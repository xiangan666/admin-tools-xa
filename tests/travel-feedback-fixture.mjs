import { readFileSync } from "node:fs";
import { parse } from "acorn";

const i18n = readFileSync(new URL("../packs/AdminTools BP/scripts/i18n.js", import.meta.url), "utf8");
const rawNode = parse(i18n, { ecmaVersion: "latest", sourceType: "module" }).body
  .find(node => node.declaration?.id?.name === "raw").declaration;
// Load the real message composer and feedback functions into each game's VM.
export const titleFeedbackSource = readFileSync(new URL("../packs/AdminTools BP/scripts/screen-feedback.js", import.meta.url), "utf8")
  .replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
export const feedbackSource = titleFeedbackSource + "\n" + i18n.slice(rawNode.start, rawNode.end) + "\n" +
  readFileSync(new URL("../packs/AdminTools BP/scripts/travel-feedback.js", import.meta.url), "utf8")
    .replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");

export function messageText(value) {
  if (typeof value === "string") return value;
  if (value?.rawtext) return value.rawtext.map(messageText).join("");
  if (value?.text !== undefined) return value.text;
  return value?.translate ?? "";
}

export function makeScreenDisplay({ actionError = false, titleError = false } = {}) {
  return {
    bars: [], titles: [], bar: "", title: "", subtitle: "",
    setActionBar(message) {
      if (actionError) throw new Error("HUD action bar unavailable");
      this.bars.push(message); this.bar = messageText(message);
    },
    setTitle(message, options = {}) {
      if (titleError) throw new Error("HUD title unavailable");
      this.titles.push({ message, options }); this.title = messageText(message);
      this.subtitle = messageText(options.subtitle);
    },
  };
}
