/**
 * Per-player home storage.
 * Players manage homes from Player Menu > Homes.
 * Staff set the global home limit from the Control Panel.
 */

import { world } from "@minecraft/server";
import { NS } from "./constants.js";
import {
  getCfg,
  getWorldStr,
  setWorldStr,
  getRegistryEntry,
  mutateRegistryEntry,
} from "./storage.js";
import { silentCatch, getPlayerXuid } from "./utils.js";

const HOMES_KEY = `${NS}:homes`;
const pendingEditsKey = (xuid) => `${NS}:xa_home_edits_${xuid}`;

function readPendingHomeEdits(xuid) {
  const text = getWorldStr(pendingEditsKey(xuid));
  if (!text) return [];
  const edits = JSON.parse(text);
  if (!Array.isArray(edits) || edits.some(edit => !edit || typeof edit.name !== "string" || typeof edit.generation !== "string" || !edit.patch || typeof edit.patch !== "object")) {
    throw new Error("管理员家园修改队列无效，请联系管理员核查。");
  }
  return edits;
}

function withPendingHomeEdits(homes, edits) {
  const next = { ...homes };
  for (const edit of edits) {
    if (!Object.prototype.hasOwnProperty.call(next, edit.name) || generationOf(next[edit.name]) !== edit.generation) continue;
    const patch = {};
    if (edit.patch.rules !== undefined) patch.rules = edit.patch.rules;
    if (typeof edit.patch.teleportEnabled === "boolean") patch.teleportEnabled = edit.patch.teleportEnabled;
    next[edit.name] = { ...next[edit.name], ...patch };
  }
  return next;
}

export function getHomes(player) {
  try {
    const raw = player.getDynamicProperty(HOMES_KEY);
    if (typeof raw === "string" && raw) return withPendingHomeEdits(JSON.parse(raw), readPendingHomeEdits(getPlayerXuid(player)));
  } catch (e) { silentCatch("homes_getHomes", e); }
  return {};
}

export function setHomes(player, homes) {
  try {
    const xuid = getPlayerXuid(player);
    const edits = readPendingHomeEdits(xuid);
    const next = withPendingHomeEdits(homes, edits);
    player.setDynamicProperty(HOMES_KEY, JSON.stringify(next));
    // Mirror by XUID so staff can view homes while the player is offline.
    try {
      setWorldStr(`${NS}:phomes_${xuid}`, JSON.stringify(next));
    } catch (e) { silentCatch("homes_mirror", e); }
    if (edits.length && !setWorldStr(pendingEditsKey(xuid), "[]")) return false;
    return true;
  } catch (e) { silentCatch("homes_setHomes", e); }
  return false;
}

/** Read homes from the offline XUID mirror. */
export function getOfflineHomes(xuid) {
  try {
    const raw = getWorldStr(`${NS}:phomes_${xuid}`);
    if (typeof raw === "string" && raw) return withPendingHomeEdits(JSON.parse(raw), readPendingHomeEdits(xuid));
  } catch (e) { silentCatch("homes_getOfflineHomes", e); }
  return {};
}

/** Overwrite the offline XUID mirror directly (no live player object needed). */
export function setOfflineHomes(xuid, homes) {
  try {
    return setWorldStr(`${NS}:phomes_${xuid}`, JSON.stringify(homes ?? {}));
  } catch (e) { silentCatch("homes_setOfflineHomes", e); }
  return false;
}

/** Internal storage adapter; the administrator service validates authority and patch fields. */
export function patchHomeSettings(xuid, homeName, expectedGeneration, patch) {
  const online = world.getPlayers().find(player => getPlayerXuid(player) === xuid);
  // Flush a queued offline edit before a newer online admin change. Otherwise
  // setHomes would overlay the older queue on top of the just-submitted patch.
  if (online && !applyPendingHomeEdits(online)) return false;
  const homes = online ? getHomes(online) : getOfflineHomes(xuid);
  if (!Object.prototype.hasOwnProperty.call(homes, homeName) || generationOf(homes[homeName]) !== expectedGeneration) return false;
  if (online) {
    homes[homeName] = { ...homes[homeName], ...patch };
    return setHomes(online, homes);
  }
  // One durable queue is authoritative while offline; reads overlay it immediately.
  // Do not rely on a mirror-only edit which the old player property would overwrite on join.
  const pending = readPendingHomeEdits(xuid);
  const prior = pending.find(edit => edit.name === homeName && edit.generation === expectedGeneration);
  const edits = pending.filter(edit => edit.name !== homeName);
  edits.push({ name: homeName, generation: expectedGeneration, patch: { ...prior?.patch, ...patch } });
  if (edits.length > 160) throw new Error("离线家园修改已达上限，请等待玩家上线或清理旧记录。");
  return setWorldStr(pendingEditsKey(xuid), JSON.stringify(edits));
}

/** Apply only matching generations before the first login snapshot. Failed writes retain the queue. */
export function applyPendingHomeEdits(player) {
  try {
    if (!readPendingHomeEdits(getPlayerXuid(player)).length) return true;
    // Parse strictly here: a read error must never turn into an empty write that clears the queue.
    const raw = player.getDynamicProperty(HOMES_KEY);
    const homes = typeof raw === "string" && raw ? JSON.parse(raw) : {};
    if (!homes || typeof homes !== "object" || Array.isArray(homes)) throw new Error("玩家家园存档格式无效。");
    return setHomes(player, homes);
  } catch (error) { silentCatch("homes_pending_edits", error); return false; }
}

const pendingDeletesKey = (xuid) => `${NS}:xa_home_deletes_${xuid}`;
const generationOf = (home) => home?.destinationId || "legacy";

function readPendingDeletes(xuid) {
  const raw = getWorldStr(pendingDeletesKey(xuid));
  if (!raw) return [];
  const pending = JSON.parse(raw);
  if (!Array.isArray(pending)) throw new Error("待处理的家园删除队列格式无效");
  return pending;
}

/** Resolve online state again at confirmation time and delete only this generation. */
export function deleteOfflineHome(xuid, homeName, expectedGeneration) {
  try {
    const online = world.getPlayers().find((player) => getPlayerXuid(player) === xuid);
    const homes = online ? getHomes(online) : getOfflineHomes(xuid);
    if (!Object.prototype.hasOwnProperty.call(homes, homeName)) return false;
    const generation = generationOf(homes[homeName]);
    if (expectedGeneration !== undefined && generation !== expectedGeneration) return false;
    const original = { ...homes };
    delete homes[homeName];
    if (online) return setHomes(online, homes);

    // A dedicated property has reliable write status, unlike legacy registry
    // mutation. Every new entry carries its generation to protect recreated homes.
    const pending = readPendingDeletes(xuid).filter((entry) => entry?.name !== homeName);
    pending.push({ name: homeName, generation });
    if (!setOfflineHomes(xuid, homes)) return false;
    if (!setWorldStr(pendingDeletesKey(xuid), JSON.stringify(pending))) {
      // Mirror and queue are separate properties. Restore the display snapshot
      // best-effort when queuing fails; never report the deletion as successful.
      setOfflineHomes(xuid, original);
      return false;
    }
    return true;
  } catch (e) { silentCatch("homes_deleteOfflineHome_queue", e); }
  return false;
}

/**
 * Apply home deletions queued (deleteOfflineHome) while the player was offline
 * to their live home store, then clear the queue. Call once on join, BEFORE the
 * first snapshot re-mirrors their store. Safe no-op when nothing is queued.
 */
export function applyPendingHomeDeletes(player) {
  try {
    const xuid = getPlayerXuid(player);
    const entry = getRegistryEntry(xuid);
    const legacy = Array.isArray(entry?.pendingHomeDeletes) ? entry.pendingHomeDeletes : [];
    const pending = readPendingDeletes(xuid);
    if (legacy.length === 0 && pending.length === 0) return true;
    const homes = getHomes(player);
    let changed = false;
    for (const queued of [...legacy, ...pending]) {
      // Strings are pre-upgrade entries and retain the original name-only behavior.
      const name = typeof queued === "string" ? queued : queued?.name;
      const matches = typeof queued === "string" ||
        (typeof queued?.generation === "string" && generationOf(homes[name]) === queued.generation);
      if (typeof name === "string" && Object.prototype.hasOwnProperty.call(homes, name) && matches) {
        delete homes[name];
        changed = true;
      }
    }
    if (changed && !setHomes(player, homes)) return false; // Retry later without losing the queue.
    if (pending.length && !setWorldStr(pendingDeletesKey(xuid), "[]")) return false;
    if (legacy.length) {
      const cleared = mutateRegistryEntry(xuid, (e) => { delete e.pendingHomeDeletes; });
      // Legacy mutateRegistryEntry only reports that an entry exists. Verify its
      // persisted result instead of mistaking a failed page write for success.
      if (!cleared || getRegistryEntry(xuid)?.pendingHomeDeletes?.length) return false;
    }
    return true;
  } catch (e) { silentCatch("homes_applyPendingHomeDeletes", e); }
  return false;
}

export function getMaxHomes() {
  const cfg = getCfg();
  return typeof cfg.maxHomes === "number" ? cfg.maxHomes : 3;
}

// labelKey is a lang key (see jm_at.homes.icon_* in the RP lang file).
// lang-keys: jm_at.homes.icon_*
export const HOME_ICONS = [
  { key: "jm_at_homes", labelKey: "jm_at.homes.icon_default" },
  { key: "jm_at_homes_blue", labelKey: "jm_at.homes.icon_blue" },
  { key: "jm_at_home_light_blue", labelKey: "jm_at.homes.icon_light_blue" },
  { key: "jm_at_homes_cyan", labelKey: "jm_at.homes.icon_cyan" },
  { key: "jm_at_homes_dark_green", labelKey: "jm_at.homes.icon_dark_green" },
  { key: "jm_at_homes_light_green", labelKey: "jm_at.homes.icon_light_green" },
  { key: "jm_at_homes_yellow", labelKey: "jm_at.homes.icon_yellow" },
  { key: "jm_at_homes_orange", labelKey: "jm_at.homes.icon_orange" },
  { key: "jm_at_homes_red", labelKey: "jm_at.homes.icon_red" },
  { key: "jm_at_homes_pink", labelKey: "jm_at.homes.icon_pink" },
  { key: "jm_at_homes_purple", labelKey: "jm_at.homes.icon_purple" },
];

export const DEFAULT_HOME_ICON = "jm_at_homes";

export function getHomeIconPath(home) {
  const icon = home?.icon || DEFAULT_HOME_ICON;
  return `textures/ui/${icon}`;
}
