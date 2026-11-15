import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = (await readFile(new URL("../packs/AdminTools BP/scripts/homes.js", import.meta.url), "utf8"))
  .replace(/^import[\s\S]*?from\s+"[^"]+";\s*/gm, "")
  .replace(/export (function|const) /g, "$1 ");
const copy = (value) => structuredClone(value);
function fixture() {
  const initial = { Main: { destinationId: "generation-1", x: 1, y: 64, z: 1 }, Other: { destinationId: "other", rules: { cooldownSeconds: 10 } } };
  const properties = new Map([["jm_at:phomes_owner", JSON.stringify(initial)]]);
  const playerProperties = new Map([["jm_at:homes", JSON.stringify(initial)]]);
  const registry = { owner: { xuid: "owner", name: "Owner" } };
  const players = [];
  let refusedKey = "";
  const player = {
    xuid: "owner", getDynamicProperty: (key) => playerProperties.get(key),
    setDynamicProperty: (key, value) => { playerProperties.set(key, value); },
  };
  const api = new vm.Script(`${source}\n({deleteOfflineHome, applyPendingHomeDeletes, getHomes, setOfflineHomes})`).runInNewContext({
    world: { getPlayers: () => players }, NS: "jm_at", getCfg: () => ({}),
    getWorldStr: (key) => properties.get(key) || "",
    setWorldStr: (key, value) => { if (key === refusedKey) return false; properties.set(key, value); return true; },
    getRegistryEntry: (id) => copy(registry[id]),
    mutateRegistryEntry: (id, fn) => { if (!registry[id]) return false; fn(registry[id]); return true; },
    getPlayerXuid: (p) => p.xuid, silentCatch: () => {},
  });
  return { api, initial, properties, playerProperties, player, players, registry,
    refuse: (key) => { refusedKey = key; },
    homes: () => JSON.parse(playerProperties.get("jm_at:homes")),
  };
}

test("offline confirmation after owner joins deletes latest live home without a stale name queue", () => {
  const f = fixture();
  f.players.push(f.player);
  const live = f.homes();
  live.Other.rules.cooldownSeconds = 999;
  live.Added = { destinationId: "new-other", x: 8, y: 80, z: 8 };
  f.playerProperties.set("jm_at:homes", JSON.stringify(live));
  assert.equal(f.api.deleteOfflineHome("owner", "Main", "generation-1"), true);
  assert.equal(Object.hasOwn(f.homes(), "Main"), false);
  assert.equal(f.homes().Other.rules.cooldownSeconds, 999);
  assert.equal(f.homes().Added.destinationId, "new-other");
  assert.equal(f.properties.has("jm_at:xa_home_deletes_owner"), false);
  assert.equal(f.registry.owner.pendingHomeDeletes, undefined);
});

test("fresh online generation refuses a stale offline delete confirmation", () => {
  const f = fixture();
  f.players.push(f.player);
  const live = f.homes();
  live.Main.destinationId = "replacement";
  f.playerProperties.set("jm_at:homes", JSON.stringify(live));
  assert.equal(f.api.deleteOfflineHome("owner", "Main", "generation-1"), false);
  assert.equal(f.homes().Main.destinationId, "replacement");
});

test("offline delete uses generation queue and cannot delete a later same-name home", () => {
  const f = fixture();
  assert.equal(f.api.deleteOfflineHome("owner", "Main", "generation-1"), true);
  assert.deepEqual(JSON.parse(f.properties.get("jm_at:xa_home_deletes_owner")), [{ name: "Main", generation: "generation-1" }]);
  assert.equal(Object.hasOwn(JSON.parse(f.properties.get("jm_at:phomes_owner")), "Main"), false);
  const recreated = f.homes();
  recreated.Main = { destinationId: "new-generation", x: 500, y: 90, z: 500 };
  f.playerProperties.set("jm_at:homes", JSON.stringify(recreated));
  assert.equal(f.api.applyPendingHomeDeletes(f.player), true);
  assert.equal(f.homes().Main.destinationId, "new-generation");
  assert.deepEqual(JSON.parse(f.properties.get("jm_at:xa_home_deletes_owner")), []);
});

test("matching generation deletes on login and legacy string queues remain compatible", () => {
  const f = fixture();
  f.registry.owner.pendingHomeDeletes = ["Other"];
  assert.equal(f.api.deleteOfflineHome("owner", "Main", "generation-1"), true);
  assert.equal(f.api.applyPendingHomeDeletes(f.player), true);
  assert.deepEqual(f.homes(), {});
  assert.equal(f.registry.owner.pendingHomeDeletes, undefined);
});

test("mirror or queue write refusal returns false without a successful deletion claim", () => {
  const f = fixture();
  f.refuse("jm_at:phomes_owner");
  assert.equal(f.api.setOfflineHomes("owner", {}), false);
  assert.equal(f.api.deleteOfflineHome("owner", "Main", "generation-1"), false);
  assert.equal(f.properties.has("jm_at:xa_home_deletes_owner"), false);
  f.refuse("jm_at:xa_home_deletes_owner");
  assert.equal(f.api.deleteOfflineHome("owner", "Main", "generation-1"), false);
  assert.deepEqual(JSON.parse(f.properties.get("jm_at:phomes_owner")), f.initial);
  assert.equal(f.properties.has("jm_at:xa_home_deletes_owner"), false);
});
