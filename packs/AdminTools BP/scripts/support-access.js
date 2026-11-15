/**
 * support-access.js — Owner-consented remote support access
 *
 * Lets a designated support technician (JM's team) gain admin-level access to a
 * world ONLY after someone with authority in that world explicitly grants it
 * from the Admin Tool. Nothing here is hidden or automatic:
 *
 *   - Access is OFF by default. The support tech has no special power until an
 *     operator/owner grants it.
 *   - The grant is typed into Admin Tool → Commands → Quick Run, is announced
 *     to all online admins, and is written to the admin log.
 *   - Either side can revoke it at any time, and it can be wiped via the normal
 *     data-reset path (cfg.supportAccess).
 *
 * Commands (typed into Admin Tool → Commands → Quick Run; `$$` wrapper optional,
 * kept for parity with the old chat syntax):
 *
 *   Run by an operator / AdminTools owner (the person who controls the world):
 *     grant "<name>" access     → grant support access to <name>
 *     revoke "<name>" access    → revoke it
 *
 *   Run by the granted support tech:
 *     open diag menu            → open the support/diagnostics menu
 *
 * This is intentionally a typed command rather than a visible button — the
 * feature should almost never be used, so it stays out of the normal menus.
 *
 * NOTE: chat interception (beforeEvents/afterEvents.chatSend) is an
 * experimental-only API and is NOT present in the stable @minecraft/server
 * module this addon targets — that's why these run through Quick Run rather
 * than chat tokens.
 *
 * The set of names that CAN be granted is intentionally fixed to the support
 * team (ALLOWED_SUPPORT). Listing a name there does NOT grant access — it only
 * means the owner is allowed to grant that name. Consent still comes from the
 * owner performing the grant.
 */

import { world, system } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { NS, SUPPORT_ACCESS_NAMES, ITEMS } from "./constants.js";
import { giveItem, hasItem } from "./players.js";
import { getCfg, setCfg } from "./storage.js";
import {
  isAdmin,
  isOwner,
  isModerator,
  assignModerator,
  removeModerator,
} from "./permissions.js";
import {
  getPlayerXuid,
  tell,
  broadcastAdmins,
  silentCatch,
} from "./utils.js";
import { logAdmin } from "./log.js";
import { t } from "./i18n.js";
import { showAdminPanel } from "./ui-admin.js";
import { runDebugVerbose, runEnvInfo } from "./jm_debug.js";
import { showStressTest } from "./stress-test.js";

// Support technicians who MAY be granted access. Normalized (lowercased,
// trimmed) for comparison so "DEATHLY PAIN" === "deathly pain".
const ALLOWED_SUPPORT = new Set(SUPPORT_ACCESS_NAMES);

const norm = (s) => String(s ?? "").trim().toLowerCase();

function isAllowedSupportName(name) {
  return ALLOWED_SUPPORT.has(norm(name));
}

/** True if `name` currently has consented support access in this world. */
function hasSupportAccess(name) {
  const list = getCfg().supportAccess ?? [];
  return list.some((e) => e.name === norm(name));
}

/** A player counts as a support tech only if allowed AND currently granted. */
export function isGrantedSupport(player) {
  return isAllowedSupportName(player.name) && hasSupportAccess(player.name);
}

// =========================================================
// Grant / revoke
// =========================================================

/**
 * Apply the live effect of an existing grant to an online player: give them the
 * "admin" tag so isAdmin() recognizes them (works with cheats off). Called on
 * grant and on join for already-granted techs.
 */
function applyAccess(player) {
  try {
    if (!player.hasTag("admin")) player.addTag("admin");
  } catch (e) {
    silentCatch("support_apply_access", e);
  }
}

/** Remove the live admin/mod effect from an online player. */
function clearAccess(player) {
  try {
    player.removeTag("admin");
  } catch {}
  try {
    removeModerator(player);
  } catch {}
}

/**
 * Grant support access to a name. `granter` is the operator/owner who consented.
 * Returns a short status string for feedback.
 */
function grant(granter, name) {
  if (!isAllowedSupportName(name)) {
    return t("jm_at.support.not_recognized", name);
  }
  const cfg = getCfg();
  cfg.supportAccess = cfg.supportAccess ?? [];
  const key = norm(name);
  if (!cfg.supportAccess.some((e) => e.name === key)) {
    cfg.supportAccess.push({
      name: key,
      grantedByName: granter.name,
      grantedByXuid: getPlayerXuid(granter),
      at: Date.now(),
    });
    setCfg(cfg);
  }
  // Apply to the tech if they are already online: give the admin tag plus the
  // Admin Tool so they have a UI entry point (works with cheats off).
  for (const p of world.getPlayers()) {
    if (norm(p.name) === key) {
      applyAccess(p);
      try {
        if (!hasItem(p, ITEMS.adminTool)) giveItem(p, ITEMS.adminTool);
      } catch (e) {
        silentCatch("support_grant_giveitem", e);
      }
      tell(
        p,
        "§2[支持] 你已获得此世界的支持访问权限。请在§f管理工具§2 → §f命令 → 快速运行§2 中输入 §fopen diag menu§2。",
      );
    }
  }
  broadcastAdmins(t("jm_at.support.granted_broadcast", granter.name, name));
  try {
    logAdmin(granter, "SUPPORT_GRANT", `→ ${name}`, name);
  } catch (e) {
    silentCatch("support_grant_log", e);
  }
  return t("jm_at.support.granted_feedback", name);
}

/** Revoke support access. `by` is whoever ran the command (owner or the tech). */
function revoke(by, name) {
  const cfg = getCfg();
  const key = norm(name);
  const before = (cfg.supportAccess ?? []).length;
  cfg.supportAccess = (cfg.supportAccess ?? []).filter((e) => e.name !== key);
  setCfg(cfg);
  for (const p of world.getPlayers()) {
    if (norm(p.name) === key) {
      clearAccess(p);
      tell(p, "§c[支持] 你在此世界的支持访问权限已被撤销。");
    }
  }
  broadcastAdmins(t("jm_at.support.revoked_broadcast", by.name, name));
  try {
    logAdmin(by, "SUPPORT_REVOKE", `→ ${name}`, name);
  } catch (e) {
    silentCatch("support_revoke_log", e);
  }
  return before > (cfg.supportAccess?.length ?? 0)
    ? t("jm_at.support.revoked_feedback", name)
    : t("jm_at.support.revoke_none", name);
}

// =========================================================
// Diagnostics menu (chat-opened, cheats-off friendly)
//
// Diagnostic text uses server-side Chinese; command syntax remains literal.
// Owner/admin grant/revoke feedback uses jm_at.support.* translation keys.
// =========================================================

export function showDiagMenu(player) {
  const selfAdmin = isAdmin(player).ok;
  const selfMod = isModerator(player);
  const form = new ActionFormData()
    .title("§l支持与诊断")
    .body(
      "§7由服主批准的支持访问权限。\n" +
        `§7管理员: ${selfAdmin ? "§a开启" : "§c关闭"}§7   协管员: ${selfMod ? "§a开启" : "§c关闭"}§r\n`,
    )
    .button(selfAdmin ? "移除自己的管理员身份" : "授予自己管理员身份")
    .button(selfMod ? "移除自己的协管员身份" : "授予自己协管员身份")
    .button("打开管理面板")
    .button("运行诊断")
    .button("存储与压力测试")
    .button("环境与运行信息")
    .button("§c撤销我的支持权限")
    .button("关闭");

  form.show(player).then((res) => {
    if (res.canceled) return;
    switch (res.selection) {
      case 0: // toggle own admin
        if (player.hasTag("admin")) {
          player.removeTag("admin");
          tell(player, "§e[支持] 已移除你的管理员标签。");
        } else {
          player.addTag("admin");
          tell(player, "§2[支持] 已授予自己管理员身份。");
        }
        try {
          logAdmin(player, "SUPPORT_SELF_ADMIN", player.hasTag("admin") ? "开启" : "关闭");
        } catch {}
        break;
      case 1: // toggle own mod
        if (isModerator(player)) {
          removeModerator(player);
          tell(player, "§e[支持] 已移除你的协管员身份。");
        } else if (isAdmin(player).ok) {
          tell(player, "§e[支持] 你已是管理员，无需重复授予协管员身份。如需仅保留协管员，请先移除管理员身份。");
        } else {
          assignModerator(player);
          tell(player, "§2[支持] 已授予自己协管员身份。");
        }
        break;
      case 2: // admin panel
        if (isAdmin(player).ok) showAdminPanel(player);
        else tell(player, "§c请先授予自己管理员身份。");
        return;
      case 3: // diagnostics
        runDebugVerbose(player);
        return;
      case 4: // storage stress test (needs admin — same gate as the panel)
        if (isAdmin(player).ok) showStressTest(player);
        else tell(player, "§c请先授予自己管理员身份。");
        return;
      case 5: // environment / runtime info (read-only, no admin needed)
        runEnvInfo(player);
        return;
      case 6: // revoke self
        tell(player, revoke(player, player.name));
        return;
      default:
        return;
    }
    // Re-open so the tech can chain toggles, except for terminal actions above.
    system.run(() => showDiagMenu(player));
  });
}

// =========================================================
// Command-input parsing (Admin Tool → Commands → Quick Run)
// =========================================================
//
// These were chat commands; chatSend is experimental-only and absent from the
// stable @minecraft/server module, so they now run by being typed into the
// Quick Run command field instead. The `$$...$$` wrapper is optional there.
//
//   grant "<name>" access     → grant support access to <name>   (admin/owner)
//   revoke "<name>" access    → revoke it            (admin/owner, or self)
//   open diag menu            → open the diagnostics menu  (granted tech)

const RE_GRANT = /^(?:\$\$)?\s*grant\s+"([^"]+)"\s+access\s*(?:\$\$)?$/i;
const RE_REVOKE = /^(?:\$\$)?\s*revoke\s+"([^"]+)"\s+access\s*(?:\$\$)?$/i;
const RE_DIAG = /^(?:\$\$)?\s*open\s+diag\s+menu\s*(?:\$\$)?$/i;

/**
 * Inspect a raw command-input string for a support-access command and, if it
 * matches one, run it (with the same consent gates the chat version had).
 * Returns one of:
 *   false  — not a support command; caller should run it normally.
 *   "ran"  — handled (grant/revoke); caller may reopen its own menu.
 *   "menu" — handled AND already opened a follow-up form (diag); caller must
 *            NOT open another form or it'll collide ("UserBusy").
 */
export function handleSupportCommand(player, raw) {
  const text = String(raw ?? "").trim();

  const mGrant = text.match(RE_GRANT);
  if (mGrant) {
    const name = mGrant[1];
    // Consent gate: only someone who controls the world may grant.
    if (!isAdmin(player).ok && !isOwner(player)) {
      tell(player, t("jm_at.support.gate_grant"));
    } else {
      tell(player, grant(player, name));
    }
    return "ran";
  }

  const mRevoke = text.match(RE_REVOKE);
  if (mRevoke) {
    const name = mRevoke[1];
    // The owner/operator can revoke anyone; a support tech can revoke themself.
    const selfRevoke = norm(player.name) === norm(name) && isAllowedSupportName(name);
    if (!isAdmin(player).ok && !isOwner(player) && !selfRevoke) {
      tell(player, t("jm_at.support.gate_revoke"));
    } else {
      tell(player, revoke(player, name));
    }
    return "ran";
  }

  if (RE_DIAG.test(text)) {
    if (!isGrantedSupport(player)) {
      tell(player, t("jm_at.support.no_access"));
      return "ran";
    }
    applyAccess(player);
    // Defer so the diagnostics form opens cleanly after the Quick Run form closes.
    system.run(() => showDiagMenu(player));
    return "menu";
  }

  return false;
}

// =========================================================
// Re-apply on join for already-consented techs
// =========================================================

world.afterEvents.playerSpawn.subscribe((ev) => {
  if (!ev.initialSpawn) return;
  const player = ev.player;
  if (!player) return;
  system.runTimeout(() => {
    try {
      if (player.isValid && isGrantedSupport(player)) {
        applyAccess(player);
        try {
          if (!hasItem(player, ITEMS.adminTool)) giveItem(player, ITEMS.adminTool);
        } catch (e) {
          silentCatch("support_join_giveitem", e);
        }
        tell(
          player,
          "§7[支持] 你已获得服主同意的支持访问权限。请在管理工具 → §f命令 → 快速运行§7 中输入 §fopen diag menu§7。",
        );
      }
    } catch (e) {
      silentCatch("support_join_reapply", e);
    }
  }, 30);
});
