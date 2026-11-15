# 参与开发

- 维护者姓名：相安
- 维护者邮箱：3199912548@qq.com

先阅读 [来源记录](NOTICE.md)、[授权状态](LICENSE.md) 和 [项目协作规则](AGENTS.md)。原作署名与权利状态必须保留。

## 环境与日常检查

使用Node.js 22+、npm、Python 3.11+。Windows在PowerShell中进入仓库根目录执行；Ubuntu需使 `python` 指向Python 3。

```powershell
npm ci --ignore-scripts
npm run check
npm run build
```

安装使用锁文件并禁用依赖生命周期脚本；构建只用Python标准库。CI在Windows与Ubuntu上使用Node.js 22 / Python 3.12。详细模块与命令见 [开发说明](docs/DEVELOPMENT.md)。

## 修改边界

- 不擅自更换BP/RP UUID、`jm_at` 命名空间或原存档字段；新增数据需提供兼容与恢复说明。
- 规则算法保持可模拟测试；物品失败退款保留实际物品栈元数据，家园传送统一通过 `visitHome`。
- 新提示沿用语言键和RawMessage约定；UTF-8、LF、占位符和格式码要求见 [本地化规范](docs/LOCALIZATION.md)。
- 文档、示例、测试与行为同步；不做无关重构，不将模拟检查写成游戏实测。
- 不提交 `upstream/`、`dist/`、`node_modules/`、个人世界、密钥、服务器配置或开发日志。

## Git与发布

先检查当前分支和已有改动；新分支默认使用 `main/主题`，不要为了套用流程切换正在工作的分支。使用Conventional Commits，例如 `fix(recipe): 修正玩家工具材料`。显式暂存本轮文件，避免将无关内容一起提交。

每轮实际修改，包括文档和工程配置，都要递增版本、更新CHANGELOG与相关文档，运行适用检查，再提交、推送标签并发布Release。常规维护使用：

```powershell
npm version patch --no-git-tag-version
```

版本生命周期自动同步派生位置。`CHANGELOG.md` 保留Unreleased节，发布条目写实际发布日；原本地交付历史不伪装为远程Release。完整步骤见 [发布指南](docs/GITHUB_RELEASE.md)。

有协作评审时通过PR说明问题、最终行为、验证和存档影响，满足仓库实际保护规则后合并。游戏行为修改按 [验收清单](docs/TESTING.md) 记录精确Minecraft版本、操作及观察；尚未实测必须明确标注。
