/**
 * ui-font.js — consistent font rendering for form bodies
 *
 * Bedrock renders text in the blocky Minecraft font until a glyph outside that
 * font appears, at which point it falls back to the smoother Noto Sans for the
 * whole form. Pages with bullet points (•) already trigger this, so they look
 * different from bullet-less pages.
 *
 * To make every page match, we append a faint, unobtrusive glyph to the end of
 * every form body: U+02D9 (dot above), colored §0 (black, near-invisible on the
 * dark form panel) and closed with §r so the color can't bleed. It forces the
 * Noto Sans fallback without looking like a stray/missing bullet. (Chosen via
 * the jm_at_fonttest probe.)
 *
 * Scope note: this only works for ActionFormData / MessageFormData, where the
 * body marker flips the whole form (title + buttons included). Input modals
 * (ModalFormData) do NOT flip from a control label, and on-screen text (action
 * bar / title / chat) is deliberately left alone — so neither is patched here.
 *
 * DDUI (CustomForm) CANNOT be smooth-fonted at all — three approaches tested and
 * ruled out in-game (2026-06):
 *   1. Unicode marker (this file's trick): DDUI does a PER-GLYPH font fallback —
 *      only the trigger glyph renders in Noto Sans, surrounding ASCII stays
 *      blocky. The whole-form flip is unique to the legacy ActionForm/MessageForm
 *      body.
 *   2. Script API: the TextOptions accepted by label()/header() exposes only
 *      `visible` — there is no font/font_type property.
 *   3. RP UI override: the RP's common_buttons.new_ui_binding_button_label
 *      `font_type: smooth` override (which restyles all vanilla UI buttons) does
 *      NOT reach DDUI buttons — they stay blocky. DDUI renders through its own
 *      internal pipeline that resource-pack element overrides can't address.
 * So DDUI font is fixed; nothing here can change it.
 *
 * Patched once at startup; imported for side-effects from main.js.
 */

import { ActionFormData, MessageFormData } from "@minecraft/server-ui";

// No leading newline: the marker attaches to the body's existing end so it adds
// no extra vertical gap (preserving each body's original trailing spacing).
const FONT_FIX = "§0˙§r";

/** Wrap a form class's body() so it always appends the font-fix marker. */
function patchBody(Cls) {
  const orig = Cls?.prototype?.body;
  if (typeof orig !== "function" || orig.__jmFontPatched) return;
  function body(text) {
    // RawMessage bodies (translate keys / rawtext from i18n.js) must keep
    // their object form — String() would render "[object Object]". Append the
    // marker as one more rawtext part instead.
    if (text && typeof text === "object") {
      const parts = Array.isArray(text.rawtext) ? text.rawtext.slice() : [text];
      parts.push({ text: FONT_FIX });
      return orig.call(this, { rawtext: parts });
    }
    return orig.call(this, String(text ?? "") + FONT_FIX);
  }
  body.__jmFontPatched = true;
  Cls.prototype.body = body;
}

patchBody(ActionFormData);
patchBody(MessageFormData);
