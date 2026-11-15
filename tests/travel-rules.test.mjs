import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRules, parseClock, gameClockMinutes, isTimeAllowed, remainingCooldown, destinationKey, cooldownProperty, inventoryChoices, chargeInventory, refundCharge } from '../packs/AdminTools BP/scripts/travel-rules.js';

class Stack {
  constructor(typeId, amount, metadata = {}) { Object.assign(this, { typeId, amount, metadata }); }
  clone() { return new Stack(this.typeId, this.amount, structuredClone(this.metadata)); }
  isStackableWith(other) { return this.typeId === other.typeId && JSON.stringify(this.metadata) === JSON.stringify(other.metadata); }
}
class Inventory {
  constructor(items) { this.items = items; this.size = items.length; }
  getItem(i) { return this.items[i]?.clone(); }
  setItem(i, item) { this.items[i] = item?.clone(); }
  addItem(item) {
    for (let i = 0; i < this.size; i++) { if (!this.items[i]) { this.setItem(i, item); return undefined; } }
    return item;
  }
}
const free = normalizeRules();
test('defaults and input validation include cooldown endpoints', () => {
  assert.equal(free.cooldownSeconds, 0);
  assert.equal(normalizeRules({cooldownSeconds:86400}).cooldownSeconds, 86400);
  for (const value of [-1, 86401, 0.5, '1e2', '', '  ', '2.0', NaN, Infinity, true, false, [], {}]) assert.throws(() => normalizeRules({cooldownSeconds:value}));
  assert.throws(() => normalizeRules({cost:{amount:1,typeId:''}}));
  assert.equal(normalizeRules({cost:{amount:0,typeId:''}}).cost.amount, 0);
});
test('strict 24-hour parsing and Bedrock 06:00 epoch', () => {
  assert.equal(parseClock('23:59'),1439);
  for (const value of ['24:00','6:00','06:60','-1:00','12:00:00']) assert.throws(() => parseClock(value));
  assert.equal(gameClockMinutes(0),360);
  assert.equal(gameClockMinutes(6000),720);
  assert.equal(gameClockMinutes(18000),0);
});
test('same-day and midnight windows use inclusive start and exclusive end', () => {
  const day={enabled:true,start:'06:00',end:'12:00'};
  assert.equal(isTimeAllowed(0,day),true);
  assert.equal(isTimeAllowed(5999,day),true);
  assert.equal(isTimeAllowed(6000,day),false);
  const night={enabled:true,start:'22:00',end:'06:00'};
  assert.equal(isTimeAllowed(16000,night),true);
  assert.equal(isTimeAllowed(18000,night),true);
  assert.equal(isTimeAllowed(23999,night),true);
  assert.equal(isTimeAllowed(0,night),false);
  assert.equal(isTimeAllowed(500,{enabled:true,start:'00:00',end:'00:00'}),true);
  assert.equal(isTimeAllowed(0,{enabled:false}),true);
});
test('cooldown is independent of owner, destination, kind and fresh destination id', () => {
  const a={kind:'home',ownerId:'a',name:'base',destinationId:'one'};
  const k=destinationKey(a);
  for(const b of [{...a,ownerId:'b'},{...a,kind:'warp'},{...a,destinationId:'two'}]) assert.notEqual(cooldownProperty(k),cooldownProperty(destinationKey(b)));
  assert.notEqual(destinationKey({...a,name:'renamed'}),k);
  assert.notEqual(destinationKey({...a,destinationId:'legacy',name:'first'}),destinationKey({...a,destinationId:'legacy',name:'second'}));
  assert.notEqual(destinationKey({...a,destinationId:undefined,name:'base'}),destinationKey({...a,destinationId:undefined,name:'other'}));
  assert.equal(remainingCooldown(1000,10,1001),10);
  assert.equal(remainingCooldown(1000,10,11000),0);
  assert.equal(remainingCooldown(1000,0,1001),0);
});
test('inventory picker aggregates types without losing transaction metadata', () => {
  const inv=new Inventory([new Stack('minecraft:diamond',3,{name:'one',enchant:'x'}),new Stack('minecraft:diamond',5,{name:'two'}),new Stack('minecraft:apple',2)]);
  assert.equal(inventoryChoices(inv).find(x=>x.typeId==='minecraft:diamond').amount,8);
  const original=structuredClone(inv.items);
  const charge=chargeInventory(inv,{typeId:'minecraft:diamond',amount:6});
  assert.equal(inv.getItem(0),undefined); assert.equal(inv.getItem(1).amount,2);
  refundCharge(charge,inv,()=>assert.fail('unexpected overflow'));
  assert.deepEqual(structuredClone(inv.items),original);
  refundCharge(charge,inv,()=>assert.fail('duplicate refund'));
  assert.deepEqual(structuredClone(inv.items),original);
});
test('insufficient inventory never removes any items; zero cost needs no inventory', () => {
  const inv=new Inventory([new Stack('minecraft:diamond',3)]);
  assert.throws(()=>chargeInventory(inv,{typeId:'minecraft:diamond',amount:4}));
  assert.equal(inv.getItem(0).amount,3);
  assert.deepEqual(chargeInventory(undefined,{typeId:'',amount:0}),{entries:[]});
});
test('failure partway through multi-slot debit restores earlier exact stacks', () => {
  const inv=new Inventory([new Stack('minecraft:diamond',3,{lore:'A'}),new Stack('minecraft:diamond',3,{lore:'B'})]);
  const set=inv.setItem.bind(inv); let failed=false;
  inv.setItem=(i,s)=>{if(i===1&&!failed){failed=true;throw new Error('write refused');}set(i,s);};
  assert.throws(()=>chargeInventory(inv,{typeId:'minecraft:diamond',amount:5}),/write refused/);
  assert.equal(inv.getItem(0).amount,3);assert.equal(inv.getItem(1).amount,3);
  assert.equal(inv.getItem(0).metadata.lore,'A');
});
test('refund overflow returns exact metadata and preserves unrelated new inventory', () => {
  const inv=new Inventory([new Stack('minecraft:diamond',2,{name:'precious'})]);
  const charge=chargeInventory(inv,{typeId:'minecraft:diamond',amount:2});
  inv.setItem(0,new Stack('minecraft:stone',64));
  const dropped=[];refundCharge(charge,inv,x=>dropped.push(x));
  assert.equal(inv.getItem(0).typeId,'minecraft:stone');
  assert.equal(dropped[0].metadata.name,'precious');assert.equal(dropped[0].amount,2);
});
