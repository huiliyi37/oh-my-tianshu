# Agent Note: 历史搜索 overlay（C2 项 2）

Status: implemented

[English](2026-08-11-tui-history-search-overlay.md) | 中文

## Problem

TUI 靠终端原生 scrollback 找历史，会话内根本无法搜索对话内容：解析层已有，却没有容器与键路由接到它。

## Decision

Ctrl+F 打开全屏 overlay，在主线程同步搜索本会话的对话文本。

1. **overlay** 走 alt-screen，复用 OverlayController/OverlayEngine 的 register/activate/deactivate 模式：可打印字符进 query（实时搜索）、Backspace 退格、n/N 循环跳转、p/P 上一个、Esc/Ctrl+C 关闭。palette 打开时 Ctrl+F 不拦截，palette 优先。
2. **smart-case**：查询含大写 → 精确匹配；否则大小写不敏感（grok 的一行规则）。
3. **数据源**：`transcript.view.messages`（adapter/transcript 的事件投影）。adapter 版 TranscriptMessage 是 `{seq/time/kind/turn/text/event}`，与 scrollback-transcript 版（`rawContent/lines`）不是同一类型，因此 overlay 通过最小结构 `SearchableMessage { text }` 消费 `text` 字段，不依赖 scrollback 版。
4. **渲染**：搜索栏（`/ <query>▌  N/M` 当前/总数）+ 消息区（从当前匹配开始，单行截断到宽度，匹配行 success 色 ▸ 前缀）+ 底部 hints。空 query 显示「输入搜索词（n/N 跳转，Esc 退出）」。

## Verification facts

- `tests/history-search-overlay.spec.ts` 9 用例（smart-case 敏感/不敏感、goNext/goPrev 循环、backspace 重算、空 query、无匹配 goNext no-op、渲染计数/hints/匹配内容）RED→GREEN，9/9。
- `tests/app.spec.ts` 集成 2 用例（Ctrl+F 打开渲染搜索提示 + Esc 关闭；字符进 query + n 跳转 no-op）RED→GREEN。
- overlay 渲染经 renderBatcher.schedule（16ms 帧合并）异步进行，因此测试等待 flush 后才断言。
- 相关 spec 140/142（2 失败为并行会话 59f655b 提交的 HEAD 既有：statusline 接入、工具卡渲染）；scratch 单查本次改动 0 类型错误，app.spec 既有错误属于并行会话。

## Files

- `packages/tui/tui/src/format/history-search-overlay.ts`（新）：HistorySearchOverlay
- `packages/tui/tui/src/ui/app.ts`：注册 'search' overlay + Ctrl+F 键路由 + overlay 打开态键处理（type/backspace/n/N/p/P/Esc）
- `packages/tui/tui/tests/history-search-overlay.spec.ts`（新）：9 用例
- `packages/tui/tui/tests/app.spec.ts`：Ctrl+F 集成 2 用例
- `docs/dsh-tui-与grok的功能对比-c2.md`：项 2 标记 ✅

## Alternatives considered

**后台搜索线程——grok 的 SearchDaemon 加查询合并** — 否决。那套索引服务的是 grok 的多 agent、百万行规模；DSH 单会话规模小到主线程同步搜索就够，因此不引入 Worker。

**消费 scrollback-transcript 的消息类型** — 否决。调研发现 adapter 投影版的 TranscriptMessage 带 `text`，而 scrollback-transcript 版带 `rawContent/lines`；overlay 从 adapter 投影取最小的 `SearchableMessage { text }`，不与 scrollback 形状耦合。

**正则查询** — 本轮否决。C2 文档把 overlay 限定在 smart-case 子串匹配，这也是一行规则下用户预期的行为。

## Consequences

- 会话内可搜索对话文本并用 n/N 跳转，代价是快照语义：消息集合在 overlay 打开时取定，搜索期间新增的消息不进结果，直到重新打开；若要实时视图，需在 setMessages 基础上订阅变更。
- 匹配只有子串 smart-case，模式搜索在这里无从下手。
- 搜索留在主线程，让 overlay 不必付出 Worker、线程与新依赖的成本。
- 证据止于包内测试：装配后的 `dsh --profile tui` 中 Ctrl+F 输入关键词、n/N 在匹配间跳转、Esc 返回主屏均未验证。
- 至此 C2 批次收束：项 1/2/4 已实现，项 3 经调研确认被既有 tool-card 截断覆盖，项 5 用户确认不做。
