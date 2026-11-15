/**
 * ui-claims-player.js — Player-facing claim UI screens
 *
 * Entry point: showClaimsPlayer(player)
 * Opened by the Claim Wand item (see the itemUse handler in main.js).
 * Intentionally NOT linked from the Player Menu — claims are accessed only
 * via the Claim Wand.
 */

// Keys picked via ternaries (overlap-warn + help variants).
// lang-keys: jm_at.cl.help_overlap_staff jm_at.cl.help_overlap_staff_owner jm_at.cl.ow_body_admin jm_at.cl.ow_body_owner_only jm_at.cl.ow_line_admin
import {
  ActionFormData,
  MessageFormData,
  CustomForm,
  ObservableString,
  ObservableNumber,
  ObservableBoolean,
  DataDrivenScreenClosedReason,
} from "@minecraft/server-ui";
import { world, system } from "@minecraft/server";
import { t, raw } from "./i18n.js";
import { LIMITS, PROTECTION_DEFS } from "./constants.js";
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
import { getCfg, getPlayerCore, getPlayerRegistry } from "./storage.js";
import { isAdmin, isOwner, adminCan } from "./permissions.js";
import { getRankDb } from "./rank-db.js";
import {
  getPendingSelection,
  clearPendingSelection,
  normalizeCorners,
  calcArea,
  claimShapeOverlaps,
  getAllClaims,
  getClaimsByOwner,
  getAdminClaims,
  getClaimById,
  getOwnerUsedArea,
  getPlayerClaimBudget,
  evaluateSelection,
  claimPreviewOpts,
  createClaim,
  deleteClaim,
  renameClaim,
  setClaimWelcomeMessage,
  updateClaimProtections,
  updateClaimYBounds,
  addMember,
  removeMember,
  updateMember,
  addTrustedRank,
  removeTrustedRank,
  updateTrustedRank,
  visualizeClaim,
  visualizeClaimMerged,
  getSubClaimsByParent,
  createSubClaim,
  deleteSubClaim,
  getClaimAt,
  MOD_TRUST_TAG,
  isInsideClaimShape,
  expandClaim,
  extendClaim,
  canManageClaim,
  getCoOwnedClaims,
  getCoOwnedClaimsForMyClaims,
} from "./claims.js";
import {
  showClaimsAdmin,
  showEditProtections,
  showTransferOwnership,
  showForceDelete,
  showAdminAdjustHeight,
} from "./ui-claims-admin.js";

// lang-keys: jm_at.cl.dur_*
const DURATIONS = [
  { label: t("jm_at.cl.dur_permanent"), ms: 0 },
  { label: t("jm_at.cl.dur_15m"), ms: 15 * 60000 },
  { label: t("jm_at.cl.dur_30m"), ms: 30 * 60000 },
  { label: t("jm_at.cl.dur_1h"), ms: 60 * 60000 },
  { label: t("jm_at.cl.dur_2h"), ms: 2 * 60 * 60000 },
  { label: t("jm_at.cl.dur_6h"), ms: 6 * 60 * 60000 },
  { label: t("jm_at.cl.dur_12h"), ms: 12 * 60 * 60000 },
  { label: t("jm_at.cl.dur_1d"), ms: 24 * 60 * 60000 },
  { label: t("jm_at.cl.dur_3d"), ms: 3 * 24 * 60 * 60000 },
  { label: t("jm_at.cl.dur_7d"), ms: 7 * 24 * 60 * 60000 },
];

const ROLE_IDS = ["visitor", "member", "builder", "co-owner"];

/** Dropdown items for the member/rank role picker (fresh array per form). */
// lang-keys: jm_at.cl.role_opt_*
function _roleItems() {
  return [
    { label: t("jm_at.cl.role_opt_visitor"), value: 0 },
    { label: t("jm_at.cl.role_opt_member"), value: 1 },
    { label: t("jm_at.cl.role_opt_builder"), value: 2 },
    { label: t("jm_at.cl.role_opt_co_owner"), value: 3 },
  ];
}

/** Display name for a stored role id. Unknown ids pass through literally. */
// lang-keys: jm_at.cl.role_*
function _roleName(role) {
  const key = {
    visitor: "jm_at.cl.role_visitor",
    member: "jm_at.cl.role_member",
    builder: "jm_at.cl.role_builder",
    "co-owner": "jm_at.cl.role_co_owner",
  }[role];
  return key ? t(key) : { text: String(role) };
}

/** Join an array of RawMessage/string parts with a literal separator. */
function _joinRaw(parts, sep) {
  const out = [];
  parts.forEach((p, i) => {
    if (i > 0) out.push(sep);
    out.push(p);
  });
  return raw(...out);
}

// =========================================================
// Entry point
// =========================================================

export async function showClaimsPlayer(player) {
  const xuid = getPlayerXuid(player);
  const pending = getPendingSelection(xuid);
  const hasBothCorners = pending?.corner1 && pending?.corner2;
  const ownedClaims = getClaimsByOwner(xuid).filter((c) => !c.isAdminClaim);
  const cfg = getCfg();
  const usedArea = getOwnerUsedArea(xuid);
  const adminMode = isAdmin(player).ok;
  const canClaimsAdmin = adminMode && adminCan(player, "claimsAdmin");
  const canPlayerClaim = adminMode || cfg.maxClaimsPerPlayer > 0;

  // Single source of truth for what the selection can do + whether THIS player
  // can actually do it. Preview as the most capable claim type the player can
  // create (claimPreviewOpts: owner -> owner-only, admin -> admin, else plain) so
  // overlap reads as an "overwrite" path for staff but a hard block for regular
  // players, and admins on an admin-only server aren't shown a false "admin-only"
  // wall. The corner-2 hint uses the SAME helper, so the surfaces can't diverge.
  const previewOpts = claimPreviewOpts(player);
  let verdict = null;
  let subClaimParent = null;
  let expandTarget = null;
  let extendTarget = null;
  let createNewOk = false;
  if (hasBothCorners) {
    const { min, max } = normalizeCorners(pending.corner1, pending.corner2);
    verdict = evaluateSelection(
      player,
      min,
      max,
      pending.dimensionId,
      previewOpts,
    );
    const tgt = verdict.target ? getClaimById(verdict.target.id) : null;
    if (verdict.kind === "subclaim") subClaimParent = tgt;
    else if (verdict.kind === "expand") expandTarget = tgt;
    else if (verdict.kind === "extend") {
      extendTarget = tgt;
      // Whether the bordering spot also supports a fresh "Create New Claim" — the
      // verdict computes this (verdict.canCreateNew) so the hint and menu agree.
      createNewOk = verdict.canCreateNew;
    }
  }

  const tname = verdict?.target?.name ?? "";

  let bodyText;
  if (!canPlayerClaim) {
    bodyText = t("jm_at.cl.body_admin_managed");
  } else {
    const budget = getPlayerClaimBudget(player);
    const ctx = !hasBothCorners
      ? t("jm_at.cl.body_howto")
      : verdict.ok
        ? verdict.kind === "subclaim"
          ? t("jm_at.cl.ctx_subclaim", tname)
          : verdict.kind === "expand"
            ? t("jm_at.cl.ctx_expand", tname)
            : verdict.kind === "extend"
              ? createNewOk
                ? t("jm_at.cl.ctx_extend_or_new", tname)
                : t("jm_at.cl.ctx_extend", tname)
              : verdict.primaryAction === "overwrite"
                ? t(
                    "jm_at.cl.ctx_overwrite",
                    verdict.overwrite.deletable.length,
                  )
                : t("jm_at.cl.ctx_ready")
        : raw(
            "§c",
            verdict.blockers[0]?.message ?? t("jm_at.claims.hint_cant_claim"),
          );
    bodyText = raw(
      t(
        "jm_at.cl.body_stats",
        ownedClaims.length,
        cfg.maxClaimsPerPlayer,
        _blocksToChunks(usedArea),
        budget,
      ),
      "\n\n",
      ctx,
    );
  }

  const form = new ActionFormData()
    .title(t("jm_at.cl.title_claims"))
    .body(bodyText);

  // Build buttons as {label, icon, run} so the dispatch can never drift from the
  // render order (this menu's positional index arithmetic was historically a
  // fragile invariant — see the claim-eval mapping notes).
  const items = [];

  // Confirm action(s) — only when the player can actually act here. A blocked
  // selection shows the red reason in the body above and offers NO confirm.
  // Target-kind branches require their resolved claim object; if it vanished
  // between build and now (getClaimById returned null), fall through to no button
  // rather than deref null or wrongly create a fresh claim.
  if (hasBothCorners && canPlayerClaim && verdict?.ok) {
    if (verdict.kind === "extend" && extendTarget) {
      items.push({
        label: t("jm_at.cl.btn_extend", tname),
        icon: "textures/ui/jm_at_add",
        run: () => showExtendClaim(player, extendTarget),
      });
      if (createNewOk)
        items.push({
          label: t("jm_at.cl.btn_create_new"),
          icon: "textures/ui/jm_at_add",
          run: () => showConfirmClaim(player),
        });
    } else if (verdict.kind === "subclaim" && subClaimParent) {
      items.push({
        label: t("jm_at.cl.btn_confirm_subclaim"),
        icon: "textures/ui/jm_at_add",
        run: () =>
          showConfirmSubClaim(player, subClaimParent.id, () =>
            showClaimsPlayer(player),
          ),
      });
    } else if (verdict.kind === "expand" && expandTarget) {
      items.push({
        label: t("jm_at.cl.btn_expand", tname),
        icon: "textures/ui/jm_at_add",
        run: () => showExpandClaim(player, expandTarget),
      });
    } else if (verdict.kind === "new") {
      // For staff overwriting existing claim(s), the claim MUST be an admin /
      // owner-only claim — seed those toggles ON so the confirm goes through
      // (otherwise it defaults to a plain claim and the overlap is rejected), and
      // route through showOverwriteWarn so the deletion is okayed BEFORE the
      // name/protections form (decision #2).
      const overwrite = verdict.primaryAction === "overwrite";
      const seed = {
        adminClaim: !!previewOpts.isAdminClaim,
        ownerOnly: !!previewOpts.ownerOnly,
      };
      items.push({
        label: overwrite
          ? t(
              "jm_at.cl.btn_overwrite_create",
              verdict.overwrite.deletable.length,
            )
          : t("jm_at.cl.btn_confirm_pending"),
        icon: "textures/ui/jm_at_add",
        run: () =>
          overwrite
            ? showOverwriteWarn(player, verdict, seed)
            : showConfirmClaim(player),
      });
    }
  }

  // Cancel a pending selection — available whenever a selection exists (even if
  // the player can't claim here, or only corner 1 is set), so a stray selection
  // and its corner markers can be cleared without relogging.
  if (pending?.corner1) {
    items.push({
      label: t("jm_at.cl.btn_cancel_selection"),
      icon: "textures/ui/jm_at_close",
      run: () => {
        clearPendingSelection(xuid);
        tell(player, t("jm_at.cl.msg_selection_canceled"));
        return showClaimsPlayer(player);
      },
    });
  }

  const coOwnedCount = getCoOwnedClaimsForMyClaims(xuid).length;
  items.push({
    label: coOwnedCount
      ? t("jm_at.cl.btn_my_claims_co", ownedClaims.length, coOwnedCount)
      : t("jm_at.cl.btn_my_claims", ownedClaims.length),
    icon: "textures/ui/jm_at_my_claims",
    run: () => showMyClaims(player),
  });

  if (adminMode)
    items.push({
      label: t("jm_at.cl.btn_admin_claims", getAdminClaims().length),
      icon: "textures/ui/jm_at_admin_claims",
      run: () => showAdminClaimsList(player),
    });

  if (canClaimsAdmin)
    items.push({
      label: t("jm_at.cl.btn_all_claims"),
      icon: "textures/ui/jm_at_control_panel",
      run: () => showClaimsAdmin(player, () => showClaimsPlayer(player)),
    });

  items.push({
    label: t("jm_at.cl.btn_help"),
    icon: "textures/ui/jm_at_player_info",
    run: () => showClaimHelp(player),
  });

  for (const it of items) form.button(it.label, it.icon);

  const res = await form.show(player);
  if (res.canceled) return;
  const chosen = items[res.selection];
  if (chosen) return chosen.run();
}

// =========================================================
// Helper: return the top-level (root) claim at a position.
// Unlike getParentClaimAt (which skips sub-claims entirely),
// this finds the most-specific claim first, then walks up the
// parentId chain so players standing inside a sub-claim or
// sub-sub-claim still get the "Current Claim" shortcut button.
// =========================================================

function _getTopLevelClaimAt(dimensionId, pos) {
  let claim = getClaimAt(dimensionId, pos);
  if (!claim) return null;
  // Walk up to root — depth is capped at 2 (sub-sub → sub → top)
  while (claim.parentId) {
    const parent = getClaimById(claim.parentId);
    if (!parent) break;
    claim = parent;
  }
  return claim;
}

// =========================================================
// My Claims (sub-page listing player's claims)
// =========================================================

async function showMyClaims(player) {
  const xuid = getPlayerXuid(player);
  const ownedClaims = getClaimsByOwner(xuid).filter((c) => !c.isAdminClaim);
  ownedClaims.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const coOwnedClaims = getCoOwnedClaimsForMyClaims(xuid);
  coOwnedClaims.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const totalCount = ownedClaims.length + coOwnedClaims.length;
  const form = new ActionFormData()
    .title(t("jm_at.cl.title_my_claims"))
    .body(
      totalCount === 0
        ? t("jm_at.cl.my_none")
        : raw(
            t("jm_at.cl.my_owned", ownedClaims.length),
            coOwnedClaims.length
              ? t("jm_at.cl.my_co_owned", coOwnedClaims.length)
              : "",
            "\n\n",
            t("jm_at.cl.my_select"),
          ),
    );

  // Resolve the highest-level (closest to root) claim at the player's position
  // that they can actually manage. Owners get the root; sub-claim-only co-owners
  // get the highest ancestor where canManageClaim passes.
  const _rawCurrentClaim = getClaimAt(player.dimension.id, player.location);
  let currentClaim = null;
  if (_rawCurrentClaim) {
    // Build chain root-first: [root, ..., most-specific]
    const _chain = [];
    let _cur = _rawCurrentClaim;
    while (_cur) {
      _chain.unshift(_cur);
      _cur = _cur.parentId ? getClaimById(_cur.parentId) : null;
    }
    for (const _c of _chain) {
      if (canManageClaim(player, _c)) {
        currentClaim = _c;
        break;
      }
    }
  }
  const hasCurrentBtn = !!currentClaim;
  if (hasCurrentBtn) {
    form.button(
      t("jm_at.cl.btn_current", _trimName(currentClaim.name || currentClaim.id)),
      "textures/ui/jm_at_position",
    );
  }

  for (const c of ownedClaims) {
    form.button(
      t(
        "jm_at.cl.btn_claim_row",
        _trimName(c.name ? c.name : c.id),
        _blocksToChunks(c.area),
        _fmtDimShort(c.dimension),
      ),
      c.ownerOnly
        ? "textures/ui/jm_at_owner_claims"
        : "textures/ui/jm_at_my_claims",
    );
  }
  for (const c of coOwnedClaims) {
    form.button(
      t(
        "jm_at.cl.btn_claim_row_co",
        _trimName(c.name ? c.name : c.id),
        _blocksToChunks(c.area),
        _fmtDimShort(c.dimension),
      ),
      "textures/ui/jm_at_my_claims",
    );
  }
  form.button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back");
  form.button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const allClaims = [...ownedClaims, ...coOwnedClaims];
  const res = await form.show(player);
  if (res.canceled) return showClaimsPlayer(player); // X = Back

  const off = hasCurrentBtn ? 1 : 0;
  if (hasCurrentBtn && res.selection === 0)
    return showClaimDetail(player, currentClaim.id, () => showMyClaims(player));
  if (res.selection === allClaims.length + off) return showClaimsPlayer(player); // Back
  if (res.selection === allClaims.length + off + 1) return; // Close

  if (res.selection >= off && res.selection < allClaims.length + off) {
    return showClaimDetail(player, allClaims[res.selection - off].id);
  }
}

// =========================================================
// Admin Claims (sub-page listing all admin claims)
// =========================================================

async function showAdminClaimsList(player) {
  const adminClaims = getAdminClaims();
  adminClaims.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const form = new ActionFormData()
    .title(t("jm_at.cl.title_admin_claims"))
    .body(
      adminClaims.length === 0
        ? t("jm_at.cl.admin_none")
        : t("jm_at.cl.admin_count", adminClaims.length),
    );

  const currentClaim = _getTopLevelClaimAt(
    player.dimension.id,
    player.location,
  );
  const hasCurrentBtn = !!currentClaim;
  if (hasCurrentBtn) {
    form.button(
      t("jm_at.cl.btn_current", _trimName(currentClaim.name || currentClaim.id)),
      "textures/ui/jm_at_position",
    );
  }

  for (const c of adminClaims) {
    form.button(
      t(
        "jm_at.cl.btn_claim_row_admin",
        _trimName(c.name ? c.name : c.id),
        c.ownerName,
        _blocksToChunks(c.area),
        _fmtDimShort(c.dimension),
      ),
      "textures/ui/jm_at_admin_claims",
    );
  }
  form.button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back");
  form.button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showClaimsPlayer(player); // X = Back

  const off = hasCurrentBtn ? 1 : 0;
  if (hasCurrentBtn && res.selection === 0)
    return showClaimDetail(player, currentClaim.id, () =>
      showAdminClaimsList(player),
    );
  if (res.selection === adminClaims.length + off)
    return showClaimsPlayer(player); // Back
  if (res.selection === adminClaims.length + off + 1) return; // Close

  if (res.selection >= off && res.selection < adminClaims.length + off) {
    return showClaimDetail(player, adminClaims[res.selection - off].id, () =>
      showAdminClaimsList(player),
    );
  }
}

// =========================================================
// Expand / Extend claim
// =========================================================

async function showExpandClaim(player, existingClaim, draft = null) {
  const xuid = getPlayerXuid(player);
  const pending = getPendingSelection(xuid);
  if (!pending?.corner1 || !pending?.corner2) {
    return warnForm(player, t("jm_at.cl.w_no_selection"), () =>
      showClaimsPlayer(player),
    );
  }
  if (pending.dimensionId !== player.dimension.id) {
    return warnForm(player, t("jm_at.cl.w_wrong_dim"), () =>
      showClaimsPlayer(player),
    );
  }

  const { min, max } = normalizeCorners(pending.corner1, pending.corner2);
  const newArea = calcArea(min, max);
  const oldArea = existingClaim.area;
  const diff = newArea - oldArea;
  const used = getOwnerUsedArea(xuid);
  const budget = getPlayerClaimBudget(player);
  const claimName = existingClaim.name || existingClaim.id;
  const budgetAfter = _blocksToChunks(used + diff);

  const detailLabel = raw(
    "§l",
    claimName,
    "§r\n",
    t(
      "jm_at.cl.expand_area",
      _blocksToChunks(oldArea),
      _blocksToChunks(newArea),
      _blocksToChunks(diff),
    ),
    "\n",
    budgetAfter > budget ? "§c§l" : "§2",
    t("jm_at.cl.budget_used", budgetAfter, budget),
    "\n",
    t(
      "jm_at.cl.coords_xz",
      Math.floor(min.x),
      Math.floor(min.z),
      Math.floor(max.x),
      Math.floor(max.z),
    ),
  );

  const nameObs = new ObservableString(draft?.name ?? claimName, {
    clientWritable: true,
  });
  const status = new ObservableString("");
  const statusShown = new ObservableBoolean(false);
  let pendingNav = null;
  let intent = null;
  const back = () => showClaimsPlayer(player);
  const reopen = () =>
    showExpandClaim(player, existingClaim, { name: nameObs.getData() });
  const snapshot = () => nameObs.getData();
  const initial = claimName;

  const form = new CustomForm(player, t("jm_at.cl.title_expand"));
  form.label(detailLabel);
  form.spacer();
  form.textField(t("jm_at.cl.field_claim_name"), nameObs);
  form.spacer();
  form.label(status, { visible: statusShown });
  form.spacer({ visible: statusShown });

  const doExpand = (name, close) => {
    const result = expandClaim(existingClaim.id, player, min, max);
    clearPendingSelection(xuid);
    if (!result.ok) {
      return warnForm(player, raw("§c", result.reason), () =>
        showClaimsPlayer(player),
      );
    }
    // Only rewrite the name when it changed — the field is seeded with the
    // current name, so an untouched expand shouldn't trigger a rename write.
    if (name !== initial) renameClaim(result.claim.id, name);
    tell(player, t("jm_at.cl.msg_expanded", name));
    visualizeClaim(
      player,
      result.claim.min,
      result.claim.max,
      player.location.y,
    );
    return close ? undefined : showClaimsPlayer(player);
  };

  const submit = (close) => {
    const name = clampText(
      String(nameObs.getData() ?? "").trim(),
      LIMITS.CLAIM_NAME_MAX,
    );
    if (!name) {
      status.setData("§c请输入领地名称。");
      statusShown.setData(true);
      return;
    }
    pendingNav = () => doExpand(name, close);
    try {
      form.close();
    } catch {}
  };
  form.button(t("jm_at.cl.btn_do_expand"), () => submit(false));
  form.button(t("jm_at.cl.btn_do_expand_close"), () => submit(true));
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

async function showExtendClaim(player, existingClaim) {
  const xuid = getPlayerXuid(player);
  const pending = getPendingSelection(xuid);
  if (!pending?.corner1 || !pending?.corner2) {
    return warnForm(player, t("jm_at.cl.w_no_selection"), () =>
      showClaimsPlayer(player),
    );
  }
  if (pending.dimensionId !== player.dimension.id) {
    return warnForm(player, t("jm_at.cl.w_wrong_dim"), () =>
      showClaimsPlayer(player),
    );
  }

  const { min, max } = normalizeCorners(pending.corner1, pending.corner2);
  const extArea = calcArea(min, max);
  const used = getOwnerUsedArea(xuid);
  const budget = getPlayerClaimBudget(player);
  const claimName = existingClaim.name || existingClaim.id;
  const extCount = (existingClaim.extensions?.length ?? 0) + 1;
  const budgetAfter = _blocksToChunks(used + extArea);

  const confirm = new MessageFormData()
    .title(t("jm_at.cl.title_extend"))
    .body(
      t(
        "jm_at.cl.extend_body",
        claimName,
        _blocksToChunks(extArea),
        _blocksToChunks(existingClaim.area + extArea),
        raw(
          budgetAfter > budget ? "§c§l" : "§2",
          t("jm_at.cl.budget_frac", budgetAfter, budget),
        ),
        extCount,
      ),
    )
    .button1(t("jm_at.common.btn_cancel"))
    .button2(t("jm_at.cl.btn_extend_confirm"));

  const cRes = await confirm.show(player);
  if (cRes.canceled || cRes.selection === 0) return showClaimsPlayer(player);

  const result = extendClaim(existingClaim.id, player, min, max);
  clearPendingSelection(xuid);

  if (!result.ok) {
    return warnForm(player, raw("§c", result.reason), () =>
      showClaimsPlayer(player),
    );
  }

  tell(player, t("jm_at.cl.msg_extended", claimName));
  visualizeClaimMerged(
    player,
    result.claim,
    player.location.y,
    "jm_at:viewer_particles",
    2,
    -3,
    false,
  );
  return showClaimsPlayer(player);
}

// =========================================================
// Confirm pending selection
// =========================================================

/**
 * Decision #2: when a staff overwrite is chosen from the menu, warn about the
 * deletion BEFORE the name/protections form — so the player doesn't invest in
 * setup before okaying it. The deletion itself still happens at commit time in
 * doCreate (deleting before the form would destroy claims if the player then
 * cancels); the overwriteAck flag tells doCreate the warning already happened.
 * `seed` = { adminClaim, ownerOnly } — the claim type the overwrite requires.
 */
async function showOverwriteWarn(player, verdict, seed) {
  const del = verdict.overwrite.deletable;
  const lines = _joinRaw(
    del.map((c) =>
      t(
        c.isAdminClaim ? "jm_at.cl.ow_line_admin" : "jm_at.cl.ow_line",
        c.name,
        c.ownerName,
      ),
    ),
    "\n",
  );
  const warn = new MessageFormData()
    .title(t("jm_at.cl.title_overlap_warn"))
    .body(
      t(
        seed.ownerOnly
          ? "jm_at.cl.ow_body_owner_only"
          : "jm_at.cl.ow_body_admin",
        del.length,
        lines,
      ),
    )
    .button1(t("jm_at.common.btn_cancel"))
    .button2(t("jm_at.cl.btn_overwrite"));
  const res = await warn.show(player);
  if (res.canceled || res.selection === 0) return showClaimsPlayer(player);
  return showConfirmClaim(player, { ...seed, overwriteAck: true });
}

/**
 * DDUI (CustomForm) claim-creation confirm. One reactive screen: claim details,
 * a name field, the visible protection toggles, and (for staff/owner) the admin
 * / owner-only toggles — read straight off Observables, removing the old
 * formValues index arithmetic. createClaim and the overlap-overwrite flow stay
 * the authority, run after the form closes.
 */
async function showConfirmClaim(player, draft = null) {
  const xuid = getPlayerXuid(player);
  const pending = getPendingSelection(xuid);
  if (!pending?.corner1 || !pending?.corner2) {
    return warnForm(player, t("jm_at.cl.w_no_selection"), () =>
      showClaimsPlayer(player),
    );
  }
  if (pending.dimensionId !== player.dimension.id) {
    return warnForm(player, t("jm_at.cl.w_wrong_dim"), () =>
      showClaimsPlayer(player),
    );
  }

  const { min, max } = normalizeCorners(pending.corner1, pending.corner2);
  const area = calcArea(min, max);
  const cfg = getCfg();
  const dimKey = player.dimension.id.replace("minecraft:", "");
  const hRange = player.dimension.heightRange ?? { min: -64, max: 320 };
  const defaultY = cfg.claimDefaultY?.[dimKey];
  min.y = defaultY?.min ?? hRange.min;
  max.y = defaultY?.max ?? hRange.max;
  const used = getOwnerUsedArea(xuid);
  const p = cfg.claimProtections ?? {};
  const ab = cfg.claimPlayerAbilities ?? {};
  const adminMode = isAdmin(player).ok;
  const ownerMode = isOwner(player);

  const allToggles = PROTECTION_DEFS.map((d) => ({
    key: d.key,
    label: t(d.labelKey),
    def:
      d.key === "allowVehicles" || d.key === "ejectPlayers"
        ? p[d.key] === true
        : p[d.key] !== false,
  }));
  const visible = adminMode
    ? allToggles
    : allToggles.filter((tg) => ab[tg.key] !== false);

  const budget = getPlayerClaimBudget(player);
  const budgetColor = _blocksToChunks(used + area) > budget ? "§c§l" : "§2";
  const details = raw(
    t("jm_at.cl.confirm_details_head", _blocksToChunks(area)),
    "\n",
    budgetColor,
    t("jm_at.cl.budget_used", _blocksToChunks(used + area), budget),
    "\n",
    t(
      "jm_at.cl.coords_xyz",
      Math.floor(min.x),
      Math.floor(min.y),
      Math.floor(min.z),
      Math.floor(max.x),
      Math.floor(max.y),
      Math.floor(max.z),
    ),
  );

  const nameObs = new ObservableString(draft?.name ?? "", {
    clientWritable: true,
  });
  const protObs = visible.map(
    (tg, i) =>
      // draft?.prot guard: the overwrite seed passes a partial draft ({adminClaim,
      // ownerOnly} with no prot) — fall back to each toggle's default for those.
      new ObservableBoolean(draft?.prot ? !!draft.prot[i] : tg.def, {
        clientWritable: true,
      }),
  );
  const adminClaimObs = new ObservableBoolean(
    draft ? !!draft.adminClaim : false,
    { clientWritable: true },
  );
  const ownerOnlyObs = new ObservableBoolean(
    draft ? !!draft.ownerOnly : false,
    { clientWritable: true },
  );
  const status = new ObservableString("");
  const statusShown = new ObservableBoolean(false);

  // True when the staff overwrite was already acknowledged at the menu (decision
  // #2: warn before this form). Carried through reopen so a UserBusy bounce or a
  // warn-cancel doesn't re-prompt; tells doCreate to skip its own overwrite warn.
  const overwriteAck = !!draft?.overwriteAck;
  let pendingNav = null;
  let intent = null;
  const back = () => showClaimsPlayer(player);
  const reopen = () =>
    showConfirmClaim(player, {
      name: nameObs.getData(),
      prot: protObs.map((o) => o.getData()),
      adminClaim: adminClaimObs.getData(),
      ownerOnly: ownerOnlyObs.getData(),
      overwriteAck,
    });
  const snapshot = () =>
    JSON.stringify([
      nameObs.getData(),
      protObs.map((o) => o.getData()),
      adminClaimObs.getData(),
      ownerOnlyObs.getData(),
    ]);
  // Baseline includes the seeded admin/owner-only toggles (an overwrite confirm
  // opens with one pre-enabled) so opening a seeded form and pressing Back does
  // not falsely report "unsaved changes".
  const initial = JSON.stringify([
    "",
    visible.map((tg) => tg.def),
    draft ? !!draft.adminClaim : false,
    draft ? !!draft.ownerOnly : false,
  ]);
  const fail = (m) => {
    status.setData(m);
    statusShown.setData(true);
  };

  // Runs after the form closes: overlap check + create. Reopens the form if the
  // overwrite is cancelled or blocked.
  const doCreate = async (data) => {
    const { name, protections, overwriteAck } = data;
    let { isAdminClaim, ownerOnly } = data;
    let overwriteTargets = [];
    if (isAdminClaim || ownerOnly) {
      const dimId = player.dimension.id;
      // Top-level only — a sub-claim always sits inside an overlapping parent and
      // is cascade-deleted with it, so counting/deleting subs separately would
      // only inflate the number. Matches evaluateSelection's overlap set.
      const overlaps = getAllClaims().filter(
        (c) =>
          !c.parentId && c.dimension === dimId && claimShapeOverlaps(c, min, max),
      );
      if (overlaps.length > 0) {
        const blocked = overlaps.filter((c) => c.ownerOnly && !isOwner(player));
        if (blocked.length > 0) {
          const blockedLines = _joinRaw(
            blocked.map((c) =>
              t("jm_at.cl.ow_line", c.name || c.id, c.ownerName),
            ),
            "\n",
          );
          return warnForm(
            player,
            t("jm_at.cl.w_owner_only_blocked", blockedLines),
            // reopen() (not a bare showConfirmClaim) so the typed name + seeded
            // admin/owner-only toggle survive the bounce instead of resetting.
            () => reopen(),
          );
        }
        // Warn here only if the overwrite wasn't already acknowledged before the
        // form (the menu's showOverwriteWarn path warns first per decision #2).
        // Other paths that reach here with overlaps — e.g. an admin toggling
        // "Admin Claim" on the extend "Create New" form — still get warned.
        if (!overwriteAck) {
          const lines = _joinRaw(
            overlaps.map((c) =>
              t(
                c.isAdminClaim ? "jm_at.cl.ow_line_admin" : "jm_at.cl.ow_line",
                c.name || c.id,
                c.ownerName,
              ),
            ),
            "\n",
          );
          const warn = new MessageFormData()
            .title(t("jm_at.cl.title_overlap_warn"))
            .body(
              t(
                ownerOnly
                  ? "jm_at.cl.ow_body_owner_only"
                  : "jm_at.cl.ow_body_admin",
                overlaps.length,
                lines,
              ),
            )
            .button1(t("jm_at.common.btn_cancel"))
            .button2(t("jm_at.cl.btn_overwrite"));
          const wRes = await warn.show(player);
          if (wRes.canceled || wRes.selection === 0) {
            return reopen(); // preserve name + seeded toggle on cancel
          }
        }
        // Defer deletion until AFTER the new claim is created successfully, so a
        // failed create never destroys the claims it was meant to overwrite.
        overwriteTargets = overlaps;
      }
    }

    const result = createClaim(
      player,
      min,
      max,
      isAdminClaim,
      isAdminClaim || ownerOnly,
      ownerOnly,
    );
    if (!result.ok) {
      // Create failed (e.g. storage full) — the overlapping claims are untouched,
      // so nothing is lost. Keep the selection so the player can adjust and retry
      // (the reopened menu shows the red reason); only clear on success.
      return warnForm(player, raw("§c", result.reason), () =>
        showClaimsPlayer(player),
      );
    }
    // Create succeeded — now it is safe to remove the claims it overwrote.
    for (const c of overwriteTargets) deleteClaim(c.id, player, true);
    clearPendingSelection(xuid);
    renameClaim(result.claim.id, name);
    updateClaimProtections(result.claim.id, protections);
    tell(player, t("jm_at.cl.msg_created", name));
    visualizeClaim(player, min, max, player.location.y);
    return showClaimsPlayer(player);
  };

  const form = new CustomForm(player, t("jm_at.cl.title_confirm"));
  form.label(details);
  form.spacer();
  form.textField(
    t("jm_at.cl.field_claim_name_req", LIMITS.CLAIM_NAME_MAX),
    nameObs,
    {
      description: t("jm_at.cl.field_name_desc"),
    },
  );
  form.spacer();
  form.label(t("jm_at.cl.label_protections"));
  form.spacer();
  visible.forEach((tg, i) => form.toggle(tg.label, protObs[i]));
  if (adminMode) {
    form.spacer();
    form.toggle(t("jm_at.cl.toggle_admin_claim"), adminClaimObs);
  }
  if (ownerMode) form.toggle(t("jm_at.cl.toggle_owner_only"), ownerOnlyObs);
  // Admin Claim and Owner-Only are mutually exclusive. Submit already forces
  // owner-only to win, but DDUI happily showed both toggles ON at once, which
  // reads as a contradiction — so flip the other off live when one is turned on.
  // Guarded with getData() checks so the paired setData() can't ping-pong.
  if (adminMode && ownerMode) {
    adminClaimObs.subscribe(() => {
      if (adminClaimObs.getData() && ownerOnlyObs.getData())
        ownerOnlyObs.setData(false);
    });
    ownerOnlyObs.subscribe(() => {
      if (ownerOnlyObs.getData() && adminClaimObs.getData())
        adminClaimObs.setData(false);
    });
  }
  form.spacer();
  form.label(status, { visible: statusShown });
  form.spacer({ visible: statusShown });

  const commit = () => {
    const name = clampText(nameObs.getData().trim(), LIMITS.CLAIM_NAME_MAX);
    if (!name) return fail("§c请输入领地名称。");
    const protections = { ...p };
    visible.forEach((tg, i) => {
      protections[tg.key] = protObs[i].getData();
    });
    let isAdminClaim = adminMode ? adminClaimObs.getData() : false;
    const ownerOnly = ownerMode ? ownerOnlyObs.getData() : false;
    if (ownerOnly) isAdminClaim = false; // owner-only stays off the admin lists
    pendingNav = () =>
      doCreate({ name, protections, isAdminClaim, ownerOnly, overwriteAck });
    try {
      form.close();
    } catch {}
  };

  form.button(t("jm_at.cl.btn_create_claim"), commit);
  form.button(t("jm_at.cl.btn_cancel"), () => {
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
// Ownership helpers
// =========================================================

function _isClaimOwner(player, claim) {
  return getPlayerXuid(player) === claim.ownerXuid || isAdmin(player).ok;
}

// =========================================================
// Claim detail
// =========================================================

async function showClaimDetail(player, claimId, backFn) {
  const claim = getClaimById(claimId);
  if (!claim) {
    return warnForm(player, t("jm_at.cl.w_gone"), () => showMyClaims(player));
  }
  if (!canManageClaim(player, claim)) {
    tell(player, t("jm_at.cl.msg_no_access"));
    return;
  }

  const goBack = backFn ?? (() => showMyClaims(player));
  const memberCount = claim.members.length;
  const rankCount = claim.trustedRanks.length;
  const isSub = !!claim.parentId;
  const isDeepest = isSub && !!getClaimById(claim.parentId)?.parentId;
  const canHaveSubs = !isDeepest;
  const subCount = canHaveSubs ? getSubClaimsByParent(claimId).length : 0;
  const displayName = claim.name ? raw("§l", claim.name, "§r") : claim.id;
  const isOwner = _isClaimOwner(player, claim);

  // Adjust height only for top-level claims (hidden for players if disabled)
  const _cfg = getCfg();
  const _ab = _cfg.claimPlayerAbilities ?? {};
  const _admin = isAdmin(player).ok;
  // Admin management tooling (transfer / force-delete / dropdown protections /
  // admin height editor) is governed by the Claims Administration privilege — the
  // same gate canManageClaim and the admin browse UI use — so an admin without it
  // acts as a normal owner on their own claims instead of seeing admin controls.
  const _claimsAdmin = _admin && adminCan(player, "claimsAdmin");
  const showHeight = !isSub && (_admin || _ab.adjustHeight !== false);
  // Per-claim entry message — owner/admin only, and only when enabled server-wide.
  const showWelcome =
    (isOwner || _admin) && _cfg.claimWelcomeMsgEnabled !== false;

  // Admin-only controls (Claims Administration privilege)
  const showTransfer = _claimsAdmin && !isSub;
  const showForceDeleteBtn = _claimsAdmin;

  const form = new ActionFormData()
    .title(
      isDeepest
        ? t("jm_at.cl.title_subsub")
        : isSub
          ? t("jm_at.cl.title_sub")
          : t("jm_at.cl.title_claim"),
    )
    .body(
      raw(
        displayName,
        "\n",
        t(
          "jm_at.cl.detail_line1",
          _blocksToChunks(claim.area),
          _fmtDimShort(claim.dimension),
        ),
        claim.extensions?.length
          ? t("jm_at.cl.detail_rects", claim.extensions.length + 1)
          : "",
        "\n",
        t("jm_at.cl.detail_line2", memberCount, rankCount),
        "\n",
        `${Math.floor(claim.min.x)},${Math.floor(claim.min.y)},${Math.floor(claim.min.z)} → ${Math.floor(claim.max.x)},${Math.floor(claim.max.y)},${Math.floor(claim.max.z)}`,
      ),
    )
    .button(t("jm_at.cl.btn_view_boundary"), "textures/ui/jm_at_claim_viewer_icon")
    .button(t("jm_at.cl.btn_members", memberCount), "textures/ui/jm_at_players")
    .button(t("jm_at.cl.btn_trusted_ranks", rankCount), "textures/ui/jm_at_rank");

  // Sub-claims button (top-level and depth-1 sub-claims)
  if (canHaveSubs)
    form.button(
      t("jm_at.cl.btn_subclaims", subCount),
      "textures/ui/jm_at_sub_claim",
    );

  // Claims-admins get the full dropdown protections editor; everyone else
  // (including an admin without claimsAdmin on their own claim) gets the toggles.
  if (_claimsAdmin) {
    form.button(
      t("jm_at.cl.btn_edit_protections"),
      "textures/ui/jm_at_server_controls",
    );
  } else {
    form.button(t("jm_at.cl.btn_settings"), "textures/ui/jm_at_control_panel");
  }
  form.button(t("jm_at.cl.btn_rename"), "textures/ui/jm_at_admin_note");
  if (showWelcome)
    form.button(
      t("jm_at.cl.btn_welcome_msg"),
      "textures/ui/jm_at_claim_notification",
    );

  if (showHeight)
    form.button(
      t("jm_at.cl.btn_adjust_height"),
      "textures/ui/jm_at_claim_height",
    );
  if (showTransfer)
    form.button(t("jm_at.cl.btn_transfer"), "textures/ui/jm_at_transfer");

  // Admins see Force delete; non-admin owners see Abandon
  if (showForceDeleteBtn) {
    form.button(t("jm_at.cl.btn_force_delete"), "textures/ui/jm_at_remove");
  } else if (isOwner) {
    form.button(
      isSub ? t("jm_at.cl.btn_abandon_sub") : t("jm_at.cl.btn_abandon"),
      "textures/ui/jm_at_remove",
    );
  }
  form.button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back");
  form.button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return goBack(); // X = Back

  const adminBack = () => showClaimDetail(player, claimId, backFn);

  let idx = res.selection;
  // View boundary
  if (idx === 0) {
    const pid = isDeepest
      ? "jm_at:sub_sub_claim_particles"
      : isSub
        ? "jm_at:sub_claim_particles"
        : "jm_at:viewer_particles";
    const pStep = isSub ? 3 : 2;
    visualizeClaimMerged(
      player,
      claim,
      player.location.y,
      pid,
      pStep,
      -3,
      false,
    );
    tell(player, t("jm_at.cl.msg_boundary_shown"));
    return;
  }
  if (idx === 1) return showManageMembers(player, claimId, backFn);
  if (idx === 2) return showTrustedRanks(player, claimId, backFn);

  let btnIdx = 3;
  if (canHaveSubs) {
    if (idx === btnIdx) return showSubClaims(player, claimId, backFn);
    btnIdx++;
  }
  // Settings / Edit protections
  if (idx === btnIdx) {
    return _claimsAdmin
      ? showEditProtections(player, claimId, 0, undefined, adminBack)
      : showClaimSettings(player, claimId, backFn);
  }
  btnIdx++;
  if (idx === btnIdx) return showRenameClaim(player, claimId, backFn);
  btnIdx++;
  if (showWelcome) {
    if (idx === btnIdx)
      return showClaimWelcomeMsg(player, claimId, () =>
        showClaimDetail(player, claimId, backFn),
      );
    btnIdx++;
  }
  if (showHeight) {
    if (idx === btnIdx) {
      return _claimsAdmin
        ? showAdminAdjustHeight(player, claimId, 0, undefined, adminBack)
        : showAdjustHeight(player, claimId, backFn);
    }
    btnIdx++;
  }
  if (showTransfer) {
    if (idx === btnIdx)
      return showTransferOwnership(player, claimId, 0, undefined, adminBack);
    btnIdx++;
  }
  if (showForceDeleteBtn) {
    if (idx === btnIdx)
      return showForceDelete(player, claimId, 0, undefined, goBack);
    btnIdx++;
  } else if (isOwner) {
    if (idx === btnIdx) {
      return isSub
        ? showAbandonSubClaim(player, claimId, backFn)
        : showAbandonClaim(player, claimId, backFn);
    }
    btnIdx++;
  }
  // Back
  if (idx === btnIdx) return goBack();
  btnIdx++;
  // Close
  if (idx === btnIdx) return;
}

// =========================================================
// Claim settings (protections)
// =========================================================

async function showClaimSettings(player, claimId, backFn, draft = null) {
  const claim = getClaimById(claimId);
  if (!claim) return showClaimsPlayer(player);
  if (!canManageClaim(player, claim)) {
    tell(player, t("jm_at.cl.msg_no_access"));
    return;
  }

  const cfg = getCfg();
  const ab = cfg.claimPlayerAbilities ?? {};
  const p = claim.protections ?? {};

  const allToggles = PROTECTION_DEFS.map((d) => ({
    key: d.key,
    label: t(d.labelKey),
    def:
      d.key === "allowVehicles" || d.key === "ejectPlayers"
        ? p[d.key] === true
        : p[d.key] !== false,
  }));

  const adminMode = isAdmin(player).ok;
  const visible = adminMode
    ? allToggles
    : allToggles.filter((tg) => ab[tg.key] !== false);

  if (visible.length === 0) {
    return warnForm(player, t("jm_at.cl.w_prot_admin_managed"), () =>
      showClaimDetail(player, claimId, backFn),
    );
  }

  const obs = visible.map(
    (tg, i) =>
      new ObservableBoolean(draft ? !!draft.vals[i] : tg.def, {
        clientWritable: true,
      }),
  );

  let pendingNav = null;
  let intent = null;
  const back = () => showClaimDetail(player, claimId, backFn);
  const reopen = () =>
    showClaimSettings(player, claimId, backFn, {
      vals: obs.map((o) => o.getData()),
    });
  const snapshot = () => JSON.stringify(obs.map((o) => o.getData()));
  const initial = JSON.stringify(visible.map((tg) => tg.def));

  const form = new CustomForm(player, t("jm_at.cl.title_settings"));
  form.spacer();
  form.header(t("jm_at.cl.header_protections"));
  form.spacer();
  visible.forEach((tg, i) => form.toggle(tg.label, obs[i]));

  const save = (close) => {
    if (snapshot() === initial) {
      tell(player, t("jm_at.cl.msg_no_changes"));
    } else {
      const updated = { ...p };
      visible.forEach((tg, i) => {
        updated[tg.key] = obs[i].getData();
      });
      updateClaimProtections(claimId, updated);
      tell(player, t("jm_at.cl.msg_settings_saved"));
    }
    pendingNav = close ? () => {} : back;
    try {
      form.close();
    } catch {}
  };
  form.spacer();
  form.button(t("jm_at.common.btn_save"), () => save(false));
  form.button(t("jm_at.cl.btn_save_close"), () => save(true));
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
// Adjust height bounds
// =========================================================

async function showAdjustHeight(player, claimId, backFn, draft = null) {
  const claim = getClaimById(claimId);
  if (!claim) return showClaimsPlayer(player);

  const hRange = _dimHeightRange(claim.dimension);
  const cfg = getCfg();
  const dimKey = claim.dimension.replace("minecraft:", "");
  const limit = isAdmin(player).ok
    ? hRange
    : (cfg.claimDefaultY?.[dimKey] ?? hRange);

  const savedMinY = Math.max(limit.min, Math.floor(claim.min.y));
  const savedMaxY = Math.min(limit.max, Math.floor(claim.max.y));
  const minObs = new ObservableNumber(draft ? draft.min : savedMinY, {
    clientWritable: true,
  });
  const maxObs = new ObservableNumber(draft ? draft.max : savedMaxY, {
    clientWritable: true,
  });
  const status = new ObservableString("");
  const statusShown = new ObservableBoolean(false);

  const form = new CustomForm(player, t("jm_at.cl.title_adjust_height"));
  form.spacer();
  form.slider(
    t("jm_at.cl.slider_min_y", limit.min),
    minObs,
    limit.min,
    limit.max,
    {
      step: 1,
    },
  );
  form.slider(
    t("jm_at.cl.slider_max_y", limit.max),
    maxObs,
    limit.min,
    limit.max,
    {
      step: 1,
    },
  );
  form.spacer();
  form.label(status, { visible: statusShown });
  form.spacer({ visible: statusShown });

  let pendingNav = null;
  let intent = null;
  const back = () => showClaimDetail(player, claimId, backFn);
  const reopen = () =>
    showAdjustHeight(player, claimId, backFn, {
      min: minObs.getData(),
      max: maxObs.getData(),
    });
  const snapshot = () => JSON.stringify([minObs.getData(), maxObs.getData()]);
  const initial = JSON.stringify([savedMinY, savedMaxY]);

  const save = (close) => {
    const newMinY = Math.round(minObs.getData());
    const newMaxY = Math.round(maxObs.getData());
    if (newMinY >= newMaxY) {
      status.setData(
        "§c最低高度必须小于最高高度。",
      );
      statusShown.setData(true);
      return;
    }
    updateClaimYBounds(claimId, newMinY, newMaxY);
    tell(player, t("jm_at.cl.msg_height_updated", newMinY, newMaxY));
    pendingNav = close ? () => {} : back;
    try {
      form.close();
    } catch {}
  };
  form.button(t("jm_at.common.btn_save"), () => save(false));
  form.button(t("jm_at.cl.btn_save_close"), () => save(true));
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
// Members
// =========================================================

async function showManageMembers(player, claimId, backFn) {
  const claim = getClaimById(claimId);
  if (!claim) return showClaimsPlayer(player);

  const form = new ActionFormData()
    .title(t("jm_at.cl.title_members"))
    .body(
      claim.members.length === 0
        ? t("jm_at.cl.members_none")
        : t("jm_at.cl.members_count", claim.members.length),
    );

  form.button(t("jm_at.cl.btn_add_member"), "textures/ui/jm_at_add");
  for (const m of claim.members) {
    let suffix = "";
    if (m.expiresAt && m.expiresAt > 0) {
      const remaining = m.expiresAt - nowMs();
      suffix =
        remaining > 0
          ? t("jm_at.cl.sub_left", _fmtDurationShort(remaining))
          : t("jm_at.cl.sub_expired");
    }
    form.button(
      raw("§l", m.name, "§r\n", _roleName(m.role), suffix),
      "textures/ui/jm_at_online",
    );
  }
  form.button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back");
  form.button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showClaimDetail(player, claimId, backFn); // X = Back
  if (res.selection === claim.members.length + 1)
    return showClaimDetail(player, claimId, backFn); // Back
  if (res.selection === claim.members.length + 2) return; // Close
  if (res.selection === 0) return showAddMember(player, claimId, backFn);
  const memberIdx = res.selection - 1;
  if (memberIdx >= 0 && memberIdx < claim.members.length) {
    return showMemberDetail(player, claimId, claim.members[memberIdx], backFn);
  }
}

async function showAddMember(player, claimId, backFn) {
  const claim = getClaimById(claimId);
  if (!claim) return showClaimsPlayer(player);
  if (claim.members.length >= LIMITS.MEMBERS_PER_CLAIM) {
    return warnForm(
      player,
      t("jm_at.cl.w_members_full", LIMITS.MEMBERS_PER_CLAIM),
      () => showManageMembers(player, claimId, backFn),
    );
  }

  const xuid = getPlayerXuid(player);
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
        e.xuid !== xuid &&
        e.xuid !== claim.ownerXuid &&
        !claim.members.find((m) => m.xuid === e.xuid),
    )
    .sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1; // online first
      return a.name.localeCompare(b.name);
    });

  // Dropdown items render § literally, so the online/offline lang values are
  // plain text (no color codes).
  // lang-keys: jm_at.cl.opt_online jm_at.cl.opt_offline jm_at.cl.opt_none
  const playerItems =
    candidates.length > 0
      ? candidates.map((e, i) => ({
          label: t(
            e.online ? "jm_at.cl.opt_online" : "jm_at.cl.opt_offline",
            e.name,
          ),
          value: i,
        }))
      : [{ label: t("jm_at.cl.opt_none"), value: 0 }];
  const roleItems = _roleItems();
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

  const form = new CustomForm(player, t("jm_at.cl.title_add_member"));
  form.spacer();
  form.header(t("jm_at.cl.header_choose_player"));
  form.spacer();
  form.label(t("jm_at.cl.label_type_or_pick"));
  form.spacer();
  form.textField(t("jm_at.cl.field_player_name"), nameObs, {
    description: t("jm_at.cl.field_player_name_desc"),
  });
  form.dropdown(t("jm_at.cl.drop_pick_known"), pickObs, playerItems);
  form.spacer();
  form.header(t("jm_at.cl.header_access"));
  form.spacer();
  form.dropdown(t("jm_at.cl.drop_role"), roleObs, roleItems);
  form.dropdown(t("jm_at.cl.drop_duration"), durObs, durItems);
  form.spacer();
  form.label(status, { visible: statusShown });
  form.spacer({ visible: statusShown });

  let pendingNav = null;
  let intent = null;
  const back = () => showManageMembers(player, claimId, backFn);

  const submit = (close) => {
    const typed = clampText((nameObs.getData() ?? "").trim(), 40);
    let targetXuid, targetName;
    if (typed) {
      // Text field takes priority — resolve from registry, then online players.
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
      if (entry.xuid === xuid)
        return fail("§c不能将自己添加为领地成员。");
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
        ? t("jm_at.cl.msg_member_added_timed", targetName, _roleName(role), dur.label)
        : t("jm_at.cl.msg_member_added_perm", targetName, _roleName(role)),
    );
    pendingNav = close ? () => {} : back;
    try {
      form.close();
    } catch {}
  };
  form.button(t("jm_at.cl.btn_do_add_member"), () => submit(false));
  form.button(t("jm_at.cl.btn_do_add_member_close"), () => submit(true));
  form.button(t("jm_at.common.btn_back"), () => {
    intent = "back";
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(() => showAddMember(player, claimId, backFn));
  }
  if (pendingNav) return system.run(pendingNav);
  if (intent === "back") return system.run(back); // Back -> up one level; X / escape -> exit
}

async function showMemberDetail(player, claimId, member, backFn) {
  let tail;
  if (member.expiresAt && member.expiresAt > 0) {
    const remaining = member.expiresAt - nowMs();
    tail =
      remaining > 0
        ? raw("\n", t("jm_at.cl.detail_expires", _fmtDurationShort(remaining)))
        : raw("\n", t("jm_at.cl.detail_expired"));
  } else {
    tail = raw("\n", t("jm_at.cl.detail_permanent"));
  }
  const bodyText = raw(
    "§9",
    member.name,
    "§r\n",
    t("jm_at.cl.detail_role", _roleName(member.role)),
    tail,
  );

  const form = new ActionFormData()
    .title(t("jm_at.cl.title_member"))
    .body(bodyText)
    .button(t("jm_at.cl.btn_edit_role"), "textures/ui/jm_at_server_controls")
    .button(t("jm_at.cl.btn_remove_member"), "textures/ui/jm_at_remove")
    .button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back")
    .button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showManageMembers(player, claimId, backFn); // X = Back
  if (res.selection === 0)
    return showEditMember(player, claimId, member, () =>
      showManageMembers(player, claimId, backFn),
    );
  if (res.selection === 1)
    return showRemoveMember(player, claimId, member, backFn);
  if (res.selection === 2) return showManageMembers(player, claimId, backFn); // Back
  if (res.selection === 3) return; // Close
}

// Shared by the owner member detail and the admin member detail (imported there).
// `back` returns to the members list (re-reads, so the updated row shows fresh).
export async function showEditMember(player, claimId, member, back) {
  const roleIdx = ROLE_IDS.indexOf(member.role);
  const roleItems = _roleItems();
  // "Keep current" first so editing the role doesn't silently reset a temp
  // member's expiry; the other options reset the timer from now.
  const curExpiry =
    member.expiresAt && member.expiresAt > 0
      ? t(
          "jm_at.cl.expires_in_short",
          _fmtDurationShort(member.expiresAt - nowMs()),
        )
      : t("jm_at.time.permanent");
  const durItems = [
    { label: t("jm_at.cl.keep_current", curExpiry), value: 0 },
    ...DURATIONS.map((d, i) => ({ label: d.label, value: i + 1 })),
  ];

  const roleObs = new ObservableNumber(roleIdx >= 0 ? roleIdx : 0, {
    clientWritable: true,
  });
  const durObs = new ObservableNumber(0, { clientWritable: true });

  let pendingNav = null;
  let intent = null;

  const form = new CustomForm(player, t("jm_at.cl.title_edit_member"));
  form.spacer();
  form.label(t("jm_at.cl.label_access_for", member.name));
  form.dropdown(t("jm_at.cl.drop_role"), roleObs, roleItems);
  form.dropdown(t("jm_at.cl.drop_duration"), durObs, durItems);

  const save = (close) => {
    const newRole = ROLE_IDS[roleObs.getData()] ?? "visitor";
    const di = durObs.getData();
    let expiresAt;
    if (di === 0) {
      expiresAt =
        member.expiresAt && member.expiresAt > 0 ? member.expiresAt : 0;
    } else {
      const dur = DURATIONS[di - 1] ?? DURATIONS[0];
      expiresAt = dur.ms > 0 ? nowMs() + dur.ms : 0;
    }
    updateMember(claimId, member.xuid, newRole, expiresAt);
    tell(
      player,
      t("jm_at.cl.msg_member_updated", member.name, _roleName(newRole)),
    );
    pendingNav = close ? () => {} : back;
    try {
      form.close();
    } catch {}
  };
  form.spacer();
  form.button(t("jm_at.common.btn_save"), () => save(false));
  form.button(t("jm_at.cl.btn_save_close"), () => save(true));
  form.button(t("jm_at.common.btn_back"), () => {
    intent = "back";
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(() => showEditMember(player, claimId, member, back));
  }
  if (pendingNav) return system.run(pendingNav);
  if (intent === "back") return system.run(back); // Back -> up one level; X / escape -> exit
}

async function showRemoveMember(player, claimId, member, backFn) {
  let tail = "";
  if (member.expiresAt && member.expiresAt > 0) {
    const remaining = member.expiresAt - nowMs();
    tail =
      remaining > 0
        ? raw(
            "\n",
            t("jm_at.cl.remove_member_temp", _fmtDurationShort(remaining)),
          )
        : raw("\n", t("jm_at.cl.detail_expired"));
  }
  const bodyText = raw(
    t("jm_at.cl.remove_member_body", member.name, _roleName(member.role)),
    tail,
  );
  const form = new MessageFormData()
    .title(t("jm_at.cl.title_remove_member"))
    .body(bodyText)
    .button1(t("jm_at.common.btn_cancel"))
    .button2(t("jm_at.cl.btn_remove"));

  const res = await form.show(player);
  if (res.canceled || res.selection === 0)
    return showManageMembers(player, claimId, backFn);
  removeMember(claimId, member.xuid);
  tell(player, t("jm_at.cl.msg_member_removed", member.name));
  return showManageMembers(player, claimId, backFn);
}

// =========================================================
// Trusted ranks
// =========================================================

async function showTrustedRanks(player, claimId, backFn) {
  const claim = getClaimById(claimId);
  if (!claim) return showClaimsPlayer(player);

  const form = new ActionFormData()
    .title(t("jm_at.cl.title_trusted_ranks"))
    .body(
      raw(
        t("jm_at.cl.ranks_body"),
        "\n",
        claim.trustedRanks.length === 0 ? t("jm_at.cl.ranks_none") : "",
      ),
    );

  form.button(t("jm_at.cl.btn_add_rank"), "textures/ui/jm_at_add");
  for (const r of claim.trustedRanks) {
    const displayTag =
      r.tag === MOD_TRUST_TAG
        ? t("jm_at.cl.mod_rank_tag")
        : raw("§l", r.tag);
    let suffix = "";
    if (r.expiresAt && r.expiresAt > 0) {
      const remaining = r.expiresAt - nowMs();
      suffix =
        remaining > 0
          ? t("jm_at.cl.sub_left", _fmtDurationShort(remaining))
          : t("jm_at.cl.sub_expired");
    }
    form.button(
      raw(displayTag, "§r\n", _roleName(r.role), suffix),
      "textures/ui/jm_at_rank",
    );
  }
  form.button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back");
  form.button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showClaimDetail(player, claimId, backFn); // X = Back
  if (res.selection === claim.trustedRanks.length + 1)
    return showClaimDetail(player, claimId, backFn); // Back
  if (res.selection === claim.trustedRanks.length + 2) return; // Close
  if (res.selection === 0) return showAddTrustedRank(player, claimId, backFn);
  const rankIdx = res.selection - 1;
  if (rankIdx >= 0 && rankIdx < claim.trustedRanks.length) {
    return showTrustedRankDetail(
      player,
      claimId,
      claim.trustedRanks[rankIdx],
      backFn,
    );
  }
}

async function showAddTrustedRank(player, claimId, backFn) {
  const claim = getClaimById(claimId);
  if (!claim) return showClaimsPlayer(player);
  if (claim.trustedRanks.length >= LIMITS.TRUSTED_RANKS_PER_CLAIM) {
    return warnForm(
      player,
      t("jm_at.cl.w_ranks_full", LIMITS.TRUSTED_RANKS_PER_CLAIM),
      () => showTrustedRanks(player, claimId, backFn),
    );
  }

  // Collect unique rank tags from the player registry and rank database
  const reg = getPlayerRegistry();
  const dbRanks = Object.values(getRankDb()).map((r) => r.tag);
  const regRanks = Object.values(reg).map((e) => (e.rankTag ?? "").trim());
  const existingTags = new Set(claim.trustedRanks.map((r) => r.tag));
  const ranks = [...new Set([...regRanks, ...dbRanks])].filter(
    (r) => r.length > 0 && !existingTags.has(r),
  );
  // Add the special "@Moderator" option so owners can trust all moderators
  if (!existingTags.has(MOD_TRUST_TAG)) {
    ranks.unshift(MOD_TRUST_TAG);
  }

  if (ranks.length === 0) {
    tell(player, t("jm_at.cl.msg_no_ranks"));
    return showTrustedRanks(player, claimId, backFn);
  }

  const rankItems = ranks.map((r, i) => ({
    label:
      r === MOD_TRUST_TAG
        ? t("jm_at.cl.mod_rank_plain")
        : r.replace(/§./g, ""), // dropdown items render § literally — strip it
    value: i,
  }));
  const roleItems = _roleItems();
  const durItems = DURATIONS.map((d, i) => ({ label: d.label, value: i }));

  const rankObs = new ObservableNumber(0, { clientWritable: true });
  const roleObs = new ObservableNumber(2, { clientWritable: true });
  const durObs = new ObservableNumber(0, { clientWritable: true });

  const form = new CustomForm(player, t("jm_at.cl.title_add_rank"));
  form.spacer();
  form.dropdown(t("jm_at.cl.drop_rank"), rankObs, rankItems);
  form.dropdown(t("jm_at.cl.drop_role"), roleObs, roleItems);
  form.dropdown(t("jm_at.cl.drop_duration"), durObs, durItems);

  let pendingNav = null;
  let intent = null;
  const back = () => showTrustedRanks(player, claimId, backFn);

  const submit = (close) => {
    const idx = rankObs.getData();
    if (idx < 0 || idx >= ranks.length) return;
    const chosen = ranks[idx];
    const role = ROLE_IDS[roleObs.getData()] ?? "visitor";
    const dur = DURATIONS[durObs.getData()] ?? DURATIONS[0];
    const expiresAt = dur.ms > 0 ? nowMs() + dur.ms : 0;
    if (!addTrustedRank(claimId, chosen, role, expiresAt)) {
      pendingNav = () =>
        warnForm(player, t("jm_at.cl.w_add_rank_failed"), () =>
          showAddTrustedRank(player, claimId, backFn),
        );
      try {
        form.close();
      } catch {}
      return;
    }
    const shown = chosen === MOD_TRUST_TAG ? t("jm_at.cl.moderator") : chosen;
    tell(
      player,
      dur.ms > 0
        ? t("jm_at.cl.msg_rank_added_timed", shown, _roleName(role), dur.label)
        : t("jm_at.cl.msg_rank_added_perm", shown, _roleName(role)),
    );
    pendingNav = close ? () => {} : back;
    try {
      form.close();
    } catch {}
  };
  form.spacer();
  form.button(t("jm_at.cl.btn_do_add_rank"), () => submit(false));
  form.button(t("jm_at.cl.btn_do_add_rank_close"), () => submit(true));
  form.button(t("jm_at.common.btn_back"), () => {
    intent = "back";
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(() => showAddTrustedRank(player, claimId, backFn));
  }
  if (pendingNav) return system.run(pendingNav);
  if (intent === "back") return system.run(back); // Back -> up one level; X / escape -> exit
}

async function showTrustedRankDetail(player, claimId, rankEntry, backFn) {
  const displayTag =
    rankEntry.tag === MOD_TRUST_TAG
      ? t("jm_at.cl.mod_rank_plain")
      : rankEntry.tag;
  let tail;
  if (rankEntry.expiresAt && rankEntry.expiresAt > 0) {
    const remaining = rankEntry.expiresAt - nowMs();
    tail =
      remaining > 0
        ? raw("\n", t("jm_at.cl.detail_expires", _fmtDurationShort(remaining)))
        : raw("\n", t("jm_at.cl.detail_expired"));
  } else {
    tail = raw("\n", t("jm_at.cl.detail_permanent"));
  }
  const bodyText = raw(
    "§9",
    displayTag,
    "§r\n",
    t("jm_at.cl.detail_role", _roleName(rankEntry.role)),
    tail,
  );

  const form = new ActionFormData()
    .title(t("jm_at.cl.title_trusted_rank"))
    .body(bodyText)
    .button(t("jm_at.cl.btn_edit_role"), "textures/ui/jm_at_server_controls")
    .button(t("jm_at.cl.btn_remove_rank"), "textures/ui/jm_at_remove")
    .button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back")
    .button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showTrustedRanks(player, claimId, backFn); // X = Back
  if (res.selection === 2) return showTrustedRanks(player, claimId, backFn); // Back
  if (res.selection === 3) return; // Close
  if (res.selection === 0)
    return showEditTrustedRank(player, claimId, rankEntry, backFn);
  if (res.selection === 1)
    return showRemoveTrustedRank(player, claimId, rankEntry.tag, backFn);
}

async function showEditTrustedRank(player, claimId, rankEntry, backFn) {
  const roleIdx = ROLE_IDS.indexOf(rankEntry.role);
  const roleItems = _roleItems();
  const durItems = DURATIONS.map((d, i) => ({ label: d.label, value: i }));

  const roleObs = new ObservableNumber(roleIdx >= 0 ? roleIdx : 2, {
    clientWritable: true,
  });
  const durObs = new ObservableNumber(0, { clientWritable: true });

  const form = new CustomForm(player, t("jm_at.cl.title_edit_rank"));
  form.spacer();
  form.dropdown(t("jm_at.cl.drop_role"), roleObs, roleItems);
  form.dropdown(t("jm_at.cl.drop_duration"), durObs, durItems);

  let pendingNav = null;
  let intent = null;
  const back = () => showTrustedRankDetail(player, claimId, rankEntry, backFn);

  const save = (close) => {
    const newRole = ROLE_IDS[roleObs.getData()] ?? "visitor";
    const dur = DURATIONS[durObs.getData()] ?? DURATIONS[0];
    const expiresAt = dur.ms > 0 ? nowMs() + dur.ms : 0;
    updateTrustedRank(claimId, rankEntry.tag, newRole, expiresAt);
    const displayTag =
      rankEntry.tag === MOD_TRUST_TAG ? t("jm_at.cl.moderator") : rankEntry.tag;
    tell(
      player,
      t("jm_at.cl.msg_rank_updated", displayTag, _roleName(newRole)),
    );
    // Reload the entry for the detail screen.
    const claim = getClaimById(claimId);
    const updated = claim?.trustedRanks.find((r) => r.tag === rankEntry.tag);
    pendingNav = close
      ? () => {}
      : updated
        ? () => showTrustedRankDetail(player, claimId, updated, backFn)
        : () => showTrustedRanks(player, claimId, backFn);
    try {
      form.close();
    } catch {}
  };
  form.spacer();
  form.button(t("jm_at.common.btn_save"), () => save(false));
  form.button(t("jm_at.cl.btn_save_close"), () => save(true));
  form.button(t("jm_at.common.btn_back"), () => {
    intent = "back";
    try {
      form.close();
    } catch {}
  });

  const reason = await form.show();
  if (reason === DataDrivenScreenClosedReason.UserBusy) {
    return system.run(() =>
      showEditTrustedRank(player, claimId, rankEntry, backFn),
    );
  }
  if (pendingNav) return system.run(pendingNav);
  if (intent === "back") return system.run(back); // Back -> up one level; X / escape -> exit
}

async function showRemoveTrustedRank(player, claimId, rankTag, backFn) {
  const claim = getClaimById(claimId);
  const entry = claim?.trustedRanks.find((r) => r.tag === rankTag);
  const displayName =
    rankTag === MOD_TRUST_TAG ? t("jm_at.cl.mod_rank_plain") : rankTag;
  const parts = [t("jm_at.cl.remove_rank_body", displayName)];
  if (entry) {
    parts.push("\n", t("jm_at.cl.detail_role", _roleName(entry.role)));
    if (entry.expiresAt && entry.expiresAt > 0) {
      const remaining = entry.expiresAt - nowMs();
      parts.push(
        "\n",
        remaining > 0
          ? t("jm_at.cl.detail_expires", _fmtDurationShort(remaining))
          : t("jm_at.cl.detail_expired"),
      );
    }
  }
  parts.push("\n\n", t("jm_at.cl.remove_rank_note"));
  const form = new MessageFormData()
    .title(t("jm_at.cl.title_remove_rank"))
    .body(raw(...parts))
    .button1(t("jm_at.common.btn_cancel"))
    .button2(t("jm_at.cl.btn_remove"));

  const res = await form.show(player);
  if (res.canceled || res.selection === 0)
    return showTrustedRanks(player, claimId, backFn);
  removeTrustedRank(claimId, rankTag);
  tell(player, t("jm_at.cl.msg_rank_removed", displayName));
  return showTrustedRanks(player, claimId, backFn);
}

// =========================================================
// Rename
// =========================================================

async function showRenameClaim(player, claimId, backFn, draft = null) {
  const claim = getClaimById(claimId);
  if (!claim) return showClaimsPlayer(player);

  const savedName = claim.name ?? "";
  const nameObs = new ObservableString(draft?.name ?? savedName, {
    clientWritable: true,
  });
  const status = new ObservableString("");
  const statusShown = new ObservableBoolean(false);
  let pendingNav = null;
  let intent = null;
  const back = () => showClaimDetail(player, claimId, backFn);
  // reopen rebuilds the draft from the live field so Keep editing / a UserBusy
  // bounce keep the typed name; baseline stays the saved name so it re-warns.
  const reopen = () =>
    showRenameClaim(player, claimId, backFn, { name: nameObs.getData() });
  const snapshot = () => nameObs.getData();
  const initial = savedName;
  const fail = (m) => {
    status.setData(m);
    statusShown.setData(true);
  };

  const form = new CustomForm(player, t("jm_at.cl.title_rename"));
  form.textField(t("jm_at.cl.field_name", LIMITS.CLAIM_NAME_MAX), nameObs, {
    description: t("jm_at.cl.field_name_desc"),
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
      tell(player, t("jm_at.cl.msg_renamed", newName));
      return close ? undefined : showClaimDetail(player, claimId, backFn);
    };
    try {
      form.close();
    } catch {}
  };
  form.button(t("jm_at.common.btn_save"), () => save(false));
  form.button(t("jm_at.cl.btn_save_close"), () => save(true));
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
  // Back -> claim detail; X / engine close / escape -> exit to game; Keep editing
  // preserves the typed name via reopen().
  if (snapshot() !== initial) {
    return system.run(async () => {
      if (await confirmDiscardChanges(player)) return reopen();
      if (intent === "back") return back();
    });
  }
  if (intent === "back") return system.run(back);
}

// =========================================================
// Welcome message (per-claim entry notification)
// =========================================================

export async function showClaimWelcomeMsg(player, claimId, back, draft = null) {
  const claim = getClaimById(claimId);
  if (!claim) return showClaimsPlayer(player);

  const notifChannel = getCfg().claimNotifDisplay ?? "actionbar";

  const msgObs = new ObservableString(draft?.msg ?? claim.welcomeMsg ?? "", {
    clientWritable: true,
  });

  // Live preview, rendered with this claim's own data so the owner sees exactly
  // how it resolves, plus a warning for any unrecognized {tags}.
  const sample = {
    owner: claim.isAdminClaim ? "管理员领地" : `${claim.ownerName}的领地`,
    ownerName: claim.isAdminClaim ? "管理员" : claim.ownerName,
    name: claim.name ? ` §7(§f${claim.name}§7)` : "",
    claimName: claim.name || "",
    restricted: claim.protections?.blocks
      ? " §c| 禁止建造：放置的潜影盒会被破坏"
      : "",
  };
  const preview = new ObservableString("");
  const warnText = new ObservableString("");
  const warnShown = new ObservableBoolean(false);
  const refreshPreview = () => {
    const msg = msgObs.getData() ?? "";
    const rendered = renderClaimTemplate(applyColorCodes(msg), sample);
    preview.setData(
      msg.trim()
        ? notifChannel === "actionbar"
          ? rendered.replace(/\\n/g, " ").trim()
          : applyNewlines(rendered)
        : "§8（留空时使用服务器默认消息）",
    );
    const unknown = findUnknownClaimPlaceholders(msg);
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
  msgObs.subscribe(refreshPreview);

  let pendingNav = null;
  let intent = null;
  const reopen = () =>
    showClaimWelcomeMsg(player, claimId, back, { msg: msgObs.getData() });
  const snapshot = () => msgObs.getData();
  const initial = claim.welcomeMsg ?? "";

  const form = new CustomForm(player, t("jm_at.cl.title_welcome"));
  form.spacer();
  form.label(t("jm_at.cl.welcome_intro"));
  form.spacer();
  // The literal "\n" the player types is passed as a param so the lang value
  // never needs an escaped backslash (lang \n always renders as a newline).
  form.label(
    raw(
      t("jm_at.cl.welcome_tags"),
      notifChannel === "actionbar"
        ? ""
        : raw("\n", t("jm_at.cl.welcome_newline_tip", "\\n")),
    ),
  );
  form.spacer();
  form.textField(
    t("jm_at.cl.field_message", LIMITS.CLAIM_WELCOME_MAX),
    msgObs,
    {
      // Sample template text — {placeholder} previews stay raw by design.
      description: "欢迎来到{claimName}！",
    },
  );
  form.spacer();
  form.header(t("jm_at.cl.header_preview"));
  form.spacer();
  form.label(preview);
  form.spacer();
  form.label(warnText, { visible: warnShown });
  form.spacer({ visible: warnShown });

  const save = (close) => {
    const msg = clampText(
      String(msgObs.getData() ?? "").trim(),
      LIMITS.CLAIM_WELCOME_MAX,
    );
    setClaimWelcomeMessage(claimId, msg);
    tell(
      player,
      msg
        ? t("jm_at.cl.msg_welcome_saved")
        : t("jm_at.cl.msg_welcome_cleared"),
    );
    pendingNav = close ? () => {} : back;
    try {
      form.close();
    } catch {}
  };
  form.button(t("jm_at.common.btn_save"), () => save(false));
  form.button(t("jm_at.cl.btn_save_close"), () => save(true));
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
// Sub-claims
// =========================================================

async function showSubClaims(player, parentClaimId, backFn) {
  const parent = getClaimById(parentClaimId);
  if (!parent) return showClaimsPlayer(player);

  const subs = getSubClaimsByParent(parentClaimId);
  subs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const xuid = getPlayerXuid(player);
  const pending = getPendingSelection(xuid);
  const hasBothCorners = pending?.corner1 && pending?.corner2;

  // Check if pending selection is inside this parent claim
  let canCreate = false;
  if (hasBothCorners) {
    const { min, max } = normalizeCorners(pending.corner1, pending.corner2);
    // Match createSubClaim: inherit parent Y bounds
    min.y = parent.min.y;
    max.y = parent.max.y;
    canCreate =
      pending.dimensionId === parent.dimension &&
      isInsideClaimShape(min, max, parent);
  }

  const form = new ActionFormData()
    .title(t("jm_at.cl.title_subclaims"))
    .body(
      raw(
        parent.name || parent.id,
        "\n",
        t("jm_at.cl.sub_body", subs.length, LIMITS.SUBCLAIMS_PER_CLAIM),
        "\n",
        canCreate
          ? t("jm_at.cl.sub_sel_inside")
          : hasBothCorners
            ? t("jm_at.cl.sub_sel_outside")
            : t("jm_at.cl.sub_sel_none"),
      ),
    );

  if (canCreate)
    form.button(t("jm_at.cl.btn_create_sub"), "textures/ui/jm_at_add");

  const mostSpecific = getClaimAt(player.dimension.id, player.location);
  const currentSub =
    mostSpecific && mostSpecific.parentId === parentClaimId
      ? mostSpecific
      : null;
  const hasCurrentBtn = !!currentSub;
  if (hasCurrentBtn) {
    form.button(
      t(
        "jm_at.cl.btn_current_sub",
        _trimName(currentSub.name || currentSub.id),
      ),
      "textures/ui/jm_at_position",
    );
  }

  for (const s of subs) {
    form.button(
      t(
        "jm_at.cl.btn_sub_row",
        _trimName(s.name ? s.name : s.id),
        _blocksToChunks(s.area),
      ),
      "textures/ui/jm_at_sub_claim",
    );
  }
  form.button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back");
  form.button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showClaimDetail(player, parentClaimId, backFn); // X = Back

  let idx = res.selection;
  if (canCreate) {
    if (idx === 0)
      return showConfirmSubClaim(player, parentClaimId, () =>
        showSubClaims(player, parentClaimId, backFn),
      );
    idx--;
  }
  if (hasCurrentBtn) {
    if (idx === 0)
      return showClaimDetail(player, currentSub.id, () =>
        showSubClaims(player, parentClaimId, backFn),
      );
    idx--;
  }
  if (idx >= 0 && idx < subs.length) {
    return showClaimDetail(player, subs[idx].id, () =>
      showSubClaims(player, parentClaimId, backFn),
    );
  }
  // Back
  if (idx === subs.length)
    return showClaimDetail(player, parentClaimId, backFn);
  // Close
  if (idx === subs.length + 1) return;
}

/**
 * DDUI (CustomForm) confirm for creating a sub-claim (and sub-sub-claim — same
 * function, depth-aware via parent.parentId). Name + visible protection toggles
 * read off Observables; createSubClaim stays the authority, run after close.
 */
async function showConfirmSubClaim(
  player,
  parentClaimId,
  backFn,
  draft = null,
) {
  const parent = getClaimById(parentClaimId);
  if (!parent) return showClaimsPlayer(player);

  const xuid = getPlayerXuid(player);
  const pending = getPendingSelection(xuid);
  const back = () => (backFn ? backFn() : showSubClaims(player, parentClaimId));
  if (!pending?.corner1 || !pending?.corner2) {
    return warnForm(player, t("jm_at.cl.w_no_selection"), () => back());
  }

  const { min, max } = normalizeCorners(pending.corner1, pending.corner2);
  const area = calcArea(min, max);
  const p = parent.protections ?? {};
  const cfg = getCfg();
  const ab = cfg.claimPlayerAbilities ?? {};
  const adminMode = isAdmin(player).ok;

  const allToggles = PROTECTION_DEFS.map((d) => ({
    key: d.key,
    label: t(d.labelKey),
    def:
      d.key === "allowVehicles" || d.key === "ejectPlayers"
        ? p[d.key] === true
        : p[d.key] !== false,
  }));
  const visible = adminMode
    ? allToggles
    : allToggles.filter((tg) => ab[tg.key] !== false);

  const details = t(
    "jm_at.cl.sub_details",
    _blocksToChunks(area),
    parent.name || parent.id,
    Math.floor(min.x),
    Math.floor(min.y),
    Math.floor(min.z),
    Math.floor(max.x),
    Math.floor(max.y),
    Math.floor(max.z),
  );

  const nameObs = new ObservableString(draft?.name ?? "", {
    clientWritable: true,
  });
  const protObs = visible.map(
    (tg, i) =>
      // draft?.prot guard: the overwrite seed passes a partial draft ({adminClaim,
      // ownerOnly} with no prot) — fall back to each toggle's default for those.
      new ObservableBoolean(draft?.prot ? !!draft.prot[i] : tg.def, {
        clientWritable: true,
      }),
  );
  const status = new ObservableString("");
  const statusShown = new ObservableBoolean(false);

  let pendingNav = null;
  let intent = null;
  const reopen = () =>
    showConfirmSubClaim(player, parentClaimId, backFn, {
      name: nameObs.getData(),
      prot: protObs.map((o) => o.getData()),
    });
  const snapshot = () =>
    JSON.stringify([nameObs.getData(), protObs.map((o) => o.getData())]);
  const initial = JSON.stringify(["", visible.map((tg) => tg.def)]);
  const fail = (m) => {
    status.setData(m);
    statusShown.setData(true);
  };

  const doCreate = (name, protections) => {
    const result = createSubClaim(player, min, max, parentClaimId);
    clearPendingSelection(xuid);
    if (!result.ok) {
      return warnForm(player, raw("§c", result.reason), () => back());
    }
    renameClaim(result.claim.id, name);
    updateClaimProtections(result.claim.id, protections);
    tell(player, t("jm_at.cl.msg_sub_created", name));
    const pid = parent.parentId
      ? "jm_at:sub_sub_claim_particles"
      : "jm_at:sub_claim_particles";
    visualizeClaim(player, min, max, player.location.y, pid, 3);
    return back();
  };

  const form = new CustomForm(player, t("jm_at.cl.title_create_sub"));
  form.spacer();
  form.label(details);
  form.spacer();
  form.textField(
    t("jm_at.cl.field_sub_name", LIMITS.CLAIM_NAME_MAX),
    nameObs,
    {
      description: t("jm_at.cl.field_sub_name_desc"),
    },
  );
  form.spacer();
  form.label(t("jm_at.cl.label_protections"));
  form.spacer();
  visible.forEach((tg, i) => form.toggle(tg.label, protObs[i]));
  form.spacer();
  form.label(status, { visible: statusShown });
  form.spacer({ visible: statusShown });

  const commit = () => {
    const name = clampText(nameObs.getData().trim(), LIMITS.CLAIM_NAME_MAX);
    if (!name) return fail("§c请输入子领地名称。");
    const protections = { ...p };
    visible.forEach((tg, i) => {
      protections[tg.key] = protObs[i].getData();
    });
    pendingNav = () => doCreate(name, protections);
    try {
      form.close();
    } catch {}
  };

  form.button(t("jm_at.cl.btn_do_create_sub"), commit);
  form.button(t("jm_at.cl.btn_cancel"), () => {
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

async function showAbandonSubClaim(player, subClaimId, backFn) {
  const sub = getClaimById(subClaimId);
  if (!sub) return showClaimsPlayer(player);
  const parent = sub.parentId ? getClaimById(sub.parentId) : sub;
  if (!parent || !canManageClaim(player, parent)) {
    tell(player, t("jm_at.cl.msg_no_access"));
    return;
  }

  const parentId = sub.parentId;
  const childCount = getSubClaimsByParent(subClaimId).length;
  const form = new MessageFormData()
    .title(t("jm_at.cl.title_abandon_sub"))
    .body(
      raw(
        t("jm_at.cl.abandon_sub_q", sub.name || sub.id),
        "\n\n",
        childCount > 0
          ? raw(t("jm_at.cl.abandon_nested", childCount), "\n\n")
          : "",
        t("jm_at.cl.abandon_no_undo"),
      ),
    )
    .button1(t("jm_at.common.btn_cancel"))
    .button2(t("jm_at.cl.btn_abandon_confirm"));

  const res = await form.show(player);
  if (res.canceled || res.selection === 0) {
    return showClaimDetail(player, subClaimId, () =>
      showSubClaims(player, parentId, backFn),
    );
  }

  deleteSubClaim(subClaimId, player);
  tell(player, t("jm_at.cl.msg_sub_removed"));
  return showSubClaims(player, parentId, backFn);
}

// =========================================================
// Abandon
// =========================================================

async function showAbandonClaim(player, claimId, backFn) {
  const claim = getClaimById(claimId);
  if (!claim) return showClaimsPlayer(player);
  if (!_isClaimOwner(player, claim)) {
    tell(player, t("jm_at.cl.msg_not_owner"));
    return;
  }

  const directSubs = getSubClaimsByParent(claimId);
  let descendantCount = directSubs.length;
  for (const s of directSubs)
    descendantCount += getSubClaimsByParent(s.id).length;
  const form = new MessageFormData()
    .title(t("jm_at.cl.title_abandon"))
    .body(
      raw(
        t("jm_at.cl.abandon_q", claim.name || claim.id),
        "\n\n",
        descendantCount > 0
          ? raw(t("jm_at.cl.abandon_nested", descendantCount), "\n\n")
          : "",
        t("jm_at.cl.abandon_no_undo_unprotected"),
      ),
    )
    .button1(t("jm_at.common.btn_cancel"))
    .button2(t("jm_at.cl.btn_abandon_confirm"));

  const res = await form.show(player);
  if (res.canceled || res.selection === 0)
    return showClaimDetail(player, claimId, backFn);

  deleteClaim(claimId, player, false);
  tell(player, t("jm_at.cl.msg_abandoned"));
  return showClaimsPlayer(player);
}

// =========================================================
// Help screen
// =========================================================

async function showClaimHelp(player) {
  const cfg = getCfg();
  const xuid = getPlayerXuid(player);
  const usedArea = _blocksToChunks(getOwnerUsedArea(xuid));
  const budget = getPlayerClaimBudget(player);
  const ownedCount = getClaimsByOwner(xuid).filter(
    (c) => !c.isAdminClaim,
  ).length;
  const ab = cfg.claimPlayerAbilities ?? {};
  const adminMode = isAdmin(player).ok;
  const ownerMode = isOwner(player);

  // Build dynamic protections list
  const protDefs = PROTECTION_DEFS.map((d) => ({
    key: d.key,
    label: t(d.shortLabelKey),
  }));
  const playerProts = protDefs
    .filter((p) => ab[p.key] !== false)
    .map((p) => p.label);
  const adminOnlyProts = protDefs
    .filter((p) => ab[p.key] === false)
    .map((p) => p.label);

  // Per-line protection entries; mirrors the old string concat exactly (the
  // admin-only block joins onto the player list with a single "\n").
  const playerProtLines = _joinRaw(
    playerProts.map((p) => t("jm_at.cl.help_prot_line", p)),
    "\n",
  );
  const adminProtLines =
    adminOnlyProts.length > 0
      ? raw(
          "\n",
          _joinRaw(
            adminOnlyProts.map((p) =>
              adminMode
                ? t("jm_at.cl.help_prot_line_admin", p)
                : t("jm_at.cl.help_prot_line_admin_only", p),
            ),
            "\n",
          ),
        )
      : "";

  const form = new ActionFormData()
    .title(t("jm_at.cl.title_help"))
    .body(
      raw(
        t("jm_at.cl.help_tool"),
        "\n\n",
        t("jm_at.cl.help_viewer"),
        "\n\n",
        cfg.maxClaimsPerPlayer > 0
          ? t(
              "jm_at.cl.help_budget",
              ownedCount,
              cfg.maxClaimsPerPlayer,
              usedArea,
              budget,
              cfg.claimAreaPerTime ?? 1,
              cfg.claimAreaTimeInterval ?? 60,
              cfg.claimStartArea ?? 5,
              cfg.claimMaxArea ?? 15,
            )
          : t("jm_at.cl.help_admin_managed"),
        "\n\n",
        t(
          "jm_at.cl.help_dims",
          cfg.claimAllowNether !== false
            ? t("jm_at.cl.allowed")
            : t("jm_at.cl.disabled"),
          cfg.claimAllowEnd !== false
            ? t("jm_at.cl.allowed")
            : t("jm_at.cl.disabled"),
        ),
        "\n\n",
        t("jm_at.cl.help_prot_head"),
        "\n",
        playerProtLines,
        adminProtLines,
        "\n\n",
        t("jm_at.cl.help_members"),
        "\n\n",
        t("jm_at.cl.help_ranks"),
        "\n\n",
        t("jm_at.cl.help_overlap"),
        adminMode
          ? t(
              ownerMode
                ? "jm_at.cl.help_overlap_staff_owner"
                : "jm_at.cl.help_overlap_staff",
            )
          : "",
        "\n\n",
        t("jm_at.cl.help_expand"),
        "\n\n",
        t("jm_at.cl.help_subclaims", LIMITS.SUBCLAIMS_PER_CLAIM),
        ownerMode ? raw("\n\n", t("jm_at.cl.help_owner_only")) : "",
      ),
    )
    .button(t("jm_at.common.btn_back_bold"), "textures/ui/jm_at_back")
    .button(CLOSE_BTN_LABEL, CLOSE_BTN_ICON);

  const res = await form.show(player);
  if (res.canceled) return showClaimsPlayer(player); // X = Back
  if (res.selection === 1) return; // Close
  return showClaimsPlayer(player); // Back
}

// =========================================================
// Helpers
// =========================================================

// lang-keys: jm_at.cl.dim_ow jm_at.cl.dim_nether_short jm_at.cl.dim_end_short
function _fmtDimShort(dimId) {
  if (dimId === "minecraft:overworld") return t("jm_at.cl.dim_ow");
  if (dimId === "minecraft:nether") return t("jm_at.cl.dim_nether_short");
  if (dimId === "minecraft:the_end") return t("jm_at.cl.dim_end_short");
  return dimId;
}

function _dimHeightRange(dimId) {
  if (dimId === "minecraft:nether") return { min: 0, max: 128 };
  if (dimId === "minecraft:the_end") return { min: 0, max: 256 };
  return { min: -64, max: 320 }; // overworld
}

function _resolvePlayerByName(name, reg) {
  const lower = name.toLowerCase();
  for (const [, e] of Object.entries(reg)) {
    if ((e.name ?? "").toLowerCase() === lower) return e;
  }
  return null;
}

function _blocksToChunks(blocks) {
  return Math.round((blocks / 256) * 100) / 100;
}

function _trimName(s, max = 20) {
  return s.length > max ? s.slice(0, max) + ".." : s;
}

// Returns compact "5m" / "2h 30m" strings (locale-neutral); only the expired
// case is a word, so that one comes from the lang file.
function _fmtDurationShort(ms) {
  if (ms <= 0) return t("jm_at.cl.expired_word");
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}秒`;
  if (s < 3600) return `${Math.floor(s / 60)}分钟`;
  if (s < 86400)
    return `${Math.floor(s / 3600)}小时 ${Math.floor((s % 3600) / 60)}分钟`;
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  return h > 0 ? `${d}天 ${h}小时` : `${d}天`;
}
