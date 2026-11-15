/**
 * holograms.js — Hologram entity lifecycle (spawn, read, update, remove)
 *
 * Also maintains a world-level hologram registry so that despawned
 * holograms (from unloaded chunks) can be detected and restored.
 */

import { world, system } from "@minecraft/server";
import { NS, KEY, LIMITS } from "./constants.js";
import {
  getPlayerXuid,
  safeJsonParse,
  safeJsonStringify,
  silentCatch,
  applyColorCodes,
} from "./utils.js";
import { getWorldStr, setWorldStr } from "./storage.js";

const DATA_PROP = `${NS}:hologram_data`;
const HITBOX_LINK = `${NS}:hologram_link`; // stored on hitbox → points to main entity ID
const HITBOX_ID_PROP = `${NS}:hologram_hitbox_id`; // stored on main → points to its hitbox ID (mirror of registry, registry-independent)
const VERSION_PROP = `${NS}:hologram_version`;
const HITBOX_TYPE = `${NS}:hologram_hitbox`;
const CURRENT_VERSION = 2;

function _hitboxOffset(version) {
  return version >= 2 ? 0.5 : 1.0;
}

function _hologramTypeId(version) {
  return version >= 2 ? `${NS}:hologram_v2` : `${NS}:hologram`;
}

const HOLOGRAM_TYPES = [`${NS}:hologram`, `${NS}:hologram_v2`];

// Default row template for scoreboard holograms. Tokens: {rank} {name} {score}.
// Text is left uncolored (auto); only the score is accented and closed with §r.
const DEFAULT_ROW_FORMAT = "{rank}. {name} - §2{score}§r";

// Bedrock returns this localization key as the displayName for any scoreboard
// participant whose player isn't currently online — sometimes %-prefixed
// (`%commands…`) for nametag translation, sometimes with surrounding format
// codes. We can't resolve it to a gamertag from script, so show a friendly
// fallback instead. Match on the distinctive substring so every variant is
// caught, not just the bare key.
const OFFLINE_NAME_MARKER = "offlineplayername";
const OFFLINE_NAME_LABEL = "离线玩家";

/** Resolve a scoreboard participant's display name, mapping the offline-player key to a friendly label. */
function _participantName(participant) {
  let name = "?";
  try {
    name = participant?.displayName ?? "?";
  } catch {}
  name = String(name);
  if (name.toLowerCase().includes(OFFLINE_NAME_MARKER)) return OFFLINE_NAME_LABEL;
  return name;
}

// =========================================================
// Hologram registry (world-level persistence)
// =========================================================

export function getHologramRegistry() {
  return safeJsonParse(getWorldStr(KEY.hologramRegistry), []);
}

function setHologramRegistry(reg) {
  return setWorldStr(KEY.hologramRegistry, safeJsonStringify(reg));
}

function addToRegistry(entityId, lines, pos, dimId, owner, hitboxId = "", version = 1, scoreboard = null) {
  const reg = getHologramRegistry();
  if (reg.some((e) => e.entityId === entityId)) return true; // already registered
  if (reg.length >= LIMITS.HOLOGRAM_REGISTRY_MAX) return false; // at cap
  reg.push({ entityId, lines, pos, dimId, owner, hitboxId, version, scoreboard });
  return setHologramRegistry(reg); // false if the write was refused/failed
}

export function removeFromRegistry(entityId) {
  const reg = getHologramRegistry();
  const idx = reg.findIndex((e) => e.entityId === entityId);
  if (idx !== -1) {
    reg.splice(idx, 1);
    setHologramRegistry(reg);
  }
}

// =========================================================
// Entity lifecycle
// =========================================================

export function spawnHologram(player, lines, pos, scoreboard = null) {
  const cleaned = lines.filter((l) => l.length > 0);
  const dim = player.dimension;
  const entity = dim.spawnEntity(_hologramTypeId(CURRENT_VERSION), pos);
  entity.nameTag = cleaned.join("\n");
  const owner = getPlayerXuid(player);
  entity.setDynamicProperty(
    DATA_PROP,
    JSON.stringify({ lines: cleaned, owner, scoreboard }),
  );
  entity.setDynamicProperty(VERSION_PROP, CURRENT_VERSION);
  // Spawn hitbox above for nametag interaction
  let hitboxId = "";
  try {
    const hitboxPos = { x: pos.x, y: pos.y + _hitboxOffset(CURRENT_VERSION), z: pos.z };
    const hitbox = dim.spawnEntity(HITBOX_TYPE, hitboxPos);
    hitbox.setDynamicProperty(HITBOX_LINK, entity.id);
    hitboxId = hitbox.id;
    // Mirror the link on the main entity so cleanup can find the hitbox without
    // the registry (see cleanupHologram / reapOrphanedHitboxes).
    try { entity.setDynamicProperty(HITBOX_ID_PROP, hitboxId); } catch {}
  } catch (e) {
    silentCatch("hologram_hitbox_spawn", e);
  }
  let registered = false;
  try {
    registered =
      addToRegistry(entity.id, cleaned, pos, dim.id, owner, hitboxId, CURRENT_VERSION, scoreboard) === true;
  } catch (e) {
    silentCatch("hologram_registry_add", e);
  }
  if (!registered) {
    // Couldn't persist to the registry — the registry is at capacity or, more
    // commonly, the write was refused for exceeding the per-property byte limit
    // (storage full). Don't leave a live but unsaved hologram: it would work
    // until the next reload and then vanish with no record to restore it. Roll
    // back both entities and signal failure so the caller can warn the admin.
    try { entity.remove(); } catch {}
    if (hitboxId) {
      try {
        const hb = _findEntityById(dim, HITBOX_TYPE, hitboxId);
        if (hb) hb.remove();
      } catch {}
    }
    return null;
  }
  return entity;
}

export function getHologramData(entity) {
  try {
    const raw = entity.getDynamicProperty(DATA_PROP);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function updateHologram(entity, lines, pos, scoreboard) {
  const cleaned = lines.filter((l) => l.length > 0);
  entity.nameTag = cleaned.join("\n");
  const data = getHologramData(entity) ?? {};
  const sb = scoreboard === undefined ? (data.scoreboard ?? null) : scoreboard;

  if (pos) {
    entity.teleport(pos);
  }

  entity.setDynamicProperty(
    DATA_PROP,
    JSON.stringify({ lines: cleaned, owner: data.owner ?? "", scoreboard: sb }),
  );
  try {
    const reg = getHologramRegistry();
    // Match by entity id first; fall back to the closest registry entry at this
    // position so an edit still persists if the id drifted (e.g. after a
    // restore). Re-point the entry at the live entity when we adopt by position.
    let entry = reg.find((e) => e.entityId === entity.id);
    if (!entry) {
      const loc = entity.location;
      entry = reg
        .filter((e) => e.dimId === entity.dimension.id && e.pos)
        .find((e) => {
          const dx = e.pos.x - loc.x;
          const dy = e.pos.y - loc.y;
          const dz = e.pos.z - loc.z;
          return dx * dx + dy * dy + dz * dz <= 2.25;
        });
      if (entry) entry.entityId = entity.id;
    }
    if (entry) {
      entry.lines = cleaned;
      entry.scoreboard = sb;
      if (pos) {
        entry.pos = { x: pos.x, y: pos.y, z: pos.z };
        // Teleport hitbox above new position
        if (entry.hitboxId) {
          const entityVersion = entity.getDynamicProperty(VERSION_PROP) ?? 1;
          const hitbox = _findEntityById(entity.dimension, `${NS}:hologram_hitbox`, entry.hitboxId);
          if (hitbox) hitbox.teleport({ x: pos.x, y: pos.y + _hitboxOffset(entityVersion), z: pos.z });
        }
      }
      setHologramRegistry(reg);
    }
  } catch (e) {
    silentCatch("hologram_registry_update", e);
  }
}

function _findEntityById(dim, typeId, entityId) {
  try {
    for (const e of dim.getEntities({ type: typeId })) {
      if (e.id === entityId) return e;
    }
  } catch {}
  return null;
}

/**
 * Is the chunk containing `pos` currently loaded? getBlock returns undefined
 * (or throws) for unloaded chunks. We use this to avoid treating a hologram in
 * an unloaded chunk as "lost" — restoring it then would spawn a duplicate that
 * collides with the real entity once its chunk finally loads.
 */
function _isChunkLoaded(dim, pos) {
  try {
    return dim.getBlock(pos) !== undefined;
  } catch {
    return false;
  }
}

/**
 * Remove leftover duplicate hologram entities created by the older
 * over-eager restore (which spawned a copy whenever the real entity's chunk
 * wasn't loaded yet). Only removes an UNtracked hologram that physically
 * overlaps a registry-tracked one — a genuine duplicate. A lone untracked
 * hologram (whose registry entry was lost) is left alone. Returns the count
 * removed.
 */
function _dedupeDimension(dim) {
  const reg = getHologramRegistry();
  const trackedIds = new Set(reg.map((e) => e.entityId));

  const live = [];
  for (const typeId of HOLOGRAM_TYPES) {
    try {
      for (const e of dim.getEntities({ type: typeId })) live.push(e);
    } catch {}
  }
  const tracked = live.filter((e) => trackedIds.has(e.id));
  if (!tracked.length) return 0; // nothing to anchor against — stay safe

  let removed = 0;
  for (const e of live) {
    if (trackedIds.has(e.id)) continue; // keep tracked entities
    const loc = e.location;
    const overlaps = tracked.some((t) => {
      const tl = t.location;
      const dx = tl.x - loc.x;
      const dy = tl.y - loc.y;
      const dz = tl.z - loc.z;
      return dx * dx + dy * dy + dz * dz <= 2.25; // within ~1.5 blocks
    });
    if (overlaps) {
      try {
        e.remove();
        removed++;
      } catch {}
    }
  }
  return removed;
}

/** Find an existing hologram entity at (or within ~1.5 blocks of) pos, any version. */
function _findHologramNear(dim, pos) {
  for (const typeId of HOLOGRAM_TYPES) {
    try {
      const near = dim.getEntities({ type: typeId, location: pos, maxDistance: 1.5 });
      if (near.length > 0) return near[0];
    } catch {}
  }
  return null;
}

/**
 * Find a hologram nameplate sitting in the same x/z column as a hitbox at `loc`
 * (the hitbox is spawned 0.5–1.0 blocks directly above its nameplate). Used by
 * the reaper to tell a true orphan from a hitbox whose link merely went stale
 * after an id drift. Requires near-exact horizontal alignment (~0.6 blocks) so a
 * neighbouring hologram can't be mistaken for this hitbox's parent. Returns the
 * nameplate entity or null.
 */
function _hologramBelowHitbox(dim, loc) {
  for (const typeId of HOLOGRAM_TYPES) {
    try {
      for (const e of dim.getEntities({ type: typeId, location: loc, maxDistance: 1.5 })) {
        const el = e.location;
        const dx = el.x - loc.x;
        const dz = el.z - loc.z;
        if (dx * dx + dz * dz <= 0.36) return e; // within ~0.6 horizontally → same column
      }
    } catch {}
  }
  return null;
}

/**
 * Called when the hologram entity is already being removed (e.g. /kill). Cleans
 * up the hitbox and registry without calling entity.remove() again.
 *
 * Pass the dying entity as `entity` when available (both the entityDie and
 * entityRemove handlers have it). The paired hitbox id is read directly off the
 * entity — stored there at spawn/restore — so cleanup no longer depends on the
 * registry entry surviving. The registry is still consulted as a fallback (for
 * the hitbox id and always for the dimension, since entity.dimension can be
 * inaccessible inside beforeEvents.entityRemove). Anything this still misses is
 * caught by reapOrphanedHitboxes() on its next sweep.
 */
export function cleanupHologram(entityId, entity = null) {
  let hitboxId = null;
  if (entity) {
    try {
      const v = entity.getDynamicProperty(HITBOX_ID_PROP);
      if (typeof v === "string" && v) hitboxId = v;
    } catch {}
  }
  let dimId = null;
  try {
    const reg = getHologramRegistry();
    const entry = reg.find((e) => e.entityId === entityId);
    if (!hitboxId && entry?.hitboxId) hitboxId = entry.hitboxId;
    dimId = entry?.dimId ?? null;
  } catch (e) {
    silentCatch("hologram_hitbox_cleanup_reg", e);
  }
  if (!dimId && entity) {
    try {
      dimId = entity.dimension?.id ?? null;
    } catch {}
  }
  if (hitboxId) {
    try {
      // Strip the "minecraft:" prefix (stored id is "minecraft:overworld");
      // getDimension rejects the prefixed form and would throw.
      const dim = world.getDimension(
        (dimId ?? "overworld").replace("minecraft:", ""),
      );
      const hitbox = _findEntityById(dim, HITBOX_TYPE, hitboxId);
      if (hitbox) hitbox.remove();
    } catch (e) {
      silentCatch("hologram_hitbox_cleanup", e);
    }
  }
  try {
    removeFromRegistry(entityId);
  } catch (e) {
    silentCatch("hologram_registry_cleanup", e);
  }
}

/**
 * Safety net against orphaned hitboxes. Independent of catching any removal
 * event: every live hitbox whose linked hologram no longer exists is removed.
 *
 * This covers cases the entityDie/entityRemove handlers can't: a lost registry
 * entry, a cleanup that partially failed, or any unforeseen path that removes
 * the main hologram without firing a script event (bulk despawn, world edits,
 * another addon's area /kill, etc.).
 *
 * Safe because a hitbox shares its parent's x/z column, so they occupy the same
 * chunk and load together — if a hitbox is live but its parent isn't found in
 * the same dimension, the parent is genuinely gone, not merely unloaded.
 *
 * A hitbox is only reaped once BOTH checks agree it's orphaned: its stored link
 * points at no live nameplate AND no nameplate sits in its column. The second
 * check guards against a hologram's entity id drifting after a restore/adopt,
 * which leaves the link stale while the nameplate is physically still present;
 * in that case the link is re-bound instead of reaping a valid hitbox. Returns
 * the number of hitboxes removed.
 */
export function reapOrphanedHitboxes() {
  let removed = 0;
  for (const dimId of ["overworld", "nether", "the_end"]) {
    let dim;
    try {
      dim = world.getDimension(dimId);
    } catch {
      continue;
    }
    const liveHoloIds = new Set();
    try {
      for (const typeId of HOLOGRAM_TYPES) {
        for (const e of dim.getEntities({ type: typeId })) liveHoloIds.add(e.id);
      }
    } catch {
      continue; // couldn't enumerate holograms — don't risk reaping valid ones
    }
    let hitboxes;
    try {
      hitboxes = dim.getEntities({ type: HITBOX_TYPE });
    } catch {
      continue;
    }
    for (const hb of hitboxes) {
      let linkedId = null;
      try {
        linkedId = hb.getDynamicProperty(HITBOX_LINK) ?? null;
      } catch {}
      if (linkedId && liveHoloIds.has(linkedId)) continue; // link valid → keep

      // Link missing or pointing at a non-existent nameplate. Don't reap yet:
      // a hologram's id can drift after a restore/adopt, leaving the link stale
      // while the nameplate is still physically present. Only a hitbox with no
      // nameplate in its column is a true orphan.
      const parent = _hologramBelowHitbox(dim, hb.location);
      if (parent) {
        // Re-bind the stale link so the fast path handles it next sweep.
        try { hb.setDynamicProperty(HITBOX_LINK, parent.id); } catch {}
        try { parent.setDynamicProperty(HITBOX_ID_PROP, hb.id); } catch {}
        continue;
      }
      try {
        hb.remove();
        removed++;
      } catch {}
    }
  }
  return removed;
}

export function removeHologram(entity) {
  const entityId = entity.id;
  // Remove paired hitbox
  try {
    const reg = getHologramRegistry();
    const entry = reg.find((e) => e.entityId === entityId);
    if (entry?.hitboxId) {
      const hitbox = _findEntityById(entity.dimension, `${NS}:hologram_hitbox`, entry.hitboxId);
      if (hitbox) hitbox.remove();
    }
  } catch (e) {
    silentCatch("hologram_hitbox_remove", e);
  }
  try {
    removeFromRegistry(entityId);
  } catch (e) {
    silentCatch("hologram_registry_remove", e);
  }
  entity.remove();
}

/**
 * Given a hitbox entity, find the main hologram it belongs to.
 * Returns the hologram entity or null.
 */
export function findHologramForHitbox(hitboxEntity) {
  const dim = hitboxEntity.dimension;
  // Prefer the direct ID link stored on the hitbox
  const linkedId = hitboxEntity.getDynamicProperty(HITBOX_LINK);
  if (linkedId) {
    for (const typeId of HOLOGRAM_TYPES) {
      for (const e of dim.getEntities({ type: typeId })) {
        if (e.id === linkedId) return e;
      }
    }
  }
  // Fallback: spatial search covering both old (1.0) and new (0.5) offsets
  const loc = hitboxEntity.location;
  for (const typeId of HOLOGRAM_TYPES) {
    try {
      const nearby = dim.getEntities({
        type: typeId,
        location: { x: loc.x, y: loc.y - 0.75, z: loc.z },
        maxDistance: 1,
      });
      if (nearby.length > 0) return nearby[0];
    } catch {}
  }
  return null;
}

// =========================================================
// Recovery: scan for missing holograms
// =========================================================

/**
 * Compares the registry against live entities. Returns entries
 * from the registry whose entities could not be found.
 */
export function scanMissingHolograms() {
  const reg = getHologramRegistry();
  if (!reg.length) return [];

  // Collect all live hologram entity IDs across all dimensions
  const liveIds = new Set();
  for (const dimId of ["overworld", "nether", "the_end"]) {
    try {
      const dim = world.getDimension(dimId);
      for (const typeId of HOLOGRAM_TYPES) {
        for (const e of dim.getEntities({ type: typeId })) liveIds.add(e.id);
      }
    } catch {}
  }

  return reg.filter((entry) => !liveIds.has(entry.entityId));
}

/**
 * Re-spawn a hologram from a registry entry and update the registry
 * with the new entity ID.
 */
export function restoreHologram(entry) {
  const dim = world.getDimension(entry.dimId.replace("minecraft:", ""));
  const version = entry.version ?? 1;

  // Guard against duplicates: if a hologram entity already exists at this
  // position, the original is simply present (its id may differ from what the
  // registry recorded). Adopt it — re-point the registry at the live entity and
  // refresh its data — instead of spawning a second overlapping hologram.
  const existing = _findHologramNear(dim, entry.pos);
  if (existing) {
    try {
      existing.nameTag = entry.lines.join("\n");
      existing.setDynamicProperty(
        DATA_PROP,
        JSON.stringify({ lines: entry.lines, owner: entry.owner ?? "", scoreboard: entry.scoreboard ?? null }),
      );
    } catch {}
    if (existing.id !== entry.entityId) {
      const reg = getHologramRegistry();
      const idx = reg.findIndex((e) => e.entityId === entry.entityId);
      if (idx !== -1) {
        reg[idx].entityId = existing.id;
        setHologramRegistry(reg);
      }
    }
    return existing;
  }

  const entity = dim.spawnEntity(_hologramTypeId(version), entry.pos);
  entity.nameTag = entry.lines.join("\n");
  entity.setDynamicProperty(
    DATA_PROP,
    JSON.stringify({ lines: entry.lines, owner: entry.owner ?? "", scoreboard: entry.scoreboard ?? null }),
  );
  entity.setDynamicProperty(VERSION_PROP, version);
  // Restore hitbox
  let hitboxId = "";
  try {
    const hitboxPos = { x: entry.pos.x, y: entry.pos.y + _hitboxOffset(version), z: entry.pos.z };
    const hitbox = dim.spawnEntity(HITBOX_TYPE, hitboxPos);
    hitbox.setDynamicProperty(HITBOX_LINK, entity.id);
    hitboxId = hitbox.id;
    try { entity.setDynamicProperty(HITBOX_ID_PROP, hitboxId); } catch {}
  } catch (e) {
    silentCatch("hologram_hitbox_restore", e);
  }
  // Update registry with new entity IDs
  const reg = getHologramRegistry();
  const idx = reg.findIndex((e) => e.entityId === entry.entityId);
  if (idx !== -1) {
    reg[idx].entityId = entity.id;
    reg[idx].hitboxId = hitboxId;
    setHologramRegistry(reg);
  }
  return entity;
}

// =========================================================
// Auto-restore: event-driven recovery
// =========================================================

export function autoRestoreDimension(dimId) {
  const reg = getHologramRegistry();
  const dimEntries = reg.filter((e) => e.dimId === dimId);
  if (!dimEntries.length) return 0;

  let dim;
  try {
    dim = world.getDimension(dimId.replace("minecraft:", ""));
  } catch {
    return 0;
  }

  const liveById = new Map();
  try {
    for (const typeId of HOLOGRAM_TYPES) {
      for (const e of dim.getEntities({ type: typeId })) liveById.set(e.id, e);
    }
  } catch {
    return 0;
  }

  // Only restore a hologram if its chunk is actually loaded and the entity is
  // still missing. If the chunk is unloaded we can't tell "lost" from "not yet
  // streamed in" — restoring then spawns a duplicate that collides with the
  // real entity when its chunk loads. The entity reloads with its chunk
  // automatically; restore is just the safety net for genuinely-lost ones.
  const missing = dimEntries.filter(
    (e) => !liveById.has(e.entityId) && _isChunkLoaded(dim, e.pos),
  );
  let restored = 0;
  for (const entry of missing) {
    try {
      restoreHologram(entry);
      restored++;
    } catch (e) {
      silentCatch("hologram_auto_restore", e);
    }
  }

  // Sweep up any leftover duplicates from the older restore behavior.
  try {
    _dedupeDimension(dim);
  } catch (e) {
    silentCatch("hologram_dedupe", e);
  }

  return restored;
}

export function autoRestoreAll() {
  let total = 0;
  for (const dimId of [
    "minecraft:overworld",
    "minecraft:nether",
    "minecraft:the_end",
  ]) {
    total += autoRestoreDimension(dimId);
  }
  return total;
}

// =========================================================
// Scoreboard-backed holograms
// =========================================================

/** Format an integer with thousands separators (1250 -> "1,250"). */
function _commaNum(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Render a score that counts MINUTES as a duration. `mode` is "h" (42h),
 * "hm" (42h 15m) or "m" (2535m); any other value returns null so the caller
 * falls back to the plain number. Used by the Playtime stat leaderboard, whose
 * objective stores minutes so all three readouts come from one score.
 *
 * A nameTag cannot carry RawMessage, so display units in server-side Chinese.
 * The stored h/hm/m mode identifiers stay unchanged.
 */
export function formatTimeScore(minutes, mode, comma = false) {
  if (mode !== "h" && mode !== "hm" && mode !== "m") return null;
  const total = Math.max(0, Math.floor(Number(minutes) || 0));
  const n = (v) => (comma ? _commaNum(v) : String(v));
  if (mode === "m") return `${n(total)}分钟`;
  const h = Math.floor(total / 60);
  if (mode === "hm") return `${n(h)}小时 ${total % 60}分钟`;
  return `${n(h)}小时`;
}

/**
 * Build the rendered lines for a scoreboard hologram from its config:
 *   { objective, title, topN, rowFormat, sort?, hideOffline?, commaScores?,
 *     timeFormat? }
 * Capped at topN. `sort` is "asc" or "desc" (default). `hideOffline` drops
 * participants whose name can't be resolved (shown as "Player Offline").
 * `commaScores` formats scores with thousands separators. `timeFormat` reads
 * the score as minutes and renders it as a duration (see formatTimeScore).
 * Both title and rows accept & color codes (converted like the rest of the
 * addon).
 */
export function renderScoreboardLines(cfg) {
  const out = [];
  const title = cfg?.title ? applyColorCodes(String(cfg.title)) : "";
  if (title) out.push(title);

  let obj = null;
  try {
    obj = world.scoreboard.getObjective(cfg.objective);
  } catch {}
  if (!obj) {
    out.push("§c（计分项目不存在）");
    return out;
  }

  let scores = [];
  try {
    scores = obj.getScores();
  } catch {}
  const asc = cfg?.sort === "asc";
  let rows = scores
    .filter((s) => typeof s.score === "number")
    .map((s) => ({ name: _participantName(s.participant), score: s.score }));
  if (cfg?.hideOffline) rows = rows.filter((r) => r.name !== OFFLINE_NAME_LABEL);
  rows.sort((a, b) => (asc ? a.score - b.score : b.score - a.score));

  if (rows.length === 0) {
    out.push("§7（暂无分数）");
    return out;
  }

  const lineBudget = Math.max(1, LIMITS.HOLOGRAM_LINE_MAX - (title ? 1 : 0));
  const topN = Math.min(Math.max(1, cfg.topN || 10), lineBudget);
  const fmt = cfg.rowFormat || DEFAULT_ROW_FORMAT;

  for (let i = 0; i < Math.min(topN, rows.length); i++) {
    const r = rows[i];
    const scoreStr =
      formatTimeScore(r.score, cfg?.timeFormat, !!cfg?.commaScores) ??
      (cfg?.commaScores ? _commaNum(r.score) : String(r.score));
    let line = applyColorCodes(
      fmt
        .replace(/\{rank\}/g, String(i + 1))
        .replace(/\{name\}/g, r.name)
        .replace(/\{score\}/g, scoreStr),
    );
    if (line.length > LIMITS.HOLOGRAM_LINE_LEN) {
      line = line.slice(0, LIMITS.HOLOGRAM_LINE_LEN);
    }
    out.push(line);
  }
  return out;
}

/**
 * Recompute every scoreboard hologram's text. Runs on a timer (~10s).
 * Only touches loaded entities and only writes when the text changed.
 */
export function refreshScoreboardHolograms() {
  let reg;
  try {
    reg = getHologramRegistry();
  } catch {
    return;
  }
  if (!reg.length) return;

  let changed = false;
  for (const entry of reg) {
    if (!entry.scoreboard) continue;
    let dim;
    try {
      dim = world.getDimension(
        (entry.dimId ?? "overworld").replace("minecraft:", ""),
      );
    } catch {
      continue;
    }
    const entity = _findEntityById(
      dim,
      _hologramTypeId(entry.version ?? CURRENT_VERSION),
      entry.entityId,
    );
    if (!entity) continue; // chunk unloaded — will refresh when reloaded

    const lines = renderScoreboardLines(entry.scoreboard);
    const nameTag = lines.join("\n");
    if (entity.nameTag === nameTag) continue; // no change → no write

    try {
      entity.nameTag = nameTag;
      const data = getHologramData(entity) ?? {};
      entity.setDynamicProperty(
        DATA_PROP,
        JSON.stringify({
          lines,
          owner: data.owner ?? "",
          scoreboard: entry.scoreboard,
        }),
      );
      entry.lines = lines;
      changed = true;
    } catch (e) {
      silentCatch("hologram_scoreboard_refresh", e);
    }
  }

  if (changed) {
    try {
      setHologramRegistry(reg);
    } catch (e) {
      silentCatch("hologram_scoreboard_reg_save", e);
    }
  }
}

// Refresh scoreboard holograms on a ~10s cadence (200 ticks), and reap orphaned
// hitboxes every 3rd pass (~30s) as the safety net for any removal path the
// event handlers miss.
let _holoIntervalTick = 0;
system.runInterval(() => {
  try {
    refreshScoreboardHolograms();
  } catch (e) {
    silentCatch("hologram_scoreboard_interval", e);
  }
  if (++_holoIntervalTick % 3 === 0) {
    try {
      reapOrphanedHitboxes();
    } catch (e) {
      silentCatch("hologram_reap_interval", e);
    }
  }
}, 200);
