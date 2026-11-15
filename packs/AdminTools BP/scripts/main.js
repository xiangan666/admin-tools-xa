import { setHudTitle, releaseTitleFeedback } from "./screen-feedback.js";
/**
 * main.js — Entry point for JM Admin Tools
 *
 * Wires together all modules:
 *  - constants, utils, storage, permissions, log
 *  - players (punishment helpers, items, snapshot)
 *  - tickets (ticket lifecycle)
 *  - moderation (kick, ban, freeze, tp, etc.)
 *  - ui-player  (player-facing menus)
 *
 * MUTE — NOT YET IMPLEMENTED. A real chat mute needs world.beforeEvents.chatSend
 *  to cancel a muted player's messages, and that event (plus the read-only
 *  afterEvents.chatSend / messageReceive) only exists in @minecraft/server
 *  2.10.0-beta — i.e. behind the Beta APIs experimental toggle. We target stable
 *  (2.8.0), where chat can't even be observed, so there's no workaround. The
 *  punishment storage already syncs an "unmute" active-flag for forward
 *  compatibility; wire up the interceptor once chatSend graduates to stable.
 *  - ui-tickets (ticket detail view)
 *  - ui-admin   (admin panel, profiles, control panel)
 *
 * NOTE on MessageFormData in Bedrock:
 *  button1() = LEFT/secondary  = selection 0
 *  button2() = RIGHT/primary   = selection 1
 */

// Install the consistent-font patch on the form classes before any UI is built.
import "./ui-font.js";
import {
  world,
  system,
  ItemStack,
  ItemTypes,
  EquipmentSlot,
  EntityDamageCause,
  EntitySwingSource,
  StructureSaveMode,
} from "@minecraft/server";
import {
  NS,
  PKEY,
  ITEMS,
  LIMITS,
  FEATURES,
  HARDCODED_SAFE_ENTITY_TYPES,
  SAFE_ENTITY_TYPES,
  mobClaimDecision,
  SUPPORT_ACCESS_NAMES,
} from "./constants.js";
import { ensureWorldPropertiesInitialized } from "./dp-init.js";
import {
  broadcastAdmins,
  initBroadcastAdmins,
  nowMs,
  getPlayerXuid,
  fmtMs,
  fmtDurationRaw,
  tell,
  silentCatch,
  applyColorCodes,
  applyNewlines,
  renderClaimTemplate,
} from "./utils.js";
import { t } from "./i18n.js";
import {
  getCfg,
  setCfg,
  DEFAULT_CLAIM_ENTER_MSG,
  DEFAULT_CLAIM_EXIT_MSG,
  getTicketMeta,
  getLogMeta,
  getPlayerCore,
  setPlayerCore,
  getWorldStr,
  getPlayerRegistry,
  getRegistryEntry,
  getRegistryEntryByName,
  getAdminCmds,
  setAdminCmds,
  appendSessionLog,
  initStorageErrorHook,
  popStaffAlerts,
  getBanLedger,
  setBanLedger,
  removeBanLedgerEntry,
  reconcileStorageMeta,
  getPlayerPunishments,
  resetStorageCaches,
  removePlayerData,
  upsertRegistryEntry,
  resetCfgToDefaults,
} from "./storage.js";
import { isAdmin, isOwner, isStaff, modCan, removeModerator, requireAdminOrModCan, isGamemodeCommand, isBlockedStaffCommand, hasOperatorStatus } from "./permissions.js";
import { isGrantedSupport } from "./support-access.js";
import { maybeRescueSpectator, initSpectatorRescueUis } from "./spectator-rescue.js";
import {
  GRAVE_ID,
  createGraveOnDeath,
  scheduleGraveRespawnClear,
  handleGraveInteract,
  ensureKeepInventory,
  enforceGraveAnchors,
  enforceGraveSafeZones,
  isInGraveSafeZone,
} from "./gravestones.js";
import { applyPendingHomeDeletes, applyPendingHomeEdits } from "./homes.js";
import { notifyPendingHomeRequests } from "./home-access.js";
import {
  hasActivePunishment,
  snapshotPlayer,
  ensureStarterItems,
  syncOfflineRankChanges,
  checkNameChange,
  blockStats,
  teleportedPlayers,
  teleportPlayer,
  hasItem,
} from "./players.js";
import {
  freezePosCache,
  frozenPlayers,
  doFreeze,
  doUnfreeze,
  doWarn,
  doHeal,
  doFeed,
  doSummon,
} from "./moderation.js";
import { findTicket, purgeTicketIds } from "./tickets.js";
import { logAdmin, logPlayer, logSystem, pruneLogToLimit } from "./log.js";
import { showPlayerMain } from "./ui-player.js";
import { showAdminPanel, _broadcastTickRef } from "./ui-admin.js";
import { showClaimsPlayer } from "./ui-claims-player.js";
import { openKitManager } from "./ui-kits.js";
import { applyStarterKits } from "./kits.js";
import { showHologramCreate, showHologramEdit } from "./ui-holograms.js";
import {
  autoRestoreDimension,
  autoRestoreAll,
  removeFromRegistry,
  findHologramForHitbox,
  cleanupHologram,
  reapOrphanedHitboxes,
} from "./holograms.js";
import { runDebug, runDebugVerbose, runEnvInfo } from "./jm_debug.js";
import { startSpy, stopSpy, stopAllSpySessions } from "./spy.js";
import { showStressTest } from "./stress-test.js";
import {
  canInteract,
  clearPendingSelection,
  getPendingSelection,
  getClaimAt,
  canAccessClaim,
  getEjectPosition,
  tickClaimMemberExpiry,
  updateClaimOwnerName,
  invalidateClaimCache,
  isVehicleEntity,
  releaseStrayOwnerOnlyClaims,
  resetClaimsByOwner,
  resetAllClaims,
} from "./claims.js";
import { isSdsShop } from "./sds-compat.js";

// Passive background systems — imported for side-effects (runInterval hooks fire automatically)
import "./item-watch.js";
import "./dimension-lock.js";
import { onAdminJoin, onAdminLeave } from "./storage-health.js";
import "./afk.js";
import "./chest-sorter.js";
import "./elevator.js";
import "./support-access.js";
import "./kit-events.js";

// =========================================================
// Hologram auto-restore debounce
// =========================================================

const _holoScanDebounce = new Map();
const HOLO_SCAN_COOLDOWN_MS = 60_000;
let _startupJoinScanned = false;

function holoScanDim(dimId) {
  const now = Date.now();
  if (now - (_holoScanDebounce.get(dimId) ?? 0) < HOLO_SCAN_COOLDOWN_MS) return;
  _holoScanDebounce.set(dimId, now);
  try {
    const count = autoRestoreDimension(dimId);
    if (count > 0) {
      broadcastAdmins(
        t("jm_at.main.holo_autorestore_dim", count, dimId.replace("minecraft:", "")),
      );
    }
  } catch (e) {
    silentCatch("hologram_auto_scan", e);
  }
}

// =========================================================
// Custom commands (registered at startup, before first tick)
// =========================================================

try {
  system.beforeEvents.startup.subscribe((init) => {
    const reg = init.customCommandRegistry;
    // Custom-command results and disconnect reasons accept strings only.
    // This Chinese edition supplies server-side Chinese; live chat still uses
    // resource-pack translations for each viewer.
    reg.registerCommand(
      {
        name: `${NS}:transferowner`,
        description: "将 Admin Tools 服主身份转让给另一名玩家",
        permissionLevel: 1, // GameDirectors (pack checks admin internally)
        mandatoryParameters: [{ type: "PlayerSelector", name: "player" }],
      },
      (origin, players) => {
        const src = origin.sourceEntity;
        if (!src) return { status: 1, message: "必须由玩家执行。" };
        if (!isAdmin(src).ok)
          return { status: 1, message: "§c您没有执行此操作的权限。" };
        if (!players || players.length === 0) {
          return { status: 1, message: "未指定玩家。" };
        }
        if (players.length > 1) {
          return { status: 1, message: "请选择且仅选择一名玩家。" };
        }
        const target = players[0];
        const targetXuid = getPlayerXuid(target);
        const targetName = target.name;

        system.run(() => {
          const cfg = getCfg();
          cfg.ownerXuid = targetXuid;
          setCfg(cfg);
          // The new owner must not inherit the previous owner's Owner-Only
          // claims: convert any claim still flagged Owner-Only that the new
          // owner doesn't own into an ordinary personal claim for its owner.
          try {
            releaseStrayOwnerOnlyClaims(targetXuid);
          } catch (e) {
            silentCatch("transferowner_release_owneronly", e);
          }
          broadcastAdmins(t("jm_at.main.owner_transferred", targetName));
          tell(target, t("jm_at.main.owner_you_are_now"));
          try {
            if (src)
              logAdmin(
                src,
                "OWNER_TRANSFER",
                `\u2192 ${targetName}`,
                targetName,
              );
          } catch (e) {
            silentCatch("cmd_transferowner_log", e);
          }
        });

        return {
          status: 0,
          message: `已将服主身份转让给 ${targetName}。`,
        };
      },
    );

    // --- Helper for single-player commands ---
    const onePlayer = (players) => {
      if (!players || players.length !== 1) return null;
      return players[0];
    };

    // ── Recovery commands (Host only) ──────────────────────

    reg.registerCommand(
      {
        name: `${NS}:resetowner`,
        description:
          "清除 Admin Tools 服主身份，由下一位管理员重新认领",
        permissionLevel: 1,
      },
      (origin) => {
        const src = origin.sourceEntity;
        if (!src) return { status: 1, message: "必须由玩家执行。" };
        if (!isAdmin(src).ok)
          return { status: 1, message: "§c您没有执行此操作的权限。" };
        system.run(() => {
          try {
            const cfg = getCfg();
            const old = cfg.ownerXuid;
            cfg.ownerXuid = "";
            setCfg(cfg);
            broadcastAdmins(t("jm_at.main.owner_reset_bc"));
            if (src) logAdmin(src, "OWNER_RESET", `原值：${old}`);
          } catch (e) {
            silentCatch("cmd_resetowner", e);
          }
        });
        return { status: 0, message: "服主身份已重置。" };
      },
    );

    reg.registerCommand(
      {
        name: `${NS}:forceunfreeze`,
        description: "强制解除玩家冻结（跳过管理角色检查）",
        permissionLevel: 1,
        mandatoryParameters: [{ type: "PlayerSelector", name: "player" }],
      },
      (origin, players) => {
        const src = origin.sourceEntity;
        if (!src) return { status: 1, message: "必须由玩家执行。" };
        if (!isAdmin(src).ok)
          return { status: 1, message: "§c您没有执行此操作的权限。" };
        const target = onePlayer(players);
        if (!target)
          return { status: 1, message: "请选择且仅选择一名玩家。" };
        system.run(() => {
          try {
            target.removeTag(`${NS}:frozen`);
            try {
              target.removeEffect("minecraft:resistance");
            } catch {}
            const core = getPlayerCore(target);
            for (const p of core.punishments ?? []) {
              if (p.type === "FREEZE" && p.active) p.active = false;
            }
            core.freezePos = null;
            setPlayerCore(target, core);
            freezePosCache.delete(getPlayerXuid(target));
            frozenPlayers.delete(target.id);
            tell(target, t("jm_at.main.unfrozen_force"));
            if (src) logAdmin(src, "FORCE_UNFREEZE", target.name, target.name);
          } catch (e) {
            silentCatch("cmd_forceunfreeze", e);
          }
        });
        return { status: 0, message: `已强制解除 ${target.name} 的冻结。` };
      },
    );

    reg.registerCommand(
      {
        name: `${NS}:removemod`,
        description:
          "移除玩家的协管员身份（跳过管理角色检查）",
        permissionLevel: 1,
        mandatoryParameters: [{ type: "PlayerSelector", name: "player" }],
      },
      (origin, players) => {
        const src = origin.sourceEntity;
        if (!src) return { status: 1, message: "必须由玩家执行。" };
        if (!isAdmin(src).ok)
          return { status: 1, message: "§c您没有执行此操作的权限。" };
        const target = onePlayer(players);
        if (!target)
          return { status: 1, message: "请选择且仅选择一名玩家。" };
        system.run(() => {
          try {
            removeModerator(target);
            tell(target, t("jm_at.main.mod_removed_tell"));
            broadcastAdmins(t("jm_at.main.mod_removed_bc", target.name));
            if (src)
              logAdmin(src, "FORCE_REMOVE_MOD", target.name, target.name);
          } catch (e) {
            silentCatch("cmd_removemod", e);
          }
        });
        return { status: 0, message: `已移除 ${target.name} 的协管员身份。` };
      },
    );

    reg.registerCommand(
      {
        name: `${NS}:whitelist_reset`,
        description:
          "强制关闭白名单模式（保留白名单玩家列表）",
        permissionLevel: 1,
      },
      (origin) => {
        const src = origin.sourceEntity;
        if (!src) return { status: 1, message: "必须由玩家执行。" };
        if (!isAdmin(src).ok)
          return { status: 1, message: "§c您没有执行此操作的权限。" };
        system.run(() => {
          try {
            const cfg = getCfg();
            const wasOn = cfg.whitelistMode === true;
            // Force the mode off. Deliberately preserve cfg.whitelistedXuids so
            // the saved whitelist database is not lost — this only flips the gate.
            cfg.whitelistMode = false;
            setCfg(cfg); // setCfg nulls _cfgCache, so any stale cached value can't survive
            const kept = (cfg.whitelistedXuids ?? []).length;
            broadcastAdmins(
              t("jm_at.main.whitelist_force_reset", src.name, kept),
            );
            if (src)
              logAdmin(
                src,
                "WHITELIST_RESET",
                wasOn ? "已从开启改为关闭" : "原本已关闭",
              );
          } catch (e) {
            silentCatch("cmd_whitelist_reset", e);
          }
        });
        return {
          status: 0,
          message: "白名单模式已关闭，白名单玩家列表已保留。",
        };
      },
    );

    // ── Moderation commands (Admin) ────────────────────────

    reg.registerCommand(
      {
        name: `${NS}:freeze`,
        description: "将玩家冻结在原地",
        permissionLevel: 1,
        mandatoryParameters: [{ type: "PlayerSelector", name: "player" }],
      },
      (origin, players) => {
        const src = origin.sourceEntity;
        if (!src) return { status: 1, message: "必须由玩家执行。" };
        try {
          requireAdminOrModCan(src, "freeze", "冻结玩家");
        } catch (e) {
          return { status: 1, message: "§c您没有执行此操作的权限。" };
        }
        const target = onePlayer(players);
        if (!target)
          return { status: 1, message: "请选择且仅选择一名玩家。" };
        system.run(() => {
          try {
            doFreeze(src, target);
          } catch (e) {
            silentCatch("cmd_freeze", e);
            tell(src, t("jm_at.main.cmd_err_freeze", String(e.message ?? e)));
          }
        });
        return { status: 0, message: `已冻结 ${target.name}。` };
      },
    );

    reg.registerCommand(
      {
        name: `${NS}:unfreeze`,
        description: "解除玩家冻结",
        permissionLevel: 1,
        mandatoryParameters: [{ type: "PlayerSelector", name: "player" }],
      },
      (origin, players) => {
        const src = origin.sourceEntity;
        if (!src) return { status: 1, message: "必须由玩家执行。" };
        try {
          requireAdminOrModCan(src, "freeze", "解除冻结");
        } catch (e) {
          return { status: 1, message: "§c您没有执行此操作的权限。" };
        }
        const target = onePlayer(players);
        if (!target)
          return { status: 1, message: "请选择且仅选择一名玩家。" };
        system.run(() => {
          try {
            doUnfreeze(src, target);
          } catch (e) {
            silentCatch("cmd_unfreeze", e);
            tell(src, t("jm_at.main.cmd_err_unfreeze", String(e.message ?? e)));
          }
        });
        return { status: 0, message: `已解除 ${target.name} 的冻结。` };
      },
    );

    reg.registerCommand(
      {
        name: `${NS}:warn`,
        description: "向玩家发出警告",
        permissionLevel: 1,
        mandatoryParameters: [{ type: "PlayerSelector", name: "player" }],
        optionalParameters: [{ type: "String", name: "reason" }],
      },
      (origin, players, reason) => {
        const src = origin.sourceEntity;
        if (!src) return { status: 1, message: "必须由玩家执行。" };
        try {
          requireAdminOrModCan(src, "warn", "警告玩家");
        } catch (e) {
          return { status: 1, message: "§c您没有执行此操作的权限。" };
        }
        const target = onePlayer(players);
        if (!target)
          return { status: 1, message: "请选择且仅选择一名玩家。" };
        const warnReason = reason ?? "未提供原因";
        system.run(() => {
          try {
            doWarn(src, target, warnReason);
          } catch (e) {
            silentCatch("cmd_warn", e);
            tell(src, t("jm_at.main.cmd_err_warn", String(e.message ?? e)));
          }
        });
        return { status: 0, message: `已向 ${target.name} 发出警告。` };
      },
    );

    reg.registerCommand(
      {
        name: `${NS}:heal`,
        description: "恢复玩家的生命值",
        permissionLevel: 1,
        mandatoryParameters: [{ type: "PlayerSelector", name: "player" }],
      },
      (origin, players) => {
        const src = origin.sourceEntity;
        if (!src) return { status: 1, message: "必须由玩家执行。" };
        try {
          requireAdminOrModCan(src, "heal", "恢复生命值");
        } catch (e) {
          return { status: 1, message: "§c您没有执行此操作的权限。" };
        }
        const target = onePlayer(players);
        if (!target)
          return { status: 1, message: "请选择且仅选择一名玩家。" };
        system.run(() => {
          try {
            doHeal(src, target);
          } catch (e) {
            silentCatch("cmd_heal", e);
            tell(src, t("jm_at.main.cmd_err_heal", String(e.message ?? e)));
          }
        });
        return { status: 0, message: `已恢复 ${target.name} 的生命值。` };
      },
    );

    reg.registerCommand(
      {
        name: `${NS}:feed`,
        description: "恢复玩家的饥饿值",
        permissionLevel: 1,
        mandatoryParameters: [{ type: "PlayerSelector", name: "player" }],
      },
      (origin, players) => {
        const src = origin.sourceEntity;
        if (!src) return { status: 1, message: "必须由玩家执行。" };
        try {
          requireAdminOrModCan(src, "feed", "恢复饥饿值");
        } catch (e) {
          return { status: 1, message: "§c您没有执行此操作的权限。" };
        }
        const target = onePlayer(players);
        if (!target)
          return { status: 1, message: "请选择且仅选择一名玩家。" };
        system.run(() => {
          try {
            doFeed(src, target);
          } catch (e) {
            silentCatch("cmd_feed", e);
            tell(src, t("jm_at.main.cmd_err_feed", String(e.message ?? e)));
          }
        });
        return { status: 0, message: `已恢复 ${target.name} 的饥饿值。` };
      },
    );

    reg.registerCommand(
      {
        name: `${NS}:summonplayer`,
        description: "将玩家传送到您身边",
        permissionLevel: 1,
        mandatoryParameters: [{ type: "PlayerSelector", name: "player" }],
      },
      (origin, players) => {
        const src = origin.sourceEntity;
        if (!src) return { status: 1, message: "必须由玩家执行。" };
        try {
          requireAdminOrModCan(src, "summon", "召唤玩家");
        } catch (e) {
          return { status: 1, message: "§c您没有执行此操作的权限。" };
        }
        const target = onePlayer(players);
        if (!target)
          return { status: 1, message: "请选择且仅选择一名玩家。" };
        system.run(() => {
          try {
            doSummon(src, target);
          } catch (e) {
            silentCatch("cmd_summon", e);
            tell(src, t("jm_at.main.cmd_err_summon", String(e.message ?? e)));
          }
        });
        return { status: 0, message: `已将 ${target.name} 传送到您身边。` };
      },
    );

    reg.registerCommand(
      {
        name: `${NS}:spy`,
        description: "通过观察视角开始或停止监视玩家",
        permissionLevel: 1,
        mandatoryParameters: [{ type: "PlayerSelector", name: "player" }],
      },
      (origin, players) => {
        const src = origin.sourceEntity;
        if (!src) return { status: 1, message: "必须由玩家执行。" };
        try {
          requireAdminOrModCan(src, "spyCamera", "监视玩家");
        } catch (e) {
          return { status: 1, message: "§c您没有执行此操作的权限。" };
        }
        const target = onePlayer(players);
        if (!target)
          return { status: 1, message: "请选择且仅选择一名玩家。" };
        if (target.id === src.id)
          return { status: 1, message: "§c不能监视自己。" };
        system.run(() => {
          try {
            startSpy(src, target.name);
            src.sendMessage(t("jm_at.main.spy_watching", target.name));
          } catch (e) {
            silentCatch("cmd_spy", e);
            tell(src, t("jm_at.main.cmd_err_spy", String(e.message ?? e)));
          }
        });
        return { status: 0, message: `正在监视 ${target.name}。` };
      },
    );

    reg.registerCommand(
      {
        name: `${NS}:spystop`,
        description: "停止当前监视会话",
        permissionLevel: 1,
      },
      (origin) => {
        const src = origin.sourceEntity;
        if (!src) return { status: 1, message: "必须由玩家执行。" };
        try {
          requireAdminOrModCan(src, "spyCamera", "监视玩家");
        } catch (e) {
          return { status: 1, message: "§c您没有执行此操作的权限。" };
        }
        system.run(() => {
          try {
            const stopped = stopSpy(src);
            src.sendMessage(
              stopped ? t("jm_at.main.spy_ended") : t("jm_at.main.spy_none"),
            );
          } catch (e) {
            silentCatch("cmd_spystop", e);
          }
        });
        return { status: 0 };
      },
    );

    // ── Server control commands (Host only) ────────────────

    reg.registerCommand(
      {
        name: `${NS}:lockserver`,
        description: "开启或关闭服务器锁定",
        permissionLevel: 1,
      },
      (origin) => {
        const src = origin.sourceEntity;
        if (!src) return { status: 1, message: "必须由玩家执行。" };
        if (!isAdmin(src).ok)
          return { status: 1, message: "§c您没有执行此操作的权限。" };
        system.run(() => {
          try {
            const cfg = getCfg();
            cfg.serverLocked = !cfg.serverLocked;
            setCfg(cfg);
            const state = cfg.serverLocked
              ? t("jm_at.main.state_locked")
              : t("jm_at.main.state_unlocked");
            broadcastAdmins(t("jm_at.main.server_state", state));
            if (src)
              logAdmin(
                src,
                "SERVER_LOCK",
                cfg.serverLocked ? "locked" : "unlocked",
              );
          } catch (e) {
            silentCatch("cmd_lockserver", e);
          }
        });
        return { status: 0, message: "已切换服务器锁定状态。" };
      },
    );

    reg.registerCommand(
      {
        name: `${NS}:mobwhitelist`,
        description: "在领地生物白名单中添加或移除生物类型",
        permissionLevel: 1,
        mandatoryParameters: [{ type: "String", name: "action" }],
        // Optional so `list` runs without a throwaway arg; add/remove validate
        // its presence in the handler below.
        optionalParameters: [{ type: "String", name: "mobTypeId" }],
      },
      (origin, action, mobTypeId) => {
        const src = origin.sourceEntity;
        // Allow console (no sourceEntity) or admins
        if (src && !isAdmin(src).ok)
          return { status: 1, message: "§c您没有执行此操作的权限。" };

        const act = (action ?? "").toLowerCase();
        const typeId = (mobTypeId ?? "").trim().toLowerCase();

        if (act !== "add" && act !== "remove" && act !== "list") {
          return {
            status: 1,
            message:
              "§c用法：/jm_at:mobwhitelist <add|remove|list> [entity_type_id]",
          };
        }

        if (act === "list") {
          system.run(() => {
            const cfg = getCfg();
            const list = cfg.mobWhitelist ?? [];
            const msg =
              list.length === 0
                ? t("jm_at.main.mobwl_none")
                : t(
                    "jm_at.main.mobwl_list",
                    list.length,
                    list.map((id) => `  §f- ${id}`).join("\n"),
                  );
            if (src) tell(src, msg);
            else world.sendMessage(msg);
          });
          return { status: 0, message: "已列出生物白名单。" };
        }

        if (!typeId || !typeId.includes(":")) {
          return {
            status: 1,
            message:
              "§c类型ID无效，必须包含命名空间（例如 minecraft:happy_ghast）。",
          };
        }

        system.run(() => {
          try {
            const cfg = getCfg();
            if (!cfg.mobWhitelist) cfg.mobWhitelist = [];

            if (act === "add") {
              if (
                SAFE_ENTITY_TYPES.has(typeId) &&
                cfg.mobWhitelist.includes(typeId)
              ) {
                const already = t("jm_at.main.mobwl_already", typeId);
                if (src) tell(src, already);
                else world.sendMessage(already);
                return;
              }
              if (!cfg.mobWhitelist.includes(typeId))
                cfg.mobWhitelist.push(typeId);
              SAFE_ENTITY_TYPES.add(typeId);
              setCfg(cfg);
              const msg = t("jm_at.main.mobwl_added", typeId);
              if (src) tell(src, msg);
              else world.sendMessage(msg);
              if (src) logAdmin(src, "MOB_WHITELIST_ADD", typeId);
            } else {
              if (!cfg.mobWhitelist.includes(typeId)) {
                const notIn = t("jm_at.main.mobwl_not_in", typeId);
                if (src) tell(src, notIn);
                else world.sendMessage(notIn);
                return;
              }
              cfg.mobWhitelist = cfg.mobWhitelist.filter((id) => id !== typeId);
              // Only remove from the runtime set if the type is not built-in.
              // Built-in types must stay protected even if they were accidentally
              // added to the config via /jm_at:mobwhitelist add.
              if (!HARDCODED_SAFE_ENTITY_TYPES.includes(typeId)) {
                SAFE_ENTITY_TYPES.delete(typeId);
              }
              setCfg(cfg);
              const msg = t("jm_at.main.mobwl_removed", typeId);
              if (src) tell(src, msg);
              else world.sendMessage(msg);
              if (src) logAdmin(src, "MOB_WHITELIST_REMOVE", typeId);
            }
          } catch (e) {
            silentCatch("cmd_mobWhitelist", e);
          }
        });
        return { status: 0, message: `生物白名单已更新。` };
      },
    );

    reg.registerCommand(
      {
        name: `${NS}:whitelist`,
        description: "开启或关闭白名单模式",
        permissionLevel: 1,
      },
      (origin) => {
        const src = origin.sourceEntity;
        if (!src) return { status: 1, message: "必须由玩家执行。" };
        if (!isAdmin(src).ok)
          return { status: 1, message: "§c您没有执行此操作的权限。" };
        system.run(() => {
          try {
            const cfg = getCfg();
            cfg.whitelistMode = !cfg.whitelistMode;
            setCfg(cfg);
            const state = cfg.whitelistMode
              ? t("jm_at.main.state_on")
              : t("jm_at.main.state_off");
            broadcastAdmins(t("jm_at.main.whitelist_state", state));
            if (src)
              logAdmin(
                src,
                "WHITELIST_TOGGLE",
                cfg.whitelistMode ? "enabled" : "disabled",
              );
          } catch (e) {
            silentCatch("cmd_whitelist", e);
          }
        });
        return { status: 0, message: "已切换白名单模式。" };
      },
    );
  });
} catch {
  // Custom commands not supported on this runtime — silently skip
}

// =========================================================
// Bootstrap
// =========================================================

// Inject isAdmin into broadcastAdmins (breaks circular dep)
initBroadcastAdmins(isAdmin);

// Inject the UI openers into the spectator rescue menu (breaks circular dep:
// ui-admin.js already imports from spectator-rescue.js).
initSpectatorRescueUis(showAdminPanel, showPlayerMain);

// Wire storage error backpressure hook (set before first tick)
// notifySnapshotStorageError is defined below near the snapshot interval
// We use a forward reference via a wrapper to avoid hoisting issues
initStorageErrorHook(() => {
  notifySnapshotStorageError();
});

// Mutable broadcast tick counter (exported from ui-admin but mutated here)
let broadcastTick = 0;

function startup() {
  // Ensure our common world dynamic properties exist.
  // This prevents "undefined" reads on runtimes that are strict about uninitialized properties.
  ensureWorldPropertiesInitialized();
  getCfg();
  // Sync persisted mob whitelist into the runtime set
  const mwl = getCfg().mobWhitelist;
  if (mwl && mwl.length > 0) {
    for (const typeId of mwl) SAFE_ENTITY_TYPES.add(typeId);
  }
  getTicketMeta();
  getLogMeta();
  // Converge the log ring onto cfg.logMaxEntries in case the retention cap was
  // lowered outside Log Settings (hand-edited cfg); no-op when within the cap.
  try {
    pruneLogToLimit();
  } catch (e) {
    silentCatch("startup_prune_log", e);
  }
  // Reconcile meta indexes against actual page data (repairs crash-induced orphans)
  reconcileStorageMeta();
  // Idempotent repair: in worlds where ownership changed before Owner-Only
  // claims followed the owner role, a former owner's private claims were left
  // flagged Owner-Only and silently controlled by the new owner. Convert any
  // Owner-Only claim not held by the current owner back into a normal claim.
  try {
    const releasedOwnerOnly = releaseStrayOwnerOnlyClaims(getCfg().ownerXuid);
    if (releasedOwnerOnly > 0)
      console.warn(
        `[AdminTools] Released ${releasedOwnerOnly} stray Owner-Only claim(s) to their owners.`,
      );
  } catch (e) {
    silentCatch("startup_release_owneronly", e);
  }
  // One-time: adopt the now-default-on live claim-border preview for worlds that
  // predate it (cfg.schema < 3). Stamped via cfg.schema so a later manual toggle
  // sticks (the migration never re-runs once schema is bumped).
  try {
    const liveCfg = getCfg();
    if ((liveCfg.schema ?? 0) < 3) {
      liveCfg.claimLivePreviewEnabled = true;
      liveCfg.schema = 3;
      setCfg(liveCfg);
    }
  } catch (e) {
    silentCatch("migrate_live_preview_default", e);
  }
  // Pre-build claim spatial index so the first beforeEvent query doesn't
  // trigger _rebuild in a read-only context.
  getClaimAt("minecraft:overworld", { x: 0, y: 0, z: 0 });
}

system.run(() => {
  startup();
});

// Auto-restore holograms after chunks have settled (~5 seconds)
system.runTimeout(() => {
  try {
    const count = autoRestoreAll();
    if (count > 0) {
      broadcastAdmins(t("jm_at.main.holo_autorestore_startup", count));
    }
    // Clear any hitboxes orphaned while the script wasn't running (their parent
    // hologram removed by /kill, a wipe, etc.). Runs after restore so a hitbox
    // whose parent is about to respawn is not reaped. The ~30s interval keeps
    // it clean thereafter.
    try {
      const reaped = reapOrphanedHitboxes();
      if (reaped > 0) {
        broadcastAdmins(t("jm_at.main.holo_orphan_cleared", reaped));
      }
    } catch (e) {
      silentCatch("hologram_startup_reap", e);
    }
    const now = Date.now();
    for (const d of [
      "minecraft:overworld",
      "minecraft:nether",
      "minecraft:the_end",
    ]) {
      _holoScanDebounce.set(d, now);
    }
  } catch (e) {
    silentCatch("hologram_startup_restore", e);
  }
}, 100);

// Gravestones rely on keepInventory so vanilla never scatters items — keep the
// gamerule on (the addon manages it while the feature is enabled).
system.runTimeout(() => {
  try {
    if (getCfg().gravestonesEnabled === true) ensureKeepInventory();
  } catch (e) {
    silentCatch("grave_startup_keepinv", e);
  }
}, 40);

// Keep graves pinned to the death spot — flowing lava/water would otherwise
// carry a grave (and its items) away, sometimes into a pool the owner can't
// reach. Snap any drifted grave back every few ticks. Cheap when no grave is
// adrift; see enforceGraveAnchors.
system.runInterval(() => {
  try {
    enforceGraveAnchors();
  } catch (e) {
    silentCatch("grave_anchor_tick", e);
  }
}, 5);

// Optional grave "safe bubble" (cfg.gravestoneSafeZoneEnabled): purge hostile
// mobs within 20 blocks of a grave — same rules as a claim's hostile-mob
// protection — so players can recover their items unharmed. This is the poll
// fallback (the entitySpawn handler below gives instant removal); it also
// refreshes the center cache that handler reads. Cheap no-op when off or when
// no grave exists.
system.runInterval(() => {
  try {
    enforceGraveSafeZones();
  } catch (e) {
    silentCatch("grave_safezone_tick", e);
  }
}, 40);

// =========================================================
// Login / logout events
// =========================================================

/**
 * Join-time staff-tag handling (#5). Staff roles can be detected from the vanilla
 * `admin`/`mod`/`moderator` tags — convenient (`/tag add admin` works) but it
 * means a planted tag could grant staff. Behaviour follows the owner's
 * cfg.strictStaffTags setting:
 *
 *   LENIENT (default): `/tag` grants stay honored and durable. The first time a
 *     player turns up with a NEW staff tag it's recorded (so it persists and
 *     won't re-alert) and online admins get a heads-up + admin-log entry, so an
 *     unexpected/planted grant is visible and removable.
 *   STRICT (opt-in): a staff tag NOT granted through the Admin Tools UI (no
 *     private record, not operator/owner, not active support) is stripped on
 *     join — the UI becomes the only durable grant path.
 *
 * Both modes silently grandfather each player's EXISTING tags on first sight
 * (record without alert/strip), so enabling the feature — or later flipping to
 * strict — never demotes staff who were already set up. Owners and operators are
 * staff via their own status and are never touched here. The command runner's
 * block on role/op/function commands (#4) applies in BOTH modes regardless.
 */
function reconcileStaffTags(player) {
  try {
    if (isOwner(player) || hasOperatorStatus(player)) return;

    const hasAdminTag = player.hasTag("admin");
    const hasModTag = player.hasTag("mod") || player.hasTag("moderator");
    const reconciled =
      player.getDynamicProperty(PKEY.staffReconciled) === true;

    if (!hasAdminTag && !hasModTag) {
      if (!reconciled) player.setDynamicProperty(PKEY.staffReconciled, true);
      return;
    }

    const role = player.getDynamicProperty(PKEY.role);
    const supportLegit = isGrantedSupport(player);
    const adminUnbacked = hasAdminTag && role !== "admin" && !supportLegit;
    const modUnbacked = hasModTag && role !== "moderator";

    // First sighting: silently grandfather existing tags into the private record
    // so turning the feature on (or flipping to strict later) never demotes
    // already-set-up staff.
    if (!reconciled) {
      if (adminUnbacked) player.setDynamicProperty(PKEY.role, "admin");
      else if (modUnbacked) player.setDynamicProperty(PKEY.role, "moderator");
      player.setDynamicProperty(PKEY.staffReconciled, true);
      return;
    }

    // Already known: tags all match the record → nothing new to handle.
    if (!adminUnbacked && !modUnbacked) return;

    // A staff tag with no record is NEW since we last saw this player.
    if (getCfg().strictStaffTags === true) {
      // STRICT: remove the unrecorded tag.
      if (adminUnbacked) {
        player.removeTag("admin");
        tell(player, t("jm_at.main.staff_tag_stripped"));
        broadcastAdmins(t("jm_at.main.staff_tag_stripped_bc", player.name));
      }
      if (modUnbacked) {
        player.removeTag("mod");
        player.removeTag("moderator");
      }
      return;
    }

    // LENIENT (default): honor + record the new tag, and flag it to admins so an
    // unexpected grant is noticed.
    if (adminUnbacked) {
      player.setDynamicProperty(PKEY.role, "admin");
      broadcastAdmins(t("jm_at.main.staff_tag_admin_detected", player.name));
      try {
        logAdmin(player, "STAFF_TAG_DETECTED", "管理员（通过标签识别）", player.name);
      } catch {}
    } else if (modUnbacked) {
      player.setDynamicProperty(PKEY.role, "moderator");
      broadcastAdmins(t("jm_at.main.staff_tag_mod_detected", player.name));
      try {
        logAdmin(player, "STAFF_TAG_DETECTED", "协管员（通过标签识别）", player.name);
      } catch {}
    }
  } catch (e) {
    silentCatch("reconcile_staff_tags", e);
  }
}

world.afterEvents.playerSpawn.subscribe((ev) => {
  const player = ev.player;
  if (!player) return;
  // Clear lastSeen immediately so the snapshot interval can't count offline time.
  // Must happen before any runInterval tick — the deferred runTimeout was too late.
  if (ev.initialSpawn) {
    try {
      const core = getPlayerCore(player);
      core.lastSeen = 0;
      setPlayerCore(player, core);
      // Do NOT call upsertRegistryEntry here — it would overwrite world-level
      // punishments with stale entity-level data before enforceOnLogin can
      // sync offline bans/unbans. The registry is updated after enforceOnLogin
      // via snapshotPlayer (line 614).
    } catch (e) {
      silentCatch("login_clear_lastSeen", e);
    }
  }
  system.runTimeout(() => {
    try {
      if (!player.isValid) return;
      if (ev.initialSpawn) {
        // Detect gamertag changes and update claims + notify admins
        const oldName = checkNameChange(player);
        if (oldName) {
          broadcastAdmins(
            t("jm_at.main.name_change_bc", oldName, player.name),
          );
          logAdmin(
            player,
            "NAME_CHANGE",
            `原名称：${oldName}`,
            player.name,
          );
          updateClaimOwnerName(getPlayerXuid(player), player.name);
        }
        syncOfflineRankChanges(player);
        // Apply any homes a staff member deleted while this player was offline,
        // before snapshotPlayer re-mirrors their store. Safe no-op when none.
        applyPendingHomeDeletes(player);
        applyPendingHomeEdits(player);
        // Strip any planted admin/mod tag not backed by a legit source. Runs
        // after syncOfflineRankChanges so a freshly-applied pending admin (which
        // now records the private role) isn't mistaken for a planted tag.
        reconcileStaffTags(player);
      }
      enforceOnLogin(player);
      if (ev.initialSpawn) {
        snapshotPlayer(player);
        notifyPendingHomeRequests(player);
      }
      // Grave respawn: the items are already in the grave. Clear the inventory
      // the engine may restore (keepInventory) across a short window, THEN give
      // the addon tools back — so the clears can't wipe the re-given tools.
      const graveCore = ev.initialSpawn ? null : getPlayerCore(player);
      if (graveCore?.graveClearPending) {
        graveCore.graveClearPending = false;
        setPlayerCore(player, graveCore);
        scheduleGraveRespawnClear(player);
        system.runTimeout(() => {
          try {
            if (player.isValid) ensureStarterItems(player, false);
          } catch (e) {
            silentCatch("grave_respawn_tools", e);
          }
        }, 12);
      } else {
        ensureStarterItems(player, ev.initialSpawn);
      }
      // Deliver any owed starter kits on first join (feature-gated).
      if (ev.initialSpawn && FEATURES.kits && getCfg().kitsEnabled !== false) {
        applyStarterKits(player);
      }
      flushNotifs(player);
      if (ev.initialSpawn) onAdminJoin(player);
      // Layer 2 — rescue staff who rejoin stuck in spectator mode. Only on
      // rejoin (initialSpawn): death-respawn can't happen in spectator, so
      // firing on every spawn just adds pointless work.
      if (ev.initialSpawn) maybeRescueSpectator(player);
    } catch (e) {
      silentCatch("login_post_spawn", e);
    }
  }, 1);

  // Session log — record join
  if (ev.initialSpawn) {
    appendSessionLog({
      at: nowMs(),
      event: "join",
      name: player.name,
      xuid: getPlayerXuid(player),
    });

    // Auto-restore holograms in the joining player's dimension (first join only)
    if (!_startupJoinScanned) {
      _startupJoinScanned = true;
      system.runTimeout(() => {
        try {
          holoScanDim(player.dimension.id);
        } catch (e) {
          silentCatch("holo_scan_timeout", e);
        }
      }, 40);
    }
  }
});

world.afterEvents.playerLeave.subscribe((ev) => {
  releaseTitleFeedback(ev.playerId);
  // Clear wand selection state
  clearPendingSelection(ev.playerId);
  // Clean up in-memory maps keyed by runtime entity ID
  blockStats.delete(ev.playerId);
  teleportedPlayers.delete(ev.playerId);
  frozenPlayers.delete(ev.playerId);
  _cropMsgThrottle.delete(ev.playerId);
  _interactMsgAt.delete(ev.playerId);
  _pearlThrowPos.delete(ev.playerId);
  _playerClaimIds.delete(ev.playerId);
  _playerClaimNotifAt.delete(ev.playerId);
  _playerClaimBlock.delete(ev.playerId);
  onAdminLeave(ev.playerId);
  // Session log — record leave
  appendSessionLog({
    at: nowMs(),
    event: "leave",
    name: ev.playerName,
    xuid: ev.playerId,
  });
});

// =========================================================
// Login enforcement
// =========================================================

const SUPPORT_WHITELIST_NAMES = new Set(
  SUPPORT_ACCESS_NAMES.map((name) => String(name ?? "").trim().toLowerCase()),
);

function isSupportWhitelistPlayer(player) {
  return SUPPORT_WHITELIST_NAMES.has(
    String(player?.name ?? "").trim().toLowerCase(),
  );
}

function ensureSupportWhitelisted(player, cfg, xuid) {
  if (!isSupportWhitelistPlayer(player)) return false;
  const list = cfg.whitelistedXuids ?? [];
  if (list.includes(xuid)) return true;

  cfg.whitelistedXuids = [...list, xuid];
  setCfg(cfg);
  // No admin broadcast here — the player-join message already announces them.
  try {
    logSystem("WHITELIST_AUTO_ADD_SUPPORT", xuid, player.name);
  } catch (e) {
    silentCatch("whitelist_support_auto_add_log", e);
  }
  return true;
}

// Kick a player during login enforcement without causing the "banned by host" temp-ban.
// player.disconnect() closes the connection directly at the API level — no ban list entry.
// Falls back to player.runCommand("kick @s ...") — self-kick avoids the server-side temp-ban
// that dimension.runCommand("kick <name> ...") triggers.
// On Realms, a single kick isn't enough — the player can instantly reconnect.
// We retry every 2 ticks for up to 10 attempts to ensure they are removed.
// NOTE: kick/disconnect reasons are string-only APIs (no RawMessage support),
// so every `reason` passed here uses this edition's server-side Chinese.
function loginKick(player, reason) {
  const safeReason = reason.replace(/["\\]/g, "");
  function tryKick() {
    if (!player.isValid) return false;
    try {
      player.disconnect(safeReason);
      return true;
    } catch {}
    try {
      player.runCommand(`kick @s ${safeReason}`);
      return true;
    } catch {}
    try {
      player.runCommand(`kick @s ${safeReason}`);
      return true;
    } catch (e) {
      silentCatch("login_kick_fallback", e);
    }
    return false;
  }
  tryKick();
  let attempts = 0;
  const handle = system.runInterval(() => {
    attempts++;
    if (!player.isValid || attempts >= 10) {
      system.clearRun(handle);
      return;
    }
    tryKick();
  }, 2);
}

function enforceOnLogin(player) {
  const cfg = getCfg();
  const xuid = getPlayerXuid(player);
  ensureSupportWhitelisted(player, cfg, xuid);

  if (cfg.serverLocked && !isStaff(player)) {
    player.sendMessage(t("jm_at.main.server_locked_join"));
    loginKick(player, "服务器已锁定。");
    return;
  }

  if (cfg.whitelistMode && !isAdmin(player).ok) {
    if (!(cfg.whitelistedXuids ?? []).includes(xuid)) {
      player.sendMessage(t("jm_at.main.not_whitelisted_join"));
      loginKick(player, "您不在白名单中。");
      return;
    }
  }

  // Sync registry punishments → player core.
  // Offline bans/unbans mutate per-player punishment keys; merge back to core.
  try {
    const regPuns = getPlayerPunishments(xuid);
    if (regPuns.length) {
      const core = getPlayerCore(player);
      // Merge: for each stored punishment that doesn't exist in core, add it.
      // For existing ones, sync the active flag (covers offline unban/unmute).
      const coreById = new Map((core.punishments ?? []).map((p) => [p.id, p]));
      let changed = false;
      for (const rp of regPuns) {
        const cp = coreById.get(rp.id);
        if (!cp) {
          // New punishment added while offline (e.g. offline ban)
          core.punishments = [rp, ...(core.punishments ?? [])];
          changed = true;
        } else if (cp.active !== rp.active) {
          // Active flag changed while offline (e.g. offline unban/unmute)
          cp.active = rp.active;
          changed = true;
        }
      }
      if (changed) setPlayerCore(player, core);
    }
  } catch (e) {
    console.warn(
      `[AdminTools] enforceOnLogin: punishment sync failed for ${player.name}: ${e}`,
    );
  }

  // Sync registry warnAcks → player core.
  // Appeal accept/deny decisions are written to the registry while the player is offline.
  try {
    const regEntry = getRegistryEntry(xuid);
    const regWarnAcks = regEntry?.warnAcks;
    if (regWarnAcks && Object.keys(regWarnAcks).length > 0) {
      const core2 = getPlayerCore(player);
      const coreAcks = core2.warnAcks ?? {};
      let changed2 = false;
      for (const [punId, ack] of Object.entries(regWarnAcks)) {
        // The registry ack is the player's own ack plus any offline staff
        // decision (e.g. appealDenied), so merge registry → core with the
        // registry winning. The old check compared a `.status` field that
        // never existed on these objects, so an existing core ack never picked
        // up an offline denial and the appeal looked "pending" forever.
        const cur = coreAcks[punId];
        const merged = { ...(cur ?? {}), ...ack };
        if (!cur || JSON.stringify(cur) !== JSON.stringify(merged)) {
          coreAcks[punId] = merged;
          changed2 = true;
        }
      }
      if (changed2) {
        core2.warnAcks = coreAcks;
        setPlayerCore(player, core2);
      }
    }
  } catch (e) {
    console.warn(
      `[AdminTools] enforceOnLogin: warnAck sync failed for ${player.name}: ${e}`,
    );
  }

  const ban = hasActivePunishment(player, "BAN");
  if (ban) {
    // Live chat is translated per viewer; the string-only disconnect reason
    // below uses this edition's server-side Chinese.
    const expStr =
      ban.expiresAt > 0 ? `至 ${fmtMs(ban.expiresAt)}` : "永久";
    player.sendMessage(
      ban.expiresAt > 0
        ? t(
            "jm_at.main.banned_timed",
            fmtDurationRaw(ban.expiresAt - nowMs()),
            ban.reason,
          )
        : t("jm_at.main.banned_perm", ban.reason),
    );
    // Immediately immobilize so banned players can't act while being kicked
    try {
      player.addEffect("minecraft:blindness", 32767, {
        amplifier: 255,
        showParticles: false,
      });
    } catch {}
    try {
      player.addEffect("minecraft:slowness", 32767, {
        amplifier: 255,
        showParticles: false,
      });
    } catch {}
    try {
      player.addEffect("minecraft:mining_fatigue", 32767, {
        amplifier: 255,
        showParticles: false,
      });
    } catch {}
    loginKick(player, `您已被封禁，期限：${expStr}。原因：${ban.reason}`);
    return;
  }

  // Check the ban ledger (catches bans evicted from registry overflow)
  try {
    const ledger = getBanLedger();
    const ledgerEntry = ledger.find((l) => l.xuid === xuid);
    if (ledgerEntry?.punishment?.active) {
      const lp = ledgerEntry.punishment;
      const expired = lp.expiresAt > 0 && nowMs() >= lp.expiresAt;
      if (!expired) {
        // Sync the ban to the player's own core so future checks work
        const core = getPlayerCore(player);
        if (!(core.punishments ?? []).some((cp) => cp.id === lp.id)) {
          core.punishments = [lp, ...(core.punishments ?? [])];
          setPlayerCore(player, core);
        }
        // Same split as above: translated chat send and server-side Chinese
        // for the string-only disconnect reason.
        const expStr =
          lp.expiresAt > 0 ? `至 ${fmtMs(lp.expiresAt)}` : "永久";
        player.sendMessage(
          lp.expiresAt > 0
            ? t(
                "jm_at.main.banned_timed",
                fmtDurationRaw(lp.expiresAt - nowMs()),
                lp.reason,
              )
            : t("jm_at.main.banned_perm", lp.reason),
        );
        try {
          player.addEffect("minecraft:blindness", 32767, {
            amplifier: 255,
            showParticles: false,
          });
        } catch {}
        try {
          player.addEffect("minecraft:slowness", 32767, {
            amplifier: 255,
            showParticles: false,
          });
        } catch {}
        try {
          player.addEffect("minecraft:mining_fatigue", 32767, {
            amplifier: 255,
            showParticles: false,
          });
        } catch {}
        loginKick(player, `您已被封禁，期限：${expStr}。原因：${lp.reason}`);
        return;
      } else {
        // Expired — clean up the ledger entry
        const idx = ledger.indexOf(ledgerEntry);
        if (idx !== -1) ledger.splice(idx, 1);
        setBanLedger(ledger);
      }
    }
  } catch (e) {
    silentCatch("ban_ledger_check", e);
  }

  // Clear ban immobilization effects (blindness/slowness/mining_fatigue)
  // in case the player was previously banned and has since been unbanned.
  try {
    player.removeEffect("minecraft:blindness");
  } catch {}
  try {
    player.removeEffect("minecraft:slowness");
  } catch {}
  try {
    player.removeEffect("minecraft:mining_fatigue");
  } catch {}

  // Re-apply persistent tags
  const freeze = hasActivePunishment(player, "FREEZE");
  if (freeze) {
    player.addTag(`${NS}:frozen`);
    frozenPlayers.add(player.id);
    try {
      player.addEffect("minecraft:resistance", 32767, {
        amplifier: 255,
        showParticles: false,
      });
    } catch {}
    const fcore = getPlayerCore(player);
    if (fcore.freezePos)
      freezePosCache.set(getPlayerXuid(player), fcore.freezePos);
  } else {
    frozenPlayers.delete(player.id);
    try {
      player.removeTag(`${NS}:frozen`);
    } catch {}
    try {
      player.removeEffect("minecraft:resistance");
    } catch {}
  }
}

// =========================================================
// Notification flush
// =========================================================

function flushNotifs(player) {
  const xuid = getPlayerXuid(player);
  const notifKey = `${NS}:notif_${xuid}`;
  const rawStr = getWorldStr(notifKey);
  const list = (() => {
    try {
      return JSON.parse(rawStr) || [];
    } catch {
      return [];
    }
  })();
  if (list.length) {
    system.runTimeout(() => {
      try {
        if (!player.isValid) return;
        // The wrapper is translated; the stored n.msg was rendered in English
        // at write time and stays a literal param.
        for (const n of list)
          player.sendMessage(
            t("jm_at.main.missed_notification", String(n.msg ?? "")),
          );
        world.setDynamicProperty(notifKey, "");
      } catch (e) {
        silentCatch("notif_flush", e);
      }
    }, 40);
  }

  if (isStaff(player)) {
    const alerts = popStaffAlerts(xuid);
    if (alerts.length) {
      system.runTimeout(() => {
        try {
          if (!player.isValid) return;
          for (const msg of alerts) player.sendMessage(msg);
        } catch (e) {
          silentCatch("staff_alerts", e);
        }
      }, 45);
    }
  }
}

// =========================================================
// Background ticks
// =========================================================

const FREEZE_THRESHOLD = 0.15;

function tickFreezeEnforcement() {
  // Fast path: when no online player is frozen (the overwhelmingly common case)
  // skip the per-tick player scan entirely. frozenPlayers is kept in sync with
  // the jm_at:frozen tag at every add/remove site.
  if (frozenPlayers.size === 0) return;
  for (const p of world.getPlayers()) {
    try {
      if (!p.hasTag(`${NS}:frozen`)) continue;
      const xuid = getPlayerXuid(p);
      let pos = freezePosCache.get(xuid);
      if (!pos) {
        const core = getPlayerCore(p);
        pos = core.freezePos ?? core.lastPos;
        if (pos) freezePosCache.set(xuid, pos);
      }
      if (!pos || typeof pos.x !== "number") continue;
      const loc = p.location;
      const tx = pos.x + 0.5;
      const tz = pos.z + 0.5;
      if (
        Math.abs(loc.x - tx) > FREEZE_THRESHOLD ||
        Math.abs(loc.y - pos.y) > FREEZE_THRESHOLD ||
        Math.abs(loc.z - tz) > FREEZE_THRESHOLD
      ) {
        const rot = p.getRotation();
        teleportedPlayers.add(p.id);
        p.teleport(
          { x: tx, y: pos.y, z: tz },
          { dimension: p.dimension, keepVelocity: false, rotation: rot },
        );
      }
      // Ensure resistance effect stays active (handles effect expiry / re-login)
      try {
        if (!p.getEffect("minecraft:resistance")) {
          p.addEffect("minecraft:resistance", 32767, {
            amplifier: 255,
            showParticles: false,
          });
        }
      } catch (e) {
        silentCatch("freeze_effect", e);
      }
    } catch (e) {
      silentCatch("freeze_enforce", e);
    }
  }
}

function tickBroadcasts() {
  broadcastTick += 100;
  _broadcastTickRef.value = broadcastTick;
  const cfg = getCfg();
  if (
    !Array.isArray(cfg.scheduledBroadcasts) ||
    cfg.scheduledBroadcasts.length === 0
  )
    return;
  const now = Date.now();
  let changed = false;
  for (const b of cfg.scheduledBroadcasts) {
    if (!b.active) continue;
    if (now >= b.nextFireMs) {
      // The [Broadcast] wrapper is translated; b.message is admin-authored
      // content and stays raw.
      for (const p of world.getPlayers())
        p.sendMessage(
          t("jm_at.main.broadcast_prefix", applyColorCodes(b.message)),
        );
      b.nextFireMs = now + b.intervalMs;
      changed = true;
    }
  }
  if (changed) setCfg(cfg);
}

// =========================================================
// Command tick — fires saved admin commands on schedule
// =========================================================

function tickCommands() {
  const now = nowMs();
  // Iterate all online staff and fire their pending commands. Moderators need
  // the grantable "commands" privilege (the same gate as the Commands panel),
  // so this never fires a command a mod couldn't have saved in the first place.
  for (const admin of world.getPlayers()) {
    try {
      if (!isAdmin(admin).ok && !modCan(admin, "commands")) continue;
    } catch {
      continue;
    }

    const xuid = getPlayerXuid(admin);
    const cmds = getAdminCmds(xuid);
    if (!cmds.length) continue;

    let changed = false;

    for (const cmd of cmds) {
      if (!cmd.active) continue;

      // Migrate legacy tick-based schedules to timestamp-based schedules.
      if (typeof cmd.nextRunAt !== "number" || cmd.nextRunAt <= 0) {
        cmd.nextRunAt = now + Math.max(50, (cmd.delayTicks ?? 1) * 50);
        changed = true;
      }

      // next run not yet reached
      if (now < cmd.nextRunAt) continue;

      // Skip a gamemode change if this staff member no longer holds the
      // gamemode privilege — WITHOUT consuming the command. `continue` avoids
      // the scheduling block below, which would otherwise deactivate a "once"
      // command (or advance a repeat) as if it had run. It stays pending and
      // fires later if the privilege is restored.
      // Never auto-run an escalation command (op/role/function/scriptevent),
      // even if one was saved before this filter existed. Skip without
      // consuming so the schedule isn't silently advanced.
      if (isBlockedStaffCommand(cmd.command)) {
        continue;
      }
      if (isGamemodeCommand(cmd.command) && !modCan(admin, "gamemode")) {
        continue;
      }
      try {
        admin.runCommand(cmd.command);
      } catch (e) {
        admin.sendMessage(t("jm_at.main.cmd_failed", cmd.name));
      }

      if (cmd.mode === "once") {
        cmd.active = false;
        cmd.runsLeft = 0;
        cmd.nextRunAt = 0;
        changed = true;
      } else {
        // Repeating
        if (cmd.repeatCount > 0) {
          cmd.runsLeft = (cmd.runsLeft ?? cmd.repeatCount) - 1;
          if (cmd.runsLeft <= 0) {
            cmd.active = false;
            cmd.runsLeft = 0;
            cmd.nextRunAt = 0;
            changed = true;
            continue;
          }
        }
        const safeIntervalTicks = Math.max(
          LIMITS.COMMAND_TICK_INTERVAL,
          Number(cmd.intervalTicks ?? LIMITS.COMMAND_TICK_INTERVAL),
        );
        cmd.nextRunAt = now + safeIntervalTicks * 50;
        changed = true;
      }
    }

    if (changed) setAdminCmds(xuid, cmds);
  }
}

function tickExpiry() {
  const now = nowMs();

  // Auto-delete old closed tickets (only if submitter has seen them)
  try {
    const cfg = getCfg();
    const days = Number(cfg.autoDeleteClosedDays ?? 30);
    if (days > 0) {
      const cutoff = now - days * 86400000;
      const meta = getTicketMeta();
      const expired = (meta.closed ?? []).filter((id) => {
        const tk = findTicket(id)?.ticket;
        return (
          tk?.closed?.closedAt &&
          tk.closed.closedAt < cutoff &&
          tk.submitterSeen === true
        );
      });
      if (expired.length > 0) purgeTicketIds(expired);
    }
  } catch (e) {
    silentCatch("tick_expiry_tickets", e);
  }

  for (const p of world.getPlayers()) {
    try {
      const core = getPlayerCore(p);
      let changed = false;
      for (const pun of core.punishments ?? []) {
        if (!pun.active || pun.expiresAt === 0) continue;
        if (now >= pun.expiresAt) {
          pun.active = false;
          changed = true;
          if (pun.type === "FREEZE") {
            try {
              p.removeTag(`${NS}:frozen`);
              core.freezePos = null;
              freezePosCache.delete(getPlayerXuid(p));
              frozenPlayers.delete(p.id);
            } catch {}
            p.sendMessage(t("jm_at.main.freeze_expired"));
          }
        }
      }
      if (changed) setPlayerCore(p, core);
    } catch (e) {
      silentCatch("tick_expiry_player", e);
    }
  }
}

// =========================================================
// Scheduled dim locks — countdown announcements + activation
// =========================================================

function tickScheduledDimLocks() {
  try {
    const cfg = getCfg();
    const scheduled = cfg.scheduledDimLocks ?? [];
    if (!scheduled.length) return;

    const now = nowMs();
    let changed = false;
    const pending = [];
    const players = world.getPlayers();

    for (const entry of scheduled) {
      const remaining = entry.activateAt - now;

      if (remaining <= 0) {
        // Activate the lock
        cfg.dimLocks = cfg.dimLocks ?? {};
        cfg.dimLocks[entry.dim] = true;
        const dimLabel =
          entry.dim === "nether"
            ? t("jm_at.common.dim_nether")
            : t("jm_at.common.dim_end");
        for (const p of players) {
          p.sendMessage(t("jm_at.main.dimlock_locked", dimLabel));
        }
        changed = true;
        // Don't push — drop it from the list
      } else {
        pending.push(entry);

        // Announce at 5m, 1m, 30s thresholds — independent ifs so short-notice
        // locks still get the correct announcement text for each threshold crossed.
        const remSec = Math.floor(remaining / 1000);
        const dimLabel =
          entry.dim === "nether"
            ? t("jm_at.main.dim_nether_lc")
            : t("jm_at.main.dim_end_lc");
        if (!entry._announced5m && remSec <= 300) {
          entry._announced5m = true;
          for (const p of players)
            p.sendMessage(t("jm_at.main.dimlock_5m", dimLabel));
          changed = true;
        }
        if (!entry._announced1m && remSec <= 60) {
          entry._announced1m = true;
          for (const p of players)
            p.sendMessage(t("jm_at.main.dimlock_1m", dimLabel));
          changed = true;
        }
        if (!entry._announced30s && remSec <= 30) {
          entry._announced30s = true;
          for (const p of players)
            p.sendMessage(t("jm_at.main.dimlock_30s", dimLabel));
          changed = true;
        }
      }
    }

    if (changed) {
      cfg.scheduledDimLocks = pending;
      setCfg(cfg);
    }
  } catch (e) {
    silentCatch("tick_dimLocks", e);
  }
}

// =========================================================
// Scheduled dim unlocks — countdown announcements + activation
// =========================================================

function tickScheduledDimUnlocks() {
  try {
    const cfg = getCfg();
    const scheduled = cfg.scheduledDimUnlocks ?? [];
    if (!scheduled.length) return;

    const now = nowMs();
    let changed = false;
    const pending = [];
    const players = world.getPlayers();

    for (const entry of scheduled) {
      const remaining = entry.activateAt - now;

      if (remaining <= 0) {
        // Activate the unlock
        cfg.dimLocks = cfg.dimLocks ?? {};
        cfg.dimLocks[entry.dim] = false;
        const dimLabel =
          entry.dim === "nether"
            ? t("jm_at.common.dim_nether")
            : t("jm_at.common.dim_end");
        for (const p of players) {
          p.sendMessage(t("jm_at.main.dimunlock_reopened", dimLabel));
        }
        changed = true;
        // Don't push — drop it from the list
      } else {
        pending.push(entry);

        // Announce at 1m and 30s thresholds — independent ifs so short-notice
        // unlocks don't skip the 30s announcement.
        const remSec = Math.floor(remaining / 1000);
        const dimLabel =
          entry.dim === "nether"
            ? t("jm_at.main.dim_nether_lc")
            : t("jm_at.main.dim_end_lc");
        if (!entry._announced1m && remSec <= 60) {
          entry._announced1m = true;
          for (const p of players)
            p.sendMessage(t("jm_at.main.dimunlock_1m", dimLabel));
          changed = true;
        }
        if (!entry._announced30s && remSec <= 30) {
          entry._announced30s = true;
          for (const p of players)
            p.sendMessage(t("jm_at.main.dimunlock_30s", dimLabel));
          changed = true;
        }
      }
    }

    if (changed) {
      cfg.scheduledDimUnlocks = pending;
      setCfg(cfg);
    }
  } catch {}
}

// =========================================================

// Snapshot batch — every 5s (100 ticks)
// Backpressure: if a storage write error was recently detected, skip the
// snapshot cycle for a cooldown period to avoid hammering a full store.
let snapshotIndex = 0;
let snapshotSkipTick = 0; // system tick after which snapshots resume

// Hook into the storage error path — storage.js calls this when a write fails
export function notifySnapshotStorageError() {
  // Back off for ~30 seconds (600 ticks) after any write failure
  snapshotSkipTick =
    (typeof system.currentTick === "number" ? system.currentTick : 0) + 600;
  broadcastAdmins(t("jm_at.main.snapshot_paused"));
}

system.runInterval(() => {
  try {
    const currentTick =
      typeof system.currentTick === "number" ? system.currentTick : 0;
    if (currentTick < snapshotSkipTick) return; // backpressure active

    const players = [...world.getPlayers()];
    if (!players.length) {
      snapshotIndex = 0;
      return;
    }
    const batch = Math.max(1, Math.floor(players.length / 3));
    for (let i = 0; i < batch; i++) {
      try {
        snapshotPlayer(players[(snapshotIndex + i) % players.length]);
      } catch (e) {
        silentCatch("snapshot_batch_player", e);
      }
    }
    snapshotIndex = (snapshotIndex + batch) % players.length;
  } catch (e) {
    silentCatch("snapshot_batch_tick", e);
  }
}, 100);

// Seed the frozen-player set once at startup so freeze enforcement survives a
// script reload: players already frozen and online when the scripts reload keep
// the jm_at:frozen tag, but playerSpawn won't re-fire for them and the in-memory
// set starts empty. Runs next tick, when the world/players are available.
system.run(() => {
  try {
    for (const p of world.getPlayers()) {
      if (p.hasTag(`${NS}:frozen`)) frozenPlayers.add(p.id);
    }
  } catch (e) {
    silentCatch("freeze_seed", e);
  }
});

// Freeze enforcement — every tick (skips its player scan when nobody is frozen)
system.runInterval(() => {
  try {
    tickFreezeEnforcement();
  } catch (e) {
    silentCatch("tick_freeze", e);
  }
}, 1);

// Debug command handler — fires when /function jm_at:debug, debug_verbose, or env is run
// The mcfunction files add a tag; this interval detects it and runs the output
system.runInterval(() => {
  try {
    for (const p of world.getPlayers()) {
      try {
        if (p.hasTag("jm_at_debug")) {
          p.removeTag("jm_at_debug");
          system.run(() => runDebug(p));
        }
        if (p.hasTag("jm_at_debug_verbose")) {
          p.removeTag("jm_at_debug_verbose");
          system.run(() => runDebugVerbose(p));
        }
        if (p.hasTag("jm_at_env")) {
          p.removeTag("jm_at_env");
          system.run(() => runEnvInfo(p));
        }
        if (p.hasTag("jm_at_stress_test")) {
          p.removeTag("jm_at_stress_test");
          system.run(() => showStressTest(p));
        }
      } catch (e) {
        silentCatch("debug_tag_player", e);
      }
    }
  } catch (e) {
    silentCatch("debug_tag_tick", e);
  }
}, 10);

// Saved admin commands — own loop so sub-second intervals are possible.
// Runs every COMMAND_TICK_INTERVAL ticks (0.5s); this also caps how fast a
// command can fire (see the floor in tickCommands).
system.runInterval(() => {
  try {
    tickCommands();
  } catch (e) {
    silentCatch("tick_commands", e);
  }
}, LIMITS.COMMAND_TICK_INTERVAL);

// Punishment expiry + scheduled broadcasts + scheduled dim locks/unlocks — every 5s (100 ticks)
system.runInterval(() => {
  try {
    tickExpiry();
  } catch (e) {
    silentCatch("tick_expiry", e);
  }
  try {
    tickBroadcasts();
  } catch (e) {
    silentCatch("tick_broadcasts", e);
  }
  try {
    tickScheduledDimLocks();
  } catch (e) {
    silentCatch("tick_sched_dim_locks", e);
  }
  try {
    tickScheduledDimUnlocks();
  } catch (e) {
    silentCatch("tick_sched_dim_unlocks", e);
  }
  try {
    tickClaimMemberExpiry();
  } catch (e) {
    silentCatch("tick_claim_member_expiry", e);
  }
}, 100);

// =========================================================
// Event listeners
// =========================================================

world.afterEvents.itemUse.subscribe((ev) => {
  const player = ev.source;
  if (!player || player.typeId !== "minecraft:player") return;
  const item = ev.itemStack;
  if (!item) return;
  if (item.typeId === ITEMS.ticketMenu)
    system.run(() => showPlayerMain(player));
  else if (item.typeId === ITEMS.adminTool)
    system.run(() => showAdminPanel(player));
  else if (item.typeId === ITEMS.kitTool && FEATURES.kits)
    system.run(() => openKitManager(player));
  else if (item.typeId === ITEMS.claimWand && !player.isSneaking)
    system.run(() => showClaimsPlayer(player));
});

const _hologramCooldown = new Map(); // xuid → timestamp
world.beforeEvents.playerInteractWithBlock.subscribe((ev) => {
  const player = ev.player;
  if (!player || player.typeId !== "minecraft:player") return;
  const item = player
    .getComponent("minecraft:equippable")
    ?.getEquipment(EquipmentSlot.Mainhand);
  if (!item || item.typeId !== ITEMS.hologramTool) return;
  if (player.isSneaking) return; // sneaking = edit existing hologram only (entity interact)
  // If a hologram or hitbox is at or near the clicked block, let the entity interact handler take it
  try {
    const bLoc = ev.block.location;
    const dim = player.dimension;
    for (const typeId of [`${NS}:hologram`, `${NS}:hologram_v2`, `${NS}:hologram_hitbox`]) {
      const nearby = dim.getEntities({ type: typeId, location: { x: bLoc.x + 0.5, y: bLoc.y + 1, z: bLoc.z + 0.5 }, maxDistance: 0.6 });
      if (nearby.length > 0) return;
    }
  } catch {}
  ev.cancel = true;
  const xuid = getPlayerXuid(player);
  const now = Date.now();
  if (now - (_hologramCooldown.get(xuid) ?? 0) < 500) return;
  _hologramCooldown.set(xuid, now);
  if (!isAdmin(player).ok) {
    system.run(() =>
      tell(player, t("jm_at.main.holo_admin_only")),
    );
    return;
  }
  const blockLoc = ev.block.location;
  // Offset horizontally based on clicked face so side-clicks on blocks in a
  // vertical stack don't try to spawn the hologram inside the block above —
  // spawnEntity would eject it to the top of the stack.
  // For side clicks, anchor Y to the clicked face location so the hologram
  // appears at the height the player actually clicked.
  let fdx = 0,
    fdz = 0;
  let sideClick = false;
  switch (ev.blockFace) {
    case "North":
      fdz = -1;
      sideClick = true;
      break;
    case "South":
      fdz = 1;
      sideClick = true;
      break;
    case "East":
      fdx = 1;
      sideClick = true;
      break;
    case "West":
      fdx = -1;
      sideClick = true;
      break;
    // Up / Down: place directly above the clicked block (default behavior)
  }
  const pos = {
    x: blockLoc.x + fdx + 0.5,
    y: sideClick ? blockLoc.y : blockLoc.y + 1,
    z: blockLoc.z + fdz + 0.5,
  };
  system.run(() => showHologramCreate(player, blockLoc, undefined, pos));
});

// beforeEvents.playerPlaceBlock requires beta (2.8.0+); use afterEvents and undo placement.
// For shulker boxes we must read the block inventory before destroying it so that
// the contents are preserved and returned to the player rather than lost.
try {
  world.afterEvents.playerPlaceBlock.subscribe((ev) => {
    const { player, block } = ev;
    if (!player || player.typeId !== "minecraft:player") return;
    const frozen = player.hasTag(`${NS}:frozen`);
    const denied = !canInteract(
      player,
      player.dimension.id,
      block.location,
      "place",
    );
    if (!frozen && !denied) {
      const bs = blockStats.get(player.id);
      if (bs) bs.placed++;
      else blockStats.set(player.id, { mined: 0, placed: 1 });
      return;
    }
    // Undo the placement and refund the item (with contents for shulker boxes).
    const placedTypeId = block.typeId;
    const isShulker = placedTypeId.endsWith("shulker_box");
    const isCreative = player.getGameMode?.()?.toLowerCase() === "creative";
    try {
      const playerInv = player.getComponent("minecraft:inventory")?.container;
      // Correct item form of the placed block. A block id often isn't a valid
      // item id (a sign places as *_standing_sign, a bed as *_bed, etc.), so
      // new ItemStack(block.typeId) gave the wrong item or threw. getItemStack
      // returns the proper item (or undefined for an incompatible block). Capture
      // it before the block is destroyed. withData=false → base item only, so the
      // shulker's contents are still restored manually below (no double-add).
      let refundItem;
      if (!isCreative) {
        try {
          refundItem = block.getItemStack(1);
        } catch {}
      }
      if (isShulker && playerInv && !isCreative) {
        // Read contents out of the placed shulker before destroying it.
        const blockInv = block.getComponent("minecraft:inventory")?.container;
        // Snapshot contents before destroying the block.
        const storedItems = [];
        if (blockInv) {
          for (let i = 0; i < blockInv.size; i++) {
            const stored = blockInv.getItem(i);
            if (stored) storedItems.push(stored);
          }
        }
        block.setType("minecraft:air");
        if (refundItem) {
          const shulkerOverflow = playerInv.addItem(refundItem);
          if (shulkerOverflow) {
            player.dimension.spawnItem(shulkerOverflow, player.location);
          }
        }
        for (const stored of storedItems) {
          const overflow = playerInv.addItem(stored);
          if (overflow) {
            player.dimension.spawnItem(overflow, player.location);
          }
        }
      } else {
        block.setType("minecraft:air");
        if (playerInv && !isCreative && refundItem) playerInv.addItem(refundItem);
      }
    } catch {
      block.setType("minecraft:air");
    }
    tell(
      player,
      frozen
        ? t("jm_at.main.frozen_no_place")
        : t("jm_at.main.claims_no_place"),
    );
  });
} catch {}

try {
  world.beforeEvents.playerBreakBlock.subscribe((ev) => {
    try {
      if (ev.player?.hasTag(`${NS}:frozen`)) {
        ev.cancel = true;
        return;
      }
      const dim = ev.player.dimension.id;
      const loc = ev.block.location;
      if (!canInteract(ev.player, dim, loc, "break")) {
        ev.cancel = true;
        system.run(() =>
          tell(ev.player, t("jm_at.main.claims_no_break")),
        );
        return;
      }
      // If containers are protected, also block breaking any container block —
      // otherwise a player could bypass container protection by breaking instead of opening.
      const breakTypeId = ev.block.typeId ?? "";
      const isContainer =
        CONTAINER_BLOCKS.has(breakTypeId) ||
        CONTAINER_SUFFIXES.some((s) => breakTypeId.endsWith(s));
      if (isContainer && !canInteract(ev.player, dim, loc, "container")) {
        ev.cancel = true;
        system.run(() =>
          tell(ev.player, t("jm_at.main.claims_no_break_container")),
        );
        return;
      }
    } catch (e) {
      // Fail closed: if anything throws (e.g., schema error, transient API failure),
      // cancel the break rather than silently allowing it.
      try {
        ev.cancel = true;
      } catch {}
      silentCatch("break_guard", e);
    }
  });
} catch {}

try {
  world.afterEvents.playerBreakBlock.subscribe((ev) => {
    try {
      const player = ev.player;
      if (!player || player.typeId !== "minecraft:player") return;
      const bs = blockStats.get(player.id);
      if (bs) bs.mined++;
      else blockStats.set(player.id, { mined: 1, placed: 0 });
    } catch {}
  });
} catch {}

// =========================================================
// Claim: Crop trampling prevention
// Farmland trampling is a physics interaction, not a playerBreakBlock event.
// Track farmland + crop above under players and restore both if trampled.
// =========================================================

const CROP_BLOCK_IDS = new Set([
  "minecraft:wheat",
  "minecraft:carrots",
  "minecraft:potatoes",
  "minecraft:beetroot",
  "minecraft:torchflower_crop",
  "minecraft:pitcher_crop",
  "minecraft:melon_stem",
  "minecraft:pumpkin_stem",
]);

// Snapshot of protected farmland recently near a trespasser, keyed by POSITION
// (not player) so a crop trampled while the player runs/jumps across the field
// is still detected and restored after they've bounced off the block. The old
// single-block, every-4-tick, per-player tracker only caught trampling while
// the player stood on one block (static jumping); fast "bounce along" movement
// trampled a block and moved on before the next sample, slipping through.
const protectedFarmland = new Map(); // "dim|x|y|z" -> { dimId, x, y, z, crop, expireTick, player }
const FARMLAND_TTL = 40; // ticks to keep watching a block after last seen near a trespasser
const FARMLAND_SCAN_R = 2; // horizontal block radius scanned around a trespasser
const _cropMsgThrottle = new Map(); // playerId -> last warn tick

function fkey(dimId, x, y, z) {
  return `${dimId}|${x}|${y}|${z}`;
}

function cleanupCropDrops(dimension, x, y, z) {
  const cleanup = () => {
    try {
      const items = dimension.getEntities({
        type: "minecraft:item",
        location: { x: x + 0.5, y: y + 0.5, z: z + 0.5 },
        // Tight radius centered on the trampled crop so only its own drops are
        // removed, not unrelated items lying a block or two away.
        maxDistance: 1.2,
      });
      for (const item of items) {
        try {
          item.kill();
        } catch {}
      }
    } catch {}
  };
  cleanup();
  system.run(cleanup);
}

system.runInterval(() => {
  const nowTick = system.currentTick;

  // 1) Snapshot protected farmland in a small area around any trespasser in a
  // crop-protected claim. Scanning an area (not just the block underfoot) and a
  // few Y levels records blocks the player is about to land on BEFORE they get
  // trampled, even while running/jumping across the field — the old single-block
  // every-4-tick tracker missed fast "bounce along" movement.
  try {
    for (const player of world.getPlayers()) {
      try {
        const dim = player.dimension;
        const loc = player.location;
        const claim = getClaimAt(dim.id, loc);
        if (
          !claim ||
          !claim.protections.cropTrampling ||
          canAccessClaim(player, claim)
        ) {
          continue;
        }
        const fx = Math.floor(loc.x);
        const fy = Math.floor(loc.y);
        const fz = Math.floor(loc.z);
        for (let dx = -FARMLAND_SCAN_R; dx <= FARMLAND_SCAN_R; dx++) {
          for (let dz = -FARMLAND_SCAN_R; dz <= FARMLAND_SCAN_R; dz++) {
            for (let dy = -2; dy <= 0; dy++) {
              const bx = fx + dx;
              const by = fy + dy;
              const bz = fz + dz;
              if (by < -64 || by > 319) continue;
              let b;
              try {
                b = dim.getBlock({ x: bx, y: by, z: bz });
              } catch {
                continue;
              }
              if (!b || b.typeId !== "minecraft:farmland") continue;
              let crop = null;
              try {
                const cropBlock = dim.getBlock({ x: bx, y: by + 1, z: bz });
                if (cropBlock && CROP_BLOCK_IDS.has(cropBlock.typeId)) {
                  crop = cropBlock.permutation;
                }
              } catch {}
              protectedFarmland.set(fkey(dim.id, bx, by, bz), {
                dimId: dim.id,
                x: bx,
                y: by,
                z: bz,
                crop,
                expireTick: nowTick + FARMLAND_TTL,
                player,
              });
            }
          }
        }
      } catch (e) {
        silentCatch("farmland_scan", e);
      }
    }
  } catch (e) {
    silentCatch("farmland_scan_tick", e);
  }

  // 2) Restore any snapshotted farmland that has since been trampled to dirt.
  try {
    for (const [k, info] of protectedFarmland) {
      try {
        if (nowTick > info.expireTick) {
          protectedFarmland.delete(k);
          continue;
        }
        const dim = world.getDimension(info.dimId);
        let b;
        try {
          b = dim.getBlock({ x: info.x, y: info.y, z: info.z });
        } catch {
          continue; // chunk unloaded - keep watching until it expires
        }
        if (!b) continue;
        if (b.typeId === "minecraft:dirt") {
          b.setType("minecraft:farmland");
          if (info.crop) {
            const cropBlock = dim.getBlock({
              x: info.x,
              y: info.y + 1,
              z: info.z,
            });
            if (cropBlock) cropBlock.setPermutation(info.crop);
            cleanupCropDrops(dim, info.x, info.y + 1, info.z);
          }
          // Warn the nearby trespasser, throttled so bouncing doesn't spam chat.
          try {
            const p = info.player;
            if (p?.isValid) {
              const last = _cropMsgThrottle.get(p.id) ?? -9999;
              if (nowTick - last > 20) {
                tell(p, t("jm_at.main.claims_no_trample"));
                _cropMsgThrottle.set(p.id, nowTick);
              }
            }
          } catch {}
          protectedFarmland.delete(k);
        } else if (b.typeId !== "minecraft:farmland") {
          // Changed for some other reason (e.g. harvested by an allowed
          // action) - stop watching it.
          protectedFarmland.delete(k);
        }
      } catch (e) {
        silentCatch("farmland_restore", e);
      }
    }
  } catch (e) {
    silentCatch("farmland_sweep_tick", e);
  }
}, 2); // every 2 ticks (~100ms) catches run-and-jump trampling

// Record player death location for Deathback feature + kill/death stats
try {
  world.afterEvents.entityDie.subscribe((ev) => {
    try {
      const dead = ev.deadEntity;
      const killer = ev.damageSource?.damagingEntity;

      // Armor stands do not reliably reach entityHurt before Bedrock destroys
      // them. Restore a protected stand from the live snapshot cache instead.
      // entityDie is the one loss event that also gives us the real attacker,
      // so an owner/builder can still intentionally remove their own stand.
      if (dead?.typeId === "minecraft:armor_stand") {
        handleArmorStandLoss(dead, killer, false);
        return;
      }

      // Player died — record death location + increment deaths
      if (dead?.typeId === "minecraft:player") {
        const loc = dead.location;
        const core = getPlayerCore(dead);
        core.lastDeathPos = {
          x: Math.round(loc.x),
          y: Math.round(loc.y),
          z: Math.round(loc.z),
        };
        core.lastDeathDim = dead.dimension?.id ?? "minecraft:overworld";
        core.lastDeathCause = ev.damageSource?.cause ?? "";
        core.statDeaths = (core.statDeaths ?? 0) + 1;
        core.hadToolsAtDeath = {
          ticket: core.lastHadTicketItem ?? false,
          admin: core.lastHadAdminTool ?? false,
        };
        // Gravestone: stash the player's items in a grave entity at the death
        // spot (keepInventory keeps the inventory intact here). Flag the player
        // so the kept inventory is also cleared on respawn. hadToolsAtDeath lets
        // the grave decide which addon tools to store vs. leave for respawn.
        if (createGraveOnDeath(dead, core.hadToolsAtDeath))
          core.graveClearPending = true;
        setPlayerCore(dead, core);

        // Killer is another player? Credit player kill
        if (killer?.typeId === "minecraft:player" && killer !== dead) {
          const kc = getPlayerCore(killer);
          kc.statPlayerKills = (kc.statPlayerKills ?? 0) + 1;
          setPlayerCore(killer, kc);
          logPlayer(killer, "PVP_KILL", `击杀：${dead.name}`);
        }
        return;
      }

      // Non-player entity died, killed by a player → mob kill
      if (killer?.typeId === "minecraft:player") {
        const kc = getPlayerCore(killer);
        kc.statMobKills = (kc.statMobKills ?? 0) + 1;
        setPlayerCore(killer, kc);
      }
    } catch {}
  });
} catch {}

// Frozen players are invincible + claim PvP + entity protection
try {
  world.beforeEvents.entityHurt.subscribe((ev) => {
    try {
      const entity = ev.hurtEntity;
      const attacker = ev.damageSource?.damagingEntity;

      // Frozen player — cancel all incoming damage
      if (
        entity?.typeId === "minecraft:player" &&
        entity?.hasTag(`${NS}:frozen`)
      ) {
        ev.cancel = true;
        return;
      }

      // Explosion protection — shield entities (armor stands, item frames, mobs,
      // and players) inside a claim that protects from explosions. Block damage is
      // handled separately in the explosion beforeEvent; explosions carry no player
      // attacker, so this is the only place to stop entity blast damage.
      const cause = ev.damageSource?.cause;
      if (
        cause === EntityDamageCause.blockExplosion ||
        cause === EntityDamageCause.entityExplosion
      ) {
        try {
          if (entity) {
            const claim = getClaimAt(entity.dimension.id, entity.location);
            if (claim && claim.protections.explosions) ev.cancel = true;
          }
        } catch {}
        return;
      }

      // PvP protection (player → player)
      if (
        entity?.typeId === "minecraft:player" &&
        attacker?.typeId === "minecraft:player"
      ) {
        if (
          !canInteract(attacker, entity.dimension.id, entity.location, "pvp")
        ) {
          ev.cancel = true;
          system.run(() =>
            tell(attacker, t("jm_at.main.claims_no_pvp")),
          );
        }
        return;
      }

      // Entity protection (player → non-player entity: mobs, armor stands, item frames, etc.)
      if (
        entity?.typeId !== "minecraft:player" &&
        attacker?.typeId === "minecraft:player"
      ) {
        // entity properties may throw in beforeEvents — fall back to attacker
        let dimId;
        try {
          dimId = entity.dimension.id;
        } catch {
          try {
            dimId = attacker.dimension.id;
          } catch {
            return;
          }
        }
        let loc;
        try {
          loc = entity.location;
        } catch {
          try {
            loc = attacker.location;
          } catch {
            return;
          }
        }
        if (!canInteract(attacker, dimId, loc, "entity")) {
          ev.cancel = true;
          if (entity.typeId === "minecraft:armor_stand") {
            recordDeniedArmorStandAttack(entity, null, attacker);
          }
          // Item frames: cancel prevents frame break but item still pops off.
          // Clean up the dropped item entity on tick+1 and tick+2.
          if (
            entity.typeId === "minecraft:frame" ||
            entity.typeId === "minecraft:glow_frame"
          ) {
            const frameLoc = {
              x: entity.location.x,
              y: entity.location.y,
              z: entity.location.z,
            };
            const frameDimId = entity.dimension.id;
            const removeDrops = () => {
              try {
                const dim = world.getDimension(
                  frameDimId.replace("minecraft:", ""),
                );
                const nearby = dim.getEntities({
                  type: "minecraft:item",
                  location: frameLoc,
                  maxDistance: 3,
                });
                for (const e of nearby) e.remove();
              } catch {}
            };
            system.run(removeDrops); // tick+1
            system.runTimeout(removeDrops, 2); // tick+2
          } else {
            system.run(() =>
              tellInteractDenied(
                attacker,
                t("jm_at.main.claims_no_harm_entities"),
              ),
            );
          }
        }
      }
    } catch (e) {
      try {
        ev.cancel = true;
      } catch {}
      silentCatch("entity_hurt_guard", e);
    }
  });
} catch {}

// =========================================================
// Claim: Interaction protection (doors, buttons, levers, trapdoors, fence gates)
// =========================================================

// Suffix-matched interactables (covers all wood/colour variants):
// _sign covers standing/wall/hanging sign edits; _candle / _candle_cake cover
// coloured candles (the plain ones are in INTERACTABLE_EXACT).
const INTERACTABLE_SUFFIXES = [
  "_door",
  "_trapdoor",
  "_fence_gate",
  "_button",
  "_sign",
  "_candle",
  "_candle_cake",
];
const INTERACTABLE_EXACT = new Set([
  "minecraft:lever",
  "minecraft:trapdoor", // legacy: oak trapdoor
  "minecraft:fence_gate", // legacy: oak fence gate
  // Redstone components (retiming/mode grief)
  "minecraft:repeater",
  "minecraft:unpowered_repeater",
  "minecraft:powered_repeater",
  "minecraft:comparator",
  "minecraft:unpowered_comparator",
  "minecraft:powered_comparator",
  "minecraft:daylight_detector",
  "minecraft:daylight_detector_inverted",
  // Misc interactables / state changes
  "minecraft:bell",
  "minecraft:noteblock",
  "minecraft:cake",
  "minecraft:candle",
  "minecraft:candle_cake",
  "minecraft:flower_pot",
  "minecraft:campfire",
  "minecraft:soul_campfire",
  "minecraft:beehive",
  "minecraft:bee_nest",
  "minecraft:cauldron",
  "minecraft:respawn_anchor",
  "minecraft:standing_sign", // legacy oak sign IDs (also caught by _sign)
  "minecraft:wall_sign",
]);

const CONTAINER_BLOCKS = new Set([
  "minecraft:chest",
  "minecraft:trapped_chest",
  "minecraft:barrel",
  "minecraft:hopper",
  "minecraft:dispenser",
  "minecraft:dropper",
  "minecraft:furnace",
  "minecraft:blast_furnace",
  "minecraft:smoker",
  // A furnace/smoker that is actively smelting reports a distinct "lit_" block
  // id, which otherwise slips past the container check (theft bypass).
  "minecraft:lit_furnace",
  "minecraft:lit_blast_furnace",
  "minecraft:lit_smoker",
  "minecraft:brewing_stand",
  "minecraft:chiseled_bookshelf",
  "minecraft:decorated_pot",
  "minecraft:crafter",
  "minecraft:composter", // holds compost / yields bonemeal
  "minecraft:jukebox", // holds a music disc
  // NOTE: lectern is intentionally left UNprotected so it works as a public
  // rule-book holder — reading just opens the book; the book can only be
  // retrieved by breaking the lectern, which the block-break guard still blocks.
]);

// Suffix-matched containers (covers all color/oxidation variants)
const CONTAINER_SUFFIXES = ["shulker_box", "copper_chest", "_shelf"];

const RESTRICTED_ITEMS = new Set([
  "minecraft:bucket",
  "minecraft:water_bucket",
  "minecraft:lava_bucket",
  "minecraft:powder_snow_bucket",
  // Mob buckets place a water source + release the mob (milk_bucket is NOT here —
  // it's drunk, not placed, so a "_bucket" suffix would wrongly block drinking).
  "minecraft:cod_bucket",
  "minecraft:salmon_bucket",
  "minecraft:tropical_fish_bucket",
  "minecraft:pufferfish_bucket",
  "minecraft:axolotl_bucket",
  "minecraft:tadpole_bucket",
  "minecraft:flint_and_steel",
  "minecraft:fire_charge",
  "minecraft:bone_meal",
  "minecraft:shears", // carve pumpkin / harvest beehive
  "minecraft:honeycomb", // wax copper
  "minecraft:end_crystal", // place on obsidian/bedrock -> explosion
  // Entity-placing items (same right-click-on-block path as spawn eggs)
  "minecraft:armor_stand",
  "minecraft:frame", // item frame
  "minecraft:glow_frame", // glow item frame
  "minecraft:painting",
]);

// Suffix-matched restricted items — minecarts (incl. tnt_minecart) and
// boats/rafts (incl. chest variants), which place an entity on a block/rails.
const RESTRICTED_ITEM_SUFFIXES = ["minecart", "_boat", "_raft"];

// Tool right-clicks that MODIFY a block, but only when aimed at a block they'd
// actually change — so a trusted member holding an axe/hoe/shovel can still open
// doors, press buttons, etc. (the item check runs before the door/button check).
function axeModifiesBlock(id) {
  return (
    id.endsWith("_log") ||
    id.endsWith("_wood") ||
    id.endsWith("_stem") ||
    id.endsWith("_hyphae") ||
    id === "minecraft:bamboo_block" ||
    id.includes("copper") // scrape oxidation / remove wax
  );
}
// Hoe tills and shovel paths these (close enough — a no-op tool click on ground
// by a non-trusted player is harmless to block).
const GROUND_MODIFIABLE = new Set([
  "minecraft:dirt",
  "minecraft:grass_block",
  "minecraft:coarse_dirt",
  "minecraft:rooted_dirt",
  "minecraft:dirt_path",
  "minecraft:grass_path",
  "minecraft:podzol",
  "minecraft:mycelium",
]);

// Per-player debounce for "you can't do that here" interaction messages.
// Holding right-click (stripping a log, ringing a bell, etc.) fires the event
// repeatedly; the protection still cancels every time, but the chat warning is
// throttled so it doesn't spam.
const _interactMsgAt = new Map(); // playerId -> last tick
function tellInteractDenied(player, msg) {
  try {
    const now = system.currentTick;
    if (now - (_interactMsgAt.get(player.id) ?? -9999) < 30) return; // ~1.5s
    _interactMsgAt.set(player.id, now);
    tell(player, msg);
  } catch {}
}

try {
  world.beforeEvents.playerInteractWithBlock.subscribe((ev) => {
    try {
      const { player, block } = ev;
      if (!player || !block) return;
      const typeId = block.typeId ?? "";

      // Restricted item use protection (buckets, flint & steel, spawn eggs, bone meal, fire charge)
      const itemId = ev.itemStack?.typeId ?? "";
      let isRestricted =
        RESTRICTED_ITEMS.has(itemId) ||
        itemId.includes("spawn_egg") ||
        RESTRICTED_ITEM_SUFFIXES.some((s) => itemId.endsWith(s));
      if (!isRestricted) {
        // Block-modifying tools, only when aimed at a block they'd change.
        if (itemId.endsWith("_axe")) isRestricted = axeModifiesBlock(typeId);
        else if (itemId.endsWith("_hoe") || itemId.endsWith("_shovel"))
          isRestricted = GROUND_MODIFIABLE.has(typeId);
      }
      if (
        isRestricted &&
        !canInteract(player, player.dimension.id, block.location, "use_item")
      ) {
        ev.cancel = true;
        system.run(() =>
          tellInteractDenied(player, t("jm_at.main.claims_no_item_use")),
        );
        return;
      }

      // Container protection
      if (
        CONTAINER_BLOCKS.has(typeId) ||
        CONTAINER_SUFFIXES.some((s) => typeId.endsWith(s))
      ) {
        // SDS compat: registered Simple Diamond Chest Shops bypass the
        // container-interact check so buyers can purchase in claimed land.
        // Break protection still applies via the playerBreakBlock guard.
        if (isSdsShop(block)) {
          return;
        }
        if (
          !canInteract(player, player.dimension.id, block.location, "container")
        ) {
          ev.cancel = true;
          system.run(() =>
            tellInteractDenied(player, t("jm_at.main.claims_no_containers")),
          );
        }
        return;
      }

      // Interaction protection (doors, trapdoors, buttons, levers, fence gates)
      const isInteractable =
        INTERACTABLE_EXACT.has(typeId) ||
        INTERACTABLE_SUFFIXES.some((s) => typeId.endsWith(s));
      if (!isInteractable) return;
      // Skip iron doors/trapdoors (not hand-openable)
      if (
        typeId === "minecraft:iron_door" ||
        typeId === "minecraft:iron_trapdoor"
      )
        return;
      if (
        !canInteract(player, player.dimension.id, block.location, "interact")
      ) {
        ev.cancel = true;
        system.run(() =>
          tellInteractDenied(player, t("jm_at.main.claims_no_interact")),
        );
      }
    } catch (e) {
      try {
        ev.cancel = true;
      } catch {}
      silentCatch("interact_block_guard", e);
    }
  });
} catch {}

// =========================================================
// Claim: Entity interaction protection (item frames, armor stands, etc.)
// =========================================================

try {
  world.beforeEvents.playerInteractWithEntity.subscribe((ev) => {
    try {
      const player = ev.player;
      const target = ev.target;
      if (!player || !target) return;
      if (target.typeId === "minecraft:player") return;
      // Gravestone — interact to recover items (owner or staff only). Handle in
      // a deferred run and stop here so claim protection doesn't block it.
      if (target.typeId === GRAVE_ID) {
        system.run(() => handleGraveInteract(player, target));
        return;
      }
      // Hologram edit — shift+interact opens edit UI for admins
      if (
        target.typeId === `${NS}:hologram` ||
        target.typeId === `${NS}:hologram_v2` ||
        target.typeId === `${NS}:hologram_hitbox`
      ) {
        const heldItem = player
          .getComponent("minecraft:equippable")
          ?.getEquipment(EquipmentSlot.Mainhand);
        if (!heldItem || heldItem.typeId !== ITEMS.hologramTool) return;
        if (!isAdmin(player).ok) return;
        ev.cancel = true;
        if (target.typeId === `${NS}:hologram` || target.typeId === `${NS}:hologram_v2`) {
          system.run(() => showHologramEdit(player, target));
        } else {
          system.run(() => {
            const hologram = findHologramForHitbox(target);
            if (hologram) showHologramEdit(player, hologram);
            else tell(player, t("jm_at.main.holo_no_linked"));
          });
        }
        return;
      }
      const dimId = player.dimension.id;
      // target.location may throw in beforeEvents — catch properly
      let loc;
      try {
        loc = target.location;
      } catch {
        loc = player.location;
      }
      if (
        !canInteract(player, dimId, loc, "entity", {
          isVehicle: isVehicleEntity(target),
        })
      ) {
        ev.cancel = true;
        system.run(() =>
          tellInteractDenied(
            player,
            t("jm_at.main.claims_no_entity_interact"),
          ),
        );
        // Item frames: cancel may not prevent item popping off. Clean up dropped items.
        if (
          target.typeId === "minecraft:frame" ||
          target.typeId === "minecraft:glow_frame"
        ) {
          const frameLoc = { x: loc.x, y: loc.y, z: loc.z };
          const removeDrops = () => {
            try {
              const dim = world.getDimension(dimId.replace("minecraft:", ""));
              const nearby = dim.getEntities({
                type: "minecraft:item",
                location: frameLoc,
                maxDistance: 3,
              });
              for (const e of nearby) e.remove();
            } catch {}
          };
          system.run(removeDrops); // tick+1
          system.runTimeout(removeDrops, 2); // tick+2
        }
      }
    } catch (e) {
      try {
        ev.cancel = true;
      } catch {}
      silentCatch("interact_entity_guard", e);
    }
  });
} catch {}

// =========================================================
// Claim: Explosion protection — remove claim blocks from blast
// =========================================================

try {
  world.beforeEvents.explosion.subscribe((ev) => {
    let dimId, blocks;
    try {
      dimId = ev.dimension.id;
      blocks = ev.getImpactedBlocks();
    } catch (e) {
      silentCatch("explosion_protect_outer", e);
      return;
    }

    const kept = [];
    for (const block of blocks) {
      let claim;
      try {
        claim = getClaimAt(dimId, block.location);
      } catch (e) {
        silentCatch("explosion_protect_block", e);
        // Fail closed: unknown claim status → assume protected, drop from blast
        continue;
      }
      if (claim && claim.protections.explosions) continue;
      kept.push(block);
    }

    try {
      if (kept.length !== blocks.length) ev.setImpactedBlocks(kept);
    } catch (e) {
      silentCatch("explosion_protect_set", e);
    }
  });
} catch {}

// =========================================================
// Claim: Armor stand destruction protection
// entityHurt is unreliable for armor stands in Bedrock. Cache their state while
// valid, then use entityDie plus entityRemove to restore protected stands.
// NOTE: Paintings and item frames cannot be protected this way due to
// Bedrock API limitations (no scriptable events fire for their
// interactions, and paintings cannot be respawned via spawnEntity).
// =========================================================

const _armorStandSnapshots = new Map();
const _armorStandRestorePending = new Set();
const _armorStandRecentAttackAccess = new Map();
const _armorStandProtectedDeathSnapshots = new Map();
const _armorStandDeniedTransactions = new Map();
const _armorStandPreventiveRemovals = new Set();
let _armorStandStructureSequence = 0;
const LEGACY_ARMOR_STAND_PROTECTED_TAG = "jm_at:claim_protected";
const ARMOR_STAND_PROTECTED_TAG = "jm_at:claim_protected_v2";

function snapshotArmorStand(entity) {
  if (!entity || entity.typeId !== "minecraft:armor_stand") return null;
  try {
    // Keep the enum values as-is. Storing slots as object keys coerces them to
    // strings, which can make setEquipment reject them during restoration.
    const equipment = [];
    let equipmentSlotsRead = 0;
    const equip = entity.getComponent("minecraft:equippable");
    if (equip) {
      for (const slot of [
        EquipmentSlot.Head,
        EquipmentSlot.Chest,
        EquipmentSlot.Legs,
        EquipmentSlot.Feet,
        EquipmentSlot.Mainhand,
        EquipmentSlot.Offhand,
      ]) {
        try {
          const item = equip.getEquipment(slot);
          equipmentSlotsRead++;
          if (item) equipment.push([slot, item.clone()]);
        } catch {}
      }
    }
    return {
      id: entity.id,
      dimId: entity.dimension.id,
      loc: { ...entity.location },
      rotation: entity.getRotation(),
      nameTag: entity.nameTag ?? "",
      tags: entity.getTags(),
      equipment,
      equipmentComplete: !!equip && equipmentSlotsRead === 6,
    };
  } catch {
    return null;
  }
}

function cacheArmorStand(entity) {
  const snapshot = snapshotArmorStand(entity);
  if (snapshot) {
    const previous = _armorStandSnapshots.get(snapshot.id);
    // A before-event can expose the stand while rejecting some equipment-slot
    // reads. Never let that partial view erase a complete live snapshot.
    if (!snapshot.equipmentComplete && previous?.equipmentComplete) {
      snapshot.equipment = previous.equipment.map(([slot, item]) => [
        slot,
        item.clone(),
      ]);
      snapshot.equipmentComplete = true;
    }
    _armorStandSnapshots.set(snapshot.id, snapshot);
  }
  return snapshot;
}

function snapshotNearbyPlayerInventories(snapshot, explicitPlayer = null) {
  const inventories = [];
  try {
    const dim = world.getDimension(snapshot.dimId.replace("minecraft:", ""));
    const players = dim.getPlayers({
      location: snapshot.loc,
      maxDistance: 12,
    });
    if (
      explicitPlayer?.typeId === "minecraft:player" &&
      !players.some((player) => player.id === explicitPlayer.id)
    ) {
      players.push(explicitPlayer);
    }
    for (const player of players) {
      try {
        const container = player.getComponent("minecraft:inventory")?.container;
        if (!container) continue;
        const slots = [];
        for (let i = 0; i < container.size; i++) {
          slots.push(container.getItem(i)?.clone());
        }
        inventories.push({ playerId: player.id, slots });
      } catch {}
    }
  } catch {}
  return inventories;
}

function recordDeniedArmorStandAttack(
  entity,
  snapshot = null,
  explicitPlayer = null,
) {
  snapshot = snapshot ?? cacheArmorStand(entity);
  if (!snapshot) return;
  const previous = _armorStandDeniedTransactions.get(snapshot.id);
  const inventories = snapshotNearbyPlayerInventories(
    snapshot,
    explicitPlayer,
  );
  let structureData = previous
    ? {
        structureId: previous.structureId,
        structureOrigin: previous.structureOrigin,
      }
    : {};
  try {
    const captured = captureArmorStandStructure(entity, snapshot);
    deleteArmorStandStructure(previous);
    structureData = captured;
  } catch (e) {
    // A capture attempted again from entityHurt is expected to be rejected in
    // restricted execution; only report it when no writable swing capture is
    // already available for this transaction.
    if (!previous?.structureId) {
      silentCatch("armor_stand_structure_capture", e);
    }
  }

  const transaction = {
    snapshot,
    inventories:
      inventories.length > 0 ? inventories : (previous?.inventories ?? []),
    tick: system.currentTick,
    ...structureData,
  };
  _armorStandDeniedTransactions.set(snapshot.id, transaction);
  system.runTimeout(() => {
    const tx = _armorStandDeniedTransactions.get(snapshot.id);
    if (tx && system.currentTick - tx.tick >= 100) {
      deleteArmorStandStructure(tx);
      _armorStandDeniedTransactions.delete(snapshot.id);
    }
  }, 100);
}

function restoreDeniedPlayerInventories(transaction) {
  for (const saved of transaction?.inventories ?? []) {
    try {
      const player = world.getEntity(saved.playerId);
      if (player?.typeId !== "minecraft:player") continue;
      const container = player.getComponent("minecraft:inventory")?.container;
      if (!container) continue;
      const count = Math.min(container.size, saved.slots.length);
      for (let i = 0; i < count; i++) {
        container.setItem(i, saved.slots[i]?.clone());
      }
    } catch {}
  }
}

function deleteArmorStandStructure(transaction) {
  try {
    if (transaction?.structureId) {
      world.structureManager.delete(transaction.structureId);
    }
  } catch {}
}

function captureArmorStandStructure(entity, snapshot) {
  const origin = {
    x: Math.floor(snapshot.loc.x),
    y: Math.floor(snapshot.loc.y),
    z: Math.floor(snapshot.loc.z),
  };
  const structureId = `jm_at:armor_stand_${system.currentTick}_${
    _armorStandStructureSequence++
  }`;
  world.structureManager.createFromWorld(
    structureId,
    entity.dimension,
    origin,
    { x: origin.x, y: origin.y + 2, z: origin.z },
    {
      includeBlocks: false,
      includeEntities: true,
      saveMode: StructureSaveMode.Memory,
    },
  );
  return { structureId, structureOrigin: origin };
}

function restoreArmorStandStructure(transaction) {
  if (!transaction?.structureId) return null;
  const snapshot = transaction.snapshot;
  const dim = world.getDimension(snapshot.dimId.replace("minecraft:", ""));
  world.structureManager.place(
    transaction.structureId,
    dim,
    transaction.structureOrigin,
    { includeBlocks: false, includeEntities: true },
  );
  const restored = dim.getEntities({
    type: "minecraft:armor_stand",
    location: snapshot.loc,
    maxDistance: 2,
  })[0];
  if (restored) {
    cacheArmorStand(restored);
    syncArmorStandClaimProtection(restored);
  }
  return restored ?? null;
}

function replaceDeniedArmorStandBeforeBreak(
  entity,
  snapshot,
  attacker,
) {
  recordDeniedArmorStandAttack(entity, snapshot, attacker);
  const transaction = _armorStandDeniedTransactions.get(snapshot.id);
  if (!transaction?.structureId) return false;

  const oldId = snapshot.id;
  let removed = false;
  _armorStandPreventiveRemovals.add(oldId);
  try {
    // remove() despawns without entering the armor stand's native death/loot
    // pipeline. Placing its entity-only structure immediately creates an exact
    // replacement and resets the hard-coded consecutive-hit state.
    entity.remove();
    removed = true;
    restoreArmorStandStructure(transaction);
    deleteArmorStandStructure(transaction);
    _armorStandDeniedTransactions.delete(oldId);
    _armorStandSnapshots.delete(oldId);
    return true;
  } catch (e) {
    silentCatch("armor_stand_preventive_replace", e);
    if (!removed) {
      _armorStandPreventiveRemovals.delete(oldId);
      return false;
    }

    // If placement failed after the loot-free removal, retry next tick while
    // the in-memory structure is still available.
    system.run(() => {
      try {
        restoreArmorStandStructure(transaction);
      } catch (retryError) {
        silentCatch("armor_stand_preventive_replace_retry", retryError);
      } finally {
        deleteArmorStandStructure(transaction);
        _armorStandDeniedTransactions.delete(oldId);
        _armorStandSnapshots.delete(oldId);
      }
    });
    return true;
  } finally {
    // beforeEvents.entityRemove normally consumes this marker synchronously;
    // this also prevents a stale marker if engine ordering changes.
    system.runTimeout(
      () => _armorStandPreventiveRemovals.delete(oldId),
      2,
    );
  }
}

function restoreArmorStandSnapshot(snapshot) {
  const dim = world.getDimension(snapshot.dimId.replace("minecraft:", ""));
  // Entity unloads also emit entityRemove. An unloaded chunk throws here,
  // preventing an ordinary unload from creating a duplicate stand.
  try {
    dim.getBlock(snapshot.loc);
  } catch {
    return null;
  }
  const claim = getClaimAt(snapshot.dimId, snapshot.loc);
  if (!claim || !claim.protections.entities) return null;

  const stand = dim.spawnEntity("minecraft:armor_stand", snapshot.loc);
  try {
    stand.setRotation(snapshot.rotation ?? { x: 0, y: 0 });
  } catch {}
  if (snapshot.nameTag) {
    try {
      stand.nameTag = snapshot.nameTag;
    } catch {}
  }
  for (const tag of snapshot.tags ?? []) {
    if (
      tag === ARMOR_STAND_PROTECTED_TAG ||
      tag === LEGACY_ARMOR_STAND_PROTECTED_TAG
    ) {
      continue;
    }
    try {
      stand.addTag(tag);
    } catch {}
  }
  // A newly spawned armor stand can exist before its equippable component is
  // initialized. Apply the saved equipment now and again on later ticks; each
  // set replaces its slot, so retries cannot duplicate an item.
  const restoreEquipment = () => {
    try {
      if (!stand.isValid) return;
      const equip = stand.getComponent("minecraft:equippable");
      if (!equip) return;
      for (const [slot, item] of snapshot.equipment) {
        try {
          equip.setEquipment(slot, item.clone());
        } catch {}
      }
      cacheArmorStand(stand);
    } catch {}
  };
  restoreEquipment();
  system.run(restoreEquipment);
  system.runTimeout(restoreEquipment, 3);
  syncArmorStandClaimProtection(stand, snapshot);
  return stand;
}

function syncArmorStandClaimProtection(entity, snapshot = null) {
  try {
    snapshot = snapshot ?? cacheArmorStand(entity);
    if (!snapshot) return;
    const claim = getClaimAt(snapshot.dimId, snapshot.loc);
    const shouldProtect = !!claim?.protections.entities;
    const hasCurrentMarker = entity.hasTag(ARMOR_STAND_PROTECTED_TAG);
    const hasLegacyMarker = entity.hasTag(
      LEGACY_ARMOR_STAND_PROTECTED_TAG,
    );
    if (shouldProtect && hasCurrentMarker) return;
    if (!shouldProtect && !hasCurrentMarker && !hasLegacyMarker) return;

    if (shouldProtect) {
      entity.addTag(ARMOR_STAND_PROTECTED_TAG);
      try {
        entity.removeTag(LEGACY_ARMOR_STAND_PROTECTED_TAG);
      } catch {}
    } else {
      entity.removeTag(ARMOR_STAND_PROTECTED_TAG);
      try {
        entity.removeTag(LEGACY_ARMOR_STAND_PROTECTED_TAG);
      } catch {}
    }
  } catch (e) {
    silentCatch("armor_stand_protection_sync", e);
  }
}

function cleanupArmorStandDrops(snapshot, dimension) {
  try {
    for (const drop of dimension.getEntities({
      type: "minecraft:item",
      location: snapshot.loc,
      maxDistance: 3,
    })) {
      try {
        drop.remove();
      } catch {}
    }
  } catch {}
}

function isProtectedArmorStandDrop(itemEntity) {
  try {
    const loc = itemEntity.location;
    const dimId = itemEntity.dimension.id;

    for (const snapshot of _armorStandProtectedDeathSnapshots.values()) {
      if (snapshot.dimId !== dimId) continue;
      const d2 =
        (loc.x - snapshot.loc.x) ** 2 +
        (loc.y - snapshot.loc.y) ** 2 +
        (loc.z - snapshot.loc.z) ** 2;
      if (d2 <= 9) return true;
    }
  } catch {}
  return false;
}

function handleArmorStandLoss(entity, attacker, allowNearbyAuthorization) {
  if (!entity || entity.typeId !== "minecraft:armor_stand") return false;

  const id = entity.id;
  if (_armorStandPreventiveRemovals.delete(id)) {
    // Loot-free replacement initiated by a denied melee swing. The caller
    // owns structure placement; do not invoke the death rollback as well.
    return true;
  }
  if (_armorStandRestorePending.has(id)) return true;

  const transaction = _armorStandDeniedTransactions.get(id);
  const snapshot = transaction?.snapshot ?? _armorStandSnapshots.get(id);
  if (!snapshot) return true;
  const claim = getClaimAt(snapshot.dimId, snapshot.loc);
  if (!claim?.protections.entities) {
    _armorStandSnapshots.delete(id);
    _armorStandDeniedTransactions.delete(id);
    return true;
  }

  const deniedAttacker =
    attacker?.typeId === "minecraft:player" &&
    !canInteract(attacker, snapshot.dimId, snapshot.loc, "entity");
  const recentDeniedTransaction =
    transaction && system.currentTick - transaction.tick <= 100;
  if (!deniedAttacker && !recentDeniedTransaction) {
    _armorStandSnapshots.delete(id);
    return true;
  }

  _armorStandRestorePending.add(id);
  _armorStandProtectedDeathSnapshots.set(id, snapshot);

  // A player standing against the stand can collect its native loot before an
  // item-entity after-event runs. Restore their exact pre-hit inventory first.
  if (transaction) {
    const restoreInventories = () =>
      restoreDeniedPlayerInventories(transaction);
    system.run(restoreInventories);
    system.runTimeout(restoreInventories, 3);
    system.runTimeout(restoreInventories, 7);
    system.runTimeout(restoreInventories, 12);
  }

  system.runTimeout(() => {
    try {
      const dim = world.getDimension(snapshot.dimId.replace("minecraft:", ""));
      const restored = transaction?.structureId
        ? restoreArmorStandStructure(transaction)
        : restoreArmorStandSnapshot(snapshot);
      const cleanup = () => cleanupArmorStandDrops(snapshot, dim);
      cleanup();
      system.runTimeout(cleanup, 1);
      system.runTimeout(cleanup, 3);
      system.runTimeout(cleanup, 6);
      system.runTimeout(cleanup, 10);
      system.runTimeout(cleanup, 20);
      if (transaction) restoreDeniedPlayerInventories(transaction);
      if (attacker?.typeId === "minecraft:player") {
        tellInteractDenied(attacker, t("jm_at.main.claims_no_harm_entities"));
      }
      if (restored) cacheArmorStand(restored);
    } catch (e) {
      silentCatch("armor_stand_transaction_restore", e);
    } finally {
      deleteArmorStandStructure(transaction);
      _armorStandRestorePending.delete(id);
      _armorStandSnapshots.delete(id);
      _armorStandDeniedTransactions.delete(id);
      system.runTimeout(
        () => _armorStandProtectedDeathSnapshots.delete(id),
        40,
      );
    }
  }, 2);
  return true;
}

// All of these events and methods are stable in @minecraft/server 2.8.0.
try {
  world.afterEvents.entitySpawn.subscribe(
    (ev) => {
      const snapshot = cacheArmorStand(ev.entity);
      if (snapshot) syncArmorStandClaimProtection(ev.entity, snapshot);
    },
    { entityTypes: ["minecraft:armor_stand"] },
  );
} catch {}

try {
  world.afterEvents.entityLoad.subscribe(
    (ev) => {
      const snapshot = cacheArmorStand(ev.entity);
      if (snapshot) syncArmorStandClaimProtection(ev.entity, snapshot);
    },
    { entityTypes: ["minecraft:armor_stand"] },
  );
} catch {}

try {
  world.afterEvents.playerSwingStart.subscribe(
    (ev) => {
      try {
        const hit = ev.player.getEntitiesFromViewDirection({ maxDistance: 12 })[0];
        if (hit?.entity.typeId === "minecraft:armor_stand") {
          const snapshot = cacheArmorStand(hit.entity);
          if (snapshot) {
            const access = {
              allowed: canInteract(
                ev.player,
                snapshot.dimId,
                snapshot.loc,
                "entity",
              ),
              tick: system.currentTick,
            };
            _armorStandRecentAttackAccess.set(snapshot.id, access);
            system.runTimeout(() => {
              if (_armorStandRecentAttackAccess.get(snapshot.id) === access) {
                _armorStandRecentAttackAccess.delete(snapshot.id);
              }
            }, 20);
            const claim = getClaimAt(snapshot.dimId, snapshot.loc);
            if (claim?.protections.entities) {
              if (!access.allowed) {
                replaceDeniedArmorStandBeforeBreak(
                  hit.entity,
                  snapshot,
                  ev.player,
                );
                tellInteractDenied(
                  ev.player,
                  t("jm_at.main.claims_no_harm_entities"),
                );
              }
            }
          }
        }
      } catch {}
    },
    { swingSource: EntitySwingSource.Attack },
  );
} catch {}

// Fallback for builds that still publish a hit event for non-attackable
// entities. The swing handler above is the primary path.
try {
  world.afterEvents.entityHitEntity.subscribe((ev) => {
    try {
      const attacker = ev.damagingEntity;
      const stand = ev.hitEntity;
      if (
        attacker?.typeId !== "minecraft:player" ||
        stand?.typeId !== "minecraft:armor_stand"
      ) {
        return;
      }

      const snapshot = cacheArmorStand(stand);
      if (!snapshot) return;
      const claim = getClaimAt(snapshot.dimId, snapshot.loc);
      if (!claim?.protections.entities) {
        return;
      }

      if (!canInteract(attacker, snapshot.dimId, snapshot.loc, "entity")) {
        replaceDeniedArmorStandBeforeBreak(stand, snapshot, attacker);
        tellInteractDenied(attacker, t("jm_at.main.claims_no_harm_entities"));
        return;
      }
    } catch (e) {
      silentCatch("armor_stand_hit_guard", e);
    }
  });
} catch {}

// Stable 2.8 exposes the exact item entities emitted by a source entity. Remove
// armor-stand death loot directly; the timed radius sweep above is only a
// fallback for engine paths that do not publish an item-drop event.
try {
  world.afterEvents.entityItemDrop.subscribe((ev) => {
    try {
      const source = ev.entity;
      if (!source || source.typeId !== "minecraft:armor_stand") return;
      const id = source.id;
      const access = _armorStandRecentAttackAccess.get(id);
      if (
        access?.allowed === true &&
        system.currentTick - access.tick <= 10
      ) {
        return;
      }

      const snapshot =
        _armorStandProtectedDeathSnapshots.get(id) ??
        _armorStandSnapshots.get(id);
      if (!snapshot) return;
      const claim = getClaimAt(snapshot.dimId, snapshot.loc);
      if (!claim || !claim.protections.entities) return;

      for (const itemEntity of ev.items) {
        try {
          itemEntity.remove();
        } catch {}
      }
    } catch (e) {
      silentCatch("armor_stand_drop_guard", e);
    }
  });
} catch {}

// Some vanilla loot-table paths can surface only as item entity spawns. Catch
// those at creation time while the protected-death marker is active.
try {
  world.afterEvents.entitySpawn.subscribe(
    (ev) => {
      try {
        const itemEntity = ev.entity;
        if (isProtectedArmorStandDrop(itemEntity)) itemEntity.remove();
      } catch (e) {
        silentCatch("armor_stand_drop_spawn_guard", e);
      }
    },
    { entityTypes: ["minecraft:item"] },
  );
} catch {}

// A player standing on the stand can otherwise win the race against all
// after-event cleanup. Cancel collection synchronously, then remove the denied
// loot once execution returns to read-write mode.
try {
  world.beforeEvents.entityItemPickup.subscribe((ev) => {
    try {
      if (!isProtectedArmorStandDrop(ev.item)) return;
      ev.cancel = true;
      const itemEntity = ev.item;
      system.run(() => {
        try {
          itemEntity.remove();
        } catch {}
      });
    } catch (e) {
      silentCatch("armor_stand_pickup_guard", e);
    }
  });
} catch {}

system.runInterval(() => {
  for (const dimName of ["overworld", "nether", "the_end"]) {
    try {
      for (const stand of world
        .getDimension(dimName)
        .getEntities({ type: "minecraft:armor_stand" })) {
        const snapshot = cacheArmorStand(stand);
        if (snapshot) syncArmorStandClaimProtection(stand, snapshot);
      }
    } catch {}
  }
}, 10);

try {
  world.beforeEvents.entityRemove.subscribe((ev) => {
    try {
      const entity = ev.removedEntity;
      if (!entity) return;

      // entity.remove() path — clean up registry entry (hitbox handled separately via entityDie)
      if (entity.typeId === `${NS}:hologram` || entity.typeId === `${NS}:hologram_v2`) {
        try {
          cleanupHologram(entity.id, entity);
        } catch {}
        return;
      }
      if (entity.typeId === `${NS}:hologram_hitbox`) return; // managed by main hologram

      if (handleArmorStandLoss(entity, null, true)) return;
    } catch {}
  });
} catch {}

// Kill-command path: /kill deals damage so entityDie fires instead of entityRemove.
// Clean up the paired hitbox + registry when a hologram dies this way.
try {
  world.afterEvents.entityDie.subscribe(
    (ev) => {
      try {
        cleanupHologram(ev.deadEntity.id, ev.deadEntity);
      } catch {}
    },
    { entityTypes: [`${NS}:hologram`, `${NS}:hologram_v2`] },
  );
} catch {}

// =========================================================
// Claim: Hostile mob spawning prevention
// =========================================================

// Helper: silently remove a hostile entity inside a protected claim
function _claimKillHostile(entity) {
  if (typeof entity.remove === "function") {
    try {
      entity.remove();
      return;
    } catch {}
  }
  if (typeof entity.kill === "function") {
    try {
      entity.kill();
    } catch {}
  }
}

// Helper: check entity validity (read-only property in Scripting V2)
function _entityIsValid(entity) {
  return entity.isValid;
}

// Layer 1: Event-based interception (instant, primary)
try {
  world.afterEvents.entitySpawn.subscribe((ev) => {
    try {
      const entity = ev.entity;
      if (!entity || !_entityIsValid(entity)) return;

      const dimId = entity.dimension?.id;
      const loc = entity.location;
      if (!dimId || !loc) return;

      // Protected either by a claim's hostile-mob rule or by an optional grave
      // safe bubble (cfg.gravestoneSafeZoneEnabled) — both purge hostiles the
      // same way. isInGraveSafeZone is cheap and self-gates when off.
      const claim = getClaimAt(dimId, loc);
      const inClaim = !!(claim && claim.protections?.hostileMobs);
      if (!inClaim && !isInGraveSafeZone(dimId, loc)) return;

      // Mob-list decision: exact (full-id) entries beat namespace entries and
      // blacklist breaks ties, so an admin can blacklist "mypack:" yet whitelist
      // "mypack:friendly" to spare that one. null = no list opinion.
      const decision = mobClaimDecision(entity.typeId, getCfg().mobBlacklist);
      if (decision === "spare") return;
      if (decision === "remove") {
        system.run(() => {
          try {
            if (_entityIsValid(entity)) _claimKillHostile(entity);
          } catch {}
        });
        return;
      }

      // No list opinion → normal hostile purge. Spare name-tagged mobs
      // (e.g. a player's named pet).
      if (entity.nameTag) return;
      if (!entity.typeId.startsWith("minecraft:")) return; // don't remove entities from other packs

      system.run(() => {
        try {
          if (!_entityIsValid(entity)) return;
          _claimKillHostile(entity);
        } catch {}
      });
    } catch {}
  });
} catch {}

// Layer 2: Polling fallback (catches mobs that slip through or are teleported in)
try {
  system.runInterval(() => {
    try {
      const bl = getCfg().mobBlacklist;
      for (const player of world.getPlayers()) {
        const dim = player.dimension;
        // Skip expensive entity query if player isn't in a protected claim
        const playerClaim = getClaimAt(dim.id, player.location);
        if (!playerClaim || !playerClaim.protections?.hostileMobs) continue;
        const entities = dim.getEntities({
          location: player.location,
          maxDistance: 48,
          excludeTypes: ["minecraft:player"],
        });
        for (const entity of entities) {
          try {
            if (!_entityIsValid(entity)) continue;
            const loc = entity.location;
            if (!loc) continue;
            const claim = getClaimAt(dim.id, loc);
            if (!claim || !claim.protections?.hostileMobs) continue;

            // Mob-list decision (see the spawn handler above for precedence).
            const decision = mobClaimDecision(entity.typeId, bl);
            if (decision === "spare") continue;
            if (decision === "remove") {
              _claimKillHostile(entity);
              continue;
            }

            // No list opinion → normal hostile purge. Spare name-tagged mobs.
            if (entity.nameTag) continue;
            if (!entity.typeId.startsWith("minecraft:")) continue; // don't remove entities from other packs
            _claimKillHostile(entity);
          } catch {}
        }
      }
    } catch {}
  }, 60); // every 3 seconds
} catch {}

// =========================================================
// Claim: Fire spread prevention
// Uses itemUse protection for player-caused fire (flint & steel, fire charge).
// For natural fire spread, periodically scan for fire blocks in protected claims.
// =========================================================

try {
  system.runInterval(() => {
    try {
      for (const player of world.getPlayers()) {
        const dim = player.dimension;
        const loc = player.location;
        // Only scan if player is in a fire-spread-protected claim
        const playerClaim = getClaimAt(dim.id, loc);
        if (!playerClaim || !playerClaim.protections.fireSpread) continue;
        // Reduced scan: 4-block radius around player, ±4 vertical
        const cx = Math.floor(loc.x),
          cy = Math.floor(loc.y),
          cz = Math.floor(loc.z);
        for (let dx = -4; dx <= 4; dx++) {
          for (let dz = -4; dz <= 4; dz++) {
            for (let dy = -4; dy <= 4; dy++) {
              try {
                const block = dim.getBlock({
                  x: cx + dx,
                  y: cy + dy,
                  z: cz + dz,
                });
                if (
                  block?.typeId === "minecraft:fire" ||
                  block?.typeId === "minecraft:soul_fire"
                ) {
                  // Don't extinguish intentional fires on permanent fire blocks
                  const below = dim.getBlock({
                    x: cx + dx,
                    y: cy + dy - 1,
                    z: cz + dz,
                  });
                  if (
                    below?.typeId === "minecraft:netherrack" ||
                    below?.typeId === "minecraft:soul_sand" ||
                    below?.typeId === "minecraft:soul_soil"
                  )
                    continue;
                  const fireClaim = getClaimAt(dim.id, block.location);
                  if (fireClaim && fireClaim.protections.fireSpread) {
                    block.setType("minecraft:air");
                  }
                }
              } catch {}
            }
          }
        }
      }
    } catch {}
  }, 80); // every 4 seconds
} catch {}

// =========================================================
// Claim: Ender pearl entry prevention
// Cache thrower position on pearl throw, restore on protected landing
// =========================================================

const _pearlThrowPos = new Map(); // playerId -> { pos, dimId }

try {
  world.afterEvents.itemUse.subscribe((ev) => {
    try {
      const { source: player, itemStack } = ev;
      if (!player || player.typeId !== "minecraft:player") return;
      if (itemStack?.typeId !== "minecraft:ender_pearl") return;
      _pearlThrowPos.set(player.id, {
        pos: {
          x: player.location.x,
          y: player.location.y,
          z: player.location.z,
        },
        dimId: player.dimension.id,
      });
      // Auto-clean after 10s
      system.runTimeout(() => _pearlThrowPos.delete(player.id), 200);
    } catch {}
  });
} catch {}

// Shared ender-pearl entry guard, used for both block and entity landings (a
// pearl that lands on a mob/armor stand inside a protected claim would otherwise
// teleport the thrower in).
function _handlePearlEntry(player, hitLoc, dimId, dimension) {
  try {
    if (canInteract(player, dimId, hitLoc, "ender_pearl")) {
      _pearlThrowPos.delete(player.id);
      return;
    }
    const cached = _pearlThrowPos.get(player.id);
    system.run(() => {
      try {
        if (cached) {
          teleportedPlayers.add(player.id);
          teleportPlayer(player, cached.pos, {
            dimension: world.getDimension(
              cached.dimId.replace("minecraft:", ""),
            ),
          });
        } else {
          // Fallback: eject to claim edge
          const claim = getClaimAt(dimId, hitLoc);
          if (claim) {
            const ejectPos = getEjectPosition(claim, hitLoc);
            teleportedPlayers.add(player.id);
            teleportPlayer(player, ejectPos, { dimension });
          }
        }
        tell(player, t("jm_at.main.claims_no_pearl"));
      } catch {}
    });
    _pearlThrowPos.delete(player.id);
  } catch {}
}

try {
  world.afterEvents.projectileHitBlock.subscribe((ev) => {
    try {
      if (ev.projectile?.typeId !== "minecraft:ender_pearl") return;
      const player = ev.source;
      if (!player || player.typeId !== "minecraft:player") return;
      _handlePearlEntry(player, ev.location, ev.dimension.id, ev.dimension);
    } catch {}
  });
} catch {}

try {
  world.afterEvents.projectileHitEntity.subscribe((ev) => {
    try {
      if (ev.projectile?.typeId !== "minecraft:ender_pearl") return;
      const player = ev.source;
      if (!player || player.typeId !== "minecraft:player") return;
      _handlePearlEntry(player, ev.location, ev.dimension.id, ev.dimension);
    } catch {}
  });
} catch {}

// =========================================================
// Claim: Eject non-trusted players from protected claims
// =========================================================

const _ejectMsgThrottle = new Map(); // playerId → lastMsgMs
try {
  system.runInterval(() => {
    try {
      const now = Date.now();
      for (const player of world.getPlayers()) {
        const claim = getClaimAt(player.dimension.id, player.location);
        if (!claim) continue;
        if (!claim.protections.ejectPlayers) continue;
        if (canAccessClaim(player, claim)) continue;
        const ejectPos = getEjectPosition(claim, player.location);
        teleportedPlayers.add(player.id);
        teleportPlayer(player, ejectPos, {
          dimension: player.dimension,
          keepVelocity: false,
        });
        // Throttle the eject message to once per 3 seconds per player
        const last = _ejectMsgThrottle.get(player.id) ?? 0;
        if (now - last > 3000) {
          tell(player, t("jm_at.main.claims_not_allowed"));
          _ejectMsgThrottle.set(player.id, now);
        }
      }
    } catch (e) {
      silentCatch("claim_eject", e);
    }
  }, 5); // every 250ms (was 20 ticks / 1s — too slow for elytra/sprint)
} catch {}

// =========================================================
// Claim: Portal/dimension change protection
// Prevents players from entering protected claims via portals
// =========================================================

try {
  world.afterEvents.playerDimensionChange.subscribe((ev) => {
    const player = ev.player;
    if (!player || player.typeId !== "minecraft:player") return;
    const toDimId = ev.toDimension.id;
    const toLoc = ev.toLocation;
    system.run(() => {
      // A pending wand selection belongs to the dimension it was started in;
      // leaving that dimension abandons it (and would otherwise strand its corner
      // markers in the old dimension). Clear it and let the owner know.
      try {
        const selXuid = getPlayerXuid(player);
        if (getPendingSelection(selXuid)) {
          clearPendingSelection(selXuid);
          tell(player, t("jm_at.main.claims_dim_change_cleared"));
        }
      } catch (e) {
        silentCatch("claim_dimchange_clear", e);
      }
      try {
        const claim = getClaimAt(toDimId, toLoc);
        if (
          claim &&
          claim.protections.ejectPlayers &&
          !canAccessClaim(player, claim)
        ) {
          const ejectPos = getEjectPosition(claim, toLoc);
          teleportedPlayers.add(player.id);
          teleportPlayer(player, ejectPos, {
            dimension: ev.toDimension,
            keepVelocity: false,
          });
          tell(player, t("jm_at.main.claims_no_portal_entry"));
        }
      } catch (e) {
        silentCatch("portal_claim_eject", e);
      }
      holoScanDim(toDimId);
    });
  });
} catch {}

// =========================================================
// Ender Chest viewing — live as of @minecraft/server 2.8.0
// The admin panel now reads the player's `minecraft:ender_inventory`
// container directly (see ui-admin.js → showEnderChest), so the old
// hasitem-selector snapshot scanner that ran a command per item type
// every tick has been removed entirely. Stale `${NS}:echest_*` dynamic
// properties left on players are simply ignored.
// =========================================================

// Claim entry/exit notifications.
//
// Polls every 4 ticks (0.2s) instead of the old 10 (0.5s) so the entry message
// appears far sooner. A movement guard keeps the faster cadence cheap: we cache
// each player's last sampled block and skip the claim lookup entirely until they
// step into a new block (Y included — claims have vertical bounds). Idle players
// therefore cost almost nothing, preserving the performance balance.
const CLAIM_NOTIF_INTERVAL_TICKS = 4;
const _playerClaimIds = new Map();     // xuid → claim.id | null
const _playerClaimNotifAt = new Map(); // xuid → Date.now() of last message sent
const _playerClaimBlock = new Map();   // xuid → { dim, x, y, z } last sampled block
const DEFAULT_CLAIM_NOTIF_COOLDOWN_MS = 1500;

/**
 * Compute the substitution values for a claim's entry message. Pass
 * includeRestricted=false to skip the (relatively costly) build-permission check
 * when the template doesn't use {restricted}.
 *
 * NOT translated: the entire claim entry/exit notification path renders
 * admin-authored {placeholder} templates through string operations
 * (renderClaimTemplate/applyNewlines), so it cannot carry RawMessages — per
 * the i18n scoping decision, admin-authored claim message templates and the
 * Chinese fragments substituted into them stay raw strings.
 */
function claimMsgValues(claim, player, dim, loc, includeRestricted) {
  const ownerName = claim.isAdminClaim ? "管理员" : claim.ownerName;
  const owner = claim.isAdminClaim ? "管理员领地" : `${claim.ownerName}的领地`;
  const claimName = claim.name || "";
  const name = claimName ? ` §7(§f${claimName}§7)` : "";
  let restricted = "";
  if (
    includeRestricted &&
    claim.protections.blocks &&
    !canInteract(player, dim, loc, "place")
  ) {
    restricted = " §c| 禁止建造：放置的潜影盒会被破坏";
  }
  return { owner, ownerName, name, claimName, restricted };
}

/**
 * Render a claim-entry message. Uses the claim's own welcome message when one is
 * set and the feature is enabled, otherwise the server-wide template. Unknown
 * {placeholders} are stripped by renderClaimTemplate so players never see raw
 * braces. Placeholders: {owner} {ownerName} {name} {claimName} {restricted}
 */
function formatClaimEnterMsg(cfg, claim, player, dim, loc) {
  const personal =
    cfg.claimWelcomeMsgEnabled !== false && claim.welcomeMsg
      ? claim.welcomeMsg
      : "";
  const tpl = applyColorCodes(
    personal || cfg.claimEnterMsg || DEFAULT_CLAIM_ENTER_MSG,
  );
  const values = claimMsgValues(
    claim,
    player,
    dim,
    loc,
    tpl.toLowerCase().includes("{restricted}"),
  );
  return renderClaimTemplate(tpl, values);
}

/** Send a claim notification via the configured display channel. */
function showClaimNotif(player, msg, display) {
  if (display === "title") {
    // Render the message as the title itself. We deliberately don't use the
    // subtitle slot: Bedrock only draws a subtitle alongside a title, so a
    // subtitle-only message would leave a blank title line visible above it.
    // Titles honor \n, so multi-line messages still work.
    setHudTitle(player, applyNewlines(msg), {
      fadeInDuration: 0,
      stayDuration: 40, // ~2s
      fadeOutDuration: 10,
    });
  } else if (display === "chat") {
    player.sendMessage(applyNewlines(msg));
  } else {
    // Action bar is a single line — collapse any line breaks to spaces.
    player.onScreenDisplay.setActionBar(String(msg).replace(/\\n/g, " ").trim());
  }
}

system.runInterval(() => {
  const cfg = getCfg();
  if (cfg.claimNotificationsEnabled === false) return;
  const now = Date.now();
  const display = cfg.claimNotifDisplay ?? "actionbar";
  for (const player of world.getPlayers()) {
    try {
      const xuid = getPlayerXuid(player);
      const loc = player.location;
      const dim = player.dimension.id;
      // Movement guard: skip the claim lookup until the player changes block.
      // Compare fields directly so the common (unmoved) path allocates nothing.
      const bx = Math.floor(loc.x);
      const by = Math.floor(loc.y);
      const bz = Math.floor(loc.z);
      const last = _playerClaimBlock.get(xuid);
      if (last && last.dim === dim && last.x === bx && last.y === by && last.z === bz)
        continue;
      _playerClaimBlock.set(xuid, { dim, x: bx, y: by, z: bz });

      const claim = getClaimAt(dim, loc);
      const newId = claim ? claim.id : null;
      const oldId = _playerClaimIds.get(xuid);
      if (oldId === newId) continue;
      _playerClaimIds.set(xuid, newId);
      // Anti-spam: suppress the message if one was sent within the cooldown.
      const cooldownMs =
        cfg.claimNotifCooldownSec != null
          ? cfg.claimNotifCooldownSec * 1000
          : DEFAULT_CLAIM_NOTIF_COOLDOWN_MS;
      const lastAt = _playerClaimNotifAt.get(xuid) ?? 0;
      if (now - lastAt < cooldownMs) continue;
      _playerClaimNotifAt.set(xuid, now);
      if (newId) {
        showClaimNotif(player, formatClaimEnterMsg(cfg, claim, player, dim, loc), display);
      } else {
        showClaimNotif(
          player,
          applyColorCodes(cfg.claimExitMsg || DEFAULT_CLAIM_EXIT_MSG),
          display,
        );
      }
    } catch (e) {
      silentCatch("claim_notify_player", e);
    }
  }
}, CLAIM_NOTIF_INTERVAL_TICKS);

// =========================================================
// Full data reset via /scriptevent jm_at:resetData
// =========================================================

const _resetConfirmations = new Map(); // key → timestamp
const RESET_CONFIRM_WINDOW_MS = 10_000;

system.afterEvents.scriptEventReceive.subscribe(
  (ev) => {
  if (ev.id !== `${NS}:resetData`) return;

  // Owner-only. This wipes ALL world + player data — including cfg.ownerXuid,
  // claims, the ban ledger, ranks and every player's data — irreversibly.
  // /scriptevent runs at operator level, so without this check any op-level
  // admin or command block could erase the entire server's Admin Tools state.
  // The double-fire confirmation below is a fat-finger guard, NOT authorization.
  const src = ev.sourceEntity;
  if (!src || src.typeId !== "minecraft:player" || !isOwner(src)) {
    if (src) tell(src, t("jm_at.main.reset_owner_only"));
    return;
  }

  const key = ev.sourceEntity?.id ?? "__no_entity__";
  const now = Date.now();
  const pending = _resetConfirmations.get(key);

  if (pending && now - pending < RESET_CONFIRM_WINDOW_MS) {
    // Second trigger within window — execute the reset
    _resetConfirmations.delete(key);
  } else {
    // First trigger — store confirmation and warn
    _resetConfirmations.set(key, now);
    world.sendMessage(t("jm_at.main.reset_confirm"));
    return;
  }

  // Log who triggered the reset (if a player entity is available)
  if (ev.sourceEntity) {
    try {
      const player = /** @type {import("@minecraft/server").Player} */ (
        ev.sourceEntity
      );
      if (player.name)
        logAdmin(player, "resetData", "通过脚本事件重置全部数据");
    } catch {}
  }

  world.sendMessage(t("jm_at.main.reset_initiated"));

  // 1. Stop all active spy sessions (restores admins first)
  try {
    stopAllSpySessions();
  } catch (e) {
    silentCatch("reset_spy", e);
  }

  // 2. Wipe all world-level dynamic properties
  try {
    world.clearDynamicProperties();
  } catch (e) {
    silentCatch("reset_world_dp", e);
  }

  // 3. Wipe player-level dynamic properties for all online players
  for (const player of world.getPlayers()) {
    try {
      player.clearDynamicProperties();
    } catch (e) {
      silentCatch("reset_player_dp", e);
    }
  }

  // 4. Remove hologram entities (and hitboxes) across all dimensions
  for (const dimId of ["overworld", "nether", "the_end"]) {
    try {
      for (const typeId of [`${NS}:hologram`, `${NS}:hologram_v2`]) {
        for (const e of world.getDimension(dimId).getEntities({ type: typeId })) {
          try {
            e.remove();
          } catch {}
        }
      }
      for (const e of world
        .getDimension(dimId)
        .getEntities({ type: `${NS}:hologram_hitbox` })) {
        try {
          e.remove();
        } catch {}
      }
    } catch {}
  }

  // 5. Clear in-memory caches
  try {
    resetStorageCaches();
  } catch (e) {
    silentCatch("reset_storage_cache", e);
  }
  try {
    invalidateClaimCache();
  } catch (e) {
    silentCatch("reset_claim_cache", e);
  }
  try {
    freezePosCache.clear();
    frozenPlayers.clear();
  } catch {}
  try {
    teleportedPlayers.clear();
  } catch {}
  try {
    _pearlThrowPos.clear();
  } catch {}
  try {
    _holoScanDebounce.clear();
  } catch {}

  // 6. Re-initialize world properties with clean defaults
  try {
    ensureWorldPropertiesInitialized();
  } catch (e) {
    silentCatch("reset_reinit", e);
  }

  world.sendMessage(t("jm_at.main.reset_complete"));
  },
  { namespaces: [NS] },
);

// =========================================================
// Owner-only claim resets via /scriptevent
//   jm_at:resetPlayerClaims <playerName>  — delete one player's claims
//   jm_at:resetAllClaims                  — delete every claim (double-confirm)
// =========================================================

const _resetAllClaimsConfirm = new Map(); // src id → timestamp

system.afterEvents.scriptEventReceive.subscribe(
  (ev) => {
    if (
      ev.id !== `${NS}:resetPlayerClaims` &&
      ev.id !== `${NS}:resetAllClaims`
    )
      return;

    // Owner-only. /scriptevent runs at operator level, so without this any op
    // or command block could wipe claims.
    const src = ev.sourceEntity;
    if (!src || src.typeId !== "minecraft:player" || !isOwner(src)) {
      if (src) tell(src, t("jm_at.main.reset_claims_owner_only"));
      return;
    }

    if (ev.id === `${NS}:resetPlayerClaims`) {
      const typed = (ev.message ?? "").trim();
      if (!typed) {
        tell(src, t("jm_at.main.reset_player_claims_usage"));
        return;
      }
      // Resolve the name: registry first (covers offline players), then any
      // online player not yet in the registry.
      let targetXuid = "";
      let targetName = typed;
      const entry = getRegistryEntryByName(typed);
      if (entry) {
        targetXuid = entry.xuid;
        targetName = entry.name;
      } else {
        const online = world
          .getPlayers()
          .find((p) => p.name.toLowerCase() === typed.toLowerCase());
        if (online) {
          targetXuid = getPlayerXuid(online);
          targetName = online.name;
        }
      }
      if (!targetXuid) {
        tell(src, t("jm_at.main.no_known_player", typed));
        return;
      }
      const removed = resetClaimsByOwner(targetXuid, src);
      tell(src, t("jm_at.main.claims_deleted_for", removed, targetName));
      try {
        logAdmin(src, "resetPlayerClaims", `${targetName}: ${removed}`, targetName);
      } catch (e) {
        silentCatch("resetplayerclaims_log", e);
      }
      return;
    }

    // jm_at:resetAllClaims — double-fire confirmation guards a full wipe.
    const key = src.id;
    const now = Date.now();
    const pending = _resetAllClaimsConfirm.get(key);
    if (!(pending && now - pending < RESET_CONFIRM_WINDOW_MS)) {
      _resetAllClaimsConfirm.set(key, now);
      tell(src, t("jm_at.main.reset_all_claims_confirm"));
      return;
    }
    _resetAllClaimsConfirm.delete(key);
    const removed = resetAllClaims(src);
    world.sendMessage(t("jm_at.main.all_claims_reset", removed));
    try {
      logAdmin(src, "resetAllClaims", `${removed} 个领地`);
    } catch (e) {
      silentCatch("resetallclaims_log", e);
    }
  },
  { namespaces: [NS] },
);

// =========================================================
// Owner-only settings reset via /scriptevent jm_at:resetToDefaults
// Resets every toggle/option/setting to factory defaults WITHOUT removing data.
// Preserves ownership and the access lists (admin deny list, whitelist, remote
// support grants). Double-fire confirmation guards it.
// =========================================================

const _resetDefaultsConfirm = new Map(); // src id → timestamp

system.afterEvents.scriptEventReceive.subscribe(
  (ev) => {
    if (ev.id !== `${NS}:resetToDefaults`) return;

    // Owner-only. /scriptevent runs at operator level, so without this any op
    // or command block could wipe the server's settings.
    const src = ev.sourceEntity;
    if (!src || src.typeId !== "minecraft:player" || !isOwner(src)) {
      if (src) tell(src, t("jm_at.main.reset_settings_owner_only"));
      return;
    }

    const key = src.id;
    const now = Date.now();
    const pending = _resetDefaultsConfirm.get(key);
    if (!(pending && now - pending < RESET_CONFIRM_WINDOW_MS)) {
      _resetDefaultsConfirm.set(key, now);
      tell(src, t("jm_at.main.reset_defaults_confirm"));
      return;
    }
    _resetDefaultsConfirm.delete(key);

    try {
      // Keep ownership and access control; reset every other toggle/option.
      resetCfgToDefaults([
        "ownerXuid",
        "adminDenyXuids",
        "whitelistedXuids",
        "supportAccess",
      ]);
    } catch (e) {
      silentCatch("reset_to_defaults", e);
      tell(src, t("jm_at.main.reset_defaults_failed"));
      return;
    }
    world.sendMessage(t("jm_at.main.reset_defaults_done"));
    try {
      logAdmin(src, "resetToDefaults", "配置已恢复默认值");
    } catch (e) {
      silentCatch("resettodefaults_log", e);
    }
  },
  { namespaces: [NS] },
);

// =========================================================
// Per-player data reset via /scriptevent jm_at:resetPlayerData <name>
// =========================================================

system.afterEvents.scriptEventReceive.subscribe(
  (ev) => {
  if (ev.id !== `${NS}:resetPlayerData`) return;

  // Requires a current admin. This wipes a player's data AND lifts any ban (an
  // effective offline unban), so it must be gated like the moderation UI.
  // isAdmin().ok is false for deny-listed admins (who keep operator status, so
  // /scriptevent still works) — that closes the deny-list bypass.
  const src = ev.sourceEntity;
  if (!src || src.typeId !== "minecraft:player" || !isAdmin(src).ok) {
    if (src) tell(src, t("jm_at.main.reset_pdata_admin_only"));
    return;
  }

  const targetName = (ev.message ?? "").trim();
  if (!targetName) {
    if (ev.sourceEntity) {
      tell(ev.sourceEntity, t("jm_at.main.reset_pdata_usage"));
    }
    return;
  }

  // Look up by name in the registry
  const regEntry = getRegistryEntryByName(targetName);
  if (!regEntry) {
    if (ev.sourceEntity) {
      tell(
        ev.sourceEntity,
        t("jm_at.main.player_not_in_registry", targetName),
      );
    }
    return;
  }

  const xuid = regEntry.xuid;
  const name = regEntry.name;

  // The owner's data (and ban immunity) is off-limits, mirroring requireNotOwner
  // on every other moderation path.
  const cfg = getCfg();
  if (cfg.ownerXuid && xuid === cfg.ownerXuid) {
    tell(src, t("jm_at.main.cannot_reset_owner"));
    return;
  }

  // 1. Clear world-level per-player data (registry, notes, punishments, notifs, commands)
  try {
    removePlayerData(xuid);
  } catch (e) {
    silentCatch("reset_plr_data", e);
  }

  // 2. Remove from ban ledger if present
  try {
    removeBanLedgerEntry(xuid);
  } catch (e) {
    silentCatch("reset_plr_ban", e);
  }

  // 3. If online, also clear their player-level dynamic properties and re-snapshot
  const onlinePlayer = world
    .getPlayers()
    .find((p) => getPlayerXuid(p) === xuid);
  if (onlinePlayer) {
    try {
      onlinePlayer.clearDynamicProperties();
    } catch (e) {
      silentCatch("reset_plr_dp", e);
    }
    try {
      snapshotPlayer(onlinePlayer);
    } catch (e) {
      silentCatch("reset_plr_snap", e);
    }
  }

  // 4. Invalidate caches so subsequent reads pull fresh data
  try {
    resetStorageCaches();
  } catch (e) {
    silentCatch("reset_plr_cache", e);
  }

  // Log the action
  if (ev.sourceEntity) {
    try {
      const player = /** @type {import("@minecraft/server").Player} */ (
        ev.sourceEntity
      );
      if (player.name)
        logAdmin(
          player,
          "resetPlayerData",
          `已清除玩家全部数据：${name} (${xuid})`,
        );
    } catch {}
  }

  world.sendMessage(t("jm_at.main.pdata_reset_done", name));
  },
  { namespaces: [NS] },
);
