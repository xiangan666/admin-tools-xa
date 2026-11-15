/**
 * chest-sorter.js — Chest Sorter item: sorts chest contents alphabetically.
 *
 * Imported for side-effects in main.js.
 * Registers a beforeEvents.playerInteractWithBlock handler that intercepts
 * chest interactions when the player holds the Chest Sorter item.
 */

import { world, system, EquipmentSlot, ItemStack } from "@minecraft/server";
import { ITEMS } from "./constants.js";
import { getPlayerXuid, tell, silentCatch } from "./utils.js";
import { t } from "./i18n.js";
import { canInteract } from "./claims.js";

// =========================================================
// Constants
// =========================================================

const SORTABLE_BLOCKS = new Set([
  "minecraft:chest",
  "minecraft:trapped_chest",
  "minecraft:barrel",
  "minecraft:shulker_box",
  "minecraft:undyed_shulker_box",
]);

/** Check if a block is a sortable container (chests, barrels, shulker boxes, copper chests). */
function isSortable(typeId) {
  return SORTABLE_BLOCKS.has(typeId) || typeId.endsWith("copper_chest") || typeId.endsWith("shulker_box");
}
const COOLDOWN_MS = 500;

// =========================================================
// Cooldown
// =========================================================

const _sortCooldown = new Map(); // xuid → timestamp

// =========================================================
// Sorting helpers
// =========================================================

/**
 * Produce a human-friendly sort key from an ItemStack.
 * Prefers custom nameTag; falls back to humanized typeId.
 */
function sortKey(item) {
  if (item.nameTag) return item.nameTag.toLowerCase();
  return item.typeId
    .replace(/^minecraft:|^jm_at:/, "")
    .replace(/_/g, " ")
    .toLowerCase();
}

/**
 * Compare two items for stable alphabetical sort.
 * Primary: sortKey.  Tiebreaker: raw typeId, then original index.
 */
function compareItems(a, b) {
  const ka = sortKey(a.item);
  const kb = sortKey(b.item);
  if (ka < kb) return -1;
  if (ka > kb) return 1;
  // tiebreaker: raw typeId
  if (a.item.typeId < b.item.typeId) return -1;
  if (a.item.typeId > b.item.typeId) return 1;
  // stable: preserve original order
  return a.index - b.index;
}

// =========================================================
// Double chest detection
// =========================================================

/**
 * Bedrock chests use "minecraft:cardinal_direction" state (north/south/east/west).
 * Two adjacent chests with the same type and facing direction form a double chest.
 * The pair is always perpendicular to the facing direction.
 */

/** Offsets perpendicular to each cardinal direction. */
const PAIR_OFFSETS = {
  north: [
    { x: -1, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
  ],
  south: [
    { x: -1, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
  ],
  east: [
    { x: 0, y: 0, z: -1 },
    { x: 0, y: 0, z: 1 },
  ],
  west: [
    { x: 0, y: 0, z: -1 },
    { x: 0, y: 0, z: 1 },
  ],
};

/**
 * Find the paired chest block for a double chest, or null if single.
 */
function findPairedChest(block) {
  try {
    const facing = block.permutation.getState("minecraft:cardinal_direction");
    if (!facing) return null;
    const offsets = PAIR_OFFSETS[facing];
    if (!offsets) return null;
    const dim = block.dimension;
    const loc = block.location;
    for (const off of offsets) {
      try {
        const neighbor = dim.getBlock({
          x: loc.x + off.x,
          y: loc.y + off.y,
          z: loc.z + off.z,
        });
        if (!neighbor || neighbor.typeId !== block.typeId) continue;
        const nFacing = neighbor.permutation.getState(
          "minecraft:cardinal_direction",
        );
        if (nFacing === facing) return neighbor;
      } catch {
        continue;
      }
    }
  } catch {}
  return null;
}

/**
 * Determine ordering for double chest halves so slot layout feels natural.
 * Returns [leftBlock, rightBlock] from the player's perspective.
 *
 * When facing north: left = east (+x), right = west (-x)
 * When facing south: left = west (-x), right = east (+x)
 * When facing east:  left = south (+z), right = north (-z)  (flipped: left=north, right=south)
 * When facing west:  left = north (-z), right = south (+z)  (flipped: left=south, right=north)
 *
 * Actually, Minecraft double chest ordering from player perspective:
 * The "left" side of the chest (top rows in GUI) depends on facing.
 * We order by: facing north → higher X first; south → lower X first;
 *              east → lower Z first; west → higher Z first.
 */
function orderChestHalves(blockA, blockB) {
  const facing = blockA.permutation.getState("minecraft:cardinal_direction");
  const aLoc = blockA.location;
  const bLoc = blockB.location;
  switch (facing) {
    case "north":
      return aLoc.x > bLoc.x ? [blockA, blockB] : [blockB, blockA];
    case "south":
      return aLoc.x < bLoc.x ? [blockA, blockB] : [blockB, blockA];
    case "east":
      return aLoc.z < bLoc.z ? [blockA, blockB] : [blockB, blockA];
    case "west":
      return aLoc.z > bLoc.z ? [blockA, blockB] : [blockB, blockA];
    default:
      return [blockA, blockB];
  }
}

// =========================================================
// Stack consolidation
// =========================================================

/**
 * Merge partial stacks of identical items into full stacks.
 * Uses isStackableWith() to ensure only truly identical items merge
 * (respects enchantments, custom names, lore, etc.).
 * Returns a new array of { index, item } entries with consolidated stacks.
 */
function consolidateStacks(entries) {
  const merged = [];
  for (const entry of entries) {
    const src = entry.item;
    const maxStack = src.maxAmount;
    // Items that don't stack (maxAmount === 1) skip merging
    if (maxStack <= 1) {
      merged.push({ index: entry.index, item: src });
      continue;
    }
    // Try to merge into an existing partial stack
    let remaining = src.amount;
    for (const existing of merged) {
      if (remaining <= 0) break;
      const dst = existing.item;
      if (dst.amount >= dst.maxAmount) continue;
      if (!dst.isStackableWith(src)) continue;
      const space = dst.maxAmount - dst.amount;
      const transfer = Math.min(space, remaining);
      dst.amount += transfer;
      remaining -= transfer;
    }
    // If there are leftover items, create new stack(s)
    while (remaining > 0) {
      const stackSize = Math.min(remaining, maxStack);
      const newStack = src.clone();
      newStack.amount = stackSize;
      merged.push({ index: entry.index, item: newStack });
      remaining -= stackSize;
    }
  }
  return merged;
}

// =========================================================
// Container helpers
// =========================================================

/**
 * Read all items from a block's container.
 * Returns { container, items: [{ index, item }] } or null on failure.
 */
function readContainer(block) {
  try {
    const inv = block.getComponent("minecraft:inventory");
    if (!inv) return null;
    const container = inv.container;
    if (!container) return null;
    const items = [];
    for (let i = 0; i < container.size; i++) {
      const item = container.getItem(i);
      if (item) items.push({ index: i, item });
    }
    return { container, size: container.size, items };
  } catch {
    return null;
  }
}

/**
 * Write sorted items back to one or more containers.
 * @param {Array<{container, size}>} containers - ordered list of containers
 * @param {Array<{item}>} sortedItems - sorted item entries
 * @returns {boolean} true on success
 */
function writeContainers(containers, sortedItems) {
  let slotOffset = 0;
  for (const { container, size } of containers) {
    // Clear all slots first
    for (let i = 0; i < size; i++) {
      container.setItem(i, undefined);
    }
    // Fill with sorted items
    for (let i = 0; i < size && slotOffset < sortedItems.length; i++) {
      container.setItem(i, sortedItems[slotOffset].item);
      slotOffset++;
    }
  }
  return true;
}

/**
 * Attempt to restore items from a snapshot.
 */
function restoreSnapshot(containers, snapshot) {
  try {
    let idx = 0;
    for (const { container, size } of containers) {
      for (let i = 0; i < size; i++) {
        container.setItem(i, idx < snapshot.length ? snapshot[idx].orig : undefined);
        idx++;
      }
    }
  } catch (e) {
    silentCatch("chest-sorter:restore", e);
  }
}

// =========================================================
// Core sort logic
// =========================================================

function sortChest(player, blockLoc, dimId) {
  try {
    const dim = world.getDimension(dimId);
    const block = dim.getBlock(blockLoc);
    if (!block || !isSortable(block.typeId)) {
      tell(player, t("jm_at.sorter.no_longer_sortable"));
      return;
    }

    // Claim permission check
    if (!canInteract(player, dimId, blockLoc, "container")) {
      tell(player, t("jm_at.sorter.no_permission"));
      return;
    }

    // Read primary container
    const primary = readContainer(block);
    if (!primary) {
      tell(player, t("jm_at.sorter.no_access"));
      return;
    }

    // Determine if this is a double chest.
    // Bedrock's API may return the full 54-slot combined inventory from either
    // half of a double chest. If container.size > 27 we already have the full
    // inventory and must NOT read the paired block (that would be the same data).
    const isApiCombined = primary.size > 27;
    let isDouble = isApiCombined;
    let containers = [primary];
    let allItems = [...primary.items];

    const isChestType = block.typeId === "minecraft:chest"
      || block.typeId === "minecraft:trapped_chest"
      || block.typeId.endsWith("copper_chest");

    if (!isApiCombined && isChestType) {
      // API gave us only 27 slots — check for a paired block manually
      const paired = findPairedChest(block);
      if (paired) {
        const secondary = readContainer(paired);
        if (secondary && secondary.size === primary.size) {
          isDouble = true;
          // Order halves so slot layout feels natural
          const [leftBlock] = orderChestHalves(block, paired);
          const leftIsBlock = leftBlock === block;
          if (leftIsBlock) {
            containers = [primary, secondary];
            allItems = [...primary.items, ...secondary.items.map((e) => ({ ...e, index: e.index + primary.size }))];
          } else {
            containers = [secondary, primary];
            allItems = [...secondary.items, ...primary.items.map((e) => ({ ...e, index: e.index + secondary.size }))];
          }
        }
      }
    }

    // Nothing to sort
    if (allItems.length === 0) {
      tell(player, t("jm_at.sorter.empty"));
      return;
    }
    if (allItems.length === 1) {
      tell(player, t("jm_at.sorter.single"));
      return;
    }

    // Snapshot for safety (store original slot → item mapping)
    const snapshot = [];
    for (const { container, size } of containers) {
      for (let i = 0; i < size; i++) {
        snapshot.push({ orig: container.getItem(i) ?? undefined });
      }
    }

    // Consolidate partial stacks, then sort
    const consolidated = consolidateStacks(allItems);
    const sorted = consolidated.sort(compareItems);

    // Write back
    try {
      writeContainers(containers, sorted);
    } catch (e) {
      silentCatch("chest-sorter:write", e);
      // Attempt restore
      restoreSnapshot(containers, snapshot);
      tell(player, t("jm_at.sorter.failed_restored"));
      return;
    }

    const blockType = block.typeId;
    let label;
    if (blockType === "minecraft:barrel") label = t("jm_at.sorter.kind_barrel");
    else if (blockType.endsWith("shulker_box"))
      label = t("jm_at.sorter.kind_shulker");
    else
      label = isDouble
        ? t("jm_at.sorter.kind_double_chest")
        : t("jm_at.sorter.kind_chest");
    tell(player, t("jm_at.sorter.sorted", sorted.length, label));
  } catch (e) {
    silentCatch("chest-sorter:sort", e);
    tell(player, t("jm_at.sorter.error"));
  }
}

// =========================================================
// Event handler
// =========================================================

try {
  world.beforeEvents.playerInteractWithBlock.subscribe((ev) => {
    try {
      const { player, block } = ev;
      if (!player || player.typeId !== "minecraft:player") return;

      const item = player
        .getComponent("minecraft:equippable")
        ?.getEquipment(EquipmentSlot.Mainhand);
      if (!item || item.typeId !== ITEMS.chestSorter) return;

      ev.cancel = true;

      // Cooldown (applied before all messages so nothing spams)
      const xuid = getPlayerXuid(player);
      const now = Date.now();
      if (now - (_sortCooldown.get(xuid) ?? 0) < COOLDOWN_MS) return;
      _sortCooldown.set(xuid, now);

      // Only act on chests
      if (!isSortable(block.typeId)) {
        system.run(() => tell(player, t("jm_at.sorter.not_sortable")));
        return;
      }

      const blockLoc = block.location;
      const dimId = player.dimension.id;
      system.run(() => sortChest(player, blockLoc, dimId));
    } catch {}
  });
} catch {}
