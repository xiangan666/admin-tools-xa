/**
 * gravestones.js — Death gravestones
 *
 * When enabled (cfg.gravestonesEnabled), a player's items are preserved on
 * death inside a custom "jm_at:grave" entity placed at the death location
 * instead of scattering on the ground. The owner — or any staff member —
 * recovers them by interacting with the grave.
 *
 * Item loss is prevented by keeping the keepInventory gamerule ON: the addon
 * maintains it while gravestones are enabled so vanilla never drops the
 * inventory. We capture the inventory in the entityDie handler (where it is
 * still intact thanks to keepInventory), copy it into the grave's own
 * container, then clear the player. The clear runs both at death and again on
 * respawn as a safeguard against the engine restoring the kept inventory a few
 * ticks into respawn (which would otherwise duplicate items).
 *
 * Storage lives in the grave entity's own minecraft:inventory container, not
 * the world DB. Ownership + metadata ride on the entity's dynamic properties.
 */

import { world, system, EquipmentSlot } from "@minecraft/server";
import { NS, ITEMS, mobClaimDecision } from "./constants.js";
import { getCfg } from "./storage.js";
import { getPlayerXuid, tell, silentCatch } from "./utils.js";
import { t } from "./i18n.js";
import { isStaff } from "./permissions.js";

export const GRAVE_ID = `${NS}:grave`;
const OWNER_KEY = `${NS}:owner`;
const OWNER_NAME_KEY = `${NS}:owner_name`;
// Death spot the grave must stay pinned to, stored as "x,y,z" (see
// enforceGraveAnchors). Flowing lava/water would otherwise carry the grave —
// and the items inside it — away from where the player died.
const ANCHOR_KEY = `${NS}:anchor`;

const GRAVE_DIMS = ["overworld", "nether", "the_end"];

// Optional "safe bubble" (cfg.gravestoneSafeZoneEnabled): radius, in blocks,
// within which hostile mobs are purged around a grave so players can recover
// their items unharmed. Matches a claim's hostile-mob protection.
const GRAVE_SAFE_RADIUS = 20;

const EQUIP_SLOTS = [
  EquipmentSlot.Head,
  EquipmentSlot.Chest,
  EquipmentSlot.Legs,
  EquipmentSlot.Feet,
  EquipmentSlot.Offhand,
];

/** Keep the keepInventory gamerule ON so vanilla never scatters items. */
export function ensureKeepInventory() {
  try {
    world.gameRules.keepInventory = true;
  } catch {
    try {
      world.getDimension("overworld").runCommand("gamerule keepinventory true");
    } catch (e) {
      silentCatch("grave_keepinv", e);
    }
  }
}

/** Turn the keepInventory gamerule OFF so vanilla scatters items again. */
export function disableKeepInventory() {
  try {
    world.gameRules.keepInventory = false;
  } catch {
    try {
      world
        .getDimension("overworld")
        .runCommand("gamerule keepinventory false");
    } catch (e) {
      silentCatch("grave_keepinv_off", e);
    }
  }
}

function normalizeToolMode(raw) {
  return raw === true || raw === "always"
    ? "always"
    : raw === "inventory"
      ? "inventory"
      : "none";
}

/** Clone a player's items (main container + equipment), keeping any item for
 *  which keep(typeId) is true and skipping empty slots. Returns ItemStack
 *  clones. */
function collectItems(player, keep) {
  const out = [];
  try {
    const inv = player.getComponent("minecraft:inventory")?.container;
    if (inv) {
      for (let i = 0; i < inv.size; i++) {
        const it = inv.getItem(i);
        if (it && keep(it.typeId)) out.push(it.clone());
      }
    }
  } catch (e) {
    silentCatch("grave_collect_inv", e);
  }
  try {
    const eq = player.getComponent("minecraft:equippable");
    if (eq) {
      for (const slot of EQUIP_SLOTS) {
        const it = eq.getEquipment(slot);
        if (it && keep(it.typeId)) out.push(it.clone());
      }
    }
  } catch (e) {
    silentCatch("grave_collect_eq", e);
  }
  return out;
}

/** Wipe a player's stored items (main container + equipment). The addon tools
 *  are re-given separately by ensureStarterItems on respawn. */
export function clearPlayerItems(player) {
  try {
    const inv = player.getComponent("minecraft:inventory")?.container;
    if (inv) for (let i = 0; i < inv.size; i++) inv.setItem(i, undefined);
  } catch (e) {
    silentCatch("grave_clear_inv", e);
  }
  try {
    const eq = player.getComponent("minecraft:equippable");
    if (eq) for (const slot of EQUIP_SLOTS) eq.setEquipment(slot, undefined);
  } catch (e) {
    silentCatch("grave_clear_eq", e);
  }
}

/**
 * Capture the dead player's items into a fresh grave entity at the death spot.
 * Call from the entityDie handler. Returns true if a grave was created — the
 * caller should then flag the player so their kept inventory is also cleared on
 * respawn (belt-and-suspenders against the engine restoring it).
 *
 * A full player inventory is 41 stacks (36 + 4 armor + 1 offhand); the grave
 * container holds 45, so everything always fits and we can clear unconditionally.
 *
 * The admin/ticket tools are handled by the existing "tools on death" setting:
 * when that setting will re-give a tool on respawn (ensureStarterItems) we keep
 * it OUT of the grave so it isn't duplicated; otherwise (e.g. mode "none") we
 * store it in the grave so it can still be recovered instead of being lost.
 */
export function createGraveOnDeath(player, hadTools = {}) {
  try {
    const cfg = getCfg();
    if (cfg.gravestonesEnabled !== true) return false;

    const toolMode = normalizeToolMode(cfg.deathbackGiveTools);
    const staff = isStaff(player);
    const willRegive = (typeId) => {
      if (typeId === ITEMS.ticketMenu)
        return (
          toolMode === "always" ||
          (toolMode === "inventory" && !!hadTools.ticket)
        );
      if (typeId === ITEMS.adminTool)
        return (
          staff &&
          (toolMode === "always" ||
            (toolMode === "inventory" && !!hadTools.admin))
        );
      return false;
    };

    const items = collectItems(player, (typeId) => !willRegive(typeId));
    if (items.length === 0) return false; // nothing worth a grave

    const dim = player.dimension;
    const loc = player.location;
    // Block-centred spot the grave is spawned at and kept pinned to.
    const anchor = {
      x: Math.floor(loc.x) + 0.5,
      y: Math.floor(loc.y),
      z: Math.floor(loc.z) + 0.5,
    };
    let grave;
    try {
      grave = dim.spawnEntity(GRAVE_ID, anchor);
    } catch (e) {
      silentCatch("grave_spawn", e);
      return false; // couldn't place — leave items with the player (keepInventory)
    }

    const container = grave.getComponent("minecraft:inventory")?.container;
    if (!container) {
      try {
        grave.remove();
      } catch {}
      return false;
    }

    let stored = 0;
    for (const it of items) {
      if (stored >= container.size) break;
      container.setItem(stored++, it);
    }

    // Record ownership FIRST and treat it as critical: a grave we can't match
    // to its owner would lock them out of their own items (only staff could
    // loot it). If this write fails, abandon the grave and leave the items with
    // the player — keepInventory keeps their inventory intact because we have
    // NOT cleared it yet. Mirrors the "couldn't place"/"no container" returns above.
    try {
      grave.setDynamicProperty(OWNER_KEY, getPlayerXuid(player));
    } catch (e) {
      silentCatch("grave_owner", e);
      try {
        grave.remove();
      } catch {}
      return false;
    }

    // Non-critical metadata — ownership is already recorded, so best-effort.
    // NOTE (i18n): nameTag is a raw string rendered identically for every
    // viewer — Bedrock nameTags use the server's Chinese, without RawMessage.
    try {
      grave.setDynamicProperty(OWNER_NAME_KEY, player.name);
      grave.setDynamicProperty(
        ANCHOR_KEY,
        `${anchor.x},${anchor.y},${anchor.z}`,
      );
      grave.addTag(`${NS}:grave`);
      grave.nameTag = `§7${player.name}的墓碑\n§8${stored} 件物品 — 交互以取回物品`;
    } catch (e) {
      silentCatch("grave_meta", e);
    }

    // Clear at death too; the respawn pass is a safeguard, not the primary clear.
    clearPlayerItems(player);
    return true;
  } catch (e) {
    silentCatch("grave_create", e);
    return false;
  }
}

/**
 * Give a grave's contents back to an interacting player. Only the owner or a
 * staff member may loot it. Items go into the player's inventory; whatever fits
 * is removed from the grave, and the grave is removed once empty.
 */
export function handleGraveInteract(player, grave) {
  try {
    if (!grave?.isValid) return;
    const ownerXuid = grave.getDynamicProperty(OWNER_KEY);
    const ownerName =
      grave.getDynamicProperty(OWNER_NAME_KEY) ?? t("jm_at.common.someone");
    const isOwner = ownerXuid && getPlayerXuid(player) === ownerXuid;
    if (!isOwner && !isStaff(player)) {
      tell(player, t("jm_at.grave.not_yours", ownerName));
      return;
    }

    const container = grave.getComponent("minecraft:inventory")?.container;
    if (!container) {
      try {
        grave.remove();
      } catch {}
      return;
    }
    const playerInv = player.getComponent("minecraft:inventory")?.container;
    if (!playerInv) return;

    let moved = 0;
    let leftover = 0;
    for (let i = 0; i < container.size; i++) {
      const it = container.getItem(i);
      if (!it) continue;
      const remaining = playerInv.addItem(it); // undefined when fully added
      if (remaining) {
        container.setItem(i, remaining);
        leftover++;
      } else {
        container.setItem(i, undefined);
        moved++;
      }
    }

    if (leftover > 0) {
      tell(player, t("jm_at.grave.recovered_partial", moved, leftover));
      return;
    }

    tell(
      player,
      isOwner
        ? t("jm_at.grave.recovered_own", moved)
        : t("jm_at.grave.recovered_other", moved, ownerName),
    );
    try {
      grave.dimension.spawnParticle(
        "jm_at:gravestone_particles",
        grave.location,
      );
    } catch {}
    try {
      grave.remove();
    } catch {}
  } catch (e) {
    silentCatch("grave_interact", e);
  }
}

/**
 * Respawn safeguard. keepInventory can restore the kept inventory a few ticks
 * into respawn, which would duplicate what we already moved into the grave — so
 * we clear again across a short window. Tools are NOT touched here; the caller
 * re-gives them via ensureStarterItems after this settles.
 */
export function scheduleGraveRespawnClear(player) {
  for (const delay of [1, 5, 10]) {
    system.runTimeout(() => {
      try {
        if (player.isValid) clearPlayerItems(player);
      } catch (e) {
        silentCatch("grave_respawn_clear", e);
      }
    }, delay);
  }
}

/**
 * Keep graves pinned to the death spot. A grave has no gravity and no collision,
 * but flowing fluid (lava, water) still imparts velocity and can sweep it — and
 * the items it holds — away, so the owner returns to an empty spot (or a grave
 * lost inside a lava pool). Each grave is stamped with its spawn position
 * (ANCHOR_KEY); any grave that has drifted off it is snapped straight back.
 *
 * Cheap in the common case: a grave sitting on dry land costs only a squared-
 * distance compare and is never moved. Only graves actually caught in a current
 * are teleported. Call on a short interval.
 */
export function enforceGraveAnchors() {
  for (const dimId of GRAVE_DIMS) {
    let graves;
    try {
      graves = world.getDimension(dimId).getEntities({ type: GRAVE_ID });
    } catch {
      continue; // dimension not available
    }
    for (const grave of graves) {
      try {
        const raw = grave.getDynamicProperty(ANCHOR_KEY);
        if (typeof raw !== "string") continue; // pre-anchor grave — leave it
        const [ax, ay, az] = raw.split(",").map(Number);
        if (
          !Number.isFinite(ax) ||
          !Number.isFinite(ay) ||
          !Number.isFinite(az)
        )
          continue;
        const loc = grave.location;
        const dx = loc.x - ax;
        const dy = loc.y - ay;
        const dz = loc.z - az;
        // >0.1 blocks of drift → pull it back to the death spot.
        if (dx * dx + dy * dy + dz * dz > 0.01) {
          grave.teleport({ x: ax, y: ay, z: az });
          try {
            grave.clearVelocity();
          } catch {}
        }
      } catch (e) {
        silentCatch("grave_anchor", e);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Optional grave "safe zone" (cfg.gravestoneSafeZoneEnabled)
// ---------------------------------------------------------------------------
// Cache of active grave centers, refreshed by enforceGraveSafeZones each run so
// the instant entitySpawn guard (isInGraveSafeZone, called from main.js) can
// early-out with a cheap distance check instead of querying the world. Keyed by
// the full dimension id ("minecraft:overworld", …) to match entity.dimension.id.
let _graveZoneCenters = []; // [{ dimId, x, y, z }]

/** Remove a hostile mob — mirrors the claim purge (remove, else kill). */
function _killGraveHostile(entity) {
  try {
    entity.remove();
    return;
  } catch {}
  try {
    entity.kill();
  } catch {}
}

/**
 * True when `loc` in `dimId` sits inside an active grave's safe bubble. Cheap:
 * a squared-distance compare against the cached centers. Returns false when the
 * feature is off (so the entitySpawn hot path pays almost nothing by default).
 */
export function isInGraveSafeZone(dimId, loc) {
  try {
    if (getCfg().gravestoneSafeZoneEnabled !== true) return false;
    if (_graveZoneCenters.length === 0) return false;
    const r2 = GRAVE_SAFE_RADIUS * GRAVE_SAFE_RADIUS;
    for (const c of _graveZoneCenters) {
      if (c.dimId !== dimId) continue;
      const dx = loc.x - c.x;
      const dy = loc.y - c.y;
      const dz = loc.z - c.z;
      if (dx * dx + dy * dy + dz * dz <= r2) return true;
    }
  } catch (e) {
    silentCatch("grave_safezone_test", e);
  }
  return false;
}

/**
 * Poll layer for the grave safe zone (opt-in). Around every active grave, purge
 * hostile mobs exactly the way a claim's hostileMobs protection does — same
 * whitelist/blacklist precedence via mobClaimDecision, same "spare name-tagged /
 * spare other-pack entities" rules — so a returning player can recover their
 * items safely. Also rebuilds the center cache the instant spawn guard reads.
 *
 * Cheap when disabled or when no graves exist (a couple of empty getEntities
 * queries). The 20-block bubble is spherical (maxDistance), matching "bubble".
 */
export function enforceGraveSafeZones() {
  const cfg = getCfg();
  if (
    cfg.gravestonesEnabled !== true ||
    cfg.gravestoneSafeZoneEnabled !== true
  ) {
    if (_graveZoneCenters.length) _graveZoneCenters = [];
    return;
  }
  const bl = cfg.mobBlacklist;
  const centers = [];
  for (const dimId of GRAVE_DIMS) {
    let dim, graves;
    try {
      dim = world.getDimension(dimId);
      graves = dim.getEntities({ type: GRAVE_ID });
    } catch {
      continue; // dimension not available
    }
    for (const grave of graves) {
      let loc;
      try {
        loc = grave.location;
        if (!loc) continue;
      } catch {
        continue;
      }
      centers.push({ dimId: dim.id, x: loc.x, y: loc.y, z: loc.z });
      let nearby;
      try {
        nearby = dim.getEntities({
          location: loc,
          maxDistance: GRAVE_SAFE_RADIUS,
          excludeTypes: ["minecraft:player", GRAVE_ID],
        });
      } catch {
        continue;
      }
      for (const entity of nearby) {
        try {
          if (!entity.isValid) continue;
          // Same precedence as claims: exact/namespace lists beat the default,
          // blacklist breaks ties (see mobClaimDecision). null = no opinion.
          const decision = mobClaimDecision(entity.typeId, bl);
          if (decision === "spare") continue;
          if (decision === "remove") {
            _killGraveHostile(entity);
            continue;
          }
          // No list opinion → normal hostile purge. Spare name-tagged mobs
          // (e.g. a player's named pet) and entities from other packs.
          if (entity.nameTag) continue;
          if (!entity.typeId.startsWith("minecraft:")) continue;
          _killGraveHostile(entity);
        } catch (e) {
          silentCatch("grave_safezone_kill", e);
        }
      }
    }
  }
  _graveZoneCenters = centers;
}
