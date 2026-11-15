/**
 * search-locale.js — per-player localized search-term pools.
 *
 * The engine (search-utils.js) scores queries against each entry's English
 * `terms` + `label`. For players whose client locale has a generated
 * search-terms-<lang>.js data module, this returns a copy of the index with
 * that language's keywords appended to each entry's term pool — so a Spanish
 * admin can type "banear" or "reclamo" and land on the right page. Everyone
 * else gets the original index back unchanged (identical behaviour to
 * English-only search). Display localization is handled by search-display.js;
 * this module only affects matching and "did you mean" suggestions.
 *
 * Adding a language: node remove-for-release/generate-search-terms.mjs <lang>
 * (see that file's header for the pipeline), then register the module in
 * LOCALE_TERMS below.
 */

import esTerms from "./search-terms-es.js";
import frTerms from "./search-terms-fr.js";
import idTerms from "./search-terms-id.js";
import ptTerms from "./search-terms-pt.js";
import zhTerms from "./search-terms-zh.js";

// language part of a locale tag → generated data module
// (es covers es_ES+es_MX, fr covers fr_FR+fr_CA, pt covers pt_BR+pt_PT,
//  zh covers zh_CN+zh_TW)
const LOCALE_TERMS = { es: esTerms, fr: frTerms, id: idTerms, pt: ptTerms, zh: zhTerms };

/** Language part of the player's client locale: "es_MX" → "es". */
export function playerLang(player) {
  try {
    const loc = String(player.clientSystemInfo?.locale ?? "");
    return loc.toLowerCase().split(/[-_]/)[0];
  } catch {
    return ""; // clientSystemInfo can throw if the player is disconnecting
  }
}

// The two indexes are static module consts, so each merged copy is built once
// per language and reused. kind disambiguates ("info"/"panel" share key names).
const mergedCache = new Map(); // `${lang}:${kind}` → merged index array

/**
 * Return `index` with the player's language keywords appended to each entry's
 * `terms`. kind = "info" (SEARCH_INDEX) or "panel" (PANEL_SEARCH_INDEX).
 */
export function localizedIndex(player, index, kind) {
  const lang = playerLang(player);
  const data = LOCALE_TERMS[lang]?.[kind];
  if (!data) return index;
  const cacheKey = `${lang}:${kind}`;
  let merged = mergedCache.get(cacheKey);
  if (!merged) {
    merged = index.map((e) =>
      data[e.key] ? { ...e, terms: `${e.terms} ${data[e.key]}` } : e,
    );
    mergedCache.set(cacheKey, merged);
  }
  return merged;
}
