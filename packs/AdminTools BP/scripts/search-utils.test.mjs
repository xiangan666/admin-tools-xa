/**
 * Engine tests for search-utils.js. Run: node scripts/search-utils.test.mjs
 *
 * Uses a representative fixture (mirroring real PANEL_SEARCH_INDEX entries after
 * the term audit) to lock in the matching/ranking fixes so the engine and the
 * indexes can't silently regress.
 */
import { searchScore, findClosestKeyword, stem, wordScore, formatResultRow, planResultView } from "./search-utils.js";

const INDEX = [
  {
    key: "game_commands",
    label: "Game Commands",
    terms:
      "game commands gamemode weather difficulty worldspawn spawn game rules gamerule keepinventory mobgriefing pvp tnt fire mob spawning clear dropped items survival creative adventure spectator storm spawnpoint clearlag explosion",
  },
  {
    key: "players_online",
    label: "Online Players",
    terms:
      "online players list who ban kick warn freeze heal feed gamemode inventory spy notes summon teleport frozen unban unfreeze admin moderator rank home vanish enderchest profile bring",
  },
  {
    key: "whitelist",
    label: "Manage Whitelist",
    terms: "whitelist add remove manage player allow allowlist offline online access invite permit",
  },
  {
    key: "config_editor",
    label: "Config Editor",
    terms:
      "config editor homes tpa teleport deathback death afk gravestone gravestones grave graves headstone tombstone keepinventory keep inventory kick respawn",
  },
  {
    key: "broadcasts",
    label: "Broadcasts",
    terms: "broadcast broadcasts announcement announce message send scheduled recurring interval repeat alert",
  },
  {
    key: "claims_admin",
    label: "Land Claims (Admin)",
    terms:
      "claim claims land protection chunks browse settings defaults abilities whitelist notifications grant revoke transfer ownership force delete owner subclaim nested trust griefing protect region territory unclaim",
  },
  {
    key: "tickets",
    label: "Tickets",
    terms:
      "ticket tickets open claimed resolved closed submit report reply claim resolve delete unclaim griefing harassment bug support help complaint",
  },
  {
    key: "kits_editor",
    label: "Kit Editor",
    terms:
      "kit kits editor manage create edit delete starter claimable repeatable cooldown contents items icon reward give bundle loadout gear",
  },
  {
    key: "teleport",
    label: "Teleport",
    terms: "teleport tp summon bring fetch send player goto move position location warp",
  },
  {
    key: "item_watch",
    label: "Item Watch",
    terms:
      "item watch monitor banned tracked threshold alert blacklist unban contraband illegal confiscate prohibited",
  },
];

function top(query) {
  let best = null;
  let bestScore = 0;
  for (const e of INDEX) {
    const { score } = searchScore(query, e);
    if (score > bestScore) {
      bestScore = score;
      best = e.key;
    }
  }
  return { key: best, score: bestScore };
}

let pass = 0;
let fail = 0;
const fails = [];
function eq(label, actual, expected) {
  if (actual === expected) pass++;
  else {
    fail++;
    fails.push(`${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  }
}
function ok(label, cond, detail = "") {
  if (cond) pass++;
  else {
    fail++;
    fails.push(`${label}: ${detail}`);
  }
}

// --- short tokens (3 chars) now resolve (regression: used to be exact/prefix only) ---
eq("'tnt' -> game_commands", top("tnt").key, "game_commands");
eq("'pvp' -> game_commands", top("pvp").key, "game_commands");
eq("'mob' -> game_commands", top("mob").key, "game_commands");
ok("'ban' matches (substring into unban/banned)", top("ban").score > 0, "no match for 'ban'");
ok("'ban' reaches online players or item watch", ["players_online", "item_watch"].includes(top("ban").key), `got ${top("ban").key}`);

// --- newly added vocabulary ---
eq("'frozen' -> players_online", top("frozen").key, "players_online");
eq("'unban' -> matched somewhere", top("unban").score > 0 ? true : false, true);
eq("'allowlist' -> whitelist", top("allowlist").key, "whitelist");
eq("'gravestone' -> config_editor", top("gravestone").key, "config_editor");
eq("'griefing' -> tickets or claims", ["tickets", "claims_admin"].includes(top("griefing").key) ? "ok" : top("griefing").key, "ok");
eq("'survival' -> game_commands", top("survival").key, "game_commands");
eq("'creative' -> game_commands", top("creative").key, "game_commands");
eq("'kit' -> kits_editor", top("kit").key, "kits_editor");
eq("'teleport' -> teleport", top("teleport").key, "teleport");
eq("'tp' (alias) -> teleport", top("tp").key, "teleport");
eq("'blacklist' -> item_watch", top("blacklist").key, "item_watch");

// --- bidirectional prefix: long query, short stored root ---
eq("'broadcasting' -> broadcasts", top("broadcasting").key, "broadcasts");
ok("wordScore reverse-prefix 'broadcasting'~'broadcast'", wordScore("broadcasting", "broadcast") >= 250, "reverse prefix not scored");

// --- stemmer: plural/inflection collapse ---
eq("stem('claims')", stem("claims"), "claim");
eq("stem('homes')", stem("homes"), "home");
eq("stem('ss' guard: 'address')", stem("address"), "address");
eq("'claims' -> claims_admin", top("claims").key, "claims_admin");

// --- stopwords no longer collapse ranking ---
const banAlone = searchScore("ban", INDEX.find((e) => e.key === "players_online"));
const banThe = searchScore("the ban", INDEX.find((e) => e.key === "players_online"));
ok(
  "'the ban' keeps the all-tokens bonus (no 1000-pt collapse)",
  banThe.score >= 1000 && banThe.score >= banAlone.score,
  `the ban=${banThe.score} vs ban=${banAlone.score}`,
);

// --- did-you-mean quality ---
ok("typo 'gravstone' suggests a grave* term", (findClosestKeyword("gravstone", INDEX) || "").startsWith("grave"), `got ${findClosestKeyword("gravstone", INDEX)}`);
eq("no echo: 'frozen' never suggests 'frozen'", findClosestKeyword("frozen", INDEX) === "frozen" ? "ECHO" : "ok", "ok");
eq("garbage 'zzzzzzqx' -> null", findClosestKeyword("zzzzzzqx", INDEX), null);

// --- result row formatting (icon resolved by caller; this is the text) ---
eq(
  "row: deep path -> parent group + differing match",
  formatResultRow({ label: "Item Watch Log", path: "Control Panel → Item Watch → Item Watch Log", matchedTerms: ["banned"] }, "ban"),
  "§lItem Watch Log§r\n§8Item Watch · banned§r",
);
eq(
  "row: hides match identical to query",
  formatResultRow({ label: "Online Players", path: "Players", matchedTerms: ["ban"] }, "ban"),
  "§lOnline Players§r\n§8Players§r",
);
eq(
  "row: shows synonym match (vanish -> spy)",
  formatResultRow({ label: "Online Players", path: "Players", matchedTerms: ["spy"] }, "vanish"),
  "§lOnline Players§r\n§8Players · spy§r",
);
eq(
  "row: top-level (leaf == label) -> no subtitle",
  formatResultRow({ label: "Teleport", path: "Teleport", matchedTerms: ["teleport"] }, "teleport"),
  "§lTeleport§r",
);

// --- strong/weak classification (drives the "loosely related" fold) ---
ok("strong: exact match", searchScore("kit", { label: "X", terms: "kit kits" }).strong === true, "exact not strong");
ok("strong: prefix match (ban->banned)", searchScore("ban", { label: "X", terms: "banned" }).strong === true, "prefix not strong");
ok("weak: substring only (ban in contraband)", searchScore("ban", { label: "X", terms: "contraband illegal" }).strong === false, "substring marked strong");
ok("weak: fuzzy only (warp~warn)", searchScore("warp", { label: "X", terms: "warn warnings" }).strong === false, "fuzzy marked strong");

// --- planResultView folding ---
{
  const mixed = [{ key: "a", strong: true }, { key: "b", strong: true }, { key: "c", strong: false }];
  const v = planResultView(mixed);
  ok("plan: folds the weak tail", v.list.length === 2 && v.foldCount === 1 && v.folded === true, JSON.stringify(v));
  const v2 = planResultView(mixed, true);
  ok("plan: showAll expands everything", v2.list.length === 3 && v2.folded === false, JSON.stringify(v2));
  const allWeak = planResultView([{ key: "a", strong: false }, { key: "b", strong: false }]);
  ok("plan: all-weak shows all (never hide everything)", allWeak.list.length === 2 && allWeak.folded === false, JSON.stringify(allWeak));
  const allStrong = planResultView([{ key: "a", strong: true }]);
  ok("plan: no weak -> no fold", allStrong.folded === false, JSON.stringify(allStrong));
}

// --- no-space scripts (Chinese etc.) — short tokens + unsegmented compounds ---
ok("cjk: 2-char exact is strong", searchScore("封禁", { label: "X", terms: "封禁 玩家" }).strong === true, "exact CJK not strong");
eq("cjk: 2-char query substrings into a stored compound", wordScore("日志", "管理员日志"), 200);
eq("cjk: unsegmented compound query reaches a stored word", wordScore("封禁玩家", "封禁"), 100);
ok("cjk: compound coverage ranks the longer stored word higher", wordScore("管理員日誌", "管理員") > wordScore("管理員日誌", "管理"), "coverage weighting broken");
eq("latin: 2-char substring still blocked ('go' in 'logout')", wordScore("go", "logout"), 0);
eq("latin: long query still can't reach short non-prefix keyword", wordScore("broadcasting", "cast"), 0);
ok("cjk: substring-only hit stays weak (folds as loosely related)", searchScore("日志", { label: "X", terms: "管理员日志" }).strong === false, "CJK substring marked strong");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) {
  console.log("\nFAILURES:");
  for (const f of fails) console.log("  - " + f);
  process.exit(1);
}
console.log("All engine assertions passed.");
