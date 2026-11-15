import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { digest, githubClient, publishRelease, releaseAssets, releaseNotes } from "../tools/release.mjs";

function fixture() {
  const calls = [], assets = [{ name: "addon.mcaddon", data: Buffer.from("actual addon bytes") }];
  let release = null, remote = [], ref = { object: { type: "commit", sha: "candidate" } };
  const api = async (method, route, body) => {
    calls.push([method, route]);
    if (route.startsWith("/git/ref/")) return ref;
    if (route.startsWith("/releases/tags/")) return release;
    if (method === "POST" && route === "/releases") return release = { id: 7, upload_url: "https://uploads.github.com/repos/owner/project/releases/7/assets{?name,label}", html_url: "https://github.com/owner/project/releases/tag/v1.0.0", ...body };
    if (route.endsWith("/assets?per_page=100")) return remote;
    if (route.startsWith("https://uploads.github.com/")) {
      const asset = { name: new URL(route).searchParams.get("name"), size: body.length, digest: `sha256:${digest(body)}` };
      remote.push(asset); return asset;
    }
    if (method === "PATCH") return release = { ...release, ...body };
    if (route === "/releases/7" || route === "/releases/latest") return release;
    throw new Error(`Unexpected request ${method} ${route}`);
  };
  return { calls, assets, api, get remote() { return remote; }, set remote(value) { remote = value; }, get release() { return release; }, set release(value) { release = value; }, set ref(value) { ref = value; } };
}
const options = fixture => ({ api: fixture.api, assets: fixture.assets, tag: "v1.0.0", commit: "candidate", notes: "real notes" });

test("release uploads and verifies a draft before publishing; matching reruns make no mutations", async () => {
  const f = fixture();
  const result = await publishRelease(options(f));
  assert.match(result.url, /v1\.0\.0$/);
  assert.equal(f.release.draft, false);
  assert.ok(f.calls.findIndex(([method]) => method === "PATCH") > f.calls.findIndex(([, route]) => route.startsWith("https://uploads")));
  const count = f.calls.length;
  await publishRelease(options(f));
  assert.ok(f.calls.slice(count).every(([method]) => method === "GET"));
});

test("release fails before creating a draft if remote tag is absent or targets another commit", async () => {
  for (const ref of [null, { object: { type: "commit", sha: "another" } }]) {
    const f = fixture(); f.ref = ref;
    await assert.rejects(publishRelease(options(f)), /标签/);
    assert.ok(f.calls.every(([method]) => method === "GET"));
  }
});

test("failed uploads can resume from the matching draft without reuploading existing assets", async () => {
  const f = fixture();
  await publishRelease(options(f));
  f.release = { ...f.release, draft: true };
  const count = f.calls.length;
  await publishRelease(options(f));
  assert.ok(f.calls.slice(count).every(([, route]) => !route.startsWith("https://uploads")));
});

test("release refuses conflicting draft content and never overwrites a published version", async () => {
  const f = fixture();
  await publishRelease(options(f));
  for (const draft of [true, false]) {
    f.release = { ...f.release, draft };
    f.remote = [{ ...f.remote[0], digest: "sha256:wrong" }];
    const count = f.calls.length;
    await assert.rejects(publishRelease(options(f)), /SHA-256/);
    assert.ok(f.calls.slice(count).every(([method]) => method === "GET"));
  }
  f.remote = [];
  await assert.rejects(publishRelease(options(f)), /不能就地修改/);
});

test("local asset checks reject stale checksums", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "admin-tools-release-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "dist"));
  for (const name of ["Admin-Tools-XA-1.0.0.mcaddon", "Admin-Tools-XA-1.0.0-distribution.zip"]) fs.writeFileSync(path.join(root, "dist", name), "bytes");
  fs.writeFileSync(path.join(root, "dist/SHA256SUMS.txt"), "old digest");
  assert.throws(() => releaseAssets(root, "1.0.0"), /不一致/);
});

test("release notes select only the requested dated changelog section", () => {
  const changelog = "# History\n\n## [Unreleased]\n\nfuture\n\n## [1.2.3] - 2026-11-15\n\n### Fixed\n\n- shipped\n\n## [1.2.2] - 2026-11-14\n\n- older\n";
  const notes = releaseNotes(changelog, "1.2.3", "owner/project");
  assert.match(notes, /shipped/); assert.doesNotMatch(notes, /future|older/);
  assert.throws(() => releaseNotes(changelog, "2.0.0", "owner/project"), /缺少/);
});

test("GitHub client refuses sending its token to any other host", async () => {
  await assert.rejects(githubClient("owner/project", "test-only")("GET", "https://example.invalid/steal"), /非 GitHub/);
});
