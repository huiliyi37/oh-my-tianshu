# Agent Note: 对齐会话把非 finalize 调用转成 face 声明，契约声明唯一可用工具

Status: implemented

[English](2026-08-20-intent-alignment-face-guidance.md) | 中文

## Problem

默认 TUI 组合（`dsh-base` + `dsh-tianshu-tui`、`standard` preset）下的一条真实会话转录显示 intent-bridge 对齐模型在打转：它调用 `zen_anchor`、`bash`、`glob`，读回一串死路——`zen_anchor` "only available during the zen phase"、`unknown tool "bash"`、`unknown tool "glob"`——用户的请求迟迟到不了主会话。对齐 agent 的可见面恰好两个工具（`finalize_alignment` 加上泄漏进来的 agent-scoped `zen_anchor`），但它继承了 `standard` preset 的"coding agent" persona，而 `intent:policy` 契约从没声明它的工具清单。不稳定的模型（TUI 用 `deepseek-v4-flash` 对齐）凭先验去调熟悉的编码 agent 工具；`unknown tool` 不给它任何恢复路径。

## Decision

- `intent:policy` 契约（`ALIGN_SECTION`）现在以 face 声明开场：本会话只有 `finalize_alignment`，没有 shell、文件系统或搜索工具——不要调用任何其他工具名。
- 注册表 guard（镜像 zen 的锁定工具 guard）在调用会话是对齐会话时拒绝一切非 `finalize_alignment` 执行，返回同样的 face 声明。这也覆盖泄漏的 `zen_anchor`，对齐模型不会再看到误导性的阶段后锚定成功。
- face 声明是单一导出常量（`ALIGN_FACE_STATEMENT`），契约与 guard 逐字插值同一常量，声明面与执行面不会漂移。

## Alternatives considered

**彻底从对齐面移除 `zen_anchor`。** 否决：锚由 zen 的 `agent/created` 恢复分支注册（对齐种子读起来像已晋升会话），且没有按名注销的工具 API；用 guard 拦截在模型可见结果上等价，且只是一条小规则。

**只靠工具列表（不加 guard）。** 否决：转录显示对齐模型会调用列表里没有的工具；guard 把它变成可操作的声明而不是光秃秃的 `unknown tool`。

## Consequences

对齐模型在提示词层与运行时层都得到单一工具的声明；非 finalize 调用解析为明确拒绝而非 `unknown tool`。`intent:policy` 段落增加一行。`zen_anchor` 在对齐面上保持注册（稳定目录），但其执行被 face 声明拒绝。主会话行为不变。

## Testing

- `packages/guard/intent-bridge/tests/intent-bridge.spec.ts`——新增：脚本化对齐模型调用 `bash`、`glob`、`zen_anchor`，三次拒绝都含 face 声明且都不含 `unknown tool`；首次请求的系统提示词携带工具清单行。配套用例 dispose 插件 fiber（HMR）后观察到拒绝回落为普通的 `unknown tool` 错误。
- `packages/guard/intent-bridge/tests/align.spec.ts`——契约断言逐字携带共享的 `ALIGN_FACE_STATEMENT`。

## Related

- [intent-bridge 架构](../architecture/2026-08-18-intent-bridge.md)——拥有本 guard 所落实的对齐会话设计。
- [zen_anchor 空操作与可用工具面](../bug-fix/2026-08-20-zen-anchor-noop-and-callable-face.md)——主会话锚定面的配对修复。
