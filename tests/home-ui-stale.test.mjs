import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { makeHomeAt } from "../packs/AdminTools BP/scripts/home-record.js";

// Execute the actual UI functions without loading the Minecraft-only imports.
const source = await readFile(new URL("../packs/AdminTools BP/scripts/ui-player.js", import.meta.url), "utf8");
function uiFunction(name, bindings) {
  const start = source.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `Missing actual UI function: ${name}`);
  const rest = source.slice(start);
  const boundary = /\n(?:export )?async function /.exec(rest);
  assert.ok(boundary, `Missing next function boundary: ${name}`);
  return new vm.Script(`${rest.slice(0, boundary.index)}\n${name}`, { filename: `ui-player.js:${name}` })
    .runInNewContext(bindings);
}

function fixture(name, mutateDuringLastForm) {
  let saved = {
    Main: { destinationId: "main-1", x: 1, y: 64, z: 2, dimension: "minecraft:overworld", icon: "old-icon", rules: { cooldownSeconds: 5 } },
    Other: { destinationId: "other-1", x: 10, y: 60, z: 20, dimension: "minecraft:overworld", rules: { cooldownSeconds: 10 } },
  };
  const snapshot = structuredClone(saved);
  const messages = [];
  let writes = 0;
  let displays = 0;
  class FakeForm {
    title() { return this; }
    body() { return this; }
    button() { return this; }
    button1() { return this; }
    button2() { return this; }
    async show() {
      displays++;
      // Mutation happens after the call suspends, while the second form is open.
      await Promise.resolve();
      if (displays === 2) mutateDuringLastForm(saved);
      return { canceled: false, selection: displays === 1 ? 0 : 1 };
    }
  }
  const bindings = {
    ActionFormData: FakeForm, MessageFormData: FakeForm,
    HOME_ICONS: [{ key: "old-icon", labelKey: "old" }, { key: "new-icon", labelKey: "new" }],
    CLOSE_BTN_LABEL: "关闭", CLOSE_BTN_ICON: "close",
    t: (key, ...args) => ({ translate: key, with: args }), raw: (...parts) => parts,
    fmtDimRaw: (dimension) => dimension, getHomeIconPath: (home) => home.icon || "icon",
    getHomes: () => structuredClone(saved),
    setHomes: (_player, homes) => { saved = structuredClone(homes); writes++; return true; },
    makeHomeAt, genId: () => "new-id", tell: (_player, message) => messages.push(message),
    logPlayer: () => {}, showHomesMenu: () => "back",
    warnForm: () => { throw new Error("Unexpected empty-home warning"); },
  };
  const player = { location: { x: 100, y: 75, z: 200 }, dimension: { id: "minecraft:nether" } };
  return {
    run: () => uiFunction(name, bindings)(player, snapshot, Object.keys(snapshot)),
    current: () => structuredClone(saved), writes: () => writes, messages,
  };
}

test("coordinate confirmation preserves rules updated while the form is open", async () => {
  const f = fixture("showUpdateHomeLocation", (homes) => {
    homes.Main.rules = { cooldownSeconds: 86400, cost: { typeId: "minecraft:emerald", amount: 4 } };
    homes.Other.rules.cooldownSeconds = 333;
    homes.Added = { destinationId: "added", x: 9, y: 90, z: 9 };
  });
  await f.run();
  const homes = f.current();
  assert.equal(f.writes(), 1);
  assert.equal(homes.Main.x, 100);
  assert.equal(homes.Main.y, 75);
  assert.equal(homes.Main.z, 200);
  assert.equal(homes.Main.dimension, "minecraft:nether");
  assert.equal(homes.Main.destinationId, "main-1");
  assert.equal(homes.Main.icon, "old-icon");
  assert.deepEqual(homes.Main.rules, { cooldownSeconds: 86400, cost: { typeId: "minecraft:emerald", amount: 4 } });
  assert.equal(homes.Other.rules.cooldownSeconds, 333);
  assert.equal(homes.Added.destinationId, "added");
});

test("icon picker changes only the latest target icon and preserves concurrent rules", async () => {
  const f = fixture("showEditHomeIcon", (homes) => {
    homes.Main.rules.cooldownSeconds = 7200;
    homes.Other.rules.cooldownSeconds = 55;
    homes.Main.x = 500;
  });
  await f.run();
  const homes = f.current();
  assert.equal(f.writes(), 1);
  assert.equal(homes.Main.icon, "new-icon");
  assert.equal(homes.Main.rules.cooldownSeconds, 7200);
  assert.equal(homes.Main.x, 500);
  assert.equal(homes.Other.rules.cooldownSeconds, 55);
});

test("deleting one home preserves other homes changed during confirmation", async () => {
  const f = fixture("showRemoveHome", (homes) => {
    homes.Other.rules = { cooldownSeconds: 1234, timeWindow: { enabled: true, start: "22:00", end: "06:00" } };
    homes.Added = { destinationId: "added-later", x: 8, y: 65, z: 8 };
  });
  await f.run();
  const homes = f.current();
  assert.equal(f.writes(), 1);
  assert.equal(Object.hasOwn(homes, "Main"), false);
  assert.equal(homes.Other.rules.cooldownSeconds, 1234);
  assert.equal(homes.Other.rules.timeWindow.start, "22:00");
  assert.equal(homes.Added.destinationId, "added-later");
});

test("all three forms reject deleted or recreated same-name targets", async () => {
  for (const name of ["showRemoveHome", "showEditHomeIcon", "showUpdateHomeLocation"]) {
    for (const recreated of [false, true]) {
      let expected;
      const f = fixture(name, (homes) => {
        delete homes.Main;
        if (recreated) homes.Main = { destinationId: "recreated-generation", x: 777, y: 80, z: 777, icon: "replacement", rules: { cooldownSeconds: 88 } };
        expected = structuredClone(homes);
      });
      await f.run();
      assert.equal(f.writes(), 0, `${name}: must not write a stale target (${recreated})`);
      assert.deepEqual(f.current(), expected, `${name}: must not revive, modify, or delete the replacement`);
      assert.ok(f.messages.some((m) => typeof m === "string" && m.includes("已删除或重新创建")), `${name}: user gets a refresh message`);
    }
  }
});
