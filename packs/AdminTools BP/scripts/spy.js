/**
 * spy.js - Camera spy mode
 * Lets admins silently watch a target player via a free camera positioned
 * behind the target's head. Stops automatically when the target logs off
 * or when the admin crouches/jumps.
 *
 * While spying the admin is switched to spectator mode, which natively
 * provides invisibility and invulnerability. Their original game mode is
 * restored when the session ends.
 *
 * Cross-dimension: the camera command always operates in the admin's current
 * dimension. When the target is in a different dimension the admin is silently
 * teleported there so the camera renders correctly. Their original position is
 * restored when the session ends.
 */

import { system, world, InputButton, ButtonState, EasingType } from "@minecraft/server";
import { NS, LIMITS } from "./constants.js";
import { nowMs, getPlayerXuid, silentCatch } from "./utils.js";
import { t } from "./i18n.js";
import { requireAdminOrModCan, requireOutranksTarget } from "./permissions.js";
import { logAdmin } from "./log.js";
import { getPlayerCore, setPlayerCore } from "./storage.js";
import { teleportedPlayers } from "./players.js";

// Map<adminId, intervalId>
const spyIntervals = new Map();

// Map<adminId, targetName> — tracks who each admin is watching (for debug)
const spyTargets = new Map();

// Map<adminId, { loc: {x,y,z}, dimId: string, savedGameMode: string }>
// Captures the admin's position and game mode at spy-start so we can restore them on end.
const spyOrigins = new Map();

/** Returns a snapshot of active spy sessions for debug output. */
export function getSpySessions() {
  const sessions = [];
  for (const [adminId, targetName] of spyTargets) {
    const admin = world.getPlayers().find((p) => p.id === adminId);
    if (admin) sessions.push({ adminName: admin.name, targetName });
  }
  return sessions;
}

// Dynamic property key used to persist spy origin across disconnects.
const SPY_ORIGIN_PROP = `${NS}:spy_origin`;

function persistOrigin(admin, origin) {
  try {
    admin.setDynamicProperty(
      SPY_ORIGIN_PROP,
      JSON.stringify({
        loc: origin.loc,
        dimId: origin.dimId,
        savedGameMode: origin.savedGameMode,
      }),
    );
  } catch (e) { silentCatch("spy_persist_origin", e); }
}

function clearOriginProp(admin) {
  try {
    admin.setDynamicProperty(SPY_ORIGIN_PROP, undefined);
  } catch (e) { silentCatch("spy_clear_origin", e); }
}

// On reconnect, restore position/game-mode left over from an interrupted spy session.
world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (!initialSpawn) return; // only on fresh join, not respawn-from-death
  try {
    const raw = player.getDynamicProperty(SPY_ORIGIN_PROP);
    if (typeof raw !== "string") return;
    const origin = JSON.parse(raw);
    clearOriginProp(player);

    // Restore the admin's original game mode (default to survival for old-format origins).
    try {
      player.runCommand(`gamemode ${origin.savedGameMode ?? "survival"}`);
    } catch {}

    // Return to original dimension/location if the admin disconnected elsewhere.
    if (origin.dimId && player.dimension.id !== origin.dimId) {
      try {
        teleportedPlayers.add(player.id);
        player.teleport(origin.loc, {
          dimension: world.getDimension(origin.dimId.replace("minecraft:", "")),
        });
      } catch {}
    }

    player.sendMessage(t("jm_at.spy.interrupted"));
  } catch {}
});

const SPY_REMINDER = t("jm_at.spy.reminder");
const SPY_ORBIT_DEFAULT = 3;
const SPY_ORBIT_MIN = 1.5;
const SPY_ORBIT_MAX = 10;
const SPY_ORBIT_STEP = 0.2;
const SPY_ORBIT_INPUT_THRESHOLD = 0.02;
const SPY_ORBIT_ADJUST_COOLDOWN = 2; // ticks

/** Record a spy session into target player's core (spy history). */
function recordSpyHistory(targetName, adminName, adminXuid) {
  try {
    const target = world.getPlayers().find((p) => p.name === targetName);
    if (!target) return;
    const core = getPlayerCore(target);
    if (!Array.isArray(core.spyHistory)) core.spyHistory = [];
    core.spyHistory.unshift({
      at: nowMs(),
      byName: adminName,
      byXuid: adminXuid,
    });
    if (core.spyHistory.length > LIMITS.SPY_HISTORY_MAX)
      core.spyHistory.length = LIMITS.SPY_HISTORY_MAX;
    setPlayerCore(target, core);
  } catch {}
}

/**
 * Clear the interval, restore game mode, clear the camera, and if the admin was
 * moved to another dimension during the session return them to where they started.
 */
function finishSpy(adminId, currentAdmin) {
  const intervalId = spyIntervals.get(adminId);
  if (intervalId !== undefined) {
    system.clearRun(intervalId);
    spyIntervals.delete(adminId);
  }
  spyTargets.delete(adminId);

  const origin = spyOrigins.get(adminId);
  spyOrigins.delete(adminId);

  if (currentAdmin) {
    clearOriginProp(currentAdmin);

    // Restore the admin's original game mode before teleporting back.
    if (origin?.savedGameMode) {
      try {
        currentAdmin.runCommand(`gamemode ${origin.savedGameMode}`);
      } catch {}
    }

    if (origin) {
      const dx = currentAdmin.location.x - origin.loc.x;
      const dy = currentAdmin.location.y - origin.loc.y;
      const dz = currentAdmin.location.z - origin.loc.z;
      const dist = Math.hypot(dx, dy, dz);
      if (currentAdmin.dimension.id !== origin.dimId || dist > 0.01) {
        try {
          teleportedPlayers.add(currentAdmin.id);
          currentAdmin.teleport(origin.loc, {
            dimension: world.getDimension(origin.dimId.replace("minecraft:", "")),
          });
        } catch {}
      }
    }
  }

  // Clear camera after a short delay so it doesn't flicker at the restored position.
  system.runTimeout(() => {
    try {
      const a = world.getPlayers().find((p) => p.id === adminId);
      if (a) a.camera.clear();
    } catch {}
  }, 5);
}

/**
 * Start spying on targetName for admin.
 * Calling again replaces any existing spy session.
 */
export function startSpy(admin, targetName) {
  requireAdminOrModCan(admin, "spyCamera", "监视玩家");
  // A moderator may not spy on an admin or the owner. Resolve the live target
  // by name; if they're offline there's nothing to spy on anyway.
  const spyTarget = world.getPlayers().find((p) => p.name === targetName);
  if (spyTarget) requireOutranksTarget(admin, spyTarget, "监视玩家");
  stopSpy(admin); // clear any existing session first

  const adminId = admin.id;

  // Save where the admin is right now so we can return them later.
  let savedGameMode = "survival";
  try {
    savedGameMode = admin.getGameMode?.()?.toLowerCase() ?? "survival";
  } catch {}

  const origin = {
    loc: { x: admin.location.x, y: admin.location.y, z: admin.location.z },
    dimId: admin.dimension.id,
    savedGameMode,
  };
  spyOrigins.set(adminId, origin);
  // Persist so position/game-mode can be recovered if the admin disconnects mid-session.
  persistOrigin(admin, origin);

  // Switch to spectator mode — makes the admin invisible and invulnerable.
  try {
    admin.runCommand("gamemode spectator");
  } catch {}

  let orbitDistance = SPY_ORBIT_DEFAULT;
  let movementAnchor = {
    x: admin.location.x,
    y: admin.location.y,
    z: admin.location.z,
  };
  let lastAdminLoc = { ...movementAnchor };
  let adjustCooldown = 0;

  const intervalId = system.runInterval(() => {
    let currentAdmin;
    try {
      currentAdmin = world.getPlayers().find((p) => p.id === adminId);
      const currentTarget = world.getPlayers().find((p) => p.name === targetName);

      if (!currentAdmin) {
        system.clearRun(intervalId);
        spyIntervals.delete(adminId);
        spyTargets.delete(adminId);
        spyOrigins.delete(adminId);
        return;
      }

      // ── Check for exit input FIRST, before any teleport ──
      // In free camera mode (especially on Xbox/Realms), isSneaking may not
      // update because the game routes input to the camera system instead of
      // the player entity. Use the raw inputInfo button state as the primary
      // check, with isSneaking as fallback. Also accept jump as an
      // alternative exit since it is always processed.
      let wantsExit = false;
      try {
        const info = currentAdmin.inputInfo;
        if (info) {
          wantsExit =
            info.getButtonState(InputButton.Sneak) === ButtonState.Pressed ||
            info.getButtonState(InputButton.Jump) === ButtonState.Pressed;
        }
      } catch {}
      if (!wantsExit) {
        try { wantsExit = currentAdmin.isSneaking; } catch {}
      }
      if (wantsExit) {
        finishSpy(adminId, currentAdmin);
        currentAdmin.sendMessage(t("jm_at.spy.ended"));
        logAdmin(currentAdmin, "SPY_STOP", targetName);
        return;
      }

      if (!currentTarget) {
        finishSpy(adminId, currentAdmin);
        currentAdmin.sendMessage(t("jm_at.spy.target_offline", targetName));
        return;
      }

      const adminLoc = currentAdmin.location;
      const lookDir = currentAdmin.getViewDirection();
      // Horizontal-only direction (for forward/back movement detection).
      const lookLen = Math.hypot(lookDir.x, lookDir.z);
      const lookX = lookLen > 0.001 ? lookDir.x / lookLen : 0;
      const lookZ = lookLen > 0.001 ? lookDir.z / lookLen : 1;
      // Full 3D normalized direction (for spherical orbit positioning).
      const lookLen3D = Math.hypot(lookDir.x, lookDir.y, lookDir.z);
      const normX = lookLen3D > 0.001 ? lookDir.x / lookLen3D : lookX;
      const normY = lookLen3D > 0.001 ? lookDir.y / lookLen3D : 0;
      const normZ = lookLen3D > 0.001 ? lookDir.z / lookLen3D : lookZ;

      // Use forward/back movement intent to change orbit distance.
      const dx = adminLoc.x - lastAdminLoc.x;
      const dz = adminLoc.z - lastAdminLoc.z;
      if (adjustCooldown > 0) adjustCooldown--;
      if (adjustCooldown <= 0) {
        const forwardDelta = dx * lookX + dz * lookZ;
        if (forwardDelta > SPY_ORBIT_INPUT_THRESHOLD) {
          orbitDistance = Math.max(SPY_ORBIT_MIN, orbitDistance - SPY_ORBIT_STEP);
          adjustCooldown = SPY_ORBIT_ADJUST_COOLDOWN;
        } else if (forwardDelta < -SPY_ORBIT_INPUT_THRESHOLD) {
          orbitDistance = Math.min(SPY_ORBIT_MAX, orbitDistance + SPY_ORBIT_STEP);
          adjustCooldown = SPY_ORBIT_ADJUST_COOLDOWN;
        }
      }

      // Keep admin body frozen at anchor while spying.
      const drift = Math.hypot(
        adminLoc.x - movementAnchor.x,
        adminLoc.z - movementAnchor.z,
      );
      const yDrift = Math.abs(adminLoc.y - movementAnchor.y);
      if (drift > 0.1 || yDrift > 0.1) {
        try {
          teleportedPlayers.add(currentAdmin.id);
          currentAdmin.teleport(movementAnchor, {
            dimension: currentAdmin.dimension,
          });
        } catch {}
        lastAdminLoc = { ...movementAnchor };
      } else {
        lastAdminLoc = { x: adminLoc.x, y: adminLoc.y, z: adminLoc.z };
      }

      // Keep a persistent actionbar hint while spy mode is active.
      try {
        currentAdmin.onScreenDisplay.setActionBar(SPY_REMINDER);
      } catch {}

      // If target moved to a different dimension, silently follow them.
      if (currentAdmin.dimension.id !== currentTarget.dimension.id) {
        try {
          teleportedPlayers.add(currentAdmin.id);
          currentAdmin.teleport(currentTarget.location, {
            dimension: currentTarget.dimension,
          });
          movementAnchor = {
            x: currentTarget.location.x,
            y: currentTarget.location.y,
            z: currentTarget.location.z,
          };
          lastAdminLoc = { ...movementAnchor };
        } catch {}
        return; // skip camera update this tick - let the teleport settle
      }

      // If the target moved far away in the same dimension, re-anchor the
      // admin near them.  Without this the admin entity can end up in
      // unloaded chunks, which makes input processing (sneaking, movement)
      // unreliable — especially on console platforms like Xbox.
      const tLoc = currentTarget.location;
      const anchorDist = Math.hypot(
        movementAnchor.x - tLoc.x,
        movementAnchor.y - tLoc.y,
        movementAnchor.z - tLoc.z,
      );
      if (anchorDist > 100) {
        try {
          teleportedPlayers.add(currentAdmin.id);
          currentAdmin.teleport(tLoc, { dimension: currentAdmin.dimension });
          movementAnchor = { x: tLoc.x, y: tLoc.y, z: tLoc.z };
          lastAdminLoc = { ...movementAnchor };
        } catch {}
        return; // skip camera update this tick - let chunks load
      }

      try {
        const head = currentTarget.getHeadLocation();
        // Drive orbit from the spying admin's look direction so horizontal look
        // controls rotate the camera around the watched player.
        currentAdmin.camera.setCamera("minecraft:free", {
          location: {
            x: head.x - normX * orbitDistance,
            y: head.y - normY * orbitDistance,
            z: head.z - normZ * orbitDistance,
          },
          facingLocation: { x: head.x, y: head.y, z: head.z },
          easeOptions: { easeTime: 0.2, easeType: EasingType.OutSine },
        });
      } catch {}
    } catch (e) {
      silentCatch("spy_tick", e);
      try { finishSpy(adminId, currentAdmin); }
      catch (e2) { silentCatch("spy_tick_cleanup", e2); }
    }
  }, 1);

  spyIntervals.set(adminId, intervalId);
  spyTargets.set(adminId, targetName);
  logAdmin(admin, "SPY_START", targetName);
  recordSpyHistory(targetName, admin.name, getPlayerXuid(admin));
}

/**
 * Stop the admin's current spy session, restore game mode, and restore position.
 * @returns {boolean} true if a session was running
 */
export function stopSpy(admin) {
  const adminId = admin.id;
  if (!spyIntervals.has(adminId)) return false;
  finishSpy(adminId, admin);
  return true;
}

export function isSpying(admin) {
  return spyIntervals.has(admin.id);
}

/** Stop every active spy session. Used by full data reset. */
export function stopAllSpySessions() {
  for (const player of world.getPlayers()) {
    if (spyIntervals.has(player.id)) {
      try { finishSpy(player.id, player); } catch {}
    }
  }
  spyIntervals.clear();
  spyTargets.clear();
  spyOrigins.clear();
}
