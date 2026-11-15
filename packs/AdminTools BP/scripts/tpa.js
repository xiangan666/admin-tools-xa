import { setHudTitle } from "./screen-feedback.js";
/** Player-to-player teleport requests. */

import { system, world } from "@minecraft/server";
import { NS } from "./constants.js";
import { getWorldStr, setWorldStr, getCfg } from "./storage.js";
import { tell, genId, silentCatch, safeJsonStringify } from "./utils.js";
import { t } from "./i18n.js";
import { teleportedPlayers, captureTpBackLocation, teleportPlayer } from "./players.js";
import { isAdmin } from "./permissions.js";
import { beginTravelWait, showTravelWait, clearTravelWait } from "./travel-feedback.js";

function isDimLocked(player, dimension) {
  if (isAdmin(player).ok) return false;
  const cfg = getCfg();
  const locks = cfg.dimLocks ?? {};
  const dim = dimension.id.replace("minecraft:", "");
  if ((dim === "nether" && locks.nether) || (dim === "the_end" && locks.end))
    return dim === "nether"
      ? t("jm_at.common.dim_nether")
      : t("jm_at.common.dim_end");
  return false;
}

const TPA_KEY = `${NS}:tpa_requests`;
const REQUEST_TTL = 60000; // 60 seconds.

// Suppress expiry notices for requests already handled.
const handledRequestIds = new Set();

export function getTpaRequests() {
  try {
    const raw = getWorldStr(TPA_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    const list = Array.isArray(parsed) ? parsed : [];
    const now = Date.now();
    const fresh = list.filter(
      (r) =>
        typeof r?.createdAt === "number" && now - r.createdAt < REQUEST_TTL,
    );
    if (fresh.length !== list.length) saveTpaRequests(fresh);
    return fresh;
  } catch (e) { silentCatch("tpa_getRequests", e); }
  return [];
}

function saveTpaRequests(reqs) {
  setWorldStr(TPA_KEY, safeJsonStringify(reqs, "[]"));
}

export function getIncomingRequests(player) {
  return getTpaRequests().filter((r) => r.targetName === player.name);
}

export function sendTpaRequest(requester, targetPlayer) {
  if (getCfg().tpaEnabled === false) {
    tell(requester, t("jm_at.tpa.disabled"));
    return false;
  }
  const reqs = getTpaRequests();

  // Keep one live request per pair.
  const exists = reqs.find(
    (r) =>
      r.requesterName === requester.name && r.targetName === targetPlayer.name,
  );
  if (exists) {
    tell(requester, t("jm_at.tpa.already_pending"));
    return false;
  }

  const req = {
    id: genId("TPA"),
    requesterName: requester.name,
    targetName: targetPlayer.name,
    createdAt: Date.now(),
  };

  reqs.push(req);
  saveTpaRequests(reqs);

  tell(requester, t("jm_at.tpa.sent", targetPlayer.name));
  tell(targetPlayer, t("jm_at.tpa.incoming", requester.name));

  // Auto-expire the request.
  system.runTimeout(() => {
    // Storage may already be pruned by getTpaRequests().
    const current = getTpaRequests();
    const remaining = current.filter((r) => r.id !== req.id);
    if (remaining.length !== current.length) saveTpaRequests(remaining);

    // Skip notices if someone already accepted or declined.
    if (!handledRequestIds.has(req.id)) {
      const online = world.getPlayers();
      const requesterOnline = online.find((p) => p.name === req.requesterName);
      const targetOnline = online.find((p) => p.name === req.targetName);
      if (requesterOnline)
        tell(requesterOnline, t("jm_at.tpa.expired_outgoing", req.targetName));
      if (targetOnline)
        tell(targetOnline, t("jm_at.tpa.expired_incoming", req.requesterName));
    }
    handledRequestIds.delete(req.id);
  }, REQUEST_TTL / 50);

  return true;
}

export function acceptTpaRequest(acceptor, req) {
  if (getCfg().tpaEnabled === false) {
    tell(acceptor, t("jm_at.tpa.disabled"));
    return;
  }
  // Re-check in case the UI was open past expiry.
  const fresh = getTpaRequests().find((r) => r.id === req.id);
  if (!fresh || fresh.targetName !== acceptor.name) {
    tell(acceptor, t("jm_at.tpa.request_expired"));
    return;
  }
  handledRequestIds.add(req.id);
  // Remove from queue.
  const reqs = getTpaRequests().filter((r) => r.id !== req.id);
  saveTpaRequests(reqs);

  const requesterName = fresh.requesterName;
  const acceptorName = acceptor.name;
  const getLiveRequester = () =>
    world.getPlayers().find((p) => p.name === requesterName);
  const getLiveAcceptor = () =>
    world.getPlayers().find((p) => p.name === acceptorName);

  const requester = getLiveRequester();
  if (!requester) {
    tell(acceptor, t("jm_at.tpa.requester_offline", requesterName));
    return;
  }

  const cfg = getCfg();
  const delaySec = Number.isFinite(cfg.tpaDelaySec) ? Math.max(0, cfg.tpaDelaySec) : 3;
  const execute = async () => {
    const liveRequester = getLiveRequester();
    const liveAcceptor = getLiveAcceptor();
    if (!liveRequester || !liveAcceptor) {
      if (liveRequester) tell(liveRequester, t("jm_at.tpa.acceptor_offline", acceptorName));
      return;
    }
    if (getCfg().tpaEnabled === false) { tell(liveRequester, t("jm_at.tpa.disabled")); return; }
    const destinationDimension = liveAcceptor.dimension;
    const lockedLabel = isDimLocked(liveRequester, destinationDimension);
    if (lockedLabel) {
      tell(liveRequester, t("jm_at.tpa.dim_locked", lockedLabel));
      return;
    }
    try {
      const ok = await teleportPlayer(liveRequester, liveAcceptor.location, {
        dimension: destinationDimension,
        askToBringMount: true,
        beforeTeleport() {
          if (getCfg().tpaEnabled === false || !getLiveRequester() || !getLiveAcceptor() || isDimLocked(liveRequester, destinationDimension)) return false;
          captureTpBackLocation(liveRequester);
          teleportedPlayers.add(liveRequester.id);
          return true;
        },
      });
      if (!ok) { tell(liveRequester, t("jm_at.tpa.failed")); return; }
      try {
        setHudTitle(liveRequester, t("jm_at.tpa.title_done"), {
          fadeInDuration: 0, stayDuration: 30, fadeOutDuration: 10,
          subtitle: t("jm_at.tpa.title_arrived", liveAcceptor.name),
        });
      } catch {}
      tell(liveRequester, t("jm_at.tpa.teleported", liveAcceptor.name));
      tell(liveAcceptor, t("jm_at.tpa.arrived", liveRequester.name));
    } catch {
      tell(liveRequester, t("jm_at.tpa.failed"));
    }
  };
  if (delaySec <= 0) { void execute(); return; }

  let done = false;
  const startTick = system.currentTick;
  const startReq = { ...requester.location };
  const startAcc = { ...acceptor.location };
  const startReqDim = requester.dimension.id;
  const startAccDim = acceptor.dimension.id;

  // Only the requester moves; subtitles reflect each side.
  beginTravelWait(requester, delaySec, acceptorName);
  beginTravelWait(acceptor, delaySec, requesterName, true);
  const clearWaits = () => { clearTravelWait(requester); clearTravelWait(acceptor); };
  let lastSecond = Math.ceil(delaySec);

  const countdownId = system.runInterval(() => {
    if (done) {
      system.clearRun(countdownId);
      return;
    }
    const liveRequester = getLiveRequester();
    const liveAcceptor = getLiveAcceptor();
    if (!liveRequester || !liveAcceptor) return;

    const elapsed = (system.currentTick - startTick) / 20;
    const remaining = Math.ceil(delaySec - elapsed);
    if (remaining > 0) {
      showTravelWait(liveRequester, remaining, acceptorName, { title: remaining !== lastSecond });
      showTravelWait(liveAcceptor, remaining, requesterName, { title: remaining !== lastSecond, receiving: true });
      lastSecond = remaining;
    }
  }, 5);

  const moveCheckId = system.runInterval(() => {
    try {
      if (done) {
        system.clearRun(moveCheckId);
        return;
      }

      const liveRequester = getLiveRequester();
      const liveAcceptor = getLiveAcceptor();
      if (!liveRequester || !liveAcceptor) {
        done = true;
        system.clearRun(moveCheckId);
        system.clearRun(countdownId);
        clearWaits();
        if (liveRequester) tell(liveRequester, t("jm_at.tpa.cancel_left"));
        if (liveAcceptor) tell(liveAcceptor, t("jm_at.tpa.cancel_left"));
        return;
      }

      const rMoved =
        liveRequester.dimension.id !== startReqDim ||
        Math.hypot(
          liveRequester.location.x - startReq.x,
          liveRequester.location.y - startReq.y,
          liveRequester.location.z - startReq.z,
        ) > 0.5;
      const aMoved =
        liveAcceptor.dimension.id !== startAccDim ||
        Math.hypot(
          liveAcceptor.location.x - startAcc.x,
          liveAcceptor.location.y - startAcc.y,
          liveAcceptor.location.z - startAcc.z,
        ) > 0.5;
      if (rMoved || aMoved) {
        done = true;
        system.clearRun(moveCheckId);
        system.clearRun(countdownId);
        clearWaits();
        const cancelTitle = {
          fadeInDuration: 0,
          stayDuration: 30,
          fadeOutDuration: 10,
        };
        try {
          setHudTitle(liveRequester, t("jm_at.tpa.title_canceled"), {
            ...cancelTitle,
            subtitle: t("jm_at.tpa.title_moved"),
          });
        } catch {}
        try {
          setHudTitle(liveAcceptor, t("jm_at.tpa.title_canceled"), {
            ...cancelTitle,
            subtitle: t("jm_at.tpa.title_moved"),
          });
        } catch {}
        tell(liveRequester, t("jm_at.tpa.cancel_moved"));
        tell(liveAcceptor, t("jm_at.tpa.cancel_moved"));
      }
    } catch (e) {
      silentCatch("tpa_movecheck", e);
      done = true;
      clearWaits();
      try { system.clearRun(moveCheckId); } catch {}
      try { system.clearRun(countdownId); } catch {}
    }
  }, 1);

  system.runTimeout(() => {
    try {
      if (done) return;
      done = true;
      system.clearRun(moveCheckId);
      system.clearRun(countdownId);
      clearWaits();

      const liveRequester = getLiveRequester();
      const liveAcceptor = getLiveAcceptor();
      if (!liveRequester || !liveAcceptor) {
        if (liveRequester) tell(liveRequester, t("jm_at.tpa.cancel_left"));
        return;
      }

      void execute();
    } catch (e) {
      silentCatch("tpa_execute", e);
    }
  }, delaySec * 20);
}

export function declineTpaRequest(decliner, req) {
  handledRequestIds.add(req.id);
  const reqs = getTpaRequests().filter((r) => r.id !== req.id);
  saveTpaRequests(reqs);
  const requester = world
    .getPlayers()
    .find((p) => p.name === req.requesterName);
  if (requester) tell(requester, t("jm_at.tpa.declined", decliner.name));
}
