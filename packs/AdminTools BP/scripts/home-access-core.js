/** Pure home-visit policy; no Minecraft dependency, covered by node:test. */
export const ACCESS_LIMITS = Object.freeze({ maxMinutes: 5256000, maxUses: 1000000 });

export function homeGeneration(home) {
  return String(home?.destinationId || "legacy");
}

export function normalizeAccessOptions(options = {}, now = Date.now()) {
  const mode = options.mode || "once";
  if (!["once", "temporary", "permanent"].includes(mode)) throw new Error("无效的授权类型。");
  const uses = mode === "once" ? 1 : Number(options.uses ?? 0);
  if (!Number.isInteger(uses) || uses < 0 || uses > ACCESS_LIMITS.maxUses) {
    throw new Error(`次数必须是 0–${ACCESS_LIMITS.maxUses} 的整数，0 表示不限次数。`);
  }
  let expiresAt = 0;
  if (mode === "temporary") {
    const minutes = Number(options.minutes);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > ACCESS_LIMITS.maxMinutes) {
      throw new Error(`临时授权时长必须是 1–${ACCESS_LIMITS.maxMinutes} 分钟的整数。`);
    }
    expiresAt = now + minutes * 60000;
  }
  return { mode, expiresAt, remainingUses: uses === 0 ? null : uses };
}

export function grantIsActive(grant, generation, now = Date.now()) {
  return !!grant && grant.generation === generation
    && (grant.expiresAt === 0 || (Number.isFinite(grant.expiresAt) && grant.expiresAt > now))
    && (grant.remainingUses === null || (Number.isInteger(grant.remainingUses) && grant.remainingUses > 0));
}

export function visitAllowed(visitorId, ownerId, grant, generation, now = Date.now()) {
  if (!visitorId || !ownerId) return false;
  return visitorId === ownerId || grantIsActive(grant, generation, now);
}

export function useGrant(grant, generation, now = Date.now()) {
  if (!grantIsActive(grant, generation, now)) return null;
  return { ...grant, remainingUses: grant.remainingUses === null ? null : grant.remainingUses - 1 };
}

export function requestIsCurrent(request, home, now = Date.now()) {
  return !!home && request.generation === homeGeneration(home)
    && Number.isFinite(request.createdAt) && now - request.createdAt < 7 * 86400000;
}

export function accessSummary(grant, now = Date.now()) {
  if (!grant) return "尚未授权";
  const validity = grant.expiresAt === 0 ? "永久有效" : grant.expiresAt <= now
    ? "已过期" : `剩余 ${Math.max(1, Math.ceil((grant.expiresAt - now) / 60000))} 分钟`;
  const uses = grant.remainingUses === null ? "不限次数" : `剩余 ${grant.remainingUses} 次`;
  return `${validity}；${uses}`;
}
