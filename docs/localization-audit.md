# 简体中文本地化审计

## 自2.5.2起的结果

当前en_US/zh_CN各3163个键；2.5.1相对2.5.0各新增174个。此前已补齐157种日志动作、10个存储标签、4个时间单位、3个搜索分组，以及工单、领地、墓碑、全息图、默认统计和诊断等服务器端文案。2.5.2仅同步11种语言、共22处玩家工具配方说明，改为3个任意种类原木无序合成且支持混用，不增删语言键。全部发货文本严格UTF-8解码，检查缺键、重复、空值、占位符、格式码、静态引用、调用参数和RawMessage字符串化；静态中文回归检查通过。执行数量与安装包摘要见 [VALIDATION.md](VALIDATION.md)，现行规范与历史文本处理见 [LOCALIZATION.md](LOCALIZATION.md)。

## 历史迁移清单（2.3.1–2.5.0）

以下保留早期DDUI实时状态、离线消息和补充文案的替换记录。当时英文和简体中文语言文件各2989个键。这里的行号、原文和“当前行”列均为当时的快照，不代表2.5.1的当前位置或最终全部改动，也不能与本轮数量相加作为修复总数。

DDUI ObservableString不接受RawMessage，所以使用服务器端中文。`tools/apply-zh-status.mjs` 和映射为历史迁移工具；现有源码已完成迁移，不应照旧行号或盲目重放旧替换。当前日常检查使用 `npm run validate`，其中中文回归脚本为只读。

| 文件 | 行 | 原文 | 中文 |
| --- | ---: | --- | --- |
| scripts/info-admin.js | 737 | §cType something to search for. | §c请输入要搜索的内容。 |
| scripts/ui-admin.js | 5595 | §cThat command can't be saved: role, operator, and function/scriptevent commands are blocked. | §c无法保存该命令：已禁止角色、操作员和 function/scriptevent 命令。 |
| scripts/ui-admin.js | 6510 | New commands start inactive. Turn it on from its page after saving to begin the run. | 新命令默认未启用。保存后请在命令详情页启用，才会开始执行。 |
| scripts/ui-admin.js | 9376 | §2Canceled scheduled ${s.kind} for ${s.dim === "nether" ? "the Nether" : "the End"}. | §2已取消${s.dim === "nether" ? "下界" : "末地"}的计划${s.kind === "lock" ? "锁定" : "解锁"}。 |
| scripts/ui-admin.js | 3838 | §2Your appeal for warning "§r${pun.reason}§2" was accepted — warning removed. | §2您对警告“§r${pun.reason}§2”的申诉已通过，该警告已移除。 |
| scripts/ui-admin.js | 4002 | §2Your appeal for warning "§r${pun.reason}§2" was accepted — warning removed. | §2您对警告“§r${pun.reason}§2”的申诉已通过，该警告已移除。 |
| scripts/ui-admin.js | 9245 | §2${s.dim === "nether" ? "Nether" : "End"} unlocks ${fmtMs(s.activateAt)} | §2${s.dim === "nether" ? "下界" : "末地"}将于 ${fmtMs(s.activateAt)} 解锁 |
| scripts/ui-admin.js | 9237 | §c${s.dim === "nether" ? "Nether" : "End"} locks ${fmtMs(s.activateAt)} | §c${s.dim === "nether" ? "下界" : "末地"}将于 ${fmtMs(s.activateAt)} 锁定 |
| scripts/ui-admin.js | 5617 | §cEnter how many times to run (1 or more), or choose "Run forever". | §c请输入执行次数（至少1次），或选择“持续执行”。 |
| scripts/ui-admin.js | 11816 | §cA threshold at ${fmtThresholdTime(totalMinutes)} already exists. | §c已存在 ${fmtThresholdTime(totalMinutes)} 的游玩时长门槛。 |
| scripts/ui-admin.js | 11974 | §cA threshold at ${fmtThresholdTime(totalMinutes)} already exists. | §c已存在 ${fmtThresholdTime(totalMinutes)} 的游玩时长门槛。 |
| scripts/ui-admin.js | 10047 | §cEnter a full item ID, e.g. minecraft:diamond (namespace:item). | §c请输入完整物品ID，例如 minecraft:diamond（命名空间:物品）。 |
| scripts/ui-admin.js | 12202 | §9§l[Ranks]§r ${fmtPlaytimeMs(absMs)} of bonus playtime removed. | §9§l[身份组]§r 已扣除 ${fmtPlaytimeMs(absMs)} 的奖励游玩时长。 |
| scripts/ui-admin.js | 12201 | §9§l[Ranks]§r ${fmtPlaytimeMs(absMs)} of bonus playtime added. | §9§l[身份组]§r 已增加 ${fmtPlaytimeMs(absMs)} 的奖励游玩时长。 |
| scripts/ui-admin.js | 6961 | §cNo record found for "${typed}". They must have joined once. | §c找不到“${typed}”的记录，对方必须至少加入过此世界一次。 |
| scripts/ui-admin.js | 1800 | §cNo record found for "${name}". They may have never joined. | §c找不到“${name}”的记录，对方可能从未加入过此世界。 |
| scripts/ui-admin.js | 10107 | §cEnter a full item ID, e.g. minecraft:tnt (namespace:item). | §c请输入完整物品ID，例如 minecraft:tnt（命名空间:物品）。 |
| scripts/ui-admin.js | 7502 | §cInvalid interval. Use a number + unit, e.g. 30s, 10m, 6h. | §c间隔无效，请使用数字加单位的格式，例如 30s、10m、6h。 |
| scripts/ui-admin.js | 2483 | §cSomething went wrong: ${e?.message ?? "Unknown error."} | §c操作失败：${e?.message ?? "未知错误。"} |
| scripts/ui-admin.js | 3857 | §cYour appeal for warning "§r${pun.reason}§c" was denied. | §c您对警告“§r${pun.reason}§c”的申诉被驳回。 |
| scripts/ui-admin.js | 4025 | §cYour appeal for warning "§r${pun.reason}§c" was denied. | §c您对警告“§r${pun.reason}§c”的申诉被驳回。 |
| scripts/ui-admin.js | 5607 | §cCouldn't read the interval. Use e.g. 10t, 30s, 5m, 1h. | §c无法识别间隔，请使用 10t、30s、5m 或 1h 等格式。 |
| scripts/ui-admin.js | 5481 | Runs once, ${_fmtTicks(delayTicks)} after activation. | 激活后等待 ${_fmtTicks(delayTicks)} 执行一次。 |
| scripts/ui-admin.js | 5600 | §cCouldn't read the delay. Use e.g. 0s, 30s, 1m, 5t. | §c无法识别延时，请使用 0s、30s、1m 或 5t 等格式。 |
| scripts/ui-admin.js | 6507 | Starts ${_fmtTicks(delayTicks)} after it's activated | 激活后等待 ${_fmtTicks(delayTicks)} 开始 |
| scripts/ui-admin.js | 6894 | §cWhitelist is full (${LIMITS.WHITELIST_MAX} max). | §c白名单已满，最多可保存 ${LIMITS.WHITELIST_MAX} 名玩家。 |
| scripts/ui-admin.js | 6970 | §cWhitelist is full (${LIMITS.WHITELIST_MAX} max). | §c白名单已满，最多可保存 ${LIMITS.WHITELIST_MAX} 名玩家。 |
| scripts/ui-admin.js | 12163 | §cNothing to change. Enter an amount other than 0. | §c没有需要修改的内容，请输入非零数值。 |
| scripts/ui-admin.js | 6502 | ${repeatCount} time${repeatCount === 1 ? "" : "s"} | ${repeatCount} 次 |
| scripts/ui-admin.js | 5610 | §cThat interval is too fast. The minimum is 0.5s. | §c执行间隔过短，最短为0.5秒。 |
| scripts/ui-admin.js | 5624 | §cCouldn't read the total time. Use e.g. 30m, 1h. | §c无法识别总时长，请使用 30m、1h 等格式。 |
| scripts/ui-admin.js | 6514 | Runs every ${_fmtTicks(intervalTicks)}, ${when}. | 每隔 ${_fmtTicks(intervalTicks)} 执行，${when}。 |
| scripts/ui-admin.js | 5501 | §7Total time must be at least the interval.§r | §7总时长不能短于执行间隔。§r |
| scripts/ui-admin.js | 6884 | §cNo online player found matching "${typed}". | §c找不到与“${typed}”匹配的在线玩家。 |
| scripts/ui-admin.js | 7075 | §cCooldown must be a whole number of seconds. | §c冷却时间必须为整数秒。 |
| scripts/ui-admin.js | 2413 | §cEnter a valid duration (e.g. 30m, 1h, 7d). | §c请输入有效时长，例如 30m（30分钟）、1h（1小时）、7d（7天）。 |
| scripts/ui-admin.js | 3408 | §cEnter a valid duration (e.g. 30m, 1h, 7d). | §c请输入有效时长，例如 30m（30分钟）、1h（1小时）、7d（7天）。 |
| scripts/ui-admin.js | 2459 | §cInvalid duration. Use e.g. 30m, 1h, or 7d. | §c时长无效，请使用 30m、1h 或 7d 等格式。 |
| scripts/ui-admin.js | 3492 | §cInvalid duration. Use e.g. 30m, 1h, or 7d. | §c时长无效，请使用 30m、1h 或 7d 等格式。 |
| scripts/ui-admin.js | 5627 | §cTotal time is shorter than the interval. | §c总时长不能短于执行间隔。 |
| scripts/ui-admin.js | 7080 | §cAuto-delete days must be a whole number. | §c自动删除天数必须为整数。 |
| scripts/ui-admin.js | 9318 | §cInvalid duration. Use e.g. 10m, 1h, 30s. | §c时长无效，请使用 10m、1h、30s 等格式。 |
| scripts/ui-admin.js | 7493 | §cAdd at least one line of message first. | §c请先输入至少一行消息。 |
| scripts/ui-admin.js | 9528 | §cA warp named "${name}" already exists. | §c名为“${name}”的传送点已存在。 |
| scripts/ui-admin.js | 6966 | §e${entry.name} is already whitelisted. | §e${entry.name} 已在白名单中。 |
| scripts/ui-admin.js | 6890 | §e${pick.name} is already whitelisted. | §e${pick.name} 已在白名单中。 |
| scripts/ui-admin.js | 10052 | §cThe quantity must be a whole number. | §c数量必须为整数。 |
| scripts/ui-admin.js | 1918 | §cNo online player matches "${name}". | §c找不到与“${name}”匹配的在线玩家。 |
| scripts/ui-admin.js | 5487 | §7Set a valid interval (min 0.5s).§r | §7请设置有效间隔，最短0.5秒。§r |
| scripts/ui-admin.js | 6508 | Starts immediately when activated | 激活后立即开始 |
| scripts/ui-admin.js | 5495 | §7Enter how many times to run.§r | §7请输入执行次数。§r |
| scripts/ui-admin.js | 945 | §cType something to search for. | §c请输入要搜索的内容。 |
| scripts/ui-admin.js | 7291 | §cThat category already exists. | §c该类别已存在。 |
| scripts/ui-admin.js | 10111 | §eThat item is already banned. | §e该物品已被禁用。 |
| scripts/ui-admin.js | 11813 | §cTime must be greater than 0. | §c时长必须大于0。 |
| scripts/ui-admin.js | 11969 | §cTime must be greater than 0. | §c时长必须大于0。 |
| scripts/ui-admin.js | 5786 | §cThat command is too short. | §c命令过短，请补充内容。 |
| scripts/ui-admin.js | 6503 | ${times} over ${runForLabel} | 在 ${runForLabel} 内执行 ${times} |
| scripts/ui-admin.js | 3264 | §cThat reason is too short. | §c原因过短，请补充说明。 |
| scripts/ui-admin.js | 3343 | §cThat reason is too short. | §c原因过短，请补充说明。 |
| scripts/ui-admin.js | 3498 | §cThat reason is too short. | §c原因过短，请补充说明。 |
| scripts/ui-admin.js | 10573 | §cEnter the tag text first. | §c请先输入标签文本。 |
| scripts/ui-admin.js | 6500 | forever (until you stop it) | 持续执行，直到手动停止 |
| scripts/ui-admin.js | 5482 | Runs once when activated. | 激活时执行一次。 |
| scripts/ui-admin.js | 1779 | §cType or pick a player. | §c请输入或选择一名玩家。 |
| scripts/ui-admin.js | 1913 | §cType or pick a player. | §c请输入或选择一名玩家。 |
| scripts/ui-admin.js | 11547 | §cTags cannot be empty. | §c标签不能为空。 |
| scripts/ui-admin.js | 4387 | §cNote can't be empty. | §c备注不能为空。 |
| scripts/ui-admin.js | 5591 | §cEnter a button name. | §c请输入按钮名称。 |
| scripts/ui-admin.js | 4287 | §cType a note first. | §c请先输入备注。 |
| scripts/ui-admin.js | 7287 | §cName is too short. | §c名称过短。 |
| scripts/ui-admin.js | 9249 | §rScheduled unlocks: | §r计划解锁： |
| scripts/ui-admin.js | 257 | §jMaterial Netherite | §j下界合金色 |
| scripts/ui-admin.js | 2465 | §cReason too short. | §c原因过短，请补充说明。 |
| scripts/ui-admin.js | 10460 | §7(no tag text yet) | §7（尚未输入标签文本） |
| scripts/ui-admin.js | 262 | §mMaterial Redstone | §m红石色 |
| scripts/ui-admin.js | 292 | §uMaterial Amethyst | §u紫水晶色 |
| scripts/ui-admin.js | 2418 |  §6(capped to 24h) |  §6（最多24小时） |
| scripts/ui-admin.js | 3413 |  §6(capped to 24h) |  §6（最多24小时） |
| scripts/ui-admin.js | 5592 | §cEnter a command. | §c请输入命令。 |
| scripts/ui-admin.js | 7417 | §7(no message yet) | §7（尚未输入消息） |
| scripts/ui-admin.js | 9249 | §rScheduled locks: | §r计划锁定： |
| scripts/ui-admin.js | 277 | §qMaterial Emerald | §q绿宝石色 |
| scripts/ui-admin.js | 282 | §sMaterial Diamond | §s钻石色 |
| scripts/ui-admin.js | 247 | §hMaterial Quartz | §h石英色 |
| scripts/ui-admin.js | 267 | §nMaterial Copper | §n铜色 |
| scripts/ui-admin.js | 301 | No color (manual) | 无颜色（手动设置） |
| scripts/ui-admin.js | 303 | No color (manual) | 无颜色（手动设置） |
| scripts/ui-admin.js | 10507 | No color (manual) | 无颜色（手动设置） |
| scripts/ui-admin.js | 11435 | No color (manual) | 无颜色（手动设置） |
| scripts/ui-admin.js | 287 | §tMaterial Lapis | §t青金石色 |
| scripts/ui-admin.js | 297 | §vMaterial Resin | §v树脂色 |
| scripts/ui-admin.js | 242 | §gMinecoin Gold | §g金币金色 |
| scripts/ui-admin.js | 252 | §iMaterial Iron | §i铁色 |
| scripts/ui-admin.js | 272 | §pMaterial Gold | §p黄金色 |
| scripts/ui-admin.js | 10462 | §7SamplePlayer | §7示例玩家 |
| scripts/ui-admin.js | 11445 | §7SamplePlayer | §7示例玩家 |
| scripts/ui-admin.js | 11445 | §7(no tag yet) | §7（尚未设置标签） |
| scripts/ui-admin.js | 235 | §dLight Purple | §d浅紫色 |
| scripts/ui-admin.js | 223 | §5Dark Purple | §5深紫色 |
| scripts/ui-admin.js | 219 | §2Dark Green | §2深绿色 |
| scripts/ui-admin.js | 218 | §1Dark Blue | §1深蓝色 |
| scripts/ui-admin.js | 220 | §3Dark Aqua | §3深青色 |
| scripts/ui-admin.js | 229 | §8Dark Gray | §8深灰色 |
| scripts/ui-admin.js | 221 | §4Dark Red | §4深红色 |
| scripts/ui-admin.js | 5474 | (unnamed) | （未命名） |
| scripts/ui-admin.js | 239 | §eYellow | §e黄色 |
| scripts/ui-admin.js | 217 | §0Black | §0黑色 |
| scripts/ui-admin.js | 231 | §aGreen | §a绿色 |
| scripts/ui-admin.js | 240 | §fWhite | §f白色 |
| scripts/ui-admin.js | 9240 | §8None | §8无 |
| scripts/ui-admin.js | 9248 | §8None | §8无 |
| scripts/ui-admin.js | 227 | §6Gold | §6金色 |
| scripts/ui-admin.js | 228 | §7Gray | §7灰色 |
| scripts/ui-admin.js | 230 | §9Blue | §9蓝色 |
| scripts/ui-admin.js | 232 | §bAqua | §b青色 |
| scripts/ui-admin.js | 233 | §cRed | §c红色 |
| scripts/ui-claims-admin.js | 899 | §2[Claims] You received the claim "${claim.name \|\| claim.id}" from ${oldOwnerName} (transferred by admin). | §2[领地] 管理员已将 ${oldOwnerName} 的领地“${claim.name \|\| claim.id}”转让给您。 |
| scripts/ui-claims-admin.js | 895 | §e[Claims] Your claim "${claim.name \|\| claim.id}" was transferred to ${newName} by an admin. | §e[领地] 管理员已将您的领地“${claim.name \|\| claim.id}”转让给 ${newName}。 |
| scripts/ui-claims-admin.js | 2043 | §cUse namespace:mob (e.g. minecraft:happy_ghast), or just mypack: to match a whole addon. | §c请使用 命名空间:生物（例如 minecraft:happy_ghast），或只输入 mypack: 以匹配整个附加包。 |
| scripts/ui-claims-admin.js | 2920 | §cCouldn't add member: they may already be trusted, or the claim's member data is full. | §c无法添加成员：对方可能已受信任，或领地成员数据已满。 |
| scripts/ui-claims-admin.js | 1967 | §cUse namespace:mob (e.g. minecraft:zombie), or just mypack: to match a whole addon. | §c请使用 命名空间:生物（例如 minecraft:zombie），或只输入 mypack: 以匹配整个附加包。 |
| scripts/ui-claims-admin.js | 953 | §c[Claims] Your sub-claim "${claim.name \|\| claim.id}" was deleted by an admin. | §c[领地] 管理员已删除您的子领地“${claim.name \|\| claim.id}”。 |
| scripts/ui-claims-admin.js | 811 | §cNo player named "${typed}" was found. They must have joined at least once. | §c找不到名为“${typed}”的玩家，对方必须至少加入过此世界一次。 |
| scripts/ui-claims-admin.js | 2898 | §cNo player named "${typed}" was found. They must have joined at least once. | §c找不到名为“${typed}”的玩家，对方必须至少加入过此世界一次。 |
| scripts/ui-claims-admin.js | 966 | §c[Claims] Your claim "${claim.name \|\| claim.id}" was deleted by an admin. | §c[领地] 管理员已删除您的领地“${claim.name \|\| claim.id}”。 |
| scripts/ui-claims-admin.js | 1214 | §7Shown in: ${displayLabels[displayObs.getData()] ?? displayLabels[0]} | §7显示位置：${displayLabels[displayObs.getData()] ?? displayLabels[0]} |
| scripts/ui-claims-admin.js | 2296 | §7New bonus: §a${currentBonus + d}§7  (§f${d >= 0 ? "+" : ""}${d}§7) | §7调整后的额外额度：§a${currentBonus + d}§7（§f${d >= 0 ? "+" : ""}${d}§7） |
| scripts/ui-claims-admin.js | 1595 | §c${r.d.label}: the minimum height must be lower than the maximum. | §c${r.d.label}：最低高度必须小于最高高度。 |
| scripts/ui-claims-admin.js | 2359 | §9§l[Claims]§r ${absAmount} chunk(s) of claim area removed. | §9§l[领地]§r 已扣除 ${absAmount} 个区块的领地额度。 |
| scripts/ui-claims-admin.js | 2358 | §9§l[Claims]§r ${absAmount} chunk(s) of claim area gained. | §9§l[领地]§r 已增加 ${absAmount} 个区块的领地额度。 |
| scripts/ui-claims-admin.js | 367 | §cNo known players to pick from yet. Type a name instead. | §c暂无已记录的玩家可供选择，请直接输入名称。 |
| scripts/ui-claims-admin.js | 2230 | §cNo known players to pick from yet. Type a name instead. | §c暂无已记录的玩家可供选择，请直接输入名称。 |
| scripts/ui-claims-admin.js | 1196 |  §c\| Building restricted: shulkers will burst if placed |  §c\| 禁止建造：放置的潜影盒会被破坏 |
| scripts/ui-claims-admin.js | 1043 | §cThe minimum height must be lower than the maximum. | §c最低高度必须小于最高高度。 |
| scripts/ui-claims-admin.js | 1227 | §eThese tags aren't recognized and were removed:\n | §e以下标签无法识别，已移除：\n |
| scripts/ui-claims-admin.js | 2903 | §cThat player is already a member of this claim. | §c该玩家已是此领地的成员。 |
| scripts/ui-claims-admin.js | 820 | §cPick a player from the list, or type a name. | §c请从列表选择玩家，或直接输入名称。 |
| scripts/ui-claims-admin.js | 2911 | §cPick a player from the list, or type a name. | §c请从列表选择玩家，或直接输入名称。 |
| scripts/ui-claims-admin.js | 1762 | §cThose settings must all be whole numbers. | §c这些设置必须全部为整数。 |
| scripts/ui-claims-admin.js | 2908 | §cNo eligible players: type a name instead. | §c暂无符合条件的玩家，请直接输入名称。 |
| scripts/ui-claims-admin.js | 817 | §cNo known players: type a name instead. | §c暂无已记录的玩家，请直接输入名称。 |
| scripts/ui-claims-admin.js | 1972 | §c${typeId} is already on the blacklist. | §c${typeId} 已在黑名单中。 |
| scripts/ui-claims-admin.js | 2048 | §c${typeId} is already on the whitelist. | §c${typeId} 已在白名单中。 |
| scripts/ui-claims-admin.js | 361 | §cNo player named "${typed}" was found. | §c找不到名为“${typed}”的玩家。 |
| scripts/ui-claims-admin.js | 2224 | §cNo player named "${typed}" was found. | §c找不到名为“${typed}”的玩家。 |
| scripts/ui-claims-admin.js | 825 | §eThat player already owns this claim. | §e该玩家已是此领地的主人。 |
| scripts/ui-claims-admin.js | 2901 | §cThat player already owns this claim. | §c该玩家已是此领地的主人。 |
| scripts/ui-claims-admin.js | 2324 | §cPick a non-zero amount to apply. | §c请输入要调整的非零数值。 |
| scripts/ui-claims-admin.js | 372 | §cPick a player or type a name. | §c请选择一名玩家或输入名称。 |
| scripts/ui-claims-admin.js | 2235 | §cPick a player or type a name. | §c请选择一名玩家或输入名称。 |
| scripts/ui-claims-admin.js | 1231 | §7 (did you mean this?) | §7（是否要使用此标签？） |
| scripts/ui-claims-admin.js | 2693 | §cPlease enter a name. | §c请输入名称。 |
| scripts/ui-claims-admin.js | 1217 | §l§2Entry message§r | §l§2进入消息§r |
| scripts/ui-claims-admin.js | 1221 | §l§2Exit message§r | §l§2离开消息§r |
| scripts/ui-claims-admin.js | 1232 | §7 (unknown tag) | §7（未知标签） |
| scripts/ui-claims-player.js | 1632 | §cCouldn't add member: they may already be trusted, or the claim's member data is full. | §c无法添加成员：对方可能已受信任，或领地成员数据已满。 |
| scripts/ui-claims-player.js | 1608 | §cNo player named "${typed}" was found. They must have joined at least once. | §c找不到名为“${typed}”的玩家，对方必须至少加入过此世界一次。 |
| scripts/ui-claims-player.js | 2194 |  §c\| Building restricted — shulkers will burst if placed |  §c\| 禁止建造：放置的潜影盒会被破坏 |
| scripts/ui-claims-player.js | 1432 | §cThe minimum height must be lower than the maximum. | §c最低高度必须小于最高高度。 |
| scripts/ui-claims-player.js | 2208 | §8(blank — the server default message will be used) | §8（留空时使用服务器默认消息） |
| scripts/ui-claims-player.js | 2213 | §eThese tags aren't recognized and were removed:\n | §e以下标签无法识别，已移除：\n |
| scripts/ui-claims-player.js | 1615 | §cThat player is already a member of this claim. | §c该玩家已是此领地的成员。 |
| scripts/ui-claims-player.js | 1623 | §cPick a player from the list, or type a name. | §c请从列表选择玩家，或直接输入名称。 |
| scripts/ui-claims-player.js | 1620 | §cNo eligible players: type a name instead. | §c暂无符合条件的玩家，请直接输入名称。 |
| scripts/ui-claims-player.js | 2531 | §cPlease enter a name for this sub-claim. | §c请输入子领地名称。 |
| scripts/ui-claims-player.js | 1613 | §cThat player already owns this claim. | §c该玩家已是此领地的主人。 |
| scripts/ui-claims-player.js | 625 | §cPlease enter a name for this claim. | §c请输入领地名称。 |
| scripts/ui-claims-player.js | 1024 | §cPlease enter a name for this claim. | §c请输入领地名称。 |
| scripts/ui-claims-player.js | 1611 | §cYou can't add yourself as a member. | §c不能将自己添加为领地成员。 |
| scripts/ui-claims-player.js | 2217 | §7 (did you mean this?) | §7（是否要使用此标签？） |
| scripts/ui-claims-player.js | 2135 | §cPlease enter a name. | §c请输入名称。 |
| scripts/ui-claims-player.js | 2218 | §7 (unknown tag) | §7（未知标签） |
| scripts/ui-holograms.js | 338 | §cCouldn't save the hologram — storage is full. Remove a hologram (or other data) and try again. | §c无法保存全息图：存储空间已满。请删除全息图或其他数据后重试。 |
| scripts/ui-holograms.js | 707 | §cCouldn't save the hologram — storage is full. Remove a hologram (or other data) and try again. | §c无法保存全息图：存储空间已满。请删除全息图或其他数据后重试。 |
| scripts/ui-holograms.js | 330 | §cHologram registry is full (${LIMITS.HOLOGRAM_REGISTRY_MAX} max). Remove one first. | §c全息图数量已达上限（${LIMITS.HOLOGRAM_REGISTRY_MAX}），请先删除一个。 |
| scripts/ui-holograms.js | 701 | §cHologram registry is full (${LIMITS.HOLOGRAM_REGISTRY_MAX} max). Remove one first. | §c全息图数量已达上限（${LIMITS.HOLOGRAM_REGISTRY_MAX}），请先删除一个。 |
| scripts/ui-holograms.js | 665 | §cCouldn't create that objective. The ID may be invalid or taken. | §c无法创建计分项目，ID可能无效或已被占用。 |
| scripts/ui-holograms.js | 320 | §cThose coordinates aren't valid. Use numbers only. | §c坐标无效，请只输入数字。 |
| scripts/ui-holograms.js | 684 | §cThose coordinates aren't valid. Use numbers only. | §c坐标无效，请只输入数字。 |
| scripts/ui-holograms.js | 540 | §7Choose or name an objective to preview. | §7请选择计分项目或输入名称以预览。 |
| scripts/ui-holograms.js | 312 | §cAdd at least one line of text first. | §c请先输入至少一行文本。 |
| scripts/ui-holograms.js | 654 | §cEnter an ID for the new objective. | §c请输入新计分项目的ID。 |
| scripts/ui-holograms.js | 669 | §cChoose an objective first. | §c请先选择计分项目。 |
| scripts/ui-holograms.js | 551 | §7(preview unavailable) | §7（无法预览） |
| scripts/ui-holograms.js | 548 | §7(no entries yet) | §7（尚无条目） |
| scripts/ui-holograms.js | 243 | §7No lines set | §7尚未设置文本行 |
| scripts/ui-kits.js | 1428 | §cThis kit contains ${total}/${LIMITS.MAX_KIT_ITEM_AMOUNT} items. Please reduce total to save. | §c礼包物品总数为 ${total}/${LIMITS.MAX_KIT_ITEM_AMOUNT}，请减少数量后保存。 |
| scripts/ui-kits.js | 1772 | §cCouldn't save changes to "${name}". Storage may be full (check chat for a storage warning). | §c无法保存“${name}”的修改。存储空间可能已满，请检查聊天中的存储警告。 |
| scripts/ui-kits.js | 1171 | §cKit total is ${total}/${LIMITS.MAX_KIT_ITEM_AMOUNT} items. Reduce to save. | §c礼包物品总数为 ${total}/${LIMITS.MAX_KIT_ITEM_AMOUNT}，请减少数量后保存。 |
| scripts/ui-kits.js | 1421 | §cEnter a whole number of 1 or more for: §f${badNames.join(", ")}§c. | §c请为以下物品输入不小于1的整数：§f${badNames.join(", ")}§c。 |
| scripts/ui-kits.js | 1444 | §cThat cooldown isn't valid. Use values like 30m, 6h, 1d, or 1d6h. | §c冷却时间无效，请使用 30m、6h、1d 或 1d6h 等格式。 |
| scripts/ui-kits.js | 1724 | §cThat cooldown isn't valid. Use values like 30m, 6h, 1d, or 1d6h. | §c冷却时间无效，请使用 30m、6h、1d 或 1d6h 等格式。 |
| scripts/ui-kits.js | 1164 | §cEnter a whole number of 1 or more for: §f${bad.join(", ")}§c. | §c请为以下物品输入不小于1的整数：§f${bad.join(", ")}§c。 |
| scripts/ui-kits.js | 1452 | §cMax claims must be a whole number (blank or 0 = unlimited). | §c最多领取次数必须为整数（留空或0表示不限）。 |
| scripts/ui-kits.js | 1732 | §cMax claims must be a whole number (blank or 0 = unlimited). | §c最多领取次数必须为整数（留空或0表示不限）。 |
| scripts/ui-kits.js | 1403 | §cA kit named "${typed}" already exists. | §c名为“${typed}”的礼包已存在。 |
| scripts/ui-kits.js | 873 | §cNo known player matching "${typed}". | §c找不到与“${typed}”匹配的已记录玩家。 |
| scripts/ui-kits.js | 1411 | §cPick at least one item for the kit. | §c请为礼包选择至少一种物品。 |
| scripts/ui-kits.js | 1399 | §cEnter a kit name. | §c请输入礼包名称。 |
| scripts/ui-player.js | 517 | §cPlease enter a longer description (at least 3 characters). | §c请补充描述，至少输入3个字符。 |
| scripts/ui-player.js | 387 | §cYour appeal is too short. Please add a little more. | §c申诉内容过短，请补充说明。 |
| scripts/ui-tickets.js | 377 | §9[Ticket ${ticketId}] Reply from ${player.name}: §r${note} | §9[工单 ${ticketId}] ${player.name} 的回复：§r${note} |
| scripts/ui-tickets.js | 290 | §cSomething went wrong: ${e?.message ?? "Unknown error."} | §c操作失败：${e?.message ?? "未知错误。"} |
| scripts/ui-tickets.js | 443 | §cSomething went wrong: ${e?.message ?? "Unknown error."} | §c操作失败：${e?.message ?? "未知错误。"} |
| scripts/ui-tickets.js | 361 | §cYour reply is too short. Please add a little more. | §c回复内容过短，请补充说明。 |
| scripts/ui-tickets.js | 280 | §cPlease enter a resolution note. | §c请输入处理说明。 |
| scripts/ui-tickets.js | 367 | §cTicket not found. | §c找不到该工单。 |

## 历史服务器端补充翻译

最终审查后继续修正了111处真实用户可见的服务器端文案：main.js 89处（自定义命令说明与结果、登录断开原因、领地默认文本片段），storage.js 2处（默认领地进入/退出模板），moderation.js 12处（封禁、解封、冻结与离线通知），permissions.js 8处（权限错误）。只修改文案，不修改实际命令、参数、角色判断或授权逻辑。已有玩家自定义领地消息不会被覆盖。权限错误中的操作标识继续保留，方便排查。

此处历史统计不包含注释修改。2.5.1已进一步翻译管理日志动作与多处详情、技术支持和诊断的说明文案；品牌、物品ID、实际命令、异常原文及用户自定义内容仍保留。历史详情字符串不会自动重写，具体边界以现行 [LOCALIZATION.md](LOCALIZATION.md) 为准。

| 文件 | 当前行 | 原文 | 中文 |
| --- | ---: | --- | --- |
| scripts/main.js | 211 | Transfer Admin Tools ownership to another player | 将 Admin Tools 服主身份转让给另一名玩家 |
| scripts/main.js | 217 | Must be run by a player. | 必须由玩家执行。 |
| scripts/main.js | 281 | Must be run by a player. | 必须由玩家执行。 |
| scripts/main.js | 309 | Must be run by a player. | 必须由玩家执行。 |
| scripts/main.js | 349 | Must be run by a player. | 必须由玩家执行。 |
| scripts/main.js | 379 | Must be run by a player. | 必须由玩家执行。 |
| scripts/main.js | 422 | Must be run by a player. | 必须由玩家执行。 |
| scripts/main.js | 452 | Must be run by a player. | 必须由玩家执行。 |
| scripts/main.js | 483 | Must be run by a player. | 必须由玩家执行。 |
| scripts/main.js | 514 | Must be run by a player. | 必须由玩家执行。 |
| scripts/main.js | 544 | Must be run by a player. | 必须由玩家执行。 |
| scripts/main.js | 574 | Must be run by a player. | 必须由玩家执行。 |
| scripts/main.js | 604 | Must be run by a player. | 必须由玩家执行。 |
| scripts/main.js | 636 | Must be run by a player. | 必须由玩家执行。 |
| scripts/main.js | 666 | Must be run by a player. | 必须由玩家执行。 |
| scripts/main.js | 804 | Must be run by a player. | 必须由玩家执行。 |
| scripts/main.js | 219 | §cNot authorized. | §c您没有执行此操作的权限。 |
| scripts/main.js | 283 | §cNot authorized. | §c您没有执行此操作的权限。 |
| scripts/main.js | 311 | §cNot authorized. | §c您没有执行此操作的权限。 |
| scripts/main.js | 351 | §cNot authorized. | §c您没有执行此操作的权限。 |
| scripts/main.js | 381 | §cNot authorized. | §c您没有执行此操作的权限。 |
| scripts/main.js | 426 | §cNot authorized. | §c您没有执行此操作的权限。 |
| scripts/main.js | 456 | §cNot authorized. | §c您没有执行此操作的权限。 |
| scripts/main.js | 487 | §cNot authorized. | §c您没有执行此操作的权限。 |
| scripts/main.js | 518 | §cNot authorized. | §c您没有执行此操作的权限。 |
| scripts/main.js | 548 | §cNot authorized. | §c您没有执行此操作的权限。 |
| scripts/main.js | 578 | §cNot authorized. | §c您没有执行此操作的权限。 |
| scripts/main.js | 608 | §cNot authorized. | §c您没有执行此操作的权限。 |
| scripts/main.js | 640 | §cNot authorized. | §c您没有执行此操作的权限。 |
| scripts/main.js | 668 | §cNot authorized. | §c您没有执行此操作的权限。 |
| scripts/main.js | 706 | §cNot authorized. | §c您没有执行此操作的权限。 |
| scripts/main.js | 806 | §cNot authorized. | §c您没有执行此操作的权限。 |
| scripts/main.js | 221 | No player specified. | 未指定玩家。 |
| scripts/main.js | 224 | Select exactly one player. | 请选择且仅选择一名玩家。 |
| scripts/main.js | 314 | Select exactly one player. | 请选择且仅选择一名玩家。 |
| scripts/main.js | 354 | Select exactly one player. | 请选择且仅选择一名玩家。 |
| scripts/main.js | 430 | Select exactly one player. | 请选择且仅选择一名玩家。 |
| scripts/main.js | 460 | Select exactly one player. | 请选择且仅选择一名玩家。 |
| scripts/main.js | 491 | Select exactly one player. | 请选择且仅选择一名玩家。 |
| scripts/main.js | 522 | Select exactly one player. | 请选择且仅选择一名玩家。 |
| scripts/main.js | 552 | Select exactly one player. | 请选择且仅选择一名玩家。 |
| scripts/main.js | 582 | Select exactly one player. | 请选择且仅选择一名玩家。 |
| scripts/main.js | 612 | Select exactly one player. | 请选择且仅选择一名玩家。 |
| scripts/main.js | 259 | Ownership transferred to ${targetName}. | 已将服主身份转让给 ${targetName}。 |
| scripts/main.js | 276 | Clear the Admin Tools owner so the next admin reclaims it | 清除 Admin Tools 服主身份，由下一位管理员重新认领 |
| scripts/main.js | 296 | Owner reset. | 服主身份已重置。 |
| scripts/main.js | 303 | Force-unfreeze a player (bypasses staff checks) | 强制解除玩家冻结（跳过管理角色检查） |
| scripts/main.js | 335 | Force-unfroze ${target.name}. | 已强制解除 ${target.name} 的冻结。 |
| scripts/main.js | 343 | Remove moderator role from a player (bypasses staff checks) | 移除玩家的协管员身份（跳过管理角色检查） |
| scripts/main.js | 366 | Removed moderator from ${target.name}. | 已移除 ${target.name} 的协管员身份。 |
| scripts/main.js | 374 | Force whitelist mode OFF (keeps the whitelisted-player list intact) | 强制关闭白名单模式（保留白名单玩家列表） |
| scripts/main.js | 406 | Whitelist mode reset to OFF (whitelist database kept). | 白名单模式已关闭，白名单玩家列表已保留。 |
| scripts/main.js | 416 | Freeze a player in place | 将玩家冻结在原地 |
| scripts/main.js | 439 | Froze ${target.name}. | 已冻结 ${target.name}。 |
| scripts/main.js | 303 | Unfreeze a frozen player | 解除玩家冻结 |
| scripts/main.js | 469 | Unfroze ${target.name}. | 已解除 ${target.name} 的冻结。 |
| scripts/main.js | 476 | Issue a warning to a player | 向玩家发出警告 |
| scripts/main.js | 492 | No reason given | 未提供原因 |
| scripts/main.js | 501 | Warned ${target.name}. | 已向 ${target.name} 发出警告。 |
| scripts/main.js | 508 | Restore a player's health | 恢复玩家的生命值 |
| scripts/main.js | 531 | Healed ${target.name}. | 已恢复 ${target.name} 的生命值。 |
| scripts/main.js | 538 | Restore a player's hunger | 恢复玩家的饥饿值 |
| scripts/main.js | 561 | Fed ${target.name}. | 已恢复 ${target.name} 的饥饿值。 |
| scripts/main.js | 568 | Teleport a player to you | 将玩家传送到您身边 |
| scripts/main.js | 591 | Summoned ${target.name}. | 已将 ${target.name} 传送到您身边。 |
| scripts/main.js | 598 | Start or stop spying on a player via the spy cam | 通过观察视角开始或停止监视玩家 |
| scripts/main.js | 614 | §cYou cannot spy on yourself. | §c不能监视自己。 |
| scripts/main.js | 624 | Spying on ${target.name}. | 正在监视 ${target.name}。 |
| scripts/main.js | 631 | Stop your active spy session | 停止当前监视会话 |
| scripts/main.js | 661 | Toggle server lock on/off | 开启或关闭服务器锁定 |
| scripts/main.js | 688 | Server lock toggled. | 已切换服务器锁定状态。 |
| scripts/main.js | 695 | Add or remove a mob type from the claim mob whitelist | 在领地生物白名单中添加或移除生物类型 |
| scripts/main.js | 715 | §cUsage: /jm_at:mobwhitelist <add\|remove\|list> [entity_type_id] | §c用法：/jm_at:mobwhitelist <add\|remove\|list> [entity_type_id] |
| scripts/main.js | 734 | Listed mob whitelist. | 已列出生物白名单。 |
| scripts/main.js | 741 | §cInvalid type ID. Must include namespace (e.g. minecraft:happy_ghast). | §c类型ID无效，必须包含命名空间（例如 minecraft:happy_ghast）。 |
| scripts/main.js | 792 | Mob whitelist updated. | 生物白名单已更新。 |
| scripts/main.js | 799 | Toggle whitelist mode on/off | 开启或关闭白名单模式 |
| scripts/main.js | 826 | Whitelist toggled. | 已切换白名单模式。 |
| scripts/main.js | 1276 | Server is locked. | 服务器已锁定。 |
| scripts/main.js | 1283 | Not whitelisted. | 您不在白名单中。 |
| scripts/main.js | 1356 | until ${fmtMs(ban.expiresAt)} | 至 ${fmtMs(ban.expiresAt)} |
| scripts/main.js | 1406 | until ${fmtMs(lp.expiresAt)} | 至 ${fmtMs(lp.expiresAt)} |
| scripts/main.js | 1356 | : "permanently"; | : "永久"; |
| scripts/main.js | 1406 | : "permanently"; | : "永久"; |
| scripts/main.js | 1385 | Banned ${expStr}. Reason: ${ban.reason} | 您已被封禁，期限：${expStr}。原因：${ban.reason} |
| scripts/main.js | 1434 | Banned ${expStr}. Reason: ${lp.reason} | 您已被封禁，期限：${expStr}。原因：${lp.reason} |
| scripts/main.js | 3993 | claim.isAdminClaim ? "Admin" : claim.ownerName | claim.isAdminClaim ? "管理员" : claim.ownerName |
| scripts/main.js | 3994 | claim.isAdminClaim ? "Admin Claim" : `${claim.ownerName}'s claim` | claim.isAdminClaim ? "管理员领地" : `${claim.ownerName}的领地` |
| scripts/main.js | 4003 |  §c\| Building restricted — shulkers will burst if placed |  §c\| 禁止建造：放置的潜影盒会被破坏 |
| scripts/storage.js | 21 | §eEntered {owner}§r{restricted} | §e进入 {owner}§r{restricted} |
| scripts/storage.js | 22 | §2Returned to un-claimed land. | §2已返回无主土地。 |
| scripts/moderation.js | 87 | Frozen by ${staffLabel} | 由${staffLabel === "moderator" ? "协管员" : "管理员"}冻结 |
| scripts/moderation.js | 223 | ` for ${fmtDuration(durationMs)}` | `，时长 ${fmtDuration(durationMs)}` |
| scripts/moderation.js | 378 | ` for ${fmtDuration(durationMs)}` | `，时长 ${fmtDuration(durationMs)}` |
| scripts/moderation.js | 223 | " permanently" | "（永久）" |
| scripts/moderation.js | 378 | " permanently" | "（永久）" |
| scripts/moderation.js | 239 | kick @s Banned${expStr}: ${safeBanReason} | kick @s 您已被封禁${expStr}，原因：${safeBanReason} |
| scripts/moderation.js | 280 | §c[Warn Alert] §g${target.name}§r now has §c${count}§r active warning(s) (threshold is ${thresh}). | §c[警告提醒] §g${target.name}§r 当前有 §c${count}§r 条有效警告（阈值为 ${thresh}）。 |
| scripts/moderation.js | 331 | ${entry.name} not found in player registry. | 在玩家记录中找不到 ${entry.name}。 |
| scripts/moderation.js | 376 | ${entry.name} not found in player registry. | 在玩家记录中找不到 ${entry.name}。 |
| scripts/moderation.js | 334 | §2[Unban] Your ban has been lifted. | §2[解除封禁] 您的封禁已解除。 |
| scripts/moderation.js | 347 | Cannot ban the server owner. | 不能封禁服主。 |
| scripts/moderation.js | 387 | §cYou have been banned${expStr}.\n§rReason: §r${reason} | §c您已被封禁${expStr}。\n§r原因：§r${reason} |
| scripts/permissions.js | 150 | Not authorized: ${action} | 您没有执行此操作的权限。（操作标识：${action}） |
| scripts/permissions.js | 200 | Not authorized: ${action} | 您没有执行此操作的权限。（操作标识：${action}） |
| scripts/permissions.js | 211 | Not authorized: ${action} | 您没有执行此操作的权限。（操作标识：${action}） |
| scripts/permissions.js | 218 | Not authorized: ${action} | 您没有执行此操作的权限。（操作标识：${action}） |
| scripts/permissions.js | 224 | Not authorized: ${action} | 您没有执行此操作的权限。（操作标识：${action}） |
| scripts/permissions.js | 298 | Cannot ${action} the server owner. | 不能对服主执行此操作。（操作标识：${action}） |
| scripts/permissions.js | 315 | Not authorized: a moderator cannot ${action} a higher-ranked staff member. | 协管员不能对更高权限的管理成员执行此操作。（操作标识：${action}） |
| scripts/permissions.js | 330 | Not authorized: a moderator cannot ${action} a higher-ranked staff member. | 协管员不能对更高权限的管理成员执行此操作。（操作标识：${action}） |
