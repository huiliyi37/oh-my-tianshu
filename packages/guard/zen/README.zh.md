# @huiliyi37/dsh-zen

[English](README.md) | 中文

zen 阶段是内建的 agent（智能体）生命周期阶段，而非 skill（技能）：新建顶层会话的最初几个步骤运行在一个最小的锚定工具 face 上——官方 DeepSeek 评测配方（`bash`、`str_replace_editor`、`todo_write`）加 agent 作用域的 `zen_anchor`——同时一段 `zen:policy` 提示词段落指示模型锚定任务：重述目标，用只读探针验证一个地标，然后调用 `zen_anchor`。由宿主验证的谓词把会话晋升（promotion）到完整 face；绝不采信模型自称已就绪。决策记录与消融证据见 [zen 阶段 Agent Note](../../../.agents/notes/implemented/architecture/2026-08-17-zen-phase-engineering-paradigm.md)。

消融实验依据（五组实验、真实 DeepSeek API、[结果数据](../../../examples/headless-agent/zen-ablation-results.json)）：双工具最小 face 完全消除了浪费的工具调用（每任务 0 次，对比 35 个 schema 的 face 上的 3.0 次），token 用量仅为宽 face 的 39%；而在宽 face 上叠加 zen 指引反而更糟——face 缩减才是起效成分，这正是该阶段物理收窄 face、而非好言相劝的原因。

## 配置

```yaml
- id: zen
  name: '@huiliyi37/dsh-zen'
  config:
    section: |                    # REQUIRED; the zen:policy guidance text
      Zen phase — the toolset is reduced while you anchor the task. …
    face: [bash, str_replace_editor, todo_write]  # default; global tools visible while zen
    timeoutSteps: 4               # default; step budget before automatic promotion
    requireEvidence: true         # default; zen_anchor demands ≥1 successful probe first
    triage:
      enabled: true               # default; skip the phase for trivially short first messages
      maxChars: 80                # default; single-line text-only threshold
    enabled: true                 # default; false mounts the service with no behavior
```

空白 `section`、未知键、空的或含重复项的 `face`、`face` 中列出 `zen_anchor`、以及非正数预算，都会让 `resolveConfig` 在插件加载时大声失败。`face` 若列出未注册的全局工具，则在 `agent/created` 处失败——同步监听器失败会否决发布，因此配置错误的部署不可能无声地跑在无限制状态下。

## 阶段机制

- **武装（arm）**——在 `agent/created`（driver 与首次组装之前），插件在 agent 作用域上注册 `zen_anchor`，安装 `ctx.tools.restrict({ allow: face })`，并记录 `zen/phase {phase: 'zen', reason: 'arm'}`。因此第一条 `request/header` 就已携带锚定 face：「模型可见 ⟺ 已记录」无需任何额外簿记即成立。
- **subagent 从不武装**——带 `header.parentSession` 的会话保留由派发方拥有的工具 profile；派发提示词本身就是它的锚点。
- **恢复与 fork 折叠日志**——`foldZenPhase`（最后一条 `zen/phase` 生效）决定是重装该 face 还是保留完整 face；不存在会漂移的实时镜像。
- **晋升**——三个宿主谓词之一解除限制并记录 `zen/phase {phase: 'full', reason}`：
  - `anchor`——模型调用 `zen_anchor`，给出非空目标、2–4 个地标和一个 pass 级别，且（在 `requireEvidence` 下）日志中已有至少 1 条成功的非簿记类工具结果；裸锚定会连同「先探针」指令一起驳回给模型。
  - `timeout`——步骤预算耗尽。晋升在预算的最后一个步骤触发，解锁在下一次组装可见；一条插件来源的通知会告知模型。
  - `triage`——首条用户消息足够短（≤ `maxChars`、单行、纯文本），该阶段在首次请求组装之前即被跳过。
- **晋升之后**，`zen:policy` 段落折叠为空，`zen_anchor` 保持注册但调用即返回错误——跨越边界只改变限制本身，呼应计划模式的稳定目录规则。
- **纵深防御**——只要*日志中的*阶段仍是 zen，注册表 guard 就拒绝 face 之外的工具执行，与实时限制簿记相互独立。

`zen/phase` 序列受不变量检查（`@huiliyi37/dsh-zen/invariant`）：载荷在持久边界做形状校验，一个会话至多武装一次，晋升绝不重复记录。

## 模型体验

### zen 阶段的首次请求

#### 模型看到的内容

首次请求的工具列表是锚定 face 加 `zen_anchor`，系统提示词携带部署配置的 `section` 文本。其余一切不变。

#### Token 影响

宽 face 的 schema 从不进入最初几次请求：消融实验中最小 face 平均每任务 561 token，宽 face 则是 1446。唯一新增的是 `section` 文本。

#### KV Cache 影响

晋升会改变工具 schema 块，因此下一次请求要重填一次前缀（约 20k token 的未命中，按 DeepSeek 定价约合 0.009 美元）；而 zen face 的小前缀本身填充成本就更低，所以实测净效果为正。

### zen_anchor 调用与结果

#### 模型看到的内容

一个按 `generic` 渲染的工具：`goal`（一句话）、`landmarks`（2–4 个字符串）、`pass`（`fast | full | loop`）、可选的 `forbidden`。接受时返回 "Anchor accepted — the full toolset unlocks from your next step…"；拒绝时把「先探针」指令作为工具错误返回。

#### Token 影响

每个会话一对小体量的调用／结果，若首次锚定因缺少证据被拒则为两对。

#### KV Cache 影响

仅追加；它触发的 face 变化即上文已计入的晋升重填。

### 超时叙述

#### 模型看到的内容

当步数预算晋升会话时，下面这条通知会以插件来源用户消息的形式加入该步的消息中。

##### 超时通知

```markdown
Zen phase ended (step budget reached); the full toolset unlocks from your next step.
```

#### Token 影响

一句话，只出现一次，且仅在超时晋升时出现。

#### KV Cache 影响

仅追加。

## 已知限制与暂缓事项

- **不支持重入**——同一会话中后续的「新任务」不会重新武装该阶段；重入需要证据证明会话中途重新锚定抵得上它的前缀重填开销。
- **分诊（triage）是宿主启发式**——只看长度与形状；MVP 否决了边车分类器（零额外请求），未来它可以接在同一谓词后面。
- **face 宽度按部署静态固定**——检索轴（基于目录段落的 `tool_search`）推迟到部署超过约 50 个工具时再做。
- **锚定内容不做语义校验**——宿主检查结构与证据，不检查地标是否*选对了*；这仍由模型负责。
