/** Player core, items, snapshots, and punishment helpers. */

import { world, system, ItemStack } from "@minecraft/server";
import { ActionFormData, FormCancelationReason } from "@minecraft/server-ui";
import { NS, ITEMS, LIMITS, FEATURES } from "./constants.js";
import {
  nowMs,
  getPlayerXuid,
  genId,
  clampText,
  fmtDuration,
  tell,
  silentCatch,
} from "./utils.js";
import { t } from "./i18n.js";
import {
  getPlayerCore,
  setPlayerCore,
  upsertRegistryEntry,
  getCfg,
  getRegistryEntry,
  mutateRegistryEntry,
  migrateLegacyOverrides,
  setAdminDenied,
} from "./storage.js";
import {
  isAdmin,
  isStaff,
  isModerator,
  isOwner,
  assignModerator,
  assignAdmin,
} from "./permissions.js";
import { getPlayerClaimBudget, refreshOwnerAdminFlag } from "./claims.js";
import { getRankDb } from "./rank-db.js";
import { syncPlayerStats } from "./stat-scoreboards.js";

// Block stats waiting for the next snapshot.
export const blockStats = new Map(); // playerId -> { mined: number, placed: number }

// Skip travel-distance stats once after teleport.
export const teleportedPlayers = new Set(); // playerId

/** Save this position as the Teleport menu's Last Location target. */
export function captureTpBackLocation(player) {
  try {
    const core = getPlayerCore(player);
    const loc = player.location;
    core.lastTpFromLoc = { x: loc.x, y: loc.y, z: loc.z };
    core.lastTpFromDim = player.dimension.id;
    setPlayerCore(player, core);
  } catch (e) {
    silentCatch("captureTpBackLocation", e);
  }
}

// =========================================================
// Companion-aware teleport
// =========================================================

// Same-dimension mounts eligible for carry. Vehicles stay behind.
const COMPANION_MOUNTS = new Set([
  "minecraft:horse",
  "minecraft:donkey",
  "minecraft:mule",
  "minecraft:skeleton_horse",
  "minecraft:zombie_horse",
  "minecraft:camel",
  "minecraft:camel_husk",
  "minecraft:llama",
  "minecraft:trader_llama",
  "minecraft:pig",
  "minecraft:strider",
  "minecraft:happy_ghast",
]);

// Mounts that need vertical air-pocket placement.
const AERIAL_MOUNTS = new Set(["minecraft:happy_ghast"]);

// Happy ghast hitbox edge length, in blocks.
const GHAST_BOX = 4;

// Extra clear air above a seated happy ghast rider.
const RIDER_HEADROOM = 2;

// Verbose mount-carry logging for render/placement debugging. KEEP = false. for release; true is only for development.
const MOUNT_TP_DEBUG = false;

// Cross-dimension mount carry is disabled; Bedrock can delete or misplace the entity.
// Auto-seat runs after same-dimension carries settle.
const RESEAT_AFTER_CARRY = true;

function ghastDbg(ctx, msg) {
  if (!MOUNT_TP_DEBUG) return;
  try {
    console.warn(`[AT:mount-tp] ${msg}`);
  } catch {}
  try {
    if (ctx?.player?.isValid) tell(ctx.player, `§8[mount-tp] ${msg}`);
  } catch {}
}

// Labels used in mount prompts/messages — lang keys so they translate.
// lang-keys: jm_at.mount.*
const MOUNT_LABEL_KEYS = {
  "minecraft:horse": "jm_at.mount.horse",
  "minecraft:donkey": "jm_at.mount.donkey",
  "minecraft:mule": "jm_at.mount.mule",
  "minecraft:skeleton_horse": "jm_at.mount.skeleton_horse",
  "minecraft:zombie_horse": "jm_at.mount.zombie_horse",
  "minecraft:camel": "jm_at.mount.camel",
  "minecraft:camel_husk": "jm_at.mount.camel_husk",
  "minecraft:llama": "jm_at.mount.llama",
  "minecraft:trader_llama": "jm_at.mount.trader_llama",
  "minecraft:pig": "jm_at.mount.pig",
  "minecraft:strider": "jm_at.mount.strider",
  "minecraft:happy_ghast": "jm_at.mount.happy_ghast",
};
/** RawMessage label for a mount typeId ("horse", "happy ghast", …). */
function mountLabel(typeId) {
  return t(MOUNT_LABEL_KEYS[typeId] ?? "jm_at.mount.generic");
}

/** Return the carried mount the player is riding, if any. */
export function getCompanionMount(player) {
  try {
    const e = player.getComponent("minecraft:riding")?.entityRidingOn;
    if (e && COMPANION_MOUNTS.has(e.typeId)) return e;
  } catch {}
  return null;
}

const _mtWait = (t) => new Promise((r) => system.runTimeout(r, t));

/**
 * Ask what to do with the current companion mount before teleporting.
 * Returns "bring", "leave", or "cancel"; no mount defaults to "bring".
 */
export async function confirmBringMount(player, destDim, targetPos) {
  const mount = getCompanionMount(player);
  if (!mount) return "bring"; // No mount to ask about.
  const label = mountLabel(mount.typeId);
  // Blocked carries offer teleport-without/cancel instead of bring/leave/cancel.
  let blockReason = null;
  if (!!destDim && destDim.id !== player.dimension.id) {
    blockReason = "crossdim";
  } else {
    try {
      const needsPin =
        targetPos && !isLoaded(destDim ?? player.dimension, targetPos);
      if (needsPin && !hasFreeTickingArea(player.dimension, player.location)) {
        blockReason = "capfull";
      }
    } catch {}
  }

  const form = new ActionFormData();
  if (blockReason) {
    const body =
      blockReason === "crossdim"
        ? t("jm_at.mount.blocked_crossdim_body", label)
        : t("jm_at.mount.blocked_capfull_body", label);
    form
      .title(
        blockReason === "crossdim"
          ? t("jm_at.mount.blocked_crossdim_title")
          : t("jm_at.mount.blocked_capfull_title"),
      )
      .body(body)
      .button(t("jm_at.mount.btn_tp_without", label))
      .button(t("jm_at.mount.btn_cancel"));
  } else {
    form
      .title(t("jm_at.mount.bring_title"))
      .body(t("jm_at.mount.bring_body", label))
      .button(t("jm_at.mount.btn_bring", label))
      .button(t("jm_at.mount.btn_leave"))
      .button(t("jm_at.mount.btn_cancel"));
  }

  let r;
  try {
    for (let i = 0; i < 20; i++) {
      if (!player.isValid) return "cancel";
      r = await form.show(player);
      if (!r.canceled) break;
      if (r.cancelationReason !== FormCancelationReason.UserBusy) break;
      await _mtWait(10);
    }
  } catch {
    // Safe fallback if the form fails.
    return blockReason ? "leave" : "bring";
  }
  if (!r || r.canceled) return "cancel"; // Esc/close cancels the teleport.
  if (blockReason) {
    return r.selection === 0 ? "leave" : "cancel";
  }
  return r.selection === 0 ? "bring" : r.selection === 1 ? "leave" : "cancel";
}

const PARROT_SEARCH_RADIUS = 2.5;

/** True when the destination chunk is loaded. */
function isLoaded(dimension, loc) {
  try {
    if (typeof dimension.isChunkLoaded === "function") {
      return dimension.isChunkLoaded(loc) === true;
    }
  } catch {}
  try {
    return !!dimension.getBlock(loc);
  } catch {
    return false; // Unloaded or unreadable chunk.
  }
}

/** Try placing the mount, letting the engine check its real hitbox. */
function tryPlaceMount(mount, loc, destDim) {
  try {
    return mount.tryTeleport(loc, { dimension: destDim, checkForBlocks: true });
  } catch {
    return false;
  }
}

/** True if the happy ghast footprint would sit over liquid. */
function footprintHasLiquid(destDim, cx, y, cz) {
  for (let dx = -1; dx <= 2; dx++) {
    for (let dz = -1; dz <= 2; dz++) {
      try {
        const b = destDim.getBlock({ x: cx + dx, y, z: cz + dz });
        if (b && b.isLiquid) return true;
      } catch {}
    }
  }
  return false;
}

/** True if the happy ghast box is fully air from this block up. */
function boxClearForRead(destDim, cx, y, cz, height) {
  for (let by = y; by < y + height; by++) {
    for (let dx = -1; dx <= 2; dx++) {
      for (let dz = -1; dz <= 2; dz++) {
        let b;
        try {
          b = destDim.getBlock({ x: cx + dx, y: by, z: cz + dz });
        } catch {
          return false; // Treat unreadable chunks as blocked.
        }
        if (!b || !b.isAir) return false;
      }
    }
  }
  return true;
}

/** Place a ground mount in the nearest same-Y ring around the landing. */
function searchPlaceMount(mount, center, destDim, radius) {
  const cx = Math.floor(center.x);
  const cy = Math.floor(center.y);
  const cz = Math.floor(center.z);
  for (let r = 1; r <= radius; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue; // Ring only.
        const loc = { x: cx + dx + 0.5, y: cy, z: cz + dz + 0.5 };
        if (tryPlaceMount(mount, loc, destDim)) return loc;
      }
    }
  }
  return null;
}

/**
 * Find a block-centered air pocket above the landing for a happy ghast.
 * `headroom > 0` is the rider-seat pass; `0` is the parked pass.
 */
function findAerialSpot(center, destDim, headroom, maxRise, startRise = 0) {
  const cx = Math.floor(center.x);
  const cy = Math.floor(center.y);
  const cz = Math.floor(center.z);
  // Keep the box and optional rider space below the dimension ceiling.
  let maxY = cy + maxRise;
  try {
    const ceil = destDim.heightRange?.max;
    if (typeof ceil === "number") {
      maxY = Math.min(maxY, ceil - GHAST_BOX - headroom);
    }
  } catch {}
  // Start above the player so the ghast does not spawn on them.
  for (let y = cy + startRise; y <= maxY; y++) {
    if (!boxClearForRead(destDim, cx, y, cz, GHAST_BOX + headroom)) continue;
    // Seat pass: do not park directly over liquid.
    if (headroom > 0 && footprintHasLiquid(destDim, cx, y - 1, cz)) continue;
    return { x: cx + 0.5, y, z: cz + 0.5 };
  }
  return null;
}

// Re-seat only after placement settles; immediate addRider caused client desyncs.

/**
 * Place a same-dimension carried mount near the landing and verify it arrived.
 * Returns "nearby", "noroom", "lost", or "failed".
 */
function placeMount(ctx) {
  const { mount } = ctx;
  if (!mount.isValid) return "failed";
  return AERIAL_MOUNTS.has(mount.typeId)
    ? placeAerialMount(ctx)
    : placeGroundMount(ctx);
}

/** Place a happy ghast in an open-air pocket above the landing. */
function placeAerialMount(ctx) {
  const { mount, location, destDim } = ctx;
  // Prefer rider headroom; fall back to any box-fit pocket.
  let spot = findAerialSpot(location, destDim, RIDER_HEADROOM, 16, 2);
  if (!spot) spot = findAerialSpot(location, destDim, 0, 16, 2);
  if (!spot) {
    ghastDbg(
      ctx,
      `aerial noroom (no air pocket near landing in ${destDim.id})`,
    );
    return "noroom";
  }
  const fromDim = mount.dimension?.id ?? "?";
  try {
    mount.teleport(spot, { dimension: destDim });
  } catch (e) {
    ghastDbg(
      ctx,
      `aerial teleport threw (${e?.message ?? e}); from=${fromDim} — lost`,
    );
    return "lost";
  }
  let nowDim = "gone";
  try {
    if (mount.isValid) nowDim = mount.dimension?.id ?? "?";
  } catch {}
  const landed = nowDim === destDim.id;
  ghastDbg(
    ctx,
    `aerial -> (${spot.x},${spot.y},${spot.z}) landed=${landed} (${fromDim}->${nowDim})`,
  );
  return landed ? "nearby" : "lost";
}

/** Place a ground mount near the landing. */
function placeGroundMount(ctx) {
  const { mount, location, destDim } = ctx;
  // Prefer a nearby ring spot; use the landing itself as a last fit.
  let spot = searchPlaceMount(mount, location, destDim, 5);
  if (!spot && tryPlaceMount(mount, location, destDim)) spot = location;
  if (!spot) {
    ghastDbg(ctx, `ground noroom (no spot near landing in ${destDim.id})`);
    return "noroom";
  }
  // Verify the mount is still valid and in the destination.
  let nowDim = "gone";
  try {
    if (mount.isValid) nowDim = mount.dimension?.id ?? "?";
  } catch {}
  if (nowDim !== destDim.id) {
    ghastDbg(ctx, `ground lost (in ${nowDim}, wanted ${destDim.id})`);
    return "lost";
  }
  ghastDbg(
    ctx,
    `ground nearby: (${Math.floor(spot.x)},${Math.floor(spot.y)},${Math.floor(spot.z)}) in ${nowDim}`,
  );
  return "nearby";
}

/** Nudge a moved mount so clients re-render it after chunk load. */
function nudgeMountRender(mount) {
  for (const delay of [4, 12]) {
    system.runTimeout(() => {
      try {
        if (!mount.isValid) return;
        const l = mount.location;
        mount.teleport({ x: l.x, y: l.y + 0.04, z: l.z });
      } catch {}
    }, delay);
  }
}

/**
 * Seat the player back on the carried mount after the teleport settles.
 * Aerial mounts move to the player; ground mounts only seat nearby players.
 */
function reseatRider(mount, player) {
  system.runTimeout(() => {
    try {
      if (!mount.isValid || !player.isValid) return;
      // Already riding; leave it alone.
      if (player.getComponent("minecraft:riding")?.entityRidingOn) return;
      let aerial = false;
      try {
        aerial = AERIAL_MOUNTS.has(mount.typeId);
      } catch {}
      if (aerial) {
        // Bring the ghast to the player for a small seat snap.
        const p = player.location;
        try {
          mount.teleport({ x: p.x, y: p.y - GHAST_BOX, z: p.z });
        } catch {}
      } else {
        // Do not pull back players who walked away from a ground mount.
        const a = player.location;
        const b = mount.location;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dz = a.z - b.z;
        if (dx * dx + dy * dy + dz * dz > 8 * 8) return;
      }
      const seated = mount.getComponent("minecraft:rideable")?.addRider(player);
      // Remove the aerial slow-fall cushion after a successful seat.
      if (seated) {
        try {
          player.removeEffect("slow_falling");
        } catch {}
      }
    } catch {}
  }, 10);
}

/** Give aerial riders slow-falling while the mount/re-seat catches up. */
function cushionAerialArrival(player) {
  if (!RESEAT_AFTER_CARRY) return;
  try {
    player.addEffect("slow_falling", 200, { showParticles: false });
  } catch {}
}

/** Finish mount carry: render nudge, optional re-seat, and player notice. */
function afterPlace(ctx, result) {
  const { player, label, askToBringMount } = ctx;
  // Re-broadcast moved mounts that render late for newly loaded clients.
  if (result === "nearby") {
    try {
      if (ctx.mount?.isValid) {
        nudgeMountRender(ctx.mount);
        // Auto-seat after the placement delay.
        if (RESEAT_AFTER_CARRY) reseatRider(ctx.mount, player);
      }
    } catch {}
  }
  if (!askToBringMount) return; // Automated teleport: no chat spam.
  if (result === "nearby") {
    // Mount arrived; message depends on auto-seat mode.
    tell(
      player,
      RESEAT_AFTER_CARRY
        ? t("jm_at.mount.came_with", label)
        : t("jm_at.mount.came_with_hop_on", label),
    );
  } else if (result === "lost") {
    // Mount went invalid before placement finished.
    tell(player, t("jm_at.mount.lost", label));
  } else {
    // "noroom" / "failed": no safe spot, or the mount was already gone.
    tell(player, t("jm_at.mount.no_room", label));
  }
}

// Fixed names let the startup sweep reclaim leaked ticking areas.
const MOUNT_TA_POOL = 4; // Concurrent mount carry pins.
export const SPAWN_TA_POOL = 2; // World-spawn teleport pins.
let _mountTaSlot = 0;

/** Probe for a free /tickingarea slot with a temporary 1-block area. */
function hasFreeTickingArea(dim, loc) {
  const x = Math.floor(loc.x);
  const y = Math.floor(loc.y);
  const z = Math.floor(loc.z);
  let free = false;
  try {
    try {
      dim.runCommand(`tickingarea remove jm_probe`);
    } catch {}
    const r = dim.runCommand(
      `tickingarea add ${x} ${y} ${z} ${x} ${y} ${z} jm_probe`,
    );
    free = !!r && (r.successCount ?? 0) >= 1;
  } catch {}
  try {
    dim.runCommand(`tickingarea remove jm_probe`);
  } catch {}
  return free;
}

/** Teleport the player (and any shoulder parrots) to the destination. */
function doPlayerTp(player, location, tpOptions, parrots, companionOpts, transaction) {
  // The travel transaction runs in the very same tick as the actual player move,
  // including the next-tick dismount path. Existing callers need no callbacks.
  if (transaction?.finished) return transaction.success;
  let success = false;
  try {
    if (transaction && transaction.prepare() === false) return false;
    player.teleport(location, tpOptions);
    success = true;
  } catch {
    success = false;
  }
  transaction?.finish(success);
  if (!success) return false;
  for (const parrot of parrots) {
    try {
      if (parrot.isValid) parrot.teleport(location, companionOpts);
    } catch {}
  }
  return true;
}

/** Pin the origin chunk while a far mount carry is in flight. */
function acquireForceLoad(dim, location) {
  const fx = Math.floor(location.x);
  const fy = Math.floor(location.y);
  const fz = Math.floor(location.z);
  const name = `jm_mount_tp_${_mountTaSlot}`;
  _mountTaSlot = (_mountTaSlot + 1) % MOUNT_TA_POOL;
  const from = { x: fx - 4, y: fy, z: fz - 4 };
  const to = { x: fx + 4, y: fy, z: fz + 4 };
  try {
    // Clear any stale area before reusing the name.
    try {
      dim.runCommand(`tickingarea remove ${name}`);
    } catch {}
    const r = dim.runCommand(
      `tickingarea add ${from.x} ${from.y} ${from.z} ${to.x} ${to.y} ${to.z} ${name}`,
    );
    // At the 10-area cap, add returns successCount 0 instead of throwing.
    if (!r || (r.successCount ?? 0) < 1) return null;
    return {
      release() {
        try {
          dim.runCommand(`tickingarea remove ${name}`);
        } catch {}
      },
    };
  } catch {
    return null;
  }
}

/** Clear any ticking areas leaked by a crash or reload. */
function sweepLeakedTickingAreas() {
  const dims = [];
  for (const id of ["overworld", "nether", "the_end"]) {
    try {
      dims.push(world.getDimension(id));
    } catch {}
  }
  for (let i = 0; i < MOUNT_TA_POOL; i++) {
    for (const d of dims) {
      try {
        d.runCommand(`tickingarea remove jm_mount_tp_${i}`);
      } catch {}
    }
  }
  // Clean any leaked probe area.
  for (const d of dims) {
    try {
      d.runCommand(`tickingarea remove jm_probe`);
    } catch {}
  }
  let ow = null;
  try {
    ow = world.getDimension("overworld");
  } catch {}
  if (ow) {
    for (let i = 0; i < SPAWN_TA_POOL; i++) {
      try {
        ow.runCommand(`tickingarea remove jm_spawn_tp_${i}`);
      } catch {}
    }
  }
}
// Defer past early read-only startup.
try {
  system.runTimeout(sweepLeakedTickingAreas, 40);
} catch {}

/**
 * Carry a same-dimension mount.
 * Near teleports move the mount first; far teleports move the player first.
 */
async function bringMount(ctx) {
  const {
    mount,
    player,
    location,
    tpOptions,
    companionOpts,
    destDim,
    parrots,
    transaction,
  } = ctx;
  const settle = (result) =>
    system.runTimeout(() => afterPlace(ctx, result), 2);
  // Aerial carries need slow-falling while the ghast catches up.
  let aerial = false;
  try {
    aerial = !!(mount && mount.isValid && AERIAL_MOUNTS.has(mount.typeId));
  } catch {}

  // Check/charge in the same synchronous tick, before moving either entity.
  if (transaction && !transaction.prepare()) return;

  // Near teleport: place the mount, then bring the player.
  if (isLoaded(destDim, location)) {
    const result = mount.isValid ? placeMount(ctx) : "failed";
    if (!doPlayerTp(player, location, tpOptions, parrots, companionOpts, transaction)) { settle("failed"); return; }
    if (aerial) cushionAerialArrival(player);
    settle(result);
    return;
  }

  // Far teleport: player first, then move the mount into the loaded chunk.
  let originHandle = null;
  try {
    // Best-effort origin pin keeps the mount handle alive.
    if (mount.isValid) {
      try {
        originHandle = acquireForceLoad(mount.dimension, mount.location);
      } catch {}
    }
    if (!doPlayerTp(player, location, tpOptions, parrots, companionOpts, transaction)) { settle("failed"); return; }
    if (aerial) cushionAerialArrival(player);
    // Wait for the destination chunk before moving the mount in.
    for (let i = 0; i < 40 && !isLoaded(destDim, location); i++)
      await _mtWait(1);
    await _mtWait(5);
    if (!player.isValid) return; // Player left mid-teleport.
    settle(mount.isValid ? placeMount(ctx) : "lost");
  } catch (e) {
    ghastDbg(ctx, `carry exception (${e?.message ?? e})`);
    transaction?.finish(false);
    settle("lost");
  } finally {
    // Release after a short settle delay.
    if (originHandle) system.runTimeout(() => originHandle.release(), 3);
  }
}

/**
 * Teleport wrapper that can carry a ridden companion mount and nearby parrots.
 * Same-dimension mounts can follow; cross-dimension mounts stay at the origin.
 */
export function teleportPlayer(player, location, options) {
  // Resolves only when the real player.teleport completes. Never rejects, so
  // legacy fire-and-forget callers do not gain unhandled promise rejections.
  let resolveResult;
  const result = new Promise((resolve) => { resolveResult = resolve; });
  const transaction = {
    before: options?.beforeTeleport,
    finished: false,
    prepared: false,
    success: false,
    prepare() {
      if (this.finished) return false;
      if (this.prepared) return true;
      this.prepared = true;
      try {
        if (this.before && this.before() === false) { this.finish(false); return false; }
        return true;
      } catch { this.finish(false); return false; }
    },
    finish(success) {
      if (this.finished) return;
      this.finished = true;
      this.success = success;
      try { options?.afterTeleport?.(success); }
      catch (e) { silentCatch("teleport_after_callback", e); }
      resolveResult(success);
    },
  };
  const askToBringMount = options?.askToBringMount === true;
  const carryMount = options?.bringMount !== false; // Default: bring it.
  // Remove wrapper-only flags before player.teleport().
  let tpOptions = options;
  if (options && ("askToBringMount" in options || "bringMount" in options || "beforeTeleport" in options || "afterTeleport" in options)) {
    tpOptions = { ...options };
    delete tpOptions.askToBringMount;
    delete tpOptions.bringMount;
    delete tpOptions.beforeTeleport;
    delete tpOptions.afterTeleport;
  }
  const destDim = tpOptions?.dimension ?? player.dimension;
  const companionOpts = tpOptions?.dimension
    ? { dimension: tpOptions.dimension }
    : undefined;

  // Collect ride state before dismounting or teleporting.
  let mount = null;
  let ridingEntity = null;
  try {
    const riding = player.getComponent("minecraft:riding");
    ridingEntity = riding?.entityRidingOn ?? null;
    if (
      carryMount &&
      ridingEntity &&
      COMPANION_MOUNTS.has(ridingEntity.typeId)
    ) {
      mount = ridingEntity;
    }
  } catch {}

  // Cross-dimension mounts stay alive at the origin.
  const crossDim = !!tpOptions?.dimension && destDim.id !== player.dimension.id;
  let mountLeftBehind = false;
  let leftBehindLabel = t("jm_at.mount.generic");
  if (mount && crossDim) {
    leftBehindLabel = mountLabel(mount.typeId);
    mount = null; // Leave cross-dimension mounts at the origin.
    mountLeftBehind = true;
  }

  const parrots = [];
  try {
    for (const e of player.dimension.getEntities({
      type: "minecraft:parrot",
      location: player.location,
      maxDistance: PARROT_SEARCH_RADIUS,
    })) {
      parrots.push(e);
    }
  } catch {}

  const ctx = {
    player,
    location,
    tpOptions,
    companionOpts,
    destDim,
    mount,
    parrots,
    label: mount ? mountLabel(mount.typeId) : null,
    askToBringMount,
    transaction,
  };

  const run = () => {
    try {
    // No carried mount: just move the player and parrots.
    if (!mount) {
      doPlayerTp(player, location, tpOptions, parrots, companionOpts, transaction);
      return;
    }
    // Last-resort fallback if same-dimension carry throws.
    bringMount(ctx).catch(() => {
      try {
        doPlayerTp(player, location, tpOptions, parrots, companionOpts, transaction);
      } catch {}
      system.runTimeout(() => afterPlace(ctx, "lost"), 2);
    });
    } catch { transaction.finish(false); }
  };

  if (ridingEntity) {
    // Dismount first, then teleport on the next tick.
    try {
      ridingEntity.getComponent("minecraft:rideable")?.ejectRider(player);
    } catch {}
    system.runTimeout(run, 1);
  } else {
    run();
  }

  // Warn only for player-facing teleports; automated teleports stay quiet.
  if (mountLeftBehind && askToBringMount) {
    system.runTimeout(() => {
      try {
        if (player.isValid) {
          tell(player, t("jm_at.mount.left_behind_crossdim", leftBehindLabel));
        }
      } catch {}
    }, 3);
  }
  return result;
}

// =========================================================
// Offline rank sync
// =========================================================

/** Apply rank/playtime changes queued while the player was offline. */
export function syncOfflineRankChanges(player) {
  try {
    const xuid = getPlayerXuid(player);
    const regEntry = getRegistryEntry(xuid);
    if (!regEntry) return;
    const core = getPlayerCore(player);
    let changed = false;
    if (regEntry.rankTag !== undefined && regEntry.rankTag !== core.rankTag) {
      core.rankTag = regEntry.rankTag;
      core.rankTagEnabled = regEntry.rankTagEnabled ?? true;
      core.rankSetManually = regEntry.rankSetManually ?? false;
      changed = true;
    }
    if (
      regEntry.bonusPlaytimeMs !== undefined &&
      regEntry.bonusPlaytimeMs !== (core.bonusPlaytimeMs ?? 0)
    ) {
      core.bonusPlaytimeMs = regEntry.bonusPlaytimeMs;
      changed = true;
    }
    // Sync offline bonus claim chunks before the next snapshot writes core.
    if (
      regEntry.bonusChunks !== undefined &&
      regEntry.bonusChunks !== (core.bonusChunks ?? 0)
    ) {
      core.bonusChunks = regEntry.bonusChunks;
      changed = true;
    }
    if (changed) setPlayerCore(player, core);

    // Apply a staff role queued by bulk rank assignment.
    if (
      regEntry.pendingRole === "admin" ||
      regEntry.pendingRole === "moderator"
    ) {
      try {
        if (regEntry.pendingRole === "admin") {
          setAdminDenied(xuid, false); // Explicit grant clears the deny list.
          player.addTag("admin");
          assignAdmin(player); // record the private, un-spoofable admin role
        } else if (!isAdmin(player).ok) {
          assignModerator(player);
        }
        const c2 = getPlayerCore(player);
        if (!c2.hasAdminTool && giveItem(player, ITEMS.adminTool)) {
          c2.hasAdminTool = true;
          setPlayerCore(player, c2);
        }
      } catch (e) {
        silentCatch("apply_pending_role", e);
      }
      try {
        mutateRegistryEntry(xuid, (e) => {
          delete e.pendingRole;
        });
      } catch {}
    }

    // Keep claim ownership flags aligned with current admin status.
    try {
      refreshOwnerAdminFlag(xuid, isAdmin(player).ok);
    } catch (e) {
      silentCatch("refresh_owner_admin", e);
    }
  } catch {}
}

// =========================================================
// Name change detection
// =========================================================

/** Return the previous registered name when a player name changes. */
export function checkNameChange(player) {
  const xuid = getPlayerXuid(player);
  const regEntry = getRegistryEntry(xuid);
  if (!regEntry || regEntry.name === player.name) return null;
  return regEntry.name;
}

// =========================================================
// Punishment helpers
// =========================================================

export function addPunishment(player, type, reason, byAdmin, durationMs = 0) {
  const core = getPlayerCore(player);
  const entry = {
    id: genId("P"),
    type,
    reason: clampText(reason, 200),
    byName: byAdmin.name,
    byXuid: getPlayerXuid(byAdmin),
    at: nowMs(),
    expiresAt: durationMs > 0 ? nowMs() + durationMs : 0,
    active: true,
  };
  core.punishments = [entry, ...(core.punishments ?? [])].slice(
    0,
    LIMITS.PUNISHMENTS_MAX,
  );
  setPlayerCore(player, core);
  return entry;
}

export function clearPunishment(player, type) {
  const core = getPlayerCore(player);
  let changed = false;
  for (const p of core.punishments ?? []) {
    if (p.type === type && p.active) {
      p.active = false;
      changed = true;
    }
  }
  if (changed) setPlayerCore(player, core);
  return changed;
}

export function hasActivePunishment(player, type) {
  const core = getPlayerCore(player);
  const now = nowMs();
  let changed = false;
  for (const p of core.punishments ?? []) {
    if (p.type !== type || !p.active) continue;
    if (p.expiresAt > 0 && now >= p.expiresAt) {
      p.active = false;
      changed = true;
      continue;
    }
    if (changed) setPlayerCore(player, core);
    return p;
  }
  if (changed) setPlayerCore(player, core);
  return null;
}

// =========================================================
// Items / inventory
// =========================================================

export function hasItem(player, itemId) {
  try {
    const inv = player.getComponent("minecraft:inventory")?.container;
    if (!inv) return false;
    for (let i = 0; i < inv.size; i++) {
      const it = inv.getItem(i);
      if (it && it.typeId === itemId) return true;
    }
  } catch {}
  return false;
}

export function giveItem(player, itemId) {
  try {
    const inv = player.getComponent("minecraft:inventory")?.container;
    if (!inv) return false;
    inv.addItem(new ItemStack(itemId, 1));
    return true;
  } catch {
    return false;
  }
}

export function clearInventory(player) {
  try {
    const inv = player.getComponent("minecraft:inventory")?.container;
    if (!inv) return false;
    for (let i = 0; i < inv.size; i++) inv.setItem(i, undefined);
    return true;
  } catch {
    return false;
  }
}

export function ensureStarterItems(player, initialSpawn = true) {
  const core = getPlayerCore(player);
  const cfg = getCfg();

  // Normalize legacy boolean config.
  const rawMode = cfg.deathbackGiveTools;
  const toolMode =
    rawMode === true || rawMode === "always"
      ? "always"
      : rawMode === "inventory"
        ? "inventory"
        : "none";

  const hadTools = core.hadToolsAtDeath ?? {};

  // Restore death-respawn tools across several ticks.
  let respawnTicket = false;
  let respawnAdmin = false;

  // Ticket menu: give once on first join; restore after death by config.
  if (!core.hasTicketItem) {
    if (giveItem(player, ITEMS.ticketMenu)) core.hasTicketItem = true;
    if (!initialSpawn) respawnTicket = true; // Verify post-respawn.
  } else if (!initialSpawn && !hasItem(player, ITEMS.ticketMenu)) {
    if (
      toolMode === "always" ||
      (toolMode === "inventory" && hadTools.ticket)
    ) {
      respawnTicket = true;
    }
  }

  // Admin tool follows the same restore rules for staff.
  if (isStaff(player)) {
    if (!core.hasAdminTool) {
      if (giveItem(player, ITEMS.adminTool)) core.hasAdminTool = true;
      if (!initialSpawn) respawnAdmin = true;
    } else if (!initialSpawn && !hasItem(player, ITEMS.adminTool)) {
      if (
        toolMode === "always" ||
        (toolMode === "inventory" && hadTools.admin)
      ) {
        respawnAdmin = true;
      }
    }
  }

  // Kit tool is craftable, not auto-given.

  setPlayerCore(player, core);

  if (respawnTicket || respawnAdmin) {
    scheduleToolRestore(player, respawnTicket, respawnAdmin);
  }
}

/** Re-check and re-give respawn tools until the inventory settles. */
function scheduleToolRestore(player, wantTicket, wantAdmin) {
  const attempts = [1, 4, 8, 16, 30];
  for (const delay of attempts) {
    system.runTimeout(() => {
      try {
        if (!player.isValid) return;
        // Wait until the player has actually respawned.
        const health = player.getComponent("minecraft:health");
        if (health && health.currentValue <= 0) return;
        if (wantTicket && !hasItem(player, ITEMS.ticketMenu)) {
          giveItem(player, ITEMS.ticketMenu);
        }
        if (wantAdmin && !hasItem(player, ITEMS.adminTool)) {
          giveItem(player, ITEMS.adminTool);
        }
      } catch (e) {
        silentCatch("ensureStarterItems_restore", e);
      }
    }, delay);
  }
}

// =========================================================
// Playtime-based automatic rank assignment
// =========================================================

function checkPlaytimeRank(player, core, cfg) {
  if (!cfg.playtimeRanksEnabled) return;
  if (isStaff(player)) return;
  if (core.rankSetManually && !cfg.playtimeRanksOverrideManual) return;

  const thresholds = cfg.playtimeRanks;
  if (!Array.isArray(thresholds) || thresholds.length === 0) return;

  const playMs = (core.playTimeMs ?? 0) + (core.bonusPlaytimeMs ?? 0);

  // Use the highest met threshold.
  let bestEntry = null;
  for (const entry of thresholds) {
    if (playMs >= entry.minutes * 60000) {
      bestEntry = entry;
    } else {
      break;
    }
  }

  if (!bestEntry) return;

  const db = getRankDb();
  const rank = db[bestEntry.rankName];
  if (!rank) return; // Rank was deleted from DB.

  const tag = rank.tag;
  if ((core.rankTag ?? "").trim() === tag) return; // Already has this rank.

  core.rankTag = tag;
  core.rankTagEnabled = true;
  core.rankSetManually = false;
  tell(player, t("jm_at.ranks.promoted", tag));
}

// =========================================================
// Snapshot
// =========================================================

export function snapshotPlayer(player) {
  let core;
  try {
    if (!player.isValid) return;
    if (player.hasTag(`${NS}:frozen`)) return;
    core = getPlayerCore(player);
    const loc = player.location;
    const prevSeen = core.lastSeen ?? 0;
    core.name = player.name;
    core.lastSeen = nowMs();
    // Accumulate play time since the last snapshot.
    const prevPlayMs = core.playTimeMs ?? 0;
    if (prevSeen > 0) {
      core.playTimeMs = prevPlayMs + Math.max(0, core.lastSeen - prevSeen);
    }
    // Notify when timed play grants more claim area.
    const cfg = getCfg();
    const intervalMs = (cfg.claimAreaTimeInterval ?? 60) * 60000;
    if (intervalMs > 0 && prevPlayMs > 0) {
      const bonus = core.bonusChunks ?? 0;
      const maxBudget = (cfg.claimMaxArea ?? 15) + bonus;
      const startArea = cfg.claimStartArea ?? 5;
      const perTime = cfg.claimAreaPerTime ?? 1;
      const prevBudget = Math.min(
        startArea + Math.floor(prevPlayMs / intervalMs) * perTime + bonus,
        maxBudget,
      );
      const newBudget = Math.min(
        startArea +
          Math.floor((core.playTimeMs ?? 0) / intervalMs) * perTime +
          bonus,
        maxBudget,
      );
      if (newBudget > prevBudget) {
        const gained = newBudget - prevBudget;
        tell(player, t("jm_at.claims.budget_gained", gained));
      }
    }
    // Apply playtime rank thresholds.
    checkPlaytimeRank(player, core, cfg);
    // Track horizontal travel unless this snapshot follows a teleport.
    if (teleportedPlayers.has(player.id)) {
      teleportedPlayers.delete(player.id);
    } else if (core.lastPos && prevSeen > 0) {
      const dx = loc.x - core.lastPos.x;
      const dz = loc.z - core.lastPos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > 0.5) {
        // Ignore micro-drift.
        core.statBlocksTraveled =
          (core.statBlocksTraveled ?? 0) + Math.round(dist);
      }
    }
    // Persist role for offline staff profiles and migrate old overrides.
    core.role = isOwner(player)
      ? "owner"
      : isAdmin(player).ok
        ? "admin"
        : isModerator(player)
          ? "moderator"
          : "";
    migrateLegacyOverrides(player);
    core.lastDim = player.dimension?.id ?? "overworld";
    core.lastPos = {
      x: Math.round(loc.x),
      y: Math.round(loc.y),
      z: Math.round(loc.z),
    };
    // Preserve the last live inventory snapshot through death.
    const health = player.getComponent("minecraft:health");
    if (!health || health.currentValue > 0) {
      core.lastHadTicketItem = hasItem(player, ITEMS.ticketMenu);
      core.lastHadAdminTool = hasItem(player, ITEMS.adminTool);
    }
    // Flush in-memory block stats.
    const bs = blockStats.get(player.id);
    if (bs) {
      core.statBlocksMined = (core.statBlocksMined ?? 0) + bs.mined;
      core.statBlocksPlaced = (core.statBlocksPlaced ?? 0) + bs.placed;
      blockStats.delete(player.id);
    }
    setPlayerCore(player, core);
  } catch (e) {
    silentCatch("snapshot_player", e);
  }
  // Keep registry writes independent from stats/location failures.
  try {
    if (core) upsertRegistryEntry(player, core);
  } catch (e) {
    silentCatch("snapshot_registry", e);
  }
  // Mirror tracked stats into their leaderboard objectives (only the ones a
  // stat-leaderboard hologram has actually created — no-op otherwise).
  try {
    if (core) syncPlayerStats(player, core);
  } catch (e) {
    silentCatch("snapshot_stat_sync", e);
  }
}

// =========================================================
