/**
 * Player-facing info pages for the Player Menu.
 * Kept separate from ui-player.js so the long help pages are easier to edit.
 */

import { ActionFormData } from "@minecraft/server-ui";
import { LIMITS, PROTECTION_DEFS, FEATURES } from "./constants.js";
import {
  getPlayerXuid,
  fmtMsRaw,
  CLOSE_BTN_LABEL,
  CLOSE_BTN_ICON,
} from "./utils.js";
import { t, raw } from "./i18n.js";
import { getCfg, getPlayerCore } from "./storage.js";
import { isAdmin, isOwner } from "./permissions.js";
import {
  getClaimsByOwner,
  getOwnerUsedArea,
  getPlayerClaimBudget,
} from "./claims.js";

// Status keys picked via ternaries throughout this file.
// lang-keys: jm_at.infop.st_*

// Local formatting helpers.

function _fmtPlaytime(ms) {
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

function _fmtNum(n) {
  if (n == null || n <= 0) return "0";
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function _fmtCooldown(sec) {
  if (sec >= 3600)
    return `${Math.floor(sec / 3600)}小时 ${Math.floor((sec % 3600) / 60)}分钟`;
  if (sec >= 60) return `${Math.floor(sec / 60)} 分钟`;
  return `${sec}秒`;
}

/** Player Menu info hub. */
export async function showPlayerInfo(player, backToMenu) {
  const kitsLive = FEATURES.kits && getCfg().kitsEnabled !== false;
  const form = new ActionFormData()
    .title(t("jm_at.infop.hub_title"))
    .body(t("jm_at.infop.hub_body"));

  const actions = [];
  form.button(t("jm_at.infop.btn_teleportation"), "textures/ui/jm_at_tpa");
  actions.push(() => showTeleportationInfo(player, backToMenu));
  form.button(t("jm_at.infop.btn_tickets"), "textures/ui/jm_at_my_tickets");
  actions.push(() => showTicketsWarningsInfo(player, backToMenu));
  form.button(t("jm_at.infop.btn_general"), "textures/ui/jm_at_player_info");
  actions.push(() => showServerRulesInfo(player, backToMenu));
  form.button(t("jm_at.infop.btn_claims"), "textures/ui/jm_at_my_claims");
  actions.push(() => showClaimsInfoPage(player, backToMenu));
  if (kitsLive) {
    form.button(t("jm_at.infop.btn_kits"), "textures/ui/jm_at_kit");
    actions.push(() => showKitsBasicInfo(player, backToMenu));
  }
  form.button(t("jm_at.infop.btn_recipes"), "textures/ui/jm_at_recipes");
  actions.push(() => showRecipePage(player, backToMenu));
  form.button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back");
  actions.push(() => backToMenu(player));
  form.button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);
  actions.push(() => undefined); // Close

  const res = await form.show(player);
  if (res.canceled) return backToMenu(player); // X = Back
  return actions[res.selection]?.();
}

// =========================================================
// Teleportation: homes, warps, TPA, and deathback.
// =========================================================

async function showTeleportationInfo(player, backToMenu) {
  const cfg = getCfg();
  const delay =
    cfg.tpaDelaySec === 0
      ? t("jm_at.infop.st_instant")
      : t("jm_at.infop.st_delay_sec", cfg.tpaDelaySec ?? 3);
  const locks = cfg.dimLocks ?? {};
  const en = (on) =>
    t(on ? "jm_at.infop.st_enabled" : "jm_at.infop.st_disabled");
  const lock = (locked) =>
    t(locked ? "jm_at.infop.st_locked" : "jm_at.infop.st_open");
  const tools =
    cfg.deathbackGiveTools === "always" || cfg.deathbackGiveTools === true
      ? t("jm_at.infop.st_always")
      : cfg.deathbackGiveTools === "inventory"
        ? t("jm_at.infop.st_inventory_only")
        : t("jm_at.infop.st_no");

  const body = t(
    "jm_at.infop.tp_body",
    en(cfg.homesEnabled !== false),
    cfg.maxHomes ?? 3,
    delay,
    en(cfg.tpaEnabled !== false),
    en(cfg.deathbackEnabled !== false),
    tools,
    lock(locks.nether),
    lock(locks.end),
  );

  const form = new ActionFormData()
    .title(t("jm_at.infop.tp_title"))
    .body(body)
    .button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back")
    .button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showPlayerInfo(player, backToMenu); // X = Back
  if (res.selection === 0) return showPlayerInfo(player, backToMenu);
  return; // Close
}

// =========================================================
// Tickets, warnings, and appeals.
// =========================================================

async function showTicketsWarningsInfo(player, backToMenu) {
  const cfg = getCfg();
  const core = getPlayerCore(player);
  const cats = cfg.categories ?? ["Griefing", "Harassment", "Bug", "Other"];
  const autoDelDays = cfg.autoDeleteClosedDays ?? 30;
  const activeWarnings = (core.punishments ?? []).filter(
    (p) =>
      p.type === "WARN" &&
      p.active &&
      (!p.expiresAt || p.expiresAt > Date.now()),
  ).length;

  const body = raw(
    t(
      "jm_at.infop.tw_body_1",
      t(cfg.ticketingOpen !== false ? "jm_at.infop.st_open" : "jm_at.infop.st_closed"),
      _fmtCooldown(cfg.submitCooldownSec ?? 120),
      cfg.ticketLimit ?? 5,
      cats.join("§r, §9"),
    ),
    autoDelDays > 0
      ? t("jm_at.infop.tw_auto_delete", autoDelDays)
      : t("jm_at.infop.tw_kept_manual"),
    t(
      "jm_at.infop.tw_body_2",
      `§${activeWarnings > 0 ? "c" : "2"}${activeWarnings}§r`,
      cfg.warnThreshold ?? 3,
    ),
  );

  const form = new ActionFormData()
    .title(t("jm_at.infop.tw_title"))
    .body(body)
    .button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back")
    .button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showPlayerInfo(player, backToMenu); // X = Back
  if (res.selection === 0) return showPlayerInfo(player, backToMenu);
  return; // Close
}

// =========================================================
// General server info.
// =========================================================

async function showServerRulesInfo(player, backToMenu) {
  const cfg = getCfg();
  const core = getPlayerCore(player);
  const locks = cfg.dimLocks ?? {};
  const adminMode = isAdmin(player).ok;

  // Current player stats.
  const playtime = _fmtPlaytime(core.playTimeMs ?? 0);
  const mobK = _fmtNum(core.statMobKills ?? 0);
  const playerK = _fmtNum(core.statPlayerKills ?? 0);
  const deaths = _fmtNum(core.statDeaths ?? 0);
  const mined = _fmtNum(core.statBlocksMined ?? 0);
  const placed = _fmtNum(core.statBlocksPlaced ?? 0);
  const traveled = _fmtNum(core.statBlocksTraveled ?? 0);

  const lock = (locked) =>
    t(locked ? "jm_at.infop.st_locked" : "jm_at.infop.st_open");
  const body = raw(
    t(
      "jm_at.infop.gen_stats",
      playtime,
      mobK,
      playerK,
      deaths,
      mined,
      placed,
      traveled,
      fmtMsRaw(core.firstSeen),
    ),
    t(
      "jm_at.infop.gen_afk_head",
      t(cfg.afkEnabled ? "jm_at.infop.st_enabled" : "jm_at.infop.st_disabled"),
    ),
    cfg.afkEnabled
      ? raw(
          t(
            "jm_at.infop.gen_afk_on",
            cfg.afkWarnMinutes ?? 2,
            cfg.afkKickEnabled
              ? t("jm_at.infop.gen_afk_kick_on", cfg.afkKickMinutes ?? 60)
              : t("jm_at.infop.gen_afk_kick_off"),
          ),
          cfg.afkExemptStaff !== false
            ? t("jm_at.infop.gen_afk_staff_exempt")
            : "",
          t("jm_at.infop.gen_afk_title_note"),
        )
      : t("jm_at.infop.gen_afk_off"),
    t("jm_at.infop.gen_dimlocks_elevator", lock(locks.nether), lock(locks.end)),
    cfg.playtimeRanksEnabled
      ? raw(
          t("jm_at.infop.gen_ranks"),
          adminMode
            ? t(
                "jm_at.infop.gen_ranks_override",
                t(
                  cfg.playtimeRanksOverrideManual
                    ? "jm_at.infop.st_yes"
                    : "jm_at.infop.st_no",
                ),
              )
            : "",
        )
      : "",
  );

  const form = new ActionFormData()
    .title(t("jm_at.infop.gen_title"))
    .body(body)
    .button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back")
    .button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showPlayerInfo(player, backToMenu); // X = Back
  if (res.selection === 0) return showPlayerInfo(player, backToMenu);
  return; // Close
}

// =========================================================
// Crafting recipes.
// =========================================================

async function showKitsBasicInfo(player, backToMenu) {
  const form = new ActionFormData()
    .title(t("jm_at.infop.kits_title"))
    .body(t("jm_at.infop.kits_body"))
    .button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back")
    .button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showPlayerInfo(player, backToMenu); // X = Back
  if (res.selection === 0) return showPlayerInfo(player, backToMenu);
  return; // Close
}

async function showRecipePage(player, backFn) {
  const cfg = getCfg();
  const kitBlock =
    FEATURES.kits && cfg.kitsEnabled !== false
      ? t("jm_at.infop.recipes_kit_block")
      : "";
  const body = raw(
    t("jm_at.infop.recipes_body_1"),
    kitBlock,
    t("jm_at.infop.recipes_body_2"),
  );

  const form = new ActionFormData()
    .title(t("jm_at.infop.recipes_title"))
    .body(body)
    .button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back")
    .button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showPlayerInfo(player, backFn); // X = Back
  if (res.selection === 0) return showPlayerInfo(player, backFn);
  return; // Close
}

// =========================================================
// Land claims guide.
// =========================================================

export async function showClaimsInfoPage(player, backFn) {
  const cfg = getCfg();
  const xuid = getPlayerXuid(player);
  const usedArea = Math.round((getOwnerUsedArea(xuid) / 256) * 100) / 100;
  const budget = getPlayerClaimBudget(player);
  const ownedCount = getClaimsByOwner(xuid).filter(
    (c) => !c.isAdminClaim,
  ).length;
  const ab = cfg.claimPlayerAbilities ?? {};
  const adminMode = isAdmin(player).ok;
  const ownerMode = isOwner(player);

  // Build protections from the current claim config (labels are lang keys).
  const protDefs = PROTECTION_DEFS.map(({ key, labelKey }) => ({
    key,
    label: t(labelKey),
  }));
  const playerProts = protDefs
    .filter((p) => ab[p.key] !== false)
    .map((p) => p.label);
  const adminOnlyProts = protDefs
    .filter((p) => ab[p.key] === false)
    .map((p) => p.label);
  // RawMessage line joiner (labels are objects — no string join).
  const joinLines = (parts) =>
    raw(...parts.flatMap((x, i) => (i ? ["\n", x] : [x])));

  // Protection labels come from PROTECTION_DEFS (constants.js) — still raw
  // strings pending the shared-label-table conversion pass.
  const body = raw(
    t("jm_at.infop.cl_body_1"),
    cfg.maxClaimsPerPlayer > 0
      ? t(
          "jm_at.infop.cl_budget",
          ownedCount,
          cfg.maxClaimsPerPlayer,
          usedArea,
          budget,
          cfg.claimAreaPerTime ?? 1,
          cfg.claimAreaTimeInterval ?? 60,
          cfg.claimStartArea ?? 5,
          cfg.claimMaxArea ?? 15,
        )
      : t("jm_at.infop.cl_admin_managed"),
    t(
      "jm_at.infop.cl_dimensions",
      t(cfg.claimAllowNether !== false ? "jm_at.infop.st_allowed" : "jm_at.infop.st_disabled"),
      t(cfg.claimAllowEnd !== false ? "jm_at.infop.st_allowed" : "jm_at.infop.st_disabled"),
    ),
    joinLines(playerProts.map((p) => raw("  §2✓§r ", p))),
    adminOnlyProts.length > 0
      ? raw(
          "\n",
          joinLines(
            adminOnlyProts.map((p) =>
              adminMode
                ? t("jm_at.infop.cl_prot_line_admin", p)
                : t("jm_at.infop.cl_prot_line_admin_only", p),
            ),
          ),
        )
      : "",
    "\n",
    t("jm_at.infop.cl_body_2", LIMITS.SUBCLAIMS_PER_CLAIM),
    ownerMode ? t("jm_at.infop.cl_owner_only") : "",
  );

  const form = new ActionFormData()
    .title(t("jm_at.infop.cl_title"))
    .body(body)
    .button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back")
    .button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showPlayerInfo(player, backFn); // X = Back
  if (res.selection === 0) return showPlayerInfo(player, backFn);
  return; // Close
}
