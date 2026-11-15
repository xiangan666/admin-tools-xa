/**
 * spectator-rescue.js — Keep staff from getting stuck in spectator mode.
 *
 * Spectators can't right-click items/blocks/entities, so they can't reopen
 * the admin UI the normal way, and without cheats they can't run /gamemode.
 * Three layers protect against this (Layer 1 — the confirmation warning — lives
 * in the gamemode picker in ui-admin.js):
 *
 *   Layer 2  Auto-recovery: on rejoin, if a staff member comes back in
 *            spectator and didn't choose it on purpose, the exit UI is
 *            force-opened for them. (Death-respawn isn't used — you can't die
 *            in spectator. The gamemode can settle late on Realms, so the
 *            rejoin check polls for a few seconds rather than checking once.)
 *   Layer 3  Manual escape: while a staff member is in spectator, pressing
 *            Sneak + Jump together opens the exit UI. (Both inputs only ascend
 *            /descend in spectator, so holding them together does nothing in
 *            the world and rarely fires by accident.)
 *
 * The exit UI uses player.setGameMode(), a script call that works without
 * cheats or op, so the rescue always succeeds. A player dynamic property
 * (jm_at:intentional_spectator) records that spectator was chosen on purpose,
 * which suppresses Layer 2. It is cleared automatically once they leave
 * spectator mode.
 */

import {
  world,
  system,
  GameMode,
  InputButton,
  ButtonState,
} from "@minecraft/server";
import { ActionFormData, FormCancelationReason } from "@minecraft/server-ui";
import { NS } from "./constants.js";
import { isStaff, isAdmin, modCan } from "./permissions.js";
import { tell, silentCatch } from "./utils.js";
import { t } from "./i18n.js";

const SPECTATOR_FLAG = `${NS}:intentional_spectator`;

// Players who currently have the rescue form open, keyed by runtime id, so the
// input poll doesn't spam-reopen it while the combo is held.
const _rescueOpen = new Set();

// The admin/player UI openers are injected at startup (main.js) rather than
// imported directly: ui-admin.js already imports setIntentionalSpectator from
// this module, so a static import back the other way would be circular. Same
// dependency-injection pattern as initBroadcastAdmins in utils.js.
let _showAdminPanel = null;
let _showPlayerMain = null;
export function initSpectatorRescueUis(showAdminPanelFn, showPlayerMainFn) {
  _showAdminPanel = showAdminPanelFn;
  _showPlayerMain = showPlayerMainFn;
}

function waitTicks(t) {
  return new Promise((resolve) => system.runTimeout(resolve, t));
}

function inSpectator(player) {
  try {
    return player.getGameMode() === GameMode.Spectator;
  } catch {
    return false;
  }
}

/** Record (or clear) that this player chose spectator on purpose. */
export function setIntentionalSpectator(player, on) {
  try {
    player.setDynamicProperty(SPECTATOR_FLAG, on ? true : undefined);
  } catch (e) {
    silentCatch("spectator_flag_set", e);
  }
}

/**
 * Show the "exit spectator" picker and apply the chosen mode via setGameMode
 * (no cheats/op needed). Retries through transient UserBusy cancellations so it
 * still works when force-opened right after a spawn.
 */
export async function openSpectatorRescue(player) {
  if (_rescueOpen.has(player.id)) return;
  _rescueOpen.add(player.id);

  // Anchor the player where they triggered the rescue. On Realms, a form opened
  // while the spectator is still moving can hand them back to gravity — they
  // start falling through the world while the UI is up. Re-teleporting to the
  // captured spot (with velocity zeroed) whenever they drift holds them in
  // place until they pick a mode. Only correct on real drift to avoid jitter.
  let anchor = null;
  let anchorDim = null;
  try {
    anchor = player.location;
    anchorDim = player.dimension;
  } catch {}
  const holdHandle = system.runInterval(() => {
    try {
      if (!player.isValid || !_rescueOpen.has(player.id) || !anchor) return;
      if (!inSpectator(player)) return; // mode already changed — let them go
      const loc = player.location;
      if (
        Math.abs(loc.x - anchor.x) > 0.5 ||
        Math.abs(loc.y - anchor.y) > 0.5 ||
        Math.abs(loc.z - anchor.z) > 0.5
      ) {
        player.teleport(anchor, { dimension: anchorDim, keepVelocity: false });
      }
    } catch {}
  }, 1);

  try {
    const playerIsAdmin = isAdmin(player).ok;

    // Creative is only offered to staff who still hold the gamemode privilege —
    // otherwise routing out of spectator through Creative would be a way around
    // the disabled "change gamemode" toggle. Survival and Adventure stay for
    // everyone so a stuck spectator can always escape without creative powers.
    const canGamemode = modCan(player, "gamemode");
    const modeButtons = [
      { mode: GameMode.Survival, label: t("jm_at.spectator.btn_survival") },
      ...(canGamemode
        ? [{ mode: GameMode.Creative, label: t("jm_at.spectator.btn_creative") }]
        : []),
      { mode: GameMode.Adventure, label: t("jm_at.spectator.btn_adventure") },
    ];

    const form = new ActionFormData()
      .title(t("jm_at.spectator.title"))
      .body(t("jm_at.spectator.body"));
    for (const b of modeButtons)
      form.button(b.label, "textures/ui/jm_at_gamemode");

    // Role-appropriate tool buttons after the gamemode buttons. Track each
    // as a closure so selection dispatch stays correct no matter how many
    // buttons the player's role contributed. showAdminPanel renders the Admin
    // Panel for admins and the Moderator Panel (modCan-gated) for moderators —
    // only the label/icon differs by role here.
    const toolActions = [];
    form.button(
      playerIsAdmin
        ? t("jm_at.spectator.btn_admin_tool")
        : t("jm_at.spectator.btn_mod_tool"),
      "textures/ui/jm_at_admin_tool",
    );
    toolActions.push(() => _showAdminPanel?.(player));
    form.button(t("jm_at.spectator.btn_player_menu"), "textures/ui/jm_at_ticket_menu");
    toolActions.push(() => _showPlayerMain?.(player));

    form.button(t("jm_at.spectator.btn_stay"), "textures/ui/jm_at_back");

    let res;
    for (let attempt = 0; attempt < 30; attempt++) {
      if (!player.isValid) return;
      res = await form.show(player);
      if (!res.canceled) break;
      if (res.cancelationReason !== FormCancelationReason.UserBusy) return;
      await waitTicks(10);
    }
    if (!res || res.canceled || res.selection == null) return;

    // Layout: [0..N-1] gamemodes (N = modeButtons.length, which drops to 2 when
    // Creative is withheld), [N .. N+toolActions.length-1] tools, last = stay.
    const sel = res.selection;

    if (sel < modeButtons.length) {
      try {
        player.setGameMode(modeButtons[sel].mode);
        setIntentionalSpectator(player, false);
        tell(player, t("jm_at.spectator.returned"));
      } catch (e) {
        silentCatch("spectator_rescue_set", e);
        tell(player, t("jm_at.spectator.change_failed"));
      }
      return;
    }

    // Everything past the gamemodes keeps the player in spectator on purpose, so
    // mark intentional to stop Layer 2 from re-nagging.
    setIntentionalSpectator(player, true);

    // A tool button? Open it (staying in spectator). Defer a few ticks so the
    // closing rescue form doesn't make the next form bounce on UserBusy; the
    // hold loop already zeroed velocity so the new form won't drop them.
    const toolIdx = sel - modeButtons.length;
    if (toolIdx >= 0 && toolIdx < toolActions.length) {
      const run = toolActions[toolIdx];
      system.runTimeout(() => {
        try {
          if (player.isValid) run();
        } catch (e) {
          silentCatch("spectator_rescue_open_ui", e);
        }
      }, 4);
    }
    // else: "Stay in Spectator" (last button) — nothing more to do.
  } finally {
    system.clearRun(holdHandle);
    _rescueOpen.delete(player.id);
  }
}

/**
 * Layer 2 — called from the playerSpawn handler on rejoin. If a staff member
 * comes back stuck in spectator and didn't choose it on purpose, force-open the
 * exit UI.
 *
 * Death-respawn isn't a useful trigger (you can't die in spectator), so this is
 * wired to initialSpawn (rejoin) only. On rejoin — especially on Realms — the
 * gamemode can take a second or two to settle to Spectator, so a single check
 * right after spawn misses it. Instead we poll for a few seconds and open the
 * rescue the moment spectator is detected.
 */
export function maybeRescueSpectator(player) {
  try {
    if (!isStaff(player)) return;
    let attempts = 0;
    const handle = system.runInterval(() => {
      attempts++;
      try {
        // Give up after ~10s, or once the player chose spectator on purpose.
        if (!player.isValid || attempts > 20) {
          system.clearRun(handle);
          return;
        }
        if (player.getDynamicProperty(SPECTATOR_FLAG) === true) {
          system.clearRun(handle);
          return;
        }
        if (inSpectator(player)) {
          system.clearRun(handle);
          openSpectatorRescue(player);
        }
      } catch (e) {
        system.clearRun(handle);
        silentCatch("spectator_spawn_open", e);
      }
    }, 10);
  } catch (e) {
    silentCatch("spectator_spawn_check", e);
  }
}

// =========================================================
// Layer 3 — Sneak + Jump escape input (polled for spectators)
// Also keeps the intentional-spectator flag clean: it's cleared the moment a
// player is no longer in spectator.
// =========================================================
system.runInterval(() => {
  for (const player of world.getPlayers()) {
    try {
      if (!inSpectator(player)) {
        if (player.getDynamicProperty(SPECTATOR_FLAG) !== undefined) {
          setIntentionalSpectator(player, false);
        }
        continue;
      }
      if (!isStaff(player)) continue;
      const info = player.inputInfo;
      const jump = info.getButtonState(InputButton.Jump) === ButtonState.Pressed;
      const sneak =
        info.getButtonState(InputButton.Sneak) === ButtonState.Pressed;
      if (jump && sneak) openSpectatorRescue(player);
    } catch (e) {
      silentCatch("spectator_input_poll", e);
    }
  }
}, 4);
