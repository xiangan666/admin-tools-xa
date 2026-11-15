import test from "node:test";
import assert from "node:assert/strict";
import { makeHomeAt, validDestinationName } from "../packs/AdminTools BP/scripts/home-record.js";

test("覆盖及更新家园坐标保留传送规则、身份和其他扩展字段", () => {
  const rules = { cooldownSeconds: 86400, cost: { typeId: "minecraft:diamond", amount: 3 }, timeWindow: { enabled: true, start: "22:00", end: "05:00" } };
  const original = { x: 1, y: 2, z: 3, dimension: "overworld", icon: "old", rules, destinationId: "one", extra: "kept" };
  const result = makeHomeAt(original, { x: 9, y: 8, z: 7, dimension: "nether" }, "new", () => assert.fail("身份应保留"));
  assert.equal(result.destinationId, "one");
  assert.equal(result.rules, rules);
  assert.equal(result.extra, "kept");
  assert.equal(result.icon, "new");
  assert.equal(result.x, 9);
  assert.equal(original.x, 1);
});

test("旧家园迁移保持 legacy 授权；删除重建产生新身份", () => {
  const updated = makeHomeAt({ x: 1, icon: "old" }, { x: 2 }, undefined, () => "new");
  assert.equal(updated.destinationId, "legacy");
  assert.equal(updated.icon, "old");
  assert.equal(makeHomeAt(undefined, { x: 2 }, "icon", () => "new").destinationId, "new");
});

test("拒绝原型污染和控制字符家园名称", () => {
  for (const name of ["", "__proto__", "constructor", "prototype", "a\nb", "x".repeat(31)]) assert.equal(validDestinationName(name), false, name);
  for (const name of ["我的家", "House 2", "x".repeat(30)]) assert.equal(validDestinationName(name), true);
});
