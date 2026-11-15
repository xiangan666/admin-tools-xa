/**
 * dp-init.js — Dynamic property registration + safe initialization
 *
 * Why this exists:
 * - Some Minecraft versions/APIs require dynamic properties to be registered up-front.
 * - In newer Script API lines, registration APIs have moved around.
 *
 * This module does 2 things:
 *  1) Best-effort registration during startup (when supported).
 *  2) Guaranteed initialization later by writing defaults if properties are missing.
 */

import { world } from "@minecraft/server";
import { KEY, LIMITS, NS } from "./constants.js";
import { safeJsonParse } from "./utils.js";

// Guaranteed initialization: if properties are missing, create them.
// This runs once the world is "ready" (first tick).
export function ensureWorldPropertiesInitialized() {
  const ensure = (k, v) => {
    const cur = world.getDynamicProperty(k);
    if (typeof cur === "undefined") {
      try {
        world.setDynamicProperty(k, v);
      } catch {}
    }
  };

  ensure(KEY.cfg, "");
  ensure(KEY.ticketMeta, "");
  ensure(KEY.logMeta, "");
  ensure(KEY.playerRegMeta, "");
  for (let i = 0; i < LIMITS.REGISTRY_PAGES; i++) ensure(KEY.playerRegPage(i), "{}");
  ensure(KEY.sessionLog, "[]");

  for (let i = 0; i < LIMITS.TICKET_PAGES; i++) ensure(KEY.ticketPage(i), "[]");
  for (let i = 0; i < LIMITS.LOG_PAGES; i++) ensure(KEY.logPage(i), "[]");

  ensure(KEY.claimsMeta, "");
  ensure(KEY.claimLog, "[]");
  for (let i = 0; i < LIMITS.CLAIMS_PAGES; i++) ensure(KEY.claimsPage(i), "[]");

  ensure(KEY.rankDb, "{}");
  ensure(KEY.banLedger, "[]");
  ensure(KEY.hologramRegistry, "[]");

  // Pre-seed notif keys for all players already in the registry.
  // This prevents silent write failures on runtimes that require properties
  // to be registered before first use.
  // Check paged registry first, then fall back to legacy single property.
  const metaRaw = world.getDynamicProperty(KEY.playerRegMeta);
  const meta = metaRaw ? safeJsonParse(metaRaw, null) : null;
  const pagesUsed =
    meta && typeof meta.pagesUsed === "number" ? meta.pagesUsed : 0;
  if (pagesUsed > 0) {
    // Paged registry: the xuid→page index is no longer persisted (see storage.js
    // _buildRegistryMeta), so read the xuids straight from the page keys.
    for (let i = 0; i < pagesUsed; i++) {
      const pageRaw = world.getDynamicProperty(KEY.playerRegPage(i));
      const page = typeof pageRaw === "string" ? safeJsonParse(pageRaw, {}) : {};
      for (const xuid of Object.keys(page)) ensure(`${NS}:notif_${xuid}`, "[]");
    }
  } else if (meta && meta.xuidToPage) {
    // Pre-refactor paged save that still carried a persisted index.
    for (const xuid of Object.keys(meta.xuidToPage)) {
      ensure(`${NS}:notif_${xuid}`, "[]");
    }
  } else {
    // Legacy single-property registry.
    const raw = world.getDynamicProperty(KEY.playerReg);
    if (typeof raw === "string" && raw.length > 2) {
      const reg = safeJsonParse(raw, {});
      for (const xuid of Object.keys(reg)) {
        ensure(`${NS}:notif_${xuid}`, "[]");
      }
    }
  }

  // A tiny marker so we can tell initialization ran.
  ensure(`${NS}:dp_init`, "1");
}

// Best-effort hook: run once when the world is loaded, if the event exists.
try {
  // Keep it defensive – some runtimes may not expose worldLoad.
  if (
    world &&
    world.afterEvents &&
    world.afterEvents.worldLoad &&
    world.afterEvents.worldLoad.subscribe
  ) {
    world.afterEvents.worldLoad.subscribe(() =>
      ensureWorldPropertiesInitialized(),
    );
  }
} catch {
  // Ignore. We'll also call this from main.js on first tick.
}
