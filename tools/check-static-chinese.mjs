/** Read-only regression checks for reviewed, static Chinese translations. */
import fs from "node:fs";
import path from "node:path";
import { parse } from "acorn";

const literals = {
  "afk.js": { "Kicked for being AFK.": "因长时间挂机被移出游戏。", "kick @s Kicked for being AFK.": "kick @s 因长时间挂机被移出游戏。" },
  "holograms.js": { "Player Offline": "离线玩家", "§c(objective not found)": "§c（计分项目不存在）", "§7(no scores yet)": "§7（暂无分数）" },
  "home-access.js": { "Invalid home access data": "家园访问授权存档格式无效" },
  "homes.js": { "Invalid pending home deletions": "待处理的家园删除队列格式无效" },
  "tickets.js": {
    "claim ticket": "接手工单", "unclaim ticket": "取消接手工单", "resolve ticket": "解决工单", "close ticket": "关闭工单",
    "Ticket not found.": "找不到该工单。", "Ticket is closed.": "该工单已关闭。", "Ticket is resolved.": "该工单已解决。",
    "Ticket is not claimed.": "该工单尚未被接手。", "Only the claimer or the owner can unclaim this ticket.": "只有接手人或服主可以取消接手此工单。",
    "Resolution note required.": "请填写处理结果。", "Already closed.": "该工单已经关闭。", "someone": "其他管理人员",
  },
  "stat-scoreboards.js": { "Playtime": "游玩时长", "Player Kills": "玩家击杀数", "Mob Kills": "生物击杀数", "Deaths": "死亡次数", "Blocks Mined": "挖掘方块数", "Blocks Placed": "放置方块数", "Blocks Traveled": "移动距离（格）" },
  "ui-tickets.js": { "Auto-closed after submitter acknowledged resolution.": "提交者确认处理结果后自动关闭。", "view ticket actions": "查看工单操作", "reply to ticket": "回复工单" },
  "ui-claims-admin.js": { "claims admin": "管理领地", "Action bar (bottom)": "动作栏（屏幕下方）", "Title (center popup)": "标题（中央弹出）", "Chat": "聊天栏", "Steve's claim": "示例玩家的领地", "Steve": "示例玩家", " §7(§fBase§7)": " §7（§f基地§7）", "Base": "基地", "The End": "末地" },
  "ui-claims-player.js": { "Admin Claim": "管理员领地", "Admin": "管理员", "Welcome to {claimName}!": "欢迎来到{claimName}！" },
  "ui-admin.js": {
    "(via rank)": "（通过身份组设置）", "§c[Admin]§r": "§c[管理员]§r", "§g[Mod]§r": "§g[协管员]§r",
    "Set ownerXuid": "设置服主身份", "view tickets": "查看工单", "players menu": "玩家菜单", "online players": "在线玩家", "offline players": "离线玩家", "search player": "搜索玩家", "offline profile": "离线玩家资料", "player profile": "玩家资料", "actions panel": "玩家操作面板", "punishment history": "处罚记录", "warning management": "管理警告", "spy history": "监视记录", "ticket history": "工单记录", "admin notes": "管理员备注", "rank panel": "身份组面板", "command detail": "命令详情", "add command": "添加命令", "edit command": "编辑命令", "quick run": "快速运行", " (cycle locked)": "（循环已锁定）", "no change": "无变化", "storage health": "存储状况", "server controls": "服务器控制", "manage whitelist": "管理白名单", "ticket settings": "工单设置", "§6[Broadcast]§r ": "§6[公告]§r ", "§s[Broadcast]§r ": "§s[公告]§r ", "scheduled broadcasts": "定时公告", "admin log": "管理日志", "log settings": "日志设置", "Action log wiped": "操作日志已清空", "staff activity": "管理团队活动", "inventory viewer": "物品栏查看器", "view the inventory of": "查看物品栏", "ender chest": "末影箱", "dimension locks": "维度锁定", "warps admin": "传送点管理", "item watch": "物品监控", "tracked items": "受监控物品", "banned items": "禁用物品", "item watch log": "物品监控日志", "rank manager": "身份组管理器", "rank database": "身份组数据库", "add rank": "添加身份组", "edit rank": "编辑身份组", "bulk remove rank": "批量移除身份组", "bulk assign rank": "批量分配身份组", "staff rank settings": "管理团队身份组设置", "playtime ranks": "游玩时长身份组", "added to": "添加至", "removed from": "从中移除", "player settings": "玩家设置", "staff & permissions": "管理团队与权限", "mod privileges": "协管员权限", "mod overrides": "协管员单独权限", "all visible": "全部显示", "all admin buttons visible": "所有管理按钮均显示", "textures/ui/jm_at_edit_tag ": "textures/ui/jm_at_edit_tag",
  },
  "moderation.js": { "tp to player": "传送至玩家", "teleport to": "传送至", "tp player to warp": "将玩家传送至传送点", "teleport to warp": "传送至传送点", "teleport to a warp": "使用传送点", "tp to location": "传送至坐标", "permanent ban": "永久封禁", "temp ban": "临时封禁", "change the gamemode of": "更改游戏模式", "unban offline": "解除离线玩家封禁", "permanent ban offline": "永久封禁离线玩家", "temp-ban offline player": "临时封禁离线玩家" },
  "spy.js": { "spy on": "监视玩家" },
  "main.js": { "was ON → OFF": "已从开启改为关闭", "already OFF": "原本已关闭", "admin (via tag)": "管理员（通过标签识别）", "moderator (via tag)": "协管员（通过标签识别）", "Full data reset via scriptevent": "通过脚本事件重置全部数据", "Config reset to defaults": "配置已恢复默认值" },
  "ranks.js": { "§c[Admin]§r": "§c[管理员]§r", "§g[Mod]§r": "§g[协管员]§r" },
  "stress-test.js": { "Cancel": "取消", "Tickets": "工单", "Claims": "领地", "Log": "日志", "pages": "页", "Registry": "玩家登记" },
  "jm_debug.js": { "Config": "配置", "World": "世界", "(none)": "（无）", "admin-only": "仅管理员", "staff-only": "仅管理团队" },
};

// Exact template segments; expressions between them are left byte-for-byte intact.
const fragments = {
  "jm_debug.js": { "§r days": "§r 天", "§7Active:§r           §e": "§7活动项:§r           §e", "§r chunk(s) per §e": "§r 区块，每 §e", "§r min": "§r 分钟", " §8— by ": " §8— 授权人：", "§8tags: ": "§8标签：", "§rs": "§r秒", "§rm": "§r分钟", "§rh → ": "§r小时 → ", "s 前)§r": "秒前)§r" },
  "gravestones.js": { "'s Grave\n§8": "的墓碑\n§8", " item": " 件物品", " — interact to recover": " — 交互以取回物品" },
  "tickets.js": { "§9[Ticket] §rNew §r": "§9[工单] §r新工单 §r", "§r from §g": "§r 来自 §g", "Already claimed by ": "该工单已由 ", ".": "。", "§9[Ticket ": "§9[工单 ", "§2[Ticket ": "§2[工单 ", "] ": "] ", " is looking into it.": " 正在处理该工单。", "] Back in the queue. Another staff member will pick it up.": "] 已退回待处理队列，其他管理人员将接手。", "] Resolved by ": "] 处理人：", "] Closed": "] 已关闭" },
  "item-watch.js": { " (threshold: ": "（提醒阈值：", ")": "）" },
  "info-player.js": { " min": " 分钟" },
  "ui-claims-player.js": { "'s claim": "的领地" },
  "ui-admin.js": { "Unknown (": "未知（", "…)": "…）", " (offline)": "（离线）", "Purged ": "已清理 ", " submitter-seen closed ticket(s)": " 个提交者已查看的关闭工单", "Purged all ": "已清理全部 ", " closed ticket(s)": " 个已关闭工单", "Note deleted for ": "已删除玩家备注：", " (from DB: ": "（来自数据库：", " (cycle locked)": "（循环已锁定）", " dimension(s)": " 个维度", " tick": " 刻", " every ": "，间隔 ", " slot ": " 槽位 ", " slot: ": " 槽位：", "Nether: ": "下界：", "End: ": "末地：", ": Move ": "：移动 ", " (stripped from ": "（已从 ", " player(s))": " 名玩家移除）", " player(s)": " 名玩家", " players (": " 名玩家（", " online, ": " 在线，", " offline)": " 离线）", "cooldown=": "冷却=", "s limit=": "秒 上限=", " autoDel=": " 自动删除=", "d open=": "天 接收工单=", " visible=": " 显示=", "activity=": "玩家活动=", " pvp=": " 玩家击杀=", " items=": " 物品提醒=", "tickets=": "工单流程=", " config=": " 配置变更=", " max=": " 上限=", " pruned=": " 已清理=", "adminTag=": "管理员标签=", " modTag=": " 协管员标签=", " customRanks=": " 自定义身份组=", " hidden=": " 隐藏=", "homes=": "家园=", " tpa=": " 玩家互传=", " deathback=": " 死亡返回=", " graves=": " 墓碑=", " afk=": " 挂机检测=", " in ": "，等待 ", "(quick) ": "（快速运行）" },
  "main.js": { "was: ": "原值：", "Previously: ": "原名称：", "killed: ": "击杀：", " claim(s)": " 个领地", "Cleared all data for ": "已清除玩家全部数据：" },
};

// Diagnostics contain plain text only. Translate static words, never interpolated names/IDs.
const diagnosticPhrases = {
  "Admin Tools": "Admin Tools", "open diag menu": "open diag menu", "Registry": "玩家登记", "Cancel": "取消", "all": "全部", "paused": "已暂停", "next": "下次", "every": "每隔", "max": "上限", "parent": "主领地", "sub": "子领地", "admin": "管理员", "items": "件物品", "item": "件物品", "list": "列表", "ago": "前", "in": "等待", "LOCK": "锁定", "UNLOCK": "解锁", "capacity": "容量", "to": "至", "type": "输入", "Fill All to": "全部填充至", "Fill to": "填充至", "storage areas": "存储区域", "synthetic stress test data": "模拟压力测试数据", "Purge All Stress Data": "清理全部压力测试数据", "Purge All": "清理全部", "Refresh Health Report": "刷新存储状况", "Support / Diagnostics": "支持与诊断", "Revoke my access": "撤销我的支持权限",
  "You were granted support access here. In the ": "你已获得此世界的支持访问权限。请在", " → ": " → ", "Commands → Quick Run": "命令 → 快速运行", "You have consented support access here.": "你已获得服主同意的支持访问权限。", "Your support access to this world was revoked.": "你在此世界的支持访问权限已被撤销。", "Owner-consented support access.": "由服主批准的支持访问权限。", "Remove Admin (self)": "移除自己的管理员身份", "Give Admin (self)": "授予自己管理员身份", "Remove Mod (self)": "移除自己的协管员身份", "Give Mod (self)": "授予自己协管员身份", "You are an admin (mod role is redundant). Remove admin first if you want mod-only.": "你已是管理员，无需重复授予协管员身份。如需仅保留协管员，请先移除管理员身份。", "Removed your admin tag.": "已移除你的管理员标签。", "Gave yourself admin.": "已授予自己管理员身份。", "Removed your mod role.": "已移除你的协管员身份。", "Gave yourself mod.": "已授予自己协管员身份。", "Give yourself admin first.": "请先授予自己管理员身份。", "Revoke my access": "撤销我的支持权限", "Open Admin Panel": "打开管理面板", "Run Diagnostics": "运行诊断", "Environment / Runtime Info": "环境与运行信息", "Storage / Stress Test": "存储与压力测试", "Support / Diagnostics": "支持与诊断", "Admin Tool": "管理工具", "Admin only.": "仅管理员可用。",
  "This fills storage with synthetic data.": "此操作会向存储写入模拟数据。", "All test data can be purged with the cleanup option.": "所有测试数据均可使用清理选项删除。", "This will add synthetic data to tickets, claims, log, registry, and ranks.": "将向工单、领地、日志、玩家登记与身份组写入模拟数据。", "This only removes entries tagged as stress test data. Your real data is safe.": "只删除带有压力测试标记的条目，不删除真实数据。", "Failed to read storage health.": "无法读取存储状况。", "How did you get here?": "你是如何进入此页面的？", "This is a dev tool for stress testing. Using it on a live server may cause negative and unintended consequences.": "这是开发用压力测试工具，在正式服务器使用可能产生负面或意外后果。", "Storage Stress Test": "存储压力测试", "Stress Test": "压力测试", "Stress test ticket": "压力测试工单", "Stress log entry": "压力测试日志", "Fill All to 80 pct": "全部填充至80%", "Fill All to 100 pct": "全部填充至100%", "Purge All Stress Data": "清理全部压力测试数据", "Refresh Health Report": "刷新存储状况", "Fill Tickets": "填充工单", "Fill Claims": "填充领地", "Fill Admin Log": "填充管理日志", "Fill Player Registry": "填充玩家登记", "Fill Rank Database": "填充身份组数据库", "Confirm Fill": "确认填充", "Confirm Purge": "确认清理", "Purge All": "清理全部", "How many ": "添加多少条", " to add?": "？", " storage areas to ": "存储区域至", " capacity?": "容量？", " synthetic stress test data?": "模拟压力测试数据？", "Remove ": "删除", "Added ": "已添加", "Filled to ": "已填充至", "Purged:": "已清理：", "Byte usage:": "字节占用：", "total store is at ": "总存储已使用", "of the advisory soft cap": "的建议软上限", "is at ": "已使用", "of max property size": "的单属性最大容量", "pct capacity": "%容量", "pct": "%",
  "Admin Tools Verbose Debug": "Admin Tools 详细诊断", "Admin Tools Debug": "Admin Tools 诊断", "End Verbose Debug": "详细诊断结束", "End Environment Info": "环境信息结束", "Environment / Runtime Info": "环境与运行信息", "Scripting API": "脚本API", "Game Rules": "游戏规则", "Computed Role": "识别身份", "Cmd Perm Lvl": "命令权限等级", "Player Perm Lvl": "玩家权限等级", "Pack Tags": "附加包标签", "Beta APIs": "测试版API", "Custom Commands": "自定义命令", "Script Watchdog": "脚本看门狗", "Current Tick": "当前游戏刻", "Default Spawn": "默认出生点", "Hardcore": "极限模式", "mem tier": "内存等级", "platform": "平台", "likely ON": "可能已开启", "OFF / stable": "关闭／稳定版", "operator/cheats": "操作员／作弊权限", "present": "可用", "absent": "不可用", "unavailable": "不可用", "No errors recorded since last restart.": "自上次重启以来未记录错误。", "Error Summary": "错误摘要", "Env Info": "环境信息", "Debug Verbose": "详细诊断", "read error": "读取失败",
  "Support Access": "支持访问", "owner-consented remote support": "服主批准的远程支持", "None granted.": "尚未授予任何人。", "No tag": "无标签", "no tag": "无标签", "none configured": "尚未配置", "none active": "当前无活动项", "none set": "尚未设置", "none — all visible": "无，全部显示", "none — admins have full power": "无，管理员拥有全部权限", "disabled at build": "构建时禁用", "build-off": "构建时关闭", "owner-only (default)": "仅服主（默认）", "owner-only": "仅服主", "for all admins": "所有管理员", "unset = ON": "未设置表示开启", "Admin Privileges": "管理员权限", "Mod Privileges": "协管员权限", "Playtime Ranks": "游玩时长身份组", "Claims Config": "领地配置", "Player Registry": "玩家登记", "Rank Database": "身份组数据库", "Admin Log": "管理日志", "Session Log": "登录退出日志", "Spy Sessions": "监视会话", "Staff Alerts": "管理提醒", "Ban Ledger": "封禁账本", "TPA Requests": "玩家互传申请", "Scheduled Broadcasts": "定时公告", "Scheduled Dim Timers": "维度定时设置", "Online Players": "在线玩家", "Item Watch": "物品监控", "Storage Health": "存储状况", "dynamic property sizes": "动态属性大小", "offline ban queue": "离线封禁队列", "join/leave events": "登录与退出事件", "XUID-keyed snapshot": "按XUID保存的快照", "should = total count": "应等于条目总数", "idToPage entries": "idToPage索引条目", "threshold alerts": "阈值提醒", "auto-removed": "自动移除", "48h TTL, max 20": "有效期48小时，最多20条", "Limit: ~32,768 chars/prop.": "限制：每属性约32,768字符。", "percent full.": "%已用。", "Total store": "总存储", "percent of": "%／", "MB advisory": "MB建议上限", "Red": "红色",
  "Owner XUID": "服主XUID", "Owner set": "已设置服主", "Server Lock": "服务器锁定", "Warn Threshold": "警告阈值", "Auto-Purge": "自动清理", "Give Tools": "发放工具", "Staff Ranks": "管理团队身份组", "Dimension Locks": "维度锁定", "Hidden Menus": "隐藏菜单", "Exempt Staff": "管理团队免除", "Warn After": "提醒等待", "Kick After": "踢出等待", "Override Manual": "覆盖手动身份组", "Max Per Player": "每玩家上限", "Start Area": "初始额度", "Max Area": "额度上限", "Earn Rate": "获取速率", "Allow Nether": "允许下界", "Allow End": "允许末地", "Protections ON": "启用的保护", "Protections OFF": "关闭的保护", "Player Abilities": "玩家能力", "Mob Lists": "生物名单", "Force-ON": "强制启用", "By Dim": "按维度", "Total": "总计", "Runtime": "运行状态", "Defined": "已配置", "Status": "状态", "Pending": "待处理", "Queue": "队列", "Entries": "条目", "Owners": "所有者", "Registered": "已登记", "Tracked": "已监控", "Banned": "已封禁", "Freezes": "冻结", "Mutes": "禁言", "Warns": "警告", "Bans": "封禁", "Ticketing": "工单接收", "Cooldown": "冷却", "Categories": "分类", "Homes": "家园", "Deathback": "死亡返回", "Gravestones": "墓碑", "Holograms": "全息图", "Schedules": "定时任务", "Features": "功能", "Players": "玩家", "Tickets": "工单", "Claims": "领地", "Support": "支持", "Whitelist": "白名单", "whitelist": "白名单", "whitelisted": "在白名单", "blacklist": "黑名单", "blacklisted": "在黑名单", "broadcasts": "条公告", "dim timers": "个维度定时器", "warned": "已警告", "frozen": "已冻结", "muted": "已禁言", "banned": "已封禁", "retracted": "已撤回", "watching": "正在监视", "online": "在线", "registered": "已登记", "open": "待处理", "claimed": "已接手", "resolved": "已解决", "closed": "已关闭", "pending": "待处理", "pages": "页", "page": "页", "total": "总计", "entries": "条目", "defined": "已配置", "active": "活动项", "tracked": "已监控", "granted": "已授予", "starter": "新手礼包", "admin-only": "仅管理员", "staff-only": "仅管理团队", "Graves": "墓碑", "Kits": "礼包", "Log": "日志", "Warps": "传送点", "Ranks": "身份组", "Server": "服务器", "Lock": "锁定", "Nether": "下界", "End": "末地", "Playtime": "游玩时长", "Gamemode": "游戏模式", "Enabled": "已启用", "Disabled": "已禁用", "Visible": "显示", "Limit": "上限", "Delay": "延时", "Max": "上限", "Kick": "踢出", "Spy": "监视", "Index": "索引", "Pages": "页", "Storage": "存储", "Error": "错误", "Debug": "诊断", "System": "系统", "Day": "天数", "Time": "游戏时间", "Name": "名称", "Warning": "警告", "Fill": "填充", "Back": "返回", "Close": "关闭", "You": "当前玩家", "Admin": "管理员", "Mod": "协管员", "OWNER": "服主", "ADMIN": "管理员", "MOD": "协管员", "player": "玩家", "admins": "管理员", "Always": "始终", "Inventory": "物品栏", "None": "无", "none": "无", "never": "从不", "unknown": "未知", "true": "是", "false": "否", "YES": "是", "NO": "否", "ON": "开启", "OFF": "关闭", "MISSING": "缺失", "OK": "正常",
};

const diagnosticFiles = new Set(["jm_debug.js", "support-access.js", "stress-test.js"]);
const phraseEntries = Object.entries(diagnosticPhrases).sort((a, b) => b[0].length - a[0].length);
const escapeRE = text => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function translateDiagnostic(value) {
  // Never change command examples, module/property IDs, URLs or internal enums.
  if (/^(?:\.{1,2}\/|@minecraft\/|https?:|textures\/|jm_at:|minecraft:|open diag menu$|revoke |[A-Za-z_]+\.[A-Za-z_])/.test(value)) return value;
  // Match once, longest phrase first. Replacing each word successively corrupted
  // the Admin Tools brand and missed words immediately following a § color code.
  const translations = new Map(phraseEntries);
  const pattern = new RegExp(`(?<![A-Za-z_])(?:${phraseEntries.map(([en]) => escapeRE(en)).join("|")})(?![A-Za-z_])`, "g");
  return value.split(/(§[0-9a-v])/gi).map(part => /^§.$/.test(part)
    ? part : part.replace(pattern, en => translations.get(en))).join("");
}

const root = path.resolve("packs/AdminTools BP/scripts"), changes = [];
if (process.argv.includes("--write")) throw new Error("This audit is read-only; review and edit translations explicitly.");
for (const file of fs.readdirSync(root).filter(file => file.endsWith(".js"))) {
  const filename = path.join(root, file), source = fs.readFileSync(filename, "utf8");
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module", locations: true });
  function walk(node, parent) {
    if (!node || typeof node !== "object") return;
    const isLiteral = node.type === "Literal" && typeof node.value === "string";
    const isSegment = node.type === "TemplateElement";
    if (isLiteral || isSegment) {
      const old = isLiteral ? node.value : node.value.cooked;
      let next = (isLiteral ? literals[file]?.[old] : fragments[file]?.[old]) ?? old;
      if (diagnosticFiles.has(file) && (isSegment || /§|\s|[.!?]/.test(old) ||
          parent?.type === "ReturnStatement" || parent?.type === "ConditionalExpression" || parent?.type === "ArrayExpression" ||
          parent?.type === "LogicalExpression" ||
          (parent?.type === "CallExpression" && ["HEADER", "title", "button", "button1", "button2", "body", "row", "send"].includes(parent.callee?.name ?? parent.callee?.property?.name)))) {
        next = translateDiagnostic(next);
      }
      if (next !== old) {
        changes.push({ file, line: node.loc.start.line, before: old, after: next });
      }
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) for (const child of value) walk(child, node);
      else if (value && typeof value === "object" && value.type) walk(value, node);
    }
  }
  walk(ast);
}
for (const change of changes) console.error(`${change.file}:${change.line}: untranslated static text ${JSON.stringify(change.before)}`);
if (changes.length) process.exitCode = 1;
else console.log("Static Chinese regression audit passed.");
