import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncVersion, versionUpdates } from "../tools/version.mjs";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "admin-tools-version-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const file of ["package.json", "package-lock.json", "README.md", "packs/AdminTools BP/manifest.json", "packs/AdminTools RP/manifest.json", "packs/AdminTools BP/scripts/constants.js"]) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.copyFileSync(new URL(`../${file}`, import.meta.url), path.join(root, file));
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json")));
  pkg.version = "9.8.7";
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify(pkg));
  return root;
}

test("version updates synchronize every package surface while preserving UUIDs and API", t => {
  const root = fixture(t);
  const manifestPath = path.join(root, "packs/AdminTools BP/manifest.json");
  const before = JSON.parse(fs.readFileSync(manifestPath));
  assert.throws(() => syncVersion(root, true), /未同步/);
  syncVersion(root);
  const after = JSON.parse(fs.readFileSync(manifestPath));
  assert.equal(after.header.uuid, before.header.uuid);
  assert.deepEqual(after.header.min_engine_version, before.header.min_engine_version);
  assert.deepEqual(after.dependencies.filter(dep => dep.module_name), before.dependencies.filter(dep => dep.module_name));
  assert.deepEqual(after.header.version, [9, 8, 7]);
  assert.ok(after.modules.every(module => module.version.join(".") === "9.8.7"));
  assert.match(fs.readFileSync(path.join(root, "README.md"), "utf8"), /releases\/tag\/v9\.8\.7/);
  assert.match(fs.readFileSync(path.join(root, "packs/AdminTools BP/scripts/constants.js"), "utf8"), /VER = "9\.8\.7 /);
  assert.deepEqual(syncVersion(root, true), []);
  assert.deepEqual(syncVersion(root), []);
});

test("version planner rejects incomplete documents before writing other derived files", t => {
  const root = fixture(t);
  const lockPath = path.join(root, "package-lock.json"), original = fs.readFileSync(lockPath);
  fs.writeFileSync(path.join(root, "README.md"), "missing marker");
  assert.throws(() => syncVersion(root), /current-version/);
  assert.deepEqual(fs.readFileSync(lockPath), original);
});

test("Bedrock version range and prerelease input are rejected", t => {
  const root = fixture(t), file = path.join(root, "package.json");
  const pkg = JSON.parse(fs.readFileSync(file));
  for (const version of ["1.2.3-beta.1", "1.2", "1.2.65536", "-1.2.3", "01.2.3"]) {
    fs.writeFileSync(file, JSON.stringify({ ...pkg, version }));
    assert.throws(() => versionUpdates(root), /版本/);
  }
});
