/**
 * storage.js — World and player dynamic property helpers
 */

import { world } from "@minecraft/server";
import { NS, KEY, PKEY, LIMITS } from "./constants.js";
import {
  safeJsonParse,
  safeJsonStringify,
  nowMs,
  getPlayerXuid,
  broadcastAdmins,
  silentCatch,
  utf8ByteLen,
} from "./utils.js";
import { t } from "./i18n.js";

// Default claim entry/exit notification templates. Exported so main.js can fall
// back to them when a config value is blank. Placeholders are documented in the
// Config Editor: {owner} {ownerName} {name} {claimName} {restricted}
export const DEFAULT_CLAIM_ENTER_MSG = "§e进入 {owner}§r{restricted}";
export const DEFAULT_CLAIM_EXIT_MSG = "§2已返回无主土地。";

// Injected by main.js after startup to avoid circular dependency
let _onStorageError = null;
export function initStorageErrorHook(fn) {
  _onStorageError = fn;
}

function notifyStorageError() {
  try {
    if (_onStorageError) _onStorageError();
  } catch (e) {
    silentCatch("storage_error_hook", e);
  }
}

// =========================================================
// World string properties
// =========================================================

export function getWorldStr(key) {
  const v = world.getDynamicProperty(key);
  return typeof v === "string" ? v : "";
}

// Keys that have already triggered an "approaching the limit" heads-up this
// session, so the soft warning fires once per key instead of on every write.
const _propWarned = new Set();

/**
 * Guard a value against the per-property byte cap BEFORE attempting the write.
 * Returns true if the value is too large to store (caller must abort the write).
 * Also emits a one-time soft warning per `id` as a blob nears the wall.
 * `id` is a human-readable label for the admin message (e.g. the property key).
 */
function propTooLarge(id, str) {
  const size = utf8ByteLen(str);
  if (size > LIMITS.MAX_PROP_BYTES) {
    broadcastAdmins(
      t("jm_at.storage.prop_too_large", id, size, LIMITS.MAX_PROP_BYTES),
    );
    notifyStorageError();
    return true;
  }
  if (size >= LIMITS.PROP_WARN_BYTES && !_propWarned.has(id)) {
    _propWarned.add(id);
    broadcastAdmins(
      t("jm_at.storage.prop_near_limit", id, size, LIMITS.MAX_PROP_BYTES),
    );
  }
  return false;
}

/** Write a world dynamic property. Returns true on success, false on failure. */
export function setWorldStr(key, str) {
  // Refuse over-limit writes up front so the data loss is reported precisely
  // (with the offending key) instead of surfacing as a generic engine throw.
  if (propTooLarge(key, str)) return false;
  try {
    world.setDynamicProperty(key, str);
    return true;
  } catch (e) {
    broadcastAdmins(
      t("jm_at.storage.world_write_failed", key, e?.message ?? e),
    );
    notifyStorageError();
    // Don't rethrow – a failed write is better than a crash
    return false;
  }
}

// =========================================================
// Caches — invalidated on successful writes
// =========================================================
let _cfgCache = null;
let _regCache = null; // merged all-pages cache
let _regMetaCache = null;
let _claimsMetaCache = null; // rebuilt-from-pages claims index (see getClaimsMeta)

/** Null out all module-level caches (used by full data reset). */
export function resetStorageCaches() {
  _cfgCache = null;
  _regCache = null;
  _regMetaCache = null;
  _claimsMetaCache = null;
  _propWarned.clear();
}

// =========================================================
// World config
// =========================================================

export function getCfg() {
  if (_cfgCache) return _cfgCache;
  const raw = getWorldStr(KEY.cfg);
  const cfg = safeJsonParse(raw, null);
  const fresh = {
    schema: 3,
    ownerXuid: "",
    ticketingOpen: true,
    ticketsVisible: true, // false = hide Tickets/Warnings from player menu
    warpsVisible: true, // false = hide Warps from player menu
    submitCooldownSec: 120,
    ticketLimit: 5, // max open tickets per player
    serverLocked: false,
    whitelistMode: false,
    whitelistedXuids: [],
    supportAccess: [], // [{ name, grantedByName, grantedByXuid, at }] — owner-consented remote support
    adminDenyXuids: [], // XUIDs denied Admin Tools access despite OP/admin tag. Keeps their operator status intact; the owner is never added here.

    categories: ["Griefing", "Harassment", "Bug", "Other"],
    scheduledBroadcasts: [],
    dimLocks: { nether: false, end: false },
    scheduledDimLocks: [], // [{ dim: "nether"|"end", activateAt: ms, announceMsg: "" }]
    scheduledDimUnlocks: [], // [{ dim: "nether"|"end", activateAt: ms, announceMsg: "" }]
    homesEnabled: true, // false = disable player homes entirely
    maxHomes: 3,
    kitsEnabled: true, // runtime toggle for kits (only meaningful when FEATURES.kits is on)
    kitsVisible: true, // false = hide the Kits button from the player menu
    tpaDelaySec: 3,
    tpaEnabled: true, // false = disable player TPA requests
    warnThreshold: 3, // warn count before admins see a flag on player profile
    autoDeleteClosedDays: 30, // 0 = disabled; auto-purge closed tickets after N days
    deathbackEnabled: true,
    deathbackGiveTools: "always", // "none" | "inventory" | "always"
    gravestonesEnabled: true, // stash items in a grave on death (manages keepInventory)
    gravestoneSafeZoneEnabled: false, // opt-in: purge hostile mobs in a 20-block bubble around each grave (same rules as a claim's hostileMobs protection)
    staffCustomRanks: false,
    staffRanksHidden: false, // hide the default [Admin]/[Mod] tags for all staff
    staffAdminTag: "§c[管理员]§r",
    staffModTag: "§g[协管员]§r",
    playtimeRanksEnabled: false,
    playtimeRanksOverrideManual: false,
    playtimeRanks: [], // [{ minutes: number, rankName: string }] sorted ascending
    afkEnabled: true,
    afkWarnMinutes: 2,
    afkKickEnabled: false,
    afkKickMinutes: 60,
    afkExemptStaff: true,
    claimNotificationsEnabled: true,
    claimEnterMsg: DEFAULT_CLAIM_ENTER_MSG,
    claimExitMsg: DEFAULT_CLAIM_EXIT_MSG,
    claimNotifCooldownSec: 1.5, // anti-spam: min seconds between claim messages
    claimNotifDisplay: "actionbar", // "actionbar" | "title" | "chat"
    claimWelcomeMsgEnabled: true, // allow claim owners to set a per-claim entry message
    // Live particle border drawn while a claim is being made/expanded with the
    // wand. ON by default as of v2.2 (schema 3); admins can turn it off in Claim
    // Settings. Gate with `getCfg().claimLivePreviewEnabled === true`.
    claimLivePreviewEnabled: true,

    maxClaimsPerPlayer: 5,
    claimStartArea: 5,
    claimMaxArea: 15,
    claimAreaPerTime: 1,
    claimAreaTimeInterval: 60,
    claimAllowNether: true,
    claimAllowEnd: true,
    claimDefaultY: {
      overworld: { min: -64, max: 320 },
      nether: { min: 0, max: 128 },
      the_end: { min: 0, max: 256 },
    },
    claimProtections: {
      blocks: true,
      containers: true,
      entities: true,
      allowVehicles: false,
      pvp: true,
      interactions: true,
      itemUse: true,
      explosions: true,
      hostileMobs: true,
      cropTrampling: true,
      fireSpread: true,
      enderPearls: true,
      ejectPlayers: false,
    },
    claimPlayerAbilities: {
      blocks: true,
      containers: true,
      entities: true,
      allowVehicles: true,
      pvp: false,
      interactions: true,
      itemUse: true,
      explosions: false,
      hostileMobs: false,
      cropTrampling: true,
      fireSpread: false,
      enderPearls: false,
      ejectPlayers: false,
    },
    mobBlacklist: [],
    mobWhitelist: [],
    modPrivileges: {
      // Currently ON for mods (default behavior)
      tickets: true,
      warn: true,
      kick: true,
      tempBan: true,
      freeze: true,
      heal: true,
      feed: true,
      tpToPlayer: true,
      spyCamera: true,
      viewInventory: true,
      punishmentHistory: true,
      claimBypass: false,
      // Currently OFF for mods (admin-only by default)
      serverControls: false,
      ticketSettings: false,
      dimensionLocks: false,
      itemWatch: false,
      configEditor: false,
      commands: false,
      gameCommands: false,
      commandButtons: false, // run owner-curated Command Buttons (managing them stays owner-only)
      gameRules: false,
      warps: false,
      broadcasts: false,
      summon: false,
      gamemode: false,
      adminNotes: false,
      rankPanel: false,
      clearInventory: false,
      rankManager: false,
      kits: false, // create/edit/delete kits (claiming is a player action)
    },
    // Admins default to all-on (adminCan treats an unset key as true), so this
    // map only lists the exceptions that should default OFF even for admins.
    adminPrivileges: {
      kits: false, // create/edit/delete kits — off for admins until the owner grants it
      gamemode: false, // change gamemodes — off for admins until the owner grants it
      // Staff-roster control is the owner's to delegate, not on by default:
      // these meta-privileges let an admin mint/strip other admins and rewrite
      // the moderator privilege set, so they stay OFF until the owner grants them
      // (mirrors how kits/gamemode are handled). Ordinary admin powers
      // (permBan/unban/claimsAdmin/etc.) still default ON via adminCan.
      manageRoles: false, // assign/remove admins & moderators
      modPrivileges: false, // edit the global mod privilege defaults
    },
    menuVisibility: {}, // { [topLevelKey]: false } for owner-hidden buttons. Empty = all visible.
    // Staff-tag trust mode (owner-set in Staff & Permissions). false = lenient:
    // vanilla admin/mod tags are honored so /tag grants work, and new ones are
    // announced to admins. true = strict: a tag not granted through the UI is
    // stripped on join. See reconcileStaffTags in main.js.
    strictStaffTags: false,
    // Action-log recording toggles (Log Settings, admin-set). These gate only
    // the optional categories mapped in log.js — audit-critical actions (bans,
    // kicks, ranks, permissions, inventory, support access, locks) are never
    // gated. All default ON; gate with `!== false`.
    logPlayerActivity: true, // homes / warps / TPA / deathback / ticket submits / kit events
    logPvpKills: true,
    logItemAlerts: true, // ITEM_ALERT only; BANNED_ITEM_DETECTED always logs
    logTicketWorkflow: true, // staff claim / unclaim / resolve / close / reply
    logConfigChanges: true, // broadcasts, warps, dim locks, item lists, settings edits
    logMaxEntries: 800, // retention cap; page-granular (rounded to multiples of 40)
  };
  if (cfg && typeof cfg === "object") {
    const merged = { ...fresh, ...cfg };
    merged.claimProtections = {
      ...fresh.claimProtections,
      ...(cfg.claimProtections ?? {}),
    };
    merged.claimPlayerAbilities = {
      ...fresh.claimPlayerAbilities,
      ...(cfg.claimPlayerAbilities ?? {}),
    };
    merged.claimDefaultY = {
      ...fresh.claimDefaultY,
      ...(cfg.claimDefaultY ?? {}),
    };
    merged.modPrivileges = {
      ...fresh.modPrivileges,
      ...(cfg.modPrivileges ?? {}),
    };
    // Deep-merge so default-off admin exceptions (e.g. kits, gamemode) survive
    // even when a saved config predates them or omits the key.
    merged.adminPrivileges = {
      ...fresh.adminPrivileges,
      ...(cfg.adminPrivileges ?? {}),
    };
    // The old "Gamemode Access (all admins)" switch is gone; gamemode is now the
    // adminPrivileges.gamemode privilege, off by default on every world. The
    // owner re-grants it in Admin Privileges if they want admins to have it.
    delete merged.gamemodeAllAdmins;
    _cfgCache = merged;
    return merged;
  }
  setWorldStr(KEY.cfg, safeJsonStringify(fresh));
  _cfgCache = fresh;
  return fresh;
}
export function setCfg(cfg) {
  // Always invalidate — callers mutate the cached object by reference, so a failed
  // write must force re-read from storage to avoid live/persisted state desync.
  _cfgCache = null;
  setWorldStr(KEY.cfg, safeJsonStringify(cfg));
}

/**
 * Reset the config to factory defaults WITHOUT removing any other data. Claims,
 * player cores, ranks, tickets, bans, the registry, holograms, etc. all live
 * under their own keys and are left untouched — only the cfg toggles/options are
 * reset. `preserveKeys` lists top-level cfg fields to carry over from the current
 * config (e.g. ownerXuid and the access lists), so a reset never drops ownership
 * or access control. Returns the new config.
 */
export function resetCfgToDefaults(preserveKeys = []) {
  const current = getCfg();
  const carried = {};
  for (const k of preserveKeys) {
    if (Object.prototype.hasOwnProperty.call(current, k))
      carried[k] = current[k];
  }
  // Drop the stored config + cache so getCfg() rebuilds the pure default schema
  // (single source of truth), then overlay the preserved fields and persist.
  _cfgCache = null;
  setWorldStr(KEY.cfg, "");
  const fresh = getCfg(); // empty raw → parse fails → returns the defaults
  Object.assign(fresh, carried);
  setCfg(fresh);
  return fresh;
}

/**
 * Apply a partial update to the config safely. Re-reads the CURRENT config
 * (picking up any change made while a form was open), runs the callback to
 * mutate only the keys it touches, then saves.
 *
 * Use this for any config write that happens AFTER an `await` (e.g. a form):
 * the old `const cfg = getCfg(); await form; cfg.x = y; setCfg(cfg)` pattern
 * writes a stale whole-object snapshot and can silently revert a change made
 * during the await — by another admin, or by a background timer that also
 * writes cfg (scheduled broadcasts, dim-lock countdowns). The callback receives
 * the fresh config object; mutate THAT (not any cfg captured before the await).
 */
export function mutateCfg(fn) {
  const cfg = getCfg();
  fn(cfg);
  setCfg(cfg);
}

// =========================================================
// Admin log storage
// =========================================================

export function getLogMeta() {
  const raw = getWorldStr(KEY.logMeta);
  const meta = safeJsonParse(raw, null);
  if (meta && typeof meta === "object") return meta;
  const fresh = { pagesUsed: 0, head: 0 };
  setWorldStr(KEY.logMeta, safeJsonStringify(fresh));
  return fresh;
}
export function setLogMeta(meta) {
  setWorldStr(KEY.logMeta, safeJsonStringify(meta));
}

export function loadLogPage(i) {
  const page = safeJsonParse(getWorldStr(KEY.logPage(i)), []);
  if (!Array.isArray(page)) {
    broadcastAdmins(t("jm_at.storage.log_page_corrupt", i));
    saveLogPage(i, []);
    return [];
  }
  return page;
}
export function saveLogPage(i, a) {
  setWorldStr(KEY.logPage(i), safeJsonStringify(a, "[]"));
}

/** Wipe all admin log entries and reset the meta. */
export function clearAdminLog() {
  // All physical pages, not just pagesUsed — the ring can wrap (head > 0), and
  // this also clears any orphaned page left by an older pack version.
  for (let i = 0; i < LIMITS.LOG_PAGES; i++) setWorldStr(KEY.logPage(i), "[]");
  setLogMeta({ pagesUsed: 0, head: 0 });
}

/**
 * Every stored log entry across the ring, oldest page first (callers that need
 * a strict order sort by `.at`). The ring's oldest page is meta.head (worlds
 * saved before the ring buffer lack the field — there, oldest was always
 * physical page 0, so `?? 0` reads them correctly).
 */
export function getAllLogEntries() {
  const meta = getLogMeta();
  const head = meta.head ?? 0;
  const pagesUsed = meta.pagesUsed ?? 0;
  let all = [];
  for (let k = 0; k < pagesUsed; k++) {
    all = all.concat(loadLogPage((head + k) % LIMITS.LOG_PAGES));
  }
  return all;
}

// =========================================================
// Ticket storage
// =========================================================

export function getTicketMeta() {
  const raw = getWorldStr(KEY.ticketMeta);
  const meta = safeJsonParse(raw, null);
  if (meta && typeof meta === "object") return meta;
  const fresh = {
    pagesUsed: 0,
    idToPage: {},
    open: [],
    claimed: [],
    resolved: [],
    closed: [],
  };
  setWorldStr(KEY.ticketMeta, safeJsonStringify(fresh));
  return fresh;
}
export function setTicketMeta(meta) {
  setWorldStr(KEY.ticketMeta, safeJsonStringify(meta));
}

export function loadTicketPage(i) {
  const page = safeJsonParse(getWorldStr(KEY.ticketPage(i)), []);
  if (!Array.isArray(page)) {
    broadcastAdmins(t("jm_at.storage.ticket_page_corrupt", i));
    saveTicketPage(i, []);
    return [];
  }
  return page;
}
export function saveTicketPage(i, a) {
  setWorldStr(KEY.ticketPage(i), safeJsonStringify(a, "[]"));
}

// =========================================================
// Player core record
// =========================================================

export function createPlayerCore(player) {
  return {
    xuid: getPlayerXuid(player),
    name: player.name,
    firstSeen: nowMs(),
    lastSeen: nowMs(),
    lastDim: "overworld",
    lastPos: { x: 0, y: 0, z: 0 },
    freezePos: null,
    myTickets: [],
    lastSubmitAt: 0,
    lastChatMs: 0,
    playTimeMs: 0,
    hasTicketItem: false,
    hasAdminTool: false,
    hasKitTool: false,
    punishments: [],
    adminNotes: [],
    pendingNotifs: [],
    warnAcks: {},
    statMobKills: 0,
    statPlayerKills: 0,
    statDeaths: 0,
    statBlocksMined: 0,
    statBlocksPlaced: 0,
    statBlocksTraveled: 0,
    rankSetManually: false,
    role: "", // resolved staff role, refreshed each snapshot ("owner"|"admin"|"moderator"|"")
    bonusPlaytimeMs: 0,
    // per-player admin menu customization
    //   hiddenTop: top-level keys this player has hidden from the main panel
    //   promoted:  sub-button keys this player has promoted as main-page shortcuts
    menuPrefs: { hiddenTop: [], promoted: [] },
  };
}

export function getPlayerCore(player) {
  const raw = player.getDynamicProperty(PKEY.core);
  const core = safeJsonParse(typeof raw === "string" ? raw : "", null);
  if (core && typeof core === "object") return core;
  const f = createPlayerCore(player);
  try {
    player.setDynamicProperty(PKEY.core, safeJsonStringify(f));
  } catch {}
  return f;
}

export function setPlayerCore(player, core) {
  const str = safeJsonStringify(core);
  // Same per-property cap applies to player entities; refuse over-limit writes
  // proactively so a player's profile can't be silently lost on save.
  if (propTooLarge(`player core for ${player.name}`, str)) return false;
  try {
    player.setDynamicProperty(PKEY.core, str);
    return true;
  } catch (e) {
    broadcastAdmins(
      t("jm_at.storage.player_write_failed", player.name, e?.message ?? e),
    );
    notifyStorageError();
    return false;
  }
}

// =========================================================
// World-level player registry (paged, offline access)
//
// Stores a stripped-down snapshot of each player keyed by XUID.
// Written on every login/snapshot so offline operations (unban,
// unmute, temp-ban) can read and mutate the record without needing
// the live player object.
//
// Storage layout:
//   jm_at:plr_reg_meta  — { pagesUsed }  (the xuid→page index is NOT persisted;
//                          it is rebuilt in memory from page contents on load —
//                          see _buildRegistryMeta. Persisting it would hit the
//                          32KB single-property cap at ~1.3k+ players.)
//   jm_at:plr_reg_00..  — { [xuid]: entry } per page (max REGISTRY_PER_PAGE)
//
// Schema per entry (lightweight index — notes/punishments are in per-player world properties):
//   { xuid, name, gamemode, firstSeen, lastSeen, lastDim, lastPos,
//     myTickets, warnAcks, playTimeMs, rankTag, ... }
// =========================================================

/**
 * Rebuild the in-memory xuid→page index by scanning the registry pages — their
 * keys ARE the xuids, so the index is fully derivable from page data. We persist
 * ONLY { pagesUsed }; the index is never written to disk because at scale it
 * would exceed the 32KB single-property limit (one xuid→page entry per known
 * player). Rebuilding from pages also makes the registry self-healing, the same
 * way reconcileStorageMeta() repairs the claims/ticket indexes.
 */
function _buildRegistryMeta(pagesUsed) {
  const n = typeof pagesUsed === "number" && pagesUsed > 0 ? pagesUsed : 0;
  const xuidToPage = {};
  for (let i = 0; i < n; i++) {
    const page = _loadRegistryPage(i);
    for (const xuid of Object.keys(page)) xuidToPage[xuid] = i;
  }
  return { pagesUsed: n, xuidToPage };
}

function _getRegistryMeta() {
  if (_regMetaCache) return _regMetaCache;
  const raw = getWorldStr(KEY.playerRegMeta);
  const persisted = safeJsonParse(raw, null);
  // New format persists only { pagesUsed }; pre-refactor saves also carried a
  // (now ignored) xuidToPage. Either way, rebuild the index from the pages —
  // they are the source of truth. This silently migrates old worlds with zero
  // data change and repairs any stale/half-written index from a prior crash.
  if (
    persisted &&
    typeof persisted === "object" &&
    typeof persisted.pagesUsed === "number"
  ) {
    const meta = _buildRegistryMeta(persisted.pagesUsed);
    _regMetaCache = meta;
    return meta;
  }
  // Check for legacy single-property registry and migrate
  const legacyRaw = getWorldStr(KEY.playerReg);
  const legacy = safeJsonParse(legacyRaw, null);
  if (legacy && typeof legacy === "object" && Object.keys(legacy).length > 0) {
    return _migrateRegistry(legacy);
  }
  const fresh = { pagesUsed: 0, xuidToPage: {} };
  setWorldStr(KEY.playerRegMeta, safeJsonStringify({ pagesUsed: 0 }));
  _regMetaCache = fresh;
  return fresh;
}

function _setRegistryMeta(meta) {
  // Callers mutate the cached meta object in place, so keep it as the live
  // in-memory index rather than nulling it (which would force a full page rescan
  // on the next access). Persist ONLY pagesUsed — the xuid→page index is rebuilt
  // from page contents on load (see _buildRegistryMeta).
  _regMetaCache = meta;
  _regCache = null;
  setWorldStr(
    KEY.playerRegMeta,
    safeJsonStringify({ pagesUsed: meta.pagesUsed ?? 0 }),
  );
}

function _loadRegistryPage(i) {
  const page = safeJsonParse(getWorldStr(KEY.playerRegPage(i)), null);
  return page && typeof page === "object" ? page : {};
}

function _saveRegistryPage(i, obj) {
  setWorldStr(KEY.playerRegPage(i), safeJsonStringify(obj));
}

/** Migrate legacy single-property registry to paged format. */
function _migrateRegistry(legacy) {
  const entries = Object.values(legacy);
  const meta = { pagesUsed: 0, xuidToPage: {} };
  let pageIdx = 0;
  let pageObj = {};
  let pageCount = 0;

  for (const entry of entries) {
    if (pageCount >= LIMITS.REGISTRY_PER_PAGE) {
      _saveRegistryPage(pageIdx, pageObj);
      pageIdx++;
      pageObj = {};
      pageCount = 0;
    }
    pageObj[entry.xuid] = entry;
    meta.xuidToPage[entry.xuid] = pageIdx;
    pageCount++;
  }
  // Save the last page
  if (pageCount > 0) {
    _saveRegistryPage(pageIdx, pageObj);
    pageIdx++;
  }
  meta.pagesUsed = pageIdx;

  // Persist only pagesUsed; the xuid→page index lives in memory (see
  // _buildRegistryMeta) and stays on the cached meta object below.
  setWorldStr(
    KEY.playerRegMeta,
    safeJsonStringify({ pagesUsed: meta.pagesUsed }),
  );
  // Clear legacy property
  try {
    setWorldStr(KEY.playerReg, "{}");
  } catch {}
  _regMetaCache = meta;
  _regCache = null;
  broadcastAdmins(
    t("jm_at.storage.registry_migrated", entries.length, meta.pagesUsed),
  );
  return meta;
}

/**
 * Returns the full merged registry as { [xuid]: entry }.
 * Loads all pages. Cached until any write invalidates it.
 * Used by callers that need to iterate all entries (lists, dropdowns, bulk ops).
 */
export function getPlayerRegistry() {
  if (_regCache) return _regCache;
  const meta = _getRegistryMeta();
  const merged = {};
  for (let i = 0; i < (meta.pagesUsed ?? 0); i++) {
    const page = _loadRegistryPage(i);
    Object.assign(merged, page);
  }
  _regCache = merged;
  return merged;
}

/**
 * Bulk-write the entire registry. Redistributes entries across pages and rebuilds meta.
 * Used by bulk operations (strip ranks, stress test).
 */
export function setPlayerRegistry(reg) {
  _regCache = null;
  _regMetaCache = null;
  const entries = Object.values(reg);
  const meta = { pagesUsed: 0, xuidToPage: {} };
  let pageIdx = 0;
  let pageObj = {};
  let pageCount = 0;

  for (const entry of entries) {
    if (pageCount >= LIMITS.REGISTRY_PER_PAGE) {
      _saveRegistryPage(pageIdx, pageObj);
      pageIdx++;
      pageObj = {};
      pageCount = 0;
    }
    pageObj[entry.xuid] = entry;
    meta.xuidToPage[entry.xuid] = pageIdx;
    pageCount++;
  }
  if (pageCount > 0) {
    _saveRegistryPage(pageIdx, pageObj);
    pageIdx++;
  }
  // Clear any leftover pages beyond what we wrote
  for (let i = pageIdx; i < LIMITS.REGISTRY_PAGES; i++) {
    _saveRegistryPage(i, {});
  }
  meta.pagesUsed = pageIdx;
  // Persist only pagesUsed; keep the rebuilt xuid→page index on the cached meta.
  setWorldStr(
    KEY.playerRegMeta,
    safeJsonStringify({ pagesUsed: meta.pagesUsed }),
  );
  _regMetaCache = meta;
}

/**
 * Write or update a player's registry entry from a live player + their core.
 * Only loads/writes the single relevant page. Trims when over PLAYER_REGISTRY_MAX.
 */
export function upsertRegistryEntry(player, core) {
  try {
    _regCache = null; // invalidate merged cache
    const xuid = getPlayerXuid(player);
    const meta = _getRegistryMeta();

    // Ensure notif key exists for this player (safe no-op if already present)
    const notifKey = `${NS}:notif_${xuid}`;
    try {
      const cur = world.getDynamicProperty(notifKey);
      if (typeof cur === "undefined") world.setDynamicProperty(notifKey, "[]");
    } catch {}

    // Migrate notes and punishments to per-player world properties (lazy migration)
    const notes = Array.isArray(core.adminNotes)
      ? core.adminNotes
      : core.adminNotes
        ? [
            {
              id: "N0",
              text: core.adminNotes,
              at: 0,
              byName: "Unknown",
              byXuid: "",
            },
          ]
        : [];
    const puns = (core.punishments ?? []).slice(0, LIMITS.PUNISHMENTS_MAX);
    if (notes.length) setPlayerNotes(xuid, notes);
    if (puns.length) setPlayerPunishments(xuid, puns);

    // Mirror saved homes to a world-level property so staff can view an
    // offline player's homes. Always writes the current value (or "{}") so
    // additions and removals both propagate, and so homes saved before this
    // feature existed get backfilled the next time the player is online.
    try {
      const homesRaw = player.getDynamicProperty(`${NS}:homes`);
      setWorldStr(
        `${NS}:phomes_${xuid}`,
        typeof homesRaw === "string" && homesRaw ? homesRaw : "{}",
      );
    } catch {}

    const entry = {
      xuid,
      name: player.name,
      gamemode: (() => {
        try {
          return player.getGameMode?.()?.toLowerCase() ?? "survival";
        } catch {
          return "survival";
        }
      })(),
      firstSeen: core.firstSeen ?? nowMs(),
      lastSeen: nowMs(),
      lastDim: core.lastDim ?? "overworld",
      lastPos: core.lastPos ?? { x: 0, y: 0, z: 0 },
      myTickets: core.myTickets ?? [],
      warnAcks: core.warnAcks ?? {},
      playTimeMs: core.playTimeMs ?? 0,
      rankTag: core.rankTag ?? "",
      rankTagEnabled: core.rankTagEnabled ?? true,
      rankSetManually: core.rankSetManually ?? false,
      bonusPlaytimeMs: core.bonusPlaytimeMs ?? 0,
      bonusChunks: core.bonusChunks ?? 0,
      // Resolved staff role ("owner"|"admin"|"moderator"|""), set by the caller
      // from the live player. Lets the offline profile know a player is staff so
      // it can offer to edit their per-staff privilege overrides.
      role: core.role ?? "",
    };

    // Trim before placing if total is at or over PLAYER_REGISTRY_MAX
    const totalBefore = Object.keys(meta.xuidToPage).length;
    if (
      totalBefore >= LIMITS.PLAYER_REGISTRY_MAX &&
      meta.xuidToPage[xuid] === undefined
    ) {
      // Collect all entries, sort by lastSeen, evict oldest
      const allEntries = [];
      for (let i = 0; i < (meta.pagesUsed ?? 0); i++) {
        const p = _loadRegistryPage(i);
        for (const e of Object.values(p)) allEntries.push(e);
      }
      allEntries.sort((a, b) => b.lastSeen - a.lastSeen);
      // Evict enough to make room for the new entry
      const evicted = allEntries.slice(LIMITS.PLAYER_REGISTRY_MAX - 1);

      if (evicted.length) {
        const ledger = getBanLedger();
        for (const e of evicted) {
          const evictedPuns = getPlayerPunishments(e.xuid);
          const activeBan = evictedPuns.find(
            (p) => p.active && p.type === "BAN",
          );
          if (activeBan && !ledger.some((l) => l.xuid === e.xuid)) {
            ledger.push({ xuid: e.xuid, name: e.name, punishment: activeBan });
          }
          try {
            world.setDynamicProperty(`${NS}:notif_${e.xuid}`, undefined);
          } catch {}

          const evictPage = meta.xuidToPage[e.xuid];
          if (evictPage !== undefined) {
            const pg = _loadRegistryPage(evictPage);
            delete pg[e.xuid];
            _saveRegistryPage(evictPage, pg);
          }
          delete meta.xuidToPage[e.xuid];
        }

        if (ledger.length > LIMITS.BAN_LEDGER_MAX) {
          const active = ledger.filter((l) => l.punishment?.active);
          const inactive = ledger.filter((l) => !l.punishment?.active);
          const trimCount = ledger.length - LIMITS.BAN_LEDGER_MAX;
          if (inactive.length >= trimCount) {
            inactive.splice(0, trimCount);
          } else {
            inactive.length = 0;
          }
          ledger.length = 0;
          ledger.push(...active, ...inactive);
        }
        setBanLedger(ledger);
      }
    }

    // Determine which page to write to
    let pageIdx = meta.xuidToPage[xuid];
    if (pageIdx === undefined) {
      // New entry — find a page with room
      pageIdx = -1;
      for (let i = 0; i < (meta.pagesUsed ?? 0); i++) {
        const count = Object.values(meta.xuidToPage).filter(
          (p) => p === i,
        ).length;
        if (count < LIMITS.REGISTRY_PER_PAGE) {
          pageIdx = i;
          break;
        }
      }
      // No room on existing pages — allocate a new one
      if (pageIdx === -1) {
        if ((meta.pagesUsed ?? 0) < LIMITS.REGISTRY_PAGES) {
          pageIdx = meta.pagesUsed ?? 0;
          meta.pagesUsed = pageIdx + 1;
        } else {
          pageIdx = 0; // fallback — should not happen after trim
        }
      }
    }

    // Write entry to its page
    const page = _loadRegistryPage(pageIdx);
    page[xuid] = entry;
    _saveRegistryPage(pageIdx, page);
    meta.xuidToPage[xuid] = pageIdx;

    _setRegistryMeta(meta);
  } catch (e) {
    silentCatch("upsert_registry", e);
  }
}

// =========================================================
// Ban ledger — preserves active bans from evicted registry entries
// =========================================================

export function getBanLedger() {
  return safeJsonParse(getWorldStr(KEY.banLedger), []);
}
export function setBanLedger(ledger) {
  setWorldStr(KEY.banLedger, safeJsonStringify(ledger));
}
export function removeBanLedgerEntry(xuid) {
  const ledger = getBanLedger();
  const idx = ledger.findIndex((l) => l.xuid === xuid);
  if (idx !== -1) {
    ledger.splice(idx, 1);
    setBanLedger(ledger);
  }
}

/**
 * Remove a single player's world-level data: registry entry, notes,
 * punishments, notifications, and admin commands.
 * Does NOT touch player-level dynamic properties (caller handles that
 * for online players).
 */
export function removePlayerData(xuid) {
  _regCache = null;
  const meta = _getRegistryMeta();
  const pageIdx = meta.xuidToPage?.[xuid];
  if (pageIdx !== undefined) {
    const page = _loadRegistryPage(pageIdx);
    delete page[xuid];
    _saveRegistryPage(pageIdx, page);
    delete meta.xuidToPage[xuid];
    _setRegistryMeta(meta);
  }
  // Clear per-player world properties
  try {
    world.setDynamicProperty(KEY.playerNotes(xuid), undefined);
  } catch {}
  try {
    world.setDynamicProperty(KEY.playerPunishments(xuid), undefined);
  } catch {}
  try {
    world.setDynamicProperty(`${NS}:phomes_${xuid}`, undefined);
  } catch {}
  try {
    world.setDynamicProperty(`${NS}:notif_${xuid}`, undefined);
  } catch {}
  try {
    world.setDynamicProperty(PKEY.adminCommands(xuid), undefined);
  } catch {}
  try {
    world.setDynamicProperty(KEY.modOverrides(xuid), undefined);
  } catch {}
  try {
    world.setDynamicProperty(KEY.adminOverrides(xuid), undefined);
  } catch {}
}

/** Get a single registry entry by XUID, or null. Loads only the relevant page. */
export function getRegistryEntry(xuid) {
  const meta = _getRegistryMeta();
  const pageIdx = meta.xuidToPage?.[xuid];
  if (pageIdx === undefined) return null;
  const page = _loadRegistryPage(pageIdx);
  return page[xuid] ?? null;
}

/** Get a single registry entry by name (case-insensitive), or null. */
export function getRegistryEntryByName(name) {
  const lname = name.toLowerCase();
  const meta = _getRegistryMeta();
  for (let i = 0; i < (meta.pagesUsed ?? 0); i++) {
    const page = _loadRegistryPage(i);
    const found = Object.values(page).find(
      (e) => e.name?.toLowerCase() === lname,
    );
    if (found) return found;
  }
  return null;
}

/**
 * Mutate punishments for an offline player.
 * The callback receives the punishments array and should mutate it in place.
 * Returns false if the player isn't in the registry.
 */
export function mutatePlayerPunishments(xuid, fn) {
  const puns = getPlayerPunishments(xuid);
  if (puns.length === 0) {
    const meta = _getRegistryMeta();
    if (meta.xuidToPage?.[xuid] === undefined) return false;
  }
  fn(puns);
  setPlayerPunishments(xuid, puns);
  return true;
}

/**
 * Mutate warnAcks in the registry for an offline player.
 * Loads only the relevant page, mutates, writes back that page.
 */
export function mutatePlayerWarnAcks(xuid, fn) {
  _regCache = null;
  const meta = _getRegistryMeta();
  const pageIdx = meta.xuidToPage?.[xuid];
  if (pageIdx === undefined) return false;
  const page = _loadRegistryPage(pageIdx);
  const entry = page[xuid];
  if (!entry) return false;
  entry.warnAcks = entry.warnAcks ?? {};
  fn(entry.warnAcks);
  page[xuid] = entry;
  _saveRegistryPage(pageIdx, page);
  return true;
}

/**
 * Mutate a registry entry for an offline player.
 * Loads only the relevant page, mutates, writes back that page.
 */
export function mutateRegistryEntry(xuid, fn) {
  _regCache = null;
  const meta = _getRegistryMeta();
  const pageIdx = meta.xuidToPage?.[xuid];
  if (pageIdx === undefined) return false;
  const page = _loadRegistryPage(pageIdx);
  const entry = page[xuid];
  if (!entry) return false;
  fn(entry);
  page[xuid] = entry;
  _saveRegistryPage(pageIdx, page);
  return true;
}

// =========================================================
// Per-player notes and punishments (world-level, keyed by XUID)
// Moved out of the registry to prevent exceeding the 32KB property limit.
// =========================================================

export function getPlayerNotes(xuid) {
  const raw = getWorldStr(KEY.playerNotes(xuid));
  if (!raw) {
    // Fallback: check inline registry (pre-migration data)
    const reg = getPlayerRegistry();
    const entry = reg[xuid];
    return entry?.adminNotes ?? [];
  }
  return safeJsonParse(raw, []);
}

export function setPlayerNotes(xuid, notes) {
  return setWorldStr(KEY.playerNotes(xuid), safeJsonStringify(notes));
}

export function getPlayerPunishments(xuid) {
  const raw = getWorldStr(KEY.playerPunishments(xuid));
  if (!raw) {
    // Fallback: check inline registry (pre-migration data)
    const reg = getPlayerRegistry();
    const entry = reg[xuid];
    return entry?.punishments ?? [];
  }
  return safeJsonParse(raw, []);
}

export function setPlayerPunishments(xuid, puns) {
  return setWorldStr(KEY.playerPunishments(xuid), safeJsonStringify(puns));
}

// =========================================================
// Per-staff privilege overrides (world-level, keyed by XUID)
//
// Stored world-level (not on the player entity) so the owner/admins can edit a
// staff member's overrides from their offline profile. modCan/adminCan read
// these by XUID at runtime. An empty/blank override map clears the property so
// "no override" is represented by the key simply being absent.
// =========================================================

/** Returns the per-mod override map for `xuid`, or null if none is stored. */
export function getModOverrides(xuid) {
  return safeJsonParse(getWorldStr(KEY.modOverrides(xuid)), null);
}
export function setModOverrides(xuid, overrides) {
  if (!overrides || Object.keys(overrides).length === 0) {
    try {
      world.setDynamicProperty(KEY.modOverrides(xuid), undefined);
    } catch {}
    return true;
  }
  return setWorldStr(KEY.modOverrides(xuid), safeJsonStringify(overrides));
}

/** Returns the per-admin override map for `xuid`, or null if none is stored. */
export function getAdminOverrides(xuid) {
  return safeJsonParse(getWorldStr(KEY.adminOverrides(xuid)), null);
}
export function setAdminOverrides(xuid, overrides) {
  if (!overrides || Object.keys(overrides).length === 0) {
    try {
      world.setDynamicProperty(KEY.adminOverrides(xuid), undefined);
    } catch {}
    return true;
  }
  return setWorldStr(KEY.adminOverrides(xuid), safeJsonStringify(overrides));
}

/**
 * True if `xuid` has been explicitly denied Admin Tools access by the owner.
 * Such players keep their operator status (so other addons still work) but are
 * treated as non-admins by this addon until re-granted. See isAdmin().
 */
export function isAdminDenied(xuid) {
  if (!xuid) return false;
  return (getCfg().adminDenyXuids ?? []).includes(xuid);
}

/**
 * Add (`denied = true`) or remove (`denied = false`) `xuid` from the admin
 * deny-list. No-ops if already in the desired state. Returns true on success.
 */
export function setAdminDenied(xuid, denied) {
  if (!xuid) return false;
  const cfg = getCfg();
  const list = cfg.adminDenyXuids ?? [];
  const has = list.includes(xuid);
  if (denied === has) return true; // already in desired state
  cfg.adminDenyXuids = denied
    ? [...list, xuid]
    : list.filter((x) => x !== xuid);
  setCfg(cfg);
  return true;
}

/**
 * One-time migration of legacy entity-level overrides (PKEY.modOverrides /
 * PKEY.adminOverrides) to world-level storage. Safe to call on every login —
 * once the player property is cleared it becomes a cheap no-op. Only copies when
 * world-level data isn't already present, so it never clobbers a newer edit made
 * while the player was offline.
 */
export function migrateLegacyOverrides(player) {
  try {
    const xuid = getPlayerXuid(player);
    const pairs = [
      [PKEY.modOverrides, KEY.modOverrides(xuid)],
      [PKEY.adminOverrides, KEY.adminOverrides(xuid)],
    ];
    for (const [legacyKey, worldKey] of pairs) {
      const raw = player.getDynamicProperty(legacyKey);
      if (typeof raw !== "string") continue;
      if (!getWorldStr(worldKey)) setWorldStr(worldKey, raw);
      try {
        player.setDynamicProperty(legacyKey, undefined);
      } catch {}
    }
  } catch (e) {
    silentCatch("migrate_overrides", e);
  }
}

// =========================================================
// Admin command list (per-admin, keyed by XUID)
//
// Schema per entry:
//   { id, name, command, mode, delayTicks, intervalTicks,
//     repeatCount, runsLeft, nextTick, active, createdAt }
// =========================================================

export function getAdminCmds(xuid) {
  const raw = getWorldStr(PKEY.adminCommands(xuid));
  const list = safeJsonParse(raw, null);
  return Array.isArray(list) ? list : [];
}

export function setAdminCmds(xuid, list) {
  setWorldStr(PKEY.adminCommands(xuid), safeJsonStringify(list));
}

// =========================================================
// Command presets (owner-curated "Command Buttons" — a single SHARED
// world-level list, unlike the per-admin saved commands above).
//
// Schema per entry: { id, name, command }
// Stored under its own key (not cfg) so it survives a config reset and the new
// owner inherits it after an ownership change; capped at COMMAND_PRESETS_MAX.
// =========================================================

export function getCommandPresets() {
  const raw = getWorldStr(KEY.commandPresets);
  const list = safeJsonParse(raw, null);
  return Array.isArray(list) ? list : [];
}

export function setCommandPresets(list) {
  const arr = Array.isArray(list) ? list.slice(0, LIMITS.COMMAND_PRESETS_MAX) : [];
  setWorldStr(KEY.commandPresets, safeJsonStringify(arr));
}

export function queuePlayerNotif(targetXuid, msg) {
  const online = world
    .getPlayers()
    .find((p) => getPlayerXuid(p) === targetXuid);
  if (online) {
    online.sendMessage(msg);
    return;
  }
  const notifKey = `${NS}:notif_${targetXuid}`;
  const raw = getWorldStr(notifKey);
  const list = safeJsonParse(raw, []);
  list.push({ msg, at: nowMs() });
  if (list.length > 10) list.splice(0, list.length - 10);
  setWorldStr(notifKey, safeJsonStringify(list));
}

// =========================================================
// Staff alert queue (world-level, shown to all staff on login)
// =========================================================

const STAFF_ALERTS_KEY = `${NS}:staff_alerts`;
const STAFF_ALERT_TTL = 48 * 60 * 60 * 1000; // 48 h

// Re-check predicates for *conditional* staff alerts. An alert may sit in the
// queue for up to 48 h before a given staff member logs in to see it, so a
// warning queued while a threshold was breached must NOT fire later once usage
// has dropped back into safe levels. Conditional alerts carry a `recheck` tag;
// the matching predicate is re-evaluated against live world state at delivery
// time (see popStaffAlerts) and the alert is dropped if the trigger no longer
// holds. Predicates run on every staff login, so keep them cheap, and they live
// here (rather than in storage-health.js) to avoid a circular import.
const STAFF_ALERT_RECHECK = {
  // Player registry capacity — queued from storage-health.js on admin join.
  registry_capacity: () =>
    Object.keys(getPlayerRegistry()).length >= LIMITS.REGISTRY_WARN_THRESHOLD,
};

/** True if a conditional alert's trigger is still live. Unknown/blank tags and
 *  predicate errors fail OPEN (deliver) — we'd rather over-warn than silently
 *  swallow a genuine alert. */
function staffAlertStillValid(alert) {
  const tag = alert.recheck;
  if (!tag) return true;
  const predicate = STAFF_ALERT_RECHECK[tag];
  if (!predicate) return true;
  try {
    return predicate();
  } catch (e) {
    silentCatch("staff_alert_recheck", e);
    return true;
  }
}

/**
 * Append a message to the world-level staff alert queue.
 * `recheck` (optional) tags the alert as conditional — its trigger is
 * re-validated at delivery time and the alert is suppressed/pruned if the
 * condition no longer holds. Conditional alerts are also de-duplicated so a
 * breached threshold doesn't stack a fresh copy on every admin join.
 */
export function queueStaffAlert(msg, targetXuid = "", recheck = "") {
  const now = nowMs();
  let list = safeJsonParse(getWorldStr(STAFF_ALERTS_KEY), []);
  list = list.filter((a) => now - a.at < STAFF_ALERT_TTL);
  if (recheck && list.some((a) => a.recheck === recheck && !a.retracted)) {
    // An equivalent conditional alert is already pending — refresh the TTL prune
    // and bail rather than queue a duplicate.
    setWorldStr(STAFF_ALERTS_KEY, safeJsonStringify(list));
    return;
  }
  list.push({
    msg,
    at: now,
    seenBy: [],
    targetXuid,
    retracted: false,
    recheck,
  });
  if (list.length > 20) list.splice(0, list.length - 20);
  setWorldStr(STAFF_ALERTS_KEY, safeJsonStringify(list));
}

/**
 * Retract all pending (unseen) staff alerts for a given target XUID.
 * Called when a warn is cleared and the threshold may no longer be met.
 */
export function retractStaffAlert(targetXuid) {
  if (!targetXuid) return;
  const now = nowMs();
  let list = safeJsonParse(getWorldStr(STAFF_ALERTS_KEY), []);
  list = list.filter((a) => now - a.at < STAFF_ALERT_TTL);
  let changed = false;
  for (const a of list) {
    if (a.targetXuid === targetXuid && !a.retracted) {
      a.retracted = true;
      changed = true;
    }
  }
  if (changed) setWorldStr(STAFF_ALERTS_KEY, safeJsonStringify(list));
}

/**
 * Return unseen staff alerts for this XUID and mark them as seen.
 * Expired alerts, and conditional alerts whose trigger no longer holds, are
 * pruned at the same time (retracted alerts are kept but never shown).
 */
export function popStaffAlerts(xuid) {
  const now = nowMs();
  let list = safeJsonParse(getWorldStr(STAFF_ALERTS_KEY), []);
  // Prune expired alerts, and any conditional alert whose trigger has cleared
  // (e.g. a capacity warning queued while over-threshold, now back in safe
  // range) so it never fires for this or any later staff member.
  list = list.filter(
    (a) => now - a.at < STAFF_ALERT_TTL && staffAlertStillValid(a),
  );
  const toShow = [];
  for (const alert of list) {
    if (alert.retracted) continue;
    if (!alert.seenBy.includes(xuid)) {
      toShow.push(alert.msg);
      alert.seenBy.push(xuid);
    }
  }
  setWorldStr(STAFF_ALERTS_KEY, safeJsonStringify(list));
  return toShow;
}

// =========================================================
// Session log (rollcall — join/leave events)
//
// Schema per entry: { at: ms, name, xuid, event: "join"|"leave" }
// =========================================================

export function getSessionLog() {
  const raw = getWorldStr(KEY.sessionLog);
  return safeJsonParse(raw, []);
}

export function appendSessionLog(entry) {
  const log = getSessionLog();
  log.push(entry);
  if (log.length > LIMITS.SESSION_LOG_MAX)
    log.splice(0, log.length - LIMITS.SESSION_LOG_MAX);
  setWorldStr(KEY.sessionLog, safeJsonStringify(log));
}

export function clearSessionLog() {
  setWorldStr(KEY.sessionLog, "[]");
}

// =========================================================
// Claims storage
// =========================================================

/**
 * Rebuild the claims indexes (idToPage / byOwner / byParent) in memory by
 * scanning the claims pages. The claim objects carry everything needed (id,
 * ownerXuid, parentId), so the indexes are fully derivable and are NOT persisted
 * — at scale (9000-claim ceiling) the combined index would blow the 32KB
 * single-property limit, the same problem the player registry had. We persist
 * only { pagesUsed }; this rebuilds on load and caches the result.
 *
 * Scans ALL CLAIMS_PAGES (not just pagesUsed) so a stale/understated pagesUsed
 * can never hide claims — identical robustness to reconcileStorageMeta(), and
 * pagesUsed is recomputed from the highest non-empty page. The index-building
 * logic below is intentionally identical to reconcileStorageMeta()'s Pass 2.
 */
function _buildClaimsMeta() {
  const idToPage = {};
  const byOwner = {};
  const byParent = {};
  let pagesUsed = 0;
  for (let i = 0; i < LIMITS.CLAIMS_PAGES; i++) {
    const page = loadClaimsPage(i);
    if (page.length > 0) pagesUsed = i + 1;
    for (const claim of page) {
      if (!claim.id || claim.id in idToPage) continue;
      idToPage[claim.id] = i;
      // byOwner indexes PERSONAL top-level claims only. Admin/server claims are
      // excluded here to match createClaim() (claims.js) and are reached via
      // getAdminClaims(); including them would count an admin's server claims
      // against their personal maxClaimsPerPlayer limit after a reload.
      if (claim.ownerXuid && !claim.parentId && !claim.isAdminClaim) {
        if (!byOwner[claim.ownerXuid]) byOwner[claim.ownerXuid] = [];
        byOwner[claim.ownerXuid].push(claim.id);
      }
      if (claim.parentId) {
        if (!byParent[claim.parentId]) byParent[claim.parentId] = [];
        byParent[claim.parentId].push(claim.id);
      }
    }
  }
  return { pagesUsed, idToPage, byOwner, byParent };
}

export function getClaimsMeta() {
  if (_claimsMetaCache) return _claimsMetaCache;
  const raw = getWorldStr(KEY.claimsMeta);
  const persisted = safeJsonParse(raw, null);
  // A persisted meta (new { pagesUsed } form OR a pre-refactor object that also
  // carried the indexes) means claims storage has been initialized — rebuild the
  // indexes from the pages (the source of truth), silently migrating old worlds
  // with no data change. Only a never-initialized world falls through to fresh.
  if (persisted && typeof persisted === "object") {
    const meta = _buildClaimsMeta();
    _claimsMetaCache = meta;
    // If this is a pre-refactor blob that still carried the indexes, shrink it on
    // disk right now (one-time) so the ~KBs are reclaimed on load rather than
    // waiting for the next claim write. Guarded so it never fires again after.
    if (persisted.idToPage || persisted.byOwner || persisted.byParent) {
      setWorldStr(
        KEY.claimsMeta,
        safeJsonStringify({ pagesUsed: meta.pagesUsed }),
      );
    }
    return meta;
  }
  const fresh = { pagesUsed: 0, idToPage: {}, byOwner: {}, byParent: {} };
  setWorldStr(KEY.claimsMeta, safeJsonStringify({ pagesUsed: 0 }));
  _claimsMetaCache = fresh;
  return fresh;
}
export function setClaimsMeta(meta) {
  // Keep the live in-memory index (callers mutate the cached meta in place);
  // persist ONLY pagesUsed — idToPage/byOwner/byParent rebuild from pages on load.
  _claimsMetaCache = meta;
  setWorldStr(
    KEY.claimsMeta,
    safeJsonStringify({ pagesUsed: meta.pagesUsed ?? 0 }),
  );
}

export function loadClaimsPage(i) {
  const page = safeJsonParse(getWorldStr(KEY.claimsPage(i)), []);
  if (!Array.isArray(page)) {
    saveClaimsPage(i, []);
    return [];
  }
  // Migrate trustedRanks: plain strings → { tag, role } objects
  for (const claim of page) {
    if (!Array.isArray(claim.trustedRanks)) claim.trustedRanks = [];
    else {
      claim.trustedRanks = claim.trustedRanks.map((entry) =>
        typeof entry === "string" ? { tag: entry, role: "builder" } : entry,
      );
    }
  }
  return page;
}
export function saveClaimsPage(i, arr) {
  // Forward the write result so callers can detect a refused (over-32KB) write
  // instead of silently losing the change and reporting success.
  return setWorldStr(KEY.claimsPage(i), safeJsonStringify(arr, "[]"));
}

export function getClaimLog() {
  return safeJsonParse(getWorldStr(KEY.claimLog), []);
}
export function appendClaimLog(entry) {
  const log = getClaimLog();
  log.push(entry);
  if (log.length > LIMITS.CLAIM_LOG_MAX)
    log.splice(0, log.length - LIMITS.CLAIM_LOG_MAX);
  setWorldStr(KEY.claimLog, safeJsonStringify(log, "[]"));
}
export function clearClaimLog() {
  setWorldStr(KEY.claimLog, "[]");
}

// =========================================================
// Startup meta reconciliation — removes orphaned index entries
// =========================================================

export function reconcileStorageMeta() {
  try {
    // ── Claims ──
    const cMeta = getClaimsMeta();
    let claimsFixed = false;

    // Pass 1: prune stale meta entries pointing to nonexistent page data
    for (const [id, pageIdx] of Object.entries(cMeta.idToPage ?? {})) {
      const page = loadClaimsPage(pageIdx);
      if (!page.some((c) => c.id === id)) {
        delete cMeta.idToPage[id];
        for (const [owner, ids] of Object.entries(cMeta.byOwner ?? {})) {
          cMeta.byOwner[owner] = ids.filter((i) => i !== id);
          if (!cMeta.byOwner[owner].length) delete cMeta.byOwner[owner];
        }
        delete (cMeta.byParent ?? {})[id];
        claimsFixed = true;
      }
    }

    // Pass 2: rebuild missing meta entries from page data
    for (let i = 0; i < LIMITS.CLAIMS_PAGES; i++) {
      const page = loadClaimsPage(i);
      for (const claim of page) {
        if (!claim.id || claim.id in (cMeta.idToPage ?? {})) continue;
        cMeta.idToPage[claim.id] = i;
        // Personal top-level claims only — mirror _buildClaimsMeta(): admin/server
        // claims are excluded so they never count against maxClaimsPerPlayer.
        if (claim.ownerXuid && !claim.parentId && !claim.isAdminClaim) {
          if (!cMeta.byOwner[claim.ownerXuid])
            cMeta.byOwner[claim.ownerXuid] = [];
          if (!cMeta.byOwner[claim.ownerXuid].includes(claim.id))
            cMeta.byOwner[claim.ownerXuid].push(claim.id);
        }
        if (claim.parentId) {
          if (!cMeta.byParent[claim.parentId])
            cMeta.byParent[claim.parentId] = [];
          if (!cMeta.byParent[claim.parentId].includes(claim.id))
            cMeta.byParent[claim.parentId].push(claim.id);
        }
        claimsFixed = true;
      }
    }

    if (claimsFixed) setClaimsMeta(cMeta);

    // ── Tickets ──
    const tMeta = getTicketMeta();
    let ticketsFixed = false;

    // Pass 1: prune stale meta entries
    for (const [id, pageIdx] of Object.entries(tMeta.idToPage ?? {})) {
      const page = loadTicketPage(pageIdx);
      if (!page.some((t) => t.id === id)) {
        delete tMeta.idToPage[id];
        for (const s of ["open", "claimed", "resolved", "closed"]) {
          tMeta[s] = (tMeta[s] ?? []).filter((i) => i !== id);
        }
        ticketsFixed = true;
      }
    }

    // Pass 2: rebuild missing meta entries + validate bucket membership
    const CANONICAL_TICKET_BUCKETS = ["open", "claimed", "resolved", "closed"];
    for (let i = 0; i < LIMITS.TICKET_PAGES; i++) {
      const page = loadTicketPage(i);
      for (const ticket of page) {
        if (!ticket.id) continue;

        // Ensure idToPage is set
        if (!(ticket.id in (tMeta.idToPage ?? {}))) {
          tMeta.idToPage[ticket.id] = i;
          ticketsFixed = true;
        }

        // Normalize status and validate bucket membership
        const rawStatus = (ticket.status ?? "open").toLowerCase();
        const status = CANONICAL_TICKET_BUCKETS.includes(rawStatus)
          ? rawStatus
          : "open";
        if (!CANONICAL_TICKET_BUCKETS.includes(rawStatus)) {
          silentCatch(
            "ticket_repair_unknown_status",
            new Error(
              `Ticket ${ticket.id} has unknown status "${ticket.status}", defaulting to open`,
            ),
          );
        }

        // Check if ticket is in any canonical bucket
        const inAnyBucket = CANONICAL_TICKET_BUCKETS.some((b) =>
          (tMeta[b] ?? []).includes(ticket.id),
        );

        if (!inAnyBucket) {
          if (!tMeta[status].includes(ticket.id)) tMeta[status].push(ticket.id);
          ticketsFixed = true;
        }
      }
    }

    // Pass 3: clean up stray uppercase bucket keys from older buggy repair runs
    const STRAY_TICKET_BUCKET_KEYS = ["OPEN", "CLAIMED", "RESOLVED", "CLOSED"];
    for (const strayKey of STRAY_TICKET_BUCKET_KEYS) {
      if (strayKey in tMeta) {
        delete tMeta[strayKey];
        ticketsFixed = true;
      }
    }

    if (ticketsFixed) setTicketMeta(tMeta);
  } catch (e) {
    silentCatch("reconcile_meta", e);
  }
}
