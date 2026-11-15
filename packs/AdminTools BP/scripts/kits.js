/**
 * Kit storage, item snapshots, and claim state.
 *
 * Kits are admin-made item bundles:
 *   - starter: auto-delivered on first join
 *   - claimable: claimed from Player Tool > Kits
 *
 * Definitions live in world storage under jm_at:kits. Claim state lives on
 * scoreboard objectives by kit id and player XUID, so cooldowns and resets work
 * even while a player is offline. Cooldowns use epoch seconds, not milliseconds,
 * because scoreboard values are signed 32-bit integers.
 *
 * Basic item data round-trips well: type, amount, name, lore, enchantments,
 * durability, lock mode, and keep-on-death. Deep item data like potion effects,
 * books, banners, maps, fireworks, and shulker contents cannot be fully rebuilt;
 * isLossyType() flags those so the editor can warn before saving.
 */

import { world, ItemStack, EnchantmentTypes } from "@minecraft/server";
import { NS, KEY, LIMITS } from "./constants.js";
import { getWorldStr, setWorldStr, getPlayerCore, getCfg } from "./storage.js";
import {
  safeJsonParse,
  safeJsonStringify,
  silentCatch,
  nowSec,
  nowMs,
  getPlayerXuid,
  tell,
} from "./utils.js";
import { t } from "./i18n.js";
import { isStaff, isAdmin, isModerator } from "./permissions.js";
import { getEffectiveRankPrefix } from "./ranks.js";

export const KIT_TYPES = { STARTER: "starter", CLAIMABLE: "claimable" };

// =========================================================
// Definition storage
// =========================================================

export function getKits() {
  return safeJsonParse(getWorldStr(KEY.kits), {});
}

/** Resolve a kit by plain name or #id for script events. */
export function resolveKitRef(ref) {
  const kits = getKits();
  const raw = String(ref ?? "").trim();
  if (!raw) return null;
  const idMatch = raw.match(/^#?(\d+)$/);
  if (idMatch) {
    const id = parseInt(idMatch[1], 10);
    for (const name of Object.keys(kits)) {
      if (kits[name].id === id) return { name, kit: kits[name] };
    }
  }
  const norm = raw.replace(/§./g, "").toLowerCase();
  for (const name of Object.keys(kits)) {
    if (name.replace(/§./g, "").toLowerCase() === norm)
      return { name, kit: kits[name] };
  }
  return null;
}

export function setKits(kits) {
  // False means storage refused the write or the blob was too large.
  return setWorldStr(KEY.kits, safeJsonStringify(kits, "{}"));
}

/** Sort starters first, then pinned kits, then names. */
export function getSortedKitNames(kits) {
  return Object.keys(kits).sort((a, b) => {
    const sa = kits[a].type === KIT_TYPES.STARTER ? 0 : 1;
    const sb = kits[b].type === KIT_TYPES.STARTER ? 0 : 1;
    if (sa !== sb) return sa - sb;
    const pa = kits[a].pinned ? 0 : 1;
    const pb = kits[b].pinned ? 0 : 1;
    if (pa !== pb) return pa - pb;
    // Sort by visible text, not leading color codes.
    return a.replace(/§./g, "").localeCompare(b.replace(/§./g, ""));
  });
}

/** Lowest unused kit id; keeps scoreboard objective names short. */
function nextKitId(kits) {
  const used = new Set(Object.values(kits).map((k) => k.id));
  let n = 0;
  while (used.has(n)) n++;
  return n;
}

/** Create a kit; false means duplicate, cap reached, or save failed. */
export function addKit(name, def) {
  const kits = getKits();
  if (kits[name]) return false;
  if (Object.keys(kits).length >= LIMITS.MAX_KITS) return false;
  def.id = nextKitId(kits);
  def.createdAt = nowSec();
  kits[name] = def;
  return setKits(kits); // Do not report success if the write failed.
}

/** Replace a kit while keeping its id and createdAt. */
export function updateKit(name, def) {
  const kits = getKits();
  if (!kits[name]) return false;
  def.id = kits[name].id;
  def.createdAt = kits[name].createdAt ?? nowSec();
  kits[name] = def;
  return setKits(kits); // Do not report success if the write failed.
}

/** Delete a kit and free its claim-tracking objectives. */
export function removeKit(name) {
  const kits = getKits();
  const kit = kits[name];
  if (!kit) return false;
  try {
    for (const id of [kitObjectiveId(kit), kitCountObjectiveId(kit)]) {
      const obj = world.scoreboard.getObjective(id);
      if (obj) world.scoreboard.removeObjective(obj);
    }
  } catch (e) {
    silentCatch("kit_remove_obj", e);
  }
  delete kits[name];
  setKits(kits);
  return true;
}

// =========================================================
// Item serialization
// =========================================================

const LOSSY_EXACT = new Set([
  "potion",
  "splash_potion",
  "lingering_potion",
  "tipped_arrow",
  "writable_book",
  "written_book",
  "firework_rocket",
  "firework_star",
  "filled_map",
  "suspicious_stew",
  "goat_horn",
  "ominous_bottle",
  "crossbow", // Loaded projectile is not captured.
  "shield", // Banner pattern is not captured.
]);

/**
 * True when item data cannot be fully rebuilt from script.
 * Armor trims are not detectable by type, so trimmed armor may restore untrimmed.
 */
export function isLossyType(typeId) {
  const base = String(typeId ?? "").replace("minecraft:", "");
  if (LOSSY_EXACT.has(base)) return true;
  if (base.endsWith("_banner")) return true;
  if (base.endsWith("shulker_box")) return true; // Contents are not captured.
  if (base.startsWith("leather_")) return true; // Dye color is not captured.
  return false;
}

/** Snapshot a live ItemStack into a plain serializable kit-item def. */
export function serializeItemStack(it, amountOverride) {
  const out = { typeId: it.typeId, amount: amountOverride ?? it.amount };
  try {
    if (it.nameTag) out.nameTag = it.nameTag;
  } catch {}
  try {
    const lore = it.getLore();
    if (lore && lore.length) out.lore = lore;
  } catch {}
  try {
    const ench = it.getComponent("minecraft:enchantable")?.getEnchantments();
    if (ench && ench.length)
      out.enchantments = ench.map((e) => ({ id: e.type.id, level: e.level }));
  } catch {}
  try {
    const dur = it.getComponent("minecraft:durability");
    if (dur && dur.damage) out.damage = dur.damage;
  } catch {}
  try {
    if (it.lockMode && it.lockMode !== "none") out.lockMode = it.lockMode;
  } catch {}
  try {
    if (it.keepOnDeath) out.keepOnDeath = true;
  } catch {}
  return out;
}

/** Apply stored item metadata where the API allows it. */
function applyItemMeta(stack, def) {
  try {
    if (def.nameTag) stack.nameTag = def.nameTag;
  } catch {}
  try {
    if (def.lore && def.lore.length) stack.setLore(def.lore);
  } catch {}
  try {
    if (def.enchantments && def.enchantments.length) {
      const ench = stack.getComponent("minecraft:enchantable");
      if (ench) {
        for (const e of def.enchantments) {
          try {
            const type = EnchantmentTypes.get(e.id);
            if (type) ench.addEnchantment({ type, level: e.level });
          } catch {}
        }
      }
    }
  } catch {}
  try {
    if (def.damage) {
      const dur = stack.getComponent("minecraft:durability");
      if (dur) dur.damage = Math.min(def.damage, dur.maxDurability);
    }
  } catch {}
  try {
    if (def.lockMode) stack.lockMode = def.lockMode;
  } catch {}
  try {
    if (def.keepOnDeath) stack.keepOnDeath = true;
  } catch {}
}

/** Build kit stacks, splitting amounts by the item's max stack size. */
export function buildKitStacks(def) {
  const stacks = [];
  let max = 64;
  try {
    max = new ItemStack(def.typeId, 1).maxAmount;
  } catch {
    return stacks; // Unknown or removed item type.
  }
  let remaining = Math.max(
    1,
    Math.min(def.amount || 1, LIMITS.MAX_KIT_ITEM_AMOUNT),
  );
  while (remaining > 0) {
    const n = Math.min(remaining, max);
    let st;
    try {
      st = new ItemStack(def.typeId, n);
    } catch {
      break;
    }
    applyItemMeta(st, def);
    stacks.push(st);
    remaining -= n;
  }
  return stacks;
}

// =========================================================
// Claim state (scoreboard)
// =========================================================

function kitObjectiveId(kit) {
  return `${NS}_k${kit.id}`;
}

/** Extra objective for repeatable kits with a total-claim cap. */
function kitCountObjectiveId(kit) {
  return `${NS}_kc${kit.id}`;
}

function getObjectiveById(id, create = false) {
  let obj = world.scoreboard.getObjective(id);
  if (!obj && create) {
    try {
      obj = world.scoreboard.addObjective(id, id);
    } catch {
      obj = world.scoreboard.getObjective(id);
    }
  }
  return obj ?? null;
}

function getKitObjective(kit, create = false) {
  return getObjectiveById(kitObjectiveId(kit), create);
}

function getCountObjective(kit, create = false) {
  return getObjectiveById(kitCountObjectiveId(kit), create);
}

/** How many times `xuid` has claimed `kit` (0 if untracked). */
function getClaimCount(kit, xuid) {
  const obj = getCountObjective(kit, false);
  if (!obj) return 0;
  try {
    const v = obj.getScore(xuid);
    return typeof v === "number" ? v : 0;
  } catch {
    return 0;
  }
}

function incrClaimCount(kit, xuid) {
  const obj = getCountObjective(kit, true);
  if (!obj) return;
  try {
    obj.setScore(xuid, getClaimCount(kit, xuid) + 1);
  } catch (e) {
    silentCatch("kit_incr_count", e);
  }
}

function getClaimValue(kit, xuid) {
  const obj = getKitObjective(kit, false);
  if (!obj) return 0;
  try {
    const v = obj.getScore(xuid);
    return typeof v === "number" ? v : 0;
  } catch {
    return 0;
  }
}

function setClaimValue(kit, xuid, val) {
  const obj = getKitObjective(kit, true);
  if (!obj) return;
  try {
    obj.setScore(xuid, val);
  } catch (e) {
    silentCatch("kit_set_claim", e);
  }
}

/** Clear one player's claim/cooldown state for a kit. */
export function resetKitClaim(kit, xuid) {
  for (const obj of [getKitObjective(kit, false), getCountObjective(kit, false)]) {
    if (!obj) continue;
    try {
      obj.removeParticipant(xuid);
    } catch {
      try {
        obj.setScore(xuid, 0);
      } catch {}
    }
  }
}

/** Clear all claim history for a kit by dropping its tracking objectives. */
export function resetAllKitClaims(kit) {
  for (const id of [kitObjectiveId(kit), kitCountObjectiveId(kit)]) {
    try {
      const obj = world.scoreboard.getObjective(id);
      if (obj) world.scoreboard.removeObjective(obj);
    } catch (e) {
      silentCatch("kit_reset_all", e);
    }
  }
}

// =========================================================
// Rank gating
// =========================================================

function normalizeRank(s) {
  // Keep symbols significant so [VIP] and [VIP]+ stay distinct.
  return String(s ?? "")
    .replace(/§./g, "")
    .trim()
    .toLowerCase();
}

/** True when the player meets a kit's staff/admin/mod/rank requirement. */
export function meetsKitRank(player, rankReq) {
  if (!rankReq) return true;
  if (rankReq === "staff") return isStaff(player);
  if (rankReq === "admins") return isAdmin(player).ok;
  if (rankReq === "mods") return isModerator(player);
  try {
    const core = getPlayerCore(player);
    const prefix = getEffectiveRankPrefix(player, core);
    return normalizeRank(prefix) === normalizeRank(rankReq);
  } catch {
    return false;
  }
}

// =========================================================
// Claiming
// =========================================================

/** Minimum playtime in minutes; playtime-rank gates track the current ladder. */
export function kitMinPlaytimeMin(kit, cfg) {
  if (kit?.minPlaytimeRank) {
    const c = cfg ?? getCfg();
    const e = (c.playtimeRanks ?? []).find(
      (r) => r.rankName === kit.minPlaytimeRank,
    );
    if (e) return Math.max(0, e.minutes || 0);
    // Removed rank: fall back to the snapshot from when it was set.
  }
  return Math.max(0, kit?.minPlaytimeMin || 0);
}

/** A player's total counted playtime in minutes (accumulated + bonus). */
function playerPlaytimeMin(player) {
  try {
    const core = getPlayerCore(player);
    return ((core.playTimeMs ?? 0) + (core.bonusPlaytimeMs ?? 0)) / 60000;
  } catch {
    return 0;
  }
}

/** Check whether a player can claim a kit right now. */
export function canClaimKit(player, kit) {
  if (!meetsKitRank(player, kit.rank))
    return { ok: false, reason: "rank" };
  const needMin = kitMinPlaytimeMin(kit);
  if (needMin > 0) {
    const haveMin = playerPlaytimeMin(player);
    if (haveMin < needMin)
      return { ok: false, reason: "playtime", needMin, haveMin };
  }
  const xuid = getPlayerXuid(player);
  const val = getClaimValue(kit, xuid);
  if (kit.onceOnly || kit.type === KIT_TYPES.STARTER) {
    if (val >= 1) return { ok: false, reason: "once" };
    return { ok: true };
  }
  // Repeatable kits can also have a lifetime cap.
  const max = Math.max(0, kit.maxClaims || 0);
  if (max > 0) {
    const count = getClaimCount(kit, xuid);
    if (count >= max) return { ok: false, reason: "limit", max, count };
  }
  const now = nowSec();
  if (val > now) return { ok: false, reason: "cooldown", waitSec: val - now };
  return { ok: true };
}

/** Count how many inventory stacks this kit will produce. */
function countKitStacks(kit) {
  let total = 0;
  for (const def of kit.items ?? []) {
    let max = 64;
    try {
      max = new ItemStack(def.typeId, 1).maxAmount;
    } catch {
      continue; // Invalid item type contributes no stacks.
    }
    const amt = Math.max(
      1,
      Math.min(def.amount || 1, LIMITS.MAX_KIT_ITEM_AMOUNT),
    );
    total += Math.ceil(amt / max);
  }
  return total;
}

/** Count empty slots in a player's main inventory container. */
function countFreeSlots(player) {
  const inv = player.getComponent("minecraft:inventory")?.container;
  if (!inv) return 0;
  let free = 0;
  for (let i = 0; i < inv.size; i++) if (!inv.getItem(i)) free++;
  return free;
}

/** Require enough empty slots before spending a claim/cooldown. */
export function kitRoomCheck(player, kit) {
  const needed = countKitStacks(kit);
  const free = countFreeSlots(player);
  return { ok: free >= needed, needed, free };
}

/** Give kit items and drop leftovers if anything still fails to fit. */
export function giveKit(player, kit) {
  const inv = player.getComponent("minecraft:inventory")?.container;
  let dropped = 0;
  for (const def of kit.items ?? []) {
    for (const stack of buildKitStacks(def)) {
      let leftover;
      try {
        leftover = inv ? inv.addItem(stack) : stack;
      } catch {
        leftover = stack;
      }
      if (leftover) {
        try {
          player.dimension.spawnItem(leftover, player.location);
        } catch (e) {
          silentCatch("kit_drop", e);
        }
        dropped += leftover.amount;
      }
    }
  }
  return { dropped };
}

/** Record a successful claim: set the one-time flag or the next-available time. */
function recordClaim(player, kit) {
  const xuid = getPlayerXuid(player);
  if (kit.onceOnly || kit.type === KIT_TYPES.STARTER) {
    setClaimValue(kit, xuid, 1);
  } else {
    setClaimValue(kit, xuid, nowSec() + (kit.cooldownSec || 0));
    if ((kit.maxClaims || 0) > 0) incrClaimCount(kit, xuid);
  }
}

/** Claim a kit, or return the failure reason. */
export function claimKit(player, kit) {
  const chk = canClaimKit(player, kit);
  if (!chk.ok) return chk;
  // Do not burn a claim if every item is missing or invalid.
  if (countKitStacks(kit) === 0) return { ok: false, reason: "empty" };
  // Do not spend cooldown/once state if the player is full.
  const room = kitRoomCheck(player, kit);
  if (!room.ok)
    return { ok: false, reason: "full", needed: room.needed, free: room.free };
  const { dropped } = giveKit(player, kit);
  recordClaim(player, kit);
  return { ok: true, dropped };
}

// =========================================================
// Starter kits (first-join delivery)
// =========================================================

/** Deliver owed starter kits on initial spawn. */
export function applyStarterKits(player) {
  try {
    const kits = getKits();
    const names = Object.keys(kits);
    if (names.length === 0) return;
    const xuid = getPlayerXuid(player);
    const core = getPlayerCore(player);
    const firstSec = Math.floor((core.firstSeen ?? nowMs()) / 1000);

    for (const name of names) {
      const kit = kits[name];
      if (kit.type !== KIT_TYPES.STARTER) continue;
      if (getClaimValue(kit, xuid) >= 1) continue; // Already received.
      const newRelative = firstSec >= (kit.createdAt ?? 0);
      if (!(kit.regiveExisting || newRelative)) continue;
      if (!meetsKitRank(player, kit.rank)) continue;

      giveKit(player, kit);
      setClaimValue(kit, xuid, 1);
      tell(player, t("jm_at.kits.received", name));
    }
  } catch (e) {
    silentCatch("apply_starter_kits", e);
  }
}
