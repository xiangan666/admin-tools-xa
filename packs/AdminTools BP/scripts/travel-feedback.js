import { setHudTitle } from "./screen-feedback.js";
/** Visible movement-cancel warning shared by home, warp, bed and TPA waits. */
import { tell } from "./utils.js";
import { raw } from "./i18n.js";

export function showTravelWait(player, seconds, label, { title = true, receiving = false } = {}) {
  const left = Math.max(1, Math.ceil(seconds));
  const destination = raw(receiving ? "等待玩家：" : "目的地：", label);
  try {
    player.onScreenDisplay.setActionBar(raw(`§e传送等待 ${left} 秒 §c请勿移动，移动会取消§r §7`, destination));
  } catch {}
  if (title) {
    try {
      setHudTitle(player, `§e传送倒计时 ${left} 秒`, {
        fadeInDuration: 0, stayDuration: 30, fadeOutDuration: 0,
        subtitle: raw(destination, "\n§c请勿移动，移动会取消传送"),
      });
    } catch {}
  }
}

export function beginTravelWait(player, seconds, label, receiving = false) {
  tell(player, raw(`§e${receiving ? "正在等待玩家 " : "即将传送到 "}`, label,
    `，需等待 ${Math.ceil(seconds)} 秒。§c请勿移动，移动会取消传送。`));
  showTravelWait(player, seconds, label, { receiving });
}

export function clearTravelWait(player) {
  try { player.onScreenDisplay.setActionBar(""); } catch {}
  try { setHudTitle(player, "", { subtitle: "", fadeInDuration: 0, stayDuration: 0, fadeOutDuration: 0 }); } catch {}
}
