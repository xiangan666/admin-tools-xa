# 开发与数据设计

## 基线与兼容

完整来源记录见 `UPSTREAM.json`。本版基于文件 8470997，不混用正式版 2.2.0。保持原 BP/RP UUID、资源及物品命名空间，当前包版本由 `package.json` 统一派生，使用 `npm version patch --no-git-tag-version` 同步。新增属性使用 `jm_at:xa_*` / `jm_at:travel_cd_*` 前缀。维护作者：相安（3199912548@qq.com）。

## 玩家工具配方

`packs/AdminTools BP/recipes/ticket_menu_recipe.json` 使用 `minecraft:recipe_shapeless`，以3个独立的 `{ "tag": "minecraft:logs" }` 材料条目合成1个 `jm_at:ticket_menu`。每个材料槽分别按原木标签匹配，因此不限制树种，也支持不同种类混用；实际可用物品集合由当前游戏版本的 `minecraft:logs` 标签决定。保留原配方标识、工作台标签及始终解锁配置。

修改配方时同时更新资源包各语言的 `jm_at.infoa.recipes_body` 和 `jm_at.infop.recipes_body_1`；两处分别用于管理员和玩家信息页。本次同步全部11种语言，保留原语言键及占位符。

## 模块职责

| 模块 | 职责 |
| --- | --- |
| `home-record.js` | 坐标更新合并与目的地身份，拒绝危险名称。 |
| `travel-rules.js` | 无游戏依赖的规则验证、游戏时间换算、冷却键、物品栈事务。 |
| `travel-service.js` | 条件确认、统一等待、重新校验、扣费与真实传送结果、冷却持久化。 |
| `travel-feedback.js` | 等待开始的聊天、即时标题、副标题和动作栏；共享倒计时更新与结束清理，兼容字符串和本地化消息目的地。 |
| `screen-feedback.js` | 本模组标题写入与限时礼包提示；按玩家取消旧清理任务，离线释放，避免旧回调抹掉新标题。 |
| `log-labels.js` | 157种日志动作及存储区域的显示语言键；原动作代码和过滤值保持不变。 |
| `search-display.js` | 搜索结果标题和上级菜单的RawMessage显示，保留真实匹配词和跳转标识；不向纯搜索引擎引入游戏API依赖。 |
| `ui-travel-rules.js` | 从当前背包选择收费类型并配置规则。 |
| `home-access-core.js` | 无游戏依赖的授权时效、次数与家园世代校验。 |
| `home-access.js` | 目录、在线/离线家园读取、持久申请和授权、房主身份校验。 |
| `ui-home-access.js` | 角色目录、详情、申请、审批、授权管理；提供统一 `visitHome` 入口。 |
| `home-policy-core.js` / `home-policy.js` | 服务器策略验证与持久化；输出独立的服务器层和房主层，按开关过滤，不覆盖房主规则。 |
| `ui-home-policy.js` | 管理员可用的家园附加规则、床传送/功能开关与税率配置。 |
| `home-admin.js` / `ui-home-admin.js` | 管理员逐玩家家园设置服务及统一管理菜单；提交时重查管理员与家园世代。 |
| `homes.js` | 在线真实记录、离线镜像、离线管理修改队列及登录合并。 |
| `home-revenue-core.js` / `home-revenue.js` | 税额余数、收益预留/提交/取消、持久物品余额及安全领取。 |
| `ui-home-revenue.js` | 当前房主的收益查看和领取页面。 |
| `players.js` | 上游坐骑/鹦鹉传送包装；扩展真正移动前后的事务钩子及结果。 |

`ui-player.js` 的自己家园、公共传送点入口和 `ui-admin.js` 的在线/离线家园入口使用统一规则服务。`moderation.js` 的“发送玩家到传送点”也检查被传送者规则。原普通坐标传送不自动猜测坐标是否等于某个家园，仍属于独立管理功能。

## 家园、传送点结构

```json
{
  "x": 100,
  "y": 64,
  "z": -20,
  "dimension": "minecraft:overworld",
  "destinationId": "XAH_unique_generation",
  "teleportEnabled": true,
  "rules": {
    "cooldownSeconds": 60,
    "cost": { "typeId": "minecraft:emerald", "amount": 2 },
    "timeWindow": { "enabled": true, "start": "22:00", "end": "06:00" }
  }
}
```

旧记录缺少 `rules` 时等价于无冷却、免费、全天；旧记录的世代为 `legacy`。更新旧记录时继续保留此身份，使既有授权不因第一次移动家园而失效。新建、删除再建时分配新的 `destinationId`。冷却身份还包含种类、房主、名称，因此多个旧家园不会共享冷却。

家园的 `teleportEnabled` 缺省为允许；管理员设置为 `false` 后，房主与访客都被阻止，规则总开关不跳过此权限。此字段不用于公共传送点。坐标覆盖沿用原记录，因此会保留该字段。

家园仍使用原玩家动态属性 `jm_at:homes` 及世界镜像 `jm_at:phomes_<id>`，传送点仍使用原 `jm_at:warps`，避免创建两份业务数据源。规则修改重读最新记录后局部合并，不覆盖坐标、图标或其他字段。

离线家园删除队列另用 `jm_at:xa_home_deletes_<id>` 保存 `{name,generation}`。提交删除时重新判断房主在线状态；上线则直接修改其最新真实记录；仍离线才写入队列。登录应用队列时核对世代，避免误删后来重建的同名家园，同时兼容上游遗留的按名称队列。

管理员离线修改用 `jm_at:xa_home_edits_<id>` 保存 `{name,generation,patch}`，patch 只允许 `rules` 和 `teleportEnabled`。离线队列单次写入是该修改的权威记录，`getHomes`/`getOfflineHomes` 立即叠加匹配世代的修改；不依赖可能被旧玩家属性覆盖的镜像写入。初次上线在快照前调用 `applyPendingHomeEdits` 合并至真实属性并清理队列。写入失败保留队列；无效存档不会被当作空记录写回。队列最多160个目的地，仍受动态属性容量约束。

## 时间语义

游戏时刻分钟数：`((ticks / 1000 * 60) + 360) % 1440`，先归一化至 0–23999 刻。普通区间采用 `start <= now < end`；跨午夜采用 `now >= start || now < end`；同起止为全天。

冷却记录实际成功的现实毫秒时间戳，而不是游戏刻。每玩家的动态属性按目的地全键派生短属性名，内容保留全键以检测哈希冲突。更改规则不会把失败尝试计入冷却。

## 服务器与房主双层规则

`jm_at:xa_home_policy` 保存服务器策略。默认总开关和冷却/收费/时段功能均启用、税率30%、服务器附加规则为无冷却/免费/全天，因此未配置服务器附加条件时，原房主规则继续生效。

解析策略得到独立的 `{server, owner}` 两层规则，而不是合成一个替代房主值的规则。传送先按服务器层检查，再按房主层检查；时间要求都满足，冷却分别用各自秒数检查同一成功时间。同类型的两层费用需要合计库存，不能用同一批物品分别通过两次独立检查。不同类型分别足额校验。总开关或某功能开关关闭时，跳过相应两层规则，保留原房主存量配置；访问授权继续检查。

策略保存以真实 `Player` 的 `isAdmin(actor).ok` 校验，包含服主、排除仅有协管员角色的玩家。表单提交和逐家园保存时重查权限，撤销管理员后旧表单不能继续写入。`bedTeleportEnabled` 缺省为 `true`，独立于 `enabled` 和三项功能开关；床传送在入口、坐骑确认后、等待中及实际移动 tick 重新检查。公共传送点不解析家园策略。

## 房主收益账本

只对房主层费用创建收益事务；服务器附加费用独立消耗。税率为0–100整数，按房主与物品类型累计百分之一税额余数：`tax = floor((gross * percent + carry) / 100)`，`carry = (gross * percent + carry) % 100`。失败不更新余数，修改税率不追溯重算已完成结算。

实际扣费后、真实移动前准备不可领取的收益预留；确认传送成功才提交净收入，失败取消预留并退款。余额与累计毛收入、税额、净收入、已领取情况使用世界动态属性保存，房主离线也可收款。领取身份从当前玩家对象获取，账本先保存扣减后再放入背包，背包满保留余额，不掉地；失败和不确定结果使用保守防重保护。

收益不把任意物品仅按类型ID重建。序列化支持经安全检查的可恢复物品数据，对无法可靠往返的特殊载荷拒绝结算，正常失败路径退回原栈。支持范围及操作说明见 [家园收益说明](HOME_REVENUE.md)。

## 授权与持久化

世界属性 `jm_at:xa_home_access_<ownerId>` 保存版本、授权列表、申请列表。权限绑定房主、家园名称、世代和访客标识。默认管理自己的账本；指定其他房主 ID 时必须通过真实服务端 `Player` 的管理员校验。管理员不会自动获得访问权，但可以明确授予自己或他人。新授权记录 `grantedById/grantedByName`，旧记录仍兼容。提交授予/撤销时校验预期世代，避免旧表单修改重建家园。

一次同意固定一次；永久/临时权限的 `remainingUses: null` 表示不限；0 表示已用尽。临时授权从审批瞬间开始计时。每房主最多 160 个有效授权、80 条有效申请，单访客对一房主最多 10 条申请，超额明确拒绝；实际动态属性容量仍可能先达到上游限制。

## 交易边界与异常

等待提示由 `travel-feedback.js` 提供，接入 `travel-service.js`、`ui-player.js` 的共用延时助手及 `tpa.js`。开始立即提醒，动作栏每5刻刷新，标题仅在剩余整数秒变化时更新（显示时长30刻，避免秒间空白）；移动检测仍每刻执行，阈值保留为0.5格，换维度也取消。各HUD调用独立保护，某个显示API失败不妨碍其他提示和业务流程。结束先清空动作栏/倒计时，再显示取消或成功结果，不用下一次循环抹掉结果。TPA两方均显示提示，且真正移动成功后才发送到达通知。0秒延时跳过等待提示。

家园和传送点的条件确认窗显示当前游戏时刻、授权状态、每层时段/冷却和费用库存；取消不启动交易。确认后、倒计时后及真实移动前都会重新验证。传送前后钩子紧邻真实 `player.teleport`；骑乘时即使延迟一刻，仍在实际移动所在 tick 重查规则与授权。费用以克隆的原栈托管，失败同步退款；成功后才记录冷却与次数。所有收费按 `typeId` 匹配，退款保留实际被扣物品的元数据。

Minecraft 动态属性不是数据库事务：引擎已成功移动后，持久写入仍可能失败。实现会告警，并对冷却保留会话内记录；授权次数写入异常通过会话内保护避免继续重复使用。收益和领取也有预留、防重及失败保护，异常退出留下的待核对记录不会自动转为可领取收益。在保存设备损坏、进程崩溃、其他模组并发篡改背包等极端情况，不宣称跨引擎和存储绝对原子性。不要把内存模拟测试等同于实际游戏验证。

## 开发命令

`npm run validate` 检查 JavaScript 语法、相对导入导出、JSON，以及package/lockfile、BP/RP header/module、互相依赖与界面版本；同时运行语言完整性、编码/格式及静态中文回归检查。`npm test` 执行自动测试；`npm run check` 执行上述校验与测试；`npm run build` 用 Python 标准库按稳定顺序/时间戳打包、逐文件核对内容并生成 SHA-256。测试文件不进入成品。

## 标题反馈的生命周期

`ui-kits.js` 的菜单领取与 `kit-events.js` 的事件发放调用 `showTimedTitle`。默认5刻淡入、30刻停留、10刻淡出，在总时长后再加1刻主动写入空标题和空副标题。计时基于游戏刻，不依赖玩家客户端的自然淡出。每位玩家只保存当前礼包通知的token与任务ID，后续领取替换任务，回调仅在token仍匹配时清理。

所有本模组标题写入统一经过 `setHudTitle`，它先使该玩家旧礼包清理任务失效，再写新标题；后续传送/挂机/领地提示因此不会被旧定时器清掉。`playerLeave` 调用 `releaseTitleFeedback` 释放任务。HUD写入异常不会阻断礼包业务。此保护覆盖本模组接入的写入路径；其他附加包可独立操作同一客户端HUD，实际共存效果仍需游戏验收。

## 语言显示与输入边界

RawMessage兼容表单、聊天和标题使用 `t` / `raw`，不能通过模板、`+`、`String()`或JSON把翻译对象转成普通字符串。DDUI的 `ObservableString`、实体nameTag、计分板显示名与持久通知只接受字符串，使用服务器端中文；用户自定义内容和技术标识保持原值。

时间显示使用中文单位或 `fmtAgoRaw` / `fmtMsRaw` / `fmtDurationRaw` 的客户端语言消息。机器可解析的编辑输入必须用 `fmtDurationExact`，例如礼包冷却和最低游玩时间，继续由 `parseDuration` 解析 `d/h/m/s`，不可用中文显示函数回填输入。诊断逻辑依赖实际API对象而非翻译后的显示文字。

`tools/localization-audit.mjs` 提供可测试的语言检查，`check-locales.mjs` 对全部发货文本严格UTF-8解码、检查语言格式与静态引用；`check-static-chinese.mjs` 只读防止已修复英文回归，不提供自动写入。早期DDUI替换映射位于 `tools/zh-status-translations.json`，它属于历史迁移资料，不能当作当前完整翻译清单。详见 [LOCALIZATION.md](LOCALIZATION.md)。

## 工程命令与版本

Node.js 22+、Python 3.11+；Windows使用PowerShell，Ubuntu需使 `python` 指向Python 3。在仓库根目录执行：

```powershell
npm ci --ignore-scripts
npm run check
npm run build
```

`npm run check` 包括派生版本检查、JavaScript/JSON/API导出检查、语言与静态中文回归、文档编码与本地链接、Node业务/工程测试和Python构建测试。工具不连接运行中的Minecraft世界。

`package.json` 是版本事实源。`npm version patch --no-git-tag-version` 更新清单与锁文件并调用 `tools/version.mjs`；该脚本先规划完整修改，再逐文件原子替换BP/RP名称、header/module/互相依赖、界面版本与README标记区。直接编辑版本后执行 `npm run version:sync`。普通版本分量为0–65535整数；本项目不向Bedrock包写入预发布字符串。

`tools/build.py` 按名称排序，固定ZIP条目时间、权限和压缩参数，并检查CRC和逐字节内容，再替换完整产物。相同源字节和Python/zlib环境下可重复构建；不同压缩库版本的压缩字节不作相同承诺。`dist/` 不跟踪，不包含世界存档或运行配置。正式发布见 [发布指南](GITHUB_RELEASE.md)。
