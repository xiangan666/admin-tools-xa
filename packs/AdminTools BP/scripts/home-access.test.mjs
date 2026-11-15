/** Exercise the actual adapter against Minecraft-shaped in-memory storage. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as core from "./home-access-core.js";
import { makeHomeAt } from "./home-record.js";

const source = (await readFile(new URL("./home-access.js", import.meta.url), "utf8"))
  .replace(/^import[\s\S]*?from\s+"[^"]+";\s*/gm, "")
  .replace(/export function /g, "function ");
function fixture() {
  const props = new Map();
  const homeStore = new Map([["owner", { Main: { x: 1, y: 64, z: 1, destinationId: "generation-1" } }]]);
  const messages = [];
  const owner = { xuid: "owner", name: "Owner" };
  const visitor = { xuid: "visitor", name: "Visitor" };
  const stranger = { xuid: "stranger", name: "Stranger" };
  const players = [owner, visitor, stranger];
  const registry = Object.fromEntries(players.map((p) => [p.xuid, { name: p.name, role: "" }]));
  let refuseSave = false;
  const bindings = {
    ...core, world: { getPlayers: () => players }, NS: "jm_at",
    getCfg: () => ({ ownerXuid: "owner" }), getPlayerRegistry: () => registry,
    getWorldStr: (key) => props.get(key) || "",
    setWorldStr: (key, value) => { if (refuseSave) return false; props.set(key, value); return true; },
    getHomes: (p) => homeStore.get(p.xuid) || {}, getOfflineHomes: (id) => homeStore.get(id) || {},
    getPlayerXuid: (p) => p.xuid, tell: (p, message) => messages.push([p.xuid, message]), silentCatch: () => {},
    isOwner: (p) => p.xuid === "owner", isAdmin: (p) => ({ ok: p.xuid === "stranger" }), isModerator: () => false,
  };
  const api = new Function(...Object.keys(bindings), `${source}\nreturn { requestHomeAccess, getOwnerAccess, grantHomeAccess, respondHomeRequest, revokeHomeAccess, canVisitHome, consumeHomeVisit, getHomeDestination, getDirectoryPlayers };`)(...Object.values(bindings));
  return { api, owner, visitor, stranger, homeStore, props, messages, players, setRefuse: (refuse) => { refuseSave = refuse; } };
}

test("approval defaults to the actor's own homes; administrators must explicitly select the owner", () => {
  const { api, owner, visitor, stranger } = fixture();
  const request = api.requestHomeAccess(visitor, "owner", "Main", { mode: "once" });
  assert.equal(api.canVisitHome(visitor, "owner", "Main"), false);
  assert.equal(api.canVisitHome(stranger, "owner", "Main"), false); // No automatic admin travel bypass.
  assert.throws(() => api.respondHomeRequest(stranger, request.id, true));
  api.respondHomeRequest(owner, request.id, true);
  assert.equal(api.canVisitHome(visitor, "owner", "Main"), true);
  assert.equal(api.getOwnerAccess(owner).requests.length, 0);
  api.consumeHomeVisit(visitor, "owner", "Main");
  assert.equal(api.canVisitHome(visitor, "owner", "Main"), false);
});

test("administrator can approve and revoke another owner's offline home access", () => {
  const f = fixture();
  f.players.splice(f.players.indexOf(f.owner), 1);
  const request = f.api.requestHomeAccess(f.visitor, "owner", "Main", { mode: "permanent", uses: 2 });
  assert.equal(f.api.getOwnerAccess(f.stranger, "owner").requests.length, 1);
  f.api.respondHomeRequest(f.stranger, request.id, true, "owner");
  assert.equal(f.api.canVisitHome(f.visitor, "owner", "Main"), true);
  const grant = f.api.getOwnerAccess(f.stranger, "owner").grants[0];
  assert.equal(grant.grantedById, "stranger");
  assert.equal(f.api.canVisitHome(f.stranger, "owner", "Main"), false);
  f.api.revokeHomeAccess(f.stranger, "Main", "visitor", "owner", "generation-1");
  assert.equal(f.api.canVisitHome(f.visitor, "owner", "Main"), false);
});

test("ordinary visitors cannot use an explicit foreign owner id for management", () => {
  const f = fixture();
  const request = f.api.requestHomeAccess(f.visitor, "owner", "Main", { mode: "once" });
  assert.throws(() => f.api.getOwnerAccess(f.visitor, "owner"), /房主或管理员/);
  assert.throws(() => f.api.grantHomeAccess(f.visitor, "Main", "stranger", { mode: "once" }, "owner"), /房主或管理员/);
  assert.throws(() => f.api.respondHomeRequest(f.visitor, request.id, true, "owner"), /房主或管理员/);
  assert.throws(() => f.api.revokeHomeAccess(f.visitor, "Main", "stranger", "owner"), /房主或管理员/);
});

test("stale administrator grant/revoke forms cannot change a recreated home", () => {
  const f = fixture();
  f.homeStore.get("owner").Main.destinationId = "new-generation";
  assert.throws(() => f.api.grantHomeAccess(f.stranger, "Main", "visitor", { mode: "once" }, "owner", "generation-1"), /重新创建/);
  assert.throws(() => f.api.revokeHomeAccess(f.stranger, "Main", "visitor", "owner", "generation-1"), /重新创建/);
  assert.equal(f.api.getOwnerAccess(f.stranger, "owner").grants.length, 0);
});

test("disabled home denies both owner and granted visitors without consuming grants", () => {
  const f = fixture();
  f.api.grantHomeAccess(f.stranger, "Main", "visitor", { mode: "once" }, "owner", "generation-1");
  f.homeStore.get("owner").Main.teleportEnabled = false;
  assert.equal(f.api.canVisitHome(f.owner, "owner", "Main"), false);
  assert.equal(f.api.canVisitHome(f.visitor, "owner", "Main"), false);
  assert.equal(f.api.getOwnerAccess(f.stranger, "owner").grants[0].remainingUses, 1);
  f.homeStore.get("owner").Main.teleportEnabled = true;
  assert.equal(f.api.canVisitHome(f.visitor, "owner", "Main"), true);
});

test("offline request survives reload and can be approved after owner returns", () => {
  const f = fixture();
  f.players.splice(f.players.indexOf(f.owner), 1);
  const request = f.api.requestHomeAccess(f.visitor, "owner", "Main", { mode: "permanent", uses: 0 });
  assert.equal(JSON.parse(f.props.get("jm_at:xa_home_access_owner")).requests[0].id, request.id);
  f.players.push(f.owner);
  assert.equal(f.api.getOwnerAccess(f.owner).requests.length, 1);
  f.api.respondHomeRequest(f.owner, request.id, true);
  assert.equal(f.api.canVisitHome(f.visitor, "owner", "Main"), true);
});

test("grant revocation and recreated-home identity both invalidate access", () => {
  const f = fixture();
  f.api.grantHomeAccess(f.owner, "Main", "visitor", { mode: "permanent", uses: 2 });
  f.homeStore.get("owner").Main.x = 88;
  assert.equal(f.api.canVisitHome(f.visitor, "owner", "Main"), true);
  f.homeStore.get("owner").Main.destinationId = "generation-2";
  assert.equal(f.api.canVisitHome(f.visitor, "owner", "Main"), false);
  f.api.grantHomeAccess(f.owner, "Main", "visitor", { mode: "permanent", uses: 2 });
  f.api.revokeHomeAccess(f.owner, "Main", "visitor");
  assert.equal(f.api.canVisitHome(f.visitor, "owner", "Main"), false);
});

test("legacy home coordinate overwrite through real makeHomeAt preserves grant and rules", () => {
  const f = fixture();
  const rules = { cooldownSeconds: 120, cost: { typeId: "minecraft:emerald", amount: 3 } };
  f.homeStore.get("owner").Main = { x: 1, y: 64, z: 1, rules };
  f.api.grantHomeAccess(f.owner, "Main", "visitor", { mode: "permanent", uses: 3 });
  const updated = makeHomeAt(f.homeStore.get("owner").Main,
    { x: 60, y: 70, z: 80, dimension: "minecraft:nether" }, "new-icon", () => "unused-id");
  f.homeStore.get("owner").Main = updated;
  assert.equal(updated.destinationId, "legacy");
  assert.deepEqual(updated.rules, rules);
  assert.equal(f.api.canVisitHome(f.visitor, "owner", "Main"), true);
  // A deletion followed by a same-name save has a new generation.
  delete f.homeStore.get("owner").Main;
  f.homeStore.get("owner").Main = makeHomeAt(undefined, { x: 60, y: 70, z: 80 }, undefined, () => "new-generation");
  assert.equal(f.api.canVisitHome(f.visitor, "owner", "Main"), false);
});

test("storage refusal cannot produce an unpersisted successful grant", () => {
  const f = fixture();
  f.setRefuse(true);
  assert.throws(() => f.api.grantHomeAccess(f.owner, "Main", "visitor", { mode: "once" }), /保存失败/);
  assert.equal(f.api.canVisitHome(f.visitor, "owner", "Main"), false);
});

test("failed successful-use save blocks new visitors and flushes exact consumption on recovery", () => {
  const f = fixture();
  f.api.grantHomeAccess(f.owner, "Main", "visitor", { mode: "permanent", uses: 1 });
  f.setRefuse(true);
  assert.throws(() => f.api.consumeHomeVisit(f.visitor, "owner", "Main"), /次数存档故障/);
  assert.equal(f.api.canVisitHome(f.visitor, "owner", "Main"), false);
  assert.throws(() => f.api.getOwnerAccess(f.owner), /存档故障/);
  assert.ok(f.messages.some(([id, text]) => id === "visitor" && text.includes("存档故障")));
  // The old persistent snapshot still has one use, but must not regain it.
  assert.equal(JSON.parse(f.props.get("jm_at:xa_home_access_owner")).grants[0].remainingUses, 1);
  f.setRefuse(false);
  assert.equal(f.api.canVisitHome(f.visitor, "owner", "Main"), false);
  assert.equal(JSON.parse(f.props.get("jm_at:xa_home_access_owner")).grants[0].remainingUses, 0);
});

test("in-flight successful visitors accumulate deductions in the latest failed-save shadow", () => {
  const f = fixture();
  f.api.grantHomeAccess(f.owner, "Main", "visitor", { mode: "permanent", uses: 2 });
  f.api.grantHomeAccess(f.owner, "Main", "stranger", { mode: "permanent", uses: 2 });
  f.setRefuse(true);
  assert.throws(() => f.api.consumeHomeVisit(f.visitor, "owner", "Main"), /存档故障/);
  assert.throws(() => f.api.consumeHomeVisit(f.stranger, "owner", "Main"), /存档故障/);
  assert.equal(f.api.canVisitHome(f.visitor, "owner", "Main"), false);
  assert.equal(f.api.canVisitHome(f.stranger, "owner", "Main"), false);
  f.setRefuse(false);
  const grants = f.api.getOwnerAccess(f.owner).grants;
  assert.equal(grants.find((g) => g.visitorId === "visitor").remainingUses, 1);
  assert.equal(grants.find((g) => g.visitorId === "stranger").remainingUses, 1);
});

test("failed grant modification and revocation do not alter persisted permissions", () => {
  const f = fixture();
  f.api.grantHomeAccess(f.owner, "Main", "visitor", { mode: "once" });
  f.setRefuse(true);
  assert.throws(() => f.api.grantHomeAccess(f.owner, "Main", "visitor", { mode: "permanent", uses: 0 }), /保存失败/);
  assert.throws(() => f.api.revokeHomeAccess(f.owner, "Main", "visitor"), /保存失败/);
  const persisted = JSON.parse(f.props.get("jm_at:xa_home_access_owner")).grants[0];
  assert.equal(persisted.mode, "once");
  assert.equal(persisted.remainingUses, 1);
});

test("directory follows real roles and preserves offline players", () => {
  const f = fixture();
  assert.equal(f.api.getDirectoryPlayers().find((p) => p.xuid === "owner").role, "owner");
  assert.equal(f.api.getDirectoryPlayers().find((p) => p.xuid === "stranger").role, "admin");
  f.players.splice(f.players.indexOf(f.visitor), 1);
  assert.equal(f.api.getDirectoryPlayers().find((p) => p.xuid === "visitor").online, false);
});
