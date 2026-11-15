/** Chinese home directory, consent inbox, and scoped visit grants. */
import { ActionFormData, MessageFormData, ModalFormData } from "@minecraft/server-ui";
import { getPlayerXuid, tell, fmtDimRaw } from "./utils.js";
import { raw } from "./i18n.js";
import { getHomeIconPath } from "./homes.js";
import { startRuleTeleport } from "./travel-service.js";
import { accessSummary, homeGeneration } from "./home-access-core.js";
import {
  getDirectoryPlayers, getDirectoryHomes, getHomeDestination, canVisitHome, consumeHomeVisit,
  getHomeGrant, requestHomeAccess, getOwnerAccess, grantHomeAccess,
  respondHomeRequest, revokeHomeAccess,
} from "./home-access.js";

const PAGE_SIZE = 20;
const ROLES = [["owner", "服主"], ["admin", "管理员"], ["moderator", "协管员"], ["player", "普通玩家"]];
const MODE_LABELS = ["仅同意一次", "临时权限", "永久权限"];
const MODE_IDS = ["once", "temporary", "permanent"];

function coords(home) {
  return raw(fmtDimRaw(home.dimension), ` (${Math.floor(home.x)}, ${Math.floor(home.y)}, ${Math.floor(home.z)})`);
}

async function showError(player, error, back) {
  const result = await new MessageFormData().title("操作未完成")
    .body(String(error?.message || error)).button1("返回").button2("关闭").show(player);
  if (!result.canceled && result.selection === 0) return back?.();
}

async function pagedChoice(player, title, body, items, back, page = 0) {
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  page = Math.max(0, Math.min(page, pages - 1));
  const slice = items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const form = new ActionFormData().title(`${title} (${page + 1}/${pages})`).body(body);
  for (const item of slice) form.button(item.label, item.icon);
  const prev = page > 0 ? slice.length : -1;
  if (prev >= 0) form.button("上一页", "textures/ui/jm_at_back");
  const next = page + 1 < pages ? slice.length + (prev >= 0 ? 1 : 0) : -1;
  if (next >= 0) form.button("下一页", "textures/ui/jm_at_next");
  form.button("返回", "textures/ui/jm_at_back");
  const result = await form.show(player);
  if (result.canceled) return back?.();
  if (result.selection === prev) return pagedChoice(player, title, body, items, back, page - 1);
  if (result.selection === next) return pagedChoice(player, title, body, items, back, page + 1);
  const choice = slice[result.selection];
  return choice ? choice.run() : back?.();
}

/** Lists positions for online and mirrored offline homes, grouped by addon role. */
export async function showHomeDirectory(player, back) {
  try {
    const players = getDirectoryPlayers();
    const form = new ActionFormData().title("所有玩家的家园")
      .body("按角色查看家园位置。访问他人家园需要有效授权；房主或管理员可以审批和管理，管理员不会自动绕过访问授权。");
    for (const [id, label] of ROLES) form.button(`${label}（${players.filter((p) => p.role === id).length} 人）`);
    form.button("返回", "textures/ui/jm_at_back");
    const result = await form.show(player);
    if (result.canceled || result.selection >= ROLES.length) return back?.();
    const [role, label] = ROLES[result.selection];
    const again = () => showHomeDirectory(player, back);
    return pagedChoice(player, label, "离线玩家显示的是其最近一次保存的家园。", players.filter((p) => p.role === role).map((p) => ({
      label: `${p.name}\n${p.online ? "§2在线" : "§8离线"}`,
      run: () => showOwnerHomes(player, p, again),
    })), again);
  } catch (error) { return showError(player, error, back); }
}

async function showOwnerHomes(player, owner, back) {
  try {
    const homes = getDirectoryHomes(owner.xuid);
    return pagedChoice(player, `${owner.name} 的家园`, Object.keys(homes).length
      ? "选择家园以查看授权并申请传送。" : "该玩家还没有保存家园。", Object.entries(homes).map(([name, home]) => ({
      label: raw(`§l${name}§r\n`, coords(home)), icon: getHomeIconPath(home),
      run: () => showVisitDetail(player, owner.xuid, name, () => showOwnerHomes(player, owner, back)),
    })), back);
  } catch (error) { return showError(player, error, back); }
}

async function showVisitDetail(player, ownerId, name, back) {
  try {
    const home = getHomeDestination(ownerId, name);
    if (!home) throw new Error("该家园已经不存在，请刷新列表。");
    if (home.teleportEnabled === false) throw new Error("管理员已关闭此家园传送；位置可在目录查看，已有授权保留。");
    const own = getPlayerXuid(player) === ownerId;
    const granted = canVisitHome(player, ownerId, name);
    const grant = own ? null : getHomeGrant(player, ownerId, name);
    const body = raw(`${name}\n`, coords(home), `\n\n${own ? "这是你自己的家园。" : accessSummary(grant)}\n传送仍需遵守家园的冷却、消耗物品和开放时段规则。`);
    const form = new ActionFormData().title("家园位置与访问").body(body);
    form.button(granted ? "传送到此家园" : "申请访问权限", "textures/ui/jm_at_tp_to_home");
    if (granted && !own) form.button("申请更新权限");
    form.button("返回", "textures/ui/jm_at_back");
    const result = await form.show(player);
    if (result.canceled) return back?.();
    if (result.selection === 0) return granted ? visitHome(player, ownerId, name, back)
      : showRequestOptions(player, ownerId, name, back);
    if (result.selection === 1 && granted && !own) return showRequestOptions(player, ownerId, name, back);
    return back?.();
  } catch (error) { return showError(player, error, back); }
}

/** Shared entry point used by both player directory and staff profile UIs. */
export async function visitHome(player, ownerId, name, back) {
  try {
    const home = getHomeDestination(ownerId, name);
    if (!home) throw new Error("该家园已经不存在。");
    if (home.teleportEnabled === false) throw new Error("管理员已关闭此家园的传送权限。");
    // Surface a pending storage fault as such instead of offering a new request.
    if (getPlayerXuid(player) !== ownerId) getHomeGrant(player, ownerId, name);
    if (!canVisitHome(player, ownerId, name)) return showRequestOptions(player, ownerId, name, back);
    return startRuleTeleport(player, {
      kind: "home", ownerId, name,
      getDestination: () => getHomeDestination(ownerId, name),
      authorize: () => canVisitHome(player, ownerId, name),
      onSuccess: () => {
        if (!consumeHomeVisit(player, ownerId, name)) throw new Error("传送已完成，但访问次数保存失败，请联系管理员。");
      },
    }, back);
  } catch (error) { return showError(player, error, back); }
}

async function selectAccessOptions(player, title, back, apply, seed = {}) {
  const selected = Math.max(0, MODE_IDS.indexOf(seed.mode || "once"));
  const form = new ModalFormData().title(title)
    .dropdown("权限类型", MODE_LABELS, { defaultValueIndex: selected })
    .textField("临时权限有效分钟数（仅临时权限生效）", "1–5256000", { defaultValue: String(seed.minutes || 60) })
    .textField("最多成功访问次数（0 表示不限；仅同意一次固定为 1）", "0–1000000", { defaultValue: String(seed.uses ?? 0) })
    .submitButton("提交");
  const result = await form.show(player);
  if (result.canceled) return back?.();
  const [modeIndex, minutes, uses] = result.formValues || [];
  const options = { mode: MODE_IDS[Number(modeIndex)], minutes: Number(minutes), uses: Number(uses) };
  if (!options.mode || String(uses).trim() === "" || (options.mode === "temporary" && String(minutes).trim() === "")) {
    return showError(player, new Error("请填写完整的有效数字。"), () => selectAccessOptions(player, title, back, apply, seed));
  }
  try { return await apply(options); }
  catch (error) { return showError(player, error, () => selectAccessOptions(player, title, back, apply, options)); }
}

async function showRequestOptions(player, ownerId, name, back) {
  const result = await new MessageFormData().title("需要家园主人同意")
    .body(`申请访问“${name}”。主人可以同意、拒绝或指定授权条件；申请 7 天后自动失效。临时权限从主人批准时开始计时，次数只在传送成功后扣除。`)
    .button1("返回").button2("填写申请").show(player);
  if (result.canceled || result.selection === 0) return back?.();
  return selectAccessOptions(player, `申请访问：${name}`, back, (options) => {
    requestHomeAccess(player, ownerId, name, options);
    tell(player, "§a申请已保存。主人离线时也可以稍后处理；同意后请再次从家园目录发起传送。");
    return back?.();
  });
}

function scopedAccess(player, scope) {
  const ownerId = scope.ownerId ?? getPlayerXuid(player);
  const data = getOwnerAccess(player, ownerId); // Recheck actor authority for every form transition.
  if (scope.homeName !== undefined) {
    const home = getHomeDestination(ownerId, scope.homeName);
    if (!home || (scope.generation !== undefined && homeGeneration(home) !== scope.generation)) throw new Error("家园已删除或重新创建，请刷新管理页面。");
    data.requests = data.requests.filter(row => row.homeName === scope.homeName);
    data.grants = data.grants.filter(row => row.homeName === scope.homeName);
  }
  return data;
}

export async function showHomeAccessMenu(player, back, scope = {}) {
  try {
    const data = scopedAccess(player, scope);
    const form = new ActionFormData().title(scope.homeName ? `家园授权：${scope.homeName}` : "访问申请与授权")
      .body("房主或管理员可审批、授予、修改和撤销访问权限。支持一次、临时或永久权限及成功访问次数限制。")
      .button(`待处理申请（${data.requests.length}）`)
      .button(`查看或撤销授权（${data.grants.length}）`)
      .button("主动授权玩家").button("返回", "textures/ui/jm_at_back");
    const result = await form.show(player);
    const again = () => showHomeAccessMenu(player, back, scope);
    if (result.canceled || result.selection === 3) return back?.();
    if (result.selection === 0) return await showRequests(player, again, scope);
    if (result.selection === 1) return await showGrants(player, again, scope);
    if (result.selection === 2) return await showGrantHomes(player, again, scope);
  } catch (error) { return showError(player, error, back); }
}

async function showRequests(player, back, scope) {
  const requests = scopedAccess(player, scope).requests;
  return pagedChoice(player, "待处理访问申请", requests.length ? "申请人提出的条件不会自动生效，由你确认。" : "暂无待处理申请。", requests.map((request) => ({
    label: `${request.visitorName} → ${request.homeName}\n${MODE_LABELS[MODE_IDS.indexOf(request.options.mode)] || "仅同意一次"}`,
    run: () => showRequestDetail(player, request, () => showRequests(player, back, scope), scope),
  })), back);
}

async function showRequestDetail(player, request, back, scope) {
  const requested = request.options;
  const mode = MODE_LABELS[MODE_IDS.indexOf(requested.mode)] || "仅同意一次";
  const detail = `${request.visitorName} 申请访问“${request.homeName}”\n类型：${mode}\n${requested.mode === "temporary" ? `有效期：${requested.minutes} 分钟\n` : ""}次数：${requested.mode === "once" ? "1" : requested.uses === 0 ? "不限" : requested.uses}`;
  const result = await new ActionFormData().title("处理访问申请").body(detail)
    .button("同意申请条件").button("更改条件后授权").button("拒绝申请").button("返回").show(player);
  if (result.canceled || result.selection === 3) return back?.();
  try {
    scopedAccess(player, scope);
    if (result.selection === 0) { respondHomeRequest(player, request.id, true, scope.ownerId); tell(player, "§a已批准访问申请。"); }
    if (result.selection === 1) return selectAccessOptions(player, "设置授权条件", back, (options) => {
      // Re-read the pending request so a replaced/expired request cannot be approved.
      if (!scopedAccess(player, scope).requests.some((r) => r.id === request.id)) throw new Error("申请已失效或已被处理。");
      grantHomeAccess(player, request.homeName, request.visitorId, options, scope.ownerId, request.generation);
      tell(player, "§a授权已保存。"); return back?.();
    }, requested);
    if (result.selection === 2) { respondHomeRequest(player, request.id, false, scope.ownerId); tell(player, "§e已拒绝访问申请。"); }
    return back?.();
  } catch (error) { return showError(player, error, back); }
}

async function showGrants(player, back, scope) {
  const grants = scopedAccess(player, scope).grants;
  return pagedChoice(player, "已有家园授权", grants.length ? "选择授权以修改条件或立即撤销。" : "暂无有效授权。", grants.map((grant) => ({
    label: `${grant.visitorName} → ${grant.homeName}\n${accessSummary(grant)}`,
    run: async () => {
      const again = () => showGrants(player, back, scope);
      const result = await new ActionFormData().title("管理家园授权")
        .body(`${grant.visitorName} → ${grant.homeName}\n${accessSummary(grant)}`)
        .button("修改授权条件").button("撤销授权").button("返回").show(player);
      if (result.canceled || result.selection === 2) return again();
      if (result.selection === 0) return selectAccessOptions(player, "修改授权条件", again, (options) => {
        scopedAccess(player, scope);
        grantHomeAccess(player, grant.homeName, grant.visitorId, options, scope.ownerId, grant.generation); tell(player, "§a授权已更新。"); return again();
      }, { mode: grant.mode, minutes: grant.expiresAt ? Math.max(1, Math.ceil((grant.expiresAt - Date.now()) / 60000)) : 60, uses: grant.remainingUses ?? 0 });
      try { scopedAccess(player, scope); revokeHomeAccess(player, grant.homeName, grant.visitorId, scope.ownerId, grant.generation); tell(player, "§a已撤销授权。"); return again(); }
      catch (error) { return showError(player, error, again); }
    },
  })), back);
}

async function showGrantHomes(player, back, scope) {
  scopedAccess(player, scope);
  const homes = getDirectoryHomes(scope.ownerId ?? getPlayerXuid(player));
  return pagedChoice(player, "选择要授权的家园", Object.keys(homes).length ? "授权只对所选家园有效。" : "请先保存一个家园。", Object.entries(homes).filter(([name]) => scope.homeName === undefined || name === scope.homeName).map(([name, home]) => ({
    label: raw(`${name}\n`, coords(home)), icon: getHomeIconPath(home),
    run: () => showGrantPlayers(player, name, homeGeneration(home), () => showGrantHomes(player, back, scope), scope),
  })), back);
}

async function showGrantPlayers(player, name, generation, back, scope) {
  scopedAccess(player, scope);
  const ownerId = scope.ownerId ?? getPlayerXuid(player);
  const players = getDirectoryPlayers().filter((p) => p.xuid !== ownerId);
  return pagedChoice(player, "选择获授权玩家", "可授权在线或曾加入世界的离线玩家。", players.map((p) => ({
    label: `${p.name}\n${p.online ? "在线" : "离线"}`,
    run: () => selectAccessOptions(player, `授权 ${p.name}：${name}`, back, (options) => {
      scopedAccess(player, scope);
      grantHomeAccess(player, name, p.xuid, options, ownerId, generation); tell(player, "§a授权已保存。"); return back?.();
    }),
  })), back);
}
