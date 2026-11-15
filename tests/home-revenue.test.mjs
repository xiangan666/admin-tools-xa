import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import * as core from "../packs/AdminTools BP/scripts/home-revenue-core.js";

const source = readFileSync(new URL("../packs/AdminTools BP/scripts/home-revenue.js", import.meta.url), "utf8")
  .replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");

class Stack {
  constructor(typeId = "minecraft:diamond", amount = 1) {
    this.typeId = typeId; this.amount = amount; this.maxAmount = 64; this.lockMode = "none";
    this.lore = []; this.dynamic = {}; this.destroy = []; this.place = [];
  }
  clone() { return Object.assign(new Stack(this.typeId, this.amount), JSON.parse(JSON.stringify(this))); }
  isStackableWith(other) {
    const data = stack => { const copy = { ...stack }; delete copy.amount; return JSON.stringify(copy); };
    return data(this) === data(other);
  }
  getRawLore() { return this.lore; } setLore(value) { this.lore = value; }
  getCanDestroy() { return this.destroy; } setCanDestroy(value) { this.destroy = value; }
  getCanPlaceOn() { return this.place; } setCanPlaceOn(value) { this.place = value; }
  getDynamicPropertyIds() { return Object.keys(this.dynamic); }
  getDynamicProperty(key) { return this.dynamic[key]; } setDynamicProperty(key, value) { this.dynamic[key] = value; }
  getComponent() { return undefined; }
}

function fixture() {
  const storage = new Map(), inventory = { size: 1, slots: [undefined],
    getItem(slot) { return this.slots[slot]?.clone(); }, setItem(slot, item) { this.slots[slot] = item?.clone(); } };
  const owner = { id: "owner", getComponent: () => ({ container: inventory }) };
  let id = 0, writes = 0, failAt = Infinity;
  const reload = () => vm.runInNewContext(source + "\n({prepareHomeRevenue,getHomeRevenue,claimHomeRevenue,snapshotRevenueItem})", {
    ...core, ItemStack: Stack, EnchantmentTypes: { get: () => undefined }, NS: "test",
    getWorldStr: key => storage.get(key), setWorldStr: (key, value) => {
      if (writes >= failAt) return false; writes++; storage.set(key, value); return true;
    },
    getPlayerXuid: p => p.id, genId: prefix => `${prefix}_${++id}`, utf8ByteLen: value => Buffer.byteLength(value), silentCatch() {},
  });
  const api = reload();
  return { api, reload, owner, inventory, storage,
    failAfter(successfulWrites) { failAt = writes + successfulWrites; }, recover() { failAt = Infinity; },
    prepare(amount = 10, taxPercent = 30, item = new Stack("minecraft:diamond", amount)) {
      return api.prepareHomeRevenue({ ownerId: "owner", payerId: "visitor", homeName: "Main", taxPercent }, { entries: [{ taken: item }] });
    },
    ledger: () => api.getHomeRevenue(owner),
  };
}

test("tax bounds and 0/30/100 percent splits use integer carry without losing small payments", () => {
  assert.deepEqual(core.taxSplit(10, 30), { gross: 10, tax: 3, net: 7, carry: 0 });
  assert.equal(core.taxSplit(10, 0).net, 10); assert.equal(core.taxSplit(10, 100).net, 0);
  for (const args of [[-1, 30], [1.1, 30], [1, 101], [1, 30, 100], [Number.MAX_SAFE_INTEGER, 100]]) assert.throws(() => core.taxSplit(...args));
  let ledger = core.emptyRevenueLedger();
  for (let i = 0; i < 10; i++) ledger = core.creditRevenue(ledger, {
    id: `visit-${i}`, taxPercent: 30, items: [{ key: "diamond", item: { typeId: "minecraft:diamond" }, amount: 1 }],
  });
  assert.equal(ledger.totals[0].gross, 10); assert.equal(ledger.totals[0].tax, 3);
  assert.equal(ledger.totals[0].net, 7); assert.equal(ledger.balances[0].amount, 7); assert.equal(ledger.totals[0].carry, 0);
  assert.deepEqual(core.emptyRevenueLedger().totals, []);
});

test("owner earnings reserve before success, credit only once, and survive owner-offline reload", () => {
  const f = fixture(), ticket = f.prepare();
  assert.equal(f.ledger().blocked, true); assert.equal(f.ledger().balances.length, 0);
  ticket.commit(); ticket.commit();
  assert.equal(f.ledger().balances[0].amount, 7); assert.equal(f.ledger().totals[0].tax, 3);
  assert.equal(f.ledger().history.length, 1); assert.equal(f.ledger().blocked, false);
  const reloaded = f.reload().getHomeRevenue(f.owner);
  assert.equal(reloaded.balances[0].amount, 7); assert.equal(reloaded.totals[0].gross, 10);
});

test("canceled income and failed reservation never create balance, tax carry or a successful receipt", () => {
  const f = fixture(), ticket = f.prepare(1); ticket.cancel(); ticket.cancel();
  assert.equal(ticket.commit(), false); assert.equal(f.ledger().balances.length, 0);
  assert.equal(f.ledger().totals.length, 0); assert.equal(f.ledger().pending.length, 0);
  f.failAfter(0); assert.throws(() => f.prepare(), /写入失败/);
  assert.equal(f.ledger().pending.length, 0); assert.equal(f.ledger().balances.length, 0);
});

test("unresolved income reservation stays frozen on reload instead of becoming claimable", () => {
  const f = fixture(); f.prepare(); const restarted = f.reload();
  assert.equal(restarted.getHomeRevenue(f.owner).blocked, true);
  assert.throws(() => restarted.claimHomeRevenue(f.owner), /待核查/);
  assert.throws(() => restarted.prepareHomeRevenue({ ownerId: "owner", payerId: "visitor", homeName: "Main", taxPercent: 30 },
    { entries: [{ taken: new Stack() }] }), /待核查/);
  assert.equal(f.inventory.slots[0], undefined);
});

test("full and partial inventory claims retain unclaimed balance and cannot mint twice", () => {
  const f = fixture(); f.prepare().commit(); f.inventory.slots[0] = new Stack("minecraft:diamond", 64);
  assert.equal(f.api.claimHomeRevenue(f.owner).amount, 0); assert.equal(f.ledger().balances[0].amount, 7);
  f.inventory.slots[0].amount = 63;
  const partial = f.api.claimHomeRevenue(f.owner);
  assert.equal(partial.amount, 1); assert.equal(partial.remaining, 6); assert.equal(f.inventory.slots[0].amount, 64);
  assert.equal(f.ledger().totals[0].claimed, 1);
  f.inventory.slots[0] = undefined;
  assert.equal(f.api.claimHomeRevenue(f.owner).amount, 6); assert.equal(f.inventory.slots[0].amount, 6);
  assert.equal(f.api.claimHomeRevenue(f.owner).amount, 0); assert.equal(f.ledger().totals[0].claimed, 7);
});

test("claim persistence failure before inventory mutation leaves all balances and items unchanged", () => {
  const f = fixture(); f.prepare().commit(); f.failAfter(0);
  assert.throws(() => f.api.claimHomeRevenue(f.owner), /写入失败/);
  assert.equal(f.inventory.slots[0], undefined); assert.equal(f.ledger().balances[0].amount, 7);
});

test("claim final-save failure keeps the finished session state and blocks duplicate delivery", () => {
  const f = fixture(); f.prepare().commit(); f.failAfter(1);
  assert.throws(() => f.api.claimHomeRevenue(f.owner), /会话内状态/); assert.equal(f.inventory.slots[0].amount, 7);
  assert.throws(() => f.api.claimHomeRevenue(f.owner), /写入失败/); assert.equal(f.inventory.slots[0].amount, 7);
  f.recover(); assert.equal(f.ledger().balances.length, 0); assert.equal(f.ledger().totals[0].claimed, 7);
  assert.equal(f.api.claimHomeRevenue(f.owner).amount, 0); assert.equal(f.inventory.slots[0].amount, 7);
});

test("unsafe special items are rejected while supported custom item metadata survives earnings and claim", () => {
  const f = fixture(); assert.throws(() => f.prepare(1, 30, new Stack("minecraft:written_book")), /特殊数据/);
  const item = new Stack("minecraft:diamond", 10); item.nameTag = "收入凭证"; item.lore = ["自定义说明"];
  item.dynamic.note = "saved";
  f.prepare(10, 30, item).commit(); f.api.claimHomeRevenue(f.owner);
  assert.equal(f.inventory.slots[0].amount, 7); assert.equal(f.inventory.slots[0].nameTag, "收入凭证");
  assert.deepEqual(f.inventory.slots[0].lore, ["自定义说明"]); assert.equal(f.inventory.slots[0].dynamic.note, "saved");
});
