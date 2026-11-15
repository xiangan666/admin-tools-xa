import { readFileSync } from "node:fs";
import { parse } from "acorn";

export function scriptSource(file) {
  return readFileSync(new URL(`../packs/AdminTools BP/scripts/${file}`, import.meta.url), "utf8");
}

/** Extract actual declarations, preserving expressions and implementation. */
export function declarations(file, names) {
  const source = scriptSource(file);
  const nodes = parse(source, { ecmaVersion: "latest", sourceType: "module" }).body
    .map(node => node.declaration ?? node)
    .filter(node => names.includes(node.id?.name) || node.declarations?.some(item => names.includes(item.id.name)));
  if (nodes.length !== names.length) throw new Error(`${file}: fixture declaration missing (${names})`);
  return nodes.map(node => source.slice(node.start, node.end)).join("\n");
}

export const messagesSource = declarations("i18n.js", ["t", "raw"]);
