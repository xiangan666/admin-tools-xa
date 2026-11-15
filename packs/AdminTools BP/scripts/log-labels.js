/** Display labels only: persisted action codes and filter values never change. */
import { t } from "./i18n.js";

export const LOG_ACTIONS = Object.freeze([
  "ADMIN_ASSIGN", "ADMIN_OVERRIDES", "ADMIN_PRIVILEGES_UPDATE", "ADMIN_REMOVE",
  "APPEAL_ACCEPT", "APPEAL_DENY", "BAN", "BANNED_ITEM_ADD", "BANNED_ITEM_DETECTED",
  "BANNED_ITEM_REMOVE", "BONUS_PLAYTIME", "BROADCAST", "BULK_RANK_ASSIGN",
  "CATEGORY_ADD", "CATEGORY_REMOVE", "CLAIM_NOTIFS", "CLEAR_INV", "CLEAR_ITEMS",
  "CMD_ADD", "CMD_EDIT", "CMD_PRESET_ADD", "CMD_PRESET_EDIT", "CMD_PRESET_REMOVE",
  "CMD_PRESET_RUN", "CMD_REMOVE", "CMD_RUN", "CMD_STOP", "DEATHBACK", "DIM_LOCK",
  "DIM_LOCK_SCHED", "DIM_UNLOCK_SCHED", "DIM_LOCK_CANCEL", "DIM_UNLOCK_CANCEL",
  "DIFFICULTY", "FEED", "FORCE_REMOVE_MOD", "FORCE_UNFREEZE", "FREEZE", "GAMEMODE",
  "GAME_RULE", "HEAL", "HOME_DELETE", "HOME_SET", "HOME_UPDATE", "ITEM_ALERT",
  "ITEM_WATCH_ADD", "ITEM_WATCH_REMOVE", "KICK", "KIT_EVENT_CLAIM", "KIT_EVENT_GIVE",
  "LOG_CLEAR", "LOG_SETTINGS", "MENU_VIS_RESET", "MENU_VIS_UPDATE", "MOB_WHITELIST_ADD",
  "MOB_WHITELIST_REMOVE", "MOD_ASSIGN", "MOD_OVERRIDES", "MOD_PRIVILEGES_UPDATE",
  "MOD_REMOVE", "NAME_CHANGE", "NOTE_ADD", "NOTE_DELETE", "NOTE_EDIT", "OWNER_CLAIM",
  "OWNER_RESET", "OWNER_TRANSFER", "PLAYER_SETTINGS", "PLAYTIME_RANKS_OVERRIDE",
  "PLAYTIME_RANKS_TOGGLE", "PLAYTIME_RANK_ADD", "PLAYTIME_RANK_EDIT", "PLAYTIME_RANK_REMOVE",
  "PVP_KILL", "RANK_BULK_REMOVE", "RANK_DB_ADD", "RANK_DB_EDIT", "RANK_DB_REMOVE",
  "RANK_REMOVE", "RANK_SET", "RANK_TOGGLE", "REMOVE_ITEM", "SCHED_BC_ADD", "SCHED_BC_EDIT",
  "SCHED_BC_REMOVE", "SCHED_BC_TOGGLE", "SERVER_LOCK", "SESSION_LOG_CLEAR", "SPY_START",
  "SPY_STOP", "STAFF_RANK_SETTINGS", "STAFF_TAG_DETECTED", "STAFF_TAG_MODE", "STRESS_TEST",
  "SUMMON", "SUPPORT_GRANT", "SUPPORT_REVOKE", "SUPPORT_SELF_ADMIN", "TAKE_ITEM",
  "TICKETS_PURGE", "TICKET_CLAIM", "TICKET_CLOSE", "TICKET_DELETE", "TICKET_REPLY",
  "TICKET_RESOLVE", "TICKET_SETTINGS", "TICKET_SUBMIT", "TICKET_UNCLAIM", "TIME_SET",
  "TPA_ACCEPT", "TPA_DECLINE", "TPA_SEND", "TP_LOC", "TP_TO", "TP_TO_WARP", "UNBAN",
  "UNFREEZE", "WARN", "WARN_CLEAR", "WARPS_VISIBILITY", "WARP_ACCESS", "WARP_ADD",
  "WARP_PIN", "WARP_REMOVE", "WARP_REORDER", "WARP_USE", "WEATHER", "WHITELIST_ADD",
  "WHITELIST_AUTO_ADD_SUPPORT", "WHITELIST_MODE", "WHITELIST_REMOVE", "WHITELIST_RESET",
  "WHITELIST_TOGGLE", "WORLDSPAWN_SET", "WORLDSPAWN_TP", "adjust_height", "create",
  "delete_admin", "delete_owner", "expand", "extend", "member_add", "member_expire",
  "member_remove", "member_update", "resetAllClaims", "resetData", "resetPlayerClaims",
  "resetPlayerData", "resetToDefaults", "subclaim_create", "subclaim_delete", "transfer",
  "trust_add", "trust_expire", "trust_remove", "trust_update",
]);
const knownActions = new Set(LOG_ACTIONS);

export function logActionLabel(action) {
  return knownActions.has(action) ? t(`jm_at.log.action.${action}`) : { text: String(action ?? "") };
}

/** Storage identifiers are translated only at display. */
const areaKeys = new Set(["tickets", "claims", "logPages", "registry", "registryMeta", "config", "claimsMeta", "ticketMeta"]);
export function storageAreaLabel(area) {
  if (areaKeys.has(area)) return t(`jm_at.storage.area.${area}`);
  const page = /^(regPage|claimsPage)(\d+)$/.exec(area);
  return page ? t(`jm_at.storage.area.${page[1]}`, Number(page[2]) + 1) : { text: String(area ?? "") };
}
