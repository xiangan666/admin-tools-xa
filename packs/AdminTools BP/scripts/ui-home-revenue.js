/** Earnings page is always scoped to the player opening it, never a supplied owner ID. */
import { ActionFormData, MessageFormData } from "@minecraft/server-ui";
import { getHomeRevenue, claimHomeRevenue } from "./home-revenue.js";
import { itemName, raw } from "./i18n.js";
import { tell } from "./utils.js";

const PAGE_SIZE = 16;

async function errorPage(player, error, back) {
  const result = await new MessageFormData().title("收益操作未完成").body(String(error?.message || error)).button1("返回").button2("关闭").show(player);
  if (!result.canceled && result.selection === 0) return back?.();
}

export async function showHomeRevenue(player, back, page = 0) {
  try {
    const ledger = getHomeRevenue(player);
    const types = ledger.totals;
    const pages = Math.max(1, Math.ceil(types.length / PAGE_SIZE));
    page = Math.max(0, Math.min(page, pages - 1));
    const shown = types.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    const form = new ActionFormData().title(`我的家园收益（${page + 1}/${pages}）`)
      .body(`成功传送产生的房主费用扣税后，保存在你的收益余额中，离线也会入账。领取只填入背包可容纳的数量，剩余继续保留。\n税额不足一个物品的百分之一余数会累计，不可通过拆单免税。\n${ledger.blocked ? `§c有 ${ledger.pending.length} 笔待结算、${ledger.pendingClaims.length} 笔待核查领取。重启遗留记录不会自动发放，请联系服主核查。` : "请选择物品查看累计收入、税额和领取记录。"}`)
      .button("领取全部可装入背包的收益");
    for (const total of shown) {
      const available = ledger.balances.filter(row => row.item.typeId === total.typeId).reduce((sum, row) => sum + row.amount, 0);
      form.button(raw(itemName(total.typeId), `\n可领 ${available}；累计净收入 ${total.net}`));
    }
    const prev = page > 0 ? shown.length + 1 : -1;
    if (prev >= 0) form.button("上一页");
    const next = page + 1 < pages ? shown.length + 1 + (prev >= 0 ? 1 : 0) : -1;
    if (next >= 0) form.button("下一页");
    const recordsIndex = shown.length + 1 + (prev >= 0 ? 1 : 0) + (next >= 0 ? 1 : 0);
    form.button("最近收益与领取记录").button("返回");
    const result = await form.show(player);
    if (result.canceled) return back?.();
    const again = () => showHomeRevenue(player, back, page);
    if (result.selection === 0) return claim(player, null, again);
    if (result.selection === prev) return showHomeRevenue(player, back, page - 1);
    if (result.selection === next) return showHomeRevenue(player, back, page + 1);
    if (result.selection === recordsIndex) return showHistory(player, again);
    const total = shown[result.selection - 1];
    return total ? showItemRevenue(player, total.typeId, again) : back?.();
  } catch (error) { return errorPage(player, error, back); }
}

async function claim(player, typeId, back) {
  try {
    const result = claimHomeRevenue(player, typeId);
    tell(player, result.amount > 0 ? `§a已领取 ${result.amount} 个收益物品，仍有 ${result.remaining} 个未领取。` : "§e没有可领取的收益，或背包已满。未领取部分继续保留。");
    return back?.();
  } catch (error) { return errorPage(player, error, back); }
}

async function showItemRevenue(player, typeId, back) {
  const ledger = getHomeRevenue(player);
  const total = ledger.totals.find(row => row.typeId === typeId);
  if (!total) return back?.();
  const balances = ledger.balances.filter(row => row.item.typeId === typeId);
  const available = balances.reduce((sum, row) => sum + row.amount, 0);
  const metadata = balances.map(row => `${row.item.nameTag || typeId} × ${row.amount}${row.item.lore?.length || row.item.dynamicProperties?.length ? "（保留自定义数据）" : ""}`).join("\n");
  const form = new ActionFormData().title(raw("家园收益：", itemName(typeId)))
    .body(raw(itemName(typeId), `\n物品 ID：${typeId}\n累计毛收入：${total.gross}\n累计已扣税物品：${total.tax}\n累计净收入：${total.net}\n累计已领取：${total.claimed}\n当前可领取：${available}\n未整物品税额：${total.carry}/100\n\n${metadata}`))
    .button("领取该类型可装入背包的收益").button("返回");
  const result = await form.show(player);
  return !result.canceled && result.selection === 0 ? claim(player, typeId, () => showItemRevenue(player, typeId, back)) : back?.();
}

async function showHistory(player, back) {
  const ledger = getHomeRevenue(player);
  const lines = ledger.history.map(row => {
    const when = new Date(row.at).toISOString().replace("T", " ").slice(0, 19) + " UTC";
    const items = row.items.map(item => row.kind === "income" ? `${item.typeId} 毛${item.gross}/税${item.tax}/净${item.net}` : `${item.typeId} × ${item.amount}`).join("；");
    return `${when} ${row.kind === "income" ? `收入 · ${row.homeName}` : "领取"}\n${items}`;
  });
  const result = await new MessageFormData().title("最近收益与领取记录").body(lines.join("\n\n") || "暂无记录。").button1("返回").button2("关闭").show(player);
  if (!result.canceled && result.selection === 0) return back?.();
}
