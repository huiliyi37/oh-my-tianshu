# Agent Note: TUI Esc 打断、粘滞换行模式与会话 tab 标签

Status: implemented

[English](2026-08-17-tui-esc-csi-u-and-compose-newline.md) | 中文

## 问题

Cursor 等 xterm 系终端会把 Esc 编成 Kitty CSI u（`CSI 27 u`），即使应用尚未请求该协议。输入解析器吃掉这段完整 CSI 后，`resolveEscapeSequence` 只认带分号的形式（`CSI 13;2u`），于是 `[27u` 变成 `unknown`，Esc 到不了打断。同一族编码也是区分 Shift+Enter 与 Enter 的可靠办法；没有它两者都是 CR，无法做换行模式。会话 tab 对 `session-<uuid>` 取 `id.slice(0, 8)`，于是每个标签都是 `[session-]`。换行模式下的长草稿只有按宽折行、没有行数上限，高草稿会把 chrome 顶出屏；逐字符量宽的渲染在万级字符草稿下每次按键上百毫秒；换行模式下粘贴流（非 bracketed paste）结束时直接提交，长文编辑场景的粘贴会被意外发出。

## 决策

`decodeEnhancedKey` 把 Kitty CSI u（`CSI 27 u`、`CSI 13;2u`、`CSI 99;5u` 等）和 xterm modifyOtherKeys（`CSI 27;2;13~`、`CSI 27;5;99~`）映射为 `escape` / `return` / `ctrl_*` 加修饰位，并排在 unknown-CSI 回落之前。CSI 匹配器接受冒号，因而 Kitty 的 `code;mod:event` 形式（`CSI 99;5:1u`）能解析；事件类型 3（释放）只消费不派发，按下+释放不会被算成两次 Ctrl+C。attach 只开 Kitty 键盘协议 flag 1（`CSI >1u`）；无修饰的可打印键仍走原字节；flag 1 把 Ctrl+字母改写成 CSI u（Ctrl+C 是 `CSI 99;5u`，不再是 `0x03` / SIGINT）；dispose 弹栈（`CSI <u`）。忽略该私有序列的终端保持孤立 Esc 与 CR 行为。

打断看 `isAgentBusy()`（`status === 'running'`，或在途 `activity`，或 inbox 非空），不只看 status。忙碌时 `setEscapeImmediate(true)`，残留的孤立 Esc 不再等 80ms 消歧。空闲 Esc 仍不退出；vim normal 下 Esc 是空操作，不布防双击 rewind（vim 用户离开 insert 后习惯性补按 Esc，不应弹出 rewind overlay）。

Ctrl+C 的连按退出不要求空输入：窗口内第二次恒退出（草稿/在途不拦路）。忙碌时第一次打断并武装 2 秒窗口，再按一次即退出、不必等空闲；空闲非空输入行第一次清草稿（setValue 记 undo，Ctrl+Z 可恢复）并武装窗口，第二次退出——不再有「已取消」噪音，也不再有「草稿非空时两次按退不出」的死角。

Shift+Enter 在 app 键路由切换粘滞 `newlineMode`（slash 菜单的 Enter 忽略 shift，切换仍可达）。开启后，非 inline 的 Enter 插入 `\n`；再按一次 Shift+Enter 退出，随后 Enter 提交。一次性换行仍是 `Ctrl+J`、Alt+Enter、以及行尾 `\`+Enter。无增强键时 Shift+Enter 仍是提交；footer 提示 `ctrl+j 换行`。换行模式下粘贴流结束的 return 与 Enter 同义——并入草稿（含尾随换行）而不提交，与 bracketed paste 直插行为一致；非换行模式保持「流结束合并提交」。长粘贴满 100 行或 10000 字才折叠为 `[paste #N +M lines]`（单数行用 `line`），提交时展开——阈值以下保持原文可编辑。输入视窗用 `inputViewportMaxLines(rows)` 封顶可视行（最少 3、最多 16，约 `rows / 3`），光标行保持可见，超出时标 `… 上 N 行` / `… 下 N 行`。草稿折行或含换行时 ↑↓ 按视觉行移动；PageUp/PageDown 按视窗高度翻页；Home / Ctrl+A / Ctrl+U 与 End / Ctrl+E / Ctrl+K 以逻辑行为范围。折行逐 code point 量宽走 `charDisplayWidth`（两档有界缓存，结果与 `displayWidth` 恒等），并免去 `Array.from` 全量数组——10 万字符草稿每次按键渲染从 ~1.3s 降到 ~10ms。

`sessionTabLabel` 剥掉前导 `session-` 再取 8 个字符。

## 备选方案

**把所有以 `u` 结尾的 CSI 都当 Esc。** 否决：Kitty 用这种形式编很多键；只有 code 27 是 Esc，Shift+Enter 是 code 13 加 shift。

**打开完整 Kitty 键盘协议（消歧以外的 flag）。** 否决：后续 flag 会把可打印键改写成 CSI u，普通打字还得再写一套解析。

**Shift+Enter 插入一次换行（常见 GUI 映射）而不是粘滞模式。** 否决：需求是切换——连续 Enter 组稿，再按一次 Shift+Enter 恢复 Enter 提交。

**仅在 `status === 'running'` 时打断。** 否决：工具可能已在途，或 follow-up 已在 inbox，而 status 尚未翻转；Esc 会空操作。

**tab 标签继续取原始 id 的前 8 个字符。** 否决：官方会话 id 都带 `session-` 前缀，栏不可读。

## 影响

Cursor 终端里 Esc 会打断忙碌回合并打印 `⏹ 已取消`。退出窗口内第二次 Ctrl+C 会离开进程，即使 agent 仍标为忙碌或输入行有草稿。粘滞换行模式在 footer 显示 `换行中`。会话 tab 显示 uuid 前缀而不是 `[session-]`。同一 flush 里的「文本+CR」仍按住 12ms，好让下一 chunk 把这次 CR 标成 inline（[粘贴行爆发合并](2026-08-16-input-paste-line-burst-merge.md)）。测试钉住 CSI 27 u 打断、CSI 99;5u / `CSI 99;5:1u` 的 Ctrl+C（释放忽略）、CSI 13;2u 切换、跨 chunk inline return、换行模式粘贴并入草稿 vs 提交、空闲草稿第二次 Ctrl+C 退出、忙碌打断后窗口内第二次退出、vim 双击 Esc 不触发 rewind、折行 ↑ 与 PageUp、tab 标签，以及 attach/dispose 的 `CSI >1u` / `CSI <u`。
