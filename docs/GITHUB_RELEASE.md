# 版本与GitHub发布

仓库：[xiangan666/admin-tools-xa](https://github.com/xiangan666/admin-tools-xa)，公开可见。维护者姓名：相安；邮箱：3199912548@qq.com。当前版本与下载入口见 [README](../README.md)，实际发布状态以 [GitHub Releases](https://github.com/xiangan666/admin-tools-xa/releases) 和 [Actions](https://github.com/xiangan666/admin-tools-xa/actions) 为准。

保留原作JM_Addons / JM的署名、All Rights Reserved及来源摘要；公开仓库不重新许可上游内容，见 [LICENSE](../LICENSE.md)、[NOTICE](../NOTICE.md)。`package.json` 维持 `private: true` / `UNLICENSED`，分别阻止意外npm发布和记录权利状态，与GitHub仓库可见性是不同概念。

## 版本与资产

版本事实源是 `package.json`。版本采用X.Y.Z；本轮工程整理从2.5.2升为2.5.3。正常缺陷、文档或内部维护递增PATCH；公共功能和兼容性变化按SemVer选择更高等级。Bedrock清单版本仅使用0–65535整数分量。不要改写已发布版本或移动已有标签。

每个Release包含三份资产：

| 资产 | 用途 |
| --- | --- |
| `Admin-Tools-XA-<版本>.mcaddon` | 可直接导入Minecraft的BP/RP，共用原包UUID。 |
| `Admin-Tools-XA-<版本>-distribution.zip` | 同一安装包、安装说明、用户/开发文档、更新历史、原作来源及授权记录。 |
| `SHA256SUMS.txt` | 上述两份成品的SHA-256；只能证明内容一致性，不证明发布者身份。 |

发行归档内部另有安装包摘要。自动源码归档是补充下载，不代替已构建的安装包。开发依赖、测试、世界存档和本地日志不进入 `.mcaddon`。相同输入与相同Python/zlib环境下构建可重复。

## 准备与提交

在仓库根目录使用PowerShell执行：

```powershell
npm ci --ignore-scripts
npm version patch --no-git-tag-version
npm run check
npm run build
```

`npm version` 自动调用版本同步脚本；它同时更新锁文件、两包名称与header/module/互相依赖版本、游戏内VER及README的current-version标记区。直接编辑版本后，可执行 `npm run version:sync`。校验会拒绝派生文件漂移。

更新CHANGELOG的本轮条目、必要文档和真实验证记录；检查完整差异后只暂存本轮文件，提交。使用与项目版本一致的候选提交及 `v<版本>` 标签：

```powershell
# 示例中的版本应替换为 package.json 的实际版本。
git tag -a v2.5.3 -m 'Admin Tools XA 2.5.3'
git push origin HEAD
git push origin v2.5.3
```

原有本地分支为 `master`；不要强制推送或自动覆盖其他开发者的分支。首次整理将既有项目纳入初始提交，2.3.1–2.5.2保留为本地历史说明，不回填不存在的远程标签。

## 自动发布与验证

分支、PR和手动校验执行 `validate.yml`，覆盖Windows与Ubuntu。标签触发 `release.yml`，先复用相同检查，再从标签提交构建并调用 `npm run release`。默认权限为 `contents: read`，仅发布job获得 `contents: write`；第三方Actions固定到经GitHub核实的完整提交SHA。

发布工具只读取当前进程的 `GITHUB_TOKEN`，使用仓库内真实地址与标签；检查干净工作区、本地HEAD和远程标签指向一致。CHANGELOG对应有日期节作为发布说明来源。

随后工具创建或续用草稿，上传缺失资产，核对GitHub返回的文件大小和SHA-256，再正式发布为最新稳定版本。重复运行遇到相同资产会复核并跳过，遇到冲突会失败并保留现场；已正式发布的版本不能补写或替换内容。若仓库启用不可变发布，此顺序同样适用；当前工具不宣称仓库已启用不可变策略或资产证明。

跟进Actions直到检查与发布结束，并复核Release不是草稿/预发布、标签对应候选提交、三份资产齐全。下载成品后可在PowerShell中运行 `Get-FileHash <文件名> -Algorithm SHA256` 与清单核对；本地发布工具报告保存在 `dist/release-result.json`，CI日志也输出同样报告。

## 中断恢复与升级

检查失败时修复后重新验证；尚未正式发布的候选可继续准备，已经正式发布则用新版本修复。网络或权限失败时在Actions重跑失败job，使用现有草稿继续，不删除Release或强移标签以重发同名版本。仅有标签、草稿或本地压缩包都不算完成发布。

维护者确需在本地恢复同一发布时，先确认候选版本、远程标签和完整检查均已通过，并通过现有凭证管理器向当前进程提供 `GITHUB_TOKEN`，再运行相同的 `npm run release`；不要将令牌写进源码、命令示例或日志，不建立第二套发布流程。

发布不自动部署到运行中的Minecraft世界。备份、BP/RP同时更新、专用服务器正常停服重启和回退世界备份的步骤见 [服务器升级指南](SERVER_UPGRADE.md)。自动检查无法证明客户端配方、HUD、多人和成就状态，实际边界见 [验证记录](VALIDATION.md) 与 [游戏清单](TESTING.md)。
