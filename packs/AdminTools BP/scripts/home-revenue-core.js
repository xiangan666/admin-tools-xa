/** Pure integer tax and owner-ledger operations. Minecraft objects stay in the adapter. */
export const REVENUE_LIMITS = Object.freeze({ balances: 96, types: 96, history: 30, bytes: 30000 });
const copy = (value) => JSON.parse(JSON.stringify(value));
const safe = (n) => Number.isSafeInteger(n) && n >= 0;

export function taxSplit(amount, taxPercent, carry = 0) {
  if (!safe(amount) || !Number.isInteger(taxPercent) || taxPercent < 0 || taxPercent > 100 ||
      !Number.isInteger(carry) || carry < 0 || carry > 99) throw new Error("税额或数量无效。");
  const hundredths = amount * taxPercent + carry;
  if (!Number.isSafeInteger(hundredths)) throw new Error("税务累计超过安全数值范围。");
  const tax = Math.floor(hundredths / 100);
  return { gross: amount, tax, net: amount - tax, carry: hundredths % 100 };
}

export function emptyRevenueLedger() {
  return { version: 1, balances: [], totals: [], pending: [], pendingClaims: [], history: [] };
}

export function validateRevenueLedger(value) {
  if (!value || value.version !== 1 || !["balances", "totals", "pending", "pendingClaims", "history"].every(key => Array.isArray(value[key]))) throw new Error("家园收益账本格式无效，请联系服主核查。");
  if (value.balances.length > REVENUE_LIMITS.balances || value.totals.length > REVENUE_LIMITS.types || value.history.length > REVENUE_LIMITS.history) throw new Error("家园收益账本容量异常。");
  const keys = new Set(), types = new Set();
  for (const balance of value.balances) {
    if (!balance || typeof balance.key !== "string" || !balance.item?.typeId || !safe(balance.amount) || balance.amount === 0 || keys.has(balance.key)) throw new Error("家园收益余额无效。");
    keys.add(balance.key);
  }
  for (const total of value.totals) {
    if (!total || typeof total.typeId !== "string" || types.has(total.typeId) ||
        !["gross", "tax", "net", "claimed"].every(key => safe(total[key])) || !Number.isInteger(total.carry) || total.carry < 0 || total.carry > 99) throw new Error("家园收益统计无效。");
    types.add(total.typeId);
  }
  return value;
}

function addSafe(a, b) {
  const n = a + b;
  if (!safe(n)) throw new Error("收益累计超过安全数值范围，请联系服主。");
  return n;
}

export function creditRevenue(ledger, receipt, at = Date.now()) {
  const result = copy(validateRevenueLedger(ledger));
  const taxByType = new Map();
  for (const incoming of receipt.items) {
    if (!incoming.item?.typeId || !safe(incoming.amount) || incoming.amount === 0) throw new Error("收入物品记录无效。");
    taxByType.set(incoming.item.typeId, addSafe(taxByType.get(incoming.item.typeId) || 0, incoming.amount));
  }
  const rows = [];
  for (const [typeId, gross] of taxByType) {
    let total = result.totals.find(row => row.typeId === typeId);
    if (!total) {
      if (result.totals.length >= REVENUE_LIMITS.types) throw new Error("收益物品种类已满，请联系服主。");
      total = { typeId, gross: 0, tax: 0, net: 0, claimed: 0, carry: 0 };
      result.totals.push(total);
    }
    const split = taxSplit(gross, receipt.taxPercent, total.carry);
    for (const name of ["gross", "tax", "net"]) total[name] = addSafe(total[name], split[name]);
    total.carry = split.carry;
    let taxLeft = split.tax;
    for (const incoming of receipt.items.filter(item => item.item.typeId === typeId)) {
      const withheld = Math.min(incoming.amount, taxLeft);
      taxLeft -= withheld;
      const amount = incoming.amount - withheld;
      if (!amount) continue;
      let balance = result.balances.find(row => row.key === incoming.key);
      if (!balance) {
        if (result.balances.length >= REVENUE_LIMITS.balances) throw new Error("未领取的收益物品种类或数据已满，请先领取。");
        balance = { key: incoming.key, item: copy(incoming.item), amount: 0 };
        result.balances.push(balance);
      }
      balance.amount = addSafe(balance.amount, amount);
    }
    rows.push({ typeId, gross, tax: split.tax, net: split.net });
  }
  result.pending = result.pending.filter(row => row.id !== receipt.id);
  result.history.unshift({ kind: "income", id: receipt.id, homeName: receipt.homeName, payerId: receipt.payerId, taxPercent: receipt.taxPercent, at, items: rows });
  result.history.length = Math.min(result.history.length, REVENUE_LIMITS.history);
  return result;
}

export function reserveRevenueClaim(ledger, id, claims, at = Date.now()) {
  const result = copy(validateRevenueLedger(ledger));
  for (const claim of claims) {
    const row = result.balances.find(item => item.key === claim.key);
    if (!row || !safe(claim.amount) || !claim.amount || claim.amount > row.amount) throw new Error("收益余额已变化，请刷新后领取。");
    row.amount -= claim.amount;
  }
  result.balances = result.balances.filter(row => row.amount > 0);
  result.pendingClaims.push({ id, at, claims: copy(claims) });
  return result;
}

export function finishRevenueClaim(ledger, id, at = Date.now()) {
  const result = copy(validateRevenueLedger(ledger));
  const claim = result.pendingClaims.find(row => row.id === id);
  if (!claim) throw new Error("找不到待完成的收益领取记录。");
  for (const row of claim.claims) {
    const total = result.totals.find(total => total.typeId === row.typeId);
    if (!total) throw new Error("收益统计记录缺失。");
    total.claimed = addSafe(total.claimed, row.amount);
  }
  result.pendingClaims = result.pendingClaims.filter(row => row.id !== id);
  result.history.unshift({ kind: "claim", id, at, items: claim.claims.map(({ typeId, amount }) => ({ typeId, amount })) });
  result.history.length = Math.min(result.history.length, REVENUE_LIMITS.history);
  return result;
}
