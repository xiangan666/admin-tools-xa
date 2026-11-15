/**
 * storage-health.js — Proactive storage capacity monitoring
 *
 * Checks usage levels when an admin joins (1-minute delay) and alerts
 * them if any area exceeds 95% capacity. Each admin is only alerted
 * once per session (until they rejoin).
 *
 * Imported by main.js; call onAdminJoin(player) from the playerSpawn handler.
 */

import { system, world } from "@minecraft/server";
import { KEY, LIMITS } from "./constants.js";
import {
  getWorldStr,
  getTicketMeta,
  getLogMeta,
  getClaimsMeta,
  getPlayerRegistry,
  queueStaffAlert,
} from "./storage.js";
import { tell, getPlayerXuid, silentCatch } from "./utils.js";
import { t, raw } from "./i18n.js";
import { storageAreaLabel } from "./log-labels.js";
import { isAdmin } from "./permissions.js";
import { getLogMaxPages } from "./log.js";

// =========================================================
// Usage computation
// =========================================================

/**
 * Returns an object describing current usage for every tracked storage area.
 * Each entry: { used, max, pct }
 */
export function getStorageHealth() {
  try {
    const tMeta = getTicketMeta();
    const lMeta = getLogMeta();
    const cMeta = getClaimsMeta();
    const reg = getPlayerRegistry();

    const ticketCount =
      (tMeta.open ?? []).length +
      (tMeta.claimed ?? []).length +
      (tMeta.resolved ?? []).length +
      (tMeta.closed ?? []).length;
    const ticketMax = LIMITS.TICKET_PAGES * LIMITS.TICKETS_PER_PAGE;

    const claimCount = Object.keys(cMeta.idToPage ?? {}).length;
    const claimMax = LIMITS.CLAIMS_PAGES * LIMITS.CLAIMS_PER_PAGE;

    const logPages = lMeta.pagesUsed ?? 0;
    // Effective retention cap (cfg.logMaxEntries), not the physical 20 pages —
    // a world capped at 200 entries should read 5/5 = 100%, not 5/20.
    const logMax = getLogMaxPages();

    const regCount = Object.keys(reg).length;
    const regMax = LIMITS.PLAYER_REGISTRY_MAX;

    const pct = (used, max) => (max > 0 ? Math.round((used / max) * 100) : 0);

    // Byte-size monitoring for largest world properties
    const BYTE_MAX = 32768;
    const byteHealth = {};
    for (const [label, key] of [
      ["registryMeta", KEY.playerRegMeta],
      ["config", KEY.cfg],
      ["claimsMeta", KEY.claimsMeta],
      ["ticketMeta", KEY.ticketMeta],
    ]) {
      const len = getWorldStr(key).length;
      byteHealth[label] = { bytes: len, max: BYTE_MAX, pct: pct(len, BYTE_MAX) };
    }
    // Monitor each registry page individually
    for (let i = 0; i < LIMITS.REGISTRY_PAGES; i++) {
      const len = getWorldStr(KEY.playerRegPage(i)).length;
      if (len > 2) { // skip empty "{}"
        byteHealth[`regPage${i}`] = { bytes: len, max: BYTE_MAX, pct: pct(len, BYTE_MAX) };
      }
    }
    // Monitor each used claims page (these grow with members, trusted ranks, and
    // per-claim welcome messages, so a page can approach the limit on its own).
    for (let i = 0; i < (cMeta.pagesUsed ?? 0); i++) {
      const len = getWorldStr(KEY.claimsPage(i)).length;
      if (len > 2) { // skip empty "[]"
        byteHealth[`claimsPage${i}`] = { bytes: len, max: BYTE_MAX, pct: pct(len, BYTE_MAX) };
      }
    }

    // Whole-store total across every dynamic property this pack owns. This is the
    // true "how full is the world store" number; the per-area counts above only
    // sample known keys. Compared against an advisory soft cap (NOT an engine
    // limit — see LIMITS.DP_TOTAL_SOFT_WARN_BYTES).
    let totalBytes = 0;
    try {
      totalBytes = world.getDynamicPropertyTotalByteCount?.() ?? 0;
    } catch {
      totalBytes = 0;
    }
    const total = {
      bytes: totalBytes,
      max: LIMITS.DP_TOTAL_SOFT_WARN_BYTES,
      pct: pct(totalBytes, LIMITS.DP_TOTAL_SOFT_WARN_BYTES),
    };

    return {
      tickets: {
        used: ticketCount,
        max: ticketMax,
        pct: pct(ticketCount, ticketMax),
      },
      total,
      claims: {
        used: claimCount,
        max: claimMax,
        pct: pct(claimCount, claimMax),
      },
      logPages: { used: logPages, max: logMax, pct: pct(logPages, logMax) },
      registry: { used: regCount, max: regMax, pct: pct(regCount, regMax) },
      byteHealth,
    };
  } catch (e) {
    silentCatch("storage_health_calc", e);
    return null;
  }
}

// =========================================================
// On-join alert — fires once per admin, 1 minute after join
// =========================================================

const WARN_PCT = 95;
const _alertedThisSession = new Set(); // XUIDs already alerted

/** Call from the playerSpawn handler for initial spawns. */
export function onAdminJoin(player) {
  const xuid = getPlayerXuid(player);
  if (_alertedThisSession.has(xuid)) return;

  // Delay 1 minute (1200 ticks) so the admin is settled in
  system.runTimeout(() => {
    try {
      if (!player.isValid) return;
      // Re-check admin status — they may have been demoted
      if (!isAdmin(player).ok) return;
      _alertedThisSession.add(xuid);

      const health = getStorageHealth();
      if (!health) return;

      const warnings = [];

      for (const [key, info] of Object.entries(health)) {
        if (key === "byteHealth" || key === "total") continue;
        // The log is a ring: sitting at 100% of its retention cap is its
        // designed steady state (oldest entries rotate out), not a problem an
        // admin can act on — alerting would fire on every join forever. The
        // Storage Health screen still shows the figure.
        if (key === "logPages") continue;
        if (info.pct >= WARN_PCT) {
          warnings.push(
            t("jm_at.storage.health_line_area", storageAreaLabel(key), info.pct, info.used, info.max),
          );
        }
      }

      // Whole-store total — advisory backstop, kept separate because it's a byte
      // figure against a soft cap rather than a per-area used/max count.
      if (health.total && health.total.pct >= WARN_PCT) {
        warnings.push(
          t(
            "jm_at.storage.health_line_total",
            health.total.pct,
            Math.round(health.total.max / 1_000_000),
            health.total.bytes.toLocaleString(),
          ),
        );
      }

      if (health.byteHealth) {
        for (const [label, info] of Object.entries(health.byteHealth)) {
          if (info.pct >= WARN_PCT) {
            warnings.push(
              t("jm_at.storage.health_line_bytes", storageAreaLabel(label), info.pct, info.bytes),
            );
          }
        }
      }

      if (warnings.length > 0) {
        // warnings are RawMessages — interleave newlines instead of join().
        tell(
          player,
          t(
            "jm_at.storage.health_header",
            WARN_PCT,
            raw(...warnings.flatMap((w, i) => (i ? ["\n", w] : [w]))),
          ),
        );
      }

      // Extra urgency for registry approaching trim threshold. This is a
      // PERSISTENT, broadcast staff alert (stored up to 48h), so it must not bake
      // in the live count \u2014 that snapshot freezes at queue time and then visibly
      // disagrees with the live Storage Health gauge as the registry keeps
      // changing. State the fixed threshold/capacity (constants, never stale) and
      // point staff to the live readout for the exact number.
      if (health.registry.used >= LIMITS.REGISTRY_WARN_THRESHOLD) {
        const warnPct = Math.round(
          (LIMITS.REGISTRY_WARN_THRESHOLD / LIMITS.PLAYER_REGISTRY_MAX) * 100,
        );
        queueStaffAlert(
          `§c[存储] 玩家登记已超过 ${LIMITS.PLAYER_REGISTRY_MAX} 人容量的 ${warnPct}%。` +
            `新玩家加入时，最早的记录（包括离线封禁记录）可能被移除。请在“存储状况”页面查看实时用量。`,
          "", // no per-player target
          // Conditional: re-checked against the live registry count at delivery.
          // If usage has dropped back under the threshold by the time a staff
          // member logs in, the alert is suppressed instead of firing stale.
          "registry_capacity",
        );
      }
    } catch (e) {
      silentCatch("storage_health_join", e);
    }
  }, 1200);
}

/** Clear session tracking when a player leaves so they get re-alerted on next join. */
export function onAdminLeave(xuid) {
  _alertedThisSession.delete(xuid);
}
