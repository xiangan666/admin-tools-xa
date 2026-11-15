/**
 * i18n.js — Localization helpers
 *
 * RawMessage-compatible surfaces use resource-pack keys through t()/raw().
 * String-only surfaces (DDUI live status, nameTags, persisted notifications)
 * use server-side Simplified Chinese. Commands, identifiers and player-authored
 * content keep their original bytes. See docs/LOCALIZATION.md.
 *
 *   t("jm_at.tpa.sent")                       -> { translate }
 *   t("jm_at.tpa.sent", name, seconds)        -> { translate, with: [s, s] }
 *   t("jm_at.x.gave", itemName(stack))        -> { translate, with: {rawtext} }
 *   raw("§7", t("jm_at.x.y"), " - ", name)    -> { rawtext: [...] }
 *
 * Lang values use positional params: %1$s, %2$s, ... (vanilla convention),
 * so translators can reorder them.
 *
 * Plain strings (shared server language rather than client translation):
 *   - entity.nameTag (graves, holograms, rank prefixes) — one raw string
 *     rendered identically for all viewers, no rawtext support
 *   - DDUI ObservableString values (live status lines in CustomForm)
 *   - scoreboard objective display names
 *   - text persisted to dynamic properties (logs, queued notifications)
 *   - user/admin-authored content (hologram lines, claim message templates,
 *     kit item nameTags, broadcasts)
 *   - search `terms` matching (scripts cannot read lang files)
 *   - support diagnostics (shown only to the fixed, authorized support team)
 *
 * No imports from other addon modules (safe base layer, like utils.js).
 */

import { ItemTypes } from "@minecraft/server";

/**
 * Build a RawMessage for a lang key. Args become the `with` parameters that
 * fill %1$s, %2$s, ... in the lang value. Numbers/strings are stringified;
 * RawMessage objects (e.g. nested translates from itemName()) pass through,
 * which switches `with` into its rawtext form.
 */
export function t(key, ...args) {
  if (args.length === 0) return { translate: key };
  if (args.every((a) => typeof a !== "object" || a === null)) {
    return { translate: key, with: args.map((a) => String(a ?? "")) };
  }
  return {
    translate: key,
    with: {
      rawtext: args.map((a) =>
        typeof a === "object" && a !== null ? a : { text: String(a ?? "") }
      ),
    },
  };
}

/**
 * Compose mixed literal/translated content into one RawMessage.
 * Strings become {text}; RawMessage objects pass through. Empty/nullish
 * parts are dropped so callers can pass conditional fragments directly.
 */
export function raw(...parts) {
  return {
    rawtext: parts
      .filter((p) => p !== null && p !== undefined && p !== "")
      .map((p) => (typeof p === "object" ? p : { text: String(p) })),
  };
}

/**
 * RawMessage for an item's display name. A player-given name tag wins
 * (literal player content); otherwise the item's own localization key so
 * the client renders it in the player's language.
 *
 * Accepts an ItemStack or a typeId string.
 */
export function itemName(stackOrTypeId) {
  try {
    if (typeof stackOrTypeId === "string") {
      const type = ItemTypes.get(stackOrTypeId);
      const key = type?.localizationKey;
      if (key) return { translate: key };
      return { text: prettifyTypeId(stackOrTypeId) };
    }
    if (stackOrTypeId?.nameTag) return { text: stackOrTypeId.nameTag };
    const key = stackOrTypeId?.localizationKey;
    if (key) return { translate: key };
    return { text: prettifyTypeId(stackOrTypeId?.typeId) };
  } catch {
    const fallback =
      typeof stackOrTypeId === "string"
        ? stackOrTypeId
        : stackOrTypeId?.typeId;
    return { text: prettifyTypeId(fallback) };
  }
}

/**
 * Fallback prettifier: "minecraft:iron_ingot" -> "Iron Ingot". Only for
 * when no localization key is available.
 */
export function prettifyTypeId(typeId) {
  return String(typeId ?? "")
    .replace(/^[^:]*:/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
