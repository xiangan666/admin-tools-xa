import { showTimedTitle } from "./screen-feedback.js";
/**
 * Kit player and staff screens.
 * Players claim from Player Tool > Kits.
 * Staff manage kits from the craftable Kit Tool.
 *
 * Creating a kit uses a textured icon picker first, then one reactive DDUI form
 * for name, items, amounts, and options. Lossy item data gets a confirmation
 * before save. Editing settings reuses the same reactive options shape.
 */

import { world, system } from "@minecraft/server";
import {
  ActionFormData,
  ModalFormData,
  MessageFormData,
  CustomForm,
  ObservableString,
  ObservableNumber,
  ObservableBoolean,
  DataDrivenScreenClosedReason,
} from "@minecraft/server-ui";
import { LIMITS, FEATURES } from "./constants.js";
import {
  tell,
  warnForm,
  clampText,
  confirmDiscardChanges,
  fmtDurationExact,
  CLOSE_BTN_LABEL,
  CLOSE_BTN_ICON,
} from "./utils.js";
import { t, raw, itemName } from "./i18n.js";
import { getCfg, getPlayerRegistry } from "./storage.js";
import { getRankDb } from "./rank-db.js";
import { modCan } from "./permissions.js";
import {
  KIT_TYPES,
  getKits,
  getSortedKitNames,
  addKit,
  updateKit,
  removeKit,
  claimKit,
  giveKit,
  canClaimKit,
  kitRoomCheck,
  resetKitClaim,
  resetAllKitClaims,
  kitMinPlaytimeMin,
  serializeItemStack,
  isLossyType,
} from "./kits.js";

// =========================================================
// Helpers
// =========================================================

// Same color list as hologram line colors. Labels are shown in a DDUI
// dropdown (color codes were always stripped there), so lang values are plain.
// lang-keys: jm_at.kits.color_*
const KIT_COLORS = [
  { label: t("jm_at.kits.color_none"), code: "" },
  { label: t("jm_at.kits.color_black"), code: "§0" },
  { label: t("jm_at.kits.color_dark_blue"), code: "§1" },
  { label: t("jm_at.kits.color_dark_green"), code: "§2" },
  { label: t("jm_at.kits.color_dark_aqua"), code: "§3" },
  { label: t("jm_at.kits.color_dark_red"), code: "§4" },
  { label: t("jm_at.kits.color_dark_purple"), code: "§5" },
  { label: t("jm_at.kits.color_gold"), code: "§6" },
  { label: t("jm_at.kits.color_gray"), code: "§7" },
  { label: t("jm_at.kits.color_dark_gray"), code: "§8" },
  { label: t("jm_at.kits.color_blue"), code: "§9" },
  { label: t("jm_at.kits.color_green"), code: "§a" },
  { label: t("jm_at.kits.color_aqua"), code: "§b" },
  { label: t("jm_at.kits.color_red"), code: "§c" },
  { label: t("jm_at.kits.color_light_purple"), code: "§d" },
  { label: t("jm_at.kits.color_yellow"), code: "§e" },
  { label: t("jm_at.kits.color_white"), code: "§f" },
  { label: t("jm_at.kits.color_minecoin_gold"), code: "§g" },
  { label: t("jm_at.kits.color_material_quartz"), code: "§h" },
  { label: t("jm_at.kits.color_material_iron"), code: "§i" },
  { label: t("jm_at.kits.color_material_netherite"), code: "§j" },
  { label: t("jm_at.kits.color_material_redstone"), code: "§m" },
  { label: t("jm_at.kits.color_material_copper"), code: "§n" },
  { label: t("jm_at.kits.color_material_gold"), code: "§p" },
  { label: t("jm_at.kits.color_material_emerald"), code: "§q" },
  { label: t("jm_at.kits.color_material_diamond"), code: "§s" },
  { label: t("jm_at.kits.color_material_lapis"), code: "§t" },
  { label: t("jm_at.kits.color_material_amethyst"), code: "§u" },
  { label: t("jm_at.kits.color_material_resin"), code: "§v" },
];

// Stored kit icon paths; ActionForm shows the textures.
const DEFAULT_KIT_ICON = "textures/ui/jm_at_kit";
// lang-keys: jm_at.kits.icon_*
const KIT_ICONS = [
  { path: "textures/ui/jm_at_kit", label: t("jm_at.kits.icon_default") },
  {
    path: "textures/ui/jm_at_kit_wood_sword",
    label: t("jm_at.kits.icon_wood_sword"),
  },
  {
    path: "textures/ui/jm_at_kit_wood_pick",
    label: t("jm_at.kits.icon_wood_pickaxe"),
  },
  {
    path: "textures/ui/jm_at_kit_leather_tunic",
    label: t("jm_at.kits.icon_leather_tunic"),
  },
  {
    path: "textures/ui/jm_at_kit_iron_sword",
    label: t("jm_at.kits.icon_iron_sword"),
  },
  {
    path: "textures/ui/jm_at_kit_iron_pick",
    label: t("jm_at.kits.icon_iron_pickaxe"),
  },
  {
    path: "textures/ui/jm_at_kit_iron_chestplate",
    label: t("jm_at.kits.icon_iron_chestplate"),
  },
  {
    path: "textures/ui/jm_at_kit_diamond_sword",
    label: t("jm_at.kits.icon_diamond_sword"),
  },
  {
    path: "textures/ui/jm_at_kit_diamond_pick",
    label: t("jm_at.kits.icon_diamond_pickaxe"),
  },
  {
    path: "textures/ui/jm_at_kit_diamond_chestplate",
    label: t("jm_at.kits.icon_diamond_chestplate"),
  },
  { path: "textures/ui/jm_at_kit_bread", label: t("jm_at.kits.icon_bread") },
  { path: "textures/ui/jm_at_kit_white", label: t("jm_at.kits.icon_white") },
  {
    path: "textures/ui/jm_at_kit_light_gray",
    label: t("jm_at.kits.icon_light_gray"),
  },
  { path: "textures/ui/jm_at_kit_gray", label: t("jm_at.kits.icon_gray") },
  { path: "textures/ui/jm_at_kit_black", label: t("jm_at.kits.icon_black") },
  { path: "textures/ui/jm_at_kit_brown", label: t("jm_at.kits.icon_brown") },
  { path: "textures/ui/jm_at_kit_red", label: t("jm_at.kits.icon_red") },
  { path: "textures/ui/jm_at_kit_orange", label: t("jm_at.kits.icon_orange") },
  { path: "textures/ui/jm_at_kit_yellow", label: t("jm_at.kits.icon_yellow") },
  { path: "textures/ui/jm_at_kit_lime", label: t("jm_at.kits.icon_lime") },
  { path: "textures/ui/jm_at_kit_green", label: t("jm_at.kits.icon_green") },
  { path: "textures/ui/jm_at_kit_cyan", label: t("jm_at.kits.icon_cyan") },
  {
    path: "textures/ui/jm_at_kit_light_blue",
    label: t("jm_at.kits.icon_light_blue"),
  },
  { path: "textures/ui/jm_at_kit_blue", label: t("jm_at.kits.icon_blue") },
  { path: "textures/ui/jm_at_kit_purple", label: t("jm_at.kits.icon_purple") },
  {
    path: "textures/ui/jm_at_kit_magenta",
    label: t("jm_at.kits.icon_magenta"),
  },
  { path: "textures/ui/jm_at_kit_pink", label: t("jm_at.kits.icon_pink") },
];

/** Stored icon path, with default fallback. */
function kitIcon(kit) {
  return kit?.icon || DEFAULT_KIT_ICON;
}

/** Remaining time, up to two units. */
function fmtRemaining(sec) {
  sec = Math.max(0, Math.floor(sec));
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const parts = [];
  if (d) parts.push(`${d}天`);
  if (h) parts.push(`${h}小时`);
  if (m) parts.push(`${m}分钟`);
  if (!d && !h && (s || !m)) parts.push(`${s}秒`); // Seconds under an hour.
  return parts.join(" ") || "0秒";
}

// Scoreboard timestamps are int32 epoch seconds; keep cooldowns well under the cap.
const MAX_COOLDOWN_SEC = 3650 * 86400; // ~10 years

/** Parse duration tokens like "30m", "6h", "1d", or "1d6h30m". */
function parseCooldownSec(str) {
  const s = String(str ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  if (!s) return -1;
  // Whole string must be <digits><unit> tokens only.
  if (!/^(\d+[dhms])+$/.test(s)) return -1;
  const mult = { d: 86400, h: 3600, m: 60, s: 1 };
  let total = 0;
  const re = /(\d+)([dhms])/g;
  let m;
  while ((m = re.exec(s))) {
    total += parseInt(m[1], 10) * mult[m[2]];
    if (total >= MAX_COOLDOWN_SEC) return MAX_COOLDOWN_SEC; // Clamp before overflow.
  }
  return total > 0 ? total : -1;
}

/** Parse max total claims. Blank/0 means unlimited. */
function parseMaxClaims(str) {
  const s = String(str ?? "").trim();
  if (!s) return 0;
  if (!/^\d+$/.test(s)) return null;
  return Math.min(parseInt(s, 10), 9999);
}

/** True when kits are enabled. */
function kitsActive() {
  return FEATURES.kits === true && getCfg().kitsEnabled !== false;
}

function canManageKits(player) {
  return modCan(player, "kits");
}

/** Plain-string display name — ONLY for ObservableString surfaces (fail()
 *  validation lists), which cannot hold RawMessage. */
function itemDisplayName(it) {
  try {
    if (it.nameTag) return it.nameTag.replace(/§./g, "");
  } catch {}
  const base = String(it.typeId)
    .replace(/^[^:]*:/, "")
    .replace(/_/g, " ");
  return base.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Localized RawMessage name for a live OR serialized kit item: a player-given
 *  nameTag wins (codes stripped, matching itemDisplayName); otherwise the
 *  typeId resolves to the item's vanilla localization key. */
function itemNameRaw(it) {
  try {
    if (it.nameTag) return { text: it.nameTag.replace(/§./g, "") };
  } catch {}
  return itemName(String(it.typeId));
}

// Fixed "Who can claim" tiers before custom rank tags.
// lang-keys: jm_at.kits.rank_*
const KIT_RANK_TIER_LABELS = [
  t("jm_at.kits.rank_everyone"),
  t("jm_at.kits.rank_staff_only"),
  t("jm_at.kits.rank_admins_only"),
  t("jm_at.kits.rank_mods_only"),
];
const KIT_RANK_TIER_VALUES = ["", "staff", "admins", "mods"];

/** Build "Who can claim" dropdown options. */
function kitRankOptions(rankTags) {
  return [...KIT_RANK_TIER_LABELS, ...rankTags];
}

/** Map "Who can claim" index to stored kit.rank. */
function kitRankFromIndex(rankIdx, rankTags) {
  return rankIdx < KIT_RANK_TIER_VALUES.length
    ? KIT_RANK_TIER_VALUES[rankIdx]
    : (rankTags[rankIdx - KIT_RANK_TIER_VALUES.length] ?? "");
}

/** Map stored kit.rank back to a dropdown index. */
function kitRankToIndex(rank, rankTags) {
  if (!rank) return 0;
  const tierIdx = KIT_RANK_TIER_VALUES.indexOf(rank);
  if (tierIdx > 0) return tierIdx;
  const i = rankTags.indexOf(rank);
  return i >= 0 ? KIT_RANK_TIER_VALUES.length + i : 0;
}

/** Label for a kit's rank requirement (RawMessage for tiers, string for tags). */
function rankLabel(rank) {
  if (!rank) return KIT_RANK_TIER_LABELS[0];
  const tierIdx = KIT_RANK_TIER_VALUES.indexOf(rank);
  if (tierIdx > 0) return KIT_RANK_TIER_LABELS[tierIdx];
  return rank.replace(/§./g, "");
}

/** Rank tags available for kit gating. */
function knownRankTags() {
  const tags = new Set();
  try {
    for (const def of Object.values(getRankDb())) {
      const tk = (def?.tag ?? "").trim();
      if (tk) tags.add(tk);
    }
  } catch {}
  try {
    for (const e of Object.values(getPlayerRegistry())) {
      const tk = (e.rankTag ?? "").trim();
      if (tk) tags.add(tk);
    }
  } catch {}
  return [...tags];
}

/** Current playtime-rank ladder, or empty when disabled. */
function playtimeLadder() {
  const cfg = getCfg();
  if (!cfg.playtimeRanksEnabled) return [];
  return Array.isArray(cfg.playtimeRanks) ? cfg.playtimeRanks : [];
}

/** Display label for a kit's playtime gate. */
function kitPlaytimeLabel(kit) {
  const min = kitMinPlaytimeMin(kit);
  if (min <= 0) return null;
  if (kit.minPlaytimeRank)
    return `${String(kit.minPlaytimeRank).replace(/§./g, "")} (${fmtRemaining(min * 60)})`;
  return fmtRemaining(min * 60);
}

// =========================================================
// Player: kit list + claim
// =========================================================

/** Locked gated kits are hidden unless staff chose "show locked". */
function kitHidden(kit) {
  return kit?.hidden !== false;
}

/** True when visibility settings can hide this kit. */
function kitIsGated(kit) {
  return !!kit?.rank || kitMinPlaytimeMin(kit) > 0;
}

/** Decide whether a claimable kit appears in the player's list. */
function kitListVisible(player, kit, chk) {
  if (chk.ok) return true;
  if (chk.reason === "rank" || chk.reason === "playtime")
    return !kitHidden(kit);
  return true; // Cooldown/once means qualified, just not claimable now.
}

/** Player Tool kit list for claiming only. */
export async function openPlayerKits(player, backFn) {
  const back = () => backFn?.(player);
  if (!kitsActive()) {
    tell(player, t("jm_at.kits.disabled"));
    return back();
  }
  const kits = getKits();
  const actions = [];

  for (const name of getSortedKitNames(kits)) {
    const kit = kits[name];
    if (kit.type !== KIT_TYPES.CLAIMABLE) continue;
    const chk = canClaimKit(player, kit);
    if (!kitListVisible(player, kit, chk)) continue;

    let status = t("jm_at.kits.status_available");
    if (!chk.ok) {
      if (chk.reason === "once")
        status = t("jm_at.kits.status_already_claimed");
      else if (chk.reason === "limit")
        status = t("jm_at.kits.status_limit_reached");
      else if (chk.reason === "cooldown")
        status = t("jm_at.kits.status_on_cooldown", fmtRemaining(chk.waitSec));
      else if (chk.reason === "playtime") {
        const req = kitPlaytimeLabel(kit);
        const have = fmtRemaining(Math.floor((chk.haveMin ?? 0) * 60));
        status = req
          ? t("jm_at.kits.status_unlocks_at", req, have)
          : t("jm_at.kits.status_unlocks_more", have);
      }
      else if (chk.reason === "rank")
        status = t("jm_at.kits.status_requires", rankLabel(kit.rank));
      else status = t("jm_at.kits.status_locked");
    }
    const star = kit.pinned ? "§e★ " : "";
    actions.push({
      label: raw(star, "§l", name, "§r\n", status),
      icon: kitIcon(kit),
      fn: () => showKitClaim(player, name, backFn),
    });
  }

  const claimableCount = actions.length;

  actions.push({
    label: t("jm_at.kits.btn_kit_info"),
    icon: "textures/ui/jm_at_player_info",
    fn: () => showKitsInfo(player, backFn),
  });

  const form = new ActionFormData()
    .title(t("jm_at.kits.title_kits"))
    .body(
      claimableCount
        ? t("jm_at.kits.body_claim_below")
        : t("jm_at.kits.body_none_available"),
    );
  for (const a of actions) form.button(a.label, a.icon);
  form.button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back");
  form.button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return back(); // X = Back
  if (res.selection === actions.length) return back(); // Back
  if (res.selection === actions.length + 1) return; // Close
  return actions[res.selection].fn();
}

/** Staff Kit Tool entry point. */
export async function openKitManager(player) {
  if (!kitsActive()) {
    tell(player, t("jm_at.kits.disabled"));
    return;
  }
  if (!canManageKits(player)) {
    tell(player, t("jm_at.kits.editor_staff_only"));
    return;
  }
  return showManageKits(player);
}

async function showKitsInfo(player, backFn) {
  const form = new ActionFormData()
    .title(t("jm_at.kits.title_how_kits_work"))
    .body(t("jm_at.kits.info_player_body"))
    .button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back")
    .button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return openPlayerKits(player, backFn); // X = Back
  if (res.selection === 1) return; // Close
  return openPlayerKits(player, backFn); // Back
}

async function showMakingKitsInfo(player) {
  const form = new ActionFormData()
    .title(t("jm_at.kits.title_making_kits"))
    .body(
      t(
        "jm_at.kits.info_staff_body",
        LIMITS.MAX_KITS,
        LIMITS.MAX_KIT_ITEMS,
        LIMITS.MAX_KIT_ITEM_AMOUNT,
      ),
    )
    .button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back")
    .button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showManageKits(player); // X = Back
  if (res.selection === 1) return; // Close
  return showManageKits(player); // Back
}

async function showKitClaim(player, name, backFn) {
  const kits = getKits();
  const kit = kits[name];
  if (!kit) return openPlayerKits(player, backFn);

  const kitItems = kit.items ?? [];
  const lines = raw(
    ...kitItems.flatMap((it, i) => {
      const row = raw(
        `§7• §f${it.amount}× `,
        itemNameRaw(it),
        isLossyType(it.typeId) ? " §e⚠" : "",
      );
      return i ? ["\n", row] : [row];
    }),
  );
  const chk = canClaimKit(player, kit);
  let statusLine;
  if (chk.ok) statusLine = t("jm_at.kits.claim_status_ready");
  else if (chk.reason === "once")
    statusLine = t("jm_at.kits.claim_status_once");
  else if (chk.reason === "limit")
    statusLine = t("jm_at.kits.claim_status_limit", chk.max);
  else if (chk.reason === "cooldown")
    statusLine = t("jm_at.kits.claim_status_cooldown", fmtRemaining(chk.waitSec));
  else if (chk.reason === "playtime") {
    const req = kitPlaytimeLabel(kit);
    const have = fmtRemaining(Math.floor((chk.haveMin ?? 0) * 60));
    statusLine = req
      ? t("jm_at.kits.claim_status_playtime", req, have)
      : t("jm_at.kits.claim_status_playtime_more", have);
  }
  else if (chk.reason === "rank")
    statusLine = t("jm_at.kits.status_requires", rankLabel(kit.rank));
  else statusLine = t("jm_at.kits.claim_status_blocked");

  const body = raw(
    statusLine,
    "\n\n",
    t("jm_at.kits.contents_header"),
    "\n",
    kitItems.length ? lines : t("jm_at.kits.contents_empty"),
  );

  const form = new ActionFormData().title(name).body(body);
  if (chk.ok)
    form.button(t("jm_at.kits.btn_claim_kit"), "textures/ui/jm_at_kit_test");
  form.button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back");
  form.button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return openPlayerKits(player, backFn);

  if (chk.ok && res.selection === 0) return attemptClaim(player, name, backFn);
  const backIdx = chk.ok ? 1 : 0;
  if (res.selection === backIdx) return openPlayerKits(player, backFn);
  return; // Close
}

/** On-screen + audio confirmation that a claim succeeded. */
function claimSuccessFeedback(player, name, dropped) {
  try {
    player.playSound("random.levelup");
  } catch {}
  try {
    showTimedTitle(player, t("jm_at.kits.kit_claimed_title"), {
      subtitle: name,
      fadeInDuration: 5,
      stayDuration: 30,
      fadeOutDuration: 10,
    });
  } catch {}
  tell(
    player,
    raw(
      t("jm_at.kits.claimed", name),
      dropped > 0 ? t("jm_at.kits.claimed_dropped_suffix", dropped) : "",
    ),
  );
}

/** Re-check claim rules and inventory room before committing a claim. */
async function attemptClaim(player, name, backFn) {
  const kit = getKits()[name];
  if (!kit) return openPlayerKits(player, backFn);

  const chk = canClaimKit(player, kit);
  if (!chk.ok) {
    return warnForm(player, t("jm_at.kits.cant_claim_now"), () =>
      openPlayerKits(player, backFn),
    );
  }

  const room = kitRoomCheck(player, kit);
  if (!room.ok) {
    return warnForm(
      player,
      t("jm_at.kits.no_room_try_again", room.needed, room.free),
      () => showKitClaim(player, name, backFn),
    );
  }

  if (kit.onceOnly) {
    const confirm = await new MessageFormData()
      .title(t("jm_at.kits.title_claim_once"))
      .body(t("jm_at.kits.claim_once_body", name))
      .button1(t("jm_at.kits.btn_claim"))
      .button2(t("jm_at.kits.btn_cancel"))
      .show(player);
    if (confirm.canceled || confirm.selection === 1)
      return showKitClaim(player, name, backFn);
  }

  const result = claimKit(player, kit);
  if (result.ok) {
    claimSuccessFeedback(player, name, result.dropped);
  } else if (result.reason === "full") {
    return warnForm(
      player,
      t("jm_at.kits.no_room", result.needed, result.free),
      () => showKitClaim(player, name, backFn),
    );
  } else if (result.reason === "empty") {
    return warnForm(player, t("jm_at.kits.kit_empty"), () =>
      openPlayerKits(player, backFn),
    );
  } else {
    return warnForm(player, t("jm_at.kits.claim_failed"), () =>
      openPlayerKits(player, backFn),
    );
  }
  return openPlayerKits(player, backFn);
}

// =========================================================
// Staff: manage kits
// =========================================================

async function showManageKits(player) {
  if (!canManageKits(player)) {
    tell(player, t("jm_at.kits.no_permission"));
    return;
  }
  const kits = getKits();
  const names = getSortedKitNames(kits);

  const actions = [];
  actions.push({
    label: t("jm_at.kits.btn_create", names.length, LIMITS.MAX_KITS),
    icon: "textures/ui/jm_at_add",
    fn: () => startCreateKit(player),
  });
  for (const name of names) {
    const kit = kits[name];
    const typeLabel =
      kit.type === KIT_TYPES.STARTER
        ? t("jm_at.kits.type_starter")
        : t("jm_at.kits.type_claimable");
    // Flag gated kits hidden from players until unlocked.
    const hiddenTag =
      kit.type === KIT_TYPES.CLAIMABLE && kitIsGated(kit) && kitHidden(kit)
        ? t("jm_at.kits.tag_hidden")
        : "";
    const star = kit.pinned ? "§e★ " : "";
    actions.push({
      label: raw(
        star,
        "§l",
        name,
        t("jm_at.kits.manage_kit_sub", typeLabel, (kit.items ?? []).length),
        hiddenTag,
      ),
      icon: kitIcon(kit),
      fn: () => showManageKitDetail(player, name),
    });
  }
  actions.push({
    label: t("jm_at.kits.btn_staff_kit_info"),
    icon: "textures/ui/jm_at_player_info",
    fn: () => showMakingKitsInfo(player),
  });

  const form = new ActionFormData()
    .title(t("jm_at.kits.title_kit_editor"))
    .body(t("jm_at.kits.body_manage"));
  for (const a of actions) form.button(a.label, a.icon);
  form.button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return; // X = Close; Kit Editor is a root menu.
  if (res.selection === actions.length) return; // Close
  return actions[res.selection].fn();
}

async function showManageKitDetail(player, name) {
  const kits = getKits();
  const kit = kits[name];
  if (!kit) return showManageKits(player);

  const kitItems = kit.items ?? [];
  const items = raw(
    ...kitItems.flatMap((it, i) => {
      const row = raw(
        `§7• §f${it.amount}× `,
        itemNameRaw(it),
        isLossyType(it.typeId) ? " §e⚠" : "",
      );
      return i ? ["\n", row] : [row];
    }),
  );
  const capSuffix =
    kit.type === KIT_TYPES.CLAIMABLE &&
    !kit.onceOnly &&
    (kit.maxClaims || 0) > 0
      ? t("jm_at.kits.sched_cap_suffix", kit.maxClaims)
      : "";
  const sched =
    kit.type === KIT_TYPES.STARTER
      ? raw(
          t("jm_at.kits.type_starter_auto"),
          kit.regiveExisting ? t("jm_at.kits.sched_backfill_suffix") : "",
        )
      : kit.onceOnly
        ? t("jm_at.kits.sched_once")
        : t(
            "jm_at.kits.sched_every",
            fmtRemaining(kit.cooldownSec || 0),
            capSuffix,
          );

  const ptLabel = kitPlaytimeLabel(kit);
  // Visibility only matters for gated claimable kits.
  const visLine =
    kit.type === KIT_TYPES.CLAIMABLE && kitIsGated(kit)
      ? t(
          "jm_at.kits.detail_visibility",
          kitHidden(kit)
            ? t("jm_at.kits.vis_hidden")
            : t("jm_at.kits.vis_show_locked"),
        )
      : "";
  const body = raw(
    t("jm_at.kits.detail_type", sched),
    kit.pinned ? t("jm_at.kits.detail_featured") : "",
    t("jm_at.kits.detail_who", rankLabel(kit.rank)),
    ptLabel ? t("jm_at.kits.detail_min_playtime", ptLabel) : "",
    visLine,
    t(
      "jm_at.kits.detail_created_by",
      kit.createdBy ?? t("jm_at.kits.unknown_creator"),
    ),
    t("jm_at.kits.contents_header"),
    "\n",
    kitItems.length ? items : t("jm_at.kits.contents_empty"),
  );

  const actions = [
    {
      label: t("jm_at.kits.btn_test_claim"),
      icon: "textures/ui/jm_at_kit_test",
      fn: () => testClaimKit(player, name),
    },
    {
      label: t("jm_at.kits.btn_give_player"),
      icon: "textures/ui/jm_at_kit",
      fn: () => showGiveKitPlayer(player, name),
    },
    {
      label: t("jm_at.kits.btn_edit_settings"),
      icon: "textures/ui/jm_at_control_panel",
      fn: () => editKitSettings(player, name),
    },
    {
      label: t("jm_at.kits.btn_edit_items"),
      icon: "textures/ui/jm_at_inventory",
      fn: () => editKitItems(player, name),
    },
    {
      label: t("jm_at.kits.btn_change_icon"),
      icon: kitIcon(kit),
      fn: () => changeKitIcon(player, name),
    },
    {
      label: kit.pinned ? t("jm_at.kits.btn_unpin") : t("jm_at.kits.btn_pin"),
      icon: "textures/ui/jm_at_pin",
      fn: () => togglePinKit(player, name),
    },
    {
      label: t("jm_at.kits.btn_reset_claims"),
      icon: "textures/ui/jm_at_reset",
      fn: () => showResetKitMenu(player, name),
    },
    {
      label: t("jm_at.kits.btn_give_command"),
      icon: "textures/ui/jm_at_commands",
      fn: () => showKitAutomation(player, name),
    },
    {
      label: t("jm_at.kits.btn_delete_kit"),
      icon: "textures/ui/jm_at_remove",
      fn: () => confirmDeleteKit(player, name),
    },
  ];

  const form = new ActionFormData().title(name).body(body);
  for (const a of actions) form.button(a.label, a.icon);
  form.button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back");
  form.button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showManageKits(player);
  if (res.selection === actions.length) return showManageKits(player); // Back
  if (res.selection === actions.length + 1) return; // Close
  return actions[res.selection].fn();
}

/** Show script-event commands for NPCs and command blocks. */
async function showKitAutomation(player, name) {
  const kit = getKits()[name];
  if (!kit) return showManageKits(player);
  const plain = name.replace(/§./g, "");
  const idRef = `#${kit.id}`;
  const form = new ActionFormData()
    .title(t("jm_at.kits.title_give_command"))
    .body(t("jm_at.kits.automation_body", plain, idRef))
    .button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back")
    .button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);
  const res = await form.show(player);
  if (res.canceled) return showManageKitDetail(player, name); // X = Back
  if (res.selection === 0) return showManageKitDetail(player, name);
  return; // Close
}

/** Change a kit's menu icon. */
async function changeKitIcon(player, name) {
  const kit = getKits()[name];
  if (!kit) return showManageKits(player);
  const current = kitIcon(kit);
  const currentIdx = Math.max(
    0,
    KIT_ICONS.findIndex((ic) => ic.path === current),
  );
  const form = new ActionFormData()
    .title(t("jm_at.kits.title_change_icon"))
    .body(t("jm_at.kits.change_icon_body", name));
  for (let i = 0; i < KIT_ICONS.length; i++) {
    const ic = KIT_ICONS[i];
    form.button(
      i === currentIdx ? t("jm_at.kits.icon_current", ic.label) : ic.label,
      ic.path,
    );
  }
  const res = await form.show(player);
  if (res.canceled) return showManageKitDetail(player, name);
  const icon = KIT_ICONS[res.selection]?.path ?? DEFAULT_KIT_ICON;
  updateKit(name, { ...kit, icon });
  tell(player, t("jm_at.kits.icon_updated", name));
  return showManageKitDetail(player, name);
}

/** Give this kit to staff immediately without touching claim state. */
function testClaimKit(player, name) {
  const kit = getKits()[name];
  if (!kit) return showManageKits(player);
  const room = kitRoomCheck(player, kit);
  if (!room.ok) {
    return warnForm(
      player,
      t("jm_at.kits.make_room", room.needed, room.free),
      () => showManageKitDetail(player, name),
    );
  }
  const { dropped } = giveKit(player, kit);
  tell(
    player,
    raw(
      t("jm_at.kits.test_claim_done", name),
      dropped > 0 ? t("jm_at.kits.test_claim_dropped_suffix", dropped) : "",
    ),
  );
  return showManageKitDetail(player, name);
}

/** Clear one player's claim state for this kit. */
async function showResetKitPlayer(player, name) {
  const kit = getKits()[name];
  if (!kit) return showManageKits(player);
  const reg = getPlayerRegistry();
  const entries = Object.values(reg)
    .filter((e) => e.name)
    .sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0));
  if (entries.length === 0) {
    tell(player, t("jm_at.kits.no_players_to_reset"));
    return showManageKitDetail(player, name);
  }
  const items = entries.map((e, i) => ({ label: e.name, value: i }));
  const typedObs = new ObservableString("", { clientWritable: true });
  const pickObs = new ObservableNumber(0, { clientWritable: true });
  const status = new ObservableString("");
  const statusShown = new ObservableBoolean(false);
  let pendingNav = null;
  const fail = (m) => {
    status.setData(m);
    statusShown.setData(true);
  };

  const form = new CustomForm(player, t("jm_at.kits.title_reset", name));
  form.textField(t("jm_at.kits.field_type_player"), typedObs);
  form.dropdown(t("jm_at.kits.field_pick_player"), pickObs, items);
  form.spacer();
  form.label(status, { visible: statusShown });
  form.spacer({ visible: statusShown });
  form.button(t("jm_at.kits.btn_reset"), () => {
    const typed = clampText(typedObs.getData().trim(), 50);
    let target;
    if (typed) {
      target = entries.find(
        (e) => e.name.toLowerCase() === typed.toLowerCase(),
      );
      if (!target) {
        fail(`§c找不到与“${typed}”匹配的已记录玩家。`);
        return;
      }
    } else {
      target = entries[pickObs.getData()] ?? entries[0];
    }
    pendingNav = () => {
      resetKitClaim(kit, target.xuid);
      tell(player, t("jm_at.kits.reset_player_done", target.name, name));
      return showManageKitDetail(player, name);
    };
    try {
      form.close();
    } catch {}
  });
  form.button(t("jm_at.common.btn_back"), () => {
    pendingNav = () => showManageKitDetail(player, name);
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(() => showResetKitPlayer(player, name));
  }
  if (pendingNav) return system.run(pendingNav);
  return; // Engine close (✕ / bottom Close) or escape → exit to game.
}

async function confirmDeleteKit(player, name) {
  const form = new MessageFormData()
    .title(t("jm_at.kits.title_delete_kit"))
    .body(t("jm_at.kits.delete_confirm_body", name))
    .button1(t("jm_at.kits.btn_delete_red"))
    .button2(t("jm_at.kits.btn_cancel"));
  const res = await form.show(player);
  if (res.canceled || res.selection === 1)
    return showManageKitDetail(player, name);
  removeKit(name);
  tell(player, t("jm_at.kits.deleted", name));
  return showManageKits(player);
}

/** Toggle whether this kit is pinned to the top. */
function togglePinKit(player, name) {
  const kit = getKits()[name];
  if (!kit) return showManageKits(player);
  const nowPinned = !kit.pinned;
  updateKit(name, { ...kit, pinned: nowPinned });
  tell(
    player,
    nowPinned
      ? t("jm_at.kits.pinned_msg", name)
      : t("jm_at.kits.unpinned_msg", name),
  );
  return showManageKitDetail(player, name);
}

/** Give this kit to an online player without touching claim state. */
async function showGiveKitPlayer(player, name) {
  const kit = getKits()[name];
  if (!kit) return showManageKits(player);
  const players = world.getPlayers();
  if (players.length === 0) {
    tell(player, t("jm_at.kits.no_players_online"));
    return showManageKitDetail(player, name);
  }
  const form = new ActionFormData()
    .title(t("jm_at.kits.title_give", name))
    .body(t("jm_at.kits.give_body"));
  for (const p of players) form.button(`§l§g${p.name}`);
  form.button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back");
  form.button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showManageKitDetail(player, name);
  if (res.selection === players.length)
    return showManageKitDetail(player, name);
  if (res.selection === players.length + 1) return; // Close

  const target = players[res.selection];
  if (!target?.isValid) {
    return warnForm(player, t("jm_at.kits.player_offline"), () =>
      showManageKitDetail(player, name),
    );
  }
  const { dropped } = giveKit(target, kit);
  tell(
    player,
    raw(
      t("jm_at.kits.gave", name, target.name),
      dropped > 0 ? t("jm_at.kits.gave_dropped_suffix", dropped) : "",
    ),
  );
  tell(
    target,
    raw(
      t("jm_at.kits.received_from_staff", name),
      dropped > 0 ? t("jm_at.kits.received_dropped_suffix") : "",
    ),
  );
  return showManageKitDetail(player, name);
}

/** Re-pick kit contents from staff inventory, keeping settings. */
async function editKitItems(player, name) {
  const kit = getKits()[name];
  if (!kit) return showManageKits(player);
  return pickKitItems(
    player,
    name,
    kit.icon ?? DEFAULT_KIT_ICON,
    finishEditItems,
  );
}

/** Save re-picked kit items and keep every other field. */
async function finishEditItems(player, name, icon, chosen, amounts) {
  const kit = getKits()[name];
  if (!kit) return showManageKits(player);
  const items = chosen.map((it, i) => serializeItemStack(it, amounts[i]));
  const lossyNames = chosen
    .filter((it) => isLossyType(it.typeId))
    .map((it) => itemNameRaw(it));

  if (lossyNames.length > 0) {
    const list = raw(
      ...lossyNames.flatMap((n, i) => (i ? ["\n§7• §f", n] : ["§7• §f", n])),
    );
    const res = await new MessageFormData()
      .title(t("jm_at.kits.title_lossy"))
      .body(t("jm_at.kits.lossy_edit_body", list))
      .button1(t("jm_at.kits.btn_save_anyway"))
      .button2(t("jm_at.kits.btn_cancel"))
      .show(player);
    if (res.canceled || res.selection === 1)
      return showManageKitDetail(player, name);
  }

  if (!updateKit(name, { ...kit, items })) {
    return warnForm(player, t("jm_at.kits.items_save_failed", name), () =>
      showManageKitDetail(player, name),
    );
  }
  tell(player, t("jm_at.kits.items_updated", name));
  return showManageKitDetail(player, name);
}

/** Reset claim history for one player or everyone. */
async function showResetKitMenu(player, name) {
  const kit = getKits()[name];
  if (!kit) return showManageKits(player);
  const form = new ActionFormData()
    .title(t("jm_at.kits.title_reset_claims", name))
    .body(t("jm_at.kits.reset_menu_body"))
    .button(t("jm_at.kits.btn_reset_player"), "textures/ui/jm_at_reset")
    .button(t("jm_at.kits.btn_reset_everyone"), "textures/ui/jm_at_reset")
    .button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back")
    .button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showManageKitDetail(player, name);
  if (res.selection === 0) return showResetKitPlayer(player, name);
  if (res.selection === 1) return confirmResetAllKit(player, name);
  if (res.selection === 2) return showManageKitDetail(player, name);
  return; // Close
}

async function confirmResetAllKit(player, name) {
  const kit = getKits()[name];
  if (!kit) return showManageKits(player);
  const res = await new MessageFormData()
    .title(t("jm_at.kits.title_reset_everyone"))
    .body(t("jm_at.kits.reset_all_body", name))
    .button1(t("jm_at.kits.btn_reset_everyone_red"))
    .button2(t("jm_at.kits.btn_cancel"))
    .show(player);
  if (res.canceled || res.selection === 1)
    return showResetKitMenu(player, name);
  resetAllKitClaims(kit);
  tell(player, t("jm_at.kits.reset_all_done", name));
  return showManageKitDetail(player, name);
}

// =========================================================
// Staff: create kit
// =========================================================

async function startCreateKit(player) {
  if (!canManageKits(player)) return;
  if (Object.keys(getKits()).length >= LIMITS.MAX_KITS) {
    return warnForm(
      player,
      t("jm_at.kits.kit_limit_reached", LIMITS.MAX_KITS),
      () => showManageKits(player),
    );
  }
  // Pick icon first because DDUI buttons cannot show texture icons.
  return chooseKitIcon(player);
}

/** Icon picker; each button shows the texture. */
async function chooseKitIcon(player) {
  const form = new ActionFormData()
    .title(t("jm_at.kits.title_choose_icon"))
    .body(t("jm_at.kits.choose_icon_body"));
  for (const ic of KIT_ICONS) form.button(ic.label, ic.path);
  const res = await form.show(player);
  if (res.canceled) return showManageKits(player);
  const icon = KIT_ICONS[res.selection]?.path ?? DEFAULT_KIT_ICON;
  return showCreateKitForm(player, icon);
}

async function pickKitItems(player, name, icon, finish) {
  const inv = player.getComponent("minecraft:inventory")?.container;
  const slots = [];
  if (inv) {
    for (let i = 0; i < inv.size && slots.length < LIMITS.MAX_KIT_ITEMS; i++) {
      const it = inv.getItem(i);
      if (it) slots.push(it.clone());
    }
  }
  if (slots.length === 0) {
    return warnForm(player, t("jm_at.kits.inv_empty"), () =>
      showManageKits(player),
    );
  }

  const form = new ModalFormData().title(t("jm_at.kits.title_pick_items", name));
  for (const it of slots) {
    const lossy = isLossyType(it.typeId) ? " §e⚠" : "";
    form.toggle(raw(itemNameRaw(it), ` ×${it.amount}${lossy}`), {
      defaultValue: false,
    });
  }
  const res = await form.show(player);
  if (res.canceled) return showManageKits(player);

  const chosen = [];
  for (let i = 0; i < slots.length; i++) {
    if (res.formValues[i]) chosen.push(slots[i]);
  }
  if (chosen.length === 0) {
    return warnForm(player, t("jm_at.kits.pick_one_item"), () =>
      showManageKits(player),
    );
  }
  return setKitAmounts(player, name, icon, chosen, undefined, finish);
}

async function setKitAmounts(player, name, icon, chosen, prev, finish) {
  const amountObs = chosen.map(
    (it, i) =>
      new ObservableString(prev?.[i] ?? String(it.amount), {
        clientWritable: true,
      }),
  );
  const status = new ObservableString("");
  const statusShown = new ObservableBoolean(false);
  let pendingNav = null;
  const fail = (m) => {
    status.setData(m);
    statusShown.setData(true);
  };

  const form = new CustomForm(player, t("jm_at.kits.title_amounts", name));
  for (let i = 0; i < chosen.length; i++) {
    form.textField(
      t("jm_at.kits.amount_label", itemNameRaw(chosen[i])),
      amountObs[i],
      {
        description: t(
          "jm_at.kits.amount_desc",
          chosen[i].amount,
          LIMITS.MAX_KIT_ITEM_AMOUNT,
        ),
      },
    );
  }
  form.spacer();
  form.label(status, { visible: statusShown });
  form.spacer({ visible: statusShown });
  form.button(t("jm_at.common.btn_save"), () => {
    const rawVals = amountObs.map((o) => o.getData().trim());
    const bad = chosen
      .filter(
        (_, i) => !/^\d+$/.test(rawVals[i]) || parseInt(rawVals[i], 10) < 1,
      )
      .map((it) => itemDisplayName(it));
    if (bad.length) {
      fail(`§c请为以下物品输入不小于1的整数：§f${bad.join(", ")}§c。`);
      return;
    }
    const amounts = rawVals.map((s) => parseInt(s, 10));
    const total = amounts.reduce((a, b) => a + b, 0);
    if (total > LIMITS.MAX_KIT_ITEM_AMOUNT) {
      fail(
        `§c礼包物品总数为 ${total}/${LIMITS.MAX_KIT_ITEM_AMOUNT}，请减少数量后保存。`,
      );
      return;
    }
    pendingNav = () =>
      finish
        ? finish(player, name, icon, chosen, amounts)
        : showManageKits(player);
    try {
      form.close();
    } catch {}
  });
  form.button(t("jm_at.common.btn_back"), () => {
    pendingNav = () => showManageKits(player);
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(() =>
      setKitAmounts(
        player,
        name,
        icon,
        chosen,
        amountObs.map((o) => o.getData()),
        finish,
      ),
    );
  }
  if (pendingNav) return system.run(pendingNav);
  return; // Engine close (✕ / bottom Close) or escape → exit to game.
}

/**
 * One reactive create form after the icon picker.
 * Item amount fields and kit options reveal as needed.
 */
async function showCreateKitForm(player, icon) {
  const inv = player.getComponent("minecraft:inventory")?.container;
  const slots = [];
  if (inv) {
    for (let i = 0; i < inv.size && slots.length < LIMITS.MAX_KIT_ITEMS; i++) {
      const it = inv.getItem(i);
      if (it) slots.push(it.clone());
    }
  }
  if (slots.length === 0) {
    return warnForm(player, t("jm_at.kits.inv_empty"), () =>
      showManageKits(player),
    );
  }

  const rankTags = knownRankTags();
  const rankOptions = kitRankOptions(rankTags);
  const ladder = playtimeLadder();
  const ptEnabled = getCfg().playtimeRanksEnabled === true;

  // Name and color.
  const colorObs = new ObservableNumber(0, { clientWritable: true });
  const nameObs = new ObservableString("", { clientWritable: true });

  // One toggle per inventory item; amount appears after selection.
  const itemToggles = slots.map(
    () => new ObservableBoolean(false, { clientWritable: true }),
  );
  const itemAmounts = slots.map(
    (it) => new ObservableString(String(it.amount), { clientWritable: true }),
  );
  const amountShown = slots.map(() => new ObservableBoolean(false));
  slots.forEach((_, i) =>
    itemToggles[i].subscribe(() =>
      amountShown[i].setData(itemToggles[i].getData()),
    ),
  );

  // Fresh kit options.
  const typeObs = new ObservableNumber(0, { clientWritable: true });
  const repeatObs = new ObservableBoolean(false, { clientWritable: true });
  const cooldownObs = new ObservableString("1d", { clientWritable: true });
  const maxClaimsObs = new ObservableString("", { clientWritable: true });
  const rankObs = new ObservableNumber(0, { clientWritable: true });
  const regiveObs = new ObservableBoolean(false, { clientWritable: true });
  const ptRankObs = new ObservableNumber(0, { clientWritable: true });
  const ptCustomObs = new ObservableString("", { clientWritable: true });
  const visObs = new ObservableNumber(0, { clientWritable: true });

  const claimableShown = new ObservableBoolean(true);
  const starterShown = new ObservableBoolean(false);
  const repeatShown = new ObservableBoolean(false);
  const status = new ObservableString("");
  const statusShown = new ObservableBoolean(false);

  const recompute = () => {
    const claimable = typeObs.getData() === 0;
    claimableShown.setData(claimable);
    starterShown.setData(!claimable);
    repeatShown.setData(claimable && repeatObs.getData());
    status.setData("");
    statusShown.setData(false);
  };
  recompute();
  typeObs.subscribe(recompute);
  repeatObs.subscribe(recompute);

  // Preview colored names once text is entered.
  const namePreview = new ObservableString("");
  const namePreviewShown = new ObservableBoolean(false);
  const refreshName = () => {
    const code = KIT_COLORS[colorObs.getData()]?.code ?? "";
    const typed = nameObs.getData().trim();
    namePreview.setData(typed ? code + typed + "§r" : "");
    namePreviewShown.setData(typed.length > 0);
  };
  refreshName();
  colorObs.subscribe(refreshName);
  nameObs.subscribe(refreshName);

  const colorItems = KIT_COLORS.map((c, i) => ({
    label: c.label,
    value: i,
  }));
  const typeItems = [
    { label: t("jm_at.kits.type_claimable_menu"), value: 0 },
    { label: t("jm_at.kits.type_starter_auto"), value: 1 },
  ];
  // Fixed tiers are RawMessages; custom rank tags stay literal (user content).
  const rankItems = rankOptions.map((l, i) => ({
    label: typeof l === "string" ? l.replace(/§./g, "") : l,
    value: i,
  }));
  const ptRankItems = [
    t("jm_at.kits.none"),
    ...ladder.map(
      (e) =>
        `${String(e.rankName).replace(/§./g, "")} (${fmtRemaining((e.minutes || 0) * 60)})`,
    ),
  ].map((l, i) => ({ label: l, value: i }));
  const visItems = [
    { label: t("jm_at.kits.vis_hidden"), value: 0 },
    { label: t("jm_at.kits.vis_show_locked_grayed"), value: 1 },
  ];

  let pendingNav = null;
  let intent = null;
  const cancel = () => showManageKits(player);
  const reopen = () => showCreateKitForm(player, icon);
  const snapshot = () =>
    JSON.stringify([
      colorObs.getData(),
      nameObs.getData(),
      itemToggles.map((o) => o.getData()),
      itemAmounts.map((o) => o.getData()),
      typeObs.getData(),
      repeatObs.getData(),
      cooldownObs.getData(),
      maxClaimsObs.getData(),
      rankObs.getData(),
      regiveObs.getData(),
      ptRankObs.getData(),
      ptCustomObs.getData(),
      visObs.getData(),
    ]);
  const initial = snapshot();

  const form = new CustomForm(player, t("jm_at.kits.title_create_kit"));
  form.dropdown(t("jm_at.kits.field_name_color"), colorObs, colorItems);
  form.textField(t("jm_at.kits.field_kit_name"), nameObs, {
    description: t("jm_at.kits.field_kit_name_desc"),
  });
  form.spacer({ visible: namePreviewShown });
  form.label(namePreview, { visible: namePreviewShown });
  form.divider({ visible: namePreviewShown });
  form.spacer();
  form.label(t("jm_at.kits.items_section_label"));
  form.spacer();
  slots.forEach((it, i) => {
    const lossy = isLossyType(it.typeId) ? " §e⚠" : "";
    form.toggle(raw(itemNameRaw(it), ` ×${it.amount}${lossy}`), itemToggles[i]);
    form.textField(
      t("jm_at.kits.item_amount_label", itemNameRaw(it)),
      itemAmounts[i],
      { visible: amountShown[i] },
    );
  });
  form.dropdown(t("jm_at.kits.field_kit_type"), typeObs, typeItems);
  form.toggle(t("jm_at.kits.field_repeatable"), repeatObs, {
    visible: claimableShown,
  });
  form.textField(t("jm_at.kits.field_cooldown"), cooldownObs, {
    visible: repeatShown,
    description: t("jm_at.kits.field_cooldown_desc"),
  });
  form.textField(t("jm_at.kits.field_max_claims"), maxClaimsObs, {
    visible: repeatShown,
  });
  form.dropdown(t("jm_at.kits.field_who_can_claim"), rankObs, rankItems);
  form.toggle(t("jm_at.kits.field_regive"), regiveObs, {
    visible: starterShown,
  });
  if (ptEnabled) {
    form.dropdown(t("jm_at.kits.field_pt_rank"), ptRankObs, ptRankItems, {
      visible: claimableShown,
    });
  }
  form.textField(
    ptEnabled
      ? t("jm_at.kits.field_pt_custom_with_rank")
      : t("jm_at.kits.field_pt_custom"),
    ptCustomObs,
    { visible: claimableShown },
  );
  form.dropdown(t("jm_at.kits.field_visibility"), visObs, visItems);
  form.spacer();
  form.label(status, { visible: statusShown });
  form.spacer({ visible: statusShown });

  const fail = (msg) => {
    status.setData(msg);
    statusShown.setData(true);
  };

  const commit = () => {
    // Name.
    const colorCode = KIT_COLORS[colorObs.getData()]?.code ?? "";
    const typed = clampText(nameObs.getData().trim(), LIMITS.KIT_NAME_MAX);
    if (!typed) return fail("§c请输入礼包名称。");
    const dup = Object.keys(getKits()).some(
      (k) => k.replace(/§./g, "").toLowerCase() === typed.toLowerCase(),
    );
    if (dup) return fail(`§c名为“${typed}”的礼包已存在。`);
    const name = colorCode ? `${colorCode}${typed}§r` : typed;

    // Items and amounts.
    const chosenIdx = slots
      .map((_, i) => i)
      .filter((i) => itemToggles[i].getData());
    if (chosenIdx.length === 0) {
      return fail("§c请为礼包选择至少一种物品。");
    }
    const rawAmts = chosenIdx.map((i) => itemAmounts[i].getData().trim());
    const badNames = chosenIdx
      .filter(
        (_, j) => !/^\d+$/.test(rawAmts[j]) || parseInt(rawAmts[j], 10) < 1,
      )
      .map((i) => itemDisplayName(slots[i]));
    if (badNames.length) {
      return fail(
        `§c请为以下物品输入不小于1的整数：§f${badNames.join(", ")}§c。`,
      );
    }
    const amounts = rawAmts.map((s) => parseInt(s, 10));
    const total = amounts.reduce((a, b) => a + b, 0);
    if (total > LIMITS.MAX_KIT_ITEM_AMOUNT) {
      return fail(
        `§c礼包物品总数为 ${total}/${LIMITS.MAX_KIT_ITEM_AMOUNT}，请减少数量后保存。`,
      );
    }
    const chosen = chosenIdx.map((i) => slots[i]);

    // Options.
    const type =
      typeObs.getData() === 1 ? KIT_TYPES.STARTER : KIT_TYPES.CLAIMABLE;
    const rank = kitRankFromIndex(rankObs.getData(), rankTags);
    let onceOnly = true;
    let cooldownSec = 0;
    let maxClaims = 0;
    if (type === KIT_TYPES.CLAIMABLE && repeatObs.getData()) {
      const sec = parseCooldownSec(cooldownObs.getData());
      if (sec <= 0) {
        return fail(
          "§c冷却时间无效，请使用 30m、6h、1d 或 1d6h 等格式。",
        );
      }
      onceOnly = false;
      cooldownSec = sec;
      const mc = parseMaxClaims(maxClaimsObs.getData());
      if (mc === null) {
        return fail(
          "§c最多领取次数必须为整数（留空或0表示不限）。",
        );
      }
      maxClaims = mc;
    }
    let minPlaytimeRank = "";
    let minPlaytimeMin = 0;
    if (type === KIT_TYPES.CLAIMABLE) {
      const ptRankIdx = ptEnabled ? ptRankObs.getData() : 0;
      const ptCustomSec = parseCooldownSec(ptCustomObs.getData());
      if (ptRankIdx > 0 && ladder[ptRankIdx - 1]) {
        minPlaytimeRank = ladder[ptRankIdx - 1].rankName;
        minPlaytimeMin = ladder[ptRankIdx - 1].minutes || 0;
      } else if (ptCustomSec > 0) {
        minPlaytimeMin = Math.round(ptCustomSec / 60);
      }
    }
    const hidden = visObs.getData() !== 1;

    const items = chosen.map((it, i) => serializeItemStack(it, amounts[i]));
    const lossyNames = chosen
      .filter((it) => isLossyType(it.typeId))
      .map((it) => itemNameRaw(it));
    const def = {
      items,
      icon,
      type,
      onceOnly,
      cooldownSec,
      maxClaims,
      rank,
      minPlaytimeRank,
      minPlaytimeMin,
      hidden,
      regiveExisting: type === KIT_TYPES.STARTER ? regiveObs.getData() : false,
      createdBy: player.name,
    };

    pendingNav =
      lossyNames.length > 0
        ? () => confirmLossyKit(player, name, def, lossyNames)
        : () => finalizeKit(player, name, def);
    try {
      form.close();
    } catch {}
  };

  form.button(t("jm_at.kits.btn_create_kit"), commit);
  form.button(t("jm_at.kits.btn_cancel"), () => {
    intent = "back";
    try {
      form.close();
    } catch {}
  });
  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(reopen);
  }
  if (pendingNav) return system.run(pendingNav);
  // Cancel returns to the kit list; the engine close (✕ / bottom Close) and
  // escape exit to game. If edited, confirm — Keep editing reopens, Discard leaves.
  if (snapshot() !== initial) {
    return system.run(async () => {
      if (await confirmDiscardChanges(player)) return reopen();
      if (intent === "back") return cancel();
    });
  }
  if (intent === "back") return system.run(cancel);
}

async function confirmLossyKit(player, name, def, lossyNames) {
  const list = raw(
    ...lossyNames.flatMap((n, i) => (i ? ["\n§7• §f", n] : ["§7• §f", n])),
  );
  const form = new MessageFormData()
    .title(t("jm_at.kits.title_lossy"))
    .body(t("jm_at.kits.lossy_create_body", list))
    .button1(t("jm_at.kits.btn_save_anyway"))
    .button2(t("jm_at.kits.btn_cancel"));
  const res = await form.show(player);
  if (res.canceled || res.selection === 1) return showManageKits(player);
  return finalizeKit(player, name, def);
}

function finalizeKit(player, name, def) {
  const ok = addKit(name, def);
  if (!ok) {
    return warnForm(player, t("jm_at.kits.create_save_failed", name), () =>
      showManageKits(player),
    );
  }
  tell(player, t("jm_at.kits.created", name));
  return showManageKits(player);
}

// =========================================================
// Staff: edit an existing kit's settings (keeps its items)
// =========================================================

/** Edit kit settings; items and icon are handled on their own screens. */
async function editKitSettings(player, name) {
  const kit = getKits()[name];
  if (!kit) return showManageKits(player);

  const rankTags = knownRankTags();
  const rankOptions = kitRankOptions(rankTags);
  const ladder = playtimeLadder();
  const ptEnabled = getCfg().playtimeRanksEnabled === true;

  // Preserve existing playtime gates when the saved ladder rank is gone.
  let ptRankDefault = 0;
  if (kit.minPlaytimeRank) {
    const i = ladder.findIndex((e) => e.rankName === kit.minPlaytimeRank);
    ptRankDefault = i >= 0 ? i + 1 : 0;
  }
  const rankWillCarry = ptEnabled && ptRankDefault > 0;
  const effMin = kitMinPlaytimeMin(kit);
  const ptCustomDefault =
    !rankWillCarry && effMin > 0 ? fmtDurationExact(effMin * 60000) : "";

  const typeObs = new ObservableNumber(kit.type === KIT_TYPES.STARTER ? 1 : 0, {
    clientWritable: true,
  });
  const repeatObs = new ObservableBoolean(!kit.onceOnly, {
    clientWritable: true,
  });
  const cooldownObs = new ObservableString(
    kit.cooldownSec ? fmtDurationExact(kit.cooldownSec * 1000) : "1d",
    { clientWritable: true },
  );
  const maxClaimsObs = new ObservableString(
    (kit.maxClaims || 0) > 0 ? String(kit.maxClaims) : "",
    { clientWritable: true },
  );
  const rankObs = new ObservableNumber(kitRankToIndex(kit.rank, rankTags), {
    clientWritable: true,
  });
  const regiveObs = new ObservableBoolean(!!kit.regiveExisting, {
    clientWritable: true,
  });
  const ptRankObs = new ObservableNumber(ptRankDefault, {
    clientWritable: true,
  });
  const ptCustomObs = new ObservableString(ptCustomDefault, {
    clientWritable: true,
  });
  const visObs = new ObservableNumber(kitHidden(kit) ? 0 : 1, {
    clientWritable: true,
  });

  const claimableShown = new ObservableBoolean(false);
  const starterShown = new ObservableBoolean(false);
  const repeatShown = new ObservableBoolean(false);
  const status = new ObservableString("");
  const statusShown = new ObservableBoolean(false);

  const recompute = () => {
    const claimable = typeObs.getData() === 0;
    claimableShown.setData(claimable);
    starterShown.setData(!claimable);
    repeatShown.setData(claimable && repeatObs.getData());
    status.setData("");
    statusShown.setData(false);
  };
  recompute();
  typeObs.subscribe(recompute);
  repeatObs.subscribe(recompute);

  const typeItems = [
    { label: t("jm_at.kits.type_claimable_menu"), value: 0 },
    { label: t("jm_at.kits.type_starter_auto"), value: 1 },
  ];
  // Fixed tiers are RawMessages; custom rank tags stay literal (user content).
  const rankItems = rankOptions.map((l, i) => ({
    label: typeof l === "string" ? l.replace(/§./g, "") : l,
    value: i,
  }));
  const ptRankItems = [
    t("jm_at.kits.none"),
    ...ladder.map(
      (e) =>
        `${String(e.rankName).replace(/§./g, "")} (${fmtRemaining((e.minutes || 0) * 60)})`,
    ),
  ].map((l, i) => ({ label: l, value: i }));
  const visItems = [
    { label: t("jm_at.kits.vis_hidden"), value: 0 },
    { label: t("jm_at.kits.vis_show_locked_grayed"), value: 1 },
  ];

  let pendingNav = null;
  let intent = null;
  const back = () => showManageKitDetail(player, name);
  const reopen = () => editKitSettings(player, name);
  const snapshot = () =>
    JSON.stringify([
      typeObs.getData(),
      repeatObs.getData(),
      cooldownObs.getData(),
      maxClaimsObs.getData(),
      rankObs.getData(),
      regiveObs.getData(),
      ptRankObs.getData(),
      ptCustomObs.getData(),
      visObs.getData(),
    ]);
  const initial = snapshot();

  const form = new CustomForm(player, t("jm_at.kits.title_edit", name));
  form.dropdown(t("jm_at.kits.field_kit_type"), typeObs, typeItems);
  form.toggle(t("jm_at.kits.field_repeatable"), repeatObs, {
    visible: claimableShown,
  });
  form.textField(t("jm_at.kits.field_cooldown"), cooldownObs, {
    visible: repeatShown,
    description: t("jm_at.kits.field_cooldown_desc"),
  });
  form.textField(t("jm_at.kits.field_max_claims"), maxClaimsObs, {
    visible: repeatShown,
  });
  form.dropdown(t("jm_at.kits.field_who_can_claim"), rankObs, rankItems);
  form.toggle(t("jm_at.kits.field_regive"), regiveObs, {
    visible: starterShown,
  });
  if (ptEnabled) {
    form.dropdown(t("jm_at.kits.field_pt_rank"), ptRankObs, ptRankItems, {
      visible: claimableShown,
    });
  }
  form.textField(
    ptEnabled
      ? t("jm_at.kits.field_pt_custom_with_rank")
      : t("jm_at.kits.field_pt_custom"),
    ptCustomObs,
    { visible: claimableShown },
  );
  form.dropdown(t("jm_at.kits.field_visibility"), visObs, visItems);
  form.spacer();
  form.label(status, { visible: statusShown });
  form.spacer({ visible: statusShown });

  const fail = (msg) => {
    status.setData(msg);
    statusShown.setData(true);
  };

  const afterSave = async (semanticsChanged) => {
    if (!semanticsChanged) return showManageKitDetail(player, name);
    const conf = await new MessageFormData()
      .title(t("jm_at.kits.title_reset_history"))
      .body(t("jm_at.kits.reset_history_body", name))
      .button1(t("jm_at.kits.btn_keep_history"))
      .button2(t("jm_at.kits.btn_reset_everyone_lower"))
      .show(player);
    if (!conf.canceled && conf.selection === 1) {
      resetAllKitClaims(getKits()[name] ?? kit);
      tell(player, t("jm_at.kits.reset_all_done", name));
    }
    return showManageKitDetail(player, name);
  };

  const commit = () => {
    const type =
      typeObs.getData() === 1 ? KIT_TYPES.STARTER : KIT_TYPES.CLAIMABLE;
    const rank = kitRankFromIndex(rankObs.getData(), rankTags);

    let onceOnly = true;
    let cooldownSec = 0;
    let maxClaims = 0;
    if (type === KIT_TYPES.CLAIMABLE && repeatObs.getData()) {
      const sec = parseCooldownSec(cooldownObs.getData());
      if (sec <= 0) {
        return fail(
          "§c冷却时间无效，请使用 30m、6h、1d 或 1d6h 等格式。",
        );
      }
      onceOnly = false;
      cooldownSec = sec;
      const mc = parseMaxClaims(maxClaimsObs.getData());
      if (mc === null) {
        return fail(
          "§c最多领取次数必须为整数（留空或0表示不限）。",
        );
      }
      maxClaims = mc;
    }

    // Starter kits ignore playtime gates.
    let minPlaytimeRank = "";
    let minPlaytimeMin = 0;
    if (type === KIT_TYPES.CLAIMABLE) {
      const ptRankIdx = ptEnabled ? ptRankObs.getData() : 0;
      const ptCustomSec = parseCooldownSec(ptCustomObs.getData());
      if (ptRankIdx > 0 && ladder[ptRankIdx - 1]) {
        minPlaytimeRank = ladder[ptRankIdx - 1].rankName;
        minPlaytimeMin = ladder[ptRankIdx - 1].minutes || 0;
      } else if (ptCustomSec > 0) {
        minPlaytimeMin = Math.round(ptCustomSec / 60);
      }
    }

    const hidden = visObs.getData() !== 1;
    const def = {
      items: kit.items ?? [],
      icon: kit.icon ?? DEFAULT_KIT_ICON,
      type,
      onceOnly,
      cooldownSec,
      maxClaims,
      rank,
      minPlaytimeRank,
      minPlaytimeMin,
      hidden,
      pinned: !!kit.pinned,
      regiveExisting: type === KIT_TYPES.STARTER ? regiveObs.getData() : false,
      createdBy: kit.createdBy ?? player.name,
    };
    const semanticsChanged =
      !!kit.onceOnly !== !!onceOnly || (kit.maxClaims || 0) !== maxClaims;
    if (!updateKit(name, def)) {
      return fail(
        `§c无法保存“${name}”的修改。存储空间可能已满，请检查聊天中的存储警告。`,
      );
    }
    tell(player, t("jm_at.kits.updated", name));
    pendingNav = () => afterSave(semanticsChanged);
    try {
      form.close();
    } catch {}
  };

  form.button(t("jm_at.kits.btn_save_changes"), commit);
  form.button(t("jm_at.common.btn_back"), () => {
    intent = "back";
    try {
      form.close();
    } catch {}
  });
  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(reopen);
  }
  if (pendingNav) return system.run(pendingNav);
  // Back returns to the kit detail; the engine close (✕ / bottom Close) and
  // escape exit to game. If edited, confirm — Keep editing reopens, Discard leaves.
  if (snapshot() !== initial) {
    return system.run(async () => {
      if (await confirmDiscardChanges(player)) return reopen();
      if (intent === "back") return back();
    });
  }
  if (intent === "back") return system.run(back);
}
