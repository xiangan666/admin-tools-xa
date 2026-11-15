import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { feedbackSource, makeScreenDisplay, messageText } from "./travel-feedback-fixture.mjs";

const source = readFileSync(new URL("../packs/AdminTools BP/scripts/tpa.js", import.meta.url), "utf8")
  .replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");

function fixture({ delay = 3, success = true, deferred = false } = {}) {
  const messages = [], timers = new Map(), storage = new Map(), cfg = { tpaDelaySec: delay };
  let next = 0, teleports = 0, captured = 0;
  const system = { currentTick: 0,
    runInterval(fn, interval) { const id = ++next; timers.set(id, { fn, interval, due: this.currentTick + interval }); return id; },
    runTimeout(fn, ticks) { const id = ++next; timers.set(id, { fn, due: this.currentTick + ticks }); return id; },
    clearRun(id) { timers.delete(id); },
  };
  const player = name => ({ id: name, name, isValid: true, dimension: { id: "minecraft:overworld" },
    location: { x: 0, y: 64, z: 0 }, onScreenDisplay: makeScreenDisplay() });
  const requester = player("访客"), acceptor = player("房主");
  const req = { id: "request", requesterName: requester.name, targetName: acceptor.name, createdAt: Date.now() };
  storage.set("test:tpa_requests", JSON.stringify([req]));
  const api = vm.runInNewContext(feedbackSource + "\n" + source + "\n({ acceptTpaRequest })", {
    NS: "test", system, world: { getPlayers: () => [requester, acceptor].filter(p => p.isValid) },
    getWorldStr: key => storage.get(key), setWorldStr: (key, value) => storage.set(key, value), getCfg: () => cfg,
    tell: (p, message) => messages.push({ player: p.name, message: messageText(message) }), t: key => key,
    safeJsonStringify: JSON.stringify, silentCatch() {}, isAdmin: () => ({ ok: false }), teleportedPlayers: new Set(),
    captureTpBackLocation: () => { captured++; },
    teleportPlayer: (_p, _location, options) => new Promise(resolve => {
      const move = () => { const ok = success && options.beforeTeleport() === true; if (ok) teleports++; resolve(ok); };
      if (deferred) system.runTimeout(move, 1); else move();
    }),
  });
  const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  return { requester, acceptor, cfg, messages, timers, get teleports() { return teleports; }, get captured() { return captured; },
    async run() { api.acceptTpaRequest(acceptor, req); await flush(); },
    async advance(n) { for (let tick = 0; tick < n; tick++) { system.currentTick++;
      for (const [id, timer] of [...timers]) { if (!timers.has(id) || timer.due > system.currentTick) continue;
        if (timer.interval) timer.due += timer.interval; else timers.delete(id); timer.fn(); }
      await flush();
    } },
  };
}

test("TPA warns both players immediately, refreshes countdown, and clears waits on success", async () => {
  const f = fixture(); await f.run();
  assert.match(f.requester.onScreenDisplay.subtitle, /目的地：房主.*请勿移动/s);
  assert.match(f.acceptor.onScreenDisplay.subtitle, /等待玩家：访客.*请勿移动/s);
  assert.equal(f.messages.filter(m => /需等待 3 秒.*请勿移动/.test(m.message)).length, 2);
  await f.advance(5); assert.equal(f.requester.onScreenDisplay.bars.length, 2); assert.equal(f.requester.onScreenDisplay.titles.length, 1);
  await f.advance(15); assert.match(f.acceptor.onScreenDisplay.title, /倒计时 2 秒/);
  await f.advance(40); assert.equal(f.teleports, 1); assert.equal(f.captured, 1);
  assert.equal(f.requester.onScreenDisplay.bar, ""); assert.equal(f.acceptor.onScreenDisplay.bar, "");
  assert.equal(f.acceptor.onScreenDisplay.title, ""); assert.equal(f.requester.onScreenDisplay.title, "jm_at.tpa.title_done");
  assert.equal(f.timers.size, 0);
});

test("either TPA player moving or changing dimension cancels both waits", async () => {
  for (const change of [f => { f.requester.location.x++; }, f => { f.acceptor.location.x++; }, f => { f.acceptor.dimension.id = "minecraft:nether"; }]) {
    const f = fixture(); await f.run(); change(f); await f.advance(1);
    assert.equal(f.teleports, 0); assert.equal(f.captured, 0);
    for (const p of [f.requester, f.acceptor]) { assert.equal(p.onScreenDisplay.bar, ""); assert.equal(p.onScreenDisplay.title, "jm_at.tpa.title_canceled"); }
    await f.advance(65); assert.equal(f.teleports, 0); assert.equal(f.timers.size, 0);
  }
});

test("TPA disconnect clears feedback for the remaining player and never moves later", async () => {
  const f = fixture(); await f.run(); f.requester.isValid = false; await f.advance(65);
  assert.equal(f.acceptor.onScreenDisplay.bar, ""); assert.equal(f.acceptor.onScreenDisplay.title, "");
  assert.equal(f.teleports, 0); assert.equal(f.timers.size, 0);
  assert.ok(f.messages.some(m => m.player === "房主" && m.message === "jm_at.tpa.cancel_left"));
});

test("TPA reports completion only after a successful actual teleport", async () => {
  for (const delay of [0, 1]) {
    const f = fixture({ delay, success: false }); await f.run(); if (delay) await f.advance(20);
    assert.equal(f.teleports, 0); assert.equal(f.captured, 0);
    assert.equal(f.messages.some(m => m.message === "jm_at.tpa.teleported" || m.message === "jm_at.tpa.arrived"), false);
    assert.ok(f.messages.some(m => m.message === "jm_at.tpa.failed"));
    assert.equal(f.requester.onScreenDisplay.bar, "");
  }
});

test("disabling TPA in the deferred actual move tick rejects an already finished countdown", async () => {
  const f = fixture({ delay: 1, deferred: true }); await f.run(); await f.advance(20);
  assert.equal(f.teleports, 0); assert.equal(f.messages.some(m => m.message === "jm_at.tpa.teleported"), false);
  f.cfg.tpaEnabled = false; await f.advance(1); assert.equal(f.teleports, 0); assert.equal(f.captured, 0);
  assert.ok(f.messages.some(m => m.message === "jm_at.tpa.failed"));
});

test("zero-delay TPA skips waiting prompts and still uses the actual success result", async () => {
  const f = fixture({ delay: 0 }); await f.run();
  assert.equal(f.teleports, 1); assert.equal(f.captured, 1);
  assert.equal(f.messages.some(m => /需等待/.test(m.message)), false); assert.equal(f.timers.size, 0);
  assert.ok(f.messages.some(m => m.message === "jm_at.tpa.teleported"));
});
