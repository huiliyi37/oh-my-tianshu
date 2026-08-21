# Agent Note: 新会话不再冒充恢复会话；fork 标题取自己的历史

Status: implemented

[English](2026-08-21-tui-new-session-banner-and-fork-titles.md) | 中文

## 问题

两个会话恢复界面的 bug 同出一根：TUI 从日志形状猜测会话来历，而不是由来历的持有方声明。

1. **Ctrl+N 报「已恢复会话」。** `mountSession` 用 `restored = session.events.length > 0` 猜测。intent-bridge 的对齐会话是带种子的（`zen/phase` ×2 + `session/end-seed` + `session/title`），于是装配 intent-bridge 时每次 Ctrl+N 挂载的都是全新会话，却仍渲染恢复横幅；今后任何带种子的新会话流程都会继承同一个误报。
2. **可恢复列表行无法区分。** fork 的持久化日志内嵌父会话前缀，`sessionTitleFor` 因此折叠到父会话的最新 `session/title` 事件或首条真人消息。同父的两个 fork 渲染出完全相同的行——同标题、同年龄、同 `fork #parent` 尾注——用户无从分辨哪个会话装着哪份工作。

## 决定

**来历是调用方语义，不靠猜。** `mountSession(id, { restored })` 显式接收该标记：`newSession` 传 `false`（普通分支与 intent-bridge 对齐分支皆是），`switchSession` 传 `true`。横幅、崩溃修复告知与「上次进行到此处」分隔仅在 `restored && events.length > 0` 时渲染。

**标题认 seed 边界。** `sessionTitleFor` 把最后一个 `session/end-seed` 之后的事件视为本会话自己的内容：自有的标题事件或自有的首条真人消息优先；自有切片为空（未活跃的 fork，或边界恰在日志末尾的恢复形状）时回退全量折叠——无 `end-seed` 的老日志与普通恢复的行为不变。未活跃的 fork 仍展示继承标题，靠 `fork #parent` 尾注区分。

## 否决的替代方案

**按 end-seed 位置推断恢复。** 否决：对齐种子在 `end-seed` 之前已带内容，任何日志形状启发式都会把它误判。调用方本就知道自己是创建还是恢复——显式参数是更窄、更真实的契约。

**在选择器里给重名标题加后缀。** 否决：这是展示层补丁——两个同标题 fork 的内容歧义仍在。折叠 fork 自己的首条消息修的是成因，不是标签。

## 后果

新会话——包括带种子的对齐会话——不再出现恢复横幅、崩溃修复告知与回放分隔。活跃 fork 展示从自己 fork 后工作推导的标题，同父 fork 在可恢复列表中不再撞名。对无 `end-seed` 的老日志与恢复会话，标题折叠与此前逐字节一致。

## 测试

`session-title.spec.ts` 钉住四种边界形状：有自有标题事件的 fork、只有自有首条消息的 fork、回退继承标题的未活跃 fork、以及全量折叠不变的恢复形状（边界在末尾）。`app.spec.ts` 钉住带种子的对齐 `newSession` 既不出现横幅也不出现分隔，并经负向验证（摘掉 `opts.restored` 门闩即用例转红）；既有恢复挂载用例仍断言横幅、年龄、cwd 与分隔。
