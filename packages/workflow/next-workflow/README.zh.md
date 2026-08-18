# @huiliyi37/dsh-next-workflow

[English](README.md) | 中文

面向人类的 `/next-workflow <objective>` 命令运行一条固定的、由 harness 持有的相位机——INTENT → PLAN → CRITIQUE → IMPLEMENT → VERIFY → REVIEW，当 `planCandidates` 大于 1 时在 PLAN 与 CRITIQUE 之间插入可选的 SELECT 相位。编排由 harness 持有，模型只写内容。插件注册在 [`ctx.commands`](../../interaction/commands/README.md) 上。设计约定：[Agent Note](../../../.agents/notes/implemented/feature/2026-08-17-next-workflow-intent-pipeline.md)。任何发货组合都不挂载本插件。

## 流水线

- **INTENT**——一个结构化输出 subagent（经 [`ctx.subagents`](../../subagent/subagent/README.md)）把目标归一化为 `SPEC.md`（目标、约束、影响面、验收条件，并附原始目标原文）。选择结构化输出 subagent 而非确定性模板：原样转储目标不产生归一化价值。
- **PLAN**——规划 subagent 把 SPEC 变成 `PLAN.md`：有序步骤，逐一指明涉及的文件与接口，并显式声明出界范围。`planCandidates` 大于 1 时，PLAN 并行扇出为对应数量的规划 subagent（同一 SPEC，自由发散），写出 `PLAN-1.md … PLAN-N.md`。
- **SELECT**（仅当 `planCandidates` > 1）——一个独立的全新上下文裁判 subagent 看到 SPEC.md 与全部候选文本，按固定评分量规（对照验收条件的正确性、可行性、范围契合、风险）打分，返回 `{ winner, rationale, mergeHints? }`。选优从不由规划者自己完成（自评偏差）。胜出候选成为 `PLAN.md`；裁决记录写入 `SELECTION.md`。winner 越界则整个运行大声失败。
- **CRITIQUE**——全新上下文的批评者只看到 SPEC.md 与 PLAN.md，永远看不到规划者的推理过程，返回 `{ verdict, gaps[] }`。实质性缺口回环到 PLAN，由 `maxCritiqueRounds`（默认 1）限界。
- **IMPLEMENT**——编排器用内联的 SPEC 与 PLAN steer 调用方会话自己的 agent，实现过程在用户工作区中实时运行、拥有完整工具面。
- **VERIFY**——确定性闸门：配置的 `verifyCommand` 经 [`ctx.bash`](../../bash/bash/README.md) 的 request/spec 分离在会话工作区中运行。失败时把限界后的闸门输出 steer 回去重试一次（`maxVerifyRetries`，默认 1）；耗尽后以 `failed-verification` 收尾——错误结果，绝不静默成功。未配置 `verifyCommand` 时 VERIFY 如实报告 `unverified`，运行继续进入 REVIEW。
- **REVIEW**——全新上下文的评审者看到 SPEC.md 与工作区 diff（优先 `ctx.git`，回退到经 bash 的 `git diff HEAD`，再退化为显式的不可用标记），返回 `{ verdict, findings[] }` 并写入 `REVIEW.md`。评审者 persona 把 findings 严格限定在正确性与既定需求上，评审者无法发明新工作。

产物位于 `<workflowsRoot>/<run-id>/`（默认根 `$DSH_HOME/workflows`）：`SPEC.md`、`PLAN.md`、`REVIEW.md`，多方案运行另有 `PLAN-1.md … PLAN-N.md` 与 `SELECTION.md`；全部在压缩后存活。每次相位转移与产物路径都是 log-only 会话事件（`next-workflow/phase`、`next-workflow/end`），`select` 事件还携带 `{ candidates, winner, rationale }`，因此整个运行——包括方案选优——可以从会话日志加产物文件重建。产物写入是承重的：写失败则整个运行大声失败。

运行期间，挂在调用方 agent 上的 `agent/request` waterfall 监听器按 `phaseEfforts` 映射逐相位改写 `reasoningEffort`（默认 plan/critique/review 为 `high`；未映射的相位继承）。切换只发生在相位边界，运行结束后的第一个请求会恢复运行前的 header effort。

## 命令契约

| 输入 | 结果 |
|---|---|
| `/next-workflow [candidates] <objective>` | 运行流水线；前导整数（1–5）覆盖本次运行的 `planCandidates`（`/next-workflow 3 …` = 三方案选优），不带则用 Config 缺省值。成功时汇总各相位、verdict 与产物路径。verify 重试耗尽时以指明 `failed-verification` 的错误收尾。 |
| `/next-workflow`（空输入） | `Usage: /next-workflow [candidates] <objective>`——不启动任何运行。 |
| 能力缺失 | 指明缺失接缝的不可用错误：无 subagents 服务、provider 未注册或能力不足（需要结构化输出、persona、全新上下文）、或配置了 `verifyCommand` 但没有 bash 执行器。 |
| 会话上已有活跃运行时再次运行 | `already running` 错误；每个会话同时只有一个运行。 |

## 装配

插件只注入 `commands`；subagent provider、bash 执行器与 git 服务都在处理器执行时探测。在 overlay 里挂载。`dsh-base` 与发货 TUI/Web bundle 不挂。IMPLEMENT 会 steer 调用方会话，禅锚定面下实现只会看到锚定工具——挂载本插件的宿主应在晋升之后，或不挂禅。plan-mode 与 `tool-ralph` 仍是独立表面。

```yaml
- id: commands
  name: '@huiliyi37/dsh-commands'
- id: next-workflow
  name: '@huiliyi37/dsh-next-workflow'
  config:
    verifyCommand: pnpm test
```

## 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `provider` | `spawn` | 各相位共用的一次性结构化输出 subagent provider。 |
| `workflowsRoot` | `$DSH_HOME/workflows` | 产物根目录；每次运行一个 `<run-id>` 目录。 |
| `verifyCommand` | 未设置 | 确定性 VERIFY 闸门命令；未设置则报告 `unverified`。 |
| `verifyTimeoutMs` | `120000` | 单次闸门运行的超时。 |
| `maxCritiqueRounds` | `1` | 批评驱动的 PLAN 修订上限。 |
| `planCandidates` | `1` | 每轮 PLAN 的候选方案数（1–5）；大于 1 时由独立裁判选出胜出方案。 |
| `maxCandidateChars` | `32768` | 单个候选方案的字符上限；裁判 prompt 以 `planCandidates` × 该值为界。 |
| `maxVerifyRetries` | `1` | verify 失败后 steer 回 IMPLEMENT 的重试上限。 |
| `phaseEfforts` | `{ plan: high, critique: high, review: high }` | 主会话请求的逐相位 reasoning effort；未知相位键在加载时报错；`select` 未单独映射时沿用 `critique` 条目。 |
| `maxArtifactChars` | `32768` | 单个相位产物的字符上限。 |
| `maxVerifyOutputChars` | `8192` | 失败时 steer 回去的闸门输出字符上限。 |
| `maxDiffChars` | `32768` | 提供给评审者的 diff 字符上限。 |

所有值在插件应用时归一化并校验，包括未经 Loader schema 归一化的直接 `apply()` 调用。

## 模型体验

### `/next-workflow` 运行

#### 模型看到什么

各相位 subagent 看到自己的静态 persona 和一个只携带本相位产物的 prompt——批评者看到 SPEC + PLAN，裁判看到 SPEC + 全部候选方案，评审者看到 SPEC + diff——外加结构化输出契约。调用方会话的模型看到 IMPLEMENT steer（一条已落日志的 user 角色消息，内联 SPEC 与 PLAN），以及闸门失败时一条携带限界闸门输出的重试 steer。人类看到命令结果摘要。所有模型可见内容都可以从会话日志与产物文件重建。

#### token 影响

每个相位都是一个全新的 subagent 上下文；主会话只承担实现轮次的开销。`maxArtifactChars` 限制每个产物，`maxDiffChars` 限制评审 diff，`maxVerifyOutputChars` 限制 steer 回去的闸门输出。多方案选优会放大规划成本：N 份规划上下文，外加一份装入 SPEC 与全部 N 个候选文本的裁判上下文（以 `planCandidates` × `maxCandidateChars` 为界）。它在目标含糊或架构性任务上物有所值——方案质量主导下游一切开销；在机械性任务上候选会趋同，额外上下文纯属浪费——保持 `planCandidates` 为 1。

#### KV 缓存影响

effort 切换按设计在相位边界打破请求前缀缓存——相位边界是合法的缓存切换点，运行结束后会恢复运行前的 effort。产物以文件形式在相位间流转，绝不作为重新塞入的上下文。subagent persona 是逐字节稳定的静态字符串，重复运行可以复用各角色的前缀。

## 已知限制与延后工作

- **subagent effort 缺口**——`AgentOptions` 没有 effort 通道，因此 `phaseEfforts` 只作用于调用方会话的请求；plan/critique/review subagent 保持默认模型路由。subagent 接缝上的 effort 通道是后续工作。
- **脚本化 persona 保真度**——组合测试模拟各相位 subagent；真实模型运行可能暴露规划者/批评者/评审者 persona 的 prompt 层问题，只有真实模型才能暴露。
- **verify 闸门需要部署配置**——未配置 `verifyCommand` 时运行报告 `unverified` 而非完成验证；挂载 `guard/evidence-gate` 作为验证器是延后工作。
- **实现不做隔离**——IMPLEMENT steer 调用方会话以获得实时可见性与完整工具面；由配置路由的隔离实现 subagent 是延后工作。
- **批评循环的经济性**——每次批评与评审都是一整份额外上下文；由配置限界，但长 SPEC 会让相位变贵。
- **多方案选优是成本乘数，不是质量保证**——每轮规划消耗 N 份规划上下文加一份裁判上下文，而裁判只能从规划者产出的候选中选；它无法超越最佳候选。规划者太弱时选优形同虚设。
- **不是禅的替代品**——IMPLEMENT steer 当前会话的完整工具面；禅锚定面是另一条产品，默认不能承载这条流水线。
- **不进发货组合**——包已上树；由宿主 overlay 挂载。缺省 `planCandidates` 保持 1。
