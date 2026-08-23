# Agent Note: zen 阶段——锚定初始 face 的生命周期范式

Status: implemented

[English](2026-08-17-zen-phase-engineering-paradigm.md) | 中文

## 问题

当首次请求就携带完整部署面时，模型在任务的最初几个轮次表现退化：候选集越大，工具选择质量越低（外部证据把拐点定在约 20 个工具附近，小模型受害最深）；浪费的调用落在看似合理实则错误的工具上；schema 块占据首次请求 token 的大头。DeepSeek 自己公开发布的评测 harness 跑的是双工具最小 face（`bash` + `str_replace_editor`）——产品发货的却是约 35 个 schema。J-Space、deep-brainstorm 这类要求模型「先思考」的 skill（技能）属于模型侧纪律：既缩不小候选集，也无法强制执行，被无视时宿主还毫不知情。用户的定调：任务开局需要一个 *zen 模式*——是 harness 里的工程范式，而不是又一个 skill。

## 决策

zen 阶段是内建的 agent（智能体）生命周期阶段，由 `packages/guard/zen`（`@huiliyi37/dsh-zen`，ctx key `zen`）拥有，挂载在 TUI bundle patch 中：

- **锚定初始 face。**在 `agent/created`（driver 与首次组装之前、具备否决能力的 seam）处，新建顶层会话获得 `ctx.tools.restrict({ allow: face })`——默认值为官方评测配方（`bash`、`str_replace_editor`、`todo_write`）加一个 agent 作用域的 `zen_anchor` 工具——并记录 `zen/phase {'zen', 'arm'}`。`request/header` 本就记录模型看到的每个 face，因此「模型可见 ⟺ 已记录」不花任何代价即成立。
- **晋升（promotion）由宿主验证，绝不采信自我声明。**三个谓词晋升到完整 face：经校验的 `zen_anchor` 调用（非空目标、2–4 个地标、pass 级别，且默认要求日志中已有至少 1 条成功的非簿记类工具结果）、带注入叙述的步骤预算超时、或首条消息分诊（triage；足够短的单行提示词在首次请求之前直接跳过该阶段）。晋升先追加 `zen/phase {'full', reason}`，再解除 zen 允许列表（若设置了 `promoteDeny` 则安装该拒绝列表；TUI 发货 `BASH_OVERLAP_TOOLS`）；段落文本按日志折叠为空，因此恢复／fork 重建 face 时没有实时镜像。
- **配置错误大声失败。**配置校验在插件加载时抛错；`face` 或 `promoteDeny` 列出任何插件都不注册的名字，则经 `agent/pre-step` 瀑布大声失败——`agent/created` 处的武装只取注册表当下已有的名字子集，因为等待注入服务的插件注册更晚，前门可能先一步到达该 seam（见[延迟武装 note](../bug-fix/2026-08-23-zen-section-pruning-deferred-arming.md)）；`agent/session-start` 的监听器错误会被循环*包住*这一既有约束，依旧把那个 seam 排除在外。
- **纵深防御。**只要*折叠后的日志*仍显示 zen，`ctx.tools.guard` 就拒绝 face 之外的执行，与实时 restrict 簿记相互独立；`zen/phase` 序列本身受不变量检查（持久边界的形状校验、至多武装一次、full 之后不再重复记录）。
- **正交组合。**preset 选择会话的 roster（哪些工具存在），zen 把 roster 的暴露按时间分阶段，计划模式按权限门控变更操作，skill 仍是模型侧纪律。subagent 会话（设置了 `header.parentSession`）从不武装——它们的派发提示词就是锚点，其 profile 由路由方拥有。

## 调研碎片池（5 路侦察，已浓缩）

- **定量**——工具选择准确率随候选集增大而拐弯，在小模型上垮得最狠；检索限定的子集在外部基准上把 13.6% 拉回 43%（[RAG-MCP／Writer–Anthropic 记述](https://tianpan.co/blog/2026-04-19-over-tooled-agent-problem)）；DeepSeek 官方编码评测使用的双工具最小配方，正是本阶段采用的默认 face。
- **已吸收进设计的反证**——「永远先规划」被证伪（收益曲线在 3–6 步任务处交叉）→ 分诊跳过；可见但被拒的工具会引发空转事件 → 物理 face 缩减，而非软性权限；「模型自称已锚定」可被作假 → 以工具调用加宿主校验为谓词；晋升会重填一次 schema 前缀，因此缓存不构成反对单次晋升的理由。
- **已有先例**——Anthropic Tool Search（延迟加载工具 schema）、Claude Code 计划模式（权限轴，带经评审的退出）、OpenAI `allowed_tools`（按请求子集）。OpenMythos 是一个 loop-depth transformer 复刻；可迁移的只有其结构隐喻（常驻核心 face／阶段信号／冻结输入重注入）。
- **神经科学映射（只借命名，不借机制）**——锚定 face ≈ 丘脑门控（先于皮层过滤）；zen 指引 ≈ 任务集预脉冲；晋升 ≈ DMN→任务正激活切换；锚定结构 ≈ 地标优先的空间编码，配 4±1 的组块（chunk）预算。
- **seam 调研**——`ctx.tools.restrict()` 对齐全部四个暴露面（wire／查找／执行／SDK），`request/header` 的变更记录让每个 face 可审计；`agent/created` 是首次组装之前唯一监听器失败即否决的 seam；pre-step 在组装之后运行，其效果要到下一步骤才落地。

## 考虑过的替代方案

- **权限轴（可见但被拒）**——已出局：它不减少首次请求的干扰，外部空转事件表明它不是替代品；其两个值得保留的特性（guard 兜底、显式解锁工具）已并入本设计。
- **检索轴（`tool_search` 元工具 + 按需追加 schema）**——推迟：剩余病根是与 `bash` 的意图重叠，而不是目录计数，因此以数量为门槛的检索轴不是下一步。
- **边车（sidecar）分诊模型**——MVP 阶段否决：宿主启发式零额外请求；谓词边界日后可接入分类器而无需重新设计。
- **纯 skill 的 zen（把 J-Space／OpenMythos 写成 SKILL.md）**——否决其作为主机制：无法强制执行、对宿主不可见，且没有 face 缩减的指引适得其反。
- **在 `agent/session-start` 武装**——发现其监听器错误会被包住后否决：配置错误的 face 会无声跳过该阶段，而不是让创建失败。

## 后果

- 新建顶层会话的最初几个步骤只面对不超过 4 个 schema 加锚定工具，而非约 35 个，代价是每个晋升会话一次 schema 前缀重填，多步骤任务多一次锚定往返。
- 该阶段是部署策略，完全由配置拥有（`section`、`face`、`timeoutSteps`、`requireEvidence`、`triage`、`faceSelection`、`diet`、`promoteDeny`、`enabled`）——想保持原有行为的 bundle 设 `enabled: false` 即可。
- 新的持久事件 `zen/phase` 加入会话词汇；消费方折叠它（最后一条生效），而不是镜像状态。
- TUI 已接线的工具表面（memory、session-query、vision）在每个新建会话的 zen 阶段期间隐藏；分诊启发式与步骤预算限定隐藏多久。
- TUI 顶边状态栏在相位布防期间渲染 `禅` 徽章（`preset-surface.ts` 中 `zenPhaseLabel` 折叠已记录的 `zen/phase`；晋升或 compaction 剪除后消失），发货默认值编码官方 minimal 配方 + `todo_write` + `subagent`、4 步预算、经裁剪的 `promoteDeny`。检索仍推迟，因为轴是重叠不是计数。

## 测试

- `packages/guard/zen/tests/zen.spec.ts`——配置大声失败用例表、折叠语义、证据谓词。
- `packages/guard/zen/tests/integration.spec.ts`——脚本化模型的完整循环运行：首个 header 的 face 快照，带 header 变更断言的锚定／超时／分诊晋升，裸锚定拒绝，zen 期间的执行拒绝，配置错误在 pre-step 大声失败，subagent 排除，已武装／已晋升种子的折叠，`enabled: false`。
- `packages/guard/zen/tests/invariant.spec.ts`——载荷形状与序列不变量，覆盖实时与迟注册两种情形。
- `packages/tui/tui/tests/bundle-patch.spec.ts`——TUI patch 挂载 `zen` 行，带非空 section、含 `subagent` 的 `face`、等于 `BASH_OVERLAP_TOOLS` 的 `promoteDeny`，以及 diet。

## 相关

- [TUI 天枢能力 roster](../feature/2026-08-17-tui-bundle-tianshu-capability-roster.md)——本阶段随之发货的接线批次。
- [Repeat-tool-guard](../../archived/feature/2026-07-08-repeat-tool-guard.md)——guard 家族的建议档；本包这个强制档阶段与它并列。
