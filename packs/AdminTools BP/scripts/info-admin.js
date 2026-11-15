/**
 * Admin-facing info pages and current-settings summaries.
 * Kept separate from ui-admin.js so the long help pages are easier to edit.
 */

// Status/plural keys picked via ternaries throughout this file.
// lang-keys: jm_at.infoa.st_* jm_at.infoa.fmt_days_one jm_at.infoa.fmt_days_many jm_at.infoa.results_found_one jm_at.infoa.results_found_many
import {
  ActionFormData,
  CustomForm,
  ObservableString,
  ObservableBoolean,
  DataDrivenScreenClosedReason,
} from "@minecraft/server-ui";
import { system } from "@minecraft/server";
import { CLOSE_BTN_LABEL, CLOSE_BTN_ICON, clampText } from "./utils.js";
import { t, raw } from "./i18n.js";
import { getCfg } from "./storage.js";
import { getItemWatchCfg } from "./item-watch.js";
import { getRankDb } from "./rank-db.js";
import {
  searchScore,
  findClosestKeyword,
  planResultView,
} from "./search-utils.js";
import { localizedIndex } from "./search-locale.js";
import { localizedResultRow } from "./search-display.js";
import { PROTECTION_DEFS, FEATURES } from "./constants.js";

// Display labels are lang keys; the protection keys come from PROTECTION_DEFS.
// lang-keys: jm_at.infoa.flag_*
const CLAIM_FLAG_LABELS = [
  ...PROTECTION_DEFS.map(({ key }) => ({
    key,
    labelKey: `jm_at.infoa.flag_${key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}`,
  })),
  { key: "adjustHeight", labelKey: "jm_at.infoa.flag_adjust_height" },
];

// =========================================================
// Fuzzy search helpers.
// =========================================================

/**
 * Search index for admin info pages.
 * key routes to a page, terms are keywords/synonyms.
 * `label` MUST stay a plain English string: the engine (search-utils.js)
 * matches, ranks, and formats against it. `labelKey` is the translated
 * display label, applied only when the result button is rendered.
 */
// lang-keys: jm_at.infoa.idx_*
const SEARCH_INDEX = [
  // Main info pages.
  {
    key: "tickets",
    label: "Tickets & Players",
    labelKey: "jm_at.infoa.idx_tickets",
    terms:
      "ticket tickets submit report player players profile online offline search ban kick warn warning appeal punishment history spy notes rank admin note cooldown category categories claim resolve close delete lifecycle open claimed resolved closed tabs support staff teleport manage limit status grief moderation reply nametag",
    path: "",
  },
  {
    key: "actions",
    label: "Actions & Moderation",
    labelKey: "jm_at.infoa.idx_actions",
    terms:
      "kick ban temp perm permanent unban warn freeze heal feed teleport summon spy camera inventory clear gamemode moderator privilege privileges actions moderation orbit spectate health hunger armor ender chest enderchest take remove item items live edit hotbar assign remove bypass mount parrot tpa last location banned tempban permaban pardon appeal warnings frozen jail admin permissions promote demote grant revoke offline staff role op claim",
    path: "",
  },
  {
    key: "server",
    label: "Server & Controls",
    labelKey: "jm_at.infoa.idx_server",
    terms:
      "server lock unlock whitelist nether end dimension control panel config editor staff permissions menu visibility mod privileges admin privileges gamemode access homes teleport deathback death afk idle commands command warp warps settings cooldown delay cheats restore item watch banned tracked threshold alert tpa tools-on-death mount parrot customize menu hide show game commands weather time day night noon midnight difficulty peaceful worldspawn world spawn go to spawn game rules gamerule keepinventory keep inventory gravestone gravestones grave graves headstone tombstone items on death loot drops mobgriefing pvp coordinates clear dropped items lock rain thunder storm owner scheduled portal maintenance open clearlag repeating",
    path: "",
  },
  {
    key: "ranks",
    label: "Ranks & Progression",
    labelKey: "jm_at.infoa.idx_ranks",
    terms:
      "rank ranks tag nametag name playtime progression threshold promote promotion bulk assign remove staff admin mod custom database bonus time prefix grant demote offline auto autorank vip",
    path: "",
  },
  {
    key: "broadcasts",
    label: "Broadcasts & Logging",
    labelKey: "jm_at.infoa.idx_broadcasts",
    terms:
      "broadcast broadcasts announcement announce message scheduled recurring color preview log logging action rollcall staff activity storage health capacity session join leave filter interval owner toggle disable hide audit alert notify notification timer auto automatic repeat event timestamp history record track clear moderation login logout settings retention prune limit entries size recording quiet noise reduce",
    path: "",
  },
  {
    key: "holograms",
    label: "Holograms",
    labelKey: "jm_at.infoa.idx_holograms",
    terms:
      "hologram holograms floating text scoreboard leaderboard objective display entity spawn place edit remove restore despawn kill caution performance line lines format color style sort hide offline preset presets comma rows title sign glow ink v2 versioning half-block limit 100 tool create delete position coordinates move preview refresh missing",
    path: "",
  },
  {
    key: "claims",
    label: "Land Claims",
    labelKey: "jm_at.infoa.idx_claims",
    terms:
      "claim claims land protect protection wand viewer sub subclaim sub-claim sub-sub-claim nested nesting depth level district house village zone member trust trusted builder visitor co-owner coowner budget chunk area pvp blocks containers entities explosions hostile mob blacklist whitelist mob whitelist crop trampling fire spread ender pearl eject untrusted transfer rename height owner admin spawn shop arena door button lever trapdoor gate chest barrel hopper armor stand vehicles current claim bypass override delete unclaim abandon expand extend resize region plot grief private config settings default log history earn playtime bonus dimension corner selection rank role expire temporary interact tnt",
    path: "",
  },
  {
    key: "kits",
    label: "Kits",
    labelKey: "jm_at.infoa.idx_kits",
    terms:
      "kit kits kit editor kit tool item bundle starter claimable claim cooldown repeatable once max claims limit rank playtime visibility hidden show locked pin pinned featured give reset manage kits player tool create delete craft permission unlock reward free",
    path: "",
  },
  {
    key: "recipes",
    label: "Recipes",
    labelKey: "jm_at.infoa.idx_recipes",
    terms:
      "recipe recipes craft crafting admin tool player tool claim wand viewer hologram tool kit tool kit editor chest planks log paper redstone stick wool lapis glass sign glow ink sac shapeless table sorter elevator piston iron",
    path: "",
  },
  {
    key: "settings",
    label: "Current Settings",
    labelKey: "jm_at.infoa.idx_settings",
    terms:
      "settings config configuration current value values summary overview read only view show status display readonly",
    path: "",
  },
  {
    key: "access",
    label: "Access & Roles",
    labelKey: "jm_at.infoa.idx_access",
    terms:
      "access role roles permission permissions admin moderator player owner operator tag tier level who can staff privilege override promote demote assign grant transfer ownership",
    path: "",
  },
  // Current Settings sub-pages.
  {
    key: "settings_server",
    label: "Settings: Server & Access",
    labelKey: "jm_at.infoa.idx_settings_server",
    terms:
      "server lock unlock whitelist nether end dimension scheduled gamemode access setting settings config allowlist maintenance close overworld owner privilege",
    path: "Current Settings",
  },
  {
    key: "settings_player",
    label: "Settings: Player Tools",
    labelKey: "jm_at.infoa.idx_settings_player",
    terms:
      "homes max teleport delay deathback tools death warn threshold afk idle kick exempt staff setting settings config warps visibility menu request warnings inventory respawn",
    path: "Current Settings",
  },
  {
    key: "settings_tickets",
    label: "Settings: Tickets",
    labelKey: "jm_at.infoa.idx_settings_tickets",
    terms:
      "ticket ticketing open closed cooldown limit auto delete categories setting settings config category support report request submit visible hide",
    path: "Current Settings",
  },
  {
    key: "settings_claims",
    label: "Settings: Claims",
    labelKey: "jm_at.infoa.idx_settings_claims",
    terms:
      "claim claims max budget area chunk start earned nether end height protections abilities co-owner coowner mob whitelist vehicles setting settings config pvp trust grief explosion container chest block build fire limit cap dimension interact",
    path: "Current Settings",
  },
  {
    key: "settings_ranks",
    label: "Settings: Ranks & Progression",
    labelKey: "jm_at.infoa.idx_settings_ranks",
    terms:
      "rank ranks admin mod tag custom playtime threshold override setting settings config staff moderator prefix title promote demote hide manual",
    path: "Current Settings",
  },
  {
    key: "settings_monitoring",
    label: "Settings: Monitoring",
    labelKey: "jm_at.infoa.idx_settings_monitoring",
    terms:
      "item watch banned tracked broadcast scheduled monitoring alert threshold log offline flagged detection setting settings config limit quantity amount dupe duplication contraband illegal hoard announce recurring interval notify inventory",
    path: "Current Settings",
  },
];

// =========================================================
// Formatting helpers.
// =========================================================

function _fmtEnabled(value) {
  return t(value ? "jm_at.infoa.st_enabled" : "jm_at.infoa.st_disabled");
}

function _fmtOnOff(value) {
  return t(value ? "jm_at.infoa.st_on" : "jm_at.infoa.st_off");
}

function _fmtOpenClosed(value) {
  return t(value ? "jm_at.infoa.st_open" : "jm_at.infoa.st_closed");
}

function _fmtAllowedBlocked(value) {
  return t(value ? "jm_at.infoa.st_allowed" : "jm_at.infoa.st_blocked");
}

function _fmtYesNo(value) {
  return t(value ? "jm_at.infoa.st_yes" : "jm_at.infoa.st_no");
}

function _fmtMinutes(minutes) {
  const total = Math.max(0, Math.floor(minutes ?? 0));
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const mins = total % 60;
  const parts = [];
  if (days > 0) parts.push(`${days}天`);
  if (hours > 0) parts.push(`${hours}小时`);
  if (mins > 0 || parts.length === 0) parts.push(`${mins}分钟`);
  return parts.join(" ");
}

function _fmtSeconds(seconds) {
  const total = Math.max(0, Math.floor(seconds ?? 0));
  if (total === 0) return t("jm_at.infoa.st_instant");
  if (total < 60) return `${total}秒`;
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return secs > 0 ? `${mins}分钟 ${secs}秒` : `${mins}分钟`;
}

function _fmtDays(days) {
  const total = Math.max(0, Math.floor(days ?? 0));
  if (total === 0) return t("jm_at.infoa.st_off");
  return t(
    total === 1 ? "jm_at.infoa.fmt_days_one" : "jm_at.infoa.fmt_days_many",
    total,
  );
}

/** Join values (strings or RawMessages) as a §9-colored comma list. */
function _fmtCsv(values, noneText) {
  const list = (values ?? []).filter((value) => !!value);
  if (!list.length) return noneText ?? t("jm_at.infoa.fmt_none_configured");
  const parts = ["§9"];
  list.forEach((value, i) => {
    if (i) parts.push("§r, §9");
    parts.push(value);
  });
  parts.push("§r");
  return raw(...parts);
}

function _fmtBulletList(values, noneText) {
  const list = (values ?? []).filter((value) => !!value);
  if (!list.length) return noneText ?? t("jm_at.infoa.fmt_none_configured");
  const parts = [];
  list.forEach((value, i) => {
    if (i) parts.push("\n");
    parts.push("• ", value);
  });
  return raw(...parts);
}

function _fmtClaimFlags(flags) {
  const enabled = CLAIM_FLAG_LABELS.filter(({ key }) => flags?.[key]).map(
    ({ labelKey }) => t(labelKey),
  );
  return _fmtCsv(enabled, t("jm_at.infoa.fmt_none_enabled"));
}

function _fmtThresholdTime(minutes) {
  return _fmtMinutes(minutes);
}

function _fmtPlaytimeThresholds(thresholds, rankDb) {
  if (!thresholds?.length) return t("jm_at.infoa.fmt_none_configured");
  const parts = [];
  thresholds.forEach((threshold, i) => {
    if (i) parts.push("\n");
    const tag =
      rankDb?.[threshold.rankName]?.tag ??
      t("jm_at.infoa.fmt_deleted_rank", threshold.rankName);
    parts.push(`• ${_fmtThresholdTime(threshold.minutes)} → `, tag);
  });
  return raw(...parts);
}

function _fmtTrackedItems(tracked) {
  const entries = Object.entries(tracked ?? {}).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  if (!entries.length) return t("jm_at.infoa.fmt_none_configured");
  return entries.map(([itemId, qty]) => `• ${itemId} >= ${qty}`).join("\n");
}

function _settingLine(label, value, path) {
  return t("jm_at.infoa.setting_line", label, value, path);
}

function _settingBlock(label, valueLines, path) {
  return t("jm_at.infoa.setting_block", label, valueLines, path);
}

/** Join body lines (strings or RawMessages) with newlines. */
function _joinLines(lines) {
  const parts = [];
  lines.forEach((line, i) => {
    if (i) parts.push("\n");
    if (line !== "") parts.push(line);
  });
  return raw(...parts);
}

async function _showReadOnlyInfoPage(player, title, body, backFn) {
  const form = new ActionFormData()
    .title(title)
    .body(body)
    .button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back")
    .button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return backFn(); // X = Back
  if (res.selection === 0) return backFn();
  // Close.
}

/** Admin Panel info hub. */
export async function showAdminInfo(player, backToPanel) {
  const kitsLive = FEATURES.kits && getCfg().kitsEnabled !== false;

  // Keep labels and handlers together so optional Kits stays aligned.
  const entries = [
    {
      label: t("jm_at.infoa.hub_btn_search"),
      icon: "textures/ui/jm_at_search_info",
      fn: () => showSearchInfo(player, backToPanel),
    },
    {
      label: t("jm_at.infoa.hub_btn_settings"),
      icon: "textures/ui/jm_at_control_panel",
      fn: () => showCurrentSettingsHub(player, backToPanel),
    },
    {
      label: t("jm_at.infoa.hub_btn_access"),
      icon: "textures/ui/jm_at_players",
      fn: () => showAccessRolesInfo(player, backToPanel),
    },
    {
      label: t("jm_at.infoa.hub_btn_actions"),
      icon: "textures/ui/jm_at_actions",
      fn: () => showActionsModerationInfo(player, backToPanel),
    },
    {
      label: t("jm_at.infoa.hub_btn_server"),
      icon: "textures/ui/jm_at_server_controls",
      fn: () => showServerControlsInfo(player, backToPanel),
    },
    {
      label: t("jm_at.infoa.hub_btn_tickets"),
      icon: "textures/ui/jm_at_tickets",
      fn: () => showTicketsPlayersInfo(player, backToPanel),
    },
    {
      label: t("jm_at.infoa.hub_btn_ranks"),
      icon: "textures/ui/jm_at_rank_manager",
      fn: () => showRanksProgressionInfo(player, backToPanel),
    },
    {
      label: t("jm_at.infoa.hub_btn_holograms"),
      icon: "textures/ui/jm_at_hologram_tool",
      fn: () => showHologramsInfo(player, backToPanel),
    },
    {
      label: t("jm_at.infoa.hub_btn_broadcasts"),
      icon: "textures/ui/jm_at_broadcast",
      fn: () => showBroadcastsLoggingInfo(player, backToPanel),
    },
    {
      label: t("jm_at.infoa.hub_btn_claims"),
      icon: "textures/ui/jm_at_my_claims",
      fn: () => showAdminClaimsInfoPage(player, backToPanel),
    },
  ];
  if (kitsLive) {
    entries.push({
      label: t("jm_at.infoa.hub_btn_kits"),
      icon: "textures/ui/jm_at_kit",
      fn: () => showKitsAdminInfo(player, backToPanel),
    });
  }
  entries.push({
    label: t("jm_at.infoa.hub_btn_recipes"),
    icon: "textures/ui/jm_at_recipes",
    fn: () => showAdminRecipePage(player, backToPanel),
  });

  const form = new ActionFormData()
    .title(t("jm_at.infoa.hub_title"))
    .body(t("jm_at.infoa.hub_body"));
  for (const e of entries) form.button(e.label, e.icon);
  form.button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back");
  form.button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return backToPanel(player); // X = Back
  if (res.selection === entries.length) return backToPanel(player); // Back
  if (res.selection === entries.length + 1) return; // Close
  return entries[res.selection]?.fn();
}

// =========================================================
// Tickets and player management.
// =========================================================

async function showTicketsPlayersInfo(player, backToPanel) {
  const cfg = getCfg();
  const cats = cfg.categories ?? ["Griefing", "Harassment", "Bug", "Other"];
  const autoDelDays = cfg.autoDeleteClosedDays ?? 30;

  const body = t(
    "jm_at.infoa.tickets_body",
    _fmtOpenClosed(cfg.ticketingOpen !== false),
    cfg.ticketLimit ?? 5,
    _fmtSeconds(cfg.submitCooldownSec ?? 120),
    _fmtCsv(cats),
    _fmtDays(autoDelDays),
  );

  const form = new ActionFormData()
    .title(t("jm_at.infoa.tickets_title"))
    .body(body)
    .button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back")
    .button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showAdminInfo(player, backToPanel); // X = Back
  if (res.selection === 0) return showAdminInfo(player, backToPanel);
  return;
}

// =========================================================
// Actions and moderation.
// =========================================================

async function showActionsModerationInfo(player, backToPanel) {
  const cfg = getCfg();
  const privs = cfg.modPrivileges ?? {};
  const enabledCount = Object.values(privs).filter(Boolean).length;
  const totalCount = Object.keys(privs).length;

  const body = t(
    "jm_at.infoa.actions_body",
    cfg.warnThreshold ?? 3,
    enabledCount,
    totalCount,
  );

  const form = new ActionFormData()
    .title(t("jm_at.infoa.actions_title"))
    .body(body)
    .button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back")
    .button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showAdminInfo(player, backToPanel); // X = Back
  if (res.selection === 0) return showAdminInfo(player, backToPanel);
  return;
}

// =========================================================
// Server controls.
// =========================================================

async function showServerControlsInfo(player, backToPanel) {
  const cfg = getCfg();
  const locks = cfg.dimLocks ?? {};

  const afkDetail = cfg.afkEnabled
    ? raw(
        t("jm_at.infoa.server_afk_warn", _fmtMinutes(cfg.afkWarnMinutes ?? 2)),
        cfg.afkKickEnabled
          ? t(
              "jm_at.infoa.server_afk_kick_on",
              _fmtMinutes(cfg.afkKickMinutes ?? 60),
            )
          : t("jm_at.infoa.server_afk_kick_off"),
      )
    : "";

  const body = raw(
    t(
      "jm_at.infoa.server_body_1",
      t(cfg.serverLocked ? "jm_at.infoa.st_locked_caps" : "jm_at.infoa.st_open_plain"),
      _fmtOnOff(cfg.whitelistMode),
      _fmtAllowedBlocked(!locks.nether),
      _fmtAllowedBlocked(!locks.end),
    ),
    t(
      "jm_at.infoa.server_body_2",
      _fmtEnabled(cfg.homesEnabled !== false),
      cfg.maxHomes ?? 3,
      _fmtEnabled(cfg.tpaEnabled !== false),
      _fmtSeconds(cfg.tpaDelaySec ?? 3),
      _fmtEnabled(cfg.deathbackEnabled !== false),
      _fmtEnabled(cfg.afkEnabled ?? true),
    ),
    afkDetail,
    t(
      "jm_at.infoa.server_body_3",
      t(
        cfg.adminPrivileges?.gamemode
          ? "jm_at.infoa.st_all_admins"
          : "jm_at.infoa.st_owner_only",
      ),
    ),
  );

  const form = new ActionFormData()
    .title(t("jm_at.infoa.server_title"))
    .body(body)
    .button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back")
    .button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showAdminInfo(player, backToPanel); // X = Back
  if (res.selection === 0) return showAdminInfo(player, backToPanel);
  return;
}

// =========================================================
// Ranks and progression.
// =========================================================

async function showRanksProgressionInfo(player, backToPanel) {
  const cfg = getCfg();
  const rankDb = getRankDb();
  const rankCount = Object.keys(rankDb).length;
  const thresholdCount = (cfg.playtimeRanks ?? []).length;

  const body = t(
    "jm_at.infoa.ranks_body",
    rankCount,
    cfg.staffAdminTag || t("jm_at.infoa.st_default_admin_tag"),
    cfg.staffModTag || t("jm_at.infoa.st_default_mod_tag"),
    _fmtEnabled(cfg.staffRanksHidden ?? false),
    _fmtEnabled(cfg.staffCustomRanks ?? false),
    _fmtEnabled(cfg.playtimeRanksEnabled ?? false),
    thresholdCount,
    _fmtEnabled(cfg.playtimeRanksOverrideManual ?? false),
  );

  const form = new ActionFormData()
    .title(t("jm_at.infoa.ranks_title"))
    .body(body)
    .button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back")
    .button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showAdminInfo(player, backToPanel); // X = Back
  if (res.selection === 0) return showAdminInfo(player, backToPanel);
  return;
}

// =========================================================
// Broadcasts and logging.
// =========================================================

async function showBroadcastsLoggingInfo(player, backToPanel) {
  const cfg = getCfg();
  const scheduledBroadcasts = cfg.scheduledBroadcasts ?? [];
  const activeBroadcasts = scheduledBroadcasts.filter((b) => b.active).length;

  const body = t(
    "jm_at.infoa.broadcasts_body",
    activeBroadcasts,
    scheduledBroadcasts.length,
  );

  const form = new ActionFormData()
    .title(t("jm_at.infoa.broadcasts_title"))
    .body(body)
    .button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back")
    .button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showAdminInfo(player, backToPanel); // X = Back
  if (res.selection === 0) return showAdminInfo(player, backToPanel);
  return;
}

// =========================================================
// Holograms.
// =========================================================

async function showHologramsInfo(player, backToPanel) {
  const form = new ActionFormData()
    .title(t("jm_at.infoa.holograms_title"))
    .body(t("jm_at.infoa.holograms_body"))
    .button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back")
    .button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showAdminInfo(player, backToPanel); // X = Back
  if (res.selection === 0) return showAdminInfo(player, backToPanel);
  return;
}

// =========================================================
// Crafting recipes.
// =========================================================

async function showKitsAdminInfo(player, backToPanel) {
  const form = new ActionFormData()
    .title(t("jm_at.infoa.kits_title"))
    .body(t("jm_at.infoa.kits_body"))
    .button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back")
    .button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showAdminInfo(player, backToPanel); // X = Back
  if (res.selection === 0) return showAdminInfo(player, backToPanel);
  return; // Close
}

async function showAdminRecipePage(player, backToPanel) {
  const cfg = getCfg();
  const kitBlock =
    FEATURES.kits && cfg.kitsEnabled !== false
      ? t("jm_at.infoa.recipes_kit_block")
      : "";
  const body = t("jm_at.infoa.recipes_body", kitBlock);

  const form = new ActionFormData()
    .title(t("jm_at.infoa.recipes_title"))
    .body(body)
    .button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back")
    .button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showAdminInfo(player, backToPanel); // X = Back
  if (res.selection === 0) return showAdminInfo(player, backToPanel);
  return;
}

// =========================================================
// Search pages.
// =========================================================

/** Route a search result key to its page. */
// Result-button icons, keyed like SEARCH_INDEX (info help pages).
const INFO_SEARCH_ICONS = {
  tickets: "textures/ui/jm_at_tickets",
  actions: "textures/ui/jm_at_actions",
  server: "textures/ui/jm_at_server_controls",
  ranks: "textures/ui/jm_at_rank_manager",
  broadcasts: "textures/ui/jm_at_broadcast",
  holograms: "textures/ui/jm_at_hologram_tool",
  claims: "textures/ui/jm_at_my_claims",
  kits: "textures/ui/jm_at_kit",
  recipes: "textures/ui/jm_at_recipes",
  settings: "textures/ui/jm_at_control_panel",
  access: "textures/ui/jm_at_moderator_controls",
  settings_server: "textures/ui/jm_at_server_controls",
  settings_player: "textures/ui/jm_at_players",
  settings_tickets: "textures/ui/jm_at_ticket_settings",
  settings_claims: "textures/ui/jm_at_my_claims",
  settings_ranks: "textures/ui/jm_at_rank_manager",
  settings_monitoring: "textures/ui/jm_at_item_watch",
};
const INFO_SEARCH_FALLBACK_ICON = "textures/ui/jm_at_search_info";

/** Translate visible menu labels without changing search or navigation data. */
function _resultButtonLabel(entry, query) {
  return localizedResultRow(entry, query, SEARCH_INDEX);
}

function _getSearchPageFn(key, player, backToPanel) {
  const map = {
    tickets: () => showTicketsPlayersInfo(player, backToPanel),
    actions: () => showActionsModerationInfo(player, backToPanel),
    server: () => showServerControlsInfo(player, backToPanel),
    ranks: () => showRanksProgressionInfo(player, backToPanel),
    broadcasts: () => showBroadcastsLoggingInfo(player, backToPanel),
    holograms: () => showHologramsInfo(player, backToPanel),
    claims: () => showAdminClaimsInfoPage(player, backToPanel),
    kits: () => showKitsAdminInfo(player, backToPanel),
    recipes: () => showAdminRecipePage(player, backToPanel),
    settings: () => showCurrentSettingsHub(player, backToPanel),
    access: () => showAccessRolesInfo(player, backToPanel),
    settings_server: () => showCurrentSettingsServerAccess(player, backToPanel),
    settings_player: () => showCurrentSettingsPlayerTools(player, backToPanel),
    settings_tickets: () => showCurrentSettingsTickets(player, backToPanel),
    settings_claims: () => showCurrentSettingsClaims(player, backToPanel),
    settings_ranks: () => showCurrentSettingsRanks(player, backToPanel),
    settings_monitoring: () =>
      showCurrentSettingsMonitoring(player, backToPanel),
  };
  return map[key];
}

async function showSearchInfo(player, backToPanel) {
  const queryObs = new ObservableString("", { clientWritable: true });
  const status = new ObservableString("");
  const statusShown = new ObservableBoolean(false);
  let pendingNav = null;
  const fail = (m) => {
    status.setData(m);
    statusShown.setData(true);
  };

  const form = new CustomForm(player, t("jm_at.infoa.search_title"));
  form.textField(t("jm_at.infoa.search_field_label"), queryObs, {
    description: t("jm_at.infoa.search_field_desc"),
  });
  form.spacer();
  form.label(status, { visible: statusShown });
  form.spacer({ visible: statusShown });
  form.button(t("jm_at.infoa.btn_search"), () => {
    const query = clampText(queryObs.getData().trim(), 50);
    if (!query) {
      // ObservableString values are not translatable (DDUI limitation).
      fail("§c请输入要搜索的内容。");
      return;
    }
    pendingNav = () => runInfoSearch(player, backToPanel, query);
    try {
      form.close();
    } catch {}
  });
  form.button(t("jm_at.common.btn_back"), () => {
    pendingNav = () => showAdminInfo(player, backToPanel);
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(() => showSearchInfo(player, backToPanel));
  }
  if (pendingNav) return system.run(pendingNav);
  return; // ✕ / engine close / escape → exit to game
}

async function runInfoSearch(player, backToPanel, query) {
  // Score pages and keep matches (term pools localized to the player's client
  // language when a search-terms-<lang> module exists — see search-locale.js).
  const index = localizedIndex(player, SEARCH_INDEX, "info");
  const scored = index.map((entry) => {
    const { score, matchedTerms, strong } = searchScore(query, entry);
    return { ...entry, score, matchedTerms, strong };
  })
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score);

  // No match: offer the closest keyword.
  if (scored.length === 0) {
    const suggestion = findClosestKeyword(query, index);
    // The user's query and the suggested keyword are echoed back as params.
    const noResultBody = suggestion
      ? t("jm_at.infoa.no_results_suggest", query, suggestion)
      : t("jm_at.infoa.no_results_try", query);

    const noResultForm = new ActionFormData()
      .title(t("jm_at.infoa.search_results_title"))
      .body(noResultBody);
    if (suggestion) {
      noResultForm.button(
        t("jm_at.infoa.btn_search_suggestion", suggestion),
        "textures/ui/jm_at_search_rename",
      );
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
    if (noRes.canceled) return showSearchInfo(player, backToPanel); // X = Back
    let idx = 0;
    if (suggestion && noRes.selection === idx++) {
      // Search again with the suggestion.
      return showSearchResults(player, backToPanel, suggestion);
    }
    if (noRes.selection === idx++) return showSearchInfo(player, backToPanel);
    if (noRes.selection === idx++) return showAdminInfo(player, backToPanel); // Back
    return; // Close
  }

  return showSearchResults(player, backToPanel, query, scored);
}

async function showSearchResults(
  player,
  backToPanel,
  query,
  scored,
  showAll = false,
) {
  // Re-score when opened from a suggestion.
  if (!scored) {
    scored = localizedIndex(player, SEARCH_INDEX, "info").map((entry) => {
      const { score, matchedTerms, strong } = searchScore(query, entry);
      return { ...entry, score, matchedTerms, strong };
    })
      .filter((e) => e.score > 0)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) {
      return _showReadOnlyInfoPage(
        player,
        t("jm_at.infoa.search_results_title"),
        t("jm_at.infoa.no_results_short", query),
        () => showSearchInfo(player, backToPanel),
      );
    }
  }

  // Strong (exact/prefix) hits up front; substring/fuzzy hits fold behind a
  // "loosely related" button.
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
      _resultButtonLabel(entry, query),
      INFO_SEARCH_ICONS[entry.key] ?? INFO_SEARCH_FALLBACK_ICON,
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
  if (resultRes.canceled) return showSearchInfo(player, backToPanel); // X = Back

  if (resultRes.selection < list.length) {
    const fn = _getSearchPageFn(list[resultRes.selection].key, player, backToPanel);
    return fn?.();
  }
  let idx = list.length;
  if (folded) {
    if (resultRes.selection === idx)
      return showSearchResults(player, backToPanel, query, scored, true); // expand
    idx++;
  }
  if (resultRes.selection === idx) return showSearchInfo(player, backToPanel);
  if (resultRes.selection === idx + 1)
    return showAdminInfo(player, backToPanel); // Back
  return; // Close
}

// =========================================================
// Access and roles.
// =========================================================

async function showAccessRolesInfo(player, backToPanel) {
  const form = new ActionFormData()
    .title(t("jm_at.infoa.access_title"))
    .body(t("jm_at.infoa.access_body"))
    .button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back")
    .button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showAdminInfo(player, backToPanel); // X = Back
  if (res.selection === 0) return showAdminInfo(player, backToPanel);
  return;
}

async function showCurrentSettingsHub(player, backToPanel) {
  const form = new ActionFormData()
    .title(t("jm_at.infoa.settings_hub_title"))
    .body(t("jm_at.infoa.settings_hub_body"))
    .button(t("jm_at.infoa.btn_set_server"), "textures/ui/jm_at_server_controls")
    .button(t("jm_at.infoa.btn_set_player"), "textures/ui/jm_at_control_panel")
    .button(t("jm_at.infoa.btn_set_tickets"), "textures/ui/jm_at_ticket_settings")
    .button(t("jm_at.infoa.btn_set_claims"), "textures/ui/jm_at_my_claims")
    .button(t("jm_at.infoa.btn_set_ranks"), "textures/ui/jm_at_rank_manager")
    .button(t("jm_at.infoa.btn_set_monitoring"), "textures/ui/jm_at_item_watch")
    .button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back")
    .button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showAdminInfo(player, backToPanel); // X = Back
  if (res.selection === 0)
    return showCurrentSettingsServerAccess(player, backToPanel);
  if (res.selection === 1)
    return showCurrentSettingsPlayerTools(player, backToPanel);
  if (res.selection === 2)
    return showCurrentSettingsTickets(player, backToPanel);
  if (res.selection === 3)
    return showCurrentSettingsClaims(player, backToPanel);
  if (res.selection === 4) return showCurrentSettingsRanks(player, backToPanel);
  if (res.selection === 5)
    return showCurrentSettingsMonitoring(player, backToPanel);
  if (res.selection === 6) return showAdminInfo(player, backToPanel);
  // Close.
}

async function showCurrentSettingsServerAccess(player, backToPanel) {
  const cfg = getCfg();
  const locks = cfg.dimLocks ?? {};
  const scheduledLocks = cfg.scheduledDimLocks ?? [];
  const scheduledUnlocks = cfg.scheduledDimUnlocks ?? [];
  const body = _joinLines([
    t("jm_at.infoa.head_server_access"),
    "",
    _settingLine(
      t("jm_at.infoa.set_server_lock"),
      _fmtOnOff(cfg.serverLocked),
      t("jm_at.infoa.path_server_lock"),
    ),
    "",
    _settingLine(
      t("jm_at.infoa.set_whitelist_mode"),
      _fmtOnOff(cfg.whitelistMode),
      t("jm_at.infoa.path_whitelist_toggle"),
    ),
    "",
    _settingLine(
      t("jm_at.infoa.set_whitelisted_players"),
      `§9${(cfg.whitelistedXuids ?? []).length}§r`,
      t("jm_at.infoa.path_manage_whitelist"),
    ),
    "",
    _settingLine(
      t("jm_at.infoa.set_nether_lock"),
      _fmtOnOff(locks.nether ?? false),
      t("jm_at.infoa.path_dimension_locks"),
    ),
    "",
    _settingLine(
      t("jm_at.infoa.set_end_lock"),
      _fmtOnOff(locks.end ?? false),
      t("jm_at.infoa.path_dimension_locks"),
    ),
    "",
    _settingLine(
      t("jm_at.infoa.set_scheduled_locks"),
      `§9${scheduledLocks.length}§r`,
      t("jm_at.infoa.path_dimension_locks"),
    ),
    "",
    _settingLine(
      t("jm_at.infoa.set_scheduled_unlocks"),
      `§9${scheduledUnlocks.length}§r`,
      t("jm_at.infoa.path_dimension_locks"),
    ),
    "",
    _settingLine(
      t("jm_at.infoa.set_gamemode_access"),
      t(
        cfg.adminPrivileges?.gamemode
          ? "jm_at.infoa.st_all_admins"
          : "jm_at.infoa.st_owner_only",
      ),
      t("jm_at.infoa.path_admin_privileges"),
    ),
  ]);

  return _showReadOnlyInfoPage(
    player,
    t("jm_at.infoa.settings_server_title"),
    body,
    () => showCurrentSettingsHub(player, backToPanel),
  );
}

async function showCurrentSettingsPlayerTools(player, backToPanel) {
  const cfg = getCfg();
  const afkEnabled = cfg.afkEnabled ?? true;
  const afkKickEnabled = cfg.afkKickEnabled ?? false;
  const body = _joinLines([
    t("jm_at.infoa.head_player_tools"),
    "",
    _settingLine(
      t("jm_at.infoa.set_homes"),
      _fmtEnabled(cfg.homesEnabled !== false),
      t("jm_at.infoa.path_config_editor"),
    ),
    "",
    _settingLine(
      t("jm_at.infoa.set_max_homes"),
      `§9${cfg.maxHomes ?? 3}§r`,
      t("jm_at.infoa.path_config_editor"),
    ),
    "",
    _settingLine(
      t("jm_at.infoa.set_tpa"),
      _fmtEnabled(cfg.tpaEnabled !== false),
      t("jm_at.infoa.path_config_editor"),
    ),
    "",
    _settingLine(
      t("jm_at.infoa.set_tpa_delay"),
      raw("§9", _fmtSeconds(cfg.tpaDelaySec ?? 3), "§r"),
      t("jm_at.infoa.path_config_editor"),
    ),
    "",
    _settingLine(
      t("jm_at.infoa.set_deathback"),
      _fmtEnabled(cfg.deathbackEnabled !== false),
      t("jm_at.infoa.path_config_editor"),
    ),
    "",
    _settingLine(
      t("jm_at.infoa.set_restore_tools"),
      t(
        cfg.deathbackGiveTools === "always" || cfg.deathbackGiveTools === true
          ? "jm_at.infoa.st_always"
          : cfg.deathbackGiveTools === "inventory"
            ? "jm_at.infoa.st_inventory_only"
            : "jm_at.infoa.st_none",
      ),
      t("jm_at.infoa.path_config_editor"),
    ),
    "",
    _settingLine(
      t("jm_at.infoa.set_warps_visible"),
      _fmtEnabled(cfg.warpsVisible !== false),
      t("jm_at.infoa.path_warps"),
    ),
    "",
    _settingLine(
      t("jm_at.infoa.set_warn_threshold"),
      `§9${cfg.warnThreshold ?? 3}§r`,
      t("jm_at.infoa.path_config_editor"),
    ),
    "",
    _settingLine(
      t("jm_at.infoa.set_afk_detection"),
      _fmtEnabled(afkEnabled),
      t("jm_at.infoa.path_config_editor"),
    ),
    "",
    _settingLine(
      t("jm_at.infoa.set_afk_warn_after"),
      `§9${_fmtMinutes(cfg.afkWarnMinutes ?? 2)}§r`,
      t("jm_at.infoa.path_config_editor"),
    ),
    "",
    _settingLine(
      t("jm_at.infoa.set_afk_kick"),
      _fmtEnabled(afkKickEnabled),
      t("jm_at.infoa.path_config_editor"),
    ),
    "",
    _settingLine(
      t("jm_at.infoa.set_afk_kick_after"),
      `§9${_fmtMinutes(cfg.afkKickMinutes ?? 60)}§r`,
      t("jm_at.infoa.path_config_editor"),
    ),
    "",
    _settingLine(
      t("jm_at.infoa.set_afk_exempt"),
      _fmtYesNo(cfg.afkExemptStaff !== false),
      t("jm_at.infoa.path_config_editor"),
    ),
    "",
    "───────────────────",
    t("jm_at.infoa.head_menu_visibility"),
    "",
    _settingLine(
      t("jm_at.infoa.set_tickets_warnings"),
      _fmtEnabled(cfg.ticketsVisible !== false),
      t("jm_at.infoa.path_ticket_settings"),
    ),
    "",
    _settingLine(
      t("jm_at.infoa.set_homes"),
      _fmtEnabled(cfg.homesEnabled !== false),
      t("jm_at.infoa.path_config_editor"),
    ),
    "",
    _settingLine(
      t("jm_at.infoa.set_warps"),
      _fmtEnabled(cfg.warpsVisible !== false),
      t("jm_at.infoa.path_warps"),
    ),
    "",
    _settingLine(
      t("jm_at.infoa.set_tpa"),
      _fmtEnabled(cfg.tpaEnabled !== false),
      t("jm_at.infoa.path_config_editor"),
    ),
    "",
    _settingLine(
      t("jm_at.infoa.set_deathback"),
      _fmtEnabled(cfg.deathbackEnabled !== false),
      t("jm_at.infoa.path_config_editor"),
    ),
  ]);

  return _showReadOnlyInfoPage(
    player,
    t("jm_at.infoa.settings_player_title"),
    body,
    () => showCurrentSettingsHub(player, backToPanel),
  );
}

async function showCurrentSettingsTickets(player, backToPanel) {
  const cfg = getCfg();
  const categories = cfg.categories ?? [];
  const body = _joinLines([
    t("jm_at.infoa.head_tickets"),
    "",
    _settingLine(
      t("jm_at.infoa.set_ticketing"),
      _fmtOpenClosed(cfg.ticketingOpen !== false),
      t("jm_at.infoa.path_ticket_open_close"),
    ),
    "",
    _settingLine(
      t("jm_at.infoa.set_visible_player_menu"),
      _fmtEnabled(cfg.ticketsVisible !== false),
      t("jm_at.infoa.path_ticket_show_hide"),
    ),
    "",
    _settingLine(
      t("jm_at.infoa.set_submission_cooldown"),
      raw("§9", _fmtSeconds(cfg.submitCooldownSec ?? 120), "§r"),
      t("jm_at.infoa.path_ticket_cooldown"),
    ),
    "",
    _settingLine(
      t("jm_at.infoa.set_ticket_limit"),
      `§9${cfg.ticketLimit ?? 5}§r`,
      t("jm_at.infoa.path_ticket_limit"),
    ),
    "",
    _settingLine(
      t("jm_at.infoa.set_auto_delete_closed"),
      _fmtDays(cfg.autoDeleteClosedDays ?? 30),
      t("jm_at.infoa.path_ticket_autodelete"),
    ),
    "",
    _settingBlock(
      t("jm_at.infoa.set_categories"),
      _fmtBulletList(categories),
      t("jm_at.infoa.path_ticket_categories"),
    ),
  ]);

  return _showReadOnlyInfoPage(
    player,
    t("jm_at.infoa.settings_tickets_title"),
    body,
    () => showCurrentSettingsHub(player, backToPanel),
  );
}

async function showCurrentSettingsClaims(player, backToPanel) {
  const cfg = getCfg();
  const claimDefaultY = cfg.claimDefaultY ?? {};
  const maxClaims = cfg.maxClaimsPerPlayer ?? 5;
  const body = _joinLines([
    t("jm_at.infoa.head_claims"),
    "",
    _settingLine(
      t("jm_at.infoa.set_player_claiming"),
      t(maxClaims === 0 ? "jm_at.infoa.st_admin_only" : "jm_at.infoa.st_enabled"),
      t("jm_at.infoa.path_claims_config"),
    ),
    "",
    _settingLine(
      t("jm_at.infoa.set_max_claims"),
      `§9${maxClaims}§r`,
      t("jm_at.infoa.path_claims_config"),
    ),
    "",
    _settingLine(
      t("jm_at.infoa.set_starting_area"),
      t("jm_at.infoa.val_chunks", cfg.claimStartArea ?? 5),
      t("jm_at.infoa.path_claims_config"),
    ),
    "",
    _settingLine(
      t("jm_at.infoa.set_earned_area"),
      t(
        "jm_at.infoa.val_earned_area",
        cfg.claimAreaPerTime ?? 1,
        _fmtMinutes(cfg.claimAreaTimeInterval ?? 60),
      ),
      t("jm_at.infoa.path_claims_config"),
    ),
    "",
    _settingLine(
      t("jm_at.infoa.set_budget_cap"),
      t("jm_at.infoa.val_chunks", cfg.claimMaxArea ?? 15),
      t("jm_at.infoa.path_claims_config"),
    ),
    "",
    _settingLine(
      t("jm_at.infoa.set_nether_claims"),
      _fmtAllowedBlocked(cfg.claimAllowNether !== false),
      t("jm_at.infoa.path_claims_config"),
    ),
    "",
    _settingLine(
      t("jm_at.infoa.set_end_claims"),
      _fmtAllowedBlocked(cfg.claimAllowEnd !== false),
      t("jm_at.infoa.path_claims_config"),
    ),
    "",
    _settingBlock(
      t("jm_at.infoa.set_claim_height"),
      _joinLines([
        t(
          "jm_at.infoa.val_height_overworld",
          claimDefaultY.overworld?.min ?? -64,
          claimDefaultY.overworld?.max ?? 320,
        ),
        t(
          "jm_at.infoa.val_height_nether",
          claimDefaultY.nether?.min ?? 0,
          claimDefaultY.nether?.max ?? 128,
        ),
        t(
          "jm_at.infoa.val_height_end",
          claimDefaultY.the_end?.min ?? 0,
          claimDefaultY.the_end?.max ?? 256,
        ),
      ]),
      t("jm_at.infoa.path_claim_height"),
    ),
    "",
    _settingLine(
      t("jm_at.infoa.set_default_protections"),
      _fmtClaimFlags(cfg.claimProtections ?? {}),
      t("jm_at.infoa.path_claim_defaults"),
    ),
    "",
    _settingLine(
      t("jm_at.infoa.set_player_protections"),
      _fmtClaimFlags(cfg.claimPlayerAbilities ?? {}),
      t("jm_at.infoa.path_claim_abilities"),
    ),
  ]);

  return _showReadOnlyInfoPage(
    player,
    t("jm_at.infoa.settings_claims_title"),
    body,
    () => showCurrentSettingsHub(player, backToPanel),
  );
}

async function showCurrentSettingsRanks(player, backToPanel) {
  const cfg = getCfg();
  const rankDb = getRankDb();
  const thresholds = cfg.playtimeRanks ?? [];
  const body = _joinLines([
    t("jm_at.infoa.head_ranks"),
    "",
    _settingLine(
      t("jm_at.infoa.set_admin_tag"),
      raw(cfg.staffAdminTag || t("jm_at.infoa.st_default_admin_tag"), "§r"),
      t("jm_at.infoa.path_staff_rank_settings"),
    ),
    "",
    _settingLine(
      t("jm_at.infoa.set_mod_tag"),
      raw(cfg.staffModTag || t("jm_at.infoa.st_default_mod_tag"), "§r"),
      t("jm_at.infoa.path_staff_rank_settings"),
    ),
    "",
    _settingLine(
      t("jm_at.infoa.set_custom_ranks"),
      _fmtEnabled(cfg.staffCustomRanks ?? false),
      t("jm_at.infoa.path_staff_rank_settings"),
    ),
    "",
    _settingLine(
      t("jm_at.infoa.set_hide_staff_ranks"),
      _fmtEnabled(cfg.staffRanksHidden ?? false),
      t("jm_at.infoa.path_staff_rank_settings"),
    ),
    "",
    _settingLine(
      t("jm_at.infoa.set_playtime_ranks"),
      _fmtEnabled(cfg.playtimeRanksEnabled ?? false),
      t("jm_at.infoa.path_playtime_toggle"),
    ),
    "",
    _settingLine(
      t("jm_at.infoa.set_override_manual"),
      _fmtEnabled(cfg.playtimeRanksOverrideManual ?? false),
      t("jm_at.infoa.path_playtime_override"),
    ),
    "",
    _settingLine(
      t("jm_at.infoa.set_threshold_count"),
      `§9${thresholds.length}§r`,
      t("jm_at.infoa.path_playtime_thresholds"),
    ),
    "",
    _settingBlock(
      t("jm_at.infoa.set_playtime_thresholds"),
      _fmtPlaytimeThresholds(thresholds, rankDb),
      t("jm_at.infoa.path_playtime_thresholds"),
    ),
  ]);

  return _showReadOnlyInfoPage(
    player,
    t("jm_at.infoa.settings_ranks_title"),
    body,
    () => showCurrentSettingsHub(player, backToPanel),
  );
}

async function showCurrentSettingsMonitoring(player, backToPanel) {
  const cfg = getCfg();
  const itemWatch = getItemWatchCfg();
  const tracked = itemWatch.tracked ?? {};
  const banned = itemWatch.banned ?? [];
  const scheduledBroadcasts = cfg.scheduledBroadcasts ?? [];
  const activeBroadcasts = scheduledBroadcasts.filter((b) => b.active).length;
  const body = _joinLines([
    t("jm_at.infoa.head_monitoring"),
    "",
    _settingLine(
      t("jm_at.infoa.set_iw_banned"),
      `§9${banned.length}§r`,
      t("jm_at.infoa.path_iw_banned"),
    ),
    "",
    _settingLine(
      t("jm_at.infoa.set_iw_tracked"),
      `§9${Object.keys(tracked).length}§r`,
      t("jm_at.infoa.path_iw_tracked"),
    ),
    "",
    _settingLine(
      t("jm_at.infoa.set_scheduled_broadcasts"),
      t(
        "jm_at.infoa.val_broadcast_counts",
        activeBroadcasts,
        scheduledBroadcasts.length,
      ),
      t("jm_at.infoa.path_broadcasts_scheduled"),
    ),
    "",
    _settingBlock(
      t("jm_at.infoa.set_tracked_thresholds"),
      _fmtTrackedItems(tracked),
      t("jm_at.infoa.path_iw_tracked"),
    ),
  ]);

  return _showReadOnlyInfoPage(
    player,
    t("jm_at.infoa.settings_monitoring_title"),
    body,
    () => showCurrentSettingsHub(player, backToPanel),
  );
}

async function showAdminClaimsInfoPage(player, backToPanel) {
  const cfg = getCfg();
  const maxClaims = cfg.maxClaimsPerPlayer ?? 5;
  const startArea = cfg.claimStartArea ?? 5;
  const maxArea = cfg.claimMaxArea ?? 15;
  const areaPerTime = cfg.claimAreaPerTime ?? 1;
  const intervalMin = cfg.claimAreaTimeInterval ?? 60;
  const claimLimitLine =
    maxClaims === 0
      ? t("jm_at.infoa.claims_limit_disabled")
      : t("jm_at.infoa.claims_limit_max", maxClaims);

  const body = t(
    "jm_at.infoa.claims_body",
    claimLimitLine,
    startArea,
    areaPerTime,
    intervalMin,
    maxArea,
  );

  const form = new ActionFormData()
    .title(t("jm_at.infoa.claims_title"))
    .body(body)
    .button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back")
    .button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showAdminInfo(player, backToPanel); // X = Back
  if (res.selection === 0) return showAdminInfo(player, backToPanel);
  return;
}
