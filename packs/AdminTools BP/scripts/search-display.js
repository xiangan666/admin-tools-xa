/** Localized search buttons; the engine and its keyword data remain pure. */
import { t, raw } from "./i18n.js";
import { resultRowParts } from "./search-utils.js";

// Groups without their own destination entry still need a display translation.
const SEARCH_GROUP_KEYS = {
  Players: "jm_at.adm.players_title",
  "Action Log & Reports": "jm_at.adm.alh_title",
  "Claim Tool": "jm_at.search.group_claim_tool",
  "All Claims / Settings": "jm_at.search.group_all_claims",
  "Kit Tool": "jm_at.search.group_kit_tool",
};

/** Translate the title and parent menu; keep actual matched keywords intact. */
export function localizedResultRow(entry, query = "", index = []) {
  const { parent, hint } = resultRowParts(entry, query);
  const parentKey = SEARCH_GROUP_KEYS[parent] ?? index.find(candidate =>
    candidate.label.toLowerCase() === parent.toLowerCase())?.labelKey;
  const group = parentKey ? t(parentKey) : parent;
  return raw("§l", t(entry.labelKey), "§r", (parent || hint) ? raw(
    "\n§8", group, parent && hint ? " · " : "", hint, "§r",
  ) : null);
}
