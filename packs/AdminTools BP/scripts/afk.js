import { setHudTitle } from "./screen-feedback.js";
/**
 * afk.js — AFK detection and auto-kick
 *
 * Tracks player movement and rotation. Players idle beyond a configurable
 * threshold receive a warning, then get kicked. Staff can be exempted.
 *
 * Config keys (in world cfg):
 *   afkEnabled       — master toggle (default true)
 *   afkWarnMinutes   — minutes before warning (default 2)
 *   afkKickMinutes   — minutes before kick (default 60)
 *   afkExemptStaff   — exempt admins/mods (default true)
 *
 * Imported by main.js for side effects (runInterval fires automatically).
 */

import { system, world } from "@minecraft/server";
import { getCfg } from "./storage.js";
import { isStaff } from "./permissions.js";
import { tell, silentCatch } from "./utils.js";
import { t, raw } from "./i18n.js";

// In-memory state: playerId → { lastActiveMs, lastPos, lastRot, warned, lastTitleMs }
const _afkState = new Map();

/** Returns a snapshot of AFK state for debug output. */
export function getAfkSummary() {
  let warned = 0;
  let tracked = 0;
  for (const s of _afkState.values()) {
    tracked++;
    if (s.warned) warned++;
  }
  return { tracked, warned };
}

const POS_THRESHOLD = 0.5; // blocks of movement to count as active
const ROT_THRESHOLD = 2; // degrees of rotation to count as active
const AFK_SUBTITLE_CYCLE_MS = 45000; // pick a new subtitle every 45 seconds

// Lang keys — the actual subtitle text lives in the RP lang file so it
// translates per-player. pickSubtitle() returns a key; showAfkTitle wraps it.
// lang-keys: jm_at.afk.sub_*
const AFK_SUBTITLES = Array.from(
  { length: 55 },
  (_, i) => `jm_at.afk.sub_${String(i + 1).padStart(2, "0")}`,
);

function dist(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
}

function rotDiff(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

let _lastSubtitleIdx = -1;
function pickSubtitle() {
  if (AFK_SUBTITLES.length <= 1) return AFK_SUBTITLES[0] ?? "";
  let idx;
  do {
    idx = Math.floor(Math.random() * AFK_SUBTITLES.length);
  } while (idx === _lastSubtitleIdx);
  _lastSubtitleIdx = idx;
  return AFK_SUBTITLES[idx];
}

function showAfkTitle(player, subtitleKey) {
  try {
    setHudTitle(player, t("jm_at.afk.title"), {
      fadeInDuration: 0,
      stayDuration: 250, // ~12.5s — refreshed every 10s so it never gaps
      fadeOutDuration: 0,
      subtitle: raw("§7", t(subtitleKey)),
    });
  } catch {}
}

function clearAfkTitle(player) {
  try {
    // Overwrite with an invisible title that vanishes in 2 ticks (~0.1s)
    setHudTitle(player, "§r", {
      fadeInDuration: 0,
      stayDuration: 0,
      fadeOutDuration: 2,
      subtitle: "",
    });
  } catch {}
}

// Reset AFK timer for a player (called on block interactions too)
function resetActivity(player) {
  const state = _afkState.get(player.id);
  if (state) {
    if (state.warned) clearAfkTitle(player);
    state.lastActiveMs = Date.now();
    state.warned = false;
  }
}

// Lightweight event hooks to reset AFK on block interaction
try {
  world.afterEvents.playerBreakBlock.subscribe((ev) => {
    if (ev.player) resetActivity(ev.player);
  });
} catch {}

try {
  world.afterEvents.playerPlaceBlock.subscribe((ev) => {
    if (ev.player) resetActivity(ev.player);
  });
} catch {}

try {
  world.afterEvents.playerInteractWithBlock.subscribe((ev) => {
    if (ev.player) resetActivity(ev.player);
  });
} catch {}

// Using an item (eating, fishing, drawing a bow, etc.) and interacting with an
// entity (trading with a villager, etc.) also count as activity, so an active
// player who happens to be standing still isn't flagged AFK. (Chat can't be
// used here — the chat event is experimental-only in the stable API.)
try {
  world.afterEvents.itemUse.subscribe((ev) => {
    if (ev.source) resetActivity(ev.source);
  });
} catch {}

try {
  world.afterEvents.playerInteractWithEntity.subscribe((ev) => {
    if (ev.player) resetActivity(ev.player);
  });
} catch {}

// Fast movement check — runs every 5 ticks (~250ms) ONLY for warned players
// so the title clears instantly when they start moving again
system.runInterval(() => {
  try {
    for (const player of world.getPlayers()) {
      const state = _afkState.get(player.id);
      if (!state || !state.warned) continue;
      const pos = player.location;
      const rot = player.getRotation();
      const moved = dist(pos, state.lastPos) > POS_THRESHOLD;
      const rotated = rotDiff(rot, state.lastRot) > ROT_THRESHOLD;
      if (moved || rotated) {
        clearAfkTitle(player);
        state.lastActiveMs = Date.now();
        state.warned = false;
        state.lastPos = { x: pos.x, y: pos.y, z: pos.z };
        state.lastRot = { x: rot.x, y: rot.y };
      }
    }
  } catch {}
}, 5);

// Main AFK check — every 200 ticks (~10 seconds)
system.runInterval(() => {
  try {
    const cfg = getCfg();
    if (!cfg.afkEnabled) return;

    const now = Date.now();
    const warnMs = (cfg.afkWarnMinutes ?? 2) * 60000;
    const kickEnabled = !!cfg.afkKickEnabled;
    const kickMs = (cfg.afkKickMinutes ?? 30) * 60000;
    const exemptStaff = cfg.afkExemptStaff !== false;
    const onlineIds = new Set();

    for (const player of world.getPlayers()) {
      try {
        onlineIds.add(player.id);

        if (exemptStaff && isStaff(player)) continue;

        const pos = player.location;
        const rot = player.getRotation();
        let state = _afkState.get(player.id);

        if (!state) {
          _afkState.set(player.id, {
            lastActiveMs: now,
            lastPos: { x: pos.x, y: pos.y, z: pos.z },
            lastRot: { x: rot.x, y: rot.y },
            warned: false,
          });
          continue;
        }

        // Check for movement or rotation
        const moved = dist(pos, state.lastPos) > POS_THRESHOLD;
        const rotated = rotDiff(rot, state.lastRot) > ROT_THRESHOLD;

        // Always update position/rotation snapshot
        state.lastPos = { x: pos.x, y: pos.y, z: pos.z };
        state.lastRot = { x: rot.x, y: rot.y };

        if (moved || rotated) {
          if (state.warned) clearAfkTitle(player);
          state.lastActiveMs = now;
          state.warned = false;
          continue;
        }

        const idleMs = now - state.lastActiveMs;

        // Kick threshold
        // NOTE (i18n): disconnect()/kick reasons only accept plain strings —
        // the disconnect screen uses the server's Chinese.
        if (kickEnabled && idleMs >= kickMs) {
          try {
            player.disconnect("因长时间挂机被移出游戏。");
          } catch {
            try {
              player.runCommand("kick @s 因长时间挂机被移出游戏。");
            } catch {}
          }
          _afkState.delete(player.id);
          continue;
        }

        // Warn threshold — first trigger
        if (idleMs >= warnMs && !state.warned) {
          state.warned = true;
          state.currentSubtitle = pickSubtitle();
          state.lastSubtitleCycleMs = now;
          if (kickEnabled) {
            const remainMin = Math.ceil((kickMs - idleMs) / 60000);
            tell(player, t("jm_at.afk.warn_kick", remainMin));
          } else {
            tell(player, t("jm_at.afk.warn"));
          }
        }

        // While warned: refresh title every tick to keep it on screen,
        // and pick a new subtitle every 30 seconds
        if (state.warned) {
          if (now - (state.lastSubtitleCycleMs ?? 0) >= AFK_SUBTITLE_CYCLE_MS) {
            state.currentSubtitle = pickSubtitle();
            state.lastSubtitleCycleMs = now;
          }
          showAfkTitle(player, state.currentSubtitle);
        }
      } catch (e) {
        silentCatch("afk_player", e);
      }
    }

    // Clean up entries for players who left
    for (const id of _afkState.keys()) {
      if (!onlineIds.has(id)) _afkState.delete(id);
    }
  } catch (e) {
    silentCatch("afk_tick", e);
  }
}, 200);
