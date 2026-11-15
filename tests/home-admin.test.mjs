import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { normalizeRules } from "../packs/AdminTools BP/scripts/travel-rules.js";
import { validDestinationName } from "../packs/AdminTools BP/scripts/home-record.js";

const strip = source => source.replace(/^import[\s\S]*?from\s+"[^"]+";\s*/gm, "").replace(/export (function|const) /g, "$1 ");
const homesSource = strip(await readFile(new URL("../packs/AdminTools BP/scripts/homes.js", import.meta.url), "utf8"));
const adminSource = strip(await readFile(new URL("../packs/AdminTools BP/scripts/home-admin.js", import.meta.url), "utf8"));
function fixture({ online = false } = {}) {
  const initial = { Main: { destinationId: "generation-1", x: 1, y: 64, z: 2, icon: "old", rules: { cooldownSeconds: 10 } }, Other: { destinationId: "other", x: 3, rules: { cooldownSeconds: 20 } } };
  const props = new Map([["jm_at:phomes_owner", JSON.stringify(initial)]]);
  const liveProps = new Map([["jm_at:homes", JSON.stringify(initial)]]);
  let refuseKey = "", refusePlayer = false;
  const admin = { xuid: "admin", admin: true };
  const owner = { xuid: "owner", getDynamicProperty: key => liveProps.get(key), setDynamicProperty: (key, value) => { if (refusePlayer) throw new Error("offline"); liveProps.set(key, value); } };
  const players = online ? [owner] : [];
  const api = new vm.Script(`${homesSource}\n${adminSource}\n({setManagedHomeSettings,getHomes,getOfflineHomes,applyPendingHomeEdits,setHomes})`).runInNewContext({
    NS: "jm_at", world: { getPlayers: () => players }, getPlayerXuid: p => p.xuid,
    getWorldStr: key => props.get(key) || "", setWorldStr: (key, value) => { if (key === refuseKey) return false; props.set(key, value); return true; },
    silentCatch: () => {}, isAdmin: p => ({ ok: p.admin === true }), normalizeRules, validDestinationName,
    getCfg: () => ({}), getRegistryEntry: () => ({}), mutateRegistryEntry: () => true,
  });
  return { api, admin, owner, props, liveProps, players, initial,
    refuse(key) { refuseKey = key; }, refuseLive(value) { refusePlayer = value; },
    rawHomes: () => JSON.parse(liveProps.get("jm_at:homes")),
    save: patch => api.setManagedHomeSettings(admin, "owner", "Main", "generation-1", patch),
  };
}

test("admin edits the latest online home without changing coordinates, identity or other homes", () => {
  const f = fixture({ online: true });
  const latest = f.rawHomes(); latest.Other.rules.cooldownSeconds = 999;
  f.liveProps.set("jm_at:homes", JSON.stringify(latest));
  assert.equal(f.save({ rules: { cooldownSeconds: 60 }, teleportEnabled: false }), true);
  const saved = f.rawHomes();
  assert.equal(saved.Main.rules.cooldownSeconds, 60);
  assert.equal(saved.Main.teleportEnabled, false);
  assert.equal(saved.Main.x, 1); assert.equal(saved.Main.icon, "old"); assert.equal(saved.Main.destinationId, "generation-1");
  assert.equal(saved.Other.rules.cooldownSeconds, 999);
});

test("offline edits are durable and immediately visible, then merge into the latest live home on login", () => {
  const f = fixture();
  f.save({ rules: { cooldownSeconds: 86400, cost: { typeId: "minecraft:diamond", amount: 3 } } });
  f.save({ teleportEnabled: false });
  assert.equal(f.api.getOfflineHomes("owner").Main.rules.cooldownSeconds, 86400);
  assert.equal(f.api.getOfflineHomes("owner").Main.teleportEnabled, false);
  // The mirror was intentionally not the sole authority for these edits.
  assert.equal(JSON.parse(f.props.get("jm_at:phomes_owner")).Main.rules.cooldownSeconds, 10);
  const latest = f.rawHomes(); latest.Main.x = 500; latest.Other.rules.cooldownSeconds = 321;
  f.liveProps.set("jm_at:homes", JSON.stringify(latest)); f.players.push(f.owner);
  assert.equal(f.api.getHomes(f.owner).Main.teleportEnabled, false);
  assert.equal(f.api.applyPendingHomeEdits(f.owner), true);
  assert.equal(f.rawHomes().Main.rules.cost.amount, 3);
  assert.equal(f.rawHomes().Main.teleportEnabled, false);
  assert.equal(f.rawHomes().Main.x, 500); assert.equal(f.rawHomes().Other.rules.cooldownSeconds, 321);
  assert.equal(f.props.get("jm_at:xa_home_edits_owner"), "[]");
  // After synchronization, the owner can edit normal rules without the old queue overriding them.
  const edited = f.api.getHomes(f.owner); edited.Main.rules.cooldownSeconds = 9;
  assert.equal(f.api.setHomes(f.owner, edited), true);
  assert.equal(f.rawHomes().Main.rules.cooldownSeconds, 9);
  assert.equal(f.rawHomes().Main.teleportEnabled, false);
});

test("offline admin edits do not apply to a deleted and recreated same-name home", () => {
  const f = fixture(); f.save({ teleportEnabled: false, rules: { cooldownSeconds: 60 } });
  const recreated = f.rawHomes(); recreated.Main = { destinationId: "new-generation", x: 900, rules: { cooldownSeconds: 7 } };
  f.liveProps.set("jm_at:homes", JSON.stringify(recreated)); f.players.push(f.owner);
  assert.equal(f.api.applyPendingHomeEdits(f.owner), true);
  assert.equal(f.rawHomes().Main.teleportEnabled, undefined);
  assert.equal(f.rawHomes().Main.rules.cooldownSeconds, 7);
  assert.throws(() => f.save({ teleportEnabled: false }), /重新创建/);
});

test("new online admin changes supersede queued offline settings after a delayed login flush", () => {
  const f = fixture(); f.save({ rules: { cooldownSeconds: 60 }, teleportEnabled: false });
  f.players.push(f.owner); f.refuseLive(true);
  assert.equal(f.api.applyPendingHomeEdits(f.owner), false);
  assert.throws(() => f.save({ rules: { cooldownSeconds: 90 }, teleportEnabled: true }), /未保存/);
  assert.equal(f.api.getHomes(f.owner).Main.rules.cooldownSeconds, 60);
  f.refuseLive(false);
  assert.equal(f.save({ rules: { cooldownSeconds: 90 }, teleportEnabled: true }), true);
  assert.equal(f.rawHomes().Main.rules.cooldownSeconds, 90); assert.equal(f.rawHomes().Main.teleportEnabled, true);
  assert.equal(f.props.get("jm_at:xa_home_edits_owner"), "[]");
});

test("ordinary players, moderators and revoked admins cannot edit foreign home settings", () => {
  const f = fixture({ online: true });
  for (const actor of [{ xuid: "owner" }, { xuid: "mod", moderator: true }, { xuid: "admin", admin: false }]) {
    assert.throws(() => f.api.setManagedHomeSettings(actor, "owner", "Main", "generation-1", { teleportEnabled: false }), /只有管理员/);
  }
  assert.deepEqual(f.rawHomes(), f.initial);
});

test("write failures report failure and preserve offline edits for retry", () => {
  const f = fixture(); f.refuse("jm_at:xa_home_edits_owner");
  assert.throws(() => f.save({ teleportEnabled: false }), /未保存/);
  assert.equal(f.api.getOfflineHomes("owner").Main.teleportEnabled, undefined);
  f.refuse(""); f.save({ teleportEnabled: false }); f.players.push(f.owner); f.refuseLive(true);
  assert.equal(f.api.applyPendingHomeEdits(f.owner), false);
  assert.equal(JSON.parse(f.props.get("jm_at:xa_home_edits_owner")).length, 1);
  assert.equal(f.api.getHomes(f.owner).Main.teleportEnabled, false);
  f.refuseLive(false);
  assert.equal(f.api.applyPendingHomeEdits(f.owner), true);
  assert.equal(f.rawHomes().Main.teleportEnabled, false);
});

test("invalid home settings and malformed pending storage cannot be silently reset", () => {
  const f = fixture();
  assert.throws(() => f.save({ teleportEnabled: "false" }), /开关值/);
  assert.throws(() => f.save({ rules: { cooldownSeconds: -1 } }), /冷却/);
  f.props.set("jm_at:xa_home_edits_owner", "broken");
  assert.equal(f.api.applyPendingHomeEdits(f.owner), false);
  assert.equal(f.props.get("jm_at:xa_home_edits_owner"), "broken");
  assert.deepEqual(f.rawHomes(), f.initial);
});

test("corrupt live home storage never becomes an empty successful offline-edit flush", () => {
  const f = fixture(); f.save({ teleportEnabled: false });
  f.liveProps.set("jm_at:homes", "broken live JSON");
  assert.equal(f.api.applyPendingHomeEdits(f.owner), false);
  assert.equal(f.liveProps.get("jm_at:homes"), "broken live JSON");
  assert.equal(JSON.parse(f.props.get("jm_at:xa_home_edits_owner")).length, 1);
});
