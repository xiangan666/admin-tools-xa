/**
 * item-watch.js — Banned item auto-clear & configurable quantity alerts
 *
 * Two layers:
 *  1. banned        — Fully editable list of banned items (auto-removed from players).
 *                     Seeded with sensible defaults on first load but every entry
 *                     can be added or removed by admins.
 *  2. Tracked items — Admin-configured item:quantity pairs. If a non-admin
 *                     player holds >= threshold of a tracked item, admins
 *                     get a one-time alert (resets when count drops below).
 *
 * Config is stored in world dynamic property "jm_at:item_watch" as JSON:
 *   { tracked: { "minecraft:diamond": 64, ... }, banned: ["minecraft:bedrock", ...] }
 */

import { system, world, EquipmentSlot } from "@minecraft/server";
import { NS, ITEMS } from "./constants.js";
import { broadcastAdmins, tell, getPlayerXuid, silentCatch } from "./utils.js";
import { t, raw, itemName } from "./i18n.js";
import { logSystem } from "./log.js";

// EquipmentSlot enum value → localized armor-slot label (shared with the
// admin gear viewer's keys).
const SLOT_LABEL_KEYS = {
  Head: "jm_at.adm.slot_head",
  Chest: "jm_at.adm.slot_chest",
  Legs: "jm_at.adm.slot_legs",
  Feet: "jm_at.adm.slot_feet",
  Offhand: "jm_at.adm.slot_offhand",
};
import { getWorldStr, setWorldStr, getCfg } from "./storage.js";
import { isAdmin } from "./permissions.js";
import {
  setCorner1,
  setCorner2,
  getPendingSelection,
  normalizeCorners,
  getAllClaims,
  getClaimAt,
  getClaimRects,
  getClaimById,
  visualizeClaim,
  visualizeClaimMerged,
  evaluateSelection,
  claimPreviewOpts,
} from "./claims.js";

const ITEM_WATCH_KEY = `${NS}:item_watch`;

// Default banned list — seeded into a fresh config, but fully editable after that
const DEFAULT_BANNED = [
  "minecraft:bedrock",
  "minecraft:barrier",
  "minecraft:command_block",
  "minecraft:repeating_command_block",
  "minecraft:chain_command_block",
  "minecraft:structure_block",
  "minecraft:allow",
  "minecraft:deny",
  "minecraft:border_block",
];

// In-memory: Map<playerId, Map<itemId, lastReportedCount>>
const lastReported = new Map();

// =========================================================
// Config helpers
// =========================================================

export function getItemWatchCfg() {
  try {
    const raw = getWorldStr(ITEM_WATCH_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Migrate old bannedExtra format to unified banned list
      if (!parsed.banned && parsed.bannedExtra) {
        parsed.banned = [...DEFAULT_BANNED, ...parsed.bannedExtra];
        delete parsed.bannedExtra;
        setItemWatchCfg(parsed);
      }
      if (!parsed.banned) parsed.banned = [...DEFAULT_BANNED];
      return parsed;
    }
  } catch {}
  return { tracked: {}, banned: [...DEFAULT_BANNED] };
}

export function setItemWatchCfg(cfg) {
  setWorldStr(ITEM_WATCH_KEY, JSON.stringify(cfg));
}

export function getBanned() {
  return getItemWatchCfg().banned ?? [];
}

export function setBanned(list) {
  const cfg = getItemWatchCfg();
  cfg.banned = list;
  setItemWatchCfg(cfg);
}

// =========================================================
// Main scan loop — runs every 200 ticks (~10s)
// =========================================================

system.runInterval(() => {
  try {
    const cfg = getItemWatchCfg();
    const watched = cfg.tracked ?? {};
    const allBanned = new Set(cfg.banned ?? []);

    for (const player of world.getPlayers()) {
      if (isAdmin(player).ok) continue;

      const inv = player.getComponent("minecraft:inventory")?.container;
      if (!inv) continue;

      const counts = {};
      let cleared = false;
      const removed = []; // banned items pulled this scan, summarized once below

      for (let i = 0; i < inv.size; i++) {
        const item = inv.getItem(i);
        if (!item) continue;

        if (allBanned.has(item.typeId)) {
          removed.push({
            id: item.typeId,
            amount: item.amount,
          });
          inv.setItem(i);
          cleared = true;
          continue;
        }

        if (watched[item.typeId] !== undefined) {
          counts[item.typeId] = (counts[item.typeId] ?? 0) + item.amount;
        }
      }

      // Scan armor and offhand slots
      const eq = player.getComponent("minecraft:equippable");
      if (eq) {
        for (const slot of [
          EquipmentSlot.Head,
          EquipmentSlot.Chest,
          EquipmentSlot.Legs,
          EquipmentSlot.Feet,
          EquipmentSlot.Offhand,
        ]) {
          try {
            const item = eq.getEquipment(slot);
            if (!item) continue;
            if (allBanned.has(item.typeId)) {
              removed.push({
                id: item.typeId,
                amount: item.amount,
                where: String(slot),
              });
              eq.setEquipment(slot, undefined);
              cleared = true;
              continue;
            }
            if (watched[item.typeId] !== undefined) {
              counts[item.typeId] = (counts[item.typeId] ?? 0) + item.amount;
            }
          } catch {}
        }
      }

      if (cleared) {
        // One summary per scan instead of a broadcast/log per removed slot.
        // Live copy is localized (item names + armor-slot labels); the
        // logSystem copy below keeps raw ids (stored English).
        // lang-keys: jm_at.adm.slot_head jm_at.adm.slot_chest jm_at.adm.slot_legs jm_at.adm.slot_feet jm_at.adm.slot_offhand
        const summary = raw(
          ...removed.flatMap((r, i) => {
            const slotKey = r.where && SLOT_LABEL_KEYS[r.where];
            const part = raw(
              `${r.amount}x `,
              itemName(r.id),
              slotKey ? raw(" (", t(slotKey), ")") : "",
            );
            return i ? [", ", part] : [part];
          }),
        );
        broadcastAdmins(t("jm_at.itemwatch.removed_broadcast", player.name, summary));
        logSystem(
          "BANNED_ITEM_DETECTED",
          removed
            .map((r) => `${r.amount}x ${r.id}${r.where ? ` (${r.where}）` : ""}`)
            .join(", "),
          player.name,
        );
        tell(player, t("jm_at.itemwatch.removed_tell"));
        try {
          player.playSound("note.bass", { pitch: 0.5, volume: 1.0 });
        } catch {}
      }

      const pid = player.id;
      if (!lastReported.has(pid)) lastReported.set(pid, new Map());
      const reported = lastReported.get(pid);

      for (const [itemId, threshold] of Object.entries(watched)) {
        const count = counts[itemId] ?? 0;
        const last = reported.get(itemId) ?? -1;

        if (count >= threshold && count !== last) {
          broadcastAdmins(
            t(
              "jm_at.itemwatch.alert_broadcast",
              player.name,
              count,
              itemName(itemId),
              threshold,
            ),
          );
          logSystem("ITEM_ALERT", `${itemId} x${count}（提醒阈值：${threshold}）`, player.name);
          reported.set(itemId, count);
        } else if (count < threshold) {
          // Reset so it can alert again if count climbs back up
          reported.delete(itemId);
        }
      }
    }
  } catch (e) { silentCatch("item_watch_scan", e); }
}, 200);

// =========================================================
// Claim wand — corner selection
// =========================================================

// Admin-only claiming (maxClaimsPerPlayer === 0): block selection up front so
// non-admins don't waste time building a claim createClaim will reject.
function _wandClaimBlocked(player) {
  if (getCfg().maxClaimsPerPlayer === 0 && !isAdmin(player).ok) {
    tell(player, t("jm_at.claims.wand_admin_only"));
    return true;
  }
  return false;
}

function handleWandCorner1(player, pos) {
  if (_wandClaimBlocked(player)) return;
  const xuid = getPlayerXuid(player);
  setCorner1(xuid, pos, player.dimension.id);
  tell(
    player,
    t(
      "jm_at.claims.wand_corner1",
      `${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)}`,
    ),
  );
  tell(player, t("jm_at.claims.wand_corner2_hint"));
}

function handleWandCorner2(player, pos) {
  if (_wandClaimBlocked(player)) return;
  const xuid = getPlayerXuid(player);
  const dimId = player.dimension.id;
  const placed = setCorner2(xuid, pos, dimId);

  if (!placed) {
    // No existing corner 1 or dimension mismatch — setCorner2 already
    // reset corner 1 to this position, so just confirm it as corner 1
    tell(
      player,
      t(
        "jm_at.claims.wand_corner1",
        `${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)}`,
      ),
    );
    tell(player, t("jm_at.claims.wand_corner2_hint"));
    return;
  }

  const sel = getPendingSelection(xuid);
  if (!sel?.corner1 || !sel?.corner2) return;

  const { min, max } = normalizeCorners(sel.corner1, sel.corner2);

  const c2 = pos;
  tell(
    player,
    t(
      "jm_at.claims.wand_corner2",
      `${Math.floor(c2.x)}, ${Math.floor(c2.y)}, ${Math.floor(c2.z)}`,
    ),
  );

  // One source of truth for what this selection would do and whether it can, so
  // the corner-2 hint can no longer disagree with the wand menu. claimPreviewOpts
  // is the SAME role-aware preview the menu uses (owner -> owner-only, admin ->
  // admin, else plain), so an overlap reads as an overwrite path for staff and a
  // hard block only for regular players — on every server, not just admin-only.
  // v.hint is a plain string today; when claims.js converts it to a RawMessage
  // the raw() composition below keeps working unchanged.
  const v = evaluateSelection(player, min, max, dimId, claimPreviewOpts(player));
  const color = v.ok ? "§2" : "§c";
  tell(
    player,
    t("jm_at.claims.wand_selection", v.areaChunks, raw(color, v.hint)),
  );

  // Visualize the pending selection using the verdict's Y-normalized bounds.
  // Colour it to match what the selection will become: a sub-claim or sub-sub-
  // claim selection uses its own particle tier (like the claim viewer and live
  // preview) instead of the normal-claim shower.
  let pid = "jm_at:viewer_particles";
  let pStep = 2;
  if (v.kind === "subclaim") {
    const parent = v.target ? getClaimById(v.target.id) : null;
    pid =
      parent && parent.parentId
        ? "jm_at:sub_sub_claim_particles"
        : "jm_at:sub_claim_particles";
    pStep = 3;
  }
  visualizeClaim(
    player,
    v.yNormalized.min,
    v.yNormalized.max,
    player.location.y,
    pid,
    pStep,
  );
}

// Claim viewer — offhand action bar display + crouch particle visualization (mainhand or offhand) (~1s poll)
system.runInterval(() => {
  try {
    // Offhand: show claim info on action bar
    for (const player of world.getPlayers()) {
      try {
        const offhand = player
          .getComponent("minecraft:equippable")
          ?.getEquipment(EquipmentSlot.Offhand);
        if (offhand?.typeId !== ITEMS.claimViewer) continue;
        const claim = getClaimAt(player.dimension.id, player.location);
        if (claim) {
          // Defensive ?? "" — a malformed record with a missing name/ownerName
          // would otherwise throw and silently skip this player's action bar.
          const name = (claim.name ?? "").trim();
          const ownerName = (claim.ownerName ?? "").trim();
          const mn = claim.min,
            mx = claim.max;
          let label;
          if (claim.isAdminClaim) {
            label = name
              ? t("jm_at.claims.viewer_admin_named", name)
              : t("jm_at.claims.viewer_admin");
          } else {
            label = name
              ? t("jm_at.claims.viewer_owner_named", ownerName, name)
              : `§q${ownerName}`;
          }
          player.onScreenDisplay.setActionBar(
            t(
              "jm_at.claims.viewer_bar",
              `${Math.floor(mn.x)},${Math.floor(mn.y)},${Math.floor(mn.z)} → ${Math.floor(mx.x)},${Math.floor(mx.y)},${Math.floor(mx.z)}`,
              label,
            ),
          );
        } else {
          player.onScreenDisplay.setActionBar(t("jm_at.claims.viewer_none"));
        }
      } catch {}
    }

    // Mainhand or offhand + crouch: particle visualization
    const eq2 = (p) => p.getComponent("minecraft:equippable");
    let sneakers;
    try {
      sneakers = world.getPlayers().filter((p) => {
        if (!p.isSneaking) return false;
        const e = eq2(p);
        return (
          e?.getEquipment(EquipmentSlot.Mainhand)?.typeId === ITEMS.claimViewer ||
          e?.getEquipment(EquipmentSlot.Offhand)?.typeId === ITEMS.claimViewer
        );
      });
    } catch (e) {
      silentCatch("claim_viewer_filter", e);
      return;
    }
    if (!sneakers.length) return;

    const allClaims = getAllClaims();
    const R2 = 20 * 20;

    for (const player of sneakers) {
      try {
        const pos = player.location;
        const dimId = player.dimension.id;

        for (const claim of allClaims) {
          if (claim.dimension !== dimId) continue;
          const pid = claim.parentId
            ? (getClaimById(claim.parentId)?.parentId
              ? "jm_at:sub_sub_claim_particles"
              : "jm_at:sub_claim_particles")
            : "jm_at:viewer_particles";
          const pStep = claim.parentId ? 3 : 2;
          // Range-cull on the claim's union bbox, then draw the MERGED fountain
          // outline — extension rects join into one shape instead of separate boxes.
          const rects = getClaimRects(claim);
          let minX = Infinity,
            minZ = Infinity,
            maxX = -Infinity,
            maxZ = -Infinity;
          for (const r of rects) {
            if (r.min.x < minX) minX = r.min.x;
            if (r.min.z < minZ) minZ = r.min.z;
            if (r.max.x > maxX) maxX = r.max.x;
            if (r.max.z > maxZ) maxZ = r.max.z;
          }
          const dx = Math.max(minX - pos.x, 0, pos.x - maxX);
          const dz = Math.max(minZ - pos.z, 0, pos.z - maxZ);
          if (dx * dx + dz * dz > R2) continue;
          visualizeClaimMerged(
            player,
            claim,
            player.location.y,
            pid,
            pStep,
            -3,
            false,
          );
        }
      } catch (e) {
        silentCatch("claim_viewer_player", e);
      }
    }
  } catch (e) {
    silentCatch("claim_viewer_tick", e);
  }
}, 20);

// =========================================================
// Live claim-border preview (cfg.claimLivePreviewEnabled, default ON; admins can disable).
// Every cube border below is gated by this flag; the legacy fountain "shower" and
// the action-bar live in the 20-tick viewer loop above and are NOT gated.
//
// Runs ~4x/sec so the one-corner rubber-band (which follows the player's aim)
// feels live. For each player it draws:
//   (A) the pending wand selection as a CYAN cube box — corner1->corner2 if both
//       are set, else corner1->the block under the crosshair (live rubber-band).
//       Plus the existing claim it would expand/extend as a GOLD box.
//   (B) when the Claim Viewer is held (offhand always; mainhand while crouching),
//       every nearby claim's border as a GOLD cube box.
// Pure preview: re-derived each tick, self-clears on confirm/cancel/timeout/
// logout, particles self-expire (~0.4s).
// =========================================================
const _livePreviewCache = new Map(); // xuid -> { key, targetId } (recompute on bounds change)
const _LIVE_MAX_CUBES = 64; // per box; caps spawns so large selections stay cheap
const _LIVE_SEL_R2 = 48 * 48; // show the player's own selection from this far
const _LIVE_VIEW_R2 = 24 * 24; // tighter radius for viewer claim borders (can be many)

function _liveStep(min, max) {
  const perim = 2 * (max.x - min.x + (max.z - min.z)) + 4;
  return Math.max(1, Math.ceil(perim / _LIVE_MAX_CUBES));
}

// Where corner 2 would land if placed now: the block under the crosshair. Falls
// back to a short view-projection so the rubber-band still shows when the player
// aims at the sky / beyond range.
function _aimTarget(player) {
  try {
    const hit = player.getBlockFromViewDirection({
      maxDistance: 32,
      includePassableBlocks: false,
    });
    if (hit && hit.block) return hit.block.location;
  } catch {}
  try {
    const h = player.getHeadLocation();
    const d = player.getViewDirection();
    return { x: h.x + d.x * 16, y: h.y + d.y * 16, z: h.z + d.z * 16 };
  } catch {}
  return null;
}

// Range-culled centred cube border at the player's feet (yOffset 0, centered).
function _drawLiveBox(player, min, max, pos, particleId, r2) {
  const dx = Math.max(min.x - pos.x, 0, pos.x - (max.x + 1));
  const dz = Math.max(min.z - pos.z, 0, pos.z - (max.z + 1));
  if (dx * dx + dz * dz > r2) return;
  visualizeClaim(player, min, max, pos.y, particleId, _liveStep(min, max), 0, true);
}

// Range-culled MERGED outline of a whole claim — joins extension rects into one
// shape (internal shared edges suppressed) instead of drawing each rect's box.
// Range-cull + step are computed from the union bounding box.
function _drawLiveClaim(player, claim, pos, particleId, r2) {
  const rects = getClaimRects(claim);
  if (!rects.length) return;
  let minX = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxZ = -Infinity;
  for (const r of rects) {
    if (r.min.x < minX) minX = r.min.x;
    if (r.min.z < minZ) minZ = r.min.z;
    if (r.max.x > maxX) maxX = r.max.x;
    if (r.max.z > maxZ) maxZ = r.max.z;
  }
  const dx = Math.max(minX - pos.x, 0, pos.x - (maxX + 1));
  const dz = Math.max(minZ - pos.z, 0, pos.z - (maxZ + 1));
  if (dx * dx + dz * dz > r2) return;
  const step = _liveStep({ x: minX, z: minZ }, { x: maxX, z: maxZ });
  visualizeClaimMerged(player, claim, pos.y, particleId, step, 0);
}

// Colour of the pending-selection box, from the verdict. Feasibility-FIRST:
// anything the action can't actually do is RED (this is why an expand that would
// swallow a second claim shows red, not green — its verdict carries a blocker so
// v.ok is false). Otherwise: yellow = a staff overwrite of deletable claim(s)
// (allowed, so v.ok stays true); blue = a new sub-claim (inside a top-level
// claim); orange = a new sub-SUB-claim (inside a sub-claim); green = a plain new
// claim / expand / extend that will go through.
function _selectionParticle(v) {
  if (!v.ok) return "jm_at:claim_outline_red";
  if (v.kind === "new" && (v.overwrite?.deletable?.length ?? 0) > 0)
    return "jm_at:claim_outline_yellow";
  if (v.kind === "subclaim") {
    const parent = v.target ? getClaimById(v.target.id) : null;
    return parent && parent.parentId
      ? "jm_at:claim_outline_orange"
      : "jm_at:claim_outline_blue";
  }
  return "jm_at:claim_outline_green";
}

// Colour of an EXISTING claim shown by the viewer (and the expand/extend target),
// by depth: top-level = darker green, sub-claim = darker blue, sub-sub = darker
// orange — the dim twins of the new-selection hues, so each tier reads as the
// same colour whether you're making it or just looking at it.
function _existingParticle(claim) {
  if (!claim.parentId) return "jm_at:claim_outline_dgreen";
  const parent = getClaimById(claim.parentId);
  return parent && parent.parentId
    ? "jm_at:claim_outline_dorange"
    : "jm_at:claim_outline_dblue";
}

system.runInterval(() => {
  try {
    if (getCfg().claimLivePreviewEnabled !== true) return;
    for (const player of world.getPlayers()) {
      try {
        const xuid = getPlayerXuid(player);
        const pos = player.location;
        const dimId = player.dimension.id;

        // (A) Pending wand selection, rubber-banding to the aimed block until
        // corner 2 is placed. Its colour reflects what the selection would do
        // (see _selectionParticle).
        const sel = getPendingSelection(xuid);
        const c2 =
          sel?.corner1 && sel.dimensionId === dimId
            ? (sel.corner2 ?? _aimTarget(player))
            : null;
        if (c2) {
          const { min, max } = normalizeCorners(sel.corner1, c2);

          // Recompute the verdict (selection colour + expand/extend target) only
          // when the (possibly moving) bounds change; replay the cache otherwise.
          const key = `${min.x},${min.z},${max.x},${max.z}`;
          let cached = _livePreviewCache.get(xuid);
          if (!cached || cached.key !== key) {
            let selParticle = "jm_at:claim_outline_green";
            let targetId = null;
            try {
              const v = evaluateSelection(
                player,
                min,
                max,
                dimId,
                claimPreviewOpts(player),
              );
              selParticle = _selectionParticle(v);
              if ((v.kind === "expand" || v.kind === "extend") && v.target)
                targetId = v.target.id;
            } catch {}
            cached = { key, selParticle, targetId };
            _livePreviewCache.set(xuid, cached);
          }

          _drawLiveBox(player, min, max, pos, cached.selParticle, _LIVE_SEL_R2);

          // Existing claim being expanded/extended, coloured by depth (a top-
          // level expand target is darker green).
          if (cached.targetId) {
            const tc = getClaimById(cached.targetId);
            if (tc)
              _drawLiveClaim(player, tc, pos, _existingParticle(tc), _LIVE_SEL_R2);
          }
        } else {
          _livePreviewCache.delete(xuid);
        }

        // (B) Claim Viewer: cube borders of nearby existing claims, coloured by
        // depth (top-level darker green, sub darker blue, sub-sub darker orange).
        // Held in EITHER hand shows them. (The legacy fountain shower + action-bar
        // are the separate 20-tick loop, still gated on crouch.)
        let showViewer = false;
        try {
          const eq = player.getComponent("minecraft:equippable");
          const off =
            eq?.getEquipment(EquipmentSlot.Offhand)?.typeId === ITEMS.claimViewer;
          const main =
            eq?.getEquipment(EquipmentSlot.Mainhand)?.typeId === ITEMS.claimViewer;
          showViewer = off || main;
        } catch {}
        if (showViewer) {
          for (const claim of getAllClaims()) {
            if (claim.dimension !== dimId) continue;
            _drawLiveClaim(player, claim, pos, _existingParticle(claim), _LIVE_VIEW_R2);
          }
        }
      } catch (e) {
        silentCatch("claim_live_preview_player", e);
      }
    }
  } catch (e) {
    silentCatch("claim_live_preview_tick", e);
  }
}, 5);

// Corner 1 — crouch + hit a block. Detected two ways so it's instant in both
// game modes: entityHitBlock (a single melee swing) covers survival, and the
// playerBreakBlock path covers creative (where a click instant-breaks and may
// not fire entityHitBlock). The wand never actually breaks blocks; a shared
// cooldown stops a creative click that fires both from double-processing.
const _wandHitCooldown = new Map(); // xuid -> timestamp (debounce held attack)
function _wandSetCorner1(player, pos) {
  try {
    if (!player || player.typeId !== "minecraft:player") return;
    if (!player.isSneaking) return; // crouch-gated to avoid stray marking
    const item = player
      .getComponent("minecraft:equippable")
      ?.getEquipment(EquipmentSlot.Mainhand);
    if (item?.typeId !== ITEMS.claimWand) return;
    const xuid = getPlayerXuid(player);
    const now = Date.now();
    if (now - (_wandHitCooldown.get(xuid) ?? 0) < 250) return;
    _wandHitCooldown.set(xuid, now);
    handleWandCorner1(player, pos);
  } catch {}
}

// Survival: a single melee swing. entityHitBlock is an after-event (read-write),
// so game-state calls can run directly.
try {
  world.afterEvents.entityHitBlock.subscribe((ev) => {
    try {
      if (ev.hitBlock) _wandSetCorner1(ev.damagingEntity, ev.hitBlock.location);
    } catch {}
  });
} catch {}

// Creative: a click instant-breaks. Cancel the break (the wand never destroys
// blocks) and use it as the Corner 1 trigger. Before-event, so defer via run.
try {
  world.beforeEvents.playerBreakBlock.subscribe((ev) => {
    try {
      const player = ev.player;
      const item = player
        ?.getComponent("minecraft:equippable")
        ?.getEquipment(EquipmentSlot.Mainhand);
      if (item?.typeId !== ITEMS.claimWand) return;
      ev.cancel = true;
      const blockLoc = ev.block.location;
      system.run(() => _wandSetCorner1(player, blockLoc));
    } catch {}
  });
} catch {}

// Corner 2 — crouch + interact on a block. beforeEvents.playerInteractWithBlock
// carries the exact clicked block. Non-sneak use opens the claims menu (itemUse
// handler in main.js), so corner-setting is sneak-gated. game-state calls in a
// before-event must run inside system.run.
const _wandInteractCooldown = new Map(); // xuid -> timestamp
try {
  world.beforeEvents.playerInteractWithBlock.subscribe((ev) => {
    try {
      const item = ev.player
        ?.getComponent("minecraft:equippable")
        ?.getEquipment(EquipmentSlot.Mainhand);
      if (item?.typeId !== ITEMS.claimWand) return;
      ev.cancel = true;
      if (!ev.player.isSneaking) return; // non-sneak use opens the menu
      const player = ev.player;
      const xuid = getPlayerXuid(player);
      const now = Date.now();
      if (now - (_wandInteractCooldown.get(xuid) ?? 0) < 250) return;
      _wandInteractCooldown.set(xuid, now);
      const blockLoc = ev.block.location;
      system.run(() => handleWandCorner2(player, blockLoc));
    } catch {}
  });
} catch {}

// Clean up in-memory tracking on player leave
world.afterEvents.playerLeave.subscribe((ev) => {
  lastReported.delete(ev.playerId);
  // Keyed by xuid (= player.id = ev.playerId), so this frees the entry and stops
  // these maps growing slowly across sessions.
  _wandHitCooldown.delete(ev.playerId);
  _wandInteractCooldown.delete(ev.playerId);
  _livePreviewCache.delete(ev.playerId);
});
