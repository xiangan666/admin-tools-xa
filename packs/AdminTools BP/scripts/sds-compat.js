/**
 * sds-compat.js — Compatibility hook for "Simple Diamond Chest Shops" (SDS) v2.9+.
 *
 * SDS v2.9+ mirrors every shop location into a world scoreboard objective
 * named "sds_shops". Scoreboards are world-scoped (unlike dynamic properties,
 * which are pack-UUID-scoped), so Admin Tools can read this objective to
 * detect shop chests and skip claim container-interact protection on them.
 *
 * Objective  : "sds_shops"
 * Participant: one fake player per shop, named "<dimensionId>|<x>,<y>,<z>"
 *              with floored integer coords, e.g. "minecraft:overworld|12,64,-8"
 * Score      : 1 (presence is the signal; the value is not used)
 *
 * Double chests: SDS registers a double-chest shop under only ONE of its two
 * halves. isSdsShop() therefore checks the clicked block AND its horizontal
 * neighbor chests so either half resolves correctly.
 */

import { world } from "@minecraft/server";
import { silentCatch } from "./utils.js";

const OBJECTIVE_ID = "sds_shops";
const CACHE_MS = 2000;

let _cache = null;        // Set<string> of shop keys
let _cacheStamp = 0;

function refresh() {
  const next = new Set();
  try {
    const obj = world.scoreboard.getObjective(OBJECTIVE_ID);
    if (obj) {
      for (const id of obj.getParticipants()) {
        const name = id?.displayName;
        if (typeof name === "string" && name.length > 0) next.add(name);
      }
    }
  } catch (e) {
    silentCatch("sds_compat_refresh", e);
  }
  _cache = next;
  _cacheStamp = Date.now();
}

function shopKeys() {
  if (!_cache || Date.now() - _cacheStamp > CACHE_MS) {
    try { refresh(); }
    catch (e) { silentCatch("sds_compat_keys", e); _cache = _cache ?? new Set(); }
  }
  return _cache;
}

/** Build "<dimid>|<x>,<y>,<z>" from a dimension id and a location. */
function keyFor(dimensionId, loc) {
  return `${dimensionId}|${Math.floor(loc.x)},${Math.floor(loc.y)},${Math.floor(loc.z)}`;
}

/**
 * True if the given block is a registered SDS chest shop (single or double).
 * @param {import("@minecraft/server").Block} block  the clicked block
 * @returns {boolean}
 */
export function isSdsShop(block) {
  if (!block || block.typeId !== "minecraft:chest") return false;
  const keys = shopKeys();
  if (keys.size === 0) return false;

  const dimId = block.dimension.id;
  const loc = block.location;

  // Direct hit: single chest, or the canonical half of a double chest.
  if (keys.has(keyFor(dimId, loc))) return true;

  // Double chest: the shop may be registered under the OTHER half.
  // Check the four horizontal neighbors; a neighboring chest whose key
  // is a registered shop means this block is part of that shop.
  const x = Math.floor(loc.x);
  const y = Math.floor(loc.y);
  const z = Math.floor(loc.z);
  const neighbors = [
    { x: x + 1, y, z },
    { x: x - 1, y, z },
    { x, y, z: z + 1 },
    { x, y, z: z - 1 },
  ];
  for (const n of neighbors) {
    let nb;
    try { nb = block.dimension.getBlock(n); } catch { nb = undefined; }
    if (!nb || nb.typeId !== "minecraft:chest") continue;
    if (keys.has(keyFor(dimId, n))) return true;
  }
  return false;
}

/** Force a fresh scoreboard read on next call. Optional. */
export function invalidateSdsShopCache() {
  _cache = null;
  _cacheStamp = 0;
}
