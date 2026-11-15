/**
 * stat-scoreboards.js — Curated leaderboards for the player stats the addon
 * already tracks in player core data (playtime, kills, deaths, block stats).
 *
 * The hologram scoreboard renderer reads from world.scoreboard objectives, but
 * these stats live in per-player dynamic properties. This module mirrors each
 * tracked stat into a dedicated objective so the existing scoreboard-hologram
 * pipeline (render / live-refresh / edit / restore) works unchanged.
 *
 * Objectives are created lazily — only once a stat leaderboard is actually
 * placed (ensureStatObjective). After that, snapshotPlayer keeps online players'
 * scores fresh via syncPlayerStats; offline players retain their last-synced
 * score (scoreboard identities persist across sessions). Players who haven't
 * been online since the leaderboard was created simply populate as they log in.
 */

import { world } from "@minecraft/server";
import { getPlayerCore } from "./storage.js";

// Effective playtime matches how the rest of the addon reports it: tracked +
// bonus. Stored in whole MINUTES so one objective can drive every readout the
// hologram offers (hours, hours + minutes, or minutes) — a score in hours
// couldn't be expanded back into minutes, and it flattened everyone under an
// hour to a tied 0.
const effMs = (core) => (core.playTimeMs ?? 0) + (core.bonusPlaytimeMs ?? 0);
const effMinutes = (core) => Math.floor(effMs(core) / 60000);
const effHours = (core) => Math.floor(effMs(core) / 3600000);

/**
 * The stats offered in the "Stat Leaderboard" picker, in display order.
 *   objId — backing scoreboard objective id (short, no spaces; created lazily)
 *   label — objective display name AND the hologram's default title (STORED
 *           world content, so it stays a plain string — nameTags/scoreboard
 *           display names can't carry translations)
 *   labelKey — lang key for DISPLAY surfaces (the picker buttons)
 *   score — (core) => integer score for that player
 *   timeFormat — optional: score counts minutes, so seed the hologram's time
 *           readout with this mode ("h" | "hm" | "m", see formatTimeScore)
 */
// lang-keys: jm_at.stat.*
export const TRACKED_STATS = [
  { objId: "at_playtime_m", label: "游玩时长", labelKey: "jm_at.stat.playtime", score: effMinutes, timeFormat: "h" },
  { objId: "at_pkills", label: "玩家击杀数", labelKey: "jm_at.stat.pkills", score: (c) => c.statPlayerKills ?? 0 },
  { objId: "at_mobkills", label: "生物击杀数", labelKey: "jm_at.stat.mobkills", score: (c) => c.statMobKills ?? 0 },
  { objId: "at_deaths", label: "死亡次数", labelKey: "jm_at.stat.deaths", score: (c) => c.statDeaths ?? 0 },
  { objId: "at_mined", label: "挖掘方块数", labelKey: "jm_at.stat.mined", score: (c) => c.statBlocksMined ?? 0 },
  { objId: "at_placed", label: "放置方块数", labelKey: "jm_at.stat.placed", score: (c) => c.statBlocksPlaced ?? 0 },
  { objId: "at_traveled", label: "移动距离（格）", labelKey: "jm_at.stat.traveled", score: (c) => c.statBlocksTraveled ?? 0 },
];

/**
 * Retired objectives: no longer offered in the picker, but still kept in sync
 * so leaderboards placed by an older version keep updating.
 *
 * `at_playtime` held whole HOURS. Rewriting it in place as minutes was not an
 * option — scoreboard identities persist for offline players, so every player
 * who hadn't logged in since the change would have kept an hour count that now
 * read as minutes (a 300h veteran showing "5h"). The picker moved to a new
 * objective instead and this one is simply left as it was.
 */
const LEGACY_STATS = [{ objId: "at_playtime", score: effHours }];

// Everything syncPlayerStats keeps fresh. ensureStatObjective only ever creates
// TRACKED_STATS objectives — a legacy one is synced if it exists, never made.
const _SYNCED_STATS = [...TRACKED_STATS, ...LEGACY_STATS];

const _byObjId = new Map(TRACKED_STATS.map((s) => [s.objId, s]));

/** Clamp to a safe non-negative 32-bit integer (scoreboard scores are i32). */
function _safeScore(v) {
  if (typeof v !== "number" || !isFinite(v)) return 0;
  return Math.max(0, Math.min(2147483647, Math.round(v)));
}

/**
 * Mirror this player's tracked stats into any stat objective that already
 * exists. Does NOT create objectives — a stat is only synced once a leaderboard
 * for it has been placed (see ensureStatObjective), so we never clutter the
 * world scoreboard with objectives nobody displays. Called from snapshotPlayer
 * with the freshly-updated core, so it costs no extra storage reads.
 */
export function syncPlayerStats(player, core) {
  if (!core) return;
  for (const stat of _SYNCED_STATS) {
    let obj = null;
    try {
      obj = world.scoreboard.getObjective(stat.objId);
    } catch {}
    if (!obj) continue; // not in use → don't materialize it
    try {
      obj.setScore(player, _safeScore(stat.score(core)));
    } catch {}
  }
}

/**
 * Ensure a stat's backing objective exists, then seed it from everyone who's
 * currently online so a freshly-placed leaderboard isn't empty. Accepts a stat
 * object or its objId. Returns the objective, or null if creation failed.
 */
export function ensureStatObjective(stat) {
  const s = typeof stat === "string" ? _byObjId.get(stat) : stat;
  if (!s) return null;
  let obj = null;
  try {
    obj = world.scoreboard.getObjective(s.objId);
  } catch {}
  if (!obj) {
    try {
      obj = world.scoreboard.addObjective(s.objId, s.label);
    } catch {
      return null;
    }
  }
  for (const p of world.getPlayers()) {
    try {
      obj.setScore(p, _safeScore(s.score(getPlayerCore(p))));
    } catch {}
  }
  return obj;
}
