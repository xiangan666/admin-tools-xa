import fs from "node:fs";
import path from "node:path";
import { parse } from "acorn";
const scripts = path.resolve("packs/AdminTools BP/scripts");
const modules = new Map();
const apiExports = new Map(["@minecraft/server", "@minecraft/server-ui"].map(name => {
  const declarations = fs.readFileSync(path.join("node_modules", name, "index.d.ts"), "utf8");
  const names = new Set([...declarations.matchAll(/^export (?:declare )?(?:abstract )?(?:class|const|enum|function|interface|type|let|var)\s+(\w+)/gm)].map(m => m[1]));
  return [name, names];
}));
for (const file of fs.readdirSync(scripts).filter(f => f.endsWith(".js"))) {
  const ast = parse(fs.readFileSync(path.join(scripts, file), "utf8"), { ecmaVersion: "latest", sourceType: "module" });
  const exports = new Set();
  for (const node of ast.body) {
    if (node.type === "ExportDefaultDeclaration") exports.add("default");
    if (node.type === "ExportNamedDeclaration") {
      if (node.declaration?.id) exports.add(node.declaration.id.name);
      for (const d of node.declaration?.declarations ?? []) if (d.id.type === "Identifier") exports.add(d.id.name);
      for (const s of node.specifiers ?? []) exports.add(s.exported.name);
    }
  }
  modules.set(file, { ast, exports });
}
let imports = 0;
for (const [file, { ast }] of modules) {
  for (const node of ast.body.filter(n => n.type === "ImportDeclaration")) {
    const source = node.source.value;
    if (!source.startsWith(".")) {
      if (!["@minecraft/server", "@minecraft/server-ui"].includes(source)) throw new Error(`${file}: unknown import ${source}`);
      for (const spec of node.specifiers) {
        const name = spec.imported?.name;
        if (name && !apiExports.get(source).has(name)) throw new Error(`${file}: ${source} published API does not export ${name}`);
      }
      continue;
    }
    const target = modules.get(path.basename(source));
    if (!target) throw new Error(`${file}: missing ${source}`);
    for (const spec of node.specifiers) {
      const name = spec.type === "ImportDefaultSpecifier" ? "default" : spec.imported?.name;
      if (name && !target.exports.has(name)) throw new Error(`${file}: ${source} does not export ${name}`);
    }
    imports++;
  }
}
const bp = JSON.parse(fs.readFileSync("packs/AdminTools BP/manifest.json"));
const rp = JSON.parse(fs.readFileSync("packs/AdminTools RP/manifest.json"));
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
if (lock.version !== pkg.version || lock.packages?.[""]?.version !== pkg.version) throw new Error("Package/lockfile version mismatch");
const version = pkg.version.split(".").map(Number);
for (const [manifest, peer] of [[bp, rp], [rp, bp]]) {
  if (String(manifest.header.version) !== String(version) || !manifest.header.name.endsWith(pkg.version)) throw new Error("Package/manifest version mismatch");
  const dep = manifest.dependencies.find(d => d.uuid === peer.header.uuid);
  if (!dep || String(dep.version) !== String(peer.header.version)) throw new Error("BP/RP dependency mismatch");
  for (const m of manifest.modules) if (String(m.version) !== String(manifest.header.version)) throw new Error("Module version mismatch");
}
const constants = fs.readFileSync(path.join(scripts, "constants.js"), "utf8");
if (!constants.includes(`export const VER = "${pkg.version} `)) throw new Error("UI version mismatch");
for (const dir of ["packs/AdminTools BP", "packs/AdminTools RP"]) {
  function walk(p) { for (const e of fs.readdirSync(p, { withFileTypes: true })) { const f = path.join(p, e.name); if (e.isDirectory()) walk(f); else if (f.endsWith(".json")) JSON.parse(fs.readFileSync(f, "utf8")); } }
  walk(dir);
}
console.log(`Validated ${modules.size} JavaScript modules, ${imports} local imports, JSON and pack manifests.`);
