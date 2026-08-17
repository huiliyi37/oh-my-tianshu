# Agent Note: T1 /effort 切换 + H1 模型面向 git 工具（C6 差距矩阵首批）

Status: implemented

English | [中文](2026-08-13-tui-effort-and-git-tools.zh.md)

> 日期：2026-08-13 · 类型：feature · 范围：packages/tui/tui（/model）+ packages/git/（新组：git 服务 + tool-git）

## Problem

C6 综合复盘（`docs/dsh-能力复盘与对标-c6.md`）差距矩阵的前两项：T1 `/effort` 切换（低成本高价值）与 H1 模型面向 git 工具（Claude Code 原生 git 工具对应物）。两个都是"便利层"差距——骨架已存在，缺命令/工具面。

## Decision

**T1**：effort 底层链路已完整（`ModelSelection.reasoningEffort` 字段、`installModelSelection` 的 agent/request waterfall 写入、agent-default-model settings 持久化、glance-bar effort 段）——只缺 `/model` 命令解析。因此**只改 TUI 命令层**：`/model <provider/model|alias> [off|high|max]`（grok 同款形状），不动 agent/llm 层。附带修复既有缺陷：`/model` 切换传 `{provider, model}` 不含 effort → `settings.replace` 整体覆盖 → 清掉已配置 effort。

**H1**：新建 `packages/git/` 组（两个包）：
- `git/git`：`Git` 服务定义 + `GitLocal` CLI provider **合一包**——git CLI 是稳定外部接口的薄封装，provider 不与定义独立演化（fs 拆三包因其 provider 会独立演化，注释明示偏离理由）
- `git/tool-git`：一个结构化工具 `git`（`operation`：`status` / `diff` / `log` / `commit`）消费 `ctx.git`（工具层零子进程接触）；cwd 三优先解析（workdir 参数 > session header > 进程 cwd）；`commit` 操作 message 必填 + 独占（`isConcurrencySafe: false`）；commit 不弹审批（与 Claude Code 同立场，文件变更仍走 fs 审批面）
- 非目标：不做 approval 集成、不做事件词汇（YAGNI）、不做 git show/branch/revert（首批四个 operation）

## Consequences

**提交**：`a1ae54b`（T1）+ `7313021`（git 服务包）+ `5b31656`（tool-git）+ 收尾（README/登记/冒烟）。

**验证**：git 组 22/22（含 3 个真实装配冒烟：GitLocal+ToolGit+真实 git 仓库）、TUI 1426/1426、相关组 2396+22 绿（vision-bridge 的 6 个失败为并行会话开发中包，外部文件不阻塞）；两包 + TUI tsc exit 0。

**用户级验收 blocked**：本环境无交互 TTY（C1/C2 同款阻塞）；自动化替代证据已列 todo acceptance。

**踩坑记录**：
- git 2.50 中文系统 stderr 本地化（「不是 git 仓库」）——错误映射英文+中文双模式（探针实测）
- ToolRegistry 真实 API：`execute(exec: ToolExecutionInput)` 单参数、返回 materialize 后 content（canonical value 不直接暴露）、参数校验失败归一化为 `{isError: true}` 结果
- 新 workspace 包需 tsconfig.base paths 登记（vite-tsconfig-paths 解析）+ pnpm install 建链接

**后续**：T3 /export、T5 全屏查看器（C6 矩阵下一批）；git 工具按需扩展（show/branch/paths-scoped commit）。

## Alternatives considered

- **T1 在 agent/llm 层新增独立 `/effort` 命令或扩展 ModelSelection 链路**——被拒：effort 底层链路（字段/waterfall/持久化/glance-bar）已完整，只缺 `/model` 命令解析；动底层是无谓破坏面。
- **H1 按 fs 样式拆三包（定义/provider/工具）**——被拒：git CLI 是稳定外部接口的薄封装，provider 不与服务定义独立演化；合一包并在注释明示偏离理由。
- **工具层直接 spawn git 子进程**——被拒：`ctx.git` 服务层封装保证工具层零子进程接触，错误映射（含中文 stderr 本地化）集中在 provider 一处。
- **`git_commit` 弹审批**——被拒：与 Claude Code 同立场，commit 本身不审批，文件变更仍走 fs 审批面。
