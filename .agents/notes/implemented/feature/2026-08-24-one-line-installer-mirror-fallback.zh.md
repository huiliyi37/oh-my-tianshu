# Agent Note: 带镜像窗口回退的一行安装器

Status: implemented

[English](2026-08-24-one-line-installer-mirror-fallback.md) | 中文

## 问题

0.4.0 发布后,配置了 npmmirror 的机器安装报 `ETARGET: No matching version found for @huiliyi37/dsh-llm@0.4.0`:镜像按包各自同步,「入口包已到、依赖未跟齐」的窗口里普通 `npm i -g` 无法解析。解析发生在任何生命周期脚本运行之前,包侧没有钩子可以拦截重试——官方 registry 完整且发布时逐包核验过,但 npm 问的是用户配置的源。

## Decision

提供引导安装器(`scripts/install.sh` POSIX、`scripts/install.ps1` Windows),并作为 README 推荐安装方式。先用用户配置的源安装;失败则恰好重试一次 `--registry=https://registry.npmjs.org`(官方源永远持有完整发布)。npm ≥ 11 才传 `--allow-scripts` 清单(旧版 npm 不识别该 flag 且默认执行脚本);缺 Node/npm 时给出可操作的提示。手动 `npm i -g` 路径在旁保留。

## Alternatives considered

- **放宽依赖版本范围,让滞后镜像解析到上一版。** 否决:整个工作区是同版本基线;0.4.0 入口下混 0.3.0 依赖正是基线要防止的状态。
- **从 `preinstall` 脚本重试。** 否决:解析期的 `ETARGET` 在本包任何脚本上机之前就已失败。
- **最后发布入口包/延后切 `latest`。** 否决:镜像同步顺序不由我们控制,而为一家镜像的延迟惩罚所有源不值得。

## Consequences

镜像窗口期的安装在引导层自愈,不再变成支持工单;代价是推荐入口从裸 npm 变为管道脚本,因此手动命令在旁保留,且脚本只含重试逻辑——不锁版本、除了这一次安装不改任何环境。

## Testing

真实 e2e:`NPM_CONFIG_REGISTRY=https://registry.npmmirror.com` 加临时 prefix,首次尝试复现了用户报告的同一条 `ETARGET`,回退路径从官方源装齐 619 个包,装出的 `oh-my-tianshu --version` 输出 `0.4.0`。
