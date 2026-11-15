/** Pure checks shared by the CLI and regression tests; no game runtime needed. */
import { parse } from "acorn";

export function textIssues(text, filename) {
  const errors = [];
  for (const [i, line] of text.split(/\r?\n/).entries()) {
    if (/\uFFFD|ï¿½|锟斤拷|Â[§\u00a0]|Ã[\u0080-\u00bf]|â[\u0080-\u009f]|[\u0080-\u009f]/u.test(line)) {
      errors.push(`${filename}:${i + 1}: damaged encoding or replacement character`);
    }
  }
  return errors;
}

export function parseLang(text, filename) {
  const values = new Map(), errors = textIssues(text, filename);
  for (const [i, line] of text.replace(/^\uFEFF/, "").split(/\r?\n/).entries()) {
    if (!line.trim() || line.startsWith("#")) continue;
    const split = line.indexOf("="), where = `${filename}:${i + 1}`;
    if (split < 1) { errors.push(`${where}: invalid language entry`); continue; }
    const key = line.slice(0, split), value = line.slice(split + 1);
    if (key.trim() !== key) errors.push(`${where}: whitespace in language key ${key}`);
    if (values.has(key)) errors.push(`${where}: duplicate key ${key}`);
    if (!value.trim()) errors.push(`${where}: empty translation ${key}`);
    // §w is Bedrock's resin color. A quoted/standalone § in color-code help is
    // literal instructional text, as opposed to an invalid code such as §z.
    if (/§(?![0-9a-w%\s"'”’])/i.test(value)) errors.push(`${where}: invalid Minecraft format code ${key}`);
    if (/%(?:\d+\$)?[a-z]/i.test(value.replace(/%(?:\d+\$)?[sdif]/g, ""))) errors.push(`${where}: invalid placeholder ${key}`);
    values.set(key, value);
  }
  return { values, errors };
}

export function placeholders(value) {
  return [...value.matchAll(/%(?:\d+\$)?[sdif]/g)].map(match => match[0]).sort().join("|");
}

const rawFunctions = new Set(["t", "raw", "logActionLabel", "storageAreaLabel", "fmtDurationRaw", "fmtMsRaw", "fmtAgoRaw", "fmtDimRaw", "itemName"]);
export function auditScript(source, filename, language) {
  const errors = [], references = new Set();
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module", locations: true });
  function walk(node, parent) {
    if (!node || typeof node !== "object") return;
    const where = `${filename}:${node.loc?.start.line}`;
    if (node.type === "Literal" && typeof node.value === "string" && /^jm_at\./.test(node.value) && !/[.*]$/.test(node.value)) {
      // Prefixes in dynamic expressions are checked through their key families.
      const prefix = (parent?.type === "BinaryExpression" && parent.operator === "+") || node.value.endsWith("_");
      if (!prefix) {
        references.add(node.value);
        if (!language.has(node.value)) errors.push(`${where}: missing translation key ${node.value}`);
      }
    }
    if (node.type === "CallExpression" && rawFunctions.has(node.callee.name)) {
      if (parent?.type === "TemplateLiteral" || (parent?.type === "BinaryExpression" && parent.operator === "+") ||
        (parent?.type === "CallExpression" && (parent.callee.name === "String" ||
          (parent.callee.object?.name === "JSON" && parent.callee.property?.name === "stringify")))) {
        errors.push(`${where}: RawMessage converted to a plain string (${node.callee.name}); compose with raw()`);
      }
      if (node.callee.name === "t" && node.arguments[0]?.type === "Literal") {
        const key = node.arguments[0].value, value = language.get(key);
        if (value && !node.arguments.some(arg => arg.type === "SpreadElement")) {
          const positions = [...value.matchAll(/%(\d+)\$[sdif]/g)].map(match => Number(match[1]));
          const required = positions.length ? Math.max(...positions) : 0;
          if (required > node.arguments.length - 1) errors.push(`${where}: ${key} needs ${required} parameters, got ${node.arguments.length - 1}`);
        }
      }
    }
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach(value => walk(value, node));
      else if (child && typeof child === "object" && child.type) walk(child, node);
    }
  }
  walk(ast);
  return { errors, references };
}
