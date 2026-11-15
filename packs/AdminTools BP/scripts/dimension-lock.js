/**
 * Nether/End access lock.
 * Admins toggle this from the Control Panel.
 * Non-admins in a locked dimension are sent back to world spawn.
 */

import { system, world } from "@minecraft/server";
import { isAdmin } from "./permissions.js";
import { getCfg } from "./storage.js";
import { teleportedPlayers, teleportPlayer } from "./players.js";
import { silentCatch } from "./utils.js";
import { t } from "./i18n.js";

const DIM = {
  nether: "minecraft:nether",
  end: "minecraft:the_end",
};

// Cache spawn surface Y until world spawn X/Z changes.
let spawnSurfaceCache = null; // { x, z, y }

system.runInterval(() => {
  try {
    const cfg = getCfg();
    const locks = cfg.dimLocks ?? {};

    // Collect players to eject before doing spawn work.
    const toEject = [];
    for (const player of world.getPlayers()) {
      if (isAdmin(player).ok) continue;
      const dimId = player.dimension.id;
      if (
        (dimId === DIM.nether && locks.nether) ||
        (dimId === DIM.end && locks.end)
      )
        toEject.push(player);
    }
    if (toEject.length === 0) return;

    // Bedrock spawn Y can be the "find surface" sentinel, so scan X/Z downward.
    // Spawn chunks stay loaded, so getBlock() is reliable here.
    const spawn = world.getDefaultSpawnLocation();
    const overworld = world.getDimension("overworld");
    const sx = Math.floor(spawn.x),
      sz = Math.floor(spawn.z);
    if (
      !spawnSurfaceCache ||
      spawnSurfaceCache.x !== sx ||
      spawnSurfaceCache.z !== sz
    ) {
      let surfaceY = 64;
      for (let y = 320; y >= -64; y--) {
        try {
          const block = overworld.getBlock({ x: sx, y, z: sz });
          const above = overworld.getBlock({ x: sx, y: y + 1, z: sz });
          if (block && !block.isAir && above?.isAir) {
            surfaceY = y + 1;
            break;
          }
        } catch {}
      }
      spawnSurfaceCache = { x: sx, z: sz, y: surfaceY };
    }
    const surfaceY = spawnSurfaceCache.y;

    for (const player of toEject) {
      try {
        const isNether = player.dimension.id === DIM.nether;
        player.sendMessage(
          t(
            "jm_at.dimlock.ejected",
            t(isNether ? "jm_at.common.dim_nether" : "jm_at.common.dim_end"),
          ),
        );
        teleportedPlayers.add(player.id);
        teleportPlayer(player,
          { x: sx + 0.5, y: surfaceY, z: sz + 0.5 },
          { dimension: overworld },
        );
      } catch (e) {
        silentCatch("dimlock_eject_player", e);
      }
    }
  } catch (e) {
    silentCatch("dimlock_tick", e);
  }
}, 100);
