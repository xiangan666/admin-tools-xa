import { logActionLabel } from "./log-labels.js";
/**
 * ui-admin.js — Admin panel, player management, profile, actions, control panel, log
 */

// Keys picked via ternaries (ban dialog variants, staff roles).
// lang-keys: jm_at.adm.ban_title_perm jm_at.adm.ban_title_temp jm_at.adm.ban_title_temp24 jm_at.adm.btn_ban_close jm_at.adm.btn_ban_plain jm_at.adm.btn_perm_ban_close jm_at.adm.btn_perm_ban_plain jm_at.adm.role_admin jm_at.adm.role_moderator
import {
  ActionFormData,
  ModalFormData,
  MessageFormData,
  CustomForm,
  ObservableString,
  ObservableNumber,
  ObservableBoolean,
  DataDrivenScreenClosedReason,
} from "@minecraft/server-ui";
import { showTravelRules } from "./ui-travel-rules.js";
import { visitHome } from "./ui-home-access.js";
import { validDestinationName } from "./home-record.js";
import { showHomeAdministration } from "./ui-home-admin.js";
import { world, system, EquipmentSlot } from "@minecraft/server";
import { NS, VER, LIMITS, GAMEMODES, ITEMS, PKEY } from "./constants.js";
import {
  tell,
  warnForm,
  confirmDiscardChanges,
  broadcastAdmins,
  broadcastAll,
  fmtMs,
  fmtAgo,
  fmtDim,
  fmtDuration,
  fmtDurationExact,
  fmtMsRaw,
  fmtAgoRaw,
  fmtDurationRaw,
  fmtDimRaw,
  clampText,
  parseDuration,
  applyColorCodes,
  nowMs,
  getPlayerXuid,
  getOnlinePlayerByName,
  genId,
  CLOSE_BTN_LABEL,
  CLOSE_BTN_ICON,
  silentCatch,
} from "./utils.js";
import { t, raw, itemName } from "./i18n.js";
import {
  getCfg,
  setCfg,
  mutateCfg,
  getTicketMeta,
  getAllLogEntries,
  getPlayerCore,
  setPlayerCore,
  queuePlayerNotif,
  getPlayerRegistry,
  setPlayerRegistry,
  getRegistryEntryByName,
  getAdminCmds,
  setAdminCmds,
  getCommandPresets,
  setCommandPresets,
  getSessionLog,
  clearSessionLog,
  clearAdminLog,
  mutatePlayerPunishments,
  mutatePlayerWarnAcks,
  retractStaffAlert,
  mutateRegistryEntry,
  getPlayerPunishments,
  getPlayerNotes,
  setPlayerNotes,
  getModOverrides,
  setModOverrides,
  getAdminOverrides,
  setAdminOverrides,
  setAdminDenied,
} from "./storage.js";
import {
  isAdmin,
  isModerator,
  isStaff,
  requireAdmin,
  requireAdminOrModCan,
  requireStaff,
  assignModerator,
  removeModerator,
  assignAdmin,
  clearStaffRole,
  isOwner,
  modCan,
  adminCan,
  MOD_PRIV_DEFAULT_ON,
  detectRankRole,
  isGamemodeCommand,
  isBlockedStaffCommand,
  requireOutranksTarget,
} from "./permissions.js";
import { logAdmin, pruneLogToLimit } from "./log.js";
import {
  getClaimsByOwner,
  refreshOwnerAdminFlag,
  releaseStrayOwnerOnlyClaims,
} from "./claims.js";
import {
  hasActivePunishment,
  clearInventory,
  ensureStarterItems,
  giveItem,
  teleportPlayer,
  teleportedPlayers,
  SPAWN_TA_POOL,
} from "./players.js";
import {
  doFreeze,
  doUnfreeze,
  doKick,
  doBan,
  doUnban,
  doWarn,
  doHeal,
  doFeed,
  doGamemode,
  doTpTo,
  doSummon,
  doTpToWarp,
  doTpToLoc,
  doUnbanOffline,
  doBanOffline,
} from "./moderation.js";
import { ensureKeepInventory, disableKeepInventory } from "./gravestones.js";
// Imported for panel search routing only (these features are otherwise reached
// via their in-world tool items). Used at call-time inside _getPanelSearchFn, so
// any import cycle resolves lazily.
import { showClaimsAdmin } from "./ui-claims-admin.js";
import { openKitManager } from "./ui-kits.js";
import {
  findTicket,
  purgeTicketIds,
  purgeClosedTickets,
  claimTicket,
  unclaimTicket,
} from "./tickets.js";
import { startSpy, stopSpy, isSpying } from "./spy.js";
import { handleSupportCommand } from "./support-access.js";
import { getEffectiveRankPrefix } from "./ranks.js";
import {
  getWarps,
  setWarps,
  addWarp,
  removeWarp,
  setWarpAccess,
  getWarpAccess,
  WARP_ACCESS,
  getSortedWarpNames,
  setWarpPinned,
  moveWarp,
  MAX_WARPS_LIMIT,
  WARPS_PER_PAGE,
} from "./warps.js";
import {
  getItemWatchCfg,
  setItemWatchCfg,
  getBanned,
  setBanned,
} from "./item-watch.js";
import {
  getRankDb,
  addRank,
  updateRank,
  removeRank,
  getRankNames,
} from "./rank-db.js";

import { showTicketDetail } from "./ui-tickets.js";
import {
  getHomes,
  setHomes,
  getHomeIconPath,
  getOfflineHomes,
  deleteOfflineHome,
} from "./homes.js";
import { getStorageHealth } from "./storage-health.js";
import { setIntentionalSpectator } from "./spectator-rescue.js";
import { showHologramRestore } from "./ui-holograms.js";
import {
  searchScore,
  findClosestKeyword,
  planResultView,
} from "./search-utils.js";
import { localizedIndex } from "./search-locale.js";
import { localizedResultRow } from "./search-display.js";
import { MENU_KEYS, MENU_BUTTON_META } from "./menu-keys.js";
import {
  isMenuButtonVisible,
  getCustomizableRowsForPlayer,
  getPromotedRowsForPlayer,
  getHiddenTopSet,
  setHiddenTopSet,
  getPromotedSet,
  setPromotedSet,
  resetPlayerMenuPrefs,
  isOwnerHidden,
  resetOwnerMenuVisibility,
} from "./menu-visibility.js";

// =========================================================
// Rank color helpers
// =========================================================

// `label` stays for string ops (dropdown fallback/ranking); `labelKey` is the
// translated display form used at render sites.
// lang-keys: jm_at.adm.color_*
const RANK_COLORS = [
  { label: "§0黑色", labelKey: "jm_at.adm.color_black", code: "§0" },
  { label: "§1深蓝色", labelKey: "jm_at.adm.color_dark_blue", code: "§1" },
  { label: "§2深绿色", labelKey: "jm_at.adm.color_dark_green", code: "§2" },
  { label: "§3深青色", labelKey: "jm_at.adm.color_dark_aqua", code: "§3" },
  { label: "§4深红色", labelKey: "jm_at.adm.color_dark_red", code: "§4" },
  {
    label: "§5深紫色",
    labelKey: "jm_at.adm.color_dark_purple",
    code: "§5",
  },
  { label: "§6金色", labelKey: "jm_at.adm.color_gold", code: "§6" },
  { label: "§7灰色", labelKey: "jm_at.adm.color_gray", code: "§7" },
  { label: "§8深灰色", labelKey: "jm_at.adm.color_dark_gray", code: "§8" },
  { label: "§9蓝色", labelKey: "jm_at.adm.color_blue", code: "§9" },
  { label: "§a绿色", labelKey: "jm_at.adm.color_green", code: "§a" },
  { label: "§b青色", labelKey: "jm_at.adm.color_aqua", code: "§b" },
  { label: "§c红色", labelKey: "jm_at.adm.color_red", code: "§c" },
  {
    label: "§d浅紫色",
    labelKey: "jm_at.adm.color_light_purple",
    code: "§d",
  },
  { label: "§e黄色", labelKey: "jm_at.adm.color_yellow", code: "§e" },
  { label: "§f白色", labelKey: "jm_at.adm.color_white", code: "§f" },
  {
    label: "§g金币金色",
    labelKey: "jm_at.adm.color_minecoin_gold",
    code: "§g",
  },
  {
    label: "§h石英色",
    labelKey: "jm_at.adm.color_material_quartz",
    code: "§h",
  },
  {
    label: "§i铁色",
    labelKey: "jm_at.adm.color_material_iron",
    code: "§i",
  },
  {
    label: "§j下界合金色",
    labelKey: "jm_at.adm.color_material_netherite",
    code: "§j",
  },
  {
    label: "§m红石色",
    labelKey: "jm_at.adm.color_material_redstone",
    code: "§m",
  },
  {
    label: "§n铜色",
    labelKey: "jm_at.adm.color_material_copper",
    code: "§n",
  },
  {
    label: "§p黄金色",
    labelKey: "jm_at.adm.color_material_gold",
    code: "§p",
  },
  {
    label: "§q绿宝石色",
    labelKey: "jm_at.adm.color_material_emerald",
    code: "§q",
  },
  {
    label: "§s钻石色",
    labelKey: "jm_at.adm.color_material_diamond",
    code: "§s",
  },
  {
    label: "§t青金石色",
    labelKey: "jm_at.adm.color_material_lapis",
    code: "§t",
  },
  {
    label: "§u紫水晶色",
    labelKey: "jm_at.adm.color_material_amethyst",
    code: "§u",
  },
  {
    label: "§v树脂色",
    labelKey: "jm_at.adm.color_material_resin",
    code: "§v",
  },
  { label: "无颜色（手动设置）", labelKey: "jm_at.adm.color_none", code: "" },
];
// Index of the "无颜色（手动设置）" entry — lets the admin type their own
// §-codes in the tag text instead of picking a single color. Used as the
// default for new ranks.
const RANK_COLOR_MANUAL_IDX = RANK_COLORS.findIndex((c) => c.code === "");

function buildRankTag(color, text) {
  if (!color) return text;
  return `${color}${text}§r`;
}

function detectRankColor(tag) {
  for (let i = 0; i < RANK_COLORS.length - 1; i++) {
    if (tag.startsWith(RANK_COLORS[i].code)) return i;
  }
  return RANK_COLORS.length - 1;
}

function stripColorCode(tag) {
  const match = tag.match(/^§[0-9a-ghi-jmnp-v](.*)§r$/);
  return match ? match[1] : tag;
}

// =========================================================
// Mod privilege helper (modCan is now imported from permissions.js)
// Per-staff override get/set are imported from storage.js — they're keyed by
// XUID and stored world-level so they can be edited while the staff member is
// offline.
// =========================================================

/**
 * Confirm with the acting admin that assigning a role-named rank will also grant
 * the corresponding staff role. Returns true if confirmed.
 */
async function confirmRankRoleGrant(admin, target, role) {
  const label = t(
    role === "admin" ? "jm_at.adm.role_admin" : "jm_at.adm.role_moderator",
  );
  const res = await new MessageFormData()
    .title(t("jm_at.adm.grant_role_title", label))
    .body(t("jm_at.adm.grant_role_body", label, target.name))
    .button1(t("jm_at.common.btn_cancel"))
    .button2(t("jm_at.adm.btn_grant_role", label))
    .show(admin);
  return !res.canceled && res.selection === 1;
}

/**
 * True if `actor` may grant or strip staff roles. This is the admin-only
 * `manageRoles` capability (or the owner) — the SAME gate the dedicated
 * Assign/Remove Admin & Moderator buttons use. The rank UIs that grant roles as
 * a side effect are gated only by rankPanel/rankManager, which are
 * mod-delegatable, so any role grant routed through a rank MUST re-check this
 * stronger capability here. Without it, a moderator (or an admin whose owner
 * turned Manage Roles OFF) could mint admins by assigning a rank named "Admin".
 */
function canManageRoles(actor) {
  return (
    isOwner(actor) || (isAdmin(actor).ok && adminCan(actor, "manageRoles"))
  );
}

/**
 * Grant the admin or moderator role to a target as a side effect of assigning a
 * role-named rank. Mirrors the manual Assign as Admin/Moderator actions (gives
 * the Admin Tool, logs, notifies the target). Returns true if granted, false if
 * the acting player isn't authorized to manage roles or the grant doesn't apply.
 */
function grantRoleFromRank(admin, target, role) {
  // Hard authorization gate — the rank callers are only rankPanel/rankManager
  // gated, so enforce the admin-only manageRoles capability here too.
  if (!canManageRoles(admin)) return false;
  if (role === "admin") {
    if (isOwner(target)) return false;
    if (isModerator(target)) removeModerator(target);
    setAdminDenied(getPlayerXuid(target), false); // lift any deny-list entry
    target.addTag("admin");
    assignAdmin(target); // record the private, un-spoofable admin role
    // Re-stamp ownerIsAdmin on this player's existing claims so the correct
    // bypass gate applies immediately, not only after they next rejoin.
    refreshOwnerAdminFlag(getPlayerXuid(target), true);
    logAdmin(admin, "ADMIN_ASSIGN", "（通过身份组设置）", target.name);
    tell(target, t("jm_at.adm.admin_granted"));
  } else if (role === "moderator") {
    if (isAdmin(target).ok) return false; // admins outrank moderators
    assignModerator(target);
    logAdmin(admin, "MOD_ASSIGN", "（通过身份组设置）", target.name);
    tell(target, t("jm_at.adm.mod_assigned_target"));
  } else {
    return false;
  }
  const core = getPlayerCore(target);
  if (!core.hasAdminTool && giveItem(target, ITEMS.adminTool)) {
    core.hasAdminTool = true;
    setPlayerCore(target, core);
    tell(target, t("jm_at.adm.admin_tool_received"));
  }
  return true;
}

// =========================================================
// Admin Panel Search
// =========================================================

// `label` stays English for the shared search engine (ranking/suggestions);
// `labelKey` is translated only at the display site (_panelResultButtonLabel).
// lang-keys: jm_at.adm.idx_*
const PANEL_SEARCH_INDEX = [
  {
    key: "tickets",
    label: "Tickets",
    labelKey: "jm_at.adm.idx_tickets",
    terms:
      "ticket tickets open claimed resolved closed submit report review reply claim resolve delete purge appeal appeals unclaim griefing harassment bug support help respond complaint",
    gate: "tickets",
    path: "Tickets",
  },
  {
    key: "players_online",
    label: "Online Players",
    labelKey: "jm_at.adm.idx_players_online",
    terms:
      "online players list who connected ban kick warn freeze heal feed gamemode inventory spy notes summon teleport frozen unban unfreeze admin moderator rank home vanish enderchest profile bring",
    gate: null,
    path: "Players",
  },
  {
    key: "players_offline",
    label: "Offline Players",
    labelKey: "jm_at.adm.idx_players_offline",
    terms:
      "offline players records history past ban unban bans punish punishment warn warnings seen inactive tickets notes appeals tempban permban profile",
    gate: null,
    path: "Players",
  },
  {
    key: "players_search",
    label: "Search Player",
    labelKey: "jm_at.adm.idx_players_search",
    terms:
      "search player find lookup name offline profile gamertag username whois",
    gate: null,
    path: "Players",
  },
  {
    key: "control_panel",
    label: "Control Panel",
    labelKey: "jm_at.adm.idx_control_panel",
    terms:
      "control panel settings configure admin options setup preferences manage dashboard",
    gate: [
      "serverControls",
      "ticketSettings",
      "dimensionLocks",
      "itemWatch",
      "configEditor",
    ],
    path: "Control Panel",
  },
  {
    key: "config_editor",
    label: "Config Editor",
    labelKey: "jm_at.adm.idx_config_editor",
    terms:
      "config editor homes tpa teleport deathback death afk idle warn threshold settings configure tools-on-death mount parrot vehicle gravestone gravestones grave graves headstone tombstone keepinventory keep inventory items on death loot drops kick respawn gamerule delay cooldown inactive away sethome corpse exempt safe zone safezone bubble hostile mobs monsters protect recover",
    gate: "configEditor",
    path: "Control Panel → Config Editor",
  },
  {
    key: "server_controls",
    label: "Server Controls",
    labelKey: "jm_at.adm.idx_server_controls",
    terms:
      "server lock unlock whitelist manage allowlist join close maintenance private",
    gate: "serverControls",
    path: "Control Panel → Server Controls",
  },
  {
    key: "whitelist",
    label: "Manage Whitelist",
    labelKey: "jm_at.adm.idx_whitelist",
    terms:
      "whitelist add remove manage player allow allowlist offline online access invite permit",
    gate: "serverControls",
    path: "Control Panel → Server Controls",
  },
  {
    key: "ticket_settings",
    label: "Ticket Settings",
    labelKey: "jm_at.adm.idx_ticket_settings",
    terms:
      "ticket settings cooldown limit categories auto delete open close ticketing visible hide player menu support warning helpdesk report purge submit enable rate",
    gate: "ticketSettings",
    path: "Control Panel → Ticket Settings",
  },
  {
    key: "categories",
    label: "Manage Categories",
    labelKey: "jm_at.adm.idx_categories",
    terms:
      "category categories add remove ticket type griefing harassment bug delete report spam reason edit create cheating hacking",
    gate: "ticketSettings",
    path: "Control Panel → Ticket Settings",
  },
  {
    key: "dimension_locks",
    label: "Dimension Locks",
    labelKey: "jm_at.adm.idx_dimension_locks",
    terms:
      "dimension lock unlock nether end schedule scheduled toggle portal disable enable close reopen access block restrict timer",
    gate: "dimensionLocks",
    path: "Control Panel → Dimension Locks",
  },
  {
    key: "item_watch",
    label: "Item Watch",
    labelKey: "jm_at.adm.idx_item_watch",
    terms:
      "item watch monitor banned tracked threshold alert auto remove log offline flagged detection history blacklist unban contraband illegal confiscate quantity amount limit inventory prohibited possess carry notify scan",
    gate: "itemWatch",
    path: "Control Panel → Item Watch",
  },
  {
    key: "item_watch_log",
    label: "Item Watch Log",
    labelKey: "jm_at.adm.idx_item_watch_log",
    terms:
      "item watch log detection alert history flagged offline events banned contraband illegal audit removed detected trigger violation",
    gate: "itemWatch",
    path: "Control Panel → Item Watch → Item Watch Log",
  },
  {
    key: "banned_items",
    label: "Banned Items",
    labelKey: "jm_at.adm.idx_banned_items",
    terms:
      "banned items add remove block contraband illegal blacklist confiscate unban prohibited forbidden restricted",
    gate: "itemWatch",
    path: "Control Panel → Item Watch",
  },
  {
    key: "tracked_items",
    label: "Tracked Items",
    labelKey: "jm_at.adm.idx_tracked_items",
    terms:
      "tracked items add remove threshold alert quantity monitor watch notify holding carrying amount limit detection inventory stack contraband",
    gate: "itemWatch",
    path: "Control Panel → Item Watch → Tracked Items",
  },
  {
    key: "storage_health",
    label: "Storage Health",
    labelKey: "jm_at.adm.idx_storage_health",
    terms:
      "storage health capacity monitor tickets claims logs registry usage size bytes limit quota property dynamic percent database disk space diagnostic full cleanup",
    gate: "admin",
    path: "Action Log & Reports",
  },
  {
    key: "restore_holograms",
    label: "Restore Holograms",
    labelKey: "jm_at.adm.idx_restore_holograms",
    terms:
      "restore holograms hologram recover despawn missing entity v2 versioning limit floating text respawn nametag display fix gone",
    gate: "admin",
    path: "Control Panel",
  },
  {
    key: "commands",
    label: "Commands",
    labelKey: "jm_at.adm.idx_commands",
    terms:
      "commands command run save custom admin execute repeat one-time cheats delay immediate macro schedule once quick timer interval loop auto trigger recurring stop",
    gate: ["commands", "gameCommands", "gameRules", "gamemode"],
    path: "Commands",
  },
  {
    key: "game_commands",
    label: "Game Commands",
    labelKey: "jm_at.adm.idx_game_commands",
    terms:
      "game commands gamemode weather clear rain thunder time day night noon midnight lock difficulty peaceful easy normal hard worldspawn world spawn setworldspawn go to spawn game rules gamerule keepinventory mobgriefing pvp coordinates immediate respawn mob spawning tnt fire tick clear dropped items survival creative adventure spectator storm teleport spawnpoint clearlag explosion explode showcoordinates instant",
    gate: ["gameCommands", "gameRules", "gamemode"],
    path: "Commands → Game Commands",
  },
  {
    key: "command_buttons",
    label: "Command Buttons",
    labelKey: "jm_at.adm.idx_command_buttons",
    terms:
      "command buttons preset presets custom one-tap shortcut shortcuts owner curated macro macros allowed run quick tap saved list delegate",
    gate: "commandButtons",
    path: "Commands → Command Buttons",
  },
  {
    key: "warps",
    label: "Warps",
    labelKey: "jm_at.adm.idx_warps",
    terms:
      "warp warps teleport point location staff admin visibility create remove pin pinned reorder delete hide sort mods public unpin goto",
    gate: "warps",
    path: "Warps",
  },
  {
    key: "broadcasts",
    label: "Broadcasts",
    labelKey: "jm_at.adm.idx_broadcasts",
    terms:
      "broadcast broadcasts announcement announce message send scheduled recurring interval repeat alert say pause resume timer notify motd color auto",
    gate: "broadcasts",
    path: "Broadcasts",
  },
  {
    key: "admin_log",
    label: "Admin Log",
    labelKey: "jm_at.adm.idx_admin_log",
    terms:
      "admin log hub action rollcall staff activity report audit track history moderation",
    gate: "adminLog",
    path: "Action Log & Reports",
  },
  {
    key: "action_log",
    label: "Action Log",
    labelKey: "jm_at.adm.idx_action_log",
    terms:
      "action log filter event history record pvp kill clear audit ban kick report warn freeze mod moderation source punishment",
    gate: "adminLog",
    path: "Action Log & Reports",
  },
  {
    key: "rollcall",
    label: "Rollcall",
    labelKey: "jm_at.adm.idx_rollcall",
    terms:
      "rollcall session join leave login logout online who connect disconnect left clear list",
    gate: "adminLog",
    path: "Action Log & Reports",
  },
  {
    key: "staff_activity",
    label: "Staff Activity",
    labelKey: "jm_at.adm.idx_staff_activity",
    terms:
      "staff activity actions summary admin moderator audit report log stats leaderboard history",
    gate: "adminLog",
    path: "Action Log & Reports",
  },
  {
    key: "log_settings",
    label: "Log Settings",
    labelKey: "jm_at.adm.idx_log_settings",
    terms:
      "log settings logging toggle toggles category categories retention prune limit max entries disable enable mute noise record recording history size storage reduce quiet verbose",
    gate: "admin",
    path: "Action Log & Reports",
  },
  {
    key: "rank_manager",
    label: "Rank Manager",
    labelKey: "jm_at.adm.idx_rank_manager",
    terms: "rank manager ranks database tag prefix demote group vip",
    gate: "rankManager",
    path: "Players → Rank Manager",
  },
  {
    key: "rank_database",
    label: "Rank Database",
    labelKey: "jm_at.adm.idx_rank_database",
    terms:
      "rank database add edit delete tag color nametag prefix remove role group create nameplate tier chat vip",
    gate: "rankManager",
    path: "Players → Rank Manager",
  },
  {
    key: "bulk_assign",
    label: "Bulk Assign Rank",
    labelKey: "jm_at.adm.idx_bulk_assign",
    terms:
      "bulk assign rank mass apply all players unranked promote set role permission grant give demote everyone",
    gate: "rankManager",
    path: "Players → Rank Manager",
  },
  {
    key: "bulk_remove",
    label: "Bulk Remove Rank",
    labelKey: "jm_at.adm.idx_bulk_remove",
    terms:
      "bulk remove rank clear strip mass tag demote role revoke purge wipe reset",
    gate: "rankManager",
    path: "Players → Rank Manager",
  },
  {
    key: "staff_rank_settings",
    label: "Staff Rank Settings",
    labelKey: "jm_at.adm.idx_staff_rank_settings",
    terms:
      "staff rank settings admin tag mod tag custom prefix color nametag moderator hide hidden title",
    gate: "rankManager",
    path: "Players → Rank Manager",
  },
  {
    key: "playtime_ranks",
    label: "Playtime Ranks",
    labelKey: "jm_at.adm.idx_playtime_ranks",
    terms:
      "playtime ranks automatic promotion threshold time bonus override promote manual tier credit hours veteran",
    gate: "rankManager",
    path: "Players → Rank Manager",
  },
  {
    key: "staff_permissions",
    label: "Staff & Permissions",
    labelKey: "jm_at.adm.idx_staff_permissions",
    terms:
      "staff permissions privileges roles mod admin gamemode access tag operator moderator ability assign promote grant demote",
    gate: "modPrivileges",
    path: "Control Panel → Staff & Permissions",
  },
  {
    key: "mod_privileges",
    label: "Mod Privileges",
    labelKey: "jm_at.adm.idx_mod_privileges",
    terms:
      "mod privileges moderator permissions toggle global override per-mod staff abilities grant allow freeze kick ban warn spy vanish inventory heal feed teleport summon claim bypass ticket warp kit broadcast rank command note home punish role",
    gate: "modPrivileges",
    path: "Control Panel → Staff & Permissions",
  },
  {
    key: "menu_visibility",
    label: "Menu Visibility",
    labelKey: "jm_at.adm.idx_menu_visibility",
    terms:
      "menu visibility hide show buttons features player admin tickets homes warps teleport deathback kits layout toggle enable disable commands broadcast permissions staff warnings owner reset customize",
    gate: ["configEditor", "ticketSettings", "warps"],
    path: "Control Panel → Menu Visibility",
  },
  {
    key: "admin_privileges",
    label: "Admin Privileges",
    labelKey: "jm_at.adm.idx_admin_privileges",
    terms:
      "admin privileges owner abilities permissions toggle global staff moderator restrict disable enable role access power grant revoke",
    gate: "owner",
    path: "Control Panel → Staff & Permissions",
  },
  {
    key: "gamemode_access",
    label: "Gamemode (Admin Privileges)",
    labelKey: "jm_at.adm.idx_gamemode_access",
    terms:
      "gamemode access all admins owner only change creative survival privilege adventure spectator gmc gms",
    gate: "owner",
    path: "Control Panel → Staff & Permissions → Admin Privileges",
  },
  {
    key: "customize_menu",
    label: "Customize Menu",
    labelKey: "jm_at.adm.idx_customize_menu",
    terms:
      "customize menu hide show buttons shortcuts promote layout personal admin panel pin reset default toggle settings config favorite arrange",
    gate: null,
    path: "Customize Menu",
  },
  // Destinations that are real, gated, and admin-reachable but were previously
  // unsearchable. The first three already live in this file; the last two are
  // imported (otherwise only reachable via their in-world tool items).
  {
    key: "teleport",
    label: "Teleport",
    labelKey: "jm_at.adm.idx_teleport",
    terms:
      "teleport tp summon bring fetch send player goto move position location warp",
    gate: ["tpToPlayer", "summon"],
    path: "Teleport",
  },
  {
    key: "info",
    label: "Info",
    labelKey: "jm_at.adm.idx_info",
    terms:
      "info help guide docs documentation how to about manual instructions faq learn tutorial readme",
    gate: null,
    path: "Info",
  },
  {
    key: "staff_tag_security",
    label: "Staff Tag Security",
    labelKey: "jm_at.adm.idx_staff_tag_security",
    terms:
      "staff tag security lenient strict trust vanilla operator op spoof grant nametag prefix",
    gate: "owner",
    path: "Control Panel → Staff & Permissions",
  },
  {
    key: "claims_admin",
    label: "Land Claims (Admin)",
    labelKey: "jm_at.adm.idx_claims_admin",
    terms:
      "claim claims land protection chunks browse all settings defaults abilities whitelist notifications entry exit grant revoke area budget transfer ownership force delete height owner subclaim sub-claim nested trust trusted member coowner griefing protect district zone region territory event log bypass override unclaim",
    gate: "claimsAdmin",
    path: "Claim Tool → All Claims / Settings",
  },
  {
    key: "kits_editor",
    label: "Kit Editor",
    labelKey: "jm_at.adm.idx_kits_editor",
    terms:
      "kit kits editor manage create edit delete starter claimable repeatable cooldown contents items icon reward give bundle loadout gear automation rank playtime pin featured",
    gate: "kits",
    path: "Kit Tool → Kit Editor",
  },
];

function _canAccessPanelEntry(player, entry) {
  if (entry.gate === null) return true;
  if (entry.gate === "admin") return isAdmin(player).ok;
  if (entry.gate === "owner") return isOwner(player);
  if (Array.isArray(entry.gate))
    return entry.gate.some((key) => modCan(player, key));
  return modCan(player, entry.gate);
}

// Result-button icons, keyed like PANEL_SEARCH_INDEX. Mostly the icon the
// destination's own panel button uses; related sub-rows share a parent icon.
const PANEL_SEARCH_ICONS = {
  tickets: "textures/ui/jm_at_tickets",
  players_online: "textures/ui/jm_at_online",
  players_offline: "textures/ui/jm_at_offline",
  players_search: "textures/ui/jm_at_player_info",
  control_panel: "textures/ui/jm_at_control_panel",
  config_editor: "textures/ui/jm_at_edit_menu",
  server_controls: "textures/ui/jm_at_server_controls",
  whitelist: "textures/ui/jm_at_manage_whitelist",
  ticket_settings: "textures/ui/jm_at_ticket_settings",
  categories: "textures/ui/jm_at_ticket_settings",
  dimension_locks: "textures/ui/jm_at_dimension_lock",
  item_watch: "textures/ui/jm_at_item_watch",
  item_watch_log: "textures/ui/jm_at_item_watch",
  banned_items: "textures/ui/jm_at_blacklist",
  tracked_items: "textures/ui/jm_at_item_watch",
  storage_health: "textures/ui/jm_at_action_log",
  restore_holograms: "textures/ui/jm_at_hologram_tool",
  commands: "textures/ui/jm_at_commands",
  game_commands: "textures/ui/jm_at_game_command",
  command_buttons: "textures/ui/jm_at_command_buttons",
  warps: "textures/ui/jm_at_warps",
  broadcasts: "textures/ui/jm_at_broadcast",
  admin_log: "textures/ui/jm_at_admin_log",
  action_log: "textures/ui/jm_at_action_log",
  rollcall: "textures/ui/jm_at_rollcall",
  staff_activity: "textures/ui/jm_at_staff_activity",
  log_settings: "textures/ui/jm_at_ticket_settings",
  rank_manager: "textures/ui/jm_at_rank_manager",
  rank_database: "textures/ui/jm_at_rank_database",
  bulk_assign: "textures/ui/jm_at_bulk_add",
  bulk_remove: "textures/ui/jm_at_bulk_remove",
  staff_rank_settings: "textures/ui/jm_at_staff_tag",
  playtime_ranks: "textures/ui/jm_at_playtime_ranks",
  staff_permissions: "textures/ui/jm_at_moderator_controls",
  mod_privileges: "textures/ui/jm_at_moderator",
  menu_visibility: "textures/ui/jm_at_edit_menu",
  admin_privileges: "textures/ui/jm_at_admin",
  gamemode_access: "textures/ui/jm_at_gamemode",
  customize_menu: "textures/ui/jm_at_edit_menu",
  teleport: "textures/ui/jm_at_tpa",
  info: "textures/ui/jm_at_admin_info",
  staff_tag_security: "textures/ui/jm_at_staff_tag",
  claims_admin: "textures/ui/jm_at_admin_claims",
  kits_editor: "textures/ui/jm_at_kit",
};
const PANEL_SEARCH_FALLBACK_ICON = "textures/ui/jm_at_search";

function _getPanelSearchFn(key, player) {
  const map = {
    tickets: () => showAdminTickets(player),
    players_online: () => showOnlinePlayers(player),
    players_offline: () => showOfflinePlayersList(player),
    players_search: () => showSearchPlayer(player),
    control_panel: () => showControlPanel(player),
    config_editor: () => showPlayerSettings(player),
    server_controls: () => showServerControls(player),
    whitelist: () => showManageWhitelist(player),
    ticket_settings: () => showTicketSettings(player),
    categories: () => showManageCategories(player),
    dimension_locks: () => showDimensionLocks(player),
    item_watch: () => showItemWatch(player),
    banned_items: () => showBannedItems(player),
    tracked_items: () => showTrackedItems(player),
    storage_health: () => showStorageHealth(player),
    restore_holograms: () => showHologramRestore(player),
    commands: () => showCommandsPanel(player),
    game_commands: () => showGameCommandsPanel(player),
    command_buttons: () => showCommandPresets(player),
    warps: () => showWarpsAdmin(player),
    broadcasts: () => showBroadcasts(player),
    admin_log: () => showAdminLogHub(player),
    action_log: () => showAdminLog(player),
    rollcall: () => showRollcall(player),
    staff_activity: () => showStaffActivity(player),
    log_settings: () => showLogSettings(player),
    rank_manager: () => showRankManager(player),
    rank_database: () => showRankDatabase(player),
    bulk_assign: () => showBulkAssignPickRank(player),
    bulk_remove: () => showBulkRemoveRank(player),
    staff_rank_settings: () => showStaffRankSettings(player),
    playtime_ranks: () => showPlaytimeRanks(player),
    staff_permissions: () => showStaffPermissions(player),
    mod_privileges: () => showModPrivileges(player),
    menu_visibility: () => showMenuVisibilityEditor(player),
    admin_privileges: () => showAdminPrivileges(player),
    gamemode_access: () => showAdminPrivileges(player),
    item_watch_log: () => showItemWatchLog(player),
    customize_menu: () => showCustomizeMenu(player),
    teleport: () => showTeleportMenu(player),
    info: () => showAdminInfo(player),
    staff_tag_security: () => showStaffTagSecurity(player),
    claims_admin: () => showClaimsAdmin(player, () => showAdminPanel(player)),
    kits_editor: () => openKitManager(player),
  };
  return map[key];
}

async function showPanelSearch(player) {
  const queryObs = new ObservableString("", { clientWritable: true });
  const status = new ObservableString("");
  const statusShown = new ObservableBoolean(false);
  let pendingNav = null;
  const fail = (m) => {
    status.setData(m);
    statusShown.setData(true);
  };

  const form = new CustomForm(player, t("jm_at.adm.search_title"));
  form.textField(t("jm_at.infoa.search_field_label"), queryObs, {
    description: t("jm_at.adm.search_field_desc"),
  });
  form.spacer();
  form.label(status, { visible: statusShown });
  form.spacer({ visible: statusShown });
  form.button(t("jm_at.adm.btn_search"), () => {
    const query = clampText(queryObs.getData().trim(), 50);
    if (!query) {
      fail("§c请输入要搜索的内容。");
      return;
    }
    pendingNav = () => runPanelSearch(player, query);
    try {
      form.close();
    } catch {}
  });
  form.button(t("jm_at.common.btn_back"), () => {
    pendingNav = () => showAdminPanel(player);
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(() => showPanelSearch(player));
  }
  if (pendingNav) return system.run(pendingNav);
  return; // ✕ / engine close / escape → exit to game
}

async function runPanelSearch(player, query) {
  // Score all entries, then split into accessible vs blocked. Term pools are
  // localized to the player's client language (see search-locale.js).
  const index = localizedIndex(player, PANEL_SEARCH_INDEX, "panel");
  const allMatches = index
    .map((entry) => {
      const { score, matchedTerms, strong } = searchScore(query, entry);
      return { ...entry, score, matchedTerms, strong };
    })
    .filter((e) => e.score > 0);

  const scored = allMatches
    .filter((e) => _canAccessPanelEntry(player, e))
    .sort((a, b) => b.score - a.score);

  const blocked = allMatches.filter((e) => !_canAccessPanelEntry(player, e));

  if (scored.length === 0) {
    let body;
    if (blocked.length > 0) {
      // Matches exist but the user lacks privileges
      const names = raw(
        ...blocked
          .sort((a, b) => b.score - a.score)
          .slice(0, 3)
          .flatMap((e, i) => [i > 0 ? ", " : "", "§9", t(e.labelKey), "§r"]),
      );
      body = t("jm_at.adm.search_blocked_body", query, names);
    } else {
      const suggestion = findClosestKeyword(query, index);
      body = suggestion
        ? t("jm_at.infoa.no_results_suggest", query, suggestion)
        : t("jm_at.infoa.no_results_try", query);
    }

    const noResultForm = new ActionFormData()
      .title(t("jm_at.infoa.search_results_title"))
      .body(body);
    if (blocked.length === 0) {
      const suggestion = findClosestKeyword(query, index);
      if (suggestion) {
        noResultForm.button(
          t("jm_at.adm.btn_search_for", suggestion),
          "textures/ui/jm_at_search_rename",
        );
      }
    }
    noResultForm.button(
      t("jm_at.infoa.btn_search_again"),
      "textures/ui/jm_at_search_again",
    );
    noResultForm.button(
      t("jm_at.common.btn_back_bold"),
      "textures/ui/jm_at_back",
    );
    noResultForm.button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

    const noRes = await noResultForm.show(player);
    if (noRes.canceled) return showPanelSearch(player); // X = Back
    let idx = 0;
    if (blocked.length === 0) {
      const suggestion = findClosestKeyword(query, index);
      if (suggestion && noRes.selection === idx++) {
        return showPanelSearchResults(player, suggestion);
      }
    }
    if (noRes.selection === idx++) return showPanelSearch(player);
    if (noRes.selection === idx++) return showAdminPanel(player); // Back
    return; // Close
  }

  return showPanelSearchResults(player, query, scored);
}

/** Translate visible menu labels without changing search or navigation data. */
function _panelResultButtonLabel(entry, query) {
  return localizedResultRow(entry, query, PANEL_SEARCH_INDEX);
}

async function showPanelSearchResults(player, query, scored, showAll = false) {
  if (!scored) {
    scored = localizedIndex(player, PANEL_SEARCH_INDEX, "panel")
      .map((entry) => {
        const { score, matchedTerms, strong } = searchScore(query, entry);
        return { ...entry, score, matchedTerms, strong };
      })
      .filter((e) => e.score > 0 && _canAccessPanelEntry(player, e))
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) {
      return warnForm(player, t("jm_at.adm.search_none", query), () =>
        showPanelSearch(player),
      );
    }
  }

  // Strong (exact/prefix) hits up front; substring/fuzzy hits fold behind a
  // "loosely related" button so an ambiguous term doesn't bury the real targets.
  const { list, foldCount, folded } = planResultView(scored, showAll);

  const resultForm = new ActionFormData()
    .title(t("jm_at.infoa.search_results_title"))
    .body(
      t(
        scored.length === 1
          ? "jm_at.infoa.results_found_one"
          : "jm_at.infoa.results_found_many",
        scored.length,
        query,
      ),
    );

  for (const entry of list) {
    resultForm.button(
      _panelResultButtonLabel(entry, query),
      PANEL_SEARCH_ICONS[entry.key] ?? PANEL_SEARCH_FALLBACK_ICON,
    );
  }
  if (folded)
    resultForm.button(
      t("jm_at.infoa.btn_show_loose", foldCount),
      "textures/ui/jm_at_down",
    );
  resultForm.button(
    t("jm_at.infoa.btn_search_again"),
    "textures/ui/jm_at_search_again",
  );
  resultForm.button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back");
  resultForm.button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const resultRes = await resultForm.show(player);
  if (resultRes.canceled) return showPanelSearch(player); // X = Back

  if (resultRes.selection < list.length) {
    const fn = _getPanelSearchFn(list[resultRes.selection].key, player);
    return fn?.();
  }
  let idx = list.length;
  if (folded) {
    if (resultRes.selection === idx)
      return showPanelSearchResults(player, query, scored, true); // expand
    idx++;
  }
  if (resultRes.selection === idx) return showPanelSearch(player); // Search Again
  if (resultRes.selection === idx + 1) return showAdminPanel(player); // Back
  return; // Close
}

// =========================================================
// Admin Panel (main hub)
// =========================================================

export async function showAdminPanel(player) {
  if (!isStaff(player)) {
    tell(player, t("jm_at.adm.staff_only"));
    return;
  }
  const isMod = isModerator(player);

  // Owner claim: only admins, not moderators
  if (!isMod) {
    const cfg = getCfg();
    const xuid = getPlayerXuid(player);
    if (!cfg.ownerXuid) {
      cfg.ownerXuid = xuid;
      setCfg(cfg);
      tell(player, t("jm_at.adm.owner_claimed"));
      logAdmin(player, "OWNER_CLAIM", "设置服主身份");
      // A freshly-claimed owner must not inherit a prior owner's Owner-Only
      // claims: convert any not owned by them into ordinary personal claims.
      try {
        releaseStrayOwnerOnlyClaims(xuid);
      } catch (e) {
        silentCatch("ownerclaim_release_owneronly", e);
      }
    }
  }

  const meta = getTicketMeta();
  const openCount = meta.open.length;
  const claimedCount = meta.claimed.length;

  const panelTitle = isMod
    ? t("jm_at.adm.panel_title_mod", VER)
    : t("jm_at.adm.panel_title_admin", VER);

  // Build buttons dynamically based on perms + per-player visibility.
  // Every top-level button is hideable per-player; Customize Menu is the only
  // always-on entry (the recovery hatch).
  const actions = [];
  if (isAdmin(player).ok) {
    actions.push({ label: "§l家园统一管理（管理员）", icon: "textures/ui/jm_at_control_panel", fn: () => showHomeAdministration(player, () => showAdminPanel(player)) });
  }
  if (isMenuButtonVisible(player, MENU_KEYS.SEARCH, { skipPerm: true })) {
    actions.push({
      label: t("jm_at.adm.btn_panel_search"),
      icon: "textures/ui/jm_at_search_info",
      fn: () => showPanelSearch(player),
    });
  }
  if (
    modCan(player, "tickets") &&
    isMenuButtonVisible(player, MENU_KEYS.TICKETS, {
      ownerLayer: true,
      skipPerm: true,
    })
  ) {
    actions.push({
      label: t("jm_at.adm.btn_panel_tickets", openCount, claimedCount),
      icon: "textures/ui/jm_at_tickets",
      fn: () => showAdminTickets(player, "open"),
    });
  }
  if (isMenuButtonVisible(player, MENU_KEYS.PLAYERS, { skipPerm: true })) {
    actions.push({
      label: t("jm_at.adm.btn_panel_players"),
      icon: "textures/ui/jm_at_players",
      fn: () => showPlayersMenu(player),
    });
  }
  if (
    (modCan(player, "tpToPlayer") || modCan(player, "summon")) &&
    isMenuButtonVisible(player, MENU_KEYS.TELEPORT, {
      ownerLayer: true,
      skipPerm: true,
    })
  ) {
    actions.push({
      label: t("jm_at.adm.btn_panel_teleport"),
      icon: "textures/ui/jm_at_tpa",
      fn: () => showTeleportMenu(player),
    });
  }
  if (
    (modCan(player, "serverControls") ||
      modCan(player, "ticketSettings") ||
      modCan(player, "dimensionLocks") ||
      modCan(player, "itemWatch") ||
      modCan(player, "configEditor")) &&
    isMenuButtonVisible(player, MENU_KEYS.CONTROL_PANEL, { skipPerm: true })
  ) {
    actions.push({
      label: t("jm_at.adm.btn_panel_control"),
      icon: "textures/ui/jm_at_control_panel",
      fn: () => showControlPanel(player),
    });
  }
  if (
    (modCan(player, "commands") ||
      modCan(player, "commandButtons") ||
      modCan(player, "gameCommands") ||
      modCan(player, "gameRules") ||
      modCan(player, "gamemode")) &&
    isMenuButtonVisible(player, MENU_KEYS.COMMANDS, {
      ownerLayer: true,
      skipPerm: true,
    })
  ) {
    actions.push({
      label: t("jm_at.adm.btn_panel_commands"),
      icon: "textures/ui/jm_at_commands",
      fn: () => showCommandsPanel(player),
    });
  }
  if (
    modCan(player, "warps") &&
    isMenuButtonVisible(player, MENU_KEYS.WARPS, {
      ownerLayer: true,
      skipPerm: true,
    })
  ) {
    actions.push({
      label: t("jm_at.adm.btn_panel_warps"),
      icon: "textures/ui/jm_at_warps",
      fn: () => showWarpsAdmin(player),
    });
  }
  if (
    modCan(player, "broadcasts") &&
    isMenuButtonVisible(player, MENU_KEYS.BROADCASTS, {
      ownerLayer: true,
      skipPerm: true,
    })
  ) {
    actions.push({
      label: t("jm_at.adm.btn_panel_broadcasts"),
      icon: "textures/ui/jm_at_broadcast",
      fn: () => showBroadcasts(player),
    });
  }
  if (
    modCan(player, "adminLog") &&
    isMenuButtonVisible(player, MENU_KEYS.ADMIN_LOG, { skipPerm: true })
  ) {
    actions.push({
      label: t("jm_at.adm.btn_panel_admin_log"),
      icon: "textures/ui/jm_at_admin_log",
      fn: () => showAdminLogHub(player),
    });
  }
  if (isMenuButtonVisible(player, MENU_KEYS.INFO, { skipPerm: true })) {
    actions.push({
      label: t("jm_at.adm.btn_panel_info"),
      icon: "textures/ui/jm_at_admin_info",
      fn: () => showAdminInfo(player),
    });
  }
  // Promoted sub-button shortcuts — appended after the standard top-level rows.
  for (const meta of getPromotedRowsForPlayer(player)) {
    const fn = _promotedActionFor(player, meta.key);
    if (!fn) continue;
    actions.push({
      // Promoted shortcut label from MENU_BUTTON_META (translated).
      // until that module gets labelKeys in a later i18n pass.
      label: raw("§e★ §r", t(meta.labelKey)),
      icon: meta.icon,
      fn,
    });
  }
  // Always-on, never hideable — the recovery hatch.
  actions.push({
    label: t("jm_at.adm.btn_panel_customize"),
    icon: "textures/ui/jm_at_edit_menu",
    fn: () => showCustomizeMenu(player),
  });

  const form = new ActionFormData()
    .title(panelTitle)
    .body(t("jm_at.adm.panel_body", openCount, claimedCount));
  for (const a of actions) form.button(a.label, a.icon);

  const res = await form.show(player);
  if (res.canceled) return;
  if (res.selection >= 0 && res.selection < actions.length)
    return actions[res.selection].fn();
}

// =========================================================
// Info
// =========================================================

// Admin info pages are in info-admin.js — re-exported here for backward compat
import { showAdminInfo as _showAdminInfo } from "./info-admin.js";
export async function showAdminInfo(player) {
  return _showAdminInfo(player, showAdminPanel);
}

// =========================================================
// Admin Tickets
// =========================================================

/** Ticket status/tab -> translated RawMessage; unknown values display raw. */
// lang-keys: jm_at.tickets.status_*
const TICKET_STATUS_KEYS = {
  OPEN: "jm_at.tickets.status_open",
  CLAIMED: "jm_at.tickets.status_claimed",
  RESOLVED: "jm_at.tickets.status_resolved",
  CLOSED: "jm_at.tickets.status_closed",
};
function _ticketStatusRaw(status) {
  const key = TICKET_STATUS_KEYS[String(status ?? "").toUpperCase()];
  return key ? t(key) : { text: String(status ?? "") };
}

export async function showAdminTickets(player, startTab = "open", page = 0) {
  try {
    requireAdminOrModCan(player, "tickets", "查看工单");
  } catch {
    return;
  }
  const isMod = isModerator(player);
  const meta = getTicketMeta();
  const tabs = ["open", "claimed", "resolved", "closed"];
  const PAGE_SIZE = 15;

  const list = meta[startTab] ?? [];
  // Cache ticket lookups before sorting to avoid repeated page scans inside the comparator
  const ticketCache = new Map(list.map((id) => [id, findTicket(id)]));
  const sortedList =
    startTab === "open" || startTab === "claimed"
      ? [...list].sort(
          (a, b) =>
            (ticketCache.get(a)?.ticket?.createdAt ?? 0) -
            (ticketCache.get(b)?.ticket?.createdAt ?? 0),
        )
      : list;

  const totalPages = Math.max(1, Math.ceil(sortedList.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const shown = sortedList.slice(
    safePage * PAGE_SIZE,
    (safePage + 1) * PAGE_SIZE,
  );
  const hasPrev = safePage > 0;
  const hasMore = (safePage + 1) * PAGE_SIZE < sortedList.length;

  const pageLabel =
    totalPages > 1
      ? t("jm_at.common.page_suffix_dash", safePage + 1, totalPages)
      : "";
  const form = new ActionFormData()
    .title(
      t("jm_at.adm.tickets_title", _ticketStatusRaw(startTab), list.length),
    )
    .body(
      list.length
        ? raw(t("jm_at.adm.tickets_body_select"), pageLabel)
        : t("jm_at.adm.tickets_body_empty"),
    );

  for (const id of shown) {
    const found = findTicket(id);
    const cat = found?.ticket?.category ?? "?";
    const sub = found?.ticket?.submitter?.name ?? "?";
    const ageMins = found
      ? Math.floor((nowMs() - found.ticket.createdAt) / 60000)
      : 0;
    const ageRaw = t(
      "jm_at.time.ago",
      ageMins < 60 ? t("jm_at.time.unit_minutes", ageMins) : t("jm_at.time.unit_hours", Math.floor(ageMins / 60)),
    );
    const seenMark =
      startTab === "closed" && found?.ticket?.submitterSeen
        ? t("jm_at.adm.tickets_seen_mark")
        : "";
    form.button(
      t("jm_at.adm.tickets_row", id, seenMark, sub, cat, ageRaw),

      "textures/ui/jm_at_my_tickets",
    );
  }

  // Build navigation buttons after ticket list
  const nextTab = tabs[(tabs.indexOf(startTab) + 1) % tabs.length];
  const hasDeleteBtn = !isMod && startTab === "closed" && list.length > 0;
  const extraBtns = [];
  extraBtns.push({
    label: t(
      "jm_at.adm.tickets_btn_switch",
      _ticketStatusRaw(nextTab),
      _ticketStatusRaw(startTab),
    ),
    icon: "textures/ui/jm_at_next",
    key: "switch",
  });
  if (hasPrev)
    extraBtns.push({
      label: t("jm_at.common.btn_prev_page_plain", safePage),
      icon: "textures/ui/jm_at_back",
      key: "prev",
    });
  if (hasMore)
    extraBtns.push({
      label: t("jm_at.common.btn_next_page_plain", safePage + 2),
      icon: "textures/ui/jm_at_next",
      key: "next",
    });
  if (hasDeleteBtn)
    extraBtns.push({
      label: t("jm_at.adm.tickets_btn_delete_all", list.length),
      icon: "textures/ui/jm_at_remove",
      key: "delete",
    });
  extraBtns.push({
    label: t("jm_at.common.btn_back_bold"),
    icon: "textures/ui/jm_at_back",
    key: "back",
  });
  extraBtns.push({
    label: CLOSE_BTN_LABEL,
    icon: CLOSE_BTN_ICON,
    key: "close",
  });
  for (const btn of extraBtns) form.button(btn.label, btn.icon);

  const res = await form.show(player);
  if (res.canceled) return showAdminPanel(player); // X = Back

  if (res.selection < shown.length) {
    const ticketId = shown[res.selection];
    if (ticketId) {
      return showTicketDetail(player, ticketId, {
        adminView: true,
        onBack: () => showAdminTickets(player, startTab, safePage),
        onProfile: (name, xuid, backToTicket) => {
          const t2 = getOnlinePlayerByName(name);
          if (t2) return showPlayerProfile(player, t2, backToTicket);
          if (xuid) return showOfflineProfile(player, xuid, backToTicket);
          tell(player, t("jm_at.adm.xuid_not_found"));
        },
      });
    }
  }

  const extra = extraBtns[res.selection - shown.length];
  if (!extra) return;

  if (extra.key === "close") return;
  if (extra.key === "back") return showAdminPanel(player);
  if (extra.key === "switch")
    return showAdminTickets(
      player,
      tabs[(tabs.indexOf(startTab) + 1) % tabs.length],
      0,
    );
  if (extra.key === "prev")
    return showAdminTickets(player, startTab, safePage - 1);
  if (extra.key === "next")
    return showAdminTickets(player, startTab, safePage + 1);

  if (extra.key === "delete") {
    const allClosedTickets = list
      .map((id) => findTicket(id)?.ticket)
      .filter(Boolean);
    const seenIds = allClosedTickets
      .filter((tk) => tk.submitterSeen)
      .map((tk) => tk.id);
    const seenCount = seenIds.length;

    const sub = await new ActionFormData()
      .title(t("jm_at.adm.tickets_delete_title"))
      .body(
        t(
          "jm_at.adm.tickets_delete_body",
          list.length,
          seenCount,
          list.length - seenCount,
        ),
      )
      .button(
        seenCount > 0
          ? t("jm_at.adm.tickets_btn_delete_seen", seenCount)
          : t("jm_at.adm.tickets_btn_delete_seen_none"),
      )
      .button(t("jm_at.adm.tickets_btn_delete_all_sub", list.length))
      .button(t("jm_at.common.btn_back_bold"))
      .show(player);

    if (!sub.canceled) {
      if (sub.selection === 0 && seenCount > 0) {
        const purged = purgeTicketIds(seenIds);
        logAdmin(
          player,
          "TICKETS_PURGE",
          `已清理 ${purged} 个提交者已查看的关闭工单`,
        );
        tell(player, t("jm_at.adm.tickets_purged_seen", purged));
      } else if (sub.selection === 1) {
        const conf = await new MessageFormData()
          .title(t("jm_at.adm.tickets_delete_all_title"))
          .body(
            t(
              "jm_at.adm.tickets_delete_all_body",
              list.length,
              list.length - seenCount,
            ),
          )
          .button1(t("jm_at.common.btn_cancel"))
          .button2(t("jm_at.adm.btn_delete_all"))
          .show(player);
        if (!conf.canceled && conf.selection === 1) {
          const purged = purgeClosedTickets();
          logAdmin(
            player,
            "TICKETS_PURGE",
            `已清理全部 ${purged} 个已关闭工单`,
          );
          tell(player, t("jm_at.adm.tickets_purged_all", purged));
        }
      }
    }
    return showAdminTickets(player, "closed", 0);
  }
}

// =========================================================
// Players menu
// =========================================================

export async function showPlayersMenu(player) {
  try {
    requireStaff(player, "玩家菜单");
  } catch {
    return;
  }
  const online = world.getPlayers().length;

  const actions = [
    {
      label: t("jm_at.adm.btn_online_players"),
      icon: "textures/ui/jm_at_online",
      fn: () => showOnlinePlayers(player),
    },
    {
      label: t("jm_at.adm.btn_offline_players"),
      icon: "textures/ui/jm_at_offline",
      fn: () => showOfflinePlayersList(player),
    },
    {
      label: t("jm_at.adm.btn_search_by_name"),
      icon: "textures/ui/jm_at_search_info",
      fn: () => showSearchPlayer(player),
    },
  ];
  if (modCan(player, "rankManager")) {
    actions.push({
      label: t("jm_at.adm.btn_rank_manager"),
      icon: "textures/ui/jm_at_rank_manager",
      fn: () => showRankManager(player),
    });
  }

  const form = new ActionFormData()
    .title(t("jm_at.adm.players_title"))
    .body(t("jm_at.adm.players_online_count", online));
  for (const a of actions) form.button(a.label, a.icon);
  form.button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back");
  form.button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showAdminPanel(player); // X = Back
  if (res.selection >= 0 && res.selection < actions.length)
    return actions[res.selection].fn();
  if (res.selection === actions.length) return showAdminPanel(player); // Back
  return; // Close
}

export async function showOnlinePlayers(player, page = 0) {
  try {
    requireStaff(player, "在线玩家");
  } catch {
    return;
  }
  const PAGE_SIZE = 15;
  const allPlayers = [...world.getPlayers()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const totalPages = Math.max(1, Math.ceil(allPlayers.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const shown = allPlayers.slice(
    safePage * PAGE_SIZE,
    (safePage + 1) * PAGE_SIZE,
  );
  const hasPrev = safePage > 0;
  const hasMore = (safePage + 1) * PAGE_SIZE < allPlayers.length;

  const pageLabel =
    totalPages > 1
      ? t("jm_at.common.page_suffix_dash", safePage + 1, totalPages)
      : "";
  const form = new ActionFormData()
    .title(t("jm_at.adm.online_title", allPlayers.length))
    .body(raw(t("jm_at.adm.online_body"), pageLabel));

  for (const p of shown) {
    const tags = [
      isAdmin(p).ok ? t("jm_at.adm.tag_admin") : "",
      isModerator(p) ? t("jm_at.adm.tag_mod") : "",
      hasActivePunishment(p, "BAN") ? t("jm_at.adm.tag_ban") : "",
      p.hasTag(`${NS}:frozen`) ? t("jm_at.adm.tag_frozen") : "",
    ].filter(Boolean);
    form.button(
      raw(
        `§l${p.name}`,
        ...tags.flatMap((tag, i) => [i === 0 ? "  " : " ", tag]),
      ),
      "textures/ui/jm_at_online",
    );
  }

  const extraBtns = [];
  if (hasPrev)
    extraBtns.push({
      label: t("jm_at.common.btn_prev_page_plain", safePage),
      icon: "textures/ui/jm_at_back",
      key: "prev",
    });
  if (hasMore)
    extraBtns.push({
      label: t("jm_at.common.btn_next_page_plain", safePage + 2),
      icon: "textures/ui/jm_at_next",
      key: "next",
    });
  extraBtns.push({
    label: t("jm_at.common.btn_back_bold"),
    icon: "textures/ui/jm_at_back",
    key: "back",
  });
  extraBtns.push({
    label: CLOSE_BTN_LABEL,
    icon: CLOSE_BTN_ICON,
    key: "close",
  });
  for (const btn of extraBtns) form.button(btn.label, btn.icon);

  const res = await form.show(player);
  if (res.canceled) return showPlayersMenu(player); // X = Back

  if (res.selection < shown.length) {
    const target = shown[res.selection];
    if (target)
      return showPlayerProfile(player, target, () =>
        showOnlinePlayers(player, safePage),
      );
  }

  const extra = extraBtns[res.selection - shown.length];
  if (!extra) return;
  if (extra.key === "close") return;
  if (extra.key === "back") return showPlayersMenu(player);
  if (extra.key === "prev") return showOnlinePlayers(player, safePage - 1);
  if (extra.key === "next") return showOnlinePlayers(player, safePage + 1);
}

export async function showOfflinePlayersList(player) {
  try {
    requireStaff(player, "离线玩家");
  } catch {
    return;
  }

  const reg = getPlayerRegistry();
  const onlineNames = new Set(world.getPlayers().map((p) => p.name));

  // Sort all registry entries by lastSeen descending, exclude currently online
  const sorted = Object.values(reg)
    .filter((e) => !onlineNames.has(e.name))
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .slice(0, 50);

  const form = new ActionFormData()
    .title(t("jm_at.adm.offline_title", sorted.length))
    .body(
      sorted.length
        ? t("jm_at.adm.offline_body")
        : t("jm_at.adm.offline_body_empty"),
    );

  for (const e of sorted) {
    const hasBan = getPlayerPunishments(e.xuid).some(
      (p) =>
        p.type === "BAN" &&
        p.active &&
        (p.expiresAt === 0 || p.expiresAt > Date.now()),
    );
    const tags = hasBan ? raw("  ", t("jm_at.adm.tag_ban")) : "";
    form.button(
      t("jm_at.adm.offline_row", e.name, tags, fmtMsRaw(e.lastSeen)),
      "textures/ui/jm_at_offline",
    );
  }
  form.button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back");
  form.button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showPlayersMenu(player); // X = Back
  if (res.selection === sorted.length) return showPlayersMenu(player); // Back
  if (res.selection === sorted.length + 1) return; // Close

  const entry = sorted[res.selection];
  if (entry)
    return showOfflineProfile(player, entry.xuid, () =>
      showOfflinePlayersList(player),
    );
}

export async function showSearchPlayer(player) {
  try {
    requireStaff(player, "搜索玩家");
  } catch {
    return;
  }

  const reg = getPlayerRegistry();
  const entries = Object.entries(reg)
    .map(([xuid, e]) => ({ xuid, name: e.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const items =
    entries.length > 0
      ? entries.map((e, i) => ({ label: e.name, value: i }))
      : [{ label: t("jm_at.adm.dropdown_none"), value: 0 }];

  const typedObs = new ObservableString("", { clientWritable: true });
  const pickObs = new ObservableNumber(0, { clientWritable: true });
  const status = new ObservableString("");
  const statusShown = new ObservableBoolean(false);
  let pendingNav = null;
  const fail = (m) => {
    status.setData(m);
    statusShown.setData(true);
  };

  const form = new CustomForm(player, t("jm_at.adm.search_player_title"));
  form.textField(t("jm_at.adm.field_type_or_pick"), typedObs);
  form.dropdown(t("jm_at.adm.field_known_players"), pickObs, items);
  form.spacer();
  form.label(status, { visible: statusShown });
  form.spacer({ visible: statusShown });
  form.button(t("jm_at.adm.btn_search"), () => {
    const typed = clampText(typedObs.getData().trim(), 50);
    const name =
      typed ||
      (entries.length > 0 ? entries[pickObs.getData()]?.name : "") ||
      "";
    if (!name) {
      fail("§c请输入或选择一名玩家。");
      return;
    }
    const online = getOnlinePlayerByName(name);
    if (online) {
      pendingNav = () =>
        showPlayerProfile(player, online, () => showSearchPlayer(player));
      try {
        form.close();
      } catch {}
      return;
    }
    const entry = getRegistryEntryByName(name);
    if (entry) {
      pendingNav = () =>
        showOfflineProfile(player, entry.xuid, () => showSearchPlayer(player));
      try {
        form.close();
      } catch {}
      return;
    }
    fail(`§c找不到“${name}”的记录，对方可能从未加入过此世界。`);
  });
  form.button(t("jm_at.common.btn_back"), () => {
    pendingNav = () => showPlayersMenu(player);
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(() => showSearchPlayer(player));
  }
  if (pendingNav) return system.run(pendingNav);
  return; // ✕ / engine close / escape → exit to game
}

export async function showTeleportMenu(player) {
  const canTp = modCan(player, "tpToPlayer");
  const canSummon = modCan(player, "summon");
  if (!canTp && !canSummon) {
    tell(player, t("jm_at.adm.no_perm_teleport"));
    return;
  }

  const actions = [];
  if (canTp) {
    actions.push({
      label: t("jm_at.adm.btn_tp_to_player"),
      icon: "textures/ui/jm_at_tp_to",
      fn: () => showTpToPlayerPicker(player),
    });
  }
  if (canSummon) {
    actions.push({
      label: t("jm_at.adm.btn_summon_player"),
      icon: "textures/ui/jm_at_summon",
      fn: () => showSummonPlayerPicker(player),
    });
    actions.push({
      label: t("jm_at.adm.btn_tp_to_warp"),
      icon: "textures/ui/jm_at_tp_to_warp",
      fn: () => showTpPlayerToWarpPicker(player),
    });
  }

  const form = new ActionFormData()
    .title(t("jm_at.tpa.menu_title"))
    .body(t("jm_at.adm.teleport_body"));
  for (const a of actions) form.button(a.label, a.icon);
  form.button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back");
  form.button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showAdminPanel(player); // X = Back
  if (res.selection >= 0 && res.selection < actions.length)
    return actions[res.selection].fn();
  if (res.selection === actions.length) return showAdminPanel(player); // Back
  return; // Close
}

/**
 * Shared DDUI "type a name or pick an online player" form for the teleport
 * actions. opts: { title, permission, back, reopen, onPick(target) }. onPick
 * runs after the form closes; validation (no name / not online) shows inline.
 */
async function showOnlinePlayerPicker(player, opts) {
  const {
    title,
    permission,
    back,
    reopen,
    onPick,
    actionLabel = t("jm_at.adm.btn_select"),
  } = opts;
  if (!modCan(player, permission)) {
    tell(player, t("jm_at.adm.no_perm_generic"));
    return;
  }
  // Targets a staff member can't act on are excluded up front so they never
  // appear in the list: the owner is off-limits to everyone, and a moderator
  // can't target a higher-ranked admin. All consumers (TP / summon / TP-to-warp)
  // enforce this at the action level too — this just keeps the picker honest.
  const actorIsMod = isModerator(player);
  const candidates = [...world.getPlayers()]
    .filter((p) => p.id !== player.id)
    .filter((p) => !isOwner(p) && !(actorIsMod && isAdmin(p).ok))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (candidates.length === 0) {
    tell(player, t("jm_at.adm.no_other_players"));
    return back();
  }
  const items = candidates.map((p, i) => ({ label: p.name, value: i }));
  const typedObs = new ObservableString("", { clientWritable: true });
  const pickObs = new ObservableNumber(0, { clientWritable: true });
  const status = new ObservableString("");
  const statusShown = new ObservableBoolean(false);
  let pendingNav = null;
  const fail = (m) => {
    status.setData(m);
    statusShown.setData(true);
  };

  const form = new CustomForm(player, title);
  form.textField(t("jm_at.adm.field_type_or_pick"), typedObs);
  form.dropdown(t("jm_at.adm.field_online_players"), pickObs, items);
  form.spacer();
  form.label(status, { visible: statusShown });
  form.spacer({ visible: statusShown });
  form.button(actionLabel, () => {
    const typed = clampText(typedObs.getData().trim(), 50);
    const name = typed || candidates[pickObs.getData()]?.name || "";
    if (!name) {
      fail("§c请输入或选择一名玩家。");
      return;
    }
    const target = getOnlinePlayerByName(name);
    if (!target || target.id === player.id) {
      fail(`§c找不到与“${name}”匹配的在线玩家。`);
      return;
    }
    pendingNav = () => onPick(target);
    try {
      form.close();
    } catch {}
  });
  form.button(t("jm_at.common.btn_back"), () => {
    pendingNav = back;
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(() => reopen(player));
  }
  if (pendingNav) return system.run(pendingNav);
  return; // ✕ / engine close / escape → exit to game
}

export async function showTpToPlayerPicker(player) {
  return showOnlinePlayerPicker(player, {
    title: t("jm_at.adm.tp_to_title"),
    permission: "tpToPlayer",
    actionLabel: t("jm_at.adm.btn_teleport_plain"),
    back: () => showTeleportMenu(player),
    reopen: showTpToPlayerPicker,
    onPick: (target) => {
      try {
        doTpTo(player, target);
      } catch (e) {
        return warnForm(
          player,
          raw("§c", e?.message ?? t("jm_at.adm.err_teleport_failed")),
          () => showTpToPlayerPicker(player),
        );
      }
    },
  });
}

export async function showSummonPlayerPicker(player) {
  return showOnlinePlayerPicker(player, {
    title: t("jm_at.adm.summon_title"),
    permission: "summon",
    actionLabel: t("jm_at.adm.btn_teleport_plain"),
    back: () => showTeleportMenu(player),
    reopen: showSummonPlayerPicker,
    onPick: (target) => {
      try {
        doSummon(player, target);
      } catch (e) {
        return warnForm(
          player,
          raw("§c", e?.message ?? t("jm_at.adm.err_summon_failed")),
          () => showSummonPlayerPicker(player),
        );
      }
    },
  });
}

export async function showTpPlayerToWarpPicker(player) {
  return showOnlinePlayerPicker(player, {
    title: t("jm_at.adm.tp_warp_title"),
    permission: "summon",
    actionLabel: t("jm_at.adm.btn_teleport_plain"),
    back: () => showTeleportMenu(player),
    reopen: showTpPlayerToWarpPicker,
    onPick: (target) => showWarpPickForPlayer(player, target.name),
  });
}

async function showWarpPickForPlayer(player, targetName) {
  const warps = getWarps();
  const names = getSortedWarpNames(warps);
  if (names.length === 0) {
    tell(player, t("jm_at.adm.no_warps_set"));
    return showTeleportMenu(player);
  }

  const r = await showWarpPicker(player, {
    title: t("jm_at.adm.send_to_warp_title", targetName),
    body: t("jm_at.adm.send_to_warp_body", targetName),
    names,
    label: (n) => {
      const w = warps[n];
      const dim = (w.dimension ?? "overworld").replace("minecraft:", "");
      const access = getWarpAccess(w);
      const tier =
        access !== WARP_ACCESS.PUBLIC
          ? t(
              access === WARP_ACCESS.ADMIN
                ? "jm_at.adm.warp_tier_suffix_admin"
                : "jm_at.adm.warp_tier_suffix_staff",
            )
          : "";
      const icon =
        dim === "nether"
          ? "textures/ui/jm_at_nether"
          : dim === "the_end"
            ? "textures/ui/jm_at_end"
            : "textures/ui/jm_at_warps";
      return {
        label: raw(`§l§s${n}§r\n`, fmtDimRaw(w.dimension), tier),
        icon,
      };
    },
  });
  if (r.nav === "close") return; // Close
  if (!r.item) return showTpPlayerToWarpPicker(player); // Back

  const warpName = r.item;
  const target = getOnlinePlayerByName(targetName);
  if (!target) {
    return warnForm(player, t("jm_at.adm.no_longer_online", targetName), () =>
      showTeleportMenu(player),
    );
  }

  try {
    doTpToWarp(player, target, warps[warpName], warpName);
  } catch (e) {
    return warnForm(
      player,
      raw("§c", e?.message ?? t("jm_at.adm.err_teleport_failed")),
      () => showTeleportMenu(player),
    );
  }
  return showTeleportMenu(player);
}

export async function showOfflineProfile(admin, xuid, backFn = null) {
  try {
    requireStaff(admin, "离线玩家资料");
  } catch {
    return;
  }
  const back = backFn ?? (() => showPlayersMenu(admin));
  const isMod = isModerator(admin);
  const cfg = getCfg();
  const isOwnerTarget = !!(cfg.ownerXuid && xuid === cfg.ownerXuid);
  const reg = getPlayerRegistry();
  const entry = reg[xuid];

  if (!entry) {
    return warnForm(admin, t("jm_at.adm.registry_not_found"), () => back());
  }

  const now = Date.now();
  const puns = getPlayerPunishments(entry.xuid);
  const banPun =
    puns.find(
      (p) =>
        p.type === "BAN" &&
        p.active &&
        (p.expiresAt === 0 || p.expiresAt > now),
    ) ?? null;
  const warnCount = puns.filter(
    (p) =>
      p.type === "WARN" && p.active && (p.expiresAt === 0 || p.expiresAt > now),
  ).length;

  const statusLine = banPun
    ? t("jm_at.adm.tag_banned")
    : t("jm_at.adm.tag_offline");

  const banDetail = banPun
    ? t(
        "jm_at.adm.ban_detail",
        banPun.reason,
        banPun.expiresAt > 0
          ? t("jm_at.adm.ban_until", fmtMsRaw(banPun.expiresAt))
          : t("jm_at.adm.ban_permanent"),
      )
    : "";
  // Personal/owner claims only (admin claims are excluded from byOwner).
  const claimCount = getClaimsByOwner(entry.xuid).filter(
    (c) => !c.isAdminClaim,
  ).length;

  const body = raw(
    t(
      "jm_at.adm.offline_profile_1",
      entry.name,
      statusLine,
      entry.xuid,
      entry.gamemode ?? t("jm_at.time.unknown"),
      fmtMsRaw(entry.firstSeen),
      fmtMsRaw(entry.lastSeen),
    ),
    "\n",
    t(
      "jm_at.adm.offline_profile_2",
      fmtDimRaw(entry.lastDim),
      entry.lastPos?.x ?? 0,
      entry.lastPos?.y ?? 0,
      entry.lastPos?.z ?? 0,
      (entry.myTickets ?? []).length,
      warnCount,
      claimCount,
    ),
    banDetail,
  );

  const form = new ActionFormData()
    .title(t("jm_at.adm.offline_title_name", entry.name))
    .body(body);

  // Build action buttons — same pattern as online profile
  const hasNotesBtn = modCan(admin, "adminNotes");
  const hasTicketsBtn = modCan(admin, "tickets");
  const hasPunBtn = modCan(admin, "punishmentHistory");
  const offHomes = getOfflineHomes(xuid);
  const hasHomesBtn =
    Object.keys(offHomes).length > 0 && modCan(admin, "homes");
  if (hasNotesBtn)
    form.button(t("jm_at.adm.btn_admin_notes"), "textures/ui/jm_at_admin_note");
  if (hasTicketsBtn)
    form.button(
      t("jm_at.adm.btn_view_tickets"),
      "textures/ui/jm_at_my_tickets",
    );
  if (hasPunBtn)
    form.button(
      t("jm_at.adm.btn_pun_history"),
      "textures/ui/jm_at_punishment_history",
    );
  if (hasHomesBtn)
    form.button(
      t("jm_at.adm.btn_homes_saved", Object.keys(offHomes).length),
      "textures/ui/jm_at_homes",
    );

  const hasWarnBtn = warnCount > 0 && modCan(admin, "warn");
  const pendingOfflineAppeals = (
    entry.warnAcks ? Object.values(entry.warnAcks) : []
  ).filter((a) => a?.appeal && !a?.appealDenied).length;
  if (hasWarnBtn) {
    const warnBtnLabel =
      pendingOfflineAppeals > 0
        ? t("jm_at.adm.btn_warnings_appeals", pendingOfflineAppeals)
        : t("jm_at.adm.btn_warnings_active_plain", warnCount);
    form.button(warnBtnLabel, "textures/ui/jm_at_warnings");
  }

  // Manage Privileges — only for offline staff targets, gated like the online
  // profile: admins (never mods) manage mods with the modPrivileges privilege;
  // only the owner manages other admins. Role comes from the registry snapshot.
  const targetRole = entry.role ?? "";
  const hasPrivBtn =
    !isMod &&
    !isOwnerTarget &&
    ((targetRole === "moderator" && adminCan(admin, "modPrivileges")) ||
      (targetRole === "admin" && isOwner(admin)));
  if (hasPrivBtn)
    form.button(
      targetRole === "admin"
        ? t("jm_at.adm.btn_manage_priv_admin")
        : t("jm_at.adm.btn_manage_priv_mod"),
      targetRole === "admin"
        ? "textures/ui/jm_at_admin"
        : "textures/ui/jm_at_moderator_controls",
    );

  // Contextual moderation actions
  let banBtnCount = 0;
  // Offline ban/unban is gated for admins by the "offlineModeration" privilege
  // (mods keep their existing tempBan-driven access).
  const _offlineMod = isMod || adminCan(admin, "offlineModeration");
  if (banPun) {
    if (!isMod && _offlineMod && adminCan(admin, "unban")) {
      form.button(t("jm_at.adm.btn_unban_r"), "textures/ui/jm_at_unban");
      banBtnCount = 1;
    }
  } else if (
    !isOwnerTarget &&
    !(isMod && targetRole === "admin") && // a mod can't ban a higher-ranked admin
    modCan(admin, "tempBan") &&
    _offlineMod
  ) {
    if (isMod) {
      form.button(
        t("jm_at.adm.btn_temp_ban_24_r"),
        "textures/ui/jm_at_temp_ban",
      );
      banBtnCount = 1;
    } else {
      form.button(t("jm_at.adm.btn_temp_ban_r"), "textures/ui/jm_at_temp_ban");
      banBtnCount = 1;
      if (adminCan(admin, "permBan")) {
        form.button(t("jm_at.adm.btn_perm_ban_r"), "textures/ui/jm_at_ban");
        banBtnCount = 2;
      }
    }
  }

  form.button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back");
  form.button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const contentBtnCount =
    (hasNotesBtn ? 1 : 0) +
    (hasTicketsBtn ? 1 : 0) +
    (hasPunBtn ? 1 : 0) +
    (hasHomesBtn ? 1 : 0) +
    (hasWarnBtn ? 1 : 0) +
    (hasPrivBtn ? 1 : 0) +
    banBtnCount;

  const res = await form.show(admin);
  if (res.canceled) return back(); // X = Back
  if (res.selection === contentBtnCount + 1) return; // Close
  // Back (res.selection === contentBtnCount) falls through to `return back()` below

  // Resolve button index dynamically
  let idx = res.selection;

  // Admin Notes
  if (hasNotesBtn && idx === 0) {
    const getNotes = () => {
      return readNotes(getPlayerNotes(xuid));
    };
    const setNotes = (notes) => {
      setPlayerNotes(xuid, notes);
    };
    return adminNotesUI(admin, entry.name, getNotes, setNotes, () =>
      showOfflineProfile(admin, xuid, backFn),
    );
  }
  if (hasNotesBtn) idx--;

  // View Tickets
  if (hasTicketsBtn && idx === 0) {
    const meta = getTicketMeta();
    const allIds = [
      ...meta.open,
      ...meta.claimed,
      ...meta.resolved,
      ...meta.closed,
    ];
    const myIds = (entry.myTickets ?? []).filter((id) => allIds.includes(id));
    const tickets = myIds.map((id) => findTicket(id)?.ticket).filter(Boolean);
    if (!tickets.length) {
      tell(admin, t("jm_at.adm.no_tickets_for_player"));
      return showOfflineProfile(admin, xuid, backFn);
    }
    const tf = new ActionFormData()
      .title(t("jm_at.adm.tickets_for_title", entry.name))
      .body(t("jm_at.adm.tickets_select_body"));
    for (const tk of tickets)
      tf.button(
        t(
          "jm_at.adm.tickets_row_simple",
          tk.id,
          _ticketStatusRaw(tk.status),
          tk.category,
        ),
      );
    tf.button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back");
    tf.button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);
    const tr = await tf.show(admin);
    if (tr.canceled) return showOfflineProfile(admin, xuid, backFn); // X = Back
    if (tr.selection < tickets.length) {
      return showTicketDetail(admin, tickets[tr.selection].id, {
        adminView: true,
        onBack: () => showOfflineProfile(admin, xuid, backFn),
        onProfile: (name, profXuid, backToTicket) => {
          const t2 = getOnlinePlayerByName(name);
          if (t2) return showPlayerProfile(admin, t2, backToTicket);
          if (profXuid)
            return showOfflineProfile(admin, profXuid, backToTicket);
          tell(admin, t("jm_at.adm.xuid_not_found"));
        },
      });
    }
    if (tr.selection === tickets.length + 1) return; // Close
    return showOfflineProfile(admin, xuid, backFn); // Back
  }
  if (hasTicketsBtn) idx--;

  // Punishment History
  if (hasPunBtn && idx === 0) {
    const histPuns = puns.slice(0, 15);
    const histBody =
      histPuns.length === 0
        ? t("jm_at.adm.pun_none")
        : raw(
            ...histPuns.flatMap((p, i) => [
              i > 0 ? "\n\n" : "",
              _punishmentEntryRaw(p, entry.warnAcks),
            ]),
          );
    const hf = new ActionFormData()
      .title(t("jm_at.adm.pun_title", entry.name))
      .body(histBody)
      .button(t("jm_at.common.btn_back_bold"))
      .button(CLOSE_BTN_LABEL);
    const hfRes = await hf.show(admin);
    if (hfRes.canceled) return showOfflineProfile(admin, xuid, backFn); // X = Back
    if (hfRes.selection === 1) return; // Close
    return showOfflineProfile(admin, xuid, backFn); // Back
  }
  if (hasPunBtn) idx--;

  // Homes (view + teleport; only shown when the player has saved homes)
  if (hasHomesBtn && idx === 0) {
    return showOfflineHomes(admin, xuid, entry.name, offHomes, backFn);
  }
  if (hasHomesBtn) idx--;

  // Warnings (only shown when warnCount > 0)
  if (hasWarnBtn && idx === 0) {
    return showOfflineWarnings(admin, xuid, backFn);
  }
  if (hasWarnBtn) idx--;

  // Manage Privileges (per-mod / per-admin overrides) — staff targets only
  if (hasPrivBtn && idx === 0) {
    const privBack = () => showOfflineProfile(admin, xuid, backFn);
    return targetRole === "admin"
      ? showAdminOverrides(admin, xuid, entry.name, privBack)
      : showModOverrides(admin, xuid, entry.name, privBack);
  }
  if (hasPrivBtn) idx--;

  // Moderation action buttons — their index depends on banPun state
  try {
    let actionIdx = idx;

    if (banBtnCount > 0) {
      if (banPun) {
        if (actionIdx === 0) {
          doUnbanOffline(admin, entry);
          tell(admin, t("jm_at.adm.unbanned_offline", entry.name));
          return showOfflineProfile(admin, xuid, backFn);
        }
      } else {
        if (isMod) {
          if (actionIdx === 0)
            return showOfflineBanModal(admin, entry, false, xuid, backFn, true);
        } else {
          if (actionIdx === 0)
            return showOfflineBanModal(
              admin,
              entry,
              false,
              xuid,
              backFn,
              false,
            );
          if (actionIdx === 1)
            return showOfflineBanModal(admin, entry, true, xuid, backFn, false);
        }
      }
    }
  } catch (e) {
    return warnForm(
      admin,
      t("jm_at.common.error_generic", e?.message ?? t("jm_at.adm.err_unknown")),
      () => back(),
    );
  }

  return back();
}

async function showOfflineBanModal(
  admin,
  entry,
  perm,
  xuid,
  backFn,
  capTo24h,
  initial = {},
) {
  const MAX_MOD_BAN_MS = 24 * 60 * 60 * 1000;
  const back = () => showOfflineProfile(admin, xuid, backFn);
  const reasonObs = new ObservableString(initial.reason ?? "", {
    clientWritable: true,
  });
  const durObs = new ObservableString(initial.dur ?? (capTo24h ? "1h" : "7d"), {
    clientWritable: true,
  });
  const durPreview = new ObservableString("");
  const status = new ObservableString("");
  const statusShown = new ObservableBoolean(false);
  let pendingNav = null;
  let intent = null; // "back" set by Back; null = ✕/engine close/escape → exit

  const refreshDur = () => {
    const ms = parseDuration(String(durObs.getData() ?? "").trim());
    if (ms <= 0) {
      durPreview.setData("§c请输入有效时长，例如 30m（30分钟）、1h（1小时）、7d（7天）。");
      return;
    }
    const capped = capTo24h && ms > MAX_MOD_BAN_MS;
    durPreview.setData(
      `§7= ${fmtDuration(capped ? MAX_MOD_BAN_MS : ms)}${capped ? " §6（最多24小时）" : ""}`,
    );
  };
  if (!perm) {
    refreshDur();
    durObs.subscribe(refreshDur);
  }

  const titleKey = perm
    ? "jm_at.adm.ban_title_perm"
    : capTo24h
      ? "jm_at.adm.ban_title_temp24"
      : "jm_at.adm.ban_title_temp";
  const form = new CustomForm(admin, t(titleKey, entry.name));
  form.spacer();
  form.textField(t("jm_at.adm.field_reason"), reasonObs, {
    description: t("jm_at.adm.field_reason_ban_desc"),
  });
  if (!perm) {
    form.textField(
      capTo24h
        ? t("jm_at.adm.field_duration_24")
        : t("jm_at.adm.field_duration"),
      durObs,
      {
        description: capTo24h
          ? t("jm_at.adm.field_dur_desc_1h")
          : t("jm_at.adm.field_dur_desc_7d"),
      },
    );
    form.spacer();
    form.label(durPreview);
  }
  form.spacer();
  form.label(status, { visible: statusShown });
  form.spacer({ visible: statusShown });

  const submit = (close) => {
    const reason = clampText(String(reasonObs.getData() ?? "").trim(), 200);
    let durMs = perm ? 0 : parseDuration(String(durObs.getData() ?? "").trim());
    if (!perm && durMs <= 0) {
      status.setData("§c时长无效，请使用 30m、1h 或 7d 等格式。");
      statusShown.setData(true);
      return;
    }
    if (capTo24h && durMs > MAX_MOD_BAN_MS) durMs = MAX_MOD_BAN_MS;
    if (reason.length < 2) {
      status.setData("§c原因过短，请补充说明。");
      statusShown.setData(true);
      return;
    }
    try {
      doBanOffline(admin, entry, reason, durMs);
      tell(
        admin,
        perm
          ? t("jm_at.adm.banned_perm_offline", entry.name)
          : t(
              "jm_at.adm.banned_temp_offline",
              fmtDurationRaw(durMs),
              entry.name,
            ),
      );
    } catch (e) {
      status.setData(
        `§c操作失败：${e?.message ?? "未知错误。"}`,
      );
      statusShown.setData(true);
      return;
    }
    pendingNav = close ? () => {} : back;
    try {
      form.close();
    } catch {}
  };
  form.button(
    t(perm ? "jm_at.adm.btn_perm_ban_plain" : "jm_at.adm.btn_ban_plain"),
    () => submit(false),
  );
  form.button(
    t(perm ? "jm_at.adm.btn_perm_ban_close" : "jm_at.adm.btn_ban_close"),
    () => submit(true),
  );
  form.button(t("jm_at.common.btn_back"), () => {
    intent = "back";
    try {
      form.close();
    } catch {}
  });

  const closeReason = await form.show();
  if (closeReason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(() =>
      showOfflineBanModal(admin, entry, perm, xuid, backFn, capTo24h, {
        reason: reasonObs.getData(),
        dur: durObs.getData(),
      }),
    );
  }
  if (pendingNav) return system.run(pendingNav);
  // Back → profile; ✕ / engine close / escape → exit to game. If a reason was
  // typed, confirm first — Keep editing reopens with the reason + duration kept.
  const goBack = intent === "back";
  if (reasonObs.getData().trim().length > 0) {
    const keep = { reason: reasonObs.getData(), dur: durObs.getData() };
    return system.run(async () => {
      if (await confirmDiscardChanges(admin))
        return showOfflineBanModal(
          admin,
          entry,
          perm,
          xuid,
          backFn,
          capTo24h,
          keep,
        );
      if (goBack) return back();
    });
  }
  if (goBack) return system.run(back);
}

// =========================================================
// Offline Homes (view / teleport to an offline player's homes)
// =========================================================

/** Short dimension name for home rows (translated). */
// lang-keys: jm_at.adm.dim_short_*
function _dimShortRaw(d) {
  if (d === "minecraft:nether") return t("jm_at.adm.dim_short_nether");
  if (d === "minecraft:the_end") return t("jm_at.common.dim_end");
  return t("jm_at.adm.dim_short_overworld");
}

async function showOfflineHomes(admin, xuid, name, homes, backFn = null) {
  const names = Object.keys(homes).sort((a, b) => a.localeCompare(b));

  if (names.length === 0) {
    return warnForm(admin, t("jm_at.adm.no_homes", name), () =>
      showOfflineProfile(admin, xuid, backFn),
    );
  }

  const form = new ActionFormData()
    .title(t("jm_at.adm.homes_title", name))
    .body(t("jm_at.adm.homes_count", names.length));

  for (const n of names) {
    const h = homes[n];
    form.button(
      t(
        "jm_at.adm.home_row",
        n,
        _dimShortRaw(h.dimension),
        Math.floor(h.x),
        Math.floor(h.y),
        Math.floor(h.z),
      ),
      getHomeIconPath(h),
    );
  }
  form.button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back");
  form.button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(admin);
  if (res.canceled) return showOfflineProfile(admin, xuid, backFn); // X = Back
  if (res.selection === names.length)
    return showOfflineProfile(admin, xuid, backFn); // Back
  if (res.selection === names.length + 1) return; // Close

  const homeName = names[res.selection];
  const h = homes[homeName];

  // Delete is admin-only; moderators get view + teleport (mirrors showAdminHomes).
  const canDelete = isAdmin(admin).ok;
  const detail = new ActionFormData()
    .title(t("jm_at.adm.homes_detail_title", name, homeName))
    .body(
      t(
        "jm_at.adm.home_detail_body",
        homeName,
        _dimShortRaw(h.dimension),
        Math.floor(h.x),
        Math.floor(h.y),
        Math.floor(h.z),
      ),
    )
    .button(t("jm_at.deathback.btn_tp"), "textures/ui/jm_at_tp_to_home");
  if (canDelete)
    detail.button(t("jm_at.adm.btn_delete_red"), "textures/ui/jm_at_remove");
  detail.button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back");
  detail.button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const dRes = await detail.show(admin);
  if (dRes.canceled) return showOfflineHomes(admin, xuid, name, homes, backFn); // X = Back

  let di = dRes.selection;
  if (di === 0) {
    // Teleport
    return visitHome(admin, xuid, homeName, () =>
      showOfflineHomes(admin, xuid, name, getOfflineHomes(xuid), backFn));
  }
  di -= 1; // consumed Teleport

  if (canDelete) {
    if (di === 0) {
      // Delete (confirm first — coordinates are unrecoverable). Removed from the
      // staff-visible mirror now and from the player's own home store on their
      // next login; see deleteOfflineHome.
      const conf = await new MessageFormData()
        .title(t("jm_at.adm.home_delete_title"))
        .body(
          t(
            "jm_at.adm.home_delete_body",
            name,
            homeName,
            _dimShortRaw(h.dimension),
            Math.floor(h.x),
            Math.floor(h.y),
            Math.floor(h.z),
          ),
        )
        .button1(t("jm_at.common.btn_cancel"))
        .button2(t("jm_at.adm.btn_delete_red"))
        .show(admin);
      if (conf.canceled || conf.selection === 0)
        return showOfflineHomes(admin, xuid, name, homes, backFn);
      const latestHome = getOfflineHomes(xuid)[homeName];
      if (!latestHome || (latestHome.destinationId || "legacy") !== (h.destinationId || "legacy")) {
        tell(admin, "§e家园已删除或重新创建，请刷新后再操作。");
        return showOfflineHomes(admin, xuid, name, getOfflineHomes(xuid), backFn);
      }
      if (!deleteOfflineHome(xuid, homeName, h.destinationId || "legacy")) {
        tell(admin, "§c家园删除未保存或目标已变化，请刷新后重试。");
        return showOfflineHomes(admin, xuid, name, getOfflineHomes(xuid), backFn);
      }
      delete homes[homeName]; // keep the in-memory list in sync for re-render
      logAdmin(admin, "HOME_DELETE", `${name}: ${homeName}（离线）`);
      tell(admin, t("jm_at.adm.home_deleted", homeName, name));
      return showOfflineHomes(admin, xuid, name, homes, backFn);
    }
    di -= 1; // consumed Delete
  }

  if (di === 0) return showOfflineHomes(admin, xuid, name, homes, backFn); // Back
  return; // Close
}

// =========================================================
// Player Profile
// =========================================================

export async function showPlayerProfile(admin, target, backFn = null) {
  try {
    requireStaff(admin, "玩家资料");
  } catch {
    return;
  }

  const core = getPlayerCore(target);
  const cfg = getCfg();
  const banPun = hasActivePunishment(target, "BAN");
  const isFrozen = target.hasTag(`${NS}:frozen`);
  const now = Date.now();
  const warnCount = (core.punishments ?? []).filter(
    (p) =>
      p.type === "WARN" && p.active && (p.expiresAt === 0 || p.expiresAt > now),
  ).length;
  const warnThresh = cfg.warnThreshold ?? 3;
  const warnFlag = warnCount >= warnThresh ? t("jm_at.adm.warn_flag") : "";

  const statusTags = [
    banPun ? t("jm_at.adm.tag_banned") : "",
    isFrozen ? t("jm_at.adm.tag_frozen") : "",
  ].filter(Boolean);
  const statusLine = statusTags.length
    ? raw(...statusTags.flatMap((tag, i) => (i > 0 ? [" ", tag] : [tag])))
    : t("jm_at.adm.status_active");

  let gamemodeLine = "";
  try {
    gamemodeLine = t(
      "jm_at.adm.profile_gamemode_line",
      target.getGameMode?.() ?? t("jm_at.time.unknown"),
    );
  } catch {}

  const spyCount = (core.spyHistory ?? []).length;
  // Personal/owner claims only — admin claims aren't in byOwner, and sub-claims
  // live under byParent, so getClaimsByOwner returns top-level personal claims.
  const claimCount = getClaimsByOwner(core.xuid).filter(
    (c) => !c.isAdminClaim,
  ).length;

  // Rank display line
  const rankPrefix = getEffectiveRankPrefix(target, core);
  const rankEnabled = core.rankTagEnabled !== false;
  const rankDisplay = rankPrefix
    ? rankEnabled
      ? rankPrefix
      : t("jm_at.adm.rank_hidden_suffix", rankPrefix)
    : t("jm_at.adm.rank_none");
  const rankLine = t("jm_at.adm.profile_rank_line", rankDisplay);

  const body = raw(
    t("jm_at.adm.profile_1", target.name, statusLine, core.xuid),
    gamemodeLine,
    rankLine,
    "\n",
    t(
      "jm_at.adm.profile_2",
      fmtMsRaw(core.firstSeen),
      fmtMsRaw(core.lastSeen),
      fmtDimRaw(core.lastDim),
      core.lastPos?.x ?? 0,
      core.lastPos?.y ?? 0,
      core.lastPos?.z ?? 0,
    ),
    "\n",
    t("jm_at.adm.profile_3", (core.myTickets ?? []).length, warnCount),
    warnFlag,
    spyCount ? t("jm_at.adm.profile_spy_line", spyCount) : "",
    "\n",
    t("jm_at.adm.profile_claims_line", claimCount),
  );

  const form = new ActionFormData()
    .title(t("jm_at.adm.profile_title", target.name))
    .body(body);

  const activeWarns = (core.punishments ?? []).filter(
    (p) =>
      p.type === "WARN" && p.active && (p.expiresAt === 0 || p.expiresAt > now),
  );
  const pendingAppeals = activeWarns.filter(
    (p) =>
      core.warnAcks?.[p.id]?.appeal && !core.warnAcks?.[p.id]?.appealDenied,
  );
  const warnsLabel =
    activeWarns.length > 0
      ? pendingAppeals.length > 0
        ? t("jm_at.adm.btn_warnings_appeals", pendingAppeals.length)
        : t("jm_at.adm.btn_warnings_active", activeWarns.length)
      : null;

  const hasTicketsBtn = modCan(admin, "tickets");
  form.button(t("jm_at.adm.btn_actions"), "textures/ui/jm_at_actions");
  if (hasTicketsBtn)
    form.button(
      t("jm_at.adm.btn_view_tickets"),
      "textures/ui/jm_at_my_tickets",
    );
  if (modCan(admin, "punishmentHistory"))
    form.button(
      t("jm_at.adm.btn_pun_history"),
      "textures/ui/jm_at_punishment_history",
    );
  if (warnsLabel && modCan(admin, "warn"))
    form.button(warnsLabel, "textures/ui/jm_at_warnings");
  if (spyCount > 0 && modCan(admin, "spyCamera"))
    form.button(
      t("jm_at.adm.btn_spy_history"),
      "textures/ui/jm_at_spy_history",
    );
  if (modCan(admin, "adminNotes"))
    form.button(t("jm_at.adm.btn_admin_notes"), "textures/ui/jm_at_admin_note");
  if (modCan(admin, "rankPanel"))
    form.button(t("jm_at.adm.btn_rank"), "textures/ui/jm_at_rank");
  const homeCount = Object.keys(getHomes(target)).length;
  if (homeCount > 0 && modCan(admin, "homes"))
    form.button(
      t("jm_at.adm.btn_homes_saved", homeCount),
      "textures/ui/jm_at_homes",
    );
  form.button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back");
  form.button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  // Build button index map dynamically
  const hasWarnsBtn = !!warnsLabel && modCan(admin, "warn");
  const hasSpyBtn = spyCount > 0 && modCan(admin, "spyCamera");
  const hasPunBtn = modCan(admin, "punishmentHistory");
  const hasNotesBtn = modCan(admin, "adminNotes");
  const hasRankBtn = modCan(admin, "rankPanel");
  const hasHomesBtn = homeCount > 0 && modCan(admin, "homes");
  let idx = 1;
  const ticketsIdx = hasTicketsBtn ? idx++ : -1;
  const punIdx = hasPunBtn ? idx++ : -1;
  const warnsIdx = hasWarnsBtn ? idx++ : -1;
  const spyHistIdx = hasSpyBtn ? idx++ : -1;
  const notesIdx = hasNotesBtn ? idx++ : -1;
  const rankIdx = hasRankBtn ? idx++ : -1;
  const homesIdx = hasHomesBtn ? idx++ : -1;
  const backIdx = idx;
  const closeIdx = idx + 1;

  const goBack = () => {
    if (backFn) return backFn();
    return showOnlinePlayers(admin);
  };

  const res = await form.show(admin);
  if (res.canceled) return goBack(); // X = Back
  if (res.selection === closeIdx) return; // Close
  if (res.selection === backIdx) return goBack();
  if (res.selection === 0) return showActionsPanel(admin, target, backFn);
  if (hasTicketsBtn && res.selection === ticketsIdx)
    return showPlayerTicketHistory(admin, target, backFn);
  if (hasPunBtn && res.selection === punIdx)
    return showPunishmentHistory(admin, target, backFn);
  if (hasWarnsBtn && res.selection === warnsIdx)
    return showAdminWarnings(admin, target, backFn);
  if (hasSpyBtn && res.selection === spyHistIdx)
    return showSpyHistory(admin, target, backFn);
  if (hasNotesBtn && res.selection === notesIdx)
    return showAdminNotes(admin, target, backFn);
  if (hasRankBtn && res.selection === rankIdx)
    return showRankPanel(admin, target, backFn);
  if (hasHomesBtn && res.selection === homesIdx)
    return showAdminHomes(admin, target, backFn);
}

// =========================================================
// Actions Panel
// =========================================================

export async function showActionsPanel(admin, target, backFn = null) {
  try {
    requireStaff(admin, "玩家操作面板");
  } catch {
    return;
  }
  const isMod = isModerator(admin);

  const isFrozen = target.hasTag(`${NS}:frozen`);
  const isBanned = !!hasActivePunishment(target, "BAN");
  const isModeTarget = isModerator(target);
  const isAdminTarget = isAdmin(target).ok;
  const isOwnerTarget = isOwner(target);
  const spyActive = isSpying(admin);
  const back = () => showActionsPanel(admin, target, backFn);

  // A moderator may not use intrusive actions on a higher-ranked admin. The
  // action functions enforce this (requireOutranksTarget); hiding the buttons
  // here keeps the UI honest so the mod never sees an action that would fail.
  const cantTargetHigher = isMod && isAdminTarget;

  // Buttons carry an `action` key — dispatch below is key-based, never by
  // label text (labels are now translated RawMessages).
  const btns = [];
  // The server owner's inventory is fully off-limits to other staff — no
  // viewing, taking, removing, or clearing — so the button is hidden for owner
  // targets, matching how Freeze/Warn/Kick/Ban are hidden below. Dispatch is by
  // action key, so omitting it doesn't shift any other button's index.
  if (modCan(admin, "viewInventory") && !isOwnerTarget && !cantTargetHigher)
    btns.push({
      label: t("jm_at.adm.btn_view_inventory"),
      icon: "textures/ui/jm_at_inventory",
      action: "inventory",
    });
  if (modCan(admin, "spyCamera") && !cantTargetHigher)
    btns.push(
      spyActive
        ? {
            label: t("jm_at.adm.btn_stop_spy"),
            icon: "textures/ui/jm_at_spy",
            action: "stopSpy",
          }
        : {
            label: t("jm_at.adm.btn_spy"),
            icon: "textures/ui/jm_at_spy",
            action: "spy",
          },
    );
  if (modCan(admin, "heal"))
    btns.push({
      label: t("jm_at.adm.btn_heal"),
      icon: "textures/ui/jm_at_heal",
      action: "heal",
    });
  if (modCan(admin, "feed"))
    btns.push({
      label: t("jm_at.adm.btn_feed"),
      icon: "textures/ui/jm_at_feed",
      action: "feed",
    });
  if (modCan(admin, "freeze") && !isOwnerTarget && !cantTargetHigher)
    btns.push(
      isFrozen
        ? {
            label: t("jm_at.adm.btn_unfreeze"),
            icon: "textures/ui/jm_at_freeze",
            action: "unfreeze",
          }
        : {
            label: t("jm_at.adm.btn_freeze"),
            icon: "textures/ui/jm_at_freeze",
            action: "freeze",
          },
    );
  if (modCan(admin, "tpToPlayer") && !isOwnerTarget && !cantTargetHigher)
    btns.push({
      label: t("jm_at.adm.btn_tp_to_plain"),
      icon: "textures/ui/jm_at_tp_to",
      action: "tpTo",
    });
  if (modCan(admin, "summon") && !isOwnerTarget && !cantTargetHigher)
    btns.push({
      label: t("jm_at.adm.btn_summon_plain"),
      icon: "textures/ui/jm_at_summon",
      action: "summon",
    });
  if (modCan(admin, "warn") && !isOwnerTarget && !cantTargetHigher)
    btns.push({
      label: t("jm_at.adm.btn_warn"),
      icon: "textures/ui/jm_at_warn",
      action: "warn",
    });
  if (modCan(admin, "kick") && !isOwnerTarget && !cantTargetHigher)
    btns.push({
      label: t("jm_at.adm.btn_kick"),
      icon: "textures/ui/jm_at_kick",
      action: "kick",
    });
  if (modCan(admin, "tempBan")) {
    if (isMod) {
      if (!isOwnerTarget && !isAdminTarget)
        btns.push(
          isBanned
            ? {
                label: t("jm_at.adm.btn_already_banned"),
                icon: "textures/ui/jm_at_temp_ban",
                action: "noop",
              }
            : {
                label: t("jm_at.adm.btn_temp_ban_24_lan"),
                icon: "textures/ui/jm_at_temp_ban",
                action: "tempBan24",
              },
        );
    } else {
      if (!isOwnerTarget) {
        if (isBanned) {
          if (adminCan(admin, "unban"))
            btns.push({
              label: t("jm_at.adm.btn_unban_plain"),
              icon: "textures/ui/jm_at_unban",
              action: "unban",
            });
        } else {
          btns.push({
            label: t("jm_at.adm.btn_temp_ban_lan"),
            icon: "textures/ui/jm_at_temp_ban",
            action: "tempBan",
          });
          if (adminCan(admin, "permBan"))
            btns.push({
              label: t("jm_at.adm.btn_perm_ban_lan"),
              icon: "textures/ui/jm_at_ban",
              action: "permBan",
            });
        }
      }
    }
  }
  if (modCan(admin, "gamemode") && !cantTargetHigher) {
    btns.push({
      label: t("jm_at.adm.btn_change_gamemode"),
      icon: "textures/ui/jm_at_gamemode",
      action: "gamemode",
    });
  }
  // Moderator management (admin only, never delegated)
  if (!isMod) {
    if (isModeTarget && adminCan(admin, "modPrivileges"))
      btns.push({
        label: t("jm_at.adm.btn_manage_priv_mod"),
        icon: "textures/ui/jm_at_moderator_controls",
        action: "managePrivMod",
      });
    if (isAdminTarget && !isOwnerTarget && isOwner(admin))
      btns.push({
        label: t("jm_at.adm.btn_manage_priv_admin"),
        icon: "textures/ui/jm_at_admin",
        action: "managePrivAdmin",
      });
    if (adminCan(admin, "manageRoles")) {
      btns.push(
        isAdminTarget
          ? {
              label: t("jm_at.adm.btn_cannot_mod_admin"),
              icon: "textures/ui/jm_at_moderator",
              action: "noop",
            }
          : isModeTarget
            ? {
                label: t("jm_at.adm.btn_remove_mod"),
                icon: "textures/ui/jm_at_moderator",
                action: "removeMod",
              }
            : {
                label: t("jm_at.adm.btn_assign_mod"),
                icon: "textures/ui/jm_at_moderator",
                action: "assignMod",
              },
      );
      btns.push(
        isOwnerTarget
          ? {
              label: t("jm_at.adm.btn_cannot_owner_admin"),
              icon: "textures/ui/jm_at_admin",
              action: "noop",
            }
          : isAdminTarget
            ? {
                label: t("jm_at.adm.btn_remove_admin"),
                icon: "textures/ui/jm_at_admin",
                action: "removeAdmin",
              }
            : {
                label: t("jm_at.adm.btn_assign_admin"),
                icon: "textures/ui/jm_at_admin",
                action: "assignAdmin",
              },
      );
    }
  }
  btns.push({
    label: t("jm_at.common.btn_back_bold"),
    icon: "textures/ui/jm_at_back",
    action: "back",
  });
  btns.push({ label: CLOSE_BTN_LABEL, icon: CLOSE_BTN_ICON, action: "close" });

  const form = new ActionFormData()
    .title(t("jm_at.adm.actions_title", target.name))
    .body(t("jm_at.adm.actions_body", target.name));
  for (const b of btns) form.button(b.label, b.icon);

  const res = await form.show(admin);
  if (res.canceled) return showPlayerProfile(admin, target, backFn); // X = Back

  if (res.selection >= btns.length) return;
  const action = btns[res.selection].action;
  if (action === "back") return showPlayerProfile(admin, target, backFn);
  if (action === "close") return; // Close

  try {
    if (action === "inventory") return showInventoryViewer(admin, target, back);
    if (action === "warn") return showWarnModal(admin, target, back);
    if (action === "freeze") {
      doFreeze(admin, target);
      tell(admin, t("jm_at.adm.froze_done", target.name));
    }
    if (action === "unfreeze") {
      doUnfreeze(admin, target);
      tell(admin, t("jm_at.adm.unfroze_done", target.name));
    }
    if (action === "kick") return showKickModal(admin, target, back);
    if (action === "tempBan")
      return showBanModal(admin, target, false, back, false);
    if (action === "tempBan24")
      return showBanModal(admin, target, false, back, true);
    if (action === "permBan")
      return showBanModal(admin, target, true, back, false);
    if (action === "unban") {
      doUnban(admin, target);
      tell(admin, t("jm_at.adm.unban_done", target.name));
    }
    if (action === "tpTo") {
      doTpTo(admin, target);
    }
    if (action === "summon") {
      doSummon(admin, target);
    }
    if (action === "heal") {
      doHeal(admin, target);
    }
    if (action === "feed") {
      doFeed(admin, target);
    }
    if (action === "spy") {
      startSpy(admin, target.name);
      tell(admin, t("jm_at.adm.spy_watching", target.name));
      return;
    }
    if (action === "stopSpy") {
      const stopped = stopSpy(admin);
      tell(admin, stopped ? t("jm_at.adm.spy_ended") : t("jm_at.adm.spy_none"));
    }
    if (action === "gamemode") return showGamemodeModal(admin, target, back);
    if (action === "managePrivMod")
      return showModOverrides(admin, getPlayerXuid(target), target.name, back);
    if (action === "managePrivAdmin")
      return showAdminOverrides(
        admin,
        getPlayerXuid(target),
        target.name,
        back,
      );
    if (action === "assignMod") {
      if (isAdminTarget) {
        return warnForm(admin, t("jm_at.adm.cannot_mod_admin_warn"), () =>
          back(),
        );
      }
      assignModerator(target);
      logAdmin(admin, "MOD_ASSIGN", "", target.name);
      tell(admin, t("jm_at.adm.mod_assigned_admin", target.name));
      tell(target, t("jm_at.adm.mod_assigned_target"));
      // Auto-give the admin tool if they don't already have it
      const core = getPlayerCore(target);
      if (!core.hasAdminTool) {
        if (giveItem(target, ITEMS.adminTool)) {
          core.hasAdminTool = true;
          setPlayerCore(target, core);
          tell(target, t("jm_at.adm.admin_tool_received"));
        }
      }
      return back();
    }
    if (action === "removeMod") {
      removeModerator(target);
      try {
        target.setDynamicProperty(PKEY.modOverrides, undefined);
      } catch {}
      setModOverrides(getPlayerXuid(target), {}); // clear world-level overrides
      logAdmin(admin, "MOD_REMOVE", "", target.name);
      tell(admin, t("jm_at.adm.mod_removed_admin", target.name));
      tell(target, t("jm_at.adm.mod_removed_target"));
      // Reset hasAdminTool so the tool is re-given if they're promoted again later.
      const coreRm = getPlayerCore(target);
      coreRm.hasAdminTool = false;
      setPlayerCore(target, coreRm);
      return back();
    }
    if (action === "assignAdmin") {
      if (isOwnerTarget) {
        return warnForm(admin, t("jm_at.adm.cannot_change_owner"), () =>
          back(),
        );
      }
      // If they're a moderator, remove mod role first (admin outranks mod)
      if (isModeTarget) removeModerator(target);
      // Clear any deny-list entry so a previously-removed OP regains access.
      setAdminDenied(getPlayerXuid(target), false);
      target.addTag("admin");
      assignAdmin(target); // record the private, un-spoofable admin role
      // Re-stamp ownerIsAdmin on this player's existing claims so other staff get
      // the correct bypass gate immediately instead of waiting for them to rejoin.
      refreshOwnerAdminFlag(getPlayerXuid(target), true);
      logAdmin(admin, "ADMIN_ASSIGN", "", target.name);
      tell(admin, t("jm_at.adm.admin_assigned_admin", target.name));
      tell(target, t("jm_at.adm.admin_granted"));
      const coreA = getPlayerCore(target);
      if (!coreA.hasAdminTool) {
        if (giveItem(target, ITEMS.adminTool)) {
          coreA.hasAdminTool = true;
          setPlayerCore(target, coreA);
          tell(target, t("jm_at.adm.admin_tool_received"));
        }
      }
      return back();
    }
    if (action === "removeAdmin") {
      if (isOwnerTarget) {
        return warnForm(admin, t("jm_at.adm.cannot_remove_owner_admin"), () =>
          back(),
        );
      }
      // Confirm first — admin removal is hard to undo (the affected person can't
      // restore it themselves), and self-removal is especially easy to do by
      // accident, so warn extra-clearly when the target is the acting admin.
      const isSelf = target.id === admin.id;
      const confirm = await new MessageFormData()
        .title(
          isSelf
            ? t("jm_at.adm.remove_admin_self_title")
            : t("jm_at.adm.remove_admin_title"),
        )
        .body(
          isSelf
            ? t("jm_at.adm.remove_admin_self_body")
            : t("jm_at.adm.remove_admin_body", target.name),
        )
        .button1(t("jm_at.common.btn_cancel"))
        .button2(
          isSelf
            ? t("jm_at.adm.btn_remove_my_admin")
            : t("jm_at.adm.btn_remove_admin_confirm"),
        )
        .show(admin);
      if (confirm.canceled || confirm.selection !== 1) return back();
      // Remove the tag (covers tag-granted admins) AND add to the deny-list
      // (covers operators — removing the tag alone wouldn't revoke their access
      // since op level still satisfies isAdmin). They keep operator status.
      target.removeTag("admin");
      clearStaffRole(target); // drop the private admin record so the tag isn't re-trusted
      setAdminDenied(getPlayerXuid(target), true);
      // Clear ownerIsAdmin on their claims so they're governed by the normal
      // claimBypass gate again immediately, not after a relog.
      refreshOwnerAdminFlag(getPlayerXuid(target), false);
      // Clear admin tool grant state so re-promotion will re-grant the item
      try {
        const coreR = getPlayerCore(target);
        coreR.hasAdminTool = false;
        setPlayerCore(target, coreR);
      } catch {}
      setAdminOverrides(getPlayerXuid(target), {}); // clear world-level overrides
      logAdmin(admin, "ADMIN_REMOVE", "", target.name);
      if (isSelf) {
        // Self-removal: target and admin are the same person, so send one message.
        tell(admin, t("jm_at.adm.removed_own_admin"));
      } else {
        tell(admin, t("jm_at.adm.removed_admin_admin", target.name));
        tell(target, t("jm_at.adm.removed_admin_target"));
      }
      return back();
    }
  } catch (e) {
    return warnForm(
      admin,
      t("jm_at.common.error_generic", e?.message ?? t("jm_at.adm.err_unknown")),
      () => back(),
    );
  }

  return back();
}

// =========================================================
// Action modals
// =========================================================

async function showWarnModal(admin, target, back, initial = {}) {
  const reasonObs = new ObservableString(initial.reason ?? "", {
    clientWritable: true,
  });
  const status = new ObservableString("");
  const statusShown = new ObservableBoolean(false);
  let pendingNav = null;
  let intent = null; // "back" set by Back; null = ✕/engine close/escape → exit

  const form = new CustomForm(admin, t("jm_at.adm.warn_title", target.name));
  form.spacer();
  form.textField(t("jm_at.adm.field_reason"), reasonObs, {
    description: t("jm_at.adm.field_reason_brief_desc"),
  });
  form.spacer();
  form.label(status, { visible: statusShown });
  form.spacer({ visible: statusShown });

  const submit = (close) => {
    const reason = clampText(String(reasonObs.getData() ?? "").trim(), 200);
    if (reason.length < 2) {
      status.setData("§c原因过短，请补充说明。");
      statusShown.setData(true);
      return;
    }
    doWarn(admin, target, reason);
    tell(admin, t("jm_at.adm.warned_done", target.name));
    pendingNav = close ? () => {} : back;
    try {
      form.close();
    } catch {}
  };
  form.button(t("jm_at.adm.btn_warn_plain"), () => submit(false));
  form.button(t("jm_at.adm.btn_warn_close"), () => submit(true));
  form.button(t("jm_at.common.btn_back"), () => {
    intent = "back";
    try {
      form.close();
    } catch {}
  });

  const closeReason = await form.show();
  if (closeReason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(() =>
      showWarnModal(admin, target, back, { reason: reasonObs.getData() }),
    );
  }
  if (pendingNav) return system.run(pendingNav);
  // Back → profile; ✕ / engine close / escape → exit to game. If a reason was
  // typed, confirm first — Keep editing reopens with the text preserved.
  const goBack = intent === "back";
  if (reasonObs.getData().trim().length > 0) {
    const keep = { reason: reasonObs.getData() };
    return system.run(async () => {
      if (await confirmDiscardChanges(admin))
        return showWarnModal(admin, target, back, keep);
      if (goBack) return back();
    });
  }
  if (goBack) return system.run(back);
}

async function showKickModal(admin, target, back, initial = {}) {
  const reasonObs = new ObservableString(initial.reason ?? "", {
    clientWritable: true,
  });
  const status = new ObservableString("");
  const statusShown = new ObservableBoolean(false);
  let pendingNav = null;
  let intent = null; // "back" set by Back; null = ✕/engine close/escape → exit

  const form = new CustomForm(admin, t("jm_at.adm.kick_title", target.name));
  form.spacer();
  form.textField(t("jm_at.adm.field_reason"), reasonObs, {
    description: t("jm_at.adm.field_reason_kick_desc"),
  });
  form.spacer();
  form.label(status, { visible: statusShown });
  form.spacer({ visible: statusShown });

  // Confirmation dialog runs after the form closes (a tick must pass before
  // opening another form). `close` decides where we land after a kick: exit to
  // game (Kick & Close) or back to the profile (Kick).
  const confirmKick = async (reason, close) => {
    const confirm = await new MessageFormData()
      .title(t("jm_at.adm.kick_confirm_title"))
      .body(t("jm_at.adm.kick_confirm_body", target.name, reason))
      .button1(t("jm_at.common.btn_cancel"))
      .button2(t("jm_at.adm.btn_kick_confirm"))
      .show(admin);
    if (!confirm.canceled && confirm.selection === 1) {
      doKick(admin, target, reason);
      return close ? undefined : back();
    }
    return back();
  };

  const submit = (close) => {
    const reason = clampText(String(reasonObs.getData() ?? "").trim(), 200);
    if (reason.length < 2) {
      status.setData("§c原因过短，请补充说明。");
      statusShown.setData(true);
      return;
    }
    pendingNav = () => confirmKick(reason, close);
    try {
      form.close();
    } catch {}
  };
  form.button(t("jm_at.adm.btn_kick_plain"), () => submit(false));
  form.button(t("jm_at.adm.btn_kick_close"), () => submit(true));
  form.button(t("jm_at.common.btn_back"), () => {
    intent = "back";
    try {
      form.close();
    } catch {}
  });

  const closeReason = await form.show();
  if (closeReason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(() =>
      showKickModal(admin, target, back, { reason: reasonObs.getData() }),
    );
  }
  if (pendingNav) return system.run(pendingNav);
  // Back → profile; ✕ / engine close / escape → exit to game. If a reason was
  // typed, confirm first — Keep editing reopens with the text preserved.
  const goBack = intent === "back";
  if (reasonObs.getData().trim().length > 0) {
    const keep = { reason: reasonObs.getData() };
    return system.run(async () => {
      if (await confirmDiscardChanges(admin))
        return showKickModal(admin, target, back, keep);
      if (goBack) return back();
    });
  }
  if (goBack) return system.run(back);
}

async function showBanModal(
  admin,
  target,
  perm,
  back,
  capTo24h = false,
  initial = {},
) {
  const MAX_MOD_BAN_MS = 24 * 60 * 60 * 1000; // 24 hours
  const reasonObs = new ObservableString(initial.reason ?? "", {
    clientWritable: true,
  });
  const durObs = new ObservableString(initial.dur ?? (capTo24h ? "1h" : "7d"), {
    clientWritable: true,
  });
  const durPreview = new ObservableString("");
  const status = new ObservableString("");
  const statusShown = new ObservableBoolean(false);
  let pendingNav = null;
  let intent = null; // "back" set by Back; null = ✕/engine close/escape → exit

  // Live-parse the duration field so the admin sees exactly how long the ban
  // will be (and any 24h cap) before committing.
  const refreshDur = () => {
    const ms = parseDuration(String(durObs.getData() ?? "").trim());
    if (ms <= 0) {
      durPreview.setData("§c请输入有效时长，例如 30m（30分钟）、1h（1小时）、7d（7天）。");
      return;
    }
    const capped = capTo24h && ms > MAX_MOD_BAN_MS;
    durPreview.setData(
      `§7= ${fmtDuration(capped ? MAX_MOD_BAN_MS : ms)}${capped ? " §6（最多24小时）" : ""}`,
    );
  };
  if (!perm) {
    refreshDur();
    durObs.subscribe(refreshDur);
  }

  const titleKey = perm
    ? "jm_at.adm.ban_title_perm"
    : capTo24h
      ? "jm_at.adm.ban_title_temp24"
      : "jm_at.adm.ban_title_temp";
  const form = new CustomForm(admin, t(titleKey, target.name));
  form.spacer();
  form.textField(t("jm_at.adm.field_reason"), reasonObs, {
    description: t("jm_at.adm.field_reason_ban_desc"),
  });
  if (!perm) {
    form.textField(
      capTo24h
        ? t("jm_at.adm.field_duration_24")
        : t("jm_at.adm.field_duration"),
      durObs,
      {
        description: capTo24h
          ? t("jm_at.adm.field_dur_desc_1h")
          : t("jm_at.adm.field_dur_desc_7d"),
      },
    );
    form.spacer();
    form.label(durPreview);
  }
  form.spacer();
  form.label(status, { visible: statusShown });
  form.spacer({ visible: statusShown });

  // Confirmation dialog — always shown for perm ban, also for temp ban as a
  // safety net. Runs after the form closes.
  const confirmBan = async (reason, durMs, close) => {
    const durLabel = perm
      ? t("jm_at.adm.ban_dur_perm")
      : t("jm_at.adm.ban_dur_for", fmtDurationRaw(durMs));
    const confirm = await new MessageFormData()
      .title(
        perm
          ? t("jm_at.adm.ban_confirm_perm_title")
          : t("jm_at.adm.ban_confirm_title"),
      )
      .body(
        raw(
          t("jm_at.adm.ban_confirm_body", target.name, durLabel, reason),
          perm ? t("jm_at.adm.ban_perm_note") : "",
        ),
      )
      .button1(t("jm_at.common.btn_cancel"))
      .button2(
        perm
          ? t("jm_at.adm.btn_perm_ban_confirm")
          : t("jm_at.adm.btn_ban_confirm"),
      )
      .show(admin);
    if (!confirm.canceled && confirm.selection === 1) {
      doBan(admin, target, reason, durMs);
      tell(
        admin,
        perm
          ? t("jm_at.adm.banned_perm_done", target.name)
          : t("jm_at.adm.banned_temp_done", fmtDurationRaw(durMs), target.name),
      );
      return close ? undefined : back();
    }
    return back();
  };

  const submit = (close) => {
    const reason = clampText(String(reasonObs.getData() ?? "").trim(), 200);
    let durMs = perm ? 0 : parseDuration(String(durObs.getData() ?? "").trim());
    if (!perm && durMs <= 0) {
      status.setData("§c时长无效，请使用 30m、1h 或 7d 等格式。");
      statusShown.setData(true);
      return;
    }
    if (capTo24h && durMs > MAX_MOD_BAN_MS) durMs = MAX_MOD_BAN_MS;
    if (reason.length < 2) {
      status.setData("§c原因过短，请补充说明。");
      statusShown.setData(true);
      return;
    }
    pendingNav = () => confirmBan(reason, durMs, close);
    try {
      form.close();
    } catch {}
  };
  form.button(
    t(perm ? "jm_at.adm.btn_perm_ban_plain" : "jm_at.adm.btn_ban_plain"),
    () => submit(false),
  );
  form.button(
    t(perm ? "jm_at.adm.btn_perm_ban_close" : "jm_at.adm.btn_ban_close"),
    () => submit(true),
  );
  form.button(t("jm_at.common.btn_back"), () => {
    intent = "back";
    try {
      form.close();
    } catch {}
  });

  const closeReason = await form.show();
  if (closeReason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(() =>
      showBanModal(admin, target, perm, back, capTo24h, {
        reason: reasonObs.getData(),
        dur: durObs.getData(),
      }),
    );
  }
  if (pendingNav) return system.run(pendingNav);
  // Back → profile; ✕ / engine close / escape → exit to game. If a reason was
  // typed, confirm first — Keep editing reopens with the reason + duration kept.
  const goBack = intent === "back";
  if (reasonObs.getData().trim().length > 0) {
    const keep = { reason: reasonObs.getData(), dur: durObs.getData() };
    return system.run(async () => {
      if (await confirmDiscardChanges(admin))
        return showBanModal(admin, target, perm, back, capTo24h, keep);
      if (goBack) return back();
    });
  }
  if (goBack) return system.run(back);
}

async function showGamemodeModal(admin, target, back) {
  // lang-keys: jm_at.adm.gamemode_survival jm_at.adm.gamemode_creative jm_at.adm.gamemode_adventure jm_at.adm.gamemode_spectator
  const gmItems = GAMEMODES.map((g, i) => ({
    label: t(`jm_at.adm.gamemode_${g}`),
    value: i,
  }));
  const gmObs = new ObservableNumber(0, { clientWritable: true });
  let pendingNav = null;
  let intent = null;

  const form = new CustomForm(
    admin,
    target.id === admin.id
      ? t("jm_at.adm.gm_title_self")
      : t("jm_at.adm.gm_title", target.name),
  );
  form.spacer();
  form.dropdown(t("jm_at.adm.field_select_gamemode"), gmObs, gmItems);

  const apply = (mode, close) => {
    try {
      doGamemode(admin, target, mode);
      tell(admin, t("jm_at.adm.gm_set_done", target.name, mode));
    } catch (e) {
      tell(admin, raw("§c", e?.message ?? ""));
    }
    return close ? undefined : back();
  };

  const proceed = async (mode, close) => {
    // Layer 1 — warn before putting YOURSELF in spectator. Spectators can't tap
    // items/blocks to reopen the admin UI and can't run /gamemode without
    // cheats. Informational (not a hard block) since the escape hatches below
    // make it recoverable.
    if (mode === "spectator" && target.id === admin.id) {
      const warn = await new MessageFormData()
        .title(t("jm_at.adm.spectator_title"))
        .body(t("jm_at.adm.spectator_body"))
        .button1(t("jm_at.common.btn_cancel"))
        .button2(t("jm_at.adm.btn_enter_spectator"))
        .show(admin);
      if (warn.canceled || warn.selection !== 1) {
        return showGamemodeModal(admin, target, back);
      }
      setIntentionalSpectator(admin, true);
    }
    return apply(mode, close);
  };
  form.spacer();
  form.button(t("jm_at.adm.btn_set_gamemode"), () => {
    const mode = GAMEMODES[gmObs.getData()] ?? GAMEMODES[0];
    pendingNav = () => proceed(mode, false);
    try {
      form.close();
    } catch {}
  });
  form.button(t("jm_at.adm.btn_set_gamemode_close"), () => {
    const mode = GAMEMODES[gmObs.getData()] ?? GAMEMODES[0];
    pendingNav = () => proceed(mode, true);
    try {
      form.close();
    } catch {}
  });
  form.button(t("jm_at.common.btn_back"), () => {
    intent = "back";
    try {
      form.close();
    } catch {}
  });

  const closeReason = await form.show();
  if (closeReason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(() => showGamemodeModal(admin, target, back));
  }
  if (pendingNav) return system.run(pendingNav);
  if (intent === "back") return system.run(back); // Back → profile; ✕ → exit
}

// =========================================================
// Punishment History
// =========================================================

/** Appeal-status suffix shown under a WARN entry in the punishment history. */
function _appealStatusLine(p, warnAcks) {
  if (p.type !== "WARN") return "";
  const ack = warnAcks?.[p.id];
  if (p.appealOutcome === "accepted")
    return t("jm_at.adm.appeal_accepted_line");
  if (p.appealOutcome === "denied" || ack?.appealDenied)
    return t("jm_at.adm.appeal_denied_line");
  if (ack?.appeal) return t("jm_at.adm.appeal_pending_line");
  return "";
}

/** Localized badges for stored punishment type codes (fallback: raw code). */
const PUN_TYPE_KEYS = {
  BAN: "jm_at.adm.pun_type_ban",
  KICK: "jm_at.adm.pun_type_kick",
  WARN: "jm_at.adm.pun_type_warn",
  FREEZE: "jm_at.adm.pun_type_freeze",
};

/** One punishment-history entry as a RawMessage (shared online/offline). */
function _punishmentEntryRaw(p, warnAcks) {
  const faded = !p.active ? "§r" : "";
  const expiry =
    p.expiresAt > 0
      ? t("jm_at.adm.pun_until", fmtMsRaw(p.expiresAt))
      : p.type !== "WARN" && p.type !== "KICK"
        ? t("jm_at.adm.pun_perm")
        : "";
  const typeLabel = PUN_TYPE_KEYS[p.type]
    ? t(PUN_TYPE_KEYS[p.type])
    : { text: String(p.type) };
  return raw(
    t(
      "jm_at.adm.pun_entry",
      faded,
      typeLabel,
      p.byName,
      fmtMsRaw(p.at),
      p.reason,
      expiry,
    ),
    _appealStatusLine(p, warnAcks),
  );
}

async function showPunishmentHistory(admin, target, backFn = null) {
  try {
    requireAdminOrModCan(admin, "punishmentHistory", "处罚记录");
  } catch {
    return;
  }
  const core = getPlayerCore(target);
  const puns = (core.punishments ?? []).slice(0, 15);

  const body =
    puns.length === 0
      ? t("jm_at.adm.pun_none")
      : raw(
          ...puns.flatMap((p, i) => [
            i > 0 ? "\n\n" : "",
            _punishmentEntryRaw(p, core.warnAcks),
          ]),
        );

  const form = new ActionFormData()
    .title(t("jm_at.adm.pun_title", target.name))
    .body(body)
    .button(t("jm_at.common.btn_back_bold"))
    .button(CLOSE_BTN_LABEL);

  const res = await form.show(admin);
  if (res.canceled) return showPlayerProfile(admin, target, backFn); // X = Back
  if (res.selection === 1) return; // Close
  return showPlayerProfile(admin, target, backFn); // Back
}

// =========================================================
// Offline Warning Management & Appeal Review
// =========================================================

async function showOfflineWarnings(admin, xuid, backFn = null) {
  try {
    requireAdminOrModCan(admin, "warn", "管理警告");
  } catch {
    return;
  }
  const reg = getPlayerRegistry();
  const entry = reg[xuid];
  if (!entry) {
    tell(admin, t("jm_at.adm.registry_entry_not_found"));
    return;
  }

  const puns = getPlayerPunishments(entry.xuid);
  const warns = puns.filter((p) => p.type === "WARN" && p.active);

  if (warns.length === 0) {
    tell(admin, t("jm_at.adm.no_active_warns"));
    return showOfflineProfile(admin, xuid, backFn);
  }

  const warnAcks = entry.warnAcks ?? {};
  const form = new ActionFormData()
    .title(t("jm_at.adm.warns_title", entry.name))
    .body(t("jm_at.adm.warns_body"));

  for (const w of warns) {
    const ack = warnAcks[w.id];
    const tag =
      ack?.appeal && !ack?.appealDenied
        ? t("jm_at.adm.appeal_tag")
        : ack?.appeal && ack?.appealDenied
          ? t("jm_at.adm.denied_tag")
          : ack?.ackedAt
            ? t("jm_at.adm.acked_tag")
            : "";
    form.button(
      t(
        "jm_at.adm.warn_row",
        w.reason.slice(0, 40),
        tag,
        w.byName,
        fmtMsRaw(w.at),
      ),
      "textures/ui/jm_at_warnings",
    );
  }
  form.button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back");
  form.button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(admin);
  if (res.canceled) return showOfflineProfile(admin, xuid, backFn); // X = Back
  if (res.selection === warns.length)
    return showOfflineProfile(admin, xuid, backFn); // Back
  if (res.selection === warns.length + 1) return; // Close

  return showOfflineWarnDetail(admin, xuid, warns[res.selection], backFn);
}

async function showOfflineWarnDetail(admin, xuid, pun, backFn = null) {
  try {
    requireAdminOrModCan(admin, "warn", "管理警告");
  } catch {
    return;
  }
  const reg = getPlayerRegistry();
  const entry = reg[xuid];
  if (!entry) {
    tell(admin, t("jm_at.adm.registry_entry_not_found"));
    return;
  }

  const warnAcks = entry.warnAcks ?? {};
  const ack = warnAcks[pun.id];

  const appealSection = ack?.appeal
    ? raw(
        t("jm_at.adm.appeal_section", ack.appeal, fmtMsRaw(ack.appealAt)),
        ack.appealDenied ? t("jm_at.adm.appeal_denied_suffix") : "",
      )
    : t("jm_at.adm.no_appeal");

  const body = raw(
    t("jm_at.warn.detail_head", pun.reason, pun.byName, fmtMsRaw(pun.at)),
    appealSection,
  );

  const btns = [];
  if (ack?.appeal && !ack?.appealDenied) {
    btns.push({ label: t("jm_at.adm.btn_accept_appeal"), action: "accept" });
    btns.push({ label: t("jm_at.adm.btn_deny_appeal"), action: "deny" });
  }
  btns.push({ label: t("jm_at.adm.btn_clear_warning"), action: "clear" });
  btns.push({ label: t("jm_at.common.btn_back_bold"), action: "back" });
  btns.push({ label: CLOSE_BTN_LABEL, action: "close" });

  const form = new ActionFormData()
    .title(t("jm_at.adm.warn_detail_title", entry.name))
    .body(body);
  for (const b of btns) form.button(b.label);

  const res = await form.show(admin);
  if (res.canceled) return showOfflineWarnings(admin, xuid, backFn); // X = Back

  const action = btns[res.selection]?.action;
  if (action === "close") return; // Close
  if (action === "back") return showOfflineWarnings(admin, xuid, backFn);

  if (action === "accept") {
    mutatePlayerWarnAcks(xuid, (acks) => {
      delete acks[pun.id];
    });
    mutatePlayerPunishments(xuid, (puns2) => {
      const p = puns2.find((x) => x.id === pun.id);
      if (p) {
        p.active = false;
        p.appealOutcome = "accepted";
      }
    });
    retractStaffAlert(xuid);
    logAdmin(admin, "APPEAL_ACCEPT", pun.reason, entry.name);
    const online = [...world.getPlayers()].find(
      (pl) => getPlayerXuid(pl) === xuid,
    );
    if (online) tell(online, t("jm_at.adm.appeal_accepted_msg", pun.reason));
    else if (xuid)
      queuePlayerNotif(
        xuid,
        // Stored notifications use server-side Chinese at write time.
        `§2您对警告“§r${pun.reason}§2”的申诉已通过，该警告已移除。`,
      );
    tell(admin, t("jm_at.adm.appeal_accepted_admin", entry.name));
    return showOfflineWarnings(admin, xuid, backFn);
  }

  if (action === "deny") {
    mutatePlayerWarnAcks(xuid, (acks) => {
      acks[pun.id] = { ...(acks[pun.id] ?? {}), appealDenied: true };
    });
    logAdmin(admin, "APPEAL_DENY", pun.reason, entry.name);
    const online = [...world.getPlayers()].find(
      (pl) => getPlayerXuid(pl) === xuid,
    );
    if (online) tell(online, t("jm_at.adm.appeal_denied_msg", pun.reason));
    else if (xuid)
      queuePlayerNotif(
        xuid,
        // Stored notifications use server-side Chinese at write time.
        `§c您对警告“§r${pun.reason}§c”的申诉被驳回。`,
      );
    tell(admin, t("jm_at.adm.appeal_denied_admin", entry.name));
    return showOfflineWarnings(admin, xuid, backFn);
  }

  if (action === "clear") {
    mutatePlayerPunishments(xuid, (puns2) => {
      const p = puns2.find((x) => x.id === pun.id);
      if (p) p.active = false;
    });
    mutatePlayerWarnAcks(xuid, (acks) => {
      delete acks[pun.id];
    });
    retractStaffAlert(xuid);
    logAdmin(admin, "WARN_CLEAR", pun.reason, entry.name);
    tell(admin, t("jm_at.adm.warn_cleared_admin", entry.name));
    return showOfflineWarnings(admin, xuid, backFn);
  }

  return showOfflineWarnings(admin, xuid, backFn);
}

// =========================================================
// Warning Management & Appeal Review (admin side)
// =========================================================

async function showAdminWarnings(admin, target, backFn = null) {
  try {
    requireAdminOrModCan(admin, "warn", "管理警告");
  } catch {
    return;
  }
  const core = getPlayerCore(target);
  const warns = (core.punishments ?? []).filter(
    (p) => p.type === "WARN" && p.active,
  );

  if (warns.length === 0) {
    tell(admin, t("jm_at.adm.no_active_warns"));
    return showPlayerProfile(admin, target, backFn);
  }

  const form = new ActionFormData()
    .title(t("jm_at.adm.warns_title", target.name))
    .body(t("jm_at.adm.warns_body"));

  for (const w of warns) {
    const ack = core.warnAcks?.[w.id];
    const tag =
      ack?.appeal && !ack?.appealDenied
        ? t("jm_at.adm.appeal_tag")
        : ack?.appeal && ack?.appealDenied
          ? t("jm_at.adm.denied_tag")
          : ack?.ackedAt
            ? t("jm_at.adm.acked_tag")
            : "";
    form.button(
      t(
        "jm_at.adm.warn_row",
        w.reason.slice(0, 40),
        tag,
        w.byName,
        fmtMsRaw(w.at),
      ),
      "textures/ui/jm_at_warnings",
    );
  }
  form.button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back");
  form.button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(admin);
  if (res.canceled) return showPlayerProfile(admin, target, backFn); // X = Back
  if (res.selection === warns.length)
    return showPlayerProfile(admin, target, backFn); // Back
  if (res.selection === warns.length + 1) return; // Close

  return showAdminWarnDetail(admin, target, warns[res.selection], backFn);
}

async function showAdminWarnDetail(admin, target, pun, backFn = null) {
  try {
    requireAdminOrModCan(admin, "warn", "管理警告");
  } catch {
    return;
  }
  const core = getPlayerCore(target);
  const ack = core.warnAcks?.[pun.id];
  const xuid = core.xuid ?? "";

  const appealSection = ack?.appeal
    ? raw(
        t("jm_at.adm.appeal_section", ack.appeal, fmtMsRaw(ack.appealAt)),
        ack.appealDenied ? t("jm_at.adm.appeal_denied_suffix") : "",
      )
    : t("jm_at.adm.no_appeal");

  const body = raw(
    t("jm_at.warn.detail_head", pun.reason, pun.byName, fmtMsRaw(pun.at)),
    appealSection,
  );

  const btns = [];
  if (ack?.appeal && !ack?.appealDenied) {
    btns.push({ label: t("jm_at.adm.btn_accept_appeal"), action: "accept" });
    btns.push({ label: t("jm_at.adm.btn_deny_appeal"), action: "deny" });
  }
  btns.push({ label: t("jm_at.adm.btn_clear_warning"), action: "clear" });
  btns.push({ label: t("jm_at.common.btn_back_bold"), action: "back" });
  btns.push({ label: CLOSE_BTN_LABEL, action: "close" });

  const form = new ActionFormData()
    .title(t("jm_at.adm.warn_detail_title", target.name))
    .body(body);
  for (const b of btns) form.button(b.label);

  const res = await form.show(admin);
  if (res.canceled) return showAdminWarnings(admin, target, backFn); // X = Back

  const action = btns[res.selection]?.action;
  if (action === "close") return; // Close
  if (action === "back") return showAdminWarnings(admin, target, backFn);

  if (action === "accept") {
    const freshCore = getPlayerCore(target);
    const p = (freshCore.punishments ?? []).find((x) => x.id === pun.id);
    if (p) {
      p.active = false;
      p.appealOutcome = "accepted";
      if (freshCore.warnAcks) delete freshCore.warnAcks[pun.id];
      setPlayerCore(target, freshCore);
    }
    mutatePlayerWarnAcks(xuid, (acks) => {
      delete acks[pun.id];
    });
    retractStaffAlert(xuid);
    logAdmin(admin, "APPEAL_ACCEPT", pun.reason, target.name);
    const online = [...world.getPlayers()].find(
      (pl) => getPlayerXuid(pl) === xuid,
    );
    if (online) tell(online, t("jm_at.adm.appeal_accepted_msg", pun.reason));
    else if (xuid)
      queuePlayerNotif(
        xuid,
        // Stored notifications use server-side Chinese at write time.
        `§2您对警告“§r${pun.reason}§2”的申诉已通过，该警告已移除。`,
      );
    tell(admin, t("jm_at.adm.appeal_accepted_admin", target.name));
    return showAdminWarnings(admin, target, backFn);
  }

  if (action === "deny") {
    const freshCore = getPlayerCore(target);
    freshCore.warnAcks = freshCore.warnAcks ?? {};
    freshCore.warnAcks[pun.id] = {
      ...(freshCore.warnAcks[pun.id] ?? {}),
      appealDenied: true,
    };
    setPlayerCore(target, freshCore);
    logAdmin(admin, "APPEAL_DENY", pun.reason, target.name);
    const online = [...world.getPlayers()].find(
      (pl) => getPlayerXuid(pl) === xuid,
    );
    if (online) tell(online, t("jm_at.adm.appeal_denied_msg", pun.reason));
    else if (xuid)
      queuePlayerNotif(
        xuid,
        // Stored notifications use server-side Chinese at write time.
        `§c您对警告“§r${pun.reason}§c”的申诉被驳回。`,
      );
    tell(admin, t("jm_at.adm.appeal_denied_admin", target.name));
    return showAdminWarnings(admin, target, backFn);
  }

  if (action === "clear") {
    const freshCore = getPlayerCore(target);
    const p = (freshCore.punishments ?? []).find((x) => x.id === pun.id);
    if (p) {
      p.active = false;
      if (freshCore.warnAcks) delete freshCore.warnAcks[pun.id];
      setPlayerCore(target, freshCore);
    }
    mutatePlayerWarnAcks(xuid, (acks) => {
      delete acks[pun.id];
    });
    retractStaffAlert(xuid);
    logAdmin(admin, "WARN_CLEAR", pun.reason, target.name);
    tell(admin, t("jm_at.adm.warn_cleared_admin", target.name));
    return showAdminWarnings(admin, target, backFn);
  }

  return showAdminWarnings(admin, target, backFn);
}

// =========================================================
// Spy History (on player profile)
// =========================================================

async function showSpyHistory(admin, target, backFn = null) {
  try {
    requireAdminOrModCan(admin, "spyCamera", "监视记录");
  } catch {
    return;
  }
  const core = getPlayerCore(target);
  const history = core.spyHistory ?? [];

  const body =
    history.length === 0
      ? t("jm_at.adm.spy_none_recorded")
      : raw(
          ...history.flatMap((s, i) => [
            i > 0 ? "\n" : "",
            t("jm_at.adm.spy_row", i + 1, s.byName, fmtMsRaw(s.at)),
          ]),
        );

  const form = new ActionFormData()
    .title(t("jm_at.adm.spy_history_title", target.name))
    .body(raw(t("jm_at.adm.spy_history_body", history.length), "\n\n", body))
    .button(t("jm_at.common.btn_back_bold"))
    .button(CLOSE_BTN_LABEL);

  const res = await form.show(admin);
  if (res.canceled) return showPlayerProfile(admin, target, backFn); // X = Back
  if (res.selection === 1) return; // Close
  return showPlayerProfile(admin, target, backFn); // Back
}

// =========================================================

async function showPlayerTicketHistory(admin, target, backFn = null) {
  try {
    requireAdminOrModCan(admin, "tickets", "工单记录");
  } catch {
    return;
  }
  const core = getPlayerCore(target);
  const myIds = core.myTickets ?? [];
  const shown = myIds.map((id) => findTicket(id)?.ticket).filter(Boolean);

  const form = new ActionFormData()
    .title(t("jm_at.adm.tickets_for_title", target.name))
    .body(
      shown.length
        ? t("jm_at.adm.tickets_select_body")
        : t("jm_at.adm.no_tickets_found"),
    );

  for (const tk of shown)
    form.button(
      t(
        "jm_at.adm.tickets_row_simple",
        tk.id,
        _ticketStatusRaw(tk.status),
        tk.category,
      ),
    );
  form.button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back");
  form.button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(admin);
  if (res.canceled) return showPlayerProfile(admin, target, backFn); // X = Back
  if (res.selection === shown.length)
    return showPlayerProfile(admin, target, backFn); // Back
  if (res.selection === shown.length + 1) return; // Close

  const ticket = shown[res.selection];
  if (ticket) {
    return showTicketDetail(admin, ticket.id, {
      adminView: true,
      onBack: () => showPlayerProfile(admin, target, backFn),
      onProfile: (name, xuid, backToTicket) => {
        const t2 = getOnlinePlayerByName(name);
        if (t2) return showPlayerProfile(admin, t2, backToTicket);
        if (xuid) return showOfflineProfile(admin, xuid, backToTicket);
        tell(admin, t("jm_at.adm.xuid_not_found"));
      },
    });
  }
}

// =========================================================
// Admin Notes (multi-note, timestamped)
// =========================================================

/** Normalise adminNotes from legacy string or missing → array. */
function readNotes(rawNotes) {
  if (Array.isArray(rawNotes)) return rawNotes;
  if (rawNotes && typeof rawNotes === "string")
    return [{ id: "N0", text: rawNotes, at: 0, byName: "Unknown", byXuid: "" }];
  return [];
}

/**
 * Shared notes UI. getNotes() → array; setNotes(array) → persists.
 */
async function adminNotesUI(admin, playerName, getNotes, setNotes, backFn) {
  try {
    requireAdminOrModCan(admin, "adminNotes", "管理员备注");
  } catch {
    return;
  }

  const notes = getNotes();
  // Buttons carry an `action` key — dispatch below is key-based, never by
  // label text (labels are now translated RawMessages).
  const btns = [
    { label: t("jm_at.adm.btn_add_note"), action: "add" },
    ...notes.map((n) => ({
      label:
        n.at > 0
          ? t(
              "jm_at.adm.note_row",
              n.text.slice(0, 30),
              fmtAgoRaw(n.at),
              n.byName,
            )
          : t("jm_at.adm.note_row_undated", n.text.slice(0, 30), n.byName),
      action: "open",
    })),
    { label: t("jm_at.common.btn_back_bold"), action: "back" },
    { label: CLOSE_BTN_LABEL, action: "close" },
  ];

  const form = new ActionFormData()
    .title(t("jm_at.adm.notes_title", playerName))
    .body(
      notes.length === 0
        ? t("jm_at.adm.notes_empty")
        : t("jm_at.adm.notes_count", notes.length),
    );
  for (const b of btns) form.button(b.label);

  const res = await form.show(admin);
  if (res.canceled) return backFn(); // X = Back
  if (btns[res.selection]?.action === "close") return; // Close
  if (btns[res.selection]?.action === "back") return backFn();

  if (res.selection === 0)
    return showAddNoteForm(admin, playerName, getNotes, setNotes, backFn);

  const note = notes[res.selection - 1];
  if (!note) return adminNotesUI(admin, playerName, getNotes, setNotes, backFn);
  return adminNoteDetail(admin, playerName, note, getNotes, setNotes, backFn);
}

async function adminNoteDetail(
  admin,
  playerName,
  note,
  getNotes,
  setNotes,
  backFn,
) {
  const form = new ActionFormData()
    .title(t("jm_at.adm.note_title", playerName))
    .body(
      note.at > 0
        ? t("jm_at.adm.note_body", note.text, fmtAgoRaw(note.at), note.byName)
        : t("jm_at.adm.note_body_undated", note.text, note.byName),
    )
    .button(t("jm_at.adm.btn_edit_green"))
    .button(t("jm_at.adm.btn_delete_red"))
    .button(t("jm_at.common.btn_back_bold"))
    .button(CLOSE_BTN_LABEL);

  const res = await form.show(admin);
  if (res.canceled)
    return adminNotesUI(admin, playerName, getNotes, setNotes, backFn); // X = Back
  if (res.selection === 3) return; // Close
  if (res.selection === 2)
    return adminNotesUI(admin, playerName, getNotes, setNotes, backFn);

  if (res.selection === 0)
    return showEditNoteForm(
      admin,
      playerName,
      note,
      getNotes,
      setNotes,
      backFn,
    );

  // Delete — confirm
  const conf = await new MessageFormData()
    .title(t("jm_at.adm.note_delete_title"))
    .body(t("jm_at.adm.note_delete_body", note.text.slice(0, 100)))
    .button1(t("jm_at.common.btn_cancel"))
    .button2(t("jm_at.adm.btn_delete_red"))
    .show(admin);
  if (!conf.canceled && conf.selection === 1) {
    setNotes(getNotes().filter((n) => n.id !== note.id));
    logAdmin(admin, "NOTE_DELETE", `已删除玩家备注：${playerName}`);
    tell(admin, t("jm_at.adm.note_deleted"));
    return adminNotesUI(admin, playerName, getNotes, setNotes, backFn);
  }
  return adminNoteDetail(admin, playerName, note, getNotes, setNotes, backFn);
}

async function showAddNoteForm(
  admin,
  playerName,
  getNotes,
  setNotes,
  backFn,
  initial = {},
) {
  const noteObs = new ObservableString(initial.note ?? "", {
    clientWritable: true,
  });
  const status = new ObservableString("");
  const statusShown = new ObservableBoolean(false);
  let pendingNav = null;
  let intent = null; // "back" set by Back; null = ✕/engine close/escape → exit
  const fail = (m) => {
    status.setData(m);
    statusShown.setData(true);
  };

  const form = new CustomForm(admin, t("jm_at.adm.note_add_title", playerName));
  form.textField(t("jm_at.adm.field_note_label"), noteObs, {
    description: t("jm_at.adm.field_note_desc"),
  });
  form.spacer();
  form.label(status, { visible: statusShown });
  form.spacer({ visible: statusShown });
  const submit = (close) => {
    const text = clampText(noteObs.getData().trim(), LIMITS.NOTE_MAX_LEN);
    if (!text) {
      fail("§c请先输入备注。");
      return;
    }
    pendingNav = () => {
      const fresh = getNotes();
      fresh.unshift({
        id: genId("N"),
        text,
        at: nowMs(),
        byName: admin.name,
        byXuid: getPlayerXuid(admin) ?? "",
      });
      if (fresh.length > LIMITS.ADMIN_NOTES_MAX)
        fresh.length = LIMITS.ADMIN_NOTES_MAX;
      setNotes(fresh);
      logAdmin(admin, "NOTE_ADD", `${playerName}: ${text.slice(0, 60)}`);
      tell(admin, t("jm_at.adm.note_added"));
      return close
        ? undefined
        : adminNotesUI(admin, playerName, getNotes, setNotes, backFn);
    };
    try {
      form.close();
    } catch {}
  };
  form.button(t("jm_at.adm.btn_add"), () => submit(false));
  form.button(t("jm_at.adm.btn_add_close"), () => submit(true));
  form.button(t("jm_at.common.btn_back"), () => {
    intent = "back";
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(() =>
      showAddNoteForm(admin, playerName, getNotes, setNotes, backFn, {
        note: noteObs.getData(),
      }),
    );
  }
  if (pendingNav) return system.run(pendingNav);
  // Back → notes list; ✕ / engine close / escape → exit to game. If a note was
  // typed, confirm first — Keep editing reopens with the text preserved.
  const goBack = intent === "back";
  const backTo = () =>
    adminNotesUI(admin, playerName, getNotes, setNotes, backFn);
  if (noteObs.getData().trim().length > 0) {
    const keep = { note: noteObs.getData() };
    return system.run(async () => {
      if (await confirmDiscardChanges(admin))
        return showAddNoteForm(
          admin,
          playerName,
          getNotes,
          setNotes,
          backFn,
          keep,
        );
      if (goBack) return backTo();
    });
  }
  if (goBack) return system.run(backTo);
}

async function showEditNoteForm(
  admin,
  playerName,
  note,
  getNotes,
  setNotes,
  backFn,
  initial = {},
) {
  const noteObs = new ObservableString(initial.text ?? note.text, {
    clientWritable: true,
  });
  const status = new ObservableString("");
  const statusShown = new ObservableBoolean(false);
  let pendingNav = null;
  let intent = null; // "back" set by Back; null = ✕/engine close/escape → exit
  const fail = (m) => {
    status.setData(m);
    statusShown.setData(true);
  };

  const form = new CustomForm(
    admin,
    t("jm_at.adm.note_edit_title", playerName),
  );
  form.textField(t("jm_at.adm.field_note_edit"), noteObs, {
    description: t("jm_at.adm.field_note_edit_desc"),
  });
  form.spacer();
  form.label(status, { visible: statusShown });
  form.spacer({ visible: statusShown });
  const save = (close) => {
    const text = clampText(noteObs.getData().trim(), LIMITS.NOTE_MAX_LEN);
    if (!text) {
      fail("§c备注不能为空。");
      return;
    }
    pendingNav = () => {
      const fresh = getNotes();
      const target = fresh.find((n) => n.id === note.id);
      if (target) {
        target.text = text;
        target.at = nowMs();
        target.byName = admin.name;
      }
      setNotes(fresh);
      logAdmin(admin, "NOTE_EDIT", `${playerName}: ${text.slice(0, 60)}`);
      tell(admin, t("jm_at.adm.note_updated"));
      return close
        ? undefined
        : adminNotesUI(admin, playerName, getNotes, setNotes, backFn);
    };
    try {
      form.close();
    } catch {}
  };
  form.button(t("jm_at.common.btn_save"), () => save(false));
  form.button(t("jm_at.cl.btn_save_close"), () => save(true));
  form.button(t("jm_at.common.btn_back"), () => {
    intent = "back";
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(() =>
      showEditNoteForm(admin, playerName, note, getNotes, setNotes, backFn, {
        text: noteObs.getData(),
      }),
    );
  }
  if (pendingNav) return system.run(pendingNav);
  // Back → notes list; ✕ / engine close / escape → exit to game. If the note was
  // changed, confirm first — Keep editing reopens with the edit preserved.
  const goBack = intent === "back";
  const backTo = () =>
    adminNotesUI(admin, playerName, getNotes, setNotes, backFn);
  if (noteObs.getData() !== note.text) {
    const keep = { text: noteObs.getData() };
    return system.run(async () => {
      if (await confirmDiscardChanges(admin))
        return showEditNoteForm(
          admin,
          playerName,
          note,
          getNotes,
          setNotes,
          backFn,
          keep,
        );
      if (goBack) return backTo();
    });
  }
  if (goBack) return system.run(backTo);
}

async function showAdminNotes(admin, target, backFn = null) {
  const getNotes = () => readNotes(getPlayerCore(target).adminNotes);
  const setNotes = (notes) => {
    const c = getPlayerCore(target);
    c.adminNotes = notes;
    setPlayerCore(target, c);
  };
  return adminNotesUI(admin, target.name, getNotes, setNotes, () =>
    showPlayerProfile(admin, target, backFn),
  );
}

// =========================================================
// Admin Homes (view / remove a player's homes)
// =========================================================

async function showAdminHomes(admin, target, backFn = null) {
  let homes = getHomes(target);
  const names = Object.keys(homes).sort((a, b) => a.localeCompare(b));

  if (names.length === 0) {
    return warnForm(admin, t("jm_at.adm.no_homes", target.name), () =>
      showPlayerProfile(admin, target, backFn),
    );
  }

  const form = new ActionFormData()
    .title(t("jm_at.adm.homes_title", target.name))
    .body(t("jm_at.adm.homes_count", names.length));

  for (const name of names) {
    const h = homes[name];
    form.button(
      t(
        "jm_at.adm.home_row",
        name,
        _dimShortRaw(h.dimension),
        Math.floor(h.x),
        Math.floor(h.y),
        Math.floor(h.z),
      ),
      getHomeIconPath(h),
    );
  }
  form.button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back");
  form.button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(admin);
  if (res.canceled) return showPlayerProfile(admin, target, backFn); // X = Back
  if (res.selection === names.length)
    return showPlayerProfile(admin, target, backFn); // Back
  if (res.selection === names.length + 1) return; // Close

  const homeName = names[res.selection];
  const h = homes[homeName];

  // Delete is admin-only; moderators get view + teleport.
  const canDelete = isAdmin(admin).ok;
  const detail = new ActionFormData()
    .title(t("jm_at.adm.homes_detail_title", target.name, homeName))
    .body(
      t(
        "jm_at.adm.home_detail_body",
        homeName,
        _dimShortRaw(h.dimension),
        Math.floor(h.x),
        Math.floor(h.y),
        Math.floor(h.z),
      ),
    )
    .button(t("jm_at.deathback.btn_tp"), "textures/ui/jm_at_tp_to_home");
  if (canDelete)
    detail.button(t("jm_at.adm.btn_delete_red"), "textures/ui/jm_at_remove");
  detail.button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back");
  detail.button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const dRes = await detail.show(admin);
  if (dRes.canceled) return showAdminHomes(admin, target, backFn); // X = Back

  let di = dRes.selection;
  if (di === 0) {
    // Teleport
    return visitHome(admin, getPlayerXuid(target), homeName, () =>
      showAdminHomes(admin, target, backFn));
  }
  di -= 1; // consumed Teleport

  if (canDelete) {
    if (di === 0) {
      // Delete (confirm first — coordinates are unrecoverable)
      const conf = await new MessageFormData()
        .title(t("jm_at.adm.home_delete_title"))
        .body(
          t(
            "jm_at.adm.home_delete_body",
            target.name,
            homeName,
            _dimShortRaw(h.dimension),
            Math.floor(h.x),
            Math.floor(h.y),
            Math.floor(h.z),
          ),
        )
        .button1(t("jm_at.common.btn_cancel"))
        .button2(t("jm_at.adm.btn_delete_red"))
        .show(admin);
      if (conf.canceled || conf.selection === 0)
        return showAdminHomes(admin, target, backFn);
      homes = getHomes(target);
      if (!homes[homeName] || (homes[homeName].destinationId || "legacy") !== (h.destinationId || "legacy")) {
        tell(admin, "§e家园已删除或重新创建，请刷新后再操作。");
        return showAdminHomes(admin, target, backFn);
      }
      delete homes[homeName];
      if (!setHomes(target, homes)) {
        tell(admin, "§c删除保存失败，请重试。");
        return showAdminHomes(admin, target, backFn);
      }
      logAdmin(admin, "HOME_DELETE", `${target.name}: ${homeName}`);
      tell(admin, t("jm_at.adm.home_deleted", homeName, target.name));
      return showAdminHomes(admin, target, backFn);
    }
    di -= 1; // consumed Delete
  }

  if (di === 0) return showAdminHomes(admin, target, backFn); // Back
  return; // Close
}

// =========================================================
// Rank Panel (admin only, online players)
// =========================================================

async function showRankPanel(admin, target, backFn = null) {
  try {
    requireAdminOrModCan(admin, "rankPanel", "身份组面板");
  } catch {
    return;
  }
  const core = getPlayerCore(target);
  const isAdminTgt = isAdmin(target).ok;
  const isModTgt = isModerator(target);
  const rankCfg = getCfg();
  const autoRank = isAdminTgt
    ? rankCfg.staffAdminTag || t("jm_at.adm.tag_admin")
    : isModTgt
      ? rankCfg.staffModTag || t("jm_at.adm.rm_tag_mod_default")
      : null;
  const customRank = (core.rankTag ?? "").trim();
  const rankEnabled = core.rankTagEnabled !== false;
  const staffCustomRanks = rankCfg.staffCustomRanks ?? false;
  const canCustomize = !autoRank || staffCustomRanks;

  // What is currently displayed? When staffCustomRanks is on, a set custom
  // rank overrides the auto-rank, so reflect that in the description.
  const activeRank =
    autoRank && staffCustomRanks && customRank
      ? customRank
      : (autoRank ?? (customRank || null));
  // lang-keys: jm_at.adm.rankp_visible jm_at.adm.rankp_hidden jm_at.adm.rankp_btn_edit_custom jm_at.adm.rankp_btn_set_custom jm_at.adm.rankp_btn_remove_custom jm_at.adm.rankp_btn_remove_custom_none jm_at.adm.rankp_btn_hide jm_at.adm.rankp_btn_show
  const rankDesc = activeRank
    ? t(
        "jm_at.adm.rankp_desc",
        activeRank,
        t(rankEnabled ? "jm_at.adm.rankp_visible" : "jm_at.adm.rankp_hidden"),
      )
    : t("jm_at.adm.rank_none");

  const note = autoRank
    ? staffCustomRanks
      ? t("jm_at.adm.rankp_note_staff_custom", autoRank)
      : t("jm_at.adm.rankp_note_staff_auto")
    : t("jm_at.adm.rankp_note_colors");

  const dbNames = getRankNames();
  const hasDbRanks = dbNames.length > 0;

  const form = new ActionFormData()
    .title(t("jm_at.adm.rankp_title", target.name))
    .body(t("jm_at.adm.rankp_body", rankDesc, note));

  // Pick from Database
  if (canCustomize && hasDbRanks) {
    form.button(t("jm_at.adm.rankp_btn_pick_db"));
  } else if (!canCustomize) {
    form.button(t("jm_at.adm.rankp_btn_pick_db_disabled"));
  } else {
    form.button(t("jm_at.adm.rankp_btn_pick_db_none"));
  }

  // Set / Edit custom rank
  if (canCustomize) {
    form.button(
      t(
        customRank
          ? "jm_at.adm.rankp_btn_edit_custom"
          : "jm_at.adm.rankp_btn_set_custom",
      ),
    );
    form.button(
      t(
        customRank
          ? "jm_at.adm.rankp_btn_remove_custom"
          : "jm_at.adm.rankp_btn_remove_custom_none",
      ),
    );
  } else {
    form.button(t("jm_at.adm.rankp_btn_set_custom_disabled"));
    form.button(t("jm_at.adm.rankp_btn_remove_custom_disabled"));
  }

  // Toggle is always available — even staff may want to hide their auto-rank
  form.button(
    t(rankEnabled ? "jm_at.adm.rankp_btn_hide" : "jm_at.adm.rankp_btn_show"),
  );
  form.button(t("jm_at.common.btn_back_bold"));
  form.button(CLOSE_BTN_LABEL);

  const res = await form.show(admin);
  if (res.canceled) return showPlayerProfile(admin, target, backFn); // X = Back
  if (res.selection === 4) return showPlayerProfile(admin, target, backFn); // Back
  if (res.selection === 5) return; // Close

  // Pick from Database
  if (res.selection === 0) {
    if (!canCustomize) {
      tell(admin, t("jm_at.adm.rankp_cannot_custom_staff"));
      return showRankPanel(admin, target, backFn);
    }
    if (!hasDbRanks) {
      tell(admin, t("jm_at.adm.rankp_no_ranks_defined"));
      return showRankPanel(admin, target, backFn);
    }

    const db = getRankDb();
    const pickForm = new ActionFormData()
      .title(t("jm_at.adm.rankp_pick_title", target.name))
      .body(t("jm_at.adm.rankp_pick_body"));
    for (const name of dbNames) {
      pickForm.button(
        t("jm_at.adm.rankp_pick_row", name, db[name].tag),
        "textures/ui/jm_at_rank_toggle",
      );
    }
    pickForm.button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back");

    const pickRes = await pickForm.show(admin);
    if (!pickRes.canceled && pickRes.selection < dbNames.length) {
      const chosen = dbNames[pickRes.selection];
      const tag = db[chosen].tag;
      const role = detectRankRole(chosen, tag);
      if (role) {
        if (!canManageRoles(admin)) {
          return warnForm(
            admin,
            t("jm_at.adm.rankp_role_requires_manage"),
            () => showRankPanel(admin, target, backFn),
          );
        }
        const ok = await confirmRankRoleGrant(admin, target, role);
        if (!ok) return showRankPanel(admin, target, backFn);
        const granted = grantRoleFromRank(admin, target, role);
        tell(
          admin,
          granted
            ? t(
                role === "admin"
                  ? "jm_at.adm.admin_assigned_admin"
                  : "jm_at.adm.mod_assigned_admin",
                target.name,
              )
            : t("jm_at.adm.rankp_grant_failed", role, target.name),
        );
        return showRankPanel(admin, target, backFn);
      }
      const freshCore = getPlayerCore(target);
      freshCore.rankTag = tag;
      freshCore.rankTagEnabled = true;
      freshCore.rankSetManually = true;
      setPlayerCore(target, freshCore);
      logAdmin(
        admin,
        "RANK_SET",
        `${target.name}: ${tag}（来自数据库：${chosen}）`,
      );
      tell(admin, t("jm_at.adm.rankp_set_done", tag, target.name));
      tell(target, t("jm_at.adm.rankp_set_target", tag));
    }
    return showRankPanel(admin, target, backFn);
  }

  // Set / Edit custom rank
  if (res.selection === 1) {
    if (autoRank && !staffCustomRanks) {
      tell(admin, t("jm_at.adm.rankp_cannot_custom_staff"));
      return showRankPanel(admin, target, backFn);
    }
    return showRankComposer(admin, {
      mode: "playerCustom",
      target,
      backFn,
      colorIdx: detectRankColor(customRank),
      tagText: stripColorCode(customRank) || "",
    });
  }

  // Remove rank
  if (res.selection === 2) {
    if (autoRank && !staffCustomRanks) {
      tell(admin, t("jm_at.adm.rankp_cannot_remove_auto"));
      return showRankPanel(admin, target, backFn);
    }
    if (!customRank) {
      tell(admin, t("jm_at.adm.rankp_no_custom_to_remove"));
      return showRankPanel(admin, target, backFn);
    }
    const freshCore = getPlayerCore(target);
    freshCore.rankTag = "";
    freshCore.rankSetManually = false;
    setPlayerCore(target, freshCore);
    logAdmin(admin, "RANK_REMOVE", target.name);
    tell(admin, t("jm_at.adm.rankp_removed_done", target.name));
    tell(target, t("jm_at.adm.rankp_removed_target"));
    return showRankPanel(admin, target, backFn);
  }

  // Toggle visibility
  if (res.selection === 3) {
    const freshCore = getPlayerCore(target);
    freshCore.rankTagEnabled = !(freshCore.rankTagEnabled !== false);
    setPlayerCore(target, freshCore);
    const nowVisible = freshCore.rankTagEnabled;
    logAdmin(
      admin,
      "RANK_TOGGLE",
      `${target.name}: ${nowVisible ? "shown" : "hidden"}`,
    );
    // lang-keys: jm_at.adm.rankp_display_enabled jm_at.adm.rankp_display_disabled jm_at.adm.rankp_now_visible jm_at.adm.rankp_now_hidden
    tell(
      admin,
      t(
        nowVisible
          ? "jm_at.adm.rankp_display_enabled"
          : "jm_at.adm.rankp_display_disabled",
        target.name,
      ),
    );
    tell(
      target,
      t(
        nowVisible
          ? "jm_at.adm.rankp_now_visible"
          : "jm_at.adm.rankp_now_hidden",
      ),
    );
    return showRankPanel(admin, target, backFn);
  }
}

// =========================================================
// Commands Panel (admin only)
// =========================================================

// Shown when the command runner refuses an escalation command (see
// isBlockedStaffCommand). These are blocked for everyone, no privilege unlocks
// them — staff roles and operator are managed through the proper UI instead.
const BLOCKED_CMD_MSG = t("jm_at.adm.blocked_cmd_msg");

async function showCommandsPanel(player) {
  // Open if the player has the Commands privilege OR any built-in Game Commands
  // access (gameCommands / gameRules / gamemode). The panel hides Quick Run /
  // Add Command / saved commands from anyone lacking "commands" and re-checks
  // on dispatch; the Game Commands submenu filters itself per privilege.
  if (
    !(
      modCan(player, "commands") ||
      modCan(player, "commandButtons") ||
      modCan(player, "gameCommands") ||
      modCan(player, "gameRules") ||
      modCan(player, "gamemode")
    )
  )
    return;
  const hasCommands = modCan(player, "commands");
  const owner = isOwner(player);
  const hasButtons = modCan(player, "commandButtons");
  const presets = hasButtons ? getCommandPresets() : [];
  const showButtonsRow = hasButtons && (presets.length > 0 || owner);
  const xuid = getPlayerXuid(player);
  const cmds = hasCommands ? getAdminCmds(xuid) : [];

  const activeCount = cmds.filter((c) => c.active).length;
  const hasGameAccess =
    modCan(player, "gameCommands") ||
    modCan(player, "gameRules") ||
    modCan(player, "gamemode");
  // Body reflects what this staffer can actually reach. "gameonly" implies the
  // Game Commands shortcuts, so a commandButtons-only staffer (no commands, no
  // game verbs) gets a neutral body instead.
  const body = hasCommands
    ? cmds.length
      ? t(
          "jm_at.adm.cmds_body_count",
          cmds.length,
          LIMITS.COMMANDS_MAX,
          activeCount,
        )
      : t("jm_at.adm.cmds_body_empty")
    : hasGameAccess
      ? t("jm_at.adm.cmds_body_gameonly")
      : t("jm_at.adm.cmds_body_buttonsonly");

  const form = new ActionFormData()
    .title(t("jm_at.adm.idx_commands"))
    .body(body);

  // Build a dispatch list so button indices can't drift as rows appear or
  // disappear. Quick Run / Add Command / saved commands only show for players
  // with the "commands" privilege; Game Commands always shows (its own submenu
  // filters items by gameCommands / gameRules / gamemode).
  const rows = [];
  if (hasCommands)
    rows.push({
      label: t("jm_at.adm.cmds_btn_quick_run"),
      icon: "textures/ui/jm_at_command_quick",
      fn: () => showQuickRun(player),
    });
  if (hasGameAccess)
    rows.push({
      label: t("jm_at.adm.cmds_btn_game_commands"),
      icon: "textures/ui/jm_at_game_command",
      fn: () => showGameCommandsPanel(player),
    });
  if (showButtonsRow)
    rows.push({
      label: t("jm_at.adm.cmds_btn_command_buttons"),
      icon: "textures/ui/jm_at_command_buttons",
      fn: () => showCommandPresets(player),
    });
  if (hasCommands) {
    rows.push({
      label: t("jm_at.adm.cmds_btn_add_command"),
      icon: "textures/ui/jm_at_add_command",
      fn: () => showAddCommand(player),
    });
    for (const cmd of cmds) {
      const statusCol = cmd.active ? "§2" : "§8";
      const modeTag = t(
        cmd.mode === "repeat"
          ? "jm_at.adm.cmds_tag_repeat"
          : "jm_at.adm.cmds_tag_once",
      );
      const activeTag = cmd.active ? t("jm_at.adm.cmds_active_dot") : "";
      rows.push({
        label: t(
          "jm_at.adm.cmds_row",
          statusCol,
          cmd.name,
          modeTag,
          activeTag,
          cmd.command.slice(0, 25),
        ),
        icon:
          cmd.mode === "repeat"
            ? "textures/ui/jm_at_command_repeating"
            : "textures/ui/jm_at_command1",
        fn: () => showCommandDetail(player, cmd.id),
      });
    }
  }

  for (const r of rows) form.button(r.label, r.icon);
  form
    .button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back")
    .button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showAdminPanel(player); // X = Back
  if (res.selection === rows.length) return showAdminPanel(player); // Back
  if (res.selection === rows.length + 1) return; // Close
  const row = rows[res.selection];
  if (row) return row.fn();
}

// =========================================================
// Command Buttons — owner-curated one-tap command presets. A single SHARED
// world-level list (getCommandPresets/setCommandPresets). USING them (see +
// run) is gated by the "commandButtons" privilege; MANAGING them (add / edit /
// remove) is owner-only. Running mirrors Quick Run's runIt exactly, so the same
// safety gates apply — an owner-added op/role/function preset can never run.
// =========================================================

async function showCommandPresets(player) {
  if (!modCan(player, "commandButtons")) return showCommandsPanel(player);
  const owner = isOwner(player);
  const presets = getCommandPresets();

  const form = new ActionFormData()
    .title(t("jm_at.adm.cbtn_title"))
    .body(
      presets.length
        ? t("jm_at.adm.cbtn_body", presets.length)
        : owner
          ? t("jm_at.adm.cbtn_body_empty_owner")
          : t("jm_at.adm.cbtn_body_empty"),
    );

  // rows[] dispatch so indices can't drift as the Manage button / presets change.
  const rows = [];
  if (owner)
    rows.push({
      manage: true,
      label: t("jm_at.adm.cbtn_btn_manage"),
      icon: "textures/ui/jm_at_manage_buttons",
    });
  for (const p of presets)
    rows.push({
      preset: p,
      label: t("jm_at.adm.cbtn_row", p.name, (p.command ?? "").slice(0, 30)),
      icon: "textures/ui/jm_at_command1",
    });

  for (const r of rows) form.button(r.label, r.icon);
  form
    .button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back")
    .button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showCommandsPanel(player); // X = Back
  if (res.selection === rows.length) return showCommandsPanel(player); // Back
  if (res.selection === rows.length + 1) return; // Close
  const row = rows[res.selection];
  if (!row) return;
  if (row.manage) return showManageCommandPresets(player);
  return runCommandPreset(player, row.preset);
}

// Run a preset. Re-checks the same two safety gates every runner path uses
// (blocked verbs are absolute; gamemode needs the privilege) — a preset saved
// before a rule tightened must still be refused, so both checks stay here.
function runCommandPreset(player, preset) {
  const command = preset?.command ?? "";
  if (isBlockedStaffCommand(command)) {
    return warnForm(player, BLOCKED_CMD_MSG, () => showCommandPresets(player));
  }
  if (isGamemodeCommand(command) && !modCan(player, "gamemode")) {
    return warnForm(player, t("jm_at.adm.no_perm_gamemode"), () =>
      showCommandPresets(player),
    );
  }
  try {
    player.runCommand(command);
  } catch {
    return warnForm(player, t("jm_at.adm.qr_run_failed", command), () =>
      showCommandPresets(player),
    );
  }
  logAdmin(player, "CMD_PRESET_RUN", `${preset.name}: ${command}`);
  tell(player, t("jm_at.adm.cmdd_ran", command));
  return showCommandPresets(player);
}

async function showManageCommandPresets(player) {
  if (!isOwner(player)) return showCommandPresets(player);
  const presets = getCommandPresets();

  const form = new ActionFormData()
    .title(t("jm_at.adm.cbtn_manage_title"))
    .body(
      presets.length
        ? t(
            "jm_at.adm.cbtn_manage_body",
            presets.length,
            LIMITS.COMMAND_PRESETS_MAX,
          )
        : t("jm_at.adm.cbtn_manage_body_empty"),
    );

  const rows = [
    {
      add: true,
      label: t("jm_at.adm.cbtn_btn_add"),
      icon: "textures/ui/jm_at_add_command",
    },
  ];
  for (const p of presets)
    rows.push({
      preset: p,
      label: t("jm_at.adm.cbtn_row", p.name, (p.command ?? "").slice(0, 30)),
      icon: "textures/ui/jm_at_command1",
    });

  for (const r of rows) form.button(r.label, r.icon);
  form
    .button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back")
    .button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showCommandPresets(player); // X = Back
  if (res.selection === rows.length) return showCommandPresets(player); // Back
  if (res.selection === rows.length + 1) return; // Close
  const row = rows[res.selection];
  if (!row) return;
  if (row.add) {
    if (presets.length >= LIMITS.COMMAND_PRESETS_MAX) {
      return warnForm(
        player,
        t("jm_at.adm.cbtn_cap_reached", LIMITS.COMMAND_PRESETS_MAX),
        () => showManageCommandPresets(player),
      );
    }
    return showCommandPresetEditor(player, null);
  }
  return showCommandPresetEditor(player, row.preset.id);
}

async function showCommandPresetEditor(player, existingId) {
  if (!isOwner(player)) return showCommandPresets(player);
  const existing = existingId
    ? getCommandPresets().find((p) => p.id === existingId)
    : null;
  if (existingId && !existing) {
    return warnForm(player, t("jm_at.adm.cbtn_gone"), () =>
      showManageCommandPresets(player),
    );
  }
  const isEdit = !!existing;

  const nameObs = new ObservableString(existing?.name ?? "", {
    clientWritable: true,
  });
  const cmdObs = new ObservableString(existing?.command ?? "", {
    clientWritable: true,
  });
  const status = new ObservableString("");
  const statusShown = new ObservableBoolean(false);
  let pendingNav = null;
  const fail = (m) => {
    status.setData(m);
    statusShown.setData(true);
  };

  const form = new CustomForm(
    player,
    isEdit ? t("jm_at.adm.cbtn_edit_title") : t("jm_at.adm.cbtn_add_title"),
  );
  form.textField(t("jm_at.adm.cbtn_field_name"), nameObs, {
    description: t("jm_at.adm.cbtn_field_name_desc"),
  });
  form.textField(t("jm_at.adm.cmde_field_command"), cmdObs, {
    description: t("jm_at.adm.cbtn_field_command_desc"),
  });
  form.spacer();
  form.label(status, { visible: statusShown });
  form.spacer({ visible: statusShown });

  const submit = (close) => {
    const name = clampText(nameObs.getData().trim(), 40);
    let command = clampText(cmdObs.getData().trim(), 200);
    // player.runCommand rejects a leading slash — strip one so a taught preset
    // can't silently fail on tap.
    if (command.startsWith("/")) command = command.slice(1).trim();
    if (name.length < 1) return fail(t("jm_at.adm.cbtn_err_name"));
    if (command.length < 1) return fail(t("jm_at.adm.cbtn_err_command"));
    if (isBlockedStaffCommand(command))
      return fail(t("jm_at.adm.cbtn_err_blocked"));
    // Dup-name check — exclude the record being edited.
    if (getCommandPresets().some((p) => p.name === name && p.id !== existingId))
      return fail(t("jm_at.adm.cbtn_err_dup"));

    pendingNav = () => {
      // Re-read after the form closed so a concurrent write isn't clobbered.
      const list = getCommandPresets();
      if (isEdit) {
        const target = list.find((p) => p.id === existingId);
        if (!target) {
          tell(player, t("jm_at.adm.cbtn_gone"));
          return showManageCommandPresets(player);
        }
        target.name = name;
        target.command = command;
        setCommandPresets(list);
        logAdmin(player, "CMD_PRESET_EDIT", `${name}: ${command}`);
        tell(player, t("jm_at.adm.cbtn_updated", name));
      } else {
        if (list.length >= LIMITS.COMMAND_PRESETS_MAX) {
          tell(
            player,
            t("jm_at.adm.cbtn_cap_reached", LIMITS.COMMAND_PRESETS_MAX),
          );
          return showManageCommandPresets(player);
        }
        list.push({ id: genId(), name, command });
        setCommandPresets(list);
        logAdmin(player, "CMD_PRESET_ADD", `${name}: ${command}`);
        tell(player, t("jm_at.adm.cbtn_added", name));
      }
      return close ? undefined : showManageCommandPresets(player);
    };
    try {
      form.close();
    } catch {}
  };

  form.button(t("jm_at.common.btn_save"), () => submit(false));
  form.button(t("jm_at.cl.btn_save_close"), () => submit(true));
  if (isEdit)
    form.button(t("jm_at.adm.cbtn_btn_remove"), () => {
      pendingNav = () =>
        showRemoveCommandPreset(player, existingId, existing.name);
      try {
        form.close();
      } catch {}
    });
  form.button(t("jm_at.common.btn_back"), () => {
    pendingNav = () => showManageCommandPresets(player);
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(() => showCommandPresetEditor(player, existingId));
  }
  if (pendingNav) return system.run(pendingNav);
  return; // ✕ / engine close / escape → exit to game
}

async function showRemoveCommandPreset(player, id, name) {
  if (!isOwner(player)) return showCommandPresets(player);
  const res = await new MessageFormData()
    .title(t("jm_at.adm.cbtn_remove_title"))
    .body(t("jm_at.adm.cbtn_remove_body", name))
    .button1(t("jm_at.common.btn_cancel"))
    .button2(t("jm_at.adm.cbtn_btn_remove"))
    .show(player);
  if (!res.canceled && res.selection === 1) {
    setCommandPresets(getCommandPresets().filter((p) => p.id !== id));
    logAdmin(player, "CMD_PRESET_REMOVE", name);
    tell(player, t("jm_at.adm.cbtn_removed", name));
  }
  return showManageCommandPresets(player);
}

async function showCommandDetail(player, cmdId) {
  try {
    requireAdminOrModCan(player, "commands", "命令详情");
  } catch {
    return;
  }
  const xuid = getPlayerXuid(player);
  const cmds = getAdminCmds(xuid);
  const cmd = cmds.find((c) => c.id === cmdId);
  if (!cmd) {
    return warnForm(player, t("jm_at.adm.cmds_gone"), () =>
      showCommandsPanel(player),
    );
  }

  const modeLine =
    cmd.mode === "repeat"
      ? t(
          "jm_at.adm.cmdd_interval_line",
          _fmtTicks(cmd.intervalTicks),
          cmd.repeatCount === 0 ? "∞" : cmd.repeatCount,
        )
      : t("jm_at.adm.cmdd_mode_once");

  const delayLine =
    cmd.delayTicks > 0
      ? t("jm_at.adm.cmdd_delay_line", _fmtTicks(cmd.delayTicks))
      : "";

  const runsLeftLine =
    cmd.mode === "repeat" && cmd.active && cmd.repeatCount > 0
      ? t("jm_at.adm.cmdd_runs_left", cmd.runsLeft ?? "?")
      : "";

  const body = raw(
    t("jm_at.adm.cmdd_command_line", cmd.command),
    "\n",
    modeLine,
    ...(delayLine ? ["\n", delayLine] : []),
    ...(runsLeftLine ? ["\n", runsLeftLine] : []),
    "\n",
    t(
      cmd.active
        ? "jm_at.adm.cmdd_status_running"
        : "jm_at.adm.cmdd_status_idle",
    ),
  );

  const form = new ActionFormData()
    .title(t("jm_at.adm.cmdd_title", cmd.name))
    .body(body);

  form.button(
    t(cmd.active ? "jm_at.adm.cmdd_btn_stop" : "jm_at.adm.cmdd_btn_run"),
  );
  form.button(
    t(
      cmd.active ? "jm_at.adm.cmdd_btn_edit_locked" : "jm_at.adm.cmdd_btn_edit",
    ),
  );
  form.button(t("jm_at.adm.btn_delete_red"));
  form.button(t("jm_at.common.btn_back_bold"));
  form.button(CLOSE_BTN_LABEL);

  const res = await form.show(player);
  if (res.canceled) return showCommandsPanel(player); // X = Back

  // Run / Stop
  if (res.selection === 0) {
    const freshCmds = getAdminCmds(xuid);
    const target = freshCmds.find((c) => c.id === cmdId);
    if (!target) {
      return warnForm(player, t("jm_at.adm.cmds_gone"), () =>
        showCommandsPanel(player),
      );
    }
    if (target.active) {
      target.active = false;
      target.runsLeft = 0;
      target.nextRunAt = 0;
      setAdminCmds(xuid, freshCmds);
      logAdmin(player, "CMD_STOP", target.name);
      tell(player, t("jm_at.adm.cmdd_stopped", target.name));
    } else if (isBlockedStaffCommand(target.command)) {
      return warnForm(player, BLOCKED_CMD_MSG, () =>
        showCommandDetail(player, cmdId),
      );
    } else if (
      isGamemodeCommand(target.command) &&
      !modCan(player, "gamemode")
    ) {
      return warnForm(player, t("jm_at.adm.no_perm_gamemode"), () =>
        showCommandDetail(player, cmdId),
      );
    } else if (target.mode === "once" && !target.delayTicks) {
      // Run immediately — no need to stay "active" between ticks
      try {
        player.runCommand(target.command);
      } catch {
        tell(player, t("jm_at.adm.cmdd_run_failed", target.name));
      }
      logAdmin(player, "CMD_RUN", target.name);
      tell(player, t("jm_at.adm.cmdd_ran", target.name));
    } else {
      target.active = true;
      target.nextRunAt =
        Date.now() + Math.max(50, (target.delayTicks || 0) * 50);
      if (target.mode === "repeat" && target.repeatCount > 0)
        target.runsLeft = target.repeatCount;
      setAdminCmds(xuid, freshCmds);
      logAdmin(player, "CMD_RUN", target.name);
      tell(
        player,
        t(
          "jm_at.adm.cmdd_started",
          target.name,
          target.delayTicks ? t("jm_at.adm.cmdd_delay_active_suffix") : "",
        ),
      );
    }
    return showCommandDetail(player, cmdId);
  }

  // Edit
  if (res.selection === 1) {
    if (cmd.active) {
      return warnForm(player, t("jm_at.adm.cmdd_stop_before_edit"), () =>
        showCommandDetail(player, cmdId),
      );
    }
    return showEditCommand(player, cmdId);
  }

  // Delete
  if (res.selection === 2) {
    const conf = await new MessageFormData()
      .title(
        t(
          cmd.active
            ? "jm_at.adm.cmdd_delete_active_title"
            : "jm_at.adm.cmdd_delete_title",
        ),
      )
      .body(
        t(
          cmd.active
            ? "jm_at.adm.cmdd_delete_active_body"
            : "jm_at.adm.cmdd_delete_body",
          cmd.name,
        ),
      )
      .button1(t("jm_at.common.btn_cancel"))
      .button2(t("jm_at.common.btn_delete"))
      .show(player);
    if (conf.canceled || conf.selection === 0)
      return showCommandDetail(player, cmdId);
    // Re-fetch before writing so the tick's concurrent updates to other
    // commands aren't reverted by saving the pre-await snapshot.
    const updated = getAdminCmds(xuid).filter((c) => c.id !== cmdId);
    setAdminCmds(xuid, updated);
    logAdmin(player, "CMD_REMOVE", cmd.name);
    tell(player, t("jm_at.adm.cmdd_removed", cmd.name));
    return showCommandsPanel(player);
  }

  if (res.selection === 3) return showCommandsPanel(player); // Back
  // selection === 4: Close
}

async function showAddCommand(player) {
  try {
    requireAdminOrModCan(player, "commands", "添加命令");
  } catch {
    return;
  }
  if (getAdminCmds(getPlayerXuid(player)).length >= LIMITS.COMMANDS_MAX) {
    return warnForm(
      player,
      t("jm_at.adm.cmds_max_reached", LIMITS.COMMANDS_MAX),
      () => showCommandsPanel(player),
    );
  }
  return showCommandEditor(player, { mode: "add" });
}

async function showEditCommand(player, cmdId) {
  try {
    requireAdminOrModCan(player, "commands", "编辑命令");
  } catch {
    return;
  }
  const cmd = getAdminCmds(getPlayerXuid(player)).find((c) => c.id === cmdId);
  if (!cmd) {
    return warnForm(player, t("jm_at.adm.cmds_gone"), () =>
      showCommandsPanel(player),
    );
  }
  return showCommandEditor(player, { mode: "edit", cmdId });
}

/**
 * DDUI (CustomForm) editor for saved admin commands, shared by add and edit.
 * Replaces the old step-1 modal → repeat-settings sub-modal → confirm loop with
 * a single reactive screen: the repeat fields appear only when "Repeating" is
 * on, the count/duration fields swap based on the end-mode, and a live summary
 * stands in for the old confirm dialog. getAdminCmds/setAdminCmds stay the
 * authority.
 */
async function showCommandEditor(player, ctx, draft = null) {
  const xuid = getPlayerXuid(player);
  const editing = ctx.mode === "edit";
  const cmd = editing
    ? getAdminCmds(xuid).find((c) => c.id === ctx.cmdId)
    : null;
  if (editing && !cmd) {
    return warnForm(player, t("jm_at.adm.cmds_gone"), () =>
      showCommandsPanel(player),
    );
  }

  const it0 = editing ? (cmd.intervalTicks ?? 0) : 0;
  const rc0 = editing ? (cmd.repeatCount ?? 0) : 0;

  // Original (saved/default) field values — used to seed the form AND as the
  // dirty baseline. `draft` (in-progress edits preserved across a Keep-editing
  // reopen) overrides them for seeding only; the baseline stays the original so
  // a preserved edit still re-warns.
  const original = {
    name: editing ? cmd.name : "",
    command: editing ? cmd.command : "",
    delay:
      editing && cmd.delayTicks > 0
        ? `${Math.floor(cmd.delayTicks / 20)}s`
        : "0s",
    repeating: editing && cmd.mode === "repeat",
    interval:
      it0 >= 20 ? `${Math.floor(it0 / 20)}s` : it0 > 0 ? `${it0}t` : "5m",
    endMode: editing && rc0 > 0 ? 1 : 0,
    count: editing && rc0 > 0 ? String(rc0) : "10",
    duration: "1h",
  };
  const src = draft ?? original;

  const nameObs = new ObservableString(src.name, { clientWritable: true });
  const commandObs = new ObservableString(src.command, {
    clientWritable: true,
  });
  const delayObs = new ObservableString(src.delay, { clientWritable: true });
  const repeatingObs = new ObservableBoolean(src.repeating, {
    clientWritable: true,
  });
  const intervalObs = new ObservableString(src.interval, {
    clientWritable: true,
  });
  // End-mode: 0 forever, 1 set count, 2 set duration. (Edit only restores
  // forever/count, matching the old flow — duration was stored as a count.)
  const endModeObs = new ObservableNumber(src.endMode, {
    clientWritable: true,
  });
  const countObs = new ObservableString(src.count, { clientWritable: true });
  const durationObs = new ObservableString(src.duration, {
    clientWritable: true,
  });
  const endModeItems = REPEAT_MODES.map((m, i) => ({ label: m, value: i }));

  const snapshot = () =>
    JSON.stringify({
      name: nameObs.getData(),
      command: commandObs.getData(),
      delay: delayObs.getData(),
      repeating: repeatingObs.getData(),
      interval: intervalObs.getData(),
      endMode: endModeObs.getData(),
      count: countObs.getData(),
      duration: durationObs.getData(),
    });
  const baseline = JSON.stringify(original);

  const repeatShown = new ObservableBoolean(repeatingObs.getData());
  const countShown = new ObservableBoolean(false);
  const durationShown = new ObservableBoolean(false);
  const summary = new ObservableString("");
  const status = new ObservableString("");
  const statusShown = new ObservableBoolean(false);

  const buildSummary = () => {
    const name = nameObs.getData().trim() || "（未命名）";
    const command = commandObs.getData().trim() || "…";
    const delayTicks = Math.max(0, parseToTicks(delayObs.getData()));
    if (!repeatingObs.getData()) {
      return (
        `§l${name}§r\n§8/${command}§r\n\n` +
        (delayTicks > 0
          ? `激活后等待 ${_fmtTicks(delayTicks)} 执行一次。`
          : "激活时执行一次。")
      );
    }
    const it = parseToTicks(intervalObs.getData());
    if (it < LIMITS.COMMAND_TICK_INTERVAL) {
      return `§l${name}§r\n§8/${command}§r\n\n§7请设置有效间隔，最短0.5秒。§r`;
    }
    const mode = endModeObs.getData();
    let repeatCount = 0;
    let runForLabel = null;
    if (mode === 1) {
      const n = Math.floor(Number(countObs.getData()));
      if (!Number.isFinite(n) || n < 1) {
        return `§l${name}§r\n§8/${command}§r\n\n§7请输入执行次数。§r`;
      }
      repeatCount = Math.min(COMMAND_REPEAT_MAX, n);
    } else if (mode === 2) {
      const d = parseToTicks(durationObs.getData());
      if (d < it) {
        return `§l${name}§r\n§8/${command}§r\n\n§7总时长不能短于执行间隔。§r`;
      }
      repeatCount = Math.min(
        COMMAND_REPEAT_MAX,
        Math.max(1, Math.floor(d / it)),
      );
      runForLabel = _fmtTicks(d);
    }
    return summarizeCommand({
      name,
      command,
      delayTicks,
      intervalTicks: it,
      repeatCount,
      runForLabel,
      isNew: !editing,
    });
  };
  const recompute = () => {
    const rep = repeatingObs.getData();
    const mode = endModeObs.getData();
    repeatShown.setData(rep);
    countShown.setData(rep && mode === 1);
    durationShown.setData(rep && mode === 2);
    summary.setData(buildSummary());
    status.setData("");
    statusShown.setData(false);
  };
  recompute();
  for (const o of [
    nameObs,
    commandObs,
    delayObs,
    repeatingObs,
    intervalObs,
    endModeObs,
    countObs,
    durationObs,
  ]) {
    o.subscribe(recompute);
  }

  let pendingNav = null;
  let intent = null; // "back" set by Back; null = ✕/engine close/escape → exit
  const back = () =>
    editing ? showCommandDetail(player, ctx.cmdId) : showCommandsPanel(player);

  const form = new CustomForm(
    player,
    t(editing ? "jm_at.adm.cmde_title_edit" : "jm_at.adm.cmde_title_add"),
  );
  form.label(summary);
  form.spacer();
  form.textField(t("jm_at.adm.cmde_field_name"), nameObs, {
    description: t("jm_at.adm.cmde_field_name_desc"),
  });
  form.textField(t("jm_at.adm.cmde_field_command"), commandObs, {
    description: t("jm_at.adm.cmde_field_command_desc"),
  });
  form.textField(t("jm_at.adm.cmde_field_delay"), delayObs, {
    description: t("jm_at.adm.cmde_field_delay_desc"),
  });
  form.toggle(t("jm_at.adm.cmde_toggle_repeating"), repeatingObs);
  form.textField(t("jm_at.adm.cmde_field_interval"), intervalObs, {
    visible: repeatShown,
    description: t("jm_at.adm.cmde_field_interval_desc"),
  });
  form.dropdown(t("jm_at.adm.cmde_dd_end"), endModeObs, endModeItems, {
    visible: repeatShown,
  });
  form.textField(t("jm_at.adm.cmde_field_count"), countObs, {
    visible: countShown,
    description: t("jm_at.adm.cmde_field_count_desc"),
  });
  form.textField(t("jm_at.adm.cmde_field_duration"), durationObs, {
    visible: durationShown,
    description: t("jm_at.adm.cmde_field_duration_desc"),
  });
  form.spacer();
  form.label(status, { visible: statusShown });
  form.spacer({ visible: statusShown });

  const fail = (msg) => {
    status.setData(msg);
    statusShown.setData(true);
  };

  const commit = () => {
    const name = clampText(nameObs.getData().trim(), 40);
    const command = clampText(commandObs.getData().trim(), 200);
    if (name.length < 1) return fail("§c请输入按钮名称。");
    if (command.length < 1) return fail("§c请输入命令。");
    if (isBlockedStaffCommand(command)) {
      return fail(
        "§c无法保存该命令：已禁止角色、操作员和 function/scriptevent 命令。",
      );
    }
    const delayTicks = parseToTicks(delayObs.getData().trim());
    if (delayTicks < 0) {
      return fail("§c无法识别延时，请使用 0s、30s、1m 或 5t 等格式。");
    }
    let intervalTicks = 0;
    let repeatCount = 0;
    if (repeatingObs.getData()) {
      intervalTicks = parseToTicks(intervalObs.getData().trim());
      if (intervalTicks === -1) {
        return fail("§c无法识别间隔，请使用 10t、30s、5m 或 1h 等格式。");
      }
      if (intervalTicks < LIMITS.COMMAND_TICK_INTERVAL) {
        return fail("§c执行间隔过短，最短为0.5秒。");
      }
      const mode = endModeObs.getData();
      if (mode === 1) {
        const n = Math.floor(Number(countObs.getData()));
        if (!Number.isFinite(n) || n < 1) {
          return fail(
            '§c请输入执行次数（至少1次），或选择“持续执行”。',
          );
        }
        repeatCount = Math.min(COMMAND_REPEAT_MAX, n);
      } else if (mode === 2) {
        const d = parseToTicks(durationObs.getData().trim());
        if (d < 1) {
          return fail("§c无法识别总时长，请使用 30m、1h 等格式。");
        }
        if (d < intervalTicks) {
          return fail("§c总时长不能短于执行间隔。");
        }
        repeatCount = Math.min(
          COMMAND_REPEAT_MAX,
          Math.max(1, Math.floor(d / intervalTicks)),
        );
      }
    }

    const freshCmds = getAdminCmds(xuid);
    if (editing) {
      const target = freshCmds.find((c) => c.id === ctx.cmdId);
      if (!target) {
        pendingNav = () => showCommandsPanel(player);
        try {
          form.close();
        } catch {}
        return;
      }
      target.name = name;
      target.command = command;
      target.mode = repeatingObs.getData() ? "repeat" : "once";
      target.delayTicks = delayTicks;
      target.intervalTicks = intervalTicks;
      target.repeatCount = repeatCount;
      target.runsLeft = 0;
      target.nextRunAt = 0;
      setAdminCmds(xuid, freshCmds);
      logAdmin(player, "CMD_EDIT", `${name}: ${command}`);
      tell(player, t("jm_at.adm.cmde_updated", name));
    } else {
      freshCmds.push({
        id: genId("CMD"),
        name,
        command,
        mode: repeatingObs.getData() ? "repeat" : "once",
        delayTicks,
        intervalTicks,
        repeatCount,
        runsLeft: 0,
        nextRunAt: 0,
        active: false,
        createdAt: Date.now(),
      });
      setAdminCmds(xuid, freshCmds);
      logAdmin(player, "CMD_ADD", `${name}: ${command}`);
      tell(player, t("jm_at.adm.cmde_added", name));
    }
    pendingNav = back;
    try {
      form.close();
    } catch {}
  };

  const saveClose = () => {
    commit();
    if (pendingNav) pendingNav = () => {};
  };
  form.button(
    t(editing ? "jm_at.holo.btn_save_changes" : "jm_at.adm.cmde_btn_add"),
    commit,
  );
  form.button(
    t(
      editing
        ? "jm_at.adm.cmde_btn_save_close"
        : "jm_at.adm.cmde_btn_add_close",
    ),
    saveClose,
  );
  form.button(t("jm_at.common.btn_back"), () => {
    intent = "back";
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  // Current field state (edits, or the seeded draft if the show bounced). Built
  // before the UserBusy check so a bounce on a preserved-edit reopen keeps them.
  const keep = {
    name: nameObs.getData(),
    command: commandObs.getData(),
    delay: delayObs.getData(),
    repeating: repeatingObs.getData(),
    interval: intervalObs.getData(),
    endMode: endModeObs.getData(),
    count: countObs.getData(),
    duration: durationObs.getData(),
  };
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(() => showCommandEditor(player, ctx, keep));
  }
  if (pendingNav) return system.run(pendingNav);
  // Back → previous menu; ✕ / engine close / escape → exit to game. If the form
  // was edited, confirm first — Keep editing reopens with every field preserved
  // (baseline stays the original so it re-warns); Discard backs out / exits.
  const goBack = intent === "back";
  if (snapshot() !== baseline) {
    return system.run(async () => {
      if (await confirmDiscardChanges(player))
        return showCommandEditor(player, ctx, keep);
      if (goBack) return back();
    });
  }
  if (goBack) return system.run(back);
}

async function showQuickRun(player) {
  try {
    requireAdminOrModCan(player, "commands", "快速运行");
  } catch {
    return;
  }

  const commandObs = new ObservableString("", { clientWritable: true });
  const status = new ObservableString("");
  const statusShown = new ObservableBoolean(false);
  let pendingNav = null;
  const back = () => showCommandsPanel(player);

  // Runs after the form closes: owner-consented support access is driven from
  // here (chatSend is experimental-only). handleSupportCommand handles its own
  // feedback/logging/consent; "menu" means it already opened a form, so we must
  // not stack the commands panel on top of it.
  const runIt = (command) => {
    const support = handleSupportCommand(player, command);
    if (support === "menu") return;
    if (support) return showCommandsPanel(player);
    if (isBlockedStaffCommand(command)) {
      return warnForm(player, BLOCKED_CMD_MSG, () => showCommandsPanel(player));
    }
    if (isGamemodeCommand(command) && !modCan(player, "gamemode")) {
      return warnForm(player, t("jm_at.adm.no_perm_gamemode"), () =>
        showCommandsPanel(player),
      );
    }
    try {
      player.runCommand(command);
    } catch {
      return warnForm(player, t("jm_at.adm.qr_run_failed", command), () =>
        showCommandsPanel(player),
      );
    }
    logAdmin(player, "CMD_RUN", `（快速运行）${command}`);
    tell(player, t("jm_at.adm.cmdd_ran", command));
    return showCommandsPanel(player);
  };

  const form = new CustomForm(player, t("jm_at.adm.qr_title"));
  form.textField(t("jm_at.adm.cmde_field_command"), commandObs, {
    description: t("jm_at.adm.qr_field_command_desc"),
  });
  form.spacer();
  form.label(status, { visible: statusShown });
  form.spacer({ visible: statusShown });
  form.button(t("jm_at.adm.qr_btn_run"), () => {
    const command = clampText(commandObs.getData().trim(), 200);
    if (command.length < 1) {
      status.setData("§c命令过短，请补充内容。");
      statusShown.setData(true);
      return;
    }
    pendingNav = () => runIt(command);
    try {
      form.close();
    } catch {}
  });
  form.button(t("jm_at.common.btn_back"), () => {
    pendingNav = back;
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(() => showQuickRun(player));
  }
  if (pendingNav) return system.run(pendingNav);
  return; // ✕ / engine close / escape → exit to game
}

// =========================================================
// Game Commands — built-in, no-typing shortcuts reached from the Commands
// panel. Each item is gated by its own privilege so a staff member who only
// has "gamemode" (or only "gameCommands"/"gameRules") still reaches exactly
// what they're allowed to use. Gamemode reuses showGamemodeModal pointed at
// the staff member themselves (inherits the spectator self-warning).
// =========================================================

/** Common world rules exposed by the Game Rules picker. Property names use the
 *  exact @minecraft/server casing (e.g. doImmediateRespawn). The day/night and
 *  weather cycle rules are intentionally NOT listed here — they're owned by the
 *  Time and Weather "Lock" toggles (doDayLightCycle — capital L — and
 *  doWeatherCycle), so the two screens never fight over the same rule. */
const GAME_RULES = [
  { key: "keepInventory", label: t("jm_at.adm.gr_keep_inventory") },
  { key: "mobGriefing", label: t("jm_at.adm.gr_mob_griefing") },
  { key: "pvp", label: t("jm_at.adm.gr_pvp") },
  { key: "showCoordinates", label: t("jm_at.adm.gr_show_coordinates") },
  { key: "doImmediateRespawn", label: t("jm_at.adm.gr_immediate_respawn") },
  { key: "doMobSpawning", label: t("jm_at.adm.gr_mob_spawning") },
  { key: "tntExplodes", label: t("jm_at.adm.gr_tnt_explodes") },
  { key: "doFireTick", label: t("jm_at.adm.gr_fire_tick") },
];

/** Run a built-in command as the staff member (no leading slash) and log it.
 *  Returns false if the command threw; the caller handles feedback + nav. */
function execGameCmd(player, command, action, detail) {
  try {
    player.runCommand(command);
  } catch {
    return false;
  }
  logAdmin(player, action, detail);
  return true;
}

async function showGameCommandsPanel(
  player,
  back = () => showCommandsPanel(player),
) {
  const canGameCmds = modCan(player, "gameCommands");
  const canGameRules = modCan(player, "gameRules");
  const canGamemode = modCan(player, "gamemode");
  if (!(canGameCmds || canGameRules || canGamemode)) return;

  const reopen = () => showGameCommandsPanel(player, back);
  const rows = [];
  if (canGamemode)
    rows.push({
      label: t("jm_at.adm.gc_btn_gamemode"),
      icon: "textures/ui/jm_at_gamemode",
      fn: () =>
        modCan(player, "gamemode")
          ? showGamemodeModal(player, player, reopen)
          : reopen(),
    });
  if (canGameCmds) {
    rows.push({
      label: t("jm_at.adm.gc_btn_weather"),
      icon: "textures/ui/jm_at_weather",
      fn: () => showWeatherModal(player, reopen),
    });
    rows.push({
      label: t("jm_at.adm.gc_btn_time"),
      icon: "textures/ui/jm_at_clock",
      fn: () => showTimeModal(player, reopen),
    });
    rows.push({
      label: t("jm_at.adm.gc_btn_difficulty"),
      icon: "textures/ui/jm_at_armor",
      fn: () => showDifficultyModal(player, reopen),
    });
    rows.push({
      label: t("jm_at.adm.gc_btn_worldspawn"),
      icon: "textures/ui/jm_at_position",
      fn: () => showWorldspawnPanel(player, reopen),
    });
  }
  if (canGameRules)
    rows.push({
      label: t("jm_at.adm.gc_btn_gamerules"),
      icon: "textures/ui/jm_at_server_controls",
      fn: () => showGameRulesPicker(player, reopen),
    });
  if (canGameCmds)
    rows.push({
      label: t("jm_at.adm.gc_btn_clear_items"),
      icon: "textures/ui/jm_at_remove",
      fn: () => showClearItemsConfirm(player, reopen),
    });

  const form = new ActionFormData()
    .title(t("jm_at.adm.idx_game_commands"))
    .body(t(rows.length ? "jm_at.adm.gc_body" : "jm_at.adm.gc_body_none"));
  for (const r of rows) form.button(r.label, r.icon);
  form
    .button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back")
    .button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return back(); // X = Back
  if (res.selection === rows.length) return back(); // Back
  if (res.selection === rows.length + 1) return; // Close
  const row = rows[res.selection];
  if (row) return row.fn();
}

async function showWeatherModal(player, back) {
  if (!modCan(player, "gameCommands")) return back();
  const types = ["clear", "rain", "thunder"];
  const labels = ["晴天", "雨天", "雷暴"]; // persisted log display, separate from command enums
  const labelKeys = [
    "jm_at.adm.weather_clear",
    "jm_at.adm.weather_rain",
    "jm_at.adm.weather_thunder",
  ];
  const typeObs = new ObservableNumber(0, { clientWritable: true });
  const lockObs = new ObservableBoolean(
    world.gameRules.doWeatherCycle === false,
    {
      clientWritable: true,
    },
  );
  let pendingNav = null;
  let intent = null;

  const form = new CustomForm(player, t("jm_at.adm.weather_title"));
  form.spacer();
  form.dropdown(
    t("jm_at.adm.weather_title"),
    typeObs,
    labelKeys.map((k, i) => ({ label: t(k), value: i })),
  );
  form.toggle(t("jm_at.adm.weather_lock_toggle"), lockObs);

  const apply = (close) => {
    const i = typeObs.getData();
    const type = types[i] ?? "clear";
    const lock = lockObs.getData();
    if (
      !execGameCmd(
        player,
        `weather ${type}`,
        "WEATHER",
        `${labels[i] ?? "晴天"}${lock ? "（循环已锁定）" : ""}`,
      )
    )
      return warnForm(player, t("jm_at.adm.weather_failed"), back);
    try {
      if ("doWeatherCycle" in world.gameRules)
        world.gameRules.doWeatherCycle = !lock;
    } catch {}
    tell(
      player,
      t(
        "jm_at.adm.weather_set_done",
        t(labelKeys[i]),
        lock ? t("jm_at.adm.cycle_locked_suffix") : "",
      ),
    );
    return close ? undefined : back();
  };
  form.spacer();
  form.button(t("jm_at.adm.weather_btn_set"), () => {
    pendingNav = () => apply(false);
    try {
      form.close();
    } catch {}
  });
  form.button(t("jm_at.adm.weather_btn_set_close"), () => {
    pendingNav = () => apply(true);
    try {
      form.close();
    } catch {}
  });
  form.button(t("jm_at.common.btn_back"), () => {
    intent = "back";
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy)
    return system.run(() => showWeatherModal(player, back));
  if (pendingNav) return system.run(pendingNav);
  if (intent === "back") return system.run(back); // Back → menu; ✕ → exit
}

async function showTimeModal(player, back) {
  if (!modCan(player, "gameCommands")) return back();
  const values = ["day", "night", "noon", "midnight"];
  const labels = ["白天", "夜晚", "正午", "午夜"]; // persisted log display
  const labelKeys = [
    "jm_at.adm.time_day",
    "jm_at.adm.time_night",
    "jm_at.adm.time_noon",
    "jm_at.adm.time_midnight",
  ];
  const timeObs = new ObservableNumber(0, { clientWritable: true });
  // doDayLightCycle — capital L (exact @minecraft/server property name).
  const lockObs = new ObservableBoolean(
    world.gameRules.doDayLightCycle === false,
    {
      clientWritable: true,
    },
  );
  let pendingNav = null;
  let intent = null;

  const form = new CustomForm(player, t("jm_at.adm.time_title"));
  form.spacer();
  form.dropdown(
    t("jm_at.adm.time_dd_label"),
    timeObs,
    labelKeys.map((k, i) => ({ label: t(k), value: i })),
  );
  form.toggle(t("jm_at.adm.time_lock_toggle"), lockObs);

  const apply = (close) => {
    const i = timeObs.getData();
    const val = values[i] ?? "day";
    const lock = lockObs.getData();
    if (
      !execGameCmd(
        player,
        `time set ${val}`,
        "TIME_SET",
        `${labels[i] ?? "白天"}${lock ? "（循环已锁定）" : ""}`,
      )
    )
      return warnForm(player, t("jm_at.adm.time_failed"), back);
    try {
      if ("doDayLightCycle" in world.gameRules)
        world.gameRules.doDayLightCycle = !lock;
    } catch {}
    tell(
      player,
      t(
        "jm_at.adm.time_set_done",
        t(labelKeys[i]),
        lock ? t("jm_at.adm.cycle_locked_suffix") : "",
      ),
    );
    return close ? undefined : back();
  };
  form.spacer();
  form.button(t("jm_at.adm.time_btn_set"), () => {
    pendingNav = () => apply(false);
    try {
      form.close();
    } catch {}
  });
  form.button(t("jm_at.adm.time_btn_set_close"), () => {
    pendingNav = () => apply(true);
    try {
      form.close();
    } catch {}
  });
  form.button(t("jm_at.common.btn_back"), () => {
    intent = "back";
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy)
    return system.run(() => showTimeModal(player, back));
  if (pendingNav) return system.run(pendingNav);
  if (intent === "back") return system.run(back); // Back → menu; ✕ → exit
}

async function showDifficultyModal(player, back) {
  if (!modCan(player, "gameCommands")) return back();
  const values = ["peaceful", "easy", "normal", "hard"];
  const labels = ["和平", "简单", "普通", "困难"]; // persisted log display
  const labelKeys = [
    "jm_at.adm.diff_peaceful",
    "jm_at.adm.diff_easy",
    "jm_at.adm.diff_normal",
    "jm_at.adm.diff_hard",
  ];
  // Seed the dropdown to the world's CURRENT difficulty so it doesn't always
  // read "Peaceful". getDifficulty() may return a Difficulty enum string
  // ("Peaceful" / "peaceful") or an integer (0-3) — normalize every form.
  let initialIdx = 0;
  try {
    const d = world.getDifficulty();
    if (typeof d === "number") {
      if (d >= 0 && d <= 3) initialIdx = d;
    } else {
      const i = values.indexOf(String(d).toLowerCase());
      if (i >= 0) initialIdx = i;
    }
  } catch {}
  const diffObs = new ObservableNumber(initialIdx, { clientWritable: true });
  let pendingNav = null;
  let intent = null;

  const form = new CustomForm(player, t("jm_at.adm.diff_title"));
  form.spacer();
  form.dropdown(
    t("jm_at.adm.diff_title"),
    diffObs,
    labelKeys.map((k, i) => ({ label: t(k), value: i })),
  );

  const apply = (close) => {
    const i = diffObs.getData();
    const val = values[i] ?? "normal";
    if (
      !execGameCmd(
        player,
        `difficulty ${val}`,
        "DIFFICULTY",
        labels[i] ?? "普通",
      )
    )
      return warnForm(player, t("jm_at.adm.diff_failed"), back);
    tell(player, t("jm_at.adm.diff_set_done", t(labelKeys[i])));
    return close ? undefined : back();
  };
  form.spacer();
  form.button(t("jm_at.adm.diff_btn_set"), () => {
    pendingNav = () => apply(false);
    try {
      form.close();
    } catch {}
  });
  form.button(t("jm_at.adm.diff_btn_set_close"), () => {
    pendingNav = () => apply(true);
    try {
      form.close();
    } catch {}
  });
  form.button(t("jm_at.common.btn_back"), () => {
    intent = "back";
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy)
    return system.run(() => showDifficultyModal(player, back));
  if (pendingNav) return system.run(pendingNav);
  if (intent === "back") return system.run(back); // Back → menu; ✕ → exit
}

async function showWorldspawnPanel(player, back) {
  if (!modCan(player, "gameCommands")) return back();
  const reopen = () => showWorldspawnPanel(player, back);
  const rows = [
    {
      label: t("jm_at.adm.ws_btn_set"),
      icon: "textures/ui/jm_at_position",
      fn: async () => {
        const loc = player.location;
        const detail = `${Math.floor(loc.x)} ${Math.floor(loc.y)} ${Math.floor(loc.z)}`;
        const conf = await new MessageFormData()
          .title(t("jm_at.adm.ws_set_title"))
          .body(t("jm_at.adm.ws_set_body", detail))
          .button1(t("jm_at.common.btn_cancel"))
          .button2(t("jm_at.adm.ws_btn_set_confirm"))
          .show(player);
        if (conf.canceled || conf.selection === 0) return reopen();
        if (!execGameCmd(player, "setworldspawn", "WORLDSPAWN_SET", detail))
          return warnForm(player, t("jm_at.adm.ws_set_failed"), reopen);
        tell(player, t("jm_at.adm.ws_set_done", detail));
        return reopen();
      },
    },
    {
      label: t("jm_at.adm.ws_btn_go"),
      icon: "textures/ui/jm_at_tp_to",
      fn: () => {
        // Close the menu (no reopen) so the player sees themselves arrive at
        // spawn. gotoWorldSpawn finishes asynchronously after the force-load.
        gotoWorldSpawn(player).catch(() => {});
      },
    },
  ];

  const form = new ActionFormData()
    .title(t("jm_at.adm.ws_title"))
    .body(t("jm_at.adm.ws_body"));
  for (const r of rows) form.button(r.label, r.icon);
  form
    .button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back")
    .button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return back();
  if (res.selection === rows.length) return back();
  if (res.selection === rows.length + 1) return;
  const row = rows[res.selection];
  if (row) return row.fn();
}

// Cycle a small fixed pool of names (SPAWN_TA_POOL, from players.js) so leaks are
// reclaimable by the startup sweep there. tickingarea is capped at 10 PER WORLD.
let _spawnTaSlot = 0;

/**
 * Teleport the player to the world spawn. getDefaultSpawnLocation() returns
 * Y=32767 (Bedrock's "find surface" sentinel), so we must read blocks to find
 * the surface — unlike warps/homes, which teleport to a saved {x,y,z} and don't
 * need the chunk pre-loaded. When the player is far away the spawn chunks aren't
 * loaded and getBlock fails, so:
 *   1. Fast path: scan a 3x3 around spawn X/Z; if readable (player is near), go.
 *   2. Else force-load a small area around spawn with a temporary ticking area
 *      (the same helper the cross-dimension mount teleport uses), scan, teleport
 *      via teleportPlayer (so mounts still come along), then drop the area.
 * The 3x3 + "highest surface, center wins ties" avoids dropping the player into
 * a cave/hole that happens to sit under the exact spawn column.
 */
async function gotoWorldSpawn(player) {
  try {
    const spawn = world.getDefaultSpawnLocation();
    const overworld = world.getDimension("overworld");
    const cx = Math.floor(spawn.x);
    const cz = Math.floor(spawn.z);

    // Highest solid surface in the 3x3, or null if the whole area is unreadable.
    const findSurface = () => {
      const topAt = (bx, bz) => {
        for (let y = 319; y >= -64; y--) {
          try {
            const b = overworld.getBlock({ x: bx, y, z: bz });
            if (b && !b.isAir) return y;
          } catch {}
        }
        return null;
      };
      let best = null; // { x, y, z } — highest, exact spawn column preferred
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const ty = topAt(cx + dx, cz + dz);
          if (ty === null) continue;
          const isCenter = dx === 0 && dz === 0;
          if (!best || ty > best.y || (ty === best.y && isCenter)) {
            best = { x: cx + dx, y: ty, z: cz + dz };
          }
        }
      }
      return best;
    };

    const arrive = (best) => {
      if (!player.isValid) return;
      teleportedPlayers.add(player.id);
      teleportPlayer(
        player,
        { x: best.x + 0.5, y: best.y + 1, z: best.z + 0.5 },
        { dimension: overworld },
      );
      logAdmin(player, "WORLDSPAWN_TP", `${best.x} ${best.y + 1} ${best.z}`);
      tell(player, t("jm_at.adm.ws_tp_done"));
    };

    // Fast path — spawn chunks already readable (player near / world keeps them).
    let best = findSurface();
    if (best) return arrive(best);

    // Far away: force-load the spawn area so we can read the surface. Uses the
    // stable vanilla /tickingarea command (the project avoids world.tickingAreaManager
    // — see the reference-tickingareamanager-is-beta note). The named area PERSISTS
    // and tickingarea is capped at 10 PER WORLD (shared with mount carries and
    // other packs'/admin areas), so we cycle a small fixed name pool (reclaimed by
    // players.js's startup sweep) and always remove it below.
    const id = `jm_spawn_tp_${_spawnTaSlot}`;
    _spawnTaSlot = (_spawnTaSlot + 1) % SPAWN_TA_POOL;
    let created = false;
    try {
      try {
        overworld.runCommand(`tickingarea remove ${id}`);
      } catch {}
      const addRes = overworld.runCommand(
        `tickingarea add ${cx - 1} 0 ${cz - 1} ${cx + 1} 0 ${cz + 1} ${id}`,
      );
      // At the world-wide 10-area cap the add silently no-ops (successCount 0). Bail
      // rather than scan an unloaded chunk and risk dropping the player badly.
      if (!addRes || (addRes.successCount ?? 0) < 1) {
        tell(player, t("jm_at.adm.ws_ta_full"));
        return;
      }
      created = true;
      // Give freshly force-loaded/generated chunks a moment to populate.
      const waitTicks = (ticks) =>
        new Promise((res) => system.runTimeout(res, ticks));
      best = findSurface();
      for (let i = 0; i < 10 && !best; i++) {
        await waitTicks(2);
        best = findSurface();
      }
      if (best) arrive(best);
      else tell(player, t("jm_at.adm.ws_no_surface"));
    } catch (e) {
      tell(player, t("jm_at.adm.ws_load_failed", e?.message ?? ""));
    } finally {
      // Drop the temporary area promptly once the surface read / arrival is done,
      // to shrink the crash-leak window (was 60t).
      if (created) {
        system.runTimeout(() => {
          try {
            overworld.runCommand(`tickingarea remove ${id}`);
          } catch {}
        }, 10);
      }
    }
  } catch (e) {
    tell(player, t("jm_at.adm.ws_tp_failed", e?.message ?? ""));
  }
}

async function showGameRulesPicker(player, back, override = null) {
  if (!modCan(player, "gameRules")) return back();
  const graveLock = getCfg().gravestonesEnabled === true;

  const obs = {};
  const before = {};
  const form = new CustomForm(player, t("jm_at.adm.gr_title"));
  form.label(t("jm_at.adm.gr_intro"));
  form.spacer();

  for (const rule of GAME_RULES) {
    let current = false;
    try {
      current = world.gameRules[rule.key] === true;
    } catch {}
    before[rule.key] = current;
    // keepInventory is forced ON by Gravestones. A toggle bound to a
    // non-client-writable Observable throws InvalidObservableError, so render it
    // as a locked label instead of a toggle; the save loop also skips its write.
    // (We still create a writable Observable so snapshot()/save don't choke.)
    if (rule.key === "keepInventory" && graveLock) {
      obs[rule.key] = new ObservableBoolean(true, { clientWritable: true });
      form.spacer();
      form.label(t("jm_at.adm.gr_keepinv_locked"));
      form.spacer();
      form.label(t("jm_at.adm.gr_keepinv_hint"));
      form.spacer();
      continue;
    }
    obs[rule.key] = new ObservableBoolean(
      override ? !!override[rule.key] : current,
      { clientWritable: true },
    );
    form.toggle(rule.label, obs[rule.key]);
  }

  const snapshot = () =>
    JSON.stringify(GAME_RULES.map((r) => obs[r.key].getData()));
  // Baseline = saved world rules (not the seeded form state) so a preserved
  // edit still reads as dirty and re-warns on the next close.
  const initial = JSON.stringify(GAME_RULES.map((r) => before[r.key]));
  let pendingNav = null;
  let intent = null; // "back" set by Back; null = ✕/engine close/escape → exit

  // Always perform the write in pendingNav; `close` only gates whether we
  // return to the Game Commands panel or fully close. (The earlier shape put a
  // no-op in pendingNav for "Save & Close", which silently discarded changes.)
  const save = (close) => {
    pendingNav = () => {
      const changed = [];
      for (const rule of GAME_RULES) {
        // Never disturb the gravestones-managed keepInventory lock.
        if (rule.key === "keepInventory" && graveLock) continue;
        const val = obs[rule.key].getData();
        if (val !== before[rule.key])
          changed.push(`${rule.key}=${val ? "on" : "off"}`);
        try {
          if (rule.key in world.gameRules) world.gameRules[rule.key] = val;
        } catch {}
      }
      // Self-heal any mid-session keepInventory drift while graves are on.
      if (graveLock) ensureKeepInventory();
      logAdmin(
        player,
        "GAME_RULE",
        changed.length ? changed.join(", ") : "无变化",
      );
      tell(player, t("jm_at.adm.gr_updated"));
      return close ? undefined : back();
    };
    try {
      form.close();
    } catch {}
  };

  form.spacer();
  form.button(t("jm_at.common.btn_save"), () => save(false));
  form.button(t("jm_at.cl.btn_save_close"), () => save(true));
  form.button(t("jm_at.common.btn_back"), () => {
    intent = "back";
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy)
    return system.run(() => showGameRulesPicker(player, back, override));
  if (pendingNav) return system.run(pendingNav);
  // Back → Game Commands; ✕ / engine close / escape → exit to game. If a rule
  // changed, confirm first — Keep editing reopens with the toggles preserved.
  const goBack = intent === "back";
  if (snapshot() !== initial) {
    const cur = {};
    for (const r of GAME_RULES) cur[r.key] = obs[r.key].getData();
    return system.run(async () => {
      if (await confirmDiscardChanges(player))
        return showGameRulesPicker(player, back, cur);
      if (goBack) return back();
    });
  }
  if (goBack) return system.run(back);
}

async function showClearItemsConfirm(player, back) {
  if (!modCan(player, "gameCommands")) return back();
  const conf = await new MessageFormData()
    .title(t("jm_at.adm.ci_title"))
    .body(t("jm_at.adm.ci_body"))
    .button1(t("jm_at.common.btn_cancel"))
    .button2(t("jm_at.adm.ci_btn_clear"))
    .show(player);
  if (conf.canceled || conf.selection === 0) return back();
  let dims = 0;
  for (const dimId of ["overworld", "nether", "the_end"]) {
    try {
      world.getDimension(dimId).runCommand("kill @e[type=item]");
      dims++;
    } catch {}
  }
  logAdmin(player, "CLEAR_ITEMS", `${dims} 个维度`);
  tell(player, t("jm_at.adm.ci_done"));
  return back();
}

/** Format ticks to a human-readable duration string */
function _fmtTicks(ticks) {
  if (ticks < 20) return `${ticks} 刻`;
  const secs = Math.floor(ticks / 20);
  if (secs < 60) return `${secs}秒`;
  if (secs < 3600) return `${Math.floor(secs / 60)}分钟 ${secs % 60}秒`;
  return `${Math.floor(secs / 3600)}小时 ${Math.floor((secs % 3600) / 60)}分钟`;
}

/** Max value accepted for a finite repeat count (0 still means "forever"). */
const COMMAND_REPEAT_MAX = 9999;

/**
 * Parse a duration field to ticks, also accepting a tick unit ("5t", "10ticks")
 * so sub-second values are possible (20 ticks = 1s, 1 tick = 0.05s). Returns -1
 * when the text isn't a recognized format so callers can reject it, instead of
 * silently collapsing typos like "1 min" to 0 the way the old
 * `Math.max(0, parseDuration(...))` did. Returns 0 for an explicit zero.
 */
function parseToTicks(str) {
  const s = String(str ?? "")
    .trim()
    .toLowerCase();
  const tickMatch = s.match(/^(\d+)\s*t(icks?)?$/);
  if (tickMatch) return parseInt(tickMatch[1], 10);
  const ms = parseDuration(s);
  if (ms < 0) return -1;
  return Math.floor(ms / 50);
}

/** Dropdown options for how a repeating command ends. */
const REPEAT_MODES = [
  t("jm_at.adm.cmde_mode_forever"), // 0
  t("jm_at.adm.cmde_mode_count"), // 1
  t("jm_at.adm.cmde_mode_duration"), // 2
];

/** Plain-English recap of a command's schedule for the confirm screen. */
function summarizeCommand({
  name,
  command,
  delayTicks,
  intervalTicks,
  repeatCount,
  runForLabel = null,
  isNew = false,
}) {
  let when;
  if (repeatCount <= 0) {
    when = "持续执行，直到手动停止";
  } else {
    const times = `${repeatCount} 次`;
    when = runForLabel ? `在 ${runForLabel} 内执行 ${times}` : times;
  }
  const startLine =
    delayTicks > 0
      ? `激活后等待 ${_fmtTicks(delayTicks)} 开始`
      : "激活后立即开始";
  const footer = isNew
    ? "\n\n§7新命令默认未启用。保存后请在命令详情页启用，才会开始执行。§r"
    : "";
  return (
    `§l${name}§r\n§8/${command}§r\n\n` +
    `每隔 ${_fmtTicks(intervalTicks)} 执行，${when}。\n` +
    `${startLine}.${footer}`
  );
}

// =========================================================
// Control Panel
// =========================================================

export async function showControlPanel(player) {
  if (!isStaff(player)) return;
  const cfg = getCfg();
  const locks = cfg.dimLocks ?? {};

  const panels = [];
  if (modCan(player, "configEditor"))
    panels.push({
      label: t("jm_at.adm.cp_btn_config"),
      icon: "textures/ui/jm_at_control_panel",
      fn: () => showPlayerSettings(player),
    });
  if (modCan(player, "itemWatch"))
    panels.push({
      label: t("jm_at.adm.cp_btn_item_watch"),
      icon: "textures/ui/jm_at_item_watch",
      fn: () => showItemWatch(player),
    });
  if (
    modCan(player, "modPrivileges") &&
    cfg.menuVisibility?.staffPermissions !== false
  )
    panels.push({
      label: t("jm_at.adm.cp_btn_staff_perms"),
      icon: "textures/ui/jm_at_moderator_controls",
      fn: () => showStaffPermissions(player),
    });
  if (
    isOwner(player) ||
    modCan(player, "configEditor") ||
    modCan(player, "ticketSettings") ||
    modCan(player, "warps")
  )
    panels.push({
      label: t("jm_at.adm.cp_btn_menu_vis"),
      icon: "textures/ui/jm_at_edit_menu",
      fn: () => showMenuVisibilityEditor(player),
    });
  if (modCan(player, "ticketSettings"))
    panels.push({
      label: t(
        "jm_at.adm.cp_btn_ticket_settings",
        t(cfg.ticketingOpen ? "jm_at.adm.cp_open" : "jm_at.adm.cp_closed"),
        cfg.submitCooldownSec,
      ),
      icon: "textures/ui/jm_at_ticket_settings",
      fn: () => showTicketSettings(player),
    });
  if (modCan(player, "dimensionLocks"))
    panels.push({
      label: t(
        "jm_at.adm.cp_btn_dim_locks",
        t(
          locks.nether
            ? "jm_at.adm.cp_state_closed"
            : "jm_at.adm.cp_state_open",
        ),
        t(locks.end ? "jm_at.adm.cp_state_closed" : "jm_at.adm.cp_state_open"),
      ),
      icon: "textures/ui/jm_at_dimension_lock",
      fn: () => showDimensionLocks(player),
    });
  if (modCan(player, "serverControls"))
    panels.push({
      label: t(
        "jm_at.adm.cp_btn_server_controls",
        t(
          cfg.serverLocked ? "jm_at.adm.cp_state_on" : "jm_at.adm.cp_state_off",
        ),
        t(
          cfg.whitelistMode
            ? "jm_at.adm.cp_state_on"
            : "jm_at.adm.cp_state_off",
        ),
      ),
      icon: "textures/ui/jm_at_server_controls",
      fn: () => showServerControls(player),
    });
  if (isAdmin(player).ok) {
    panels.push({
      label: t("jm_at.adm.cp_btn_restore_holograms"),
      icon: "textures/ui/jm_at_hologram_tool",
      fn: () => showHologramRestore(player),
    });
  }

  if (panels.length === 0) {
    tell(player, t("jm_at.adm.cp_none"));
    return;
  }

  const form = new ActionFormData()
    .title(t("jm_at.adm.idx_control_panel"))
    .body(t("jm_at.adm.cp_body"));
  for (const p of panels) form.button(p.label, p.icon);
  form.button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back");
  form.button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showAdminPanel(player); // X = Back
  if (res.selection === panels.length) return showAdminPanel(player); // Back
  if (res.selection === panels.length + 1) return; // Close
  if (res.selection >= 0 && res.selection < panels.length)
    return panels[res.selection].fn();
}

async function showStorageHealth(player) {
  try {
    requireAdmin(player, "存储状况");
  } catch {
    return;
  }
  const health = getStorageHealth();
  if (!health) {
    tell(player, t("jm_at.adm.sh_read_failed"));
    return showAdminLogHub(player);
  }

  const row = (info) => {
    const color =
      info.pct >= 90 ? "\u00a7c" : info.pct >= 70 ? "\u00a76" : "\u00a72";
    return t("jm_at.adm.sh_row", color, info.used, info.max);
  };

  // Whole-store total reads bytes (not a used/max count), so it formats in KB
  // against the advisory soft cap rather than going through row().
  const totalRow = (info) => {
    const color =
      info.pct >= 90 ? "\u00a7c" : info.pct >= 70 ? "\u00a76" : "\u00a72";
    const kb = Math.round(info.bytes / 1024);
    const maxMb = Math.round(info.max / 1_000_000);
    return t(
      "jm_at.adm.sh_total_row",
      color,
      kb.toLocaleString(),
      maxMb,
      `${info.pct}%`,
    );
  };

  const parts = [
    t("jm_at.adm.sh_header"),
    t("jm_at.adm.sh_tickets", row(health.tickets)),
    t("jm_at.adm.sh_claims", row(health.claims)),
    t("jm_at.adm.sh_log_pages", row(health.logPages)),
    t("jm_at.adm.sh_registry", row(health.registry)),
    health.total ? t("jm_at.adm.sh_total", totalRow(health.total)) : "",
    "",
    t("jm_at.adm.sh_footer"),
  ];
  const body = raw(...parts.flatMap((p, i) => (i ? ["\n", p] : [p])));

  const form = new MessageFormData()
    .title(t("jm_at.adm.idx_storage_health"))
    .body(body)
    .button1(t("jm_at.common.btn_back"))
    .button2(t("jm_at.adm.btn_ok_plain"));
  await form.show(player);
  return showAdminLogHub(player);
}

async function showServerControls(player) {
  try {
    requireAdminOrModCan(player, "serverControls", "服务器控制");
  } catch {
    return;
  }
  const cfg = getCfg();

  const form = new ActionFormData()
    .title(t("jm_at.adm.idx_server_controls"))
    .body(
      t(
        "jm_at.adm.sc_body",
        t(
          cfg.serverLocked ? "jm_at.adm.cp_state_on" : "jm_at.adm.cp_state_off",
        ),
        t(
          cfg.whitelistMode
            ? "jm_at.adm.cp_state_on"
            : "jm_at.adm.cp_state_off",
        ),
        (cfg.whitelistedXuids ?? []).length,
      ),
    )
    .button(
      t(cfg.serverLocked ? "jm_at.adm.sc_btn_unlock" : "jm_at.adm.sc_btn_lock"),
      cfg.serverLocked
        ? "textures/ui/jm_at_unlock_server"
        : "textures/ui/jm_at_lock_server",
    )
    .button(
      t(
        cfg.whitelistMode
          ? "jm_at.adm.sc_btn_wl_disable"
          : "jm_at.adm.sc_btn_wl_enable",
      ),
      cfg.whitelistMode
        ? "textures/ui/jm_at_disable_whitelist"
        : "textures/ui/jm_at_enable_whitelist",
    )
    .button(
      t("jm_at.adm.sc_btn_manage_wl"),
      "textures/ui/jm_at_manage_whitelist",
    )
    .button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back")
    .button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showControlPanel(player); // X = Back
  if (res.selection === 3) return showControlPanel(player); // Back
  if (res.selection === 4) return; // Close

  try {
    if (res.selection === 0) {
      system.run(() => {
        mutateCfg((c) => {
          c.serverLocked = !c.serverLocked;
        });
        const locked = getCfg().serverLocked;
        logAdmin(player, "SERVER_LOCK", locked ? "Locked" : "Unlocked");
        broadcastAdmins(
          t(
            locked ? "jm_at.adm.sc_locked_bc" : "jm_at.adm.sc_unlocked_bc",
            player.name,
          ),
        );
        showServerControls(player);
      });
      return;
    } else if (res.selection === 1) {
      system.run(() => {
        mutateCfg((c) => {
          c.whitelistMode = !c.whitelistMode;
        });
        const on = getCfg().whitelistMode;
        logAdmin(player, "WHITELIST_MODE", on ? "开启" : "关闭");
        broadcastAdmins(
          t(
            on ? "jm_at.adm.sc_wl_on_bc" : "jm_at.adm.sc_wl_off_bc",
            player.name,
          ),
        );
        showServerControls(player);
      });
      return;
    } else if (res.selection === 2) {
      return showManageWhitelist(player);
    }
  } catch (e) {
    return warnForm(
      player,
      t("jm_at.common.error_generic", e?.message ?? t("jm_at.adm.err_unknown")),
      () => showServerControls(player),
    );
  }

  return showServerControls(player);
}

async function showManageWhitelist(player) {
  try {
    requireAdminOrModCan(player, "serverControls", "管理白名单");
  } catch {
    return;
  }
  const cfg = getCfg();
  const list = cfg.whitelistedXuids ?? [];
  const reg = getPlayerRegistry();
  const listedEntries = list.map((xuid) => {
    const e = reg[xuid];
    const known = e?.name;
    return {
      xuid,
      name: known ?? `未知（${xuid.slice(0, 8)}…）`, // plain string for logs/data
      displayName: known
        ? { text: known }
        : raw(t("jm_at.common.unknown"), ` (${xuid.slice(0, 8)}…）`), // translated
    };
  });

  const form = new ActionFormData()
    .title(t("jm_at.adm.wl_title", list.length))
    .body(t("jm_at.adm.wl_body"))
    .button(t("jm_at.adm.wl_btn_add_online"))
    .button(t("jm_at.adm.wl_btn_add_offline"))
    .button(t("jm_at.adm.wl_btn_remove"))
    .button(t("jm_at.common.btn_back_bold"))
    .button(CLOSE_BTN_LABEL);

  const res = await form.show(player);
  if (res.canceled) return showServerControls(player); // X = Back
  if (res.selection === 0) return showAddOnlineWhitelist(player);
  if (res.selection === 1) return showAddOfflineWhitelist(player);
  if (res.selection === 2) {
    if (listedEntries.length === 0) {
      tell(player, t("jm_at.adm.wl_empty"));
      return showManageWhitelist(player);
    }
    const pick = new ActionFormData()
      .title(t("jm_at.adm.wl_remove_title"))
      .body(t("jm_at.adm.wl_remove_body"));
    for (const e of listedEntries) pick.button(raw("§l", e.displayName));
    pick.button(t("jm_at.common.btn_back_bold"));
    pick.button(CLOSE_BTN_LABEL);
    const pr = await pick.show(player);
    if (pr.selection === listedEntries.length + 1) return; // Close
    if (!pr.canceled && pr.selection < listedEntries.length) {
      const target = listedEntries[pr.selection];
      mutateCfg((c) => {
        c.whitelistedXuids = (c.whitelistedXuids ?? []).filter(
          (x) => x !== target.xuid,
        );
      });
      logAdmin(player, "WHITELIST_REMOVE", target.name);
      tell(player, t("jm_at.adm.wl_removed", target.displayName));
    }
    return showManageWhitelist(player);
  }
  if (res.selection === 3) return showServerControls(player); // Back
  return; // Close
}

/** DDUI: add an online (not-yet-whitelisted) player to the whitelist. */
async function showAddOnlineWhitelist(player) {
  const notListed = [...world.getPlayers()]
    .filter(
      (p) => !(getCfg().whitelistedXuids ?? []).includes(getPlayerXuid(p)),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  if (notListed.length === 0) {
    tell(player, t("jm_at.adm.wl_all_online_listed"));
    return showManageWhitelist(player);
  }
  const items = notListed.map((p, i) => ({ label: p.name, value: i }));
  const typedObs = new ObservableString("", { clientWritable: true });
  const pickObs = new ObservableNumber(0, { clientWritable: true });
  const status = new ObservableString("");
  const statusShown = new ObservableBoolean(false);
  let pendingNav = null;
  const back = () => showManageWhitelist(player);
  const fail = (m) => {
    status.setData(m);
    statusShown.setData(true);
  };

  const form = new CustomForm(player, t("jm_at.adm.wl_add_online_title"));
  form.textField(t("jm_at.adm.field_type_or_pick"), typedObs);
  form.dropdown(t("jm_at.adm.field_online_players"), pickObs, items);
  form.spacer();
  form.label(status, { visible: statusShown });
  form.spacer({ visible: statusShown });
  const submit = (close) => {
    const typed = clampText(typedObs.getData().trim(), 50);
    const pick = typed
      ? (notListed.find((p) => p.name.toLowerCase() === typed.toLowerCase()) ??
        notListed.find((p) =>
          p.name.toLowerCase().startsWith(typed.toLowerCase()),
        ))
      : notListed[pickObs.getData()];
    if (!pick) {
      fail(`§c找不到与“${typed}”匹配的在线玩家。`);
      return;
    }
    const xuid = getPlayerXuid(pick);
    const cur = getCfg().whitelistedXuids ?? [];
    if (cur.includes(xuid)) {
      fail(`§e${pick.name} 已在白名单中。`);
      return;
    }
    if (cur.length >= LIMITS.WHITELIST_MAX) {
      fail(`§c白名单已满，最多可保存 ${LIMITS.WHITELIST_MAX} 名玩家。`);
      return;
    }
    mutateCfg((c) => {
      c.whitelistedXuids = [...(c.whitelistedXuids ?? []), xuid];
    });
    logAdmin(player, "WHITELIST_ADD", pick.name);
    tell(player, t("jm_at.adm.wl_added", pick.name));
    pendingNav = close ? () => {} : back;
    try {
      form.close();
    } catch {}
  };
  form.button(t("jm_at.adm.btn_add"), () => submit(false));
  form.button(t("jm_at.adm.btn_add_close"), () => submit(true));
  form.button(t("jm_at.common.btn_back"), () => {
    pendingNav = back;
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(() => showAddOnlineWhitelist(player));
  }
  if (pendingNav) return system.run(pendingNav);
  return; // ✕ / engine close / escape → exit to game
}

/** DDUI: add a known (registry) player to the whitelist by name. */
async function showAddOfflineWhitelist(player) {
  const list = getCfg().whitelistedXuids ?? [];
  const reg = getPlayerRegistry();
  const offlineEntries = Object.entries(reg)
    .map(([xuid, e]) => ({ xuid, name: e.name }))
    .filter((e) => !list.includes(e.xuid))
    .sort((a, b) => a.name.localeCompare(b.name));
  const items =
    offlineEntries.length > 0
      ? offlineEntries.map((e, i) => ({ label: e.name, value: i }))
      : [{ label: t("jm_at.adm.dropdown_none"), value: 0 }];
  const typedObs = new ObservableString("", { clientWritable: true });
  const pickObs = new ObservableNumber(0, { clientWritable: true });
  const status = new ObservableString("");
  const statusShown = new ObservableBoolean(false);
  let pendingNav = null;
  const back = () => showManageWhitelist(player);
  const fail = (m) => {
    status.setData(m);
    statusShown.setData(true);
  };

  const form = new CustomForm(player, t("jm_at.adm.wl_add_offline_title"));
  form.textField(t("jm_at.adm.field_type_or_pick"), typedObs);
  form.dropdown(t("jm_at.adm.field_known_players"), pickObs, items);
  form.spacer();
  form.label(status, { visible: statusShown });
  form.spacer({ visible: statusShown });
  const submit = (close) => {
    const typed = clampText(typedObs.getData().trim(), 50);
    const entry = typed
      ? getRegistryEntryByName(typed)
      : offlineEntries.length > 0
        ? offlineEntries[pickObs.getData()]
        : null;
    if (!entry) {
      fail(`§c找不到“${typed}”的记录，对方必须至少加入过此世界一次。`);
      return;
    }
    const cur = getCfg().whitelistedXuids ?? [];
    if (cur.includes(entry.xuid)) {
      fail(`§e${entry.name} 已在白名单中。`);
      return;
    }
    if (cur.length >= LIMITS.WHITELIST_MAX) {
      fail(`§c白名单已满，最多可保存 ${LIMITS.WHITELIST_MAX} 名玩家。`);
      return;
    }
    mutateCfg((c) => {
      c.whitelistedXuids = [...(c.whitelistedXuids ?? []), entry.xuid];
    });
    logAdmin(player, "WHITELIST_ADD", entry.name);
    tell(player, t("jm_at.adm.wl_added", entry.name));
    pendingNav = close ? () => {} : back;
    try {
      form.close();
    } catch {}
  };
  form.button(t("jm_at.adm.btn_add"), () => submit(false));
  form.button(t("jm_at.adm.btn_add_close"), () => submit(true));
  form.button(t("jm_at.common.btn_back"), () => {
    pendingNav = back;
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(() => showAddOfflineWhitelist(player));
  }
  if (pendingNav) return system.run(pendingNav);
  return; // ✕ / engine close / escape → exit to game
}

/**
 * DDUI (CustomForm) ticket settings — the old hub + sub-modals on one reactive
 * screen. Cooldown/auto-delete are validated text fields; limit is a slider;
 * open/visible are toggles saved together. Manage Categories (a list CRUD) and
 * Delete Closed Tickets (destructive) stay as buttons that persist the settings
 * first, then navigate, so nothing's lost. mutateCfg stays the authority.
 */
async function showTicketSettings(player, override = null) {
  try {
    requireAdminOrModCan(player, "ticketSettings", "工单设置");
  } catch {
    return;
  }
  const cfg = getCfg();
  const cats = cfg.categories ?? [];
  const meta = getTicketMeta();
  const closedCount = (meta.closed ?? []).length;
  const wasOpen = !!cfg.ticketingOpen;
  const wasVisible = cfg.ticketsVisible !== false;

  const cooldownObs = new ObservableString(
    override ? override.cooldown : String(cfg.submitCooldownSec ?? 120),
    { clientWritable: true },
  );
  const limitObs = new ObservableNumber(
    override ? override.limit : (cfg.ticketLimit ?? 5),
    { clientWritable: true },
  );
  const autoDelObs = new ObservableString(
    override ? override.autoDel : String(cfg.autoDeleteClosedDays ?? 30),
    { clientWritable: true },
  );
  const openObs = new ObservableBoolean(override ? override.open : wasOpen, {
    clientWritable: true,
  });
  const visibleObs = new ObservableBoolean(
    override ? override.visible : wasVisible,
    { clientWritable: true },
  );
  const status = new ObservableString("");
  const statusShown = new ObservableBoolean(false);

  let pendingNav = null;
  let intent = null;
  const back = () => showControlPanel(player);
  // Carry `override` so a UserBusy bounce on a preserved-edit reopen keeps the
  // edits (on UserBusy no interaction happened, so override still holds them).
  const reopen = () => showTicketSettings(player, override);
  const snapshot = () =>
    JSON.stringify([
      cooldownObs.getData(),
      limitObs.getData(),
      autoDelObs.getData(),
      openObs.getData(),
      visibleObs.getData(),
    ]);
  // Baseline = SAVED settings (not the seeded form state) so a preserved edit
  // still reads as dirty and re-warns on the next close.
  const initial = JSON.stringify([
    String(cfg.submitCooldownSec ?? 120),
    cfg.ticketLimit ?? 5,
    String(cfg.autoDeleteClosedDays ?? 30),
    wasOpen,
    wasVisible,
  ]);
  const fail = (m) => {
    status.setData(m);
    statusShown.setData(true);
  };

  // Validates + writes the settings. Returns false (with an inline error) on
  // bad input so action buttons don't navigate away with unsaved changes.
  const persist = () => {
    const cd = parseInt(cooldownObs.getData().trim(), 10);
    if (isNaN(cd)) {
      fail("§c冷却时间必须为整数秒。");
      return false;
    }
    const ad = parseInt(autoDelObs.getData().trim(), 10);
    if (isNaN(ad)) {
      fail("§c自动删除天数必须为整数。");
      return false;
    }
    const cooldown = Math.max(0, Math.min(3600, cd));
    const autoDel = Math.max(0, Math.min(365, ad));
    const limit = Math.max(1, Math.min(20, Math.round(limitObs.getData())));
    const newOpen = openObs.getData();
    const newVisible = visibleObs.getData();
    mutateCfg((c) =>
      Object.assign(c, {
        submitCooldownSec: cooldown,
        ticketLimit: limit,
        autoDeleteClosedDays: autoDel,
        ticketingOpen: newOpen,
        ticketsVisible: newVisible,
      }),
    );
    logAdmin(
      player,
      "TICKET_SETTINGS",
      `冷却=${cooldown}秒 上限=${limit} 自动删除=${autoDel}天 接收工单=${newOpen} 显示=${newVisible}`,
    );
    if (newOpen !== wasOpen) {
      broadcastAdmins(
        t(
          newOpen ? "jm_at.adm.ts_opened_bc" : "jm_at.adm.ts_closed_bc",
          player.name,
        ),
      );
    }
    if (newVisible !== wasVisible) {
      tell(
        player,
        t(newVisible ? "jm_at.adm.ts_vis_shown" : "jm_at.adm.ts_vis_hidden"),
      );
    }
    return true;
  };

  const deleteClosedFlow = async () => {
    if (closedCount === 0) {
      tell(player, t("jm_at.adm.ts_no_closed"));
      return showTicketSettings(player);
    }
    const conf = await new MessageFormData()
      .title(t("jm_at.adm.ts_delete_all_title"))
      .body(t("jm_at.adm.ts_delete_all_body", closedCount))
      .button1(t("jm_at.common.btn_cancel"))
      .button2(t("jm_at.adm.btn_delete_all"))
      .show(player);
    if (!conf.canceled && conf.selection === 1) {
      const purged = purgeClosedTickets();
      logAdmin(player, "TICKETS_PURGE", `已清理 ${purged} 个已关闭工单`);
      tell(player, t("jm_at.adm.tickets_purged_all", purged));
    }
    return showTicketSettings(player);
  };

  const form = new CustomForm(player, t("jm_at.adm.idx_ticket_settings"));
  form.toggle(t("jm_at.adm.ts_toggle_open"), openObs);
  form.toggle(t("jm_at.adm.ts_toggle_visible"), visibleObs);
  form.textField(t("jm_at.adm.ts_field_cooldown"), cooldownObs, {
    description: t("jm_at.adm.ts_field_cooldown_desc"),
  });
  form.slider(t("jm_at.adm.ts_slider_limit"), limitObs, 1, 20, { step: 1 });
  form.textField(t("jm_at.adm.ts_field_autodel"), autoDelObs, {
    description: t("jm_at.adm.ts_field_autodel_desc"),
  });
  form.spacer();
  form.label(
    t(
      "jm_at.adm.ts_categories_label",
      cats.length ? cats.join(", ") : t("jm_at.adm.ts_categories_none"),
    ),
  );
  form.spacer();
  form.label(status, { visible: statusShown });
  form.spacer({ visible: statusShown });

  const save = (close) => {
    if (persist()) {
      pendingNav = close ? () => {} : back;
      try {
        form.close();
      } catch {}
    }
  };
  form.button(t("jm_at.common.btn_save"), () => save(false));
  form.button(t("jm_at.cl.btn_save_close"), () => save(true));
  form.button(t("jm_at.adm.idx_categories"), () => {
    if (persist()) {
      pendingNav = () => showManageCategories(player);
      try {
        form.close();
      } catch {}
    }
  });
  form.button(t("jm_at.adm.ts_btn_delete_closed", closedCount), () => {
    if (persist()) {
      pendingNav = deleteClosedFlow;
      try {
        form.close();
      } catch {}
    }
  });
  form.button(t("jm_at.common.btn_back"), () => {
    intent = "back";
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(reopen);
  }
  if (pendingNav) return system.run(pendingNav);
  // Back → Control Panel; ✕ / engine close / escape → exit to game. If a setting
  // changed, confirm first — Keep editing reopens with the fields preserved.
  if (snapshot() !== initial) {
    const keep = {
      cooldown: cooldownObs.getData(),
      limit: limitObs.getData(),
      autoDel: autoDelObs.getData(),
      open: openObs.getData(),
      visible: visibleObs.getData(),
    };
    return system.run(async () => {
      if (await confirmDiscardChanges(player))
        return showTicketSettings(player, keep);
      if (intent === "back") return back();
    });
  }
  if (intent === "back") return system.run(back);
}

async function showManageCategories(player) {
  try {
    requireAdminOrModCan(player, "ticketSettings", "管理工单分类");
  } catch {
    return;
  }
  const cfg = getCfg();
  const cats = cfg.categories ?? [];

  const form = new ActionFormData()
    .title(t("jm_at.adm.cat_title", cats.length))
    .body(cats.length ? cats.join(", ") : t("jm_at.adm.cat_none"))
    .button(t("jm_at.adm.cat_btn_add"))
    .button(t("jm_at.adm.cat_btn_remove"))
    .button(t("jm_at.common.btn_back_bold"))
    .button(CLOSE_BTN_LABEL);

  const res = await form.show(player);
  if (res.canceled) return showTicketSettings(player); // X = Back
  if (res.selection === 2) return showTicketSettings(player); // Back
  if (res.selection === 3) return; // Close

  if (res.selection === 0) return showAddCategoryForm(player);

  if (res.selection === 1) {
    if (cats.length === 0) {
      tell(player, t("jm_at.adm.cat_none_to_remove"));
      return showManageCategories(player);
    }
    const pick = new ActionFormData()
      .title(t("jm_at.adm.cat_remove_title"))
      .body(t("jm_at.adm.cat_remove_body"));
    for (const c of cats) pick.button(raw("§l", c));
    pick.button(t("jm_at.common.btn_back_bold"));
    pick.button(CLOSE_BTN_LABEL);
    const pr = await pick.show(player);
    if (pr.selection === cats.length + 1) return; // Close
    if (!pr.canceled && pr.selection < cats.length) {
      const removed = cats[pr.selection];
      mutateCfg((c) => {
        c.categories = (c.categories ?? []).filter((x) => x !== removed);
        if (c.categories.length === 0) c.categories = ["Other"];
      });
      logAdmin(player, "CATEGORY_REMOVE", removed);
      tell(player, t("jm_at.adm.cat_removed", removed));
    }
  }

  return showManageCategories(player);
}

async function showAddCategoryForm(player) {
  const nameObs = new ObservableString("", { clientWritable: true });
  const status = new ObservableString("");
  const statusShown = new ObservableBoolean(false);
  let pendingNav = null;
  const fail = (m) => {
    status.setData(m);
    statusShown.setData(true);
  };

  const form = new CustomForm(player, t("jm_at.adm.cat_add_title"));
  form.textField(t("jm_at.adm.cat_field_name"), nameObs, {
    description: t("jm_at.adm.cat_field_name_desc"),
  });
  form.spacer();
  form.label(status, { visible: statusShown });
  form.spacer({ visible: statusShown });
  const submit = (close) => {
    const name = clampText(nameObs.getData().trim(), 30);
    if (name.length <= 1) {
      fail("§c名称过短。");
      return;
    }
    if ((getCfg().categories ?? []).includes(name)) {
      fail("§c该类别已存在。");
      return;
    }
    pendingNav = () => {
      mutateCfg((c) => {
        c.categories = [...(c.categories ?? []), name];
      });
      logAdmin(player, "CATEGORY_ADD", name);
      tell(player, t("jm_at.adm.cat_added", name));
      return close ? undefined : showManageCategories(player);
    };
    try {
      form.close();
    } catch {}
  };
  form.button(t("jm_at.adm.btn_add"), () => submit(false));
  form.button(t("jm_at.adm.btn_add_close"), () => submit(true));
  form.button(t("jm_at.common.btn_back"), () => {
    pendingNav = () => showManageCategories(player);
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(() => showAddCategoryForm(player));
  }
  if (pendingNav) return system.run(pendingNav);
  return; // ✕ / engine close / escape → exit to game
}

// =========================================================
// Broadcasts
// =========================================================

// broadcastTick is incremented by main.js tickBroadcasts and used here for scheduling
export const _broadcastTickRef = { value: 0 };

// Broadcast prefixes as actually sent. Immediate and scheduled differ
// historically; preview each with its real prefix so what you see matches.
const BROADCAST_PREFIX = {
  // A DDUI label trims a regular space at a colour-segment boundary (right
  // before/after a § or §r code), so the gap between the tag and the message
  // vanished in the live preview while chat still showed it. A non-breaking
  // space ( ) isn't treated as trimmable whitespace — it renders in both
  // the DDUI preview and chat, and looks identical to a normal space.
  immediate: "§6[公告]§r ",
  scheduled: "§s[公告]§r ",
};

/** Join non-empty lines and convert & color codes to §. */
function broadcastBody(lines) {
  return applyColorCodes(
    lines
      .map((l) => String(l ?? "").trim())
      .filter((l) => l.length > 0)
      .join("\n"),
  );
}

function broadcastComposerBack(player, ctx) {
  return ctx.editId
    ? showManageScheduledBroadcasts(player)
    : showBroadcasts(player);
}

function reopenBroadcastComposer(player, ctx) {
  return system.run(() => showBroadcastComposer(player, ctx));
}

/**
 * DDUI (CustomForm) composer for broadcasts, shared by immediate sends and
 * new/edit scheduled broadcasts. ctx = { mode: "immediate"|"scheduled", editId?,
 * lines[5], intervalStr?, label? }. The message/interval/label fields write to
 * Observables and the preview label re-renders live (with & codes applied) as
 * you type. commitBroadcast stays the persistence authority.
 */
async function showBroadcastComposer(player, ctx, draft = null) {
  const title = t(
    ctx.mode === "immediate"
      ? "jm_at.adm.bc_title_immediate"
      : ctx.editId
        ? "jm_at.adm.bc_title_edit"
        : "jm_at.adm.bc_title_new",
  );
  const scheduled = ctx.mode !== "immediate";
  const prefix = scheduled
    ? BROADCAST_PREFIX.scheduled
    : BROADCAST_PREFIX.immediate;

  // Seed from `draft` (in-progress edits preserved across a Keep-editing reopen)
  // when present, else from ctx (the original loaded values). The dirty baseline
  // below stays pinned to the original ctx so a preserved edit still re-warns.
  const src = draft ?? ctx;
  const lineObs = [];
  for (let i = 0; i < 5; i++) {
    lineObs.push(
      new ObservableString(src.lines?.[i] ?? "", { clientWritable: true }),
    );
  }
  // Reveal one line at a time. DDUI can't add controls to a live form, but it
  // can show hidden ones — so all 5 exist and we flip their `visible` flags.
  // Start with the already-filled lines (min 1); "Add line" reveals the rest.
  let shownCount = Math.max(
    1,
    (src.lines ?? []).filter((l) => String(l ?? "").trim().length > 0).length,
  );
  const lineVisible = [];
  for (let i = 0; i < 5; i++) {
    lineVisible.push(new ObservableBoolean(i < shownCount));
  }
  const canAddLine = new ObservableBoolean(shownCount < 5);
  const intervalObs = new ObservableString(src.intervalStr || "1h", {
    clientWritable: true,
  });
  const labelObs = new ObservableString(src.label || "", {
    clientWritable: true,
  });
  const preview = new ObservableString("");
  const status = new ObservableString("");
  const statusShown = new ObservableBoolean(false);

  const currentLines = () => lineObs.map((o) => o.getData());
  const refresh = () => {
    const body = broadcastBody(currentLines());
    preview.setData(body ? prefix + body : "§7（尚未输入消息）");
    status.setData("");
    statusShown.setData(false);
  };
  refresh();
  for (const o of lineObs) o.subscribe(refresh);

  // Dirty baseline = the ORIGINAL ctx values (not the draft-seeded state) so a
  // preserved-then-reopened edit still reads as dirty and re-warns.
  const origLines = Array.from({ length: 5 }, (_, i) => ctx.lines?.[i] ?? "");
  const baseline = JSON.stringify([
    origLines,
    ctx.intervalStr || "1h",
    ctx.label || "",
  ]);
  const snapshot = () =>
    JSON.stringify([currentLines(), intervalObs.getData(), labelObs.getData()]);
  let pendingNav = null; // runs after the form closes (Save / Save & Close)
  let intent = null; // "back" set by Back; null = ✕/engine close/escape → exit

  const form = new CustomForm(player, title);
  form.header(t("jm_at.adm.bc_header_preview"));
  form.spacer();
  form.label(preview); // live render of how the broadcast will look
  form.spacer();
  form.divider();
  form.label(t("jm_at.adm.bc_tip"));
  form.spacer();
  for (let i = 0; i < 5; i++) {
    form.textField(
      i === 0
        ? t("jm_at.adm.bc_line1")
        : t("jm_at.adm.bc_line_optional", i + 1),
      lineObs[i],
      { visible: lineVisible[i] },
    );
  }
  form.spacer({ visible: canAddLine });
  form.button(
    t("jm_at.adm.bc_btn_add_line"),
    () => {
      if (shownCount >= 5) return;
      lineVisible[shownCount].setData(true); // reveal the next hidden line
      shownCount++;
      canAddLine.setData(shownCount < 5); // hide the button once all 5 show
    },
    { visible: canAddLine },
  );
  form.spacer({ visible: canAddLine });
  if (scheduled) {
    form.textField(t("jm_at.adm.bc_field_interval"), intervalObs, {
      description: t("jm_at.adm.bc_field_interval_desc"),
    });
    form.textField(t("jm_at.adm.bc_field_label"), labelObs, {
      description: t("jm_at.adm.bc_field_label_desc"),
    });
  }
  form.spacer();
  form.label(status, { visible: statusShown });
  form.spacer({ visible: statusShown });

  const saveLabel = t(
    ctx.mode === "immediate"
      ? "jm_at.adm.bc_btn_send"
      : ctx.editId
        ? "jm_at.holo.btn_save_changes"
        : "jm_at.adm.bc_btn_create",
  );

  form.button(saveLabel, () => {
    ctx.lines = currentLines().map((v) => String(v ?? ""));
    const rawMsg = ctx.lines
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .join("\n");
    if (!rawMsg) {
      status.setData("§c请先输入至少一行消息。");
      statusShown.setData(true);
      return;
    }
    if (scheduled) {
      ctx.intervalStr = intervalObs.getData().trim();
      ctx.label = clampText(labelObs.getData().trim(), 40);
      if (parseDuration(ctx.intervalStr) <= 0) {
        status.setData(
          "§c间隔无效，请使用数字加单位的格式，例如 30s、10m、6h。",
        );
        statusShown.setData(true);
        return;
      }
    }
    // commitBroadcast re-validates and handles the scheduled-limit case.
    pendingNav = () => commitBroadcast(player, ctx);
    try {
      form.close();
    } catch {}
  });
  form.button(t("jm_at.common.btn_back"), () => {
    intent = "back";
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  // Current field state (edits, or the seeded draft if the show bounced). Built
  // before the UserBusy check so a bounce on a preserved-edit reopen keeps them.
  const keep = {
    lines: currentLines(),
    intervalStr: intervalObs.getData(),
    label: labelObs.getData(),
  };
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(() => showBroadcastComposer(player, ctx, keep)); // retry
  }
  if (pendingNav) return system.run(pendingNav);
  // Back → previous menu; ✕ / engine close / escape → exit to game. If the
  // message was edited, confirm first — Keep editing reopens with the lines +
  // interval + label preserved (baseline stays the original so it re-warns).
  const goBack = intent === "back";
  if (snapshot() !== baseline) {
    return system.run(async () => {
      if (await confirmDiscardChanges(player))
        return showBroadcastComposer(player, ctx, keep);
      if (goBack) return broadcastComposerBack(player, ctx);
    });
  }
  if (goBack) return system.run(() => broadcastComposerBack(player, ctx));
}

async function commitBroadcast(player, ctx) {
  const rawMsg = ctx.lines
    .map((l) => String(l ?? "").trim())
    .filter((l) => l.length > 0)
    .join("\n");
  if (rawMsg.length === 0) {
    return warnForm(player, t("jm_at.adm.bc_need_line"), () =>
      reopenBroadcastComposer(player, ctx),
    );
  }
  const message = clampText(rawMsg, 200); // stored/sent raw; & converted on render

  if (ctx.mode === "immediate") {
    broadcastAll(BROADCAST_PREFIX.immediate + applyColorCodes(message));
    logAdmin(player, "BROADCAST", message.slice(0, 80));
    tell(player, t("jm_at.adm.bc_sent"));
    return showBroadcasts(player);
  }

  const intervalMs = parseDuration(String(ctx.intervalStr ?? "").trim());
  if (intervalMs <= 0) {
    return warnForm(player, t("jm_at.adm.bc_bad_interval"), () =>
      reopenBroadcastComposer(player, ctx),
    );
  }
  const cfg = getCfg();
  const sched = cfg.scheduledBroadcasts ?? [];
  const label = clampText(ctx.label || message.slice(0, 20), 40);

  if (ctx.editId) {
    const bc = sched.find((b) => b.id === ctx.editId);
    if (!bc) return showManageScheduledBroadcasts(player);
    bc.label = label;
    bc.message = message;
    bc.intervalMs = intervalMs;
    bc.nextFireMs = Date.now() + intervalMs;
    setCfg(cfg);
    logAdmin(
      player,
      "SCHED_BC_EDIT",
      `${label}，间隔 ${fmtDurationExact(intervalMs)}`,
    );
    tell(player, t("jm_at.adm.bc_updated"));
    return showManageScheduledBroadcasts(player);
  }

  if (sched.length >= LIMITS.SCHEDULED_BROADCASTS_MAX) {
    return warnForm(
      player,
      t("jm_at.adm.bc_max", LIMITS.SCHEDULED_BROADCASTS_MAX),
      () => showBroadcasts(player),
    );
  }
  cfg.scheduledBroadcasts = [
    ...sched,
    {
      id: genId("BC"),
      label,
      message,
      intervalMs,
      nextFireMs: Date.now() + intervalMs,
      active: true,
    },
  ];
  setCfg(cfg);
  logAdmin(
    player,
    "SCHED_BC_ADD",
    `${label}，间隔 ${fmtDurationExact(intervalMs)}`,
  );
  tell(player, t("jm_at.adm.bc_added"));
  return showBroadcasts(player);
}

function _doSendImmediateBroadcastFlow(player) {
  return showBroadcastComposer(player, {
    mode: "immediate",
    lines: ["", "", "", "", ""],
  });
}

function _doAddScheduledBroadcastFlow(player) {
  const sched = getCfg().scheduledBroadcasts ?? [];
  if (sched.length >= LIMITS.SCHEDULED_BROADCASTS_MAX) {
    return warnForm(
      player,
      t("jm_at.adm.bc_max", LIMITS.SCHEDULED_BROADCASTS_MAX),
      () => showBroadcasts(player),
    );
  }
  return showBroadcastComposer(player, {
    mode: "scheduled",
    lines: ["", "", "", "", ""],
    intervalStr: "1h",
    label: "",
  });
}

export async function showBroadcasts(player) {
  try {
    requireAdminOrModCan(player, "broadcasts", "发送公告");
  } catch {
    return;
  }
  const cfg = getCfg();
  const sched = cfg.scheduledBroadcasts ?? [];
  const activeCount = sched.filter((b) => b.active).length;

  const actions = [
    {
      label: t("jm_at.adm.bc_btn_immediate"),
      icon: "textures/ui/jm_at_broadcast",
      fn: () => _doSendImmediateBroadcastFlow(player),
    },
    {
      label: t("jm_at.adm.bc_btn_add_sched"),
      icon: "textures/ui/jm_at_scheduled_broadcast",
      fn: () => _doAddScheduledBroadcastFlow(player),
    },
    {
      label: t("jm_at.adm.bc_btn_manage_sched"),
      icon: "textures/ui/jm_at_manage_broadcast",
      fn: () => showManageScheduledBroadcasts(player),
    },
  ];

  const form = new ActionFormData()
    .title(t("jm_at.adm.idx_broadcasts"))
    .body(t("jm_at.adm.bc_body", activeCount, sched.length));
  for (const a of actions) form.button(a.label, a.icon);
  form.button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back");
  form.button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showAdminPanel(player); // X = Back
  if (res.selection === actions.length) return showAdminPanel(player); // Back
  if (res.selection === actions.length + 1) return; // Close
  if (res.selection >= 0 && res.selection < actions.length)
    return actions[res.selection].fn();
}

async function showManageScheduledBroadcasts(player) {
  try {
    requireAdminOrModCan(player, "broadcasts", "定时公告");
  } catch {
    return;
  }
  const cfg = getCfg();
  const sched = cfg.scheduledBroadcasts ?? [];

  if (sched.length === 0) {
    tell(player, t("jm_at.adm.bc_none_sched"));
    return showBroadcasts(player);
  }

  const form = new ActionFormData()
    .title(t("jm_at.adm.bc_sched_title"))
    .body(t("jm_at.adm.bc_sched_body"));

  for (const b of sched) {
    form.button(
      t(
        "jm_at.adm.bc_sched_row",
        b.label,
        t(b.active ? "jm_at.adm.bc_tag_running" : "jm_at.adm.bc_tag_paused"),
        fmtDurationExact(b.intervalMs),
      ),
    );
  }
  form.button(t("jm_at.common.btn_back_bold"));
  form.button(CLOSE_BTN_LABEL);

  const res = await form.show(player);
  if (res.canceled) return showBroadcasts(player); // X = Back
  if (res.selection === sched.length) return showBroadcasts(player); // Back
  if (res.selection === sched.length + 1) return; // Close

  const bc = sched[res.selection];
  const action = await new ActionFormData()
    .title(bc.label)
    .body(
      t(
        "jm_at.adm.bc_detail_body",
        applyColorCodes(bc.message),
        fmtDurationExact(bc.intervalMs),
        t(bc.active ? "jm_at.adm.bc_yes" : "jm_at.adm.bc_no"),
      ),
    )
    .button(
      t(bc.active ? "jm_at.adm.bc_btn_pause" : "jm_at.adm.bc_btn_resume"),
      bc.active ? "textures/ui/jm_at_pause" : "textures/ui/jm_at_resume",
    )
    .button(t("jm_at.adm.bc_btn_edit"), "textures/ui/jm_at_submit_ticket")
    .button(t("jm_at.adm.btn_delete_red"), "textures/ui/jm_at_remove")
    .button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back")
    .button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON)
    .show(player);

  if (action.canceled) return showManageScheduledBroadcasts(player); // X = Back
  if (action.selection === 4) return; // Close
  if (action.selection === 3) return showManageScheduledBroadcasts(player); // Back
  if (!action.canceled) {
    if (action.selection === 0) {
      // Toggle the targeted broadcast on the fresh config so the timer's
      // concurrent nextFireMs updates to other broadcasts aren't reverted.
      let nowActive;
      mutateCfg((c) => {
        const b = (c.scheduledBroadcasts ?? []).find((x) => x.id === bc.id);
        if (b) {
          b.active = !b.active;
          nowActive = b.active;
        }
      });
      logAdmin(
        player,
        "SCHED_BC_TOGGLE",
        `${bc.label}：${nowActive ? "开启" : "关闭"}`,
      );
      tell(
        player,
        t(nowActive ? "jm_at.adm.bc_resumed" : "jm_at.adm.bc_paused"),
      );
    } else if (action.selection === 1) {
      const lines = (bc.message ?? "").split("\n");
      while (lines.length < 5) lines.push("");
      return showBroadcastComposer(player, {
        mode: "scheduled",
        editId: bc.id,
        lines: lines.slice(0, 5),
        intervalStr: fmtDurationExact(bc.intervalMs),
        label: bc.label,
      });
    } else if (action.selection === 2) {
      const conf = await new MessageFormData()
        .title(t("jm_at.adm.bc_delete_title"))
        .body(t("jm_at.adm.bc_delete_body", bc.label))
        .button1(t("jm_at.common.btn_cancel"))
        .button2(t("jm_at.adm.btn_delete_red"))
        .show(player);
      if (!conf.canceled && conf.selection === 1) {
        mutateCfg((c) => {
          c.scheduledBroadcasts = (c.scheduledBroadcasts ?? []).filter(
            (b) => b.id !== bc.id,
          );
        });
        logAdmin(player, "SCHED_BC_REMOVE", bc.label);
        tell(player, t("jm_at.adm.bc_deleted"));
      }
    }
  }
  return showManageScheduledBroadcasts(player);
}

// =========================================================
// Admin Log
// =========================================================

export async function showAdminLogHub(player) {
  try {
    requireAdminOrModCan(player, "adminLog", "管理日志");
  } catch {
    return;
  }

  // Built as a list because one button is conditional: Log Settings is
  // admin-only, while mods with the adminLog privilege still see the hub.
  const buttons = [
    {
      label: t("jm_at.adm.alh_btn_action_log"),
      icon: "textures/ui/jm_at_action_log",
      fn: () => showAdminLog(player),
    },
    {
      label: t("jm_at.adm.alh_btn_rollcall"),
      icon: "textures/ui/jm_at_rollcall",
      fn: () => showRollcall(player),
    },
    {
      label: t("jm_at.adm.alh_btn_staff_activity"),
      icon: "textures/ui/jm_at_staff_activity",
      fn: () => showStaffActivity(player),
    },
  ];
  if (isAdmin(player).ok) {
    // Storage Health and Log Settings are admin-only (requireAdmin inside
    // both) — don't show mods a button that would silently dead-end.
    buttons.push({
      label: t("jm_at.adm.alh_btn_storage"),
      icon: "textures/ui/jm_at_inventory",
      fn: () => showStorageHealth(player),
    });
    buttons.push({
      label: t("jm_at.adm.alh_btn_log_settings"),
      icon: "textures/ui/jm_at_admin_log_settings",
      fn: () => showLogSettings(player),
    });
  }
  buttons.push({
    label: t("jm_at.adm.alh_btn_back_panel"),
    icon: "textures/ui/jm_at_back",
    fn: () => showAdminPanel(player),
  });
  buttons.push({ label: CLOSE_BTN_LABEL, icon: CLOSE_BTN_ICON, fn: null });

  const form = new ActionFormData()
    .title(t("jm_at.adm.alh_title"))
    .body(t("jm_at.adm.alh_body"));
  for (const b of buttons) form.button(b.label, b.icon);

  const res = await form.show(player);
  if (res.canceled) return showAdminPanel(player); // X = Back
  const fn = buttons[res.selection]?.fn;
  if (fn) return fn(); // fn === null → Close
}

// =========================================================
// Log Settings (recording toggles + retention)
// =========================================================

// Retention presets in entries; page-granular (multiples of LOGS_PER_PAGE).
const RETENTION_PRESETS = [200, 400, 600, 800];

async function showLogSettings(player, override = null) {
  try {
    requireAdmin(player, "日志设置");
  } catch {
    return;
  }
  const cfg = getCfg();
  const retIdxFor = (n) => {
    let best = RETENTION_PRESETS.length - 1;
    for (let i = 0; i < RETENTION_PRESETS.length; i++) {
      if (
        Math.abs(RETENTION_PRESETS[i] - n) <
        Math.abs(RETENTION_PRESETS[best] - n)
      )
        best = i;
    }
    return best;
  };
  const saved = {
    activity: cfg.logPlayerActivity !== false,
    pvp: cfg.logPvpKills !== false,
    items: cfg.logItemAlerts !== false,
    tickets: cfg.logTicketWorkflow !== false,
    config: cfg.logConfigChanges !== false,
    retIdx: retIdxFor(cfg.logMaxEntries ?? 800),
  };
  const src = override ?? saved;

  const activityObs = new ObservableBoolean(src.activity, {
    clientWritable: true,
  });
  const pvpObs = new ObservableBoolean(src.pvp, { clientWritable: true });
  const itemsObs = new ObservableBoolean(src.items, { clientWritable: true });
  const ticketsObs = new ObservableBoolean(src.tickets, {
    clientWritable: true,
  });
  const configObs = new ObservableBoolean(src.config, { clientWritable: true });
  const retObs = new ObservableNumber(src.retIdx, { clientWritable: true });

  let pendingNav = null;
  let intent = null;
  const back = () => showAdminLogHub(player);
  // Carry `override` so a UserBusy bounce on a preserved-edit reopen keeps the
  // edits (on UserBusy no interaction happened, so override still holds them).
  const reopen = () => showLogSettings(player, override);
  const snapshot = () =>
    JSON.stringify([
      activityObs.getData(),
      pvpObs.getData(),
      itemsObs.getData(),
      ticketsObs.getData(),
      configObs.getData(),
      retObs.getData(),
    ]);
  // Baseline = SAVED settings (not the seeded form state) so a preserved edit
  // still reads as dirty and re-warns on the next close.
  const initial = JSON.stringify([
    saved.activity,
    saved.pvp,
    saved.items,
    saved.tickets,
    saved.config,
    saved.retIdx,
  ]);

  const persist = () => {
    const retIdx = Math.max(
      0,
      Math.min(RETENTION_PRESETS.length - 1, Math.round(retObs.getData())),
    );
    const v = {
      logPlayerActivity: activityObs.getData(),
      logPvpKills: pvpObs.getData(),
      logItemAlerts: itemsObs.getData(),
      logTicketWorkflow: ticketsObs.getData(),
      logConfigChanges: configObs.getData(),
      logMaxEntries: RETENTION_PRESETS[retIdx],
    };
    mutateCfg((c) => Object.assign(c, v));
    const pruned = pruneLogToLimit();
    // LOG_SETTINGS is deliberately unmapped in log.js → always recorded, so
    // this page can never hide its own use.
    logAdmin(
      player,
      "LOG_SETTINGS",
      `玩家活动=${v.logPlayerActivity} 玩家击杀=${v.logPvpKills} 物品提醒=${v.logItemAlerts} ` +
        `工单流程=${v.logTicketWorkflow} 配置变更=${v.logConfigChanges} 上限=${v.logMaxEntries}` +
        (pruned ? ` 已清理=${pruned}` : ""),
    );
    tell(
      player,
      pruned ? t("jm_at.adm.ls_saved_pruned", pruned) : t("jm_at.adm.ls_saved"),
    );
    return true;
  };

  const form = new CustomForm(player, t("jm_at.adm.ls_title"));
  form.spacer();
  form.label(t("jm_at.adm.ls_intro"));
  form.spacer();
  form.header(t("jm_at.adm.ls_header_categories"));
  form.spacer();
  form.toggle(t("jm_at.adm.ls_toggle_player_activity"), activityObs);
  form.toggle(t("jm_at.adm.ls_toggle_pvp"), pvpObs);
  form.toggle(t("jm_at.adm.ls_toggle_item_alerts"), itemsObs);
  form.toggle(t("jm_at.adm.ls_toggle_tickets"), ticketsObs);
  form.toggle(t("jm_at.adm.ls_toggle_config"), configObs);
  form.spacer();
  form.header(t("jm_at.adm.ls_header_retention"));
  form.spacer();
  form.dropdown(
    t("jm_at.adm.ls_dd_retention"),
    retObs,
    RETENTION_PRESETS.map((n, i) => ({
      label: t("jm_at.adm.ls_opt_entries", n),
      value: i,
    })),
  );
  form.spacer();
  form.label(t("jm_at.adm.ls_dd_retention_desc"));
  form.spacer();

  const save = (close) => {
    if (persist()) {
      pendingNav = close ? () => {} : back;
      try {
        form.close();
      } catch {}
    }
  };
  form.button(t("jm_at.common.btn_save"), () => save(false));
  form.button(t("jm_at.cl.btn_save_close"), () => save(true));
  form.button(t("jm_at.common.btn_back"), () => {
    intent = "back";
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(reopen);
  }
  if (pendingNav) return system.run(pendingNav);
  // Back → Log hub; ✕ / engine close / escape → exit to game. If a setting
  // changed, confirm first — Keep editing reopens with the fields preserved.
  if (snapshot() !== initial) {
    const keep = {
      activity: activityObs.getData(),
      pvp: pvpObs.getData(),
      items: itemsObs.getData(),
      tickets: ticketsObs.getData(),
      config: configObs.getData(),
      retIdx: retObs.getData(),
    };
    return system.run(async () => {
      if (await confirmDiscardChanges(player))
        return showLogSettings(player, keep);
      if (intent === "back") return back();
    });
  }
  if (intent === "back") return system.run(back);
}

// =========================================================
// Admin Log (filterable)
// =========================================================

export async function showAdminLog(
  player,
  filterAdmin = "",
  filterAction = "",
  filterSource = "",
  page = 0,
) {
  try {
    requireAdminOrModCan(player, "adminLog", "管理日志");
  } catch {
    return;
  }
  // Collect ALL log entries (ring-order agnostic — sorted newest first)
  const allEntries = getAllLogEntries();
  allEntries.sort((a, b) => b.at - a.at);

  // Derive filter options
  const adminNames = [
    ...new Set(allEntries.map((e) => e.byName).filter(Boolean)),
  ].sort();
  const actionTypes = [
    ...new Set(allEntries.map((e) => e.action).filter(Boolean)),
  ].sort();

  // Filter
  let filtered = allEntries;
  if (filterAdmin) filtered = filtered.filter((e) => e.byName === filterAdmin);
  if (filterAction)
    filtered = filtered.filter((e) => e.action === filterAction);
  if (filterSource)
    filtered = filtered.filter((e) => (e.source ?? "admin") === filterSource);

  const PAGE_SIZE = 15;
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const hasPrev = safePage > 0;
  const hasMore = (safePage + 1) * PAGE_SIZE < filtered.length;
  const shown = filtered.slice(
    safePage * PAGE_SIZE,
    (safePage + 1) * PAGE_SIZE,
  );

  const entryRows = shown.map((e) => {
    const ts = fmtMsRaw(e.at);
    const src = e.source ?? "admin";
    const isPlr = src === "player";
    const isSys = src === "system";
    const srcTag = t(
      isSys
        ? "jm_at.adm.al_src_sys"
        : isPlr
          ? "jm_at.adm.al_src_plr"
          : "jm_at.adm.al_src_adm",
    );
    const tgt = e.targetName
      ? t("jm_at.adm.al_target_arrow", e.targetName)
      : "";
    const RED_ACTIONS = new Set([
      "BAN",
      "KICK",
      "BANNED_ITEM_DETECTED",
      "CLEAR_INV",
      "PVP_KILL",
    ]);
    const ORANGE_ACTIONS = new Set([
      "WARN",
      "FREEZE",
      "UNFREEZE",
      "REMOVE_ITEM",
    ]);
    const YELLOW_ACTIONS = new Set([
      "ADMIN_ASSIGN",
      "ADMIN_REMOVE",
      "MOD_ASSIGN",
      "MOD_REMOVE",
      "OWNER_CLAIM",
      "OWNER_RESET",
      "OWNER_TRANSFER",
    ]);
    const PURPLE_ACTIONS = new Set([
      "SERVER_LOCK",
      "DIM_LOCK",
      "DIM_LOCK_SCHED",
      "LOG_CLEAR",
    ]);
    const actColor = RED_ACTIONS.has(e.action)
      ? "§c"
      : ORANGE_ACTIONS.has(e.action)
        ? "§6"
        : YELLOW_ACTIONS.has(e.action)
          ? "§e"
          : PURPLE_ACTIONS.has(e.action)
            ? "§5"
            : isSys
              ? "§7"
              : isPlr
                ? "§a"
                : "§9";
    const act = raw(actColor, logActionLabel(e.action), "§r");
    return raw(
      "§r[§o",
      ts,
      "§r] ",
      srcTag,
      isSys ? t("jm_at.adm.alf_src_system") : e.byName,
      ": ",
      act,
      tgt,
      ...(e.detail ? [" §7", e.detail] : []),
    );
  });
  const lines = shown.length
    ? raw(...entryRows.flatMap((r, i) => (i ? ["\n\n", r] : [r])))
    : t("jm_at.adm.al_no_entries");

  const filterParts = [
    filterAdmin ? t("jm_at.adm.al_filter_admin", filterAdmin) : "",
    filterAction ? t("jm_at.adm.al_filter_action", logActionLabel(filterAction)) : "",
    filterSource ? t("jm_at.adm.al_filter_source", filterSource) : "",
  ].filter(Boolean);
  const activeFilters = filterParts.length
    ? raw(...filterParts.flatMap((p, i) => (i ? [" | ", p] : [p])))
    : "";

  const hasFilters = filterAdmin || filterAction || filterSource;
  const pageLabel =
    totalPages > 1
      ? t("jm_at.common.page_suffix_dash", safePage + 1, totalPages)
      : "";

  const navBtns = [];
  if (hasPrev)
    navBtns.push({
      label: t("jm_at.common.btn_prev_page_plain", safePage),
      icon: "textures/ui/jm_at_back",
      key: "prev",
    });
  if (hasMore)
    navBtns.push({
      label: t("jm_at.common.btn_next_page_plain", safePage + 2),
      icon: "textures/ui/jm_at_next",
      key: "next",
    });

  const canClearLog = isOwner(player);

  const form = new ActionFormData()
    .title(t("jm_at.adm.al_title", filtered.length))
    .body(
      raw(
        ...(activeFilters
          ? [t("jm_at.adm.al_filters_prefix"), activeFilters, "\n"]
          : []),
        lines,
        ...(pageLabel ? ["\n§8", pageLabel] : []),
      ),
    );

  for (const b of navBtns) form.button(b.label, b.icon);
  form.button(
    t(
      hasFilters
        ? "jm_at.adm.al_btn_filters_active"
        : "jm_at.adm.al_btn_filters",
    ),
    "textures/ui/jm_at_filter",
  );
  if (hasFilters)
    form.button(
      t("jm_at.adm.al_btn_clear_filters"),
      "textures/ui/jm_at_clear_filter",
    );
  if (canClearLog)
    form.button(t("jm_at.adm.al_btn_clear_log"), "textures/ui/jm_at_remove");
  form.button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back");
  form.button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showAdminLogHub(player); // X = Back

  let idx = res.selection ?? -1;
  for (const b of navBtns) {
    if (idx === 0) {
      if (b.key === "prev")
        return showAdminLog(
          player,
          filterAdmin,
          filterAction,
          filterSource,
          safePage - 1,
        );
      if (b.key === "next")
        return showAdminLog(
          player,
          filterAdmin,
          filterAction,
          filterSource,
          safePage + 1,
        );
    }
    idx--;
  }
  if (idx === 0)
    return showAdminLogFilter(
      player,
      filterAdmin,
      filterAction,
      filterSource,
      adminNames,
      actionTypes,
    ); // Filters
  idx--;
  if (hasFilters) {
    if (idx === 0) return showAdminLog(player, "", "", "", 0); // Clear Filters
    idx--;
  }
  if (canClearLog) {
    if (idx === 0) {
      const confirm = await new MessageFormData()
        .title(t("jm_at.adm.al_clear_title"))
        .body(t("jm_at.adm.al_clear_body"))
        .button1(t("jm_at.common.btn_cancel"))
        .button2(t("jm_at.adm.al_btn_clear_log_confirm"))
        .show(player);
      if (!confirm.canceled && confirm.selection === 1) {
        clearAdminLog();
        logAdmin(player, "LOG_CLEAR", "操作日志已清空");
        tell(player, t("jm_at.adm.al_cleared"));
      }
      return showAdminLog(player, "", "", "", 0);
    }
    idx--;
  }
  if (idx === 0) return showAdminLogHub(player); // Back
  // idx === 1 → Close
}

async function showAdminLogFilter(
  player,
  currentAdmin,
  currentAction,
  currentSource,
  adminNames,
  actionTypes,
) {
  const reg = getPlayerRegistry();
  const regNames = Object.values(reg)
    .map((e) => e.name)
    .filter(Boolean)
    .sort();

  // Merge log-seen names with registry names, dedupe
  const allNames = [...new Set([...adminNames, ...regNames])].sort();

  const playerOptions = [t("jm_at.adm.alf_show_all"), ...allNames];
  const currentPlayerIdx = allNames.indexOf(currentAdmin);
  const playerDefault = currentPlayerIdx >= 0 ? currentPlayerIdx + 1 : 0;

  const actionOptions = [t("jm_at.adm.alf_show_all"), ...actionTypes.map(logActionLabel)];
  const currentActionIdx = actionTypes.indexOf(currentAction);
  const actionDefault = currentActionIdx >= 0 ? currentActionIdx + 1 : 0;

  const SOURCE_OPTIONS = [
    t("jm_at.adm.alf_show_all"),
    t("jm_at.adm.alf_src_admin"),
    t("jm_at.adm.alf_src_player"),
    t("jm_at.adm.alf_src_system"),
  ];
  const SOURCE_KEYS = ["", "admin", "player", "system"];
  const sourceDefault = Math.max(0, SOURCE_KEYS.indexOf(currentSource));

  const form = new ModalFormData()
    .title(t("jm_at.adm.alf_title"))
    .textField(
      t("jm_at.adm.alf_field_name"),
      t("jm_at.adm.alf_field_name_ph"),
      {
        defaultValue: currentAdmin,
      },
    )
    .dropdown(t("jm_at.adm.alf_dd_players"), playerOptions, {
      defaultValueIndex: playerDefault,
    })
    .dropdown(t("jm_at.adm.alf_dd_action"), actionOptions, {
      defaultValueIndex: actionDefault,
    })
    .dropdown(t("jm_at.adm.alf_dd_source"), SOURCE_OPTIONS, {
      defaultValueIndex: sourceDefault,
    });

  const res = await form.show(player);
  if (res.canceled)
    return showAdminLog(player, currentAdmin, currentAction, currentSource, 0);

  const typed = (res.formValues[0] ?? "").trim();
  const dropIdx = res.formValues[1] ?? 0;
  const actionIdx = res.formValues[2] ?? 0;
  const sourceIdx = res.formValues[3] ?? 0;

  // Resolve player filter
  let newAdmin = "";
  if (typed) {
    const lower = typed.toLowerCase();
    const match = allNames.find((n) => n.toLowerCase() === lower);
    if (!match) {
      return warnForm(player, t("jm_at.adm.alf_no_player", typed), () =>
        showAdminLogFilter(
          player,
          currentAdmin,
          currentAction,
          currentSource,
          adminNames,
          actionTypes,
        ),
      );
    }
    newAdmin = match;
  } else if (dropIdx > 0) {
    newAdmin = allNames[dropIdx - 1] ?? "";
  }

  const newAction = actionIdx > 0 ? (actionTypes[actionIdx - 1] ?? "") : "";
  const newSource = SOURCE_KEYS[sourceIdx] ?? "";

  return showAdminLog(player, newAdmin, newAction, newSource, 0);
}

// =========================================================
// Rollcall / Session Log
// =========================================================

async function showRollcall(player) {
  try {
    requireAdminOrModCan(player, "adminLog", "查看登录退出日志");
  } catch {
    return;
  }
  const log = getSessionLog();

  let lines;
  if (!log.length) {
    lines = t("jm_at.adm.rc_empty");
  } else {
    // Show newest 30 events
    const shown = [...log].reverse().slice(0, 30);
    const rows = shown.map((e) =>
      t(
        e.event === "join" ? "jm_at.adm.rc_row_join" : "jm_at.adm.rc_row_left",
        e.name,
        fmtMsRaw(e.at),
      ),
    );
    lines = raw(...rows.flatMap((r, i) => (i ? ["\n", r] : [r])));
    if (log.length > 30)
      lines = raw(lines, "\n", t("jm_at.adm.rc_more", log.length - 30));
  }

  const isMod = isModerator(player);

  const form = new ActionFormData()
    .title(t("jm_at.adm.rc_title", log.length))
    .body(lines);
  if (!isMod)
    form.button(t("jm_at.adm.rc_btn_clear"), "textures/ui/jm_at_remove");
  form.button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back");
  form.button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const backSel = isMod ? 0 : 1;
  const closeSel = backSel + 1;

  const res = await form.show(player);
  if (res.canceled) return showAdminLogHub(player); // X = Back
  if (res.selection === closeSel) return; // Close
  if (res.selection === backSel) return showAdminLogHub(player); // Back

  if (!isMod && res.selection === 0) {
    const conf = await new MessageFormData()
      .title(t("jm_at.adm.rc_clear_title"))
      .body(t("jm_at.adm.rc_clear_body"))
      .button1(t("jm_at.common.btn_cancel"))
      .button2(t("jm_at.adm.rc_btn_clear_confirm"))
      .show(player);
    if (!conf.canceled && conf.selection === 1) {
      clearSessionLog();
      logAdmin(player, "SESSION_LOG_CLEAR", "");
      tell(player, t("jm_at.adm.rc_cleared"));
    }
    return showRollcall(player);
  }

  return showAdminLogHub(player);
}

// =========================================================
// Staff Activity Summary
// =========================================================

async function showStaffActivity(player) {
  try {
    requireAdminOrModCan(player, "adminLog", "管理团队活动");
  } catch {
    return;
  }
  // Tally actions per admin
  const tally = {}; // { adminName: { total, byAction: { ACTION: count } } }
  for (const entry of getAllLogEntries()) {
    if (!entry.byName) continue;
    // Only staff actions belong in "Staff Activity" — skip player actions
    // (logPlayer, source "player") and System events (logSystem). Legacy
    // entries with no source field are treated as admin (their old behavior).
    if ((entry.source ?? "admin") !== "admin") continue;
    if (!tally[entry.byName]) tally[entry.byName] = { total: 0, byAction: {} };
    tally[entry.byName].total++;
    tally[entry.byName].byAction[entry.action] =
      (tally[entry.byName].byAction[entry.action] ?? 0) + 1;
  }

  // Also tally tickets handled (claims) from tickets
  // We use the log for this since claims are logged as TICKET_CLAIM

  const sorted = Object.entries(tally).sort((a, b) => b[1].total - a[1].total);

  let body;
  if (!sorted.length) {
    body = t("jm_at.adm.sa_empty");
  } else {
    const rows = sorted.map(([name, data]) => {
      const top3 = Object.entries(data.byAction)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([a, c]) => raw(logActionLabel(a), `×${c}`));
      return t(
        "jm_at.adm.sa_row",
        name,
        data.total,
        top3.length ? raw(...top3.flatMap((entry, i) => i ? [", ", entry] : [entry])) : t("jm_at.adm.sa_no_breakdown"),
      );
    });
    body = raw(...rows.flatMap((r, i) => (i ? ["\n\n", r] : [r])));
  }

  const form = new ActionFormData()
    .title(t("jm_at.adm.sa_title"))
    .body(body)
    .button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back")
    .button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showAdminLogHub(player); // X = Back
  if (res.selection === 1) return; // Close
  return showAdminLogHub(player); // Back
}

// =========================================================
// Inventory & Ender Chest Viewer
// =========================================================

async function showInventoryViewer(admin, target, backFn) {
  try {
    requireAdminOrModCan(admin, "viewInventory", "物品栏查看器");
  } catch {
    return;
  }
  // Hard guard: the owner's inventory is never viewable/editable by other staff.
  // The actions-panel button is hidden for owner targets; this backs that up so
  // no other path (now or later) can reach the viewer for the owner.
  if (isOwner(target)) {
    return warnForm(admin, t("jm_at.adm.inv_owner_protected"), () =>
      typeof backFn === "function" ? backFn() : undefined,
    );
  }
  // A moderator may not inspect or edit a higher-ranked admin's inventory.
  try {
    requireOutranksTarget(admin, target, "查看物品栏");
  } catch (e) {
    return warnForm(admin, raw("§c", e?.message ?? ""), () =>
      typeof backFn === "function" ? backFn() : undefined,
    );
  }
  const canClear = modCan(admin, "clearInventory");

  const form = new ActionFormData()
    .title(t("jm_at.adm.inv_title", target.name))
    .body(t("jm_at.adm.inv_body"))
    .button(t("jm_at.adm.inv_btn_main"), "textures/ui/jm_at_inventory")
    .button(t("jm_at.adm.inv_btn_ender"), "textures/ui/jm_at_ender")
    .button(t("jm_at.adm.inv_btn_armor"), "textures/ui/jm_at_armor")
    .button(t("jm_at.adm.inv_btn_effects"), "textures/ui/jm_at_potion");

  if (canClear)
    form.button(t("jm_at.adm.inv_btn_clear"), "textures/ui/jm_at_remove");

  form.button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back");
  form.button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const backIdx = canClear ? 5 : 4;
  const closeIdx = backIdx + 1;

  const res = await form.show(admin);
  if (res.canceled) return backFn(); // X = Back
  if (res.selection === backIdx) return backFn(); // Back
  if (res.selection === closeIdx) return; // Close
  if (res.selection === 0) return showMainInventory(admin, target, backFn);
  if (res.selection === 1) return showEnderChest(admin, target, backFn);
  if (res.selection === 2) return showArmorSlots(admin, target, backFn);
  if (res.selection === 3) return showActiveEffects(admin, target, backFn);

  // Clear Inventory (selection === 4)
  if (canClear && res.selection === 4) {
    if (isOwner(target)) {
      tell(admin, t("jm_at.adm.inv_owner_clear"));
      return showInventoryViewer(admin, target, backFn);
    }
    const conf = await new MessageFormData()
      .title(t("jm_at.adm.inv_clear_title"))
      .body(t("jm_at.adm.inv_clear_body", target.name))
      .button1(t("jm_at.common.btn_cancel"))
      .button2(t("jm_at.adm.inv_btn_clear_confirm"))
      .show(admin);
    if (!conf.canceled && conf.selection === 1) {
      clearInventory(target);
      logAdmin(admin, "CLEAR_INV", "", target.name);
      tell(admin, t("jm_at.adm.inv_cleared", target.name));
      tell(target, t("jm_at.adm.inv_cleared_target"));
    }
    return showInventoryViewer(admin, target, backFn);
  }
}

// A "container source" describes one of a player's live containers so the
// shared item-action modals (take / delete / remove) can operate on either the
// main inventory or the ender chest. `redraw` is the list view to return to.
// NOTE: the referenced functions are hoisted declarations, so naming them here
// (above their definitions) is safe.
const INV_SOURCE = {
  componentId: "minecraft:inventory",
  label: "物品栏", // persisted log display
  labelKey: "jm_at.adm.src_inventory",
  get redraw() {
    return showMainInventory;
  },
};
const ECHEST_SOURCE = {
  componentId: "minecraft:ender_inventory",
  label: "末影箱", // persisted log display
  labelKey: "jm_at.adm.src_ender_chest",
  get redraw() {
    return showEnderChest;
  },
};

async function showMainInventory(admin, target, backFn) {
  const inv = target.getComponent("minecraft:inventory")?.container;
  if (!inv) {
    return warnForm(admin, t("jm_at.adm.inv_open_failed"), () => backFn());
  }
  const isAdm = isAdmin(admin).ok;
  // Removing/taking items destroys a player's belongings, so it is gated by the
  // clearInventory privilege — the same one the bulk "Clear Inventory" button
  // uses. Without it the viewer is read-only (viewInventory grants look, not
  // touch). Defense in depth: the item-action modals re-check this too.
  const canModify = modCan(admin, "clearInventory");

  // Build list of occupied slots
  const occupied = [];
  for (let i = 0; i < inv.size; i++) {
    const item = inv.getItem(i);
    if (item) occupied.push({ slot: i, item });
  }

  const form = new ActionFormData()
    .title(t("jm_at.adm.inv_main_title", target.name, occupied.length))
    .body(
      t(
        occupied.length
          ? canModify
            ? isAdm
              ? "jm_at.adm.inv_main_body_admin"
              : "jm_at.adm.inv_main_body_mod"
            : "jm_at.adm.inv_main_body_view"
          : "jm_at.adm.inv_main_empty",
      ),
    );

  for (const { slot, item } of occupied) {
    const name = itemName(item);
    form.button(
      t(
        "jm_at.adm.inv_item_row",
        name,
        item.amount,
        String(slot).padStart(2, "0"),
      ),
    );
  }
  form.button(t("jm_at.common.btn_back_bold"));
  form.button(CLOSE_BTN_LABEL);

  const res = await form.show(admin);
  if (res.canceled) return showInventoryViewer(admin, target, backFn); // X = Back
  if (res.selection === occupied.length)
    return showInventoryViewer(admin, target, backFn); // Back
  if (res.selection === occupied.length + 1) return; // Close

  const chosen = occupied[res.selection];
  if (!chosen) return;
  if (!canModify) {
    return warnForm(admin, t("jm_at.adm.inv_view_only"), () =>
      showMainInventory(admin, target, backFn),
    );
  }
  if (isAdm)
    return showItemActionModal(
      admin,
      target,
      chosen.slot,
      chosen.item,
      backFn,
      INV_SOURCE,
    );
  return showRemoveItemModal(
    admin,
    target,
    chosen.slot,
    chosen.item,
    backFn,
    INV_SOURCE,
  );
}

async function showItemActionModal(admin, target, slot, item, backFn, source) {
  if (!modCan(admin, "clearInventory")) {
    return warnForm(admin, t("jm_at.adm.inv_no_perm_take"), () =>
      source.redraw(admin, target, backFn),
    );
  }
  const name = itemName(item);
  const form = new ActionFormData()
    .title(t("jm_at.adm.inv_item_title", name, item.amount))
    .body(t("jm_at.adm.inv_item_body"))
    .button(t("jm_at.adm.inv_btn_take"), "textures/ui/jm_at_inventory")
    .button(t("jm_at.adm.inv_btn_delete"), "textures/ui/jm_at_remove")
    .button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back")
    .button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(admin);
  if (res.canceled) return source.redraw(admin, target, backFn); // X = Back
  if (res.selection === 2) return source.redraw(admin, target, backFn); // Back
  if (res.selection === 3) return; // Close
  if (res.selection === 0)
    return showTakeItemModal(admin, target, slot, item, backFn, source);
  if (res.selection === 1)
    return showRemoveItemModal(admin, target, slot, item, backFn, source);
}

async function showTakeItemModal(admin, target, slot, item, backFn, source) {
  const name = itemName(item);
  const total = item.amount;

  if (total === 1) {
    // Slider with min===max is broken in some engine versions — use a confirm.
    const conf = await new MessageFormData()
      .title(t("jm_at.adm.inv_take_title", name))
      .body(t("jm_at.adm.inv_take_one_body", name, target.name))
      .button1(t("jm_at.common.btn_cancel"))
      .button2(t("jm_at.adm.inv_btn_take_confirm"))
      .show(admin);
    if (conf.canceled || conf.selection === 0)
      return source.redraw(admin, target, backFn);
    return _takeItemApply(admin, target, slot, item, backFn, source, 1);
  }

  const amountObs = new ObservableNumber(total, { clientWritable: true });
  let pendingNav = null;
  const form = new CustomForm(admin, t("jm_at.adm.inv_take_title", name));
  form.slider(t("jm_at.adm.inv_take_slider", total), amountObs, 1, total, {
    step: 1,
  });
  form.spacer();
  form.button(t("jm_at.adm.inv_btn_take_plain"), () => {
    const amount = Math.max(
      1,
      Math.min(total, Math.floor(amountObs.getData())),
    );
    pendingNav = () =>
      _takeItemApply(admin, target, slot, item, backFn, source, amount);
    try {
      form.close();
    } catch {}
  });
  form.button(t("jm_at.common.btn_back"), () => {
    pendingNav = () => source.redraw(admin, target, backFn);
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(() =>
      showTakeItemModal(admin, target, slot, item, backFn, source),
    );
  }
  if (pendingNav) return system.run(pendingNav);
  return; // ✕ / engine close / escape → exit to game
}

function _takeItemApply(admin, target, slot, item, backFn, source, amount) {
  const name = itemName(item); // live tells (localized)
  const nameStr = item.typeId.replace("minecraft:", ""); // stored log (English)
  try {
    const inv = target.getComponent(source.componentId)?.container;
    if (!inv) {
      return warnForm(
        admin,
        t("jm_at.adm.inv_open_src_failed", t(source.labelKey)),
        () => source.redraw(admin, target, backFn),
      );
    }

    const current = inv.getItem(slot);
    if (!current || current.typeId !== item.typeId) {
      return warnForm(
        admin,
        t("jm_at.adm.inv_src_changed", t(source.labelKey)),
        () => source.redraw(admin, target, backFn),
      );
    }

    const originalAmount = current.amount;
    const toTake = Math.min(amount, originalAmount);

    if (toTake >= originalAmount) {
      inv.setItem(slot);
    } else {
      current.amount = originalAmount - toTake;
      inv.setItem(slot, current);
    }

    current.amount = toTake;
    const adminInv = admin.getComponent("minecraft:inventory")?.container;
    let dropped = false;
    if (adminInv) {
      const leftover = adminInv.addItem(current);
      if (leftover) {
        admin.dimension.spawnItem(leftover, admin.location);
        dropped = true;
      }
    } else {
      admin.dimension.spawnItem(current, admin.location);
      dropped = true;
    }

    logAdmin(
      admin,
      "TAKE_ITEM",
      `${toTake}x ${nameStr} (${source.label} 槽位 ${slot})`,
      target.name,
    );
    tell(
      admin,
      t(
        dropped ? "jm_at.adm.inv_took_dropped" : "jm_at.adm.inv_took",
        toTake,
        name,
        target.name,
        t(source.labelKey),
      ),
    );
    tell(
      target,
      t("jm_at.adm.inv_took_target", toTake, name, t(source.labelKey)),
    );
  } catch (e) {
    return warnForm(
      admin,
      raw("§c", e?.message ?? t("jm_at.adm.inv_take_failed")),
      () => source.redraw(admin, target, backFn),
    );
  }

  return source.redraw(admin, target, backFn);
}

async function showRemoveItemModal(admin, target, slot, item, backFn, source) {
  if (!modCan(admin, "clearInventory")) {
    return warnForm(admin, t("jm_at.adm.inv_no_perm_remove"), () =>
      source.redraw(admin, target, backFn),
    );
  }
  const name = itemName(item);
  const total = item.amount;

  if (total === 1) {
    // Slider with min===max is broken in some engine versions — use a confirm.
    const conf = await new MessageFormData()
      .title(t("jm_at.adm.inv_remove_title", name))
      .body(t("jm_at.adm.inv_remove_one_body", name, target.name))
      .button1(t("jm_at.common.btn_cancel"))
      .button2(t("jm_at.adm.btn_delete_red"))
      .show(admin);
    if (conf.canceled || conf.selection === 0)
      return source.redraw(admin, target, backFn);
    return _removeItemApply(admin, target, slot, item, backFn, source, 1);
  }

  const amountObs = new ObservableNumber(total, { clientWritable: true });
  let pendingNav = null;
  const form = new CustomForm(admin, t("jm_at.adm.inv_remove_title", name));
  form.slider(t("jm_at.adm.inv_remove_slider", total), amountObs, 1, total, {
    step: 1,
  });
  form.spacer();
  form.button(t("jm_at.adm.btn_delete_plain"), () => {
    const amount = Math.max(
      1,
      Math.min(total, Math.floor(amountObs.getData())),
    );
    pendingNav = () =>
      _removeItemApply(admin, target, slot, item, backFn, source, amount);
    try {
      form.close();
    } catch {}
  });
  form.button(t("jm_at.common.btn_back"), () => {
    pendingNav = () => source.redraw(admin, target, backFn);
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(() =>
      showRemoveItemModal(admin, target, slot, item, backFn, source),
    );
  }
  if (pendingNav) return system.run(pendingNav);
  return; // ✕ / engine close / escape → exit to game
}

function _removeItemApply(admin, target, slot, item, backFn, source, amount) {
  const name = itemName(item); // live tells (localized)
  const nameStr = item.typeId.replace("minecraft:", ""); // stored log (English)
  try {
    const inv = target.getComponent(source.componentId)?.container;
    if (!inv) {
      return warnForm(
        admin,
        t("jm_at.adm.inv_open_src_failed", t(source.labelKey)),
        () => source.redraw(admin, target, backFn),
      );
    }

    // Re-read the slot in case the container changed while the form was open
    const current = inv.getItem(slot);
    if (!current || current.typeId !== item.typeId) {
      return warnForm(
        admin,
        t("jm_at.adm.inv_src_changed", t(source.labelKey)),
        () => source.redraw(admin, target, backFn),
      );
    }

    if (amount >= current.amount) {
      inv.setItem(slot);
    } else {
      current.amount = current.amount - amount;
      inv.setItem(slot, current);
    }

    logAdmin(
      admin,
      "REMOVE_ITEM",
      `${amount}x ${nameStr} (${source.label} 槽位 ${slot})`,
      target.name,
    );
    tell(
      admin,
      t("jm_at.adm.inv_removed", amount, name, target.name, t(source.labelKey)),
    );
    tell(
      target,
      t("jm_at.adm.inv_removed_target", amount, name, t(source.labelKey)),
    );
  } catch (e) {
    return warnForm(
      admin,
      raw("§c", e?.message ?? t("jm_at.adm.inv_remove_failed")),
      () => source.redraw(admin, target, backFn),
    );
  }

  return source.redraw(admin, target, backFn);
}

async function showEnderChest(admin, target, backFn) {
  // Live ender chest viewer. As of @minecraft/server 2.8.0 the
  // `minecraft:ender_inventory` component exposes a real Container, so this is
  // now read/write and mirrors the main inventory viewer (no more dynamic-
  // property snapshots — the old `hasitem` scanner is obsolete).
  const ender = target.getComponent("minecraft:ender_inventory")?.container;
  if (!ender) {
    return warnForm(admin, t("jm_at.adm.inv_open_ender_failed"), () =>
      showInventoryViewer(admin, target, backFn),
    );
  }
  const isAdm = isAdmin(admin).ok;
  const canModify = modCan(admin, "clearInventory");

  // Build list of occupied slots
  const occupied = [];
  for (let i = 0; i < ender.size; i++) {
    const item = ender.getItem(i);
    if (item) occupied.push({ slot: i, item });
  }

  const form = new ActionFormData()
    .title(t("jm_at.adm.inv_ender_title", target.name, occupied.length))
    .body(
      t(
        occupied.length
          ? canModify
            ? isAdm
              ? "jm_at.adm.inv_main_body_admin"
              : "jm_at.adm.inv_main_body_mod"
            : "jm_at.adm.inv_main_body_view"
          : "jm_at.adm.inv_ender_empty",
      ),
    );

  for (const { slot, item } of occupied) {
    const name = itemName(item);
    form.button(
      t(
        "jm_at.adm.inv_item_row",
        name,
        item.amount,
        String(slot).padStart(2, "0"),
      ),
    );
  }
  form.button(t("jm_at.common.btn_back_bold"));
  form.button(CLOSE_BTN_LABEL);

  const res = await form.show(admin);
  if (res.canceled) return showInventoryViewer(admin, target, backFn); // X = Back
  if (res.selection === occupied.length)
    return showInventoryViewer(admin, target, backFn); // Back
  if (res.selection === occupied.length + 1) return; // Close

  const chosen = occupied[res.selection];
  if (!chosen) return;
  if (!canModify) {
    return warnForm(admin, t("jm_at.adm.inv_view_only"), () =>
      showEnderChest(admin, target, backFn),
    );
  }
  if (isAdm)
    return showItemActionModal(
      admin,
      target,
      chosen.slot,
      chosen.item,
      backFn,
      ECHEST_SOURCE,
    );
  return showRemoveItemModal(
    admin,
    target,
    chosen.slot,
    chosen.item,
    backFn,
    ECHEST_SOURCE,
  );
}

async function showActiveEffects(admin, target, backFn) {
  let effects = [];
  try {
    effects = target.getEffects();
  } catch {}

  const lines = effects.map((e) => {
    const name = e.typeId.replace("minecraft:", "");
    const level = e.amplifier + 1;
    const ticks = e.duration;
    const secs = Math.floor(ticks / 20);
    const mins = Math.floor(secs / 60);
    const remSecs = secs % 60;
    const time =
      mins > 0 ? `${mins}:${String(remSecs).padStart(2, "0")}` : `${secs}s`;
    return t(
      "jm_at.adm.eff_row",
      name,
      level > 1 ? t("jm_at.adm.eff_level", level) : "",
      time,
    );
  });

  const body = effects.length
    ? t(
        "jm_at.adm.eff_body",
        target.name,
        raw(...lines.flatMap((l, i) => (i ? ["\n", l] : [l]))),
      )
    : t("jm_at.adm.eff_none", target.name);

  const form = new MessageFormData()
    .title(t("jm_at.adm.eff_title", target.name, effects.length))
    .body(body)
    .button1(t("jm_at.common.btn_back_bold"))
    .button2(t("jm_at.adm.eff_btn_refresh"));

  const res = await form.show(admin);
  if (res.canceled) return showInventoryViewer(admin, target, backFn); // X = Back
  if (res.selection === 0) return showInventoryViewer(admin, target, backFn);
  if (res.selection === 1) return showActiveEffects(admin, target, backFn);
}

async function showArmorSlots(admin, target, backFn) {
  const equip = target.getComponent("minecraft:equippable");
  // label = persisted Chinese log detail; labelKey = live display surfaces.
  const slotDefs = [
    ["头部", EquipmentSlot.Head, "jm_at.adm.slot_head"],
    ["胸部", EquipmentSlot.Chest, "jm_at.adm.slot_chest"],
    ["腿部", EquipmentSlot.Legs, "jm_at.adm.slot_legs"],
    ["脚部", EquipmentSlot.Feet, "jm_at.adm.slot_feet"],
    ["副手", EquipmentSlot.Offhand, "jm_at.adm.slot_offhand"],
  ];

  // Build list of occupied armor/offhand slots
  const occupied = [];
  for (const [label, slot, labelKey] of slotDefs) {
    try {
      const item = equip?.getEquipment(slot);
      if (item) occupied.push({ label, labelKey, slot, item });
    } catch {}
  }

  const canModify = modCan(admin, "clearInventory");
  const form = new ActionFormData()
    .title(t("jm_at.adm.gear_title", target.name, occupied.length))
    .body(
      t(
        occupied.length
          ? canModify
            ? "jm_at.adm.gear_body_modify"
            : "jm_at.adm.gear_body_view"
          : "jm_at.adm.gear_empty",
      ),
    );

  // Show all five slots, grayed out if empty so the layout is clear
  for (const [, slot, labelKey] of slotDefs) {
    const entry = occupied.find((o) => o.slot === slot);
    if (entry) {
      form.button(
        t("jm_at.adm.gear_slot_row", t(labelKey), itemName(entry.item)),
      );
    } else {
      form.button(t("jm_at.adm.gear_slot_empty", t(labelKey)));
    }
  }
  form.button(t("jm_at.common.btn_back_bold"));
  form.button(CLOSE_BTN_LABEL);

  const res = await form.show(admin);
  if (res.canceled) return showInventoryViewer(admin, target, backFn); // X = Back
  if (res.selection === slotDefs.length)
    return showInventoryViewer(admin, target, backFn); // Back
  if (res.selection === slotDefs.length + 1) return; // Close

  const [chosenLabel, chosenSlot, chosenLabelKey] = slotDefs[res.selection];
  const chosenEntry = occupied.find((o) => o.slot === chosenSlot);

  if (!chosenEntry) {
    // Clicked an empty slot — tell the admin why nothing happened, then redraw
    // so the tap isn't a silent no-op.
    tell(admin, t("jm_at.adm.gear_slot_is_empty", t(chosenLabelKey)));
    return showArmorSlots(admin, target, backFn);
  }

  if (!canModify) {
    return warnForm(admin, t("jm_at.adm.gear_view_only"), () =>
      showArmorSlots(admin, target, backFn),
    );
  }

  return showRemoveArmorModal(
    admin,
    target,
    { label: chosenLabel, labelKey: chosenLabelKey },
    chosenSlot,
    chosenEntry.item,
    backFn,
  );
}

async function showRemoveArmorModal(
  admin,
  target,
  { label, labelKey },
  slot,
  item,
  backFn,
) {
  if (!modCan(admin, "clearInventory")) {
    return warnForm(admin, t("jm_at.adm.gear_no_perm"), () =>
      showArmorSlots(admin, target, backFn),
    );
  }
  const name = itemName(item); // live surfaces (localized)
  const nameStr = item.typeId.replace("minecraft:", ""); // stored log (English)

  const conf = await new MessageFormData()
    .title(t("jm_at.adm.inv_remove_title", t(labelKey)))
    .body(t("jm_at.adm.gear_remove_body", name, target.name, t(labelKey)))
    .button1(t("jm_at.common.btn_cancel"))
    .button2(t("jm_at.adm.gear_btn_remove"))
    .show(admin);
  if (conf.canceled || conf.selection === 0)
    return showArmorSlots(admin, target, backFn);

  try {
    const equip = target.getComponent("minecraft:equippable");
    if (!equip) {
      return warnForm(admin, t("jm_at.adm.gear_open_failed"), () =>
        showArmorSlots(admin, target, backFn),
      );
    }
    // Re-verify the slot still holds the item shown in the dialog — the target
    // may have swapped gear while the modal was open, which would otherwise
    // destroy a different item.
    const current = equip.getEquipment(slot);
    if (!current || current.typeId !== item.typeId) {
      return warnForm(admin, t("jm_at.adm.gear_changed"), () =>
        showArmorSlots(admin, target, backFn),
      );
    }
    equip.setEquipment(slot);
    logAdmin(admin, "REMOVE_ITEM", `${label} 槽位：${nameStr}`, target.name);
    tell(admin, t("jm_at.adm.gear_removed", name, target.name, t(labelKey)));
    tell(target, t("jm_at.adm.gear_removed_target", name, t(labelKey)));
  } catch (e) {
    return warnForm(
      admin,
      raw("§c", e?.message ?? t("jm_at.adm.inv_remove_failed")),
      () => showArmorSlots(admin, target, backFn),
    );
  }

  return showArmorSlots(admin, target, backFn);
}

// =========================================================
// Dimension Locks
// =========================================================

/**
 * DDUI (CustomForm) dimension locks. The lock toggles apply immediately (via
 * Observable subscriptions, matching the old instant behavior). Scheduling is
 * inline (dimension + action + duration + a Schedule button); each currently
 * scheduled lock/unlock gets its own Cancel button. Removes the old
 * cancelLockIdx/backIdx selection-index arithmetic. mutateCfg is the authority.
 */
async function showDimensionLocks(player) {
  try {
    requireAdminOrModCan(player, "dimensionLocks", "维度锁定");
  } catch {
    return;
  }
  const cfg = getCfg();
  const locks = cfg.dimLocks ?? { nether: false, end: false };
  // Snapshot of entries that exist now — each gets a Cancel button. New ones
  // scheduled this session appear in the summary; reopen to cancel them.
  const schedAtOpen = [
    ...(cfg.scheduledDimLocks ?? []).map((s) => ({ ...s, kind: "lock" })),
    ...(cfg.scheduledDimUnlocks ?? []).map((s) => ({ ...s, kind: "unlock" })),
  ];

  const netherObs = new ObservableBoolean(!!locks.nether, {
    clientWritable: true,
  });
  const endObs = new ObservableBoolean(!!locks.end, { clientWritable: true });
  const schedDimObs = new ObservableNumber(0, { clientWritable: true });
  const schedActionObs = new ObservableNumber(0, { clientWritable: true });
  const schedDurObs = new ObservableString("10m", { clientWritable: true });
  const status = new ObservableString("");
  const statusShown = new ObservableBoolean(false);

  const buildSummary = () => {
    const c = getCfg();
    const lk = c.scheduledDimLocks ?? [];
    const ul = c.scheduledDimUnlocks ?? [];
    const lkLines = lk.length
      ? lk
          .map(
            (s) =>
              `§c${s.dim === "nether" ? "下界" : "末地"}将于 ${fmtMs(s.activateAt)} 锁定`,
          )
          .join("\n")
      : "§8无";
    const ulLines = ul.length
      ? ul
          .map(
            (s) =>
              `§2${s.dim === "nether" ? "下界" : "末地"}将于 ${fmtMs(s.activateAt)} 解锁`,
          )
          .join("\n")
      : "§8无";
    return `§r计划锁定：\n${lkLines}\n\n§r计划解锁：\n${ulLines}`;
  };
  const schedSummary = new ObservableString(buildSummary());

  let pendingNav = null;
  const note = (m) => {
    status.setData(m);
    statusShown.setData(true);
  };

  // Lock toggles apply immediately, like the old per-button behavior.
  netherObs.subscribe(() => {
    const locked = netherObs.getData();
    mutateCfg((c) => {
      c.dimLocks = c.dimLocks ?? {};
      c.dimLocks.nether = locked;
    });
    logAdmin(player, "DIM_LOCK", `下界：${locked ? "LOCKED" : "UNLOCKED"}`);
    broadcastAdmins(
      t(
        locked
          ? "jm_at.adm.dl_nether_locked_bc"
          : "jm_at.adm.dl_nether_unlocked_bc",
        player.name,
      ),
    );
  });
  endObs.subscribe(() => {
    const locked = endObs.getData();
    mutateCfg((c) => {
      c.dimLocks = c.dimLocks ?? {};
      c.dimLocks.end = locked;
    });
    logAdmin(player, "DIM_LOCK", `末地：${locked ? "LOCKED" : "UNLOCKED"}`);
    broadcastAdmins(
      t(
        locked ? "jm_at.adm.dl_end_locked_bc" : "jm_at.adm.dl_end_unlocked_bc",
        player.name,
      ),
    );
  });

  const form = new CustomForm(player, t("jm_at.adm.dl_title"));
  form.spacer();
  form.label(t("jm_at.adm.dl_intro"));
  form.spacer();
  form.toggle(t("jm_at.adm.dl_toggle_nether"), netherObs);
  form.toggle(t("jm_at.adm.dl_toggle_end"), endObs);
  form.spacer();
  form.header(t("jm_at.adm.dl_sched_header"));
  form.spacer();
  form.dropdown(t("jm_at.adm.dl_dd_dimension"), schedDimObs, [
    { label: t("jm_at.adm.dim_short_nether"), value: 0 },
    { label: t("jm_at.adm.dim_short_end"), value: 1 },
  ]);
  form.dropdown(t("jm_at.adm.dl_dd_action"), schedActionObs, [
    { label: t("jm_at.adm.dl_opt_lock"), value: 0 },
    { label: t("jm_at.adm.dl_opt_unlock"), value: 1 },
  ]);
  form.textField(t("jm_at.adm.dl_field_when"), schedDurObs, {
    description: t("jm_at.adm.dl_field_when_desc"),
  });
  form.spacer();
  // lang-keys: jm_at.adm.dl_sched_nether_lock_bc jm_at.adm.dl_sched_nether_unlock_bc jm_at.adm.dl_sched_end_lock_bc jm_at.adm.dl_sched_end_unlock_bc
  form.button(t("jm_at.adm.dl_btn_schedule"), () => {
    const dim = schedDimObs.getData() === 1 ? "end" : "nether";
    const isUnlock = schedActionObs.getData() === 1;
    const durMs = parseDuration(schedDurObs.getData().trim());
    if (!durMs || durMs <= 0) {
      return note("§c时长无效，请使用 10m、1h、30s 等格式。");
    }
    const activateAt = Date.now() + durMs;
    mutateCfg((c) => {
      const key = isUnlock ? "scheduledDimUnlocks" : "scheduledDimLocks";
      c[key] = [...(c[key] ?? []), { dim, activateAt }];
    });
    logAdmin(
      player,
      isUnlock ? "DIM_UNLOCK_SCHED" : "DIM_LOCK_SCHED",
      `${dim}，等待 ${fmtDuration(durMs)}`,
    );
    const bcKey = `jm_at.adm.dl_sched_${dim}_${isUnlock ? "unlock" : "lock"}_bc`;
    for (const p of world.getPlayers()) {
      p.sendMessage(t(bcKey, fmtDurationRaw(durMs)));
    }
    // Reopen so the new entry gets a Cancel button.
    pendingNav = () => showDimensionLocks(player);
    try {
      form.close();
    } catch {}
  });
  form.spacer();
  form.label(schedSummary);
  form.spacer();

  // One Cancel button per entry that existed when the form opened.
  const cancelShown = schedAtOpen.map(() => new ObservableBoolean(true));
  schedAtOpen.forEach((s, i) => {
    const dimLabel = t(
      s.dim === "nether"
        ? "jm_at.adm.dim_short_nether"
        : "jm_at.adm.dim_short_end",
    );
    form.button(
      t(
        s.kind === "lock"
          ? "jm_at.adm.dl_btn_cancel_lock"
          : "jm_at.adm.dl_btn_cancel_unlock",
        dimLabel,
        fmtMsRaw(s.activateAt),
      ),
      () => {
        mutateCfg((c) => {
          const key =
            s.kind === "lock" ? "scheduledDimLocks" : "scheduledDimUnlocks";
          c[key] = (c[key] ?? []).filter(
            (e) => !(e.dim === s.dim && e.activateAt === s.activateAt),
          );
        });
        logAdmin(
          player,
          s.kind === "lock" ? "DIM_LOCK_CANCEL" : "DIM_UNLOCK_CANCEL",
          s.dim,
        );
        cancelShown[i].setData(false);
        schedSummary.setData(buildSummary());
        note(
          `§2已取消${s.dim === "nether" ? "下界" : "末地"}的计划${s.kind === "lock" ? "锁定" : "解锁"}。`,
        );
      },
      { visible: cancelShown[i] },
    );
  });

  form.spacer();
  form.label(status, { visible: statusShown });
  form.spacer({ visible: statusShown });
  form.button(t("jm_at.common.btn_back"), () => {
    pendingNav = () => showControlPanel(player);
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(() => showDimensionLocks(player));
  }
  if (pendingNav) return system.run(pendingNav);
  return; // ✕ / engine close / escape → exit (locks/schedules apply immediately)
}

// =========================================================
// Warps (Admin)
// =========================================================

// Maps the visibility dropdown index → access tier, and tier → display bits.
const ACCESS_BY_INDEX = [
  WARP_ACCESS.PUBLIC,
  WARP_ACCESS.STAFF,
  WARP_ACCESS.ADMIN,
];
const ACCESS_SUFFIX_KEY = {
  public: "",
  staff: "jm_at.adm.warp_suffix_staff",
  admin: "jm_at.adm.warp_suffix_admin",
};
/** Short colored tag for a warp's access tier, e.g. "§c[Admin-only]§r". */
function accessTag(access) {
  if (access === WARP_ACCESS.ADMIN) return t("jm_at.adm.warp_tag_admin");
  if (access === WARP_ACCESS.STAFF) return t("jm_at.adm.warp_tag_staff");
  return t("jm_at.adm.warp_tag_public");
}

/**
 * Render a paginated ActionForm picker over `names` (WARPS_PER_PAGE per page).
 * `label(name)` returns either a button label string, or { label, icon }.
 * Handles Prev/Next internally; returns { item } on selection, or
 * { nav: "back" | "close" } when the user backs out or closes.
 */
async function showWarpPicker(player, { title, body, names, label }) {
  let page = 0;
  while (true) {
    const totalPages = Math.max(1, Math.ceil(names.length / WARPS_PER_PAGE));
    page = Math.min(Math.max(page, 0), totalPages - 1);
    const shown = names.slice(
      page * WARPS_PER_PAGE,
      (page + 1) * WARPS_PER_PAGE,
    );
    const hasPrev = page > 0;
    const hasMore = (page + 1) * WARPS_PER_PAGE < names.length;
    const pageLabel =
      totalPages > 1
        ? t("jm_at.common.page_suffix_dash", page + 1, totalPages)
        : "";

    const form = new ActionFormData().title(title).body(raw(body, pageLabel));
    for (const n of shown) {
      const b = label(n);
      if (typeof b === "string" || !b.icon) form.button(b.label ?? b);
      else form.button(b.label, b.icon);
    }

    const nav = [];
    if (hasPrev)
      nav.push({
        key: "prev",
        label: t("jm_at.common.btn_prev_page_plain", page),
        icon: "textures/ui/jm_at_back",
      });
    if (hasMore)
      nav.push({
        key: "next",
        label: t("jm_at.common.btn_next_page_plain", page + 2),
        icon: "textures/ui/jm_at_next",
      });
    nav.push({
      key: "back",
      label: t("jm_at.common.btn_back_bold"),
      icon: "textures/ui/jm_at_back",
    });
    nav.push({ key: "close", label: CLOSE_BTN_LABEL, icon: CLOSE_BTN_ICON });
    for (const b of nav) form.button(b.label, b.icon);

    const res = await form.show(player);
    if (res.canceled) return { nav: "back" }; // X = Back
    if (res.selection < shown.length) return { item: shown[res.selection] };

    const chosen = nav[res.selection - shown.length];
    if (!chosen) return { nav: "close" };
    if (chosen.key === "prev") {
      page--;
      continue;
    }
    if (chosen.key === "next") {
      page++;
      continue;
    }
    return { nav: chosen.key }; // "back" | "close"
  }
}

async function _doAddWarpFlow(player) {
  const warps = getWarps();
  const names = getSortedWarpNames(warps);
  if (names.length >= MAX_WARPS_LIMIT) {
    return warnForm(player, t("jm_at.adm.warp_limit", MAX_WARPS_LIMIT), () =>
      showWarpsAdmin(player),
    );
  }
  const nameObs = new ObservableString("", { clientWritable: true });
  const accessObs = new ObservableNumber(0, { clientWritable: true });
  const status = new ObservableString("");
  const statusShown = new ObservableBoolean(false);
  let pendingNav = null;
  const fail = (m) => {
    status.setData(m);
    statusShown.setData(true);
  };

  const form = new CustomForm(player, t("jm_at.adm.warp_add_title"));
  form.textField(t("jm_at.adm.warp_field_name"), nameObs, {
    description: t("jm_at.adm.warp_field_name_desc"),
  });
  form.dropdown(t("jm_at.adm.warp_dd_visibility"), accessObs, [
    { label: t("jm_at.adm.warp_opt_public"), value: 0 },
    { label: t("jm_at.adm.warp_opt_staff"), value: 1 },
    { label: t("jm_at.adm.warp_opt_admin"), value: 2 },
  ]);
  form.spacer();
  form.label(status, { visible: statusShown });
  form.spacer({ visible: statusShown });
  const submit = (close) => {
    const name = clampText(nameObs.getData().trim(), 30);
    if (!validDestinationName(name)) {
      fail("§c传送点名称须为 1–30 个字符，且不能含控制字符或保留名称。");
      return;
    }
    if (getWarps()[name]) {
      fail(`§c名为“${name}”的传送点已存在。`);
      return;
    }
    const access = ACCESS_BY_INDEX[accessObs.getData()] ?? WARP_ACCESS.PUBLIC;
    pendingNav = () => {
      try { requireAdminOrModCan(player, "warps", "添加传送点"); } catch { return; }
      if (!addWarp(name, player, access)) {
        tell(player, "§c传送点保存失败，或名称已存在/数量达到上限。");
        return showWarpsAdmin(player);
      }
      logAdmin(
        player,
        "WARP_ADD",
        `${name}${access !== WARP_ACCESS.PUBLIC ? ` [${access}]` : ""}`,
      );
      tell(
        player,
        t(
          "jm_at.adm.warp_set_done",
          name,
          ACCESS_SUFFIX_KEY[access] ? t(ACCESS_SUFFIX_KEY[access]) : "",
        ),
      );
      return close ? undefined : showWarpsAdmin(player);
    };
    try {
      form.close();
    } catch {}
  };
  form.button(t("jm_at.adm.btn_add"), () => submit(false));
  form.button(t("jm_at.adm.btn_add_close"), () => submit(true));
  form.button(t("jm_at.common.btn_back"), () => {
    pendingNav = () => showWarpsAdmin(player);
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(() => _doAddWarpFlow(player));
  }
  if (pendingNav) return system.run(pendingNav);
  return; // ✕ / engine close / escape → exit to game
}

async function _doRemoveWarpFlow(player) {
  const warps = getWarps();
  const names = getSortedWarpNames(warps);
  if (names.length === 0) {
    tell(player, t("jm_at.adm.warp_none_remove"));
    return showWarpsAdmin(player);
  }
  const r = await showWarpPicker(player, {
    title: t("jm_at.adm.warp_remove_title"),
    body: t("jm_at.adm.warp_remove_body"),
    names,
    label: (n) => {
      const w = warps[n];
      const access = getWarpAccess(w);
      const tier =
        access !== WARP_ACCESS.PUBLIC
          ? t(
              access === WARP_ACCESS.ADMIN
                ? "jm_at.adm.warp_row_tier_admin"
                : "jm_at.adm.warp_row_tier_staff",
            )
          : "";
      return t("jm_at.adm.warp_remove_row", n, fmtDimRaw(w.dimension), tier);
    },
  });
  if (r.nav === "close") return; // Close
  if (r.item) {
    const conf = await new MessageFormData()
      .title(t("jm_at.adm.warp_remove_title"))
      .body(t("jm_at.adm.warp_remove_confirm_body", r.item))
      .button1(t("jm_at.common.btn_cancel"))
      .button2(t("jm_at.adm.gear_btn_remove"))
      .show(player);
    if (conf.canceled || conf.selection === 0) return _doRemoveWarpFlow(player);
    removeWarp(r.item);
    logAdmin(player, "WARP_REMOVE", r.item);
    tell(player, t("jm_at.adm.warp_removed", r.item));
  }
  return showWarpsAdmin(player);
}

async function _doSetWarpAccessFlow(player) {
  const warps = getWarps();
  const names = getSortedWarpNames(warps);
  if (names.length === 0) {
    tell(player, t("jm_at.adm.warp_none_configure"));
    return showWarpsAdmin(player);
  }
  // Step 1: pick a warp (button shows its current tier).
  const r = await showWarpPicker(player, {
    title: t("jm_at.adm.warp_setvis_title"),
    body: t("jm_at.adm.warp_setvis_body"),
    names,
    label: (n) => raw("§l", accessTag(getWarpAccess(warps[n])), " ", n),
  });
  if (r.nav === "close") return; // Close
  if (!r.item) return showWarpsAdmin(player); // Back

  // Step 2: choose the new tier.
  return showSetWarpAccessForm(player, r.item);
}

async function showSetWarpAccessForm(player, wName) {
  const warps = getWarps();
  if (!warps[wName]) return showWarpsAdmin(player);
  const current = getWarpAccess(warps[wName]);
  const accessObs = new ObservableNumber(
    Math.max(0, ACCESS_BY_INDEX.indexOf(current)),
    { clientWritable: true },
  );
  let pendingNav = null;

  const form = new CustomForm(player, t("jm_at.adm.warp_vis_title", wName));
  form.dropdown(t("jm_at.adm.warp_dd_who"), accessObs, [
    { label: t("jm_at.adm.warp_opt_public"), value: 0 },
    { label: t("jm_at.adm.warp_opt_staff"), value: 1 },
    { label: t("jm_at.adm.warp_opt_admin"), value: 2 },
  ]);
  form.spacer();
  const save = (close) => {
    const access = ACCESS_BY_INDEX[accessObs.getData()] ?? WARP_ACCESS.PUBLIC;
    pendingNav = () => {
      if (access !== current) {
        setWarpAccess(wName, access);
        logAdmin(player, "WARP_ACCESS", `${wName}: ${access}`);
        tell(player, t("jm_at.adm.warp_now_access", wName, accessTag(access)));
      }
      return close ? undefined : showWarpsAdmin(player);
    };
    try {
      form.close();
    } catch {}
  };
  form.button(t("jm_at.common.btn_save"), () => save(false));
  form.button(t("jm_at.cl.btn_save_close"), () => save(true));
  form.button(t("jm_at.common.btn_back"), () => {
    pendingNav = () => showWarpsAdmin(player);
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(() => showSetWarpAccessForm(player, wName));
  }
  if (pendingNav) return system.run(pendingNav);
  return; // ✕ / engine close / escape → exit to game
}

function _doToggleWarpsVisibilityFlow(player) {
  const cfg = getCfg();
  cfg.warpsVisible = !(cfg.warpsVisible !== false);
  setCfg(cfg);
  logAdmin(player, "WARPS_VISIBILITY", cfg.warpsVisible ? "Visible" : "Hidden");
  tell(
    player,
    t(
      cfg.warpsVisible
        ? "jm_at.adm.warp_vis_shown"
        : "jm_at.adm.warp_vis_hidden",
    ),
  );
  return showWarpsAdmin(player);
}

async function showWarpRules(player) {
  try { requireAdminOrModCan(player, "warps", "配置传送规则"); } catch { return; }
  const warps = getWarps();
  const names = getSortedWarpNames(warps);
  const pick = await showWarpPicker(player, {
    title: "传送点规则", body: "选择传送点，分别配置冷却、背包物品费用和游戏内开放时段。", names,
    label: (name) => name,
  });
  if (!pick.item) return pick.nav === "close" ? undefined : showWarpsAdmin(player);
  const name = pick.item;
  const destinationId = warps[name].destinationId;
  return showTravelRules(player, {
    kind: "warp",
    getDestination: () => {
      const current = getWarps()[name];
      return current?.destinationId === destinationId ? current : undefined;
    },
    saveRules: (rules) => {
      try { requireAdminOrModCan(player, "warps", "配置传送规则"); } catch { return false; }
      const latest = getWarps();
      if (!latest[name] || latest[name].destinationId !== destinationId) return false;
      latest[name].rules = rules;
      return setWarps(latest);
    },
  }, () => showWarpsAdmin(player));
}

async function showWarpsAdmin(player) {
  try {
    requireAdminOrModCan(player, "warps", "传送点管理");
  } catch {
    return;
  }
  const warps = getWarps();
  const names = getSortedWarpNames(warps);

  const cfg = getCfg();
  const staffOnlyCount = names.filter(
    (n) => getWarpAccess(warps[n]) === WARP_ACCESS.STAFF,
  ).length;
  const adminOnlyCount = names.filter(
    (n) => getWarpAccess(warps[n]) === WARP_ACCESS.ADMIN,
  ).length;
  const pinnedCount = names.filter((n) => warps[n].pinned).length;

  const actions = [
    {
      label: t("jm_at.adm.warp_btn_add"),
      icon: "textures/ui/jm_at_add",
      fn: () => _doAddWarpFlow(player),
    },
    {
      label: t("jm_at.adm.warp_btn_remove"),
      icon: "textures/ui/jm_at_remove",
      fn: () => _doRemoveWarpFlow(player),
    },
    {
      label: t("jm_at.adm.warp_btn_visibility"),
      icon: "textures/ui/jm_at_staff_toggle",
      fn: () => _doSetWarpAccessFlow(player),
    },
    {
      label: "§l传送规则（冷却 / 物品 / 时段）",
      icon: "textures/ui/jm_at_edit_menu",
      fn: () => showWarpRules(player),
    },
    {
      label: t("jm_at.adm.warp_btn_reorder"),
      icon: "textures/ui/jm_at_add_or_remove",
      fn: () => showWarpReorder(player),
    },
    {
      label: t(
        cfg.warpsVisible !== false
          ? "jm_at.adm.warp_btn_hide_menu"
          : "jm_at.adm.warp_btn_show_menu",
      ),
      icon: "textures/ui/jm_at_warps",
      fn: () => _doToggleWarpsVisibilityFlow(player),
    },
  ];

  const visYesNo = t(
    cfg.warpsVisible !== false ? "jm_at.adm.bc_yes" : "jm_at.adm.bc_no",
  );
  const bodyText = names.length
    ? t(
        "jm_at.adm.warp_admin_body",
        names.join("§r, §9"),
        staffOnlyCount,
        adminOnlyCount,
        pinnedCount,
        visYesNo,
      )
    : t("jm_at.adm.warp_admin_body_empty", visYesNo);

  const form = new ActionFormData()
    .title(t("jm_at.adm.warp_admin_title", names.length, MAX_WARPS_LIMIT))
    .body(bodyText);
  for (const a of actions) form.button(a.label, a.icon);
  form.button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back");
  form.button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showAdminPanel(player); // X = Back
  if (res.selection === actions.length) return showAdminPanel(player); // Back
  if (res.selection === actions.length + 1) return; // Close
  if (res.selection >= 0 && res.selection < actions.length)
    return actions[res.selection].fn();
}

async function showWarpReorder(player) {
  const warps = getWarps();
  const sorted = getSortedWarpNames(warps);

  if (sorted.length === 0) {
    tell(player, t("jm_at.adm.warp_none_reorder"));
    return showWarpsAdmin(player);
  }

  const bodyParts = [t("jm_at.adm.warp_reorder_intro")];
  for (let i = 0; i < sorted.length; i++) {
    const n = sorted[i];
    const w = warps[n];
    const tag = w.pinned
      ? t("jm_at.adm.warp_tag_pinned", w.order + 1)
      : t("jm_at.adm.warp_tag_unpinned");
    bodyParts.push(raw(tag, " §r", n, "\n"));
  }
  const body = raw(...bodyParts);

  const form = new ActionFormData()
    .title(t("jm_at.adm.warp_reorder_title"))
    .body(body)
    .button(t("jm_at.adm.warp_btn_pin_unpin"), "textures/ui/jm_at_warps")
    .button(t("jm_at.adm.warp_btn_move_up"), "textures/ui/jm_at_up")
    .button(t("jm_at.adm.warp_btn_move_down"), "textures/ui/jm_at_down")
    .button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back")
    .button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showWarpsAdmin(player); // X = Back
  if (res.selection === 3) return showWarpsAdmin(player); // Back
  if (res.selection === 4) return; // Close

  // Pin / Unpin
  if (res.selection === 0) {
    const r = await showWarpPicker(player, {
      title: t("jm_at.adm.warp_pin_title"),
      body: t("jm_at.adm.warp_pin_body"),
      names: sorted,
      label: (n) => {
        const w = warps[n];
        return w.pinned
          ? t("jm_at.adm.warp_pin_row_pinned", w.order + 1, n)
          : t("jm_at.adm.warp_pin_row_unpinned", n);
      },
    });
    if (r.nav === "close") return; // Close
    if (r.item) {
      const wName = r.item;
      const wasPinned = warps[wName].pinned ?? false;
      setWarpPinned(wName, !wasPinned);
      logAdmin(
        player,
        "WARP_PIN",
        `${wName}: ${!wasPinned ? "Pinned" : "Unpinned"}`,
      );
      tell(
        player,
        t(
          !wasPinned
            ? "jm_at.adm.warp_pinned_done"
            : "jm_at.adm.warp_unpinned_done",
          wName,
        ),
      );
    }
    return showWarpReorder(player);
  }

  // Move Up / Move Down
  // lang-keys: jm_at.adm.warp_move_title_up jm_at.adm.warp_move_title_down jm_at.adm.warp_move_body_up jm_at.adm.warp_move_body_down jm_at.adm.warp_moved_up jm_at.adm.warp_moved_down jm_at.adm.warp_cant_move_up jm_at.adm.warp_cant_move_down
  if (res.selection === 1 || res.selection === 2) {
    const direction = res.selection === 1 ? -1 : 1;
    const dirLabel = direction === -1 ? "Up" : "Down"; // stored log detail
    const dirKey = direction === -1 ? "up" : "down";
    const pinned = sorted.filter((n) => warps[n].pinned);
    if (pinned.length < 2) {
      return warnForm(player, t("jm_at.adm.warp_pin_two"), () =>
        showWarpReorder(player),
      );
    }
    const r = await showWarpPicker(player, {
      title: t(`jm_at.adm.warp_move_title_${dirKey}`),
      body: t(`jm_at.adm.warp_move_body_${dirKey}`),
      names: pinned,
      label: (n) => t("jm_at.adm.warp_move_row", warps[n].order + 1, n),
    });
    if (r.nav === "close") return; // Close
    if (r.item) {
      const wName = r.item;
      if (moveWarp(wName, direction)) {
        logAdmin(player, "WARP_REORDER", `${wName}：移动 ${dirLabel}`);
        tell(player, t(`jm_at.adm.warp_moved_${dirKey}`, wName));
      } else {
        return warnForm(
          player,
          t(`jm_at.adm.warp_cant_move_${dirKey}`, wName),
          () => showWarpReorder(player),
        );
      }
    }
    return showWarpReorder(player);
  }
}

// =========================================================
// Item Watch
// =========================================================

async function showItemWatch(player) {
  try {
    requireAdminOrModCan(player, "itemWatch", "物品监控");
  } catch {
    return;
  }
  const cfg = getItemWatchCfg();
  const tracked = cfg.tracked ?? {};
  const trackedCount = Object.keys(tracked).length;
  const banned = cfg.banned ?? [];

  const form = new ActionFormData()
    .title(t("jm_at.adm.idx_item_watch"))
    .body(t("jm_at.adm.iw_body", banned.length, trackedCount))
    .button(t("jm_at.adm.iw_btn_banned"), "textures/ui/jm_at_ban")
    .button(
      t("jm_at.adm.iw_btn_tracked", trackedCount),
      "textures/ui/jm_at_item_watch",
    )
    .button(t("jm_at.adm.iw_btn_log"), "textures/ui/jm_at_action_log")
    .button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back")
    .button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showControlPanel(player); // X = Back
  if (res.selection === 0) return showBannedItems(player);
  if (res.selection === 1) return showTrackedItems(player);
  if (res.selection === 2) return showItemWatchLog(player);
  if (res.selection === 3) return showControlPanel(player); // Back
  // selection === 4 → Close
}

// =========================================================
// Tracked Items (sub-page of Item Watch)
// =========================================================

async function showTrackedItems(player) {
  try {
    requireAdminOrModCan(player, "itemWatch", "受监控物品");
  } catch {
    return;
  }
  const cfg = getItemWatchCfg();
  const tracked = cfg.tracked ?? {};
  const keys = Object.keys(tracked);

  const list =
    keys.length > 0
      ? raw(
          ...keys.flatMap((id, i) => {
            const row = t(
              "jm_at.adm.ti_row",
              id.replace("minecraft:", ""),
              tracked[id],
            );
            return i ? ["\n", row] : [row];
          }),
        )
      : t("jm_at.adm.ti_none");

  const form = new ActionFormData()
    .title(t("jm_at.adm.ti_title", keys.length))
    .body(t("jm_at.adm.ti_body", list))
    .button(t("jm_at.adm.ti_btn_add"), "textures/ui/jm_at_add")
    .button(t("jm_at.adm.ti_btn_remove"), "textures/ui/jm_at_remove")
    .button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back")
    .button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showItemWatch(player); // X = Back
  if (res.selection === 2) return showItemWatch(player); // Back
  if (res.selection === 3) return; // Close

  if (res.selection === 0) return showAddTrackedItemForm(player);

  if (res.selection === 1) {
    if (keys.length === 0) {
      tell(player, t("jm_at.adm.ti_none_remove"));
      return showTrackedItems(player);
    }
    const pick = new ActionFormData()
      .title(t("jm_at.adm.ti_remove_title"))
      .body(t("jm_at.adm.ti_remove_body"));
    for (const k of keys)
      pick.button(
        t("jm_at.adm.ti_remove_row", k.replace("minecraft:", ""), tracked[k]),
      );
    pick.button(t("jm_at.common.btn_back_bold"));
    pick.button(CLOSE_BTN_LABEL);
    const pr = await pick.show(player);
    if (pr.selection === keys.length + 1) return; // Close
    if (!pr.canceled && pr.selection < keys.length) {
      const removed = keys[pr.selection];
      delete tracked[removed];
      cfg.tracked = tracked;
      setItemWatchCfg(cfg);
      logAdmin(player, "ITEM_WATCH_REMOVE", removed);
      tell(player, t("jm_at.adm.ti_removed", removed));
    }
    return showTrackedItems(player);
  }
}

async function showAddTrackedItemForm(player) {
  const idObs = new ObservableString("minecraft:", { clientWritable: true });
  const qtyObs = new ObservableString("64", { clientWritable: true });
  const status = new ObservableString("");
  const statusShown = new ObservableBoolean(false);
  let pendingNav = null;
  const fail = (m) => {
    status.setData(m);
    statusShown.setData(true);
  };

  const form = new CustomForm(player, t("jm_at.adm.ti_add_title"));
  form.textField(t("jm_at.adm.ti_field_id"), idObs, {
    description: t("jm_at.adm.iw_field_id_desc"),
  });
  form.textField(t("jm_at.adm.ti_field_qty"), qtyObs, {
    description: t("jm_at.adm.ti_field_qty_desc"),
  });
  form.spacer();
  form.label(status, { visible: statusShown });
  form.spacer({ visible: statusShown });
  const submit = (close) => {
    const itemId = clampText(idObs.getData().trim(), 80).toLowerCase();
    if (!/^[a-z0-9_.-]+:[a-z0-9_.-]+$/.test(itemId)) {
      fail("§c请输入完整物品ID，例如 minecraft:diamond（命名空间:物品）。");
      return;
    }
    const rawQty = parseInt(qtyObs.getData(), 10);
    if (isNaN(rawQty)) {
      fail("§c数量必须为整数。");
      return;
    }
    const qty = Math.max(1, Math.min(9999, rawQty));
    pendingNav = () => {
      const cfg = getItemWatchCfg();
      const tracked = cfg.tracked ?? {};
      tracked[itemId] = qty;
      cfg.tracked = tracked;
      setItemWatchCfg(cfg);
      logAdmin(player, "ITEM_WATCH_ADD", `${itemId} ≥ ${qty}`);
      tell(player, t("jm_at.adm.ti_added", itemId, qty));
      return close ? undefined : showTrackedItems(player);
    };
    try {
      form.close();
    } catch {}
  };
  form.button(t("jm_at.adm.btn_add"), () => submit(false));
  form.button(t("jm_at.adm.btn_add_close"), () => submit(true));
  form.button(t("jm_at.common.btn_back"), () => {
    pendingNav = () => showTrackedItems(player);
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(() => showAddTrackedItemForm(player));
  }
  if (pendingNav) return system.run(pendingNav);
  return; // ✕ / engine close / escape → exit to game
}

async function showAddBannedItemForm(player) {
  const idObs = new ObservableString("minecraft:", { clientWritable: true });
  const status = new ObservableString("");
  const statusShown = new ObservableBoolean(false);
  let pendingNav = null;
  const fail = (m) => {
    status.setData(m);
    statusShown.setData(true);
  };

  const form = new CustomForm(player, t("jm_at.adm.bi_add_title"));
  form.textField(t("jm_at.adm.bi_field_id"), idObs, {
    description: t("jm_at.adm.iw_field_id_desc"),
  });
  form.spacer();
  form.label(status, { visible: statusShown });
  form.spacer({ visible: statusShown });
  const submit = (close) => {
    const itemId = clampText(idObs.getData().trim(), 80).toLowerCase();
    if (!/^[a-z0-9_.-]+:[a-z0-9_.-]+$/.test(itemId)) {
      fail("§c请输入完整物品ID，例如 minecraft:tnt（命名空间:物品）。");
      return;
    }
    if (getBanned().includes(itemId)) {
      fail("§e该物品已被禁用。");
      return;
    }
    pendingNav = () => {
      setBanned([...getBanned(), itemId]);
      logAdmin(player, "BANNED_ITEM_ADD", itemId);
      tell(player, t("jm_at.adm.bi_added", itemId));
      return close ? undefined : showBannedItems(player);
    };
    try {
      form.close();
    } catch {}
  };
  form.button(t("jm_at.adm.btn_add"), () => submit(false));
  form.button(t("jm_at.adm.btn_add_close"), () => submit(true));
  form.button(t("jm_at.common.btn_back"), () => {
    pendingNav = () => showBannedItems(player);
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(() => showAddBannedItemForm(player));
  }
  if (pendingNav) return system.run(pendingNav);
  return; // ✕ / engine close / escape → exit to game
}

async function showBannedItems(player) {
  try {
    requireAdminOrModCan(player, "itemWatch", "禁用物品");
  } catch {
    return;
  }
  const banned = getBanned();

  const body =
    banned.length > 0
      ? raw(
          ...banned.flatMap((id, i) => {
            const row = t("jm_at.adm.bi_row", id.replace("minecraft:", ""));
            return i ? ["\n", row] : [row];
          }),
        )
      : t("jm_at.adm.bi_none");

  const form = new ActionFormData()
    .title(t("jm_at.adm.bi_title", banned.length))
    .body(body)
    .button(t("jm_at.adm.bi_btn_add"), "textures/ui/jm_at_add_banned")
    .button(t("jm_at.adm.bi_btn_remove"), "textures/ui/jm_at_remove")
    .button(t("jm_at.adm.btn_back_r"), "textures/ui/jm_at_back")
    .button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showItemWatch(player); // X = Back
  if (res.selection === 2) return showItemWatch(player); // Back
  if (res.selection === 3) return; // Close

  if (res.selection === 0) return showAddBannedItemForm(player);

  if (res.selection === 1) {
    if (banned.length === 0) {
      tell(player, t("jm_at.adm.bi_none_remove"));
      return showBannedItems(player);
    }
    const pick = new ActionFormData()
      .title(t("jm_at.adm.bi_remove_title"))
      .body(t("jm_at.adm.bi_remove_body"));
    for (const id of banned)
      pick.button(raw("§l§c", id.replace("minecraft:", "")));
    pick.button(t("jm_at.common.btn_back_bold"));
    pick.button(CLOSE_BTN_LABEL);
    const pr = await pick.show(player);
    if (pr.selection === banned.length + 1) return; // Close
    if (!pr.canceled && pr.selection < banned.length) {
      const removed = banned[pr.selection];
      setBanned(banned.filter((id) => id !== removed));
      logAdmin(player, "BANNED_ITEM_REMOVE", removed);
      tell(player, t("jm_at.adm.bi_removed", removed));
    }
    return showBannedItems(player);
  }
}

// =========================================================
// Item Watch Log
// =========================================================

const ITEM_WATCH_ACTIONS = new Set([
  "BANNED_ITEM_DETECTED",
  "ITEM_ALERT",
  "ITEM_WATCH_ADD",
  "ITEM_WATCH_REMOVE",
  "BANNED_ITEM_ADD",
  "BANNED_ITEM_REMOVE",
]);

async function showItemWatchLog(player, page = 0) {
  try {
    requireAdminOrModCan(player, "itemWatch", "物品监控日志");
  } catch {
    return;
  }

  const allEntries = getAllLogEntries();
  allEntries.sort((a, b) => b.at - a.at);

  const filtered = allEntries.filter((e) => ITEM_WATCH_ACTIONS.has(e.action));

  const PAGE_SIZE = 15;
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const hasPrev = safePage > 0;
  const hasMore = (safePage + 1) * PAGE_SIZE < filtered.length;
  const shown = filtered.slice(
    safePage * PAGE_SIZE,
    (safePage + 1) * PAGE_SIZE,
  );

  const lines = shown.length
    ? raw(
        ...shown.flatMap((e, i) => {
          const isSys = (e.source ?? "admin") === "system";
          const row = raw(
            "§r",
            fmtMsRaw(e.at),
            " ",
            t(isSys ? "jm_at.adm.iwl_src_sys" : "jm_at.adm.iwl_src_adm"),
            "§9",
            logActionLabel(e.action),
            "§r",
            ...(e.targetName
              ? [t("jm_at.adm.iwl_target_arrow", e.targetName)]
              : []),
            ...(e.detail ? [" §8", e.detail] : []),
          );
          return i ? ["\n", row] : [row];
        }),
      )
    : t("jm_at.adm.iwl_empty");

  const pageLabel =
    totalPages > 1
      ? raw("\n", t("jm_at.adm.iwl_page", safePage + 1, totalPages))
      : "";

  const navBtns = [];
  if (hasPrev)
    navBtns.push({
      label: t("jm_at.common.btn_prev_page_plain", safePage),
      icon: "textures/ui/jm_at_back",
      key: "prev",
    });
  if (hasMore)
    navBtns.push({
      label: t("jm_at.common.btn_next_page_plain", safePage + 2),
      icon: "textures/ui/jm_at_next",
      key: "next",
    });

  const form = new ActionFormData()
    .title(t("jm_at.adm.iwl_title", filtered.length))
    .body(raw(lines, pageLabel));
  for (const b of navBtns) form.button(b.label, b.icon);
  form.button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back");
  form.button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const backIdx = navBtns.length;
  const closeIdx = backIdx + 1;

  const res = await form.show(player);
  if (res.canceled) return showItemWatch(player); // X = Back
  if (res.selection === backIdx) return showItemWatch(player); // Back
  if (res.selection === closeIdx) return; // Close

  const nav = navBtns[res.selection];
  if (nav?.key === "prev") return showItemWatchLog(player, safePage - 1);
  if (nav?.key === "next") return showItemWatchLog(player, safePage + 1);
}

// =========================================================
// Rank Manager (hub)
// =========================================================

function stripRankFromPlayers(tag) {
  let count = 0;
  for (const p of world.getPlayers()) {
    const core = getPlayerCore(p);
    if ((core.rankTag ?? "").trim() === tag) {
      core.rankTag = "";
      core.rankSetManually = false;
      setPlayerCore(p, core);
      count++;
    }
  }
  const reg = getPlayerRegistry();
  const onlineXuids = new Set(world.getPlayers().map((p) => getPlayerXuid(p)));
  for (const entry of Object.values(reg)) {
    if (onlineXuids.has(entry.xuid)) continue;
    if ((entry.rankTag ?? "").trim() === tag) {
      entry.rankTag = "";
      // Leave rankTagEnabled untouched — removing a rank must not override the
      // player's "hide my tag" preference (matches the online branch above).
      entry.rankSetManually = false;
      count++;
    }
  }
  setPlayerRegistry(reg);
  return count;
}

function stripRankFromSelected(tag, selected) {
  const targetXuids = new Set(selected.map((e) => e.xuid));
  let count = 0;
  for (const p of world.getPlayers()) {
    if (!targetXuids.has(getPlayerXuid(p))) continue;
    const core = getPlayerCore(p);
    if ((core.rankTag ?? "").trim() === tag) {
      core.rankTag = "";
      core.rankSetManually = false;
      setPlayerCore(p, core);
      targetXuids.delete(getPlayerXuid(p));
      count++;
    }
  }
  if (targetXuids.size > 0) {
    const reg = getPlayerRegistry();
    for (const entry of Object.values(reg)) {
      if (!targetXuids.has(entry.xuid)) continue;
      if ((entry.rankTag ?? "").trim() === tag) {
        entry.rankTag = "";
        // Leave rankTagEnabled untouched — removing a rank must not override the
        // player's "hide my tag" preference (matches the online branch above).
        entry.rankSetManually = false;
        count++;
      }
    }
    setPlayerRegistry(reg);
  }
  return count;
}

async function showRankManager(player) {
  try {
    requireAdminOrModCan(player, "rankManager", "身份组管理器");
  } catch {
    return;
  }
  const db = getRankDb();
  const count = Object.keys(db).length;
  const cfg = getCfg();

  const form = new ActionFormData()
    .title(t("jm_at.adm.idx_rank_manager"))
    .body(
      t(
        "jm_at.adm.rm_body",
        count,
        LIMITS.RANK_DB_MAX,
        cfg.staffAdminTag || t("jm_at.adm.tag_admin"),
        cfg.staffModTag || t("jm_at.adm.rm_tag_mod_default"),
        t(cfg.staffRanksHidden ? "jm_at.adm.rm_yes" : "jm_at.adm.rm_no"),
        t(
          cfg.staffCustomRanks
            ? "jm_at.adm.rm_enabled"
            : "jm_at.adm.rm_disabled",
        ),
      ),
    )
    .button(t("jm_at.adm.rm_btn_database"), "textures/ui/jm_at_rank_database")
    .button(t("jm_at.adm.rm_btn_bulk_assign"), "textures/ui/jm_at_bulk_add")
    .button(t("jm_at.adm.rm_btn_bulk_remove"), "textures/ui/jm_at_bulk_remove")
    .button(t("jm_at.adm.rm_btn_staff_settings"), "textures/ui/jm_at_moderator")
    .button(
      t(
        "jm_at.adm.rm_btn_playtime",
        t(
          cfg.playtimeRanksEnabled
            ? "jm_at.adm.rm_enabled"
            : "jm_at.adm.rm_disabled",
        ),
      ),
      "textures/ui/jm_at_playtime_ranks",
    )
    .button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back")
    .button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showPlayersMenu(player); // X = Back
  if (res.selection === 5) return showPlayersMenu(player); // Back
  if (res.selection === 6) return; // Close
  if (res.selection === 0) return showRankDatabase(player);
  if (res.selection === 1) return showBulkAssignPickRank(player);
  if (res.selection === 2) return showBulkRemoveRank(player);
  if (res.selection === 3) return showStaffRankSettings(player);
  if (res.selection === 4) return showPlaytimeRanks(player);
}

// =========================================================
// Rank Database (CRUD)
// =========================================================

async function showRankDatabase(player) {
  try {
    requireAdminOrModCan(player, "rankManager", "身份组数据库");
  } catch {
    return;
  }
  const db = getRankDb();
  const names = getRankNames();

  const form = new ActionFormData()
    .title(t("jm_at.adm.rk_db_title", names.length, LIMITS.RANK_DB_MAX))
    .body(
      names.length
        ? t("jm_at.adm.rk_db_body", names.join("§r, §9"))
        : t("jm_at.adm.rk_db_body_empty"),
    );

  form.button(t("jm_at.adm.rk_btn_add"), "textures/ui/jm_at_add");
  for (const name of names) {
    form.button(
      t("jm_at.adm.rk_db_row", name, db[name].tag),
      "textures/ui/jm_at_search",
    );
  }
  form.button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back");
  form.button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showRankManager(player); // X = Back
  if (res.selection === names.length + 1) return showRankManager(player); // Back
  if (res.selection === names.length + 2) return; // Close
  if (res.selection === 0) return showAddRank(player);
  return showRankDetail(player, names[res.selection - 1]);
}

// =========================================================
// Rank tag composer — live preview hub shared by Add Rank, Edit Tag, and the
// per-player custom rank flow. Modals can't preview while you type, so the tag
// is built on this screen with a button per part (name / color / text).
// =========================================================

/** Render a tag exactly as the game shows it, above a sample player name. */
function rankTagPreview(colorIdx, tagText) {
  const text = String(tagText ?? "").trim();
  if (!text) return "§7（尚未输入标签文本）";
  const tag = buildRankTag(RANK_COLORS[colorIdx]?.code ?? "", text);
  return `${tag}§r §7示例玩家`;
}

function reopenRankComposer(player, ctx) {
  return system.run(() => showRankComposer(player, ctx));
}

function rankComposerBack(player, ctx) {
  if (ctx.mode === "dbEdit") return showRankDetail(player, ctx.rankName);
  if (ctx.mode === "playerCustom")
    return showRankPanel(player, ctx.target, ctx.backFn);
  return showRankDatabase(player);
}

// DDUI (CustomForm) version: one reactive screen. The color dropdown and the
// tag-text field write to Observables; the preview label recomputes live as the
// player edits, so there's no close-and-reopen on every change like the old
// ActionForm composer needed. commitRank stays the persistence authority.
async function showRankComposer(player, ctx, draft = null) {
  const title =
    ctx.mode === "dbEdit"
      ? t("jm_at.adm.rk_title_edit", ctx.rankName)
      : ctx.mode === "playerCustom"
        ? t("jm_at.adm.rk_title_set", ctx.target?.name ?? "")
        : t("jm_at.adm.rk_title_add");

  // Reactive state. Client-writable controls feed these; preview/status are
  // server-driven labels we update from subscriptions. Seed from `draft` (the
  // in-progress edits preserved across a Keep-editing reopen) when present,
  // otherwise from ctx (the original loaded values).
  const src = draft ?? ctx;
  const colorIdx = new ObservableNumber(src.colorIdx ?? 0, {
    clientWritable: true,
  });
  const tagText = new ObservableString(src.tagText ?? "", {
    clientWritable: true,
  });
  const name = new ObservableString(src.name ?? "", { clientWritable: true });
  const preview = new ObservableString(
    rankTagPreview(src.colorIdx ?? 0, src.tagText ?? ""),
  );
  const status = new ObservableString("");
  const statusShown = new ObservableBoolean(false); // hide the line until needed
  // Live color swatch for the current pick (labels DO parse §). An ObservableString
  // can't carry a RawMessage, so this stays language-neutral — the translated color
  // NAME is shown by the dropdown control itself. "无颜色（手动设置）" → a neutral dash.
  const selColorText = (i) => {
    const c = RANK_COLORS[i];
    return c && c.code ? c.code + "██████§r" : "§8▬▬▬▬▬▬";
  };
  const colorPick = new ObservableString(selColorText(src.colorIdx ?? 0));

  const refresh = () => {
    preview.setData(rankTagPreview(colorIdx.getData(), tagText.getData()));
    colorPick.setData(selColorText(colorIdx.getData()));
    status.setData(""); // clear stale validation message on any edit
    statusShown.setData(false);
  };
  tagText.subscribe(refresh);
  colorIdx.subscribe(refresh);

  // Translated color names. The color_* lang values are now §-free (color comes
  // from RANK_COLORS[].code), so dropdown items render the translated name with no
  // literal § — dropdown items can't be colored anyway, and the live swatch shows
  // the actual color.
  const colorItems = RANK_COLORS.map((c, i) => ({
    label: t(c.labelKey),
    value: i,
  }));

  // Dirty-check so closing or backing out only prompts when something changed.
  // Baseline is the ORIGINAL loaded values (ctx), NOT the draft-seeded form
  // state — so a preserved-then-reopened edit still reads as dirty and re-warns.
  const snapshot = () =>
    JSON.stringify([colorIdx.getData(), tagText.getData(), name.getData()]);
  const initial = JSON.stringify([
    ctx.colorIdx ?? 0,
    ctx.tagText ?? "",
    ctx.name ?? "",
  ]);
  let pendingNav = null; // runs after the form closes (Save / Save & Close)
  let intent = null; // "back" set by Back; null = ✕/engine close/escape → exit

  const form = new CustomForm(player, title);
  form.header(t("jm_at.adm.rk_header_preview"));
  form.spacer();
  form.label(preview); // live-updates above a sample player name
  form.spacer();
  if (ctx.mode === "dbAdd") {
    form.textField(t("jm_at.adm.rk_field_name"), name, {
      description: t("jm_at.adm.rk_field_name_desc"),
    });
  }
  form.dropdown(t("jm_at.adm.rk_dd_color"), colorIdx, colorItems);
  form.spacer();
  form.label(colorPick); // live: current color shown in its own color
  form.spacer();
  form.textField(t("jm_at.adm.rk_field_tag"), tagText, {
    description: t("jm_at.adm.rk_field_tag_desc"),
  });
  form.spacer();
  form.label(status, { visible: statusShown }); // shown only when there's a message
  form.spacer({ visible: statusShown }); // padding below the message when present

  const doSave = (close) => {
    ctx.colorIdx = colorIdx.getData();
    ctx.tagText = tagText.getData().trim();
    if (ctx.mode === "dbAdd") {
      ctx.name = name.getData().trim().substring(0, LIMITS.RANK_NAME_MAX);
    }
    if (!ctx.tagText) {
      status.setData("§c请先输入标签文本。"); // stay open, live error
      statusShown.setData(true);
      return;
    }
    // commitRank validates the rest (name format, duplicates) and navigates;
    // its failure paths reopen this composer via reopenRankComposer. `close`
    // makes the success path exit to game instead of opening the follow-on page.
    pendingNav = () => commitRank(player, ctx, close);
    try {
      form.close();
    } catch {}
  };
  form.button(t("jm_at.common.btn_save"), () => doSave(false));
  form.button(t("jm_at.cl.btn_save_close"), () => doSave(true));
  form.button(t("jm_at.common.btn_back"), () => {
    intent = "back";
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  // Current field state (edits, or the seeded draft if the show bounced). Built
  // before the UserBusy check so a bounce on a preserved-edit reopen keeps them.
  const keep = {
    colorIdx: colorIdx.getData(),
    tagText: tagText.getData(),
    name: name.getData(),
  };
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(() => showRankComposer(player, ctx, keep)); // another UI was up; retry
  }
  if (pendingNav) return system.run(pendingNav);

  // Back → previous menu; the engine close (bottom Close / corner ✕) and escape
  // → exit to game. Either way, if the tag was edited, confirm first — Keep
  // editing reopens with the edits intact (via `keep`, leaving ctx as the
  // original baseline so it still re-warns); Discard then backs out (Back) or
  // drops to the game (✕). Exit-without-discard is "Save & Close".
  const goBack = intent === "back";
  if (snapshot() !== initial) {
    return system.run(async () => {
      if (await confirmDiscardChanges(player))
        return showRankComposer(player, ctx, keep);
      if (goBack) return rankComposerBack(player, ctx);
    });
  }
  if (goBack) return system.run(() => rankComposerBack(player, ctx));
}

async function commitRank(player, ctx, close = false) {
  const text = String(ctx.tagText ?? "").trim();
  if (!text) {
    return warnForm(player, t("jm_at.adm.rk_need_text"), () =>
      reopenRankComposer(player, ctx),
    );
  }
  const tag = buildRankTag(
    RANK_COLORS[ctx.colorIdx]?.code ?? "",
    clampText(text, LIMITS.RANK_TAG_MAX),
  );

  if (ctx.mode === "dbAdd") {
    const name = String(ctx.name ?? "")
      .trim()
      .substring(0, LIMITS.RANK_NAME_MAX);
    if (!name || !/^[A-Za-z0-9_ ]+$/.test(name)) {
      return warnForm(player, t("jm_at.adm.rk_bad_name"), () =>
        reopenRankComposer(player, ctx),
      );
    }
    if (!addRank(name, tag)) {
      return warnForm(player, t("jm_at.adm.rk_dupe", name), () =>
        reopenRankComposer(player, ctx),
      );
    }
    logAdmin(player, "RANK_DB_ADD", `${name}: ${tag}`);
    tell(player, t("jm_at.adm.rk_added", name, tag));
    return close ? undefined : showRankDatabase(player);
  }

  if (ctx.mode === "dbEdit") {
    updateRank(ctx.rankName, tag);
    logAdmin(player, "RANK_DB_EDIT", `${ctx.rankName}: ${tag}`);
    tell(player, t("jm_at.adm.rk_tag_updated", tag));
    return close ? undefined : showRankDetail(player, ctx.rankName);
  }

  // playerCustom — mirrors the previous per-player save (incl. role grant).
  const target = ctx.target;
  const role = detectRankRole(text, tag);
  if (role) {
    if (!canManageRoles(player)) {
      return warnForm(player, t("jm_at.adm.rankp_role_requires_manage"), () =>
        showRankPanel(player, target, ctx.backFn),
      );
    }
    const ok = await confirmRankRoleGrant(player, target, role);
    if (!ok) return showRankPanel(player, target, ctx.backFn);
    const granted = grantRoleFromRank(player, target, role);
    tell(
      player,
      granted
        ? t(
            role === "admin"
              ? "jm_at.adm.admin_assigned_admin"
              : "jm_at.adm.mod_assigned_admin",
            target.name,
          )
        : t("jm_at.adm.rankp_grant_failed", role, target.name),
    );
    return close ? undefined : showRankPanel(player, target, ctx.backFn);
  }
  const freshCore = getPlayerCore(target);
  freshCore.rankTag = tag;
  freshCore.rankTagEnabled = true; // auto-show when a rank is set
  freshCore.rankSetManually = true;
  setPlayerCore(target, freshCore);
  logAdmin(player, "RANK_SET", `${target.name}: ${tag}`);
  tell(player, t("jm_at.adm.rankp_set_done", tag, target.name));
  tell(target, t("jm_at.adm.rankp_set_target", tag));
  return close ? undefined : showRankPanel(player, target, ctx.backFn);
}

async function showAddRank(player) {
  try {
    requireAdminOrModCan(player, "rankManager", "添加身份组");
  } catch {
    return;
  }
  if (Object.keys(getRankDb()).length >= LIMITS.RANK_DB_MAX) {
    return warnForm(player, t("jm_at.adm.rk_limit", LIMITS.RANK_DB_MAX), () =>
      showRankDatabase(player),
    );
  }
  return showRankComposer(player, {
    mode: "dbAdd",
    name: "",
    colorIdx: RANK_COLOR_MANUAL_IDX,
    tagText: "",
  });
}

async function showRankDetail(player, rankName) {
  const db = getRankDb();
  const rank = db[rankName];
  if (!rank) {
    return warnForm(player, t("jm_at.adm.rk_not_found"), () =>
      showRankDatabase(player),
    );
  }

  const form = new ActionFormData()
    .title(t("jm_at.adm.rankp_title", rankName))
    .body(t("jm_at.adm.rk_detail_body", rank.tag))
    .button(t("jm_at.adm.rk_btn_edit_tag"), "textures/ui/jm_at_edit_tag")
    .button(t("jm_at.adm.rk_btn_delete"), "textures/ui/jm_at_remove")
    .button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back")
    .button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showRankDatabase(player); // X = Back
  if (res.selection === 2) return showRankDatabase(player); // Back
  if (res.selection === 3) return; // Close
  if (res.selection === 0) return showEditRankTag(player, rankName);
  if (res.selection === 1) return showConfirmDeleteRank(player, rankName);
}

async function showEditRankTag(player, rankName) {
  try {
    requireAdminOrModCan(player, "rankManager", "编辑身份组");
  } catch {
    return;
  }
  const db = getRankDb();
  const rank = db[rankName];
  if (!rank) return showRankDatabase(player);

  return showRankComposer(player, {
    mode: "dbEdit",
    rankName,
    colorIdx: detectRankColor(rank.tag),
    tagText: stripColorCode(rank.tag),
  });
}

async function showConfirmDeleteRank(player, rankName) {
  const tag = getRankDb()[rankName]?.tag ?? "";
  const stripObs = new ObservableBoolean(false, { clientWritable: true });
  let pendingNav = null;

  const form = new CustomForm(player, t("jm_at.adm.rk_delete_title", rankName));
  form.label(t("jm_at.adm.rk_delete_q", rankName));
  if (tag) {
    form.spacer();
    form.label(t("jm_at.adm.rk_current_tag", tag));
  }
  form.spacer();
  form.toggle(t("jm_at.adm.rk_toggle_strip"), stripObs);
  form.spacer();
  form.button(t("jm_at.adm.btn_delete_plain"), () => {
    const stripPlayers = stripObs.getData();
    pendingNav = () => {
      removeRank(rankName);
      let detail = rankName;
      let stripped = 0;
      if (stripPlayers && tag) {
        stripped = stripRankFromPlayers(tag);
        detail += `（已从 ${stripped} 名玩家移除）`;
      }
      logAdmin(player, "RANK_DB_REMOVE", detail);
      tell(
        player,
        t(
          "jm_at.adm.rk_deleted",
          rankName,
          stripPlayers && tag
            ? t("jm_at.adm.rk_deleted_stripped", stripped)
            : "",
        ),
      );
      return showRankDatabase(player);
    };
    try {
      form.close();
    } catch {}
  });
  form.button(t("jm_at.common.btn_back"), () => {
    pendingNav = () => showRankDetail(player, rankName);
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(() => showConfirmDeleteRank(player, rankName));
  }
  if (pendingNav) return system.run(pendingNav);
  return; // ✕ / engine close / escape → exit to game
}

// =========================================================
// Bulk Remove
// =========================================================

function getPlayersWithTag(tag) {
  const matches = [];
  const onlineXuids = new Set();
  for (const p of world.getPlayers()) {
    const xuid = getPlayerXuid(p);
    onlineXuids.add(xuid);
    if ((getPlayerCore(p).rankTag ?? "").trim() === tag) {
      matches.push({ xuid, name: p.name });
    }
  }
  const reg = getPlayerRegistry();
  for (const entry of Object.values(reg)) {
    if (onlineXuids.has(entry.xuid)) continue;
    if ((entry.rankTag ?? "").trim() === tag) {
      matches.push({ xuid: entry.xuid, name: entry.name ?? entry.xuid });
    }
  }
  return matches.sort((a, b) => a.name.localeCompare(b.name));
}

/** Distinct rank tags currently in use, with how many players have each. */
function getRankTagsInUse() {
  const counts = new Map();
  const onlineXuids = new Set();
  for (const p of world.getPlayers()) {
    onlineXuids.add(getPlayerXuid(p));
    const tag = (getPlayerCore(p).rankTag ?? "").trim();
    if (tag) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  const reg = getPlayerRegistry();
  for (const entry of Object.values(reg)) {
    if (onlineXuids.has(entry.xuid)) continue;
    const tag = (entry.rankTag ?? "").trim();
    if (tag) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => stripColorCode(a.tag).localeCompare(stripColorCode(b.tag)));
}

async function showBulkRemoveRank(player) {
  try {
    requireAdminOrModCan(player, "rankManager", "批量移除身份组");
  } catch {
    return;
  }
  const form = new ActionFormData()
    .title(t("jm_at.adm.br_title"))
    .body(t("jm_at.adm.br_body"))
    .button(t("jm_at.adm.br_btn_by_tag"), "textures/ui/jm_at_remove")
    .button(t("jm_at.adm.br_btn_clear"), "textures/ui/jm_at_remove")
    .button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back")
    .button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showRankManager(player); // X = Back
  if (res.selection === 2) return showRankManager(player); // Back
  if (res.selection === 3) return; // Close
  if (res.selection === 0) return showBulkRemoveByTag(player);
  if (res.selection === 1) return showBulkAssignPickPlayers(player, null, 0);
}

async function showBulkRemoveByTag(player, filter = "") {
  const all = getRankTagsInUse();
  const f = filter.trim().toLowerCase();
  const tags = f
    ? all.filter((tg) => stripColorCode(tg.tag).toLowerCase().includes(f))
    : all;

  const form = new ActionFormData().title(t("jm_at.adm.br_bytag_title"));
  if (all.length === 0) {
    form.body(t("jm_at.adm.br_no_tags"));
  } else {
    form.body(
      raw(
        t("jm_at.adm.br_bytag_body"),
        ...(filter ? [t("jm_at.adm.br_filter_line", filter)] : []),
        ...(tags.length === 0 ? [t("jm_at.adm.br_no_filter_match")] : []),
      ),
    );
  }

  form.button(
    filter
      ? t("jm_at.adm.br_btn_filter_set", filter)
      : t("jm_at.adm.br_btn_filter"),
    "textures/ui/jm_at_search_info",
  );
  if (f)
    form.button(
      t("jm_at.adm.br_btn_clear_filter"),
      "textures/ui/jm_at_search_again",
    );

  for (const { tag, count } of tags) {
    form.button(
      t(
        count === 1 ? "jm_at.adm.br_tag_row_one" : "jm_at.adm.br_tag_row",
        tag,
        count,
      ),
    );
  }
  form.button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back");
  form.button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showBulkRemoveRank(player); // X = Back

  let idx = 0;
  const filterIdx = idx++;
  const clearIdx = f ? idx++ : -1;
  const tagStart = idx;
  const tagEnd = tagStart + tags.length;

  if (res.selection === filterIdx)
    return showBulkRemoveTagFilter(player, filter);
  if (f && res.selection === clearIdx) return showBulkRemoveByTag(player, "");
  if (res.selection >= tagStart && res.selection < tagEnd) {
    const chosen = tags[res.selection - tagStart];
    const matches = getPlayersWithTag(chosen.tag);
    if (matches.length === 0) {
      return warnForm(player, t("jm_at.adm.br_tag_gone"), () =>
        showBulkRemoveByTag(player, filter),
      );
    }
    return showBulkRemoveMode(player, chosen.tag, matches);
  }
  if (res.selection === tagEnd) return showBulkRemoveRank(player); // Back
  return; // Close
}

async function showBulkRemoveTagFilter(player, current) {
  const textObs = new ObservableString(current ?? "", { clientWritable: true });
  let pendingNav = null;

  const form = new CustomForm(player, t("jm_at.adm.br_filter_title"));
  form.textField(t("jm_at.adm.br_filter_field"), textObs, {
    description: t("jm_at.adm.br_filter_field_desc"),
  });
  form.spacer();
  form.button(t("jm_at.cla.btn_apply"), () => {
    const f = clampText(textObs.getData().trim(), 30);
    pendingNav = () => showBulkRemoveByTag(player, f);
    try {
      form.close();
    } catch {}
  });
  form.button(t("jm_at.common.btn_back"), () => {
    pendingNav = () => showBulkRemoveByTag(player, current);
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(() => showBulkRemoveTagFilter(player, current));
  }
  if (pendingNav) return system.run(pendingNav);
  return; // ✕ / engine close / escape → exit to game
}

async function showBulkRemoveMode(player, tag, matches) {
  const form = new ActionFormData()
    .title(t("jm_at.adm.br_title"))
    .body(t("jm_at.adm.br_mode_body", tag, matches.length))
    .button(t("jm_at.adm.br_btn_remove_all"), "textures/ui/jm_at_remove")
    .button(t("jm_at.adm.br_btn_pick"), "textures/ui/jm_at_players")
    .button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back")
    .button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showRankManager(player); // X = Back
  if (res.selection === 2) return showRankManager(player); // Back
  if (res.selection === 3) return; // Close

  if (res.selection === 0) {
    return showBulkRemoveConfirm(player, tag, matches);
  }
  return showBulkRemovePickPlayers(player, tag, matches, 0);
}

async function showBulkRemovePickPlayers(
  player,
  tag,
  matches,
  page,
  chosenXuids,
) {
  const pageSize = LIMITS.BULK_ASSIGN_PAGE;
  const totalPages = Math.ceil(matches.length / pageSize);
  const safePage = Math.min(page, totalPages - 1);
  const start = safePage * pageSize;
  const slice = matches.slice(start, start + pageSize);

  // Running selection across pages — seeded with everyone (the old all-checked
  // default) so switching pages no longer drops the checks on the page you left.
  const chosen = chosenXuids ?? new Set(matches.map((e) => e.xuid));

  const form = new ModalFormData().title(
    t("jm_at.adm.br_pick_title", tag, safePage + 1, totalPages),
  );

  for (const e of slice) {
    form.toggle(e.name, { defaultValue: chosen.has(e.xuid) });
  }

  if (totalPages > 1) {
    const pageLabels = [];
    for (let i = 0; i < totalPages; i++)
      pageLabels.push(t("jm_at.adm.bulk_page_n", i + 1));
    form.dropdown(t("jm_at.adm.bulk_goto_page"), pageLabels, {
      defaultValueIndex: safePage,
    });
  }

  const res = await form.show(player);
  if (res.canceled) return showBulkRemoveMode(player, tag, matches);

  // Merge this page's toggle states into the running selection before doing
  // anything else (navigate or finalize), so a page change doesn't lose them.
  for (let i = 0; i < slice.length; i++) {
    if (res.formValues[i]) chosen.add(slice[i].xuid);
    else chosen.delete(slice[i].xuid);
  }

  if (totalPages > 1) {
    const selectedPage = res.formValues[slice.length];
    if (selectedPage !== safePage) {
      return showBulkRemovePickPlayers(
        player,
        tag,
        matches,
        selectedPage,
        chosen,
      );
    }
  }

  const selected = matches.filter((e) => chosen.has(e.xuid));

  if (selected.length === 0) {
    tell(player, t("jm_at.adm.bulk_none_selected"));
    return showBulkRemovePickPlayers(player, tag, matches, safePage, chosen);
  }

  return showBulkRemoveConfirm(player, tag, selected);
}

async function showBulkRemoveConfirm(player, tag, selected) {
  const maxShow = 20;
  const nameList = selected
    .slice(0, maxShow)
    .map((e) => e.name)
    .join(", ");
  const extra =
    selected.length > maxShow
      ? t("jm_at.adm.bulk_and_more", selected.length - maxShow)
      : "";

  const form = new MessageFormData()
    .title(t("jm_at.adm.br_confirm_title"))
    .body(t("jm_at.adm.br_confirm_body", tag, selected.length, nameList, extra))
    .button1(t("jm_at.common.btn_cancel"))
    .button2(t("jm_at.adm.gear_btn_remove"));

  const res = await form.show(player);
  if (res.canceled || res.selection === 0) return showRankManager(player);

  const count = stripRankFromSelected(tag, selected);
  logAdmin(player, "RANK_BULK_REMOVE", `${tag} (${count} 名玩家移除）`);
  tell(player, t("jm_at.adm.br_removed", tag, count));
  return showRankManager(player);
}

// =========================================================
// Bulk Assign
// =========================================================

async function showBulkAssignPickRank(player) {
  try {
    requireAdminOrModCan(player, "rankManager", "批量分配身份组");
  } catch {
    return;
  }
  const names = getRankNames();
  const db = getRankDb();

  if (names.length === 0) {
    return warnForm(player, t("jm_at.adm.ba_no_ranks"), () =>
      showRankManager(player),
    );
  }

  const form = new ActionFormData()
    .title(t("jm_at.adm.ba_pick_title"))
    .body(t("jm_at.adm.ba_pick_body"));

  for (const name of names) {
    form.button(
      t("jm_at.adm.ba_rank_row", name, db[name].tag),
      "textures/ui/jm_at_search",
    );
  }
  form.button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back");
  form.button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showRankManager(player); // X = Back
  if (res.selection === names.length) return showRankManager(player); // Back
  if (res.selection === names.length + 1) return; // Close

  return showBulkAssignMode(player, names[res.selection]);
}

async function showBulkAssignMode(player, rankName) {
  const db = getRankDb();
  const tag = db[rankName]?.tag ?? "";
  const reg = getPlayerRegistry();
  const entries = Object.entries(reg).map(([xuid, e]) => ({
    xuid,
    name: e.name ?? xuid,
    currentTag: e.rankTag ?? "",
  }));
  const totalCount = entries.length;
  const unrankedCount = entries.filter((e) => !e.currentTag).length;

  const form = new ActionFormData()
    .title(t("jm_at.adm.ba_mode_title", rankName))
    .body(t("jm_at.adm.ba_mode_body", tag, totalCount, unrankedCount))
    .button(t("jm_at.adm.ba_btn_all"), "textures/ui/jm_at_players_red")
    .button(t("jm_at.adm.ba_btn_unranked"), "textures/ui/jm_at_players_yellow")
    .button(t("jm_at.adm.ba_btn_pick"), "textures/ui/jm_at_players_green")
    .button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back")
    .button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showBulkAssignPickRank(player); // X = Back
  if (res.selection === 3) return showBulkAssignPickRank(player); // Back
  if (res.selection === 4) return; // Close

  if (res.selection === 0) {
    // Apply to all players
    const all = entries.sort((a, b) => a.name.localeCompare(b.name));
    if (all.length === 0) {
      return warnForm(player, t("jm_at.adm.ba_registry_empty"), () =>
        showBulkAssignPickRank(player),
      );
    }
    return showBulkAssignConfirm(player, rankName, all);
  }
  if (res.selection === 1) {
    // Apply to all unranked players
    const unranked = entries
      .filter((e) => !e.currentTag)
      .sort((a, b) => a.name.localeCompare(b.name));
    if (unranked.length === 0) {
      tell(player, t("jm_at.adm.ba_no_unranked"));
      return showBulkAssignMode(player, rankName);
    }
    return showBulkAssignConfirm(player, rankName, unranked);
  }
  // Pick players manually
  return showBulkAssignPickPlayers(player, rankName, 0);
}

async function showBulkAssignPickPlayers(player, rankName, page, chosenXuids) {
  const db = getRankDb();
  const tag = rankName ? (db[rankName]?.tag ?? "") : "";
  const reg = getPlayerRegistry();
  const entries = Object.entries(reg)
    .map(([xuid, e]) => ({
      xuid,
      name: e.name ?? xuid,
      currentTag: e.rankTag ?? "",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (entries.length === 0) {
    return warnForm(player, t("jm_at.adm.ba_registry_empty"), () =>
      rankName ? showBulkAssignPickRank(player) : showBulkRemoveRank(player),
    );
  }

  const pageSize = LIMITS.BULK_ASSIGN_PAGE;
  const totalPages = Math.ceil(entries.length / pageSize);
  const safePage = Math.min(page, totalPages - 1);
  const start = safePage * pageSize;
  const slice = entries.slice(start, start + pageSize);

  // Running selection across pages, seeded from the per-entry default (assign
  // pre-checks players who already have the rank; clear pre-checks nobody) so a
  // page change no longer discards the checks on the page you left.
  const chosen =
    chosenXuids ??
    new Set(
      entries
        .filter((e) => (rankName ? e.currentTag === tag : false))
        .map((e) => e.xuid),
    );

  const title = rankName
    ? t("jm_at.adm.ba_pick_pg_title", rankName, safePage + 1, totalPages)
    : t("jm_at.adm.ba_clear_pg_title", safePage + 1, totalPages);

  const form = new ModalFormData().title(title);

  for (const e of slice) {
    const label = e.currentTag
      ? t("jm_at.adm.ba_player_row_tag", e.name, e.currentTag)
      : e.name;
    form.toggle(label, { defaultValue: chosen.has(e.xuid) });
  }

  if (totalPages > 1) {
    const pageLabels = [];
    for (let i = 0; i < totalPages; i++)
      pageLabels.push(t("jm_at.adm.bulk_page_n", i + 1));
    form.dropdown(t("jm_at.adm.bulk_goto_page"), pageLabels, {
      defaultValueIndex: safePage,
    });
  }

  const res = await form.show(player);
  if (res.canceled)
    return rankName
      ? showBulkAssignPickRank(player)
      : showBulkRemoveRank(player);

  // Merge this page's toggles into the running selection before navigating or
  // finalizing.
  for (let i = 0; i < slice.length; i++) {
    if (res.formValues[i]) chosen.add(slice[i].xuid);
    else chosen.delete(slice[i].xuid);
  }

  // Check for page change
  if (totalPages > 1) {
    const selectedPage = res.formValues[slice.length];
    if (selectedPage !== safePage) {
      return showBulkAssignPickPlayers(player, rankName, selectedPage, chosen);
    }
  }

  const selected = entries.filter((e) => chosen.has(e.xuid));

  if (selected.length === 0) {
    tell(player, t("jm_at.adm.bulk_none_selected"));
    return showBulkAssignPickPlayers(player, rankName, safePage, chosen);
  }

  return showBulkAssignConfirm(player, rankName, selected);
}

async function showBulkAssignConfirm(player, rankName, selected) {
  const db = getRankDb();
  const tag = rankName ? (db[rankName]?.tag ?? "") : "";
  const role = rankName ? detectRankRole(rankName, tag) : null;
  const actionLabel = rankName
    ? t("jm_at.adm.ba_action_assign", rankName, tag)
    : t("jm_at.adm.ba_action_clear");
  const maxShow = 20;
  const nameList = selected
    .slice(0, maxShow)
    .map((e) => e.name)
    .join(", ");
  const extra =
    selected.length > maxShow
      ? t("jm_at.adm.bulk_and_more", selected.length - maxShow)
      : "";

  const roleWarn = role
    ? t(
        "jm_at.adm.ba_role_warn",
        t(
          role === "admin"
            ? "jm_at.adm.role_admin"
            : "jm_at.adm.role_moderator",
        ),
      )
    : "";
  const form = new MessageFormData()
    .title(t("jm_at.adm.ba_confirm_title"))
    .body(
      t(
        "jm_at.adm.ba_confirm_body",
        actionLabel,
        selected.length,
        nameList,
        extra,
        roleWarn,
      ),
    )
    .button1(t("jm_at.common.btn_cancel"))
    .button2(
      t(role ? "jm_at.adm.ba_btn_grant_all" : "jm_at.adm.ba_btn_confirm"),
    );

  const res = await form.show(player);
  if (res.canceled || res.selection === 0)
    return rankName
      ? showBulkAssignPickRank(player)
      : showBulkRemoveRank(player);

  executeBulkAssign(player, rankName, tag, selected);
  return showRankManager(player);
}

function executeBulkAssign(admin, rankName, tag, selected) {
  const role = rankName ? detectRankRole(rankName, tag) : null;
  // A role-granting rank requires the admin-only manageRoles capability — the
  // same gate grantRoleFromRank enforces for online targets. Block here too so
  // an unauthorized actor can't stamp pendingRole onto offline accounts (which
  // syncOfflineRankChanges would later apply on join with no re-check).
  if (role && !canManageRoles(admin)) {
    tell(admin, t("jm_at.adm.ba_need_manage_roles"));
    return;
  }
  let onlineCount = 0;
  let offlineCount = 0;

  for (const entry of selected) {
    // Try to find online player
    const onlinePlayer = world
      .getPlayers()
      .find((p) => getPlayerXuid(p) === entry.xuid);

    if (role) {
      // Role-granting rank: grant the staff role rather than a cosmetic tag.
      if (onlinePlayer) {
        grantRoleFromRank(admin, onlinePlayer, role);
        onlineCount++;
      } else {
        mutateRegistryEntry(entry.xuid, (e) => {
          e.pendingRole = role;
        });
        offlineCount++;
      }
      continue;
    }

    if (onlinePlayer) {
      const core = getPlayerCore(onlinePlayer);
      core.rankTag = tag;
      core.rankTagEnabled = tag ? true : core.rankTagEnabled;
      core.rankSetManually = !!tag;
      setPlayerCore(onlinePlayer, core);
      if (rankName) {
        tell(onlinePlayer, t("jm_at.adm.rankp_set_target", tag));
      } else {
        tell(onlinePlayer, t("jm_at.adm.rankp_removed_target"));
      }
      onlineCount++;
    } else {
      mutateRegistryEntry(entry.xuid, (e) => {
        e.rankTag = tag;
        e.rankTagEnabled = tag ? true : (e.rankTagEnabled ?? true);
        e.rankSetManually = !!tag;
      });
      offlineCount++;
    }
  }

  const label = rankName ? `${rankName} (${tag})` : "CLEAR";
  logAdmin(
    admin,
    "BULK_RANK_ASSIGN",
    `${label} → ${selected.length} 名玩家（${onlineCount} 在线，${offlineCount} 离线）`,
  );
  tell(admin, t("jm_at.adm.ba_done", onlineCount, offlineCount));
}

// =========================================================
// Staff Rank Settings
// =========================================================

async function showStaffRankSettings(player, override = null) {
  try {
    requireAdminOrModCan(player, "rankManager", "管理团队身份组设置");
  } catch {
    return;
  }
  const cfg = getCfg();

  const adminTag = cfg.staffAdminTag ?? "§c[管理员]§r";
  const modTag = cfg.staffModTag ?? "§g[协管员]§r";

  const adminColorObs = new ObservableNumber(
    override ? override.adminColor : detectRankColor(adminTag),
    { clientWritable: true },
  );
  const adminTextObs = new ObservableString(
    override ? override.adminText : stripColorCode(adminTag),
    { clientWritable: true },
  );
  const modColorObs = new ObservableNumber(
    override ? override.modColor : detectRankColor(modTag),
    { clientWritable: true },
  );
  const modTextObs = new ObservableString(
    override ? override.modText : stripColorCode(modTag),
    { clientWritable: true },
  );
  const customObs = new ObservableBoolean(
    override ? override.custom : (cfg.staffCustomRanks ?? false),
    { clientWritable: true },
  );
  const hideObs = new ObservableBoolean(
    override ? override.hide : (cfg.staffRanksHidden ?? false),
    { clientWritable: true },
  );
  const status = new ObservableString("");
  const statusShown = new ObservableBoolean(false);

  // Compose a tag the same way for preview and save: honor any & color codes
  // the owner types, then wrap with the picked color unless "无颜色（手动设置）".
  const composeTag = (idx, rawText) => {
    const text = applyColorCodes(String(rawText ?? "").trim());
    if (!text) return "";
    return idx === RANK_COLOR_MANUAL_IDX
      ? text
      : `${RANK_COLORS[idx].code}${text}§r`;
  };
  const tagPreview = (idx, rawText) => {
    const tag = composeTag(idx, rawText);
    return tag ? `${tag}§r §7示例玩家` : "§7（尚未设置标签）";
  };
  const adminPreview = new ObservableString(
    tagPreview(adminColorObs.getData(), adminTextObs.getData()),
  );
  const modPreview = new ObservableString(
    tagPreview(modColorObs.getData(), modTextObs.getData()),
  );
  const refreshAdmin = () => {
    adminPreview.setData(
      tagPreview(adminColorObs.getData(), adminTextObs.getData()),
    );
  };
  const refreshMod = () => {
    modPreview.setData(tagPreview(modColorObs.getData(), modTextObs.getData()));
  };
  adminColorObs.subscribe(refreshAdmin);
  adminTextObs.subscribe(refreshAdmin);
  modColorObs.subscribe(refreshMod);
  modTextObs.subscribe(refreshMod);

  // Translated color names. The color_* lang values are now §-free (color comes
  // from RANK_COLORS[].code), so dropdown items render the translated name with no
  // literal § — dropdown items can't be colored anyway, and the live swatch shows
  // the actual color.
  const colorItems = RANK_COLORS.map((c, i) => ({
    label: t(c.labelKey),
    value: i,
  }));

  let pendingNav = null;
  let intent = null;
  const back = () => showRankManager(player);
  // Carry `override` so a UserBusy bounce on a preserved-edit reopen keeps the
  // edits (on UserBusy no interaction happened, so override still holds them).
  const reopen = () => showStaffRankSettings(player, override);
  const snapshot = () =>
    JSON.stringify([
      adminColorObs.getData(),
      adminTextObs.getData(),
      modColorObs.getData(),
      modTextObs.getData(),
      customObs.getData(),
      hideObs.getData(),
    ]);
  // Baseline = SAVED tags (not the seeded form state) so a preserved edit still
  // reads as dirty and re-warns on the next close.
  const initial = JSON.stringify([
    detectRankColor(adminTag),
    stripColorCode(adminTag),
    detectRankColor(modTag),
    stripColorCode(modTag),
    cfg.staffCustomRanks ?? false,
    cfg.staffRanksHidden ?? false,
  ]);

  const form = new CustomForm(player, t("jm_at.adm.idx_staff_rank_settings"));
  form.spacer();
  form.header(t("jm_at.adm.srs_header_admin"));
  form.spacer();
  form.label(t("jm_at.adm.srs_admin_intro"));
  form.label(adminPreview);
  form.spacer();
  form.dropdown(t("jm_at.adm.srs_dd_admin_color"), adminColorObs, colorItems);
  form.textField(t("jm_at.adm.srs_field_admin_text"), adminTextObs, {
    description: t("jm_at.adm.srs_field_admin_text_desc"),
  });
  form.spacer();
  form.header(t("jm_at.adm.srs_header_mod"));
  form.spacer();
  form.label(t("jm_at.adm.srs_mod_intro"));
  form.label(modPreview);
  form.spacer();
  form.dropdown(t("jm_at.adm.srs_dd_mod_color"), modColorObs, colorItems);
  form.textField(t("jm_at.adm.srs_field_mod_text"), modTextObs, {
    description: t("jm_at.adm.srs_field_mod_text_desc"),
  });
  form.spacer();
  form.header(t("jm_at.adm.srs_header_options"));
  form.spacer();
  form.toggle(t("jm_at.adm.srs_toggle_hide"), hideObs);
  form.spacer();
  form.label(t("jm_at.adm.srs_hide_note"));
  form.spacer();
  form.toggle(t("jm_at.adm.srs_toggle_custom"), customObs);
  form.spacer();
  form.label(t("jm_at.adm.srs_custom_note"));
  form.spacer();
  form.label(status, { visible: statusShown });
  form.spacer({ visible: statusShown });
  form.spacer();

  const save = (close) => {
    const newAdminTag = clampText(
      composeTag(adminColorObs.getData(), adminTextObs.getData()),
      LIMITS.RANK_TAG_MAX,
    );
    const newModTag = clampText(
      composeTag(modColorObs.getData(), modTextObs.getData()),
      LIMITS.RANK_TAG_MAX,
    );
    if (!newAdminTag || !newModTag) {
      status.setData("§c标签不能为空。");
      statusShown.setData(true);
      return;
    }
    const newCustomRanks = customObs.getData();
    const newHidden = hideObs.getData();
    mutateCfg((c) =>
      Object.assign(c, {
        staffAdminTag: newAdminTag,
        staffModTag: newModTag,
        staffCustomRanks: newCustomRanks,
        staffRanksHidden: newHidden,
      }),
    );
    logAdmin(
      player,
      "STAFF_RANK_SETTINGS",
      `管理员标签=${newAdminTag} 协管员标签=${newModTag} 自定义身份组=${newCustomRanks} 隐藏=${newHidden}`,
    );
    tell(player, t("jm_at.adm.srs_updated"));
    pendingNav = close ? () => {} : back;
    try {
      form.close();
    } catch {}
  };
  form.button(t("jm_at.common.btn_save"), () => save(false));
  form.button(t("jm_at.cl.btn_save_close"), () => save(true));
  form.button(t("jm_at.common.btn_back"), () => {
    intent = "back";
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(reopen);
  }
  if (pendingNav) return system.run(pendingNav);
  // Back → Rank Manager; ✕ / engine close / escape → exit to game. If a tag/color
  // changed, confirm first — Keep editing reopens with the fields preserved.
  if (snapshot() !== initial) {
    const keep = {
      adminColor: adminColorObs.getData(),
      adminText: adminTextObs.getData(),
      modColor: modColorObs.getData(),
      modText: modTextObs.getData(),
      custom: customObs.getData(),
      hide: hideObs.getData(),
    };
    return system.run(async () => {
      if (await confirmDiscardChanges(player))
        return showStaffRankSettings(player, keep);
      if (intent === "back") return back();
    });
  }
  if (intent === "back") return system.run(back);
}

// =========================================================
// Playtime Ranks
// =========================================================

function fmtThresholdTime(minutes) {
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  const parts = [];
  if (d > 0) parts.push(`${d}天`);
  if (h > 0) parts.push(`${h}小时`);
  if (m > 0 || parts.length === 0) parts.push(`${m}分钟`);
  return parts.join(" ");
}

async function showPlaytimeRanks(player) {
  try {
    requireAdminOrModCan(player, "rankManager", "游玩时长身份组");
  } catch {
    return;
  }
  const cfg = getCfg();
  const enabled = cfg.playtimeRanksEnabled ?? false;
  const overrideManual = cfg.playtimeRanksOverrideManual ?? false;
  const thresholds = cfg.playtimeRanks ?? [];
  const db = getRankDb();

  const lines = thresholds.map((th) => {
    const rank = db[th.rankName];
    const tag = rank ? rank.tag : t("jm_at.adm.pr_deleted", th.rankName);
    // NOTE: was `t.minutes` (a leftover from the part-1 local rename) — the
    // threshold entry is `th`.
    return t("jm_at.adm.pr_line", fmtThresholdTime(th.minutes), tag);
  });

  const form = new ActionFormData()
    .title(t("jm_at.adm.idx_playtime_ranks"))
    .body(
      t(
        "jm_at.adm.pr_body",
        t(enabled ? "jm_at.adm.rm_enabled" : "jm_at.adm.rm_disabled"),
        t(overrideManual ? "jm_at.adm.rm_yes" : "jm_at.adm.pr_no"),
        thresholds.length,
        LIMITS.PLAYTIME_RANKS_MAX,
        lines.length ? raw(...lines.flatMap((l) => ["\n", l])) : "",
      ),
    )
    .button(
      t(enabled ? "jm_at.adm.pr_btn_disable" : "jm_at.adm.pr_btn_enable"),
      "textures/ui/jm_at_playtime_ranks",
    )
    .button(
      t(
        "jm_at.adm.pr_btn_override",
        t(overrideManual ? "jm_at.adm.rm_yes" : "jm_at.adm.pr_no"),
      ),
      "textures/ui/jm_at_rank_toggle",
    )
    .button(
      t("jm_at.adm.pr_btn_thresholds", thresholds.length),
      "textures/ui/jm_at_control_panel",
    )
    .button(t("jm_at.adm.pr_btn_bonus"), "textures/ui/jm_at_hourglass")
    .button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back")
    .button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showRankManager(player); // X = Back
  if (res.selection === 4) return showRankManager(player); // Back
  if (res.selection === 5) return; // Close

  if (res.selection === 0) {
    mutateCfg((c) => {
      c.playtimeRanksEnabled = !c.playtimeRanksEnabled;
    });
    const on = getCfg().playtimeRanksEnabled;
    logAdmin(player, "PLAYTIME_RANKS_TOGGLE", on ? "Enabled" : "Disabled");
    tell(player, t(on ? "jm_at.adm.pr_enabled" : "jm_at.adm.pr_disabled"));
    return showPlaytimeRanks(player);
  }
  if (res.selection === 1) {
    mutateCfg((c) => {
      c.playtimeRanksOverrideManual = !c.playtimeRanksOverrideManual;
    });
    const on = getCfg().playtimeRanksOverrideManual;
    logAdmin(player, "PLAYTIME_RANKS_OVERRIDE", on ? "Enabled" : "Disabled");
    tell(
      player,
      t(on ? "jm_at.adm.pr_override_on" : "jm_at.adm.pr_override_off"),
    );
    return showPlaytimeRanks(player);
  }
  if (res.selection === 2) return showPlaytimeRankThresholds(player);
  if (res.selection === 3) return showBonusPlaytimePicker(player);
}

async function showPlaytimeRankThresholds(player) {
  const cfg = getCfg();
  const thresholds = cfg.playtimeRanks ?? [];
  const db = getRankDb();

  const form = new ActionFormData()
    .title(
      t("jm_at.adm.pt_title", thresholds.length, LIMITS.PLAYTIME_RANKS_MAX),
    )
    .body(
      thresholds.length
        ? raw(
            ...thresholds.flatMap((th, i) => {
              const rank = db[th.rankName];
              const tag = rank
                ? rank.tag
                : t("jm_at.adm.pr_deleted", th.rankName);
              // NOTE: was `t.minutes` (part-1 local-rename leftover) — the
              // threshold entry is `th`.
              const row = t(
                "jm_at.adm.pt_row",
                fmtThresholdTime(th.minutes),
                tag,
              );
              return i ? ["\n", row] : [row];
            }),
          )
        : t("jm_at.adm.pt_none"),
    );

  form.button(t("jm_at.adm.pt_btn_add"), "textures/ui/jm_at_add");
  for (const th of thresholds) {
    const rank = db[th.rankName];
    const tag = rank ? rank.tag : t("jm_at.adm.pt_deleted_short");
    form.button(
      // NOTE: was `t.minutes` (part-1 local-rename leftover).
      t("jm_at.adm.pt_btn_row", fmtThresholdTime(th.minutes), tag),
      "textures/ui/jm_at_search",
    );
  }
  form.button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back");
  form.button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showPlaytimeRanks(player); // X = Back
  if (res.selection === thresholds.length + 1) return showPlaytimeRanks(player); // Back
  if (res.selection === thresholds.length + 2) return; // Close
  if (res.selection === 0) return showAddPlaytimeThreshold(player);
  return showEditPlaytimeThreshold(player, res.selection - 1);
}

async function showAddPlaytimeThreshold(player) {
  const cfg = getCfg();
  const thresholds = cfg.playtimeRanks ?? [];

  if (thresholds.length >= LIMITS.PLAYTIME_RANKS_MAX) {
    return warnForm(
      player,
      t("jm_at.adm.pt_limit", LIMITS.PLAYTIME_RANKS_MAX),
      () => showPlaytimeRankThresholds(player),
    );
  }

  const dbNames = getRankNames();
  if (dbNames.length === 0) {
    return warnForm(player, t("jm_at.adm.pt_no_ranks"), () =>
      showPlaytimeRankThresholds(player),
    );
  }

  const rankItems = dbNames.map((n, i) => ({
    label: String(n).replace(/§./g, ""),
    value: i,
  }));
  const rankObs = new ObservableNumber(0, { clientWritable: true });
  const hoursObs = new ObservableString("", { clientWritable: true });
  const minsObs = new ObservableString("", { clientWritable: true });
  const status = new ObservableString("");
  const statusShown = new ObservableBoolean(false);
  const fail = (m) => {
    status.setData(m);
    statusShown.setData(true);
  };
  let pendingNav = null;
  let intent = null;
  const back = () => showPlaytimeRankThresholds(player);

  const form = new CustomForm(player, t("jm_at.adm.pt_add_title"));
  form.spacer();
  form.dropdown(t("jm_at.adm.pt_dd_rank"), rankObs, rankItems);
  form.textField(t("jm_at.adm.pt_field_hours"), hoursObs, {
    description: t("jm_at.adm.pt_field_hours_desc"),
  });
  form.textField(t("jm_at.adm.pt_field_mins"), minsObs, {
    description: t("jm_at.adm.pt_field_mins_desc"),
  });
  form.spacer();
  form.label(status, { visible: statusShown });
  form.spacer({ visible: statusShown });

  const submit = (close) => {
    const rankName = dbNames[rankObs.getData()];
    const hours = Math.max(
      0,
      parseInt(String(hoursObs.getData() ?? ""), 10) || 0,
    );
    const mins = Math.max(
      0,
      parseInt(String(minsObs.getData() ?? ""), 10) || 0,
    );
    const totalMinutes = hours * 60 + mins;
    if (totalMinutes <= 0) return fail("§c时长必须大于0。");
    if (thresholds.some((th) => th.minutes === totalMinutes)) {
      return fail(
        `§c已存在 ${fmtThresholdTime(totalMinutes)} 的游玩时长门槛。`,
      );
    }
    thresholds.push({ minutes: totalMinutes, rankName });
    thresholds.sort((a, b) => a.minutes - b.minutes);
    mutateCfg((c) => {
      c.playtimeRanks = thresholds;
    });
    const db = getRankDb();
    const tag = db[rankName]?.tag ?? rankName;
    logAdmin(
      player,
      "PLAYTIME_RANK_ADD",
      `${fmtThresholdTime(totalMinutes)} → ${rankName} (${tag})`,
    );
    tell(player, t("jm_at.adm.pt_added", fmtThresholdTime(totalMinutes), tag));
    pendingNav = close ? () => {} : back;
    try {
      form.close();
    } catch {}
  };
  form.button(t("jm_at.adm.btn_add"), () => submit(false));
  form.button(t("jm_at.adm.btn_add_close"), () => submit(true));
  form.button(t("jm_at.common.btn_back"), () => {
    intent = "back";
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(() => showAddPlaytimeThreshold(player));
  }
  if (pendingNav) return system.run(pendingNav);
  if (intent === "back") return system.run(back); // Back → list; ✕/escape → exit
}

async function showEditPlaytimeThreshold(player, index) {
  const cfg = getCfg();
  const thresholds = cfg.playtimeRanks ?? [];
  if (index < 0 || index >= thresholds.length)
    return showPlaytimeRankThresholds(player);

  const entry = thresholds[index];
  const db = getRankDb();
  const rank = db[entry.rankName];
  const tag = rank ? rank.tag : t("jm_at.adm.pr_deleted", entry.rankName);

  const form = new ActionFormData()
    .title(t("jm_at.adm.pt_edit_title"))
    .body(
      t(
        "jm_at.adm.pt_edit_body",
        fmtThresholdTime(entry.minutes),
        entry.rankName,
        tag,
      ),
    )
    .button(t("jm_at.adm.pt_btn_edit"), "textures/ui/jm_at_search")
    .button(t("jm_at.adm.btn_delete_red"), "textures/ui/jm_at_remove")
    .button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back")
    .button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showPlaytimeRankThresholds(player); // X = Back
  if (res.selection === 2) return showPlaytimeRankThresholds(player); // Back
  if (res.selection === 3) return; // Close

  if (res.selection === 1) {
    const conf = await new MessageFormData()
      .title(t("jm_at.adm.pt_delete_title"))
      .body(t("jm_at.adm.pt_delete_body", fmtThresholdTime(entry.minutes), tag))
      .button1(t("jm_at.common.btn_cancel"))
      .button2(t("jm_at.adm.btn_delete_red"))
      .show(player);
    if (conf.canceled || conf.selection === 0)
      return showPlaytimeRankThresholds(player);
    const removed = thresholds.splice(index, 1)[0];
    mutateCfg((c) => {
      c.playtimeRanks = thresholds;
    });
    logAdmin(
      player,
      "PLAYTIME_RANK_REMOVE",
      `${fmtThresholdTime(removed.minutes)} → ${removed.rankName}`,
    );
    tell(
      player,
      t("jm_at.adm.pt_removed", fmtThresholdTime(removed.minutes), tag),
    );
    return showPlaytimeRankThresholds(player);
  }

  // Edit
  const dbNames = getRankNames();
  if (dbNames.length === 0) {
    return warnForm(player, t("jm_at.adm.pt_no_ranks_short"), () =>
      showPlaytimeRankThresholds(player),
    );
  }

  const rankItems = dbNames.map((n, i) => ({
    label: String(n).replace(/§./g, ""),
    value: i,
  }));
  const rankObs = new ObservableNumber(
    Math.max(0, dbNames.indexOf(entry.rankName)),
    { clientWritable: true },
  );
  const hoursObs = new ObservableString(
    String(Math.floor(entry.minutes / 60)),
    {
      clientWritable: true,
    },
  );
  const minsObs = new ObservableString(String(entry.minutes % 60), {
    clientWritable: true,
  });
  const status = new ObservableString("");
  const statusShown = new ObservableBoolean(false);
  const fail = (m) => {
    status.setData(m);
    statusShown.setData(true);
  };
  let pendingNav = null;
  let intent = null;
  const back = () => showEditPlaytimeThreshold(player, index);

  const editForm = new CustomForm(player, t("jm_at.adm.pt_edit_form_title"));
  editForm.spacer();
  editForm.dropdown(t("jm_at.adm.pt_dd_rank"), rankObs, rankItems);
  editForm.textField(t("jm_at.adm.pt_field_hours"), hoursObs, {
    description: t("jm_at.adm.pt_field_hours_desc"),
  });
  editForm.textField(t("jm_at.adm.pt_field_mins"), minsObs, {
    description: t("jm_at.adm.pt_field_mins_desc"),
  });
  editForm.spacer();
  editForm.label(status, { visible: statusShown });
  editForm.spacer({ visible: statusShown });

  const save = (close) => {
    const newRankName = dbNames[rankObs.getData()];
    const hours = Math.max(
      0,
      parseInt(String(hoursObs.getData() ?? ""), 10) || 0,
    );
    const mins = Math.max(
      0,
      parseInt(String(minsObs.getData() ?? ""), 10) || 0,
    );
    const totalMinutes = hours * 60 + mins;
    if (totalMinutes <= 0) return fail("§c时长必须大于0。");
    if (
      thresholds.some((th, i) => i !== index && th.minutes === totalMinutes)
    ) {
      return fail(
        `§c已存在 ${fmtThresholdTime(totalMinutes)} 的游玩时长门槛。`,
      );
    }
    const oldDesc = `${fmtThresholdTime(entry.minutes)} → ${entry.rankName}`;
    thresholds[index] = { minutes: totalMinutes, rankName: newRankName };
    thresholds.sort((a, b) => a.minutes - b.minutes);
    mutateCfg((c) => {
      c.playtimeRanks = thresholds;
    });
    const newTag = db[newRankName]?.tag ?? newRankName;
    logAdmin(
      player,
      "PLAYTIME_RANK_EDIT",
      `${oldDesc} → ${fmtThresholdTime(totalMinutes)} → ${newRankName} (${newTag})`,
    );
    tell(
      player,
      t("jm_at.adm.pt_updated", fmtThresholdTime(totalMinutes), newTag),
    );
    pendingNav = close ? () => {} : () => showPlaytimeRankThresholds(player);
    try {
      editForm.close();
    } catch {}
  };
  editForm.button(t("jm_at.common.btn_save"), () => save(false));
  editForm.button(t("jm_at.cl.btn_save_close"), () => save(true));
  editForm.button(t("jm_at.common.btn_back"), () => {
    intent = "back";
    try {
      editForm.close();
    } catch {}
  });
  const reason = await editForm.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(() => showEditPlaytimeThreshold(player, index));
  }
  if (pendingNav) return system.run(pendingNav);
  if (intent === "back") return system.run(back); // Back → Edit menu; ✕/escape → exit
}

// =========================================================
// Bonus Playtime
// =========================================================

function fmtPlaytimeMs(ms) {
  if (!ms || ms <= 0) return "0分钟";
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const parts = [];
  if (d > 0) parts.push(`${d}天`);
  if (h > 0) parts.push(`${h}小时`);
  if (m > 0 || parts.length === 0) parts.push(`${m}分钟`);
  return parts.join(" ");
}

async function showBonusPlaytimePicker(player, page = 0) {
  const onlinePlayers = world.getPlayers();
  const reg = getPlayerRegistry();

  const onlineXuids = new Set();
  const entries = [];
  for (const p of onlinePlayers) {
    const xuid = getPlayerXuid(p);
    onlineXuids.add(xuid);
    const core = getPlayerCore(p);
    entries.push({
      name: p.name,
      xuid,
      playTimeMs: core.playTimeMs ?? 0,
      bonusPlaytimeMs: core.bonusPlaytimeMs ?? 0,
      online: true,
    });
  }
  for (const [xuid, r] of Object.entries(reg)) {
    if (!onlineXuids.has(xuid)) {
      entries.push({
        name: r.name,
        xuid,
        playTimeMs: r.playTimeMs ?? 0,
        bonusPlaytimeMs: r.bonusPlaytimeMs ?? 0,
        online: false,
      });
    }
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));

  // Paginate — the registry can hold up to PLAYER_REGISTRY_MAX players, so
  // a single button-per-player form would be unusable.
  const PAGE_SIZE = LIMITS.BULK_ASSIGN_PAGE;
  const totalPages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const start = safePage * PAGE_SIZE;
  const slice = entries.slice(start, start + PAGE_SIZE);

  const form = new ActionFormData()
    .title(t("jm_at.adm.bp_title"))
    .body(
      raw(
        t("jm_at.adm.bp_body"),
        ...(totalPages > 1
          ? ["\n\n", t("jm_at.adm.iwl_page", safePage + 1, totalPages)]
          : []),
      ),
    );

  for (const e of slice) {
    const status = t(e.online ? "jm_at.adm.bp_online" : "jm_at.adm.bp_offline");
    const effective = e.playTimeMs + e.bonusPlaytimeMs;
    const bonus =
      e.bonusPlaytimeMs > 0
        ? t("jm_at.adm.bp_bonus_suffix", fmtPlaytimeMs(e.bonusPlaytimeMs))
        : "";
    form.button(
      t("jm_at.adm.bp_row", e.name, status, fmtPlaytimeMs(effective), bonus),
      "textures/ui/jm_at_players",
    );
  }

  // Nav buttons after the player list, tracked in an array so the selection
  // handler stays correct regardless of which appear.
  const nav = [];
  if (safePage > 0) {
    nav.push("prev");
    form.button(t("jm_at.adm.bp_btn_prev"), "textures/ui/jm_at_back");
  }
  if (start + PAGE_SIZE < entries.length) {
    nav.push("next");
    form.button(t("jm_at.adm.bp_btn_next"), "textures/ui/jm_at_next");
  }
  nav.push("back");
  form.button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back");
  nav.push("close");
  form.button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showPlaytimeRanks(player); // X = Back

  if (res.selection < slice.length) {
    return showBonusPlaytimeAdjust(player, slice[res.selection], safePage);
  }
  const navKey = nav[res.selection - slice.length];
  if (navKey === "prev") return showBonusPlaytimePicker(player, safePage - 1);
  if (navKey === "next") return showBonusPlaytimePicker(player, safePage + 1);
  if (navKey === "back") return showPlaytimeRanks(player);
  // close
}

async function showBonusPlaytimeAdjust(player, entry, backPage = 0) {
  const effective = entry.playTimeMs + entry.bonusPlaytimeMs;
  const hoursObs = new ObservableString("", { clientWritable: true });
  const minsObs = new ObservableString("", { clientWritable: true });
  const status = new ObservableString("");
  const statusShown = new ObservableBoolean(false);
  let pendingNav = null;
  let intent = null;
  const back = () => showBonusPlaytimePicker(player, backPage);

  const form = new CustomForm(
    player,
    t("jm_at.adm.bp_adjust_title", entry.name),
  );
  form.spacer();
  form.label(
    t(
      "jm_at.adm.bp_stats",
      fmtPlaytimeMs(entry.playTimeMs),
      fmtPlaytimeMs(entry.bonusPlaytimeMs),
      fmtPlaytimeMs(effective),
    ),
  );
  form.spacer();
  form.label(t("jm_at.adm.bp_hint"));
  form.spacer();
  form.textField(t("jm_at.adm.bp_field_hours"), hoursObs, {
    description: t("jm_at.adm.bp_field_hours_desc"),
  });
  form.textField(t("jm_at.adm.bp_field_mins"), minsObs, {
    description: t("jm_at.adm.bp_field_mins_desc"),
  });
  form.spacer();
  form.label(status, { visible: statusShown });
  form.spacer({ visible: statusShown });

  const submit = (close) => {
    const hours = parseInt(String(hoursObs.getData() ?? ""), 10) || 0;
    const mins = parseInt(String(minsObs.getData() ?? ""), 10) || 0;
    const deltaMs = (hours * 60 + mins) * 60000;
    if (deltaMs === 0) {
      status.setData("§c没有需要修改的内容，请输入非零数值。");
      statusShown.setData(true);
      return;
    }
    const target = world
      .getPlayers()
      .find((p) => getPlayerXuid(p) === entry.xuid);
    if (target) {
      const core = getPlayerCore(target);
      core.bonusPlaytimeMs = Math.max(0, (core.bonusPlaytimeMs ?? 0) + deltaMs);
      setPlayerCore(target, core);
    } else {
      const reg = getPlayerRegistry();
      const r = reg[entry.xuid];
      if (r) {
        r.bonusPlaytimeMs = Math.max(0, (r.bonusPlaytimeMs ?? 0) + deltaMs);
        setPlayerRegistry(reg);
      }
    }
    const absMs = Math.abs(deltaMs);
    const verb = deltaMs > 0 ? "添加至" : "从中移除";
    logAdmin(
      player,
      "BONUS_PLAYTIME",
      `${fmtPlaytimeMs(absMs)} ${verb} ${entry.name}`,
    );
    tell(
      player,
      t(
        deltaMs > 0 ? "jm_at.adm.bp_added" : "jm_at.adm.bp_removed",
        fmtPlaytimeMs(absMs),
        entry.name,
      ),
    );
    // Stays English: queuePlayerNotif payloads are stored text.
    queuePlayerNotif(
      entry.xuid,
      deltaMs > 0
        ? `§9§l[身份组]§r 已增加 ${fmtPlaytimeMs(absMs)} 的奖励游玩时长。`
        : `§9§l[身份组]§r 已扣除 ${fmtPlaytimeMs(absMs)} 的奖励游玩时长。`,
    );
    pendingNav = close ? () => {} : back;
    try {
      form.close();
    } catch {}
  };
  form.button(t("jm_at.cla.btn_apply"), () => submit(false));
  form.button(t("jm_at.adm.bp_btn_apply_close"), () => submit(true));
  form.button(t("jm_at.common.btn_back"), () => {
    intent = "back";
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(() => showBonusPlaytimeAdjust(player, entry, backPage));
  }
  if (pendingNav) return system.run(pendingNav);
  if (intent === "back") return system.run(back); // Back → list; ✕/escape → exit
}

// =========================================================
// Player Settings / In-game Config Editor
// =========================================================

/**
 * DDUI (CustomForm) player-config editor — collapses the old hub + 5 sub-modals
 * (Homes, Teleport, Warns, Deathback, AFK) onto one reactive screen. Every input
 * is a slider/toggle/dropdown (nothing to mis-type), and dependent fields hide
 * when their toggle is off. mutateCfg stays the authority; saved all at once.
 */
async function showPlayerSettings(player, override = null) {
  try {
    requireAdminOrModCan(player, "configEditor", "玩家设置");
  } catch {
    return;
  }
  const cfg = getCfg();
  const gravestonesOn = cfg.gravestonesEnabled === true;
  const rawToolMode = cfg.deathbackGiveTools;
  const toolMode =
    rawToolMode === true || rawToolMode === "always"
      ? "always"
      : rawToolMode === "inventory"
        ? "inventory"
        : "none";
  const toolModes = ["none", "inventory", "always"];

  // Preserve-on-discard: seed from `override` (a returning preserved edit) when
  // present, else from saved config. `saved` is also the dirty-check baseline so
  // a preserved edit still reads as changed and re-warns. Key order must match
  // snapshot().
  const saved = {
    homesEnabled: cfg.homesEnabled !== false,
    maxHomes: cfg.maxHomes ?? 3,
    tpaEnabled: cfg.tpaEnabled !== false,
    tpaDelaySec: cfg.tpaDelaySec ?? 3,
    warnThreshold: cfg.warnThreshold ?? 3,
    deathbackEnabled: cfg.deathbackEnabled !== false,
    toolModeIdx: Math.max(0, toolModes.indexOf(toolMode)),
    gravestonesEnabled: gravestonesOn,
    graveSafeZone: cfg.gravestoneSafeZoneEnabled === true,
    afkEnabled: cfg.afkEnabled ?? false,
    afkWarnMinutes: cfg.afkWarnMinutes ?? 2,
    afkKickEnabled: !!cfg.afkKickEnabled,
    afkKickMinutes: cfg.afkKickMinutes ?? 30,
    afkExemptStaff: cfg.afkExemptStaff !== false,
  };
  const src = override ?? saved;

  const homesEnabledObs = new ObservableBoolean(src.homesEnabled, {
    clientWritable: true,
  });
  const maxHomesObs = new ObservableNumber(src.maxHomes, {
    clientWritable: true,
  });
  const tpaEnabledObs = new ObservableBoolean(src.tpaEnabled, {
    clientWritable: true,
  });
  const tpaDelayObs = new ObservableNumber(src.tpaDelaySec, {
    clientWritable: true,
  });
  const warnObs = new ObservableNumber(src.warnThreshold, {
    clientWritable: true,
  });
  const deathbackObs = new ObservableBoolean(src.deathbackEnabled, {
    clientWritable: true,
  });
  const toolModeObs = new ObservableNumber(src.toolModeIdx, {
    clientWritable: true,
  });
  const gravesObs = new ObservableBoolean(src.gravestonesEnabled, {
    clientWritable: true,
  });
  const safeZoneObs = new ObservableBoolean(src.graveSafeZone, {
    clientWritable: true,
  });
  const afkEnabledObs = new ObservableBoolean(src.afkEnabled, {
    clientWritable: true,
  });
  const afkWarnObs = new ObservableNumber(src.afkWarnMinutes, {
    clientWritable: true,
  });
  const afkKickEnabledObs = new ObservableBoolean(src.afkKickEnabled, {
    clientWritable: true,
  });
  const afkKickMinObs = new ObservableNumber(src.afkKickMinutes, {
    clientWritable: true,
  });
  const afkExemptObs = new ObservableBoolean(src.afkExemptStaff, {
    clientWritable: true,
  });

  const homesMaxShown = new ObservableBoolean(homesEnabledObs.getData());
  const tpaDelayShown = new ObservableBoolean(tpaEnabledObs.getData());
  const graveSafeShown = new ObservableBoolean(gravesObs.getData());
  const afkShown = new ObservableBoolean(afkEnabledObs.getData());
  const afkKickShown = new ObservableBoolean(
    afkEnabledObs.getData() && afkKickEnabledObs.getData(),
  );
  const recompute = () => {
    homesMaxShown.setData(homesEnabledObs.getData());
    tpaDelayShown.setData(tpaEnabledObs.getData());
    // The safe-zone bubble only matters when gravestones exist, so hide it
    // (and its note) whenever gravestones are turned off.
    graveSafeShown.setData(gravesObs.getData());
    afkShown.setData(afkEnabledObs.getData());
    afkKickShown.setData(
      afkEnabledObs.getData() && afkKickEnabledObs.getData(),
    );
  };
  recompute();
  homesEnabledObs.subscribe(recompute);
  tpaEnabledObs.subscribe(recompute);
  gravesObs.subscribe(recompute);
  afkEnabledObs.subscribe(recompute);
  afkKickEnabledObs.subscribe(recompute);

  const toolItems = [
    { label: t("jm_at.adm.cfg_tools_none"), value: 0 },
    { label: t("jm_at.adm.cfg_tools_inventory"), value: 1 },
    { label: t("jm_at.adm.cfg_tools_always"), value: 2 },
  ];

  let pendingNav = null;
  let intent = null;
  const back = () => showControlPanel(player);
  // Carry `override` so a UserBusy bounce on a preserved-edit reopen keeps the
  // edits (on UserBusy no interaction happened, so override still holds them).
  const reopen = () => showPlayerSettings(player, override);
  const snapshot = () =>
    JSON.stringify([
      homesEnabledObs.getData(),
      maxHomesObs.getData(),
      tpaEnabledObs.getData(),
      tpaDelayObs.getData(),
      warnObs.getData(),
      deathbackObs.getData(),
      toolModeObs.getData(),
      gravesObs.getData(),
      safeZoneObs.getData(),
      afkEnabledObs.getData(),
      afkWarnObs.getData(),
      afkKickEnabledObs.getData(),
      afkKickMinObs.getData(),
      afkExemptObs.getData(),
    ]);
  const initial = JSON.stringify(Object.values(saved));

  const form = new CustomForm(player, t("jm_at.adm.idx_config_editor"));
  form.spacer();
  form.header(t("jm_at.adm.cfg_header_homes"));
  form.spacer();
  form.toggle(t("jm_at.adm.cfg_toggle_homes"), homesEnabledObs);
  form.slider(t("jm_at.adm.cfg_slider_max_homes"), maxHomesObs, 1, 50, {
    step: 1,
    visible: homesMaxShown,
  });
  form.spacer();
  form.header(t("jm_at.adm.cfg_header_tpa"));
  form.spacer();
  form.toggle(t("jm_at.adm.cfg_toggle_tpa"), tpaEnabledObs);
  form.slider(t("jm_at.adm.cfg_slider_tpa_delay"), tpaDelayObs, 0, 30, {
    step: 1,
    visible: tpaDelayShown,
  });
  form.spacer();
  form.header(t("jm_at.adm.cfg_header_warnings"));
  form.spacer();
  form.slider(t("jm_at.adm.cfg_slider_warn"), warnObs, 1, 20, { step: 1 });
  form.spacer();
  form.header(t("jm_at.adm.cfg_header_deathback"));
  form.spacer();
  form.toggle(t("jm_at.adm.cfg_toggle_deathback"), deathbackObs);
  form.dropdown(t("jm_at.adm.cfg_dd_tools"), toolModeObs, toolItems);
  form.toggle(t("jm_at.adm.cfg_toggle_graves"), gravesObs);
  form.spacer();
  form.label(t("jm_at.adm.cfg_graves_note"));
  form.spacer();
  form.toggle(t("jm_at.adm.cfg_toggle_grave_safezone"), safeZoneObs, {
    visible: graveSafeShown,
  });
  form.spacer();
  form.label(t("jm_at.adm.cfg_grave_safezone_note"), {
    visible: graveSafeShown,
  });
  form.spacer();
  form.divider();
  form.header(t("jm_at.adm.cfg_header_afk"));
  form.spacer();
  form.toggle(t("jm_at.adm.cfg_toggle_afk"), afkEnabledObs);
  form.slider(t("jm_at.adm.cfg_slider_afk_warn"), afkWarnObs, 1, 30, {
    step: 1,
    visible: afkShown,
  });
  form.toggle(t("jm_at.adm.cfg_toggle_afk_kick"), afkKickEnabledObs, {
    visible: afkShown,
  });
  form.slider(t("jm_at.adm.cfg_slider_afk_kick"), afkKickMinObs, 10, 120, {
    step: 1,
    visible: afkKickShown,
  });
  form.toggle(t("jm_at.adm.cfg_toggle_afk_exempt"), afkExemptObs, {
    visible: afkKickShown,
  });

  const commit = () => {
    const maxHomes = Math.max(
      1,
      Math.min(50, Math.round(maxHomesObs.getData())),
    );
    const tpaDelay = Math.max(
      0,
      Math.min(30, Math.round(tpaDelayObs.getData())),
    );
    const warn = Math.max(1, Math.min(20, Math.round(warnObs.getData())));
    let afkWarn = Math.round(afkWarnObs.getData());
    const afkKickMin = Math.round(afkKickMinObs.getData());
    if (afkWarn >= afkKickMin) afkWarn = Math.max(1, afkKickMin - 5);
    const newGraves = gravesObs.getData();
    mutateCfg((c) =>
      Object.assign(c, {
        homesEnabled: homesEnabledObs.getData(),
        maxHomes,
        tpaEnabled: tpaEnabledObs.getData(),
        tpaDelaySec: tpaDelay,
        warnThreshold: warn,
        deathbackEnabled: deathbackObs.getData(),
        deathbackGiveTools: toolModes[toolModeObs.getData()] ?? "none",
        gravestonesEnabled: newGraves,
        gravestoneSafeZoneEnabled: safeZoneObs.getData(),
        afkEnabled: afkEnabledObs.getData(),
        afkWarnMinutes: afkWarn,
        afkKickEnabled: afkKickEnabledObs.getData(),
        afkKickMinutes: afkKickMin,
        afkExemptStaff: afkExemptObs.getData(),
      }),
    );
    if (newGraves) ensureKeepInventory();
    // Turn graves off → release the lock by turning keepInventory back off, so
    // deaths scatter items the vanilla way again. Only on the actual transition,
    // so an admin who later flips keepInventory back on by hand isn't overridden.
    else if (gravestonesOn) disableKeepInventory();
    logAdmin(
      player,
      "PLAYER_SETTINGS",
      `家园=${homesEnabledObs.getData()} 玩家互传=${tpaEnabledObs.getData()} 死亡返回=${deathbackObs.getData()} 墓碑=${newGraves} 挂机检测=${afkEnabledObs.getData()}`,
    );
    tell(player, t("jm_at.adm.cfg_saved"));
    if (newGraves !== gravestonesOn) {
      tell(
        player,
        t(
          newGraves
            ? "jm_at.adm.cfg_graves_enabled"
            : "jm_at.adm.cfg_graves_disabled",
        ),
      );
    }
    pendingNav = back;
    try {
      form.close();
    } catch {}
  };

  const saveClose = () => {
    commit();
    if (pendingNav) pendingNav = () => {};
  };
  form.spacer();
  form.button(t("jm_at.common.btn_save"), commit);
  form.button(t("jm_at.cl.btn_save_close"), saveClose);
  form.button(t("jm_at.common.btn_back"), () => {
    intent = "back";
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(reopen);
  }
  if (pendingNav) return system.run(pendingNav);
  // Back → Control Panel; ✕ / engine close / escape → exit to game. If anything
  // changed, confirm first — Keep editing reopens with every control preserved.
  if (snapshot() !== initial) {
    const keep = {
      homesEnabled: homesEnabledObs.getData(),
      maxHomes: maxHomesObs.getData(),
      tpaEnabled: tpaEnabledObs.getData(),
      tpaDelaySec: tpaDelayObs.getData(),
      warnThreshold: warnObs.getData(),
      deathbackEnabled: deathbackObs.getData(),
      toolModeIdx: toolModeObs.getData(),
      gravestonesEnabled: gravesObs.getData(),
      graveSafeZone: safeZoneObs.getData(),
      afkEnabled: afkEnabledObs.getData(),
      afkWarnMinutes: afkWarnObs.getData(),
      afkKickEnabled: afkKickEnabledObs.getData(),
      afkKickMinutes: afkKickMinObs.getData(),
      afkExemptStaff: afkExemptObs.getData(),
    };
    return system.run(async () => {
      if (await confirmDiscardChanges(player))
        return showPlayerSettings(player, keep);
      if (intent === "back") return back();
    });
  }
  if (intent === "back") return system.run(back);
}

// =========================================================
// Staff & Permissions (Control Panel hub)
// =========================================================

async function showStaffPermissions(player) {
  try {
    requireAdminOrModCan(player, "modPrivileges", "管理团队与权限");
  } catch {
    if (!isOwner(player)) {
      return warnForm(player, t("jm_at.adm.sp_no_perm"), () =>
        showControlPanel(player),
      );
    }
  }
  const ownerMode = isOwner(player);

  // Owner-only items are hidden from non-owners; Mod Privileges is the only entry
  // a non-owner with the modPrivileges right can reach.
  const actions = [];
  actions.push({
    label: t("jm_at.adm.sp_btn_mod_priv"),
    icon: "textures/ui/jm_at_moderator",
    fn: () => showModPrivileges(player),
  });
  if (ownerMode) {
    actions.push({
      label: t("jm_at.adm.sp_btn_admin_priv"),
      icon: "textures/ui/jm_at_admin",
      fn: () => showAdminPrivileges(player),
    });
    actions.push({
      label: t("jm_at.adm.sp_btn_tag_security"),
      icon: "textures/ui/jm_at_staff_tag",
      fn: () => showStaffTagSecurity(player),
    });
  }

  const form = new ActionFormData()
    .title(t("jm_at.adm.idx_staff_permissions"))
    .body(t("jm_at.adm.sp_body"));
  for (const a of actions) form.button(a.label, a.icon);
  form.button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back");
  form.button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showControlPanel(player); // X = Back
  if (res.selection === actions.length) return showControlPanel(player); // Back
  if (res.selection === actions.length + 1) return; // Close
  if (res.selection >= 0 && res.selection < actions.length)
    return actions[res.selection].fn();
}

// =========================================================
// Staff Tag Security (owner only) — controls whether vanilla admin/mod tags are
// trusted to grant staff (#5). Lenient (default) keeps /tag grants working and
// announces new ones; Strict strips tags not granted through the UI on join.
// =========================================================

async function showStaffTagSecurity(player) {
  if (!isOwner(player)) {
    return warnForm(player, t("jm_at.adm.sts_owner_only"), () =>
      showStaffPermissions(player),
    );
  }
  const strict = getCfg().strictStaffTags === true;
  const form = new ActionFormData()
    .title(t("jm_at.adm.idx_staff_tag_security"))
    .body(
      t(
        "jm_at.adm.sts_body",
        t(strict ? "jm_at.adm.sts_strict" : "jm_at.adm.sts_lenient"),
      ),
    )
    .button(
      t(strict ? "jm_at.adm.sts_btn_lenient" : "jm_at.adm.sts_btn_strict"),
      strict ? "textures/ui/jm_at_unban" : "textures/ui/jm_at_ban",
    )
    .button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back")
    .button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showStaffPermissions(player); // X = Back
  if (res.selection === 0) {
    const now = !strict;
    mutateCfg((c) => {
      c.strictStaffTags = now;
    });
    logAdmin(player, "STAFF_TAG_MODE", now ? "strict" : "lenient");
    tell(
      player,
      t(now ? "jm_at.adm.sts_set_strict" : "jm_at.adm.sts_set_lenient"),
    );
    return showStaffTagSecurity(player);
  }
  if (res.selection === 1) return showStaffPermissions(player); // Back
  return; // Close
}

// =========================================================
// Mod Privileges
// =========================================================

// Section values were "§l§2..." historically, but the header control strips §
// codes anyway — so the lang values are the plain stripped text.
const MOD_PRIV_KEYS = [
  // Player actions
  {
    key: "warn",
    label: t("jm_at.adm.btn_warn_plain"),
    section: t("jm_at.adm.priv_sec_player_actions"),
  },
  { key: "kick", label: t("jm_at.adm.btn_kick_plain") },
  { key: "tempBan", label: t("jm_at.adm.priv_tempBan") },
  { key: "freeze", label: t("jm_at.adm.priv_freeze") },
  { key: "heal", label: t("jm_at.adm.priv_heal") },
  { key: "feed", label: t("jm_at.adm.priv_feed") },
  { key: "gamemode", label: t("jm_at.adm.priv_gamemode") },
  { key: "tpToPlayer", label: t("jm_at.adm.tp_to_title") },
  { key: "summon", label: t("jm_at.adm.summon_title") },
  { key: "spyCamera", label: t("jm_at.adm.priv_spyCamera") },
  // Inventory & moderation
  {
    key: "viewInventory",
    label: t("jm_at.adm.priv_viewInventory"),
    section: t("jm_at.adm.priv_sec_inventory"),
  },
  { key: "clearInventory", label: t("jm_at.adm.inv_clear_title") },
  { key: "punishmentHistory", label: t("jm_at.adm.priv_punishmentHistory") },
  { key: "claimBypass", label: t("jm_at.adm.priv_claimBypass") },
  { key: "adminClaimBypass", label: t("jm_at.adm.priv_adminClaimBypass") },
  { key: "adminNotes", label: t("jm_at.adm.priv_adminNotes") },
  { key: "homes", label: t("jm_at.adm.priv_homes") },
  // Panels
  {
    key: "tickets",
    label: t("jm_at.adm.idx_tickets"),
    section: t("jm_at.adm.priv_sec_panels"),
  },
  { key: "commands", label: t("jm_at.adm.priv_commands") },
  { key: "commandButtons", label: t("jm_at.adm.priv_command_buttons") },
  { key: "gameCommands", label: t("jm_at.adm.idx_game_commands") },
  { key: "gameRules", label: t("jm_at.adm.gr_title") },
  { key: "warps", label: t("jm_at.adm.idx_warps") },
  { key: "broadcasts", label: t("jm_at.adm.idx_broadcasts") },
  { key: "kits", label: t("jm_at.adm.priv_kits") },
  { key: "adminLog", label: t("jm_at.adm.priv_adminLog") },
  // Ranks (Players → Rank Manager, and the per-player Rank tab on a profile)
  {
    key: "rankManager",
    label: t("jm_at.adm.idx_rank_manager"),
    section: t("jm_at.adm.priv_sec_ranks"),
  },
  { key: "rankPanel", label: t("jm_at.adm.priv_rankPanel") },
  // Control panel
  {
    key: "serverControls",
    label: t("jm_at.adm.idx_server_controls"),
    section: t("jm_at.adm.idx_control_panel"),
  },
  { key: "ticketSettings", label: t("jm_at.adm.idx_ticket_settings") },
  { key: "dimensionLocks", label: t("jm_at.adm.dl_title") },
  { key: "itemWatch", label: t("jm_at.adm.idx_item_watch") },
  { key: "configEditor", label: t("jm_at.adm.idx_config_editor") },
];

// Admin privileges reuse the full mod catalog plus admin-only powers.
// Owner-controlled; admins default to all-on (see adminCan in permissions.js).
const ADMIN_PRIV_KEYS = [
  ...MOD_PRIV_KEYS,
  {
    key: "permBan",
    label: t("jm_at.adm.priv_permBan"),
    section: t("jm_at.adm.priv_sec_admin_powers"),
  },
  { key: "unban", label: t("jm_at.adm.priv_unban") },
  { key: "offlineModeration", label: t("jm_at.adm.priv_offlineModeration") },
  { key: "claimsAdmin", label: t("jm_at.adm.priv_claimsAdmin") },
  { key: "manageRoles", label: t("jm_at.adm.priv_manageRoles") },
  { key: "modPrivileges", label: t("jm_at.adm.priv_modPrivileges") },
];

/**
 * Shared DDUI privilege toggle grid (Mod/Admin global + per-staff overrides).
 * One toggle per key, grouped by section header; values read straight off the
 * Observables (no formValues index tracking). opts: { title, keys, intro?,
 * valueFor(key), suffixFor?(key), onSave(chosen), back, reopen }.
 */
async function showPrivilegeToggleForm(player, opts, override = null) {
  const { title, keys, intro, valueFor, suffixFor, onSave, back, reopen } =
    opts;
  const obs = {};
  const form = new CustomForm(player, title);
  if (intro) {
    form.label(intro);
    form.spacer();
    form.divider();
  }
  for (const { key, label, section } of keys) {
    if (section) {
      form.spacer();
      form.header(section); // lang values are already code-free plain text
      form.spacer();
    }
    obs[key] = new ObservableBoolean(
      override ? !!override[key] : !!valueFor(key),
      { clientWritable: true },
    );
    const suffix = suffixFor ? suffixFor(key) : "";
    form.toggle(suffix ? raw(label, suffix) : label, obs[key]);
  }

  const snapshot = () => JSON.stringify(keys.map((k) => obs[k.key].getData()));
  // Baseline is the SAVED config (not the seeded form state) so a preserved
  // edit still reads as dirty and re-warns on the next close.
  const initial = JSON.stringify(keys.map((k) => !!valueFor(k.key)));
  let pendingNav = null;
  let intent = null; // "back" | "close"; escape leaves it null → treated as back
  // Always persist in pendingNav; `close` is passed to onSave so it can skip
  // its trailing navigation (return to the previous screen) when closing. The
  // earlier shape put a no-op in pendingNav for "Save & Close", which silently
  // discarded every change. Mirrors showGameRulesPicker / showEditNoteForm.
  const save = (close) => {
    const chosen = {};
    for (const { key } of keys) chosen[key] = obs[key].getData();
    pendingNav = () => onSave(chosen, close);
    try {
      form.close();
    } catch {}
  };
  form.spacer();
  form.button(t("jm_at.common.btn_save"), () => save(false));
  form.button(t("jm_at.cl.btn_save_close"), () => save(true));
  form.button(t("jm_at.common.btn_back"), () => {
    intent = "back";
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    // A preserved-edit reopen (override set) must re-show with the in-progress
    // toggles, not bounce back through the wrapper's saved-state reopen.
    if (override) {
      const current = {};
      for (const { key } of keys) current[key] = obs[key].getData();
      return system.run(() => showPrivilegeToggleForm(player, opts, current));
    }
    return system.run(reopen);
  }
  if (pendingNav) return system.run(pendingNav);
  // Back → previous menu; ✕ / engine close / escape → exit to game. If a toggle
  // changed, confirm first — Keep editing reopens with the in-progress toggles
  // preserved; Discard then backs out (Back) or drops to the game (✕).
  if (snapshot() !== initial) {
    const current = {};
    for (const { key } of keys) current[key] = obs[key].getData();
    return system.run(async () => {
      if (await confirmDiscardChanges(player))
        return showPrivilegeToggleForm(player, opts, current);
      if (intent === "back") return back();
    });
  }
  if (intent === "back") return system.run(back);
}

async function showModPrivileges(player) {
  try {
    requireAdminOrModCan(player, "modPrivileges", "协管员权限");
  } catch {
    return warnForm(player, t("jm_at.adm.priv_no_perm_mod"), () =>
      showStaffPermissions(player),
    );
  }
  const priv = getCfg().modPrivileges ?? {};
  return showPrivilegeToggleForm(player, {
    title: t("jm_at.adm.idx_mod_privileges"),
    keys: MOD_PRIV_KEYS,
    valueFor: (key) => priv[key] ?? MOD_PRIV_DEFAULT_ON.has(key),
    back: () => showStaffPermissions(player),
    reopen: () => showModPrivileges(player),
    onSave: (chosen, close) => {
      mutateCfg((c) => {
        c.modPrivileges = chosen;
      });
      logAdmin(player, "MOD_PRIVILEGES_UPDATE", JSON.stringify(chosen));
      tell(player, t("jm_at.adm.priv_mod_updated"));
      return close ? undefined : showStaffPermissions(player);
    },
  });
}

// =========================================================
// Admin Privileges (owner only — global defaults for all admins)
// =========================================================

async function showAdminPrivileges(player) {
  if (!isOwner(player)) {
    return warnForm(player, t("jm_at.adm.priv_owner_only_admin"), () =>
      showStaffPermissions(player),
    );
  }
  const priv = getCfg().adminPrivileges ?? {};
  return showPrivilegeToggleForm(player, {
    title: t("jm_at.adm.idx_admin_privileges"),
    intro: t("jm_at.adm.priv_admin_intro"),
    keys: ADMIN_PRIV_KEYS,
    valueFor: (key) => priv[key] ?? true,
    back: () => showStaffPermissions(player),
    reopen: () => showAdminPrivileges(player),
    onSave: (chosen, close) => {
      mutateCfg((c) => {
        c.adminPrivileges = chosen;
      });
      logAdmin(player, "ADMIN_PRIVILEGES_UPDATE", JSON.stringify(chosen));
      tell(player, t("jm_at.adm.priv_admin_updated"));
      return close ? undefined : showStaffPermissions(player);
    },
  });
}

// =========================================================
// Per-Admin Privilege Overrides (owner only, from player actions)
// =========================================================

async function showAdminOverrides(admin, targetXuid, targetName, backFn) {
  if (!isOwner(admin)) {
    return warnForm(admin, t("jm_at.adm.priv_owner_only_admin"), () =>
      backFn(),
    );
  }
  const globalPriv = getCfg().adminPrivileges ?? {};
  const overrides = getAdminOverrides(targetXuid) ?? {};
  return showPrivilegeToggleForm(admin, {
    title: t("jm_at.adm.priv_admin_overrides_title", targetName),
    keys: ADMIN_PRIV_KEYS,
    valueFor: (key) => {
      const globalVal = key in globalPriv ? !!globalPriv[key] : true;
      return key in overrides ? !!overrides[key] : globalVal;
    },
    suffixFor: (key) =>
      key in overrides ? t("jm_at.adm.priv_override_suffix") : "",
    back: () => backFn(),
    reopen: () => showAdminOverrides(admin, targetXuid, targetName, backFn),
    onSave: (chosen, close) => {
      const newOverrides = {};
      for (const { key } of ADMIN_PRIV_KEYS) {
        const globalVal = key in globalPriv ? !!globalPriv[key] : true;
        if (chosen[key] !== globalVal) newOverrides[key] = chosen[key];
      }
      setAdminOverrides(targetXuid, newOverrides);
      logAdmin(
        admin,
        "ADMIN_OVERRIDES",
        JSON.stringify(newOverrides),
        targetName,
      );
      tell(admin, t("jm_at.adm.priv_admin_overrides_updated", targetName));
      return close ? undefined : backFn();
    },
  });
}

// =========================================================
// Per-Mod Privilege Overrides (from player actions)
// =========================================================

async function showModOverrides(admin, targetXuid, targetName, backFn) {
  try {
    requireAdminOrModCan(admin, "modPrivileges", "协管员单独权限");
  } catch {
    return warnForm(admin, t("jm_at.adm.priv_no_perm_mod"), () => backFn());
  }
  const globalPriv = getCfg().modPrivileges ?? {};
  const overrides = getModOverrides(targetXuid) ?? {};
  return showPrivilegeToggleForm(admin, {
    title: t("jm_at.adm.priv_mod_overrides_title", targetName),
    keys: MOD_PRIV_KEYS,
    valueFor: (key) => {
      const globalVal =
        key in globalPriv ? !!globalPriv[key] : MOD_PRIV_DEFAULT_ON.has(key);
      return key in overrides ? !!overrides[key] : globalVal;
    },
    suffixFor: (key) =>
      key in overrides ? t("jm_at.adm.priv_override_suffix") : "",
    back: () => backFn(),
    reopen: () => showModOverrides(admin, targetXuid, targetName, backFn),
    onSave: (chosen, close) => {
      const newOverrides = {};
      for (const { key } of MOD_PRIV_KEYS) {
        const globalVal =
          key in globalPriv ? !!globalPriv[key] : MOD_PRIV_DEFAULT_ON.has(key);
        if (chosen[key] !== globalVal) newOverrides[key] = chosen[key];
      }
      setModOverrides(targetXuid, newOverrides);
      logAdmin(
        admin,
        "MOD_OVERRIDES",
        JSON.stringify(newOverrides),
        targetName,
      );
      tell(admin, t("jm_at.adm.priv_mod_overrides_updated", targetName));
      return close ? undefined : backFn();
    },
  });
}

// =========================================================
// Menu Customization (per-player + owner-layer editor)
// =========================================================

/**
 * Map a sub-button MENU_KEYS value to the closure that runs when its promoted
 * shortcut is clicked from the main admin panel. Returns null for unknown keys.
 *
 * Note: each closure invokes the sub-button's existing function as-is, which
 * means the function's own back-navigation goes to its original submenu (not
 * the main panel). That's a deliberate trade-off — the sub-button functions
 * weren't built to be re-rooted.
 */
function _promotedActionFor(player, key) {
  switch (key) {
    // Players
    case MENU_KEYS.PLAYERS_ONLINE:
      return () => showOnlinePlayers(player);
    case MENU_KEYS.PLAYERS_OFFLINE:
      return () => showOfflinePlayersList(player);
    case MENU_KEYS.PLAYERS_SEARCH:
      return () => showSearchPlayer(player);
    case MENU_KEYS.PLAYERS_RANKMGR:
      return () => showRankManager(player);

    // Teleport
    case MENU_KEYS.TELEPORT_TP:
      return () => showTpToPlayerPicker(player);
    case MENU_KEYS.TELEPORT_SUMMON:
      return () => showSummonPlayerPicker(player);
    case MENU_KEYS.TELEPORT_WARP:
      return () => showTpPlayerToWarpPicker(player);

    // Control Panel
    case MENU_KEYS.CONTROL_CONFIG:
      return () => showPlayerSettings(player);
    case MENU_KEYS.CONTROL_ITEMWATCH:
      return () => showItemWatch(player);
    case MENU_KEYS.CONTROL_TICKETSET:
      return () => showTicketSettings(player);
    case MENU_KEYS.CONTROL_DIMLOCKS:
      return () => showDimensionLocks(player);
    case MENU_KEYS.CONTROL_SERVERCTL:
      return () => showServerControls(player);
    case MENU_KEYS.CONTROL_HOLOGRAMS:
      return () => showHologramRestore(player);

    // Warps Admin
    case MENU_KEYS.WARPS_ADD:
      return () => _doAddWarpFlow(player);
    case MENU_KEYS.WARPS_REMOVE:
      return () => _doRemoveWarpFlow(player);
    case MENU_KEYS.WARPS_STAFFONLY:
      return () => _doSetWarpAccessFlow(player);
    case MENU_KEYS.WARPS_REORDER:
      return () => showWarpReorder(player);
    case MENU_KEYS.WARPS_VISIBILITY:
      return () => _doToggleWarpsVisibilityFlow(player);

    // Broadcasts
    case MENU_KEYS.BC_IMMEDIATE:
      return () => _doSendImmediateBroadcastFlow(player);
    case MENU_KEYS.BC_ADD_SCHED:
      return () => _doAddScheduledBroadcastFlow(player);
    case MENU_KEYS.BC_MANAGE_SCHED:
      return () => showManageScheduledBroadcasts(player);

    default:
      return null;
  }
}

async function showCustomizeMenu(player, override = null) {
  // No extra gate — anyone with isStaff (the gate that opens the panel) can use this.
  const rows = getCustomizableRowsForPlayer(player);
  const hiddenTop = getHiddenTopSet(player);
  const promoted = getPromotedSet(player);

  if (rows.length === 0) {
    const f = new ActionFormData()
      .title(t("jm_at.adm.cm_title"))
      .body(t("jm_at.adm.cm_none"))
      .button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back")
      .button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);
    const fRes = await f.show(player);
    if (fRes.canceled) return showAdminPanel(player); // X = Back
    if (fRes.selection === 1) return; // Close
    return showAdminPanel(player); // Back
  }

  // Split rows into their two semantic groups so each renders under its own
  // labeled section. Values read straight off Observables (no index tracking).
  //   topRows  → hide/show top-level admin panel buttons (default visible)
  //   subRows  → promote sub-menu buttons as shortcuts on the main page (default off)
  const topRows = rows.filter((m) => m.topLevel);
  const subRows = rows.filter((m) => !m.topLevel);

  const topObs = topRows.map(
    (m, i) =>
      new ObservableBoolean(
        override ? !!override.top[i] : !hiddenTop.has(m.key),
        { clientWritable: true },
      ),
  );
  const subObs = subRows.map(
    (m, i) =>
      new ObservableBoolean(
        override ? !!override.sub[i] : promoted.has(m.key),
        {
          clientWritable: true,
        },
      ),
  );

  let pendingNav = null;
  let intent = null;
  const back = () => showAdminPanel(player);
  // Carry `override` so a UserBusy bounce on a preserved-edit reopen keeps the
  // edits (on UserBusy no interaction happened, so override still holds them).
  const reopen = () => showCustomizeMenu(player, override);
  const snapshot = () =>
    JSON.stringify([
      topObs.map((o) => o.getData()),
      subObs.map((o) => o.getData()),
    ]);
  // Baseline = saved prefs (not the seeded form state) so a preserved edit still
  // reads as dirty and re-warns on the next close.
  const initial = JSON.stringify([
    topRows.map((m) => !hiddenTop.has(m.key)),
    subRows.map((m) => promoted.has(m.key)),
  ]);

  const form = new CustomForm(player, t("jm_at.adm.cm_title"));
  if (topRows.length > 0) {
    form.spacer();
    form.header(t("jm_at.adm.cm_header_main"));
    form.spacer();
    form.label(t("jm_at.adm.cm_main_note"));
    form.spacer();
    topRows.forEach((m, i) =>
      form.toggle(t("jm_at.adm.cm_show_quoted", t(m.labelKey)), topObs[i]),
    );
  }
  if (subRows.length > 0) {
    form.spacer();
    form.header(t("jm_at.adm.cm_header_shortcuts"));
    form.spacer();
    form.label(t("jm_at.adm.cm_shortcuts_note"));
    form.spacer();
    subRows.forEach((m, i) => form.toggle(t(m.labelKey), subObs[i]));
  }

  const commit = () => {
    // Preserve dead-data entries for keys the player can't currently see (e.g.
    // recently lost a perm) so they reactivate if the perm comes back. The
    // setters filter truly-unknown keys.
    const nextHiddenTop = new Set(hiddenTop);
    const nextPromoted = new Set(promoted);
    topRows.forEach((m, i) => {
      if (topObs[i].getData()) nextHiddenTop.delete(m.key);
      else nextHiddenTop.add(m.key);
    });
    subRows.forEach((m, i) => {
      if (subObs[i].getData()) nextPromoted.add(m.key);
      else nextPromoted.delete(m.key);
    });
    setHiddenTopSet(player, nextHiddenTop);
    setPromotedSet(player, nextPromoted);
    tell(player, t("jm_at.adm.cm_saved"));
    pendingNav = back;
    try {
      form.close();
    } catch {}
  };

  const saveClose = () => {
    commit();
    if (pendingNav) pendingNav = () => {};
  };
  form.spacer();
  form.button(t("jm_at.common.btn_save"), commit);
  form.button(t("jm_at.cl.btn_save_close"), saveClose);
  form.button(t("jm_at.adm.cm_btn_reset"), () => {
    pendingNav = () => {
      resetPlayerMenuPrefs(player);
      tell(player, t("jm_at.adm.cm_reset_done"));
      return showAdminPanel(player);
    };
    try {
      form.close();
    } catch {}
  });
  form.button(t("jm_at.common.btn_back"), () => {
    intent = "back";
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(reopen);
  }
  if (pendingNav) return system.run(pendingNav);
  // Back → admin panel; ✕ / engine close / escape → exit to game. If a toggle
  // changed, confirm first — Keep editing reopens with the toggles preserved.
  if (snapshot() !== initial) {
    const keep = {
      top: topObs.map((o) => o.getData()),
      sub: subObs.map((o) => o.getData()),
    };
    return system.run(async () => {
      if (await confirmDiscardChanges(player))
        return showCustomizeMenu(player, keep);
      if (intent === "back") return back();
    });
  }
  if (intent === "back") return system.run(back);
}

// Player-facing menu features and the cfg flag each one is bound to. Toggling a
// flag here is identical to enabling/disabling that feature from its own admin
// section (same flag), so the two stay in sync automatically. `priv` is the
// privilege that already controls that feature — a toggle is shown only to staff
// who hold it (the owner holds everything).
const PLAYER_MENU_FEATURES = [
  {
    label: t("jm_at.adm.pmf_tickets"),
    flag: "ticketsVisible",
    priv: "ticketSettings",
  },
  {
    label: t("jm_at.adm.pmf_homes"),
    flag: "homesEnabled",
    priv: "configEditor",
  },
  {
    label: t("jm_at.adm.idx_teleport"),
    flag: "tpaEnabled",
    priv: "configEditor",
  },
  {
    label: t("jm_at.adm.pmf_deathback"),
    flag: "deathbackEnabled",
    priv: "configEditor",
  },
  { label: t("jm_at.adm.idx_warps"), flag: "warpsVisible", priv: "warps" },
  { label: t("jm_at.adm.pmf_kits"), flag: "kitsVisible", priv: "kits" },
];

async function showMenuVisibilityEditor(player, override = null) {
  const ownerMode = isOwner(player);
  const cfg = getCfg();

  // Which player-feature toggles this staff member may edit (owner = all).
  const playerDefs = PLAYER_MENU_FEATURES.filter(
    (d) => ownerMode || modCan(player, d.priv),
  );

  if (!ownerMode && playerDefs.length === 0) {
    return warnForm(player, t("jm_at.adm.mv_no_perm"), () =>
      showControlPanel(player),
    );
  }

  // Values read straight off Observables (no formValues index tracking).
  const adminRows = ownerMode
    ? MENU_BUTTON_META.filter((m) => m.ownerLayer)
    : [];
  const adminObs = adminRows.map(
    (m, i) =>
      new ObservableBoolean(
        override ? !!override.admin[i] : !isOwnerHidden(m.key),
        { clientWritable: true },
      ),
  );
  const staffPermsObs = new ObservableBoolean(
    override
      ? !!override.staffPerms
      : cfg.menuVisibility?.staffPermissions !== false,
    { clientWritable: true },
  );
  const playerObs = playerDefs.map(
    (d, i) =>
      new ObservableBoolean(
        override ? !!override.player[i] : cfg[d.flag] !== false,
        { clientWritable: true },
      ),
  );

  let pendingNav = null;
  let intent = null;
  const back = () => showControlPanel(player);
  // Carry `override` so a UserBusy bounce on a preserved-edit reopen keeps the
  // edits (on UserBusy no interaction happened, so override still holds them).
  const reopen = () => showMenuVisibilityEditor(player, override);
  const snapshot = () =>
    JSON.stringify([
      ownerMode ? adminObs.map((o) => o.getData()) : [],
      ownerMode ? staffPermsObs.getData() : null,
      playerObs.map((o) => o.getData()),
    ]);
  // Baseline = SAVED visibility (not the seeded form state) so a preserved edit
  // still reads as dirty and re-warns on the next close.
  const initial = JSON.stringify([
    ownerMode ? adminRows.map((m) => !isOwnerHidden(m.key)) : [],
    ownerMode ? cfg.menuVisibility?.staffPermissions !== false : null,
    playerDefs.map((d) => cfg[d.flag] !== false),
  ]);

  const form = new CustomForm(player, t("jm_at.adm.idx_menu_visibility"));
  if (ownerMode) {
    form.spacer();
    form.header(t("jm_at.adm.mv_header_admin"));
    form.spacer();
    adminRows.forEach((m, i) =>
      form.toggle(t("jm_at.adm.cm_show_quoted", t(m.labelKey)), adminObs[i]),
    );
    form.toggle(
      t("jm_at.adm.cm_show_quoted", t("jm_at.adm.idx_staff_permissions")),
      staffPermsObs,
    );
    form.divider();
  }
  form.spacer();
  form.header(t("jm_at.adm.mv_header_player"));
  form.spacer();
  playerDefs.forEach((d, i) =>
    form.toggle(t("jm_at.adm.cm_show_quoted", d.label), playerObs[i]),
  );

  const commit = () => {
    // Apply everything in one getCfg/setCfg cycle to avoid clobbering.
    const cfg2 = getCfg();
    const vis = { ...(cfg2.menuVisibility ?? {}) };
    const hidden = [];
    if (ownerMode) {
      adminRows.forEach((m, i) => {
        if (adminObs[i].getData()) delete vis[m.key];
        else {
          vis[m.key] = false;
          hidden.push(m.key);
        }
      });
      if (staffPermsObs.getData()) delete vis.staffPermissions;
      else {
        vis.staffPermissions = false;
        hidden.push("staffPermissions");
      }
    }
    playerDefs.forEach((d, i) => {
      const on = playerObs[i].getData();
      cfg2[d.flag] = on;
      if (!on) hidden.push(d.flag);
    });
    cfg2.menuVisibility = vis;
    setCfg(cfg2);
    logAdmin(
      player,
      "MENU_VIS_UPDATE",
      hidden.length ? `hidden=${hidden.join(",")}` : "全部显示",
    );
    tell(player, t("jm_at.adm.mv_updated"));
    pendingNav = back;
    try {
      form.close();
    } catch {}
  };

  const saveClose = () => {
    commit();
    if (pendingNav) pendingNav = () => {};
  };
  form.spacer();
  form.button(t("jm_at.common.btn_save"), commit);
  form.button(t("jm_at.cl.btn_save_close"), saveClose);
  if (ownerMode) {
    form.button(t("jm_at.adm.mv_btn_reset"), () => {
      pendingNav = () => {
        resetOwnerMenuVisibility();
        logAdmin(player, "MENU_VIS_RESET", "所有管理按钮均显示");
        tell(player, t("jm_at.adm.mv_reset_done"));
        return showControlPanel(player);
      };
      try {
        form.close();
      } catch {}
    });
  }
  form.button(t("jm_at.common.btn_back"), () => {
    intent = "back";
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(reopen);
  }
  if (pendingNav) return system.run(pendingNav);
  // Back → Control Panel; ✕ / engine close / escape → exit to game. If a toggle
  // changed, confirm first — Keep editing reopens with the toggles preserved.
  if (snapshot() !== initial) {
    const keep = {
      admin: adminObs.map((o) => o.getData()),
      staffPerms: staffPermsObs.getData(),
      player: playerObs.map((o) => o.getData()),
    };
    return system.run(async () => {
      if (await confirmDiscardChanges(player))
        return showMenuVisibilityEditor(player, keep);
      if (intent === "back") return back();
    });
  }
  if (intent === "back") return system.run(back);
}
