// menu-visibility.js
// Runtime helpers for the two-layer admin menu customization system.
//
//   Layer 1 (owner):       cfg.menuVisibility — server-wide hide of optional top-level buttons
//   Layer 2 (per-player):  core.menuPrefs.hiddenTop — top-level keys this player has hidden
//                          core.menuPrefs.promoted  — sub-button keys this player has promoted
//                                                     to appear as shortcuts on the main page
//
// All readers fail OPEN on errors so a corrupt preference can never lock a
// staff member out of the admin panel.

import { getCfg, setCfg, getPlayerCore, setPlayerCore } from "./storage.js";
import { isAdmin, modCan } from "./permissions.js";
import { MENU_BUTTON_META, OWNER_LAYER_KEYS } from "./menu-keys.js";

// ─── Owner layer ─────────────────────────────────────────────────────────────

export function isOwnerHidden(key) {
  if (!OWNER_LAYER_KEYS.includes(key)) return false;
  const vis = getCfg().menuVisibility ?? {};
  return vis[key] === false;
}

export function setOwnerHidden(key, hidden) {
  if (!OWNER_LAYER_KEYS.includes(key)) return;
  const cfg = getCfg();
  const vis = { ...(cfg.menuVisibility ?? {}) };
  if (hidden) vis[key] = false;
  else delete vis[key]; // empty entry = visible (keeps cfg slim)
  cfg.menuVisibility = vis;
  setCfg(cfg);
}

export function resetOwnerMenuVisibility() {
  const cfg = getCfg();
  cfg.menuVisibility = {};
  setCfg(cfg);
}

// ─── Per-player layer (two sets) ─────────────────────────────────────────────

function _normalizeMenuPrefs(core) {
  if (!core.menuPrefs || typeof core.menuPrefs !== "object") {
    core.menuPrefs = { hiddenTop: [], promoted: [] };
  }
  if (!Array.isArray(core.menuPrefs.hiddenTop)) core.menuPrefs.hiddenTop = [];
  if (!Array.isArray(core.menuPrefs.promoted)) core.menuPrefs.promoted = [];
}

export function getHiddenTopSet(player) {
  try {
    const core = getPlayerCore(player);
    const arr = core?.menuPrefs?.hiddenTop;
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

export function getPromotedSet(player) {
  try {
    const core = getPlayerCore(player);
    const arr = core?.menuPrefs?.promoted;
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

export function setHiddenTopSet(player, set) {
  const core = getPlayerCore(player);
  _normalizeMenuPrefs(core);
  const valid = new Set(
    MENU_BUTTON_META.filter((m) => m.topLevel).map((m) => m.key),
  );
  core.menuPrefs.hiddenTop = [...set].filter((k) => valid.has(k));
  setPlayerCore(player, core);
}

export function setPromotedSet(player, set) {
  const core = getPlayerCore(player);
  _normalizeMenuPrefs(core);
  const valid = new Set(
    MENU_BUTTON_META.filter((m) => !m.topLevel).map((m) => m.key),
  );
  core.menuPrefs.promoted = [...set].filter((k) => valid.has(k));
  setPlayerCore(player, core);
}

export function resetPlayerMenuPrefs(player) {
  const core = getPlayerCore(player);
  core.menuPrefs = { hiddenTop: [], promoted: [] };
  setPlayerCore(player, core);
}

// ─── Render-time predicates ──────────────────────────────────────────────────

/** True if the player passes the perm/admin gate for this meta row. */
function _hasAccess(player, meta) {
  if (meta.adminOnly && !isAdmin(player).ok) return false;
  if (meta.perm) {
    const perms = Array.isArray(meta.perm) ? meta.perm : [meta.perm];
    if (!perms.some((p) => modCan(player, p))) return false;
  }
  return true;
}

/**
 * Should this TOP-LEVEL menu button render on the main admin panel?
 *   opts.ownerLayer ⇒ apply the cfg.menuVisibility gate
 *   opts.skipPerm   ⇒ caller already called modCan(), don't repeat
 *
 * Falls open on any error so a corrupt preference can never lock a staff
 * member out of the menu.
 */
export function isMenuButtonVisible(player, key, opts = {}) {
  try {
    const meta = MENU_BUTTON_META.find((m) => m.key === key);
    if (!meta) return true; // unknown keys never hide
    if (!opts.skipPerm && !_hasAccess(player, meta)) return false;
    if (opts.ownerLayer && isOwnerHidden(key)) return false;
    return !getHiddenTopSet(player).has(key);
  } catch {
    return true; // fail open
  }
}

/**
 * Returns the meta rows the player has promoted as main-page shortcuts.
 * Filters by perm and skips any sub-button whose top-level parent is owner-hidden.
 */
export function getPromotedRowsForPlayer(player) {
  try {
    const promoted = getPromotedSet(player);
    if (promoted.size === 0) return [];

    const ownerHiddenTopLevel = new Set(
      OWNER_LAYER_KEYS.filter((k) => isOwnerHidden(k)),
    );
    return MENU_BUTTON_META.filter((meta) => {
      if (meta.topLevel) return false;
      if (!promoted.has(meta.key)) return false;
      if (!_hasAccess(player, meta)) return false;
      const dotIdx = meta.key.indexOf(".");
      if (dotIdx > 0) {
        const parentKey = meta.key.slice(0, dotIdx);
        if (
          OWNER_LAYER_KEYS.includes(parentKey) &&
          ownerHiddenTopLevel.has(parentKey)
        ) {
          return false;
        }
      }
      return true;
    });
  } catch {
    return [];
  }
}

/**
 * Filter for the customize modal: returns the meta rows the player can actually
 * see (i.e. has perms for, parent isn't owner-hidden if it's a sub-button).
 *
 * Top-level rows themselves are always offered if the player has the perm —
 * even when owner-hidden — so the player can pre-toggle them in case the owner
 * re-enables later.
 */
export function getCustomizableRowsForPlayer(player) {
  const ownerHiddenTopLevel = new Set(
    OWNER_LAYER_KEYS.filter((k) => isOwnerHidden(k)),
  );
  return MENU_BUTTON_META.filter((meta) => {
    if (!_hasAccess(player, meta)) return false;
    if (!meta.topLevel) {
      const dotIdx = meta.key.indexOf(".");
      if (dotIdx > 0) {
        const parentKey = meta.key.slice(0, dotIdx);
        if (
          OWNER_LAYER_KEYS.includes(parentKey) &&
          ownerHiddenTopLevel.has(parentKey)
        ) {
          return false;
        }
      }
    }
    return true;
  });
}
