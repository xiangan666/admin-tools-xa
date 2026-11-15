import { system, world, InputButton, ButtonState } from "@minecraft/server";
import { silentCatch } from "./utils.js";
import { t } from "./i18n.js";
import { teleportPlayer } from "./players.js";

const BLOCK_ID = "jm_at:elevator";
const SEARCH_RANGE = 128;
const COOLDOWN_MS = 500;

const lastJumping = new Map();
const lastSneaking = new Map();
const lastTeleportMs = new Map();

function getInputState(player) {
  try {
    const info = player.inputInfo;
    if (info) {
      return {
        jump: info.getButtonState(InputButton.Jump) === ButtonState.Pressed,
        sneak: info.getButtonState(InputButton.Sneak) === ButtonState.Pressed,
      };
    }
  } catch {}
  return { jump: player.isJumping, sneak: player.isSneaking };
}

function showActionBar(player, text) {
  try { player.onScreenDisplay.setActionBar(text); } catch {}
}

function showError(player, result, direction) {
  // Full-sentence keys per direction — a shared "above"/"below" fragment can't
  // inflect correctly across all three sentence frames in every language.
  const above = direction === "above";
  if (result?.blocked) {
    if (result.blockedCount > 1) {
      showActionBar(
        player,
        t(
          above
            ? "jm_at.elevator.blocked_many_above"
            : "jm_at.elevator.blocked_many_below",
          result.blockedCount,
        ),
      );
    } else {
      showActionBar(
        player,
        t(
          above
            ? "jm_at.elevator.blocked_one_above"
            : "jm_at.elevator.blocked_one_below",
          result.blockedY,
        ),
      );
    }
  } else {
    showActionBar(
      player,
      t(
        above ? "jm_at.elevator.none_above" : "jm_at.elevator.none_below",
        SEARCH_RANGE,
      ),
    );
  }
}

/**
 * Find the elevator block the player is standing on by checking
 * two Y levels and the player's footprint (they can straddle block edges).
 * Returns { x, y, z } of the elevator block, or null.
 */
function findStandingElevator(dimension, loc) {
  const xOffsets = new Set([Math.floor(loc.x - 0.3), Math.floor(loc.x + 0.3)]);
  const zOffsets = new Set([Math.floor(loc.z - 0.3), Math.floor(loc.z + 0.3)]);
  for (const y of [Math.floor(loc.y), Math.floor(loc.y) - 1]) {
    for (const x of xOffsets) {
      for (const z of zOffsets) {
        try {
          const block = dimension.getBlock({ x, y, z });
          if (block && block.typeId === BLOCK_ID) return { x, y, z };
        } catch {}
      }
    }
  }
  return null;
}

system.runInterval(() => {
  try {
    for (const player of world.getPlayers()) {
      try {
        const id = player.id;

        // Read input first (cheap) before doing block lookups (expensive)
        const { jump, sneak } = getInputState(player);
        const wasJumping = lastJumping.get(id) ?? false;
        const wasSneaking = lastSneaking.get(id) ?? false;

        // Fast path: no current input AND no prior state → nothing to do
        if (!jump && !sneak && !wasJumping && !wasSneaking) continue;

        const loc = player.location;
        const pad = findStandingElevator(player.dimension, loc);

        if (!pad) {
          lastJumping.delete(id);
          lastSneaking.delete(id);
          continue;
        }

        const now = Date.now();
        const onCooldown = now - (lastTeleportMs.get(id) ?? 0) < COOLDOWN_MS;
        const jumpEdge = jump && !wasJumping;
        const sneakEdge = sneak && !wasSneaking;

        if (jumpEdge && !onCooldown) {
          const result = findElevator(player.dimension, pad.x, pad.z, pad.y + 1, 1);
          if (result?.y !== undefined) {
            teleportPlayer(player, { x: pad.x + 0.5, y: result.y + 0.0625, z: pad.z + 0.5 });
            lastTeleportMs.set(id, Date.now());
          } else {
            showError(player, result, "above");
          }
        }

        if (sneakEdge && !onCooldown) {
          const result = findElevator(player.dimension, pad.x, pad.z, pad.y - 1, -1);
          if (result?.y !== undefined) {
            teleportPlayer(player, { x: pad.x + 0.5, y: result.y + 0.0625, z: pad.z + 0.5 });
            lastTeleportMs.set(id, Date.now());
          } else {
            showError(player, result, "below");
          }
        }

        lastJumping.set(id, jump);
        lastSneaking.set(id, sneak);
      } catch (e) {
        silentCatch("elevator_player", e);
      }
    }
  } catch (e) {
    silentCatch("elevator_tick", e);
  }
}, 2);

/**
 * Returns { y } on success,
 * { blocked: true, blockedY, blockedCount } if pad(s) exist but are obstructed,
 * or null if no pad was found within SEARCH_RANGE.
 */
function findElevator(dimension, x, z, startY, direction) {
  let blockedCount = 0;
  let blockedY;
  for (let i = 0; i < SEARCH_RANGE; i++) {
    const y = startY + i * direction;
    let block;
    try {
      block = dimension.getBlock({ x, y, z });
    } catch {
      break;
    }
    if (!block) continue;
    if (block.typeId === BLOCK_ID) {
      if (hasHeadroom(dimension, x, y, z)) return { y };
      if (blockedCount === 0) blockedY = y;
      blockedCount++;
    }
  }
  return blockedCount > 0 ? { blocked: true, blockedY, blockedCount } : null;
}

function hasHeadroom(dimension, x, y, z) {
  try {
    const above = dimension.getBlock({ x, y: y + 1, z });
    return !!above && (above.isAir || above.typeId === BLOCK_ID);
  } catch {
    return false;
  }
}

world.afterEvents.playerLeave.subscribe((ev) => {
  lastJumping.delete(ev.playerId);
  lastSneaking.delete(ev.playerId);
  lastTeleportMs.delete(ev.playerId);
});
