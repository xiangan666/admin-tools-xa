import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = (await readFile(new URL("../packs/AdminTools BP/scripts/ui-home-admin.js", import.meta.url), "utf8"))
  .replace(/^import[^\n]+\n/gm, "").replace(/export async function /g, "async function ");
function fixture({ homeAction = 0, revokeAtForm = 0 } = {}) {
  let admin = true, forms = 0, edited = null, scope = null;
  const home = { destinationId: "generation-1", x: 1, y: 64, z: 1 };
  const warnings = [], writes = [];
  const choices = [1, 0, 1, homeAction];
  class Form {
    title() { return this; } body() { return this; } button() { return this; }
    async show() { forms++; if (forms === revokeAtForm) admin = false; return { canceled: false, selection: choices[forms - 1] }; }
  }
  const requireHomeAdmin = () => { if (!admin) throw new Error("只有管理员可以管理"); };
  const show = new vm.Script(`${source}\nshowHomeAdministration`).runInNewContext({
    ActionFormData: Form, MessageFormData: Form, requireHomeAdmin,
    getDirectoryPlayers: () => [{ xuid: "offline-owner", name: "Offline Owner", online: false }],
    getDirectoryHomes: () => ({ Main: home }), getHomeDestination: () => home,
    homeGeneration: value => value.destinationId, getHomeIconPath: () => "icon", fmtDimRaw: value => value, raw: (...parts) => parts,
    tell() {}, warnForm: (_p, message) => warnings.push(message), showHomePolicy() {},
    setManagedHomeSettings: (_actor, owner, name, generation, patch) => { requireHomeAdmin(); writes.push({ owner, name, generation, patch }); return true; },
    showTravelRules: async (_player, adapter) => { edited = adapter; adapter.getDestination(); adapter.saveRules({ cooldownSeconds: 90 }); },
    showHomeAccessMenu: async (_player, _back, value) => { scope = value; },
  });
  return { warnings, writes, run: () => show({}, () => {}), get editor() { return edited; }, get scope() { return scope; } };
}

test("unified admin UI connects the selected offline player's home to the scoped rule adapter", async () => {
  const f = fixture(); await f.run();
  assert.equal(f.editor.kind, "home"); assert.equal(f.editor.manageAsAdmin, true);
  assert.deepEqual(JSON.parse(JSON.stringify(f.writes)), [{ owner: "offline-owner", name: "Main", generation: "generation-1", patch: { rules: { cooldownSeconds: 90 } } }]);
});

test("unified admin UI passes owner, home and generation to access management", async () => {
  const f = fixture({ homeAction: 2 }); await f.run();
  assert.deepEqual(JSON.parse(JSON.stringify(f.scope)), { ownerId: "offline-owner", homeName: "Main", generation: "generation-1" });
});

test("revoked admin cannot continue from a previously opened management form", async () => {
  const f = fixture({ revokeAtForm: 3 }); await f.run();
  assert.equal(f.editor, null); assert.equal(f.scope, null); assert.equal(f.writes.length, 0);
  assert.ok(f.warnings.some(message => message.includes("只有管理员")));
});
