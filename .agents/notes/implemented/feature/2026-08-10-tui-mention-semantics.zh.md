# Agent Note: TUI @mention 展开语义（Phase 9a）

Status: implemented

[English](2026-08-10-tui-mention-semantics.md) | 中文

## Problem

TUI 路线文档 Phase 9a 写"输入 `@filename` 自动展开文件内容摘要"；天枢移植源`.rivet/tui-source/tui/mention-parser.ts`（51 行）的实际语义是 **agent 上下文注入**：`@file` → `MentionReference` → `renderMentionContext` 渲染 `<mentions>` XML 块（"Resolve these @mentions before proceeding"）→ 注入 agent 上下文让 agent 自己解析。两种语义不同，实现方向不定，编码前需先决策。

## Decision

取计划文档原义的用户侧语义：`@filename` 展开为截断的内容摘要展示在用户消息中，**不做** agent 上下文注入。

## Alternatives considered

**天枢 mentions 注入（agent 上下文）** — 否决。它跨越 TUI 插件边界进入 agent上下文装配（system-prompt/assemble 接线）；且任何模型可见输入必须配套 session事件（AGENTS.md: Model-visible ⟺ logged），超出 Phase 9a 范围。

**用户侧摘要展开** — 采用。在 TUI 插件内闭环（dsh-tui-next-phase.md 架构约束），不触及模型输入，无 session-log 义务。

## Consequences

- 解析为纯函数：输入文本中 `@` 后跟相对/绝对路径 token（无 IO）。
- 读取边界：仅限工作区（cwd）内文件；目录/不存在/越界 → 降级为引用名展示。
- 摘要截断（首 20 行 / 4KB）加折叠标记，防止污染输入框。
- 文件读取在 file 边界做存在性与大小验证（AGENTS.md 边界验证纪律）。
- 未来如需 agent 上下文 mentions 注入，单独成项并配套所需 session 事件。
