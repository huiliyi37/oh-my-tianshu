# Agent Note: TUI rewind closes on Esc and lists user checkpoints

Status: implemented

[English](2026-08-20-tui-rewind-esc-close-and-user-checkpoints.md) | 中文

## Problem

双击 Esc 能打开 rewind overlay，但打开之后 rewind 键分支在 `handleKey` 之后无条件 `return`。`RewindOverlay.handleKey` 把 `escape` / `ctrl_c` 标成已消费，并写明由装配方关闭 overlay；装配方却只在 `isDone()` 为真时调用 `deactivate()`。因此 Esc 只是重绘面板，第一次 Ctrl+C 也走不到连按退出进程的路径，只能杀进程。列表还把折叠出的每条 `user/message` 和 `assistant/message` 都塞进去，包括画成 `❯` 的插件注入用户行（`source.kind === 'plugin'`）以及 `foldText` 为空的纯工具助手行。提示行加在按消息条数切窗之后；turn 分隔线再把总行数顶过终端高度，`OverlayEngine` 就会裁掉「Esc 取消」底栏。

## Decision

rewind 键分支的关闭路径对齐 memory overlay：Ctrl+C，以及处于 `isListPhase()` 或 `isDone()` 时的 Esc，立刻 `overlay.deactivate()` 并 return。mode 阶段的 Esc 留在 overlay 上：`handleKey` 把阶段设回 `list`，装配方重绘。list 阶段 `handleKey` 对 Esc 仍返回 true，单元测试继续钉住「已消费」契约。

`rewindSession()` 只保留 `kind === 'user'`、`text` 非空、且 `event` 为 `user/message` 且 `data.source.kind === 'user'` 的 transcript 行。检查点列表为空时不激活 overlay，并回显 `没有可回退的用户消息`。list 与 mode 的 `render` 先留出提示行（`height - 2`），再按含 turn 分隔线的 body 切窗，最后一行永远是提示：列表为 `↑↓/j k 选检查点 · Enter 选粒度 · Esc 取消`，粒度步为 `1/2/3 确认 · Esc 返回列表或取消`。打开时仍清零 `escRewindPendingSince`；之后的空闲 Esc 只布防新的双击窗口。

`executeRewind`、文件快照、会话截断、以及双击 Esc 打开窗口均未改。

## Alternatives considered

**让 `handleKey` 切到 `done` / 取消阶段，复用现有的 `isDone()` deactivate 路径来关面板。** 否决：overlay 的 Esc 契约是「已消费，装配方关」；把取消折进 `done` 会画出用户并未请求的完成帧。

**在 `render` 里过滤行，`setMessages` 仍传入完整 transcript。** 否决：只有插件行或空助手行的会话仍会打开一块空面板；打开守卫必须跑在过滤后的列表上。

**继续把助手行当作检查点。** 否决：用户要的是「回到自己说过的话」。纯工具助手行和插件注入不是那个目标。

**让 `OverlayEngine` 给每个 overlay 留底栏槽。** 否决：只有 rewind 在对一条被裁掉的 Esc 提示撒谎；`render` 本地预留就够。

## Consequences

rewind 列表上第一次 Ctrl+C 会离开 overlay，之后的 Ctrl+C 才能布防并退出进程。mode 阶段 Esc 不关闭面板，避免按 Enter 后立刻误关。插件注入和空助手行不再以 `❯` / 空白 `✦` 检查点出现。矮终端上提示行保持可见。没有用户检查点的会话留在主屏并打印空列表回显。`rewindSession()` 返回 false 时（无会话或检查点为空），`/rewind` 仍会再打印 `⚠ 当前无可回退的会话`。

## Testing

- `packages/tui/tui/tests/app.spec.ts` — 双击 Esc 后再按第三次 Esc 写入 `ALT_SCREEN_OFF` 且不立刻重开；rewind 打开时 Ctrl+C 关闭且不调用 `onExit`；插件源与空助手行不出现；只有插件行的 transcript 拒绝打开并回显 `没有可回退的用户消息`。
- `packages/tui/tui/tests/rewind-overlay.spec.ts` — mode 阶段 Esc 回到列表；矮 `height` 把提示留在最后一行。

## Related

- [TUI Esc 打断与粘滞换行](2026-08-17-tui-esc-csi-u-and-compose-newline.md) — 空闲双击 Esc 打开窗口以及 vim 排除，本 note 保持不动。
