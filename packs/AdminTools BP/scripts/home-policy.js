/** Durable home policy managed by administrators, including the server owner. */
import { NS } from "./constants.js";
import { getWorldStr, setWorldStr } from "./storage.js";
import { isAdmin } from "./permissions.js";
import { normalizeHomePolicy, resolveHomeRulesPure } from "./home-policy-core.js";

const POLICY_KEY = `${NS}:xa_home_policy`;

export { normalizeHomePolicy, resolveHomeRulesPure } from "./home-policy-core.js";

export function getHomePolicy() {
  try {
    const raw = getWorldStr(POLICY_KEY);
    return normalizeHomePolicy(raw ? JSON.parse(raw) : {});
  } catch {
    throw new Error("服务器家园规则无法读取，请联系管理员修复存档；不会自动重置已有配置。");
  }
}

export function setHomePolicy(actor, value) {
  if (!isAdmin(actor).ok) throw new Error("只有管理员可以修改家园全局规则、床传送开关和税率。");
  const policy = normalizeHomePolicy(value);
  if (!setWorldStr(POLICY_KEY, JSON.stringify(policy))) throw new Error("服务器家园规则保存失败，原配置继续生效。");
  return true;
}

export function resolveHomeRules(ownerRules, policy = getHomePolicy()) {
  return resolveHomeRulesPure(ownerRules, policy);
}
