# Agent Note: TUI Esc 打断、粘滞换行模式与会话 tab 标签

Status: implemented

[English](2026-08-17-tui-esc-csi-u-and-compose-newline.md) | 中文

## 问题

Cursor 等 xterm 系终端会把 Esc 编成 Kitty CSI u（`CSI 27 u`），即使应用尚未请求该协议。输入解析器吃掉这段完整 CSI 后，`resolveEscapeSequence` 只认带分号的形式（`CSI 13;2u`），于是 `[27u` 变成 `unknown`，Esc 到不了打断。同一族编码也是区分 Shift+Enter 与 Enter 的可靠办法；没有它两者都是 CR，无法做换行模式。会话 tab 对 `session-<uuid>` 取 `id.slice(0, 8)`，于是每个标签都是 `[session-]`。换行模式下的长草稿只有按宽折行、没有行数上限，高草稿会把 chrome 顶出屏。

## 决策

`decodeEnhancedKey` 把 Kitty CSI u（`CSI 27 u`、`CSI 13;2u` 等）和 xterm modifyOtherKeys（`CSI 27;2;13~`）映射为 `escape` / `return` 加修饰位，并排在 unknown-CSI 回落之前。attach 只开 Kitty 键盘协议 flag 1（`CSI >1u`）；可打印键仍走原字节；dispose 弹栈（`CSI <u`）。忽略该私有序列的终端保持孤立 Esc 与 CR 行为。

打断看 `isAgentBusy()`（`status === 'running'`，或在途 `activity`，或 inbox 非空），不只看 status。忙碌时 `setEscapeImmediate(true)`，残留的孤立 Esc 不再等 80ms 消歧。空闲 Esc 仍不退出。

Shift+Enter 在 app 键路由切换粘滞 `newlineMode`（slash 菜单的 Enter 忽略 shift，切换仍可达）。开启后，非 inline 的 Enter 插入 `\n`；再按一次 Shift+Enter 退出，随后 Enter 提交。一次性换行仍是 `Ctrl+J`、Alt+Enter、以及行尾 `\`+Enter。无增强键时 Shift+Enter 仍是提交；footer 提示 `ctrl+j 换行`。长粘贴仍在 10 行或 1000 字折叠为 `[paste #N +M lines]`，提交时展开。输入视窗用 `inputViewportMaxLines(rows)` 封顶可视行（最少 3、最多 12，约 `rows / 3`），光标行保持可见。

`sessionTabLabel` 剥掉前导 `session-` 再取 8 个字符。

## 备选方案

**把所有以 `u` 结尾的 CSI 都当 Esc。** 否决：Kitty 用这种形式编很多键；只有 code 27 是 Esc，Shift+Enter 是 code 13 加 shift。

**打开完整 Kitty 键盘协议（消歧以外的 flag）。** 否决：后续 flag 会把可打印键改写成 CSI u，普通打字还得再写一套解析。

**Shift+Enter 插入一次换行（常见 GUI 映射）而不是粘滞模式。** 否决：需求是切换——连续 Enter 组稿，再按一次 Shift+Enter 恢复 Enter 提交。

**仅在 `status === 'running'` 时打断。** 否决：工具可能已在途，或 follow-up 已在 inbox，而 status 尚未翻转；Esc 会空操作。

**tab 标签继续取原始 id 的前 8 个字符。** 否决：官方会话 id 都带 `session-` 前缀，栏不可读。

## 影响

Cursor 终端里 Esc 会打断忙碌回合并打印 `⏹ 已取消`。粘滞换行模式在 footer 显示 `换行中`。会话 tab 显示 uuid 前缀而不是 `[session-]`。同一 flush 里的「文本+CR」仍按住 12ms，好让下一 chunk 把这次 CR 标成 inline（[粘贴行爆发合并](2026-08-16-input-paste-line-burst-merge.md)）。测试钉住 CSI 27 u 打断、CSI 13;2u 切换、跨 chunk inline return、newlineMode 提交 vs 插入、tab 标签，以及 attach/dispose 的 `CSI >1u` / `CSI <u`。
