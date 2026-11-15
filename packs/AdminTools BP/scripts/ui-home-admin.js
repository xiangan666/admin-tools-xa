/** One administrator entry for global settings and every player's home rules/access. */
import { ActionFormData, MessageFormData } from "@minecraft/server-ui";
import { requireHomeAdmin, setManagedHomeSettings } from "./home-admin.js";
import { getDirectoryPlayers, getDirectoryHomes, getHomeDestination } from "./home-access.js";
import { homeGeneration } from "./home-access-core.js";
import { getHomeIconPath } from "./homes.js";
import { showHomePolicy } from "./ui-home-policy.js";
import { showTravelRules } from "./ui-travel-rules.js";
import { showHomeAccessMenu } from "./ui-home-access.js";
import { tell, warnForm, fmtDimRaw } from "./utils.js";
import { raw } from "./i18n.js";

const PAGE_SIZE = 20;
const roleLabels = { owner: "服主", admin: "管理员", moderator: "协管员", player: "普通玩家" };

async function choose(player, title, body, entries, back, page = 0) {
  requireHomeAdmin(player);
  const last = Math.max(0, Math.ceil(entries.length / PAGE_SIZE) - 1);
  page = Math.max(0, Math.min(page, last));
  const visible = entries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const form = new ActionFormData().title(`${title}（${page + 1}/${last + 1}）`).body(body);
  const actions = visible.map(entry => { form.button(entry.label, entry.icon); return entry.run; });
  if (page > 0) { form.button("上一页"); actions.push(() => choose(player, title, body, entries, back, page - 1)); }
  if (page < last) { form.button("下一页"); actions.push(() => choose(player, title, body, entries, back, page + 1)); }
  form.button("返回"); actions.push(back);
  const result = await form.show(player);
  requireHomeAdmin(player);
  return result.canceled ? back?.() : actions[result.selection]?.();
}

export async function showHomeAdministration(player, back) {
  try {
    requireHomeAdmin(player);
    const form = new ActionFormData().title("家园统一管理（管理员）")
      .body("统一管理服务器附加规则、床传送、税率，以及在线/离线玩家家园的传送开关、房主规则和访问授权。管理员传送仍需有效访问授权。")
      .button("服务器家园规则、床传送与税务", "textures/ui/jm_at_control_panel")
      .button("逐玩家管理家园权限与规则", "textures/ui/jm_at_players")
      .button("返回", "textures/ui/jm_at_back");
    const result = await form.show(player);
    requireHomeAdmin(player);
    const again = () => showHomeAdministration(player, back);
    if (result.canceled || result.selection === 2) return back?.();
    if (result.selection === 0) return await showHomePolicy(player, again);
    if (result.selection === 1) return await showManagedPlayers(player, again);
  } catch (error) { return warnForm(player, `§c${error.message}`, back); }
}

async function showManagedPlayers(player, back) {
  requireHomeAdmin(player);
  const players = getDirectoryPlayers();
  return choose(player, "选择家园所属玩家", "可管理在线玩家与已有家园镜像的离线玩家。", players.map(owner => ({
    label: `${owner.name}\n${roleLabels[owner.role] || "普通玩家"} · ${owner.online ? "在线" : "离线"}`,
    run: () => showManagedOwnerHomes(player, owner, () => showManagedPlayers(player, back)),
  })), back);
}

async function showManagedOwnerHomes(player, owner, back) {
  requireHomeAdmin(player);
  const homes = getDirectoryHomes(owner.xuid);
  const again = () => showManagedOwnerHomes(player, owner, back);
  const entries = [{ label: "该玩家全部家园的访问申请与授权", run: () => showHomeAccessMenu(player, again, { ownerId: owner.xuid }) }];
  for (const [name, home] of Object.entries(homes)) {
    const generation = homeGeneration(home);
    entries.push({ label: raw(`${name} · ${home.teleportEnabled === false ? "已禁用传送" : "允许传送"}\n`, fmtDimRaw(home.dimension), ` (${Math.floor(home.x)}, ${Math.floor(home.y)}, ${Math.floor(home.z)})`),
      icon: getHomeIconPath(home), run: () => showManagedHome(player, owner, name, generation, again) });
  }
  return choose(player, `${owner.name} 的家园管理`, "选择家园配置规则和传送权限；修改离线家园会在其上线时同步。", entries, back);
}

async function showManagedHome(player, owner, name, generation, back) {
  try {
    const current = () => {
      requireHomeAdmin(player);
      const home = getHomeDestination(owner.xuid, name);
      if (!home || homeGeneration(home) !== generation) throw new Error("家园已删除或重新创建，请刷新列表。");
      return home;
    };
    const home = current();
    const again = () => showManagedHome(player, owner, name, generation, back);
    const result = await new ActionFormData().title(`管理家园：${name}`)
      .body(`${owner.name} 的家园\n传送权限：${home.teleportEnabled === false ? "管理员已关闭" : "启用"}\n关闭时包括房主在内均不可使用该家园传送；既有规则和授权保留。`)
      .button("编辑该家园传送规则").button(home.teleportEnabled === false ? "启用此家园传送" : "关闭此家园传送")
      .button("管理此家园访问申请与授权").button("返回").show(player);
    if (result.canceled || result.selection === 3) return back?.();
    current();
    if (result.selection === 0) return await showTravelRules(player, {
      kind: "home", manageAsAdmin: true, getDestination: current,
      saveRules: rules => setManagedHomeSettings(player, owner.xuid, name, generation, { rules }),
    }, again);
    if (result.selection === 1) {
      const enabled = home.teleportEnabled === false;
      const confirmation = await new MessageFormData().title(enabled ? "启用家园传送" : "关闭家园传送")
        .body(`将${enabled ? "启用" : "关闭"} ${owner.name} 的家园“${name}”传送。既有规则和访问授权保留。`)
        .button1("取消").button2("确认").show(player);
      if (!confirmation.canceled && confirmation.selection === 1) {
        setManagedHomeSettings(player, owner.xuid, name, generation, { teleportEnabled: enabled });
        tell(player, "§a家园传送权限已保存。");
      }
      return again();
    }
    if (result.selection === 2) return await showHomeAccessMenu(player, again, { ownerId: owner.xuid, homeName: name, generation });
  } catch (error) { return warnForm(player, `§c${error.message}`, back); }
}
