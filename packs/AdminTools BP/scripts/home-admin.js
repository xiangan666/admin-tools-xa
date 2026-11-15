/** Administrator edits for any player's online or offline home. */
import { isAdmin } from "./permissions.js";
import { patchHomeSettings } from "./homes.js";
import { normalizeRules } from "./travel-rules.js";
import { validDestinationName } from "./home-record.js";

export function requireHomeAdmin(actor) {
  if (!isAdmin(actor).ok) throw new Error("只有管理员可以统一管理玩家家园。");
}

export function setManagedHomeSettings(actor, ownerId, homeName, generation, value) {
  requireHomeAdmin(actor);
  if (!ownerId || !validDestinationName(homeName) || typeof generation !== "string" || !value || typeof value !== "object") throw new Error("家园管理参数无效。");
  const patch = {};
  if (value.rules !== undefined) patch.rules = normalizeRules(value.rules);
  if (value.teleportEnabled !== undefined) {
    if (typeof value.teleportEnabled !== "boolean") throw new Error("家园传送权限必须为开关值。");
    patch.teleportEnabled = value.teleportEnabled;
  }
  if (!Object.keys(patch).length) throw new Error("没有可保存的家园设置。");
  if (!patchHomeSettings(String(ownerId), homeName, generation, patch)) throw new Error("家园设置未保存：存储失败，或家园已删除/重新创建，请刷新后重试。");
  return true;
}
