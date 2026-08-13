# Agent Note: TUI 会话分叉命令 /fork /branch（A3）

Status: implemented

[English](2026-08-11-tui-session-fork-commands.md) | 中文

## Problem

C1 对标（`docs/dsh-tui-与claude的对比-c1.md`）的 A3 项指出 session 层与 TUI 之间的落差。fork 能力本身已存在：`packages/core/session/src/index.ts`（L1095）的 `SessionStore.fork` 把事件历史复制到新的 child session，并在元数据里记录 `parentSession` 血缘与 `seedLength`（见 [session-store fork API](2026-06-30-session-store-fork-api.md)）。而 TUI 完全没有 fork 或 branch 的命令入口，只有启动时的 restore-session 恢复。

## Decision

`/fork` 与 `/branch` 共享同一个 handler（`deps.forkSession` → `TuiApp.forkSession`）：`ctx.sessions.fork(activeSessionId)` 创建 child，随后 `switchSession(child.id)` 经既有的 agent-ensure 路径切换过去，child 没有 live agent 时走 resume。DSH 没有后台会话概念，因此 Claude Code 那两个彼此区分的命令——`/fork` 复制到新的后台会话、`/branch` 开分支并继续——在这里收敛成 fork 加切换的单一语义；两个命令名都保留，因为它们对齐用户心智。

命令即切，不设确认对话框，也不做分支树 UI。`/session list` 已经通过 `adapter/sessions.ts` 的 `SessionSummary` 携带 `parentSession` 血缘，父子关系在列表里可见。

## Verification

- `commands.spec.ts` 为这一行为承载三个用例——`/fork` 调用 `deps.forkSession` 并回显新 id、`/fork` 在无会话时把错误上抛、`/branch` 复用同一 handler——先 RED 后转 GREEN；该文件 64/64。
- `app.spec.ts` 承载两个 `forkSession` 用例——`sessions.fork` 收到由 `newSession` 铸造的当前 session id，应用 resume 到 child 并返回 child id；无活跃会话时调用抛错——先 RED 后转 GREEN；该文件 61/61。
- TUI 全量 1026/1027。唯一失败是 term-width 的 `isCjkLocale` 用例：本机 CJK locale 下的既有环境失败，与 A1 交付时同一基线，非本次引入。
- 类型：只检查四个改动文件的 scratch project 报告本次改动零类型错误；`tsc` 在别处报出的三类错误逐一溯源到其他来源——`app.ts` 里 HEAD 并不存在的未初始化 `renderBatcher` 字段（来自并行会话的未提交改动），以及 `commands.spec.ts` 中 `makeCtx` overrides 缺 `tasks`（HEAD 上的既有类型错误，其三处 `tasks` 测试在 HEAD 已存在）。

## Files

- `packages/tui/tui/src/commands/registry.ts`：`BuiltinCommandDeps.forkSession`、`/fork` 与 `/branch` 命令，以及在 `BUILTIN_COMMAND_NAMES` 里补上 `fork`/`branch`
- `packages/tui/tui/src/ui/app.ts`：`TuiApp.forkSession` 与 `createBuiltinCommands` 调用点
- `packages/tui/tui/tests/commands.spec.ts`：`/fork` 与 `/branch` 三个用例，以及 `commandByName` 的 deps
- `packages/tui/tui/tests/app.spec.ts`：两个 `forkSession` 用例，以及在 `makeCtx` 中补 `fork` mock
- `docs/dsh-tui-与claude的对比-c1.md`：A3 标记为已完成

## Alternatives considered

**沿用 Claude Code 的拆分语义：`/fork` 复制到后台会话、`/branch` 开分支继续** — 否决。DSH 没有后台会话概念，两种行为在这里没有任何可区分之处；两个命令共用一个 fork 加切换的 handler，既保留了用户熟悉的命令名，又不必为这种拆分凭空造出一套后台会话模型。

**切换前加确认对话框把关** — 否决。C1 草案把确认对话框列为非必需项，而分叉本身可以切回来，因此命令直接切；若日后误分叉真的造成困扰，再补对话框。

**为分叉关系做分支树 UI** — 否决。`/session list` 已经通过 `SessionSummary` 暴露 `parentSession` 血缘，父子关系本就可读；树状视图只是把列表已有的数据再呈现一遍。

## Consequences

- 两个命令名共用一个 handler，换来的是不新增任何 UI 面就拿到完整能力，付出的是没有确认环节：`/fork` 立即切换活跃会话，误分叉只能靠 `/session` 切回去。
- 血缘信息落在 `/session list` 而非专门视图里，因此较深的分叉链读起来是一串扁平的父引用，不是树。
- 行为只由单元测试锚定。本地没有 TUI profile 运行环境，因此 `dsh --profile tui` 下的端到端结果——transcript 中 fork 出的历史、`/session list` 中的 `parentSession` 血缘——只有这一层单元证据支撑。
- fork 出的 child 的持久化依赖 session-persistence 在 flush 时落盘 seed 事件，本次改动未单独验证：跨重启恢复分叉会话仍归既有的持久化约定管辖。
