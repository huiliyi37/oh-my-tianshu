# Agent Note: zen 阶段——锚定初始 face 的生命周期范式

Status: implemented

[English](2026-08-17-zen-phase-engineering-paradigm.md) | 中文

## 问题

当首次请求就携带完整部署面时，模型在任务的最初几个轮次表现退化：候选集越大，工具选择质量越低（外部证据把拐点定在约 20 个工具附近，小模型受害最深）；浪费的调用落在看似合理实则错误的工具上；schema 块占据首次请求 token 的大头。DeepSeek 自己公开发布的评测 harness 跑的是双工具最小 face（`bash` + `str_replace_editor`）——产品发货的却是约 35 个 schema。J-Space、deep-brainstorm 这类要求模型「先思考」的 skill（技能）属于模型侧纪律：既缩不小候选集，也无法强制执行，被无视时宿主还毫不知情。用户的定调：任务开局需要一个 *zen 模式*——是 harness 里的工程范式，而不是又一个 skill。

## 决策

zen 阶段是内建的 agent（智能体）生命周期阶段，由 `packages/guard/zen`（`@huiliyi37/dsh-zen`，ctx key `zen`）拥有，挂载在 TUI bundle patch 中：

- **锚定初始 face。**在 `agent/created`（driver 与首次组装之前、具备否决能力的 seam）处，新建顶层会话获得 `ctx.tools.restrict({ allow: face })`——默认值为官方评测配方（`bash`、`str_replace_editor`、`todo_write`）加一个 agent 作用域的 `zen_anchor` 工具——并记录 `zen/phase {'zen', 'arm'}`。`request/header` 本就记录模型看到的每个 face，因此「模型可见 ⟺ 已记录」不花任何代价即成立。
- **晋升（promotion）由宿主验证，绝不采信自我声明。**三个谓词晋升到完整 face：经校验的 `zen_anchor` 调用（非空目标、2–4 个地标、pass 级别，且默认要求日志中已有至少 1 条成功的非簿记类工具结果）、带注入叙述的步骤预算超时、或首条消息分诊（triage；足够短的单行提示词在首次请求之前直接跳过该阶段）。晋升先追加 `zen/phase {'full', reason}`，再解除限制；段落文本按日志折叠为空，因此恢复／fork 重建 face 时没有实时镜像。
- **配置错误大声失败。**配置校验在插件加载时抛错；face 中列出未注册工具则在同步的 `agent/created` 监听器内抛错，从而否决 agent 发布——这里发现的约束是：`agent/session-start` 的监听器错误会被循环*包住*，在那里武装会把配置错误退化成无声跳过。
- **纵深防御。**只要*折叠后的日志*仍显示 zen，`ctx.tools.guard` 就拒绝 face 之外的执行，与实时 restrict 簿记相互独立；`zen/phase` 序列本身受不变量检查（持久边界的形状校验、至多武装一次、full 之后不再重复记录）。
- **正交组合。**preset 选择会话的 roster（哪些工具存在），zen 把 roster 的暴露按时间分阶段，计划模式按权限门控变更操作，skill 仍是模型侧纪律。subagent 会话（设置了 `header.parentSession`）从不武装——它们的派发提示词就是锚点，其 profile 由路由方拥有。

## 消融证据（Phase 0）

五组实验、真实 DeepSeek API（`deepseek-v4-flash`）、六个真实 TUI 风味任务（3 个简单／3 个多步骤）、21 个名字看似合理但执行即失败的干扰 schema；脚本 `examples/headless-agent/zen-ablation.mts`，数据 `examples/headless-agent/zen-ablation-results.json`：

| 组 | Face | 成功率 | 每任务浪费调用 | 锚定 face 首选率 | 平均 token |
|---|---|---|---|---|---|
| A 宽 face 直接运行 | 35 | 100% | 3.0 | 33% | 1446 |
| B 宽 face + zen 指引 | 35 | 100% | 4.3 | 17% | 1672 |
| C 最小 face 直接运行 | 2 | 100% | **0** | **100%** | **561** |
| D 最小 face + zen 指引 | 2 | 100% | **0** | **100%** | 1251 |
| E 宽 face 可见但被拒 | 35 | 100% | 4.0 | 17% | 954 |

按预注册判据的结论：C ≥ A 且 E 不优于 A ⇒ *目录轴*（物理收窄 face）才是起效的处理手段，可见但被拒不是替代品；B 差于 A ⇒ 单靠指引救不了宽 face；D 在简单任务上花掉 C 的 2.2 倍 token ⇒ 分诊跳过必不可少，锚定留给多步骤工作。采样卫生附带检查：DeepSeek 适配器只在显式配置时发送 `temperature`——产品什么都不固定，跟随提供方默认值。

## 调研碎片池（5 路侦察，已浓缩）

- **定量**——工具选择准确率在约 20 个候选附近出现拐点，在小模型上垮得最狠（有报告 84%→43%）；检索限定的子集在外部基准上把 13.6% 拉回 43%；DeepSeek 官方编码评测使用的双工具最小配方，正是本阶段采用的默认 face。
- **已吸收进设计的反证**——「永远先规划」被证伪（收益曲线在 3–6 步任务处交叉）→ 分诊跳过；可见但被拒的工具会引发空转事件 → 物理 face 缩减，而非软性权限；「模型自称已锚定」可被作假 → 以工具调用加宿主校验为谓词；DeepSeek 没有缓存断点，一次扩面重填约花 0.009 美元 → 缓存不构成反对晋升的理由。
- **已有先例**——Anthropic Tool Search（延迟加载工具 schema）、Claude Code 计划模式（权限轴，带经评审的退出）、OpenAI `allowed_tools`（按请求子集）。OpenMythos 是一个 loop-depth transformer 复刻；可迁移的只有其结构隐喻（常驻核心 face／阶段信号／冻结输入重注入）。
- **神经科学映射（只借命名，不借机制）**——锚定 face ≈ 丘脑门控（先于皮层过滤）；zen 指引 ≈ 任务集预脉冲；晋升 ≈ DMN→任务正激活切换；锚定结构 ≈ 地标优先的空间编码，配 4±1 的组块（chunk）预算。
- **seam 调研**——`ctx.tools.restrict()` 对齐全部四个暴露面（wire／查找／执行／SDK），`request/header` 的变更记录让每个 face 可审计；`agent/created` 是首次组装之前唯一监听器失败即否决的 seam；pre-step 在组装之后运行，其效果要到下一步骤才落地。

## 考虑过的替代方案

- **权限轴（可见但被拒）**——已出局：它不减少首次请求的干扰，实验组 E 加上外部空转事件表明它不是替代品；其两个值得保留的特性（guard 兜底、显式解锁工具）已并入本设计。
- **检索轴（`tool_search` 元工具 + 按需追加 schema）**——推迟到后续阶段，以部署超过约 50 个工具为门槛；本次建成的消融 harness 是它的前置条件。
- **边车（sidecar）分诊模型**——MVP 阶段否决：宿主启发式零额外请求；谓词边界日后可接入分类器而无需重新设计。
- **纯 skill 的 zen（把 J-Space／OpenMythos 写成 SKILL.md）**——否决其作为主机制：无法强制执行、对宿主不可见，且实验组 B 表明没有 face 缩减的指引适得其反。
- **在 `agent/session-start` 武装**——发现其监听器错误会被包住后否决：配置错误的 face 会无声跳过该阶段，而不是让创建失败。

## 后果

- 新建顶层会话的最初几个步骤只面对不超过 4 个 schema 加锚定工具，而非约 35 个：消融实验显示零浪费调用、首阶段 token 节省约 61%，代价是每个晋升会话一次前缀重填（约 0.009 美元），多步骤任务多一次锚定往返。
- 该阶段是部署策略，完全由配置拥有（`section`、`face`、`timeoutSteps`、`requireEvidence`、`triage`、`enabled`）——想保持原有行为的 bundle 设 `enabled: false` 即可。
- 新的持久事件 `zen/phase` 加入会话词汇；消费方折叠它（最后一条生效），而不是镜像状态。
- TUI 已接线的工具表面（memory、session-query、vision）在每个新建会话的 zen 阶段期间隐藏；分诊启发式与步骤预算限定隐藏多久。
- TUI 顶边状态栏在相位布防期间渲染 `禅` 徽章（`preset-surface.ts` 中 `zenPhaseLabel` 折叠已记录的 `zen/phase`；晋升或 compaction 剪除后消失），发货默认值已编码消融裁决（官方 minimal 配方 + `todo_write`、4 步预算）。检索轴（Phase 3）仍处于推迟状态；见 README 的已知限制。

## 测试

- `packages/guard/zen/tests/zen.spec.ts`——配置大声失败用例表、折叠语义、证据谓词。
- `packages/guard/zen/tests/integration.spec.ts`——脚本化模型的完整循环运行：首个 header 的 face 快照，带 header 变更断言的锚定／超时／分诊晋升，裸锚定拒绝，zen 期间的执行拒绝，配置错误否决，subagent 排除，已武装／已晋升种子的折叠，`enabled: false`。
- `packages/guard/zen/tests/invariant.spec.ts`——载荷形状与序列不变量，覆盖实时与迟注册两种情形。
- `packages/tui/tui/tests/bundle-patch.spec.ts`——TUI patch 挂载 `zen` 行，带非空 section 与默认谓词。

## 相关

- [TUI 天枢能力 roster](../feature/2026-08-17-tui-bundle-tianshu-capability-roster.md)——本阶段随之发货的接线批次。
- [Repeat-tool-guard](../../archived/feature/2026-07-08-repeat-tool-guard.md)——guard 家族的建议档；本包这个强制档阶段与它并列。
