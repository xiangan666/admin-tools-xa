import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { normalizeHomePolicy, resolveHomeRulesPure } from "../packs/AdminTools BP/scripts/home-policy-core.js";
import { normalizeRules, inventoryChoices, isTimeAllowed } from "../packs/AdminTools BP/scripts/travel-rules.js";

test("default global home policy keeps owner rules and starts at 30 percent tax", () => {
  const policy = normalizeHomePolicy();
  assert.equal(policy.enabled, true);
  assert.equal(policy.bedTeleportEnabled, true);
  assert.equal(policy.taxPercent, 30);
  assert.deepEqual(policy.features, { cooldown: true, cost: true, timeWindow: true });
  const owner = normalizeRules({ cooldownSeconds: 17, cost: { typeId: "minecraft:emerald", amount: 7 } });
  const layers = resolveHomeRulesPure(owner, policy);
  assert.deepEqual(layers.owner, owner);
  assert.deepEqual(layers.server, normalizeRules());
});

test("server and owner rules remain separate AND constraints rather than replacements", () => {
  const owner = { cooldownSeconds: 300, cost: { typeId: "minecraft:emerald", amount: 7 }, timeWindow: { enabled: true, start: "23:00", end: "03:00" } };
  const policy = normalizeHomePolicy({ serverRules: { cooldownSeconds: 60, cost: { typeId: "minecraft:diamond", amount: 3 }, timeWindow: { enabled: true, start: "22:00", end: "06:00" } } });
  const layers = resolveHomeRulesPure(owner, policy);
  assert.equal(layers.server.cooldownSeconds, 60);
  assert.equal(layers.owner.cooldownSeconds, 300);
  assert.equal(layers.server.cost.amount, 3);
  assert.equal(layers.owner.cost.amount, 7);
  // 22:00 passes the server but fails the owner; 00:00 passes both.
  assert.equal(isTimeAllowed(16000, layers.server.timeWindow), true);
  assert.equal(isTimeAllowed(16000, layers.owner.timeWindow), false);
  assert.equal(isTimeAllowed(18000, layers.server.timeWindow) && isTimeAllowed(18000, layers.owner.timeWindow), true);
  assert.deepEqual(owner.cost, { typeId: "minecraft:emerald", amount: 7 });
});

test("global switch disables both rule layers without mutating stored owner rules", () => {
  const owner = normalizeRules({ cooldownSeconds: 86400, cost: { typeId: "minecraft:diamond", amount: 9 } });
  const policy = normalizeHomePolicy({ enabled: false, serverRules: owner });
  assert.deepEqual(resolveHomeRulesPure(owner, policy), { server: normalizeRules(), owner: normalizeRules() });
  assert.equal(owner.cooldownSeconds, 86400);
  assert.equal(policy.serverRules.cost.amount, 9);
});

test("each feature switch disables only its feature in both layers", () => {
  const rules = normalizeRules({ cooldownSeconds: 120, cost: { typeId: "minecraft:diamond", amount: 5 }, timeWindow: { enabled: true, start: "22:00", end: "06:00" } });
  const costOff = resolveHomeRulesPure(rules, { features: { cost: false }, serverRules: rules });
  for (const layer of [costOff.server, costOff.owner]) {
    assert.equal(layer.cost.amount, 0);
    assert.equal(layer.cooldownSeconds, 120);
    assert.equal(layer.timeWindow.enabled, true);
  }
  const otherOff = resolveHomeRulesPure(rules, { features: { cooldown: false, timeWindow: false }, serverRules: rules });
  for (const layer of [otherOff.server, otherOff.owner]) {
    assert.equal(layer.cooldownSeconds, 0);
    assert.equal(layer.timeWindow.enabled, false);
    assert.equal(layer.cost.amount, 5);
  }
});

test("tax, switches, cooldown and clock inputs fail closed", () => {
  for (const taxPercent of [-1, 101, 0.1, "1e2", "", true, Infinity]) assert.throws(() => normalizeHomePolicy({ taxPercent }));
  for (const taxPercent of [0, 30, 100, "100"]) assert.equal(normalizeHomePolicy({ taxPercent }).taxPercent, Number(taxPercent));
  assert.throws(() => normalizeHomePolicy({ enabled: "false" }));
  assert.throws(() => normalizeHomePolicy({ bedTeleportEnabled: "false" }));
  assert.throws(() => normalizeHomePolicy({ features: { cost: 0 } }));
  assert.throws(() => normalizeHomePolicy({ serverRules: { cooldownSeconds: 86401 } }));
  assert.throws(() => normalizeHomePolicy({ serverRules: { timeWindow: { enabled: true, start: "24:00", end: "00:00" } } }));
});

const policySource = (await readFile(new URL("../packs/AdminTools BP/scripts/home-policy.js", import.meta.url), "utf8"))
  .replace(/^import[^\n]+\n/gm, "").replace(/^export \{[^\n]+\n/gm, "").replace(/export function /g, "function ");
function persistedFixture() {
  const properties = new Map();
  let owner = true, refuse = false;
  const api = new vm.Script(`${policySource}\n({getHomePolicy,setHomePolicy,resolveHomeRules})`).runInNewContext({
    NS: "jm_at", normalizeHomePolicy, resolveHomeRulesPure,
    getWorldStr: key => properties.get(key) || "",
    setWorldStr: (key, value) => { if (refuse) return false; properties.set(key, value); return true; },
    isAdmin: () => ({ ok: owner }),
  });
  return { api, properties, loseOwner() { owner = false; }, refuseWrites() { refuse = true; } };
}

test("current administrators may durably change home policy, revoked actors cannot", () => {
  const f = persistedFixture();
  assert.equal(f.api.getHomePolicy().taxPercent, 30);
  assert.equal(f.api.setHomePolicy({}, { taxPercent: 50 }), true);
  assert.equal(f.api.getHomePolicy().taxPercent, 50);
  f.loseOwner();
  assert.throws(() => f.api.setHomePolicy({}, { taxPercent: 0 }), /只有管理员/);
  assert.equal(f.api.getHomePolicy().taxPercent, 50);
});

test("failed policy writes leave old policy intact and corrupt storage is not reset", () => {
  const f = persistedFixture();
  f.api.setHomePolicy({}, { taxPercent: 25 });
  f.refuseWrites();
  assert.throws(() => f.api.setHomePolicy({}, { taxPercent: 100 }), /保存失败/);
  assert.equal(f.api.getHomePolicy().taxPercent, 25);
  f.properties.set("jm_at:xa_home_policy", "broken JSON");
  assert.throws(() => f.api.getHomePolicy(), /无法读取/);
  assert.equal(f.properties.get("jm_at:xa_home_policy"), "broken JSON");
});

const editorSource = (await readFile(new URL("../packs/AdminTools BP/scripts/ui-travel-rules.js", import.meta.url), "utf8"))
  .replace(/^import[^\n]+\n/gm, "").replace(/export async function /g, "async function ");
const ownerUiSource = (await readFile(new URL("../packs/AdminTools BP/scripts/ui-home-policy.js", import.meta.url), "utf8"))
  .replace(/^import[^\n]+\n/gm, "").replace(/export async function /g, "async function ");

function editorFixture({ kind = "home", policy = normalizeHomePolicy(), values = [], duringModal, managing = false, admin = true } = {}) {
  let current = { rules: normalizeRules({ cooldownSeconds: 8, cost: { typeId: "minecraft:diamond", amount: 2 }, timeWindow: { enabled: true, start: "22:00", end: "06:00" } }) };
  let writes = 0, overviewCount = 0, modalCount = 0;
  const fields = [], warnings = [];
  class Form {
    title() { return this; } body() { return this; } button() { return this; }
    textField(label) { fields.push(label); return this; }
    dropdown(label) { fields.push(label); return this; }
    toggle(label) { fields.push(label); return this; }
    async show() { modalCount++; duringModal?.(current, policy); return { canceled: false, formValues: values }; }
  }
  class Overview extends Form { async show() { overviewCount++; return { canceled: false, selection: 0 }; } }
  const show = new vm.Script(`${editorSource}\nshowTravelRules`).runInNewContext({
    ModalFormData: Form, ActionFormData: Overview, normalizeRules, inventoryChoices,
    isAdmin: () => ({ ok: admin }),
    getHomePolicy: () => { if (kind === "warp") throw new Error("Warp must not read home policy"); return normalizeHomePolicy(policy); },
    itemName: x => typeof x === "string" ? x : x.typeId, raw: (...parts) => parts,
    tell: () => {}, warnForm: (_p, message) => warnings.push(message),
  });
  const adapter = { kind, manageAsAdmin: managing, getDestination: () => structuredClone(current), saveRules(rules) { current.rules = structuredClone(rules); writes++; return true; } };
  const player = { getComponent: () => ({ container: { size: 1, getItem: () => ({ typeId: "minecraft:diamond", amount: 64 }) } }) };
  return { run: () => show(player, adapter, () => {}), current: () => current, fields, warnings, writes: () => writes, modalCount: () => modalCount, overviewCount: () => overviewCount };
}

test("home editor hides disabled fields and preserves their latest stored values", async () => {
  const f = editorFixture({ policy: normalizeHomePolicy({ features: { cost: false } }),
    values: ["60", true, "23:00", "05:00"], duringModal(current) { current.rules.cost.amount = 19; } });
  await f.run();
  assert.equal(f.writes(), 1);
  assert.equal(f.current().rules.cost.amount, 19);
  assert.equal(f.current().rules.cooldownSeconds, 60);
  assert.equal(f.fields.length, 4);
  assert.equal(f.fields.some(label => label.includes("消耗")), false);
  assert.equal(f.overviewCount(), 1);
});

test("home editor refuses stale submissions after server switches change", async () => {
  const f = editorFixture({ values: ["60", 1, "3", true, "23:00", "05:00"], duringModal(_current, policy) { policy.features.cost = false; } });
  await f.run();
  assert.equal(f.writes(), 0);
  assert.equal(f.warnings.some(message => message.includes("已更改")), true);
});

test("global disable blocks home editing while warp editing ignores the policy", async () => {
  const disabled = editorFixture({ policy: normalizeHomePolicy({ enabled: false }) });
  await disabled.run();
  assert.equal(disabled.modalCount(), 0);
  assert.equal(disabled.writes(), 0);
  const warp = editorFixture({ kind: "warp", values: ["60", 1, "3", false, "00:00", "00:00"] });
  await warp.run();
  assert.equal(warp.fields.length, 6);
  assert.equal(warp.overviewCount(), 0);
  assert.equal(warp.writes(), 1);
  assert.equal(warp.current().rules.cost.amount, 3);
});

test("administrator policy form rechecks admin identity after the await", async () => {
  let owner = true, writes = 0;
  const warnings = [];
  class Form {
    title() { return this; } toggle() { return this; } textField() { return this; }
    dropdown() { return this; } submitButton() { return this; }
    async show() { owner = false; return { canceled: false, formValues: [false, true, true, true, true, "30", "0", 0, "0", false, "00:00", "00:00"] }; }
  }
  const show = new vm.Script(`${ownerUiSource}\nshowHomePolicy`).runInNewContext({
    ModalFormData: Form, isAdmin: () => ({ ok: owner }), getHomePolicy: () => normalizeHomePolicy(), normalizeHomePolicy,
    setHomePolicy: () => { writes++; }, inventoryChoices: () => [], itemName: x => x, raw: (...x) => x,
    tell: () => {}, warnForm: (_p, message) => warnings.push(message),
  });
  await show({ getComponent: () => ({}) }, () => {});
  assert.equal(writes, 0);
  assert.equal(warnings.some(message => message.includes("身份已变化")), true);
});

test("bed toggle persists independently of the rule switch and survives policy reload", () => {
  const f = persistedFixture();
  f.api.setHomePolicy({}, { enabled: false, bedTeleportEnabled: false, taxPercent: 45 });
  assert.equal(f.api.getHomePolicy().bedTeleportEnabled, false);
  assert.equal(f.api.getHomePolicy().enabled, false);
  assert.equal(f.api.getHomePolicy().taxPercent, 45);
});

test("administrator may preconfigure suspended home rules without enabling server features", async () => {
  const policy = normalizeHomePolicy({ enabled: false, features: { cost: false } });
  const f = editorFixture({ managing: true, policy, values: ["90", 1, "4", false, "00:00", "00:00"] });
  await f.run();
  assert.equal(f.writes(), 1);
  assert.equal(f.current().rules.cost.amount, 4);
  assert.equal(policy.enabled, false);
  assert.equal(policy.features.cost, false);
});

test("a forged admin editor flag grants no rule management privilege", async () => {
  const f = editorFixture({ managing: true, admin: false });
  await f.run();
  assert.equal(f.writes(), 0);
  assert.equal(f.modalCount(), 0);
  assert.ok(f.warnings.some(message => message.includes("只有管理员")));
});
