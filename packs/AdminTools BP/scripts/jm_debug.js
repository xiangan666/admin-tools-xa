/**
 * debug.js — In-game debug output for troubleshooting
 *
 * Triggered by /function jm_at_debug or /function jm_at_debug_verbose
 * (the mcfunction files add a tag; main.js polls for it and calls these).
 *
 * runDebug        — quick summary of key state
 * runDebugVerbose — full dump with explanations for every value
 */

import { world, system, PlayerPermissionLevel } from "@minecraft/server";
import { VER, NS, KEY, LIMITS, FEATURES } from "./constants.js";
import {
  getCfg,
  getTicketMeta,
  getLogMeta,
  getPlayerRegistry,
  getSessionLog,
  getClaimsMeta,
  getClaimLog,
  getPlayerPunishments,
  getBanLedger,
} from "./storage.js";
import { isAdmin, isModerator, isOwner } from "./permissions.js";
import { getPlayerXuid, getErrorSummary } from "./utils.js";
import { getWarps, getWarpAccess } from "./warps.js";
import { getItemWatchCfg } from "./item-watch.js";
import { getRankDb } from "./rank-db.js";
import { getAllClaims } from "./claims.js";
import { getTpaRequests } from "./tpa.js";
import { getAfkSummary } from "./afk.js";
import { getSpySessions } from "./spy.js";
import { getHologramRegistry } from "./holograms.js";
import { getKits } from "./kits.js";

// --- Helpers ---

function propSize(key) {
  try {
    const v = world.getDynamicProperty(key);
    return typeof v === "string" ? v.length : 0;
  } catch {
    return 0;
  }
}

function onOff(v) {
  return v ? "§c开启" : "§2关闭";
}
function yesNo(v) {
  return v ? "§2是" : "§c否";
}
function sizeColor(sz) {
  return sz > 26000 ? "§c" : sz > 16000 ? "§6" : "§2";
}
function pageSizeTotal(keyFn, count) {
  let total = 0;
  for (let i = 0; i < count; i++) total += propSize(keyFn(i));
  return total;
}

const SEP = "§8 · §r";
const HEADER = (title) => `\n§9§l── ${title} ──§r`;

// =========================================================
// Quick debug
// =========================================================

export function runDebug(player) {
  try {
    const cfg = getCfg();
    const tMeta = getTicketMeta();
    const lMeta = getLogMeta();
    const reg = getPlayerRegistry();
    const warps = getWarps();
    const online = world.getPlayers();
    const cMeta = getClaimsMeta();
    const rankDb = getRankDb();
    const tpaReqs = getTpaRequests();

    const tOpen = (tMeta.open ?? []).length;
    const tClaimed = (tMeta.claimed ?? []).length;
    const tResolved = (tMeta.resolved ?? []).length;
    const tClosed = (tMeta.closed ?? []).length;
    const totalClaims = Object.keys(cMeta.idToPage ?? {}).length;
    const afk = getAfkSummary();
    const spySessions = getSpySessions();
    const holoReg = getHologramRegistry();
    const banLedger = getBanLedger();
    const kitCount = (() => {
      try {
        return Object.keys(getKits()).length;
      } catch {
        return 0;
      }
    })();
    const supportCount = (cfg.supportAccess ?? []).length;

    const lines = [
      `§9§l══ Admin Tools 诊断 §8— §rv${VER}§r`,
      ``,
      `§7玩家   §r${online.length} 在线${SEP}${Object.keys(reg).length}/${LIMITS.PLAYER_REGISTRY_MAX} 已登记`,
      `§7工单   §r${tOpen} 待处理${SEP}${tClaimed} 已接手${SEP}${tResolved} 已解决${SEP}${tClosed} 已关闭`,
      `§7领地    §r${totalClaims} 总计${SEP}${cMeta.pagesUsed ?? 0}/${LIMITS.CLAIMS_PAGES} 页`,
      `§7日志       §r${lMeta.pagesUsed ?? 0}/${LIMITS.LOG_PAGES} 页${SEP}§7传送点 §r${Object.keys(warps).length}/20 ${yesNo(cfg.warpsVisible !== false)}${SEP}§7身份组 §r${Object.keys(rankDb).length}/${LIMITS.RANK_DB_MAX}`,
      `§7TPA       §r${tpaReqs.length} 待处理${SEP}§7全息图 §r${holoReg.length}/${LIMITS.HOLOGRAM_REGISTRY_MAX}${SEP}§7封禁账本 §r${banLedger.length}/${LIMITS.BAN_LEDGER_MAX}`,
      `§7AFK       §r${onOff(cfg.afkEnabled)}${SEP}踢出 ${onOff(cfg.afkKickEnabled)}${SEP}§e${afk.warned}§r 已警告${SEP}§7监视 §r${spySessions.length} 活动项`,
      `§7功能  §r礼包 ${FEATURES.kits ? onOff(cfg.kitsEnabled !== false) : "§8构建时关闭"}§r ${SEP}§7${kitCount} 已配置${SEP}墓碑 ${onOff(cfg.gravestonesEnabled === true)}${SEP}§7支持 §r${supportCount ? `§c${supportCount} 已授予` : "§2无"}`,
      ``,
      `§7服务器    §r锁定 ${onOff(cfg.serverLocked)}${SEP}白名单 ${onOff(cfg.whitelistMode)}${SEP}工单接收 ${onOff(cfg.ticketingOpen)}`,
      `§7维度锁定 §r下界 ${onOff(cfg.dimLocks?.nether)}${SEP}末地 ${onOff(cfg.dimLocks?.end)}`,
      `§7游玩时长  §r身份组 ${onOff(cfg.playtimeRanksEnabled)}${SEP}§7游戏模式 §r${cfg.adminPrivileges?.gamemode ? "§e管理员" : "§8仅服主"}`,
      `§7定时任务 §r${(cfg.scheduledBroadcasts ?? []).length} 条公告${SEP}${(cfg.scheduledDimLocks ?? []).length + (cfg.scheduledDimUnlocks ?? []).length} 个维度定时器`,
      ``,
      `§7已设置服主 §r${yesNo(!!cfg.ownerXuid)}${SEP}§7dp_init §r${world.getDynamicProperty(`${NS}:dp_init`) === "1" ? "§2正常" : "§c缺失"}`,
    ];

    // Emit in batches so each chat message carries a "•" (renders in Noto Sans,
    // more legible) — same treatment as the verbose dump. Append a faint
    // trailing bullet only to batches that have none of their own.
    for (let i = 0; i < lines.length; i += 10) {
      let msg = lines.slice(i, i + 10).join("\n");
      if (!msg.includes("•")) msg += " §8•§r";
      player.sendMessage(msg);
    }
  } catch (e) {
    player.sendMessage(`§c[诊断] 错误: ${e?.message ?? e}`);
  }
}

// =========================================================
// Verbose debug
// =========================================================

export function runDebugVerbose(player) {
  try {
    const cfg = getCfg();
    const tMeta = getTicketMeta();
    const lMeta = getLogMeta();
    const reg = getPlayerRegistry();
    const sesLog = getSessionLog();
    const warps = getWarps();
    const online = world.getPlayers();
    const regVals = Object.values(reg);
    const cMeta = getClaimsMeta();
    const claimLog = getClaimLog();
    const allClaims = getAllClaims();
    const rankDb = getRankDb();
    const tpaReqs = getTpaRequests();
    const afk = getAfkSummary();
    const spySessions = getSpySessions();
    const holoReg = getHologramRegistry();
    const banLedger = getBanLedger();
    // Bedrock keeps only ~100 chat-history entries and each sendMessage is one
    // entry, so a long dump scrolls its own header out of view. Batch lines into
    // multi-line messages (one entry per ~10 lines) to stay well under that cap.
    let _buf = [];
    const flush = () => {
      if (!_buf.length) return;
      // A message containing "•" renders in Noto Sans (more legible than the
      // default font), so guarantee at least one per batch — append a faint
      // trailing bullet only when the batch has none of its own.
      let msg = _buf.join("\n");
      if (!msg.includes("•")) msg += " §8•§r";
      player.sendMessage(msg);
      _buf = [];
    };
    const send = (s) => {
      _buf.push(s);
      if (_buf.length >= 10) flush();
    };

    send(`§9§l══ Admin Tools 详细诊断 §8— §rv${VER}§r`);

    // ── Config ──────────────────────────────────────────
    send(HEADER("配置"));
    send(`§7服主XUID:§r       ${cfg.ownerXuid || "§8(尚未设置)"}`);
    send(
      `§7服务器锁定:§r      ${onOff(cfg.serverLocked)}${SEP}§7白名单:§r ${onOff(cfg.whitelistMode)}${SEP}§e${(cfg.whitelistedXuids ?? []).length}§r 在白名单`,
    );
    send(
      `§7工单接收:§r        ${onOff(cfg.ticketingOpen)}${SEP}§7显示:§r ${yesNo(cfg.ticketsVisible !== false)}${SEP}§7冷却:§r §e${cfg.submitCooldownSec}§r秒${SEP}§7上限:§r §e${cfg.ticketLimit}§r/玩家`,
    );
    send(`§7分类:§r       §e${(cfg.categories ?? []).join("§r, §e")}§r`);
    send(
      `§7家园:§r            ${yesNo(cfg.homesEnabled !== false)}${SEP}§7上限:§r §e${cfg.maxHomes}§r`,
    );
    send(
      `§7TPA:§r              ${yesNo(cfg.tpaEnabled !== false)}${SEP}§7延时:§r §e${cfg.tpaDelaySec}§r秒`,
    );
    send(
      `§7警告阈值:§r   §e${cfg.warnThreshold}§r${SEP}§7自动清理:§r §e${cfg.autoDeleteClosedDays ?? 30}§r 天`,
    );
    send(
      `§7死亡返回:§r        ${yesNo(cfg.deathbackEnabled !== false)}${SEP}§7发放工具:§r §e${cfg.deathbackGiveTools === "always" || cfg.deathbackGiveTools === true ? "始终" : cfg.deathbackGiveTools === "inventory" ? "物品栏" : "无"}`,
    );
    send(`§7管理团队身份组:§r      ${yesNo(!!cfg.staffCustomRanks)}`);
    send(
      `§7墓碑:§r      ${onOff(cfg.gravestonesEnabled === true)}${SEP}§7礼包:§r ${FEATURES.kits ? onOff(cfg.kitsEnabled !== false) : "§8(构建时关闭)"}`,
    );
    send(
      `§7维度锁定:§r  下界 ${onOff(cfg.dimLocks?.nether)}${SEP}末地 ${onOff(cfg.dimLocks?.end)}`,
    );
    send(
      `§7游戏模式:§r         ${cfg.adminPrivileges?.gamemode ? "§e所有管理员" : "§8仅服主（默认）"}`,
    );
    const hiddenMenus = Object.entries(cfg.menuVisibility ?? {})
      .filter(([, v]) => v === false)
      .map(([k]) => k);
    send(
      `§7隐藏菜单:§r     ${hiddenMenus.length ? `§c${hiddenMenus.join("§r, §c")}§r` : "§8(无，全部显示)"}`,
    );

    // ── AFK Config ──────────────────────────────────────
    send(HEADER("AFK"));
    send(
      `§7已启用:§r          ${onOff(cfg.afkEnabled)}${SEP}§7踢出:§r ${onOff(cfg.afkKickEnabled)}${SEP}§7管理团队免除:§r ${yesNo(cfg.afkExemptStaff !== false)}`,
    );
    send(
      `§7提醒等待:§r       §e${cfg.afkWarnMinutes ?? 2}§r分钟${SEP}§7踢出等待:§r §e${cfg.afkKickMinutes ?? 30}§r分钟`,
    );
    send(
      `§7活动项:§r           §e${afk.tracked}§r 已监控${SEP}§e${afk.warned}§r 已警告`,
    );

    // ── Playtime Ranks ──────────────────────────────────
    send(HEADER("游玩时长身份组"));
    send(
      `§7已启用:§r          ${onOff(cfg.playtimeRanksEnabled)}${SEP}§7覆盖手动身份组:§r ${yesNo(!!cfg.playtimeRanksOverrideManual)}`,
    );
    const ptRanks = cfg.playtimeRanks ?? [];
    if (ptRanks.length) {
      for (const r of ptRanks) {
        const hrs = Math.round((r.minutes ?? 0) / 60);
        send(`  §8•§r §e${hrs}§r小时 → ${r.rankName ?? "?"} §8(${r.tag ?? "无标签"})§r`);
      }
    } else {
      send("  §8(尚未配置)§r");
    }

    // ── Claims Config ───────────────────────────────────
    send(HEADER("领地配置"));
    send(
      `§7每玩家上限:§r   §e${cfg.maxClaimsPerPlayer}§r${SEP}§7初始额度:§r §e${cfg.claimStartArea}§r${SEP}§7额度上限:§r §e${cfg.claimMaxArea}§r`,
    );
    send(
      `§7获取速率:§r        §e${cfg.claimAreaPerTime}§r 区块，每 §e${cfg.claimAreaTimeInterval}§r 分钟`,
    );
    send(
      `§7允许下界:§r     ${yesNo(cfg.claimAllowNether !== false)}${SEP}§7允许末地:§r ${yesNo(cfg.claimAllowEnd !== false)}`,
    );
    const prot = cfg.claimProtections ?? {};
    const protOn = Object.entries(prot)
      .filter(([, v]) => v)
      .map(([k]) => k);
    const protOff = Object.entries(prot)
      .filter(([, v]) => !v)
      .map(([k]) => k);
    send(`§7启用的保护:§r   §2${protOn.join("§r, §2") || "（无）"}§r`);
    if (protOff.length)
      send(`§7关闭的保护:§r  §c${protOff.join("§r, §c")}§r`);
    const abil = cfg.claimPlayerAbilities ?? {};
    const abilOn = Object.entries(abil)
      .filter(([, v]) => v)
      .map(([k]) => k);
    send(`§7玩家能力:§r §2${abilOn.join("§r, §2") || "（无）"}§r`);
    send(
      `§7生物名单:§r       §e${(cfg.mobWhitelist ?? []).length}§r 在白名单${SEP}§e${(cfg.mobBlacklist ?? []).length}§r 在黑名单`,
    );
    if ((cfg.mobWhitelist ?? []).length)
      send(
        `  §8白名单:§r §2${cfg.mobWhitelist.map((t) => t.replace("minecraft:", "")).join("§r, §2")}§r`,
      );
    if ((cfg.mobBlacklist ?? []).length)
      send(
        `  §8黑名单:§r §c${cfg.mobBlacklist.map((t) => t.replace("minecraft:", "")).join("§r, §c")}§r`,
      );

    // ── Mod Privileges ──────────────────────────────────
    send(HEADER("协管员权限"));
    const privs = cfg.modPrivileges ?? {};
    const privOn = Object.entries(privs)
      .filter(([, v]) => v)
      .map(([k]) => k);
    const privOff = Object.entries(privs)
      .filter(([, v]) => !v)
      .map(([k]) => k);
    send(`§7已启用:§r  §2${privOn.join("§r, §2") || "（无）"}§r`);
    send(`§7已禁用:§r §c${privOff.join("§r, §c") || "（无）"}§r`);

    // ── Admin Privileges ────────────────────────────────
    // Global cfg.adminPrivileges overrides. Unset keys default to ON (admins
    // keep full power until explicitly disabled), so "Disabled" is the signal.
    send(HEADER("管理员权限 §8(未设置表示开启)"));
    const aprivs = cfg.adminPrivileges ?? {};
    const aprivOn = Object.entries(aprivs)
      .filter(([, v]) => v)
      .map(([k]) => k);
    const aprivOff = Object.entries(aprivs)
      .filter(([, v]) => !v)
      .map(([k]) => k);
    send(
      `§7已禁用:§r §c${aprivOff.join("§r, §c") || "(无，管理员拥有全部权限)"}§r`,
    );
    if (aprivOn.length)
      send(`§7强制启用:§r §2${aprivOn.join("§r, §2")}§r`);

    // ── Support Access ──────────────────────────────────
    send(HEADER("支持访问 §8(服主批准的远程支持)"));
    const support = cfg.supportAccess ?? [];
    if (!support.length) {
      send("  §2尚未授予任何人。§r");
    } else {
      const now = Date.now();
      for (const e of support) {
        const when =
          typeof e.at === "number"
            ? `${Math.round((now - e.at) / 86400000)}d 前`
            : "?";
        send(
          `  §c•§r ${e.name} §8— 授权人：${e.grantedByName ?? "?"}, ${when}§r`,
        );
      }
    }

    // ── Kits ────────────────────────────────────────────
    send(HEADER("礼包"));
    if (!FEATURES.kits) {
      send("  §8(构建时禁用：礼包功能开关已关闭)§r");
    } else {
      try {
        const kits = getKits();
        const kitNames = Object.keys(kits);
        const starters = kitNames.filter((n) => kits[n]?.type === "starter");
        send(
          `§7运行状态:§r  ${onOff(cfg.kitsEnabled !== false)}${SEP}§7已配置:§r §e${kitNames.length}§r/${LIMITS.MAX_KITS}${SEP}§e${starters.length}§r 新手礼包`,
        );
        for (const n of kitNames) {
          const k = kits[n];
          const items = Array.isArray(k?.items) ? k.items.length : 0;
          send(
            `  §8•§r ${n} §8(${({ starter: "新手礼包", claimable: "可领取礼包", repeatable: "可重复领取礼包" })[k?.type] ?? k?.type ?? "?"}, ${items} 件物品)§r`,
          );
        }
      } catch (ke) {
        send(`  §c(读取失败: ${ke?.message ?? ke})§r`);
      }
    }

    // ── Tickets ─────────────────────────────────────────
    send(HEADER("工单"));
    const tOpen = (tMeta.open ?? []).length;
    const tClaim = (tMeta.claimed ?? []).length;
    const tRes = (tMeta.resolved ?? []).length;
    const tClose = (tMeta.closed ?? []).length;
    send(
      `§7状态:§r   §e${tOpen}§r 待处理${SEP}§e${tClaim}§r 已接手${SEP}§e${tRes}§r 已解决${SEP}§e${tClose}§r 已关闭`,
    );
    send(
      `§7索引:§r    §e${Object.keys(tMeta.idToPage ?? {}).length}§r idToPage索引条目 §8(应等于条目总数)§r`,
    );
    send(
      `§7页:§r    §e${tMeta.pagesUsed ?? 0}§r/${LIMITS.TICKET_PAGES} §8(${LIMITS.TICKETS_PER_PAGE}/页, ${LIMITS.TICKET_PAGES * LIMITS.TICKETS_PER_PAGE} 上限)§r`,
    );

    // ── Admin Log ───────────────────────────────────────
    send(HEADER("管理日志"));
    send(
      `§7页:§r    §e${lMeta.pagesUsed ?? 0}§r/${LIMITS.LOG_PAGES} §8(${LIMITS.LOGS_PER_PAGE}/页, ${LIMITS.LOG_PAGES * LIMITS.LOGS_PER_PAGE} 上限)§r`,
    );

    // ── Claims ──────────────────────────────────────────
    send(HEADER("领地"));
    const totalClaims = Object.keys(cMeta.idToPage ?? {}).length;
    const claimOwnerMap = cMeta.byOwner ?? {};
    const parentClaims = allClaims.filter((c) => !c.parentId);
    const subClaims = allClaims.filter((c) => !!c.parentId);
    const adminClaims = allClaims.filter((c) => c.isAdminClaim);
    send(
      `§7总计:§r    §e${totalClaims}§r §8(§r§e${parentClaims.length}§r 主领地 + §e${subClaims.length}§r 子领地§8)§r${SEP}§e${adminClaims.length}§r 管理员`,
    );
    send(
      `§7所有者:§r   §e${Object.keys(claimOwnerMap).length}§r${SEP}§7页:§r §e${cMeta.pagesUsed ?? 0}§r/${LIMITS.CLAIMS_PAGES} §8(${LIMITS.CLAIMS_PER_PAGE}/页, ${LIMITS.CLAIMS_PAGES * LIMITS.CLAIMS_PER_PAGE} 上限)§r`,
    );
    send(
      `§7日志:§r      §e${claimLog.length}§r/${LIMITS.CLAIM_LOG_MAX} 条目`,
    );
    if (parentClaims.length) {
      const dims = {};
      for (const c of parentClaims) {
        const d = (c.dimensionId ?? "").replace("minecraft:", "");
        dims[d] = (dims[d] ?? 0) + 1;
      }
      send(
        `§7按维度:§r   ${Object.entries(dims)
          .map(([d, n]) => `§e${n}§r ${d}`)
          .join(SEP)}`,
      );
    }

    // ── Rank Database ───────────────────────────────────
    send(HEADER("身份组数据库"));
    const rankEntries = Object.entries(rankDb);
    send(`§7已配置:§r  §e${rankEntries.length}§r/${LIMITS.RANK_DB_MAX}`);
    for (const [name, data] of rankEntries) {
      send(`  §8•§r ${name} §8→§r ${data.tag ?? "§8(无标签)"}`);
    }
    if (!rankEntries.length) send("  §8(无)§r");

    // ── TPA Requests ────────────────────────────────────
    send(HEADER("玩家互传申请"));
    send(`§7待处理:§r  §e${tpaReqs.length}§r`);
    if (tpaReqs.length) {
      const now = Date.now();
      for (const r of tpaReqs) {
        const age = Math.round((now - (r.createdAt ?? 0)) / 1000);
        send(
          `  §8•§r ${r.requesterName ?? "?"} §8→§r ${r.targetName ?? "?"} §8(${age}秒前)§r`,
        );
      }
    }

    // ── Spy Sessions ────────────────────────────────────
    send(HEADER("监视会话"));
    if (!spySessions.length) {
      send("  §8(当前无活动项)§r");
    } else {
      for (const s of spySessions) {
        send(`  §8•§r ${s.adminName} §8→§r 正在监视 ${s.targetName}`);
      }
    }

    // ── Staff Alerts ────────────────────────────────────
    send(HEADER("管理提醒"));
    try {
      const alertRaw = world.getDynamicProperty(`${NS}:staff_alerts`);
      const alerts = alertRaw ? JSON.parse(alertRaw) : [];
      const active = alerts.filter((a) => !a.retracted).length;
      const retracted = alerts.filter((a) => a.retracted).length;
      send(
        `§7队列:§r    §e${alerts.length}§r 总计${SEP}§e${active}§r 活动项${SEP}§e${retracted}§r 已撤回 §8(有效期48小时，最多20条)§r`,
      );
    } catch (ae) {
      send(`  §c(读取失败: ${ae?.message ?? ae})§r`);
    }

    // ── Player Registry ─────────────────────────────────
    send(HEADER("玩家登记"));
    send(
      `§7条目:§r  §e${regVals.length}§r/${LIMITS.PLAYER_REGISTRY_MAX} §8(按XUID保存的快照)§r`,
    );
    const activeBans = regVals.filter((e) =>
      getPlayerPunishments(e.xuid).some((p) => p.active && p.type === "BAN"),
    );
    const activeFreezes = regVals.filter((e) =>
      getPlayerPunishments(e.xuid).some((p) => p.active && p.type === "FREEZE"),
    );
    const activeMutes = regVals.filter((e) =>
      getPlayerPunishments(e.xuid).some((p) => p.active && p.type === "MUTE"),
    );
    const activeWarns = regVals.filter((e) =>
      getPlayerPunishments(e.xuid).some((p) => p.active && p.type === "WARN"),
    );
    send(
      `§7封禁:§r     §c${activeBans.length}§r 活动项${SEP}§7冻结:§r §s${activeFreezes.length}§r 活动项${SEP}§7禁言:§r §6${activeMutes.length}§r 活动项${SEP}§7警告:§r §e${activeWarns.length}§r 活动项`,
    );
    if (activeBans.length)
      send(`  §8已封禁:§r §c${activeBans.map((e) => e.name).join("§r, §c")}§r`);
    if (activeFreezes.length)
      send(
        `  §8已冻结:§r §s${activeFreezes.map((e) => e.name).join("§r, §s")}§r`,
      );
    if (activeMutes.length)
      send(
        `  §8已禁言:§r §6${activeMutes.map((e) => e.name).join("§r, §6")}§r`,
      );
    if (activeWarns.length)
      send(
        `  §8已警告:§r §e${activeWarns.map((e) => e.name).join("§r, §e")}§r`,
      );

    // ── Session Log ─────────────────────────────────────
    send(HEADER("登录退出日志"));
    send(
      `§7条目:§r  §e${sesLog.length}§r/${LIMITS.SESSION_LOG_MAX} §8(登录与退出事件)§r`,
    );

    // ── Warps ───────────────────────────────────────────
    send(HEADER(`传送点 §8(${Object.keys(warps).length}/20)`));
    const warpEntries = Object.entries(warps);
    if (!warpEntries.length) {
      send("  §8(无)§r");
    } else {
      for (const [name, w] of warpEntries) {
        const dim = (w.dimension ?? "").replace("minecraft:", "");
        const access = getWarpAccess(w);
        const tier =
          access === "admin"
            ? " §c仅管理员§r"
            : access === "staff"
              ? " §m仅管理团队§r"
              : "";
        send(
          `  §8•§r ${name} §8→§r ${Math.round(w.x)}, ${Math.round(w.y)}, ${Math.round(w.z)} §8[${dim}]§r${tier}`,
        );
      }
    }

    // ── Scheduled Broadcasts ────────────────────────────
    send(HEADER("定时公告"));
    const sbs = cfg.scheduledBroadcasts ?? [];
    if (!sbs.length) {
      send("  §8(无)§r");
    } else {
      for (const b of sbs) {
        const nextIn = b.nextFireMs
          ? Math.max(0, Math.round((b.nextFireMs - Date.now()) / 1000))
          : "?";
        const everyMin = Math.round((b.intervalMs ?? 0) / 60000);
        send(
          `  §8•§r "${(b.message ?? "").slice(0, 35)}\" §8→§r 每隔 §e${everyMin}§r分钟${SEP}${b.active ? "§2活动项" : "§c已暂停"}${SEP}下次 ~§e${nextIn}§r秒`,
        );
      }
    }

    // ── Scheduled Dim Locks/Unlocks ─────────────────────
    send(HEADER("维度定时设置"));
    const sdl = cfg.scheduledDimLocks ?? [];
    const sdu = cfg.scheduledDimUnlocks ?? [];
    if (!sdl.length && !sdu.length) {
      send("  §8(无)§r");
    } else {
      const now = Date.now();
      for (const d of sdl)
        send(
          `  §c▼ 锁定§r   ${d.dim} §8等待§r ~§e${Math.max(0, Math.round((d.activateAt - now) / 1000))}§r秒`,
        );
      for (const d of sdu)
        send(
          `  §2▲ 解锁§r ${d.dim} §8等待§r ~§e${Math.max(0, Math.round((d.activateAt - now) / 1000))}§r秒`,
        );
    }

    // ── Item Watch ──────────────────────────────────────
    send(HEADER("物品监控"));
    try {
      const iwCfg = getItemWatchCfg();
      const banned = iwCfg.banned ?? [];
      const tracked = iwCfg.tracked ?? {};
      send(`§7已封禁:§r   §e${banned.length}§r 件物品 §8(自动移除)§r`);
      send(
        `§7已监控:§r  §e${Object.keys(tracked).length}§r 件物品 §8(阈值提醒)§r`,
      );
      if (banned.length)
        send(
          `  §8列表:§r §c${banned.map((id) => id.replace("minecraft:", "")).join("§r, §c")}§r`,
        );
      for (const [id, threshold] of Object.entries(tracked)) {
        send(`  §8•§r ${id.replace("minecraft:", "")} §8>=§r §e${threshold}§r`);
      }
    } catch (ie) {
      send(`  §c(读取失败: ${ie?.message ?? ie})§r`);
    }

    // ── Holograms ────────────────────────────────────────
    send(HEADER("全息图"));
    send(
      `§7已登记:§r §e${holoReg.length}§r/${LIMITS.HOLOGRAM_REGISTRY_MAX}`,
    );
    if (holoReg.length) {
      const holoDims = {};
      for (const h of holoReg) {
        const d = (h.dimId ?? "").replace("minecraft:", "");
        holoDims[d] = (holoDims[d] ?? 0) + 1;
      }
      send(
        `§7按维度:§r   ${Object.entries(holoDims)
          .map(([d, n]) => `§e${n}§r ${d}`)
          .join(SEP)}`,
      );
    }

    // ── Ban Ledger ──────────────────────────────────────
    send(HEADER("封禁账本"));
    send(
      `§7条目:§r  §e${banLedger.length}§r/${LIMITS.BAN_LEDGER_MAX} §8(离线封禁队列)§r`,
    );

    // ── Storage ─────────────────────────────────────────
    send(HEADER("存储 §8(动态属性大小)"));
    send(`§8限制：每属性约32,768字符。 §c红色§8 = >79 %已用。§r`);

    const knownProps = [
      [KEY.cfg, "cfg"],
      [KEY.ticketMeta, "ticket_meta"],
      [KEY.logMeta, "log_meta"],
      [KEY.playerRegMeta, "plr_reg_meta"],
      [KEY.sessionLog, "session_log"],
      [KEY.claimsMeta, "claims_meta"],
      [KEY.claimLog, "claim_log"],
      [KEY.rankDb, "rank_db"],
      [`${NS}:staff_alerts`, "staff_alerts"],
      [`${NS}:tpa_requests`, "tpa_requests"],
      [`${NS}:item_watch`, "item_watch"],
      [`${NS}:warps`, "warps"],
      [KEY.banLedger, "ban_ledger"],
      [KEY.hologramRegistry, "hologram_registry"],
      [KEY.kits, "kits"],
      [`${NS}:dp_init`, "dp_init"],
    ];
    for (const [k, label] of knownProps) {
      const sz = propSize(k);
      send(`  ${sizeColor(sz)}${sz.toLocaleString()}§r  ${label}`);
    }

    const rpTotal = pageSizeTotal(KEY.playerRegPage, LIMITS.REGISTRY_PAGES);
    send(
      `  ${sizeColor(rpTotal / LIMITS.REGISTRY_PAGES)}${rpTotal.toLocaleString()}§r  plr_reg_pages §8[${LIMITS.REGISTRY_PAGES} 页]§r`,
    );

    const tpTotal = pageSizeTotal(KEY.ticketPage, LIMITS.TICKET_PAGES);
    send(
      `  ${sizeColor(tpTotal / LIMITS.TICKET_PAGES)}${tpTotal.toLocaleString()}§r  ticket_pages §8[${LIMITS.TICKET_PAGES} 页]§r`,
    );

    const lpTotal = pageSizeTotal(KEY.logPage, LIMITS.LOG_PAGES);
    send(
      `  ${sizeColor(lpTotal / LIMITS.LOG_PAGES)}${lpTotal.toLocaleString()}§r  log_pages §8[${LIMITS.LOG_PAGES} 页]§r`,
    );

    const cpTotal = pageSizeTotal(KEY.claimsPage, LIMITS.CLAIMS_PAGES);
    send(
      `  ${sizeColor(cpTotal / LIMITS.CLAIMS_PAGES)}${cpTotal.toLocaleString()}§r  claims_pages §8[${LIMITS.CLAIMS_PAGES} 页]§r`,
    );

    // Whole-store total across EVERY property this pack owns (not just the keys
    // listed above). Soft advisory cap; the real hard wall is 32,768 chars/prop.
    let dpTotal = 0;
    try {
      dpTotal = world.getDynamicPropertyTotalByteCount?.() ?? 0;
    } catch {}
    const dpPct = Math.round((dpTotal / LIMITS.DP_TOTAL_SOFT_WARN_BYTES) * 100);
    send(
      `§7总存储:§r ${dpTotal.toLocaleString()}B §8(${dpPct} %／ ${Math.round(
        LIMITS.DP_TOTAL_SOFT_WARN_BYTES / 1_000_000,
      )}MB建议上限)§r`,
    );

    // ── Online Players ──────────────────────────────────
    send(HEADER(`在线玩家 §8(${online.length})`));
    if (!online.length) {
      send("  §8(无)§r");
    } else {
      for (const p of online) {
        const xuid = getPlayerXuid(p);
        const role = isOwner(p)
          ? "§6服主"
          : isAdmin(p).ok
            ? "§c管理员"
            : isModerator(p)
              ? "§e协管员"
              : "§7玩家";
        const packTags = p.getTags().filter((t) => t.startsWith(NS));
        const tagStr = packTags.length ? packTags.join("§r, §8") : "无";
        send(
          `  §8•§r ${p.name} §8(${xuid})§r ${role}§r${SEP}§8标签：${tagStr}§r`,
        );
      }
    }

    // ── Error Summary ──────────────────────────────────
    send(HEADER("错误摘要 §8(silentCatch)"));
    const errSummary = getErrorSummary();
    const errEntries = Object.entries(errSummary);
    if (!errEntries.length) {
      send("  §2自上次重启以来未记录错误。§r");
    } else {
      for (const [ctx, count] of errEntries.sort((a, b) => b[1] - a[1])) {
        send(`  §c${count}§r  ${ctx}`);
      }
    }

    send(`\n§9§l══ 详细诊断结束 ══§r`);
    flush();
  } catch (e) {
    flush(); // emit whatever was buffered before the failure
    player.sendMessage(`§c[详细诊断] 错误: ${e?.message ?? e}`);
  }
}

// =========================================================
// Environment / runtime info
// =========================================================
//
// Surfaces things the normal UI never shows and that aren't in the data dump:
// which scripting APIs / experimental toggles are actually live, world/server
// state, and what the engine thinks this player's permissions are. This is the
// layer that explains "why doesn't X work" bugs (e.g. an experimental-only API
// being absent on a stable build).

/** Map a PlayerPermissionLevel enum value back to its name. */
function permLevelName(lvl) {
  try {
    for (const [k, v] of Object.entries(PlayerPermissionLevel)) {
      if (v === lvl) return k;
    }
  } catch {}
  return String(lvl);
}

/** "§2present" / "§cabsent" probe that never throws. */
function probe(getter) {
  try {
    return getter() != null ? "§2可用" : "§c不可用";
  } catch {
    return "§c不可用";
  }
}

export function runEnvInfo(player) {
  // Batch lines into multi-line messages so the dump doesn't blow past
  // Bedrock's ~100-entry chat history (see runDebugVerbose for detail).
  let _buf = [];
  const flush = () => {
    if (!_buf.length) return;
    // "•" makes Bedrock render the message in Noto Sans (more legible). Ensure
    // each batch has one; append a faint trailing bullet only when it doesn't.
    let msg = _buf.join("\n");
    if (!msg.includes("•")) msg += " §8•§r";
    player.sendMessage(msg);
    _buf = [];
  };
  const send = (s) => {
    _buf.push(s);
    if (_buf.length >= 10) flush();
  };
  try {
    send(`§9§l══ 环境与运行信息 §8— §rv${VER}§r`);

    // ── Scripting API capabilities ──────────────────────
    send(HEADER("脚本API"));
    const chatBefore = probe(() => world.beforeEvents?.chatSend);
    const chatAfter = probe(() => world.afterEvents?.chatSend);
    let betaOn = false;
    try { betaOn = world.beforeEvents?.chatSend != null || world.afterEvents?.chatSend != null; } catch {}
    send(
      `§7测试版API:§r       ${betaOn ? "§2可能已开启" : "§c关闭／稳定版"} §8(chatSend before:${chatBefore}§8 after:${chatAfter}§8)§r`,
    );
    send(
      `§7自定义命令:§r ${probe(() => system.beforeEvents?.startup)} §8(system.beforeEvents.startup)§r`,
    );
    send(
      `§7脚本看门狗:§r ${probe(() => system.beforeEvents?.watchdogTerminate)}§r`,
    );

    // ── Server / system ─────────────────────────────────
    send(HEADER("服务器"));
    send(`§7当前游戏刻:§r    §e${system.currentTick}§r`);
    try {
      const si = system.serverSystemInfo;
      if (si) {
        const bits = [];
        if (si.memoryTier !== undefined) bits.push(`内存等级 §e${si.memoryTier}§r`);
        if (si.platformType !== undefined) bits.push(`平台 §e${si.platformType}§r`);
        if (bits.length) send(`§7系统:§r          ${bits.join(SEP)}`);
      }
    } catch {}

    // ── World ───────────────────────────────────────────
    send(HEADER("世界"));
    try {
      send(`§7极限模式:§r       ${world.isHardcore ? "§2是" : "§c否"}`);
    } catch {}
    try {
      send(`§7天数:§r            §e${world.getDay()}§r${SEP}§7游戏时间:§r §e${world.getTimeOfDay()}§r`);
    } catch {}
    try {
      const ow = world.getDefaultSpawnLocation?.();
      if (ow) send(`§7默认出生点:§r  §e${ow.x}, ${ow.y}, ${ow.z}§r`);
    } catch {}

    // ── Game rules ──────────────────────────────────────
    send(HEADER("游戏规则"));
    try {
      const gr = world.gameRules;
      const fmt = (v) =>
        typeof v === "boolean" ? (v ? "§2开启" : "§c关闭") : `§e${v}`;
      const want = [
        "showCoordinates",
        "keepInventory",
        "doDayLightCycle",
        "doImmediateRespawn",
        "commandBlockOutput",
        "sendCommandFeedback",
        "pvp",
        "mobGriefing",
        "doFireTick",
        "showTags",
      ];
      const shown = [];
      for (const k of want) {
        try {
          if (gr[k] !== undefined) shown.push(`${k} ${fmt(gr[k])}`);
        } catch {}
      }
      if (shown.length) {
        // Two per line to keep it compact.
        for (let i = 0; i < shown.length; i += 2) {
          send(`  §8•§r ${shown.slice(i, i + 2).join(SEP)}`);
        }
      } else {
        send("  §8(不可用)§r");
      }
    } catch {
      send("  §8(不可用)§r");
    }

    // ── You (how the engine sees this player) ───────────
    send(HEADER("当前玩家"));
    try {
      const xuid = getPlayerXuid(player);
      const role = isOwner(player)
        ? "§6服主"
        : isAdmin(player).ok
          ? "§c管理员"
          : isModerator(player)
            ? "§e协管员"
            : "§7玩家";
      send(`§7名称:§r           ${player.name} §8(${xuid})§r`);
      send(`§7识别身份:§r   ${role}§r`);
    } catch {}
    try {
      send(
        `§7命令权限等级:§r    §e${player.commandPermissionLevel}§r §8(>0 = 操作员／作弊权限)§r`,
      );
    } catch {}
    try {
      send(
        `§7玩家权限等级:§r §e${permLevelName(player.playerPermissionLevel)}§r`,
      );
    } catch {}
    try {
      const packTags = player.getTags().filter((t) => t.startsWith(NS));
      send(`§7附加包标签:§r      §8${packTags.length ? packTags.join("§r, §8") : "无"}§r`);
    } catch {}

    send(`\n§9§l══ 环境信息结束 ══§r`);
    flush();
  } catch (e) {
    flush(); // emit whatever was buffered before the failure
    player.sendMessage(`§c[环境信息] 错误: ${e?.message ?? e}`);
  }
}
