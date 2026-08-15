# Agent Note:hook systemMessage 随 hook/result 落账并由客户端透出

Status: implemented

[English](2026-08-16-hook-systemmessage-surfaced.md) | 中文

## Problem

两座 hook 桥都解析 Claude Code 方言的 `systemMessage`(hook 面向用户的通告),共享 merge 也把它收进了 `MergedHookOutcome.systemMessages`,但没有任何消费者:各桥只经 `ctx.logger.warn` 打一条 "not yet surfaced" 警告,而默认 logger 落点是内存环形 buffer,在出厂组合里实际不可见。hook 作者按方言文档写 `{"systemMessage": "…"}` 只能得到沉默。c7 对标(docs/dsh-编排机制对标-claude-c7.md §3.3)把这列为 hooks 协议覆盖差距的一部分。

## Decision

`systemMessage` 现在持久落账、客户端透出、对模型绝不可见:

- `hook/result` 的 log-only payload 新增可选 `systemMessage` 字段(trim,空白则省略),由共享的 `appendHookResult` 助手填充(`packages/hooks/hook-protocol/src/events.ts`)——两桥(claude 与 codex 方言)零分叉自动获得。
- 两桥删掉 "not yet surfaced" 警告;事件追加本来就是唯一记录点。
- TUI 把携带 `systemMessage` 的 `hook/result` 渲染为暗色 `[hook] <文本>` scrollback 行,走既有 `handleStreamEvent` → `commitToScrollback` 路径(`packages/tui/tui/src/ui/app.ts`)。不带 `systemMessage` 的常规结果不渲染——审计在日志里,不上屏。
- web/client 半侧 wire 零改动:scaffold server 原样转发全部会话事件,带新字段的 `hook/result` 直达任意客户端;渲染方按 Conversation Node 纪律自行接入。

该字段刻意不进任何模型可见通道(不走 `user/message`、不是 surface 事件):Claude Code 的 `systemMessage` 契约上面向用户;把它塞进派生历史会双向违反 "模型可见 ⟺ 已落账" 纪律。

## Alternatives considered

- **继续走 `ctx.logger.warn` 警告**:默认 logger 目标是内存环形 buffer,没有 console exporter 时实际不可见——这就是现状即差距。
- **像 `additionalContext` 一样注入 user message**:语义错误——`additionalContext` 设计上面向模型,`systemMessage` 是用户通告。CC 把两者放在不同通道,DSH 同样。
- **新开独立事件类型而非扩展 `hook/result`**:该通告从属于某次 hook 调用的结果;挂在既有 invoked/result 信封上,turn 闭合与审计关联都是免费的。

## Consequences

- 两桥 coverage 套件从 "warned, not surfaced" 翻转为新契约断言,另加 hook-protocol 的 payload 形状用例与 TUI 的 scrollback 渲染用例(hooks 三包 206 测试 + TUI 用例全绿)。
- `docs/persistence-catalog.md` 已重生成(`hook/result` payload 说明与字段);zh 对应文档已同步。
- 两桥 README 把 `systemMessage` 移出 Known Limitations;`updatedInput` 仍如实列为已解析未生效,待 pre-tool input rewrite 落地(其 proposed 笔记在案)。
