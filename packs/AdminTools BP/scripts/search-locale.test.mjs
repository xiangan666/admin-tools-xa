/**
 * search-locale.test.mjs — run with: node scripts/search-locale.test.mjs
 *
 * Covers the per-player localized term pools (search-locale.js) using the
 * real generated Spanish data module and the real engine. Player objects are
 * duck-typed stand-ins for @minecraft/server Player (only clientSystemInfo
 * is read).
 */
import { localizedIndex, playerLang } from "./search-locale.js";
import esTerms from "./search-terms-es.js";
import { searchScore } from "./search-utils.js";

let passed = 0;
let failed = 0;
const ok = (name, cond, extra = "") => {
  if (cond) passed++;
  else {
    failed++;
    console.error(`FAIL: ${name}${extra ? " — " + extra : ""}`);
  }
};

const esPlayer = { clientSystemInfo: { locale: "es_MX" } };
const enPlayer = { clientSystemInfo: { locale: "en_US" } };
const bare = {};
const throwing = {
  get clientSystemInfo() {
    throw new Error("player left");
  },
};

// --- playerLang ---
ok("es_MX -> es", playerLang(esPlayer) === "es");
ok("en_US -> en", playerLang(enPlayer) === "en");
ok("fr-FR (hyphen) -> fr", playerLang({ clientSystemInfo: { locale: "fr-FR" } }) === "fr");
ok("no clientSystemInfo -> ''", playerLang(bare) === "");
ok("throwing getter -> ''", playerLang(throwing) === "");

// --- localizedIndex ---
// Fixture uses a REAL panel key (players_online) so real es data attaches,
// plus a fake key to prove unmatched entries pass through untouched.
const INDEX = [
  { key: "players_online", label: "Online Players", terms: "online players ban kick" },
  { key: "not_a_real_key", label: "X", terms: "xyz" },
];

ok("en player gets the original array back", localizedIndex(enPlayer, INDEX, "panel") === INDEX);
ok("player w/o clientSystemInfo gets the original", localizedIndex(bare, INDEX, "panel") === INDEX);

const merged = localizedIndex(esPlayer, INDEX, "panel");
ok("es player gets a new merged array", merged !== INDEX);
ok(
  "es terms appended after the English pool",
  merged[0].terms.startsWith(INDEX[0].terms) && merged[0].terms.length > INDEX[0].terms.length,
);
ok("entry without es data is the same object", merged[1] === INDEX[1]);
ok("merged index is cached (same identity)", localizedIndex(esPlayer, INDEX, "panel") === merged);
ok("info/panel kinds cached separately", localizedIndex(esPlayer, INDEX, "info") !== merged);

// --- engine integration ---
// Every Spanish keyword is an exact term for its entry, so the first one must
// produce a strong match through the unmodified engine.
const esWord = (esTerms.panel.players_online || "").split(/\s+/)[0];
ok("es data exists for panel players_online", !!esWord);
if (esWord) {
  const { score, strong } = searchScore(esWord, merged[0]);
  ok(`spanish query "${esWord}" scores strong on merged entry`, score > 0 && strong === true);
  ok(
    `spanish query "${esWord}" does nothing for the unmerged entry`,
    searchScore(esWord, INDEX[0]).score < score,
  );
}

// --- generator guarantees the data module must uphold ---
const allWords = Object.values(esTerms.panel)
  .concat(Object.values(esTerms.info))
  .join(" ")
  .split(/\s+/);
ok("no uppercase words in es data", allWords.every((w) => w === w.toLowerCase()));
const accented = allWords.find((w) => /[áéíóúüñ]/.test(w));
ok("accented Spanish words present", !!accented, "generator produced none?");
if (accented) {
  const plain = accented.normalize("NFD").replace(/[̀-ͯ]/g, "");
  ok(
    `accent-stripped variant of "${accented}" stored too`,
    allWords.includes(plain),
    `missing "${plain}"`,
  );
}

console.log(`search-locale tests: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
