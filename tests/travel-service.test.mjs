import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import { feedbackSource, makeScreenDisplay, messageText } from './travel-feedback-fixture.mjs';
import * as rules from '../packs/AdminTools BP/scripts/travel-rules.js';
import { normalizeHomePolicy, resolveHomeRulesPure } from '../packs/AdminTools BP/scripts/home-policy-core.js';

const playersSource=readFileSync(new URL('../packs/AdminTools BP/scripts/players.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const helper=playersSource.slice(playersSource.indexOf('function doPlayerTp('),playersSource.indexOf('/** Pin the origin chunk'));
const mount=playersSource.slice(playersSource.indexOf('async function bringMount('),playersSource.indexOf('/**\n * Teleport wrapper'));
const wrapper=playersSource.slice(playersSource.indexOf('export function teleportPlayer('),playersSource.indexOf('// =========================================================\n// Offline rank sync')).replace('export function','function');
const service=readFileSync(new URL('../packs/AdminTools BP/scripts/travel-service.js',import.meta.url),'utf8').replace(/import\s+[\s\S]*?\s+from\s+"([^"]+)";/g,(_m,path)=>path==='./travel-rules.js'?'const {normalizeRules,isTimeAllowed,gameClockMinutes,inventoryCount,chargeInventory,refundCharge,destinationKey,cooldownProperty,remainingCooldown}=rules;':'').replace('export async function','async function');
class Stack {
 constructor(amount,meta='kept'){this.typeId='minecraft:diamond';this.amount=amount;this.meta=meta;}
 clone(){return new Stack(this.amount,this.meta);}
 isStackableWith(x){return this.typeId===x.typeId&&this.meta===x.meta;}
}
function fixture({delay=0,mounted=false,failTeleport=false,formSelection=1,policy=null,authorized=true}={}) {
 let next=0;const timers=new Map();const messages=[];const properties=new Map();
  const forms=[],revenueTickets=[];
  class FakeMessageFormData {
    title(value){this.formTitle=value;return this;}
    body(value){this.formBody=value;return this;}
    button1(value){this.cancelLabel=value;return this;}
    button2(value){this.confirmLabel=value;return this;}
    async show(){forms.push({title:this.formTitle,body:this.formBody,cancel:this.cancelLabel,confirm:this.confirmLabel});return {canceled:false,selection:formSelection};}
  }
 const cfg={tpaDelaySec:delay};
 const system={currentTick:0,runTimeout(fn,ticks){const id=++next;timers.set(id,{fn,due:this.currentTick+Math.max(1,ticks)});return id;},runInterval(fn,ticks){const id=++next;timers.set(id,{fn,due:this.currentTick+ticks,interval:ticks});return id;},clearRun(id){timers.delete(id);}};
 const dimension={id:'minecraft:overworld',getEntities:()=>[],spawnItem:()=>{},getBlock:()=>({})};
 const inventory={size:2,items:[new Stack(12),undefined],getItem(i){return this.items[i]?.clone();},setItem(i,x){this.items[i]=x?.clone();},addItem(x){const i=this.items.findIndex(v=>!v);if(i>=0){this.items[i]=x.clone();return;}return x;}};
 const ridden={isValid:true,typeId:'minecraft:horse',getComponent:()=>({ejectRider:()=>{}})};
 const player={id:'p1',isValid:true,location:{x:0,y:64,z:0},dimension,onScreenDisplay:makeScreenDisplay(),teleports:0,getDynamicProperty:k=>properties.get(k),setDynamicProperty:(k,v)=>{properties.set(k,v);},getComponent:k=>k==='minecraft:inventory'?{container:inventory}:mounted?{entityRidingOn:ridden}:undefined,teleport(pos,opts){this.teleports++;assert.equal(opts.beforeTeleport,undefined);assert.equal(opts.afterTeleport,undefined);if(failTeleport)throw new Error('refused');this.location={...pos};this.dimension=opts.dimension;}};
 const context=vm.createContext({rules,MessageFormData:FakeMessageFormData,system,world:{getTimeOfDay:()=>0,getDimension:()=>dimension},getCfg:()=>cfg,isAdmin:()=>({ok:false}),tell:(_p,m)=>messages.push(m),silentCatch:()=>{},getPlayerXuid:p=>p.id,t:(k,...args)=>({translate:k,args}),raw:(...parts)=>parts,fmtDimRaw:value=>value,itemName:value=>value,getHomePolicy:()=>policy?normalizeHomePolicy(policy):null,resolveHomeRules:resolveHomeRulesPure,prepareHomeRevenue:(meta,charge)=>{revenueTickets.push({meta,charge});return {meta,charge,commit:()=>true,cancel:()=>true};},captureTpBackLocation:()=>{},teleportedPlayers:new Set(),confirmBringMount:async()=>'bring',COMPANION_MOUNTS:new Set(['minecraft:horse']),AERIAL_MOUNTS:new Set(),isLoaded:()=>true,placeMount:()=>true,afterPlace:()=>{},cushionAerialArrival:()=>{},mountLabel:()=>({translate:'horse'})});
 vm.runInContext(helper+mount+wrapper+feedbackSource+service+';globalThis.start=startRuleTeleport;',context);
 const destination={x:100,y:65,z:200,dimension:'overworld',destinationId:'home-1',rules:{cooldownSeconds:10,cost:{typeId:'minecraft:diamond',amount:2}}};
 let allowed=true,consumed=0;
 const descriptor={kind:'home',ownerId:'owner',name:'home',getDestination:()=>destination,authorize:()=>allowed&&authorized,onSuccess:()=>{consumed++;}};
 const bodyText=()=>forms.length?JSON.stringify(forms[0].body):'';
 return {context,system,player,inventory,cfg,destination,descriptor,messages,properties,forms,revenueTickets,bodyText,get consumed(){return consumed;},set allowed(v){allowed=v;},async flush(){for(let i=0;i<12;i++)await Promise.resolve();},async advance(n){for(let t=0;t<n;t++){system.currentTick++;for(const[id,timer]of [...timers]){if(timer.due>system.currentTick)continue;if(timer.interval)timer.due+=timer.interval;else timers.delete(id);timer.fn();}for(let i=0;i<12;i++)await Promise.resolve();}},start(){return context.start(player,descriptor);}};
}
test('successful transaction charges once and separately persists destination cooldown',async()=>{
 const f=fixture();assert.equal(await f.start(),true);assert.equal(f.inventory.getItem(0).amount,10);assert.equal(f.consumed,1);assert.equal(f.properties.size,1);
 assert.equal(await f.start(),false);assert.equal(f.player.teleports,1);assert.equal(f.consumed,1);
 f.descriptor.ownerId='other';assert.equal(await f.start(),true);assert.equal(f.inventory.getItem(0).amount,8);assert.equal(f.properties.size,2);
});
test('engine teleport failure refunds metadata and never consumes cooldown or grant',async()=>{
 const f=fixture({failTeleport:true});assert.equal(await f.start(),false);assert.equal(f.inventory.getItem(0).amount,12);assert.equal(f.inventory.getItem(0).meta,'kept');assert.equal(f.properties.size,0);assert.equal(f.consumed,0);
});
test('mounted next-tick path revalidates authorization before removing any items',async()=>{
 const f=fixture({mounted:true});const trip=f.start();await f.flush();f.allowed=false;await f.advance(1);assert.equal(await trip,false);assert.equal(f.player.teleports,0);assert.equal(f.inventory.getItem(0).amount,12);assert.equal(f.properties.size,0);
});
test('mounted actual failure refunds and returns false rather than early success',async()=>{
 const f=fixture({mounted:true,failTeleport:true});const trip=f.start();await f.flush();assert.equal(f.properties.size,0);await f.advance(1);assert.equal(await trip,false);assert.equal(f.inventory.getItem(0).amount,12);assert.equal(f.consumed,0);
});
test('movement cancels a countdown with no cost, cooldown, or visit consumption',async()=>{
 const f=fixture({delay:2});const trip=f.start();await f.flush();f.player.location.x=1;await f.advance(1);assert.equal(await trip,false);assert.equal(f.inventory.getItem(0).amount,12);assert.equal(f.consumed,0);assert.equal(f.player.teleports,0);
 assert.equal(f.player.onScreenDisplay.bar,'');assert.match(f.player.onScreenDisplay.title,/传送已取消/);
 await f.advance(50);assert.match(f.player.onScreenDisplay.title,/传送已取消/);
});

test('home and warp waits show conditions immediately and refresh until actual success',async()=>{
 for (const kind of ['home','warp']) {
  const f=fixture({delay:2});f.descriptor.kind=kind;const trip=f.start();await f.flush();
  const screen=f.player.onScreenDisplay;
  assert.ok(f.messages.some(message=>/即将传送到 home.*需等待 2 秒.*请勿移动/.test(messageText(message))));
  assert.match(screen.subtitle,/目的地：home/);assert.equal(f.inventory.getItem(0).amount,12);
  await f.advance(5);assert.equal(screen.bars.length,2);assert.equal(screen.titles.length,1);
  await f.advance(15);assert.match(screen.title,/倒计时 1 秒/);assert.equal(f.player.teleports,0);
  await f.advance(20);assert.equal(await trip,true);assert.equal(screen.bar,'');assert.equal(screen.title,'');
  assert.equal(f.inventory.getItem(0).amount,10);
 }
});

test('disconnecting clears rule travel feedback without charging or starting cooldown',async()=>{
 const f=fixture({delay:2});const trip=f.start();await f.flush();f.player.isValid=false;await f.advance(1);
 assert.equal(await trip,false);assert.equal(f.player.onScreenDisplay.bar,'');assert.equal(f.player.onScreenDisplay.title,'');
 assert.equal(f.inventory.getItem(0).amount,12);assert.equal(f.properties.size,0);assert.equal(f.consumed,0);
});
test('rules and inventory are read again after countdown',async()=>{
 const f=fixture({delay:1});const trip=f.start();await f.flush();f.destination.rules.cost.amount=13;await f.advance(20);assert.equal(await trip,false);assert.equal(f.inventory.getItem(0).amount,12);assert.equal(f.player.teleports,0);
});
test('same-player concurrent travel is refused without a second countdown',async()=>{
 const f=fixture({delay:1});const trip=f.start();await f.flush();assert.equal(await f.start(),false);await f.advance(20);assert.equal(await trip,true);assert.equal(f.player.teleports,1);assert.equal(f.inventory.getItem(0).amount,10);
});
test('destination changed in the mounted deferred tick does not use stale coordinates',async()=>{
 const f=fixture({mounted:true});const trip=f.start();await f.flush();f.destination.x=300;await f.advance(1);assert.equal(await trip,false);assert.equal(f.player.teleports,0);assert.equal(f.inventory.getItem(0).amount,12);
});
test('onSuccess persistence error never relabels a real success or refunds fee',async()=>{
 const f=fixture();f.descriptor.onSuccess=()=>{throw new Error('disk refused');};assert.equal(await f.start(),true);assert.equal(f.player.teleports,1);assert.equal(f.inventory.getItem(0).amount,10);assert.equal(f.properties.size,1);assert.equal(await f.start(),false);
});
test('confirmation shows live conditions and cancellation has no transaction effects',async()=>{
 const f=fixture({formSelection:0,authorized:false,policy:{serverRules:{cooldownSeconds:30,cost:{typeId:'minecraft:diamond',amount:1},timeWindow:{enabled:true,start:'22:00',end:'23:00'}}}});
 assert.equal(await f.start(),false);
 assert.match(f.bodyText(),/游戏时间：06:00/);
 assert.match(f.bodyText(),/访问授权：未授权/);
 assert.match(f.bodyText(),/当前不允许/);
 assert.match(f.bodyText(),/背包现有 12，足够/);
 assert.equal(f.inventory.getItem(0).amount,12);
 assert.equal(f.player.teleports,0);
 assert.equal(f.properties.size,0);
 assert.equal(f.consumed,0);
});
test('server and owner fees are both charged while only the owner fee enters earnings',async()=>{
 const f=fixture({policy:{serverRules:{cost:{typeId:'minecraft:diamond',amount:3}}}});
 assert.equal(await f.start(),true);
 assert.equal(f.inventory.getItem(0).amount,7);
 assert.equal(f.player.teleports,1);
 assert.equal(f.forms.length,1);
 assert.equal(f.revenueTickets.length,1);
 assert.equal(f.revenueTickets[0].meta.taxPercent,30);
 assert.equal(f.revenueTickets[0].charge.entries.reduce((sum,entry)=>sum+entry.taken.amount,0),2);
});
test('disabled home travel is refused without a charge, cooldown, grant consumption or earnings',async()=>{
 const f=fixture({policy:{}});f.destination.teleportEnabled=false;
 assert.equal(await f.start(),false);assert.equal(f.inventory.getItem(0).amount,12);
 assert.equal(f.player.teleports,0);assert.equal(f.properties.size,0);assert.equal(f.consumed,0);assert.equal(f.revenueTickets.length,0);
 assert.ok(f.messages.some(message=>String(message).includes('关闭此家园')));
});
test('admin disabling a home during the actual mounted tick cancels the already confirmed request',async()=>{
 const f=fixture({mounted:true,policy:{}});const trip=f.start();await f.flush();
 f.destination.teleportEnabled=false;await f.advance(1);
 assert.equal(await trip,false);assert.equal(f.inventory.getItem(0).amount,12);
 assert.equal(f.player.teleports,0);assert.equal(f.properties.size,0);assert.equal(f.consumed,0);assert.equal(f.revenueTickets.length,0);
});
