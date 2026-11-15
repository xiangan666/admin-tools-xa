/**
 * search-utils.js — Shared fuzzy search engine for info and admin panel search.
 *
 * Matching is tiered (exact > prefix > stem/bidirectional > substring > fuzzy).
 * Key behaviours, with the queries they unblock:
 *  - 3-char tokens get substring + fuzzy (tnt, pvp, afk, mob, ban) — "ban" now
 *    reaches "unban"/"banned" via substring.
 *  - Bidirectional prefix: a long query reaches a short stored root
 *    ("broadcasting" -> stored "broadcast").
 *  - A light stemmer collapses plural/inflection variants ("claims" <-> "claim").
 *  - Stopwords ("the", "to", ...) no longer forfeit the all-tokens rank bonus,
 *    so "the ban" ranks like "ban".
 */

/**
 * Common abbreviations and shorthand mapped to their full terms.
 * Applied to each query word before scoring.
 */
export const SEARCH_ALIASES = {
  tp: "teleport",
  tpa: "teleport",
  gm: "gamemode",
  gmc: "creative",
  gms: "survival",
  gma: "adventure",
  perms: "permissions",
  perm: "permission",
  wb: "whitelist",
  wl: "whitelist",
  db: "database",
  inv: "inventory",
  bc: "broadcast",
  msg: "message",
  cmds: "commands",
  cmd: "command",
  cfg: "config",
  holo: "hologram",
  sc: "subclaim",
  dm: "dimension",
  dims: "dimension",
};

/**
 * Filler words that should not be *required* for the all-tokens ranking bonus.
 * A query made entirely of stopwords still requires them all (see searchScore),
 * so natural phrasing like "the ban list" ranks like "ban list".
 */
export const STOPWORDS = new Set([
  "the", "a", "an", "to", "of", "for", "my", "me", "is", "are", "on", "in",
  "and", "with", "go", "how", "do", "i", "you", "please", "pls", "can",
]);

/**
 * Scripts written without word spaces (CJK ideographs, kana, hangul). Query
 * tokens containing these bypass the 3-char minimum for substring matching —
 * 1-2 char words are the norm ("日志" = log) — and additionally match stored
 * words CONTAINED IN the query, since an unsegmented compound ("封禁玩家" =
 * ban player) arrives as a single token.
 */
const NO_SPACE_SCRIPT_RE = /[぀-ヿ㐀-鿿豈-﫿가-힯]/;

/**
 * Normalize a raw query string into deduplicated lowercase tokens.
 */
export function normalizeQuery(raw) {
  const words = raw.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return [...new Set(words)];
}

/** Levenshtein edit distance between two strings. */
export function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/**
 * Very light rule-based stemmer. Conservative: only strips when the resulting
 * root stays >= 4 chars, so distinct short words ("bus") are never mangled.
 * Used to collapse plural/inflection variants to a common root.
 */
export function stem(w) {
  if (w.length <= 4) return w;
  if (w.endsWith("ies") && w.length > 5) return w.slice(0, -3) + "y";
  if (w.endsWith("ing") && w.length > 6) return w.slice(0, -3);
  if (w.endsWith("ed") && w.length > 5) return w.slice(0, -2);
  if (w.endsWith("ss")) return w; // address, class — not a plural
  if (w.endsWith("es") && w.length > 5) return w.slice(0, -2);
  if (w.endsWith("s") && w.length > 4) return w.slice(0, -1);
  return w;
}

/**
 * Score a single query word against a single keyword using tiered scoring.
 * Returns 0 (no match) or a positive score (higher = better).
 *
 * Tiers (label matches score higher at the exact/prefix tiers):
 *   500/400  exact match (label / keyword)
 *   350/300  forward prefix: keyword starts with query (typed-short/stored-long)
 *   300/250  reverse prefix: query starts with stored root (typed-long/stored-short)
 *   300/250  stem-equal (plural / inflection collapse)
 *       200  substring match (3+ char query tokens)
 *       100  fuzzy match (3+ char query tokens)
 */
export function wordScore(query, keyword, isLabel = false) {
  if (keyword === query) return isLabel ? 500 : 400;
  if (keyword.startsWith(query)) return isLabel ? 350 : 300;
  // typed-long / stored-short (e.g. query "broadcasting" vs stored "broadcast");
  // gated to substantial roots so tiny tokens like "go"/"to" don't over-match.
  if (keyword.length >= 4 && query.startsWith(keyword)) return isLabel ? 300 : 250;
  // plural / inflection collapse via the light stemmer
  if (query.length >= 4 && keyword.length >= 4 && stem(query) === stem(keyword))
    return isLabel ? 300 : 250;
  // substring + fuzzy now reach 3-char tokens (tnt, pvp, afk, mob, ban, ...).
  // "ban" -> "unban"/"banned" works here via substring. No-space scripts get
  // substring at any length, in both directions (see NO_SPACE_SCRIPT_RE).
  const noSpaceScript = NO_SPACE_SCRIPT_RE.test(query);
  if (query.length < 3 && !noSpaceScript) return 0;
  if (keyword.includes(query)) return 200;
  // Stored word contained in an unsegmented compound query: score by how much
  // of the query it explains, so "管理員日誌" prefers an entry storing "管理員"
  // (or "日誌") over one that merely stores the generic "管理".
  if (noSpaceScript && keyword.length >= 2 && query.includes(keyword))
    return Math.round(200 * (keyword.length / query.length));
  const maxDist = query.length < 8 ? 1 : 2;
  if (Math.abs(query.length - keyword.length) > maxDist) return 0;
  if (levenshtein(query, keyword) <= maxDist) return 100;
  return 0;
}

/** Expand a query word using the alias table. Returns [original, ...aliases]. */
export function expandWord(word) {
  const words = [word];
  if (SEARCH_ALIASES[word]) words.push(SEARCH_ALIASES[word]);
  return words;
}

/**
 * Score an entire search query against one index entry.
 * Returns { score, matchedTerms[] } so results can show context.
 *
 * Entries matching all NON-STOPWORD query tokens receive a +1000 bonus, ensuring
 * they rank above partial matches. Stopwords are excluded from that requirement
 * (but still contribute their own match score), so a filler word can't collapse
 * a strong result. If a query is ALL stopwords, they are all required.
 */
export function searchScore(query, entry) {
  const queryWords = normalizeQuery(query);
  if (queryWords.length === 0) return { score: 0, matchedTerms: [] };
  const keywords = entry.terms.split(/\s+/);
  const labelWords = entry.label.toLowerCase().split(/\s+/);

  let required = queryWords.filter((w) => !STOPWORDS.has(w));
  if (required.length === 0) required = queryWords;
  const requiredSet = new Set(required);

  let total = 0;
  let requiredMatched = 0;
  let bestTier = 0; // strongest single-word match across the query
  const matchedTerms = [];
  for (const qw of queryWords) {
    let best = 0;
    let bestTerm = "";
    for (const expanded of expandWord(qw)) {
      for (const lw of labelWords) {
        const s = wordScore(expanded, lw, true);
        if (s > best) {
          best = s;
          bestTerm = lw;
        }
      }
      for (const kw of keywords) {
        const s = wordScore(expanded, kw, false);
        if (s > best) {
          best = s;
          bestTerm = kw;
        }
      }
    }
    total += best;
    if (best > bestTier) bestTier = best;
    if (best > 0) {
      if (requiredSet.has(qw)) requiredMatched++;
      if (bestTerm && !matchedTerms.includes(bestTerm)) matchedTerms.push(bestTerm);
    }
  }
  if (requiredMatched === required.length) total += 1000;
  // "strong" = at least one query word hit an exact/prefix/stem tier (>= 250).
  // substring (200) and fuzzy (100) only ⇒ a loosely-related match.
  return { score: total, matchedTerms, strong: bestTier >= STRONG_MATCH_TIER };
}

/** Minimum single-word tier that counts as a strong (not loosely-related) hit. */
export const STRONG_MATCH_TIER = 250;

/**
 * Decide how a sorted, scored result list is shown: strong (exact/prefix) hits
 * up front, with substring/fuzzy hits folded behind a "loosely related" button.
 * Pure so both search surfaces share identical behaviour.
 *  - showAll=true  → everything, no fold (the expanded view).
 *  - If there are no strong hits, weak hits are shown directly (never hide all).
 * Returns { list, foldCount, folded }.
 */
export function planResultView(scored, showAll = false) {
  const strong = scored.filter((e) => e.strong);
  const weak = scored.filter((e) => !e.strong);
  const folded = !showAll && strong.length > 0 && weak.length > 0;
  return {
    list: folded ? strong : scored,
    foldCount: folded ? weak.length : 0,
    folded,
  };
}

/**
 * Build the button TEXT for one search result (pure; the caller supplies the
 * icon). Second line = the parent group (so the user learns where it lives),
 * plus the matched term ONLY when it differs from what they typed (so synonym/
 * fuzzy hits explain themselves, e.g. searching "vanish" shows "· spy", while
 * "ban" matching "ban" shows nothing). The full breadcrumb is intentionally
 * dropped: the "→" glyph doesn't render in the button font and deep paths
 * truncate.
 */
export function resultRowParts(entry, query = "") {
  const qset = new Set(normalizeQuery(query));
  const label = String(entry.label ?? "");
  // Parent group = the last path segment that isn't the destination itself.
  const segs = String(entry.path ?? "")
    .split("→")
    .map((s) => s.trim())
    .filter(Boolean);
  if (segs.length && segs[segs.length - 1].toLowerCase() === label.toLowerCase())
    segs.pop();
  const parent = segs.length ? segs[segs.length - 1] : "";
  // Matched hint: first matched term the user did not literally type.
  let hint = "";
  for (const t of entry.matchedTerms ?? []) {
    if (t && !qset.has(String(t).toLowerCase())) {
      hint = t;
      break;
    }
  }
  return { label, parent, hint };
}

export function formatResultRow(entry, query = "") {
  const { label, parent, hint } = resultRowParts(entry, query);
  const sub = [parent, hint].filter(Boolean).join(" · ");
  return `§l${label}§r${sub ? `\n§8${sub}§r` : ""}`;
}

/**
 * Find the closest keyword across a search index to a query string.
 * Used for "Did you mean...?" suggestions.
 *
 * The length pre-filter uses maxSuggestDist as an exact lower bound on edit
 * distance (|len diff| <= edit distance), so it never discards a valid
 * suggestion — unlike the old hardcoded gate. Never echoes the query back.
 */
export function findClosestKeyword(query, index) {
  const qw = query.toLowerCase().trim();
  if (!qw) return null;
  const maxSuggestDist = Math.max(2, Math.floor(qw.length / 3) + 1);
  let bestWord = null;
  let bestDist = Infinity;

  const consider = (word) => {
    if (!word || word === qw) return; // never suggest the query itself
    if (Math.abs(qw.length - word.length) > maxSuggestDist) return;
    const dist = levenshtein(qw, word);
    if (dist < bestDist) {
      bestDist = dist;
      bestWord = word;
    }
  };

  for (const entry of index) {
    for (const kw of entry.terms.split(/\s+/)) consider(kw);
    for (const lw of entry.label.toLowerCase().split(/\s+/)) consider(lw);
  }

  // If the query is close to an alias key, suggest its expansion directly
  // (the expansion's own length is irrelevant to how the user mistyped).
  for (const [alias, expansion] of Object.entries(SEARCH_ALIASES)) {
    if (Math.abs(qw.length - alias.length) > maxSuggestDist) continue;
    const dist = levenshtein(qw, alias);
    if (dist <= maxSuggestDist && dist < bestDist && expansion !== qw) {
      bestDist = dist;
      bestWord = expansion;
    }
  }

  return bestDist <= maxSuggestDist ? bestWord : null;
}
