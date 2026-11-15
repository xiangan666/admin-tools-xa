/**
 * ranks.js — Player nameTag rank prefix system
 *
 * Applies a visible [Rank] prefix above player heads via player.nameTag.
 * Updated on a 20-tick (~1s) interval so changes propagate quickly.
 *
 * Priority order:
 *   1. Admin  → §c[Admin]§r  (automatic, from permissions)
 *   2. Mod    → §g[Mod]§r    (automatic, from permissions)
 *   3. Custom → whatever the admin set in core.rankTag (e.g. "§6[VIP]§r")
 *   4. None   → nameTag reset to plain player.name
 *
 * The toggle (core.rankTagEnabled) applies to ALL ranks including auto-assigned
 * Admin/Mod prefixes, so staff can disable it if another pack conflicts.
 */

import { world, system } from "@minecraft/server";
import { getPlayerCore, getCfg } from "./storage.js";
import { isAdmin, isModerator } from "./permissions.js";

/**
 * Returns the rank prefix string for a player, or "" if none applies.
 * Does NOT include a trailing space — callers add that when building the tag.
 */
export function getEffectiveRankPrefix(player, core) {
  // If the player has explicitly disabled rank display, show nothing
  if (core.rankTagEnabled === false) return "";

  const isStaff = isAdmin(player).ok || isModerator(player);

  if (isStaff) {
    const cfg = getCfg();
    // When staffCustomRanks is enabled, a custom rank set on this player
    // takes priority over the default admin/mod tag.
    if (cfg.staffCustomRanks) {
      const custom = (core.rankTag ?? "").trim();
      if (custom.length > 0) return `${custom}§r`;
    }
    // "Hide staff ranks" suppresses the automatic [Admin]/[Mod] tag for all
    // staff. A set per-staff custom rank (handled above) is opt-in per player,
    // so it still shows.
    if (cfg.staffRanksHidden) return "";
    return isAdmin(player).ok
      ? (cfg.staffAdminTag || "§c[管理员]§r")
      : (cfg.staffModTag || "§g[协管员]§r");
  }

  const custom = (core.rankTag ?? "").trim();
  return custom.length > 0 ? `${custom}§r` : "";
}

/**
 * Builds the full nameTag string for a player.
 * Format: "[Prefix] Name"  or just "Name" when no prefix.
 */
export function buildNameTag(player, core) {
  const prefix = getEffectiveRankPrefix(player, core);
  return prefix ? `${prefix} ${player.name}` : player.name;
}

// Update all players' nameTags every 20 ticks (~1 second).
// Skips if nameTag is already correct to avoid unnecessary writes.
system.runInterval(() => {
  for (const player of world.getPlayers()) {
    try {
      const core = getPlayerCore(player);
      const desired = buildNameTag(player, core);
      if (player.nameTag !== desired) player.nameTag = desired;
    } catch {}
  }
}, 20);
