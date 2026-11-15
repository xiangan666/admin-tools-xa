import { setHudTitle } from "./screen-feedback.js";
/** Successful travel transactions shared by homes, visiting homes, and warps. */
import { system, world } from "@minecraft/server";
import { MessageFormData } from "@minecraft/server-ui";
import { getCfg } from "./storage.js";
import { isAdmin } from "./permissions.js";
import { tell, silentCatch, getPlayerXuid, fmtDimRaw } from "./utils.js";
import { t, raw, itemName } from "./i18n.js";
import { confirmBringMount, teleportPlayer, captureTpBackLocation, teleportedPlayers } from "./players.js";
import { normalizeRules, isTimeAllowed, gameClockMinutes, inventoryCount, chargeInventory, refundCharge, destinationKey, cooldownProperty, remainingCooldown } from "./travel-rules.js";
import { getHomePolicy, resolveHomeRules } from "./home-policy.js";
import { prepareHomeRevenue } from "./home-revenue.js";
import { beginTravelWait, showTravelWait, clearTravelWait } from "./travel-feedback.js";

const active = new Set();
// A failed persistent write must not grant a second trip during this session.
const recent = new Map();
function cooldownIdentity(descriptor, destination) {
  const key = destinationKey({ ...descriptor, destinationId: destination.destinationId });
  return { key, property: cooldownProperty(key) };
}
function readLastSuccess(player, identity) {
  let saved = 0;
  const raw = player.getDynamicProperty(identity.property);
  if (typeof raw === "string" && raw) {
    const value = JSON.parse(raw);
    if (value.key !== identity.key) throw new Error("目的地冷却存储发生冲突，请联系管理员。");
    saved = value.at;
  }
  return Math.max(Number(saved) || 0, recent.get(`${getPlayerXuid(player)}:${identity.key}`) ?? 0);
}
function samePlace(a, b) {
  return a.x === b.x && a.y === b.y && a.z === b.z && (a.dimension ?? "overworld") === (b.dimension ?? "overworld") && a.destinationId === b.destinationId;
}
function ruleLayers(descriptor, destination) {
  const policy = descriptor.kind === "home" ? getHomePolicy() : null;
  const homeRules = policy ? resolveHomeRules(destination.rules, policy) : null;
  const layers = homeRules
    ? [{ name: "服务器", rules: homeRules.server }, { name: "家园主人", rules: homeRules.owner }]
    : [{ name: "传送点", rules: normalizeRules(destination.rules) }];
  return { policy, layers };
}
function quoteIdentity(descriptor, destination, policy, layers) {
  return JSON.stringify({ kind: descriptor.kind, ownerId: descriptor.ownerId || "", name: descriptor.name,
    x: destination.x, y: destination.y, z: destination.z, dimension: destination.dimension || "overworld",
    generation: destination.destinationId || "legacy", teleportEnabled: destination.teleportEnabled !== false, layers, taxPercent: policy?.taxPercent ?? null });
}
async function confirmTravelConditions(player, descriptor) {
  const destination = descriptor.getDestination();
  if (!destination || ![destination.x, destination.y, destination.z].every(Number.isFinite)) throw new Error("目的地已删除或坐标无效。");
  const { policy, layers } = ruleLayers(descriptor, destination);
  const quote = quoteIdentity(descriptor, destination, policy, layers);
  const lastSuccess = readLastSuccess(player, cooldownIdentity(descriptor, destination));
  const inventory = player.getComponent("minecraft:inventory")?.container;
  const now = gameClockMinutes(world.getTimeOfDay());
  const gameTime = `${String(Math.floor(now / 60)).padStart(2, "0")}:${String(Math.floor(now % 60)).padStart(2, "0")}`;
  const authorized = descriptor.authorize ? descriptor.authorize() === true : true;
  const parts = [raw(`目的地：${descriptor.name}\n`, fmtDimRaw(destination.dimension || "overworld"),
    ` (${Math.floor(destination.x)}, ${Math.floor(destination.y)}, ${Math.floor(destination.z)})\n游戏时间：${gameTime}\n访问授权：${authorized ? "有效" : "未授权"}${descriptor.kind === "home" ? `\n家园传送：${destination.teleportEnabled === false ? "管理员已关闭" : "启用"}` : ""}\n\n`)];
  const totalCosts = new Map();
  for (const layer of layers) {
    const { cooldownSeconds, cost, timeWindow } = layer.rules;
    const remaining = remainingCooldown(lastSuccess, cooldownSeconds);
    const timeAllowed = isTimeAllowed(world.getTimeOfDay(), timeWindow);
    parts.push(raw(`【${layer.name}规则】\n冷却：${cooldownSeconds} 秒${remaining > 0 ? `（还需等待 ${remaining} 秒）` : "（当前可用）"}\n开放时段：`,
      timeWindow.enabled ? `${timeWindow.start}–${timeWindow.end}（游戏时间${timeWindow.start > timeWindow.end ? "，跨午夜" : ""}；当前${timeAllowed ? "允许" : "不允许"}）` : "全天（允许）", "\n费用：",
      cost.amount > 0 ? raw(itemName(cost.typeId), ` × ${cost.amount}`) : "免费", "\n\n"));
    if (cost.amount > 0) totalCosts.set(cost.typeId, (totalCosts.get(cost.typeId) || 0) + cost.amount);
  }
  parts.push(raw("【合计消耗】\n"));
  let enoughItems = true;
  if (!totalCosts.size) parts.push(raw("无物品消耗\n"));
  for (const [typeId, amount] of totalCosts) {
    const available = inventoryCount(inventory, typeId);
    if (available < amount) enoughItems = false;
    parts.push(raw(itemName(typeId), ` × ${amount}（背包现有 ${available}，${available >= amount ? "足够" : "不足"}）\n`));
  }
  if (descriptor.kind === "home") parts.push(raw(`费用状态：${enoughItems ? "物品充足" : "物品不足"}\n`));
  if (policy) parts.push(raw(`\n必须先满足服务器规则，再满足家园主人规则，并持有有效访问授权。\n房主收费税率：${policy.taxPercent}%（税后收益归房主；服务器附加费用另行消耗）。\n`));
  parts.push(raw(`\n确认后按全局延时等待，移动可取消。只有传送成功才扣访问次数并开始冷却；传送失败退还物品。\n条件在等待中改变时必须重新确认。`));
  const result = await new MessageFormData().title("确认传送条件").body(raw(...parts))
    .button1("取消").button2("确认传送").show(player);
  return result.canceled || result.selection !== 1 ? null : quote;
}
function inspect(player, descriptor) {
  if (!player.isValid) throw new Error("玩家已离线，传送已取消。");
  const destination = descriptor.getDestination();
  if (!destination || ![destination.x, destination.y, destination.z].every(Number.isFinite)) throw new Error("目的地已删除或坐标无效。");
  const cfg = getCfg();
  if (descriptor.kind === "home" && cfg.homesEnabled === false) throw new Error("家园功能已关闭。");
  if (descriptor.kind === "home" && destination.teleportEnabled === false) throw new Error("管理员已关闭此家园的传送权限。");
  if (descriptor.authorize && descriptor.authorize() !== true) throw new Error("没有访问该目的地的权限，授权可能已过期、撤销或用尽。");
  const dim = String(destination.dimension ?? "overworld").replace("minecraft:", "");
  const locks = cfg.dimLocks ?? {};
  if (!isAdmin(player).ok && ((dim === "nether" && locks.nether) || (dim === "the_end" && locks.end))) throw new Error("目的地所在维度已被锁定。");
  const identity = cooldownIdentity(descriptor, destination);
  const lastSuccess = readLastSuccess(player, identity);
  const { policy, layers } = ruleLayers(descriptor, destination);
  const costs = new Map();
  // The server layer is checked first. Passing it never replaces the owner's layer.
  for (const layer of layers) {
    if (!isTimeAllowed(world.getTimeOfDay(), layer.rules.timeWindow)) throw new Error(`未满足${layer.name}规则：允许的游戏时段为 ${layer.rules.timeWindow.start}–${layer.rules.timeWindow.end}。`);
    const remaining = remainingCooldown(lastSuccess, layer.rules.cooldownSeconds);
    if (remaining > 0) throw new Error(`未满足${layer.name}规则：该目的地仍需冷却 ${remaining} 秒。`);
    const cost = layer.rules.cost;
    if (cost.amount > 0) costs.set(cost.typeId, (costs.get(cost.typeId) ?? 0) + cost.amount);
  }
  const container = player.getComponent("minecraft:inventory")?.container;
  for (const [typeId, amount] of costs) {
    if (inventoryCount(container, typeId) < amount) throw new Error(`背包物品不足：两层规则合计需要 ${amount} 个 ${typeId}。`);
  }
  return { destination, layers, policy, identity, container, dimension: world.getDimension(dim), quote: quoteIdentity(descriptor, destination, policy, layers) };
}
function waitCountdown(player, seconds, label) {
  if (seconds <= 0) return Promise.resolve(true);
  const origin = { ...player.location }, originDim = player.dimension.id;
  const start = system.currentTick;
  beginTravelWait(player, seconds, label);
  return new Promise((resolve) => {
    let lastSecond = Math.ceil(seconds);
    const finish = (ok) => { system.clearRun(handle); clearTravelWait(player); resolve(ok); };
    const handle = system.runInterval(() => {
      try {
        if (!player.isValid) { finish(false); return; }
        if (player.dimension.id !== originDim || Math.hypot(player.location.x - origin.x, player.location.y - origin.y, player.location.z - origin.z) > 0.5) {
          finish(false);
          try { setHudTitle(player, "§c传送已取消", { fadeInDuration: 0, stayDuration: 30, fadeOutDuration: 5, subtitle: "你移动了，请重新发起传送" }); } catch {}
          tell(player, t("jm_at.tp.canceled_moved")); return;
        }
        const left = Math.ceil(seconds - (system.currentTick - start) / 20);
        if (left <= 0) { finish(true); return; }
        if (left !== lastSecond || (system.currentTick - start) % 5 === 0) {
          showTravelWait(player, left, label, { title: left !== lastSecond });
          lastSecond = left;
        }
      } catch { finish(false); }
    }, 1);
  });
}
/** Returns success; never creates cooldowns/charges for canceled travel. */
export async function startRuleTeleport(player, descriptor, _back) {
  const playerKey = String(getPlayerXuid(player));
  if (active.has(playerKey)) { tell(player, "§c已有一项传送正在进行，请等待或移动取消。"); return false; }
  active.add(playerKey);
  const charges = [];
  let chargedContainer = null, revenueTicket = null;
  const overflow = (item) => {
    // Synchronous failure rollback normally restores the exact source slots.
    // If another extension filled them, addItem then drops the exact remainder.
    player.dimension.spawnItem(item, player.location);
    tell(player, "§e退款物品已掉落在你的脚下，请及时拾取。");
  };
  try {
    const quote = await confirmTravelConditions(player, descriptor);
    if (quote === null) return false;
    let state = inspect(player, descriptor);
    if (state.quote !== quote) throw new Error("传送条件已改变，请重新发起传送并确认。");
    const choice = await confirmBringMount(player, state.dimension, state.destination);
    if (choice === "cancel") { tell(player, t("jm_at.tp.canceled")); return false; }
    const delay = Number(getCfg().tpaDelaySec);
    if (!await waitCountdown(player, Number.isFinite(delay) ? Math.max(0, delay) : 3, descriptor.name)) return false;
    state = inspect(player, descriptor);
    if (state.quote !== quote) throw new Error("传送条件已改变，请重新发起传送并确认。");
    const target = { ...state.destination };
    let failure = "传送失败，已退还扣除的物品。";
    const success = await teleportPlayer(player, { x: target.x, y: target.y, z: target.z }, {
      dimension: state.dimension,
      askToBringMount: true,
      bringMount: choice === "bring",
      beforeTeleport() {
        try {
          // Recheck in the actual move tick; mounted travel may defer one tick.
          state = inspect(player, descriptor);
          if (state.quote !== quote) throw new Error("传送条件已改变，请重新发起传送并确认。");
          if (!samePlace(target, state.destination)) throw new Error("目的地已更新，请重新发起传送。");
          chargedContainer = state.container;
          for (const layer of state.layers) {
            const charge = chargeInventory(chargedContainer, layer.rules.cost, overflow);
            charges.push(charge);
            if (descriptor.kind === "home" && layer.name === "家园主人" && layer.rules.cost.amount > 0) {
              revenueTicket = prepareHomeRevenue({
                ownerId: descriptor.ownerId, homeName: descriptor.name,
                destinationId: state.destination.destinationId || "legacy",
                payerId: playerKey, taxPercent: state.policy.taxPercent,
              }, charge);
            }
          }
          captureTpBackLocation(player);
          teleportedPlayers.add(player.id);
          return true;
        } catch (e) { failure = e?.message ?? String(e); return false; }
      },
      afterTeleport(ok) {
        if (!ok) {
          try { revenueTicket?.cancel(); }
          catch (e) { silentCatch("travel_revenue_cancel", e); tell(player, "§e传送已取消，收益预留记录清理异常；该记录不可领取，请联系管理员核查。"); }
          // Reverse order restores exact source stacks when both layers debit the same slot.
          for (let i = charges.length - 1; i >= 0; i--) refundCharge(charges[i], chargedContainer, overflow);
          return;
        }
        try { revenueTicket?.commit(); }
        catch (e) { silentCatch("travel_revenue_commit", e); tell(player, "§e传送成功，但房主收益存档暂时异常，已保留待核对记录，请联系管理员。"); }
        const at = Date.now();
        recent.set(`${playerKey}:${state.identity.key}`, at);
        try { player.setDynamicProperty(state.identity.property, JSON.stringify({ key: state.identity.key, at })); }
        catch (e) { silentCatch("travel_cooldown_save", e); tell(player, "§e传送成功，但冷却存档写入失败；本次会话仍会执行冷却，请联系管理员。"); }
        try { descriptor.onSuccess?.(); }
        catch (e) { silentCatch("travel_success_callback", e); tell(player, "§e传送成功，但访问次数存档发生异常，请联系家园主人或管理员。"); }
      },
    });
    if (!success) { tell(player, `§c${failure}`); return false; }
    tell(player, t("jm_at.tp.done", descriptor.name));
    return true;
  } catch (e) {
    tell(player, `§c${e?.message ?? e}`);
    return false;
  } finally { active.delete(playerKey); }
}
