/** Configure destination rules. Home owners cannot bypass server feature switches. */
import { ModalFormData, ActionFormData } from "@minecraft/server-ui";
import { tell, warnForm } from "./utils.js";
import { itemName, raw } from "./i18n.js";
import { inventoryChoices, normalizeRules } from "./travel-rules.js";
import { getHomePolicy } from "./home-policy.js";
import { isAdmin } from "./permissions.js";

function sameFeatures(a, b) {
  return a.enabled === b.enabled && ["cooldown", "cost", "timeWindow"].every(key => a.features[key] === b.features[key]);
}

function layerDescription(rules) {
  const time = rules.timeWindow.enabled ? `${rules.timeWindow.start}–${rules.timeWindow.end}` : "全天";
  return `冷却 ${rules.cooldownSeconds} 秒；收费 ${rules.cost.amount ? `${rules.cost.typeId} × ${rules.cost.amount}` : "无"}；开放时段 ${time}`;
}

export async function showTravelRules(player, adapter, back) {
  try {
    const destination = adapter.getDestination();
    if (!destination) return warnForm(player, "§c该目的地已删除。", back);
    const isHome = adapter.kind === "home";
    const managing = isHome && adapter.manageAsAdmin === true;
    if (managing && !isAdmin(player).ok) throw new Error("只有管理员可以代管家园规则。");
    const policy = isHome ? getHomePolicy() : null;
    if (policy && !policy.enabled && !managing) return warnForm(player, "§e管理员已关闭家园规则功能。双方的冷却、收费和时段规则均暂停，原配置保留，访问授权仍然有效。", back);
    const editable = policy && !managing ? policy.features : { cooldown: true, cost: true, timeWindow: true };
    const rules = normalizeRules(destination.rules);
    if (isHome) {
      const disabled = Object.entries(editable).filter(([, on]) => !on).map(([key]) => ({ cooldown: "冷却", cost: "收费", timeWindow: "开放时段" }[key]));
      const info = `传送先满足服务器规则，再满足该家园的房主规则，两层都必须满足，费用叠加。\n房主收费税率：${policy.taxPercent}%；服务器附加费作为服务器消耗，不计房主收益。\n\n服务器附加规则：${layerDescription(policy.serverRules)}\n该家园已存规则：${layerDescription(rules)}\n${managing ? "\n管理员可预先编辑已暂停的规则；保存不会启用被关闭的功能。" : disabled.length ? `\n管理员已关闭：${disabled.join("、")}。关闭项不可编辑，原配置保留，双方该项均不执行。` : ""}`;
      if (!Object.values(editable).some(Boolean)) return warnForm(player, info, back);
      const overview = await new ActionFormData().title("家园规则与服务器要求").body(info)
        .button("编辑房主规则").button("返回").show(player);
      if (overview.canceled || overview.selection !== 0) return back?.();
    }
    const container = player.getComponent("minecraft:inventory")?.container;
    const choices = inventoryChoices(container);
    const values = [{ typeId: "", label: "不收费（数量必须为 0）" }, ...choices.map(c => ({ typeId: c.typeId, label: raw(itemName(c.example), `（背包 ${c.amount} 个；${c.typeId}）`) }))];
    if (rules.cost.typeId && !values.some(v => v.typeId === rules.cost.typeId)) {
      values.push({ typeId: rules.cost.typeId, label: raw("保留现有收费物品：", itemName(rules.cost.typeId), "（当前背包没有）"), retained: true });
    }
    const selected = Math.max(0, values.findIndex(v => v.typeId === rules.cost.typeId));
    const form = new ModalFormData().title(isHome ? managing ? "家园传送规则（管理员代管）" : "家园传送规则（房主）" : "传送点规则");
    if (editable.cooldown) form.textField("传送冷却（0–86400 秒；0 关闭）", "0", { defaultValue: String(rules.cooldownSeconds) });
    if (editable.cost) {
      form.dropdown("消耗物品（按物品类型收费）", values.map(v => v.label), { defaultValueIndex: selected });
      form.textField("消耗数量（0 表示不收费）", "0", { defaultValue: String(rules.cost.amount) });
    }
    if (editable.timeWindow) {
      form.toggle("限制游戏时间（Minecraft 游戏时钟，非现实时间）", { defaultValue: rules.timeWindow.enabled });
      form.textField("允许时段开始（24 小时制 HH:mm）", "22:00", { defaultValue: rules.timeWindow.start });
      form.textField("允许时段结束（支持跨午夜；起止相同为全天）", "06:00", { defaultValue: rules.timeWindow.end });
    }
    const response = await form.show(player);
    if (response.canceled) return back?.();
    if (managing && !isAdmin(player).ok) throw new Error("你的管理员身份已变化，未保存规则。");
    if (isHome && !managing && !sameFeatures(policy, getHomePolicy())) throw new Error("管理员已更改家园规则功能开关，请刷新后重新编辑。");
    const current = adapter.getDestination();
    if (!current) throw new Error("该目的地已删除，未保存规则。");
    // Merge into a fresh record: disabled fields and concurrent changes are retained.
    const next = normalizeRules(current.rules);
    const inputs = response.formValues ?? [];
    let i = 0;
    if (editable.cooldown) next.cooldownSeconds = inputs[i++];
    if (editable.cost) {
      const choice = values[inputs[i++]];
      if (!choice) throw new Error("请选择有效的收费物品。");
      next.cost = { typeId: choice.typeId, amount: inputs[i++] };
      if (Number(next.cost.amount) > 0 && !choice.retained && !inventoryChoices(player.getComponent("minecraft:inventory")?.container).some(c => c.typeId === choice.typeId)) {
        throw new Error("选中的物品已不在当前背包中，请重新选择。");
      }
    }
    if (editable.timeWindow) next.timeWindow = { enabled: inputs[i++], start: String(inputs[i++] ?? "").trim(), end: String(inputs[i++] ?? "").trim() };
    const normalized = normalizeRules(next);
    if (adapter.saveRules(normalized) !== true) throw new Error("规则保存失败；请检查权限、存储空间或目的地是否仍存在。");
    tell(player, isHome ? "§a该家园规则已保存。传送仍须先满足服务器规则，冷却与访问次数仅在成功后生效。" : "§a传送点规则已保存。冷却仅在传送成功后生效。");
    return back?.();
  } catch (error) {
    return warnForm(player, `§c${error?.message ?? error}`, () => showTravelRules(player, adapter, back));
  }
}
