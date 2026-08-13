# Agent Note: Windows 默认改用 pwsh（路线图）

Status: proposed

[English](2026-08-01-windows-pwsh-default.md) | 中文

## 问题

harness 交付的执行配置在每个平台都是 bash 优先。Windows 主机必须安装 bash 垫片（WSL 或 Git-Bash），或退回到仅 POSIX 的 `dsh-bash-local` 行为；面向模型的 bash 工具教的是 bash 方言，TUI/Web 界面按照 bash 风格的预期渲染终端输出。第一块 Windows 原生基础已随 [pwsh 执行器与工具决策](../../implemented/feature/2026-08-01-pwsh-tool-and-executor.md) 交付：`ctx.bash` seam 的 PowerShell 实现与对等的 `pwsh` 工具——但还没有任何东西让 Windows 主机默认使用它们。

## 提案

两个阶段，各自可独立交付。原阶段 2（bash 工具对等孪生）已随 [pwsh 工具与 bash 对齐决策](../../implemented/feature/2026-08-02-pwsh-tool-bash-parity.md) 交付：`tool-pwsh` 现在除 sandbox 接口外，在前台与后台工作方面均与 `tool-bash` 对齐，通过 `dsh-bash-env` 共享 `DSH_*` 环境，并携带其组装后形态的 keyless 应用快照。

1. **Windows 默认组合**——交付的 CLI（命令行界面）组合在 Windows 主机上挂载 `dsh-pwsh-local` 作为 `ctx.bash` 执行器、`dsh-tool-pwsh` 作为面向模型的 shell 工具（那里不挂载 bash），POSIX 主机保持 bash 栈。这是 `base.cordis.yml` 与 surface 覆盖层里按平台门控的组合/清单决策；它让交付的 Windows 体验端到端 PowerShell 原生。
2. **pwsh GUI 渲染**——Web 界面使用 bash 风格的终端呈现来渲染 pwsh 调用（带胶囊状退出状态标签的终端卡片），与 bash 终端卡片相对应。已随 [pwsh UI 呈现与 bash 对齐决策](../../implemented/feature/2026-08-05-pwsh-ui-bash-parity.md) 及 keyless web 通道交付；TUI 已移除，不再有对应的终端界面。超出 bash 对齐的 PowerShell 感知呈现（原生路径显示、`$env:` 信息）仍无人认领。

各阶段仅在有依赖关系时排序：渲染阶段已随 [pwsh UI 呈现与 bash 对齐决策](../../implemented/feature/2026-08-05-pwsh-ui-bash-parity.md) 先行交付（平台无关，其 keyless web 通道可在任意宿主运行），而 Windows 默认组合仍是唯一未交付的阶段。本提案不改变任何 POSIX 行为。

## 备选方案

**在 `dsh-bash-local` 内部让 Windows 默认 pwsh（一个执行器，方言开关）。** 否决，理由与执行器决策否决模式开关相同：执行器的身份就是它 spawn 的 shell，而按平台门控的组合是部署选择，不是执行器配置。

**把 Windows 默认与执行器/工具一起交付。** 否决：清单变更需要自己的证据（交付的 Windows 树停挂 bash 后什么会坏、哪些工具依赖 bash 语义），并且它属于会在审批／PTY 界面上显现的组合决策。

**用垫片在 Windows 上保留 bash，跳过 PowerShell 默认。** 否决：这延续了安装税与路线图要消除的方言错配；垫片是部署要求，不是产品行为。

## 验收标准

- 运行交付版 `dsh` TUI/Web 的 Windows 主机无需配置即获得 `pwsh` 作为其 shell 工具、PowerShell 作为 `ctx.bash` 执行器，且那里的模型可见清单中没有 `bash`。
- POSIX 主机逐字节不受影响（清单相同，执行器相同）。
- 交付组合 e2e 在两个平台族上断言按平台门控的清单。
- 阶段 1 落地时，parity 变更带来的 keyless pwsh 工具快照已经就位；阶段 2 已随 web `pwsh-terminal` 渲染通道落地（TUI 的移除意味着不再有可供快照测试的终端界面）。

## 风险

- **依赖 bash 的组合行**——任何假设 bash 语义的交付插件（执行 shell 钩子的钩子桥接、工作区工具）必须按阶段审计；审计可能迫使分阶段推出而非一次切换。
- **Windows CI 覆盖缺口**——单元覆盖在 Linux 上运行；pwsh 栈里仅 Windows 的回归通过 Windows 构建/静态通道与 e2e 暴露出来；这些覆盖必须按阶段扩展，不能想当然地认为已经具备。
- **渲染约定**——与 bash 风格一致的终端呈现已随 web 通道交付；超出 bash 对齐的 PowerShell 感知呈现（原生路径显示、`$env:` 信息）仍是一项需要快照覆盖的 UI 设计决策，随阶段 1 一起延期。
