# Agent Note: PowerShell 执行器与 pwsh 工具

Status: implemented

[English](2026-08-01-pwsh-tool-and-executor.md) | 中文

## 问题

harness 在每个平台只说一种 shell 方言：`bash`。Windows 主机只能通过 WSL 或 Git-Bash 垫片运行它，而交付的 `dsh-bash-local` 执行器仅限 POSIX（硬编码 `bash`，进程组语义是 POSIX 的）。Windows 路线图——让主机默认 `pwsh`，之后再做 pwsh TUI/GUI 渲染——没有执行基础：既没有 bash 执行器 seam 的 PowerShell 实现，也没有教模型 PowerShell 方言的面向模型工具。bash 工具本身也远大于 Windows 优先画像所需：后台任务、沙箱升级与持久 PTY 孪生都是 bash 形状的表面，最小化的 `pwsh` 工具不该背负。

## 决策

在 `packages/bash/` 下新增两个包：

- **`@deepseek-ai/dsh-pwsh-local`** —— `ctx.bash` 执行器 seam 的本地实现，基于 `ctx.subprocess`，逐调用镜像 `dsh-bash-local`：`resolve()` 从配置默认化并设上限，`run()` 通过一个 deadline 融合配置夹取的超时与调用方信号，`start()` 返回消费式后台句柄，其进程归属于 subprocess 服务。命令字符串作为 ONE argv 元素传给 `pwsh -NoLogo -NoProfile -NonInteractive -Command`，由 PowerShell 解析，不存在 shell 引号层。可执行文件解析（`resolvePwshPath`）是 `(configured, env, platform)` 的纯函数：先显式配置，再在 Windows 上探测 PowerShell 7 安装位置、PATH 条目（剥离引号）与 Windows PowerShell 5.1，否则经 PATH 解析裸 `pwsh`。
- **`@deepseek-ai/dsh-tool-pwsh`** —— 基于 `ctx.bash` 的面向模型工具，约定是 PowerShell 方言，逐调用镜像 `dsh-tool-bash`、减去 sandbox 面：经通用任务运行时执行前台与 `run_in_background`，经共享 [`dsh-bash-env`](../feature/2026-08-02-pwsh-tool-bash-parity.md) 注册表管理 `DSH_*` 环境，以及 bash 的 marker/截断渲染故事（干净退出不产生 marker）。parity 决策取代了本 note 的最小画像工具描述。

Windows vitest 覆盖率刻意不属本次改动：仓库的 Windows CI 通道负责构建/静态门禁，单元覆盖在 Linux 上运行，两个包的套件在那里以真实 `pwsh` 运行（GitHub 托管 runner 预装）或缺失时自行跳过。vitest 的 `windowsUnsupportedPackages` 排除从 `packages/bash/*` 收窄为真正需要 bash 的包，使 pwsh 套件也能在 Windows 开发机上原生运行。

本决策之后的路线图——让 Windows 主机默认 `pwsh`（关闭 bash）与 pwsh TUI/GUI 渲染——另行记录为[提案](../../proposed/feature/2026-08-01-windows-pwsh-default.md)。

## 备选方案

**给 `dsh-bash-local` 增加 pwsh 模式。** 否决：执行器的身份就是它 spawn 的 shell；在一个包内塞第二种方言会翻倍配置面（`shell` 开关）与测试矩阵，且两种方言的怪癖（Windows 上的信号实情、引号域）应各自归入自己包的文档。

**给 `dsh-tool-bash` 增加方言参数。** 否决：bash 工具的后台/沙箱表面是 bash 形状的；`pwsh` 模式要么隐藏它（条件 schema 翻动），要么继承它（把最小画像明确拒绝的表面带进来）。最小孪生让模型约定保持诚实。

**现在就接入交付的 CLI 组合。** 否决：在 Windows 默认决策落地前把 `tool-pwsh` + `pwsh-local` 挂进 `base.cordis.yml` 会改变交付清单；本改动交付能力与接线点（`apps/cli` 依赖、tsconfig 工程），不切换任何默认。

## 后果

- bash 执行器 seam 有了第二个、Windows 原生的实现，请求/规范约定一致，因此 `tool-pwsh` 之外的面向模型消费方（hooks 桥、进程内插件）无需方言垫片即可运行 PowerShell。
- `tool-pwsh` 是模型可见的 Windows 优先 shell 工具：在前台与后台工作（减 sandbox）上与 bash 工具行为可互换，提示词指导精确陈述 marker 约定。
- Windows 语义在平台差异处不同：强制终止报告退出码 1 且无信号（因此 `signal`/`killed` 状态实情仅限 POSIX），PowerShell 输出 CRLF，测试做归一化。
- CLI 增加两个 workspace 依赖与两个 tsconfig 工程，但不挂载任一插件——组合决策留给 Windows 默认提案。
