# Agent Note: 从姊妹仓库 dsh-tui 移植 TUI 退出生命周期与命令面板修复

Status: implemented

[English](2026-08-16-port-tui-exit-and-palette-fixes.md) | 中文

## 问题

TUI 存在两个姊妹仓库 `dsh-tui`（`huiliyi37/dsh-tianshu-tui`，以 `dshtui/*` refs 拉取）中已修复的缺陷：live 帧会隐藏硬件光标且 `dispose()` 之后不再恢复，用户退出（`Ctrl+Q`）后 stdin 仍处于暂停状态且宿主进程不退出，shell 无法收回 TTY；以及命令面板中 `Esc`/`Ctrl+C` 会被既有三个分支漏掉后直接吞掉（只有 `Enter` 能关闭并把 `/命令` 回填进输入行），而面板底栏却提示「Esc 关闭」。两个仓库共享 109/117 个 TUI 源文件，但没有任何共同 git 祖先，无法直接 cherry-pick 或 merge；两边各自独立演进。

## 决策

按语义把两个修复移植进 `packages/tui/tui`（`@huiliyi37/dsh-tui`），适配本仓库的 `@huiliyi37` scope 与目录结构。

用户退出（`Ctrl+Q` / `/exit` / `SIGINT`）现在先 dispose 再退出宿主：`index.ts` 新增 `requestHostExit()`，优先通过 `runtimeCtx.reflect.get('appExit', false)` 取宿主 `appExit` 能力，缺失时回退 `process.exit(0)`；`teardown(quit)` 区分用户主动退出与插件卸载清理——后者只 dispose，把进程生命周期留给宿主。`TuiApp.dispose()` 现在会先 deactivate 仍激活的 overlay（退出备用屏），并在 `live.clear()` 之后写入 `ANSI.SHOW_CURSOR`，TTY 交还 shell 时硬件光标可见。新增 `/exit` slash 命令经 `BuiltinCommandDeps` 的 `requestExit` 槽走同一 `onExit` 路径。

命令面板在 `return` 分支之前处理 `escape` 与 `ctrl_c`：两者都关闭面板但不提交、不回填输入行，与 search/memory overlay 及底栏提示一致。

本仓库没有 `USAGE_TEXT` 帮助块（键位表在 `Ctrl+.` 面板），上游修复中该部分不适用。

## Alternatives considered

**直接 cherry-pick 上游两个提交。** 否决：两个仓库没有共同 merge base，diff 会与本仓库 rebrand 且重构过的文件整体冲突，且上游补丁引用 `@deepseek-ai` import。

**把 `dshtui/main` merge 或 fetch 进本仓库。** 否决：两边历史无关；merge 会把姊妹仓 96 个分叉提交缠进本仓库，而不是携带两个聚焦修复。

**只修面板、推迟退出生命周期。** 否决：退出缺陷危害更大（shell 收不回 TTY），且没有宿主退出的 `/exit` 依然会让 shell 卡住。

**把 `/exit` 写成独立命令而非 `requestExit` 依赖。** 否决：经 `onExit` 路由保证单一退出路径（`Ctrl+Q`、`/exit`、空输入 `Ctrl+C` 都走同一 dispose-后-退出序列），与姊妹仓修复一致。

## Consequences

用户触发的退出现在在 flush 之后终止宿主进程，而插件卸载仍是只 dispose——进程生命周期归宿主。所有 dispose 路径（含 attach 失败）都会恢复光标。`/exit` 进入 `BUILTIN_COMMAND_NAMES` 后 `/ex` 与 `/export` 歧义（解析返回 null，不猜命令）。测试覆盖 `Ctrl+Q`、`/exit`、`Esc`/`Ctrl+C` 关面板、`appExit(0)` 优先、`process.exit(0)` 回退、插件卸载路径不退出；`process.exit` 被 spy，测试不会真杀进程。`term-caps.ts` 与 `app.ts` 的 `tailLines` 行仍有与本改动无关的既有 lint 发现。
