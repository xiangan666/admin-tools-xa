/** Pure server policy. Server and home-owner rules are both mandatory. */
import { integerInRange, normalizeRules } from "./travel-rules.js";

function flag(value, fallback, label) {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new Error(`${label}必须为开关值。`);
  return value;
}

export function normalizeHomePolicy(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("服务器家园规则格式无效。");
  const features = value.features ?? {};
  if (!features || typeof features !== "object" || Array.isArray(features)) throw new Error("家园规则功能开关格式无效。");
  return {
    version: 1,
    enabled: flag(value.enabled, true, "家园规则总开关"),
    bedTeleportEnabled: flag(value.bedTeleportEnabled, true, "传送到床开关"),
    taxPercent: integerInRange(value.taxPercent ?? 30, 0, 100, "家园税率"),
    features: {
      cooldown: flag(features.cooldown, true, "冷却功能"),
      cost: flag(features.cost, true, "收费功能"),
      timeWindow: flag(features.timeWindow, true, "开放时段功能"),
    },
    serverRules: normalizeRules(value.serverRules),
  };
}

function enabledLayer(value, features) {
  const source = value ?? {};
  return normalizeRules({
    cooldownSeconds: features.cooldown ? source.cooldownSeconds : 0,
    cost: features.cost ? source.cost : { typeId: "", amount: 0 },
    timeWindow: features.timeWindow ? source.timeWindow : { enabled: false, start: "00:00", end: "00:00" },
  });
}

/** Never combines/replaces either layer: callers must check server, then owner. */
export function resolveHomeRulesPure(ownerRules, value = {}) {
  const policy = normalizeHomePolicy(value);
  if (!policy.enabled) return { server: normalizeRules(), owner: normalizeRules() };
  return {
    server: enabledLayer(policy.serverRules, policy.features),
    owner: enabledLayer(ownerRules, policy.features),
  };
}
