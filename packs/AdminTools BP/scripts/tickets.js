/** Ticket creation, lookup, and lifecycle actions. */

import { NS, LIMITS } from "./constants.js";
import {
  nowMs,
  clampText,
  genId,
  getPlayerXuid,
  broadcastAdmins,
  tell,
} from "./utils.js";
import {
  getCfg,
  getTicketMeta,
  setTicketMeta,
  loadTicketPage,
  saveTicketPage,
  getPlayerCore,
  setPlayerCore,
  queuePlayerNotif,
  queueStaffAlert,
} from "./storage.js";
import { requireAdmin, requireAdminOrModCan } from "./permissions.js";
import { logAdmin } from "./log.js";
import { t } from "./i18n.js";

// =========================================================
// Ticket storage helpers
// =========================================================

export function findTicket(ticketId) {
  const meta = getTicketMeta();
  const pageIndex = meta.idToPage?.[ticketId];
  if (pageIndex === undefined) return null;
  const page = loadTicketPage(pageIndex);
  const idx = page.findIndex((t) => t?.id === ticketId);
  if (idx < 0) return null;
  return { ticket: page[idx], pageIndex, idx, meta, page };
}

export function saveTicket(found) {
  const { ticket, pageIndex, idx, page } = found;
  ticket.updatedAt = nowMs();
  page[idx] = ticket;
  saveTicketPage(pageIndex, page);
}

function allocTicketSlot(ticketObj, initialBucket = "open") {
  const meta = getTicketMeta();
  const start = Math.max(0, meta.pagesUsed - 1);
  const order = [];
  for (let i = start; i < LIMITS.TICKET_PAGES; i++) order.push(i);
  for (let i = 0; i < start; i++) order.push(i);
  for (const i of order) {
    const page = loadTicketPage(i);
    if (page.length < LIMITS.TICKETS_PER_PAGE) {
      page.push(ticketObj);
      saveTicketPage(i, page);
      meta.idToPage[ticketObj.id] = i;
      if (i >= meta.pagesUsed) meta.pagesUsed = i + 1;
      if (!meta[initialBucket]) meta[initialBucket] = [];
      if (!meta[initialBucket].includes(ticketObj.id)) {
        meta[initialBucket].push(ticketObj.id);
      }
      setTicketMeta(meta);
      return true;
    }
  }
  return false;
}

export function moveTicketId(meta, from, to, id) {
  const fi = meta[from].indexOf(id);
  if (fi >= 0) meta[from].splice(fi, 1);
  if (!meta[to].includes(id)) meta[to].push(id);
}

// =========================================================
// Ticket actions
// =========================================================

/** Return the current reason a player cannot submit a ticket (RawMessage), or null. */
export function ticketSubmitBlockReason(submitter) {
  const cfg = getCfg();
  if (!cfg.ticketingOpen) return t("jm_at.tickets.system_closed");
  const core = getPlayerCore(submitter);
  const now = nowMs();
  const cooldownMs = (cfg.submitCooldownSec ?? 120) * 1000;
  if (cooldownMs > 0 && now - (core.lastSubmitAt ?? 0) < cooldownMs) {
    const left = Math.ceil((cooldownMs - (now - core.lastSubmitAt)) / 1000);
    return t("jm_at.tickets.submit_cooldown", left);
  }
  const ticketLimit = cfg.ticketLimit ?? 5;
  if (ticketLimit > 0) {
    const meta = getTicketMeta();
    const activeStatuses = new Set([...meta.open, ...meta.claimed]);
    const openCount = (core.myTickets ?? []).filter((id) =>
      activeStatuses.has(id),
    ).length;
    if (openCount >= ticketLimit) {
      return t("jm_at.tickets.submit_limit", openCount);
    }
  }
  return null;
}

export function createTicket(submitter, category, desc) {
  const block = ticketSubmitBlockReason(submitter);
  if (block) {
    tell(submitter, block);
    return null;
  }

  const core = getPlayerCore(submitter);
  const now = nowMs();

  const submitLoc = (() => {
    try {
      const loc = submitter.location;
      return {
        dim: submitter.dimension?.id ?? "overworld",
        x: Math.round(loc.x),
        y: Math.round(loc.y),
        z: Math.round(loc.z),
      };
    } catch {
      return null;
    }
  })();

  const ticketId = genId("T");
  // Named `ticket`, not `t` — `t` is the i18n translate helper in this module.
  const ticket = {
    id: ticketId,
    createdAt: now,
    updatedAt: now,
    status: "OPEN",
    category,
    desc: clampText(desc, LIMITS.DESC_MAX_LEN),
    submitter: { xuid: getPlayerXuid(submitter), name: submitter.name },
    submitLoc,
    claimedBy: null,
    resolution: null,
    closed: null,
    adminReply: null,
  };

  if (!allocTicketSlot(ticket)) {
    tell(submitter, t("jm_at.tickets.storage_full"));
    return null;
  }

  core.myTickets = [ticketId, ...(core.myTickets ?? [])].slice(
    0,
    LIMITS.MY_TICKETS_MAX,
  );
  core.lastSubmitAt = now;
  setPlayerCore(submitter, core);

  // Live broadcast is translated per-viewer; the queued copy for offline staff
  // is persisted as server-side Chinese (rendered at write time).
  broadcastAdmins(
    t("jm_at.tickets.new_alert", ticketId, submitter.name, category),
  );
  queueStaffAlert(
    `§9[工单] §r新工单 §r${ticketId}§r 来自 §g${submitter.name}§r (§r${category}§r)`,
  );
  return ticketId;
}

export function claimTicket(admin, ticketId) {
  requireAdminOrModCan(admin, "tickets", "接手工单");
  const found = findTicket(ticketId);
  if (!found) throw new Error("找不到该工单。");
  const { ticket, meta } = found;
  if (ticket.status === "CLOSED") throw new Error("该工单已关闭。");
  if (ticket.status === "RESOLVED") throw new Error("该工单已解决。");
  if (ticket.status === "CLAIMED")
    throw new Error(
      `该工单已由 ${ticket.claimedBy?.name ?? "其他管理人员"} 接手。`,
    );
  ticket.status = "CLAIMED";
  ticket.claimedBy = {
    xuid: getPlayerXuid(admin),
    name: admin.name,
    claimedAt: nowMs(),
  };
  saveTicket(found);
  moveTicketId(meta, "open", "claimed", ticketId);
  setTicketMeta(meta);
  logAdmin(admin, "TICKET_CLAIM", ticketId);
  if (ticket.submitter) {
    const { xuid, name } = ticket.submitter;
    queuePlayerNotif(
      xuid,
      `§9[工单 ${ticketId}] ${admin.name} 正在处理该工单。`,
    );
  }
}

export function unclaimTicket(admin, ticketId) {
  requireAdminOrModCan(admin, "tickets", "取消接手工单");
  const found = findTicket(ticketId);
  if (!found) throw new Error("找不到该工单。");
  const { ticket, meta } = found;
  if (ticket.status !== "CLAIMED") throw new Error("该工单尚未被接手。");
  const cfg = getCfg();
  const callerXuid = getPlayerXuid(admin);
  const claimerXuid = ticket.claimedBy?.xuid ?? "";
  if (
    claimerXuid &&
    claimerXuid !== callerXuid &&
    cfg.ownerXuid &&
    cfg.ownerXuid !== callerXuid
  )
    throw new Error("只有接手人或服主可以取消接手此工单。");
  ticket.status = "OPEN";
  ticket.claimedBy = null;
  saveTicket(found);
  moveTicketId(meta, "claimed", "open", ticketId);
  setTicketMeta(meta);
  logAdmin(admin, "TICKET_UNCLAIM", ticketId);
  // Tell the submitter the ticket went back to the queue.
  if (ticket.submitter) {
    queuePlayerNotif(
      ticket.submitter.xuid,
      `§9[工单 ${ticketId}] 已退回待处理队列，其他管理人员将接手。`,
    );
  }
}

export function resolveTicket(admin, ticketId, note) {
  requireAdminOrModCan(admin, "tickets", "解决工单");
  const found = findTicket(ticketId);
  if (!found) throw new Error("找不到该工单。");
  const { ticket, meta } = found;
  if (ticket.status === "CLOSED") throw new Error("该工单已关闭。");
  const n = clampText(note, 300);
  if (!n || n.length < 1) throw new Error("请填写处理结果。");
  ticket.status = "RESOLVED";
  ticket.resolution = {
    note: n,
    resolvedAt: nowMs(),
    byXuid: getPlayerXuid(admin),
    byName: admin.name,
  };
  saveTicket(found);
  if (meta.open.includes(ticketId))
    moveTicketId(meta, "open", "resolved", ticketId);
  if (meta.claimed.includes(ticketId))
    moveTicketId(meta, "claimed", "resolved", ticketId);
  setTicketMeta(meta);
  logAdmin(admin, "TICKET_RESOLVE", `${ticketId} — ${n.slice(0, 80)}`);
  const _res = findTicket(ticketId);
  if (_res?.ticket?.submitter) {
    const { xuid, name } = _res.ticket.submitter;
    queuePlayerNotif(
      xuid,
      `§2[工单 ${ticketId}] 处理人：${admin.name}: ${n}`,
    );
  }
}

export function closeTicket(admin, ticketId, note = "") {
  requireAdminOrModCan(admin, "tickets", "关闭工单");
  const found = findTicket(ticketId);
  if (!found) throw new Error("找不到该工单。");
  const { ticket, meta } = found;
  if (ticket.status === "CLOSED") throw new Error("该工单已经关闭。");
  const n = clampText(note ?? "", 200);
  ticket.status = "CLOSED";
  ticket.closed = {
    note: n,
    closedAt: nowMs(),
    byXuid: getPlayerXuid(admin),
    byName: admin.name,
  };
  saveTicket(found);
  for (const list of ["open", "claimed", "resolved"]) {
    const idx = meta[list].indexOf(ticketId);
    if (idx >= 0) meta[list].splice(idx, 1);
  }
  if (!meta.closed.includes(ticketId)) meta.closed.push(ticketId);
  setTicketMeta(meta);
  logAdmin(
    admin,
    "TICKET_CLOSE",
    `${ticketId}${n ? " — " + n.slice(0, 80) : ""}`,
  );
  const _close = findTicket(ticketId);
  if (_close?.ticket?.submitter) {
    const { xuid, name } = _close.ticket.submitter;
    queuePlayerNotif(xuid, `§9[工单 ${ticketId}] 已关闭${n ? ": " + n : ""}`);
  }
}

/** Purge selected closed tickets and return the count. */
export function purgeTicketIds(idsToDelete) {
  const toDelete = new Set(idsToDelete);
  if (toDelete.size === 0) return 0;
  const meta = getTicketMeta();
  for (let i = 0; i < meta.pagesUsed; i++) {
    const page = loadTicketPage(i);
    const filtered = page.filter((t) => t && !toDelete.has(t.id));
    if (filtered.length !== page.length) saveTicketPage(i, filtered);
  }
  for (const id of toDelete) delete meta.idToPage[id];
  meta.closed = (meta.closed ?? []).filter((id) => !toDelete.has(id));
  setTicketMeta(meta);
  return toDelete.size;
}

export function purgeClosedTickets() {
  const meta = getTicketMeta();
  const closedIds = new Set(meta.closed ?? []);
  if (closedIds.size === 0) return 0;
  for (let i = 0; i < meta.pagesUsed; i++) {
    const page = loadTicketPage(i);
    const filtered = page.filter((t) => t && !closedIds.has(t.id));
    if (filtered.length !== page.length) saveTicketPage(i, filtered);
  }
  for (const id of closedIds) delete meta.idToPage[id];
  const count = meta.closed.length;
  meta.closed = [];
  setTicketMeta(meta);
  return count;
}
