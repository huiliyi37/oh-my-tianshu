# guard/ — 循环卫生 guard 家族

[English](README.md) | 中文

行为 guard 插件监视 agent loop（智能体循环）中的无效模式，并强制执行单次调用预算。guard 是核心服务和扩展点的自包含消费方，而非可替换能力。

## 把卫生从「提示」升级为「机制」

guard 把原本只能靠提示词传达的规则，变成 agent loop 上被强制执行、且经事件归账的机制。它们复用其它 dsh 能力相同的扩展点——`ctx.tools.guard`、`tools/execute`、`tools/post-execute`、`agent/pre-step` 与 `session/event`——要么丰富模型的下一次请求，要么否决一次调用。两档：

- **建议档**——`repeat-tool-guard` 把提醒折叠进下一次请求，但从不否决。
- **强制档**——`evidence-gate`、`agent-router`、`timeout-policy` 与 `zen` 否决、改派或门控工作。

## 验证与路由闭环

`evidence-gate` 与 `agent-router` 一起闭合了自主编码最关键的回路：

```text
tool outcomes → failure prediction (agent-router)
             → verification discipline (evidence-gate)
             → routing escalation (agent-router → native subagents)
             → results accounted back through session/event (evidence-gate)
```

归账复用会话事件流，因此零新通道：子代理的 `tool/call` → `tool/result` 配对与主代理一样被 `evidence-gate` 读到。

## 包

| 包 | 职责 | ctx key |
|---|---|---|
| [`evidence-gate/`](evidence-gate/README.md) | bugfix 义务的 RED-first 验证纪律 | `ctx.evidence` |
| [`agent-router/`](agent-router/README.md) | 失败预测路由 + 原生子代理派发 | `ctx.router` |
| [`repeat-tool-guard/`](repeat-tool-guard/README.md) | 针对重复工具调用的建议性提醒 | 监听工具/agent 事件 |
| [`timeout-policy/`](timeout-policy/README.md) | 以部署策略形式设置单次工具调用截止时间 | 注册 `tools/execute` 监听器 |
| [`zen/`](zen/README.md) | 锚定的最小初始 face + 宿主验证的晋升 | `ctx.zen` |
| [`task-card/`](task-card/README.md) | 首条消息任务卡改写，提升模型语义清晰度 | `ctx.taskCard` |
| [`intent-bridge/`](intent-bridge/README.md) | 主会话前的对齐模型澄清，任务卡交接 | `ctx.intentBridge` |
| [`pheromone/`](pheromone/README.md) | 文件级信息素信号 | 纯库 |

### evidence-gate — RED-first 验证

**义务**（`family` + `claim`）是验证纪律的单位。`bugfix` 族是 RED-first：修复的 GREEN 必须由 RED 背书——先有一个失败测试记为 `red:` 证据——门才会放行对源码的编辑。

- **L1 编辑门**在 high-risk `bugfix` 义务尚无 RED 证据时，拦截对目标源文件的首次编辑。同一义务只拦一次（原样重发本次编辑即放行），并豁免测试/scratch 路径——它们本身就是 RED 动作。
- **TDD 门**统计连续无验证的编辑次数；达阈值（默认 3）时建议，`{ tddMode: 'enforce' }` 下硬拦截。
- **L2 终审门**（`evaluateFinal`）裁决任务收尾：`allow`、`continue_once`（带精准 RED 探针建议）、或 `honest_blocked`（披露未决义务）。

验证检测零测试框架耦合：插件读取 `tool/call` 命令与 `tool/result` 输出，从命令文本（`vitest`、`pytest` 等）加输出标记判定 `passed` / `failed` / `blocked`，再套用 RED 规则。探针建议在目标已被覆盖后从 `targeted_test`（期望失败）降级为 `grep`，冷却表抑制反复无信息的探针。细节见 [evidence-gate README](evidence-gate/README.md)。

### agent-router — 失败预测路由

**预测累计器**在工具结果上滑动 10 轮窗口，由错误率派生干预级别：≥0.4 `hint`、≥0.6 `gate`、≥0.8 `escalate`；连续三次成功重置窗口（环境已恢复）。**确定性路由表**再把指标映射为动作，优先级降序：

1. `escalate` → 派发 `verifier` 子代理（独立复核）；
2. `gate` 且探针冷却耗尽 → 派发 `code_scout` 子代理（新角度侦查）；
3. 义务未决 + 零验证 → `self`（先写探针——编辑门已在拦编辑）；
4. 否则 `self`。

派发是 dsh 原生：`ctx.agents.create` → `followup` 注入任务 → `whenIdle` 等待 → `dispose` 清理；每个 profile 限制子代理工具集（读/搜索/bash）。结果经 `session/event` 归账回 `evidence-gate`。细节见 [agent-router README](agent-router/README.md)。

### repeat-tool-guard — 重复调用提醒

每个 agent 的相同调用链（参数深键排序后序列化，属性顺序无关）在可配置阈值（默认 3、5、8）触发提醒。它观察并丰富——从不否决——用户插话会重置链。细节见 [repeat-tool-guard README](repeat-tool-guard/README.md)。

### timeout-policy — 单次调用截止时间

一个 `tools/execute` 包装器，把工具声明的截止时间（`timeoutMs`）武装到 `exec.signal`，并在自己的定时器触发时把结果替换为结构化的 `TOOL_TIMEOUT`——不竞争、不放弃工具 promise。细节见 [timeout-policy README](timeout-policy/README.md)。

### zen — 锚定初始 face

新建顶层会话的最初几个步骤运行在一个最小的锚定工具 face 上（默认：官方 DeepSeek 评测配方加 `zen_anchor`），并置于一段 `zen:policy` 提示词段落之下；宿主验证的谓词——带探针证据的有效锚定、步骤预算超时、或首条消息分诊（triage）——通过解除 agent 作用域的 `tools.restrict` 晋升到完整 face。阶段状态就是持久的 `zen/phase` 事件，读取时折叠。细节见 [zen README](zen/README.md)。

### pheromone — 文件级信息素

会话级空间记忆：信号（`fragile`、`well-tested`、`entry-point`、`dead-end`、`coupling-hub`）指数衰减（半衰期 7 天），LRU 容量控制，原子持久化到 `.rivet/pheromones.json`。它是纯库；信号源（测试失败 RED、读/编辑痕迹）由消费插件接线。细节见 [pheromone README](pheromone/README.md)。

## guard 如何触达模型

建议性提醒作为 `additionalContexts` 随 `tools/post-execute` 瀑布传递，并以插件来源的 `user/message` 事件记录，因此可日志化、可重建。强制否决返回 reason 字符串，循环把它作为被拦调用的工具结果交付——模型看到原因并可据此行动（[工具子系统](../../docs/subsystems/tools.md)）。

跨 `dsh-timeout`、能力方终止与本策略层的超时拆分记录在[超时库 Agent Note](../../.agents/notes/implemented/architecture/2026-07-06-timeout-deadline-library.md)。
