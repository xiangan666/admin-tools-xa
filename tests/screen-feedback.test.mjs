import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readdirSync } from "node:fs";
import { titleFeedbackSource, makeScreenDisplay } from "./travel-feedback-fixture.mjs";
import { declarations, messagesSource, scriptSource } from "./source-fixture.mjs";

function fixture() {
  let tick = 0, nextId = 1;
  const jobs = new Map(), callbacks = new Map(), messages = [];
  const system = {
    runTimeout(callback, delay) {
      const id = nextId++; jobs.set(id, { at: tick + delay, callback }); callbacks.set(id, callback); return id;
    },
    clearRun(id) { jobs.delete(id); },
  };
  const source = [titleFeedbackSource, messagesSource,
    declarations("ui-kits.js", ["claimSuccessFeedback"]), declarations("kit-events.js", ["receivedFeedback"])].join("\n");
  const api = vm.runInNewContext(source + "\n({ setHudTitle, showTimedTitle, releaseTitleFeedback, claimSuccessFeedback, receivedFeedback })", {
    system, tell: (_player, message) => messages.push(message),
  });
  return {
    ...api, jobs, callbacks, messages,
    player(id = "p1", options) { return { id, isValid: true, onScreenDisplay: makeScreenDisplay(options), playSound() {} }; },
    advance(count) {
      for (let i = 0; i < count; i++) {
        tick++;
        for (const [id, job] of [...jobs]) if (job.at <= tick) { jobs.delete(id); job.callback(); }
      }
    },
  };
}

test("menu claims and script-event awards explicitly clear title and subtitle after their fade duration", () => {
  for (const method of ["claimSuccessFeedback", "receivedFeedback"]) {
    const f = fixture(), player = f.player();
    f[method](player, "玩家的自定义礼包名称", 3);
    const screen = player.onScreenDisplay;
    assert.match(screen.title, /jm_at.kits\.(kit_claimed_title|received_title)/);
    assert.equal(screen.subtitle, "玩家的自定义礼包名称");
    assert.equal(f.messages.length, 1);
    f.advance(45); assert.notEqual(screen.title, "");
    f.advance(1); assert.equal(screen.title, ""); assert.equal(screen.subtitle, "");
    assert.equal(f.jobs.size, 0);
  }
});

test("repeated claims replace the cleanup timer and stale callbacks cannot clear a new claim", () => {
  const f = fixture(), player = f.player();
  f.showTimedTitle(player, "第一次", { subtitle: "一" });
  const stale = [...f.callbacks.values()][0];
  f.advance(20); f.showTimedTitle(player, "第二次", { subtitle: "二" });
  assert.equal(f.jobs.size, 1);
  stale(); assert.equal(player.onScreenDisplay.title, "第二次");
  f.advance(26); assert.equal(player.onScreenDisplay.title, "第二次");
  f.advance(20); assert.equal(player.onScreenDisplay.title, "");
});

test("a later travel, AFK or territory title invalidates the old kit cleanup", () => {
  for (const label of ["传送倒计时 3 秒", "挂机中", "进入领地"]) {
    const f = fixture(), player = f.player();
    f.claimSuccessFeedback(player, "礼包", 0);
    const stale = [...f.callbacks.values()][0];
    f.setHudTitle(player, label, { subtitle: "后续提示" });
    assert.equal(f.jobs.size, 0);
    stale(); f.advance(100);
    assert.equal(player.onScreenDisplay.title, label);
    assert.equal(player.onScreenDisplay.subtitle, "后续提示");
  }
});

test("different players have independent title timers", () => {
  const f = fixture(), a = f.player("a"), b = f.player("b");
  f.showTimedTitle(a, "甲"); f.advance(10); f.showTimedTitle(b, "乙");
  f.advance(36);
  assert.equal(a.onScreenDisplay.title, ""); assert.equal(b.onScreenDisplay.title, "乙");
  f.advance(10); assert.equal(b.onScreenDisplay.title, "");
});

test("disconnect releases timers and a stale callback cannot clear a reconnected player's title", () => {
  const f = fixture(), old = f.player();
  f.showTimedTitle(old, "旧礼包"); const stale = [...f.callbacks.values()][0];
  old.isValid = false; f.releaseTitleFeedback(old.id);
  assert.equal(f.jobs.size, 0);
  const current = f.player(); f.showTimedTitle(current, "新礼包"); stale();
  assert.equal(current.onScreenDisplay.title, "新礼包");
  f.advance(46); assert.equal(current.onScreenDisplay.title, "");
  assert.equal(old.onScreenDisplay.titles.length, 1);
});

test("HUD failures and an invalidated player do not leak pending notification state", () => {
  const f = fixture(), player = f.player("bad", { titleError: true });
  assert.equal(f.showTimedTitle(player, "礼包"), false); assert.equal(f.jobs.size, 0);
  const left = f.player("left"); f.showTimedTitle(left, "礼包"); left.isValid = false;
  assert.doesNotThrow(() => f.advance(46)); assert.equal(f.jobs.size, 0);
  assert.equal(left.onScreenDisplay.titles.length, 1);
});

test("all addon title writers use the guard and playerLeave releases notification timers", () => {
  const directWriters = readdirSync(new URL("../packs/AdminTools BP/scripts", import.meta.url))
    .filter(file => file.endsWith(".js") && /\.onScreenDisplay\.setTitle\(/.test(scriptSource(file)));
  assert.deepEqual(directWriters, ["screen-feedback.js"]);
  assert.match(scriptSource("main.js"), /playerLeave\.subscribe\(\(ev\) => \{\s*releaseTitleFeedback\(ev.playerId\)/);
});
