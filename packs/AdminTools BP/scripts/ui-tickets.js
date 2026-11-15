/** Shared ticket detail view and prompt dialogs. */

import {
  ActionFormData,
  MessageFormData,
  CustomForm,
  ObservableString,
  ObservableBoolean,
  DataDrivenScreenClosedReason,
} from "@minecraft/server-ui";
import { system } from "@minecraft/server";
import {
  nowMs,
  tell,
  warnForm,
  fmtMsRaw,
  fmtDim,
  clampText,
  confirmDiscardChanges,
  getPlayerXuid,
  getOnlinePlayerByName,
  CLOSE_BTN_LABEL,
  CLOSE_BTN_ICON,
} from "./utils.js";
import { queuePlayerNotif, getTicketMeta, setTicketMeta } from "./storage.js";
import { t, raw } from "./i18n.js";
import { isAdmin, requireAdminOrModCan } from "./permissions.js";
import { logAdmin } from "./log.js";
import {
  findTicket,
  saveTicket,
  moveTicketId,
  claimTicket,
  unclaimTicket,
  resolveTicket,
  closeTicket,
  purgeTicketIds,
} from "./tickets.js";
import { doTpToLoc } from "./moderation.js";

// =========================================================
// Ticket body formatter
// =========================================================

/** Ticket status enum -> lang key. Values outside the enum display raw. */
// lang-keys: jm_at.tickets.status_*
const STATUS_KEYS = {
  OPEN: "jm_at.tickets.status_open",
  CLAIMED: "jm_at.tickets.status_claimed",
  RESOLVED: "jm_at.tickets.status_resolved",
  CLOSED: "jm_at.tickets.status_closed",
};

export function formatTicketBody(ticket) {
  // Submitter name, category (admin-configured list) and desc/notes are
  // stored/user content — passed through raw. Labels + status are translated.
  const submit = ticket.submitter?.name
    ? { text: ticket.submitter.name }
    : t("jm_at.common.unknown");
  const cat = ticket.category ?? "Other";
  const statusRaw = ticket.status ?? "OPEN";
  const status = STATUS_KEYS[statusRaw]
    ? t(STATUS_KEYS[statusRaw])
    : { text: statusRaw };
  const created = fmtMsRaw(ticket.createdAt);
  const parts = [
    `§9${ticket.id}§r\n`,
    t("jm_at.tickets.detail_status", status),
    "\n",
    t("jm_at.tickets.detail_category", cat),
    "\n",
    t("jm_at.tickets.detail_submitter", submit),
    "\n",
    t("jm_at.tickets.detail_created", created),
  ];
  if (ticket.submitLoc) {
    parts.push(
      "\n",
      t(
        "jm_at.tickets.detail_location",
        `${fmtDim(ticket.submitLoc.dim)} (${ticket.submitLoc.x}, ${ticket.submitLoc.y}, ${ticket.submitLoc.z})`,
      ),
    );
  }
  if (ticket.claimedBy?.name) {
    parts.push("\n", t("jm_at.tickets.detail_claimed_by", ticket.claimedBy.name));
  }
  parts.push(`\n\n${ticket.desc ?? ""}`);
  if (ticket.resolution?.note) {
    parts.push("\n\n", t("jm_at.tickets.detail_resolution", ticket.resolution.note));
  }
  if (ticket.closed?.note) {
    parts.push("\n\n", t("jm_at.tickets.detail_closed_note", ticket.closed.note));
  }
  if (ticket.adminReply) {
    parts.push(
      "\n\n",
      t(
        "jm_at.tickets.detail_staff_reply",
        ticket.adminReply.note,
        ticket.adminReply.byName,
      ),
    );
  }
  return raw(...parts);
}

// =========================================================
// Ticket detail
// =========================================================

export async function showTicketDetail(player, ticketId, opts = {}) {
  const found = findTicket(ticketId);
  if (!found) {
    tell(player, t("jm_at.tickets.not_found"));
    return;
  }
  // Named `tk`, not `t` — `t` is the i18n translate helper in this module.
  const tk = found.ticket;
  const isAdm = isAdmin(player).ok;

  // Mark closed tickets seen once the submitter opens them.
  if (!isAdm && tk.status === "CLOSED" && !tk.submitterSeen) {
    if (getPlayerXuid(player) === tk.submitter?.xuid) {
      tk.submitterSeen = true;
      saveTicket(found);
    }
  }

  // Viewing a resolution closes the submitter's ticket.
  if (!isAdm && tk.status === "RESOLVED") {
    if (getPlayerXuid(player) === tk.submitter?.xuid) {
      try {
        const meta = getTicketMeta();
        tk.status = "CLOSED";
        tk.closed = {
          note: "提交者确认处理结果后自动关闭。",
          closedAt: nowMs(),
          byXuid: "",
          byName: "System",
        };
        tk.submitterSeen = true;
        saveTicket(found);
        if (meta.resolved.includes(tk.id))
          moveTicketId(meta, "resolved", "closed", tk.id);
        setTicketMeta(meta);
      } catch {}
    }
  }

  let isStf = false;
  try { requireAdminOrModCan(player, "tickets", "查看工单操作"); isStf = true; } catch {}
  // Buttons carry an action tag — labels are RawMessage translate keys, so
  // dispatch must never compare label text.
  const actionBtns = [];
  if (isStf) {
    if (tk.status === "OPEN")
      actionBtns.push({ label: t("jm_at.tickets.btn_claim"), action: "claim" });
    if (tk.status === "CLAIMED")
      actionBtns.push({ label: t("jm_at.tickets.btn_unclaim"), action: "unclaim" });
    if (tk.status !== "CLOSED") {
      actionBtns.push({ label: t("jm_at.tickets.btn_resolve"), action: "resolve" });
      actionBtns.push({ label: t("jm_at.tickets.btn_reply"), action: "reply" });
      actionBtns.push({ label: t("jm_at.tickets.btn_close_ticket"), action: "closeTicket" });
    }
    if (tk.submitLoc && isAdm)
      actionBtns.push({ label: t("jm_at.tickets.btn_tp"), action: "tp" });
    if (tk.submitter?.name)
      actionBtns.push({
        label: t("jm_at.tickets.btn_profile", tk.submitter.name),
        action: "profile",
      });
    if (tk.status === "CLOSED" && isAdm)
      actionBtns.push({ label: t("jm_at.tickets.btn_delete"), action: "delete" });
  }
  actionBtns.push({ label: t("jm_at.common.btn_back_bold"), action: "back" });
  actionBtns.push({ label: CLOSE_BTN_LABEL, action: "close" });

  const form = new ActionFormData()
    .title(t("jm_at.tickets.detail_title"))
    .body(formatTicketBody(tk));
  for (const b of actionBtns) form.button(b.label);

  const res = await form.show(player);
  if (res.canceled) return opts.onBack?.(); // X = Back.

  const action = actionBtns[res.selection]?.action;

  if (action === "close") return; // Close.
  if (action === "back") {
    return opts.onBack?.();
  }

  if (action === "tp") {
    try {
      const sl = tk.submitLoc;
      doTpToLoc(player, sl.dim, sl.x, sl.y, sl.z);
    } catch (e) {
      return warnForm(
        player,
        t("jm_at.common.error_generic", e?.message ?? t("jm_at.adm.err_unknown")),
        () => showTicketDetail(player, ticketId, opts),
      );
    }
    return showTicketDetail(player, ticketId, opts);
  }

  if (action === "profile") {
    return opts.onProfile?.(tk.submitter?.name, tk.submitter?.xuid, () =>
      showTicketDetail(player, ticketId, opts),
    );
  }

  try {
    if (action === "claim") {
      claimTicket(player, ticketId);
      tell(player, t("jm_at.tickets.claimed", ticketId));
    }
    if (action === "unclaim") {
      unclaimTicket(player, ticketId);
      tell(player, t("jm_at.tickets.unclaimed", ticketId));
    }
    if (action === "resolve") return promptResolve(player, ticketId, opts);
    if (action === "reply") return promptAdminReply(player, ticketId, opts);
    if (action === "closeTicket") return promptClose(player, ticketId, opts);
    if (action === "delete") {
      const conf = await new MessageFormData()
        .title(t("jm_at.tickets.delete_title"))
        .body(t("jm_at.tickets.delete_body", ticketId))
        .button1(t("jm_at.common.btn_cancel"))
        .button2(t("jm_at.common.btn_delete"))
        .show(player);
      if (!conf.canceled && conf.selection === 1) {
        purgeTicketIds([ticketId]);
        logAdmin(player, "TICKET_DELETE", ticketId);
        tell(player, t("jm_at.tickets.deleted", ticketId));
        return opts.onBack?.();
      }
      return showTicketDetail(player, ticketId, opts);
    }
  } catch (e) {
    return warnForm(
      player,
      t("jm_at.common.error_generic", e?.message ?? t("jm_at.adm.err_unknown")),
      () => showTicketDetail(player, ticketId, opts),
    );
  }

  return showTicketDetail(player, ticketId, opts);
}

// =========================================================
// Ticket prompt dialogs
// =========================================================

export async function promptResolve(player, ticketId, opts = {}, initial = {}) {
  const noteObs = new ObservableString(initial.note ?? "", {
    clientWritable: true,
  });
  // NOTE (i18n): `status` is bound to an ObservableString, which only holds
  // plain strings — live DDUI status uses server-side Chinese.
  const status = new ObservableString("");
  const statusShown = new ObservableBoolean(false);
  const back = () => showTicketDetail(player, ticketId, opts);
  let pendingNav = null;
  let intent = null;

  const form = new CustomForm(player, t("jm_at.tickets.resolve_title"));
  form.spacer();
  form.textField(t("jm_at.tickets.resolve_note_label"), noteObs, {
    description: t("jm_at.tickets.resolve_note_desc"),
  });
  form.spacer();
  form.label(status, { visible: statusShown });
  form.spacer({ visible: statusShown });

  const submit = (close) => {
    const note = clampText(String(noteObs.getData() ?? "").trim(), 300);
    if (!note) {
      status.setData("§c请输入处理说明。");
      statusShown.setData(true);
      return;
    }
    try {
      resolveTicket(player, ticketId, note);
      tell(player, t("jm_at.tickets.resolved", ticketId));
      pendingNav = close ? () => {} : back;
    } catch (e) {
      status.setData(
        `§c操作失败：${e?.message ?? "未知错误。"}`,
      );
      statusShown.setData(true);
      return;
    }
    try {
      form.close();
    } catch {}
  };
  form.button(t("jm_at.tickets.btn_resolve_plain"), () => submit(false));
  form.button(t("jm_at.tickets.btn_resolve_exit"), () => submit(true));
  form.button(t("jm_at.common.btn_back"), () => {
    intent = "back";
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(() =>
      promptResolve(player, ticketId, opts, { note: noteObs.getData() }),
    );
  }
  if (pendingNav) return system.run(pendingNav);
  // Back → ticket detail; ✕ / engine close / escape → exit to game. If a note was
  // typed, confirm first — Keep editing reopens with the text preserved.
  const goBack = intent === "back";
  if (noteObs.getData().trim().length > 0) {
    const keep = { note: noteObs.getData() };
    return system.run(async () => {
      if (await confirmDiscardChanges(player))
        return promptResolve(player, ticketId, opts, keep);
      if (goBack) return back();
    });
  }
  if (goBack) return system.run(back);
}

export async function promptAdminReply(
  player,
  ticketId,
  opts = {},
  initial = {},
) {
  try {
    requireAdminOrModCan(player, "tickets", "回复工单");
  } catch {
    return;
  }
  const noteObs = new ObservableString(initial.note ?? "", {
    clientWritable: true,
  });
  const status = new ObservableString("");
  const statusShown = new ObservableBoolean(false);
  const back = () => showTicketDetail(player, ticketId, opts);
  let pendingNav = null;
  let intent = null;

  const form = new CustomForm(player, t("jm_at.tickets.reply_title"));
  form.spacer();
  form.textField(t("jm_at.tickets.reply_label"), noteObs, {
    description: t("jm_at.tickets.reply_desc"),
  });
  form.spacer();
  form.label(status, { visible: statusShown });
  form.spacer({ visible: statusShown });

  const submit = (close) => {
    const note = clampText(String(noteObs.getData() ?? ""), 300);
    if (note.trim().length < 2) {
      status.setData("§c回复内容过短，请补充说明。");
      statusShown.setData(true);
      return;
    }
    const found = findTicket(ticketId);
    if (!found) {
      status.setData("§c找不到该工单。");
      statusShown.setData(true);
      return;
    }
    found.ticket.adminReply = { note, byName: player.name, at: nowMs() };
    saveTicket(found);
    logAdmin(player, "TICKET_REPLY", `${ticketId} — ${note.slice(0, 60)}`);
    if (found.ticket.submitter?.xuid) {
      queuePlayerNotif(
        found.ticket.submitter.xuid,
        `§9[工单 ${ticketId}] ${player.name} 的回复：§r${note}`,
      );
    }
    tell(player, t("jm_at.tickets.reply_saved"));
    pendingNav = close ? () => {} : back;
    try {
      form.close();
    } catch {}
  };
  form.button(t("jm_at.tickets.btn_reply_send"), () => submit(false));
  form.button(t("jm_at.tickets.btn_reply_send_exit"), () => submit(true));
  form.button(t("jm_at.common.btn_back"), () => {
    intent = "back";
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(() =>
      promptAdminReply(player, ticketId, opts, { note: noteObs.getData() }),
    );
  }
  if (pendingNav) return system.run(pendingNav);
  // Back → ticket detail; ✕ / engine close / escape → exit to game. If a reply was
  // typed, confirm first — Keep editing reopens with the text preserved.
  const goBack = intent === "back";
  if (noteObs.getData().trim().length > 0) {
    const keep = { note: noteObs.getData() };
    return system.run(async () => {
      if (await confirmDiscardChanges(player))
        return promptAdminReply(player, ticketId, opts, keep);
      if (goBack) return back();
    });
  }
  if (goBack) return system.run(back);
}

export async function promptClose(player, ticketId, opts = {}, initial = {}) {
  const noteObs = new ObservableString(initial.note ?? "", {
    clientWritable: true,
  });
  const status = new ObservableString("");
  const statusShown = new ObservableBoolean(false);
  const back = () => showTicketDetail(player, ticketId, opts);
  let pendingNav = null;
  let intent = null;

  const form = new CustomForm(player, t("jm_at.tickets.close_title"));
  form.spacer();
  form.textField(t("jm_at.tickets.close_note_label"), noteObs, {
    description: t("jm_at.tickets.close_note_desc"),
  });
  form.spacer();
  form.label(status, { visible: statusShown });
  form.spacer({ visible: statusShown });

  const submit = (close) => {
    const note = clampText(String(noteObs.getData() ?? "").trim(), 300);
    try {
      closeTicket(player, ticketId, note);
      tell(player, t("jm_at.tickets.closed_done", ticketId));
      pendingNav = close ? () => {} : back;
    } catch (e) {
      status.setData(
        `§c操作失败：${e?.message ?? "未知错误。"}`,
      );
      statusShown.setData(true);
      return;
    }
    try {
      form.close();
    } catch {}
  };
  form.button(t("jm_at.tickets.btn_close_plain"), () => submit(false));
  form.button(t("jm_at.tickets.btn_close_exit"), () => submit(true));
  form.button(t("jm_at.common.btn_back"), () => {
    intent = "back";
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(() =>
      promptClose(player, ticketId, opts, { note: noteObs.getData() }),
    );
  }
  if (pendingNav) return system.run(pendingNav);
  // Back → ticket detail; ✕ / engine close / escape → exit to game. If a note was
  // typed, confirm first — Keep editing reopens with the text preserved.
  const goBack = intent === "back";
  if (noteObs.getData().trim().length > 0) {
    const keep = { note: noteObs.getData() };
    return system.run(async () => {
      if (await confirmDiscardChanges(player))
        return promptClose(player, ticketId, opts, keep);
      if (goBack) return back();
    });
  }
  if (goBack) return system.run(back);
}
