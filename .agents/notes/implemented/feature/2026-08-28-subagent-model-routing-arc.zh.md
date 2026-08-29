# Agent Note: 子代理模型路由弧——纯核心、持久策略与工具接线

Status: implemented

[English](2026-08-28-subagent-model-routing-arc.md) | 中文

Scope: `packages/subagent/subagent`、`packages/subagent/tool-subagent`，及全部 `SubagentProvider` 能力广告位

## 问题

委派工具此前只能在部署期配置子路由（`Config.agentOptions`）；模型无法把某个合适的子任务路由到不同的 provider/model/effort，而在无法承载路由的 provider 上，路由配置会被静默忽略。上游 `deepseek-ai/deepseek-harness` 在本仓基线之后发布了完整弧（底层 `2026-08-18-model-selected-subagent-routes`、授权 `2026-08-24-user-authorized-subagent-model-routes`）；本浪对其回流。

## 决策

**纯核心、持久策略、消费方——三个提交。** `model-selection.ts` 持有接缝的词汇与规则：精确 `{provider, model}` 路由做 fail-closed 校验（非空、去重），合并语义（provider 与 model 是一条路由必须成对；换有效路由而未点名 effort 时清除配置的路由自有 effort），执行器侧 allowlist 强制，以及经 `ctx.llm.resolveCallConfig()` 的预检。`model-selection-state.ts` 声明 log-only 的 `subagent/model-selection-policy` 会话事件（只落一次，在选择可被行使之前；缺席即固定路由定义）与读/记 API。`model-selection-settings.ts` 是 Host 自有的 `subagent-model-selection` 设置段，作为独立装配入口（默认关；启用需至少一条路由；在使用点采样，设置变更永不重建运行中的 Agent）。

**工具接线按每次委派调用消费策略——对上游 per-Agent 发布采样的刻意分叉。** 上游把工具实例挂载进 Agent 作用域并在 Agent 发布时采样设置，从无策略 Session 的 schema 中省略路由字段。本仓 `tool-subagent` 是由 `cordis.yml` 装配的部署级单实例；为复刻省略而把它重构成 per-Agent 挂载，是一次与收益不成比例的生命周期重写。因此只要配置了 `modelSelectionSettings`，schema 就携带三个路由字段，而策略在首次委派调用时解析：读会话已录事件（决策锚定在日志里）；否则父 agent 仍可达的子会话继承父会话事件（父子一致优先）；否则采样设置并记录一次。该采样覆盖顶层新会话、无锚定的 resume 旧顶层会话，以及父 agent 不可达的子会话（跨进程后端、孤儿 resume）——末者采样即上游 per-Agent 发布采样的等价路径，可能与不可达父会话的已锚定决策分叉。禁用 Session 仍看得到字段，但任何携带它们的调用都被拒绝（`child model selection is disabled for this tool instance`），且已录决策锚定在会话日志中——设置变更只影响尚未记录的会话。

**能力广告即传输事实。** `SubagentCapabilities` 增 `agentOptions` 为首位成员。服务在 `start` 之前拒绝广告 `false` 的 provider 上携带 `agentOptions` 的请求；工具挂载在 `Config.agentOptions` 撞上此类 provider 时失败——accepted-then-ignored 路径不复存在。进程内 provider（`fork`、`spawn`）广告 `true`；`acp` 与 `dsh-sdk` 广告 `false`。上游弧的 DSH SDK 半边（跨 SDK 协议的路由传输与 provider 的不可变 `agentRouteDefaults`）**未移植**：本仓 SDK 传输从未消费过 `agentOptions`，广告 `false` 保持诚实，而曾被静默忽略的配置路由现在 fail loud。`agentRouteDefaults` provider 面与引用它的 schema 描述变体已按形状移植以对齐终态；当前没有发布方，父请求头回退（`parentAgentOptionsForDelegation`，最新已录请求优先于创建选项并保留 `maxTokens`）是现役基线路径。

**预检关闭竞态。** 异步 `resolveCallConfig` 之后，工具复核同一 provider 实例仍在注册表，HMR 交换不能把一个 provider 的默认值配到另一个 provider 的进程上。父选项读取是惰性的——裸调用 agent（直接调用、测试替身）不触碰请求头路径。

**发现工具的注册跟随 fiber，而非 provider 可用性。** `list_subagent_models` 只读 llm 活目录与调用方会话的策略，因此在 `apply()` 中随 fiber 注册一次——绝不放在 `mount()` 内，否则 provider 消失/再现循环会重插全局单例名并抛 `tool "list_subagent_models" is already registered`，委派工具自此无法重新挂载。多个启用选择的实例共享同一份注册：resolver 按调用方会话解析、与实例无关，并发兄弟的工具可互换——注册 catch 在确认同作用域已有该工具后跳过，其余错误照常重抛。

未移植：上游的 `tool:subagent` 提示词指引段（本仓委派工具从未注册过；采纳它是独立的模型可见变更）、钉住上游 per-Agent 定义稳定性的 invariant 机制（本仓单实例只有一份静态定义）、以及 Web 管理卡片（后续浪）。

## 已考虑的替代方案

### 为什么不按上游在每个 Agent 上采样策略？

那需要本仓没有的 per-Agent 工具挂载。按调用解析保留了上游所有要紧的保证——每会话一个决策、持久落盘、父 agent 可达时子会话继承（否则与上游一样采样）、对设置热编辑免疫——代价只是在禁用 Session 上广告（而非隐藏）路由字段，执行器拒绝守住了授权边界。

### 为什么禁用时仍广告字段？

本仓的 schema 成员资格是部署级的；按会话省略需要上游的挂载模型。被拒绝的调用就是边界；字段只是惰性元数据。

### 为什么 SDK 停在 `false`？

不实现协议传输就广告 `true`，等于声称一次从未发生的路由选择。上游的 SDK 路由是自成一体的后续项。

### 为什么不把发现工具注册在 `mount()` 里？

最初的接线在 `mount()` 内注册 `list_subagent_models` 且未保存 disposer。provider 消失→再现循环（HMR、重连）会重跑 `mount()` 并重插全局单例名，从 `subagent/provider-added` 监听器抛出 `tool "list_subagent_models" is already registered`，委派工具自此无法挂载且没有恢复路径；两个启用选择的实例在加载时撞同一冲突。修复改为在 `apply()` 中随 fiber 注册一次，碰撞时共享兄弟实例的注册而非 fail loud：两侧 resolver 等价（策略按调用方会话解析），拒绝第二个实例只会阻碍一份完全相同且正确的行为。

## 后果

买到：带持久 per-Session 授权的模型可见子路由选择、前缀稳定的发现工具、所有 provider 上的能力诚实，以及本仓此前静默忽略配置处的 fail-loud。授权矩阵在工具/服务层已经完整，且 TUI 管理面随本弧落地：`/config` 的「子代理模型」类目（装配设置入口时出现）切换开关、原位移除授权路由、并经 provider/model 两级 picker 从 llm 活目录添加路由——全部走 settings 文档的修订 fence 写入。发现工具现在能扛过 provider 消失/再现循环（注册跟随 fiber，启用选择的兄弟实例共享同一份等价工具）；回归测试覆盖 re-add 循环、双实例共享、resume 会话采样与父可达继承。策略解析现在也以采样覆盖 resume 旧会话与父不可达子会话，而非拒绝每一次显式路由请求。留给后续浪的是 Web 管理卡片与 DSH SDK 传输。
