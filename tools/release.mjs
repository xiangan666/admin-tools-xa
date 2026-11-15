import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const digest = data => createHash("sha256").update(data).digest("hex");

/** GitHub REST client; tokens come only from the caller's environment. */
export function githubClient(repository, token) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !token) throw new Error("需要 GITHUB_REPOSITORY 和 GITHUB_TOKEN");
  const base = `https://api.github.com/repos/${repository}`;
  return async (method, route, body) => {
    const url = route.startsWith("https:") ? route : base + route;
    if (!["api.github.com", "uploads.github.com"].includes(new URL(url).hostname)) throw new Error("拒绝向非 GitHub 地址发送凭证");
    const binary = Buffer.isBuffer(body);
    const response = await fetch(url, {
      method, redirect: "error", signal: AbortSignal.timeout(60000),
      headers: {
        Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "admin-tools-xa-release", Accept: "application/vnd.github+json",
        ...(body !== undefined ? { "Content-Type": binary ? "application/octet-stream" : "application/json" } : {})
      },
      body: body === undefined ? undefined : binary ? body : JSON.stringify(body)
    });
    if (response.status === 404 && method === "GET") return null;
    if (!response.ok) throw new Error(`GitHub ${method} ${new URL(url).pathname}: HTTP ${response.status}`);
    return response.status === 204 ? null : response.json();
  };
}

export function releaseAssets(root, version) {
  const names = [`Admin-Tools-XA-${version}.mcaddon`, `Admin-Tools-XA-${version}-distribution.zip`];
  const assets = names.map(name => ({ name, data: fs.readFileSync(path.join(root, "dist", name)) }));
  const checksum = assets.map(asset => `${digest(asset.data)}  ${asset.name}\n`).join("");
  const data = fs.readFileSync(path.join(root, "dist/SHA256SUMS.txt"));
  if (data.toString("utf8") !== checksum) throw new Error("发行资产与 SHA256SUMS.txt 不一致");
  return [...assets, { name: "SHA256SUMS.txt", data }];
}

export function releaseNotes(changelog, version, repository) {
  const escaped = version.replaceAll(".", "\\.");
  const sections = changelog.split(/^## /m);
  const entry = sections.find(section => new RegExp(`^\\[${escaped}\\] - \\d{4}-\\d{2}-\\d{2}\\r?\\n`).test(section));
  const body = entry?.slice(entry.indexOf("\n") + 1).trim();
  if (!body) throw new Error(`CHANGELOG 缺少 ${version} 的有日期说明`);
  return body + `\n\n完整记录：[CHANGELOG](https://github.com/${repository}/blob/v${version}/CHANGELOG.md)。\n\n下载 .mcaddon 直接安装，或使用含操作与授权说明的 distribution.zip；SHA256SUMS.txt 用于核对文件一致性。专用服务器更新后需正常停服并重启。自动测试不代替 Minecraft 游戏内验收，具体边界见 [验证记录](https://github.com/${repository}/blob/v${version}/docs/VALIDATION.md)。\n\n维护者：相安 <3199912548@qq.com>；原作：JM_Addons / JM。保留上游 All Rights Reserved，详见 [授权状态](https://github.com/${repository}/blob/v${version}/LICENSE.md)。\n`;
}

/** Resume matching drafts without overwriting assets, and publish only after every digest matches. */
export async function publishRelease({ api, tag, commit, notes, assets }) {
  const ref = await api("GET", `/git/ref/tags/${encodeURIComponent(tag)}`);
  if (!ref) throw new Error(`远程标签不存在：${tag}`);
  let object = ref.object;
  for (let depth = 0; object.type === "tag" && depth < 5; depth++) {
    object = (await api("GET", `/git/tags/${object.sha}`)).object;
  }
  if (object.type !== "commit" || object.sha !== commit) throw new Error("远程标签与本地候选提交不同");
  let release = await api("GET", `/releases/tags/${encodeURIComponent(tag)}`);
  if (!release) release = await api("POST", "/releases", { tag_name: tag, target_commitish: commit, name: `Admin Tools 相安版 ${tag}`, body: notes, draft: true, prerelease: false });
  if (release.prerelease) throw new Error("已有 Release 是预发布，需核对发布线");
  let remote = await api("GET", `/releases/${release.id}/assets?per_page=100`);
  if (remote.some(asset => !assets.some(local => local.name === asset.name))) throw new Error("Release 含预期之外的资产，停止发布");
  for (const asset of assets) {
    let uploaded = remote.find(item => item.name === asset.name);
    if (!uploaded) {
      if (!release.draft) throw new Error(`已发布版本缺少资产，不能就地修改：${asset.name}`);
      const upload = release.upload_url.replace(/\{.*$/, "");
      uploaded = await api("POST", `${upload}?name=${encodeURIComponent(asset.name)}`, asset.data);
    }
    if (uploaded.size !== asset.data.length || uploaded.digest !== `sha256:${digest(asset.data)}`) {
      throw new Error(`远程资产大小或 SHA-256 不匹配：${asset.name}；保留现状供排查`);
    }
  }
  if (release.draft) release = await api("PATCH", `/releases/${release.id}`, { body: notes, draft: false, prerelease: false, make_latest: "true" });
  const published = await api("GET", `/releases/${release.id}`);
  const latest = await api("GET", "/releases/latest");
  if (published.draft || published.prerelease || latest?.id !== published.id || published.tag_name !== tag) throw new Error("发布状态或最新稳定版本未通过核对");
  remote = await api("GET", `/releases/${release.id}/assets?per_page=100`);
  if (remote.length !== assets.length || !assets.every(asset => remote.some(item => item.name === asset.name && item.size === asset.data.length && item.digest === `sha256:${digest(asset.data)}`))) throw new Error("发布后资产复核失败");
  return { url: published.html_url, tag, commit, assets: remote.map(({ name, size, digest: sha256 }) => ({ name, size, sha256 })) };
}

async function main() {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const git = args => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const repository = pkg.repository.url.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\.git$/)?.[1];
  if (!repository || (process.env.GITHUB_REPOSITORY && process.env.GITHUB_REPOSITORY !== repository)) throw new Error("发布目标必须与 package.json 的真实仓库一致");
  const tag = `v${pkg.version}`;
  if (process.env.GITHUB_REF && process.env.GITHUB_REF !== `refs/tags/${tag}`) throw new Error("仅允许从对应版本标签发布");
  if (git(["status", "--porcelain"])) throw new Error("工作区必须干净；先提交所有本轮项目改动");
  execFileSync(process.execPath, ["tools/version.mjs", "--check"], { cwd: root, stdio: "inherit" });
  const commit = git(["rev-parse", "HEAD"]);
  if (git(["rev-parse", `${tag}^{commit}`]) !== commit) throw new Error("本地版本标签与 HEAD 不同");
  const notes = releaseNotes(fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8"), pkg.version, repository);
  const result = await publishRelease({ api: githubClient(repository, process.env.GITHUB_TOKEN), tag, commit, notes, assets: releaseAssets(root, pkg.version) });
  fs.writeFileSync(path.join(root, "dist/release-result.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
