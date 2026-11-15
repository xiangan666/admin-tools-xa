/**
 * permissions.js — Admin and moderator permission checks
 *
 * Roles (in descending order of privilege):
 *   owner     — cfg.ownerXuid; always admin, can never be denied
 *   admin     — op level > 0, permission level Operator or above (not Visitor/Member), or "admin" tag
 *               UNLESS their XUID is on the owner-set admin deny-list (cfg.adminDenyXuids),
 *               which strips Admin Tools access while leaving operator status intact.
 *   moderator — jm_at:role dynamic property === "moderator" (set via admin UI)
 *
 * Dynamic property is used instead of tags so assignment works without cheats.
 */

import { PlayerPermissionLevel } from "@minecraft/server";
import { NS, PKEY } from "./constants.js";
import {
  getCfg,
  getModOverrides,
  getAdminOverrides,
  isAdminDenied,
} from "./storage.js";
import { getPlayerXuid, silentCatch, safeJsonParse } from "./utils.js";

/**
 * Read a staff member's effective override map, preferring world-level storage
 * (keyed by XUID, editable while offline) and falling back to the legacy
 * entity-level property for any player whose data hasn't migrated yet.
 * `which` is "mod" or "admin". Returns an object (possibly empty) or null.
 */
function readOverrides(player, which) {
  try {
    const xuid = getPlayerXuid(player);
    const world =
      which === "admin" ? getAdminOverrides(xuid) : getModOverrides(xuid);
    if (world && typeof world === "object") return world;
  } catch (e) {
    silentCatch("perm_read_overrides_world", e);
  }
  try {
    const legacyKey =
      which === "admin" ? PKEY.adminOverrides : PKEY.modOverrides;
    const raw = player.getDynamicProperty(legacyKey);
    if (typeof raw === "string") return safeJsonParse(raw, {});
  } catch (e) {
    silentCatch("perm_read_overrides_legacy", e);
  }
  return null;
}

// Mod privileges that are ON by default for moderators when the owner hasn't
// set them explicitly. Still fully disableable via the Mod Privileges UI or a
// per-mod override. (Admins already default to all-on via adminCan.)
export const MOD_PRIV_DEFAULT_ON = new Set(["homes"]);

/**
 * Map a rank's name and/or display tag to the staff role it should grant, or
 * null. Exact match on a normalized form: color/format codes, brackets, spaces
 * and punctuation are stripped and the result is lowercased.
 *   admin / administrator → "admin"
 *   mod / moderator       → "moderator"
 */
function _normalizeRankLabel(s) {
  return String(s ?? "")
    .replace(/§./g, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
}

export function detectRankRole(...labels) {
  for (const label of labels) {
    const n = _normalizeRankLabel(label);
    if (n === "admin" || n === "administrator") return "admin";
    if (n === "mod" || n === "moderator") return "moderator";
  }
  return null;
}

/**
 * True if a command string is a /gamemode change. Used to stop staff without the
 * `gamemode` privilege from changing gamemodes through the addon's command runner
 * (saved commands / Quick Run / scheduled). Vanilla chat /gamemode can't be
 * intercepted.
 *
 * Catches both the direct form (`gamemode creative`, with or without a leading
 * slash) and the execute-wrapped form (`execute as @s run gamemode creative`).
 * The command runner executes with elevated permission, so without the `run
 * gamemode` branch `execute` would be a way around the toggle.
 */
export function isGamemodeCommand(s) {
  return /(?:^\s*\/?\s*|\brun\s+)gamemode(?:\s|$)/i.test(String(s ?? ""));
}

/**
 * True if a command string is one the addon's command runner (Quick Run, saved
 * commands, scheduled commands) must NEVER execute, regardless of privilege.
 * Those paths run with elevated permission, so without this filter a staff
 * member holding only the "commands" privilege could escalate their own role or
 * grant operator. Unlike gamemode (which a privilege can unlock), these are
 * blocked outright — the proper role-management UI exists for the legitimate use.
 *
 * Blocked verbs:
 *   - op / deop                       — operator escalation
 *   - tag <target> add|remove admin|administrator|mod|moderator
 *                                       — staff roles are tag-detected, so this is
 *                                         a direct self/other promotion to staff
 *   - function / scriptevent          — wrappers whose contents this filter can't
 *                                         see, so they could re-introduce any of
 *                                         the above
 * Each pattern also matches the `execute … run <cmd>` wrapper (mirroring
 * isGamemodeCommand) so the wrapper can't be used to slip past the filter.
 */
export function isBlockedStaffCommand(s) {
  const str = String(s ?? "");
  return (
    /(?:^\s*\/?\s*|\brun\s+)(?:de)?op\b/i.test(str) ||
    /(?:^\s*\/?\s*|\brun\s+)tag\b[\s\S]*?\b(?:add|remove)\b[\s\S]*?\b(?:admin|administrator|mod|moderator)\b/i.test(
      str,
    ) ||
    /(?:^\s*\/?\s*|\brun\s+)(?:function|scriptevent)\b/i.test(str)
  );
}

export function isAdmin(player) {
  // The owner is always an admin and can never be denied.
  if (isOwner(player)) return { ok: true, mode: "owner" };
  // Owner-set deny-list: an OP or tagged player whose Admin Tools access was
  // removed. They keep their operator status (so other addons that require OP
  // still work) but are not treated as an admin here until re-granted.
  try {
    if (isAdminDenied(getPlayerXuid(player)))
      return { ok: false, mode: "denied" };
  } catch (e) { silentCatch("perm_isAdmin_denied", e); }
  try {
    const cpl = player.commandPermissionLevel;
    if (cpl !== undefined && Number(cpl) > 0) return { ok: true, mode: "perm" };
  } catch (e) { silentCatch("perm_isAdmin_cmdLvl", e); }
  try {
    const lvl = player.playerPermissionLevel;
    if (lvl !== undefined && lvl !== PlayerPermissionLevel.Member && lvl !== PlayerPermissionLevel.Visitor)
      return { ok: true, mode: "perm" };
  } catch (e) { silentCatch("perm_isAdmin_playerLvl", e); }
  try {
    if (player.hasTag("admin")) return { ok: true, mode: "tag" };
  } catch (e) { silentCatch("perm_isAdmin_tag", e); }
  return { ok: false, mode: "none" };
}

export function requireAdmin(player, action) {
  const res = isAdmin(player);
  if (!res.ok) throw new Error(`您没有执行此操作的权限。（操作标识：${action}）`);
  return res;
}

/**
 * True if the player holds Minecraft operator status — command permission level
 * above 0, or an elevated player-permission level. This is the engine-level
 * "is an operator" signal, independent of the addon's `admin` tag, and is used
 * by the join-time tag reconciliation to recognize a legitimate admin (an
 * operator's admin status doesn't depend on the spoofable tag).
 */
export function hasOperatorStatus(player) {
  try {
    const cpl = player.commandPermissionLevel;
    if (cpl !== undefined && Number(cpl) > 0) return true;
  } catch (e) { silentCatch("perm_hasOp_cmdLvl", e); }
  try {
    const lvl = player.playerPermissionLevel;
    if (
      lvl !== undefined &&
      lvl !== PlayerPermissionLevel.Member &&
      lvl !== PlayerPermissionLevel.Visitor
    )
      return true;
  } catch (e) { silentCatch("perm_hasOp_playerLvl", e); }
  return false;
}

/**
 * True if the player has been assigned the moderator role via dynamic property
 * AND is not already an admin (admins outrank moderators).
 */
export function isModerator(player) {
  try {
    if (isAdmin(player).ok) return false;
    if (player.getDynamicProperty(PKEY.role) === "moderator") return true;
    // Also recognize a vanilla tag, mirroring how the "admin" tag works, so
    // `/tag <player> add moderator` (or mod) grants the role.
    return player.hasTag("moderator") || player.hasTag("mod");
  } catch {
    return false;
  }
}

/** True if player is an admin or a moderator. */
export function isStaff(player) {
  return isAdmin(player).ok || isModerator(player);
}

export function requireStaff(player, action) {
  if (!isStaff(player)) throw new Error(`您没有执行此操作的权限。（操作标识：${action}）`);
}

/**
 * Allows admin OR moderator with a specific privilege enabled.
 * Throws if neither condition is met.
 */
export function requireAdminOrModCan(player, privKey, action) {
  if (isOwner(player)) return;
  if (isAdmin(player).ok) {
    if (adminCan(player, privKey)) return;
    throw new Error(`您没有执行此操作的权限。（操作标识：${action}）`);
  }
  if (isModerator(player)) {
    // Check per-mod overrides first, then fall back to global privileges
    const overrides = readOverrides(player, "mod");
    if (overrides && privKey in overrides) {
      if (overrides[privKey]) return;
      throw new Error(`您没有执行此操作的权限。（操作标识：${action}）`);
    }
    const cfg = getCfg();
    const mp = cfg.modPrivileges ?? {};
    if (privKey in mp ? !!mp[privKey] : MOD_PRIV_DEFAULT_ON.has(privKey)) return;
  }
  throw new Error(`您没有执行此操作的权限。（操作标识：${action}）`);
}

/**
 * Record that a player holds the admin role in the addon's private, un-spoofable
 * store — a dynamic property that vanilla /tag, command blocks and functions
 * cannot set. The public `admin` tag is still added by the caller (used for
 * detection and cheats-off support access), but THIS is the authoritative record
 * the join-time reconciliation uses to tell a legitimately-assigned admin from a
 * planted `admin` tag. Mirrors assignModerator.
 */
export function assignAdmin(player) {
  try {
    player.setDynamicProperty(PKEY.role, "admin");
    return true;
  } catch {
    return false;
  }
}

/** Clear any recorded staff role (admin or moderator) from the private store.
 *  Call when revoking admin so reconciliation no longer treats the tag as
 *  legitimate. (removeModerator already clears it for the mod case.) */
export function clearStaffRole(player) {
  try {
    player.setDynamicProperty(PKEY.role, undefined);
    return true;
  } catch {
    return false;
  }
}

/** Assign moderator role to a player. Fails silently if they are already an admin. */
export function assignModerator(player) {
  if (isAdmin(player).ok) return false;
  try {
    player.setDynamicProperty(PKEY.role, "moderator");
    return true;
  } catch {
    return false;
  }
}

/** Remove moderator role from a player. */
export function removeModerator(player) {
  try {
    player.setDynamicProperty(PKEY.role, undefined);
    // Clear tag-based assignment too, so Remove works regardless of how the
    // role was granted (UI property or /tag).
    try { player.removeTag("moderator"); } catch {}
    try { player.removeTag("mod"); } catch {}
    return true;
  } catch {
    return false;
  }
}

/** True if the player is the designated server owner. */
export function isOwner(player) {
  try {
    const cfg = getCfg();
    if (!cfg.ownerXuid) return false;
    return getPlayerXuid(player) === cfg.ownerXuid;
  } catch {
    return false;
  }
}

/**
 * Throws if the target player is the server owner.
 * Call this before executing any moderation action on a target.
 */
export function requireNotOwner(target, action) {
  if (isOwner(target)) {
    throw new Error(`不能对服主执行此操作。（操作标识：${action}）`);
  }
}

/**
 * Role-hierarchy guard: throws if the acting staff member does NOT outrank the
 * target — i.e. a moderator attempting a staff action on an admin or the owner.
 * Admins are peers (an admin may act on another admin); the owner outranks
 * everyone (and is separately protected by requireNotOwner for destructive
 * actions). Call this in addition to requireAdminOrModCan on any intrusive
 * action a moderator could aim at a higher-ranked staff member (freeze, kick,
 * ban, warn, summon, gamemode, spy, inventory). `target` is a live Player.
 */
export function requireOutranksTarget(actor, target, action) {
  if (isOwner(actor)) return; // the owner outranks everyone
  if (isModerator(actor) && (isAdmin(target).ok || isOwner(target))) {
    throw new Error(
      `协管员不能对更高权限的管理成员执行此操作。（操作标识：${action}）`,
    );
  }
}

/**
 * Offline variant of requireOutranksTarget. The target is a registry entry
 * rather than a live Player, so the caller passes the resolved role string
 * (entry.role: "admin" | "moderator" | "owner" | ""). Same rule: a moderator
 * may not act on an admin or the owner.
 */
export function requireOutranksRole(actor, targetRole, action) {
  if (isOwner(actor)) return;
  if (isModerator(actor) && (targetRole === "admin" || targetRole === "owner")) {
    throw new Error(
      `协管员不能对更高权限的管理成员执行此操作。（操作标识：${action}）`,
    );
  }
}

/**
 * Returns true if the player may use the capability `key`.
 *  - Server owner: always allowed.
 *  - Admin: allowed unless the owner has disabled it for admins (see adminCan).
 *    Admins default to all-on, so existing setups are unaffected until changed.
 *  - Moderator: per-mod override, else the global modPrivileges default.
 */
export function modCan(player, key) {
  if (isOwner(player)) return true;
  if (isAdmin(player).ok) return adminCan(player, key);
  if (!isModerator(player)) return false;
  const overrides = readOverrides(player, "mod");
  if (overrides && key in overrides) return !!overrides[key];
  const global = getCfg().modPrivileges ?? {};
  if (key in global) return !!global[key];
  return MOD_PRIV_DEFAULT_ON.has(key);
}

/**
 * Returns true if an admin may use the capability `key`.
 * Owner is always allowed; non-admins get false. Admins check their per-admin
 * overrides first, then the global cfg.adminPrivileges. An unset key defaults to
 * TRUE so admins keep full power until the owner explicitly disables it.
 */
export function adminCan(player, key) {
  if (isOwner(player)) return true;
  if (!isAdmin(player).ok) return false;
  const overrides = readOverrides(player, "admin");
  if (overrides && key in overrides) return !!overrides[key];
  const ap = getCfg().adminPrivileges ?? {};
  return key in ap ? !!ap[key] : true;
}
