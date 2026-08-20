# Agent Note: zen_anchor 阶段后调用改为空操作成功，并让禅阶段指引列出可用工具面

Status: implemented

[English](2026-08-20-zen-anchor-noop-and-callable-face.md) | 中文

## Problem

真实会话转录暴露了两个禅阶段失败模式——模型在锚定面上调用 `zen_anchor`、`bash`、`glob`、`grep`，收到一串令人困惑的错误：

1. **预算末步锚定自相矛盾。** 步骤预算晋升在预算的最后一个步骤触发（`agent/pre-step` 监听器先于该步请求运行），因此连探三步、第四步才锚定的模型——最自然的节奏——调用 `zen_anchor` 时阶段已记入 `'full'`。工具抛出 "zen_anchor is only available during the zen phase; the full toolset is already unlocked"，与模型所见的一切矛盾：仍是 zen 的 `request/header` face、`zen:policy` 段落、以及说解锁落在*下一步*的通知。模型于是原地打转。
2. **指引从不列出可用工具。** `zen:policy` 段落只说"工具集被缩减"而不列举；guard 的拒绝信息只说"用缩减工具集探针"而不点名。带着强烈工具先验（glob/grep/read）的模型会去调被 face 移除的工具、被锁死，且没有可操作的替代。

## Decision

- `zen_anchor` 跨阶段边界幂等：折叠阶段已是 `'full'`（锚定、步骤预算超时或分诊）时，调用解析为良性成功（`{ unlocked: true }`）而非错误——呼应 `/plan off` 的幂等措辞，让模型继续前进而不是读回矛盾。证据门与参数校验在阶段真正为 zen 时仍然生效。
- `zen:policy` 段落追加一行 `Zen-phase callable tools:`，精确列出按代理解析的 face 加 `zen_anchor`——与 guard 使用同一份安装映射——模型无需猜测哪些工具可调。
- guard 的拒绝信息点名可用集合（`Callable now: …`），让锁定错误携带可操作的替代。

## Alternatives considered

**把步骤预算晋升推迟一步，让预算末步保持完全 zen。** 否决：这会改变已文档化的预算记账与"完整 face 自下一次组装可见"的契约；空操作锚定用一条小而稳定的规则覆盖该失败。

**保留错误但改写措辞。** 否决：错误结果仍会消耗模型一步并读起来像矛盾；转录显示模型在错误后打转而非恢复。

## Consequences

在预算末步（或分诊、先前锚定之后）锚定的模型得到良性成功并继续；阶段日志仍至多记录一次晋升。禅段落与 guard 信息各多一行，README 的 token 记账已同步。`zen_anchor` 在晋升后的 face 上保持注册（稳定目录），subagent 与对齐会话不受影响（从不武装，或种子已过禅）。

## Testing

- `packages/guard/zen/tests/integration.spec.ts`——新增用例：预算末步锚定解析为空操作成功且不重复记录晋升；分诊后锚定在完整 face 上解析为成功；禅段落精确列出 `probe, zen_anchor`；非 face 拒绝信息点名可用 face。

## Related

- [禅相位工程范式](../architecture/2026-08-17-zen-phase-engineering-paradigm.md)——拥有阶段设计；本 note 在其上记录失败模式修复。
