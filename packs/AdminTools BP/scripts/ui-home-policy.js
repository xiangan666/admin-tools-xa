/** Administrator configuration of global AND constraints, bed travel and tax. */
import { ModalFormData } from "@minecraft/server-ui";
import { isAdmin } from "./permissions.js";
import { getHomePolicy, setHomePolicy, normalizeHomePolicy } from "./home-policy.js";
import { inventoryChoices } from "./travel-rules.js";
import { itemName, raw } from "./i18n.js";
import { tell, warnForm } from "./utils.js";

export async function showHomePolicy(player, back) {
  if (!isAdmin(player).ok) return warnForm(player, "§c只有管理员可以设置服务器家园规则、床传送与税率。", back);
  try {
    const policy = getHomePolicy();
    const rules = policy.serverRules;
    const values = [{ typeId: "", label: "不收取服务器附加费（数量为 0）" },
      ...inventoryChoices(player.getComponent("minecraft:inventory")?.container).map(c => ({
        typeId: c.typeId, label: raw(itemName(c.example), `（背包 ${c.amount} 个；${c.typeId}）`),
      }))];
    if (rules.cost.typeId && !values.some(v => v.typeId === rules.cost.typeId)) {
      values.push({ typeId: rules.cost.typeId, label: raw("保留已有附加收费：", itemName(rules.cost.typeId), "（当前背包没有）"), retained: true });
    }
    const selected = Math.max(0, values.findIndex(v => v.typeId === rules.cost.typeId));
    const form = new ModalFormData().title("服务器家园规则与税务（管理员设置）")
      .toggle("允许传送到床（关闭后隐藏入口，并取消尚未执行的床传送）", { defaultValue: policy.bedTeleportEnabled })
      .toggle("启用家园规则（关闭后双方规则暂停；访问授权继续）", { defaultValue: policy.enabled })
      .toggle("启用冷却功能（关闭后双方冷却暂停）", { defaultValue: policy.features.cooldown })
      .toggle("启用收费功能（关闭后双方收费暂停）", { defaultValue: policy.features.cost })
      .toggle("启用开放时段功能（关闭后双方时段限制暂停）", { defaultValue: policy.features.timeWindow })
      .textField("房主收费税率（0–100%；默认 30%）", "30", { defaultValue: String(policy.taxPercent) })
      .textField("服务器附加冷却（0–86400 秒；须同时满足房主冷却）", "0", { defaultValue: String(rules.cooldownSeconds) })
      .dropdown("服务器附加收费物品（另需支付房主收费，两项叠加）", values.map(v => v.label), { defaultValueIndex: selected })
      .textField("服务器附加收费数量（0 不收费；物品作为服务器消耗，不计房主收益）", "0", { defaultValue: String(rules.cost.amount) })
      .toggle("限制服务器开放时段（还须同时处于房主开放时段）", { defaultValue: rules.timeWindow.enabled })
      .textField("服务器允许时段开始（游戏 24 小时制 HH:mm）", "22:00", { defaultValue: rules.timeWindow.start })
      .textField("服务器允许时段结束（可跨午夜；起止相同全天）", "06:00", { defaultValue: rules.timeWindow.end })
      .submitButton("保存服务器家园设置");
    const response = await form.show(player);
    if (response.canceled) return back?.();
    if (!isAdmin(player).ok) throw new Error("你的管理员身份已变化，未保存规则。");
    const [bedTeleportEnabled, enabled, cooldown, cost, timeWindow, taxPercent, cooldownSeconds, index, amount, timeEnabled, start, end] = response.formValues ?? [];
    const selectedCost = values[index];
    if (!selectedCost) throw new Error("请选择有效的附加收费物品。");
    const next = normalizeHomePolicy({
      enabled, bedTeleportEnabled, taxPercent, features: { cooldown, cost, timeWindow },
      serverRules: {
        cooldownSeconds, cost: { typeId: selectedCost.typeId, amount },
        timeWindow: { enabled: timeEnabled, start: String(start ?? "").trim(), end: String(end ?? "").trim() },
      },
    });
    if (next.serverRules.cost.amount > 0 && !selectedCost.retained &&
        !inventoryChoices(player.getComponent("minecraft:inventory")?.container).some(c => c.typeId === selectedCost.typeId)) {
      throw new Error("所选收费物品已不在当前背包中，请刷新后重新选择。");
    }
    setHomePolicy(player, next);
    tell(player, "§a服务器家园设置已保存。传送先检查服务器规则，再检查房主规则；双方条件都必须满足。");
    return back?.();
  } catch (error) {
    return warnForm(player, `§c${error?.message ?? error}`, () => showHomePolicy(player, back));
  }
}
