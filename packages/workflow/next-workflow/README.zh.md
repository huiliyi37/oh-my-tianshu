# @huiliyi37/dsh-next-workflow

[English](README.md) | 中文

面向人类的 `/next-workflow <objective>` 命令运行一条固定的、由 harness 持有的相位机——INTENT → PLAN → CRITIQUE → IMPLEMENT → VERIFY → REVIEW。编排由 harness 持有，模型只写内容。插件注册在 [`ctx.commands`](../../interaction/commands/README.md) 上，因此每个已装配的命令适配器（TUI、web）无需客户端改动即可发现并执行它。设计理由归 [intent-pipeline Agent Note](../../../.agents/notes/proposed/feature/2026-08-17-next-workflow-intent-pipeline.md) 所有。

## 流水线

- **INTENT**——一个结构化输出 subagent（经 [`ctx.subagents`](../../subagent/subagent/README.md)）把目标归一化为 `SPEC.md`（目标、约束、影响面、验收条件，并附原始目标原文）。选择结构化输出 subagent 而非确定性模板：原样转储目标不产生归一化价值。
- **PLAN**——规划 subagent 把 SPEC 变成 `PLAN.md`：有序步骤，逐一指明涉及的文件与接口，并显式声明出界范围。
- **CRITIQUE**——全新上下文的批评者只看到 SPEC.md 与 PLAN.md，永远看不到规划者的推理过程，返回 `{ verdict, gaps[] }`。实质性缺口回环到 PLAN，由 `maxCritiqueRounds`（默认 1）限界。
- **IMPLEMENT**——编排器用内联的 SPEC 与 PLAN steer 调用方会话自己的 agent，实现过程在用户工作区中实时运行、拥有完整工具面。
- **VERIFY**——确定性闸门：配置的 `verifyCommand` 经 [`ctx.bash`](../../bash/bash/README.md) 的 request/spec 分离在会话工作区中运行。失败时把限界后的闸门输出 steer 回去重试一次（`maxVerifyRetries`，默认 1）；耗尽后以 `failed-verification` 收尾——错误结果，绝不静默成功。未配置 `verifyCommand` 时 VERIFY 如实报告 `unverified`，运行继续进入 REVIEW。
- **REVIEW**——全新上下文的评审者看到 SPEC.md 与工作区 diff（优先 `ctx.git`，回退到经 bash 的 `git diff HEAD`，再退化为显式的不可用标记），返回 `{ verdict, findings[] }` 并写入 `REVIEW.md`。评审者 persona 把 findings 严格限定在正确性与既定需求上，评审者无法发明新工作。

产物位于 `<workflowsRoot>/<run-id>/{SPEC,PLAN,REVIEW}.md`（默认根 `$DSH_HOME/workflows`），压缩后仍然存活。每次相位转移与产物路径都是 log-only 会话事件（`next-workflow/phase`、`next-workflow/end`），因此整个运行可以从会话日志加产物文件重建。产物写入是承重的：写失败则整个运行大声失败。

运行期间，挂在调用方 agent 上的 `agent/request` waterfall 监听器按 `phaseEfforts` 映射逐相位改写 `reasoningEffort`（默认 plan/critique/review 为 `high`；未映射的相位继承）。切换只发生在相位边界，运行结束后的第一个请求会恢复运行前的 header effort。

## 命令契约

| 输入 | 结果 |
|---|---|
| `/next-workflow <objective>` | 运行流水线；成功时汇总各相位、verdict 与产物路径。verify 重试耗尽时以指明 `failed-verification` 的错误收尾。 |
| `/next-workflow`（空输入） | `Usage: /next-workflow <objective>`——不启动任何运行。 |
| 能力缺失 | 指明缺失接缝的不可用错误：无 subagents 服务、provider 未注册或能力不足（需要结构化输出、persona、全新上下文）、或配置了 `verifyCommand` 但没有 bash 执行器。 |
| 会话上已有活跃运行时再次运行 | `already running` 错误；每个会话同时只有一个运行。 |

## 装配

插件只注入 `commands`；subagent provider、bash 执行器与 git 服务都在处理器执行时探测，因此随发布的基础行保持中性：

```yaml
- id: commands
  name: '@huiliyi37/dsh-commands'
- id: next-workflow
  name: '@huiliyi37/dsh-next-workflow'
```

## 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `provider` | `spawn` | 各相位共用的一次性结构化输出 subagent provider。 |
| `workflowsRoot` | `$DSH_HOME/workflows` | 产物根目录；每次运行一个 `<run-id>` 目录。 |
| `verifyCommand` | 未设置 | 确定性 VERIFY 闸门命令；未设置则报告 `unverified`。 |
| `verifyTimeoutMs` | `120000` | 单次闸门运行的超时。 |
| `maxCritiqueRounds` | `1` | 批评驱动的 PLAN 修订上限。 |
| `maxVerifyRetries` | `1` | verify 失败后 steer 回 IMPLEMENT 的重试上限。 |
| `phaseEfforts` | `{ plan: high, critique: high, review: high }` | 主会话请求的逐相位 reasoning effort；未知相位键在加载时报错。 |
| `maxArtifactChars` | `32768` | 单个相位产物的字符上限。 |
| `maxVerifyOutputChars` | `8192` | 失败时 steer 回去的闸门输出字符上限。 |
| `maxDiffChars` | `32768` | 提供给评审者的 diff 字符上限。 |

所有值在插件应用时归一化并校验，包括未经 Loader schema 归一化的直接 `apply()` 调用。

## 模型体验

### `/next-workflow` 运行

#### 模型看到什么

各相位 subagent 看到自己的静态 persona 和一个只携带本相位产物的 prompt——批评者看到 SPEC + PLAN，评审者看到 SPEC + diff——外加结构化输出契约。调用方会话的模型看到 IMPLEMENT steer（一条已落日志的 user 角色消息，内联 SPEC 与 PLAN），以及闸门失败时一条携带限界闸门输出的重试 steer。人类看到命令结果摘要。所有模型可见内容都可以从会话日志与产物文件重建。

#### token 影响

每个相位都是一个全新的 subagent 上下文；主会话只承担实现轮次的开销。`maxArtifactChars` 限制每个产物，`maxDiffChars` 限制评审 diff，`maxVerifyOutputChars` 限制 steer 回去的闸门输出。

#### KV 缓存影响

effort 切换按设计在相位边界打破请求前缀缓存——相位边界是合法的缓存切换点，运行结束后会恢复运行前的 effort。产物以文件形式在相位间流转，绝不作为重新塞入的上下文。subagent persona 是逐字节稳定的静态字符串，重复运行可以复用各角色的前缀。

## 已知限制与延后工作

- **subagent effort 缺口**——`AgentOptions` 没有 effort 通道，因此 `phaseEfforts` 只作用于调用方会话的请求；plan/critique/review subagent 保持默认模型路由。subagent 接缝上的 effort 通道是后续工作。
- **脚本化 persona 保真度**——组合测试模拟各相位 subagent；真实模型运行可能暴露规划者/批评者/评审者 persona 的 prompt 层问题，只有真实模型才能暴露。
- **verify 闸门需要部署配置**——未配置 `verifyCommand` 时运行报告 `unverified` 而非完成验证；挂载 `guard/evidence-gate` 作为验证器是延后工作。
- **实现不做隔离**——IMPLEMENT steer 调用方会话以获得实时可见性与完整工具面；由配置路由的隔离实现 subagent 是延后工作。
- **批评循环的经济性**——每次批评与评审都是一整份额外上下文；由配置限界，但长 SPEC 会让相位变贵。
