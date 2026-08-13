# Agent Note: TUI bracketed paste 接线——多行/长文本粘贴整段进入输入行

Status: implemented

[English](2026-08-12-tui-bracketed-paste.md) | 中文

## Problem

TUI 输入框从未发送 `\x1B[?2004h`（DECSET 2004）启用 bracketed paste，也从未注册 `InputHandler.onPaste` 处理器。终端未包裹粘贴时，多行文本的每行行尾 `\r`（0x0d）被解析为 Enter 键 → **每行触发一次提交**——用户粘贴一段报错被拆成一行一条消息发出，且多条消息排队后 Ctrl+C 无法打断。长文本（>10 行/1000 字符）本应折叠为 `[paste #N +M lines]` 标记的路径也从未可达（折叠逻辑在 `insertText` 内，但无人调用）。

## Decision

- `engine/ansi.ts`：新增 `BRACKETED_PASTE_ON`（`\x1B[?2004h`）/ `BRACKETED_PASTE_OFF`（`\x1B[?2004l`）。
- `ui/app.ts` attach：写入 `BRACKETED_PASTE_ON` 并注册 `input.onPaste(text => { inputLine.insertText(text); flushLiveRender() })`（pasteDisposer 随 attach 重建、dispose 释放）；dispose 写入 `BRACKETED_PASTE_OFF` 恢复终端默认。
- 粘贴文本经 insertText 进入输入行：≤10 行/1000 字符直接插入（含 `\n`，输入行多行渲染），超出折叠为原子标记、提交时 expandPastes 还原——**一次 Enter 提交整段**，不再逐行触发。
- 附带修复：onChange 只刷新 slash 状态不重绘，粘贴后补 `flushLiveRender`。

## Verification

- `tests/app.spec.ts` +3：attach 写入 `2004h`、dispose 写入 `2004l`；模拟 `\x1B[200~…\x1B[201~` 多行粘贴整段进入输入行（无逐行提交）；超阈值长粘贴显示折叠标记。
- TUI 全量 **1421 passed / 2 todo**（79 文件）；`tsc --noEmit` 0 错误；oxlint 0 错误。

## Files

- `packages/tui/tui/src/engine/ansi.ts`：BRACKETED_PASTE_ON/OFF
- `packages/tui/tui/src/ui/app.ts`：attach/dispose 接线 + onPaste 注册 + flush
- `packages/tui/tui/tests/app.spec.ts`：+3 用例

## Alternatives considered

### 逐行解析 \r 而非启用 bracketed paste

不改终端模式、在 InputHandler 里区分 `\r` 与粘贴上下文（如粘贴窗口内吞掉 Enter）也可阻止逐行提交，但会把「粘贴状态」推进输入解析器，跨 chunk 粘贴边界的判定脆弱，且拿不到「整段一次性到达」的语义。DECSET 2004 是终端原生契约，成本为零、行为由终端保证。

## Consequences

- 多行/长文本粘贴整段进输入行、一次 Enter 提交，不再逐行触发提交（此前粘贴报错会被拆成多条消息且排队后无法打断）。
- attach 写 `2004h`、dispose 写 `2004l` 恢复终端默认；pasteDisposer 随 attach 重建、dispose 释放。
- 后续图片粘贴工作（[2026-08-13-tui-image-paste-and-vision-bridge](2026-08-13-tui-image-paste-and-vision-bridge.md)）在 onPaste 处理链前段增加剪贴板图片识别——bracketed paste 仍是文本通道入口，两者互斥不冲突。
