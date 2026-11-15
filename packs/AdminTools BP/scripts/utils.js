/**
 * utils.js — Utility / helper functions
 * Only imports i18n.js (which is itself a safe base layer) — no other addon
 * modules, so this file stays a safe base layer.
 */

import { world, system } from "@minecraft/server";
import {
  ActionFormData,
  MessageFormData,
  FormCancelationReason,
} from "@minecraft/server-ui";
import { t, raw } from "./i18n.js";

// =========================================================
// UI nav button constants
// =========================================================

/** Standard Close button label — appended to every non-top-level menu so players
 *  can exit the entire UI in one click instead of pressing Back repeatedly.
 *  A single frozen RawMessage: every `btn === CLOSE_BTN_LABEL` dispatch across
 *  the UIs is an identity comparison against this exact object, which keeps
 *  working now that labels are translate keys instead of strings. */
export const CLOSE_BTN_LABEL = Object.freeze(t("jm_at.common.btn_close"));
export const CLOSE_BTN_ICON = "textures/ui/jm_at_close";

// =========================================================
// Time & formatting
// =========================================================

export function nowMs() {
  return Date.now();
}

/** Current time as epoch SECONDS. Use for scoreboard storage — epoch ms
 *  overflows a signed 32-bit scoreboard value, epoch seconds fit until 2038. */
export function nowSec() {
  return Math.floor(Date.now() / 1000);
}

/** Plain Chinese for persisted notifications and string-only APIs. */
export function fmtAgo(ms) {
  if (!ms) return "未知";
  const diff = Math.max(0, Date.now() - ms);
  const m = Math.floor(diff / 60000) % 60;
  const h = Math.floor(diff / 3600000) % 24;
  const d = Math.floor(diff / 86400000);
  if (diff < 60000) return "刚才";
  if (d > 0) return `${d}天 ${h}小时 ${m}分钟前`;
  if (h > 0) return `${h}小时 ${m}分钟前`;
  return `${m}分钟前`;
}

export function fmtMs(ms) {
  if (!ms) return "从不";
  const now = Date.now();
  const diff = ms - now;
  const abs = Math.abs(diff);
  const d = Math.floor(abs / 86400000);
  const h = Math.floor((abs % 86400000) / 3600000);
  const m = Math.floor((abs % 3600000) / 60000);
  const parts = [];
  if (d > 0) parts.push(`${d}天`);
  if (h > 0) parts.push(`${h}小时`);
  if (m > 0 || parts.length === 0) parts.push(`${m}分钟`);
  return `${parts.join(" ")}${diff < 0 ? "前" : "后"}`;
}

export function fmtDuration(ms) {
  if (!ms || ms <= 0) return "永久";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts = [];
  if (d) parts.push(`${d}天`);
  if (h) parts.push(`${h}小时`);
  if (m) parts.push(`${m}分钟`);
  if (sec) parts.push(`${sec}秒`);
  // Show the two largest non-zero units (e.g. "7d 23h", "1h 30m") for an
  // accurate-but-readable label; display only — round-tripping uses
  // fmtDurationExact.
  return parts.slice(0, 2).join(" ") || "0秒";
}

/**
 * Lossless single-unit duration string for round-tripping through parseDuration:
 * picks the largest unit (d/h/m/s) that divides the value evenly, so 90 minutes
 * formats as "90m" (not "1h") and 36 hours as "36h" (not "1d"). Used to seed the
 * broadcast-edit interval field without truncating it.
 */
export function fmtDurationExact(ms) {
  if (!ms || ms <= 0) return "0";
  const units = [
    ["d", 86400000],
    ["h", 3600000],
    ["m", 60000],
    ["s", 1000],
  ];
  for (const [unit, size] of units) {
    if (ms % size === 0) return `${ms / size}${unit}`;
  }
  return `${Math.round(ms / 1000)}s`; // sub-second shouldn't occur for broadcasts
}

/** Parse duration strings like "30m", "2h", "7d", "perm" -> ms (0 = permanent). */
export function parseDuration(str) {
  if (!str) return 0;
  const s = str.trim().toLowerCase();
  if (s === "perm" || s === "permanent" || s === "0") return 0;
  // Accept one or more unit segments so combined durations like "1h30m" or
  // "1d6h" work, not just a single unit.
  if (!/^(\d+[smhd])+$/.test(s)) return -1;
  const mults = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  let total = 0;
  for (const m of s.matchAll(/(\d+)([smhd])/g)) {
    total += parseInt(m[1], 10) * mults[m[2]];
  }
  return total;
}

export function fmtDim(dimId) {
  return (dimId ?? "overworld").replace("minecraft:", "");
}

// ---------------------------------------------------------
// RawMessage display variants of the fmt* helpers.
//
// Persisted text uses Chinese. Live RawMessage surfaces localize both relative
// words and time units. Input fields use fmtDurationExact's unchanged d/h/m/s.
// ---------------------------------------------------------

const joinTimeParts = parts => raw(...parts.flatMap((part, i) => i ? [" ", part] : [part]));

/** Localized time-unit builder shared by live relative-time displays. */
function _timeParts(absMs) {
  const m = Math.floor(absMs / 60000) % 60;
  const h = Math.floor(absMs / 3600000) % 24;
  const d = Math.floor(absMs / 86400000);
  const parts = [];
  if (d > 0) parts.push(t("jm_at.time.unit_days", d));
  if (h > 0 || d > 0) parts.push(t("jm_at.time.unit_hours", h));
  parts.push(t("jm_at.time.unit_minutes", m));
  return joinTimeParts(parts);
}

/** RawMessage version of fmtAgo. */
export function fmtAgoRaw(ms) {
  if (!ms) return t("jm_at.time.unknown");
  const diff = Math.max(0, Date.now() - ms);
  if (diff < 60000) return t("jm_at.time.just_now");
  return t("jm_at.time.ago", _timeParts(diff));
}

/** RawMessage version of fmtMs. */
export function fmtMsRaw(ms) {
  if (!ms) return t("jm_at.time.never");
  const diff = ms - Date.now();
  const abs = Math.abs(diff);
  const d = Math.floor(abs / 86400000);
  const h = Math.floor((abs % 86400000) / 3600000);
  const m = Math.floor((abs % 3600000) / 60000);
  const parts = [];
  if (d > 0) parts.push(t("jm_at.time.unit_days", d));
  if (h > 0) parts.push(t("jm_at.time.unit_hours", h));
  if (m > 0 || parts.length === 0) parts.push(t("jm_at.time.unit_minutes", m));
  const joined = joinTimeParts(parts);
  return diff < 0 ? t("jm_at.time.ago", joined) : t("jm_at.time.in", joined);
}

/** RawMessage version of fmtDuration. */
export function fmtDurationRaw(ms) {
  if (!ms || ms <= 0) return t("jm_at.time.permanent");
  const seconds = Math.floor(ms / 1000);
  const parts = [
    ["jm_at.time.unit_days", Math.floor(seconds / 86400)],
    ["jm_at.time.unit_hours", Math.floor(seconds % 86400 / 3600)],
    ["jm_at.time.unit_minutes", Math.floor(seconds % 3600 / 60)],
    ["jm_at.time.unit_seconds", seconds % 60],
  ].filter(([, amount]) => amount > 0).slice(0, 2).map(([key, amount]) => t(key, amount));
  return parts.length ? joinTimeParts(parts) : t("jm_at.time.unit_seconds", 0);
}

/** RawMessage version of fmtDim — same lowercase ids, but translatable. */
// lang-keys: jm_at.dimid.*
const DIMID_KEYS = {
  overworld: "jm_at.dimid.overworld",
  nether: "jm_at.dimid.nether",
  the_end: "jm_at.dimid.the_end",
};
export function fmtDimRaw(dimId) {
  const id = fmtDim(dimId);
  return DIMID_KEYS[id] ? t(DIMID_KEYS[id]) : { text: id };
}

// =========================================================
// JSON helpers
// =========================================================

export function safeJsonParse(text, fallback) {
  try {
    if (typeof text !== "string" || text.length === 0) return fallback;
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

export function safeJsonStringify(obj, fallback = "{}") {
  try {
    return JSON.stringify(obj);
  } catch {
    return fallback;
  }
}

/**
 * UTF-8 byte length of a string — this is how Bedrock measures dynamic property
 * sizes against its 32767-byte-per-property cap. Note color codes (§, U+00A7)
 * cost 2 bytes each, so a heavily-formatted blob is larger than its char count.
 */
export function utf8ByteLen(str) {
  if (typeof str !== "string") return 0;
  let bytes = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      bytes += 4; // high surrogate — counts the full pair, skip the low half
      i++;
    } else bytes += 3;
  }
  return bytes;
}

// =========================================================
// String helpers
// =========================================================

export function clampText(s, maxLen) {
  if (typeof s !== "string") return "";
  const cleaned = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen) : cleaned;
}

export function genId(prefix) {
  const t = nowMs().toString(36);
  const r = Math.random().toString(36).slice(2, 6);
  return `${prefix}${t}-${r}`.toUpperCase();
}

// =========================================================
// Claim notification message templates
// =========================================================

/** Placeholders recognized in claim entry message templates. */
export const CLAIM_MSG_PLACEHOLDERS = [
  "owner",
  "ownerName",
  "name",
  "claimName",
  "restricted",
];

/**
 * Convert easy-to-type "&7" color codes into Bedrock "§7" codes. The § symbol
 * can't be typed on most consoles/phones, so templates accept & as an alias.
 * Only valid code chars are converted; a bare "&" (e.g. "Steve & friends") is
 * left intact.
 */
export function applyColorCodes(s) {
  // Every code §0–§9 and §a–§v is meaningful on Bedrock (colors plus the §k/l/o/r
  // formatting codes; §m/§n etc. are colors, not strikethrough/underline). The
  // old class missed the material colors h,i,j,p,q,s,t,u,v.
  return String(s).replace(/&([0-9a-v])/g, "§$1");
}

/**
 * Expand a literal "\n" (backslash + n, two characters) typed in a single-line
 * text field into a real newline. Bedrock titles, subtitles and chat honor real
 * newlines, but the in-game form text fields can't capture an Enter key — so
 * users type \n to mark a line break. Stray breaks at the very start/end are
 * trimmed so they can't shove a centered title/subtitle off-position.
 */
export function applyNewlines(s) {
  return String(s).replace(/\\n/g, "\n").replace(/^\n+|\n+$/g, "");
}

/**
 * Substitute {placeholder} tokens in `tpl` from `values`. Matching is
 * case-insensitive ({Owner}, {OWNER}, {owner} all work). Unrecognized tokens are
 * stripped (replaced with "") so players never see raw braces.
 */
export function renderClaimTemplate(tpl, values) {
  const lower = {};
  for (const k in values) lower[k.toLowerCase()] = values[k];
  return String(tpl).replace(/\{(\w+)\}/g, (_m, key) => {
    const lk = key.toLowerCase();
    return Object.prototype.hasOwnProperty.call(lower, lk) ? lower[lk] : "";
  });
}

/** Small edit distance (capped) for typo suggestions. */
function _editDistance(a, b) {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 2) return 3; // early out — too different to suggest
  const dp = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] =
        a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[n];
}

/**
 * Scan a template for {tokens} that aren't recognized placeholders. Returns
 * [{ tag, suggestion }] where suggestion is the closest known placeholder when
 * the token is a likely typo (edit distance ≤ 2), otherwise null. Used by the
 * config editor's live preview to flag mistakes.
 */
export function findUnknownClaimPlaceholders(tpl) {
  const known = CLAIM_MSG_PLACEHOLDERS.map((s) => s.toLowerCase());
  const out = [];
  const seen = new Set();
  const re = /\{(\w+)\}/g;
  let m;
  while ((m = re.exec(String(tpl))) !== null) {
    const key = m[1];
    const lk = key.toLowerCase();
    if (known.includes(lk) || seen.has(lk)) continue;
    seen.add(lk);
    let best = null;
    let bestD = Infinity;
    for (const k of CLAIM_MSG_PLACEHOLDERS) {
      const d = _editDistance(key.toLowerCase(), k.toLowerCase());
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    out.push({ tag: key, suggestion: bestD <= 2 ? best : null });
  }
  return out;
}

// =========================================================
// Player helpers
// =========================================================

export function getPlayerXuid(player) {
  return player.xuid ?? player.id;
}

export function getOnlinePlayerByName(name) {
  const lower = name.toLowerCase();
  return world.getPlayers().find((p) => p.name.toLowerCase() === lower) ?? null;
}

// =========================================================
// Messaging
// =========================================================

export function tell(player, msg) {
  try {
    player.sendMessage(msg);
  } catch {}
}

function _waitTicks(t) {
  return new Promise((res) => system.runTimeout(res, t));
}

/**
 * Blocking warning dialog, then optionally re-open a form. Replaces chat
 * warnings that get hidden behind an open UI form (Bedrock suppresses chat
 * while a form is on screen). Single OK button.
 *
 * Retries through transient UserBusy cancellations (mirrors the loop in
 * spectator-rescue.js) so the dialog still lands if it's opened in the same
 * tick the previous form closed.
 *
 * @param {Player} player   Who to warn.
 * @param {string} message  Warning text (color codes OK).
 * @param {Function} [backFn]  Called after OK to re-open the originating form.
 */
export async function warnForm(player, message, backFn = null) {
  try {
    const form = new ActionFormData()
      .title(t("jm_at.common.warn_title"))
      .body(message)
      .button(t("jm_at.common.btn_ok"));
    for (let attempt = 0; attempt < 20; attempt++) {
      if (!player.isValid) return;
      const res = await form.show(player);
      if (!res.canceled) break;
      if (res.cancelationReason !== FormCancelationReason.UserBusy) break;
      await _waitTicks(10);
    }
  } catch {}
  if (backFn) return backFn();
}

/**
 * DDUI discard guard — shown when leaving a CustomForm that has unsaved edits
 * (callers do the dirty-check via Observable snapshots first, so this only
 * appears when something actually changed). Returns true to KEEP EDITING
 * (reopen the form), false to DISCARD and leave. Only an explicit "Discard"
 * leaves; cancelling/closing the prompt keeps edits (safe default).
 */
export async function confirmDiscardChanges(player) {
  let r;
  try {
    for (let attempt = 0; attempt < 20; attempt++) {
      if (!player.isValid) return false;
      r = await new MessageFormData()
        .title(t("jm_at.common.discard_title"))
        .body(t("jm_at.common.discard_body"))
        .button1(t("jm_at.common.btn_keep_editing"))
        .button2(t("jm_at.common.btn_discard"))
        .show(player);
      if (!r.canceled) break;
      if (r.cancelationReason !== FormCancelationReason.UserBusy) break;
      await _waitTicks(10);
    }
  } catch {
    return true; // on error, keep editing rather than silently lose edits
  }
  return !(r && !r.canceled && r.selection === 1);
}

export function broadcastAll(msg) {
  for (const p of world.getPlayers()) tell(p, msg);
}

/** broadcastAdmins requires isAdmin — injected at startup to avoid circular deps. */
let _isAdminFn = null;
export function initBroadcastAdmins(isAdminFn) {
  _isAdminFn = isAdminFn;
}
export function broadcastAdmins(msg) {
  for (const p of world.getPlayers()) {
    if (_isAdminFn && _isAdminFn(p).ok) tell(p, msg);
  }
}

// =========================================================
// Structured error handling
// =========================================================

/** In-memory error counter for debug visibility */
const _errorCounts = new Map(); // context string → count

/**
 * Drop-in replacement for bare `catch {}` blocks.
 * Logs the error to console.warn with context and tracks occurrence counts.
 */
export function silentCatch(context, error) {
  _errorCounts.set(context, (_errorCounts.get(context) ?? 0) + 1);
  try {
    console.warn(`[AT:${context}] ${error?.message ?? error}`);
  } catch {}
}

/** Returns a snapshot of error counts keyed by context. */
export function getErrorSummary() {
  return Object.fromEntries(_errorCounts);
}

/** Resets all error counters. */
export function clearErrorSummary() {
  _errorCounts.clear();
}
