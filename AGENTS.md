# 项目协作规则

- 以最高可行工程质量自主完成任务；先读相关文档、检查 Git 状态并保护已有成果。
- `packs/AdminTools BP/` 为行为包，`packs/AdminTools RP/` 为资源包，业务回归测试位于 `tests/`。
- 维护者：相安 <3199912548@qq.com>。保留 JM_Addons / JM 的原作署名及 `LICENSE.md`、`NOTICE.md`，不得将上游内容重新许可。
- 保留原 BP/RP UUID、`jm_at` 命名空间和动态属性兼容性；规则与授权必须通过统一服务，不增加隐含管理员绕过。
- 新文档使用中文。修改语言资源时遵守 [本地化规范](docs/LOCALIZATION.md)，保持 UTF-8、LF、格式码与占位符。
- 环境：Node.js 22+、Python 3.11+；安装 `npm ci --ignore-scripts`，检查 `npm run check`，构建 `npm run build`。
- 每轮实际修改必须升版、同步 CHANGELOG 和相关文档、验证、提交、推送标签并正式发布 GitHub Release；只读检查不创建空版本。
- 版本事实源为 `package.json`。使用 `npm version patch --no-git-tag-version`（或适当的 minor/major），由生命周期脚本同步包清单、锁文件、界面和 README；禁止移动已发布标签。
- 发布目标为 `origin`（`xiangan666/admin-tools-xa`），流程见 [发布指南](docs/GITHUB_RELEASE.md)。自动检查不等同于 Minecraft 实测，记录真实验证边界。
- 显式暂存本任务文件；不提交 `node_modules/`、`dist/`、`upstream/`、世界存档、密钥或开发机日志。

架构与存储见 [开发说明](docs/DEVELOPMENT.md)，游戏验收见 [测试清单](docs/TESTING.md)，专用服务器操作见 [升级指南](docs/SERVER_UPGRADE.md)。
