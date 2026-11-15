/**
 * stress-test.js — Storage stress testing for admins
 *
 * Triggered via /function jm_at:stress_test (tag-based, same pattern as debug).
 * Fills storage areas with synthetic data to test capacity, performance,
 * and the health monitoring system. All synthetic data is tagged for easy cleanup.
 */

import { system } from "@minecraft/server";
import {
  ActionFormData,
  ModalFormData,
  MessageFormData,
} from "@minecraft/server-ui";
import { KEY, LIMITS } from "./constants.js";
import {
  getWorldStr,
  setWorldStr,
  getTicketMeta,
  setTicketMeta,
  loadTicketPage,
  saveTicketPage,
  getLogMeta,
  setLogMeta,
  loadLogPage,
  saveLogPage,
  getClaimsMeta,
  setClaimsMeta,
  loadClaimsPage,
  saveClaimsPage,
  getPlayerRegistry,
  setPlayerRegistry,
} from "./storage.js";
import { getRankDb, setRankDb } from "./rank-db.js";
import { getLogMaxPages } from "./log.js";
import { getStorageHealth } from "./storage-health.js";
import { tell, broadcastAdmins, genId, nowMs } from "./utils.js";
import { isAdmin } from "./permissions.js";
import { t } from "./i18n.js";
import { storageAreaLabel } from "./log-labels.js";

const STRESS_PREFIX = "STRESS_";

// =========================================================
// Synthetic data generators
// =========================================================

function fakeXuid(i) {
  return `${STRESS_PREFIX}${String(i).padStart(6, "0")}`;
}

function fakeTicket(i) {
  const now = nowMs();
  return {
    id: `${STRESS_PREFIX}T${i}`,
    createdAt: now - i * 60000,
    updatedAt: now - i * 60000,
    status: "OPEN",
    category: "StressTest",
    desc: `压力测试工单 #${i}`,
    submitter: { xuid: fakeXuid(i), name: `StressPlayer${i}` },
    submitLoc: { dim: "overworld", x: i, y: 64, z: i },
    claimedBy: null,
    resolution: null,
    closed: null,
    adminReply: null,
    _stress: true,
  };
}

function fakeLogEntry(i) {
  return {
    source: "admin",
    at: nowMs() - i * 30000,
    byXuid: STRESS_PREFIX + "admin",
    byName: "StressAdmin",
    action: "STRESS_TEST",
    detail: `压力测试日志 #${i}`,
    targetName: `StressTarget${i}`,
    _stress: true,
  };
}

function fakeClaim(i) {
  const now = nowMs();
  const x = i * 20;
  return {
    id: `${STRESS_PREFIX}clm${i}`,
    ownerXuid: fakeXuid(i % 50),
    ownerName: `StressPlayer${i % 50}`,
    isAdminClaim: false,
    dimension: "minecraft:overworld",
    min: { x: x, y: -64, z: 0 },
    max: { x: x + 15, y: 320, z: 15 },
    area: 256,
    name: `StressClaim${i}`,
    createdAt: now - i * 10000,
    members: [],
    trustedRanks: [],
    protections: {
      blocks: true,
      containers: true,
      entities: true,
      pvp: false,
      interactions: true,
      itemUse: true,
      explosions: true,
      hostileMobs: true,
      cropTrampling: true,
      fireSpread: true,
      enderPearls: true,
      ejectPlayers: false,
    },
    _stress: true,
  };
}

function fakeRegistryEntry(i) {
  return {
    xuid: fakeXuid(i),
    name: `StressPlayer${i}`,
    gamemode: "survival",
    firstSeen: nowMs() - 86400000,
    lastSeen: nowMs() - i * 1000,
    lastDim: "overworld",
    lastPos: { x: i, y: 64, z: i },
    myTickets: [],
    warnAcks: {},
    playTimeMs: i * 60000,
    rankTag: "",
    rankTagEnabled: false,
    rankSetManually: false,
    bonusPlaytimeMs: 0,
    bonusChunks: 0,
    _stress: true,
  };
}

// =========================================================
// Fill functions
// =========================================================

function fillTickets(count) {
  const meta = getTicketMeta();
  const maxTotal = LIMITS.TICKET_PAGES * LIMITS.TICKETS_PER_PAGE;
  const currentTotal =
    (meta.open?.length ?? 0) +
    (meta.claimed?.length ?? 0) +
    (meta.resolved?.length ?? 0) +
    (meta.closed?.length ?? 0);
  const toAdd = Math.min(count, maxTotal - currentTotal);
  if (toAdd <= 0) return 0;

  let added = 0;
  for (let i = 0; i < toAdd; i++) {
    const ticket = fakeTicket(currentTotal + i);
    // Find a page with room
    let placed = false;
    for (let p = 0; p < LIMITS.TICKET_PAGES; p++) {
      const page = loadTicketPage(p);
      if (page.length < LIMITS.TICKETS_PER_PAGE) {
        page.push(ticket);
        saveTicketPage(p, page);
        meta.idToPage[ticket.id] = p;
        meta.open.push(ticket.id);
        if (p >= (meta.pagesUsed ?? 0)) meta.pagesUsed = p + 1;
        placed = true;
        added++;
        break;
      }
    }
    if (!placed) break;
  }

  setTicketMeta(meta);
  return added;
}

function fillLog(count) {
  const meta = getLogMeta();
  let head = meta.head ?? 0;
  let pagesUsed = meta.pagesUsed ?? 0;
  // Fill up to the EFFECTIVE retention cap (cfg.logMaxEntries), not the
  // physical maximum — matches what writeLogEntry would allow.
  const maxPages = getLogMaxPages();
  const maxTotal = maxPages * LIMITS.LOGS_PER_PAGE;
  // Count existing entries across all pages (scan all, not just pagesUsed)
  let totalEntries = 0;
  for (let p = 0; p < LIMITS.LOG_PAGES; p++) {
    totalEntries += loadLogPage(p).length;
  }
  const toAdd = Math.min(count, maxTotal - totalEntries);
  if (toAdd <= 0) return 0;

  if (pagesUsed < 1) {
    head = 0;
    pagesUsed = 1;
  }

  let added = 0;
  for (let i = 0; i < toAdd; i++) {
    const entry = fakeLogEntry(totalEntries + i);
    // Ring tail = newest page; allocate the next ring slot when it fills
    let tail = (head + pagesUsed - 1) % LIMITS.LOG_PAGES;
    let page = loadLogPage(tail);
    if (page.length >= LIMITS.LOGS_PER_PAGE) {
      if (pagesUsed >= maxPages) break; // at cap — a filler never evicts
      pagesUsed++;
      tail = (head + pagesUsed - 1) % LIMITS.LOG_PAGES;
      page = [];
    }
    page.push(entry);
    saveLogPage(tail, page);
    added++;
  }

  setLogMeta({ pagesUsed, head });
  return added;
}

function fillClaims(count) {
  const meta = getClaimsMeta();
  const maxTotal = LIMITS.CLAIMS_PAGES * LIMITS.CLAIMS_PER_PAGE;
  const currentTotal = Object.keys(meta.idToPage ?? {}).length;
  const toAdd = Math.min(count, maxTotal - currentTotal);
  if (toAdd <= 0) return 0;

  // Read each page at most once, fill it, then write it once. The previous
  // implementation reloaded + parsed EVERY full page from index 0 for each
  // claim added — O(claims x pages) — which is fine at small ceilings but hung
  // the watchdog once the claim cap tripled to 9000 across 300 pages. This is
  // O(claims) with a single read and a single write per touched page.
  let added = 0;
  let seq = currentTotal;
  for (let p = 0; p < LIMITS.CLAIMS_PAGES && added < toAdd; p++) {
    const page = loadClaimsPage(p);
    if (page.length >= LIMITS.CLAIMS_PER_PAGE) continue;
    let dirty = false;
    while (page.length < LIMITS.CLAIMS_PER_PAGE && added < toAdd) {
      const claim = fakeClaim(seq++);
      page.push(claim);
      meta.idToPage[claim.id] = p;
      if (!meta.byOwner[claim.ownerXuid]) meta.byOwner[claim.ownerXuid] = [];
      meta.byOwner[claim.ownerXuid].push(claim.id);
      added++;
      dirty = true;
    }
    if (dirty) {
      if (p >= (meta.pagesUsed ?? 0)) meta.pagesUsed = p + 1;
      saveClaimsPage(p, page);
    }
  }

  setClaimsMeta(meta);
  return added;
}

function fillRegistry(count) {
  const reg = getPlayerRegistry();
  const current = Object.keys(reg).length;
  const toAdd = Math.min(count, LIMITS.PLAYER_REGISTRY_MAX - current);
  if (toAdd <= 0) return 0;

  for (let i = 0; i < toAdd; i++) {
    const entry = fakeRegistryEntry(current + i);
    reg[entry.xuid] = entry;
  }

  setPlayerRegistry(reg);
  return toAdd;
}

function fillRanks(count) {
  const db = getRankDb();
  const current = Object.keys(db).length;
  const toAdd = Math.min(count, LIMITS.RANK_DB_MAX - current);
  if (toAdd <= 0) return 0;

  for (let i = 0; i < toAdd; i++) {
    const name = `${STRESS_PREFIX}rank_${current + i}`;
    db[name] = { tag: `§8[Stress${current + i}]§r` };
  }

  setRankDb(db);
  return toAdd;
}

// =========================================================
// Purge functions — remove only synthetic data
// =========================================================

function purgeStressTickets() {
  const meta = getTicketMeta();
  let removed = 0;
  for (let p = 0; p < LIMITS.TICKET_PAGES; p++) {
    const page = loadTicketPage(p);
    const filtered = page.filter(
      (t) => !t._stress && !t.id?.startsWith(STRESS_PREFIX),
    );
    if (filtered.length !== page.length) {
      removed += page.length - filtered.length;
      saveTicketPage(p, filtered);
    }
  }
  // Rebuild meta
  const stressIds = Object.keys(meta.idToPage).filter((id) =>
    id.startsWith(STRESS_PREFIX),
  );
  for (const id of stressIds) delete meta.idToPage[id];
  meta.open = (meta.open ?? []).filter((id) => !id.startsWith(STRESS_PREFIX));
  meta.claimed = (meta.claimed ?? []).filter(
    (id) => !id.startsWith(STRESS_PREFIX),
  );
  meta.resolved = (meta.resolved ?? []).filter(
    (id) => !id.startsWith(STRESS_PREFIX),
  );
  meta.closed = (meta.closed ?? []).filter(
    (id) => !id.startsWith(STRESS_PREFIX),
  );
  setTicketMeta(meta);
  return removed;
}

function purgeStressLog() {
  const meta = getLogMeta();
  const head = meta.head ?? 0;
  const pagesUsed = meta.pagesUsed ?? 0;
  const inRing = new Set();
  for (let k = 0; k < pagesUsed; k++) inRing.add((head + k) % LIMITS.LOG_PAGES);

  // Collect survivors in logical (ring) order. The old "highest non-empty
  // page" reconcile mis-reads a wrapped ring, so surviving entries are
  // compacted back to physical page 0 with head reset instead.
  let removed = 0;
  const survivors = [];
  for (let k = 0; k < pagesUsed; k++) {
    for (const e of loadLogPage((head + k) % LIMITS.LOG_PAGES)) {
      if (e._stress) removed++;
      else survivors.push(e);
    }
  }
  // Pages outside the ring are invisible to readers and get wiped below —
  // count their stress strays so the report stays honest.
  for (let p = 0; p < LIMITS.LOG_PAGES; p++) {
    if (!inRing.has(p))
      removed += loadLogPage(p).filter((e) => e._stress).length;
  }

  let newPages = 0;
  for (let s = 0; s < survivors.length; s += LIMITS.LOGS_PER_PAGE) {
    saveLogPage(newPages, survivors.slice(s, s + LIMITS.LOGS_PER_PAGE));
    newPages++;
  }
  for (let p = newPages; p < LIMITS.LOG_PAGES; p++) saveLogPage(p, []);
  setLogMeta({ pagesUsed: newPages, head: 0 });
  return removed;
}

function purgeStressClaims() {
  const meta = getClaimsMeta();
  let removed = 0;
  for (let p = 0; p < LIMITS.CLAIMS_PAGES; p++) {
    const page = loadClaimsPage(p);
    const filtered = page.filter(
      (c) => !c._stress && !c.id?.startsWith(STRESS_PREFIX),
    );
    if (filtered.length !== page.length) {
      removed += page.length - filtered.length;
      saveClaimsPage(p, filtered);
    }
  }
  // Rebuild meta indexes
  const stressIds = Object.keys(meta.idToPage).filter((id) =>
    id.startsWith(STRESS_PREFIX),
  );
  for (const id of stressIds) delete meta.idToPage[id];
  for (const xuid of Object.keys(meta.byOwner)) {
    meta.byOwner[xuid] = meta.byOwner[xuid].filter(
      (id) => !id.startsWith(STRESS_PREFIX),
    );
    if (meta.byOwner[xuid].length === 0) delete meta.byOwner[xuid];
  }
  setClaimsMeta(meta);
  return removed;
}

function purgeStressRegistry() {
  const reg = getPlayerRegistry();
  let removed = 0;
  for (const xuid of Object.keys(reg)) {
    if (xuid.startsWith(STRESS_PREFIX) || reg[xuid]._stress) {
      delete reg[xuid];
      removed++;
    }
  }
  setPlayerRegistry(reg);
  return removed;
}

function purgeStressRanks() {
  const db = getRankDb();
  let removed = 0;
  for (const name of Object.keys(db)) {
    if (name.startsWith(STRESS_PREFIX)) {
      delete db[name];
      removed++;
    }
  }
  setRankDb(db);
  return removed;
}

// =========================================================
// Health report helper
// =========================================================

/** Fire health warnings immediately (stress test bypass — skips join-based timing). */
function triggerHealthWarnings() {
  const WARN_PCT = 95;
  const h = getStorageHealth();
  if (!h) return;
  for (const [key, info] of Object.entries(h)) {
    if (key === "byteHealth" || key === "total") continue;
    if (info.pct >= WARN_PCT) {
      broadcastAdmins(
        t("jm_at.storage.health_line_area", storageAreaLabel(key), info.pct, info.used, info.max),
      );
    }
  }
  // total is a byte figure against an advisory soft cap, not a used/max count.
  if (h.total && h.total.pct >= WARN_PCT) {
    broadcastAdmins(
      t("jm_at.storage.health_line_total", h.total.pct, Math.round(h.total.max / 1_000_000), h.total.bytes),
    );
  }
  if (h.byteHealth) {
    for (const [label, info] of Object.entries(h.byteHealth)) {
      if (info.pct >= WARN_PCT) {
        broadcastAdmins(
          t("jm_at.storage.health_line_bytes", storageAreaLabel(label), info.pct, info.bytes),
        );
      }
    }
  }
}

function formatHealth() {
  const h = getStorageHealth();
  if (!h) return "§c无法读取存储状况。§r";
  const bar = (pct) => {
    const filled = Math.round(pct / 5);
    const empty = 20 - filled;
    const color = pct >= 90 ? "§c" : pct >= 70 ? "§6" : "§2";
    const padded = String(pct).padStart(3);
    return `${color}${"▮".repeat(filled)}§8${"▯".repeat(empty)} ${padded} %§r`;
  };
  const row = (label, info, suffix) => {
    const pad = " ".repeat(Math.max(1, 10 - label.length));
    const usage = suffix
      ? `${info.used}/${info.max} ${suffix}`
      : `${info.used}/${info.max}`;
    return `§7${label}:§r${pad}${bar(info.pct)}  §8(${usage})§r`;
  };
  return [
    `§9§l存储状况§r\n\n你是如何进入此页面的？\n\n这是开发用压力测试工具，在正式服务器使用可能产生负面或意外后果。\n-JM`,
    ``,
    row("工单", h.tickets),
    row("领地", h.claims),
    row("日志", h.logPages, "页"),
    row("玩家登记", h.registry),
    h.total
      ? `§7总计:§r     ${bar(h.total.pct)}  §8(${h.total.bytes}/${h.total.max}B)§r`
      : ``,
    ``,
    `§7字节占用：§r`,
    ...Object.entries(h.byteHealth ?? {}).map(
      ([k, v]) => `  §7${healthAreaText(k)}:§r ${bar(v.pct)}  §8(${v.bytes}/${v.max}B)§r`,
    ),
  ].join("\n");
}

/** This diagnostic body is string-only, so it uses the server's Chinese. */
function healthAreaText(key) {
  const fixed = { registryMeta: "玩家登记索引", config: "配置", claimsMeta: "领地索引", ticketMeta: "工单索引" };
  if (Object.hasOwn(fixed, key)) return fixed[key];
  const page = /^(regPage|claimsPage)(\d+)$/.exec(key);
  return page ? `${page[1] === "regPage" ? "玩家登记" : "领地"}第${Number(page[2]) + 1}页` : key;
}

// =========================================================
// UI
// =========================================================

export async function showStressTest(player) {
  try {
    if (!isAdmin(player).ok) {
      tell(player, "§c[压力测试] 仅管理员可用。");
      return;
    }
  } catch {
    return;
  }

  const h = getStorageHealth();
  const rankCount = Object.keys(getRankDb()).length;

  const form = new ActionFormData()
    .title("§c§l存储压力测试")
    .body(
      `${formatHealth()}\n\n` +
        `§c§l警告:§r 此操作会向存储写入模拟数据。\n` +
        `所有测试数据均可使用清理选项删除。`,
    )
    .button("§l填充工单", "textures/ui/jm_at_tickets")
    .button("§l填充领地", "textures/ui/jm_at_my_claims")
    .button("§l填充管理日志", "textures/ui/jm_at_admin_log")
    .button("§l填充玩家登记", "textures/ui/jm_at_players")
    .button("§l填充身份组数据库", "textures/ui/jm_at_rank_database")
    .button("§l全部填充至80%", "textures/ui/jm_at_hourglass")
    .button("§l全部填充至100%", "textures/ui/jm_at_hourglass")
    .button("§c§l清理全部压力测试数据", "textures/ui/jm_at_remove")
    .button("§l刷新存储状况", "textures/ui/jm_at_stats")
    .button("§l返回", "textures/ui/jm_at_back");

  const res = await form.show(player);
  if (res.canceled) return;

  if (res.selection <= 4) {
    // Individual fill
    return showFillAmount(player, res.selection);
  }
  if (res.selection === 5) return fillAllTo(player, 0.8);
  if (res.selection === 6) return fillAllTo(player, 1.0);
  if (res.selection === 7) return purgeAll(player);
  if (res.selection === 8) return showStressTest(player);
  // Back
}

const AREA_NAMES = [
  "工单",
  "领地",
  "管理日志",
  "玩家登记",
  "身份组数据库",
];
const AREA_MAXES = [
  LIMITS.TICKET_PAGES * LIMITS.TICKETS_PER_PAGE,
  LIMITS.CLAIMS_PAGES * LIMITS.CLAIMS_PER_PAGE,
  LIMITS.LOG_PAGES * LIMITS.LOGS_PER_PAGE,
  LIMITS.PLAYER_REGISTRY_MAX,
  LIMITS.RANK_DB_MAX,
];

async function showFillAmount(player, areaIdx) {
  const name = AREA_NAMES[areaIdx];
  const max = AREA_MAXES[areaIdx];

  const form = new ModalFormData()
    .title(`填充 ${name}`)
    .slider(`添加多少条${name.toLowerCase()}？`, 1, max, {
      defaultValue: Math.round(max * 0.5),
      valueStep: Math.max(1, Math.round(max / 20)),
    });

  const res = await form.show(player);
  if (res.canceled) return showStressTest(player);

  const count = res.formValues[0] ?? 0;
  const fillers = [fillTickets, fillClaims, fillLog, fillRegistry, fillRanks];
  const added = fillers[areaIdx](count);

  tell(player, `§2[压力测试] 已添加§l${added}§r§2 ${name.toLowerCase()}.`);
  return showStressTest(player);
}

async function fillAllTo(player, pct) {
  const label = `${Math.round(pct * 100)} %`;
  const confirm = new MessageFormData()
    .title("确认填充")
    .body(
      `填充 §l全部§r存储区域至§c${label}§r容量？\n\n` +
        `将向工单、领地、日志、玩家登记与身份组写入模拟数据。`,
    )
    .button1("§c§l填充至 " + label)
    .button2("取消");

  const res = await confirm.show(player);
  if (res.canceled || res.selection === 1) return showStressTest(player);

  const results = [];

  const ticketTarget = Math.round(
    LIMITS.TICKET_PAGES * LIMITS.TICKETS_PER_PAGE * pct,
  );
  const h = getStorageHealth();
  results.push(
    `工单: +${fillTickets(Math.max(0, ticketTarget - h.tickets.used))}`,
  );

  const claimTarget = Math.round(
    LIMITS.CLAIMS_PAGES * LIMITS.CLAIMS_PER_PAGE * pct,
  );
  results.push(
    `领地: +${fillClaims(Math.max(0, claimTarget - h.claims.used))}`,
  );

  const logTarget = Math.round(LIMITS.LOG_PAGES * LIMITS.LOGS_PER_PAGE * pct);
  let logCurrent = 0;
  for (let p = 0; p < LIMITS.LOG_PAGES; p++) {
    logCurrent += loadLogPage(p).length;
  }
  results.push(`日志: +${fillLog(Math.max(0, logTarget - logCurrent))}`);

  const regTarget = Math.round(LIMITS.PLAYER_REGISTRY_MAX * pct);
  results.push(
    `玩家登记: +${fillRegistry(Math.max(0, regTarget - Object.keys(getPlayerRegistry()).length))}`,
  );

  const rankTarget = Math.round(LIMITS.RANK_DB_MAX * pct);
  results.push(
    `身份组: +${fillRanks(Math.max(0, rankTarget - Object.keys(getRankDb()).length))}`,
  );

  tell(player, `§2[压力测试] 已填充至${label}:\n§r${results.join("\n")}`);
  triggerHealthWarnings();
  return showStressTest(player);
}

async function purgeAll(player) {
  const confirm = new MessageFormData()
    .title("确认清理")
    .body(
      `删除§l全部§r模拟压力测试数据？\n\n` +
        `只删除带有压力测试标记的条目，不删除真实数据。`,
    )
    .button1("§c§l清理全部")
    .button2("取消");

  const res = await confirm.show(player);
  if (res.canceled || res.selection === 1) return showStressTest(player);

  const results = [
    `工单: -${purgeStressTickets()}`,
    `领地: -${purgeStressClaims()}`,
    `日志: -${purgeStressLog()}`,
    `玩家登记: -${purgeStressRegistry()}`,
    `身份组: -${purgeStressRanks()}`,
  ];

  tell(player, `§2[压力测试] 已清理：\n§r${results.join("\n")}`);
  return showStressTest(player);
}
