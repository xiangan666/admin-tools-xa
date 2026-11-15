/** Home directory and owner/admin-managed grants. Staff have no automatic visit bypass. */
import { world } from "@minecraft/server";
import { NS } from "./constants.js";
import { getCfg, getPlayerRegistry, getWorldStr, setWorldStr } from "./storage.js";
import { getHomes, getOfflineHomes } from "./homes.js";
import { getPlayerXuid, tell, silentCatch } from "./utils.js";
import { isOwner, isAdmin, isModerator } from "./permissions.js";
import {
  homeGeneration, normalizeAccessOptions, grantIsActive, visitAllowed, useGrant, requestIsCurrent,
} from "./home-access-core.js";

const MAX_GRANTS = 160;
const MAX_REQUESTS = 80;
const MAX_REQUESTS_PER_VISITOR = 10;
const keyFor = (ownerId) => `${NS}:xa_home_access_${ownerId}`;
// A successful teleport must not regain a use merely because persistence failed.
// Pending consumption blocks new visitors until it has been durably written.
const pendingConsumption = new Map();
const cloneAccess = (data) => JSON.parse(JSON.stringify(data));

function readAccess(ownerId, allowPendingConsumption = false) {
  const pending = pendingConsumption.get(ownerId);
  if (pending) {
    if (setWorldStr(keyFor(ownerId), JSON.stringify(pending))) {
      pendingConsumption.delete(ownerId);
      return cloneAccess(pending);
    }
    // A second already-in-flight successful visitor still has to consume their
    // use from the latest shadow, rather than overwrite the first visitor's use.
    if (allowPendingConsumption) return cloneAccess(pending);
    throw new Error("家园授权存档故障，已暂时阻止新的访客传送。待保存恢复后自动解除，请联系管理员。");
  }
  try {
    const raw = getWorldStr(keyFor(ownerId));
    if (!raw) return { version: 1, grants: [], requests: [] };
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.grants) || !Array.isArray(data.requests)) throw new Error("家园访问授权存档格式无效");
    return data;
  } catch (error) {
    silentCatch("xa_home_access_read", error);
    // Do not silently overwrite corrupted data and accidentally revive requests.
    throw new Error("家园访问数据暂时无法读取，请联系管理员。");
  }
}

function saveAccess(ownerId, data, preserveConsumption = false) {
  if (!setWorldStr(keyFor(ownerId), JSON.stringify(data))) {
    if (preserveConsumption) {
      pendingConsumption.set(ownerId, cloneAccess(data));
      throw new Error("传送已完成，但授权次数存档故障；已记住扣减并暂时阻止新的访客传送，保存恢复后自动解除。请联系管理员。");
    }
    throw new Error("授权保存失败，请稍后重试。");
  }
  pendingConsumption.delete(ownerId);
  return true;
}

function livePlayer(id) {
  return world.getPlayers().find((p) => getPlayerXuid(p) === id);
}

export function getHomeDestination(ownerId, homeName) {
  const online = livePlayer(ownerId);
  const homes = online ? getHomes(online) : getOfflineHomes(ownerId);
  return Object.prototype.hasOwnProperty.call(homes, homeName) ? homes[homeName] : null;
}

function sameGrant(g, visitorId, homeName, generation) {
  return g.visitorId === visitorId && g.homeName === homeName && g.generation === generation;
}

export function getHomeGrant(visitor, ownerId, homeName) {
  const visitorId = typeof visitor === "string" ? visitor : getPlayerXuid(visitor);
  const home = getHomeDestination(ownerId, homeName);
  if (!home) return null;
  return readAccess(ownerId).grants.find((g) => sameGrant(g, visitorId, homeName, homeGeneration(home))) || null;
}

export function canVisitHome(visitor, ownerId, homeName) {
  try {
    const visitorId = getPlayerXuid(visitor);
    const home = getHomeDestination(ownerId, homeName);
    if (!home || home.teleportEnabled === false) return false;
    const generation = homeGeneration(home);
    if (visitorId === ownerId) return true;
    const grant = readAccess(ownerId).grants.find((g) => sameGrant(g, visitorId, homeName, generation));
    return visitAllowed(visitorId, ownerId, grant, generation);
  } catch (error) {
    silentCatch("xa_home_access_check", error);
    if (pendingConsumption.has(ownerId)) tell(visitor, `§c${error.message}`);
    return false;
  }
}

/** Called only after the teleport actually succeeded; failed attempts use no visit. */
export function consumeHomeVisit(visitor, ownerId, homeName) {
  const visitorId = getPlayerXuid(visitor);
  if (visitorId === ownerId) return true;
  const home = getHomeDestination(ownerId, homeName);
  if (!home) return false;
  const generation = homeGeneration(home);
  const data = readAccess(ownerId, true);
  const index = data.grants.findIndex((g) => sameGrant(g, visitorId, homeName, generation));
  if (index < 0) return false;
  const grant = useGrant(data.grants[index], generation);
  if (!grant) return false;
  data.grants[index] = grant;
  return saveAccess(ownerId, data, true);
}

function pruneAccess(ownerId, data) {
  const now = Date.now();
  data.grants = data.grants.filter((g) => {
    const home = getHomeDestination(ownerId, g.homeName);
    return home && grantIsActive(g, homeGeneration(home), now);
  });
  data.requests = data.requests.filter((r) => requestIsCurrent(r, getHomeDestination(ownerId, r.homeName), now));
  return data;
}

export function requestHomeAccess(visitor, ownerId, homeName, options = {}) {
  const visitorId = getPlayerXuid(visitor);
  if (!visitorId || visitorId === ownerId) throw new Error("不能向自己申请访问权限。");
  const home = getHomeDestination(ownerId, homeName);
  if (!home) throw new Error("该家园已经不存在。");
  normalizeAccessOptions(options); // Validation only: expiry starts at owner approval.
  const generation = homeGeneration(home);
  const data = pruneAccess(ownerId, readAccess(ownerId));
  const existing = data.requests.findIndex((r) => r.visitorId === visitorId && r.homeName === homeName && r.generation === generation);
  if (existing < 0 && (data.requests.length >= MAX_REQUESTS
      || data.requests.filter((r) => r.visitorId === visitorId).length >= MAX_REQUESTS_PER_VISITOR)) {
    throw new Error("申请已达上限，请等待家园主人处理。");
  }
  const request = {
    id: `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
    visitorId, visitorName: String(visitor.name), homeName, generation,
    options: { mode: options.mode, minutes: Number(options.minutes || 0), uses: Number(options.uses || 0) },
    createdAt: Date.now(),
  };
  if (existing < 0) data.requests.push(request); else data.requests[existing] = request;
  saveAccess(ownerId, data);
  const owner = livePlayer(ownerId);
  if (owner) tell(owner, `§e${visitor.name} 申请访问你的家园“${homeName}”。请在“家园 → 访问申请与授权”中处理。`);
  return request;
}

function accessOwnerId(actor, ownerId = getPlayerXuid(actor)) {
  if (!ownerId || (String(getPlayerXuid(actor)) !== String(ownerId) && !isAdmin(actor).ok)) throw new Error("只有房主或管理员可以管理此玩家的家园授权。");
  return String(ownerId);
}

export function getOwnerAccess(owner, targetOwnerId) {
  const ownerId = accessOwnerId(owner, targetOwnerId);
  const data = pruneAccess(ownerId, readAccess(ownerId));
  return { grants: data.grants, requests: data.requests };
}

/** Actor identity is always derived from the authenticated server Player object. */
export function grantHomeAccess(owner, homeName, visitorId, options, targetOwnerId, expectedGeneration) {
  const ownerId = accessOwnerId(owner, targetOwnerId);
  const home = getHomeDestination(ownerId, homeName);
  if (!home) throw new Error("该家园已经不存在。");
  if (!visitorId || visitorId === ownerId) throw new Error("请选择其他玩家。");
  const player = getDirectoryPlayers().find((p) => p.xuid === visitorId);
  if (!player) throw new Error("找不到该玩家，请刷新列表。");
  const generation = homeGeneration(home);
  if (expectedGeneration !== undefined && generation !== expectedGeneration) throw new Error("家园已重新创建，请刷新后重新授权。");
  const data = pruneAccess(ownerId, readAccess(ownerId));
  const existing = data.grants.findIndex((g) => sameGrant(g, visitorId, homeName, generation));
  if (existing < 0 && data.grants.length >= MAX_GRANTS) throw new Error("授权数量已达上限，请先撤销不再需要的授权。");
  const grant = {
    visitorId, visitorName: player.name, homeName, generation,
    ...normalizeAccessOptions(options), createdAt: Date.now(),
    grantedById: String(getPlayerXuid(owner)), grantedByName: String(owner.name),
  };
  if (existing < 0) data.grants.push(grant); else data.grants[existing] = grant;
  data.requests = data.requests.filter((r) => !(r.visitorId === visitorId && r.homeName === homeName && r.generation === generation));
  saveAccess(ownerId, data);
  const online = livePlayer(visitorId);
  if (online) tell(online, `§a${owner.name} 已同意你访问家园“${homeName}”。请从家园目录发起传送。`);
  return grant;
}

export function respondHomeRequest(owner, requestId, approve, targetOwnerId) {
  const ownerId = accessOwnerId(owner, targetOwnerId);
  const data = pruneAccess(ownerId, readAccess(ownerId));
  const request = data.requests.find((r) => r.id === requestId);
  if (!request) throw new Error("申请已失效或已经被处理。");
  if (approve) return grantHomeAccess(owner, request.homeName, request.visitorId, request.options, ownerId, request.generation);
  data.requests = data.requests.filter((r) => r.id !== requestId);
  saveAccess(ownerId, data);
  const online = livePlayer(request.visitorId);
  if (online) tell(online, `§c${owner.name} 拒绝了你对家园“${request.homeName}”的访问申请。`);
  return true;
}

export function revokeHomeAccess(owner, homeName, visitorId, targetOwnerId, expectedGeneration) {
  const ownerId = accessOwnerId(owner, targetOwnerId);
  if (expectedGeneration !== undefined && homeGeneration(getHomeDestination(ownerId, homeName)) !== expectedGeneration) throw new Error("家园已删除或重新创建，请刷新授权列表。");
  const data = readAccess(ownerId);
  data.grants = data.grants.filter((g) => !(g.visitorId === visitorId && g.homeName === homeName && (expectedGeneration === undefined || g.generation === expectedGeneration)));
  return saveAccess(ownerId, data);
}

export function getDirectoryPlayers() {
  const registry = getPlayerRegistry();
  const entries = new Map(Object.entries(registry).map(([id, entry]) => [id, { ...entry, xuid: id, online: false }]));
  for (const player of world.getPlayers()) {
    const xuid = getPlayerXuid(player);
    const role = isOwner(player) ? "owner" : isAdmin(player).ok ? "admin" : isModerator(player) ? "moderator" : "player";
    entries.set(xuid, { ...entries.get(xuid), xuid, name: player.name, role, online: true });
  }
  const ownerId = getCfg().ownerXuid;
  return [...entries.values()].map((entry) => ({
    ...entry,
    role: entry.xuid === ownerId ? "owner" : ["admin", "moderator"].includes(entry.role) ? entry.role : "player",
  })).sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

export function getDirectoryHomes(ownerId) {
  const online = livePlayer(ownerId);
  return online ? getHomes(online) : getOfflineHomes(ownerId);
}

export function notifyPendingHomeRequests(player) {
  try {
    const count = getOwnerAccess(player).requests.length;
    if (count) tell(player, `§e你有 ${count} 条待处理家园访问申请。请打开“家园 → 访问申请与授权”。`);
  } catch (error) { silentCatch("xa_home_request_notify", error); }
}
