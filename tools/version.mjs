import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const readJson = (root, file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));

/** Plan every derived version change before writing any file. UUIDs and API versions stay intact. */
export function versionUpdates(root = projectRoot) {
  const pkg = readJson(root, "package.json");
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(pkg.version)) throw new Error("版本必须为 Bedrock 可用的 X.Y.Z 整数版本");
  const version = pkg.version.split(".").map(Number);
  if (version.some(n => !Number.isSafeInteger(n) || n > 65535)) throw new Error("版本分量必须在 0–65535 之间");
  const updates = new Map();
  const json = (file, value) => updates.set(file, JSON.stringify(value, null, 2) + "\n");
  const lock = readJson(root, "package-lock.json");
  lock.version = lock.packages[""].version = pkg.version;
  json("package-lock.json", lock);
  const packs = ["packs/AdminTools BP/manifest.json", "packs/AdminTools RP/manifest.json"];
  const manifests = packs.map(file => readJson(root, file));
  manifests.forEach((manifest, i) => {
    manifest.header.name = manifest.header.name.replace(/\d+\.\d+\.\d+$/, pkg.version);
    if (!manifest.header.name.endsWith(pkg.version)) throw new Error(`${packs[i]} 缺少包名称版本`);
    manifest.header.version = version;
    for (const module of manifest.modules) module.version = version;
    const peer = manifest.dependencies.find(dep => dep.uuid === manifests[1 - i].header.uuid);
    if (!peer) throw new Error(`${packs[i]} 缺少对端包依赖`);
    peer.version = version;
    json(packs[i], manifest);
  });
  const constantsFile = "packs/AdminTools BP/scripts/constants.js";
  const constants = fs.readFileSync(path.join(root, constantsFile), "utf8");
  if ((constants.match(/export const VER = "\d+\.\d+\.\d+ /g) ?? []).length !== 1) throw new Error("无法唯一定位界面版本");
  updates.set(constantsFile, constants.replace(/(export const VER = ")\d+\.\d+\.\d+( )/, (_, prefix, suffix) => prefix + pkg.version + suffix));
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const marker = /<!-- current-version:start -->[\s\S]*?<!-- current-version:end -->/g;
  if ([...readme.matchAll(marker)].length !== 1) throw new Error("README 必须含唯一的 current-version 标记区");
  const repo = pkg.repository.url.replace(/\.git$/, "");
  const block = `<!-- current-version:start -->\n当前版本：**${pkg.version}** · [版本发布页](${repo}/releases/tag/v${pkg.version}) · [全部 Releases](${repo}/releases)\n\n推荐安装文件：\`Admin-Tools-XA-${pkg.version}.mcaddon\`；附说明的发行归档：\`Admin-Tools-XA-${pkg.version}-distribution.zip\`；完整性校验：\`SHA256SUMS.txt\`。\n<!-- current-version:end -->`;
  updates.set("README.md", readme.replace(marker, () => block));
  return updates;
}

export function syncVersion(root = projectRoot, check = false) {
  const changes = [...versionUpdates(root)].filter(([file, content]) => fs.readFileSync(path.join(root, file), "utf8") !== content);
  if (check && changes.length) throw new Error(`版本派生文件未同步：${changes.map(([file]) => file).join(", ")}；运行 npm run version:sync`);
  for (const [file, content] of changes) {
    const target = path.join(root, file);
    const temporary = `${target}.version-tmp`;
    try {
      fs.writeFileSync(temporary, content, { encoding: "utf8", flag: "wx" });
      fs.renameSync(temporary, target);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }
  return changes.map(([file]) => file);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const changed = syncVersion(projectRoot, process.argv.includes("--check"));
    console.log(`版本 ${readJson(projectRoot, "package.json").version}：${changed.length ? `同步 ${changed.length} 个文件` : "全部同步"}。`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
