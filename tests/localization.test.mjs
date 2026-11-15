import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync, readdirSync } from "node:fs";
import { parse } from "acorn";
import { auditScript, parseLang, textIssues, placeholders } from "../tools/localization-audit.mjs";
import { declarations, messagesSource, scriptSource } from "./source-fixture.mjs";

const languages = Object.fromEntries(["en_US", "zh_CN"].map(locale => [locale,
  parseLang(readFileSync(new URL(`../packs/AdminTools RP/texts/${locale}.lang`, import.meta.url), "utf8"), locale).values]));
function render(message, locale = "zh_CN") {
  if (typeof message === "string" || typeof message === "number") return String(message);
  if (message?.rawtext) return message.rawtext.map(value => render(value, locale)).join("");
  if (message?.text !== undefined) return message.text;
  const template = languages[locale].get(message?.translate);
  assert.ok(template !== undefined, `missing key ${message?.translate}`);
  const args = Array.isArray(message.with) ? message.with : message.with?.rawtext ?? [];
  return template.replace(/%(\d+)\$[sdif]/g, (_, position) => render(args[Number(position) - 1], locale));
}
const labelSource = scriptSource("log-labels.js").replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
const labels = vm.runInNewContext(messagesSource + "\n" + labelSource + "\n({ LOG_ACTIONS, logActionLabel, storageAreaLabel })");

test("language audit detects damaged encoding, duplicate entries, invalid codes and broken placeholders", () => {
  const bad = parseLang("jm_at.a=中文\njm_at.a=乱码\uFFFD\njm_at.b=§z错误\njm_at.c=%1$q\njm_at.d=", "test.lang");
  assert.match(bad.errors.join("\n"), /damaged encoding/);
  assert.match(bad.errors.join("\n"), /duplicate key/);
  assert.match(bad.errors.join("\n"), /invalid Minecraft format code/);
  assert.match(bad.errors.join("\n"), /invalid placeholder/);
  assert.match(bad.errors.join("\n"), /empty translation/);
  assert.ok(textIssues("Â§aæ\u0088\u0090", "bad").length > 0);
  assert.equal(parseLang('key=§w树脂色，用“§”或 § 字符输入颜色，参数 %1$s', "ok").errors.length, 0);
  assert.equal(placeholders("%2$s 和 %1$s"), placeholders("%1$s and %2$s"));
});

test("script audit catches missing menu keys, missing parameters and RawMessage string coercion", () => {
  const source = 'const menu={labelKey:"jm_at.missing"}; t("jm_at.a"); `x${t("jm_at.a","p")}`; String(t("jm_at.a","p"));';
  const result = auditScript(source, "test.js", new Map([["jm_at.a", "%1$s"]]));
  assert.match(result.errors.join("\n"), /missing translation key jm_at.missing/);
  assert.match(result.errors.join("\n"), /needs 1 parameters/);
  assert.equal(result.errors.filter(error => error.includes("RawMessage converted")).length, 2);
  assert.equal(auditScript('raw("前缀",t("jm_at.a","Name / @p"));', "ok.js", new Map([["jm_at.a", "%1$s"]])).errors.length, 0);
});

test("all log actions and dynamic storage areas resolve to Chinese without changing stored identifiers", () => {
  for (const action of labels.LOG_ACTIONS) {
    const entry = { action, detail: "用户的自定义名称 Admin Home" };
    assert.match(render(labels.logActionLabel(entry.action)), /\p{Script=Han}/u);
    assert.ok(languages.en_US.has(`jm_at.log.action.${action}`));
    assert.equal(entry.action, action); assert.equal(entry.detail, "用户的自定义名称 Admin Home");
  }
  assert.equal(render(labels.logActionLabel("KIT_EVENT_CLAIM")), "事件领取礼包");
  assert.equal(render(labels.storageAreaLabel("regPage2")), "玩家登记第3页");
  assert.equal(render(labels.storageAreaLabel("claimsPage0")), "领地第1页");
  assert.equal(render(labels.logActionLabel("FUTURE_ACTION")), "FUTURE_ACTION");
});

test("all literal logging call sites and world-command action families have localized display labels", () => {
  const known = new Set(labels.LOG_ACTIONS), seen = new Set();
  for (const file of readdirSync(new URL("../packs/AdminTools BP/scripts", import.meta.url)).filter(name => name.endsWith(".js"))) {
    const ast = parse(scriptSource(file), { ecmaVersion: "latest", sourceType: "module" });
    function walk(node) {
      if (!node || typeof node !== "object") return;
      if (node.type === "CallExpression" && ["logAdmin", "logPlayer", "logSystem", "logClaimEvent"].includes(node.callee.name)) {
        const idx = ["logSystem", "logClaimEvent"].includes(node.callee.name) ? 0 : 1;
        const action = node.arguments[idx];
        if (action?.type === "Literal") seen.add(action.value);
        if (action?.type === "ConditionalExpression") for (const branch of [action.consequent, action.alternate]) if (branch.type === "Literal") seen.add(branch.value);
      }
      for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(walk); else if (value?.type) walk(value);
    }
    walk(ast);
  }
  assert.ok(seen.size > 140);
  for (const action of [...seen, "WEATHER", "TIME_SET", "DIFFICULTY", "WORLDSPAWN_SET", "DIM_LOCK_SCHED", "DIM_UNLOCK_SCHED", "DIM_LOCK_CANCEL", "DIM_UNLOCK_CANCEL"]) {
    assert.ok(known.has(action), `untranslated action ${action}`);
  }
});

test("the actual log filter displays Chinese while submitting the original action code", async () => {
  const dropdowns = [], submitted = [];
  class Form {
    title() { return this; } textField() { return this; }
    dropdown(label, options, defaults) { dropdowns.push({ label, options, defaults }); return this; }
    async show() { return { formValues: ["", 0, 2, 3] }; }
  }
  const fn = vm.runInNewContext(messagesSource + "\n" + labelSource + "\n" + declarations("ui-admin.js", ["showAdminLogFilter"]) + "\nshowAdminLogFilter", {
    ModalFormData: Form, getPlayerRegistry: () => ({}), showAdminLog: (...args) => submitted.push(args),
  });
  await fn({}, "", "BAN", "system", [], ["BAN", "KIT_EVENT_CLAIM"]);
  assert.equal(render(dropdowns[1].options[2]), "事件领取礼包");
  assert.equal(dropdowns[1].defaults.defaultValueIndex, 1);
  assert.equal(submitted[0][2], "KIT_EVENT_CLAIM"); assert.equal(submitted[0][3], "system");
});

test("localized duration displays and machine-readable duration inputs stay separate and lossless", () => {
  const names = ["fmtAgo", "fmtMs", "fmtDuration", "fmtDurationExact", "parseDuration", "joinTimeParts", "_timeParts", "fmtAgoRaw", "fmtMsRaw", "fmtDurationRaw"];
  const api = vm.runInNewContext(messagesSource + "\n" + declarations("utils.js", names) + `\n({ ${names.join(",")} })`, {
    Date: class extends Date { static now() { return 2000000000; } },
  });
  assert.equal(api.fmtAgo(2000000000 - 3660000), "1小时 1分钟前");
  assert.equal(api.fmtMs(2000000000 + 60000), "1分钟后");
  assert.equal(api.fmtDuration(3661000), "1小时 1分钟");
  assert.equal(render(api.fmtDurationRaw(3661000)), "1小时 1分钟");
  assert.equal(render(api.fmtDurationRaw(3661000), "en_US"), "1 h 1 min");
  assert.equal(render(api.fmtMsRaw(2000000000 + 60000)), "1分钟后");
  assert.equal(render(api.fmtAgoRaw(2000000000 - 3660000)), "1小时 1分钟前");
  for (const ms of [1000, 30 * 60000, 36 * 3600000, 86400000 + 6 * 3600000 + 15000]) assert.equal(api.parseDuration(api.fmtDurationExact(ms)), ms);
});

test("editing a kit round-trips its exact cooldown and custom playtime after Chinese display changes", () => {
  const source = declarations("ui-kits.js", ["editKitSettings"]);
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  const defaults = ast.body[0].body.body.filter(node => node.type === "VariableDeclaration" && node.declarations.some(d => ["ptCustomDefault", "cooldownObs"].includes(d.id.name)))
    .map(node => source.slice(node.start, node.end)).join("\n");
  class ObservableString { constructor(value) { this.value = value; } getData() { return this.value; } }
  const api = vm.runInNewContext(messagesSource + "\n" + declarations("utils.js", ["fmtDurationExact"]) + "\n" +
    declarations("ui-kits.js", ["fmtRemaining", "parseCooldownSec", "MAX_COOLDOWN_SEC"]) + "\n" + defaults + "\n({ input:cooldownObs.getData(), playtime:ptCustomDefault, parseCooldownSec, fmtRemaining })", {
    kit: { cooldownSec: 86400 + 21600 + 15 }, rankWillCarry: false, effMin: 90, ObservableString,
  });
  assert.equal(api.parseCooldownSec(api.input), 108015);
  assert.equal(api.parseCooldownSec(api.playtime), 5400);
  assert.equal(api.fmtRemaining(108015), "1天 6小时");
  assert.equal(api.fmtRemaining(75), "1分钟 15秒");
  assert.equal(api.fmtRemaining(0), "0秒");
});

test("translated runtime diagnostics still detect available experimental APIs", () => {
  for (const available of [true, false]) {
    const messages = [];
    const fn = vm.runInNewContext(declarations("jm_debug.js", ["HEADER", "probe", "permLevelName", "runEnvInfo"]) + "\nrunEnvInfo", {
      world: { beforeEvents: available ? { chatSend: {} } : {}, afterEvents: {}, gameRules: {}, getDay: () => 1, getTimeOfDay: () => 0 },
      system: { currentTick: 42 }, VER: "test", NS: "jm_at", SEP: " · ", PlayerPermissionLevel: { Member: 0 },
      isOwner: () => false, isAdmin: () => ({ ok: false }), isModerator: () => false, getPlayerXuid: () => "xuid",
    });
    fn({ name: "Player Admin 自定义名称", getTags: () => [], sendMessage: value => messages.push(value) });
    assert.match(messages.join("\n"), available ? /可能已开启/ : /关闭／稳定版/);
    assert.match(messages.join("\n"), /Player Admin 自定义名称/);
  }
});

function searchDisplayApi() {
  return vm.runInNewContext(messagesSource + "\n" +
    declarations("search-utils.js", ["normalizeQuery", "resultRowParts", "formatResultRow"]) + "\n" +
    declarations("search-display.js", ["SEARCH_GROUP_KEYS", "localizedResultRow"]) + "\n" +
    declarations("ui-admin.js", ["PANEL_SEARCH_INDEX", "_panelResultButtonLabel"]) + "\n" +
    declarations("info-admin.js", ["SEARCH_INDEX", "_resultButtonLabel"]) +
    "\n({ PANEL_SEARCH_INDEX, SEARCH_INDEX, _panelResultButtonLabel, _resultButtonLabel, formatResultRow })");
}

test("every actual search result localizes its parent menu as well as its destination title", () => {
  const api = searchDisplayApi();
  for (const [entries, button] of [[api.PANEL_SEARCH_INDEX, api._panelResultButtonLabel], [api.SEARCH_INDEX, api._resultButtonLabel]]) {
    for (const entry of entries) {
      const displayed = button(entry, "");
      const chinese = render(displayed);
      assert.match(chinese.split("\n")[0], /\p{Script=Han}/u, entry.key);
      if (chinese.includes("\n")) assert.match(chinese.split("\n")[1], /\p{Script=Han}/u, entry.path);
      assert.equal(render(displayed, "en_US"), api.formatResultRow(entry), entry.key);
      assert.doesNotMatch(chinese, /\[object Object\]|jm_at\./);
    }
  }
});

test("localized search display keeps matching keywords and navigation data unchanged", () => {
  const api = searchDisplayApi();
  const original = api.PANEL_SEARCH_INDEX.find(entry => entry.key === "players_online");
  const entry = { ...original, matchedTerms: ["spy"] };
  const before = JSON.stringify(entry);
  const result = api._panelResultButtonLabel(entry, "vanish");
  assert.equal(JSON.stringify(entry), before);
  assert.equal(original.key, "players_online");
  assert.equal(entry.path, "Players");
  assert.match(render(result), /\n§8玩家 · spy§r$/);
  assert.equal(render(result, "en_US"), api.formatResultRow(entry, "vanish"));
});
