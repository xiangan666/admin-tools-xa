import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const decoder = new TextDecoder("utf-8", { fatal: true });
function markdownFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if ([".git", "node_modules", "dist", "upstream", "packs"].includes(entry.name)) return [];
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? markdownFiles(file) : file.endsWith(".md") ? [file] : [];
  });
}
const errors = [];
const files = markdownFiles(root);
for (const file of files) {
  const source = decoder.decode(fs.readFileSync(file)).replace(/```[\s\S]*?```/g, "");
  for (const match of source.matchAll(/\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+"[^"]*")?\)/g)) {
    const target = (match[1] ?? match[2]).split("#")[0];
    if (!target || /^[a-z][a-z\d+.-]*:/i.test(target)) continue;
    const resolved = path.resolve(path.dirname(file), decodeURIComponent(target));
    if (!fs.existsSync(resolved)) errors.push(`${path.relative(root, file)}: 链接不存在 ${target}`);
  }
}
if (errors.length) throw new Error(errors.join("\n"));
console.log(`Checked UTF-8 and local link targets in ${files.length} Markdown files.`);
