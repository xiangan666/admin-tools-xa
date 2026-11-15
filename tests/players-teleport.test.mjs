import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../packs/AdminTools BP/scripts/players.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const helper=source.slice(source.indexOf('function doPlayerTp('),source.indexOf('/** Pin the origin chunk'));
const carry=source.slice(source.indexOf('async function bringMount('),source.indexOf('/**\n * Teleport wrapper'));
const wrapper=source.slice(source.indexOf('export function teleportPlayer('),source.indexOf('// =========================================================\n// Offline rank sync')).replace('export function','function');
function setup({mounted=false,loaded=true,playerFails=false,parrotFails=false,mountResult='ok'}={}) {
 const events=[],tasks=new Map();let next=0,now=0,playerMoves=0,mountMoves=0,parrotMoves=0,releases=0;
 const system={runTimeout(fn,ticks){const id=++next;tasks.set(id,{fn,at:now+Math.max(1,ticks)});return id;}};
 const dim={id:'minecraft:overworld',getEntities:()=>[{isValid:true,teleport(){parrotMoves++;if(parrotFails)throw new Error('parrot unavailable');}}]};
 const mount={isValid:true,typeId:'minecraft:horse',dimension:dim,location:{x:0,y:65,z:0},getComponent:()=>({ejectRider:()=>events.push('eject')})};
 const player={id:'p',isValid:true,location:{x:0,y:65,z:0},dimension:dim,getComponent:()=>mounted?{entityRidingOn:mount}:undefined,teleport(_location,options){events.push('player');playerMoves++;assert.equal(options.beforeTeleport,undefined);assert.equal(options.afterTeleport,undefined);if(playerFails)throw new Error('player teleport refused');}};
 const context=vm.createContext({system,PARROT_SEARCH_RADIUS:8,COMPANION_MOUNTS:new Set(['minecraft:horse']),AERIAL_MOUNTS:new Set(),mountLabel:()=>'',t:()=>'',tell:()=>{},silentCatch:()=>{},isLoaded:()=>loaded||now>=3,placeMount:()=>{events.push('mount');mountMoves++;return mountResult;},afterPlace:(_ctx,r)=>events.push(`settle:${r}`),cushionAerialArrival:()=>{},acquireForceLoad:()=>({release:()=>{releases++;}}),ghastDbg:()=>{},_mtWait:t=>new Promise(resolve=>system.runTimeout(resolve,t))});
 vm.runInContext(helper+carry+wrapper+';globalThis.teleport=teleportPlayer;',context);
 return {player,dim,events,teleport:options=>context.teleport(player,{x:100,y:65,z:100},{dimension:dim,...options}),get playerMoves(){return playerMoves;},get mountMoves(){return mountMoves;},get parrotMoves(){return parrotMoves;},get releases(){return releases;},async advance(ticks){for(let i=0;i<ticks;i++){now++;for(const[id,task]of [...tasks])if(task.at<=now){tasks.delete(id);task.fn();}for(let j=0;j<4;j++)await Promise.resolve();}}};
}
test('non-mounted successful player move resolves true despite a failed parrot',async()=>{
 const f=setup({parrotFails:true});let before=0;const after=[];
 assert.equal(await f.teleport({beforeTeleport:()=>{before++;return true;},afterTeleport:ok=>after.push(ok)}),true);
 assert.equal(before,1);assert.deepEqual(after,[true]);assert.equal(f.playerMoves,1);assert.equal(f.parrotMoves,1);
});
test('failed player move calls failure once and never moves shoulder parrots',async()=>{
 const f=setup({playerFails:true});const after=[];
 assert.equal(await f.teleport({beforeTeleport:()=>true,afterTeleport:ok=>after.push(ok)}),false);
 assert.deepEqual(after,[false]);assert.equal(f.playerMoves,1);assert.equal(f.parrotMoves,0);
});
test('mounted cancellation checks before any mount/player movement on the deferred tick',async()=>{
 const f=setup({mounted:true});let before=0;const after=[];
 const result=f.teleport({beforeTeleport:()=>{before++;return false;},afterTeleport:ok=>after.push(ok)});
 assert.deepEqual(f.events,['eject']);assert.equal(before,0);
 await f.advance(1);assert.equal(await result,false);assert.equal(before,1);assert.equal(f.mountMoves,0);assert.equal(f.playerMoves,0);assert.deepEqual(after,[false]);
});
test('near mounted travel prepares once then moves mount and player once',async()=>{
 const f=setup({mounted:true});let before=0;const after=[];
 const result=f.teleport({beforeTeleport:()=>{before++;f.events.push('prepare');return true;},afterTeleport:ok=>after.push(ok)});
 await f.advance(1);assert.equal(await result,true);await f.advance(3);
 assert.equal(before,1);assert.deepEqual(after,[true]);assert.equal(f.mountMoves,1);assert.equal(f.playerMoves,1);assert.deepEqual(f.events.slice(0,4),['eject','prepare','mount','player']);
});
test('mount placement failure still counts a successful player teleport once',async()=>{
 const f=setup({mounted:true,mountResult:'failed'});const after=[];
 const result=f.teleport({beforeTeleport:()=>true,afterTeleport:ok=>after.push(ok)});
 await f.advance(1);assert.equal(await result,true);await f.advance(3);assert.deepEqual(after,[true]);assert.ok(f.events.includes('settle:failed'));
});
test('far carry resolves at actual player success then asynchronously carries mount',async()=>{
 const f=setup({mounted:true,loaded:false});let before=0;const after=[];
 const result=f.teleport({beforeTeleport:()=>{before++;return true;},afterTeleport:ok=>after.push(ok)});
 await f.advance(1);assert.equal(await result,true);assert.equal(f.mountMoves,0);assert.equal(f.playerMoves,1);
 await f.advance(12);assert.equal(before,1);assert.deepEqual(after,[true]);assert.equal(f.mountMoves,1);assert.equal(f.releases,1);
});
test('far carry failure refunds signal once and never carries mount after player failed',async()=>{
 const f=setup({mounted:true,loaded:false,playerFails:true});let before=0;const after=[];
 const result=f.teleport({beforeTeleport:()=>{before++;return true;},afterTeleport:ok=>after.push(ok)});
 await f.advance(1);assert.equal(await result,false);await f.advance(12);
 assert.equal(before,1);assert.deepEqual(after,[false]);assert.equal(f.mountMoves,0);assert.equal(f.parrotMoves,0);assert.equal(f.releases,1);
});
test('legacy fire-and-forget options still work and callback flags never reach engine',async()=>{
 const f=setup();assert.equal(await f.teleport({askToBringMount:true,bringMount:false}),true);assert.equal(f.playerMoves,1);
});
