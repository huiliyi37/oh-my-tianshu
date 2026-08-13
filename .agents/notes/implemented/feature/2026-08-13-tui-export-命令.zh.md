# Agent Note: T3 /export 会话导出命令

Status: implemented

[English](2026-08-13-tui-export-命令.md) | 中文

- **日期**: 2026-08-13
- **范围**: TUI 命令层（`packages/tui/tui`）+ 文档

## Problem

C6 差距矩阵第三批 T3：Claude Code 有 `/export`、grok 有 `export_cmd.rs`（三字段 `ExportArgs`），DSH 无会话导出面——用户无法把当前会话转录导出为 Markdown 分享/存档/评审/喂给别的模型。低成本高可见（渲染器是纯函数，事件源已有）。

## Decision

**只加 TUI 命令层，不动 session/agent 层、不发明事件类型**：导出纯读 `session.events`（权威事件流）正向渲染——**不复用 `scrollback-transcript.ts`**（它是反向解析：渲染行 → 消息单元供搜索；正向渲染才能导出完整内容、无折叠截断、工具结果全文）。

- `format/export.ts`（新增，纯函数，Cordis-free）：`renderSessionExport(events, meta)` → Markdown。user/assistant/tool-result 三类消息事件；assistant 拆 text + reasoning（`> 推理` 引用）+ tool-call 行；工具结果超长截断 5000 字符附 `…+N 字符`；空会话输出 `（无消息）`。确定性：同输入恒同输出（可快照测试）。
- `registry.ts`：`BuiltinCommandDeps.exportTranscript(path?)`（返回导出路径）+ `/export [path]` 命令 + `BUILTIN_COMMAND_NAMES` 登记。
- `ui/app.ts` `exportTranscript`：`ctx.sessions.get(activeSessionId)` 取当前会话；path 缺省 = `join(header.cwd ?? process.cwd(), 'dsh-export-<id>.md')`；无会话/会话不存在/写盘失败都抛错（fails loud，命令层回显失败）。
- 非目标：`/copy`（剪贴板导出，依赖剪贴板读入面，列后续）；远程分享/上传。

## Consequences

**提交**：本批（`registry.ts` + `app.ts` + `format/export.ts` + 三个 spec + README 双语 + C6 矩阵）。

**验证**：`export.spec` 7/7（含截断/确定性/空会话）、`commands.spec` 111/111（/export 无参/带 path/名字表）、`app.spec` 接线用例走真实文件系统完整链路（命令 → deps → renderSessionExport → writeFile → 回显，`vi.waitFor` 轮询落盘）；TUI tsc exit 0。app.spec 全量 180/182——2 个失败为并行会话外部改动引入（`str_replace 审批 diff` 断言与 permission-diff 新 renderFileDiff 格式不匹配；`长静默 stale` 超时），与本批 diff 零交集，不阻塞。

**踩坑记录**：
- `tool/result` 事件 data 有 `message: ToolResultMessage`（`core/session/types.ts` 权威形状），content 是 `[ToolResultBlock]` 元组——fixture 必须用 `createToolResultMessage` 构造（`createMessage` 平铺 text 块会假绿：渲染器提取不到文本）
- `user/message` 的 data 直接是 UserMessage（非 `{message}` 包装）——与 assistant/message 不对称，容易写错
- exactOptionalPropertyTypes：`{ cwd: string | undefined }` 不兼容 `cwd?: string`——条件展开 `...(cwd !== undefined ? { cwd } : {})` 是正确形态
- app.spec 接线测试不能依赖 `setImmediate` 单轮等真实 IO——`vi.waitFor` 轮询文件落盘 + 回显上屏

**后续**：`/copy` 剪贴板导出（依赖剪贴板读入面）；T5 全屏查看器。

## Alternatives considered

- **复用 `scrollback-transcript.ts` 做导出**——被拒：该模块是反向解析（渲染行 → 消息单元供搜索），折叠会截断内容；只有从 `session.events` 正向渲染才能导出完整文本与工具结果全文。
- **发明专门的导出事件类型或 session 层导出 API**——被拒：纯读权威事件流 `session.events` 已足够，无需新词汇。
- **同批做 `/copy` 剪贴板导出**——推迟：依赖尚不存在的剪贴板读入面，列为后续。
