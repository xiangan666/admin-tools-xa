/** Punishment and moderation actions. */

import { world } from "@minecraft/server";
import { startRuleTeleport } from "./travel-service.js";
import { getWarps, canAccessWarp } from "./warps.js";
import { NS, LIMITS } from "./constants.js";
import {
  tell,
  broadcastAdmins,
  getPlayerXuid,
  fmtDuration,
  fmtMs,
  fmtDim,
  fmtDimRaw,
  clampText,
  genId,
  nowMs,
  silentCatch,
} from "./utils.js";
import {
  getPlayerCore,
  setPlayerCore,
  mutatePlayerPunishments,
  setPlayerPunishments,
  getRegistryEntryByName,
  queuePlayerNotif,
  getCfg,
  queueStaffAlert,
  removeBanLedgerEntry,
} from "./storage.js";
import {
  requireAdmin,
  requireStaff,
  requireAdminOrModCan,
  isModerator,
  isStaff,
  requireNotOwner,
  requireOutranksTarget,
  requireOutranksRole,
} from "./permissions.js";
import { logAdmin } from "./log.js";
import { t, raw } from "./i18n.js";
import {
  addPunishment,
  clearPunishment,
  hasActivePunishment,
  teleportedPlayers,
} from "./players.js";

// Freeze positions cached by XUID so relogs stay pinned.
export const freezePosCache = new Map();

// Online frozen player IDs; lets the tick loop skip work when empty.
export const frozenPlayers = new Set();

// =========================================================
// Chat
// =========================================================

// =========================================================
// Movement
// =========================================================

export function doFreeze(admin, target) {
  requireAdminOrModCan(admin, "freeze", "冻结玩家");
  requireNotOwner(target, "冻结玩家");
  requireOutranksTarget(admin, target, "冻结玩家");
  const tLoc = target.location;
  const core = getPlayerCore(target);
  const fp = {
    x: Math.round(tLoc.x),
    y: Math.round(tLoc.y),
    z: Math.round(tLoc.z),
  };
  core.freezePos = fp;
  setPlayerCore(target, core);
  freezePosCache.set(getPlayerXuid(target), fp);
  frozenPlayers.add(target.id);
  target.addTag(`${NS}:frozen`);
  try {
    target.addEffect("minecraft:resistance", 32767, {
      amplifier: 255,
      showParticles: false,
    });
  } catch (e) { silentCatch("mod_freeze_effect", e); }
  const staffLabel = isModerator(admin) ? "moderator" : "admin";
  addPunishment(target, "FREEZE", `由${staffLabel === "moderator" ? "协管员" : "管理员"}冻结`, admin, 0);
  logAdmin(admin, "FREEZE", "", target.name);
  // lang-keys: jm_at.mod.frozen_by_admin jm_at.mod.frozen_by_moderator
  tell(
    target,
    t(
      staffLabel === "admin"
        ? "jm_at.mod.frozen_by_admin"
        : "jm_at.mod.frozen_by_moderator",
    ),
  );
}

export function doUnfreeze(admin, target) {
  requireAdminOrModCan(admin, "freeze", "解除冻结");
  requireOutranksTarget(admin, target, "解除冻结");
  clearPunishment(target, "FREEZE");
  const core = getPlayerCore(target);
  core.freezePos = null;
  setPlayerCore(target, core);
  freezePosCache.delete(getPlayerXuid(target));
  frozenPlayers.delete(target.id);
  target.removeTag(`${NS}:frozen`);
  try {
    target.removeEffect("minecraft:resistance");
  } catch (e) { silentCatch("mod_unfreeze_effect", e); }
  logAdmin(admin, "UNFREEZE", "", target.name);
  tell(target, t("jm_at.mod.unfrozen"));
}

export function doTpTo(admin, target) {
  requireAdminOrModCan(admin, "tpToPlayer", "传送至玩家");
  // The owner's location is off-limits to other staff (matches summon/warp,
  // which already block owner targets); also stop a mod from TPing onto an admin.
  requireNotOwner(target, "传送至");
  requireOutranksTarget(admin, target, "传送至");
  const loc = target.location;
  teleportedPlayers.add(admin.id);
  admin.teleport(
    { x: loc.x, y: loc.y, z: loc.z },
    { dimension: target.dimension },
  );
  logAdmin(admin, "TP_TO", target.name);
  tell(admin, t("jm_at.mod.tp_to", target.name));
}

export function doSummon(admin, target) {
  requireAdminOrModCan(admin, "summon", "召唤玩家");
  requireNotOwner(target, "召唤玩家");
  requireOutranksTarget(admin, target, "召唤玩家");
  const loc = admin.location;
  teleportedPlayers.add(target.id);
  target.teleport(
    { x: loc.x, y: loc.y, z: loc.z },
    { dimension: admin.dimension },
  );
  logAdmin(admin, "SUMMON", target.name);
  tell(target, t("jm_at.mod.summoned", admin.name));
  tell(admin, t("jm_at.mod.summon_done", target.name));
}

export function doTpToWarp(admin, target, warp, warpName) {
  // Moving another player uses the summon permission.
  requireAdminOrModCan(admin, "summon", "将玩家传送至传送点");
  requireNotOwner(target, "传送至传送点");
  requireOutranksTarget(admin, target, "使用传送点");
  return startRuleTeleport(target, {
    kind: "warp", name: warpName,
    getDestination: () => getWarps()[warpName],
    authorize: () => {
      try {
        requireAdminOrModCan(admin, "summon", "将玩家传送至传送点");
        requireNotOwner(target, "传送至传送点");
        requireOutranksTarget(admin, target, "使用传送点");
        const current = getWarps()[warpName];
        return !!current && canAccessWarp(target, current);
      } catch { return false; }
    },
    onSuccess: () => {
      logAdmin(admin, "TP_TO_WARP", warpName, target.name);
      tell(target, t("jm_at.mod.warped_target", warpName, admin.name));
      tell(admin, t("jm_at.mod.warped_admin", target.name, warpName));
    },
  });
}

export function doTpToLoc(admin, dim, x, y, z) {
  // Staff self-teleport used by home/ticket viewers.
  requireStaff(admin, "传送至坐标");
  const dimension = world.getDimension(dim.replace("minecraft:", ""));
  teleportedPlayers.add(admin.id);
  admin.teleport({ x, y, z }, { dimension });
  logAdmin(admin, "TP_LOC", `${fmtDim(dim)} (${x}, ${y}, ${z})`);
  tell(admin, t("jm_at.mod.tp_loc", raw(fmtDimRaw(dim), ` (${x}, ${y}, ${z})`)));
}

// =========================================================
// Sanctions
// =========================================================

export function doKick(admin, target, reason) {
  requireAdminOrModCan(admin, "kick", "移出玩家");
  requireNotOwner(target, "移出玩家");
  requireOutranksTarget(admin, target, "移出玩家");
  const entry = addPunishment(target, "KICK", reason, admin, 0);
  const core = getPlayerCore(target);
  const pun = (core.punishments ?? []).find((p) => p.id === entry.id);
  if (pun) {
    pun.active = false;
    setPlayerCore(target, core);
  }
  logAdmin(admin, "KICK", clampText(reason, 100), target.name);
  tell(target, t("jm_at.mod.kicked", reason));
  // Self-kick avoids the temp-ban side effect of world.runCommand.
  const safeReason = reason.replace(/["\\]/g, "");
  try {
    target.runCommand(`kick @s ${safeReason}`);
  } catch (e) { silentCatch("mod_kick_cmd", e); }
}

export function doBan(admin, target, reason, durationMs) {
  if (durationMs === 0) {
    requireAdminOrModCan(admin, "permBan", "永久封禁");
  } else {
    requireAdminOrModCan(admin, "tempBan", "临时封禁");
  }
  requireNotOwner(target, "封禁玩家");
  requireOutranksTarget(admin, target, "封禁玩家");
  clearPunishment(target, "BAN");
  addPunishment(target, "BAN", reason, admin, durationMs);
  // Sync before the kick; snapshot may not run afterward.
  try {
    const xuid = getPlayerXuid(target);
    setPlayerPunishments(xuid, getPlayerCore(target).punishments ?? []);
  } catch (e) { silentCatch("ban_sync_puns", e); }
  const expStr =
    durationMs > 0 ? `，时长 ${fmtDuration(durationMs)}` : "（永久）";
  logAdmin(
    admin,
    "BAN",
    `${fmtDuration(durationMs)} — ${clampText(reason, 80)}`,
    target.name,
  );
  tell(
    target,
    durationMs > 0
      ? t("jm_at.mod.banned_temp", fmtDuration(durationMs), reason)
      : t("jm_at.mod.banned_perm", reason),
  );
  // The string-only /kick disconnect line uses server-side Chinese.
  const safeBanReason = reason.replace(/["\\]/g, "");
  try {
    target.runCommand(`kick @s 您已被封禁${expStr}，原因：${safeBanReason}`);
  } catch (e) { silentCatch("mod_ban_kick", e); }
}

export function doUnban(admin, target) {
  requireAdminOrModCan(admin, "unban", "解除封禁");
  clearPunishment(target, "BAN");
  // Keep registry punishment state in sync.
  const xuid = getPlayerXuid(target);
  try {
    setPlayerPunishments(xuid, getPlayerCore(target).punishments ?? []);
  } catch (e) { silentCatch("unban_sync_puns", e); }
  removeBanLedgerEntry(xuid);
  logAdmin(admin, "UNBAN", "", target.name);
  tell(target, t("jm_at.mod.unbanned"));
}

export function doWarn(admin, target, reason) {
  requireAdminOrModCan(admin, "warn", "警告玩家");
  requireNotOwner(target, "警告玩家");
  requireOutranksTarget(admin, target, "警告玩家");
  addPunishment(target, "WARN", reason, admin, 0);
  logAdmin(admin, "WARN", clampText(reason, 100), target.name);
  tell(target, t("jm_at.mod.warned", admin.name, reason));

  // Alert staff when active warnings reach the threshold.
  const thresh = getCfg().warnThreshold ?? 3;
  const now = Date.now();
  const core = getPlayerCore(target);
  const count = (core.punishments ?? []).filter(
    (p) =>
      p.type === "WARN" && p.active && (p.expiresAt === 0 || p.expiresAt > now),
  ).length;
  if (count >= thresh) {
    // Live alert is translated per viewer; the queued copy for offline staff
    // stores this edition's server-side Chinese.
    for (const p of world.getPlayers()) {
      if (p !== admin && isStaff(p))
        tell(p, t("jm_at.mod.warn_alert", target.name, count, thresh));
    }
    queueStaffAlert(
      `§c[警告提醒] §g${target.name}§r 当前有 §c${count}§r 条有效警告（阈值为 ${thresh}）。`,
      getPlayerXuid(target),
    );
  }
}

// =========================================================
// Utility
// =========================================================

export function doHeal(admin, target) {
  requireAdminOrModCan(admin, "heal", "恢复生命值");
  try {
    target.getComponent("minecraft:health")?.resetToMaxValue();
  } catch {}
  logAdmin(admin, "HEAL", "", target.name);
  tell(target, t("jm_at.mod.healed", admin.name));
}

export function doFeed(admin, target) {
  requireAdminOrModCan(admin, "feed", "恢复饥饿值");
  try {
    target.getComponent("minecraft:player.hunger")?.setCurrentValue(20);
    target.getComponent("minecraft:player.saturation")?.setCurrentValue(20);
  } catch {}
  logAdmin(admin, "FEED", "", target.name);
  tell(target, t("jm_at.mod.fed", admin.name));
}

export function doGamemode(admin, target, mode) {
  requireAdminOrModCan(admin, "gamemode", "更改游戏模式");
  requireOutranksTarget(admin, target, "更改游戏模式");
  target.runCommand(`gamemode ${mode}`);
  logAdmin(admin, "GAMEMODE", mode, target.name);
  // lang-keys: jm_at.adm.gamemode_*
  tell(target, t("jm_at.mod.gamemode_set", t(`jm_at.adm.gamemode_${mode}`), admin.name));
}

// =========================================================
// Offline moderation works on registry entries.
// =========================================================

/** Clear active bans from an offline player's registry record. */
export function doUnbanOffline(admin, entry) {
  requireAdminOrModCan(admin, "offlineModeration", "解除离线玩家封禁");
  requireAdminOrModCan(admin, "unban", "解除离线玩家封禁");
  const ok = mutatePlayerPunishments(entry.xuid, (puns) => {
    for (const p of puns) {
      if (p.type === "BAN" && p.active) p.active = false;
    }
  });
  if (!ok) throw new Error(`在玩家记录中找不到 ${entry.name}。`);
  removeBanLedgerEntry(entry.xuid);
  logAdmin(admin, "UNBAN", "（离线）", entry.name);
  queuePlayerNotif(entry.xuid, "§2[解除封禁] 您的封禁已解除。");
}

export function doBanOffline(admin, entry, reason, durationMs) {
  if (durationMs === 0) {
    requireAdminOrModCan(admin, "offlineModeration", "永久封禁离线玩家");
    requireAdminOrModCan(admin, "permBan", "永久封禁离线玩家");
  } else {
    requireAdminOrModCan(admin, "tempBan", "临时封禁离线玩家");
  }
  // Mirror requireNotOwner for offline bans.
  const cfg = getCfg();
  if (cfg.ownerXuid && entry.xuid === cfg.ownerXuid) {
    throw new Error("不能封禁服主。");
  }
  // Mirror the online role-hierarchy guard: a moderator may not ban an admin
  // (the offline target's role comes from its registry snapshot, entry.role).
  requireOutranksRole(admin, entry.role ?? "", "封禁玩家");
  const now = nowMs();
  const newEntry = {
    id: genId("P"),
    type: "BAN",
    reason: clampText(reason, 200),
    byName: admin.name,
    byXuid: getPlayerXuid(admin),
    at: now,
    expiresAt: durationMs > 0 ? now + durationMs : 0,
    active: true,
  };
  const ok = mutatePlayerPunishments(entry.xuid, (puns) => {
    // Replace any active ban.
    for (const p of puns) {
      if (p.type === "BAN" && p.active) p.active = false;
    }
    puns.unshift(newEntry);
    if (puns.length > LIMITS.PUNISHMENTS_MAX) {
      console.warn(
        `[AdminTools] Punishment history for ${entry.name} (${entry.xuid}) exceeded ${LIMITS.PUNISHMENTS_MAX} — oldest records dropped.`,
      );
      puns.splice(LIMITS.PUNISHMENTS_MAX);
    }
  });
  if (!ok) throw new Error(`在玩家记录中找不到 ${entry.name}。`);
  const expStr =
    durationMs > 0 ? `，时长 ${fmtDuration(durationMs)}` : "（永久）";
  logAdmin(
    admin,
    "BAN",
    `${fmtDuration(durationMs)} — ${clampText(reason, 80)}（离线）`,
    entry.name,
  );
  queuePlayerNotif(
    entry.xuid,
    `§c您已被封禁${expStr}。\n§r原因：§r${reason}`,
  );
}
