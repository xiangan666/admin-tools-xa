/**
 * log.js — Admin and player action logging
 *
 * Storage is a ring of up to LIMITS.LOG_PAGES dynamic-property pages holding
 * LIMITS.LOGS_PER_PAGE entries each. Meta {pagesUsed, head} tracks the ring:
 * head is the physical index of the OLDEST page, the newest (tail) page is
 * (head + pagesUsed - 1) % LOG_PAGES. Worlds saved before the ring buffer lack
 * `head`; their oldest page was always physical 0, so `?? 0` reads them
 * unchanged.
 */

import { LIMITS } from "./constants.js";
import { nowMs, clampText, getPlayerXuid } from "./utils.js";
import {
  getCfg,
  getLogMeta,
  setLogMeta,
  loadLogPage,
  saveLogPage,
} from "./storage.js";

// ---------------------------------------------------------
// Optional log categories (Log Settings)
// ---------------------------------------------------------
// Maps are per source because the same action name can be an ignorable player
// event AND an audit-critical admin event — HOME_DELETE is a player deleting
// their own home (logPlayer) but also an admin deleting someone else's
// (logAdmin). Any (source, action) pair NOT mapped here is ALWAYS logged:
// audit actions and future/unknown actions fail safe to "recorded".

const PLAYER_LOG_CATEGORY = {
  HOME_SET: "playerActivity",
  HOME_DELETE: "playerActivity",
  HOME_UPDATE: "playerActivity",
  WARP_USE: "playerActivity",
  DEATHBACK: "playerActivity",
  TPA_SEND: "playerActivity",
  TPA_ACCEPT: "playerActivity",
  TPA_DECLINE: "playerActivity",
  TICKET_SUBMIT: "playerActivity",
  KIT_EVENT_GIVE: "playerActivity",
  KIT_EVENT_CLAIM: "playerActivity",
  PVP_KILL: "pvpKills",
};

const SYSTEM_LOG_CATEGORY = {
  // BANNED_ITEM_DETECTED intentionally absent — contraband possession is an
  // audit event and always logs.
  ITEM_ALERT: "itemAlerts",
};

const ADMIN_LOG_CATEGORY = {
  // Staff ticket workflow. TICKET_DELETE / TICKETS_PURGE are destructive and
  // intentionally absent (always logged).
  TICKET_CLAIM: "ticketWorkflow",
  TICKET_UNCLAIM: "ticketWorkflow",
  TICKET_RESOLVE: "ticketWorkflow",
  TICKET_CLOSE: "ticketWorkflow",
  TICKET_REPLY: "ticketWorkflow",
  // Admin config & world-settings edits.
  BROADCAST: "configChanges",
  SCHED_BC_ADD: "configChanges",
  SCHED_BC_EDIT: "configChanges",
  SCHED_BC_TOGGLE: "configChanges",
  SCHED_BC_REMOVE: "configChanges",
  CATEGORY_ADD: "configChanges",
  CATEGORY_REMOVE: "configChanges",
  TICKET_SETTINGS: "configChanges",
  // WORLDSPAWN_SET is the setworldspawn edit; WORLDSPAWN_TP (teleport to
  // spawn) stays unmapped like the other admin teleports (TP_TO, TP_LOC, …).
  WORLDSPAWN_SET: "configChanges",
  GAME_RULE: "configChanges",
  WEATHER: "configChanges",
  TIME_SET: "configChanges",
  DIFFICULTY: "configChanges",
  DIM_LOCK: "configChanges",
  DIM_LOCK_SCHED: "configChanges",
  DIM_UNLOCK_SCHED: "configChanges",
  DIM_LOCK_CANCEL: "configChanges",
  DIM_UNLOCK_CANCEL: "configChanges",
  WARP_ADD: "configChanges",
  WARP_REMOVE: "configChanges",
  WARP_ACCESS: "configChanges",
  WARP_PIN: "configChanges",
  WARP_REORDER: "configChanges",
  WARPS_VISIBILITY: "configChanges",
  ITEM_WATCH_ADD: "configChanges",
  ITEM_WATCH_REMOVE: "configChanges",
  BANNED_ITEM_ADD: "configChanges",
  BANNED_ITEM_REMOVE: "configChanges",
  MENU_VIS_UPDATE: "configChanges",
  MENU_VIS_RESET: "configChanges",
  PLAYER_SETTINGS: "configChanges",
  CLAIM_NOTIFS: "configChanges",
};

const CATEGORY_CFG_KEY = {
  playerActivity: "logPlayerActivity",
  pvpKills: "logPvpKills",
  itemAlerts: "logItemAlerts",
  ticketWorkflow: "logTicketWorkflow",
  configChanges: "logConfigChanges",
};

function shouldLog(entry) {
  const map =
    entry.source === "player"
      ? PLAYER_LOG_CATEGORY
      : entry.source === "system"
        ? SYSTEM_LOG_CATEGORY
        : ADMIN_LOG_CATEGORY;
  const cat = map[entry.action];
  if (!cat) return true;
  return getCfg()[CATEGORY_CFG_KEY[cat]] !== false;
}

// ---------------------------------------------------------
// Retention
// ---------------------------------------------------------

/** Effective ring size in pages from cfg.logMaxEntries (default = all pages). */
export function getLogMaxPages() {
  const max =
    getCfg().logMaxEntries ?? LIMITS.LOG_PAGES * LIMITS.LOGS_PER_PAGE;
  return Math.min(
    LIMITS.LOG_PAGES,
    Math.max(1, Math.round(max / LIMITS.LOGS_PER_PAGE)),
  );
}

/**
 * Drop oldest pages until the ring fits the retention cap. Run on startup and
 * after a Log Settings save; a no-op when already within the limit. Returns
 * the number of entries removed.
 */
export function pruneLogToLimit() {
  const maxPages = getLogMaxPages();
  const meta = getLogMeta();
  let head = meta.head ?? 0;
  let pagesUsed = meta.pagesUsed ?? 0;
  if (pagesUsed <= maxPages) return 0;
  let pruned = 0;
  while (pagesUsed > maxPages) {
    pruned += loadLogPage(head).length;
    saveLogPage(head, []); // the "[]" write frees the property's bytes
    head = (head + 1) % LIMITS.LOG_PAGES;
    pagesUsed--;
  }
  setLogMeta({ pagesUsed, head });
  return pruned;
}

// ---------------------------------------------------------
// Write path
// ---------------------------------------------------------

function writeLogEntry(entry) {
  if (!shouldLog(entry)) return;
  const meta = getLogMeta();
  const prevHead = meta.head ?? 0;
  const prevPages = meta.pagesUsed ?? 0;
  let head = prevHead;
  let pagesUsed = prevPages;
  if (pagesUsed === 0) {
    head = 0;
    pagesUsed = 1;
  }
  let tail = (head + pagesUsed - 1) % LIMITS.LOG_PAGES;
  let page = loadLogPage(tail);
  if (page.length >= LIMITS.LOGS_PER_PAGE) {
    if (pagesUsed >= getLogMaxPages()) {
      // O(1) ring eviction: drop the oldest page, advance head. At the full
      // 20-page cap the evicted slot IS the new tail (overwritten below); at a
      // lower cap the new tail is the next free slot and the evicted one is
      // cleared explicitly.
      const oldHead = head;
      head = (oldHead + 1) % LIMITS.LOG_PAGES;
      tail = (oldHead + pagesUsed) % LIMITS.LOG_PAGES;
      if (tail !== oldHead) saveLogPage(oldHead, []);
    } else {
      pagesUsed++;
      tail = (head + pagesUsed - 1) % LIMITS.LOG_PAGES;
    }
    page = [];
  }
  page.push(entry);
  saveLogPage(tail, page);
  if (head !== prevHead || pagesUsed !== prevPages) {
    setLogMeta({ pagesUsed, head });
  }
}

export function logAdmin(byPlayer, action, detail = "", targetName = "") {
  writeLogEntry({
    source: "admin",
    at: nowMs(),
    byXuid: getPlayerXuid(byPlayer),
    byName: byPlayer.name,
    action,
    detail: clampText(detail, 120),
    targetName: targetName ?? "",
  });
}

export function logPlayer(byPlayer, action, detail = "") {
  writeLogEntry({
    source: "player",
    at: nowMs(),
    byXuid: getPlayerXuid(byPlayer),
    byName: byPlayer.name,
    action,
    detail: clampText(detail, 120),
    targetName: "",
  });
}

export function logSystem(action, detail = "", targetName = "") {
  writeLogEntry({
    source: "system",
    at: nowMs(),
    byXuid: "",
    byName: "System",
    action,
    detail: clampText(detail, 120),
    targetName: targetName ?? "",
  });
}
