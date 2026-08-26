# TUI Chrome 闭环

[English](2026-08-26-tui-chrome-closed-loops-design.md) | 中文

## 目标

在 `0.5.0` 之后，用闭合已有回路来挑选下一批 TUI 工作：一次人工按键产生一张卡片状态、一条持久记录，以及一份额度内的 live 行预算——而不是新增默认开启的面板，也不是把尚未提交的坐姿狐狸欢迎页并进来。

本规格是决策，不是实现计划。它不改动 `agent-loop`，不增加模型可见输入，也不交付坐姿狐狸欢迎页。

## 认知对齐

用户意图原文：继续用 grok-4.5 subagent 调研本项目，结合内外参考，优先可闭环的功能收敛与迭代，包括交互层与面板绘制。

问题层级：

- 主问题：L2 接线——人工决策、live 合成与持久记录必须一致。
- 相关：L5 handoff（`[p]` 持久化 vs 结算）与 live 合成（`renderLive` + `LiveSnapshot`）。
- 本轮范围外：L7 大补丁、Web `allowed-always`，以及坐姿狐狸欢迎页 WIP。

## 背景

`packages/tui/tui/src/ui/app.ts` 中的 `TuiApp.renderLive` 是 live compositor。它每帧构建一次 `LiveSnapshot`，再拼接来自 `packages/tui/tui/src/render/live-panels.ts` 的八个 snapshot 面板函数（`renderGlancePanel`、`renderTodosPanel`、`renderTasksPanel`、`renderStatusPanel`、`renderDelegationPanel`、`renderWorkflowPanel`、`renderSkillsPanel`、`renderLspPanel`），然后绘制不在 snapshot 上的片段：`/btw`、fluency、reasoning、stream tail、挂起的工具卡片，以及 `formatActivityBand`。

必须常驻屏幕的 chrome（提问、审批卡、输入、页脚）从 `chromeStart` 起算。`CommitEngine` 拥有已结算的 scrollback。`LiveEngine` 重绘底部区域，并在 H2 行文本匹配时可以 no-op。120 ms 的 ticker 仍会跑完整的 JavaScript 组装。活跃 overlay 会跳过整次 live 写入；该跳过是约定，不是漏洞。

核心审批已使用五个 `ApprovalOutcome` 值。`[p]` 写入 `match: 'exact'`。Web 与 remote 的 decide 故意保持 `allowed-once` | `rejected`。`[a]` 设置进程内的 `alwaysApprove` 标志。Rewind 截断已存事件；它不追加一条 rewind 决策。

## 调研发现

侦察：GitHub TUI 调研、厨房／交易／告警 HUD、TUI 代码考古，以及第四路针对首个假说的反证侦察。

| 来源 | 站住的事实 |
| --- | --- |
| Codex / Gemini / Crush | 审批替换或折叠 composer；权限请求串行化；欢迎页是一种状态，不是伪造的 transcript（文本记录）行。 |
| Claude Code | 状态行是外部进程与第二套时钟；tmux 列竞态与整块底区重绘是已知失败。 |
| Kitchen / blotter / alert board | Live 与 settled 分列；确认是审计事件；确认降低注意力，并不假装条件已消失；增量更新必须保留选中与滚动。 |
| TUI code | 组合器调用的八个面板是 `LiveSnapshot` 的纯函数；activity band 与工具卡片不是；Web 双值 decide 文档写明为有意为之；overlay 暂停是注释 A6；`canAnimateWelcome()` 为 false。 |
| Fourth scout | `Model-visible ⟺ logged` 适用于模型请求，而非每一行对人可见的行。主题、tip 与面板可见性属于 live 控制平面。把每一种第二权威都当缺陷，会与已交付的 `frames` / `events` 二分相冲突。 |

经反证后的假说：可闭环的工作是两平面之间的泄漏，外加从未进入 `LiveSnapshot` 的残余 live 片段——而不是「记录每一行 chrome」，也不是「统一 Web decide」。

证据类别：

- Fact：rewind 截断；Web decide 为双值；overlay 跳过 live 写入。
- Status：activity band 落在 snapshot 之外；120 ms 组装总会跑；`[a]` 仅在内存。
- Convention：120 ms 是动画时钟；CI 中无 idle-assemble 预算。
- Assumption：「闭环」指完成半接线行为，而不是新增 chrome。

## Round 1 — 变异

Niche：`0.5.0` 之后的 TUI 维护者与操作者；硬限制是不重写 `agent-loop`、不在没有会话事件的情况下新增模型可见输入，以及不把坐姿狐狸 WIP 混进本条线。

选择压力：一键 → 一张卡 + 一条持久记录 + 一份额度内的行预算，且今天就能用失败测试钉死。

已占位：standing-grant pentad、新的默认开启面板、Claude 式状态行子进程。空位：像 blotter 对待 Working vs Filled 那样对待 live vs settled，且不新增面板。

| Id | 生态位 | 一句话 |
| --- | --- | --- |
| V1 | Mainstream | 给 Web 与 remote 配上 TTY 已有的同一 `allowed-always` answerer，使每个通道写入相同的 standing grant。 |
| V2 | Neighbor | 把 live chrome 重建为 Codex 式底栏：一个有预算的 compositor 拥有面板、activity band、审批与输入。 |
| V3 | Empty | 保留两平面。钉死泄漏（`[p]` 磁盘 vs 卡片、`[a]` vs 状态行），并把 activity band 迁到 `LiveSnapshot`，使 Working 行与 Filled scrollback 无法互相争抢。 |
| V4 | Mutant | 删除默认 chrome（intent-bridge handler、额外面板、120 ms ticker），直到只剩三个 live 区域：glance、stream tail、input。 |

Founder assumptions：「闭环」指完成既有接线；交互与面板绘制是正确层次；坐姿狐狸是另一条线。

Fitness：硬条件 = 一键诚实 + 无新的默认开启面板；加分 = 在今天的树上就会失败的测试；减分 = Web always-allow、新的子进程 chrome、合并坐姿狐狸。

## Round 2 — 选择

再注入的请求：寻找可闭环的收敛，包括交互与面板绘制。

| 测试 | V1 | V2 | V3 | V4 |
| --- | --- | --- | --- | --- |
| Causal | 破：Web 双值 decide 是通道角色，不是缺失的 answerer。 | 若「一个 compositor」指 snapshot + 预算而非重写，则成立。 | 成立：泄漏 → 卡片／磁盘／状态不一致。 | 破：删除 `/todos` 并不闭环 `[p]`。 |
| Cost | 高，且文档写明为非目标。 | 若重写 `renderLive` 则高；若只扩展 snapshot 则低。 | 低：先写测试与 snapshot 字段。 | 产品成本高，诚实性收益少。 |
| Co-evolve | 静态：更多接线，同样的 TTY bug。 | 仅当 snapshot 即 live 约定时才动态。 | 动态：交互测试迫使 compositor 说真话。 | 静态删除。 |
| Landable first step | 放宽 `approvalResponsePayloadSchema`。 | 把 activity-band 输入放进 `LiveSnapshot`。 | 先写 persist-vs-settle 测试，再写 snapshot 字段。 | 在 disabled 时取消订阅 `intent-bridge/handoff`。 |

局部最优陷阱：V1 看起来像「补完 pentad」却扩大了 standing-grant 注记刻意推迟的表面。V4 看起来像收敛，却跳过了用户点名的交互泄漏。

| 去向 | Id | 原因 |
| --- | --- | --- |
| Extinct | V1 | 有意的通道分裂；不是本树上可闭环的工作。 |
| Extinct as a rewrite | V2 | 整页底栏重写是新的 compositor。保留 snapshot+预算这一性状。 |
| Extinct as a product | V4 | 删掉操作者面板并不闭环一次按键。保留死 handler 这一性状。 |
| Survives | V3 | 同时命中两个被点名的层次；第一步就是在今天的代码上写失败测试。 |

Salvaged traits：V2 的「activity band 属于 snapshot」；V4 的「disabled 的 intent-bridge 不得订阅」。

最强：V3 加上那两个性状。

新发现：live-panels 中的 `renderSessionTabs` 已被 compositor 弃用——删除已经发生。不要重做。

## Round 3 — 适应

已清除的 tropes：「统一每个通道」、「记录每一行对人可见的行」、「状态行子进程」、「overlay 暂停是 bug」。

Exaptation：`LiveSnapshot` 已存在，因此后续无需再做 compositor 重写。把 activity-band 输入放上去，让 H2 继续跳过 stdout。Kitchen recall 映射为带显式 overlay 的破坏性截断 rewind，而不是新的追加事件。

谁／何处／动作／结果：

- 操作者在 TTY 的审批卡上：`y` / `n` / `a` / `p` / Esc → 卡片、磁盘规则与状态行一致，或回显点明三者中哪一个失败。
- 操作者在进行中的轮次：ticker 或 resize → Working 行（activity band + 挂起工具）落在上限内；已结算文本留在 `CommitEngine`；可选面板仍藏在各自的 slash 标志后。
- 维护者在本分支：先写失败测试；同一改动中不要打开坐姿狐狸欢迎页。

收敛：V2、V3 与厨房／blotter 二分一致认为 live 与 settled 不得共享一个无界列表。

## 最终方案

以两平面诚实性外加 chrome 预算交付 V3。

### Loop A — 审批诚实性

在 TTY 上，每次审批按键后以下三者必须同时为真：

1. `approval.peek()` 要么是本请求，要么是 `null`。
2. 当且仅当 `[p]` 已完成为本请求写入时，才存在持久化的 allow 规则。
3. 当且仅当本进程、本会话中 `alwaysApprove` 为 true 时，状态行 “always” 才开启。

`[a]` 保持进程本地。重启必须再问一次。本条线不要把 `[a]` 持久化进 YAML。

若 `[p]` 在请求已是 `cancelled` 之后才完成，卡片必须仍以 `cancelled` 结算。下一次匹配的 ask 可以使用新的 exact 规则。测试必须钉死该三元组；今天的树还没有。

不要把 Web 或 `apiproxy` decide 放宽到 `allowed-always`。

修正 `mode-cycle` 断言，使 `[a]` / Shift+Tab 在控制器结算为 `allowed-always` 时，不能仍期望 `allowed-once`。

### Loop B — live 合成

`LiveSnapshot` 成为默认开启、且非 chrome 的 live 行的唯一输入：

- 保留八个门控面板为 snapshot 的纯函数。
- 把 activity-band 输入加入 snapshot，并停止在其旁从 `renderLive` 调用 `foldActivity`。
- 提问、审批、输入与页脚仍作为 `chromeStart` 之后的 chrome。
- 默认开启的 Working 行：glance、stream tail、挂起的工具卡片、activity band。
- 可选行仍藏在 `/todos`、`/tasks`、`/status`、`/subagents`、`/workflow`、`/skills`、`/lsp`、`/btw` 之后。

行预算：chrome 永不从顶部裁切。Working 行有最大高度。已结算文本只走 `CommitEngine`。

Idle 帧：若 snapshot 键与 chrome 键未变，跳过组装。当 spinner 可见时，120 ms ticker 仍可推进 shimmer `tick`。Overlay 保持暂停仍是 A6 约定。

### Loop C — 死条目

当 intent-bridge 为 `disabled: true` 时，`attach` 不得订阅 `intent-bridge/handoff`。

坐姿狐狸欢迎页（`28` / `36` 档、坐姿资源）保持为另一条脏树线。它不得与 Loop A–C 落在同一改动中。在该线有自己的规格之前，已发布的欢迎档保持 `56` / `72`。

## 实现路径

### Phase 1 — 钉死泄漏

动作：增加 persist-vs-settle 测试；为 `[a]` 增加 restart-still-asks 测试；使 `mode-cycle` 与 `allowed-always` 对齐；向 `LiveSnapshot` 增加 activity-band 字段并经由它们路由 `formatActivityBand`；取消订阅 disabled 的 intent-bridge。

产出：测试在改动前的树上失败，钉死后通过。无欢迎资源改动。无 Web schema 改动。

成功：Loop A 的三条事实在 TUI 测试中成立；`renderLive` 不再在 snapshot 旁折叠 activity；disabled 的 intent-bridge 不安装 handoff 监听器。

退出：若测试无法点名磁盘／卡片／outcome 三元组，则停下，不开始 Phase 2。

### Phase 2 — 行预算

动作：给 Working 行一个文档化的上限；键匹配时跳过 idle 组装；保留 overlay 暂停。

产出：24 行窗口仍保留输入与审批卡；activity band 不能把 chrome 顶出屏幕。

成功：snapshot 或单元测试钉死在满 activity band 的 24 行窗口下 chrome 仍存活。

退出：若 idle skip 丢掉了必需的 shimmer 帧，则只对 spinner 行保留 ticker。

### Phase 3 — 独立视觉线

动作：仅在 A 与 B 之后，把坐姿狐狸欢迎页作为独立规格打开，或放弃它。

产出：欢迎档仅在该规格中变更。

成功：`WELCOME_FOX_BAND_WIDTHS` 与 `formatFoxFrame` 仍是同一套。

退出：若坐姿狐狸无法满足已发布的抠图身份，则保持 `56` / `72`。

## 风险

| 脆弱点 | 应对 |
| --- | --- |
| 把每个本地标志都叫作第二权威 | 主题、tip 与面板可见性留在 live 控制平面。范围内只有决策泄漏。 |
| `[p]` 随后 `cancelled` 看起来像数据丢失 | 测试必须写明规则：本卡保持 cancelled；下一次 ask 可由新的 exact 规则自动允许。 |
| Idle skip 隐藏了 spinner | 仅当 snapshot 键中无 spinner 字段时才跳过。 |
| 坐姿狐狸 WIP 与 `56` / `72` 冲突 | 保持未提交；此处不要改那些常量。 |
| Web 操作者想要 Always | 指向 standing-grant 注记；本规格不打开该通道。 |

## 下一步

写一条 TUI 测试：持久化一条 allow 规则，在写入进行中取消同一请求，并断言磁盘／卡片／outcome 三元组。该改动中不要开始坐姿狐狸欢迎页。

## 已否决的备选

- 在本条线把 Web decide 放宽到五个 outcome。
- 把 `Model-visible ⟺ logged` 当成「每一行 live 行都需要会话事件」。
- 把 `renderLive` 重建为新的底栏框架。
- 增加 Claude 式状态行子进程。
- 把 overlay 暂停当成缺陷。
- 把坐姿狐狸欢迎页并入 Loop A–C。
- 删除 `/todos` 与 `/tasks` 以显得已收敛。
