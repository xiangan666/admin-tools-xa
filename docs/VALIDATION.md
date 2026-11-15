# 本轮验证记录

日期：2026-11-15（Asia/Shanghai）。版本：**2.5.3**；整理前基线为2.5.2。本轮只调整工程、版本与文档，未修改配方和业务规则，未部署到运行中的服务器。

## 环境与实际检查

本地为Windows / PowerShell、Node.js v26.13.1、npm 11.20.0、Python 3.14.6。开发依赖保持 `@minecraft/server` 2.8.0、`@minecraft/server-ui` 2.1.0、acorn 8.15.0；锁文件的下载源改为npm官方仓库，版本及完整性摘要保留。

| 检查 | 实际结果 |
| --- | --- |
| 整理前 `npm run check` | 退出码0；原有133项Node测试通过。 |
| `npm ci --ignore-scripts` | 退出码0；从锁文件安装5个开发依赖包。 |
| 整理后 `npm run check` | 退出码0；143项Node测试与2项Python构建测试全部通过，无失败、取消或跳过。 |
| 版本派生检查 | package/lockfile、BP/RP名称、header/module/互相依赖、游戏内VER、README入口均同步为2.5.3。 |
| 脚本与JSON | 72个模块、380个本地导入通过，外部命名导出与已安装API声明核对；包内JSON可解析。 |
| 语言与编码 | en_US/zh_CN各3163键；190个UTF-8发货文本、72个脚本、2898个静态翻译引用通过；静态中文回归通过。 |
| 文档 | 21份Markdown严格UTF-8解码与本地链接目标检查通过；外部链接不以本地检查冒充联网可用性。 |
| 新增工程回归 | 3项版本测试、7项发布测试、2项Python构建测试通过；发布测试不连接真实GitHub。 |
| GitHub工作流静态检查 | 通过已校验下载摘要的actionlint v1.7.12校验，退出码0；未安装的shellcheck/pyflakes不计为已执行。 |
| npm官方审计 | `npm audit --omit=optional --audit-level=moderate --registry=https://registry.npmjs.org --json` 退出码0，报告已知漏洞0。 |
| `npm run build` | 退出码0；安装包375个文件，2,527,525字节。ZIP CRC、条目清单与逐文件内容校验通过。 |
| 构建可重复性 | Python测试对相同夹具连续构建得到相同资产大小及SHA-256；结论限同源字节和同Python/zlib环境。 |
| 与整理前源文件核对 | 除两个manifest和constants.js的版本更新外，发货源内容仅统一LF换行；保留包UUID、最低引擎版本、Script API依赖与3原木配方。 |

本地安装包 `dist/Admin-Tools-XA-2.5.3.mcaddon` 的SHA-256：

```text
1be4b2d1c4b0798c10066d22c79548ae86828c295ef18a42a0506df718a30eff
```

发行归档包含同一安装包、安装说明、文档与授权记录；两份成品的最终大小及摘要由构建输出和 `dist/SHA256SUMS.txt` 记录。构建不会将开发测试、Git信息、node_modules、世界存档或本地日志放入 `.mcaddon`。

本地检查日志为 `dist/check-2.5.3.log`。产物与日志均为忽略文件，不随源码提交；GitHub发布从标签提交重新构建，远程资产的最终摘要以Release中的 `SHA256SUMS.txt` 为准。不同Python/zlib版本不承诺压缩字节相同。

## GitHub检查与发布证据

公开仓库为 [xiangan666/admin-tools-xa](https://github.com/xiangan666/admin-tools-xa)。Windows/Ubuntu检查、标签候选提交和发布流程的远程运行结果见 [Actions](https://github.com/xiangan666/admin-tools-xa/actions)，正式分发结果见 [v2.5.3 Release](https://github.com/xiangan666/admin-tools-xa/releases/tag/v2.5.3)。这些入口的实时结果应在交付时核实；本地构建本身不代表已经正式发布。

发布工具在草稿阶段核对GitHub返回的三份资产大小与SHA-256，正式发布后复核标签、非草稿/非预发布状态及最新稳定标记。完整操作与中断恢复见 [发布指南](GITHUB_RELEASE.md)。

## 尚未执行的游戏验证

本轮未启动或操作Minecraft客户端，未执行3个同种/混合原木实际合成、材料边界、旧配方失效、HUD显示、多人联机、存档重启及成就状态实测。自动测试使用模拟Minecraft对象与实际业务函数，静态配方和成品核验不能替代游戏验收。

2026-11-14服务端重启后，已在当时的新 `Pack Stack` 日志中确认2.5.2被加载；这是历史运行证据，不表示本轮2.5.3已经部署。完整时间线见 [服务器升级与排查](SERVER_UPGRADE.md)，实际游戏验收见 [测试清单](TESTING.md)。

- 维护者姓名：相安
- 维护者邮箱：3199912548@qq.com
