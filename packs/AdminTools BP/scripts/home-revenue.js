/** Owner earnings. Persist pending before movement; only real successful trips credit income. */
import { ItemStack, EnchantmentTypes } from "@minecraft/server";
import { NS } from "./constants.js";
import { getWorldStr, setWorldStr } from "./storage.js";
import { getPlayerXuid, genId, utf8ByteLen, silentCatch } from "./utils.js";
import { REVENUE_LIMITS, emptyRevenueLedger, validateRevenueLedger, creditRevenue, reserveRevenueClaim, finishRevenueClaim } from "./home-revenue-core.js";

const ledgerKey = ownerId => `${NS}:xa_home_revenue_${ownerId}`;
const shadow = new Map();
const busy = new Set();
const clone = value => JSON.parse(JSON.stringify(value));
const COMPLEX = /(?:^|:)(?:potion|splash_potion|lingering_potion|tipped_arrow|writable_book|written_book|firework_rocket|firework_star|filled_map|suspicious_stew|goat_horn|ominous_bottle|crossbow|shield)$|(?:_banner|shulker_box)$|:bundle$/;

function writeLedger(ownerId, data) {
  validateRevenueLedger(data);
  const text = JSON.stringify(data);
  if (utf8ByteLen(text) > REVENUE_LIMITS.bytes) throw new Error("家园收益账本已满，请先领取收益后重试。");
  if (!setWorldStr(ledgerKey(ownerId), text)) throw new Error("家园收益存档写入失败，请稍后重试。");
  shadow.delete(ownerId);
}

function readLedger(ownerId) {
  if (shadow.has(ownerId)) {
    const pending = shadow.get(ownerId);
    writeLedger(ownerId, pending);
    return clone(pending);
  }
  const raw = getWorldStr(ledgerKey(ownerId));
  return raw ? validateRevenueLedger(JSON.parse(raw)) : emptyRevenueLedger();
}

function persistAfterAction(ownerId, data) {
  try { writeLedger(ownerId, data); }
  catch (error) {
    shadow.set(ownerId, clone(data));
    throw new Error(`操作已执行，但收益存档暂时失败；已保留会话内状态并阻止重复处理。${error.message}`);
  }
}

/** Construct only API-readable, verifiably round-tripping fungible item stacks. */
export function restoreRevenueItem(def, amount = 1) {
  const item = new ItemStack(def.typeId, 1);
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > item.maxAmount) throw new Error("收益物品堆叠数量无效。");
  if (def.nameTag) item.nameTag = def.nameTag;
  if (def.lore?.length) item.setLore(def.lore);
  if (def.lockMode) item.lockMode = def.lockMode;
  if (def.keepOnDeath) item.keepOnDeath = true;
  if (def.canDestroy?.length) item.setCanDestroy(def.canDestroy);
  if (def.canPlaceOn?.length) item.setCanPlaceOn(def.canPlaceOn);
  for (const [id, value] of def.dynamicProperties || []) item.setDynamicProperty(id, value);
  if (def.damage !== undefined) {
    const component = item.getComponent("minecraft:durability");
    if (!component) throw new Error("收益物品的耐久组件已不可用。");
    component.damage = def.damage;
  }
  if (def.enchantments?.length) {
    const component = item.getComponent("minecraft:enchantable");
    if (!component) throw new Error("收益物品的附魔组件已不可用。");
    for (const enchantment of def.enchantments) {
      const type = EnchantmentTypes.get(enchantment.id);
      if (!type) throw new Error("收益物品的附魔类型已不可用。");
      component.addEnchantment({ type, level: enchantment.level });
    }
  }
  item.amount = amount;
  return item;
}

export function snapshotRevenueItem(item) {
  if (!item || item.maxAmount <= 1 || COMPLEX.test(item.typeId)) throw new Error("该收费物品含无法安全保存的特殊数据，或为不可堆叠装备；请改用钻石、绿宝石等可堆叠货币。本次未产生收益。");
  const def = { typeId: item.typeId };
  if (item.nameTag) def.nameTag = item.nameTag;
  const lore = item.getRawLore();
  if (lore.length) def.lore = lore;
  if (item.lockMode && item.lockMode !== "none") def.lockMode = item.lockMode;
  if (item.keepOnDeath) def.keepOnDeath = true;
  const destroy = item.getCanDestroy(), place = item.getCanPlaceOn();
  if (destroy.length) def.canDestroy = destroy;
  if (place.length) def.canPlaceOn = place;
  const dynamic = item.getDynamicPropertyIds().sort().map(id => [id, item.getDynamicProperty(id)]);
  if (dynamic.length) def.dynamicProperties = dynamic;
  const durability = item.getComponent("minecraft:durability");
  if (durability) def.damage = durability.damage;
  const enchantments = item.getComponent("minecraft:enchantable")?.getEnchantments();
  if (enchantments?.length) def.enchantments = enchantments.map(value => ({ id: value.type.id, level: value.level })).sort((a, b) => a.id.localeCompare(b.id));
  const restored = restoreRevenueItem(def, 1);
  if (!item.isStackableWith(restored)) throw new Error("收费物品含无法安全重建的数据，本次传送取消并退还物品；请使用普通可堆叠货币。");
  return def;
}

export function getHomeRevenue(player) {
  const ownerId = String(getPlayerXuid(player));
  const ledger = readLedger(ownerId);
  return { ...clone(ledger), blocked: ledger.pending.length > 0 || ledger.pendingClaims.length > 0 };
}

/** The charge must contain only the destination owner's fee, never the server's extra fee. */
export function prepareHomeRevenue(meta, charge) {
  const ownerId = String(meta.ownerId || "");
  if (!ownerId || !meta.payerId || !Number.isInteger(meta.taxPercent) || meta.taxPercent < 0 || meta.taxPercent > 100) throw new Error("家园收益收款信息或税率无效。");
  if (busy.has(ownerId)) throw new Error("该房主的收益正在处理，请稍后再试。");
  const items = [];
  for (const entry of charge?.entries || []) {
    const def = snapshotRevenueItem(entry.taken);
    const key = JSON.stringify(def);
    const existing = items.find(row => row.key === key);
    if (existing) existing.amount += entry.taken.amount;
    else items.push({ key, item: def, amount: entry.taken.amount });
  }
  if (!items.length) return { id: null, commit: () => false, cancel: () => false };
  const ledger = readLedger(ownerId);
  if (ledger.pending.length || ledger.pendingClaims.length) throw new Error("该房主有待核查的收益交易，已暂停收费传送；请联系服主检查收益页面。");
  const receipt = { id: genId("XHR"), homeName: String(meta.homeName), destinationId: String(meta.destinationId || "legacy"), payerId: String(meta.payerId), taxPercent: meta.taxPercent, items, at: Date.now() };
  // Ensure a successful credit will fit before the irreversible native move.
  const projected = creditRevenue(ledger, receipt);
  if (utf8ByteLen(JSON.stringify(projected)) > REVENUE_LIMITS.bytes) throw new Error("房主收益账本容量不足，请先领取后再传送。");
  ledger.pending.push(receipt);
  writeLedger(ownerId, ledger);
  let state = "prepared";
  let outcome = null;
  return {
    id: receipt.id,
    commit() {
      if (state !== "prepared") return state === "committed" ? outcome : false;
      state = "committed";
      const current = readLedger(ownerId);
      const pending = current.pending.find(row => row.id === receipt.id);
      if (!pending) throw new Error("收益待结算记录缺失，请联系服主核查。");
      const next = creditRevenue(current, pending);
      outcome = next.history[0];
      persistAfterAction(ownerId, next);
      return outcome;
    },
    cancel() {
      if (state !== "prepared") return false;
      state = "canceled";
      const current = readLedger(ownerId);
      current.pending = current.pending.filter(row => row.id !== receipt.id);
      persistAfterAction(ownerId, current);
      return true;
    },
  };
}

function planClaim(container, balances) {
  const original = Array.from({ length: container.size }, (_, slot) => container.getItem(slot)?.clone());
  const result = original.map(item => item?.clone());
  const claims = [];
  for (const balance of balances) {
    const example = restoreRevenueItem(balance.item, 1);
    let remaining = balance.amount;
    for (let slot = 0; slot < result.length && remaining > 0; slot++) {
      const current = result[slot];
      if (!current || !current.isStackableWith(example)) continue;
      const added = Math.min(remaining, current.maxAmount - current.amount);
      if (added > 0) { current.amount += added; remaining -= added; }
    }
    for (let slot = 0; slot < result.length && remaining > 0; slot++) {
      if (result[slot]) continue;
      const added = Math.min(remaining, example.maxAmount);
      result[slot] = restoreRevenueItem(balance.item, added);
      remaining -= added;
    }
    if (remaining < balance.amount) claims.push({ key: balance.key, typeId: balance.item.typeId, amount: balance.amount - remaining });
  }
  const slots = [];
  for (let slot = 0; slot < result.length; slot++) {
    const a = original[slot], b = result[slot];
    const same = (!a && !b) || (a && b && a.amount === b.amount && a.isStackableWith(b));
    if (!same) slots.push({ slot, before: a, after: b });
  }
  return { claims, slots };
}

/** Claims belong exclusively to this server-authenticated Player's own ledger. */
export function claimHomeRevenue(player, typeId = null) {
  const ownerId = String(getPlayerXuid(player));
  if (busy.has(ownerId)) throw new Error("收益正在处理中，请勿重复领取。");
  busy.add(ownerId);
  try {
    const original = readLedger(ownerId);
    if (original.pending.length || original.pendingClaims.length) throw new Error("有待核查的收益交易，暂不能领取。请联系服主检查；不会自动重复发放。");
    const container = player.getComponent("minecraft:inventory")?.container;
    if (!container) throw new Error("无法读取你的背包。");
    const balances = original.balances.filter(row => typeId === null || row.item.typeId === typeId);
    const plan = planClaim(container, balances);
    if (!plan.claims.length) return { amount: 0, remaining: balances.reduce((sum, row) => sum + row.amount, 0), items: [] };
    const id = genId("XHC");
    const reserved = reserveRevenueClaim(original, id, plan.claims);
    writeLedger(ownerId, reserved); // No inventory mutation if this fails.
    const attempted = [];
    try {
      for (const change of plan.slots) {
        attempted.push(change); // An engine might throw after a partial write.
        container.setItem(change.slot, change.after?.clone());
      }
    } catch (error) {
      let restored = true;
      for (const change of attempted.reverse()) {
        try { container.setItem(change.slot, change.before?.clone()); }
        catch (rollbackError) { restored = false; silentCatch("home_revenue_claim_restore", rollbackError); }
      }
      if (!restored) throw new Error("领取背包写入及回滚发生异常；该笔领取已冻结等待服主核查，请勿重复操作。");
      persistAfterAction(ownerId, original);
      throw new Error(`领取未完成，物品与收益余额已回退。${error.message}`);
    }
    const finished = finishRevenueClaim(reserved, id);
    persistAfterAction(ownerId, finished);
    const amount = plan.claims.reduce((sum, row) => sum + row.amount, 0);
    const remaining = finished.balances.filter(row => typeId === null || row.item.typeId === typeId).reduce((sum, row) => sum + row.amount, 0);
    return { amount, remaining, items: plan.claims };
  } finally { busy.delete(ownerId); }
}
