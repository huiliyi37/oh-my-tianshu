# Agent Note: /next-workflow——固定意图流水线：分阶段 effort 调配与验证硬门

Status: proposed

[English](2026-08-17-next-workflow-intent-pipeline.md) | 中文

## Problem

harness 已出厂一套强工程工作流的全部零件——带硬只读门的 plan-mode、subagent 角色、按请求的 effort 调配（`agent/request` waterfall)、workflow 引擎、hook waterfall(`agent/pre-tool-commit`)——但没有做任何组合。用户想要"理解 → 计划 → 评审 → 实现 → 验证 → 复审"就必须每次手工编提示词：计划纪律靠模型自觉，验证是荣誉制度（干活的自己当裁判），评审和计划发生在同一个上下文里（作者评自己的作业），而 effort 在各阶段一刀切——规划阶段受益于深推理，例行确认并不需要。

调研记录对修复形态高度一致（Anthropic 多智能体研究系统与 Claude Code best practices;spec-kit 的工件链）：阶段工件落在文件里，评审/复审在只见工件不见推理的新鲜上下文里跑，验证是确定性闸门而非自我汇报，effort 按阶段分配——规划与评审用高档，执行用默认。适应性记忆契约的缓存纪律原样适用：阶段边界是切换 effort 的唯一合法点（与缓存断点天然对齐），工件在阶段间以文件传递，绝不回灌上下文。

## Proposal

新包 `packages/workflow/next-workflow`(`@huiliyi37/dsh-next-workflow`)，注册宿主命令 `/next-workflow <objective>`。一次调用运行一条固定的、harness 持有的阶段机——harness 持有计划，模型写内容：

```
INTENT → PLAN → CRITIQUE → IMPLEMENT → VERIFY → REVIEW → DONE
```

- **INTENT**——把目标规范化为 SPEC 工件：目标、约束、涉及面、验收检查。写入 `<workflowsRoot>/<run-id>/SPEC.md`（根缺省 `dshHomePath('workflows')`)。
- **PLAN**——规划 subagent（结构化输出）把 SPEC 变成 `PLAN.md`：有序步骤、点名文件/接口、out-of-scope 声明。
- **CRITIQUE**——新鲜上下文的 subagent 只对照 SPEC.md 审 PLAN.md（永远看不到规划者的推理），返回 `{verdict, gaps[]}`；实质性 gap 打回 PLAN 一次（Config 限界）。
- **IMPLEMENT**——编排器把计划内容 steer 进当前会话的 agent：实现在用户工作区里实时可见地运行，拥有完整工具面。
- **VERIFY**——确定性闸门：经 bash 执行器运行配置的 `verifyCommand`(Config，如仓库测试命令）。失败则把输出打回 IMPLEMENT 做一次有界重试（`maxVerifyRetries`，缺省 1)；重试耗尽以 `failed-verification` 终态结束，绝不静默宣称成功。
- **REVIEW**——新鲜上下文的 subagent 对照 SPEC.md 的验收检查审产生的 diff，返回 `{verdict, findings[]}` 并写入 `REVIEW.md`；发现限定在正确性与既定需求（无边界的 reviewer 会发明工作）。

阶段迁移、工件与判定记录为 log-only 会话事件（`next-workflow/phase`、`next-workflow/end`)；磁盘上的工件在 compaction 后存活。分阶段 effort 调配走 `agent/request` waterfall：运行期间插件按阶段改写 `reasoningEffort`(Config 映射；缺省 plan/critique/review 为 `high`，其余不设），运行结束时恢复先前 header——切换只发生在阶段边界，即缓存合法点。命令沿用 `command-memory` 先例：注册在 `ctx.commands`,TUI 和 web 自动可见。

## Alternatives considered

**经现有 `tool-workflow` 让模型写动态 workflow。** v1 否决：workflow 的 `phases` 只是展示词汇，`agent()` 拒绝 `effort`，而且让模型持有编排脚本正是本特性要消除的非确定性。固定的 harness 持有状态机沿用 tool-ralph 的部署持有脚本模式，但带真实阶段语义。

**扩展 plan-mode。** 否决：plan-mode 是单个阶段（计划 + 批准），不是流水线；它保留为交互式对应物，不做改动。

**挂载 `guard/evidence-gate` 当验证器。** 推迟：它未出厂且仅内存态。v1 的验证门是经 bash 执行器的配置命令——确定性且部署持有；evidence-gate 集成是后续工作。

**IMPLEMENT 放进新鲜 subagent。** v1 否决：用户会失去实时可见性和工作区工具面；steer 主会话保持实现可观察。后续可用 `isolated: true` Config 在 provider 支持时把实现路由给 subagent。

## Acceptance criteria

- `/next-workflow <objective>` 注册在 `ctx.commands`,web 命令面无需客户端改动即可见。
- 组合测试（keyless,scripted provider）覆盖：完整阶段序列且工件文件落盘；critique gap 回环受 Config 限界；verify 失败 → 有界重试 → `failed-verification` 终态；effort header 按活动阶段改写并在结束时恢复；所有编排事件 log-only。
- 全部预算/阈值/effort 值是带 schema 缺省的验证 Config 字段。
- 包 README（双语）含 Model Experience(effort 切换在阶段边界按设计打破前缀缓存；工件以文件传递）与 Known Limitations。
- 不改 `agent-loop`；除新命令包自身的 bundle 行外不向出厂组合挂载任何东西；适应性记忆契约笔记仍是记忆行为的权威。

## Risks

- **subagent effort 缺口**:`AgentOptions` 没有 effort 字段、workflow `agent()` 拒绝 effort，所以分阶段 effort 作用于主会话请求；subagent 阶段走默认模型路由。若阶段质量受影响，seam 需要加 effort 通道（后续）。
- **验证门依赖部署配置**：没有 `verifyCommand` 时 VERIFY 阶段必须诚实降级（报告 `unverified`，绝不宣称成功）。
- **scripted provider 保真度**：组合测试是模拟阶段；首次真实运行才可能暴露 prompt 层问题（planner/critic 人设）。
- **评审回环经济性**：每次 critique/review 都是一整份额外上下文；Config 限界，但长 SPEC 会让阶段变贵。

## 实现纪要：多方案选优

PLAN 可以就同一 SPEC 并行扇出 N 个候选规划者（`planCandidates`,1..5，缺省 1——单方案路径与原始状态机逐字节一致）。N > 1 时，PLAN 与 CRITIQUE 之间插入 SELECT 阶段：一个独立的全新上下文裁判只看到 SPEC.md 与候选文本——永远看不到任何规划者的推理——按固定评分量规（对照验收条件的正确性、可行性、范围契合、风险）打分，返回 `{winner, rationale, mergeHints?}`。选优从不由规划者自己完成：自评偏差正是全新上下文规则要消除的东西。候选落盘为 `PLAN-1.md … PLAN-N.md`（各以 `maxCandidateChars` 限界），胜出者成为 `PLAN.md`，裁判的裁决记录单独存为 `SELECTION.md` 而非追加进计划，保持 PLAN.md 是规划者自己的文本。winner 越界或非整数时在边界大声失败。`select` 阶段事件携带 `{candidates, winner, rationale}`，选优可从日志审计；裁判沿用 `critique` 的 effort 条目，除非部署方单独映射 `select`。CRITIQUE 随后照旧在选出的 PLAN.md 上运行，批评修订轮会重新扇出 N 个候选并重新选优。

## 实现纪要：后台运行与会话内进度（2026-08-18）

命令 handler 原本同步跑完整条流水线：调用界面会卡死数分钟，且阶段工作在最终结果前完全不可见。现在 handler 先同步做能力预检（配置错误仍在命令时即答），随后后台启动状态机并立即应答；每一行进展同时以追加的插件 notice 消息（`form: 'notice'`，尾部追加——缓存安全，model-visible ⟺ logged）落进会话，进度、最终汇总与失败在对话中实时可见。测试经导出的 `pendingRuns` 映射等待后台运行结束。
