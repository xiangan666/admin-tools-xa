import { showTimedTitle } from "./screen-feedback.js";
/**
 * Kit script events for NPCs and command blocks.
 *   /scriptevent jm_at:givekit  <kit>   gives the kit directly
 *   /scriptevent jm_at:claimkit <kit>   applies cooldown/limit/rank rules
 *
 * The kit goes to the script event's source entity, so target a player with
 * execute. Command blocks and NPC buttons work well for this:
 *   /execute as @p run scriptevent jm_at:givekit Starter
 *   /execute as @initiator run scriptevent jm_at:givekit Starter
 * <kit> can be the plain name or #id.
 *
 * /scriptevent is operator-gated. Survival players can still press the button
 * or talk to the NPC; the command runs as them.
 */

import { system } from "@minecraft/server";
import { NS, FEATURES } from "./constants.js";
import { getCfg } from "./storage.js";
import { resolveKitRef, giveKit, claimKit } from "./kits.js";
import { tell, silentCatch } from "./utils.js";
import { t } from "./i18n.js";
import { logPlayer } from "./log.js";

function kitsLive() {
  return FEATURES.kits === true && getCfg().kitsEnabled !== false;
}

/** Compact cooldown text for chat feedback. */
function fmtWait(sec) {
  sec = Math.max(0, Math.floor(sec));
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (d) return `${d}天 ${h}小时`;
  if (h) return `${h}小时 ${m}分钟`;
  if (m) return `${m}分钟 ${s}秒`;
  return `${s}秒`;
}

function receivedFeedback(player, name, dropped) {
  try {
    player.playSound("random.levelup");
  } catch {}
  try {
    showTimedTitle(player, t("jm_at.kits.received_title"), {
      subtitle: name,
      fadeInDuration: 5,
      stayDuration: 30,
      fadeOutDuration: 10,
    });
  } catch {}
  tell(
    player,
    dropped > 0
      ? t("jm_at.kits.received_dropped", name, dropped)
      : t("jm_at.kits.received", name),
  );
}

/** Tell the player why a script-event claim failed. */
function claimFailMessage(player, name, res) {
  switch (res.reason) {
    case "cooldown":
      tell(player, t("jm_at.kits.fail_cooldown", name, fmtWait(res.waitSec)));
      break;
    case "limit":
      tell(player, t("jm_at.kits.fail_limit", name));
      break;
    case "once":
      tell(player, t("jm_at.kits.fail_once", name));
      break;
    case "rank":
      tell(player, t("jm_at.kits.fail_rank", name));
      break;
    case "playtime":
      tell(player, t("jm_at.kits.fail_playtime", name));
      break;
    case "full":
      tell(player, t("jm_at.kits.fail_full", name));
      break;
    case "empty":
      tell(player, t("jm_at.kits.fail_empty", name));
      break;
    default:
      tell(player, t("jm_at.kits.fail_generic", name));
  }
}

system.afterEvents.scriptEventReceive.subscribe(
  (ev) => {
    try {
      const give = ev.id === `${NS}:givekit`;
      const claim = ev.id === `${NS}:claimkit`;
      if (!give && !claim) return;

      const player = ev.sourceEntity;
      if (!player || player.typeId !== "minecraft:player") return;
      if (!kitsLive()) return;

      const found = resolveKitRef(ev.message);
      if (!found) {
        tell(
          player,
          t("jm_at.kits.not_found", String(ev.message ?? "").trim()),
        );
        return;
      }
      const { name, kit } = found;

      if (give) {
        const { dropped } = giveKit(player, kit);
        receivedFeedback(player, name, dropped);
        logPlayer(player, "KIT_EVENT_GIVE", name);
      } else {
        const res = claimKit(player, kit);
        if (res.ok) {
          receivedFeedback(player, name, res.dropped);
          logPlayer(player, "KIT_EVENT_CLAIM", name);
        } else {
          claimFailMessage(player, name, res);
        }
      }
    } catch (e) {
      silentCatch("kit_scriptevent", e);
    }
  },
  { namespaces: [NS] },
);
