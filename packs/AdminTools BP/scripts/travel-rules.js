/** Pure travel validation and inventory transactions (no Minecraft imports). */
export const MAX_COOLDOWN_SECONDS = 86400;
export const MAX_COST_AMOUNT = 2147483647;
export function parseClock(value) {
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error("时间必须使用 24 小时制 HH:mm（00:00–23:59）。");
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}
export function integerInRange(value, min, max, label) {
  if (typeof value !== "number" && typeof value !== "string") throw new Error(`${label}必须是 ${min}–${max} 的整数。`);
  if (typeof value === "string" && !/^\d+$/.test(value.trim())) throw new Error(`${label}必须是 ${min}–${max} 的整数。`);
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`${label}必须是 ${min}–${max} 的整数。`);
  return n;
}
export function normalizeRules(value = {}) {
  const cost = value.cost ?? {};
  const time = value.timeWindow ?? {};
  const rules = {
    cooldownSeconds: integerInRange(value.cooldownSeconds ?? 0, 0, MAX_COOLDOWN_SECONDS, "冷却秒数"),
    cost: { typeId: String(cost.typeId ?? ""), amount: integerInRange(cost.amount ?? 0, 0, MAX_COST_AMOUNT, "消耗数量") },
    timeWindow: { enabled: time.enabled === true, start: time.start ?? "00:00", end: time.end ?? "00:00" },
  };
  if (rules.cost.amount && !/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(rules.cost.typeId)) throw new Error("收费时必须选择一种背包物品。");
  parseClock(rules.timeWindow.start); parseClock(rules.timeWindow.end);
  return rules;
}
/** Bedrock 0 ticks is 06:00. Preserve fractions at boundaries. */
export function gameClockMinutes(ticks) {
  if (!Number.isFinite(ticks)) throw new Error("无法读取游戏时间。");
  return (((ticks % 24000) + 24000) % 24000 / 1000 * 60 + 360) % 1440;
}
export function isTimeAllowed(ticks, timeWindow) {
  if (!timeWindow?.enabled) return true;
  const start = parseClock(timeWindow.start), end = parseClock(timeWindow.end);
  const now = gameClockMinutes(ticks);
  if (start === end) return true;
  return start < end ? now >= start && now < end : now >= start || now < end;
}
export function destinationKey({ kind, ownerId = "", name, destinationId }) {
  return JSON.stringify([kind, String(ownerId), String(name), String(destinationId || "legacy")]);
}
/** Two hashes keep property IDs short. Stored full key detects any collision. */
export function cooldownProperty(key) {
  let a = 2166136261, b = 5381;
  for (let i = 0; i < key.length; i++) { const c = key.charCodeAt(i); a = Math.imul(a ^ c, 16777619); b = Math.imul(b, 33) ^ c; }
  return `jm_at:travel_cd_${(a >>> 0).toString(36)}_${(b >>> 0).toString(36)}`;
}
export function remainingCooldown(lastSuccess, seconds, now = Date.now()) {
  if (!seconds || !Number.isFinite(lastSuccess)) return 0;
  return Math.max(0, Math.ceil((lastSuccess + seconds * 1000 - now) / 1000));
}
export function inventoryChoices(container) {
  const totals = new Map();
  for (let i = 0; i < (container?.size ?? 0); i++) {
    const item = container.getItem(i);
    if (!item) continue;
    const found = totals.get(item.typeId);
    if (found) found.amount += item.amount;
    else totals.set(item.typeId, { typeId: item.typeId, amount: item.amount, example: item });
  }
  return [...totals.values()];
}
export function inventoryCount(container, typeId) {
  return inventoryChoices(container).find((c) => c.typeId === typeId)?.amount ?? 0;
}
function clone(stack) { return stack.clone(); }
/** Refund each exact original stack; no reconstructed ItemStack loses metadata. */
export function refundCharge(charge, container, overflow) {
  for (const entry of charge.entries) {
    if (entry.refunded) continue;
    let leftover = clone(entry.taken);
    const current = container.getItem(entry.slot);
    if (!current && !entry.expected) {
      container.setItem(entry.slot, clone(entry.original));
      entry.refunded = true; continue;
    }
    if (current && entry.expected && current.amount === entry.expected.amount && current.isStackableWith(entry.expected)) {
      container.setItem(entry.slot, clone(entry.original));
      entry.refunded = true; continue;
    }
    leftover = container.addItem(leftover);
    if (leftover) overflow(leftover);
    entry.refunded = true;
  }
}
/** Exact-stack escrow; caller refunds synchronously if teleport fails. */
export function chargeInventory(container, cost, overflow = () => { throw new Error("退款背包空间不足。"); }) {
  const charge = { entries: [] };
  if (!cost.amount) return charge;
  if (!container || inventoryCount(container, cost.typeId) < cost.amount) throw new Error(`背包物品不足：需要 ${cost.amount} 个 ${cost.typeId}。`);
  let remaining = cost.amount;
  try {
    for (let slot = 0; slot < container.size && remaining; slot++) {
      const item = container.getItem(slot);
      if (!item || item.typeId !== cost.typeId) continue;
      const original = clone(item), taken = clone(item), take = Math.min(item.amount, remaining);
      taken.amount = take;
      const expected = item.amount > take ? clone(item) : undefined;
      if (expected) expected.amount -= take;
      container.setItem(slot, expected);
      charge.entries.push({ slot, original, taken, expected, refunded: false });
      remaining -= take;
    }
    if (remaining) throw new Error("扣费过程中背包发生变化。");
    return charge;
  } catch (error) {
    refundCharge(charge, container, overflow);
    throw error;
  }
}
