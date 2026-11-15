/**
 * ui-claims-admin.js — Admin-facing claim management UI
 *
 * Entry point: showClaimsAdmin(player)
 * Called from ui-admin.js Control Panel.
 */

import {
  ActionFormData,
  ModalFormData,
  MessageFormData,
  CustomForm,
  ObservableString,
  ObservableNumber,
  ObservableBoolean,
  DataDrivenScreenClosedReason,
} from "@minecraft/server-ui";
import { world, system } from "@minecraft/server";
import { t, raw } from "./i18n.js";
import { LIMITS, PROTECTION_DEFS, SAFE_ENTITY_TYPES } from "./constants.js";
import {
  tell,
  warnForm,
  confirmDiscardChanges,
  getPlayerXuid,
  fmtMs,
  nowMs,
  clampText,
  applyColorCodes,
  applyNewlines,
  renderClaimTemplate,
  findUnknownClaimPlaceholders,
  CLOSE_BTN_LABEL,
  CLOSE_BTN_ICON,
} from "./utils.js";
import {
  getCfg,
  setCfg,
  mutateCfg,
  queuePlayerNotif,
  getPlayerRegistry,
  setPlayerRegistry,
  getPlayerCore,
  setPlayerCore,
  DEFAULT_CLAIM_ENTER_MSG,
  DEFAULT_CLAIM_EXIT_MSG,
} from "./storage.js";
import { getClaimLog, clearClaimLog } from "./storage.js";
import { logAdmin } from "./log.js";
// Reuse the player-side welcome-message editor for admins (it edits claim.welcomeMsg
// for any claimId and takes a back navigator). player→admin already imports this way,
// so this back-edge is circular but safe — it's only called from a button handler.
import { showClaimWelcomeMsg, showEditMember } from "./ui-claims-player.js";
import {
  getAllClaims,
  getClaimById,
  deleteClaim,
  transferClaim,
  updateClaimProtections,
  updateClaimYBounds,
  visualizeClaimMerged,
  logClaimEvent,
  getPlayerClaimBudget,
  getSubClaimsByParent,
  deleteSubClaim,
  renameClaim,
  addMember,
  removeMember,
  addTrustedRank,
  removeTrustedRank,
  updateTrustedRank,
  MOD_TRUST_TAG,
  getParentClaimAt,
  getClaimAt,
  sweepStrayMarkers,
} from "./claims.js";
import { requireAdminOrModCan, isOwner } from "./permissions.js";
import { getRankDb } from "./rank-db.js";
import { showClaimsPlayer } from "./ui-claims-player.js";

const PAGE_SIZE = 10;

// Protection groups for the DDUI toggle editors (Claim Defaults & per-claim Edit
// Protections). Each toggle's ON state maps directly to the stored boolean —
// PROTECTION_DEFS labels are phrased so true = the protection is active. Vehicles
// and ejection are permissive flags (default off); the rest default on.
const PROTECTION_GROUPS = [
  {
    header: t("jm_at.cla.prot_group_blocks"),
    keys: ["blocks", "containers"],
  },
  {
    header: t("jm_at.cla.prot_group_players"),
    keys: [
      "entities",
      "allowVehicles",
      "pvp",
      "interactions",
      "itemUse",
      "ejectPlayers",
    ],
  },
  {
    header: t("jm_at.cla.prot_group_env"),
    keys: [
      "explosions",
      "hostileMobs",
      "cropTrampling",
      "fireSpread",
      "enderPearls",
    ],
  },
];
const _protLabel = (key) => t(PROTECTION_DEFS.find((d) => d.key === key).labelKey);
const _protDefault = (key, store) =>
  key === "allowVehicles" || key === "ejectPlayers"
    ? store[key] === true
    : store[key] !== false;

// Builds grouped protection toggles on `form`; returns a key→Observable map.
function buildProtectionToggles(form, store) {
  const obs = {};
  PROTECTION_GROUPS.forEach((g, gi) => {
    if (gi > 0) form.divider();
    form.spacer();
    form.header(g.header);
    form.spacer();
    for (const key of g.keys) {
      obs[key] = new ObservableBoolean(_protDefault(key, store), {
        clientWritable: true,
      });
      form.toggle(_protLabel(key), obs[key]);
    }
  });
  return obs;
}

// Reads a protection toggle map (from buildProtectionToggles) into a plain
// { key: bool } object covering every protection key, in group order.
function readProtectionToggles(obs) {
  const out = {};
  for (const g of PROTECTION_GROUPS)
    for (const key of g.keys) out[key] = obs[key].getData();
  return out;
}

// The saved baseline as a plain { key: bool } map (same group order as
// readProtectionToggles). Mirrors the per-key defaults buildProtectionToggles
// would seed for `store`, so a snapshot()===initial comparison is meaningful
// without needing a live form.
function baselineProtectionToggles(store) {
  const out = {};
  for (const g of PROTECTION_GROUPS)
    for (const key of g.keys) out[key] = _protDefault(key, store);
  return out;
}

// =========================================================
// Entry point
// =========================================================

export async function showClaimsAdmin(player, backFn) {
  try {
    requireAdminOrModCan(player, "claimsAdmin", "管理领地");
  } catch {
    return;
  }

  const allClaims = getAllClaims().filter(
    (c) => !c.parentId && (!c.ownerOnly || isOwner(player)),
  );
  const cfg = getCfg();
  const totalArea = allClaims.reduce((s, c) => s + (c.area ?? 0), 0);

  const form = new ActionFormData()
    .title(t("jm_at.cla.title"))
    .body(
      t(
        "jm_at.cla.hub_body",
        allClaims.length,
        _blocksToChunks(totalArea),
        cfg.maxClaimsPerPlayer,
        cfg.claimStartArea ?? 5,
        cfg.claimMaxArea ?? 15,
      ),
    )
    .button(t("jm_at.cla.btn_browse"), "textures/ui/jm_at_my_claims")
    .button(t("jm_at.cla.btn_settings"), "textures/ui/jm_at_control_panel")
    .button(
      t("jm_at.cla.btn_notifications"),
      "textures/ui/jm_at_claim_notification",
    )
    .button(t("jm_at.cla.btn_chunks"), "textures/ui/jm_at_add_or_remove")
    .button(t("jm_at.cla.btn_event_log"), "textures/ui/jm_at_admin_log")
    .button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back")
    .button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  // Default the Back target to the player claims menu. Browse/Search/Inspect
  // re-enter this hub without a backFn, so without this fallback the hub's Back
  // button would have nowhere to go and would close the menu instead.
  const goBack = backFn ?? (() => showClaimsPlayer(player));

  const res = await form.show(player);
  if (res.canceled) return goBack(); // X = Back
  if (res.selection === 5) return goBack(); // Back
  if (res.selection === 6) return; // Close
  if (res.selection === 0) return showBrowseClaims(player, 0);
  if (res.selection === 1) return showClaimSettingsMenu(player);
  if (res.selection === 2) return showClaimNotificationsEditor(player);
  if (res.selection === 3) return showChunkAdjustPicker(player);
  if (res.selection === 4) return showClaimEventLog(player, 0);
}

// =========================================================
// Browse all claims (paginated)
// =========================================================

async function showBrowseClaims(player, page, filterOwner) {
  let all = getAllClaims().filter(
    (c) => !c.parentId && (!c.ownerOnly || isOwner(player)),
  );
  if (filterOwner) all = all.filter((c) => c.ownerName === filterOwner);
  all.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const total = all.length;
  const start = page * PAGE_SIZE;
  const slice = all.slice(start, start + PAGE_SIZE);

  const form = new ActionFormData()
    .title(t("jm_at.cla.browse_title", total))
    .body(
      raw(
        t("jm_at.cla.page_of", page + 1, Math.ceil(total / PAGE_SIZE) || 1),
        filterOwner ? raw("\n", t("jm_at.cla.filtered", filterOwner)) : "",
      ),
    );

  // Search button is always first (index 0)
  form.button(
    filterOwner
      ? t("jm_at.cla.btn_clear_filter", filterOwner)
      : t("jm_at.cla.btn_search_player"),
    "textures/ui/jm_at_search_info",
  );

  // Owner-Only claims are filtered out of the list above for non-owners; apply
  // the same gate to the "Current claim" shortcut so a non-owner admin standing
  // inside an Owner-Only claim can't open its Inspect panel through this button.
  const _rawCurrentClaim = getParentClaimAt(
    player.dimension.id,
    player.location,
  );
  const currentClaim =
    _rawCurrentClaim && (!_rawCurrentClaim.ownerOnly || isOwner(player))
      ? _rawCurrentClaim
      : null;
  const hasCurrentBtn = !!currentClaim;
  if (hasCurrentBtn) {
    form.button(
      t(
        "jm_at.cla.btn_current_claim",
        _trimName(currentClaim.name || currentClaim.id),
      ),
      "textures/ui/jm_at_position",
    );
  }

  for (const c of slice) {
    const name = c.name ? c.name : c.id;
    form.button(
      t(
        "jm_at.cla.btn_claim_row",
        _trimName(name),
        c.ownerName,
        _blocksToChunks(c.area),
        _fmtDimShort(c.dimension),
      ),
      c.ownerOnly
        ? "textures/ui/jm_at_owner_claims"
        : c.isAdminClaim
          ? "textures/ui/jm_at_admin_claims"
          : "textures/ui/jm_at_my_claims",
    );
  }

  const extraBtns = [];
  if (start > 0) {
    extraBtns.push("prev");
    form.button(t("jm_at.cla.btn_prev"), "textures/ui/jm_at_back");
  }
  if (start + PAGE_SIZE < total) {
    extraBtns.push("next");
    form.button(t("jm_at.cla.btn_next"), "textures/ui/jm_at_next");
  }
  extraBtns.push("back");
  form.button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back");
  extraBtns.push("close");
  form.button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showClaimsAdmin(player); // X = Back

  // Index 0 = search/clear filter button
  if (res.selection === 0) {
    if (filterOwner) return showBrowseClaims(player, 0);
    return showPlayerFilter(player);
  }

  // Index 1 = current claim button (if present)
  if (hasCurrentBtn && res.selection === 1)
    return showClaimInspect(player, currentClaim.id, page, filterOwner);

  const headerBtns = 1 + (hasCurrentBtn ? 1 : 0); // search + optional current
  const claimIdx = res.selection - headerBtns;
  if (claimIdx >= 0 && claimIdx < slice.length)
    return showClaimInspect(player, slice[claimIdx].id, page, filterOwner);

  const extra = extraBtns[claimIdx - slice.length];
  if (extra === "close") return;
  if (extra === "prev") return showBrowseClaims(player, page - 1, filterOwner);
  if (extra === "next") return showBrowseClaims(player, page + 1, filterOwner);
  return showClaimsAdmin(player);
}

async function showPlayerFilter(player) {
  const reg = getPlayerRegistry();
  const entries = Object.entries(reg)
    .map(([xuid, e]) => ({ xuid, name: e.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const items =
    entries.length > 0
      ? entries.map((e, i) => ({ label: e.name, value: i }))
      : [{ label: t("jm_at.cla.opt_none"), value: 0 }];

  const typedObs = new ObservableString("", { clientWritable: true });
  const pickObs = new ObservableNumber(0, { clientWritable: true });
  const status = new ObservableString("");
  const statusShown = new ObservableBoolean(false);
  let pendingNav = null;
  let intent = null;
  const back = () => showBrowseClaims(player, 0);
  const fail = (m) => {
    status.setData(m);
    statusShown.setData(true);
  };

  const form = new CustomForm(player, t("jm_at.cla.filter_title"));
  form.textField(t("jm_at.cla.filter_type_name"), typedObs);
  form.dropdown(t("jm_at.cla.filter_pick_known"), pickObs, items);
  form.spacer();
  form.label(status, { visible: statusShown });
  form.spacer({ visible: statusShown });
  form.button(t("jm_at.cla.btn_filter"), () => {
    const typed = clampText(typedObs.getData().trim(), 50);
    let selectedName;
    if (typed) {
      const lower = typed.toLowerCase();
      const entry = entries.find((e) => (e.name ?? "").toLowerCase() === lower);
      if (!entry) {
        fail(`§c找不到名为“${typed}”的玩家。`);
        return;
      }
      selectedName = entry.name;
    } else {
      if (entries.length === 0) {
        fail("§c暂无已记录的玩家可供选择，请直接输入名称。");
        return;
      }
      selectedName = entries[pickObs.getData()]?.name;
      if (!selectedName) {
        fail("§c请选择一名玩家或输入名称。");
        return;
      }
    }
    pendingNav = () => showBrowseClaims(player, 0, selectedName);
    try {
      form.close();
    } catch {}
  });
  form.button(t("jm_at.common.btn_back"), () => {
    intent = "back";
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(() => showPlayerFilter(player));
  }
  if (pendingNav) return system.run(pendingNav);
  if (intent === "back") return system.run(back); // Back -> up one level; X / escape -> exit
}

// =========================================================
// Claim inspect (admin view)
// =========================================================

async function showClaimInspect(player, claimId, page = 0, filterOwner) {
  const claim = getClaimById(claimId);
  if (!claim) {
    return warnForm(player, t("jm_at.cla.warn_claim_gone"), () =>
      showClaimsAdmin(player),
    );
  }

  // Hard guard: Owner-Only claims may only be inspected/managed by the Server
  // Owner — never by another admin or moderator, regardless of how this screen
  // was reached. This backs up the list/button filters in showBrowseClaims.
  if (claim.ownerOnly && !isOwner(player)) {
    return warnForm(player, t("jm_at.cla.warn_owner_only"), () =>
      showClaimsAdmin(player),
    );
  }

  const isSub = !!claim.parentId;
  const isDeepest = isSub && !!getClaimById(claim.parentId)?.parentId;
  const canHaveSubs = !isDeepest;
  const subCount = canHaveSubs ? getSubClaimsByParent(claimId).length : 0;
  const welcomeEnabled = getCfg().claimWelcomeMsgEnabled !== false;
  const displayName = claim.name ? raw("§l", claim.name, "§r") : claim.id;
  const prots = claim.protections;
  const protParts = [
    prots.blocks ? t("jm_at.cla.prot_blocks") : null,
    prots.containers ? t("jm_at.cla.prot_containers") : null,
    prots.entities ? t("jm_at.cla.prot_entities") : null,
    prots.allowVehicles ? t("jm_at.cla.prot_vehicles") : null,
    prots.pvp ? t("jm_at.cla.prot_pvp") : null,
    prots.interactions ? t("jm_at.cla.prot_interactions") : null,
    prots.itemUse ? t("jm_at.cla.prot_item_use") : null,
    prots.explosions ? t("jm_at.cla.prot_explosions") : null,
    prots.hostileMobs ? t("jm_at.cla.prot_hostile_mobs") : null,
    prots.cropTrampling ? t("jm_at.cla.prot_crop_trampling") : null,
    prots.fireSpread ? t("jm_at.cla.prot_fire_spread") : null,
    prots.enderPearls ? t("jm_at.cla.prot_ender_pearls") : null,
    prots.ejectPlayers ? t("jm_at.cla.prot_eject_players") : null,
  ].filter(Boolean);
  const protStr = protParts.length
    ? raw(...protParts.flatMap((p, i) => (i > 0 ? [", ", p] : [p])))
    : t("jm_at.cla.prot_none");

  const form = new ActionFormData()
    .title(
      isSub ? t("jm_at.cla.inspect_title_sub") : t("jm_at.cla.inspect_title"),
    )
    .body(
      raw(
        displayName,
        "\n",
        t("jm_at.cla.inspect_owner", claim.ownerName),
        "\n",
        t(
          "jm_at.cla.inspect_dim_area",
          _fmtDimShort(claim.dimension),
          _blocksToChunks(claim.area),
        ),
        "\n",
        t(
          "jm_at.cla.inspect_min",
          Math.floor(claim.min.x),
          Math.floor(claim.min.y),
          Math.floor(claim.min.z),
        ),
        "\n",
        t(
          "jm_at.cla.inspect_max",
          Math.floor(claim.max.x),
          Math.floor(claim.max.y),
          Math.floor(claim.max.z),
        ),
        "\n",
        t(
          "jm_at.cla.inspect_counts",
          claim.members.length,
          claim.trustedRanks.length,
        ),
        "\n",
        t("jm_at.cla.inspect_prots", protStr),
        "\n",
        t("jm_at.cla.inspect_created", fmtMs(claim.createdAt)),
      ),
    )
    .button(
      t("jm_at.cla.btn_view_boundary"),
      "textures/ui/jm_at_claim_viewer_icon",
    )
    .button(t("jm_at.cla.btn_edit_prots"), "textures/ui/jm_at_server_controls");

  if (!isSub)
    form.button(
      t("jm_at.cla.btn_adjust_height"),
      "textures/ui/jm_at_claim_height",
    );
  if (!isSub)
    form.button(t("jm_at.cla.btn_transfer"), "textures/ui/jm_at_transfer");
  if (canHaveSubs)
    form.button(
      t("jm_at.cla.btn_subclaims", subCount),
      "textures/ui/jm_at_sub_claim",
    );

  form
    .button(
      t("jm_at.cla.btn_members", claim.members.length),
      "textures/ui/jm_at_players",
    )
    .button(
      t("jm_at.cla.btn_trusted_ranks", claim.trustedRanks.length),
      "textures/ui/jm_at_rank",
    )
    .button(t("jm_at.cla.btn_rename"), "textures/ui/jm_at_admin_note");
  if (welcomeEnabled)
    form.button(
      t("jm_at.cla.btn_welcome"),
      "textures/ui/jm_at_claim_notification",
    );
  form
    .button(t("jm_at.cla.btn_force_delete"), "textures/ui/jm_at_remove")
    .button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back")
    .button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const goBack = () =>
    isSub
      ? showAdminSubClaims(player, claim.parentId, page, filterOwner)
      : showBrowseClaims(player, page, filterOwner);

  const res = await form.show(player);
  if (res.canceled) return goBack(); // X = Back

  const back = () => showClaimInspect(player, claimId, page, filterOwner);
  let idx = res.selection;
  if (idx === 0) {
    const pid = isDeepest
      ? "jm_at:sub_sub_claim_particles"
      : isSub
        ? "jm_at:sub_claim_particles"
        : "jm_at:viewer_particles";
    visualizeClaimMerged(
      player,
      claim,
      player.location.y,
      pid,
      isSub ? 3 : 2,
      -3,
      false,
    );
    tell(player, t("jm_at.cla.msg_boundary_shown"));
    return;
  }
  if (idx === 1) return showEditProtections(player, claimId, page, filterOwner);

  let btnIdx = 2;
  if (!isSub) {
    if (idx === btnIdx)
      return showAdminAdjustHeight(player, claimId, page, filterOwner);
    btnIdx++;
    if (idx === btnIdx)
      return showTransferOwnership(player, claimId, page, filterOwner);
    btnIdx++;
  }
  if (canHaveSubs) {
    if (idx === btnIdx)
      return showAdminSubClaims(player, claimId, page, filterOwner);
    btnIdx++;
  }
  if (idx === btnIdx) return showAdminMembers(player, claimId, back);
  btnIdx++;
  if (idx === btnIdx) return showAdminTrustedRanks(player, claimId, back);
  btnIdx++;
  if (idx === btnIdx)
    return showAdminRename(player, claimId, page, filterOwner);
  btnIdx++;
  if (welcomeEnabled) {
    if (idx === btnIdx) return showClaimWelcomeMsg(player, claimId, back);
    btnIdx++;
  }
  if (idx === btnIdx)
    return showForceDelete(player, claimId, page, filterOwner);
  btnIdx++;
  // Back
  if (idx === btnIdx) return goBack();
  btnIdx++;
  // Close
  if (idx === btnIdx) return;
}

// =========================================================
// Admin sub-claims list
// =========================================================

async function showAdminSubClaims(
  player,
  parentClaimId,
  page = 0,
  filterOwner,
) {
  const parent = getClaimById(parentClaimId);
  if (!parent) return showClaimsAdmin(player);

  const subs = getSubClaimsByParent(parentClaimId);
  subs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const form = new ActionFormData()
    .title(t("jm_at.cla.subclaims_title"))
    .body(
      raw(
        parent.name || parent.id,
        "\n",
        t("jm_at.cla.subclaims_count", subs.length),
      ),
    );

  const mostSpecific = getClaimAt(player.dimension.id, player.location);
  const currentSub =
    mostSpecific && mostSpecific.parentId === parentClaimId
      ? mostSpecific
      : null;
  const hasCurrentBtn = !!currentSub;
  if (hasCurrentBtn) {
    form.button(
      t(
        "jm_at.cla.btn_current_sub",
        _trimName(currentSub.name || currentSub.id),
      ),
      "textures/ui/jm_at_position",
    );
  }

  for (const s of subs) {
    form.button(
      t(
        "jm_at.cla.btn_sub_row",
        _trimName(s.name ? s.name : s.id),
        _blocksToChunks(s.area),
      ),
      "textures/ui/jm_at_sub_claim",
    );
  }
  form.button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back");
  form.button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled)
    return showClaimInspect(player, parentClaimId, page, filterOwner); // X = Back

  const off = hasCurrentBtn ? 1 : 0;
  if (hasCurrentBtn && res.selection === 0)
    return showClaimInspect(player, currentSub.id, page, filterOwner);
  if (res.selection === subs.length + off)
    return showClaimInspect(player, parentClaimId, page, filterOwner); // Back
  if (res.selection === subs.length + off + 1) return; // Close

  if (res.selection >= off && res.selection < subs.length + off) {
    return showClaimInspect(
      player,
      subs[res.selection - off].id,
      page,
      filterOwner,
    );
  }
}

// =========================================================
// Edit protections
// =========================================================

export async function showEditProtections(
  player,
  claimId,
  page = 0,
  filterOwner,
  backFn,
  draft = null,
) {
  const claim = getClaimById(claimId);
  if (!claim) return showClaimsAdmin(player);

  const goBack =
    backFn ?? (() => showClaimInspect(player, claimId, page, filterOwner));

  const p = claim.protections;

  const form = new CustomForm(player, t("jm_at.cla.edit_prots_title"));
  // Seed from the draft when present so a UserBusy bounce / Keep editing
  // preserves in-progress toggles; otherwise seed from the saved protections.
  const obs = buildProtectionToggles(form, draft ?? p);

  let pendingNav = null;
  let intent = null;
  const reopen = () =>
    showEditProtections(
      player,
      claimId,
      page,
      filterOwner,
      backFn,
      readProtectionToggles(obs),
    );
  const snapshot = () => JSON.stringify(readProtectionToggles(obs));
  // SAVED baseline (the original protections), NOT snapshot() — element order
  // matches readProtectionToggles().
  const initial = JSON.stringify(baselineProtectionToggles(p));

  const save = (close) => {
    if (snapshot() === initial) {
      tell(player, t("jm_at.cla.msg_no_changes"));
    } else {
      updateClaimProtections(claimId, readProtectionToggles(obs));
      tell(player, t("jm_at.cla.msg_prots_updated"));
    }
    pendingNav = close ? () => {} : goBack;
    try {
      form.close();
    } catch {}
  };
  form.spacer();
  form.button(t("jm_at.common.btn_save"), () => save(false));
  form.button(t("jm_at.cla.btn_save_close"), () => save(true));
  form.button(t("jm_at.common.btn_back"), () => {
    intent = "back";
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(reopen);
  }
  if (pendingNav) return system.run(pendingNav);
  if (snapshot() !== initial) {
    return system.run(async () => {
      if (await confirmDiscardChanges(player)) return reopen();
      if (intent === "back") return goBack();
    });
  }
  if (intent === "back") return system.run(goBack); // Back -> up one level; X / escape -> exit
}

// =========================================================
// Transfer ownership
// =========================================================

export async function showTransferOwnership(
  player,
  claimId,
  page = 0,
  filterOwner,
  backFn,
) {
  const claim = getClaimById(claimId);
  if (!claim) return showClaimsAdmin(player);

  const goBack =
    backFn ?? (() => showClaimInspect(player, claimId, page, filterOwner));

  const reg = getPlayerRegistry();
  const entries = Object.entries(reg)
    .map(([xuid, e]) => ({ xuid, name: e.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const currentIdx = entries.findIndex((e) => e.xuid === claim.ownerXuid);

  const nameObs = new ObservableString("", { clientWritable: true });
  const pickObs = new ObservableNumber(Math.max(0, currentIdx), {
    clientWritable: true,
  });
  const status = new ObservableString("");
  const statusShown = new ObservableBoolean(false);
  const fail = (m) => {
    status.setData(m);
    statusShown.setData(true);
  };
  let pendingNav = null;
  let intent = null;

  const playerItems =
    entries.length > 0
      ? entries.map((e, i) => ({
          label: String(e.name).replace(/§./g, ""),
          value: i,
        }))
      : [{ label: t("jm_at.cla.opt_none"), value: 0 }];

  const form = new CustomForm(player, t("jm_at.cla.transfer_title"));
  form.spacer();
  form.label(
    t("jm_at.cla.transfer_info", claim.name || claim.id, claim.ownerName),
  );
  form.spacer();
  form.label(t("jm_at.cla.pick_hint"));
  form.spacer();
  form.textField(t("jm_at.cla.field_player_name"), nameObs, {
    description: t("jm_at.cla.field_leave_blank"),
  });
  form.dropdown(t("jm_at.cla.pick_known"), pickObs, playerItems);
  form.spacer();
  form.label(status, { visible: statusShown });
  form.spacer({ visible: statusShown });

  form.button(t("jm_at.cla.btn_transfer_go"), () => {
    const typed = (nameObs.getData() ?? "").trim();
    let selectedXuid, selectedName;
    if (typed) {
      const lower = typed.toLowerCase();
      const entry = Object.values(reg).find(
        (e) => (e.name ?? "").toLowerCase() === lower,
      );
      if (!entry)
        return fail(
          `§c找不到名为“${typed}”的玩家，对方必须至少加入过此世界一次。`,
        );
      selectedXuid = entry.xuid;
      selectedName = entry.name;
    } else {
      if (entries.length === 0)
        return fail("§c暂无已记录的玩家，请直接输入名称。");
      const idx = pickObs.getData();
      if (idx < 0 || idx >= entries.length)
        return fail("§c请从列表选择玩家，或直接输入名称。");
      selectedXuid = entries[idx].xuid;
      selectedName = entries[idx].name;
    }
    if (selectedXuid === claim.ownerXuid)
      return fail("§e该玩家已是此领地的主人。");
    pendingNav = () =>
      showConfirmTransfer(
        player,
        claimId,
        selectedXuid,
        selectedName,
        page,
        filterOwner,
        backFn,
      );
    try {
      form.close();
    } catch {}
  });
  form.button(t("jm_at.common.btn_back"), () => {
    intent = "back";
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(() =>
      showTransferOwnership(player, claimId, page, filterOwner, backFn),
    );
  }
  if (pendingNav) return system.run(pendingNav);
  if (intent === "back") return system.run(goBack); // Back -> up one level; X / escape -> exit
}

async function showConfirmTransfer(
  player,
  claimId,
  newXuid,
  newName,
  page = 0,
  filterOwner,
  backFn,
) {
  const claim = getClaimById(claimId);
  if (!claim) return showClaimsAdmin(player);

  const goBack =
    backFn ?? (() => showClaimInspect(player, claimId, page, filterOwner));

  const form = new MessageFormData()
    .title(t("jm_at.cla.confirm_transfer_title"))
    .body(
      t(
        "jm_at.cla.confirm_transfer_body",
        claim.name || claim.id,
        claim.ownerName,
        newName,
      ),
    )
    .button1(t("jm_at.common.btn_cancel"))
    .button2(t("jm_at.cla.btn_transfer_confirm"));

  const res = await form.show(player);
  if (res.canceled || res.selection === 0)
    return showTransferOwnership(player, claimId, page, filterOwner, backFn);

  const oldOwnerXuid = claim.ownerXuid;
  const oldOwnerName = claim.ownerName;
  transferClaim(claimId, newXuid, newName, player);

  queuePlayerNotif(
    oldOwnerXuid,
    `§e[领地] 管理员已将您的领地“${claim.name || claim.id}”转让给 ${newName}。`,
  );
  queuePlayerNotif(
    newXuid,
    `§2[领地] 管理员已将 ${oldOwnerName} 的领地“${claim.name || claim.id}”转让给您。`,
  );
  tell(player, t("jm_at.cla.msg_transferred", newName));
  return goBack();
}

// =========================================================
// Force delete
// =========================================================

export async function showForceDelete(
  player,
  claimId,
  page = 0,
  filterOwner,
  backFn,
) {
  const claim = getClaimById(claimId);
  if (!claim) return showClaimsAdmin(player);

  const goBack =
    backFn ?? (() => showClaimInspect(player, claimId, page, filterOwner));
  const isSub = !!claim.parentId;
  const directSubs = getSubClaimsByParent(claimId);
  let descendantCount = directSubs.length;
  for (const s of directSubs)
    descendantCount += getSubClaimsByParent(s.id).length;

  const form = new MessageFormData()
    .title(
      isSub
        ? t("jm_at.cla.force_delete_title_sub")
        : t("jm_at.cla.force_delete_title"),
    )
    .body(
      raw(
        t("jm_at.cla.force_delete_q", claim.name || claim.id, claim.ownerName),
        descendantCount > 0
          ? t("jm_at.cla.force_delete_nested", descendantCount)
          : "",
        t("jm_at.cla.force_delete_tail"),
      ),
    )
    .button1(t("jm_at.common.btn_cancel"))
    .button2(t("jm_at.cla.btn_delete_red"));

  const res = await form.show(player);
  if (res.canceled || res.selection === 0) return goBack();

  if (isSub) {
    const parentId = claim.parentId;
    deleteSubClaim(claimId, player);
    queuePlayerNotif(
      claim.ownerXuid,
      `§c[领地] 管理员已删除您的子领地“${claim.name || claim.id}”。`,
    );
    tell(player, t("jm_at.cla.msg_sub_deleted"));
    // After deleting a sub-claim, go back to the parent claim detail if backFn is set,
    // otherwise fall through to the admin sub-claims list as usual.
    return backFn
      ? backFn()
      : showAdminSubClaims(player, parentId, page, filterOwner);
  }

  deleteClaim(claimId, player, true);
  queuePlayerNotif(
    claim.ownerXuid,
    `§c[领地] 管理员已删除您的领地“${claim.name || claim.id}”。`,
  );
  tell(player, t("jm_at.cla.msg_claim_deleted"));
  // After deleting a top-level claim, go back one level (the list that spawned this detail).
  return backFn ? backFn() : showBrowseClaims(player, page, filterOwner);
}

// =========================================================
// Adjust height (admin)
// =========================================================

export async function showAdminAdjustHeight(
  player,
  claimId,
  page = 0,
  filterOwner,
  backFn,
  draft = null,
) {
  const claim = getClaimById(claimId);
  if (!claim) return showClaimsAdmin(player);

  const goBack =
    backFn ?? (() => showClaimInspect(player, claimId, page, filterOwner));

  const hRange = _dimHeightRange(claim.dimension);
  // Seed from the draft when present (UserBusy bounce / Keep editing);
  // otherwise from the claim's saved Y bounds.
  const minObs = new ObservableNumber(
    draft ? draft.min : Math.floor(claim.min.y),
    { clientWritable: true },
  );
  const maxObs = new ObservableNumber(
    draft ? draft.max : Math.floor(claim.max.y),
    { clientWritable: true },
  );
  const status = new ObservableString("");
  const statusShown = new ObservableBoolean(false);

  const form = new CustomForm(player, t("jm_at.cla.adjust_height_title"));
  form.spacer();
  form.slider(
    t("jm_at.cla.slider_min_y", hRange.min),
    minObs,
    hRange.min,
    hRange.max,
    { step: 1 },
  );
  form.slider(
    t("jm_at.cla.slider_max_y", hRange.max),
    maxObs,
    hRange.min,
    hRange.max,
    { step: 1 },
  );
  form.spacer();
  form.label(status, { visible: statusShown });
  form.spacer({ visible: statusShown });

  let pendingNav = null;
  let intent = null;
  const reopen = () =>
    showAdminAdjustHeight(player, claimId, page, filterOwner, backFn, {
      min: minObs.getData(),
      max: maxObs.getData(),
    });
  const snapshot = () => JSON.stringify([minObs.getData(), maxObs.getData()]);
  // SAVED baseline from the claim's stored Y bounds, NOT snapshot().
  const initial = JSON.stringify([
    Math.floor(claim.min.y),
    Math.floor(claim.max.y),
  ]);

  const save = (close) => {
    const newMinY = Math.round(minObs.getData());
    const newMaxY = Math.round(maxObs.getData());
    if (newMinY >= newMaxY) {
      status.setData("§c最低高度必须小于最高高度。");
      statusShown.setData(true);
      return;
    }
    updateClaimYBounds(claimId, newMinY, newMaxY);
    tell(player, t("jm_at.cla.msg_height_updated", newMinY, newMaxY));
    pendingNav = close ? () => {} : goBack;
    try {
      form.close();
    } catch {}
  };
  form.button(t("jm_at.common.btn_save"), () => save(false));
  form.button(t("jm_at.cla.btn_save_close"), () => save(true));
  form.button(t("jm_at.common.btn_back"), () => {
    intent = "back";
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(reopen);
  }
  if (pendingNav) return system.run(pendingNav);
  if (snapshot() !== initial) {
    return system.run(async () => {
      if (await confirmDiscardChanges(player)) return reopen();
      if (intent === "back") return goBack();
    });
  }
  if (intent === "back") return system.run(goBack); // Back -> up one level; X / escape -> exit
}

// =========================================================
// Claim settings submenu
// =========================================================

async function showClaimSettingsMenu(player) {
  const form = new ActionFormData()
    .title(t("jm_at.cla.settings_title"))
    .body(t("jm_at.cla.settings_body"))
    .button(t("jm_at.cla.btn_config"), "textures/ui/jm_at_control_panel")
    .button(t("jm_at.cla.btn_defaults"), "textures/ui/jm_at_server_controls")
    .button(t("jm_at.cla.btn_abilities"), "textures/ui/jm_at_players")
    .button(
      t("jm_at.cla.btn_default_height"),
      "textures/ui/jm_at_claim_height",
    )
    .button(t("jm_at.cla.btn_mob_list"), "textures/ui/jm_at_blacklist")
    .button(t("jm_at.cla.btn_clear_stray"), "textures/ui/jm_at_clear_stray")
    .button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back")
    .button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showClaimsAdmin(player); // X = Back
  if (res.selection === 6) return showClaimsAdmin(player); // Back
  if (res.selection === 7) return; // Close
  if (res.selection === 0) return showClaimSettings(player);
  if (res.selection === 1) return showClaimDefaults(player);
  if (res.selection === 2) return showPlayerAbilities(player);
  if (res.selection === 3) return showDefaultClaimHeight(player);
  if (res.selection === 4) return showMobBlacklist(player);
  if (res.selection === 5) {
    // Force-remove every claim-selection marker in loaded chunks (including any
    // not tracked by an active selection). Markers in unloaded chunks are reaped
    // automatically by the periodic sweep as those chunks load.
    let removed = 0;
    try {
      removed = sweepStrayMarkers(true);
    } catch {}
    // lang-keys: jm_at.cla.msg_stray_cleared_one jm_at.cla.msg_stray_cleared
    tell(
      player,
      t(
        removed === 1
          ? "jm_at.cla.msg_stray_cleared_one"
          : "jm_at.cla.msg_stray_cleared",
        removed,
      ),
    );
    return showClaimSettingsMenu(player);
  }
}

// =========================================================
// Claim notifications (entry/exit messages)
// =========================================================

async function showClaimNotificationsEditor(player, draft = null) {
  const cfg = getCfg();

  // Anti-spam delay as a dropdown (Bedrock sliders are unreliable with
  // fractional steps, and explicit labels read better for everyone).
  const cooldownChoices = [0, 0.5, 1, 1.5, 2, 3, 5];
  const cooldownLabels = [
    t("jm_at.cla.cooldown_off"),
    t("jm_at.cla.cooldown_0_5s"),
    t("jm_at.cla.cooldown_1s"),
    t("jm_at.cla.cooldown_1_5s"),
    t("jm_at.cla.cooldown_2s"),
    t("jm_at.cla.cooldown_3s"),
    t("jm_at.cla.cooldown_5s"),
  ];
  let cooldownIdx = cooldownChoices.indexOf(cfg.claimNotifCooldownSec ?? 1.5);
  if (cooldownIdx === -1) cooldownIdx = cooldownChoices.indexOf(1.5);

  const displayChoices = ["actionbar", "title", "chat"];
  // Plain English: feeds the ObservableString live preview via setData(),
  // which cannot carry RawMessages (stays in the server's language).
  const displayLabels = ["动作栏（屏幕下方）", "标题（中央弹出）", "聊天栏"];
  // Localized variants for the dropdown items.
  const displayItemLabels = [
    t("jm_at.cla.display_actionbar"),
    t("jm_at.cla.display_title"),
    t("jm_at.cla.display_chat"),
  ];
  let displayIdx = displayChoices.indexOf(cfg.claimNotifDisplay ?? "actionbar");
  if (displayIdx === -1) displayIdx = 0;

  // Original saved seeds, used both for the live observables (when no draft)
  // and for the `initial` dirty-check baseline.
  const seedOn = cfg.claimNotificationsEnabled !== false;
  const seedCooldown = cooldownIdx;
  const seedDisplay = displayIdx;
  const seedEnter = cfg.claimEnterMsg || DEFAULT_CLAIM_ENTER_MSG;
  const seedExit = cfg.claimExitMsg || DEFAULT_CLAIM_EXIT_MSG;

  // Seed from the draft when present (UserBusy bounce / Keep editing).
  const onObs = new ObservableBoolean(draft ? !!draft.on : seedOn, {
    clientWritable: true,
  });
  const cooldownObs = new ObservableNumber(
    draft ? draft.cooldown : seedCooldown,
    { clientWritable: true },
  );
  const displayObs = new ObservableNumber(draft ? draft.display : seedDisplay, {
    clientWritable: true,
  });
  const enterObs = new ObservableString(draft ? draft.enter : seedEnter, {
    clientWritable: true,
  });
  const exitObs = new ObservableString(draft ? draft.exit : seedExit, {
    clientWritable: true,
  });

  // Live preview, rendered with sample data so colors/placeholders resolve
  // exactly as in-game, plus a warning for any unrecognized {tags}.
  const sample = {
    owner: "示例玩家的领地",
    ownerName: "示例玩家",
    name: " §7（§f基地§7）",
    claimName: "基地",
    restricted: " §c| 禁止建造：放置的潜影盒会被破坏",
  };
  const shownIn = new ObservableString("");
  const previewEnter = new ObservableString("");
  const previewExit = new ObservableString("");
  const warnText = new ObservableString("");
  const warnShown = new ObservableBoolean(false);
  // Render a message exactly as the selected channel will: the Title popup and
  // Chat honor \n line breaks, the single-line action bar collapses them to spaces.
  const renderForChannel = (rawTemplate, def) => {
    const text = renderClaimTemplate(applyColorCodes(rawTemplate || def), sample);
    const channel = displayChoices[displayObs.getData()] ?? "actionbar";
    return channel === "actionbar"
      ? text.replace(/\\n/g, " ").trim()
      : applyNewlines(text);
  };
  const refreshPreview = () => {
    shownIn.setData(
      `§7显示位置：${displayLabels[displayObs.getData()] ?? displayLabels[0]}`,
    );
    previewEnter.setData(
      "§l§2进入消息§r\n" +
        renderForChannel(enterObs.getData(), DEFAULT_CLAIM_ENTER_MSG),
    );
    previewExit.setData(
      "§l§2离开消息§r\n" +
        renderForChannel(exitObs.getData(), DEFAULT_CLAIM_EXIT_MSG),
    );
    const unknown = findUnknownClaimPlaceholders(enterObs.getData() || "");
    if (unknown.length) {
      warnText.setData(
        "§e以下标签无法识别，已移除：\n" +
          unknown
            .map((u) =>
              u.suggestion
                ? `§c{${u.tag}}§7→§2{${u.suggestion}}§7（是否要使用此标签？）`
                : `§c{${u.tag}}§7（未知标签）`,
            )
            .join("\n"),
      );
      warnShown.setData(true);
    } else {
      warnText.setData("");
      warnShown.setData(false);
    }
  };
  refreshPreview();
  enterObs.subscribe(refreshPreview);
  exitObs.subscribe(refreshPreview);
  displayObs.subscribe(refreshPreview);

  const cooldownItems = cooldownLabels.map((l, i) => ({ label: l, value: i }));
  const displayItems = displayItemLabels.map((l, i) => ({
    label: l,
    value: i,
  }));

  const form = new CustomForm(player, t("jm_at.cla.notif_title"));
  form.spacer();
  form.header(t("jm_at.cla.notif_h_default"));
  form.spacer();
  form.label(t("jm_at.cla.notif_default_info"));
  form.spacer();
  form.toggle(t("jm_at.cla.notif_toggle_show"), onObs);
  form.spacer();
  form.header(t("jm_at.cla.notif_h_timing"));
  form.spacer();
  form.dropdown(t("jm_at.cla.notif_dd_cooldown"), cooldownObs, cooldownItems);
  form.dropdown(t("jm_at.cla.notif_dd_display"), displayObs, displayItems);
  form.spacer();
  form.header(t("jm_at.cla.notif_h_text"));
  form.spacer();
  form.label(t("jm_at.cla.notif_tags_info", "\\n"));
  form.spacer();
  form.textField(t("jm_at.cla.notif_field_enter"), enterObs);
  form.textField(t("jm_at.cla.notif_field_exit"), exitObs);
  form.spacer();
  form.header(t("jm_at.cla.notif_h_preview"));
  form.spacer();
  form.label(shownIn);
  form.spacer();
  form.label(previewEnter);
  form.spacer();
  form.label(previewExit);
  form.spacer();
  form.label(warnText, { visible: warnShown });
  form.spacer({ visible: warnShown });
  form.label(t("jm_at.cla.notif_sample_note"));

  let pendingNav = null;
  let intent = null;
  const back = () => showClaimsAdmin(player);
  const reopen = () =>
    showClaimNotificationsEditor(player, {
      on: onObs.getData(),
      cooldown: cooldownObs.getData(),
      display: displayObs.getData(),
      enter: enterObs.getData(),
      exit: exitObs.getData(),
    });
  const snapshot = () =>
    JSON.stringify([
      onObs.getData(),
      cooldownObs.getData(),
      displayObs.getData(),
      enterObs.getData(),
      exitObs.getData(),
    ]);
  // SAVED baseline from the original seeds, NOT snapshot() (which would reflect
  // a draft). Element order matches snapshot().
  const initial = JSON.stringify([
    seedOn,
    seedCooldown,
    seedDisplay,
    seedEnter,
    seedExit,
  ]);

  const save = (close) => {
    const enabled = onObs.getData();
    const newEnter = String(enterObs.getData() ?? "").trim();
    const newExit = String(exitObs.getData() ?? "").trim();
    // Save only the keys this screen owns, so a change made elsewhere while the
    // form was open (another admin, or a timer) isn't reverted.
    mutateCfg((c) =>
      Object.assign(c, {
        claimNotificationsEnabled: enabled,
        claimNotifCooldownSec: cooldownChoices[cooldownObs.getData()] ?? 1.5,
        claimNotifDisplay: displayChoices[displayObs.getData()] ?? "actionbar",
        claimEnterMsg: newEnter || DEFAULT_CLAIM_ENTER_MSG,
        claimExitMsg: newExit || DEFAULT_CLAIM_EXIT_MSG,
      }),
    );
    logAdmin(player, "CLAIM_NOTIFS", enabled ? "enabled" : "disabled");
    tell(
      player,
      enabled
        ? t("jm_at.cla.msg_notifs_enabled")
        : t("jm_at.cla.msg_notifs_disabled"),
    );
    pendingNav = close ? () => {} : back;
    try {
      form.close();
    } catch {}
  };
  form.spacer();
  form.button(t("jm_at.common.btn_save"), () => save(false));
  form.button(t("jm_at.cla.btn_save_close"), () => save(true));
  form.button(t("jm_at.common.btn_back"), () => {
    intent = "back";
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(reopen);
  }
  if (pendingNav) return system.run(pendingNav);
  if (snapshot() !== initial) {
    return system.run(async () => {
      if (await confirmDiscardChanges(player)) return reopen();
      if (intent === "back") return back();
    });
  }
  if (intent === "back") return system.run(back); // Back -> up one level; X / escape -> exit
}

// =========================================================
// Player abilities
// =========================================================

async function showPlayerAbilities(player, draft = null) {
  const cfg = getCfg();
  const a = cfg.claimPlayerAbilities ?? {};

  // Which protections players may toggle on their own claims. Defaults differ
  // per key (some abilities are off by default), so each carries its own seed.
  const _pa = (key) => t(PROTECTION_DEFS.find((d) => d.key === key).labelKey);
  const groups = [
    {
      header: t("jm_at.cla.prot_group_blocks"),
      items: [
        { key: "blocks", def: a.blocks !== false },
        { key: "containers", def: a.containers !== false },
      ],
    },
    {
      header: t("jm_at.cla.prot_group_players"),
      items: [
        { key: "entities", def: a.entities !== false },
        { key: "allowVehicles", def: a.allowVehicles !== false },
        { key: "pvp", def: a.pvp === true },
        { key: "interactions", def: a.interactions !== false },
        { key: "itemUse", def: a.itemUse !== false },
        { key: "ejectPlayers", def: a.ejectPlayers === true },
        {
          key: "adjustHeight",
          label: t("jm_at.cla.abilities_adjust_height"),
          def: a.adjustHeight !== false,
        },
      ],
    },
    {
      header: t("jm_at.cla.prot_group_env"),
      items: [
        { key: "explosions", def: a.explosions === true },
        { key: "hostileMobs", def: a.hostileMobs === true },
        { key: "cropTrampling", def: a.cropTrampling !== false },
        { key: "fireSpread", def: a.fireSpread === true },
        { key: "enderPearls", def: a.enderPearls === true },
      ],
    },
  ];

  const form = new CustomForm(player, t("jm_at.cla.abilities_title"));
  const obs = {};
  groups.forEach((g, gi) => {
    if (gi > 0) form.divider();
    form.spacer();
    form.header(g.header);
    form.spacer();
    for (const item of g.items) {
      // Seed from the draft when present (UserBusy bounce / Keep editing);
      // otherwise from the saved per-ability default.
      obs[item.key] = new ObservableBoolean(
        draft ? !!draft[item.key] : item.def,
        { clientWritable: true },
      );
      form.toggle(
        t("jm_at.cla.abilities_allow", item.label ?? _pa(item.key)),
        obs[item.key],
      );
    }
  });

  const readAbilities = () => {
    const out = {};
    for (const g of groups)
      for (const item of g.items) out[item.key] = obs[item.key].getData();
    return out;
  };

  let pendingNav = null;
  let intent = null;
  const back = () => showClaimSettingsMenu(player);
  const reopen = () => showPlayerAbilities(player, readAbilities());
  const snapshot = () => JSON.stringify(readAbilities());
  // SAVED baseline from the per-ability defaults, NOT snapshot(). Element order
  // matches readAbilities() (group order).
  const initial = JSON.stringify(
    (() => {
      const out = {};
      for (const g of groups)
        for (const item of g.items) out[item.key] = item.def;
      return out;
    })(),
  );

  const save = (close) => {
    const abilities = readAbilities();
    mutateCfg((c) => {
      c.claimPlayerAbilities = abilities;
    });
    tell(player, t("jm_at.cla.msg_abilities_saved"));
    pendingNav = close ? () => {} : back;
    try {
      form.close();
    } catch {}
  };
  form.spacer();
  form.button(t("jm_at.common.btn_save"), () => save(false));
  form.button(t("jm_at.cla.btn_save_close"), () => save(true));
  form.button(t("jm_at.common.btn_back"), () => {
    intent = "back";
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(reopen);
  }
  if (pendingNav) return system.run(pendingNav);
  if (snapshot() !== initial) {
    return system.run(async () => {
      if (await confirmDiscardChanges(player)) return reopen();
      if (intent === "back") return back();
    });
  }
  if (intent === "back") return system.run(back); // Back -> up one level; X / escape -> exit
}

// =========================================================
// Default claim height
// =========================================================

async function showDefaultClaimHeight(player, draft = null) {
  const cfg = getCfg();
  const dy = cfg.claimDefaultY ?? {};

  // `label` stays plain English: it feeds the ObservableString status line via
  // setData(), which cannot carry RawMessages. `header` is the localized form.
  const dims = [
    {
      key: "overworld",
      label: "Overworld",
      header: t("jm_at.cla.dim_overworld"),
      range: _dimHeightRange("minecraft:overworld"),
    },
    {
      key: "nether",
      label: "Nether",
      header: t("jm_at.cla.dim_nether"),
      range: _dimHeightRange("minecraft:nether"),
    },
    {
      key: "the_end",
      label: "末地",
      header: t("jm_at.common.dim_end"),
      range: _dimHeightRange("minecraft:the_end"),
    },
  ];

  const form = new CustomForm(player, t("jm_at.cla.default_height_title"));
  const rows = dims.map((d, i) => {
    const cur = dy[d.key] ?? d.range;
    // Seed from the draft when present (UserBusy bounce / Keep editing);
    // otherwise from the saved per-dimension default.
    return {
      d,
      minObs: new ObservableNumber(
        draft ? draft[i][0] : (cur.min ?? d.range.min),
        {
          clientWritable: true,
        },
      ),
      maxObs: new ObservableNumber(
        draft ? draft[i][1] : (cur.max ?? d.range.max),
        {
          clientWritable: true,
        },
      ),
    };
  });
  const status = new ObservableString("");
  const statusShown = new ObservableBoolean(false);

  rows.forEach((r, i) => {
    if (i > 0) form.divider();
    form.spacer();
    form.header(r.d.header);
    form.spacer();
    form.slider(
      t("jm_at.cla.slider_min_floor", r.d.range.min),
      r.minObs,
      r.d.range.min,
      r.d.range.max,
      { step: 1 },
    );
    form.slider(
      t("jm_at.cla.slider_max_ceiling", r.d.range.max),
      r.maxObs,
      r.d.range.min,
      r.d.range.max,
      { step: 1 },
    );
  });
  form.spacer();
  form.label(status, { visible: statusShown });
  form.spacer({ visible: statusShown });

  let pendingNav = null;
  let intent = null;
  const back = () => showClaimSettingsMenu(player);
  const reopen = () =>
    showDefaultClaimHeight(
      player,
      rows.map((r) => [r.minObs.getData(), r.maxObs.getData()]),
    );
  const snapshot = () =>
    JSON.stringify(rows.map((r) => [r.minObs.getData(), r.maxObs.getData()]));
  // SAVED baseline from the per-dimension stored defaults, NOT snapshot().
  const initial = JSON.stringify(
    dims.map((d) => {
      const cur = dy[d.key] ?? d.range;
      return [cur.min ?? d.range.min, cur.max ?? d.range.max];
    }),
  );

  const save = (close) => {
    const newY = {};
    for (const r of rows) {
      const minY = Math.round(r.minObs.getData());
      const maxY = Math.round(r.maxObs.getData());
      if (minY >= maxY) {
        status.setData(
          `§c${r.d.label}：最低高度必须小于最高高度。`,
        );
        statusShown.setData(true);
        return;
      }
      newY[r.d.key] = { min: minY, max: maxY };
    }
    mutateCfg((c) => {
      c.claimDefaultY = newY;
    });
    tell(player, t("jm_at.cla.msg_heights_saved"));
    pendingNav = close ? () => {} : back;
    try {
      form.close();
    } catch {}
  };
  form.button(t("jm_at.common.btn_save"), () => save(false));
  form.button(t("jm_at.cla.btn_save_close"), () => save(true));
  form.button(t("jm_at.common.btn_back"), () => {
    intent = "back";
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(reopen);
  }
  if (pendingNav) return system.run(pendingNav);
  if (snapshot() !== initial) {
    return system.run(async () => {
      if (await confirmDiscardChanges(player)) return reopen();
      if (intent === "back") return back();
    });
  }
  if (intent === "back") return system.run(back); // Back -> up one level; X / escape -> exit
}

// =========================================================
// Claims config (limits only)
// =========================================================

async function showClaimSettings(player, draft = null) {
  const cfg = getCfg();

  // Original saved seeds, used for the live observables (when no draft) and for
  // the `initial` dirty-check baseline.
  const seedMaxClaims = String(cfg.maxClaimsPerPlayer ?? 5);
  const seedStartArea = String(cfg.claimStartArea ?? 5);
  const seedMaxArea = String(cfg.claimMaxArea ?? 15);
  const seedPerTime = String(cfg.claimAreaPerTime ?? 1);
  const seedInterval = String(cfg.claimAreaTimeInterval ?? 60);
  const seedNether = cfg.claimAllowNether !== false;
  const seedEnd = cfg.claimAllowEnd !== false;
  const seedLivePreview = cfg.claimLivePreviewEnabled === true;

  // Seed from the draft when present (UserBusy bounce / Keep editing).
  const maxClaimsObs = new ObservableString(
    draft ? draft.maxClaims : seedMaxClaims,
    { clientWritable: true },
  );
  const startAreaObs = new ObservableString(
    draft ? draft.startArea : seedStartArea,
    { clientWritable: true },
  );
  const maxAreaObs = new ObservableString(draft ? draft.maxArea : seedMaxArea, {
    clientWritable: true,
  });
  const perTimeObs = new ObservableString(draft ? draft.perTime : seedPerTime, {
    clientWritable: true,
  });
  const intervalObs = new ObservableString(
    draft ? draft.interval : seedInterval,
    { clientWritable: true },
  );
  const netherObs = new ObservableBoolean(draft ? !!draft.nether : seedNether, {
    clientWritable: true,
  });
  const endObs = new ObservableBoolean(draft ? !!draft.end : seedEnd, {
    clientWritable: true,
  });
  const livePreviewObs = new ObservableBoolean(
    draft ? !!draft.livePreview : seedLivePreview,
    { clientWritable: true },
  );
  const status = new ObservableString("");
  const statusShown = new ObservableBoolean(false);

  const form = new CustomForm(player, t("jm_at.cla.config_title"));
  form.spacer();
  form.header(t("jm_at.cla.config_h_limits"));
  form.spacer();
  form.label(t("jm_at.cla.config_chunk_note"));
  form.spacer();
  form.textField(t("jm_at.cla.config_field_max_claims"), maxClaimsObs);
  form.textField(t("jm_at.cla.config_field_start_area"), startAreaObs);
  form.textField(t("jm_at.cla.config_field_max_area"), maxAreaObs);
  form.spacer();
  form.header(t("jm_at.cla.config_h_earning"));
  form.spacer();
  form.label(t("jm_at.cla.config_earning_info"));
  form.spacer();
  form.textField(t("jm_at.cla.config_field_per_interval"), perTimeObs);
  form.textField(t("jm_at.cla.config_field_interval_min"), intervalObs);
  form.spacer();
  form.header(t("jm_at.cla.config_h_dims"));
  form.spacer();
  form.toggle(t("jm_at.cla.config_toggle_nether"), netherObs);
  form.toggle(t("jm_at.cla.config_toggle_end"), endObs);
  form.spacer();
  form.header(t("jm_at.cla.config_h_wand"));
  form.spacer();
  form.label(t("jm_at.cla.config_wand_info"));
  form.spacer();
  form.toggle(t("jm_at.cla.config_toggle_live_preview"), livePreviewObs);
  form.spacer();
  form.label(status, { visible: statusShown });
  form.spacer({ visible: statusShown });

  let pendingNav = null;
  let intent = null;
  const back = () => showClaimSettingsMenu(player);
  const reopen = () =>
    showClaimSettings(player, {
      maxClaims: maxClaimsObs.getData(),
      startArea: startAreaObs.getData(),
      maxArea: maxAreaObs.getData(),
      perTime: perTimeObs.getData(),
      interval: intervalObs.getData(),
      nether: netherObs.getData(),
      end: endObs.getData(),
      livePreview: livePreviewObs.getData(),
    });
  const snapshot = () =>
    JSON.stringify([
      maxClaimsObs.getData(),
      startAreaObs.getData(),
      maxAreaObs.getData(),
      perTimeObs.getData(),
      intervalObs.getData(),
      netherObs.getData(),
      endObs.getData(),
      livePreviewObs.getData(),
    ]);
  // SAVED baseline from the original seeds, NOT snapshot(). Element order
  // matches snapshot().
  const initial = JSON.stringify([
    seedMaxClaims,
    seedStartArea,
    seedMaxArea,
    seedPerTime,
    seedInterval,
    seedNether,
    seedEnd,
    seedLivePreview,
  ]);

  const save = (close) => {
    const maxClaims = parseInt(maxClaimsObs.getData(), 10);
    const startRaw = parseInt(startAreaObs.getData(), 10);
    const maxRaw = parseInt(maxAreaObs.getData(), 10);
    const perTime = parseInt(perTimeObs.getData(), 10);
    const interval = parseInt(intervalObs.getData(), 10);
    if (
      [maxClaims, startRaw, maxRaw, perTime, interval].some((n) => isNaN(n))
    ) {
      status.setData("§c这些设置必须全部为整数。");
      statusShown.setData(true);
      return;
    }
    // Starting area may be 0 (players begin with nothing and earn over time).
    // Max can't sit below Starting, so it follows up when needed.
    const startArea = Math.max(0, Math.floor(startRaw));
    const maxArea = Math.max(startArea, Math.floor(maxRaw));
    mutateCfg((c) =>
      Object.assign(c, {
        maxClaimsPerPlayer: Math.max(0, Math.floor(maxClaims)),
        claimStartArea: startArea,
        claimMaxArea: maxArea,
        claimAreaPerTime: Math.max(0, Math.floor(perTime)),
        claimAreaTimeInterval: Math.max(1, Math.floor(interval)),
        claimAllowNether: netherObs.getData(),
        claimAllowEnd: endObs.getData(),
        claimLivePreviewEnabled: livePreviewObs.getData(),
      }),
    );
    tell(player, t("jm_at.cla.msg_config_saved"));
    pendingNav = close ? () => {} : back;
    try {
      form.close();
    } catch {}
  };
  form.button(t("jm_at.common.btn_save"), () => save(false));
  form.button(t("jm_at.cla.btn_save_close"), () => save(true));
  form.button(t("jm_at.common.btn_back"), () => {
    intent = "back";
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(reopen);
  }
  if (pendingNav) return system.run(pendingNav);
  if (snapshot() !== initial) {
    return system.run(async () => {
      if (await confirmDiscardChanges(player)) return reopen();
      if (intent === "back") return back();
    });
  }
  if (intent === "back") return system.run(back); // Back -> up one level; X / escape -> exit
}

// =========================================================
// Claim defaults (default protections for new claims)
// =========================================================

async function showClaimDefaults(player, draft = null) {
  const cfg = getCfg();
  const p = cfg.claimProtections ?? {};

  const form = new CustomForm(player, t("jm_at.cla.defaults_title"));
  // Seed from the draft when present (UserBusy bounce / Keep editing);
  // otherwise from the saved default protections.
  const obs = buildProtectionToggles(form, draft ? draft.prot : p);

  form.spacer();
  form.header(t("jm_at.cla.defaults_h_welcome"));
  form.spacer();
  const seedWelcome = cfg.claimWelcomeMsgEnabled !== false;
  const welcomeObs = new ObservableBoolean(
    draft ? !!draft.welcome : seedWelcome,
    { clientWritable: true },
  );
  form.toggle(t("jm_at.cla.defaults_toggle_welcome"), welcomeObs);

  let pendingNav = null;
  let intent = null;
  const back = () => showClaimSettingsMenu(player);
  const reopen = () =>
    showClaimDefaults(player, {
      prot: readProtectionToggles(obs),
      welcome: welcomeObs.getData(),
    });
  const snapshot = () =>
    JSON.stringify([readProtectionToggles(obs), welcomeObs.getData()]);
  // SAVED baseline from the original defaults, NOT snapshot(). Element order
  // matches snapshot().
  const initial = JSON.stringify([baselineProtectionToggles(p), seedWelcome]);

  const save = (close) => {
    mutateCfg((c) =>
      Object.assign(c, {
        claimProtections: readProtectionToggles(obs),
        claimWelcomeMsgEnabled: welcomeObs.getData(),
      }),
    );
    tell(player, t("jm_at.cla.msg_defaults_saved"));
    pendingNav = close ? () => {} : back;
    try {
      form.close();
    } catch {}
  };
  form.spacer();
  form.button(t("jm_at.common.btn_save"), () => save(false));
  form.button(t("jm_at.cla.btn_save_close"), () => save(true));
  form.button(t("jm_at.common.btn_back"), () => {
    intent = "back";
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(reopen);
  }
  if (pendingNav) return system.run(pendingNav);
  if (snapshot() !== initial) {
    return system.run(async () => {
      if (await confirmDiscardChanges(player)) return reopen();
      if (intent === "back") return back();
    });
  }
  if (intent === "back") return system.run(back); // Back -> up one level; X / escape -> exit
}

// =========================================================
// Mob Black/Whitelist
// =========================================================

async function showMobBlacklist(player) {
  const cfg = getCfg();
  const blacklist = cfg.mobBlacklist ?? [];
  const whitelist = cfg.mobWhitelist ?? [];

  const form = new ActionFormData()
    .title(t("jm_at.cla.mob_title"))
    .body(
      raw(
        t("jm_at.cla.mob_body_blacklist", blacklist.length),
        "\n",
        t("jm_at.cla.mob_body_whitelist", whitelist.length),
        "\n\n",
        t("jm_at.cla.mob_body_help"),
      ),
    );

  form.button(t("jm_at.cla.btn_add_blacklist"), "textures/ui/jm_at_add");
  form.button(t("jm_at.cla.btn_add_whitelist"), "textures/ui/jm_at_add");

  for (const typeId of blacklist) {
    const label = typeId.endsWith(":")
      ? t("jm_at.cla.mob_whole_addon", typeId)
      : typeId;
    form.button(raw("§c✕ §l", label), "textures/ui/jm_at_remove");
  }
  for (const typeId of whitelist) {
    const label = typeId.endsWith(":")
      ? t("jm_at.cla.mob_whole_addon", typeId)
      : typeId;
    form.button(raw("§2✓ §l", label), "textures/ui/jm_at_remove");
  }
  form.button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back");
  form.button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const totalEntryBtns = 2 + blacklist.length + whitelist.length;

  const res = await form.show(player);
  if (res.canceled) return showClaimSettingsMenu(player); // X = Back
  if (res.selection === totalEntryBtns) return showClaimSettingsMenu(player); // Back
  if (res.selection === totalEntryBtns + 1) return; // Close

  if (res.selection === 0) return showAddBlacklistedMob(player);
  if (res.selection === 1) return showAddWhitelistedMob(player);

  const entryIdx = res.selection - 2;
  if (entryIdx >= 0 && entryIdx < blacklist.length) {
    return showRemoveBlacklistedMob(player, blacklist[entryIdx]);
  }
  const wlIdx = entryIdx - blacklist.length;
  if (wlIdx >= 0 && wlIdx < whitelist.length) {
    return showRemoveWhitelistedMob(player, whitelist[wlIdx]);
  }
}

async function showAddBlacklistedMob(player) {
  const idObs = new ObservableString("", { clientWritable: true });
  const status = new ObservableString("");
  const statusShown = new ObservableBoolean(false);
  let pendingNav = null;
  let intent = null;
  const back = () => showMobBlacklist(player);
  const fail = (m) => {
    status.setData(m);
    statusShown.setData(true);
  };

  const form = new CustomForm(player, t("jm_at.cla.mob_add_bl_title"));
  form.textField(t("jm_at.cla.mob_field_id_bl"), idObs, {
    description: t("jm_at.cla.mob_field_id_bl_desc"),
  });
  form.spacer();
  form.label(status, { visible: statusShown });
  form.spacer({ visible: statusShown });
  const submit = (close) => {
    const typeId = idObs.getData().trim().toLowerCase();
    if (!typeId || !typeId.includes(":") || typeId.startsWith(":")) {
      fail(
        "§c请使用 命名空间:生物（例如 minecraft:zombie），或只输入 mypack: 以匹配整个附加包。",
      );
      return;
    }
    if ((getCfg().mobBlacklist ?? []).includes(typeId)) {
      fail(`§c${typeId} 已在黑名单中。`);
      return;
    }
    pendingNav = () => {
      const cfg = getCfg();
      if (!cfg.mobBlacklist) cfg.mobBlacklist = [];
      cfg.mobBlacklist.push(typeId);
      setCfg(cfg);
      tell(player, t("jm_at.cla.msg_mob_bl_added", typeId));
      return close ? undefined : showMobBlacklist(player);
    };
    try {
      form.close();
    } catch {}
  };
  form.button(t("jm_at.cla.btn_add"), () => submit(false));
  form.button(t("jm_at.cla.btn_add_close"), () => submit(true));
  form.button(t("jm_at.common.btn_back"), () => {
    intent = "back";
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(() => showAddBlacklistedMob(player));
  }
  if (pendingNav) return system.run(pendingNav);
  if (intent === "back") return system.run(back); // Back -> up one level; X / escape -> exit
}

async function showRemoveBlacklistedMob(player, typeId) {
  const form = new MessageFormData()
    .title(t("jm_at.cla.mob_remove_bl_title"))
    .body(t("jm_at.cla.mob_remove_bl_body", typeId))
    .button1(t("jm_at.common.btn_cancel"))
    .button2(t("jm_at.cla.btn_remove"));

  const res = await form.show(player);
  if (res.canceled || res.selection === 0) return showMobBlacklist(player);
  const cfg = getCfg();
  cfg.mobBlacklist = (cfg.mobBlacklist ?? []).filter((x) => x !== typeId);
  setCfg(cfg);
  tell(player, t("jm_at.cla.msg_mob_bl_removed", typeId));
  return showMobBlacklist(player);
}

async function showAddWhitelistedMob(player) {
  const idObs = new ObservableString("", { clientWritable: true });
  const status = new ObservableString("");
  const statusShown = new ObservableBoolean(false);
  let pendingNav = null;
  let intent = null;
  const back = () => showMobBlacklist(player);
  const fail = (m) => {
    status.setData(m);
    statusShown.setData(true);
  };

  const form = new CustomForm(player, t("jm_at.cla.mob_add_wl_title"));
  form.textField(t("jm_at.cla.mob_field_id_wl"), idObs, {
    description: t("jm_at.cla.mob_field_id_wl_desc"),
  });
  form.spacer();
  form.label(status, { visible: statusShown });
  form.spacer({ visible: statusShown });
  const submit = (close) => {
    const typeId = idObs.getData().trim().toLowerCase();
    if (!typeId || !typeId.includes(":") || typeId.startsWith(":")) {
      fail(
        "§c请使用 命名空间:生物（例如 minecraft:happy_ghast），或只输入 mypack: 以匹配整个附加包。",
      );
      return;
    }
    if ((getCfg().mobWhitelist ?? []).includes(typeId)) {
      fail(`§c${typeId} 已在白名单中。`);
      return;
    }
    pendingNav = () => {
      const cfg = getCfg();
      if (!cfg.mobWhitelist) cfg.mobWhitelist = [];
      cfg.mobWhitelist.push(typeId);
      SAFE_ENTITY_TYPES.add(typeId);
      setCfg(cfg);
      tell(player, t("jm_at.cla.msg_mob_wl_added", typeId));
      return close ? undefined : showMobBlacklist(player);
    };
    try {
      form.close();
    } catch {}
  };
  form.button(t("jm_at.cla.btn_add"), () => submit(false));
  form.button(t("jm_at.cla.btn_add_close"), () => submit(true));
  form.button(t("jm_at.common.btn_back"), () => {
    intent = "back";
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(() => showAddWhitelistedMob(player));
  }
  if (pendingNav) return system.run(pendingNav);
  if (intent === "back") return system.run(back); // Back -> up one level; X / escape -> exit
}

async function showRemoveWhitelistedMob(player, typeId) {
  const form = new MessageFormData()
    .title(t("jm_at.cla.mob_remove_wl_title"))
    .body(t("jm_at.cla.mob_remove_wl_body", typeId))
    .button1(t("jm_at.common.btn_cancel"))
    .button2(t("jm_at.cla.btn_remove"));

  const res = await form.show(player);
  if (res.canceled || res.selection === 0) return showMobBlacklist(player);
  const cfg = getCfg();
  cfg.mobWhitelist = (cfg.mobWhitelist ?? []).filter((x) => x !== typeId);
  SAFE_ENTITY_TYPES.delete(typeId);
  setCfg(cfg);
  tell(player, t("jm_at.cla.msg_mob_wl_removed", typeId));
  return showMobBlacklist(player);
}

// =========================================================
// Add / Remove chunks (per-player bonus)
// =========================================================

async function showChunkAdjustPicker(player, filterName) {
  const onlinePlayers = world.getPlayers();
  const reg = getPlayerRegistry();

  // Build combined list: online players first, then offline from registry
  const onlineXuids = new Set();
  const entries = [];
  for (const p of onlinePlayers) {
    const xuid = getPlayerXuid(p);
    onlineXuids.add(xuid);
    const core = getPlayerCore(p);
    entries.push({
      name: p.name,
      xuid,
      bonusChunks: core.bonusChunks ?? 0,
      playTimeMs: core.playTimeMs ?? 0,
      online: true,
    });
  }
  for (const [xuid, r] of Object.entries(reg)) {
    if (!onlineXuids.has(xuid)) {
      entries.push({
        name: r.name,
        xuid,
        bonusChunks: r.bonusChunks ?? 0,
        playTimeMs: r.playTimeMs ?? 0,
        online: false,
      });
    }
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));

  const filtered = filterName
    ? entries.filter((e) => e.name === filterName)
    : entries;

  const form = new ActionFormData()
    .title(t("jm_at.cla.chunks_title"))
    .body(
      raw(
        t("jm_at.cla.chunks_body"),
        filterName ? raw("\n", t("jm_at.cla.filtered", filterName)) : "",
      ),
    );

  // Search/clear button is always first
  form.button(
    filterName
      ? t("jm_at.cla.btn_clear_filter", raw("§8", filterName))
      : t("jm_at.cla.btn_search_player"),
    "textures/ui/jm_at_search_info",
  );

  for (const e of filtered) {
    form.button(
      raw(
        "§l",
        e.name,
        "§r\n",
        e.online
          ? t("jm_at.cla.status_online")
          : t("jm_at.cla.status_offline"),
        e.bonusChunks !== 0
          ? t("jm_at.cla.chunks_bonus_suffix", e.bonusChunks)
          : "",
      ),
      "textures/ui/jm_at_players",
    );
  }
  form.button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back");
  form.button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showClaimsAdmin(player); // X = Back
  if (res.selection === filtered.length + 1) return showClaimsAdmin(player); // Back
  if (res.selection === filtered.length + 2) return; // Close

  // Index 0 = search/clear filter button
  if (res.selection === 0) {
    if (filterName) return showChunkAdjustPicker(player);
    return showChunkAdjustPlayerFilter(player);
  }

  return showChunkAdjustForm(player, filtered[res.selection - 1]);
}

async function showChunkAdjustPlayerFilter(player) {
  const reg = getPlayerRegistry();
  const entries = Object.entries(reg)
    .map(([xuid, e]) => ({ xuid, name: e.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const items =
    entries.length > 0
      ? entries.map((e, i) => ({ label: e.name, value: i }))
      : [{ label: t("jm_at.cla.opt_none"), value: 0 }];

  const typedObs = new ObservableString("", { clientWritable: true });
  const pickObs = new ObservableNumber(0, { clientWritable: true });
  const status = new ObservableString("");
  const statusShown = new ObservableBoolean(false);
  let pendingNav = null;
  let intent = null;
  const back = () => showChunkAdjustPicker(player);
  const fail = (m) => {
    status.setData(m);
    statusShown.setData(true);
  };

  const form = new CustomForm(player, t("jm_at.cla.filter_title"));
  form.textField(t("jm_at.cla.filter_type_name"), typedObs);
  form.dropdown(t("jm_at.cla.filter_pick_known"), pickObs, items);
  form.spacer();
  form.label(status, { visible: statusShown });
  form.spacer({ visible: statusShown });
  form.button(t("jm_at.cla.btn_filter"), () => {
    const typed = clampText(typedObs.getData().trim(), 50);
    let selectedName;
    if (typed) {
      const lower = typed.toLowerCase();
      const entry = entries.find((e) => (e.name ?? "").toLowerCase() === lower);
      if (!entry) {
        fail(`§c找不到名为“${typed}”的玩家。`);
        return;
      }
      selectedName = entry.name;
    } else {
      if (entries.length === 0) {
        fail("§c暂无已记录的玩家可供选择，请直接输入名称。");
        return;
      }
      selectedName = entries[pickObs.getData()]?.name;
      if (!selectedName) {
        fail("§c请选择一名玩家或输入名称。");
        return;
      }
    }
    pendingNav = () => showChunkAdjustPicker(player, selectedName);
    try {
      form.close();
    } catch {}
  });
  form.button(t("jm_at.common.btn_back"), () => {
    intent = "back";
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(() => showChunkAdjustPlayerFilter(player));
  }
  if (pendingNav) return system.run(pendingNav);
  if (intent === "back") return system.run(back); // Back -> up one level; X / escape -> exit
}

async function showChunkAdjustForm(player, entry, draft = null) {
  // Compute total budget
  const livePlayer = world
    .getPlayers()
    .find((p) => getPlayerXuid(p) === entry.xuid);
  let totalChunks;
  if (livePlayer) {
    totalChunks = getPlayerClaimBudget(livePlayer);
  } else {
    const cfg = getCfg();
    const playMs = entry.playTimeMs ?? 0;
    const bonus = entry.bonusChunks ?? 0;
    const intervalMs = (cfg.claimAreaTimeInterval ?? 60) * 60000;
    const earned =
      intervalMs > 0
        ? Math.floor(playMs / intervalMs) * (cfg.claimAreaPerTime ?? 1)
        : 0;
    totalChunks = Math.min(
      (cfg.claimStartArea ?? 5) + earned + bonus,
      (cfg.claimMaxArea ?? 15) + bonus,
    );
  }

  const currentBonus = entry.bonusChunks ?? 0;
  // Seed from the draft when present (UserBusy bounce / Keep editing).
  const deltaObs = new ObservableNumber(draft ? draft.delta : 0, {
    clientWritable: true,
  });
  const preview = new ObservableString("");
  const status = new ObservableString("");
  const statusShown = new ObservableBoolean(false);
  let pendingNav = null;
  let intent = null;
  const back = () => showChunkAdjustPicker(player);
  const refresh = () => {
    const d = Math.round(deltaObs.getData());
    preview.setData(
      `§7调整后的额外额度：§a${currentBonus + d}§7（§f${d >= 0 ? "+" : ""}${d}§7）`,
    );
  };
  refresh();

  const reopen = () =>
    showChunkAdjustForm(player, entry, { delta: deltaObs.getData() });
  const snapshot = () => JSON.stringify([deltaObs.getData()]);
  // SAVED baseline: no adjustment yet (delta 0), NOT snapshot().
  const initial = JSON.stringify([0]);

  const form = new CustomForm(
    player,
    t("jm_at.cla.chunks_form_title", entry.name),
  );
  form.label(t("jm_at.cla.chunks_total", totalChunks));
  form.label(t("jm_at.cla.chunks_current_bonus", currentBonus));
  form.spacer();
  form.slider(t("jm_at.cla.chunks_slider"), deltaObs, -64, 64, {
    step: 1,
  });
  form.spacer();
  form.label(preview);
  form.label(status, { visible: statusShown });
  form.spacer();
  const submit = (close) => {
    const amount = Math.round(deltaObs.getData());
    if (amount === 0) {
      status.setData("§c请输入要调整的非零数值。");
      statusShown.setData(true);
      return;
    }
    pendingNav = () => {
      const target = world
        .getPlayers()
        .find((p) => getPlayerXuid(p) === entry.xuid);
      if (target) {
        const core = getPlayerCore(target);
        core.bonusChunks = (core.bonusChunks ?? 0) + amount;
        setPlayerCore(target, core);
      } else {
        const reg = getPlayerRegistry();
        const r = reg[entry.xuid];
        if (r) {
          r.bonusChunks = (r.bonusChunks ?? 0) + amount;
          setPlayerRegistry(reg);
        }
      }
      const absAmount = Math.abs(amount);
      // lang-keys: jm_at.cla.msg_chunks_added jm_at.cla.msg_chunks_removed
      tell(
        player,
        t(
          amount > 0
            ? "jm_at.cla.msg_chunks_added"
            : "jm_at.cla.msg_chunks_removed",
          absAmount,
          entry.name,
        ),
      );
      const msg =
        amount > 0
          ? `§9§l[领地]§r 已增加 ${absAmount} 个区块的领地额度。`
          : `§9§l[领地]§r 已扣除 ${absAmount} 个区块的领地额度。`;
      queuePlayerNotif(entry.xuid, msg);
      return close ? undefined : showChunkAdjustPicker(player);
    };
    try {
      form.close();
    } catch {}
  };
  form.button(t("jm_at.cla.btn_apply"), () => submit(false));
  form.button(t("jm_at.cla.btn_apply_close"), () => submit(true));
  form.button(t("jm_at.common.btn_back"), () => {
    intent = "back";
    try {
      form.close();
    } catch {}
  });

  const ticker = system.runInterval(refresh, 5);
  const reason = await form.show();
  system.clearRun(ticker);
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(reopen);
  }
  if (pendingNav) return system.run(pendingNav);
  if (snapshot() !== initial) {
    return system.run(async () => {
      if (await confirmDiscardChanges(player)) return reopen();
      if (intent === "back") return back();
    });
  }
  if (intent === "back") return system.run(back); // Back -> up one level; X / escape -> exit
}

// =========================================================
// Event log (paginated, most recent first)
// =========================================================

async function showClaimEventLog(
  player,
  page = 0,
  filterPlayer = "",
  filterType = "",
) {
  const LOG_PAGE_SIZE = 15;
  let log = getClaimLog().slice().reverse(); // most recent first

  // Apply filters
  if (filterPlayer) {
    const lower = filterPlayer.toLowerCase();
    log = log.filter(
      (e) =>
        (e.ownerName ?? "").toLowerCase() === lower ||
        (e.actorName ?? "").toLowerCase() === lower,
    );
  }
  if (filterType) log = log.filter((e) => e.type === filterType);

  const total = log.length;
  const totalPages = Math.max(1, Math.ceil(total / LOG_PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const start = safePage * LOG_PAGE_SIZE;
  const slice = log.slice(start, start + LOG_PAGE_SIZE);

  const hasFilters = filterPlayer || filterType;
  const filterDescParts = [
    filterPlayer ? t("jm_at.cla.log_filter_player", filterPlayer) : "",
    filterType
      ? t("jm_at.cla.log_filter_action", _fmtLogTypePlain(filterType))
      : "",
  ].filter(Boolean);
  const filterDesc = raw(
    ...filterDescParts.flatMap((p, i) => (i > 0 ? ["  §8|§r  ", p] : [p])),
  );

  const lines = slice.length
    ? raw(
        ...slice.flatMap((entry, i) => {
          const parts =
            i > 0 ? ["\n――――――――――――――――\n"] : [];
          parts.push(
            _fmtLogType(entry.type),
            "§r: §l",
            _trimName(entry.claimName || entry.claimId, 32),
            "§r\n  §8",
            _fmtAgoShort(entry.at),
            "  §7",
            entry.ownerName,
          );
          if (entry.actorName && entry.actorName !== entry.ownerName)
            parts.push(" §7· ", entry.actorName);
          if (entry.detail) parts.push(" §7· §r", entry.detail);
          return parts;
        }),
      )
    : t("jm_at.cla.log_none");

  const hasPrev = safePage > 0;
  const hasNext = (safePage + 1) * LOG_PAGE_SIZE < total;

  const navBtns = [];
  if (hasPrev)
    navBtns.push({
      label: t("jm_at.common.btn_prev_page_plain", safePage),
      key: "prev",
    });
  if (hasNext)
    navBtns.push({
      label: t("jm_at.common.btn_next_page_plain", safePage + 2),
      key: "next",
    });

  const form = new ActionFormData()
    .title(t("jm_at.cla.log_title", total))
    .body(
      raw(
        hasFilters ? t("jm_at.cla.log_filters_prefix", filterDesc) : "",
        hasFilters ? "\n" : "",
        lines,
        totalPages > 1
          ? raw("\n", t("jm_at.cla.log_page", safePage + 1, totalPages))
          : "",
      ),
    );

  for (const b of navBtns) form.button(b.label);
  form.button(
    hasFilters
      ? t("jm_at.cla.btn_filters_active")
      : t("jm_at.cla.btn_filters"),
    "textures/ui/jm_at_filter",
  );
  if (hasFilters)
    form.button(t("jm_at.cla.btn_clear_filters"), "textures/ui/jm_at_clear_filter");
  if (total > 0)
    form.button(t("jm_at.cla.btn_clear_log"), "textures/ui/jm_at_remove");
  form.button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back");
  form.button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showClaimsAdmin(player); // X = Back

  // Decode selection
  let idx = res.selection ?? -1;
  for (const b of navBtns) {
    if (idx === 0) {
      if (b.key === "prev")
        return showClaimEventLog(
          player,
          safePage - 1,
          filterPlayer,
          filterType,
        );
      if (b.key === "next")
        return showClaimEventLog(
          player,
          safePage + 1,
          filterPlayer,
          filterType,
        );
    }
    idx--;
  }
  if (idx === 0) return showClaimLogFilter(player, filterPlayer, filterType); // Filters
  idx--;
  if (hasFilters) {
    if (idx === 0) return showClaimEventLog(player, 0, "", ""); // Clear Filters
    idx--;
  }
  // Must match the button's own condition above (`if (total > 0)`). Using the
  // unfiltered count here drifted the index when filters hid every entry, so
  // "Back" landed on the Clear-log confirm.
  if (total > 0) {
    if (idx === 0) return showConfirmClearLog(player);
    idx--;
  }
  if (idx === 0) return showClaimsAdmin(player); // Back
  // idx === 1 → Close
}

async function showClaimLogFilter(
  player,
  currentPlayer = "",
  currentType = "",
) {
  const reg = getPlayerRegistry();
  const entries = Object.entries(reg)
    .map(([, e]) => ({ name: e.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const names = entries.map((e) => e.name);

  const ACTION_TYPES = [
    "create",
    "expand",
    "extend",
    "subclaim_create",
    "subclaim_delete",
    "delete_owner",
    "delete_admin",
    "member_add",
    "member_remove",
    "member_update",
    "member_expire",
    "trust_add",
    "trust_remove",
    "trust_update",
    "trust_expire",
    "transfer",
    "adjust_height",
  ];
  const typeLabels = ACTION_TYPES.map((at) => _fmtLogTypePlain(at));

  // Pre-select current values
  const dropdownNames = [t("jm_at.cla.opt_show_all"), ...names];
  const currentPlayerIdx = names.indexOf(currentPlayer);
  const playerDefaultIdx = currentPlayerIdx >= 0 ? currentPlayerIdx + 1 : 0;

  const typeOptions = [t("jm_at.cla.opt_show_all"), ...typeLabels];
  const currentTypeIdx = ACTION_TYPES.indexOf(currentType);
  const typeDefaultIdx = currentTypeIdx >= 0 ? currentTypeIdx + 1 : 0;

  const form = new ModalFormData()
    .title(t("jm_at.cla.log_filter_title"))
    .textField(
      t("jm_at.cla.log_filter_type_name"),
      t("jm_at.cla.field_player_name"),
      {
        defaultValue: currentPlayer,
      },
    )
    .dropdown(t("jm_at.cla.log_filter_pick"), dropdownNames, {
      defaultValueIndex: playerDefaultIdx,
    })
    .dropdown(t("jm_at.cla.log_filter_action_label"), typeOptions, {
      defaultValueIndex: typeDefaultIdx,
    });

  const res = await form.show(player);
  if (res.canceled)
    return showClaimEventLog(player, 0, currentPlayer, currentType);

  const typed = (res.formValues[0] ?? "").trim();
  const dropIdx = res.formValues[1] ?? 0;
  const typeIdx = res.formValues[2] ?? 0;

  // Resolve player filter
  let newPlayer = "";
  if (typed) {
    const lower = typed.toLowerCase();
    const match = Object.values(reg).find(
      (e) => (e.name ?? "").toLowerCase() === lower,
    );
    if (!match) {
      return warnForm(player, t("jm_at.cla.warn_no_player", typed), () =>
        showClaimLogFilter(player, currentPlayer, currentType),
      );
    }
    newPlayer = match.name;
  } else if (dropIdx > 0) {
    newPlayer = names[dropIdx - 1] ?? "";
  }

  // Resolve type filter
  const newType = typeIdx > 0 ? (ACTION_TYPES[typeIdx - 1] ?? "") : "";

  return showClaimEventLog(player, 0, newPlayer, newType);
}

// =========================================================
// Clear claim event log
// =========================================================

async function showConfirmClearLog(player) {
  const total = getClaimLog().length;
  const form = new MessageFormData()
    .title(t("jm_at.cla.clear_log_title"))
    .body(t("jm_at.cla.clear_log_body", total))
    .button1(t("jm_at.common.btn_cancel"))
    .button2(t("jm_at.cla.btn_clear_red"));

  const res = await form.show(player);
  if (res.canceled || res.selection === 0) return showClaimEventLog(player, 0);

  clearClaimLog();
  tell(player, t("jm_at.cla.msg_log_cleared"));
  return showClaimEventLog(player, 0);
}

// =========================================================
// Admin Rename
// =========================================================

async function showAdminRename(
  player,
  claimId,
  page,
  filterOwner,
  draft = null,
) {
  const claim = getClaimById(claimId);
  if (!claim) return showClaimsAdmin(player);

  const seedName = claim.name ?? "";
  // Seed from the draft when present (UserBusy bounce / Keep editing);
  // otherwise from the claim's saved name.
  const nameObs = new ObservableString(draft?.name ?? seedName, {
    clientWritable: true,
  });
  const status = new ObservableString("");
  const statusShown = new ObservableBoolean(false);
  let pendingNav = null;
  let intent = null;
  const back = () => showClaimInspect(player, claimId, page, filterOwner);
  const reopen = () =>
    showAdminRename(player, claimId, page, filterOwner, {
      name: nameObs.getData(),
    });
  const snapshot = () => JSON.stringify([nameObs.getData()]);
  // SAVED baseline from the claim's stored name, NOT snapshot().
  const initial = JSON.stringify([seedName]);
  const fail = (m) => {
    status.setData(m);
    statusShown.setData(true);
  };

  const form = new CustomForm(player, t("jm_at.cla.rename_title"));
  form.textField(t("jm_at.cla.rename_field", LIMITS.CLAIM_NAME_MAX), nameObs, {
    description: t("jm_at.cla.rename_field_desc"),
  });
  form.spacer();
  form.label(status, { visible: statusShown });
  form.spacer({ visible: statusShown });
  const save = (close) => {
    const newName = clampText(nameObs.getData().trim(), LIMITS.CLAIM_NAME_MAX);
    if (!newName) {
      fail("§c请输入名称。");
      return;
    }
    pendingNav = () => {
      renameClaim(claimId, newName);
      tell(player, t("jm_at.cla.msg_renamed", newName));
      return close
        ? undefined
        : showClaimInspect(player, claimId, page, filterOwner);
    };
    try {
      form.close();
    } catch {}
  };
  form.button(t("jm_at.common.btn_save"), () => save(false));
  form.button(t("jm_at.cla.btn_save_close"), () => save(true));
  form.button(t("jm_at.common.btn_back"), () => {
    intent = "back";
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(reopen);
  }
  if (pendingNav) return system.run(pendingNav);
  if (snapshot() !== initial) {
    return system.run(async () => {
      if (await confirmDiscardChanges(player)) return reopen();
      if (intent === "back") return back();
    });
  }
  if (intent === "back") return system.run(back); // Back -> up one level; X / escape -> exit
}

// =========================================================
// Admin Members
// =========================================================

// lang-keys: jm_at.cla.duropt_*
const DURATIONS = [
  { label: t("jm_at.cla.duropt_permanent"), ms: 0 },
  { label: t("jm_at.cla.duropt_15m"), ms: 15 * 60000 },
  { label: t("jm_at.cla.duropt_30m"), ms: 30 * 60000 },
  { label: t("jm_at.cla.duropt_1h"), ms: 60 * 60000 },
  { label: t("jm_at.cla.duropt_2h"), ms: 2 * 60 * 60000 },
  { label: t("jm_at.cla.duropt_6h"), ms: 6 * 60 * 60000 },
  { label: t("jm_at.cla.duropt_12h"), ms: 12 * 60 * 60000 },
  { label: t("jm_at.cla.duropt_1d"), ms: 24 * 60 * 60000 },
  { label: t("jm_at.cla.duropt_3d"), ms: 3 * 24 * 60 * 60000 },
  { label: t("jm_at.cla.duropt_7d"), ms: 7 * 24 * 60 * 60000 },
];

// Role dropdown items shared by Add Member / Add Trusted Rank / Edit Trusted
// Rank. Index order matches the stored role ids in ROLE_IDS.
// lang-keys: jm_at.cla.role_item_*
const ROLE_ITEMS = [
  t("jm_at.cla.role_item_visitor"),
  t("jm_at.cla.role_item_member"),
  t("jm_at.cla.role_item_builder"),
  t("jm_at.cla.role_item_coowner"),
].map((l, i) => ({ label: l, value: i }));
const ROLE_IDS = ["visitor", "member", "builder", "co-owner"];

async function showAdminMembers(player, claimId, backFn) {
  const claim = getClaimById(claimId);
  if (!claim) return showClaimsAdmin(player);

  const form = new ActionFormData()
    .title(t("jm_at.cla.members_title"))
    .body(
      claim.members.length === 0
        ? t("jm_at.cla.members_none")
        : t("jm_at.cla.members_count", claim.members.length),
    );

  form.button(t("jm_at.cla.btn_add_member"), "textures/ui/jm_at_add");
  for (const m of claim.members) {
    const parts = [_roleLabel(m.role)];
    if (m.expiresAt && m.expiresAt > 0) {
      const remaining = m.expiresAt - nowMs();
      parts.push(
        remaining > 0
          ? t("jm_at.cla.suffix_time_left", _fmtDurationShort(remaining))
          : t("jm_at.cla.suffix_expired"),
      );
    }
    form.button(
      raw("§l", m.name, "§r\n", ...parts),
      "textures/ui/jm_at_online",
    );
  }
  form.button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back");
  form.button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return backFn(); // X = Back
  if (res.selection === claim.members.length + 1) return backFn(); // Back
  if (res.selection === claim.members.length + 2) return; // Close
  if (res.selection === 0) return showAdminAddMember(player, claimId, backFn);
  const memberIdx = res.selection - 1;
  if (memberIdx >= 0 && memberIdx < claim.members.length) {
    return showAdminMemberDetail(
      player,
      claimId,
      claim.members[memberIdx],
      backFn,
    );
  }
}

async function showAdminAddMember(player, claimId, backFn) {
  const claim = getClaimById(claimId);
  if (!claim) return showClaimsAdmin(player);
  if (claim.members.length >= LIMITS.MEMBERS_PER_CLAIM) {
    return warnForm(
      player,
      t("jm_at.cla.warn_members_max", LIMITS.MEMBERS_PER_CLAIM),
      () => showAdminMembers(player, claimId, backFn),
    );
  }

  const onlineSet = new Set(world.getPlayers().map((p) => getPlayerXuid(p)));
  const reg = getPlayerRegistry();
  const candidates = Object.entries(reg)
    .map(([pxuid, e]) => ({
      xuid: pxuid,
      name: e.name,
      online: onlineSet.has(pxuid),
    }))
    .filter(
      (e) =>
        e.xuid !== claim.ownerXuid &&
        !claim.members.find((m) => m.xuid === e.xuid),
    )
    .sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  // Dropdown items render § literally, so names are stripped and the
  // online/offline tags use uncolored lang values.
  // lang-keys: jm_at.cla.opt_online jm_at.cla.opt_offline
  const playerItems =
    candidates.length > 0
      ? candidates.map((e, i) => ({
          label: t(
            e.online ? "jm_at.cla.opt_online" : "jm_at.cla.opt_offline",
            String(e.name).replace(/§./g, ""),
          ),
          value: i,
        }))
      : [{ label: t("jm_at.cla.opt_none"), value: 0 }];
  const roleItems = ROLE_ITEMS;
  const durItems = DURATIONS.map((d, i) => ({ label: d.label, value: i }));

  const nameObs = new ObservableString("", { clientWritable: true });
  const pickObs = new ObservableNumber(0, { clientWritable: true });
  const roleObs = new ObservableNumber(1, { clientWritable: true });
  const durObs = new ObservableNumber(0, { clientWritable: true });
  const status = new ObservableString("");
  const statusShown = new ObservableBoolean(false);
  const fail = (m) => {
    status.setData(m);
    statusShown.setData(true);
  };

  const form = new CustomForm(player, t("jm_at.cla.add_member_title"));
  form.spacer();
  form.header(t("jm_at.cla.h_choose_player"));
  form.spacer();
  form.label(raw("§7", t("jm_at.cla.pick_hint")));
  form.spacer();
  form.textField(t("jm_at.cla.field_player_name"), nameObs, {
    description: t("jm_at.cla.field_leave_blank"),
  });
  form.dropdown(t("jm_at.cla.pick_known"), pickObs, playerItems);
  form.spacer();
  form.header(t("jm_at.cla.h_access"));
  form.spacer();
  form.dropdown(t("jm_at.cla.field_role"), roleObs, roleItems);
  form.dropdown(t("jm_at.cla.field_duration"), durObs, durItems);
  form.spacer();
  form.label(status, { visible: statusShown });
  form.spacer({ visible: statusShown });

  let pendingNav = null;
  let intent = null;
  const back = () => showAdminMembers(player, claimId, backFn);

  const submit = (close) => {
    const typed = clampText((nameObs.getData() ?? "").trim(), 40);
    let targetXuid, targetName;
    if (typed) {
      let entry = _resolvePlayerByName(typed, reg);
      if (!entry) {
        const online = world
          .getPlayers()
          .find((p) => p.name.toLowerCase() === typed.toLowerCase());
        if (online) entry = { xuid: getPlayerXuid(online), name: online.name };
      }
      if (!entry)
        return fail(
          `§c找不到名为“${typed}”的玩家，对方必须至少加入过此世界一次。`,
        );
      if (entry.xuid === claim.ownerXuid)
        return fail("§c该玩家已是此领地的主人。");
      if (claim.members.find((m) => m.xuid === entry.xuid))
        return fail("§c该玩家已是此领地的成员。");
      targetXuid = entry.xuid;
      targetName = entry.name;
    } else {
      if (candidates.length === 0)
        return fail("§c暂无符合条件的玩家，请直接输入名称。");
      const idx = pickObs.getData();
      if (idx < 0 || idx >= candidates.length)
        return fail("§c请从列表选择玩家，或直接输入名称。");
      targetXuid = candidates[idx].xuid;
      targetName = candidates[idx].name;
    }
    const role = ROLE_IDS[roleObs.getData()] ?? "visitor";
    const dur = DURATIONS[durObs.getData()] ?? DURATIONS[0];
    const expiresAt = dur.ms > 0 ? nowMs() + dur.ms : 0;
    if (!addMember(claimId, targetXuid, targetName, role, expiresAt)) {
      return fail(
        "§c无法添加成员：对方可能已受信任，或领地成员数据已满。",
      );
    }
    tell(
      player,
      dur.ms > 0
        ? t("jm_at.cla.msg_member_added_timed", targetName, _roleLabel(role), dur.label)
        : t("jm_at.cla.msg_member_added_perm", targetName, _roleLabel(role)),
    );
    pendingNav = close ? () => {} : back;
    try {
      form.close();
    } catch {}
  };
  form.button(t("jm_at.cla.btn_add_member_go"), () => submit(false));
  form.button(t("jm_at.cla.btn_add_member_close"), () => submit(true));
  form.button(t("jm_at.common.btn_back"), () => {
    intent = "back";
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(() => showAdminAddMember(player, claimId, backFn));
  }
  if (pendingNav) return system.run(pendingNav);
  if (intent === "back") return system.run(back); // Back -> up one level; X / escape -> exit
}

async function showAdminMemberDetail(player, claimId, member, backFn) {
  const bodyParts = [
    raw("§9", member.name, "§r\n"),
    t("jm_at.cla.body_role", _roleLabel(member.role)),
  ];
  if (member.expiresAt && member.expiresAt > 0) {
    const remaining = member.expiresAt - nowMs();
    bodyParts.push(
      remaining > 0
        ? raw(
            "§r\n",
            t("jm_at.cla.body_expires_in", _fmtDurationShort(remaining)),
          )
        : raw("§r\n", t("jm_at.cla.body_expired")),
    );
  } else {
    bodyParts.push(raw("\n", t("jm_at.cla.body_permanent")));
  }

  const form = new ActionFormData()
    .title(t("jm_at.cla.member_title"))
    .body(raw(...bodyParts))
    .button(t("jm_at.cla.btn_edit_role"), "textures/ui/jm_at_server_controls")
    .button(t("jm_at.cla.btn_remove_member"), "textures/ui/jm_at_remove")
    .button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back")
    .button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showAdminMembers(player, claimId, backFn); // X = Back
  if (res.selection === 0)
    return showEditMember(player, claimId, member, () =>
      showAdminMembers(player, claimId, backFn),
    );
  if (res.selection === 1)
    return showAdminRemoveMember(player, claimId, member, backFn);
  if (res.selection === 2) return showAdminMembers(player, claimId, backFn); // Back
  if (res.selection === 3) return; // Close
}

async function showAdminRemoveMember(player, claimId, member, backFn) {
  const bodyParts = [
    t("jm_at.cla.remove_member_body", member.name, _roleLabel(member.role)),
  ];
  if (member.expiresAt && member.expiresAt > 0) {
    const remaining = member.expiresAt - nowMs();
    bodyParts.push(
      remaining > 0
        ? raw(
            "\n",
            t("jm_at.cla.body_temp_remaining", _fmtDurationShort(remaining)),
          )
        : raw("\n", t("jm_at.cla.body_expired")),
    );
  }
  const form = new MessageFormData()
    .title(t("jm_at.cla.remove_member_title"))
    .body(raw(...bodyParts))
    .button1(t("jm_at.common.btn_cancel"))
    .button2(t("jm_at.cla.btn_remove_red"));

  const res = await form.show(player);
  if (res.canceled || res.selection === 0)
    return showAdminMembers(player, claimId, backFn);
  removeMember(claimId, member.xuid);
  tell(player, t("jm_at.cla.msg_member_removed", member.name));
  return showAdminMembers(player, claimId, backFn);
}

// =========================================================
// Admin Trusted Ranks
// =========================================================

async function showAdminTrustedRanks(player, claimId, backFn) {
  const claim = getClaimById(claimId);
  if (!claim) return showClaimsAdmin(player);

  const form = new ActionFormData()
    .title(t("jm_at.cla.ranks_title"))
    .body(
      raw(
        t("jm_at.cla.ranks_body"),
        "\n",
        claim.trustedRanks.length === 0 ? t("jm_at.cla.ranks_none") : "",
      ),
    );

  form.button(t("jm_at.cla.btn_add_rank"), "textures/ui/jm_at_add");
  for (const r of claim.trustedRanks) {
    const displayTag =
      r.tag === MOD_TRUST_TAG
        ? t("jm_at.cla.rank_moderator_full")
        : raw("§l", r.tag);
    const parts = [_roleLabel(r.role)];
    if (r.expiresAt && r.expiresAt > 0) {
      const remaining = r.expiresAt - nowMs();
      parts.push(
        remaining > 0
          ? t("jm_at.cla.suffix_time_left", _fmtDurationShort(remaining))
          : t("jm_at.cla.suffix_expired"),
      );
    }
    form.button(raw(displayTag, "§r\n", ...parts), "textures/ui/jm_at_rank");
  }
  form.button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back");
  form.button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return backFn(); // X = Back
  if (res.selection === claim.trustedRanks.length + 1) return backFn(); // Back
  if (res.selection === claim.trustedRanks.length + 2) return; // Close
  if (res.selection === 0)
    return showAdminAddTrustedRank(player, claimId, backFn);
  const rankIdx = res.selection - 1;
  if (rankIdx >= 0 && rankIdx < claim.trustedRanks.length) {
    return showAdminTrustedRankDetail(
      player,
      claimId,
      claim.trustedRanks[rankIdx],
      backFn,
    );
  }
}

async function showAdminAddTrustedRank(player, claimId, backFn) {
  const claim = getClaimById(claimId);
  if (!claim) return showClaimsAdmin(player);
  if (claim.trustedRanks.length >= LIMITS.TRUSTED_RANKS_PER_CLAIM) {
    return warnForm(
      player,
      t("jm_at.cla.warn_ranks_max", LIMITS.TRUSTED_RANKS_PER_CLAIM),
      () => showAdminTrustedRanks(player, claimId, backFn),
    );
  }

  const reg = getPlayerRegistry();
  const dbRanks = Object.values(getRankDb()).map((r) => r.tag);
  const regRanks = Object.values(reg).map((e) => (e.rankTag ?? "").trim());
  const existingTags = new Set(claim.trustedRanks.map((r) => r.tag));
  const ranks = [...new Set([...regRanks, ...dbRanks])].filter(
    (r) => r.length > 0 && !existingTags.has(r),
  );
  if (!existingTags.has(MOD_TRUST_TAG)) {
    ranks.unshift(MOD_TRUST_TAG);
  }

  if (ranks.length === 0) {
    return warnForm(player, t("jm_at.cla.warn_no_ranks"), () =>
      showAdminTrustedRanks(player, claimId, backFn),
    );
  }

  const rankItems = ranks.map((r, i) => ({
    label:
      r === MOD_TRUST_TAG
        ? t("jm_at.cla.rank_moderator_plain")
        : r.replace(/§./g, ""),
    value: i,
  }));
  const roleItems = ROLE_ITEMS;
  const durItems = DURATIONS.map((d, i) => ({ label: d.label, value: i }));

  const rankObs = new ObservableNumber(0, { clientWritable: true });
  const roleObs = new ObservableNumber(2, { clientWritable: true });
  const durObs = new ObservableNumber(0, { clientWritable: true });

  const form = new CustomForm(player, t("jm_at.cla.add_rank_title"));
  form.spacer();
  form.dropdown(t("jm_at.cla.field_rank"), rankObs, rankItems);
  form.dropdown(t("jm_at.cla.field_role"), roleObs, roleItems);
  form.dropdown(t("jm_at.cla.field_duration"), durObs, durItems);

  let pendingNav = null;
  let intent = null;
  const back = () => showAdminTrustedRanks(player, claimId, backFn);

  const submit = (close) => {
    const idx = rankObs.getData();
    if (idx < 0 || idx >= ranks.length) return;
    const chosen = ranks[idx];
    const role = ROLE_IDS[roleObs.getData()] ?? "visitor";
    const dur = DURATIONS[durObs.getData()] ?? DURATIONS[0];
    const expiresAt = dur.ms > 0 ? nowMs() + dur.ms : 0;
    if (!addTrustedRank(claimId, chosen, role, expiresAt)) {
      pendingNav = () =>
        warnForm(player, t("jm_at.cla.warn_rank_add_failed"), () =>
          showAdminAddTrustedRank(player, claimId, backFn),
        );
      try {
        form.close();
      } catch {}
      return;
    }
    const shown =
      chosen === MOD_TRUST_TAG ? t("jm_at.cla.rank_moderator") : chosen;
    tell(
      player,
      dur.ms > 0
        ? t("jm_at.cla.msg_rank_added_timed", shown, _roleLabel(role), dur.label)
        : t("jm_at.cla.msg_rank_added_perm", shown, _roleLabel(role)),
    );
    pendingNav = close ? () => {} : back;
    try {
      form.close();
    } catch {}
  };
  form.spacer();
  form.button(t("jm_at.cla.btn_add_rank_go"), () => submit(false));
  form.button(t("jm_at.cla.btn_add_rank_close"), () => submit(true));
  form.button(t("jm_at.common.btn_back"), () => {
    intent = "back";
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(() => showAdminAddTrustedRank(player, claimId, backFn));
  }
  if (pendingNav) return system.run(pendingNav);
  if (intent === "back") return system.run(back); // Back -> up one level; X / escape -> exit
}

async function showAdminTrustedRankDetail(player, claimId, rankEntry, backFn) {
  const displayTag =
    rankEntry.tag === MOD_TRUST_TAG
      ? t("jm_at.cla.rank_moderator_plain")
      : rankEntry.tag;
  const bodyParts = [
    raw("§9", displayTag, "§r\n"),
    t("jm_at.cla.body_role", _roleLabel(rankEntry.role)),
  ];
  if (rankEntry.expiresAt && rankEntry.expiresAt > 0) {
    const remaining = rankEntry.expiresAt - nowMs();
    bodyParts.push(
      remaining > 0
        ? raw(
            "§r\n",
            t("jm_at.cla.body_expires_in", _fmtDurationShort(remaining)),
          )
        : raw("§r\n", t("jm_at.cla.body_expired")),
    );
  } else {
    bodyParts.push(raw("§r\n", t("jm_at.cla.body_permanent")));
  }

  const form = new ActionFormData()
    .title(t("jm_at.cla.rank_title"))
    .body(raw(...bodyParts))
    .button(t("jm_at.cla.btn_edit_role"), "textures/ui/jm_at_server_controls")
    .button(t("jm_at.cla.btn_remove_rank"), "textures/ui/jm_at_remove")
    .button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back")
    .button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showAdminTrustedRanks(player, claimId, backFn); // X = Back
  if (res.selection === 2)
    return showAdminTrustedRanks(player, claimId, backFn); // Back
  if (res.selection === 3) return; // Close
  if (res.selection === 0)
    return showAdminEditTrustedRank(player, claimId, rankEntry, backFn);
  if (res.selection === 1)
    return showAdminRemoveTrustedRank(player, claimId, rankEntry.tag, backFn);
}

async function showAdminEditTrustedRank(player, claimId, rankEntry, backFn) {
  const roleIdx = ROLE_IDS.indexOf(rankEntry.role);
  const roleItems = ROLE_ITEMS;
  const durItems = DURATIONS.map((d, i) => ({ label: d.label, value: i }));

  const roleObs = new ObservableNumber(roleIdx >= 0 ? roleIdx : 2, {
    clientWritable: true,
  });
  const durObs = new ObservableNumber(0, { clientWritable: true });

  const form = new CustomForm(player, t("jm_at.cla.edit_rank_title"));
  form.spacer();
  form.dropdown(t("jm_at.cla.field_role"), roleObs, roleItems);
  form.dropdown(t("jm_at.cla.field_duration"), durObs, durItems);

  let pendingNav = null;
  let intent = null;
  const back = () =>
    showAdminTrustedRankDetail(player, claimId, rankEntry, backFn);

  const save = (close) => {
    const newRole = ROLE_IDS[roleObs.getData()] ?? "visitor";
    const dur = DURATIONS[durObs.getData()] ?? DURATIONS[0];
    const expiresAt = dur.ms > 0 ? nowMs() + dur.ms : 0;
    updateTrustedRank(claimId, rankEntry.tag, newRole, expiresAt);
    const displayName =
      rankEntry.tag === MOD_TRUST_TAG
        ? t("jm_at.cla.rank_moderator")
        : rankEntry.tag;
    tell(
      player,
      t("jm_at.cla.msg_rank_updated", displayName, _roleLabel(newRole)),
    );
    const claim = getClaimById(claimId);
    const updated = claim?.trustedRanks.find((r) => r.tag === rankEntry.tag);
    pendingNav = close
      ? () => {}
      : updated
        ? () => showAdminTrustedRankDetail(player, claimId, updated, backFn)
        : () => showAdminTrustedRanks(player, claimId, backFn);
    try {
      form.close();
    } catch {}
  };
  form.spacer();
  form.button(t("jm_at.common.btn_save"), () => save(false));
  form.button(t("jm_at.cla.btn_save_close"), () => save(true));
  form.button(t("jm_at.common.btn_back"), () => {
    intent = "back";
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(() =>
      showAdminEditTrustedRank(player, claimId, rankEntry, backFn),
    );
  }
  if (pendingNav) return system.run(pendingNav);
  if (intent === "back") return system.run(back); // Back -> up one level; X / escape -> exit
}

async function showAdminRemoveTrustedRank(player, claimId, rankTag, backFn) {
  const claim = getClaimById(claimId);
  const entry = claim?.trustedRanks.find((r) => r.tag === rankTag);
  const displayName =
    rankTag === MOD_TRUST_TAG ? t("jm_at.cla.rank_moderator_plain") : rankTag;
  const bodyParts = [t("jm_at.cla.remove_rank_body", displayName)];
  if (entry) {
    bodyParts.push(raw("\n", t("jm_at.cla.body_role", _roleLabel(entry.role))));
    if (entry.expiresAt && entry.expiresAt > 0) {
      const remaining = entry.expiresAt - nowMs();
      bodyParts.push(
        remaining > 0
          ? raw(
              "§r\n",
              t("jm_at.cla.body_expires_in", _fmtDurationShort(remaining)),
            )
          : raw("§r\n", t("jm_at.cla.body_expired")),
      );
    }
  }
  bodyParts.push(raw("\n\n", t("jm_at.cla.remove_rank_warn")));
  const form = new MessageFormData()
    .title(t("jm_at.cla.remove_rank_title"))
    .body(raw(...bodyParts))
    .button1(t("jm_at.common.btn_cancel"))
    .button2(t("jm_at.cla.btn_remove_red"));

  const res = await form.show(player);
  if (res.canceled || res.selection === 0)
    return showAdminTrustedRanks(player, claimId, backFn);
  removeTrustedRank(claimId, rankTag);
  tell(player, t("jm_at.cla.msg_rank_removed", displayName));
  return showAdminTrustedRanks(player, claimId, backFn);
}

// =========================================================
// Helpers
// =========================================================

function _resolvePlayerByName(name, reg) {
  const lower = name.toLowerCase();
  for (const [, e] of Object.entries(reg)) {
    if ((e.name ?? "").toLowerCase() === lower) return e;
  }
  return null;
}

// Stored role ids double as display words; localized via jm_at.cla.role_*.
// lang-keys: jm_at.cla.role_*
const ROLE_LABEL_KEYS = {
  visitor: "jm_at.cla.role_visitor",
  member: "jm_at.cla.role_member",
  builder: "jm_at.cla.role_builder",
  "co-owner": "jm_at.cla.role_co_owner",
};

function _roleLabel(role) {
  const key = ROLE_LABEL_KEYS[role];
  return key ? t(key) : String(role ?? "");
}

function _fmtDurationShort(ms) {
  if (ms <= 0) return t("jm_at.cla.fmtdur_expired");
  const s = Math.floor(ms / 1000);
  if (s < 60) return t("jm_at.cla.fmtdur_s", s);
  if (s < 3600) return t("jm_at.cla.fmtdur_m", Math.floor(s / 60));
  if (s < 86400)
    return t(
      "jm_at.cla.fmtdur_h_m",
      Math.floor(s / 3600),
      Math.floor((s % 3600) / 60),
    );
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  return h > 0 ? t("jm_at.cla.fmtdur_d_h", d, h) : t("jm_at.cla.fmtdur_d", d);
}

function _blocksToChunks(blocks) {
  return Math.round((blocks / 256) * 100) / 100;
}

function _trimName(s, max = 20) {
  return s.length > max ? s.slice(0, max) + ".." : s;
}

function _fmtDimShort(dimId) {
  if (dimId === "minecraft:overworld") return t("jm_at.cla.dim_ow");
  if (dimId === "minecraft:nether") return t("jm_at.cla.dim_nether");
  if (dimId === "minecraft:the_end") return t("jm_at.cla.dim_end_short");
  return dimId;
}

function _dimHeightRange(dimId) {
  if (dimId === "minecraft:nether") return { min: 0, max: 128 };
  if (dimId === "minecraft:the_end") return { min: 0, max: 256 };
  return { min: -64, max: 320 }; // overworld
}

// Color + word key per log type; the [brackets] are composed in code so one
// word key serves both the colored and the plain (dropdown-safe) variants.
// lang-keys: jm_at.cla.logtype_*
const LOG_TYPE_DEFS = {
  // Creation / structural
  create: { color: "§2", key: "jm_at.cla.logtype_create" },
  expand: { color: "§2", key: "jm_at.cla.logtype_expand" },
  extend: { color: "§2", key: "jm_at.cla.logtype_extend" },
  subclaim_create: { color: "§a", key: "jm_at.cla.logtype_subclaim_create" },
  // Deletion
  delete_owner: { color: "§c§m", key: "jm_at.cla.logtype_delete_owner" },
  delete_admin: { color: "§c", key: "jm_at.cla.logtype_delete_admin" },
  subclaim_delete: { color: "§8", key: "jm_at.cla.logtype_subclaim_delete" },
  // Members
  member_add: { color: "§9", key: "jm_at.cla.logtype_member_add" },
  member_remove: { color: "§7", key: "jm_at.cla.logtype_member_remove" },
  member_update: { color: "§5", key: "jm_at.cla.logtype_member_update" },
  member_expire: { color: "§7", key: "jm_at.cla.logtype_member_expire" },
  // Trusted ranks
  trust_add: { color: "§b", key: "jm_at.cla.logtype_trust_add" },
  trust_remove: { color: "§7", key: "jm_at.cla.logtype_trust_remove" },
  trust_update: { color: "§5", key: "jm_at.cla.logtype_trust_update" },
  trust_expire: { color: "§7", key: "jm_at.cla.logtype_trust_expire" },
  // Admin actions
  transfer: { color: "§6", key: "jm_at.cla.logtype_transfer" },
  adjust_height: { color: "§e", key: "jm_at.cla.logtype_adjust_height" },
};

function _fmtLogType(type) {
  const def = LOG_TYPE_DEFS[type];
  return def ? raw(def.color + "[", t(def.key), "]") : raw("§7[", type, "]");
}

// Uncolored variant: dropdown items render § literally, and the filter
// summary line stripped colors — matches the old .replace(/§./g, "") output.
function _fmtLogTypePlain(type) {
  const def = LOG_TYPE_DEFS[type];
  return def ? raw("[", t(def.key), "]") : raw("[", type, "]");
}

function _fmtAgoShort(ms) {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return t("jm_at.cla.ago_s", s);
  if (s < 3600) return t("jm_at.cla.ago_m", Math.floor(s / 60));
  if (s < 86400) return t("jm_at.cla.ago_h", Math.floor(s / 3600));
  return t("jm_at.cla.ago_d", Math.floor(s / 86400));
}
