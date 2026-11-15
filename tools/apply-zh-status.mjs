/** Exact replacements for DDUI ObservableString surfaces, which cannot use RawMessage. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const translations = JSON.parse(fs.readFileSync(path.join(root, 'tools/zh-status-translations.json'), 'utf8'));
const scripts = path.join(root, 'packs/AdminTools BP/scripts');
const targets = ['info-admin.js', 'ui-admin.js', 'ui-claims-admin.js', 'ui-claims-player.js', 'ui-holograms.js', 'ui-kits.js', 'ui-player.js', 'ui-tickets.js'];
const write = process.argv.includes('--write');
let total = 0;
const records = [];
// Longest first so a shorter sentence cannot partially replace a longer one.
const entries = Object.entries(translations).sort((a,b) => b[0].length - a[0].length);
for (const target of targets) {
  const file = path.join(scripts, target);
  let source = fs.readFileSync(file, 'utf8');
  let count = 0;
  for (const [oldText, newText] of entries) {
    let from = 0, index;
    while ((index = source.indexOf(oldText, from)) >= 0) {
      records.push({file: target, line: source.slice(0,index).split('\n').length, oldText, newText});
      from = index + oldText.length;
      count++;
    }
    if (source.includes(oldText)) source = source.split(oldText).join(newText);
  }
  total += count;
  if (process.argv.includes('--check')) {
    const result = spawnSync(process.execPath, ['--check', '--input-type=module'], { input: source, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`Translated ${target} did not parse:\n${result.stderr}`);
  }
  if (write && count) fs.writeFileSync(file, source, 'utf8');
  if (count) console.log(`${write ? 'translated' : 'pending'} ${target}: ${count}`);
}
console.log(`${write ? 'applied' : 'dry run'}: ${total} replacements`);
if (process.argv.includes('--audit')) {
  const header = '# 简体中文本地化审计\n\n英文和简体中文语言文件原有键各 2989 个，原有缺键为 0。已修正家园、传送、状态开关、封禁、礼包和挂机提示中的英文残留与误译。品牌、物品 ID、命令、技术占位符保留原文。\n\n以下为 DDUI 实时状态与离线消息的精确替换清单。DDUI ObservableString 不接受 RawMessage，因此这里使用服务器端中文。行号为执行脚本时的位置。运行 `node tools/apply-zh-status.mjs --write` 应用，重复运行不会重复修改。\n\n| 文件 | 行 | 原文 | 中文 |\n| --- | ---: | --- | --- |\n';
  const esc = s => s.replaceAll('|','\\|').replaceAll('\n','<br>');
  const lines = records.map(r=>`| scripts/${r.file} | ${r.line} | ${esc(r.oldText)} | ${esc(r.newText)} |`).join('\n');
  fs.mkdirSync(path.join(root,'docs'),{recursive:true});
  fs.writeFileSync(path.join(root,'docs/localization-audit.md'),header+lines+'\n','utf8');
}
