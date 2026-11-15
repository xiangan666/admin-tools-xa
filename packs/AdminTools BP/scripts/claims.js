/**
 * claims.js — Land claim logic
 *
 * Handles: create, delete, query, overlap, trust, permission,
 * visualization, and event logging for land claims.
 *
 * No UI lives here. All UI is in ui-claims-player.js and ui-claims-admin.js.
 */

import { world, system } from "@minecraft/server";
import { NS, KEY, LIMITS, ITEMS, PKEY } from "./constants.js";
import {
  getClaimsMeta,
  setClaimsMeta,
  loadClaimsPage,
  saveClaimsPage,
  getClaimLog,
  appendClaimLog,
  getCfg,
  getPlayerCore,
} from "./storage.js";
import { isAdmin, isStaff, isModerator, modCan, isOwner, adminCan } from "./permissions.js";
import {
  getPlayerXuid,
  nowMs,
  genId,
  safeJsonParse,
  tell,
  silentCatch,
} from "./utils.js";
// Feasibility `reason`, blocker `message`, and verdict `hint` fields are
// RawMessages (t()/raw()) — UI consumers must compose them with raw(), never
// template literals.
import { t } from "./i18n.js";

/** Chinese log text only; the stored member role enum is unchanged. */
function claimRoleLabel(role) {
  return ({ visitor: "访客", member: "成员", builder: "建造者", "co-owner": "共同所有者" })[role] ?? String(role);
}

// =========================================================
// Vehicle detection (component-based, addon-friendly)
// =========================================================

/**
 * Returns true if `entity` looks like a non-living vehicle (minecart, boat,
 * addon-provided vehicle). Detected via the `minecraft:rideable` component,
 * excluding anything in the `mob` type family so saddled living mounts
 * (horses, pigs, striders, camels, llamas, etc.) are NOT auto-allowed by the
 * "allow vehicles" toggle — that would let strangers steal someone's mount.
 *
 * The try/catch is deliberate: the stable @minecraft/server API notes that
 * component accessors can throw on invalid/unloaded entities, and the
 * protection check must never throw.
 */
export function isVehicleEntity(entity) {
  if (!entity) return false;
  try {
    if (!entity.hasComponent("minecraft:rideable")) return false;
    const fam = entity.getComponent("minecraft:type_family");
    if (fam && fam.hasTypeFamily("mob")) return false;
    return true;
  } catch {
    return false;
  }
}

// =========================================================
// Chunk-based spatial cache (in-memory, never persisted)
// =========================================================

let _cachedClaims = null; // Claim[] — all claims loaded once
let _chunkIndex = null; // Map<string, Claim[]> — keyed by "dim|cx|cz"
let _dirty = true; // Rebuild needed?

// Whether any claim currently holds a temporary (expiring) member or trusted
// rank. When false, tickClaimMemberExpiry skips its full page scan entirely.
// Starts true so the first tick establishes the truth; re-armed whenever a
// temporary grant is added or updated, and re-evaluated at the end of each sweep.
let _hasTempGrants = true;

function _chunkKey(dim, cx, cz) {
  return `${dim}|${cx}|${cz}`;
}

function _rebuild() {
  const meta = getClaimsMeta();
  const all = [];
  for (let i = 0; i < meta.pagesUsed; i++)
    for (const c of loadClaimsPage(i)) all.push(c);

  const idx = new Map();
  for (const c of all) {
    const rects = getClaimRects(c);
    const indexed = new Set(); // avoid duplicate bucket entries for same claim
    for (const r of rects) {
      const cxMin = Math.floor(r.min.x / 16);
      const cxMax = Math.floor(r.max.x / 16);
      const czMin = Math.floor(r.min.z / 16);
      const czMax = Math.floor(r.max.z / 16);
      for (let cx = cxMin; cx <= cxMax; cx++) {
        for (let cz = czMin; cz <= czMax; cz++) {
          const key = _chunkKey(c.dimension, cx, cz);
          if (indexed.has(key)) continue;
          indexed.add(key);
          let bucket = idx.get(key);
          if (!bucket) {
            bucket = [];
            idx.set(key, bucket);
          }
          bucket.push(c);
        }
      }
    }
  }
  _cachedClaims = all;
  _chunkIndex = idx;
  _dirty = false;
}

export function invalidateClaimCache() {
  _dirty = true;
  _cachedClaims = null;
  _chunkIndex = null;
}

// =========================================================
// Wand selection state (in-memory, cleared on leave)
// =========================================================

// Map<xuid, { corner1, corner2, dimensionId, expiresAt }>
const pendingSelections = new Map();

// Pending selections expire so forgotten ones (and their markers) don't linger.
// A lone Corner 1 clears sooner; once Corner 2 is placed the whole selection
// gets a longer window to be confirmed. The expiry is refreshed when corners are
// (re)set.
const CORNER1_TIMEOUT_MS = 300_000; // 5 min — Corner 1 set, no Corner 2 yet
const FULL_SELECTION_TIMEOUT_MS = 600_000; // 10 min — both corners set, unconfirmed

// Floating corner-marker entities rendered while a wand selection is pending.
// Tracked per owner as one slot per corner ({ c1, c2 }) so re-picking a corner
// REPLACES its marker instead of stacking a new entity (each marker renders its
// own particles, so stacked Corner 2 markers left multiple outlines on screen).
const CORNER_MARKER_TYPE = `${NS}:corner_block`;
const _cornerMarkers = new Map(); // xuid -> { c1: entityId|null, c2: entityId|null }

function _removeMarkerEntity(id) {
  if (!id) return;
  try {
    const ent = world.getEntity(id);
    if (ent) ent.remove();
  } catch (e) {
    silentCatch("corner_marker_clear", e);
  }
}

function _spawnCornerMarker(xuid, dimensionId, pos, variant) {
  try {
    const slot = variant === 1 ? "c2" : "c1";
    const marks = _cornerMarkers.get(xuid) ?? { c1: null, c2: null };
    // Replace any existing marker in this slot (e.g. moving Corner 2 again).
    _removeMarkerEntity(marks[slot]);
    marks[slot] = null;
    const dim = world.getDimension(
      (dimensionId ?? "overworld").replace("minecraft:", ""),
    );
    // Center on the block in X/Z, sit at the block's base in Y so the cube
    // model fills the corner block's volume exactly.
    const ent = dim.spawnEntity(CORNER_MARKER_TYPE, {
      x: Math.floor(pos.x) + 0.5,
      y: Math.floor(pos.y) + 1,
      z: Math.floor(pos.z) + 0.5,
    });
    // variant 0 → corner-one texture, 1 → corner-two texture
    try {
      ent.setProperty(`${NS}:variant`, variant);
    } catch (e) {
      silentCatch("corner_marker_variant", e);
    }
    marks[slot] = ent.id;
    _cornerMarkers.set(xuid, marks);
  } catch (e) {
    silentCatch("corner_marker_spawn", e);
  }
}

/** Remove a player's pending-selection corner markers. */
export function clearCornerMarkers(xuid) {
  const marks = _cornerMarkers.get(xuid);
  if (!marks) return;
  _cornerMarkers.delete(xuid);
  _removeMarkerEntity(marks.c1);
  _removeMarkerEntity(marks.c2);
}

export function setCorner1(xuid, pos, dimensionId) {
  clearCornerMarkers(xuid);
  pendingSelections.set(xuid, {
    corner1: pos,
    corner2: null,
    dimensionId,
    expiresAt: nowMs() + CORNER1_TIMEOUT_MS,
  });
  _spawnCornerMarker(xuid, dimensionId, pos, 0);
}

export function setCorner2(xuid, pos, dimensionId) {
  const sel = pendingSelections.get(xuid);
  if (!sel || sel.dimensionId !== dimensionId) {
    // Different dimension or no corner1 — start fresh with just corner1
    setCorner1(xuid, pos, dimensionId);
    return false;
  }
  sel.corner2 = pos;
  // Both corners set — give the whole selection a longer window to be confirmed.
  sel.expiresAt = nowMs() + FULL_SELECTION_TIMEOUT_MS;
  _spawnCornerMarker(xuid, dimensionId, pos, 1);
  return true;
}

export function getPendingSelection(xuid) {
  return pendingSelections.get(xuid) ?? null;
}

export function clearPendingSelection(xuid) {
  clearCornerMarkers(xuid);
  pendingSelections.delete(xuid);
}

// Auto-expire pending selections so forgotten ones (and their floating markers)
// get cleaned up: a lone Corner 1 after CORNER1_TIMEOUT_MS, a both-corners
// selection after FULL_SELECTION_TIMEOUT_MS. A confirmed/cancelled selection is
// already removed, so it never reaches here.
system.runInterval(() => {
  try {
    if (pendingSelections.size === 0) return;
    const now = nowMs();
    for (const [xuid, sel] of pendingSelections) {
      if (!sel.corner1) continue;
      if (now < (sel.expiresAt ?? Infinity)) continue;
      const hadBoth = !!sel.corner2;
      clearPendingSelection(xuid);
      try {
        const p = world.getPlayers().find((pl) => getPlayerXuid(pl) === xuid);
        if (p)
          tell(
            p,
            hadBoth
              ? t("jm_at.claims.timeout_both")
              : t("jm_at.claims.timeout_c1"),
          );
      } catch {}
    }
  } catch (e) {
    silentCatch("claim_selection_expiry", e);
  }
}, 20); // every ~1s

// Reclaim corner-marker entities that no active selection is tracking — markers
// stranded by a quit, crash, dimension change, or a removal that landed while the
// marker's chunk was unloaded (world.getEntity returns undefined there, so the
// per-id remove() in _removeMarkerEntity silently no-ops). getEntities only sees
// loaded chunks, so a stray marker is reaped the moment its chunk next loads.
// Active-selection markers are tracked in _cornerMarkers (by entity id) and
// skipped. force=true removes ALL corner markers regardless — used on script
// reload (in-memory state is gone) and by the admin "clear stray markers" action.
// Returns the number removed.
export function sweepStrayMarkers(force = false) {
  const live = new Set();
  if (!force) {
    for (const marks of _cornerMarkers.values()) {
      if (marks.c1) live.add(marks.c1);
      if (marks.c2) live.add(marks.c2);
    }
  }
  let removed = 0;
  for (const dimId of ["overworld", "nether", "the_end"]) {
    try {
      const dim = world.getDimension(dimId);
      for (const e of dim.getEntities({ type: CORNER_MARKER_TYPE })) {
        if (!force && live.has(e.id)) continue;
        try {
          e.remove();
          removed++;
        } catch {}
      }
    } catch {}
  }
  return removed;
}

// On script (re)load, in-memory selection state is gone, so force-clear every
// corner marker currently in a loaded chunk.
system.run(() => {
  try {
    sweepStrayMarkers(true);
  } catch (e) {
    silentCatch("corner_marker_startup_sweep", e);
  }
});

// Periodic safety net: reap stray markers as their chunks load. This is what
// finally removes a marker left behind when a player quit (or walked away) far
// enough that its chunk had unloaded by the time cleanup ran — it disappears
// within a few seconds of anyone being near it again.
system.runInterval(() => {
  try {
    sweepStrayMarkers(false);
  } catch (e) {
    silentCatch("corner_marker_periodic_sweep", e);
  }
}, 100); // every ~5s

// =========================================================
// Geometry helpers
// =========================================================

export function calcArea(min, max) {
  return (Math.abs(max.x - min.x) + 1) * (Math.abs(max.z - min.z) + 1);
}

export function normalizeCorners(a, b) {
  return {
    min: {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      z: Math.min(a.z, b.z),
    },
    max: {
      x: Math.max(a.x, b.x),
      y: Math.max(a.y, b.y),
      z: Math.max(a.z, b.z),
    },
  };
}

function containsPoint(min, max, pos) {
  // max + 1 because block coordinates are the block's negative corner;
  // the block at max.x occupies x to x+1, so entity positions up to max+1 are inside
  return (
    pos.x >= min.x &&
    pos.x < max.x + 1 &&
    pos.y >= min.y &&
    pos.y < max.y + 1 &&
    pos.z >= min.z &&
    pos.z < max.z + 1
  );
}

export function isFullyContained(
  innerMin,
  innerMax,
  outerMin,
  outerMax,
  ignoreY = false,
) {
  return (
    innerMin.x >= outerMin.x &&
    innerMax.x <= outerMax.x &&
    (ignoreY || (innerMin.y >= outerMin.y && innerMax.y <= outerMax.y)) &&
    innerMin.z >= outerMin.z &&
    innerMax.z <= outerMax.z
  );
}

export function claimsOverlap(minA, maxA, minB, maxB) {
  return (
    minA.x <= maxB.x &&
    maxA.x >= minB.x &&
    minA.y <= maxB.y &&
    maxA.y >= minB.y &&
    minA.z <= maxB.z &&
    maxA.z >= minB.z
  );
}

// =========================================================
// Compound claim geometry (extensions support)
// =========================================================

export function getClaimRects(claim) {
  const rects = [{ min: claim.min, max: claim.max }];
  if (claim.extensions) {
    for (const ext of claim.extensions)
      rects.push({ min: ext.min, max: ext.max });
  }
  return rects;
}

function claimContainsPoint(claim, pos) {
  for (const r of getClaimRects(claim)) {
    if (containsPoint(r.min, r.max, pos)) return true;
  }
  return false;
}

export function claimShapeOverlaps(claim, minB, maxB) {
  for (const r of getClaimRects(claim)) {
    if (claimsOverlap(r.min, r.max, minB, maxB)) return true;
  }
  return false;
}

export function rectsBorder(minA, maxA, minB, maxB) {
  // Two rects border if they share an edge (XZ) with overlapping range on the shared axis
  const zOverlap = minA.z <= maxB.z && maxA.z >= minB.z;
  const xOverlap = minA.x <= maxB.x && maxA.x >= minB.x;
  if (zOverlap && maxA.x + 1 === minB.x) return true; // A left of B
  if (zOverlap && maxB.x + 1 === minA.x) return true; // B left of A
  if (xOverlap && maxA.z + 1 === minB.z) return true; // A above B
  if (xOverlap && maxB.z + 1 === minA.z) return true; // B above A
  return false;
}

export function claimBordersRect(claim, min, max) {
  const rects = getClaimRects(claim);
  // Must not overlap any existing rect
  for (const r of rects) {
    if (claimsOverlap(r.min, r.max, min, max)) return false;
  }
  // Must border at least one rect
  for (const r of rects) {
    if (rectsBorder(r.min, r.max, min, max)) return true;
  }
  return false;
}

// ignoreY: compare only the XZ footprint. Used by the wand's expand detection
// so a claim whose height was widened past the default Y band (only owners/admins
// can do that) still registers as "encompassed" by a default-Y selection.
export function selectionEncompassesClaim(selMin, selMax, claim, ignoreY = false) {
  for (const r of getClaimRects(claim)) {
    if (!isFullyContained(r.min, r.max, selMin, selMax, ignoreY)) return false;
  }
  return true;
}

export function isInsideClaimShape(innerMin, innerMax, claim) {
  for (const r of getClaimRects(claim)) {
    if (isFullyContained(innerMin, innerMax, r.min, r.max)) return true;
  }
  return false;
}

// =========================================================
// Page iteration helpers
// =========================================================

export function getAllClaims() {
  if (_dirty) _rebuild();
  return _cachedClaims;
}

export function getClaimById(id) {
  const meta = getClaimsMeta();
  const page = meta.idToPage[id];
  if (page === undefined) return null;
  return loadClaimsPage(page).find((c) => c.id === id) ?? null;
}

export function getClaimAt(dimensionId, pos) {
  if (_dirty) _rebuild();
  const key = _chunkKey(
    dimensionId,
    Math.floor(pos.x / 16),
    Math.floor(pos.z / 16),
  );
  const candidates = _chunkIndex.get(key);
  if (!candidates) return null;
  let best = null;
  for (const c of candidates) {
    if (!claimContainsPoint(c, pos)) continue;
    if (
      !best ||
      c.area < best.area ||
      // Equal-area overlapping claims form a nesting chain (siblings can't
      // overlap), so the more deeply nested one governs. Climbing via
      // c.parentId === best.id makes the winner deterministic regardless of
      // candidate order, even for a 3-level (claim → sub → sub-sub) tie.
      (c.area === best.area &&
        c.parentId &&
        (!best.parentId || c.parentId === best.id))
    )
      best = c;
  }
  return best;
}

/** Returns the top-level (non-sub) claim containing the point, or null. */
export function getParentClaimAt(dimensionId, pos) {
  if (_dirty) _rebuild();
  const key = _chunkKey(
    dimensionId,
    Math.floor(pos.x / 16),
    Math.floor(pos.z / 16),
  );
  const candidates = _chunkIndex.get(key);
  if (!candidates) return null;
  for (const c of candidates) {
    if (c.parentId) continue;
    if (claimContainsPoint(c, pos)) return c;
  }
  return null;
}

export function getClaimsByOwner(xuid) {
  const meta = getClaimsMeta();
  const ids = meta.byOwner[xuid] ?? [];
  return ids.map((id) => getClaimById(id)).filter(Boolean);
}

export function getAdminClaims() {
  return getAllClaims().filter((c) => c.isAdminClaim && !c.parentId);
}

export function getSubClaimsByParent(parentClaimId) {
  const meta = getClaimsMeta();
  const ids = meta.byParent[parentClaimId] ?? [];
  return ids.map((id) => getClaimById(id)).filter(Boolean);
}

export function getOwnerUsedArea(xuid) {
  return getClaimsByOwner(xuid)
    .filter((c) => !c.isAdminClaim)
    .reduce((sum, c) => sum + (c.area ?? 0), 0);
}

/**
 * Enforce that only the current Server Owner may hold Owner-Only claims.
 * Any Owner-Only claim whose owner is NOT `currentOwnerXuid` is converted to an
 * ordinary personal claim: the ownerOnly flag is cleared while ownerXuid /
 * ownerName are kept, so it simply belongs to that player like any other claim
 * (it may now exceed their area budget, exactly as when an admin hands a claim
 * to a player). Inherited-ownerOnly sub-claims are converted too, since the
 * page walk visits every claim.
 *
 * Call after ownership changes so a new owner never inherits the previous
 * owner's private claims, and once at startup to repair worlds where ownership
 * changed before this rule existed. No-op when there is no current owner.
 * Returns the number of claims converted.
 */
export function releaseStrayOwnerOnlyClaims(currentOwnerXuid) {
  if (!currentOwnerXuid) return 0;
  const meta = getClaimsMeta();
  const dirty = new Map();
  let count = 0;
  for (let i = 0; i < (meta.pagesUsed ?? 0); i++) {
    const page = loadClaimsPage(i);
    let changed = false;
    for (const c of page) {
      if (c.ownerOnly && c.ownerXuid !== currentOwnerXuid) {
        c.ownerOnly = false;
        count++;
        changed = true;
      }
    }
    if (changed) dirty.set(i, page);
  }
  if (dirty.size > 0) {
    for (const [i, page] of dirty) saveClaimsPage(i, page);
    invalidateClaimCache();
  }
  return count;
}

export function getPlayerClaimBudget(player) {
  const cfg = getCfg();
  const core = getPlayerCore(player);
  const playMs = core.playTimeMs ?? 0;
  const bonus = core.bonusChunks ?? 0;
  const intervalMs = (cfg.claimAreaTimeInterval ?? 60) * 60000;
  const earned =
    intervalMs > 0
      ? Math.floor(playMs / intervalMs) * (cfg.claimAreaPerTime ?? 1)
      : 0;
  return Math.min(
    (cfg.claimStartArea ?? 5) + earned + bonus,
    (cfg.claimMaxArea ?? 15) + bonus,
  ); // chunks
}

// =========================================================
// Shared feasibility helpers — the SINGLE authority for "can this claim
// operation happen?", consumed by both the commit functions (createClaim,
// expandClaim, extendClaim, createSubClaim) and the preview (evaluateSelection),
// so a preview can never disagree with the commit. Each returns
// { ok: true, ... } | { ok: false, reason }, with reason strings byte-for-byte
// identical to what callers display via warnForm.
// =========================================================

// Area-budget check. addArea = blocks² being added; alreadyCountedArea = blocks²
// of this owner's area already in getOwnerUsedArea that the op REPLACES (expand
// passes the claim's old area so only the delta is charged; create/extend pass
// 0). Budget is in CHUNKS, area in BLOCKS² (1 chunk = 256 blocks²).
function _budgetCheck(player, xuid, addArea, alreadyCountedArea = 0) {
  const budgetBlocks = getPlayerClaimBudget(player) * 256;
  const usedArea = getOwnerUsedArea(xuid) - alreadyCountedArea;
  if (usedArea + addArea > budgetBlocks) {
    const remaining = (budgetBlocks - usedArea) / 256;
    return {
      ok: false,
      reason: t("jm_at.claims.r_budget", Math.round(remaining * 100) / 100),
    };
  }
  return { ok: true };
}

// Apply the server default Y band for a NEW top-level claim and compute its XZ
// footprint area. Mirrors exactly what createClaim stores. (Sub-claims inherit
// parent Y; expand/extend preserve the claim's own Y — those do NOT use this.)
export function normalizeClaimBounds(cfg, dimId, heightRange, min, max) {
  const hRange = heightRange ?? { min: -64, max: 320 };
  const defaultY = cfg.claimDefaultY?.[dimId.replace("minecraft:", "")];
  const nMin = { x: min.x, y: defaultY?.min ?? hRange.min, z: min.z };
  const nMax = { x: max.x, y: defaultY?.max ?? hRange.max, z: max.z };
  return { min: nMin, max: nMax, area: calcArea(nMin, nMax) };
}

// Pure feasibility for a NEW top-level claim, in createClaim's EXACT order,
// returning the FIRST failing reason. Excludes the storage-full check (write-path
// only — createClaim handles that after this passes). Expects ALREADY-Y-normalized
// min/max and the pre-computed area (see normalizeClaimBounds).
export function checkClaimCreatable({
  player,
  xuid,
  cfg,
  dimId,
  min,
  max,
  area,
  isAdminClaim,
  ownerOnly,
  skipOverlap,
}) {
  // Dimension allow check (admin & owner-only claims bypass)
  if (!isAdminClaim && !ownerOnly) {
    if (dimId === "minecraft:nether" && cfg.claimAllowNether === false)
      return { ok: false, reason: t("jm_at.claims.r_no_nether") };
    if (dimId === "minecraft:the_end" && cfg.claimAllowEnd === false)
      return { ok: false, reason: t("jm_at.claims.r_no_end") };
  }
  // Overlap check (skip sub-claims — they're inside parents)
  if (!skipOverlap) {
    for (const c of getAllClaims()) {
      if (c.parentId) continue;
      if (c.dimension !== dimId) continue;
      if (claimShapeOverlaps(c, min, max))
        return { ok: false, reason: t("jm_at.claims.r_overlap") };
    }
  }
  if (!isAdminClaim && !ownerOnly) {
    // Admin-only claiming
    if (cfg.maxClaimsPerPlayer === 0)
      return {
        ok: false,
        reason: t("jm_at.claims.wand_admin_only"),
      };
    // Claim count limit — personal claims only. Admin/server claims must never
    // count against the player's limit (they're excluded from byOwner, but filter
    // defensively so a stale index can't wrongly block a personal claim).
    const ownedCount = getClaimsByOwner(xuid).filter(
      (c) => !c.isAdminClaim,
    ).length;
    if (ownedCount >= cfg.maxClaimsPerPlayer)
      return {
        ok: false,
        reason: t("jm_at.claims.r_claim_limit", cfg.maxClaimsPerPlayer),
      };
    // Area budget (dynamic per-player, in chunks → blocks²)
    const b = _budgetCheck(player, xuid, area);
    if (!b.ok) return b;
  }
  return { ok: true };
}

// =========================================================
// Create / delete
// =========================================================

export function createClaim(
  player,
  min,
  max,
  isAdminClaim = false,
  skipOverlap = false,
  ownerOnly = false,
) {
  const cfg = getCfg();
  const xuid = getPlayerXuid(player);
  const dimId = player.dimension.id;
  const norm = normalizeClaimBounds(
    cfg,
    dimId,
    player.dimension.heightRange,
    min,
    max,
  );
  min = norm.min;
  max = norm.max;
  const area = norm.area;

  const feasible = checkClaimCreatable({
    player,
    xuid,
    cfg,
    dimId,
    min,
    max,
    area,
    isAdminClaim,
    ownerOnly,
    skipOverlap,
  });
  if (!feasible.ok) return feasible;

  const claim = {
    id: genId("clm"),
    ownerXuid: xuid,
    ownerName: player.name,
    isAdminClaim,
    ownerOnly,
    ownerIsAdmin: isAdmin(player).ok,
    dimension: dimId,
    min,
    max,
    area,
    name: "",
    welcomeMsg: "", // optional per-claim entry message (owner-set)
    createdAt: nowMs(),
    members: [], // [{ xuid, name, role: "visitor"|"member"|"builder"|"co-owner", expiresAt? }]
    trustedRanks: [], // rank tag strings
    protections: { ...cfg.claimProtections },
  };

  // Write to storage. A page rolls over when full by COUNT, or when adding this
  // claim would exceed the 32KB per-property byte cap (a page of large claims can
  // hit the wall before CLAIMS_PER_PAGE entries). saveClaimsPage returns false on
  // an over-size write, leaving the stored page untouched — so we retry on a fresh
  // page rather than silently losing the claim. pagesUsed is committed only after
  // a successful write.
  const meta = getClaimsMeta();
  let pagesUsed = Math.max(meta.pagesUsed, 1);
  let pageIdx = meta.pagesUsed > 0 ? meta.pagesUsed - 1 : 0;
  let page = meta.pagesUsed > 0 ? loadClaimsPage(pageIdx) : [];

  if (page.length >= LIMITS.CLAIMS_PER_PAGE) {
    if (pagesUsed >= LIMITS.CLAIMS_PAGES)
      return { ok: false, reason: t("jm_at.claims.r_storage_full") };
    pageIdx = pagesUsed;
    page = [];
    pagesUsed++;
  }

  page.push(claim);
  let saved = saveClaimsPage(pageIdx, page);
  if (!saved && page.length > 1) {
    if (pagesUsed >= LIMITS.CLAIMS_PAGES)
      return { ok: false, reason: t("jm_at.claims.r_storage_full") };
    pageIdx = pagesUsed;
    page = [claim];
    pagesUsed++;
    saved = saveClaimsPage(pageIdx, page);
  }
  if (!saved)
    return {
      ok: false,
      reason: t("jm_at.claims.r_save_too_large"),
    };

  meta.pagesUsed = pagesUsed;
  meta.idToPage[claim.id] = pageIdx;
  if (!isAdminClaim) {
    if (!meta.byOwner[xuid]) meta.byOwner[xuid] = [];
    meta.byOwner[xuid].push(claim.id);
  }
  setClaimsMeta(meta);
  invalidateClaimCache();

  logClaimEvent("create", claim, player);
  return { ok: true, claim };
}

// Write order: sub-claim pages → parent page → meta (last, as commit step).
// If a crash occurs mid-operation, reconcileStorageMeta() repairs orphans on next startup.
export function deleteClaim(claimId, actorPlayer, isForced = false) {
  const meta = getClaimsMeta();
  const pageIdx = meta.idToPage[claimId];
  if (pageIdx === undefined) return false;

  const page = loadClaimsPage(pageIdx);
  const idx = page.findIndex((c) => c.id === claimId);
  if (idx === -1) return false;

  // Owner-only claims can only be deleted by the Server Owner — not by staff,
  // even through the forced/admin delete path. System deletions (no actor) pass.
  if (page[idx]?.ownerOnly && actorPlayer && !isOwner(actorPlayer)) return false;

  // Cascade-delete sub-claims (and their children) first
  const subIds = (meta.byParent[claimId] ?? []).slice();
  for (const subId of subIds) {
    // Delete grandchildren (sub-sub-claims) of this sub-claim
    const grandchildIds = (meta.byParent[subId] ?? []).slice();
    for (const gcId of grandchildIds) {
      const gcPageIdx = meta.idToPage[gcId];
      if (gcPageIdx === undefined) continue;
      const gcPage = loadClaimsPage(gcPageIdx);
      const gcIdx = gcPage.findIndex((c) => c.id === gcId);
      if (gcIdx !== -1) {
        gcPage.splice(gcIdx, 1);
        try { saveClaimsPage(gcPageIdx, gcPage); } catch (e) { silentCatch("delete_subsub_page", e); }
      }
      delete meta.idToPage[gcId];
    }
    delete meta.byParent[subId];

    const subPageIdx = meta.idToPage[subId];
    if (subPageIdx === undefined) continue;
    const subPage = loadClaimsPage(subPageIdx);
    const subIdx = subPage.findIndex((c) => c.id === subId);
    if (subIdx !== -1) {
      subPage.splice(subIdx, 1);
      try { saveClaimsPage(subPageIdx, subPage); } catch (e) { silentCatch("delete_sub_page", e); }
    }
    delete meta.idToPage[subId];
  }
  delete meta.byParent[claimId];

  // Reload the parent's page in case sub-claims on the same page were removed above
  const freshPage = loadClaimsPage(pageIdx);
  const freshIdx = freshPage.findIndex((c) => c.id === claimId);
  if (freshIdx === -1) return false;
  const claim = freshPage[freshIdx];
  freshPage.splice(freshIdx, 1);
  saveClaimsPage(pageIdx, freshPage);

  delete meta.idToPage[claimId];
  const ownerList = meta.byOwner[claim.ownerXuid] ?? [];
  const ownerIdx = ownerList.indexOf(claimId);
  if (ownerIdx !== -1) ownerList.splice(ownerIdx, 1);
  if (ownerList.length === 0) delete meta.byOwner[claim.ownerXuid];
  else meta.byOwner[claim.ownerXuid] = ownerList;
  setClaimsMeta(meta);
  invalidateClaimCache();

  logClaimEvent(isForced ? "delete_admin" : "delete_owner", claim, actorPlayer);
  return true;
}

/**
 * Delete every top-level claim owned by `xuid` (sub-claims cascade with their
 * parent), including the owner's Owner-Only claims. Admin claims are rank-based
 * and not tracked per owner, so they are NOT included. `actorPlayer` is the
 * Server Owner running the reset; it is passed to deleteClaim so the Owner-Only
 * guard passes and the deletion is attributed in the claim log. Returns the
 * number of top-level claims removed.
 */
export function resetClaimsByOwner(xuid, actorPlayer) {
  if (!xuid) return 0;
  // Snapshot ids first — deleteClaim mutates the meta indexes as it runs.
  const ids = getClaimsByOwner(xuid)
    .filter((c) => !c.parentId)
    .map((c) => c.id);
  let removed = 0;
  for (const id of ids) {
    try {
      if (deleteClaim(id, actorPlayer, true)) removed++;
    } catch (e) {
      silentCatch("reset_owner_claim", e);
    }
  }
  return removed;
}

/**
 * Delete EVERY claim in the world (player, admin, and Owner-Only). Top-level
 * claims are removed and their sub-claims cascade. `actorPlayer` is the Server
 * Owner running the reset. Returns the number of top-level claims removed.
 */
export function resetAllClaims(actorPlayer) {
  const ids = getAllClaims()
    .filter((c) => !c.parentId)
    .map((c) => c.id);
  let removed = 0;
  for (const id of ids) {
    try {
      if (deleteClaim(id, actorPlayer, true)) removed++;
    } catch (e) {
      silentCatch("reset_all_claim", e);
    }
  }
  return removed;
}

// Pure feasibility for creating a sub-claim inside `parent` (Y inherited from
// the parent). Same checks, order, and reason strings as the createSubClaim
// authority. NOTE: like the authority, this performs NO actor authorization —
// the caller/UI must gate who may sub-claim. Returns { ok:true, min, max, area }.
export function checkSubClaimFeasible(parent, min, max) {
  if (!parent) return { ok: false, reason: t("jm_at.claims.r_parent_not_found") };
  // Allow up to 2 levels of nesting (claim -> sub -> sub-sub)
  if (parent.parentId) {
    const grandparent = getClaimById(parent.parentId);
    if (grandparent && grandparent.parentId)
      return {
        ok: false,
        reason: t("jm_at.claims.r_nest_depth"),
      };
  }

  // Inherit Y bounds from parent
  const nMin = { x: min.x, y: parent.min.y, z: min.z };
  const nMax = { x: max.x, y: parent.max.y, z: max.z };

  // Containment check (must fit inside one rect: primary or extension)
  if (!isInsideClaimShape(nMin, nMax, parent))
    return {
      ok: false,
      reason: t("jm_at.claims.r_sub_within_parent"),
    };

  // Sub-claim count limit
  const siblingIds = getClaimsMeta().byParent[parent.id] ?? [];
  if (siblingIds.length >= LIMITS.SUBCLAIMS_PER_CLAIM)
    return {
      ok: false,
      reason: t("jm_at.claims.r_sub_max", LIMITS.SUBCLAIMS_PER_CLAIM),
    };

  // Overlap check against sibling sub-claims
  for (const sibId of siblingIds) {
    const sib = getClaimById(sibId);
    if (sib && claimsOverlap(nMin, nMax, sib.min, sib.max))
      return { ok: false, reason: t("jm_at.claims.r_sub_overlap") };
  }

  return { ok: true, min: nMin, max: nMax, area: calcArea(nMin, nMax) };
}

export function createSubClaim(player, min, max, parentClaimId) {
  const parent = getClaimById(parentClaimId);
  const feas = checkSubClaimFeasible(parent, min, max);
  if (!feas.ok) return feas;
  min = feas.min;
  max = feas.max;
  const area = feas.area;

  const meta = getClaimsMeta();
  const claim = {
    id: genId("sub"),
    parentId: parentClaimId,
    ownerXuid: parent.ownerXuid,
    ownerName: parent.ownerName,
    isAdminClaim: parent.isAdminClaim,
    ownerOnly: parent.ownerOnly ?? false,
    ownerIsAdmin: parent.ownerIsAdmin ?? false,
    dimension: parent.dimension,
    min,
    max,
    area,
    name: "",
    welcomeMsg: "", // optional per-claim entry message (owner-set)
    createdAt: nowMs(),
    members: [],
    trustedRanks: [],
    protections: { ...parent.protections },
  };

  // Store in paginated storage. Same count/byte rollover + deferred commit as
  // createClaim: retry on a fresh page if the write would exceed the 32KB cap,
  // and surface a failure instead of silently dropping the sub-claim.
  let pagesUsed = Math.max(meta.pagesUsed, 1);
  let pageIdx = meta.pagesUsed > 0 ? meta.pagesUsed - 1 : 0;
  let page = meta.pagesUsed > 0 ? loadClaimsPage(pageIdx) : [];

  if (page.length >= LIMITS.CLAIMS_PER_PAGE) {
    if (pagesUsed >= LIMITS.CLAIMS_PAGES)
      return { ok: false, reason: t("jm_at.claims.r_storage_full") };
    pageIdx = pagesUsed;
    page = [];
    pagesUsed++;
  }

  page.push(claim);
  let saved = saveClaimsPage(pageIdx, page);
  if (!saved && page.length > 1) {
    if (pagesUsed >= LIMITS.CLAIMS_PAGES)
      return { ok: false, reason: t("jm_at.claims.r_storage_full") };
    pageIdx = pagesUsed;
    page = [claim];
    pagesUsed++;
    saved = saveClaimsPage(pageIdx, page);
  }
  if (!saved)
    return {
      ok: false,
      reason: t("jm_at.claims.r_sub_save_too_large"),
    };

  meta.pagesUsed = pagesUsed;
  meta.idToPage[claim.id] = pageIdx;
  if (!meta.byParent[parentClaimId]) meta.byParent[parentClaimId] = [];
  meta.byParent[parentClaimId].push(claim.id);
  setClaimsMeta(meta);
  invalidateClaimCache();

  logClaimEvent("subclaim_create", claim, player);
  return { ok: true, claim };
}

export function deleteSubClaim(subClaimId, actorPlayer) {
  const meta = getClaimsMeta();
  const pageIdx = meta.idToPage[subClaimId];
  if (pageIdx === undefined) return false;

  // Cascade-delete children (sub-sub-claims) first
  const childIds = (meta.byParent[subClaimId] ?? []).slice();
  for (const childId of childIds) {
    const childPageIdx = meta.idToPage[childId];
    if (childPageIdx === undefined) continue;
    const childPage = loadClaimsPage(childPageIdx);
    const childIdx = childPage.findIndex((c) => c.id === childId);
    if (childIdx !== -1) {
      childPage.splice(childIdx, 1);
      try { saveClaimsPage(childPageIdx, childPage); } catch (e) { silentCatch("delete_subsub_page", e); }
    }
    delete meta.idToPage[childId];
  }
  delete meta.byParent[subClaimId];

  // Reload the page in case children on the same page were removed above
  const page = loadClaimsPage(pageIdx);
  const idx = page.findIndex((c) => c.id === subClaimId);
  if (idx === -1) return false;

  const sub = page[idx];
  page.splice(idx, 1);
  saveClaimsPage(pageIdx, page);

  delete meta.idToPage[subClaimId];
  // Remove from parent's byParent list
  if (sub.parentId && meta.byParent[sub.parentId]) {
    const arr = meta.byParent[sub.parentId];
    const i = arr.indexOf(subClaimId);
    if (i !== -1) arr.splice(i, 1);
    if (arr.length === 0) delete meta.byParent[sub.parentId];
  }
  setClaimsMeta(meta);
  invalidateClaimCache();

  logClaimEvent("subclaim_delete", sub, actorPlayer);
  return true;
}

export function renameClaim(claimId, newName) {
  const meta = getClaimsMeta();
  const pageIdx = meta.idToPage[claimId];
  if (pageIdx === undefined) return false;
  const page = loadClaimsPage(pageIdx);
  const claim = page.find((c) => c.id === claimId);
  if (!claim) return false;
  claim.name = newName.slice(0, LIMITS.CLAIM_NAME_MAX);
  saveClaimsPage(pageIdx, page);
  invalidateClaimCache();
  return true;
}

/** Set (or clear, with "") a claim's custom entry message. */
export function setClaimWelcomeMessage(claimId, msg) {
  const meta = getClaimsMeta();
  const pageIdx = meta.idToPage[claimId];
  if (pageIdx === undefined) return false;
  const page = loadClaimsPage(pageIdx);
  const claim = page.find((c) => c.id === claimId);
  if (!claim) return false;
  claim.welcomeMsg = String(msg ?? "").slice(0, LIMITS.CLAIM_WELCOME_MAX);
  if (!saveClaimsPage(pageIdx, page)) return false; // over-32KB write refused
  invalidateClaimCache();
  return true;
}

// Write order: parent page → sub-claim pages → meta (last, as commit step).
export function transferClaim(
  claimId,
  newOwnerXuid,
  newOwnerName,
  actorPlayer,
) {
  const meta = getClaimsMeta();
  const pageIdx = meta.idToPage[claimId];
  if (pageIdx === undefined) return false;
  const page = loadClaimsPage(pageIdx);
  const claim = page.find((c) => c.id === claimId);
  if (!claim) return false;

  // Owner-only claims can only be transferred by the Server Owner — transfer
  // clears the ownerOnly flag, so allowing a non-owner here would permanently
  // strip the protection. Mirrors the guard in deleteClaim. System transfers
  // (no actor) are allowed.
  if (claim.ownerOnly && actorPlayer && !isOwner(actorPlayer)) return false;

  const oldXuid = claim.ownerXuid;

  // Update byOwner index — remove from old owner
  const oldList = meta.byOwner[oldXuid] ?? [];
  const oldIdx = oldList.indexOf(claimId);
  if (oldIdx !== -1) oldList.splice(oldIdx, 1);
  if (oldList.length === 0) delete meta.byOwner[oldXuid];
  else meta.byOwner[oldXuid] = oldList;

  // Add to new owner
  if (!meta.byOwner[newOwnerXuid]) meta.byOwner[newOwnerXuid] = [];
  meta.byOwner[newOwnerXuid].push(claimId);

  // Determine the new owner's admin status (online check; offline owners get
  // backfilled the next time they join, via refreshOwnerAdminFlag).
  const _newOwnerAdmin = onlineXuidIsAdmin(newOwnerXuid) === true;

  // Update claim itself
  claim.ownerXuid = newOwnerXuid;
  claim.ownerName = newOwnerName;
  claim.isAdminClaim = false;
  claim.ownerOnly = false;
  claim.ownerIsAdmin = _newOwnerAdmin;
  // Drop a now-redundant member/co-owner entry for the new owner (the ownerXuid
  // check supersedes it; leaving it behind is just stale data).
  if (Array.isArray(claim.members))
    claim.members = claim.members.filter((m) => m.xuid !== newOwnerXuid);

  saveClaimsPage(pageIdx, page);

  // Cascade ownership to sub-claims and their children
  const subIds = meta.byParent[claimId] ?? [];
  for (const subId of subIds) {
    const subPageIdx = meta.idToPage[subId];
    if (subPageIdx === undefined) continue;
    const subPage = loadClaimsPage(subPageIdx);
    const sub = subPage.find((c) => c.id === subId);
    if (sub) {
      sub.ownerXuid = newOwnerXuid;
      sub.ownerName = newOwnerName;
      sub.isAdminClaim = false;
      sub.ownerOnly = false;
      sub.ownerIsAdmin = _newOwnerAdmin;
      if (Array.isArray(sub.members))
        sub.members = sub.members.filter((m) => m.xuid !== newOwnerXuid);
      try { saveClaimsPage(subPageIdx, subPage); } catch (e) { silentCatch("transfer_sub_page", e); }
    }
    // Cascade to sub-sub-claims
    const grandchildIds = meta.byParent[subId] ?? [];
    for (const gcId of grandchildIds) {
      const gcPageIdx = meta.idToPage[gcId];
      if (gcPageIdx === undefined) continue;
      const gcPage = loadClaimsPage(gcPageIdx);
      const gc = gcPage.find((c) => c.id === gcId);
      if (gc) {
        gc.ownerXuid = newOwnerXuid;
        gc.ownerName = newOwnerName;
        gc.isAdminClaim = false;
        gc.ownerOnly = false;
        gc.ownerIsAdmin = _newOwnerAdmin;
        if (Array.isArray(gc.members))
          gc.members = gc.members.filter((m) => m.xuid !== newOwnerXuid);
        try { saveClaimsPage(gcPageIdx, gcPage); } catch (e) { silentCatch("transfer_subsub_page", e); }
      }
    }
  }

  setClaimsMeta(meta);
  invalidateClaimCache();
  logClaimEvent("transfer", claim, actorPlayer, `→ ${newOwnerName}`);
  return true;
}

/**
 * Update the ownerName field on all claims belonging to a XUID.
 * Called when a player's gamertag changes.
 */
export function updateClaimOwnerName(xuid, newName) {
  const claims = getClaimsByOwner(xuid);
  if (!claims.length) return;
  const meta = getClaimsMeta();

  // Group claim IDs by page so each page is loaded, modified, and saved once
  const pageMap = new Map(); // pageIdx → Set<claimId>
  for (const claim of claims) {
    const pageIdx = meta.idToPage[claim.id];
    if (pageIdx === undefined) continue;
    if (!pageMap.has(pageIdx)) pageMap.set(pageIdx, new Set());
    pageMap.get(pageIdx).add(claim.id);
  }

  for (const [pageIdx, claimIds] of pageMap) {
    const page = loadClaimsPage(pageIdx);
    for (const c of page) {
      if (claimIds.has(c.id)) c.ownerName = newName;
    }
    saveClaimsPage(pageIdx, page);
  }
  if (pageMap.size) invalidateClaimCache();
}

export function updateClaimYBounds(claimId, minY, maxY) {
  const meta = getClaimsMeta();
  const pageIdx = meta.idToPage[claimId];
  if (pageIdx === undefined) return false;
  const page = loadClaimsPage(pageIdx);
  const claim = page.find((c) => c.id === claimId);
  if (!claim) return false;
  claim.min = { ...claim.min, y: minY };
  claim.max = { ...claim.max, y: maxY };
  saveClaimsPage(pageIdx, page);

  // Sub-claims always span the parent's full Y band (createSubClaim inherits it,
  // and there is no separate sub Y to preserve). Re-inherit the new range here —
  // clamping inward only would leave a sub permanently narrower after the parent
  // shrinks and then later grows back.
  const subIds = meta.byParent[claimId] ?? [];
  for (const subId of subIds) {
    const subPageIdx = meta.idToPage[subId];
    if (subPageIdx === undefined) continue;
    const subPage = loadClaimsPage(subPageIdx);
    const sub = subPage.find((c) => c.id === subId);
    if (!sub) continue;
    if (sub.min.y !== minY || sub.max.y !== maxY) {
      sub.min = { ...sub.min, y: minY };
      sub.max = { ...sub.max, y: maxY };
      saveClaimsPage(subPageIdx, subPage);
    }
  }

  invalidateClaimCache();
  logClaimEvent("adjust_height", claim, null, `y ${minY} → ${maxY}`);
  return true;
}

// Pure feasibility for expanding a claim's XZ footprint to newMin/newMax (Y is
// PRESERVED from the claim). Same checks, order, and reason strings as the
// expandClaim authority. Returns { ok:true, min, max, area } (Y-preserved bounds)
// on success so the commit and preview use identical bounds.
export function checkExpandFeasible(player, claim, newMin, newMax) {
  const xuid = getPlayerXuid(player);
  if (
    (claim.ownerXuid !== xuid && !isAdmin(player).ok) ||
    (claim.ownerOnly && !isOwner(player))
  ) {
    return { ok: false, reason: t("jm_at.claims.r_not_owner") };
  }

  // Preserve the claim's existing Y band — expanding only grows the XZ footprint.
  const nMin = { x: newMin.x, y: claim.min.y, z: newMin.z };
  const nMax = { x: newMax.x, y: claim.max.y, z: newMax.z };
  const newArea = calcArea(nMin, nMax);

  // The expanded footprint must still fully cover the claim's current shape
  // (base rect + any extensions). expandClaim deletes the extensions, so without
  // this an "expand" to a non-encompassing rect would silently move/shrink the
  // claim and orphan that area. Y is ignored (expand preserves the Y band).
  if (!selectionEncompassesClaim(nMin, nMax, claim, true)) {
    return {
      ok: false,
      reason: t("jm_at.claims.r_expand_cover"),
    };
  }

  // Budget check (only charge the difference — claim.area is already in usedArea)
  if (!claim.isAdminClaim) {
    const b = _budgetCheck(player, xuid, newArea, claim.area);
    if (!b.ok) return b;
  }

  // Overlap check against all other top-level claims
  for (const c of getAllClaims()) {
    if (c.parentId) continue;
    if (c.id === claim.id) continue;
    if (c.dimension !== claim.dimension) continue;
    if (claimShapeOverlaps(c, nMin, nMax))
      return { ok: false, reason: t("jm_at.claims.r_expand_overlap") };
  }

  // Sub-claim safety: verify all subs still fit in new bounds
  const subIds = getClaimsMeta().byParent[claim.id] ?? [];
  for (const subId of subIds) {
    const sub = getClaimById(subId);
    if (sub && !isFullyContained(sub.min, sub.max, nMin, nMax))
      return {
        ok: false,
        reason: t("jm_at.claims.r_expand_subclaim_outside"),
      };
  }

  return { ok: true, min: nMin, max: nMax, area: newArea };
}

export function expandClaim(claimId, player, newMin, newMax) {
  const meta = getClaimsMeta();
  const pageIdx = meta.idToPage[claimId];
  if (pageIdx === undefined) return { ok: false, reason: t("jm_at.claims.r_not_found") };
  const page = loadClaimsPage(pageIdx);
  const claim = page.find((c) => c.id === claimId);
  if (!claim) return { ok: false, reason: t("jm_at.claims.r_not_found") };

  const feas = checkExpandFeasible(player, claim, newMin, newMax);
  if (!feas.ok) return feas;

  claim.min = feas.min;
  claim.max = feas.max;
  claim.area = feas.area;
  delete claim.extensions;
  saveClaimsPage(pageIdx, page);
  invalidateClaimCache();
  logClaimEvent("expand", claim, player);
  return { ok: true, claim };
}

// Pure feasibility for adding a bordering extension rect to a claim (Y inherited
// from the claim). Same checks, order, and reason strings as the extendClaim
// authority. Returns { ok:true, min, max, area } on success.
export function checkExtendFeasible(player, claim, extMin, extMax) {
  const xuid = getPlayerXuid(player);
  if (
    (claim.ownerXuid !== xuid && !isAdmin(player).ok) ||
    (claim.ownerOnly && !isOwner(player))
  ) {
    return { ok: false, reason: t("jm_at.claims.r_not_owner") };
  }

  if ((claim.extensions?.length ?? 0) >= 2) {
    return {
      ok: false,
      reason: t("jm_at.claims.r_ext_max"),
    };
  }

  // Inherit Y from claim
  const nMin = { x: extMin.x, y: claim.min.y, z: extMin.z };
  const nMax = { x: extMax.x, y: claim.max.y, z: extMax.z };
  const extArea = calcArea(nMin, nMax);

  // Budget check (charges the full extension area)
  if (!claim.isAdminClaim) {
    const b = _budgetCheck(player, xuid, extArea);
    if (!b.ok) return b;
  }

  // Must border existing shape (also rejects self-overlap)
  if (!claimBordersRect(claim, nMin, nMax)) {
    return {
      ok: false,
      reason: t("jm_at.claims.r_ext_border"),
    };
  }

  // Overlap check against all other top-level claims
  for (const c of getAllClaims()) {
    if (c.parentId) continue;
    if (c.id === claim.id) continue;
    if (c.dimension !== claim.dimension) continue;
    if (claimShapeOverlaps(c, nMin, nMax))
      return { ok: false, reason: t("jm_at.claims.r_ext_overlap") };
  }

  return { ok: true, min: nMin, max: nMax, area: extArea };
}

export function extendClaim(claimId, player, extMin, extMax) {
  const meta = getClaimsMeta();
  const pageIdx = meta.idToPage[claimId];
  if (pageIdx === undefined) return { ok: false, reason: t("jm_at.claims.r_not_found") };
  const page = loadClaimsPage(pageIdx);
  const claim = page.find((c) => c.id === claimId);
  if (!claim) return { ok: false, reason: t("jm_at.claims.r_not_found") };

  const feas = checkExtendFeasible(player, claim, extMin, extMax);
  if (!feas.ok) return feas;

  if (!claim.extensions) claim.extensions = [];
  claim.extensions.push({ min: feas.min, max: feas.max, area: feas.area });
  claim.area += feas.area;
  saveClaimsPage(pageIdx, page);
  invalidateClaimCache();
  logClaimEvent("extend", claim, player);
  return { ok: true, claim };
}

// =========================================================
// Selection evaluation — the single source of truth that backs claim PREVIEWS
// (wand menu, corner-2 hint, confirm screen). Pure read: no mutation, no storage
// writes. Classifies a pending selection exactly as the wand menu does, then
// reuses the SAME feasibility helpers the commit authorities use, so a preview
// can never disagree with what create/expand/extend/sub-claim will actually do.
// =========================================================

function _claimRef(c) {
  return {
    id: c.id,
    name: c.name || c.id,
    ownerName: c.ownerName,
    ownerXuid: c.ownerXuid,
    isAdminClaim: !!c.isAdminClaim,
    ownerOnly: !!c.ownerOnly,
  };
}

function _round2(n) {
  return Math.round(n * 100) / 100;
}

// Budget snapshot for display. addArea / alreadyCountedArea match _budgetCheck.
// bypass=true for admin/owner-only (create) or claim.isAdminClaim (expand/extend),
// where no budget is charged.
function _budgetInfo(player, xuid, addArea, alreadyCountedArea, bypass) {
  const totalChunks = getPlayerClaimBudget(player);
  const totalBlocks = totalChunks * 256;
  const usedBlocks = getOwnerUsedArea(xuid);
  const effUsed = usedBlocks - alreadyCountedArea;
  const afterBlocks = effUsed + addArea;
  return {
    totalChunks,
    usedChunks: _round2(usedBlocks / 256),
    remainingChunks: _round2((totalBlocks - effUsed) / 256),
    afterChunks: _round2(afterBlocks / 256),
    ok: !!bypass || afterBlocks <= totalBlocks,
    bypassed: !!bypass,
  };
}

function _verdictHint(kind, targetName, ok, blockers, primaryAction, canCreateNew) {
  if (!ok) return blockers[0]?.message ?? t("jm_at.claims.hint_cant_claim");
  if (kind === "subclaim") return t("jm_at.claims.hint_subclaim", targetName);
  if (kind === "expand") return t("jm_at.claims.hint_expand", targetName);
  if (kind === "extend")
    return canCreateNew
      ? t("jm_at.claims.hint_extend_or_new", targetName)
      : t("jm_at.claims.hint_extend", targetName);
  if (primaryAction === "overwrite") return t("jm_at.claims.hint_overwrite");
  return t("jm_at.claims.hint_ready");
}

/**
 * The claim TYPE a wand PREVIEW should assume for this player, so an overlap
 * reads as an overwrite path for staff (owner -> owner-only, admin -> admin) but
 * stays a hard block for a regular player. Shared by the wand menu and the
 * corner-2 hint so the two surfaces compute the verdict identically and can
 * never disagree. Pass the result as evaluateSelection's `opts`.
 */
export function claimPreviewOpts(player) {
  if (isOwner(player)) return { ownerOnly: true };
  if (isAdmin(player).ok) return { isAdminClaim: true };
  return {};
}

/**
 * evaluateSelection(player, rawMin, rawMax, dimensionId, opts?) -> verdict
 *
 * rawMin/rawMax: the selection's XZ corners (Y is normalized internally).
 * dimensionId: the dimension the selection was made in (pending.dimensionId).
 * opts.isAdminClaim / opts.ownerOnly: the TYPE a 'new' claim would be created as
 *   (drives overlap-vs-overwrite). Defaults to a plain player claim.
 *
 * Verdict: { kind: "new"|"subclaim"|"expand"|"extend", target, ok, blockers[],
 *   warnings[], overlaps[], overwrite{deletable,blockedOwnerOnly}, budget, count,
 *   authOk, area, areaChunks, primaryAction, hint, yNormalized }. blocker/warning
 *   messages are the authority's verbatim reason strings.
 */
export function evaluateSelection(
  player,
  rawMin,
  rawMax,
  dimensionId,
  opts = {},
) {
  const cfg = getCfg();
  const xuid = getPlayerXuid(player);
  const adminMode = isAdmin(player).ok;
  const ownerMode = isOwner(player);
  const wantAdminClaim = !!opts.isAdminClaim;
  const wantOwnerOnly = !!opts.ownerOnly;

  // Y-normalize to the default band — identical to the wand menu, used for all
  // classification geometry and the 'new'-claim feasibility.
  const norm = normalizeClaimBounds(
    cfg,
    dimensionId,
    player.dimension.heightRange,
    rawMin,
    rawMax,
  );
  const min = norm.min;
  const max = norm.max;
  const area = norm.area;

  const all = getAllClaims();
  const coOwnerActive = (m) =>
    m.xuid === xuid &&
    m.role === "co-owner" &&
    !(m.expiresAt && m.expiresAt > 0 && nowMs() >= m.expiresAt);

  // Candidate sets — identical filters to showClaimsPlayer (owner-only excluded
  // for non-owners; co-owned sets empty for admins, who use the owned sets).
  const ownedTopLevel = all.filter(
    (c) =>
      !c.parentId &&
      c.dimension === dimensionId &&
      (c.ownerXuid === xuid || adminMode) &&
      (!c.ownerOnly || ownerMode),
  );
  const coOwnedTopLevel = adminMode
    ? []
    : all.filter(
        (c) =>
          !c.parentId &&
          c.dimension === dimensionId &&
          !c.ownerOnly &&
          c.ownerXuid !== xuid &&
          c.members.some(coOwnerActive),
      );
  const ownedDepth1 = all.filter(
    (c) =>
      c.parentId &&
      !getClaimById(c.parentId)?.parentId &&
      c.dimension === dimensionId &&
      (c.ownerXuid === xuid || adminMode) &&
      (!c.ownerOnly || ownerMode),
  );
  const coOwnedDepth1 = adminMode
    ? []
    : all.filter(
        (c) =>
          c.parentId &&
          !getClaimById(c.parentId)?.parentId &&
          c.dimension === dimensionId &&
          !c.ownerOnly &&
          c.ownerXuid !== xuid &&
          c.members.some(coOwnerActive),
      );

  // Classify (priority: subclaim > expand > extend > new).
  let kind = "new";
  let target = null;
  for (const c of [...ownedDepth1, ...coOwnedDepth1]) {
    if (isInsideClaimShape(min, max, c)) {
      kind = "subclaim";
      target = c;
      break;
    }
  }
  if (kind === "new")
    for (const c of [...ownedTopLevel, ...coOwnedTopLevel]) {
      if (isInsideClaimShape(min, max, c)) {
        kind = "subclaim";
        target = c;
        break;
      }
    }
  if (kind === "new")
    for (const c of ownedTopLevel) {
      if (selectionEncompassesClaim(min, max, c, true)) {
        kind = "expand";
        target = c;
        break;
      }
    }
  if (kind === "new")
    for (const c of ownedTopLevel) {
      if (claimBordersRect(c, min, max) && (c.extensions?.length ?? 0) < 2) {
        kind = "extend";
        target = c;
        break;
      }
    }

  const blockers = [];
  const warnings = [];
  let overlaps = [];
  const overwrite = { deletable: [], blockedOwnerOnly: [] };
  let budget = null;
  let count = null;
  let authOk = true;
  let canCreateNew = false; // extend-only: is a fresh claim also feasible here?

  if (kind === "subclaim") {
    // createSubClaim has NO actor-auth check (by design — the caller gates it),
    // so the verdict is the gate: an admin without the claimsAdmin privilege, or
    // anyone who isn't the owner/co-owner, must not be offered a sub-claim inside
    // someone else's claim.
    authOk = canManageClaim(player, target);
    if (!authOk)
      blockers.push({
        code: "subclaimAuth",
        message: t("jm_at.claims.b_no_access"),
      });
    const feas = checkSubClaimFeasible(target, min, max);
    if (!feas.ok) blockers.push({ code: "subclaim", message: feas.reason });
    budget = _budgetInfo(player, xuid, 0, 0, true); // sub-claims are free
  } else if (kind === "expand") {
    authOk =
      (target.ownerXuid === xuid || adminMode) &&
      (!target.ownerOnly || ownerMode);
    const feas = checkExpandFeasible(player, target, min, max);
    if (!feas.ok) blockers.push({ code: "expand", message: feas.reason });
    budget = _budgetInfo(
      player,
      xuid,
      feas.ok ? feas.area : area,
      target.area,
      target.isAdminClaim,
    );
  } else if (kind === "extend") {
    authOk =
      (target.ownerXuid === xuid || adminMode) &&
      (!target.ownerOnly || ownerMode);
    const feas = checkExtendFeasible(player, target, min, max);
    if (!feas.ok) blockers.push({ code: "extend", message: feas.reason });
    // Whether a fresh claim of this player's type is ALSO feasible at this
    // bordering spot — gates the "Create New Claim" alternative. Computed here
    // (not in the UI) so the menu and the corner-2 hint agree.
    canCreateNew = checkClaimCreatable({
      player,
      xuid,
      cfg,
      dimId: dimensionId,
      min,
      max,
      area,
      isAdminClaim: wantAdminClaim,
      ownerOnly: wantOwnerOnly,
      skipOverlap: wantAdminClaim || wantOwnerOnly,
    }).ok;
    budget = _budgetInfo(
      player,
      xuid,
      feas.ok ? feas.area : area,
      0,
      target.isAdminClaim,
    );
  } else {
    // kind === "new"
    const skipOverlap = wantAdminClaim || wantOwnerOnly;
    // Top-level only (!c.parentId): a sub-claim always sits inside an overlapping
    // parent, and deleting that parent cascade-deletes its subs — so listing subs
    // separately would only inflate the overwrite count. (doCreate filters subs
    // the same way, so the previewed count and the deleted count always agree.)
    overlaps = all
      .filter(
        (c) =>
          !c.parentId &&
          c.dimension === dimensionId &&
          claimShapeOverlaps(c, min, max),
      )
      .map(_claimRef);
    if (skipOverlap && overlaps.length) {
      overwrite.blockedOwnerOnly = overlaps.filter(
        (c) => c.ownerOnly && !ownerMode,
      );
      overwrite.deletable = overlaps.filter((c) => !(c.ownerOnly && !ownerMode));
      if (overwrite.blockedOwnerOnly.length)
        blockers.push({
          code: "ownerOnlyOverwrite",
          message: t("jm_at.claims.b_owner_only"),
        });
      else if (overwrite.deletable.length)
        warnings.push({
          code: "overwrite",
          // lang-keys: jm_at.claims.w_overwrite_owner_only jm_at.claims.w_overwrite_admin
          message: t(
            wantOwnerOnly
              ? "jm_at.claims.w_overwrite_owner_only"
              : "jm_at.claims.w_overwrite_admin",
            overwrite.deletable.length,
          ),
        });
    }
    const feas = checkClaimCreatable({
      player,
      xuid,
      cfg,
      dimId: dimensionId,
      min,
      max,
      area,
      isAdminClaim: wantAdminClaim,
      ownerOnly: wantOwnerOnly,
      skipOverlap,
    });
    if (!feas.ok) blockers.push({ code: "new", message: feas.reason });
    // Personal claims only, matching the limit check and the displayed counter
    // (admin/server claims never count toward maxClaimsPerPlayer).
    const owned = getClaimsByOwner(xuid).filter((c) => !c.isAdminClaim).length;
    count = {
      owned,
      max: cfg.maxClaimsPerPlayer,
      adminOnly: cfg.maxClaimsPerPlayer === 0,
      ok: cfg.maxClaimsPerPlayer !== 0 && owned < cfg.maxClaimsPerPlayer,
    };
    budget = _budgetInfo(player, xuid, area, 0, wantAdminClaim || wantOwnerOnly);
  }

  const ok = blockers.length === 0;
  let primaryAction;
  if (!ok) primaryAction = "blocked";
  else if (kind === "subclaim") primaryAction = "createSub";
  else if (kind === "expand") primaryAction = "expand";
  else if (kind === "extend") primaryAction = "extend";
  else if (overwrite.deletable.length) primaryAction = "overwrite";
  else primaryAction = "create";

  const targetName = target ? target.name || target.id : "";
  return {
    kind,
    target: target ? _claimRef(target) : null,
    ok,
    blockers,
    warnings,
    overlaps,
    overwrite,
    budget,
    count,
    authOk,
    area,
    areaChunks: _round2(area / 256),
    primaryAction,
    canCreateNew,
    hint: _verdictHint(kind, targetName, ok, blockers, primaryAction, canCreateNew),
    yNormalized: { min, max },
  };
}

export function updateClaimProtections(claimId, protections) {
  const meta = getClaimsMeta();
  const pageIdx = meta.idToPage[claimId];
  if (pageIdx === undefined) return false;
  const page = loadClaimsPage(pageIdx);
  const claim = page.find((c) => c.id === claimId);
  if (!claim) return false;
  claim.protections = { ...claim.protections, ...protections };
  saveClaimsPage(pageIdx, page);
  invalidateClaimCache();
  return true;
}

// =========================================================
// Member / trust management
// =========================================================

export function addMember(claimId, xuid, name, role, expiresAt = 0) {
  const meta = getClaimsMeta();
  const pageIdx = meta.idToPage[claimId];
  if (pageIdx === undefined) return false;
  const page = loadClaimsPage(pageIdx);
  const claim = page.find((c) => c.id === claimId);
  if (!claim) return false;
  if ((claim.members?.length ?? 0) >= LIMITS.MEMBERS_PER_CLAIM) return false; // cap — keeps the page under 32KB
  if (claim.members.find((m) => m.xuid === xuid)) return false; // already a member
  const member = { xuid, name, role };
  if (expiresAt > 0) {
    member.expiresAt = expiresAt;
    _hasTempGrants = true; // re-arm the expiry sweep
  }
  claim.members.push(member);
  if (!saveClaimsPage(pageIdx, page)) return false; // over-32KB write refused
  invalidateClaimCache();
  const detail =
    `${name}，权限：${claimRoleLabel(role)}${expiresAt > 0 ? "（临时）" : ""}`;
  logClaimEvent("member_add", claim, null, detail);
  return true;
}

export function removeMember(claimId, xuid) {
  const meta = getClaimsMeta();
  const pageIdx = meta.idToPage[claimId];
  if (pageIdx === undefined) return false;
  const page = loadClaimsPage(pageIdx);
  const claim = page.find((c) => c.id === claimId);
  if (!claim) return false;
  const before = claim.members.length;
  claim.members = claim.members.filter((m) => m.xuid !== xuid);
  if (claim.members.length === before) return false;
  saveClaimsPage(pageIdx, page);
  invalidateClaimCache();
  logClaimEvent("member_remove", claim, null, xuid);
  return true;
}

/** Update an existing member's role and/or expiry (expiresAt 0 = permanent). */
export function updateMember(claimId, xuid, role, expiresAt) {
  const meta = getClaimsMeta();
  const pageIdx = meta.idToPage[claimId];
  if (pageIdx === undefined) return false;
  const page = loadClaimsPage(pageIdx);
  const claim = page.find((c) => c.id === claimId);
  if (!claim) return false;
  const member = claim.members.find((m) => m.xuid === xuid);
  if (!member) return false;
  member.role = role;
  if (expiresAt > 0) {
    member.expiresAt = expiresAt;
    _hasTempGrants = true; // re-arm the expiry sweep
  } else delete member.expiresAt;
  saveClaimsPage(pageIdx, page);
  invalidateClaimCache();
  logClaimEvent("member_update", claim, null, `${member.name} → ${claimRoleLabel(role)}`);
  return true;
}

export function addTrustedRank(
  claimId,
  rankTag,
  role = "builder",
  expiresAt = 0,
) {
  const meta = getClaimsMeta();
  const pageIdx = meta.idToPage[claimId];
  if (pageIdx === undefined) return false;
  const page = loadClaimsPage(pageIdx);
  const claim = page.find((c) => c.id === claimId);
  if (!claim) return false;
  if ((claim.trustedRanks?.length ?? 0) >= LIMITS.TRUSTED_RANKS_PER_CLAIM)
    return false; // cap — keeps the page under 32KB
  if (claim.trustedRanks.find((r) => r.tag === rankTag)) return false;
  const entry = { tag: rankTag, role };
  if (expiresAt > 0) {
    entry.expiresAt = expiresAt;
    _hasTempGrants = true; // re-arm the expiry sweep
  }
  claim.trustedRanks.push(entry);
  if (!saveClaimsPage(pageIdx, page)) return false; // over-32KB write refused
  invalidateClaimCache();
  const detail =
    `${rankTag}，权限：${claimRoleLabel(role)}${expiresAt > 0 ? "（临时）" : ""}`;
  logClaimEvent("trust_add", claim, null, detail);
  return true;
}

export function removeTrustedRank(claimId, rankTag) {
  const meta = getClaimsMeta();
  const pageIdx = meta.idToPage[claimId];
  if (pageIdx === undefined) return false;
  const page = loadClaimsPage(pageIdx);
  const claim = page.find((c) => c.id === claimId);
  if (!claim) return false;
  const before = claim.trustedRanks.length;
  claim.trustedRanks = claim.trustedRanks.filter((r) => r.tag !== rankTag);
  if (claim.trustedRanks.length === before) return false;
  saveClaimsPage(pageIdx, page);
  invalidateClaimCache();
  logClaimEvent("trust_remove", claim, null, rankTag);
  return true;
}

export function updateTrustedRank(claimId, rankTag, role, expiresAt) {
  const meta = getClaimsMeta();
  const pageIdx = meta.idToPage[claimId];
  if (pageIdx === undefined) return false;
  const page = loadClaimsPage(pageIdx);
  const claim = page.find((c) => c.id === claimId);
  if (!claim) return false;
  const entry = claim.trustedRanks.find((r) => r.tag === rankTag);
  if (!entry) return false;
  entry.role = role;
  if (expiresAt !== undefined) {
    if (expiresAt > 0) {
      entry.expiresAt = expiresAt;
      _hasTempGrants = true; // re-arm the expiry sweep
    } else delete entry.expiresAt;
  }
  saveClaimsPage(pageIdx, page);
  invalidateClaimCache();
  logClaimEvent("trust_update", claim, null, `${rankTag} → ${claimRoleLabel(role)}`);
  return true;
}

// =========================================================
// Permission check — single function for all protection hooks
// =========================================================

/** Trusted-rank sentinel that claim owners can add to trust all moderators. */
export const MOD_TRUST_TAG = "@Moderator";

/**
 * Whether a staff member's role lets them bypass this claim's protections.
 *  - Server admin claims are shared admin areas: admins ALWAYS have access;
 *    moderators need the "adminClaimBypass" privilege.
 *  - Another admin's personal claim is governed by "adminClaimBypass" — with
 *    it off the staff member acts like a normal player there (unless trusted).
 *  - Any ordinary player's claim is governed by "claimBypass".
 * Returns false for non-staff and for staff lacking the relevant privilege, so
 * they fall through to the owner/member/trusted checks below. A staff member's
 * own claim is handled by the ownership checks regardless of this result.
 */
function staffCanBypassClaim(player, claim, actorXuid) {
  if (claim.isAdminClaim) {
    if (isAdmin(player).ok) return true;
    return isModerator(player) && modCan(player, "adminClaimBypass");
  }
  const key =
    claim.ownerIsAdmin && claim.ownerXuid !== actorXuid
      ? "adminClaimBypass"
      : "claimBypass";
  if (isAdmin(player).ok) return adminCan(player, key);
  return isModerator(player) && modCan(player, key);
}

/** isAdmin status of an xuid if they're currently online; null if offline. */
function onlineXuidIsAdmin(xuid) {
  try {
    for (const p of world.getAllPlayers()) {
      if (getPlayerXuid(p) === xuid) return isAdmin(p).ok;
    }
  } catch (e) {
    silentCatch("claim_online_admin", e);
  }
  return null;
}

/**
 * Re-stamp the ownerIsAdmin flag on every top-level claim owned by an xuid.
 * Called when the owner joins so the "Admin Claim Bypass" privilege governs
 * their claims correctly after a promotion/demotion, and to backfill claims
 * created before this flag existed. Only rewrites pages that actually change.
 */
export function refreshOwnerAdminFlag(xuid, isAdminNow) {
  const meta = getClaimsMeta();
  const ids = meta.byOwner[xuid];
  if (!ids || ids.length === 0) return;
  const dirty = new Map(); // pageIdx -> page
  for (const id of ids) {
    const pageIdx = meta.idToPage[id];
    if (pageIdx === undefined) continue;
    const page = dirty.get(pageIdx) ?? loadClaimsPage(pageIdx);
    const claim = page.find((c) => c.id === id);
    if (claim && claim.ownerIsAdmin !== isAdminNow) {
      claim.ownerIsAdmin = isAdminNow;
      dirty.set(pageIdx, page);
    }
  }
  if (dirty.size > 0) {
    for (const [pageIdx, page] of dirty) saveClaimsPage(pageIdx, page);
    invalidateClaimCache();
  }
}

export function canInteract(player, dimensionId, pos, actionType, opts) {
  // actionType: "break"|"place"|"container"|"entity"|"pvp"|"interact"|"use_item"|"ender_pearl"
  // opts (optional): { isVehicle?: boolean } — used by the entity interaction
  // handler to allow minecarts/boats/addon vehicles when claim.protections.allowVehicles is true.
  const claim = getClaimAt(dimensionId, pos);
  if (!claim) return true; // unclaimed land
  const xuid = getPlayerXuid(player);
  // Owner-only claims: the live Server Owner always has full access, and NO
  // admin/moderator claim-bypass applies — being shielded from staff is the
  // whole point of owner-only. But the claim is NOT immutable to its owner:
  // members, co-owners, trusted ranks, and the owner's per-action protection
  // toggles below all still apply exactly like a personal claim, so the owner
  // can share access or reduce protections. (Do NOT short-circuit to
  // isOwner() here — that skips every member/protection check below.)
  if (claim.ownerOnly) {
    if (isOwner(player)) return true;
  } else if (staffCanBypassClaim(player, claim, xuid)) {
    // Protection bypass. Player claims gate on "claimBypass"; admin claims gate
    // on the separate "adminClaimBypass" so overriding another admin's claim can
    // be restricted independently. Staff lacking the relevant privilege are
    // treated like a normal player inside that claim.
    return true;
  }

  // Admin claims are rank-based: the creator's XUID grants no special access.
  // Only the admin/mod checks above can bypass an admin claim.
  if (!claim.isAdminClaim) {
    if (claim.ownerXuid === xuid) return true; // owner
    // Ancestor-owner OR ancestor co-owner bypass for sub-claims (up to 2 levels).
    // Mirrors canManageClaim so a parent/grandparent co-owner can actually build
    // in a sub-claim, not just manage its settings.
    if (claim.parentId) {
      const parent = getClaimById(claim.parentId);
      if (
        parent &&
        !parent.isAdminClaim &&
        (parent.ownerXuid === xuid || _isDirectCoOwner(parent, xuid))
      )
        return true;
      if (parent && parent.parentId) {
        const grandparent = getClaimById(parent.parentId);
        if (
          grandparent &&
          !grandparent.isAdminClaim &&
          (grandparent.ownerXuid === xuid || _isDirectCoOwner(grandparent, xuid))
        )
          return true;
      }
    }
  }

  // Per-action protection enabled?
  const protKey =
    actionType === "break" || actionType === "place"
      ? "blocks"
      : actionType === "container"
        ? "containers"
        : actionType === "entity"
          ? "entities"
          : actionType === "pvp"
            ? "pvp"
            : actionType === "interact"
              ? "interactions"
              : actionType === "use_item"
                ? "itemUse"
                : actionType === "ender_pearl"
                  ? "enderPearls"
                  : "blocks";
  if (!claim.protections[protKey]) return true; // protection disabled for this type

  // Vehicle exemption: when entity protection is on but the owner has opted in
  // to "allow vehicle use," let any rideable non-mob entity (minecart, boat,
  // addon vehicle) through while still blocking villagers, item frames, etc.
  if (
    actionType === "entity" &&
    claim.protections.allowVehicles === true &&
    opts?.isVehicle === true
  ) {
    return true;
  }

  // Rank trust check
  const core = getPlayerCore(player);
  const rankTag = (core.rankTag ?? "").trim();
  const _trPersonal = rankTag
    ? claim.trustedRanks.find((r) => r.tag === rankTag)
    : null;
  const _trMod = isModerator(player)
    ? claim.trustedRanks.find((r) => r.tag === MOD_TRUST_TAG)
    : null;
  const rankEntry = _trPersonal || _trMod;
  if (rankEntry) {
    const expired =
      rankEntry.expiresAt &&
      rankEntry.expiresAt > 0 &&
      nowMs() >= rankEntry.expiresAt;
    if (!expired) {
      if (rankEntry.role === "member") return actionType === "interact";
      if (rankEntry.role !== "visitor") return true; // builder
    }
  }

  // Member check
  const member = claim.members.find((m) => m.xuid === xuid);
  if (!member) return false;
  // Expired temporary member — treat as non-member
  if (member.expiresAt && member.expiresAt > 0 && nowMs() >= member.expiresAt)
    return false;
  // visitor: no protection bypass (only bypasses eject via canAccessClaim)
  if (member.role === "visitor") return false;
  // member: can only interact (doors, buttons, levers)
  if (member.role === "member") return actionType === "interact";
  // builder: full access like owner
  return true;
}

/**
 * Check if a player has any access to a claim (owner, member, trusted rank, admin, staff).
 * Used by the eject system — does NOT check a specific protection key.
 */
export function canAccessClaim(player, claim) {
  const xuid = getPlayerXuid(player);
  // Owner-only: the live Server Owner has access and NO staff bypass applies.
  // Members, co-owners, and trusted ranks still grant access (anti-eject) so the
  // owner can invite people in — owner-only shields from staff, not from guests.
  if (claim.ownerOnly) {
    if (isOwner(player)) return true;
  } else if (staffCanBypassClaim(player, claim, xuid)) {
    return true;
  }
  if (!claim.isAdminClaim) {
    if (claim.ownerXuid === xuid) return true;
    // Ancestor-owner OR ancestor co-owner bypass (up to 2 levels) — keeps a
    // parent/grandparent co-owner from being ejected from a sub-claim.
    if (claim.parentId) {
      const parent = getClaimById(claim.parentId);
      if (
        parent &&
        !parent.isAdminClaim &&
        (parent.ownerXuid === xuid || _isDirectCoOwner(parent, xuid))
      )
        return true;
      if (parent && parent.parentId) {
        const grandparent = getClaimById(parent.parentId);
        if (
          grandparent &&
          !grandparent.isAdminClaim &&
          (grandparent.ownerXuid === xuid || _isDirectCoOwner(grandparent, xuid))
        )
          return true;
      }
    }
  }
  const core = getPlayerCore(player);
  const rankTag = (core.rankTag ?? "").trim();
  const _trPersonal = rankTag
    ? claim.trustedRanks.find((r) => r.tag === rankTag)
    : null;
  const _trMod = isModerator(player)
    ? claim.trustedRanks.find((r) => r.tag === MOD_TRUST_TAG)
    : null;
  const rankEntry = _trPersonal || _trMod;
  if (rankEntry) {
    const expired =
      rankEntry.expiresAt &&
      rankEntry.expiresAt > 0 &&
      nowMs() >= rankEntry.expiresAt;
    if (!expired) return true; // any role grants access (anti-eject)
  }
  const member = claim.members.find((m) => m.xuid === xuid);
  if (member) {
    if (member.expiresAt && member.expiresAt > 0 && nowMs() >= member.expiresAt)
      return false;
    return true;
  }
  return false;
}

/**
 * Check if a player can manage a claim (edit settings, members, sub-claims, rename).
 * True for: owner, parent-owner (sub-claims), co-owner members, and admins.
 */
export function canManageClaim(player, claim) {
  const xuid = getPlayerXuid(player);
  // Owner-only: the live Server Owner manages it, and admins get NO "claimsAdmin"
  // override — owner-only is shielded from staff. Co-owners still manage it just
  // like a personal claim, so the owner can delegate.
  if (claim.ownerOnly) {
    if (isOwner(player)) return true;
  } else if (isAdmin(player).ok && adminCan(player, "claimsAdmin")) {
    // Admins manage any (non-owner-only) claim with the Claims Administration
    // privilege. Without it they fall through to normal ownership/co-owner rules
    // (so they still manage their own claims like a regular player).
    return true;
  }
  if (!claim.isAdminClaim) {
    if (claim.ownerXuid === xuid) return true;
  }
  if (claim.parentId) {
    const parent = getClaimById(claim.parentId);
    if (parent && !parent.isAdminClaim && parent.ownerXuid === xuid) return true;
    // co-owner of the parent can also manage sub-claims
    if (
      parent &&
      parent.members.some(
        (m) =>
          m.xuid === xuid &&
          m.role === "co-owner" &&
          !(m.expiresAt && m.expiresAt > 0 && nowMs() >= m.expiresAt),
      )
    )
      return true;
    // Grandparent-owner and co-owner bypass (sub-sub-claims)
    if (parent && parent.parentId) {
      const grandparent = getClaimById(parent.parentId);
      if (grandparent && !grandparent.isAdminClaim && grandparent.ownerXuid === xuid) return true;
      if (
        grandparent &&
        grandparent.members.some(
          (m) =>
            m.xuid === xuid &&
            m.role === "co-owner" &&
            !(m.expiresAt && m.expiresAt > 0 && nowMs() >= m.expiresAt),
        )
      )
        return true;
    }
  }
  return claim.members.some(
    (m) =>
      m.xuid === xuid &&
      m.role === "co-owner" &&
      !(m.expiresAt && m.expiresAt > 0 && nowMs() >= m.expiresAt),
  );
}

/**
 * Get all top-level claims where the player is a co-owner member (not expired).
 */
export function getCoOwnedClaims(xuid) {
  return getAllClaims().filter(
    (c) =>
      !c.parentId &&
      !c.isAdminClaim &&
      c.members.some(
        (m) =>
          m.xuid === xuid &&
          m.role === "co-owner" &&
          !(m.expiresAt && m.expiresAt > 0 && nowMs() >= m.expiresAt),
      ),
  );
}

/**
 * Returns true if xuid is a non-expired co-owner member of the given claim object.
 */
function _isDirectCoOwner(claim, xuid) {
  return claim.members.some(
    (m) =>
      m.xuid === xuid &&
      m.role === "co-owner" &&
      !(m.expiresAt && m.expiresAt > 0 && nowMs() >= m.expiresAt),
  );
}

/**
 * Returns true if xuid can manage the claim purely by xuid checks
 * (mirrors canManageClaim but without a player object).
 */
function _canManageClaimByXuid(claim, xuid) {
  if (claim.ownerXuid === xuid) return true;
  if (_isDirectCoOwner(claim, xuid)) return true;
  if (claim.parentId) {
    const parent = getClaimById(claim.parentId);
    if (parent) {
      if (parent.ownerXuid === xuid) return true;
      if (_isDirectCoOwner(parent, xuid)) return true;
      if (parent.parentId) {
        const grandparent = getClaimById(parent.parentId);
        if (grandparent) {
          if (grandparent.ownerXuid === xuid) return true;
          if (_isDirectCoOwner(grandparent, xuid)) return true;
        }
      }
    }
  }
  return false;
}

/**
 * Returns true if xuid already has access to this claim via an ancestor
 * (so the claim doesn't need to appear separately in My Claims).
 */
function _hasAncestorAccess(claim, xuid) {
  let cur = claim;
  while (cur.parentId) {
    const parent = getClaimById(cur.parentId);
    if (!parent) return false;
    if (parent.ownerXuid === xuid) return true;
    if (_isDirectCoOwner(parent, xuid)) return true;
    cur = parent;
  }
  return false;
}

/**
 * All non-admin claims the player can manage as a co-owner (or via ancestor
 * co-ownership), deduplicated so that only the highest-level entry per chain
 * appears — matching exactly what canManageClaim grants access to.
 */
export function getCoOwnedClaimsForMyClaims(xuid) {
  return getAllClaims().filter(
    (c) =>
      c.ownerXuid !== xuid &&           // exclude own claims (shown separately)
      _canManageClaimByXuid(c, xuid) && // can manage it
      !_hasAncestorAccess(c, xuid),     // not already reachable via a listed ancestor
  );
}

/**
 * Find the nearest point just outside a claim's shape for ejection. Considers
 * every rectangle of the claim (primary + extensions): a player standing in an
 * extension is ejected outside the whole claim, not into the adjoining main
 * rect (which previously caused a teleport stutter). For a simple single-rect
 * claim this returns the same result as before.
 */
export function getEjectPosition(claim, pos) {
  const rects = getClaimRects(claim);
  // The rect the player is currently in (fall back to the primary rect).
  const host = rects.find((r) => containsPoint(r.min, r.max, pos)) ?? rects[0];
  // Exit candidates just outside each edge of the host rect, with the player's
  // distance to that edge, nearest first.
  const candidates = [
    { x: host.min.x - 2, z: pos.z, d: Math.abs(pos.x - host.min.x) },
    { x: host.max.x + 3, z: pos.z, d: Math.abs(pos.x - (host.max.x + 1)) },
    { x: pos.x, z: host.min.z - 2, d: Math.abs(pos.z - host.min.z) },
    { x: pos.x, z: host.max.z + 3, d: Math.abs(pos.z - (host.max.z + 1)) },
  ].sort((a, b) => a.d - b.d);
  // Pick the nearest exit that lands outside EVERY rect, so we don't eject from
  // an extension straight back into the claim.
  for (const c of candidates) {
    const inside = rects.some((r) =>
      containsPoint(r.min, r.max, { x: c.x, y: pos.y, z: c.z }),
    );
    if (!inside) return { x: c.x, y: pos.y, z: c.z };
  }
  // Degenerate shape (host fully bordered by the other rects) — best effort.
  const f = candidates[candidates.length - 1];
  return { x: f.x, y: pos.y, z: f.z };
}

// =========================================================
// Visualization — called on demand from UI only, no interval
// =========================================================

// Sample integer positions from lo to hi inclusive, striding by step, ALWAYS
// including both endpoints — so a strided edge never drops its far corner when the
// side length isn't a multiple of step. lo === hi yields a single position.
function _samples(lo, hi, step) {
  const out = [];
  for (let v = lo; v < hi; v += step) out.push(v);
  out.push(hi);
  return out;
}

export function visualizeClaim(
  player,
  min,
  max,
  playerY = 64,
  particleId = "jm_at:viewer_particles",
  step = 2,
  yOffset = -3,
  centered = false,
) {
  try {
    // player.spawnParticle is PER-PLAYER — only this player sees the border.
    // (Dimension.spawnParticle would broadcast it to every nearby player, which
    // is wrong for a personal preview / viewer.) Each call is wrapped in its own
    // try/catch since particle spawns can throw on unloaded chunks.
    // Default -3 keeps the legacy viewer/one-shot borders 3 blocks below the
    // player; the live wand preview passes yOffset 0 to draw at the player's feet.
    const y = Math.floor(playerY) + yOffset;

    if (centered) {
      // Draw at the EDGE BLOCKS' centres (x+0.5, z+0.5), using max (the last
      // block) not max+1. A ~1-block cube glyph then sits fully INSIDE the claim
      // footprint instead of straddling the outer boundary line (where half of it
      // would hang ~0.5 block outside). Used by the live wand cube preview.
      for (const x of _samples(min.x, max.x, step)) {
        try {
          player.spawnParticle(particleId, { x: x + 0.5, y, z: min.z + 0.5 });
        } catch {}
        try {
          player.spawnParticle(particleId, { x: x + 0.5, y, z: max.z + 0.5 });
        } catch {}
      }
      for (let z = min.z + step; z < max.z; z += step) {
        try {
          player.spawnParticle(particleId, { x: min.x + 0.5, y, z: z + 0.5 });
        } catch {}
        try {
          player.spawnParticle(particleId, { x: max.x + 0.5, y, z: z + 0.5 });
        } catch {}
      }
      return;
    }

    // Default: thin streaks ON the boundary lines (legacy viewer / one-shot).
    // max + 1 because block coordinates are the block's negative corner;
    // the outer edge of the last block is at max + 1
    const maxX = max.x + 1;
    const maxZ = max.z + 1;
    for (let x = min.x; x <= maxX; x += step) {
      try {
        player.spawnParticle(particleId, { x, y, z: min.z });
      } catch {}
      try {
        player.spawnParticle(particleId, { x, y, z: maxZ });
      } catch {}
    }
    for (let z = min.z + step; z < maxZ; z += step) {
      try {
        player.spawnParticle(particleId, { x: min.x, y, z });
      } catch {}
      try {
        player.spawnParticle(particleId, { x: maxX, y, z });
      } catch {}
    }
  } catch (e) {
    silentCatch("visualize_claim", e);
  }
}

// Draws the MERGED outer outline of a whole claim (primary + extension rects) so
// an extended claim reads as ONE joined shape instead of separate boxes. The
// trick: an edge cell is kept only when the block one step OUTSIDE that edge isn't
// part of the claim's footprint — internal edges where two rects meet face into
// the claim, so they drop out, and only the union's outer perimeter remains.
// `centered` true = filled cube glyphs at cell centres (the live wand cube preview);
// false = beams ON the boundary grid lines at each outer cell-edge's midpoint (the
// legacy fountain "shower", matching visualizeClaim's non-centered line positions).
// Per-player (player.spawnParticle); a dedup set keyed by spawn coord stops shared
// corners from double-spawning (which would brighten them).
export function visualizeClaimMerged(
  player,
  claim,
  playerY = 64,
  particleId = "jm_at:viewer_particles",
  step = 2,
  yOffset = 0,
  centered = true,
) {
  try {
    const rects = getClaimRects(claim);
    if (!rects.length) return;
    const y = Math.floor(playerY) + yOffset;
    const inFp = (x, z) => {
      for (const r of rects)
        if (x >= r.min.x && x <= r.max.x && z >= r.min.z && z <= r.max.z)
          return true;
      return false;
    };
    const drawn = new Set();
    const emit = (fx, fz) => {
      const key = fx + "," + fz;
      if (drawn.has(key)) return;
      drawn.add(key);
      try {
        player.spawnParticle(particleId, { x: fx, y, z: fz });
      } catch {}
    };
    for (const r of rects) {
      // North (z=min.z) / South (z=max.z) edges — sample along x; keep a cell only
      // if the block just outside (north/south) is unclaimed. Cube → cell centre;
      // fountain → the boundary line (z=min.z / z=max.z+1) at the cell's midpoint.
      for (const x of _samples(r.min.x, r.max.x, step)) {
        if (!inFp(x, r.min.z - 1))
          emit(x + 0.5, centered ? r.min.z + 0.5 : r.min.z);
        if (!inFp(x, r.max.z + 1))
          emit(x + 0.5, centered ? r.max.z + 0.5 : r.max.z + 1);
      }
      // West (x=min.x) / East (x=max.x) edges — sample along z.
      for (const z of _samples(r.min.z, r.max.z, step)) {
        if (!inFp(r.min.x - 1, z))
          emit(centered ? r.min.x + 0.5 : r.min.x, z + 0.5);
        if (!inFp(r.max.x + 1, z))
          emit(centered ? r.max.x + 0.5 : r.max.x + 1, z + 0.5);
      }
    }
  } catch (e) {
    silentCatch("visualize_claim_merged", e);
  }
}

// =========================================================
// Temporary member expiry — called from main.js tick loop
// =========================================================

export function tickClaimMemberExpiry() {
  // Nothing temporary anywhere — skip the full page scan until a temporary grant
  // is added again (which re-arms the flag). This keeps the ~5s tick from
  // deserializing every claims page on servers with no expiring trust.
  if (!_hasTempGrants) return;
  const now = nowMs();
  const meta = getClaimsMeta();
  let anyChanged = false;
  let remainingTemp = 0; // temporary grants still pending after this sweep
  for (let i = 0; i < meta.pagesUsed; i++) {
    const page = loadClaimsPage(i);
    let changed = false;
    for (const claim of page) {
      const mBefore = claim.members.length;
      claim.members = claim.members.filter((m) => {
        if (m.expiresAt && m.expiresAt > 0 && now >= m.expiresAt) {
          logClaimEvent("member_expire", claim, null, m.name);
          return false;
        }
        if (m.expiresAt && m.expiresAt > 0) remainingTemp++;
        return true;
      });
      if (claim.members.length !== mBefore) changed = true;

      const trBefore = claim.trustedRanks.length;
      claim.trustedRanks = claim.trustedRanks.filter((r) => {
        if (r.expiresAt && r.expiresAt > 0 && now >= r.expiresAt) {
          logClaimEvent("trust_expire", claim, null, r.tag);
          return false;
        }
        if (r.expiresAt && r.expiresAt > 0) remainingTemp++;
        return true;
      });
      if (claim.trustedRanks.length !== trBefore) changed = true;
    }
    if (changed) {
      saveClaimsPage(i, page);
      anyChanged = true;
    }
  }
  if (anyChanged) invalidateClaimCache();
  // Re-evaluate from what the scan actually saw: stop ticking once nothing
  // temporary remains. Safe because the flag only drops to false here, after a
  // full scan confirmed zero pending grants.
  _hasTempGrants = remainingTemp > 0;
}

// =========================================================
// Event log
// =========================================================

export function logClaimEvent(type, claim, actorPlayer, detail = "") {
  appendClaimLog({
    at: nowMs(),
    type,
    claimId: claim?.id ?? "",
    claimName: claim?.name ?? "",
    ownerName: claim?.ownerName ?? "",
    actorName: actorPlayer?.name ?? "",
    actorXuid: actorPlayer ? getPlayerXuid(actorPlayer) : "",
    detail,
  });
}
