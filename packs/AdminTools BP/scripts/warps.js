/**
 * Server warp storage and access checks.
 * Players use warps from Player Menu > Warps.
 * Staff manage them from Control Panel > Warps Admin.
 */

import { NS } from "./constants.js";
import { getWorldStr, setWorldStr } from "./storage.js";
import { silentCatch, genId } from "./utils.js";
import { validDestinationName } from "./home-record.js";
import { isAdmin, isStaff } from "./permissions.js";

const WARPS_KEY = `${NS}:warps`;
const MAX_WARPS = 50;

/** Warps per picker page. */
export const WARPS_PER_PAGE = 25;

/** Keep stored coordinates compact. */
function roundCoord(n) {
  return Math.round(n * 100) / 100;
}

/** Warp access tiers, least to most restrictive. */
export const WARP_ACCESS = { PUBLIC: "public", STAFF: "staff", ADMIN: "admin" };

/** Resolve access tier, including old `staffOnly` warps. */
export function getWarpAccess(warp) {
  if (warp?.access === "admin") return "admin";
  if (warp?.access === "staff" || warp?.staffOnly) return "staff";
  return "public";
}

/** True when this player can see/use the warp. */
export function canAccessWarp(player, warp) {
  const access = getWarpAccess(warp);
  if (access === "admin") return isAdmin(player).ok;
  if (access === "staff") return isStaff(player);
  return true;
}

export function getWarps() {
  try {
    const raw = getWorldStr(WARPS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { silentCatch("warps_getWarps", e); }
  return {};
}

export function setWarps(warps) {
  // False means the save was refused or failed.
  return setWorldStr(WARPS_KEY, JSON.stringify(warps));
}

export function addWarp(name, player, access = WARP_ACCESS.PUBLIC) {
  const warps = getWarps();
  if (!validDestinationName(name) || Object.prototype.hasOwnProperty.call(warps, name)) return false;
  if (Object.keys(warps).length >= MAX_WARPS) return false;
  warps[name] = {
    destinationId: genId("XAW"),
    x: roundCoord(player.location.x),
    y: roundCoord(player.location.y),
    z: roundCoord(player.location.z),
    dimension: player.dimension.id,
    access,
    // Keep the old flag synced for older readers.
    staffOnly: access !== WARP_ACCESS.PUBLIC,
  };
  return setWarps(warps);
}

export function setWarpAccess(name, access) {
  const warps = getWarps();
  if (!warps[name]) return false;
  warps[name].access = access;
  warps[name].staffOnly = access !== WARP_ACCESS.PUBLIC;
  setWarps(warps);
  return true;
}

export function removeWarp(name) {
  const warps = getWarps();
  if (!warps[name]) return false;
  delete warps[name];
  normalizeWarpOrder(warps);
  setWarps(warps);
  return true;
}

// =========================================================
// Sorting & pinning
// =========================================================

/** Re-index pinned warps in place. */
function normalizeWarpOrder(warps) {
  const pinned = Object.keys(warps)
    .filter((n) => warps[n].pinned)
    .sort((a, b) => (warps[a].order ?? 0) - (warps[b].order ?? 0));
  for (let i = 0; i < pinned.length; i++) warps[pinned[i]].order = i;
  return warps;
}

/** Sort pinned warps first, then unpinned alphabetically. */
export function getSortedWarpNames(warps) {
  return Object.keys(warps).sort((a, b) => {
    const wa = warps[a], wb = warps[b];
    const pa = wa.pinned ? 0 : 1;
    const pb = wb.pinned ? 0 : 1;
    if (pa !== pb) return pa - pb;
    if (pa === 0) return (wa.order ?? 0) - (wb.order ?? 0);
    return a.localeCompare(b);
  });
}

/** Pin or unpin a warp; new pins go to the bottom. */
export function setWarpPinned(name, pinned) {
  const warps = getWarps();
  if (!warps[name]) return false;
  if (pinned) {
    const maxOrder = Object.values(warps)
      .filter((w) => w.pinned)
      .reduce((m, w) => Math.max(m, w.order ?? 0), -1);
    warps[name].pinned = true;
    warps[name].order = maxOrder + 1;
  } else {
    warps[name].pinned = false;
    delete warps[name].order;
    normalizeWarpOrder(warps);
  }
  setWarps(warps);
  return true;
}

/** Move a pinned warp up or down; false at the edge. */
export function moveWarp(name, direction) {
  const warps = getWarps();
  if (!warps[name]?.pinned) return false;
  const pinned = Object.keys(warps)
    .filter((n) => warps[n].pinned)
    .sort((a, b) => (warps[a].order ?? 0) - (warps[b].order ?? 0));
  const idx = pinned.indexOf(name);
  const swapIdx = idx + direction;
  if (swapIdx < 0 || swapIdx >= pinned.length) return false;
  const other = pinned[swapIdx];
  const tmp = warps[name].order;
  warps[name].order = warps[other].order;
  warps[other].order = tmp;
  setWarps(warps);
  return true;
}

export const MAX_WARPS_LIMIT = MAX_WARPS;
