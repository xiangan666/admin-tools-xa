import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { parse } from "acorn";
import { feedbackSource, makeScreenDisplay, messageText } from "./travel-feedback-fixture.mjs";

const source = await readFile(new URL("../packs/AdminTools BP/scripts/ui-player.js", import.meta.url), "utf8");
const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
function functions(names) {
  return ast.body.map(node => node.type === "ExportNamedDeclaration" ? node.declaration : node)
    .filter(node => node?.type === "FunctionDeclaration" && names.includes(node.id.name))
    .map(node => source.slice(node.start, node.end)).join("\n");
}

function menuFixture({ bed = true, admin = false, selection = 0 } = {}) {
  const labels = [], calls = [];
  class Form {
    title() { return this; } body() { return this; }
    button(label) { labels.push(label); return this; }
    async show() { return { canceled: false, selection }; }
  }
  const names = ["showTpToBed", "showTpHome", "showSetHome", "showRemoveHome", "showUpdateHomeLocation", "showEditHomeIcon", "showOwnHomeRules", "showHomeDirectory", "showHomeAccessMenu", "showHomeRevenue", "showHomeAdministration", "showPlayerMain"];
  const bindings = Object.fromEntries(names.map(name => [name, () => calls.push(name)]));
  const show = new vm.Script(`${functions(["showHomesMenu"])}\nshowHomesMenu`).runInNewContext({
    ...bindings, getCfg: () => ({}), getHomes: () => ({}), getMaxHomes: () => 3,
    getHomePolicy: () => ({ bedTeleportEnabled: bed }), isAdmin: () => ({ ok: admin }),
    ActionFormData: Form, t: key => key, tell: () => {}, warnForm: () => {}, CLOSE_BTN_LABEL: "close", CLOSE_BTN_ICON: "close",
  });
  return { labels, calls, run: () => show({}) };
}

test("bed disabled hides its button and leaves the first home action correctly wired", async () => {
  const f = menuFixture({ bed: false }); await f.run();
  assert.equal(f.labels.includes("jm_at.homes.btn_tp_bed"), false);
  assert.equal(f.labels[0], "jm_at.homes.btn_tp_home");
  assert.deepEqual(f.calls, ["showTpHome"]);
});

test("bed enabled keeps its original entry; admin management is visible only to admins", async () => {
  const normal = menuFixture(); await normal.run();
  assert.equal(normal.labels[0], "jm_at.homes.btn_tp_bed");
  assert.deepEqual(normal.calls, ["showTpToBed"]);
  assert.equal(normal.labels.some(label => String(label).includes("统一管理")), false);
  const admin = menuFixture({ bed: false, admin: true, selection: 9 }); await admin.run();
  assert.equal(admin.labels[9], "§l家园统一管理（管理员）");
  assert.deepEqual(admin.calls, ["showHomeAdministration"]);
});

function tripFixture({ delay = 0, defer = false, bed = true } = {}) {
  const policy = { bedTeleportEnabled: bed }, cfg = { tpaDelaySec: delay };
  const timers = new Map(), messages = [], warnings = [];
  let next = 0, teleports = 0, mountPrompts = 0, captured = 0;
  const system = {
    currentTick: 0, runTimeout(fn, ticks) { const id = ++next; timers.set(id, { fn, due: this.currentTick + ticks }); return id; },
    runInterval(fn, ticks) { const id = ++next; timers.set(id, { fn, due: this.currentTick + ticks, interval: ticks }); return id; },
    clearRun(id) { timers.delete(id); },
  };
  const player = { id: "player", isValid: true, location: { x: 0, y: 64, z: 0 }, dimension: { id: "minecraft:overworld" },
    getSpawnPoint: () => ({ x: 10, y: 65, z: 20, dimension: "minecraft:overworld" }), onScreenDisplay: makeScreenDisplay() };
  const show = new vm.Script(`${feedbackSource}\n${functions(["showTpToBed", "bedTravelAllowed", "startDelayedTeleport"])}\nshowTpToBed`).runInNewContext({
    getHomePolicy: () => policy, getCfg: () => cfg, isAdmin: () => ({ ok: false }),
    world: { getDimension: () => ({}) }, system, t: key => key, tell: (_p, message) => messages.push(message),
    warnForm: (_p, message) => warnings.push(message), silentCatch() {}, showHomesMenu() {},
    confirmBringMount: async () => { mountPrompts++; return "leave"; },
    captureTpBackLocation: () => { captured++; }, teleportedPlayers: new Set(),
    teleportPlayer: (_p, _pos, options) => new Promise(resolve => {
      const move = () => { const ok = options.beforeTeleport() === true; if (ok) teleports++; resolve(ok); };
      if (defer) system.runTimeout(move, 1); else move();
    }),
  });
  const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  return { policy, cfg, messages, warnings, player, get teleports() { return teleports; }, get prompts() { return mountPrompts; }, get captured() { return captured; },
    async run() { await show(player); await flush(); },
    async advance(n) { for (let tick = 0; tick < n; tick++) { system.currentTick++; for (const [id, timer] of [...timers]) {
      if (!timers.has(id) || timer.due > system.currentTick) continue;
      if (timer.interval) timer.due += timer.interval; else timers.delete(id);
      timer.fn();
    } await flush(); } },
  };
}

test("an old bed button cannot start travel after the admin disables it", async () => {
  const f = tripFixture({ bed: false }); await f.run();
  assert.equal(f.teleports, 0); assert.equal(f.prompts, 0); assert.equal(f.captured, 0);
  assert.ok(f.warnings.some(message => message.includes("关闭传送到床")));
});

test("disabling bed travel during countdown prevents movement and back-location capture", async () => {
  const f = tripFixture({ delay: 2 }); await f.run();
  f.policy.bedTeleportEnabled = false; await f.advance(40);
  assert.equal(f.teleports, 0); assert.equal(f.captured, 0);
  assert.ok(f.messages.some(message => messageText(message).includes("关闭此传送功能")));
  assert.equal(f.player.onScreenDisplay.bar, ""); assert.equal(f.player.onScreenDisplay.title, "");
});

test("the actual deferred mount tick also checks the bed switch", async () => {
  const f = tripFixture({ defer: true }); await f.run();
  f.policy.bedTeleportEnabled = false; await f.advance(1);
  assert.equal(f.teleports, 0); assert.equal(f.captured, 0);
});

test("enabled bed travel completes normally and closing homes also blocks it", async () => {
  const enabled = tripFixture({ delay: 1 }); await enabled.run(); await enabled.advance(20);
  assert.equal(enabled.teleports, 1); assert.equal(enabled.captured, 1);
  assert.ok(enabled.messages.includes("jm_at.tp.done"));
  const disabled = tripFixture(); disabled.cfg.homesEnabled = false; await disabled.run();
  assert.equal(disabled.teleports, 0);
});

test("bed wait warns immediately, refreshes the HUD, and clears it after arrival", async () => {
  const f = tripFixture({ delay: 2 }); await f.run();
  const screen = f.player.onScreenDisplay;
  assert.ok(f.messages.some(message => /需等待 2 秒.*请勿移动/.test(messageText(message))));
  assert.match(screen.subtitle, /目的地：jm_at.homes.dest_bed/);
  await f.advance(5); assert.equal(screen.bars.length, 2); assert.equal(screen.titles.length, 1);
  await f.advance(15); assert.match(screen.title, /倒计时 1 秒/); assert.equal(f.teleports, 0);
  await f.advance(20); assert.equal(f.teleports, 1); assert.equal(screen.bar, "");
  assert.doesNotMatch(screen.title, /倒计时/);
});

test("moving or changing dimension cancels bed wait and does not erase the cancellation title", async () => {
  for (const change of [player => { player.location.x++; }, player => { player.dimension.id = "minecraft:nether"; }]) {
    const f = tripFixture({ delay: 2 }); await f.run(); change(f.player); await f.advance(1);
    assert.equal(f.teleports, 0); assert.equal(f.captured, 0); assert.equal(f.player.onScreenDisplay.bar, "");
    assert.equal(f.player.onScreenDisplay.title, "jm_at.tp.title_canceled");
    await f.advance(50); assert.equal(f.teleports, 0);
    assert.equal(f.player.onScreenDisplay.title, "jm_at.tp.title_canceled");
  }
});

test("disconnecting during bed wait clears both HUD surfaces without executing later", async () => {
  const f = tripFixture({ delay: 2 }); await f.run(); f.player.isValid = false; await f.advance(50);
  assert.equal(f.teleports, 0); assert.equal(f.player.onScreenDisplay.bar, ""); assert.equal(f.player.onScreenDisplay.title, "");
});
