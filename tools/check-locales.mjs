/** Validate shipped text, en/zh parity, referenced keys and RawMessage usage. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditScript, parseLang, placeholders, textIssues } from './localization-audit.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [], decoder = new TextDecoder('utf-8', { fatal: true });
const languages = new Map();
let textFiles = 0, scripts = 0;
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(file); continue; }
    if (!/\.(?:lang|js|json|mcfunction|txt)$/.test(file)) continue;
    const name = path.relative(root, file);
    let text;
    try { text = decoder.decode(fs.readFileSync(file)); }
    catch { errors.push(`${name}: invalid UTF-8 bytes`); continue; }
    textFiles++;
    if (file.endsWith('.lang')) {
      const result = parseLang(text, name);
      errors.push(...result.errors);
      languages.set(path.basename(file), result.values);
    } else errors.push(...textIssues(text, name));
  }
}
walk(path.join(root, 'packs'));
const en = languages.get('en_US.lang'), zh = languages.get('zh_CN.lang');
if (!en || !zh) throw new Error('Missing English or Simplified Chinese language resources');
for (const [key, value] of en) {
  if (!zh.has(key)) { errors.push(`zh_CN missing key ${key}`); continue; }
  if (placeholders(value) !== placeholders(zh.get(key))) errors.push(`placeholder mismatch ${key}`);
}
for (const key of zh.keys()) if (!en.has(key)) errors.push(`en_US missing key ${key}`);
const properNames = new Set(['jm_at:admin_tools']);
const untranslatedProse = [...zh].filter(([key, value]) => !properNames.has(key) && en.get(key) === value && /[A-Za-z]{3,}\s+[A-Za-z]{3,}/.test(value));
for (const [key] of untranslatedProse) errors.push(`untranslated sentence ${key}`);
const references = new Set();
const scriptDir = path.join(root, 'packs/AdminTools BP/scripts');
for (const file of fs.readdirSync(scriptDir).filter(name => name.endsWith('.js'))) {
  const result = auditScript(fs.readFileSync(path.join(scriptDir, file), 'utf8'), file, en);
  scripts++;
  errors.push(...result.errors);
  for (const key of result.references) references.add(key);
}
console.log(`en_US ${en.size} keys; zh_CN ${zh.size} keys; identical English sentences ${untranslatedProse.length}`);
console.log(`Audited ${textFiles} UTF-8 text resources, ${scripts} scripts, ${references.size} literal translation references.`);
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log('Locale validation passed: keys, placeholders, encoding, format codes and RawMessage composition.');
