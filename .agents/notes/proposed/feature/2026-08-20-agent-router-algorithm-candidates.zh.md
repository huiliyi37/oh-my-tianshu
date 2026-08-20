# Agent Note: agent-router 后续算法优化候选

Status: proposed

[English](2026-08-20-agent-router-algorithm-candidates.md) | 中文

## Problem

闭环已落地至 Phase 4（触发 → 决策 → seam 派发 → outcome → 综合 → 采用声明），全部处于 shadow 或只记录模式。从天枢代码库（`opencode-tui`，时间点引用）调研出的若干算法精化可行但刻意不发货——每一项都需要闭环现在产出的 shadow 证据才值得其机制成本。本笔记即登记册：候选、各自证据门、以及带理由的拒绝清单，避免后续会话重新发现它们。

## Proposal

候选（仅当证据门满足才转 implemented；每个落地配自己的 Agent Note）：

1. **auto 模式触发切换。** 证据门：真实 TUI 会话的 shadow `router/decision` 记录持续一段时期无假阳性 delegate 决策。切换是 TUI 配置一行（`trigger.mode: 'auto'`）加 `provider`/`model`；产品定夺。
2. **`resolvePromotionGate` 的 per-session shadow tally 接线。** 纯 veto 阶梯（`promotion.ts`）已就位；tally（samples/falseGreenRate/scopeHealth/margin 每会话）尚未累计与落日志。证据门：有消费者需要门槛判定。
3. **预算强制（Phase 3 方案 b）。** `router/route` 已携带 `budget { maxTurns, deadlineMs }`（只记录）。强制需要 subagent-seam 的 run-level 预算能力（回合帽 + deadline 信号）——独立的 seam 立项；history 自调（天枢 `budget-shape.ts` 的 `historyBudgetFloor`）样本从会话日志推导（子代理工具计数/耗时），绝不用 sidecar store。
4. **失败类别严重度权重。** 天枢 `vigor.ts:45-69` 把失败类别（语义 vs 环境 vs 预期 RED）映射为惩罚权重；DSH 原生版本按失败类别加权 prediction 窗口。证据门：真实错误率数据显示平坦窗口误判。
5. **模型档位升级（flash → strong 带 hard floor）。** 天枢 `model-tier-policy.ts:59-71` 连续失败后升级 worker 模型档位，`escalationCap` 钳制并带 `hardFloor`。DSH 的 escalate 目前只换 profile（verifier），不换档位。证据门：verifier 派发的采用记录显示只换 profile 不够。
6. **先验证后路由规则。** `verificationGap` 信号（文件改动无新验证）可成为路由规则：gap + gate 级错误率 → 派发 verifier。证据门：综合提示节的 gap 标记与真实缺陷相关。
7. **采用驱动的 profile 调优。** `router/adoption` 判定是 per-profile 的成败信号；shadow-only 的提升可偏置 profile 选择（绝不做学习型 gate——确定性规则表保留）。证据门：足够多的采用记录以通过 veto 阶梯（`MIN_SAMPLES`、`MIN_MARGIN`）。

拒绝（无新证据不再提案）：

- **LinUCB effort bandit / 跨会话 DB 学习**（`opencode-tui/src/agent/linucb-bandit.ts`、`model-tier-gate.ts` 的历史状态构建）：违反按会话隔离与先 shadow 后自适应；需要 30+ pulls 才可能有意义。
- **vigor/sensorium/cognitive-season/EFE**（`opencode-tui/src/agent/vigor.ts` 等）：重 CMV 状态，策略调制而非路由。
- **多席 council fan-out、quorum/veto/pillars、加权文本合并、autoExecute**（`council-convene.ts`、`aggregation.ts`）：主代理拥有综合；投票即 MoE 已拒绝。
- **star-domain 角色表/注册表/`.rivet` 卡片**（`star-domain-registry.ts`）：产品风味 persona 状态；只借了关键词匹配器的 hit/tie/no-match 审计形态。

## Alternatives considered

- **现在就发货这些候选。** 否决：每个候选的证据门之所以存在，是因为闭环刚开始产出 shadow 记录——在闭环基线被测出之前把派发预算花在未验证精化上，会恰好破坏这些精化所需要的证据。
- **把登记册并入 implemented 移植笔记。** 否决：移植笔记记录已发货现实；把未来候选放进去等于给 implemented 记录掺 spec 话术。proposed 笔记让登记册可以独立被否决。

## Acceptance criteria

- 上述每个候选在其证据门满足并落地自己的 Agent Note 之前，不进入发货面。
- 任何提升都保持确定性规则表不变——自适应永远 shadow 先行，绝不成为学习型 gate。
- 本登记册是候选与拒绝理由的唯一归属；新候选或推翻更新本笔记（双语对重录）。

## Risks

- 在证据门满足前发货任何候选，等于在未验证规则上烧真实派发预算（升级迟滞已防最坏情况；门槛阶梯是第二道防线）。
- 登记册可能腐烂成想法坟场；证据门让每条候选可证伪——证据门永远无法满足的候选应移入 rejected 而非滞留。
