/** Finite title notifications with ownership guards for later addon messages. */
import { system } from "@minecraft/server";

const timedTitles = new Map();

/** All addon title writers invalidate an older notification's cleanup timer. */
export function setHudTitle(player, message, options) {
  const previous = timedTitles.get(player.id);
  if (previous) {
    system.clearRun(previous.timer);
    timedTitles.delete(player.id);
  }
  try { player.onScreenDisplay.setTitle(message, options); return true; }
  catch { return false; }
}

/** Native fade-out plus an explicit, bounded cleanup for clients with custom HUDs. */
export function showTimedTitle(player, message, options = {}) {
  const timing = { fadeInDuration: 5, stayDuration: 30, fadeOutDuration: 10, ...options };
  if (!setHudTitle(player, message, timing)) return false;
  const token = {};
  timedTitles.set(player.id, token);
  const ticks = [timing.fadeInDuration, timing.stayDuration, timing.fadeOutDuration]
    .reduce((sum, value) => sum + (Number.isFinite(value) ? Math.max(0, value) : 0), 0);
  token.timer = system.runTimeout(() => {
    if (timedTitles.get(player.id) !== token) return;
    timedTitles.delete(player.id);
    if (player.isValid === false) return;
    try { player.onScreenDisplay.setTitle("", { subtitle: "", fadeInDuration: 0, stayDuration: 0, fadeOutDuration: 0 }); } catch {}
  }, Math.max(1, Math.ceil(ticks) + 1));
  return true;
}

/** Release the timer on disconnect; no HUD writes to an invalid player. */
export function releaseTitleFeedback(playerId) {
  const pending = timedTitles.get(playerId);
  if (!pending) return;
  system.clearRun(pending.timer);
  timedTitles.delete(playerId);
}
