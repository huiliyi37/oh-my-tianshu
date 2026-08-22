/**
 * agent-router — Cordis 插件接线：指标采集 → 路由决策 → dsh 原生子代理派发。
 *
 * 四个钩子（全部走 dsh 既有机制）：
 * 1. 指标采集：`ctx.on('session/event')` tool/result → recordPrediction
 *    （工具成败累计器，按 session 隔离、child 会话排除）；evidence tracker
 *    指标经 reflect.get('evidence', false) 读取（无 evidence-gate 时缺省
 *    空值，prediction 独立工作）。
 * 2. 路由决策：`ctx.router.decide()` 返回 RouterAction（纯函数 decideRouterAction）。
 * 3. 子代理派发：delegate 动作 → dispatchSubagent（dsh 子代理 seam：
 *    ctx.subagents.start；血统/深度/投影由 seam 自动写）。
 * 4. 持久账本（Phase 1）：每个非 zen 的合格 turn-end 落一条带品牌化
 *    decisionId 与完整指标输入的 `router/decision`（self 与 delegate 全量，
 *    消除只有 delegate 分子的偏差）；闭合的观察窗口归账 `router/evaluation`
 *    （recovered/persisted/inconclusive），关卡判定留痕 `router/gate`——只
 *    记录不切换模式。
 *
 * 综合面（router_adopt 工具 + router:synthesis 节）按可派发性门控：仅当派发
 * 被显式打开（provider+model 齐备且 dispatchEnabled）才注册——shadow 重挂等
 * 不可派发装配上未综合结论恒空、adopt 每调必抛，常驻模型面只是白占请求 token。
 *
 * 未装配时零行为（可选插件）；子代理结果经 session/event 自动归账回
 * evidence-gate（零新通道）。
 *
 * @module @huiliyi37/dsh-agent-router
 */

import type { Context } from '@huiliyi37/cordis'
import type { Session, SessionEvent, SessionId } from '@huiliyi37/dsh-session'
import type {} from '@huiliyi37/dsh-agent' // 'agent/disposed' 事件声明合并
import type {} from '@huiliyi37/dsh-tools' // ctx.tools 声明合并
import type {} from '@huiliyi37/dsh-system-prompt' // ctx.systemPrompt 声明合并'
import { foldZenPhase } from '@huiliyi37/dsh-zen'
import {
  createPredictionAccumulator,
  getConsecutiveFailures,
  getInterventionLevel,
  recordPrediction,
  resetAccumulator,
  shouldTippingPointReset,
} from './prediction.js'
import { decideRouterAction, type EscalationPolicy, type RouterAction, type RouterMetrics } from './router.js'
import { DEFAULT_PROFILE_TOOLS, dispatchSubagent, type DispatchOptions, type DispatchOutcome, type DispatchRole } from './dispatch.js'
import { mergeBudgetOverride, resolveBudgetConfig, shapeWriteBudget, type BudgetConfig } from './budget.js'
import { ADOPT_TOOL_NAME, DEFAULT_SYNTHESIS_SECTION, parseAdoptArgs, pendingOutcomes, renderSynthesisSection, verificationGap } from './synthesis.js'
import {
  canaryHealth,
  classifyObservation,
  observeWindow,
  pendingEvaluations,
  resolveCanaryConfig,
  resolveEvaluationConfig,
  resolveReadinessConfig,
  shadowReadiness,
} from './evaluation.js'
import { resolveCanaryHealthGate, resolveShadowReadinessGate } from './promotion.js'
import { RouterDecisionId } from './ids.js'
import { FINDING_SCHEMA_BY_PROFILE, type RouterFinding } from './finding.js'

/** 插件名（cordis.yml 装配用）。 */
export const name = 'agent-router'
/** 服务依赖（Cordis reactive coeffect：装配按序激活）。 */
export const inject = ['tools', 'systemPrompt']

declare module '@huiliyi37/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Durable route record on the PARENT session's log: log-only (never
     * reaches the model surface), whole-value append at acceptance. One per
     * accepted delegate — a session may route many delegates.
     */
    'router/route': {
      profile: 'code_scout' | 'verifier'
      task: string
      targets: string[]
      subagentSessionId: string
      /** 记录用预算（shape 计算 + 绝对帽；方案 a 只记录不强制）。 */
      budget?: { maxTurns: number; deadlineMs: number }
    }
    /**
     * Durable route-decision record on the session's own log: log-only (never
     * reaches the model surface), whole-value append at turn end. One per
     * trigger firing — shadow records the decision without dispatching;
     * auto records the dispatch outcome (subagentSessionId only when
     * dispatched).
     */
    /**
     * Durable outcome record on the PARENT session's log: log-only (never
     * reaches the model surface), whole-value append when the child settles.
     * Paired one-to-one with the acceptance `router/route` record. A bounded
     * structured `finding` is present only when the child completed AND its
     * structured capture passed the parent-boundary shape check — errors,
     * cancellations, budget terminals, and malformed captures never fabricate
     * one.
     */
    'router/outcome': { subagentSessionId: string; stopReason: string; finding?: RouterFinding }
    /**
     * Durable adoption record on the parent session's own log: log-only
     * (never reaches the model surface), whole-value append via the
     * `router_adopt` tool. Pairs with a `router/outcome` record — the main
     * agent declares adopt/reject with a reason; at most one per outcome.
     */
    'router/adoption': { subagentSessionId: string; verdict: 'adopt' | 'reject'; reason: string }
    /**
     * 触发评估的持久记录（父会话日志，log-only，不进模型面）：每个非 zen
     * 的合格 turn-end 落一条——self 与 delegate 全量记账（分母/比例可从任一
     * 日志重建），带品牌化 decisionId 与决策时的完整 RouterMetrics 输入。
     * 判别联合以 action 区分（{@link RouterDecisionRecord}）。
     */
    'router/decision': RouterDecisionRecord
    /**
     * 决策评估的持久归账（父会话日志，log-only，不进模型面）：决策的观察
     * 窗口（其后至多 windowToolResults 条父会话 tool/result）闭合时落一条，
     * 分类 recovered / persisted / inconclusive；每条 decision 至多一条
     * evaluation（不变量强制），decisionId 必须引用本会话更早的决策。
     */
    'router/evaluation': {
      decisionId: string
      classification: 'recovered' | 'persisted' | 'inconclusive'
      /** 归账窗口内的父会话工具结果数。 */
      samples: number
      /** 归账窗口内的失败数（false-green 判定输入）。 */
      windowFailures: number
    }
    /**
     * 晋升关卡留痕（父会话日志，log-only，不进模型面）：关卡是纯函数判定，
     * 只记录 verdict 与 veto 理由，绝不自行切换模式——产品始终通过配置人工
     * 晋升。shadow-readiness 回答 shadow 数据是否可信；canary-health 仅在
     * auto 装配上记录，回答灰度本身是否健康。
     */
    'router/gate': {
      kind: 'shadow-readiness' | 'canary-health'
      verdict: 'pass' | 'veto'
      vetoSignals: string[]
    }
  }
}

/** evidence 服务最小面（可选——无 evidence-gate 时 metrics 缺省）。 */
interface EvidenceFacet {
  unresolvedHigh(): { id: string; claim: string; targets: string[] }[]
  cooldownTable(): Record<string, number>
  verificationCount(): number
}

/**
 * self 决策记录（`router/decision` 判别联合的 self 分支）：不携带 delegate
 * 专属字段，dispatched 恒 false。
 */
export interface RouterSelfDecision {
  /** 品牌化决策 id（`rtdec-<seq>`；与 router/evaluation 一对一配对）。 */
  decisionId: RouterDecisionId
  action: 'self'
  reason: 'turn-end'
  mode: 'shadow' | 'auto'
  dispatched: false
  /** 决策时的完整指标输入（判定依据可从日志重建）。 */
  metrics: RouterMetrics
}

/**
 * delegate 决策记录（`router/decision` 判别联合的 delegate 分支）：
 * dispatched 与 subagentSessionId 配对（仅 auto 且真实派发时携带 id）。
 */
export interface RouterDelegateDecision {
  decisionId: RouterDecisionId
  action: 'delegate'
  profile: 'code_scout' | 'verifier'
  task: string
  targets: string[]
  reason: 'turn-end'
  mode: 'shadow' | 'auto'
  dispatched: boolean
  subagentSessionId?: SessionId
  metrics: RouterMetrics
}

/** `router/decision` 判别联合（action 区分 self / delegate 分支）。 */
export type RouterDecisionRecord = RouterSelfDecision | RouterDelegateDecision

/* jscpd:ignore-start */
/** 从 tool/result 消息提取文本（tool-result 块内 text 拼接；成败判定用）。 */
function extractResultText(message: { content: unknown[] }): string {
  const first = message.content[0]
  if (first === undefined || first === null || typeof first !== 'object' || !('content' in first)) return ''
  const inner = (first as { content?: unknown[] }).content
  if (!Array.isArray(inner)) return ''
  return inner
    .filter((b): b is { type: 'text'; text: string } =>
      typeof b === 'object' && b !== null && (b as { type?: string }).type === 'text'
        && typeof (b as { text?: string }).text === 'string')
    .map(b => b.text)
    .join('\n')
}
/* jscpd:ignore-end */

/** 插件配置。 */
export interface AgentRouterConfig {
  /** 是否启用子代理派发（默认 true；false 时路由仍决策但只回显动作）。 */
  dispatchEnabled?: boolean
  /**
   * 派发子代理所用 provider。与 `model` 一起构成派发的显式前提：任一缺省时
   * execute 短路返回 null（auto 触发落 `dispatched:false`），且 `router_adopt`
   * 工具与 `router:synthesis` 节不注册——不可派发即无 outcome 可综合，常驻
   * 模型面只是白占请求 token。
   */
  provider?: string
  /** 派发子代理所用模型名（与 `provider` 同为派发的显式前提；缺省不派发）。 */
  model?: string
  /**
   * profile 工具集覆盖（部署差异——如只装少量工具的精简装配——声明自己的
   * 子集）；缺省用内置只读/验证集合（{@link DEFAULT_PROFILE_TOOLS}）。
   */
  profileTools?: {
    /** code_scout profile 的允许工具集（覆盖内置默认）。 */
    codeScout?: string[]
    /** verifier profile 的允许工具集（覆盖内置默认）。 */
    verifier?: string[]
  }
  /** 子代理 provider 名（ctx.subagents 注册名）；缺省 'spawn'（进程内子代理）。 */
  subagentProvider?: string
  /**
   * turn-end 触发（生产触发点）：turn 结束时自动 decide；shadow 只记录
   * 决策不派发（标准起步），auto 经 seam 派发。缺省 mode 'off'（不触发）。
   */
  trigger?: {
    /** 触发模式：'off' 关闭 / 'shadow' 只决策并记录 / 'auto' 决策并派发。 */
    mode?: 'off' | 'shadow' | 'auto'
    /** 是否在 turn/end 触发（缺省 false）。 */
    onTurnEnd?: boolean
  }
  /**
   * 派发预算（Phase 3，方案 a：计算与记录；强制属候选优化）。tunables 全部
   * 经此配置注入并校验（no hardcoded tunables）。
   */
  budget?: {
    /** 缺省回合预算（正整数）。 */
    defaultMaxTurns?: number
    /** 回合预算绝对帽（正整数，≥ 缺省）。 */
    ceilMaxTurns?: number
    /** 墙钟预算（毫秒，即单发绝对帽）。 */
    ceilTimeoutMs?: number
    /** 每多一个目标文件增加的回合数（非负）。 */
    turnsPerExtraFile?: number
  }
  /**
   * 主代理综合提示（Phase 2）：存在未综合 child 结论时渲染；rubric 可覆盖。
   * 缺省用内置 rubric（角色裁定纪律：主代理拥有最终综合与写入）。
   */
  synthesis?: {
    /** 综合提示 rubric 文本（覆盖内置缺省）。 */
    section?: string
  }
  /**
   * 升级迟滞（escalate 分支的钳制与最小连续失败数）。缺省 cap 'verifier'、
   * minConsecutiveFailures 2——单次偶发失败不触发升级。
   */
  escalation?: {
    /** 升级目标钳制（'off' 关闭升级分支）。 */
    cap?: 'off' | 'verifier'
    /** 允许 escalate 的最小连续失败次数（正整数）。 */
    minConsecutiveFailures?: number
  }
  /**
   * 决策评估观察窗口（Phase 1 归账）：决策后的父会话工具轨迹归账为
   * recovered/persisted/inconclusive。tunables 全部经此配置注入并校验。
   */
  evaluation?: {
    /** 固定观察窗口：决策后计多少条父会话 tool/result（正整数）。 */
    windowToolResults?: number
    /** 归账所需最小样本；不足 → inconclusive（正整数）。 */
    minSamples?: number
    /** 窗口尾部连续成功 ≥ 此值 → recovered（正整数）。 */
    recoveredConsecutive?: number
    /** 窗口错误率 ≥ 此值 → persisted（[0,1]）。 */
    persistedErrorRate?: number
  }
  /** shadow readiness 关卡阈值（证据投影窗口与 veto 阈值）。 */
  readiness?: {
    /** 统计窗口：最近多少条已评估决策（正整数）。 */
    window?: number
    /** 最小样本（正整数）。 */
    minSamples?: number
    /** 假绿率上限（> 即 veto；[0,1]）。 */
    maxFalseGreenRate?: number
    /** persisted 占比 ≥ 此值 → scopeHealth high（[0,1]）。 */
    persistedScopeShare?: number
  }
  /** canary health 关卡阈值（真实派发后的运行健康；auto 装配记录）。 */
  canary?: {
    /** 统计窗口：最近多少次真实派发（正整数）。 */
    window?: number
    /** 最小派发数（正整数）。 */
    minDispatches?: number
    /** 预算耗尽占比上限（> 即 veto；[0,1]）。 */
    maxBudgetExhaustedShare?: number
    /** 收益代理下限（有已评估派发且低于此值即 veto；[0,1]）。 */
    minBenefitProxy?: number
  }
  /**
   * 自动派发的 canary 上限与子代理运行预算。mode 'auto' 时五个字段全部必填
   * （装配显式声明——这些是灰度装配值，不设插件默认）；shadow/off 下忽略。
   */
  auto?: {
    /** 每会话同时在飞自动派发上限（正整数）。 */
    maxConcurrent?: number
    /** 每会话累计自动派发上限（正整数；达到后不再派发，只记录决策）。 */
    maxTotal?: number
    /** 两次自动派发之间的最小合格 turn 间隔（正整数）。 */
    cooldownTurns?: number
    /** 子代理步数预算（seam runBudget 强制；正整数）。 */
    maxSteps?: number
    /** 子代理墙钟预算毫秒（seam runBudget 强制；正整数）。 */
    timeoutMs?: number
  }
}

/** 触发策略（Config 经 resolveTriggerPolicy 解析后传入）。 */
export interface TriggerPolicy {
  mode: 'off' | 'shadow' | 'auto'
  onTurnEnd: boolean
}

/**
 * 校验并默认触发策略：mode ∈ {off, shadow, auto}、onTurnEnd 为布尔；
 * 形状错误在装配时 fail loud。缺省 mode 'off'、onTurnEnd false——挂载
 * 不自触发（装配显式声明 trigger 才生效）。
 * @param config - 插件配置。
 * @returns 解析后的策略。
 */
export function resolveTriggerPolicy(config: AgentRouterConfig): TriggerPolicy {
  const mode = config.trigger?.mode ?? 'off'
  if (mode !== 'off' && mode !== 'shadow' && mode !== 'auto') {
    throw new Error(`agent-router: trigger.mode must be 'off' | 'shadow' | 'auto', got ${JSON.stringify(mode)}`)
  }
  const onTurnEnd = config.trigger?.onTurnEnd ?? false
  if (typeof onTurnEnd !== 'boolean') {
    throw new Error(`agent-router: trigger.onTurnEnd must be a boolean, got ${JSON.stringify(onTurnEnd)}`)
  }
  return { mode, onTurnEnd }
}

/**
 * 校验并默认升级迟滞策略：cap ∈ {verifier, off}、minConsecutiveFailures 为
 * 正整数；形状错误在装配时 fail loud。
 * @param config - 插件配置。
 * @returns 解析后的策略（缺省 cap 'verifier'、minConsecutiveFailures 2）。
 */
export function resolveEscalationPolicy(config: AgentRouterConfig): EscalationPolicy {
  const cap = config.escalation?.cap ?? 'verifier'
  if (cap !== 'verifier' && cap !== 'off') {
    throw new Error(`agent-router: escalation.cap must be 'verifier' | 'off', got ${JSON.stringify(cap)}`)
  }
  const minConsecutiveFailures = config.escalation?.minConsecutiveFailures ?? 2
  if (!Number.isInteger(minConsecutiveFailures) || minConsecutiveFailures < 1) {
    throw new Error(`agent-router: escalation.minConsecutiveFailures must be a positive integer, got ${JSON.stringify(minConsecutiveFailures)}`)
  }
  return { cap, minConsecutiveFailures }
}

/** 自动派发 canary 策略（Config 经 resolveAutoPolicy 解析后传入）。 */
export interface AutoDispatchPolicy {
  /** 每会话同时在飞自动派发上限。 */
  maxConcurrent: number
  /** 每会话累计自动派发上限。 */
  maxTotal: number
  /** 两次自动派发之间的最小合格 turn 间隔。 */
  cooldownTurns: number
  /** 子代理步数预算（seam runBudget）。 */
  maxSteps: number
  /** 子代理墙钟预算毫秒（seam runBudget）。 */
  timeoutMs: number
}

/** 自动派发策略的五个必填字段。 */
const AUTO_POLICY_FIELDS = ['maxConcurrent', 'maxTotal', 'cooldownTurns', 'maxSteps', 'timeoutMs'] as const

/**
 * 校验并默认自动派发策略：mode 'auto' 时五个字段全部显式必填（灰度上限是
 * 装配值，不设插件默认——缺字段即装配期 fail loud）；shadow/off 下返回
 * undefined（不触发派发路径，无需策略）。
 * @param config - 插件配置。
 * @returns 解析后的策略；非 auto 装配为 undefined。
 */
export function resolveAutoPolicy(config: AgentRouterConfig): AutoDispatchPolicy | undefined {
  if (config.trigger?.mode !== 'auto') return undefined
  const missing = AUTO_POLICY_FIELDS.filter(field => config.auto?.[field] === undefined)
  if (missing.length > 0) {
    throw new Error(`agent-router: trigger.mode 'auto' requires explicit auto.${missing.join(', auto.')} (canary caps are assembly values, never plugin defaults)`)
  }
  const raw = config.auto ?? {}
  const policy = {} as Record<keyof AutoDispatchPolicy, number>
  for (const field of AUTO_POLICY_FIELDS) {
    const value: number | undefined = raw[field]
    if (!Number.isInteger(value) || (value as number) < 1) {
      throw new Error(`agent-router: auto.${field} must be a positive integer, got ${JSON.stringify(value)}`)
    }
    policy[field] = value as number
  }
  return policy as AutoDispatchPolicy
}

/**
 * 校验并默认 profile 工具集。每个列表必须是非空工具名字符串数组且无
 * 重复（空列表会被 tools.restrict 拒绝，在此先行拒绝）；形状错误在装配
 * 时 fail loud，未知工具名由 restrict 在派发时 fail loud（两级防线）。
 * @param config - 插件配置。
 * @returns 两个 profile 的最终工具集（缺省用 {@link DEFAULT_PROFILE_TOOLS}）。
 */
export function resolveProfileTools(config: AgentRouterConfig): Record<DispatchOptions['profile'], string[]> {
  const result: Record<DispatchOptions['profile'], string[]> = {
    code_scout: [...DEFAULT_PROFILE_TOOLS.code_scout],
    verifier: [...DEFAULT_PROFILE_TOOLS.verifier],
  }
  const overrides: Array<[DispatchOptions['profile'], string[] | undefined]> = [
    ['code_scout', config.profileTools?.codeScout],
    ['verifier', config.profileTools?.verifier],
  ]
  for (const [profile, list] of overrides) {
    if (list === undefined) continue
    const key = profile === 'code_scout' ? 'codeScout' : 'verifier'
    if (list.length === 0 || list.some(name => typeof name !== 'string' || name.trim() === '')) {
      throw new Error(`agent-router: profileTools.${key} must be a non-empty array of non-empty tool names`)
    }
    if (new Set(list).size !== list.length) {
      throw new Error(`agent-router: profileTools.${key} must not contain duplicates`)
    }
    result[profile] = [...list]
  }
  return result
}

/** 宿主服务面。 */
export interface RouterService {
  /**
   * 当前指标快照（指定会话的累计器）。
   * @param options.sessionId - 指标归属的会话。
   */
  metrics(options: { sessionId: SessionId }): RouterMetrics
  /**
   * 路由决策（纯函数；可重复调用）。
   * @param options.sessionId - 决策归属的会话。
   */
  decide(options: { sessionId: SessionId }): RouterAction
  /**
   * 执行动作（delegate → 经 subagent seam 派发子代理；self → no-op）。
   * @param action - 路由动作。
   * @param options.sessionId - 父会话 id（必须活 agent；子代理血统自此派生）。
   * @param options.signal - 派发取消通道（缺省新建）。
   * @returns 派发终态（sessionId/stopReason/output）；self 或未派发为 null。
   */
  execute(action: RouterAction, options: { sessionId: SessionId; signal?: AbortSignal }): Promise<DispatchOutcome | null>
  /**
   * 重置预测累计器（环境恢复后调用）。
   * @param sessionId - 目标会话；缺省清空全部会话的累计器。
   */
  resetPrediction(sessionId?: SessionId): void
}

/** 插件装配：指标采集 + 路由服务面 + 派发。 */
export function apply(ctx: Context, config: AgentRouterConfig = {}): void {
  const profileTools = resolveProfileTools(config)
  const escalationPolicy = resolveEscalationPolicy(config)
  const trigger = resolveTriggerPolicy(config)
  const subagentProvider = config.subagentProvider ?? 'spawn'
  if (typeof subagentProvider !== 'string' || subagentProvider.trim() === '') {
    throw new Error('agent-router: subagentProvider must be a non-empty provider name')
  }
  const budgetConfig: BudgetConfig = resolveBudgetConfig(config.budget ?? {})
  const autoPolicy = resolveAutoPolicy(config)
  const evaluationConfig = resolveEvaluationConfig(config.evaluation ?? {})
  const readinessConfig = resolveReadinessConfig(config.readiness ?? {})
  const canaryConfig = resolveCanaryConfig(config.canary ?? {})
  const synthesisSection = config.synthesis?.section ?? DEFAULT_SYNTHESIS_SECTION
  if (typeof synthesisSection !== 'string' || synthesisSection.trim() === '') {
    throw new Error('agent-router: synthesis.section must be a non-empty string')
  }
  const dispatchEnabled = config.dispatchEnabled ?? true
  // 可派发性门控：outcome 只在显式派发装配上存在。shadow 重挂（无 provider/model）
  // 等装配上综合节恒空、router_adopt 每调必抛"no pending finding"，常驻模型面
  // 只是白占每轮请求 token——两者都不注册。executeAction 内的短路是同一条件的
  // 展开（保留 undefined 收窄，TS 友好）。
  const canDispatch = dispatchEnabled && config.provider !== undefined && config.model !== undefined

  // —— 采用声明工具：主代理对每条 child 结论逐条声明 adopt/reject ——
  if (canDispatch) {
    ctx.tools.register({
      name: ADOPT_TOOL_NAME,
      description: 'Declare your adoption decision for one dispatched subagent finding: '
        + 'adopt (integrate it) or reject (state why). Call exactly once per finding listed in your synthesis prompt.',
      parameters: {
        subagentSessionId: { type: 'string', required: true, description: 'The subagent session id from the synthesis prompt.' },
        verdict: { type: 'string', required: true, enum: ['adopt', 'reject'], description: 'adopt or reject the finding.' },
        reason: { type: 'string', required: true, description: 'Why you adopt or reject it.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { adopted: { type: 'boolean', const: true } },
        },
        render: () => [{ type: 'text', text: 'Finding adoption recorded.' }],
      },
      execute: async (args, exec) => {
        const agent = exec.agent
        if (agent === undefined) throw new Error(`${ADOPT_TOOL_NAME} requires a calling agent`)
        const parsed = parseAdoptArgs(args)
        // 声明必须引用本会话一条未综合的 child 结论（契约：逐条、恰好一次）。
        const session = agent.session
        const pending = pendingOutcomes(session.events)
        if (!pending.some(entry => entry.subagentSessionId === parsed.subagentSessionId)) {
          throw new Error(`${ADOPT_TOOL_NAME}: no pending finding for subagent ${parsed.subagentSessionId} — declare each finding exactly once`)
        }
        session.append('router/adoption', {
          subagentSessionId: parsed.subagentSessionId,
          verdict: parsed.verdict,
          reason: parsed.reason,
        })
        return { adopted: true as const }
      },
    })

    // —— 主代理综合提示：存在未综合 child 结论时渲染（model-visible 内容
    //    全部派生自已落盘的 router/outcome 与 router/adoption 记录）——
    ctx.systemPrompt.section({
      name: 'router:synthesis',
      order: 51,
      text: (context) => {
        const agent = context.agent
        if (agent === undefined) return ''
        const events = agent.session.events
        return renderSynthesisSection(pendingOutcomes(events), verificationGap(events), synthesisSection)
      },
    })
  }
  const predictions = new Map<SessionId, ReturnType<typeof createPredictionAccumulator>>()

  // —— 指标组装（evidence 可选；prediction 按会话取）——
  const collectMetrics = (sessionId: SessionId): RouterMetrics => {
    const evidence = ctx.reflect.get('evidence', false) as unknown as EvidenceFacet | undefined
    const high = evidence?.unresolvedHigh() ?? []
    const cooled = evidence?.cooldownTable() ?? {}
    const cooledTargets = Object.values(cooled).filter(v => v >= 2).length
    const accumulator = predictions.get(sessionId) ?? createPredictionAccumulator()
    return {
      interventionLevel: getInterventionLevel(accumulator),
      consecutiveFailures: getConsecutiveFailures(accumulator),
      unresolvedHigh: high.length,
      verifications: evidence?.verificationCount() ?? 0,
      probeCooledTargets: cooledTargets,
    }
  }

  // —— 每会话派发控制器（Phase 2）：单飞锁、累计帽、冷却与可收敛的 run 信号 ——
  interface SessionRunState {
    /** 在飞自动派发数（单飞锁数据源）。 */
    inFlight: number
    /** 累计自动派发数（canary 总帽）。 */
    total: number
    /** 合格 turn 计数（冷却间隔的分母）。 */
    qualifiedTurns: number
    /** 上次真实派发时的 qualifiedTurns 值。 */
    lastDispatchTurn: number | undefined
    /** 在飞 run 的取消通道（父 dispose 时统一收敛）。 */
    controllers: Set<AbortController>
  }
  const runStates = new Map<SessionId, SessionRunState>()
  const stateOf = (sessionId: SessionId): SessionRunState => {
    const existing = runStates.get(sessionId)
    if (existing !== undefined) return existing
    const created: SessionRunState = {
      inFlight: 0, total: 0, qualifiedTurns: 0, lastDispatchTurn: undefined, controllers: new Set(),
    }
    runStates.set(sessionId, created)
    return created
  }

  // —— 角色解析（agent-definitions 可选在场）：profile → 固定角色映射 ——
  const definitions = ctx.reflect.get('agentDefinitions', false) as
    | { get(name: string, options?: { cwd?: string }): Promise<{ content: string; tools?: readonly string[]; sandbox?: 'read-only' } | undefined> }
    | undefined
  /** profile → 角色名（结构性映射；角色由 agent-definitions 内置提供）。 */
  const ROLE_BY_PROFILE: Record<DispatchOptions['profile'], string> = { code_scout: 'explore', verifier: 'verify' }
  const resolveDispatchRole = async (
    profile: DispatchOptions['profile'],
    sessionId: SessionId,
  ): Promise<DispatchRole | undefined> => {
    if (definitions === undefined) return undefined
    const name = ROLE_BY_PROFILE[profile]
    const agents = ctx.reflect.get('agents', false) as { get(sessionId: SessionId): { session?: { header?: { cwd?: string } } } | undefined } | undefined
    const cwd: string | undefined = agents?.get(sessionId)?.session?.header?.cwd
    const definition = await definitions.get(name, cwd === undefined ? {} : { cwd })
    if (definition === undefined) {
      throw new Error(`agent-router: role "${name}" (profile ${profile}) is not registered — agent-definitions must provide it before dispatch`)
    }
    const ceiling = profileTools[profile]
    const tools = ceiling.filter(tool => definition.tools?.includes(tool) ?? false)
    if (tools.length === 0) {
      throw new Error(`agent-router: role "${name}" tool set intersects profile ${profile} ceiling to nothing (ceiling: ${ceiling.join(', ')})`)
    }
    return {
      tools,
      persona: definition.content,
      ...(definition.sandbox !== undefined ? { sandboxMode: definition.sandbox } : {}),
    }
  }

  // —— 派发执行（service.execute 与 turn-end 触发共用）——
  const executeAction = async (
    action: RouterAction,
    sessionId: SessionId,
    signal?: AbortSignal,
  ): Promise<DispatchOutcome | null> => {
    // 短路条件即 canDispatch 的展开（保留 undefined 收窄，TS 友好）。
    if (action.kind !== 'delegate' || !dispatchEnabled) return null
    if (config.provider === undefined || config.model === undefined) return null
    // 每会话派发控制器：run 信号挂到可被父 dispose 收敛的 controller 上
    // （删除永不触发的临时 AbortController().signal）；外部 signal 仍可取消。
    const controller = new AbortController()
    if (signal !== undefined) {
      signal.addEventListener('abort', () => { controller.abort() }, { once: true })
    }
    const state = stateOf(sessionId)
    state.controllers.add(controller)
    try {
      const dispatchRole = await resolveDispatchRole(action.profile, sessionId)
      const opts: DispatchOptions = {
        profile: action.profile,
        task: action.task,
        targets: action.targets,
        provider: config.provider,
        model: config.model,
        // 角色在场时以「角色工具集 ∩ profile 天花板」收紧（resolveDispatchRole
        // 已保证非空交集）并透传 persona/sandbox；缺省回落 profile 内置工具集。
        ...(dispatchRole !== undefined ? { role: dispatchRole } : {}),
        tools: profileTools[action.profile],
        subagentProvider,
        parentSessionId: sessionId,
        signal: controller.signal,
        budget: mergeBudgetOverride(undefined, shapeWriteBudget(action.targets.length, budgetConfig)),
        ...(autoPolicy !== undefined
          ? { runBudget: { maxSteps: autoPolicy.maxSteps, timeoutMs: autoPolicy.timeoutMs } }
          : {}),
        findingSchema: FINDING_SCHEMA_BY_PROFILE[action.profile],
      }
      return await dispatchSubagent(ctx, opts)
    } finally {
      state.controllers.delete(controller)
    }
  }

  // —— 决策 id：append 时点铸造，预测 seq = 当前事件数（同步无并发）——
  const rtdecId = (owner: Session): RouterDecisionId => RouterDecisionId(`rtdec-${owner.events.length}`)

  // —— 决策归账（Phase 1）：闭合的观察窗口 → router/evaluation + 关卡留痕 ——
  // 纯投影从日志推导待归账决策；本函数只在微任务中调用（绝不重入发布中的
  // Session.append）。关卡只记录 verdict/veto 理由，绝不切换模式。
  const closeDueEvaluations = (owner: Session): void => {
    const due = pendingEvaluations(owner.events, evaluationConfig)
    if (due.length === 0) return
    for (const entry of due) {
      const stats = observeWindow(owner.events, entry.decisionIndex, evaluationConfig)
      owner.append('router/evaluation', {
        decisionId: entry.decisionId,
        classification: classifyObservation(stats, evaluationConfig),
        samples: stats.samples,
        windowFailures: stats.failures,
      })
    }
    const readiness = resolveShadowReadinessGate(shadowReadiness(owner.events, readinessConfig))
    owner.append('router/gate', {
      kind: 'shadow-readiness',
      verdict: readiness.enabled ? 'pass' : 'veto',
      vetoSignals: readiness.vetoSignals,
    })
    if (trigger.mode === 'auto') {
      const canary = resolveCanaryHealthGate(canaryHealth(owner.events, canaryConfig), {
        maxBudgetExhaustedShare: canaryConfig.maxBudgetExhaustedShare,
        minBenefitProxy: canaryConfig.minBenefitProxy,
      })
      owner.append('router/gate', {
        kind: 'canary-health',
        verdict: canary.enabled ? 'pass' : 'veto',
        vetoSignals: canary.vetoSignals,
      })
    }
  }

  // —— turn-end 触发：全量决策记账（self+delegate）/ shadow 只记录 / seam 派发（auto）——
  const runTrigger = async (owner: Session): Promise<void> => {
    const metricsSnapshot = collectMetrics(owner.id)
    const action = decideRouterAction(metricsSnapshot, obligationHint(), escalationPolicy)
    if (action.kind === 'self') {
      // 合格 turn-end 全量落决策：self 也带完整指标输入，消除只有 delegate
      // 分子的偏差（合格 turn 分母与 self/delegate 比例可从任一日志重建）。
      owner.append('router/decision', {
        decisionId: rtdecId(owner),
        action: 'self',
        reason: 'turn-end',
        mode: trigger.mode === 'auto' ? 'auto' : 'shadow',
        dispatched: false,
        metrics: metricsSnapshot,
      })
      return
    }
    if (trigger.mode === 'shadow') {
      owner.append('router/decision', {
        decisionId: rtdecId(owner),
        action: 'delegate',
        profile: action.profile,
        task: action.task,
        targets: action.targets,
        reason: 'turn-end',
        mode: 'shadow',
        dispatched: false,
        metrics: metricsSnapshot,
      })
      return
    }
    // auto：决策 + canary 门（单飞锁/累计帽/冷却）+ 派发；失败不打断 turn，
    // 但必须留痕（决策记录 + 错误日志）。被 canary 门拦下时同样落
    // dispatched:false 的决策——路由意愿与灰度上限都在日志里可重建。
    // mode 'auto' 在装配期已保证 autoPolicy 就位（resolveAutoPolicy fail loud）。
    if (autoPolicy === undefined) return
    const runState = stateOf(owner.id)
    runState.qualifiedTurns++
    const cooled = runState.lastDispatchTurn !== undefined
      && runState.qualifiedTurns - runState.lastDispatchTurn < autoPolicy.cooldownTurns
    if (runState.inFlight >= autoPolicy.maxConcurrent
      || runState.total >= autoPolicy.maxTotal || cooled) {
      owner.append('router/decision', {
        decisionId: rtdecId(owner),
        action: 'delegate',
        profile: action.profile,
        task: action.task,
        targets: action.targets,
        reason: 'turn-end',
        mode: 'auto',
        dispatched: false,
        metrics: metricsSnapshot,
      })
      return
    }
    let dispatched = false
    let subagentSessionId: SessionId | undefined
    runState.inFlight++
    runState.total++
    runState.lastDispatchTurn = runState.qualifiedTurns
    try {
      const outcome = await executeAction(action, owner.id)
      if (outcome === null) {
        // 缺 provider/model 等短路：决策记录 dispatched false（原因在装配态）。
        dispatched = false
      } else {
        dispatched = true
        subagentSessionId = outcome.sessionId
      }
    } catch (error) {
      dispatched = false
      ctx.logger.error('agent-router: turn-end dispatch failed for %s: %o', owner.id, error)
    } finally {
      runState.inFlight--
    }
    owner.append('router/decision', {
      decisionId: rtdecId(owner),
      action: 'delegate',
      profile: action.profile,
      task: action.task,
      targets: action.targets,
      reason: 'turn-end',
      mode: 'auto',
      dispatched,
      ...(subagentSessionId !== undefined ? { subagentSessionId } : {}),
      metrics: metricsSnapshot,
    })
  }

  // —— 指标采集：tool/result 成败喂 prediction（按 session 隔离）——
  ctx.on('session/event', (owner, event: SessionEvent) => {
    // child 会话排除：子代理反馈污染父会话窗口（镜像 zen 的 parentSession
    // 跳过条件）——路由决定只归因于本会话自己的工具轨迹；触发同理跳过。
    const header = (owner as { header?: { parentSession?: unknown } }).header
    if (header?.parentSession !== undefined) return
    if (event.type === 'tool/result') {
      const block = event.data.message.content[0]
      // 成败判定：isError 标记（工具异常）或输出含非零退出码（dsh bash 对
      // 非零退出码不标 isError，退出码在文本 `[exit code: N]`——真实装配实证）。
      const text = extractResultText(event.data.message)
      const exitFail = /\[exit code: [1-9]\d*\]/.test(text)
      const isError = block.isError === true || exitFail
      const current = predictions.get(owner.id) ?? createPredictionAccumulator()
      const next = recordPrediction(current, !isError)
      predictions.set(owner.id, next)
      // tipping point：连续 3 次正确 → 环境恢复，重置累计器（干预撤销）
      if (shouldTippingPointReset(next)) {
        predictions.set(owner.id, resetAccumulator(next))
      }
      // 观察窗口归账：tool/result 可能闭合某条决策的窗口，微任务出窗补记。
      queueMicrotask(() => { closeDueEvaluations(owner) })
    }
    // turn-end 触发（生产触发点）：全量决策记账；shadow 只记录；auto 决策并
    // 派发。禅阶段（对齐/锚定轮）整体跳过：会话尚在进入状态，受限工具面上的
    // 指标决策不出可信路由——不决策、不记录、不派发、不归账，晋升 full 后的
    // 下一轮起才参与。微任务出窗：runTrigger 的同步前缀（决策 append）与
    // closeDueEvaluations 的归账 append 会重入 turn/end 尚在发布中的
    // Session.append，撞上重入守卫即 fatal。触发前先归账已满窗口，触发后
    // 再归账一次——新决策点会取代上一条未满窗口（每条决策恰一条评估）。
    if (event.type === 'turn/end' && trigger.onTurnEnd && trigger.mode !== 'off') {
      queueMicrotask(() => {
        if (foldZenPhase(owner.events) === 'zen') return
        closeDueEvaluations(owner)
        void runTrigger(owner).then(() => { closeDueEvaluations(owner) })
      })
    }
  })

  // —— 会话终结回收：agent 注销时 evict 该会话的累计器与派发状态（长驻进程
  // 防无界增长），并收敛在飞自动 run（父 dispose → abort 全部 controller）——
  ctx.on('agent/disposed', ({ agent }) => {
    predictions.delete(agent.session.id)
    const state = runStates.get(agent.session.id)
    if (state === undefined) return
    for (const controller of state.controllers) controller.abort()
    runStates.delete(agent.session.id)
  })

  // —— 义务提示（delegate 任务描述素材）——
  const obligationHint = (): { claim: string; targets: string[] } | undefined => {
    const evidence = ctx.reflect.get('evidence', false) as unknown as EvidenceFacet | undefined
    const first = evidence?.unresolvedHigh()[0]
    return first === undefined
      ? undefined
      : { claim: first.claim, targets: first.targets }
  }

  const service: RouterService = {
    metrics: options => collectMetrics(options.sessionId),
    decide: options => decideRouterAction(collectMetrics(options.sessionId), obligationHint(), escalationPolicy),
    execute: (action, options) => executeAction(action, options.sessionId, options.signal),
    resetPrediction: (sessionId) => {
      if (sessionId === undefined) {
        predictions.clear()
        return
      }
      predictions.set(sessionId, resetAccumulator(predictions.get(sessionId) ?? createPredictionAccumulator()))
    },
  }
  ctx.provide('router', service)
}

export { createPredictionAccumulator, getConsecutiveFailures, getErrorRate, getInterventionLevel, recordPrediction, resetAccumulator, shouldTippingPointReset } from './prediction.js'
export { decideRouterAction, type EscalationPolicy, type RouterAction, type RouterMetrics } from './router.js'
export { dispatchSubagent, SUBAGENT_TASK_PREFIX, type DispatchOptions, type DispatchOutcome, type DispatchRole } from './dispatch.js'
export { boundFinding, boundFindingText, FINDING_SCHEMA_BY_PROFILE, FINDING_SUMMARY_MAX_CHARS, FINDING_ITEM_MAX_CHARS, FINDING_ITEMS_MAX, type RouterFinding, type ScoutFinding, type VerifyFinding } from './finding.js'
export { ADOPT_TOOL_NAME, DEFAULT_SYNTHESIS_SECTION, parseAdoptArgs, pendingOutcomes, renderSynthesisSection, verificationGap, type AdoptArgs, type AdoptVerdict, type PendingOutcome } from './synthesis.js'
export { mergeBudgetOverride, resolveBudgetConfig, shapeWriteBudget, type BudgetConfig, type BudgetShape } from './budget.js'
export { MIN_SAMPLES, effectivePromotionMode, resolveCanaryHealthGate, resolveShadowReadinessGate, type CanaryGatePolicy, type PromotionGateResult, type PromotionMode } from './promotion.js'
export {
  canaryHealth,
  classifyObservation,
  evaluatedDecisions,
  observeWindow,
  pendingEvaluations,
  resolveCanaryConfig,
  resolveEvaluationConfig,
  resolveReadinessConfig,
  shadowReadiness,
  type CanaryConfig,
  type CanaryHealthEvidence,
  type EvaluatedDecision,
  type EvaluationConfig,
  type ObservationClassification,
  type ObservationStats,
  type PendingEvaluation,
  type ReadinessConfig,
  type ShadowReadinessEvidence,
} from './evaluation.js'
export { RouterDecisionId } from './ids.js'
