import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { feedbackSource, makeScreenDisplay, messageText } from "./travel-feedback-fixture.mjs";

function fixture(options) {
  const messages = [], player = { onScreenDisplay: makeScreenDisplay(options) };
  const api = vm.runInNewContext(feedbackSource + "\n({ beginTravelWait, showTravelWait, clearTravelWait })",
    { tell: (_player, message) => messages.push(message) });
  return { ...api, player, messages, screen: player.onScreenDisplay };
}

test("wait begins immediately with chat, destination, title and movement warning", () => {
  const f = fixture(); f.beginTravelWait(f.player, 3, { rawtext: [{ text: "我的家" }] });
  assert.match(messageText(f.messages[0]), /我的家，需等待 3 秒.*请勿移动，移动会取消/);
  assert.match(f.screen.bar, /传送等待 3 秒.*请勿移动.*目的地：我的家/);
  assert.match(f.screen.title, /倒计时 3 秒/);
  assert.match(f.screen.subtitle, /目的地：我的家.*\n.*请勿移动/s);
  f.showTravelWait(f.player, 2, "我的家", { title: false });
  assert.match(f.screen.bar, /等待 2 秒/); assert.equal(f.screen.titles.length, 1);
  f.showTravelWait(f.player, 1, "我的家"); assert.match(f.screen.title, /倒计时 1 秒/);
  f.clearTravelWait(f.player);
  assert.equal(f.screen.bar, ""); assert.equal(f.screen.title, ""); assert.equal(f.screen.subtitle, "");
});

test("TPA receiver sees the waiting player's name and must also stay still", () => {
  const f = fixture(); f.beginTravelWait(f.player, 3, "访客", true);
  assert.match(messageText(f.messages[0]), /正在等待玩家 访客.*请勿移动/);
  assert.match(f.screen.subtitle, /等待玩家：访客/);
});

test("a failed HUD surface does not suppress the other surface or break cleanup", () => {
  const action = fixture({ actionError: true });
  assert.doesNotThrow(() => action.beginTravelWait(action.player, 3, "家"));
  assert.match(action.screen.title, /倒计时/); assert.equal(action.messages.length, 1);
  const title = fixture({ titleError: true });
  assert.doesNotThrow(() => title.beginTravelWait(title.player, 3, "家"));
  assert.match(title.screen.bar, /请勿移动/);
  assert.doesNotThrow(() => action.clearTravelWait(undefined));
  assert.doesNotThrow(() => title.clearTravelWait(title.player));
});
