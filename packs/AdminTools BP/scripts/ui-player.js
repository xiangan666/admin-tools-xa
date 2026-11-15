import { setHudTitle } from "./screen-feedback.js";
/** Player-facing UI screens. */

import { showPlayerInfo as _showPlayerInfo } from "./info-player.js";
import { makeHomeAt, validDestinationName } from "./home-record.js";
import { showTravelRules } from "./ui-travel-rules.js";
import { startRuleTeleport } from "./travel-service.js";
import { showHomeDirectory, showHomeAccessMenu, visitHome } from "./ui-home-access.js";
import { showHomeRevenue } from "./ui-home-revenue.js";
import { showHomeAdministration } from "./ui-home-admin.js";
import { getHomePolicy } from "./home-policy.js";
import { beginTravelWait, showTravelWait, clearTravelWait } from "./travel-feedback.js";
import {
  ActionFormData,
  MessageFormData,
  CustomForm,
  ObservableString,
  ObservableNumber,
  ObservableBoolean,
  DataDrivenScreenClosedReason,
} from "@minecraft/server-ui";
import { system, world } from "@minecraft/server";
import { LIMITS, FEATURES } from "./constants.js";
import { openPlayerKits } from "./ui-kits.js";
import {
  tell,
  warnForm,
  clampText,
  confirmDiscardChanges,
  fmtMsRaw,
  fmtDimRaw,
  getPlayerXuid,
  nowMs,
  genId,
  broadcastAdmins,
  getOnlinePlayerByName,
  silentCatch,
  CLOSE_BTN_LABEL,
  CLOSE_BTN_ICON,
} from "./utils.js";
import { t, raw } from "./i18n.js";
import { getCfg, getPlayerCore, setPlayerCore } from "./storage.js";
import {
  createTicket,
  findTicket,
  ticketSubmitBlockReason,
} from "./tickets.js";
import {
  getHomes,
  setHomes,
  getMaxHomes,
  HOME_ICONS,
  DEFAULT_HOME_ICON,
  getHomeIconPath,
} from "./homes.js";
import {
  getWarps,
  getSortedWarpNames,
  getWarpAccess,
  canAccessWarp,
  WARPS_PER_PAGE,
} from "./warps.js";
import { isStaff, isAdmin, isOwner } from "./permissions.js";
import {
  getIncomingRequests,
  sendTpaRequest,
  acceptTpaRequest,
  declineTpaRequest,
} from "./tpa.js";
import { logPlayer } from "./log.js";
import {
  teleportedPlayers,
  captureTpBackLocation,
  teleportPlayer,
  confirmBringMount,
} from "./players.js";
import { showTicketDetail } from "./ui-tickets.js";
import { showPlayerProfile, showOfflineProfile } from "./ui-admin.js";

function fmtPlaytime(ms) {
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

function fmtNum(n) {
  if (n == null || n <= 0) return "0";
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// =========================================================
// Player main menu
// =========================================================

export async function showPlayerMain(player) {
  const cfg = getCfg();
  const actions = [];
  // Earnings stay accessible even while the server has temporarily hidden homes.
  actions.push({ label: "§l家园收益", icon: "textures/ui/jm_at_homes", fn: () => showHomeRevenue(player, () => showPlayerMain(player)) });

  // Keep travel first, support next, stats/info last.

  // Homes are hidden when disabled.
  if (cfg.homesEnabled !== false) {
    actions.push({
      label: t("jm_at.pmenu.homes"),
      icon: "textures/ui/jm_at_homes",
      fn: () => showHomesMenu(player),
    });
  }

  // Staff can see hidden warps.
  if (cfg.warpsVisible !== false || isStaff(player)) {
    actions.push({
      label: t("jm_at.pmenu.warps"),
      icon: "textures/ui/jm_at_warps",
      fn: () => showWarpsMenu(player),
    });
  }

  // TPA menu includes requests and last location.
  if (cfg.tpaEnabled !== false) {
    const incoming = getIncomingRequests(player);
    const tpaLabel =
      incoming.length > 0
        ? t("jm_at.pmenu.teleport_pending", incoming.length)
        : t("jm_at.pmenu.teleport");
    actions.push({
      label: tpaLabel,
      icon: "textures/ui/jm_at_tpa",
      fn: () => showTpaMenu(player),
    });
  }

  // Deathback is hidden when disabled.
  if (cfg.deathbackEnabled !== false) {
    const core = getPlayerCore(player);
    const deathbackLabel = core.lastDeathPos
      ? t(
          "jm_at.pmenu.deathback_pos",
          core.lastDeathPos.x,
          core.lastDeathPos.y,
          core.lastDeathPos.z,
        )
      : t("jm_at.pmenu.deathback");
    actions.push({
      label: deathbackLabel,
      icon: "textures/ui/jm_at_deathback",
      fn: () => showDeathback(player),
    });
  }

  // Kits need both the feature flag and runtime toggle.
  if (
    FEATURES.kits &&
    cfg.kitsEnabled !== false &&
    (cfg.kitsVisible !== false || isStaff(player))
  ) {
    actions.push({
      label: t("jm_at.pmenu.kits"),
      icon: "textures/ui/jm_at_kit",
      fn: () => openPlayerKits(player, showPlayerMain),
    });
  }

  // Staff can see hidden tickets.
  if (cfg.ticketsVisible !== false || isStaff(player)) {
    actions.push({
      label: t("jm_at.pmenu.tickets_warnings"),
      icon: "textures/ui/jm_at_submit_ticket",
      fn: () => showTicketsWarningsMenu(player),
    });
  }

  // Stats are always shown.
  actions.push({
    label: t("jm_at.pmenu.my_stats"),
    icon: "textures/ui/jm_at_stats",
    fn: () => showMyStats(player),
  });

  // Info is always shown.
  actions.push({
    label: t("jm_at.pmenu.info"),
    icon: "textures/ui/jm_at_player_info",
    fn: () => showPlayerInfo(player, showPlayerMain),
  });

  const form = new ActionFormData()
    .title(t("jm_at.pmenu.title"))
    .body(t("jm_at.pmenu.body"));
  for (const a of actions) form.button(a.label, a.icon);

  const res = await form.show(player);
  if (res.canceled) return;
  if (res.selection >= 0 && res.selection < actions.length)
    return actions[res.selection].fn();
}

// =========================================================
// Tickets / Warnings sub-menu
// =========================================================

async function showTicketsWarningsMenu(player) {
  const form = new ActionFormData()
    .title(t("jm_at.pmenu.tw_title"))
    .body(t("jm_at.pmenu.tw_body"))
    .button(t("jm_at.pmenu.btn_submit_ticket"), "textures/ui/jm_at_submit_ticket")
    .button(t("jm_at.pmenu.btn_my_tickets"), "textures/ui/jm_at_my_tickets")
    .button(t("jm_at.pmenu.btn_warnings"), "textures/ui/jm_at_warnings")
    .button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back")
    .button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);
  const res = await form.show(player);
  if (res.canceled) return showPlayerMain(player); // X = Back
  if (res.selection === 4) return; // Close
  if (res.selection === 3) return showPlayerMain(player); // Back
  if (res.selection === 0) {
    if (!getCfg().ticketingOpen) {
      return warnForm(player, t("jm_at.tickets.system_closed"), () =>
        showTicketsWarningsMenu(player),
      );
    }
    return showSubmitTicket(player, getCfg());
  }
  if (res.selection === 1) return showMyTickets(player);
  if (res.selection === 2) return showMyWarnings(player);
}

// =========================================================
// My Stats
// =========================================================

async function showMyStats(player) {
  const core = getPlayerCore(player);
  const body = t(
    "jm_at.pmenu.stats_body",
    fmtPlaytime(core.playTimeMs ?? 0),
    fmtNum(core.statMobKills ?? 0),
    fmtNum(core.statPlayerKills ?? 0),
    fmtNum(core.statDeaths ?? 0),
    fmtNum(core.statBlocksMined ?? 0),
    fmtNum(core.statBlocksPlaced ?? 0),
    fmtNum(core.statBlocksTraveled ?? 0),
    fmtMsRaw(core.firstSeen),
  );

  const form = new ActionFormData()
    .title(t("jm_at.pmenu.stats_title"))
    .body(body)
    .button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back")
    .button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showPlayerMain(player); // X = Back
  if (res.selection === 0) return showPlayerMain(player); // Back
  return; // Close
}

// =========================================================
// Info
// =========================================================

// Re-export player info for older imports.
export async function showPlayerInfo(player, backToMenu) {
  return _showPlayerInfo(player, backToMenu ?? showPlayerMain);
}

// =========================================================
// Warnings
// =========================================================

export async function showMyWarnings(player) {
  const core = getPlayerCore(player);
  const warns = (core.punishments ?? []).filter(
    (p) => p.type === "WARN" && p.active,
  );

  if (warns.length === 0) {
    const f = await new MessageFormData()
      .title(t("jm_at.warn.list_title"))
      .body(t("jm_at.warn.none"))
      .button1(t("jm_at.common.btn_back_bold"))
      .button2(t("jm_at.common.btn_close"))
      .show(player);
    if (f.canceled) return showTicketsWarningsMenu(player); // X = Back
    if (f.selection === 0) return showTicketsWarningsMenu(player); // Back
    return; // Close
  }

  const form = new ActionFormData()
    .title(t("jm_at.warn.list_title_count", warns.length))
    .body(t("jm_at.warn.list_body"));
  for (const w of warns) {
    const acked = core.warnAcks?.[w.id];
    const status = acked?.appealDenied
      ? t("jm_at.warn.status_denied")
      : acked?.appeal
        ? t("jm_at.warn.status_pending_appeal")
        : acked?.ackedAt
          ? t("jm_at.warn.status_acked")
          : t("jm_at.warn.status_pending");
    form.button(t("jm_at.warn.list_entry", w.reason.slice(0, 40), w.byName, status));
  }
  form.button(t("jm_at.common.btn_back_bold"));
  form.button(CLOSE_BTN_LABEL);

  const res = await form.show(player);
  if (res.canceled) return showTicketsWarningsMenu(player); // X = Back
  if (res.selection === warns.length) return showTicketsWarningsMenu(player); // Back
  if (res.selection === warns.length + 1) return; // Close

  const warn = warns[res.selection];
  if (warn) return showWarnDetail(player, warn);
}

async function showWarnDetail(player, warn) {
  const core = getPlayerCore(player);
  const acked = core.warnAcks?.[warn.id];

  const parts = [
    t("jm_at.warn.detail_head", warn.reason, warn.byName, fmtMsRaw(warn.at)),
  ];
  if (acked?.appeal) {
    const status = acked.appealDenied
      ? t("jm_at.warn.appeal_denied")
      : t("jm_at.warn.appeal_pending_review");
    parts.push("\n\n", t("jm_at.warn.detail_appeal", acked.appeal, status));
  }

  const btns = [];
  if (!acked)
    btns.push({ label: t("jm_at.warn.btn_ack"), action: "ack" });
  if (!acked?.appeal)
    btns.push({ label: t("jm_at.warn.btn_appeal"), action: "appeal" });
  btns.push({ label: t("jm_at.common.btn_back_bold"), action: "back" });
  btns.push({ label: CLOSE_BTN_LABEL, action: "close" });

  const form = new ActionFormData()
    .title(t("jm_at.warn.detail_title"))
    .body(raw(...parts));
  for (const b of btns) form.button(b.label);

  const res = await form.show(player);
  if (res.canceled) return showMyWarnings(player); // X = Back
  const action = btns[res.selection]?.action;
  if (action === "close") return; // Close
  if (action === "back") return showMyWarnings(player);

  if (action === "ack") {
    const freshCore = getPlayerCore(player);
    freshCore.warnAcks = freshCore.warnAcks ?? {};
    freshCore.warnAcks[warn.id] = { ackedAt: nowMs() };
    setPlayerCore(player, freshCore);
    tell(player, t("jm_at.warn.acked"));
    broadcastAdmins(t("jm_at.warn.acked_broadcast", player.name, warn.reason));
    return showMyWarnings(player);
  }

  if (action === "appeal") return showSubmitAppeal(player, warn);

  return showMyWarnings(player);
}

async function showSubmitAppeal(player, warn, initial = {}) {
  const appealObs = new ObservableString(initial.appeal ?? "", {
    clientWritable: true,
  });
  const status = new ObservableString("");
  const statusShown = new ObservableBoolean(false);
  let pendingNav = null;
  let intent = null;
  const back = () => showWarnDetail(player, warn);
  const fail = (m) => {
    status.setData(m);
    statusShown.setData(true);
  };

  const form = new CustomForm(player, t("jm_at.warn.appeal_title"));
  form.textField(t("jm_at.warn.appeal_field"), appealObs, {
    description: t("jm_at.warn.appeal_field_desc"),
  });
  form.spacer();
  form.label(status, { visible: statusShown });
  form.spacer({ visible: statusShown });
  const submit = (close) => {
    const appeal = clampText(appealObs.getData().trim(), 300);
    if (appeal.length < 5) {
      fail("§c申诉内容过短，请补充说明。");
      return;
    }
    pendingNav = () => {
      const freshCore = getPlayerCore(player);
      freshCore.warnAcks = freshCore.warnAcks ?? {};
      freshCore.warnAcks[warn.id] = {
        ...(freshCore.warnAcks[warn.id] ?? {}),
        appeal,
        appealAt: nowMs(),
      };
      setPlayerCore(player, freshCore);
      tell(player, t("jm_at.warn.appeal_submitted"));
      broadcastAdmins(
        t("jm_at.warn.appeal_broadcast", player.name, warn.reason, appeal),
      );
      return close ? undefined : showMyWarnings(player);
    };
    try {
      form.close();
    } catch {}
  };
  form.button(t("jm_at.common.btn_submit"), () => submit(false));
  form.button(t("jm_at.warn.btn_submit_close"), () => submit(true));
  form.button(t("jm_at.common.btn_back"), () => {
    intent = "back";
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(() =>
      showSubmitAppeal(player, warn, { appeal: appealObs.getData() }),
    );
  }
  if (pendingNav) return system.run(pendingNav);
  // Back → warning detail; ✕ / engine close / escape → exit to game. If an appeal
  // was typed, confirm first — Keep editing reopens with the text preserved.
  const goBack = intent === "back";
  if (appealObs.getData().trim().length > 0) {
    const keep = { appeal: appealObs.getData() };
    return system.run(async () => {
      if (await confirmDiscardChanges(player))
        return showSubmitAppeal(player, warn, keep);
      if (goBack) return back();
    });
  }
  if (goBack) return system.run(back);
}

// =========================================================
// Submit ticket
// =========================================================

export async function showSubmitTicket(player, cfg, seed = {}) {
  // Check submit rules before showing the form.
  const block = ticketSubmitBlockReason(player);
  if (block) {
    return warnForm(player, block, () => showTicketsWarningsMenu(player));
  }

  const cats =
    Array.isArray(cfg.categories) && cfg.categories.length
      ? cfg.categories
      : ["Other"];
  const seedCatIdx = seed.category
    ? Math.max(0, cats.indexOf(seed.category))
    : 0;

  const catItems = cats.map((c, i) => ({ label: c, value: i }));
  const catObs = new ObservableNumber(seedCatIdx, { clientWritable: true });
  const descObs = new ObservableString(seed.desc ?? "", {
    clientWritable: true,
  });
  const status = new ObservableString("");
  const statusShown = new ObservableBoolean(false);

  const form = new CustomForm(player, t("jm_at.tickets.submit_title"));
  form.spacer();
  form.dropdown(t("jm_at.tickets.submit_category"), catObs, catItems);
  form.textField(
    t("jm_at.tickets.submit_desc_label", LIMITS.DESC_MAX_LEN),
    descObs,
    { description: t("jm_at.tickets.submit_desc_hint") },
  );
  form.spacer();
  form.label(status, { visible: statusShown });
  form.spacer({ visible: statusShown });

  let pendingNav = null;
  let intent = null;
  const back = () => showTicketsWarningsMenu(player);

  // Open the confirmation after this DDUI form closes.
  const finish = async (category, desc, close) => {
    const id = createTicket(player, category, desc);
    if (!id) return;
    logPlayer(player, "TICKET_SUBMIT", `${id} [${category}]`);
    const staffOnline = world
      .getPlayers()
      .filter((p) => p !== player && isStaff(p)).length;
    const staffLine =
      staffOnline > 0
        ? t("jm_at.tickets.staff_online", staffOnline)
        : t("jm_at.tickets.staff_offline");
    if (close) {
      tell(player, t("jm_at.tickets.submitted_chat", id, staffLine));
      return;
    }
    const submitResult = await new MessageFormData()
      .title(t("jm_at.tickets.submitted_title"))
      .body(t("jm_at.tickets.submitted_body", id, staffLine))
      .button1(t("jm_at.common.btn_ok"))
      .button2(t("jm_at.tickets.btn_my_tickets"))
      .show(player);
    if (!submitResult.canceled && submitResult.selection === 1)
      return showMyTickets(player);
    return showTicketsWarningsMenu(player);
  };

  const submit = (close) => {
    const category = cats[catObs.getData()] ?? "Other";
    const desc = clampText(
      String(descObs.getData() ?? ""),
      LIMITS.DESC_MAX_LEN,
    );
    if (!desc || desc.trim().length < 3) {
      status.setData(
        "§c请补充描述，至少输入3个字符。",
      );
      statusShown.setData(true);
      return;
    }
    pendingNav = () => finish(category, desc.trim(), close);
    try {
      form.close();
    } catch {}
  };
  form.button(t("jm_at.common.btn_submit"), () => submit(false));
  form.button(t("jm_at.tickets.btn_submit_exit"), () => submit(true));
  form.button(t("jm_at.common.btn_back"), () => {
    intent = "back";
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  // Current category + description (edits, or the seeded values if the show
  // bounced). Built before the UserBusy check so a bounce keeps them.
  const keep = {
    category: cats[catObs.getData()] ?? seed.category,
    desc: descObs.getData(),
  };
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(() => showSubmitTicket(player, cfg, keep));
  }
  if (pendingNav) return system.run(pendingNav);
  // Back → tickets menu; ✕ / engine close / escape → exit to game. If a description
  // was typed, confirm first — Keep editing reopens with category + text preserved.
  const goBack = intent === "back";
  if (descObs.getData().trim().length > 0) {
    return system.run(async () => {
      if (await confirmDiscardChanges(player))
        return showSubmitTicket(player, cfg, keep);
      if (goBack) return back();
    });
  }
  if (goBack) return system.run(back);
}

// =========================================================
// My Tickets
// =========================================================

export async function showMyTickets(player, page = 0) {
  const PAGE_SIZE = 12;
  const core = getPlayerCore(player);
  const my = core.myTickets ?? [];

  // Resolve ticket IDs once for this page.
  const ticketMap = new Map(my.map((id) => [id, findTicket(id)]));
  const allViewable = my.filter((id) => ticketMap.get(id) !== null);
  const goneCount = my.filter((id) => ticketMap.get(id) === null).length;
  const closedCount = my.filter(
    (id) => ticketMap.get(id)?.ticket?.status === "CLOSED",
  ).length;
  const removableCount = closedCount + goneCount;

  const totalPages = Math.max(1, Math.ceil(allViewable.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const viewable = allViewable.slice(
    safePage * PAGE_SIZE,
    (safePage + 1) * PAGE_SIZE,
  );
  const hasPrev = safePage > 0;
  const hasMore = (safePage + 1) * PAGE_SIZE < allViewable.length;

  const pageLabel =
    totalPages > 1
      ? t("jm_at.common.page_suffix", safePage + 1, totalPages)
      : "";
  const form = new ActionFormData()
    .title(t("jm_at.tickets.my_title"))
    .body(
      my.length
        ? raw(t("jm_at.tickets.my_body"), pageLabel)
        : t("jm_at.tickets.my_body_empty"),
    );

  // lang-keys: jm_at.tickets.status_*
  const STATUS_KEYS = {
    OPEN: "jm_at.tickets.status_open",
    CLAIMED: "jm_at.tickets.status_claimed",
    RESOLVED: "jm_at.tickets.status_resolved",
    CLOSED: "jm_at.tickets.status_closed",
  };
  for (const id of viewable) {
    const found = ticketMap.get(id);
    const status = found?.ticket?.status ?? "UNKNOWN";
    const cat = found?.ticket?.category ?? "";
    const color =
      status === "RESOLVED"
        ? "§2"
        : status === "CLOSED"
          ? "§r"
          : status === "CLAIMED"
            ? "§g"
            : "§9";
    const statusMsg = STATUS_KEYS[status]
      ? t(STATUS_KEYS[status])
      : { text: status };
    form.button(
      raw(`§l${id}§r\n${color}`, statusMsg, `§r${cat ? " - " + cat : ""}§r`),
      "textures/ui/jm_at_my_tickets",
    );
  }

  // Append navigation/actions after tickets.
  const extraBtns = [];
  if (hasPrev)
    extraBtns.push({
      label: t("jm_at.common.btn_prev_page", safePage),
      icon: "textures/ui/jm_at_back",
      key: "prev",
    });
  if (hasMore)
    extraBtns.push({
      label: t("jm_at.common.btn_next_page", safePage + 2),
      icon: "textures/ui/jm_at_next",
      key: "next",
    });
  const hasDeleteBtn = removableCount > 0;
  if (hasDeleteBtn) {
    const label =
      goneCount > 0 && closedCount === 0
        ? t("jm_at.tickets.btn_remove_deleted", goneCount)
        : t("jm_at.tickets.btn_clean_up", removableCount, closedCount, goneCount);
    extraBtns.push({ label, icon: "textures/ui/jm_at_remove", key: "delete" });
  }
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
  if (res.canceled) return showTicketsWarningsMenu(player); // X = Back

  if (res.selection < viewable.length) {
    const id = viewable[res.selection];
    if (id) {
      return showTicketDetail(player, id, {
        adminView: false,
        onBack: () => showMyTickets(player),
        onProfile: isStaff(player)
          ? (name, xuid, backToTicket) => {
              const t2 = getOnlinePlayerByName(name);
              if (t2) return showPlayerProfile(player, t2, backToTicket);
              if (xuid) return showOfflineProfile(player, xuid, backToTicket);
              tell(player, t("jm_at.common.player_not_found"));
            }
          : undefined,
      });
    }
  }

  const extra = extraBtns[res.selection - viewable.length];
  if (!extra) return;

  if (extra.key === "close") return;
  if (extra.key === "back") return showTicketsWarningsMenu(player);
  if (extra.key === "prev") return showMyTickets(player, safePage - 1);
  if (extra.key === "next") return showMyTickets(player, safePage + 1);

  if (extra.key === "delete") {
    const conf = await new MessageFormData()
      .title(t("jm_at.tickets.cleanup_title"))
      .body(t("jm_at.tickets.cleanup_body", removableCount, closedCount, goneCount))
      .button1(t("jm_at.common.btn_cancel"))
      .button2(t("jm_at.tickets.btn_remove"))
      .show(player);
    if (!conf.canceled && conf.selection === 1) {
      const uc = getPlayerCore(player);
      uc.myTickets = (uc.myTickets ?? []).filter((id) => {
        const f = findTicket(id);
        if (!f) return false;
        return f.ticket.status !== "CLOSED";
      });
      setPlayerCore(player, uc);
      tell(player, t("jm_at.tickets.cleanup_done", removableCount));
    }
    return showMyTickets(player, 0);
  }
}

// =========================================================
// Homes Menu
// =========================================================

export async function showHomesMenu(player) {
  const cfg = getCfg();
  if (cfg.homesEnabled === false) {
    tell(player, t("jm_at.homes.disabled"));
    return;
  }
  const homes = getHomes(player);
  const names = Object.keys(homes);
  const maxHomes = getMaxHomes();

  let policy;
  try { policy = getHomePolicy(); }
  catch (error) { return warnForm(player, `§c${error.message}`, () => showPlayerMain(player)); }
  const form = new ActionFormData()
    .title(t("jm_at.homes.title", names.length, maxHomes))
    .body(names.length ? t("jm_at.homes.body") : t("jm_at.homes.body_empty"));
  // Build handlers with their visible buttons so disabling bed travel cannot shift actions.
  const actions = [];
  const add = (label, icon, run) => { form.button(label, icon); actions.push(run); };
  if (policy.bedTeleportEnabled) add(t("jm_at.homes.btn_tp_bed"), "textures/ui/jm_at_bed", () => showTpToBed(player));
  add(t("jm_at.homes.btn_tp_home"), "textures/ui/jm_at_tp_to_home", () => showTpHome(player, homes, names));
  add(t("jm_at.homes.btn_set"), "textures/ui/jm_at_add_home", () => showSetHome(player, homes, names, maxHomes));
  add(t("jm_at.homes.btn_remove"), "textures/ui/jm_at_remove", () => showRemoveHome(player, homes, names));
  add(t("jm_at.homes.btn_update"), "textures/ui/jm_at_update_home", () => showUpdateHomeLocation(player, homes, names));
  add(t("jm_at.homes.btn_edit_icon"), "textures/ui/jm_at_homes", () => showEditHomeIcon(player, homes, names));
  add("§l家园传送规则", "textures/ui/jm_at_edit_menu", () => showOwnHomeRules(player));
  add("§l玩家家园目录（按角色）", "textures/ui/jm_at_players", () => showHomeDirectory(player, () => showHomesMenu(player)));
  add("§l家园访问申请与授权", "textures/ui/jm_at_lock", () => showHomeAccessMenu(player, () => showHomesMenu(player)));
  add("§l家园收益", "textures/ui/jm_at_homes", () => showHomeRevenue(player, () => showHomesMenu(player)));
  if (isAdmin(player).ok) add("§l家园统一管理（管理员）", "textures/ui/jm_at_control_panel", () => showHomeAdministration(player, () => showHomesMenu(player)));
  const backIndex = actions.length;
  form.button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back")
    .button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showPlayerMain(player); // X = Back
  if (res.selection === backIndex) return showPlayerMain(player); // Back
  if (res.selection === backIndex + 1) return; // Close
  return actions[res.selection]?.();
}

async function showOwnHomeRules(player) {
  const homes = getHomes(player);
  const names = Object.keys(homes);
  const form = new ActionFormData().title("家园传送规则").body("选择要配置的家园。");
  for (const name of names) form.button(name, getHomeIconPath(homes[name]));
  form.button("返回");
  const res = await form.show(player);
  const name = names[res.selection];
  if (res.canceled || name === undefined) return showHomesMenu(player);
  const destinationId = homes[name].destinationId;
  return showTravelRules(player, {
    kind: "home",
    getDestination: () => {
      const current = getHomes(player)[name];
      return current?.destinationId === destinationId ? current : undefined;
    },
    saveRules: (rules) => {
      const latest = getHomes(player);
      if (!latest[name] || latest[name].destinationId !== destinationId) return false;
      latest[name].rules = rules;
      return setHomes(player, latest);
    },
  }, () => showHomesMenu(player));
}

async function showTpToBed(player) {
  try {
    if (!bedTravelAllowed()) return warnForm(player, "§e管理员已关闭传送到床。", () => showHomesMenu(player));
  } catch (error) { return warnForm(player, `§c${error.message}`, () => showHomesMenu(player)); }
  let spawnPoint;
  try {
    spawnPoint = player.getSpawnPoint();
  } catch {}

  if (!spawnPoint) {
    const f = await new MessageFormData()
      .title(t("jm_at.homes.bed_title"))
      .body(t("jm_at.homes.bed_none"))
      .button1(t("jm_at.common.btn_back_bold"))
      .button2(t("jm_at.common.btn_close"))
      .show(player);
    if (f.canceled) return showHomesMenu(player); // X = Back
    if (f.selection === 0) return showHomesMenu(player); // Back
    return; // Close
  }

  // Spawn dimension may be a string or Dimension object.
  const dimId =
    typeof spawnPoint.dimension === "string"
      ? spawnPoint.dimension
      : (spawnPoint.dimension?.id ?? "minecraft:overworld");
  startDelayedTeleport(
    player,
    { x: spawnPoint.x, y: spawnPoint.y, z: spawnPoint.z },
    dimId,
    t("jm_at.homes.dest_bed"),
    () => showHomesMenu(player),
    bedTravelAllowed,
  );
}

function bedTravelAllowed() {
  return getCfg().homesEnabled !== false && getHomePolicy().bedTeleportEnabled;
}

async function showTpHome(player, homes, names) {
  if (names.length === 0) {
    return warnForm(player, t("jm_at.homes.none_saved"), () =>
      showHomesMenu(player),
    );
  }

  const locks = getCfg().dimLocks ?? {};
  const form = new ActionFormData()
    .title(t("jm_at.homes.tp_title"))
    .body(t("jm_at.homes.tp_body"));
  for (const n of names) {
    const h = homes[n];
    const dim = (h.dimension ?? "overworld").replace("minecraft:", "");
    const isLocked =
      (dim === "nether" && locks.nether) || (dim === "the_end" && locks.end);
    const lockedTag = isLocked ? raw(" ", t("jm_at.common.tag_locked")) : "";
    form.button(
      raw(
        `§s§l${n}`,
        lockedTag,
        `§r\n§8`,
        fmtDimRaw(h.dimension),
        ` (${Math.floor(h.x)}, ${Math.floor(h.y)}, ${Math.floor(h.z)})`,
      ),
      getHomeIconPath(h),
    );
  }
  form.button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back");
  form.button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showHomesMenu(player); // X = Back
  if (res.selection === names.length) return showHomesMenu(player); // Back
  if (res.selection === names.length + 1) return; // Close

  const name = names[res.selection];
  return visitHome(player, getPlayerXuid(player), name, () => showHomesMenu(player));
}

async function showSetHome(player, homes, names, maxHomes) {
  const nameObs = new ObservableString("", { clientWritable: true });
  const status = new ObservableString("");
  const statusShown = new ObservableBoolean(false);
  let pendingNav = null;
  const fail = (m) => {
    status.setData(m);
    statusShown.setData(true);
  };

  const form = new CustomForm(player, t("jm_at.homes.set_title"));
  form.textField(t("jm_at.homes.set_name_label"), nameObs, {
    description: t("jm_at.homes.set_name_desc"),
  });
  form.spacer();
  form.label(status, { visible: statusShown });
  form.spacer({ visible: statusShown });
  form.button(t("jm_at.common.btn_save"), () => {
    const name = clampText(nameObs.getData().trim(), 30);
    if (!validDestinationName(name)) {
      fail("§c家园名称须为 1–30 个字符，且不能含控制字符或保留名称。");
      return;
    }
    const latest = getHomes(player);
    if (!Object.prototype.hasOwnProperty.call(latest, name) && Object.keys(latest).length >= getMaxHomes()) {
      fail("§c已达到家园数量上限；可覆盖同名家园。");
      return;
    }
    homes = latest;
    pendingNav = async () => {
      if (homes[name]) {
        const h = homes[name];
        const dim = (h.dimension ?? "overworld").replace("minecraft:", "");
        const confirm = await new MessageFormData()
          .title(t("jm_at.homes.overwrite_title"))
          .body(
            t(
              "jm_at.homes.overwrite_body",
              name,
              raw(
                fmtDimRaw(h.dimension),
                ` (${Math.floor(h.x)}, ${Math.floor(h.y)}, ${Math.floor(h.z)})`,
              ),
            ),
          )
          .button1(t("jm_at.common.btn_cancel"))
          .button2(t("jm_at.homes.btn_overwrite"))
          .show(player);
        if (confirm.canceled || confirm.selection === 0)
          return showHomesMenu(player);
      }
      const coords = {
        x: player.location.x,
        y: player.location.y,
        z: player.location.z,
        dimension: player.dimension.id,
      };
      return showIconPicker(player, homes, name, coords);
    };
    try {
      form.close();
    } catch {}
  });
  form.button(t("jm_at.common.btn_back"), () => {
    pendingNav = () => showHomesMenu(player);
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(() => showSetHome(player, homes, names, maxHomes));
  }
  if (pendingNav) return system.run(pendingNav);
  return; // ✕ / engine close / escape → exit to game
}

async function showIconPicker(player, homes, name, coords) {
  const form = new ActionFormData()
    .title(t("jm_at.homes.icon_title"))
    .body(t("jm_at.homes.icon_body", name));
  for (const { key, labelKey } of HOME_ICONS) {
    form.button(raw("§0§l", t(labelKey)), `textures/ui/${key}`);
  }
  form.button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back");
  form.button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showHomesMenu(player); // X = Back
  if (res.selection === HOME_ICONS.length) return showHomesMenu(player); // Back
  if (res.selection === HOME_ICONS.length + 1) return; // Close

  const icon =
    res.selection < HOME_ICONS.length
      ? HOME_ICONS[res.selection].key
      : DEFAULT_HOME_ICON;

  homes = getHomes(player);
  if (!Object.prototype.hasOwnProperty.call(homes, name) && Object.keys(homes).length >= getMaxHomes()) {
    tell(player, t("jm_at.homes.limit_reached", getMaxHomes()));
    return showHomesMenu(player);
  }
  homes[name] = makeHomeAt(homes[name], coords, icon, () => genId("XAH"));
  if (!setHomes(player, homes)) {
    tell(player, "§c家园保存失败，请重试。");
    return showHomesMenu(player);
  }
  tell(player, t("jm_at.homes.saved", name));
  logPlayer(player, "HOME_SET", name);
  return showHomesMenu(player);
}

async function showRemoveHome(player, homes, names) {
  if (names.length === 0) {
    return warnForm(player, t("jm_at.homes.none_to_remove"), () =>
      showHomesMenu(player),
    );
  }

  const form = new ActionFormData()
    .title(t("jm_at.homes.remove_title"))
    .body(t("jm_at.homes.remove_body"));
  for (const n of names) form.button(`§l§c${n}`, getHomeIconPath(homes[n]));
  form.button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back");
  form.button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showHomesMenu(player); // X = Back
  if (res.selection === names.length) return showHomesMenu(player); // Back
  if (res.selection === names.length + 1) return; // Close

  const name = names[res.selection];
  const selectedGeneration = homes[name]?.destinationId || "legacy";
  const conf = await new MessageFormData()
    .title(t("jm_at.homes.delete_title"))
    .body(t("jm_at.homes.delete_body", name))
    .button1(t("jm_at.common.btn_cancel"))
    .button2(t("jm_at.homes.btn_delete_red"))
    .show(player);
  if (conf.canceled || conf.selection === 0)
    return showRemoveHome(player, homes, names);
  homes = getHomes(player);
  if (!homes[name] || (homes[name].destinationId || "legacy") !== selectedGeneration) {
    tell(player, "§e家园已删除或重新创建，请刷新后再操作。");
    return showHomesMenu(player);
  }
  delete homes[name];
  if (!setHomes(player, homes)) {
    tell(player, "§c删除保存失败，请重试。");
    return showHomesMenu(player);
  }
  tell(player, t("jm_at.homes.removed", name));
  logPlayer(player, "HOME_DELETE", name);
  return showHomesMenu(player);
}

async function showUpdateHomeLocation(player, homes, names) {
  if (names.length === 0) {
    return warnForm(player, t("jm_at.homes.none_to_update"), () =>
      showHomesMenu(player),
    );
  }

  const form = new ActionFormData()
    .title(t("jm_at.homes.update_title"))
    .body(t("jm_at.homes.update_body"));
  for (const n of names) {
    const h = homes[n];
    form.button(
      raw(
        `§0§l${n}§r\n§8`,
        fmtDimRaw(h.dimension),
        ` (${Math.floor(h.x)}, ${Math.floor(h.y)}, ${Math.floor(h.z)})`,
      ),
      getHomeIconPath(h),
    );
  }
  form.button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back");
  form.button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showHomesMenu(player); // X = Back
  if (res.selection === names.length) return showHomesMenu(player); // Back
  if (res.selection === names.length + 1) return; // Close

  const name = names[res.selection];
  const old = homes[name];

  const confirm = await new MessageFormData()
    .title(t("jm_at.homes.update_confirm_title"))
    .body(
      t(
        "jm_at.homes.update_confirm_body",
        name,
        raw(
          fmtDimRaw(old.dimension),
          ` (${Math.floor(old.x)}, ${Math.floor(old.y)}, ${Math.floor(old.z)})`,
        ),
        raw(
          fmtDimRaw(player.dimension.id),
          ` (${Math.floor(player.location.x)}, ${Math.floor(player.location.y)}, ${Math.floor(player.location.z)})`,
        ),
      ),
    )
    .button1(t("jm_at.common.btn_cancel"))
    .button2(t("jm_at.homes.btn_update_green"))
    .show(player);
  if (confirm.canceled || confirm.selection === 0) return showHomesMenu(player);

  homes = getHomes(player);
  if (!Object.prototype.hasOwnProperty.call(homes, name) ||
      (homes[name].destinationId || "legacy") !== (old.destinationId || "legacy")) {
    tell(player, "§e家园已删除或重新创建，请刷新后再操作。");
    return showHomesMenu(player);
  }
  homes[name] = makeHomeAt(homes[name], {
    x: player.location.x,
    y: player.location.y,
    z: player.location.z,
    dimension: player.dimension.id,
  }, undefined, () => genId("XAH"));
  if (!setHomes(player, homes)) {
    tell(player, "§c家园保存失败，请重试。");
    return showHomesMenu(player);
  }
  tell(player, t("jm_at.homes.updated", name));
  logPlayer(player, "HOME_UPDATE", name);
  return showHomesMenu(player);
}

async function showEditHomeIcon(player, homes, names) {
  if (names.length === 0) {
    return warnForm(player, t("jm_at.homes.none_to_edit"), () =>
      showHomesMenu(player),
    );
  }

  const form = new ActionFormData()
    .title(t("jm_at.homes.edit_icon_title"))
    .body(t("jm_at.homes.edit_icon_body"));
  for (const n of names) {
    form.button(`§0§l${n}`, getHomeIconPath(homes[n]));
  }
  form.button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back");
  form.button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showHomesMenu(player); // X = Back
  if (res.selection === names.length) return showHomesMenu(player); // Back
  if (res.selection === names.length + 1) return; // Close

  const name = names[res.selection];
  const home = homes[name];

  const picker = new ActionFormData()
    .title(t("jm_at.homes.icon_title"))
    .body(t("jm_at.homes.icon_body_new", name));
  for (const { key, labelKey } of HOME_ICONS) {
    picker.button(raw("§0§l", t(labelKey)), `textures/ui/${key}`);
  }
  picker.button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back");
  picker.button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const pRes = await picker.show(player);
  if (pRes.canceled) return showEditHomeIcon(player, homes, names); // X = Back
  if (pRes.selection === HOME_ICONS.length)
    return showEditHomeIcon(player, homes, names); // Back
  if (pRes.selection === HOME_ICONS.length + 1) return; // Close
  if (pRes.selection >= HOME_ICONS.length) return showHomesMenu(player);

  homes = getHomes(player);
  if (!homes[name] || (homes[name].destinationId || "legacy") !== (home.destinationId || "legacy")) {
    tell(player, "§e家园已删除或重新创建，请刷新后再操作。");
    return showHomesMenu(player);
  }
  homes[name].icon = HOME_ICONS[pRes.selection].key;
  if (!setHomes(player, homes)) {
    tell(player, "§c图标保存失败，请重试。");
    return showHomesMenu(player);
  }
  tell(player, t("jm_at.homes.icon_updated", name));
  return showHomesMenu(player);
}

// =========================================================
// Deathback
// =========================================================

async function showDeathback(player) {
  const cfg = getCfg();

  if (cfg.deathbackEnabled === false) {
    const f = await new MessageFormData()
      .title(t("jm_at.deathback.title"))
      .body(t("jm_at.deathback.disabled"))
      .button1(t("jm_at.common.btn_back_bold"))
      .button2(t("jm_at.common.btn_close"))
      .show(player);
    if (f.canceled) return showPlayerMain(player); // X = Back
    if (f.selection === 0) return showPlayerMain(player); // Back
    return; // Close
  }

  const core = getPlayerCore(player);
  if (!core.lastDeathPos || !core.lastDeathDim) {
    const f = await new MessageFormData()
      .title(t("jm_at.deathback.title"))
      .body(t("jm_at.deathback.none"))
      .button1(t("jm_at.common.btn_back_bold"))
      .button2(t("jm_at.common.btn_close"))
      .show(player);
    if (f.canceled) return showPlayerMain(player); // X = Back
    if (f.selection === 0) return showPlayerMain(player); // Back
    return; // Close
  }

  const pos = core.lastDeathPos;
  const dimId = core.lastDeathDim; // Full dimension ID.
  const dimShort = dimId.replace("minecraft:", ""); // Short ID for teleport.

  // Use saved death cause; the chunk may not be loaded here.
  const cause = core.lastDeathCause ?? "";
  let unsafe = false;
  let unsafeReason = null;
  if (cause === "lava") {
    unsafe = true;
    unsafeReason = t("jm_at.deathback.hazard_lava");
  } else if (cause === "fire" || cause === "fireTick") {
    unsafe = true;
    unsafeReason = t("jm_at.deathback.hazard_fire");
  } else if (cause === "void" || pos.y < -60) {
    unsafe = true;
    unsafeReason = t("jm_at.deathback.hazard_void");
  }

  // Dimension name via fmtDimRaw so it translates; coordStr is a RawMessage
  // passed into the deathback body's %s param.
  const coordStr = raw(
    `§8X: ${pos.x}  Y: ${pos.y}  Z: ${pos.z}  (`,
    fmtDimRaw(dimId),
    ")",
  );
  const body = unsafe
    ? t("jm_at.deathback.body_unsafe", unsafeReason, coordStr)
    : t("jm_at.deathback.body", coordStr);

  const f = await new MessageFormData()
    .title(t("jm_at.deathback.title"))
    .body(body)
    .button1(t("jm_at.common.btn_back_bold"))
    .button2(
      unsafe ? t("jm_at.deathback.btn_tp_anyway") : t("jm_at.deathback.btn_tp"),
    )
    .show(player);

  if (f.canceled) return showPlayerMain(player); // X = Back
  if (f.selection === 0) return showPlayerMain(player); // Back

  logPlayer(player, "DEATHBACK", `${pos.x},${pos.y},${pos.z} in ${dimId}`);
  startDelayedTeleport(player, pos, dimShort, t("jm_at.deathback.dest"), () =>
    showPlayerMain(player),
  );
}

// =========================================================
// Warps Menu
// =========================================================

export async function showWarpsMenu(player, page = 0) {
  const warps = getWarps();
  // Filter by warp access tier.
  const names = getSortedWarpNames(warps).filter((n) =>
    canAccessWarp(player, warps[n]),
  );

  if (names.length === 0) {
    const f = await new MessageFormData()
      .title(t("jm_at.warps.title"))
      .body(t("jm_at.warps.none"))
      .button1(t("jm_at.common.btn_back_bold"))
      .button2(t("jm_at.common.btn_close"))
      .show(player);
    if (f.canceled) return showPlayerMain(player); // X = Back
    if (f.selection === 0) return showPlayerMain(player); // Back
    return; // Close
  }

  const totalPages = Math.max(1, Math.ceil(names.length / WARPS_PER_PAGE));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const shown = names.slice(
    safePage * WARPS_PER_PAGE,
    (safePage + 1) * WARPS_PER_PAGE,
  );
  const hasPrev = safePage > 0;
  const hasMore = (safePage + 1) * WARPS_PER_PAGE < names.length;

  const pageLabel =
    totalPages > 1
      ? t("jm_at.common.page_suffix_dash", safePage + 1, totalPages)
      : "";
  const locks = getCfg().dimLocks ?? {};
  const form = new ActionFormData()
    .title(t("jm_at.warps.title"))
    .body(raw(t("jm_at.warps.body"), pageLabel));
  for (const n of shown) {
    const w = warps[n];
    const dim = (w.dimension ?? "overworld").replace("minecraft:", "");
    const access = getWarpAccess(w);
    const accessTag =
      access === "admin"
        ? raw(" ", t("jm_at.warps.tag_admin"))
        : access === "staff"
          ? raw(" ", t("jm_at.warps.tag_staff"))
          : "";
    const isLocked =
      (dim === "nether" && locks.nether) || (dim === "the_end" && locks.end);
    const lockedTag = isLocked ? raw(" ", t("jm_at.common.tag_locked")) : "";
    const icon =
      dim === "nether"
        ? "textures/ui/jm_at_nether"
        : dim === "the_end"
          ? "textures/ui/jm_at_end"
          : "textures/ui/jm_at_warps";
    const pinnedTag = w.pinned ? "§e* " : "";
    form.button(
      raw(`${pinnedTag}§l§s${n}`, accessTag, lockedTag, "§r\n", fmtDimRaw(w.dimension)),
      icon,
    );
  }

  // Append navigation after the warp list.
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
  navBtns.push({
    label: t("jm_at.common.btn_back_bold"),
    icon: "textures/ui/jm_at_back",
    key: "back",
  });
  navBtns.push({ label: CLOSE_BTN_LABEL, icon: CLOSE_BTN_ICON, key: "close" });
  for (const btn of navBtns) form.button(btn.label, btn.icon);

  const res = await form.show(player);
  if (res.canceled) return showPlayerMain(player); // X = Back

  if (res.selection < shown.length) {
    const name = shown[res.selection];
    startRuleTeleport(player, {
      kind: "warp", name,
      getDestination: () => getWarps()[name],
      authorize: () => {
        const current = getWarps()[name];
        return (getCfg().warpsVisible !== false || isStaff(player)) && !!current && canAccessWarp(player, current);
      },
      onSuccess: () => logPlayer(player, "WARP_USE", name),
    }, () => showWarpsMenu(player, safePage));
    return;
  }

  const nav = navBtns[res.selection - shown.length];
  if (!nav) return;
  if (nav.key === "close") return;
  if (nav.key === "back") return showPlayerMain(player);
  if (nav.key === "prev") return showWarpsMenu(player, safePage - 1);
  if (nav.key === "next") return showWarpsMenu(player, safePage + 1);
}

// =========================================================
// TPA Menu
// =========================================================

export async function showTpaMenu(player) {
  const incoming = getIncomingRequests(player);
  const core = getPlayerCore(player);
  const hasLastTp = !!(core.lastTpFromLoc && core.lastTpFromDim);

  const actions = [];
  actions.push({
    label: t("jm_at.tpa.menu_btn_send"),
    fn: () => showTpaSend(player),
  });
  if (incoming.length > 0) {
    actions.push({
      label: t("jm_at.tpa.menu_btn_accept", incoming.length),
      fn: () => showTpaAccept(player, incoming),
    });
  }
  if (hasLastTp) {
    const p = core.lastTpFromLoc;
    actions.push({
      label: t(
        "jm_at.tpa.menu_btn_last",
        Math.round(p.x),
        Math.round(p.y),
        Math.round(p.z),
      ),
      fn: () =>
        startDelayedTeleport(
          player,
          core.lastTpFromLoc,
          core.lastTpFromDim,
          t("jm_at.tpa.dest_last_location"),
          () => showTpaMenu(player),
        ),
    });
  }

  const form = new ActionFormData()
    .title(t("jm_at.tpa.menu_title"))
    .body(
      incoming.length
        ? t("jm_at.tpa.menu_body_pending", incoming.length)
        : t("jm_at.tpa.menu_body"),
    );
  for (const a of actions) form.button(a.label);
  form.button(t("jm_at.common.btn_back_bold"));
  form.button(CLOSE_BTN_LABEL);

  const res = await form.show(player);
  if (res.canceled) return showPlayerMain(player); // X = Back
  if (res.selection === actions.length) return showPlayerMain(player); // Back
  if (res.selection === actions.length + 1) return; // Close
  if (res.selection >= 0 && res.selection < actions.length)
    return actions[res.selection].fn();
}

async function showTpaSend(player) {
  const allPlayers = world.getPlayers().filter((p) => p.name !== player.name);

  if (allPlayers.length === 0) {
    return warnForm(player, t("jm_at.tpa.no_players"), () =>
      showTpaMenu(player),
    );
  }

  const form = new ActionFormData()
    .title(t("jm_at.tpa.send_title"))
    .body(t("jm_at.tpa.send_body"));
  for (const p of allPlayers) form.button(`§l§g${p.name}`);
  form.button(t("jm_at.common.btn_back_bold"));
  form.button(CLOSE_BTN_LABEL);

  const res = await form.show(player);
  if (res.canceled) return showTpaMenu(player); // X = Back
  if (res.selection === allPlayers.length) return showTpaMenu(player); // Back
  if (res.selection === allPlayers.length + 1) return; // Close

  const target = allPlayers[res.selection];
  sendTpaRequest(player, target);
  logPlayer(player, "TPA_SEND", target.name);
  return showTpaMenu(player);
}

async function showTpaAccept(player, incoming) {
  const form = new ActionFormData()
    .title(t("jm_at.tpa.incoming_title"))
    .body(t("jm_at.tpa.incoming_body"));

  for (const req of incoming) {
    form.button(t("jm_at.tpa.incoming_entry", req.requesterName));
  }
  form.button(t("jm_at.common.btn_back_bold"));
  form.button(CLOSE_BTN_LABEL);

  const res = await form.show(player);
  if (res.canceled) return showTpaMenu(player); // X = Back
  if (res.selection === incoming.length) return showTpaMenu(player); // Back
  if (res.selection === incoming.length + 1) return; // Close

  const req = incoming[res.selection];

  const action = await new MessageFormData()
    .title(t("jm_at.tpa.confirm_title", req.requesterName))
    .body(t("jm_at.tpa.confirm_body", req.requesterName))
    .button1(t("jm_at.tpa.btn_decline"))
    .button2(t("jm_at.tpa.btn_accept"))
    .show(player);

  if (action.canceled) {
    // Closing the confirm keeps the request pending.
    return showTpaMenu(player);
  }
  if (action.selection === 0) {
    declineTpaRequest(player, req);
    logPlayer(player, "TPA_DECLINE", req.requesterName);
  } else {
    acceptTpaRequest(player, req);
    logPlayer(player, "TPA_ACCEPT", req.requesterName);
  }
  return showTpaMenu(player);
}

// =========================================================
// Shared: delayed teleport with movement cancel
// =========================================================

function startDelayedTeleport(player, targetPos, dimensionId, label, backFn, validate = () => true) {
  const allowed = () => {
    try { if (validate() === true) return true; }
    catch (error) { tell(player, `§c${error.message}`); return false; }
    tell(player, "§e传送已取消：管理员已关闭此传送功能。");
    return false;
  };
  if (!allowed()) return;
  // `label` may be a plain string (home/warp names — user content) or a
  // RawMessage (t("jm_at.homes.dest_bed") etc.) — t()'s param handling and
  // raw() accept both.
  const cfg = getCfg();
  const delaySec = Number.isFinite(cfg.tpaDelaySec) ? Math.max(0, cfg.tpaDelaySec) : 3;
  // Use short dimension IDs for getDimension().
  const dimShort = dimensionId.replace("minecraft:", "");

  // Respect dimension locks; admins bypass them.
  if (!isAdmin(player).ok) {
    const locks = cfg.dimLocks ?? {};
    const dim = dimShort;
    if (
      (dim === "nether" && locks.nether) ||
      (dim === "the_end" && locks.end)
    ) {
      tell(
        player,
        t(
          "jm_at.tpa.dim_locked",
          t(dim === "nether" ? "jm_at.common.dim_nether" : "jm_at.common.dim_end"),
        ),
      );
      return;
    }
  }

  // Ask whether to bring, leave, or cancel the current mount.
  return confirmBringMount(player, world.getDimension(dimShort), targetPos).then(
    (choice) => {
      if (choice === "cancel") {
        tell(player, t("jm_at.tp.canceled"));
        return;
      }
      const bring = choice === "bring";
      if (!allowed()) return;
      const startLoc = { ...player.location };
      const startDim = player.dimension.id;

      const execute = () => teleportPlayer(player, targetPos, {
        dimension: world.getDimension(dimShort), askToBringMount: true, bringMount: bring,
        beforeTeleport() {
          if (!allowed()) return false;
          captureTpBackLocation(player);
          teleportedPlayers.add(player.id);
          return true;
        },
      }).then((ok) => {
        if (!ok) return tell(player, t("jm_at.tp.failed"));
        try { setHudTitle(player, "§2✔", { fadeInDuration: 0, stayDuration: 30, fadeOutDuration: 10, subtitle: t("jm_at.tp.title_arrived", label) }); } catch {}
        tell(player, t("jm_at.tp.done", label));
      }).catch(() => tell(player, t("jm_at.tp.failed")));

      if (delaySec <= 0) {
        try {
          execute();
        } catch {
          tell(player, t("jm_at.tp.failed"));
        }
        return;
      }

      const startTick = system.currentTick;
      beginTravelWait(player, delaySec, label);
      let lastSecond = Math.ceil(delaySec);
      const finishWait = () => { system.clearRun(waitId); clearTravelWait(player); };
      const waitId = system.runInterval(() => {
        try {
          if (!player.isValid || !allowed()) { finishWait(); return; }
          const moved =
            player.dimension.id !== startDim ||
            Math.hypot(
              player.location.x - startLoc.x,
              player.location.y - startLoc.y,
              player.location.z - startLoc.z,
            ) > 0.5;
          if (moved) {
            finishWait();
            try {
              setHudTitle(player, t("jm_at.tp.title_canceled"), {
                fadeInDuration: 0,
                stayDuration: 30,
                fadeOutDuration: 10,
                subtitle: t("jm_at.tp.title_you_moved"),
              });
            } catch {}
            tell(player, t("jm_at.tp.canceled_moved"));
            return;
          }
          const remaining = Math.ceil(delaySec - (system.currentTick - startTick) / 20);
          if (remaining <= 0) {
            finishWait();
            execute();
            return;
          }
          if (remaining !== lastSecond || (system.currentTick - startTick) % 5 === 0) {
            showTravelWait(player, remaining, label, { title: remaining !== lastSecond });
            lastSecond = remaining;
          }
        } catch (e) {
          silentCatch("ui_tp_movecheck", e);
          finishWait();
          tell(player, t("jm_at.tp.failed"));
        }
      }, 1);
    },
  );
}
