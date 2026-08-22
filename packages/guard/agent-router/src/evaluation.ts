/**
 * evaluation.ts — shadow 评估的纯函数投影：会话日志 → 观察窗口分类与
 * readiness/canary 证据。
 *
 * 决策（`router/decision`）落盘后，其观察窗口是该会话日志中紧随其后的
 * 至多 `windowToolResults` 条 `tool/result`。窗口闭合（样本满或被更晚的
 * 决策取代）时归账为一条 `router/evaluation`，分类 recovered / persisted /
 * inconclusive；每条决策至多一条评估（不变量强制）。readiness/canary 证据
 * 同样从日志投影——shadow 无真实派发时 canary 证据恒为零值，绝不伪造
 * 收益边际（veto 阶梯见 promotion.ts）。
 *
 * @module @huiliyi37/dsh-agent-router/evaluation
 */

import type { SessionEvent } from '@huiliyi37/dsh-session'

/** 观察窗口分类（决策后父会话工具轨迹的走向）。 */
export type ObservationClassification = 'recovered' | 'persisted' | 'inconclusive'

/** 评估配置（Config `evaluation` 字段，全部校验）。 */
export interface EvaluationConfig {
  /** 固定观察窗口：决策后计多少条父会话 tool/result。 */
  windowToolResults: number
  /** 归账所需最小样本；不足 → inconclusive。 */
  minSamples: number
  /** 窗口尾部连续成功 ≥ 此值 → recovered。 */
  recoveredConsecutive: number
  /** 窗口错误率 ≥ 此值 → persisted。 */
  persistedErrorRate: number
}

/**
 * 校验并默认评估配置（形状非法 fail loud）。
 * @param raw - 组合层原始字段（全部可选）。
 * @returns 字段齐备且通过校验的评估配置。
 */
export function resolveEvaluationConfig(raw: {
  windowToolResults?: number
  minSamples?: number
  recoveredConsecutive?: number
  persistedErrorRate?: number
}): EvaluationConfig {
  const config: EvaluationConfig = {
    windowToolResults: raw.windowToolResults ?? 8,
    minSamples: raw.minSamples ?? 3,
    recoveredConsecutive: raw.recoveredConsecutive ?? 3,
    persistedErrorRate: raw.persistedErrorRate ?? 0.5,
  }
  for (const key of ['windowToolResults', 'minSamples', 'recoveredConsecutive'] as const) {
    const value = config[key]
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`agent-router: evaluation.${key} must be a positive integer, got ${JSON.stringify(value)}`)
    }
  }
  if (!Number.isFinite(config.persistedErrorRate) || config.persistedErrorRate < 0 || config.persistedErrorRate > 1) {
    throw new Error(`agent-router: evaluation.persistedErrorRate must be within [0, 1], got ${JSON.stringify(config.persistedErrorRate)}`)
  }
  return config
}

/** 窗口统计（分类输入；全部可从日志重建）。 */
export interface ObservationStats {
  /** 窗口内父会话工具结果数。 */
  samples: number
  /** 窗口内失败数（isError 或非零退出码）。 */
  failures: number
  /** 窗口尾部连续成功数。 */
  trailingSuccesses: number
}

/**
 * 提取 tool/result 的成败判定文本口径与指标采集一致：isError 标记或输出
 * 文本含非零退出码（dsh bash 非零退出码不标 isError）。
 */
function isFailedResult(event: SessionEvent): boolean {
  const message = (event.data as { message?: { content?: unknown[] } }).message
  const first = message?.content?.[0]
  if (first !== null && typeof first === 'object' && 'isError' in first && (first as { isError?: unknown }).isError === true) {
    return true
  }
  const inner = first !== null && typeof first === 'object' && 'content' in first
    ? (first as { content?: unknown[] }).content
    : undefined
  if (!Array.isArray(inner)) return false
  const text = inner
    .filter((block): block is { type: 'text'; text: string } =>
      typeof block === 'object' && block !== null && (block as { type?: string }).type === 'text'
        && typeof (block as { text?: string }).text === 'string')
    .map(block => block.text)
    .join('\n')
  return /\[exit code: [1-9]\d*\]/.test(text)
}

/**
 * 统计某条决策之后的观察窗口（事件数组下标制，不依赖 seq——测试替身的
 * 追加事件可无 seq）。只统计 `tool/result`；其余记录类型原样越过。
 * @param events - 会话事件日志（权威来源）。
 * @param decisionIndex - 决策事件在数组中的下标。
 * @param config - 评估配置。
 * @returns 窗口统计。
 */
export function observeWindow(
  events: readonly SessionEvent[],
  decisionIndex: number,
  config: EvaluationConfig,
): ObservationStats {
  const stats: ObservationStats = { samples: 0, failures: 0, trailingSuccesses: 0 }
  for (let index = decisionIndex + 1; index < events.length && stats.samples < config.windowToolResults; index++) {
    const event = events[index]
    if (event?.type !== 'tool/result') continue
    stats.samples++
    if (isFailedResult(event)) {
      stats.failures++
      stats.trailingSuccesses = 0
    } else {
      stats.trailingSuccesses++
    }
  }
  return stats
}

/**
 * 分类一个已闭合窗口（调用方保证样本满或已被更晚决策取代）：
 * 样本不足 → inconclusive；尾部连续成功达阈值 → recovered；错误率达阈值 →
 * persisted；其余 → inconclusive。
 * @param stats - 窗口统计。
 * @param config - 评估配置。
 * @returns 观察分类。
 */
export function classifyObservation(stats: ObservationStats, config: EvaluationConfig): ObservationClassification {
  if (stats.samples < config.minSamples) return 'inconclusive'
  if (stats.trailingSuccesses >= config.recoveredConsecutive) return 'recovered'
  if (stats.samples > 0 && stats.failures / stats.samples >= config.persistedErrorRate) return 'persisted'
  return 'inconclusive'
}

/** 一条待归账决策（窗口已闭合且尚无 evaluation 引用）。 */
export interface PendingEvaluation {
  /** 决策事件在日志数组中的下标（observeWindow 输入）。 */
  decisionIndex: number
  /** 决策 id（evaluation 配对引用）。 */
  decisionId: string
  /** 决策模式（gate 记录分流用）。 */
  mode: 'shadow' | 'auto'
  /** 决策动作（false-green 判定只看 delegate）。 */
  action: 'self' | 'delegate'
}

/**
 * 待归账决策投影：尚无配对 `router/evaluation` 且窗口已闭合的决策。
 * 闭合条件（任一）：窗口样本满；日志中存在更晚的决策（该决策点取代了
 * 未满的窗口）。按日志顺序返回。
 * @param events - 会话事件日志。
 * @param config - 评估配置。
 * @returns 待归账决策列表。
 */
export function pendingEvaluations(events: readonly SessionEvent[], config: EvaluationConfig): PendingEvaluation[] {
  interface OpenDecision extends PendingEvaluation {
    samples: number
  }
  const open: OpenDecision[] = []
  const evaluated = new Set<string>()
  for (let index = 0; index < events.length; index++) {
    const event = events[index]
    if (event === undefined) continue
    if (event.type === 'router/decision') {
      // 更晚的决策闭合此前所有未满窗口（先开新决策点，再归账旧窗口）。
      for (const entry of open) entry.samples = Number.POSITIVE_INFINITY
      const data = event.data as { decisionId?: unknown; mode?: unknown; action?: unknown }
      if (typeof data.decisionId === 'string' && !evaluated.has(data.decisionId)) {
        open.push({
          decisionIndex: index,
          decisionId: data.decisionId,
          mode: data.mode === 'auto' ? 'auto' : 'shadow',
          action: data.action === 'delegate' ? 'delegate' : 'self',
          samples: 0,
        })
      }
      continue
    }
    if (event.type === 'router/evaluation') {
      const { decisionId } = event.data as { decisionId?: unknown }
      if (typeof decisionId === 'string') {
        evaluated.add(decisionId)
        // 已归账的在途决策立即出列（至多一条 evaluation 的投影侧保证）。
        for (const entry of open) {
          if (entry.decisionId === decisionId) entry.samples = -1
        }
      }
      continue
    }
    if (event.type === 'tool/result') {
      for (const entry of open) {
        if (entry.samples < config.windowToolResults) entry.samples++
      }
    }
  }
  return open.filter(entry => entry.samples >= config.windowToolResults)
}

/* jscpd:ignore-start */
/** 一条已归账评估（readiness 投影的中间形态）。 */
export interface EvaluatedDecision {
  decisionId: string
  mode: 'shadow' | 'auto'
  action: 'self' | 'delegate'
  classification: ObservationClassification
  /** 评估窗口内的失败数（false-green 判定输入）。 */
  failures: number
}

/**
 * 已归账评估投影（日志顺序）：decision + 配对 evaluation 的合并视图，
 * readiness/canary 证据的数据源。
 * @param events - 会话事件日志。
 * @returns 已归账评估列表。
 */
export function evaluatedDecisions(events: readonly SessionEvent[]): EvaluatedDecision[] {
  interface DecisionRecord {
    mode: 'shadow' | 'auto'
    action: 'self' | 'delegate'
    subagentSessionId?: string
  }
  const decisions = new Map<string, DecisionRecord>()
  const order: string[] = []
  const evaluations = new Map<string, { classification: ObservationClassification; failures: number }>()
  for (const event of events) {
    if (event.type === 'router/decision') {
      const data = event.data as { decisionId?: unknown; mode?: unknown; action?: unknown; subagentSessionId?: unknown }
      if (typeof data.decisionId !== 'string') continue
      decisions.set(data.decisionId, {
        mode: data.mode === 'auto' ? 'auto' : 'shadow',
        action: data.action === 'delegate' ? 'delegate' : 'self',
        ...(typeof data.subagentSessionId === 'string' ? { subagentSessionId: data.subagentSessionId } : {}),
      })
      order.push(data.decisionId)
      continue
    }
    if (event.type === 'router/evaluation') {
      const data = event.data as { decisionId?: unknown; classification?: unknown; windowFailures?: unknown }
      if (typeof data.decisionId !== 'string') continue
      evaluations.set(data.decisionId, {
        classification: data.classification === 'recovered' || data.classification === 'persisted'
          ? data.classification
          : 'inconclusive',
        failures: typeof data.windowFailures === 'number' ? data.windowFailures : 0,
      })
    }
  }
  const result: EvaluatedDecision[] = []
  for (const decisionId of order) {
    const decision = decisions.get(decisionId)
    const evaluation = evaluations.get(decisionId)
    if (decision === undefined || evaluation === undefined) continue
    result.push({
      decisionId,
      mode: decision.mode,
      action: decision.action,
      classification: evaluation.classification,
      failures: evaluation.failures,
    })
  }
  return result
}
/* jscpd:ignore-end */

/** shadow readiness 证据（promotion.ts 的 veto 阶梯输入）。 */
export interface ShadowReadinessEvidence {
  /** readiness 窗口内已评估决策数。 */
  samples: number
  /** 其中 delegate 决策数。 */
  delegateSamples: number
  /**
   * 假绿率：delegate 决策中「警报自愈」（分类 recovered 且窗口零失败——
   * 路由对已恢复的环境开了火）的占比，0-1。
   */
  falseGreenRate: number
  /** 范围健康：persisted 占比映射 healthy / medium / high。 */
  scopeHealth: 'healthy' | 'medium' | 'high'
}

/** readiness 配置（Config `readiness` 字段，全部校验）。 */
export interface ReadinessConfig {
  /** 统计窗口：最近多少条已评估决策。 */
  window: number
  /** 最小样本（低于即 veto insufficient）。 */
  minSamples: number
  /** 假绿率上限（> 即 veto）。 */
  maxFalseGreenRate: number
  /** persisted 占比 ≥ 此值 → scopeHealth high（>0 → medium）。 */
  persistedScopeShare: number
}

/**
 * 校验并默认 readiness 配置（形状非法 fail loud）。
 * @param raw - 组合层原始字段（全部可选）。
 * @returns 字段齐备且通过校验的 readiness 配置。
 */
export function resolveReadinessConfig(raw: {
  window?: number
  minSamples?: number
  maxFalseGreenRate?: number
  persistedScopeShare?: number
}): ReadinessConfig {
  const config: ReadinessConfig = {
    window: raw.window ?? 30,
    minSamples: raw.minSamples ?? 30,
    maxFalseGreenRate: raw.maxFalseGreenRate ?? 0,
    persistedScopeShare: raw.persistedScopeShare ?? 0.5,
  }
  for (const key of ['window', 'minSamples'] as const) {
    const value = config[key]
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`agent-router: readiness.${key} must be a positive integer, got ${JSON.stringify(value)}`)
    }
  }
  for (const key of ['maxFalseGreenRate', 'persistedScopeShare'] as const) {
    const value = config[key]
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`agent-router: readiness.${key} must be within [0, 1], got ${JSON.stringify(value)}`)
    }
  }
  return config
}

/**
 * shadow readiness 证据投影：最近 `config.window` 条已评估决策上的样本、
 * 假绿率与范围健康。零派发假设下的诚实信号——不含任何收益边际。
 * @param events - 会话事件日志。
 * @param config - readiness 配置。
 * @returns readiness 证据。
 */
export function shadowReadiness(events: readonly SessionEvent[], config: ReadinessConfig): ShadowReadinessEvidence {
  const evaluated = evaluatedDecisions(events).slice(-config.window)
  const delegateEvaluated = evaluated.filter(entry => entry.action === 'delegate')
  const falseGreens = delegateEvaluated.filter(entry => entry.classification === 'recovered' && entry.failures === 0)
  const persistedShare = delegateEvaluated.length > 0
    ? delegateEvaluated.filter(entry => entry.classification === 'persisted').length / delegateEvaluated.length
    : 0
  return {
    samples: evaluated.length,
    delegateSamples: delegateEvaluated.length,
    falseGreenRate: delegateEvaluated.length > 0 ? falseGreens.length / delegateEvaluated.length : 0,
    scopeHealth: persistedShare >= config.persistedScopeShare ? 'high' : persistedShare > 0 ? 'medium' : 'healthy',
  }
}

/** canary health 证据（真实派发后的运行健康）。 */
export interface CanaryHealthEvidence {
  /** canary 窗口内真实派发数（router/route 记录）。 */
  dispatches: number
  /** 主代理 adopt 声明数。 */
  adopted: number
  /** 主代理 reject 声明数。 */
  rejected: number
  /** 预算耗尽终态的 outcome 数。 */
  budgetExhausted: number
  /**
   * 收益代理：canary 窗口内「已评估的真实派发决策」中 recovered 占比
   * （0-1）；无已评估派发时为 0（由 veto 阶梯以样本门先行拦住）。
   */
  benefitProxy: number
  /** 参与收益代理计算的已评估派发决策数。 */
  evaluatedDispatches: number
}

/** canary 配置（Config `canary` 字段，全部校验）。 */
export interface CanaryConfig {
  /** 统计窗口：最近多少次真实派发。 */
  window: number
  /** 最小派发数（低于即 veto insufficient）。 */
  minDispatches: number
  /** 预算耗尽占比上限（> 即 veto）。 */
  maxBudgetExhaustedShare: number
  /** 收益代理下限（有已评估派发且低于此值即 veto）。 */
  minBenefitProxy: number
}

/**
 * 校验并默认 canary 配置（形状非法 fail loud）。
 * @param raw - 组合层原始字段（全部可选）。
 * @returns 字段齐备且通过校验的 canary 配置。
 */
export function resolveCanaryConfig(raw: {
  window?: number
  minDispatches?: number
  maxBudgetExhaustedShare?: number
  minBenefitProxy?: number
}): CanaryConfig {
  const config: CanaryConfig = {
    window: raw.window ?? 30,
    minDispatches: raw.minDispatches ?? 10,
    maxBudgetExhaustedShare: raw.maxBudgetExhaustedShare ?? 0.1,
    minBenefitProxy: raw.minBenefitProxy ?? 0.5,
  }
  for (const key of ['window', 'minDispatches'] as const) {
    const value = config[key]
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`agent-router: canary.${key} must be a positive integer, got ${JSON.stringify(value)}`)
    }
  }
  for (const key of ['maxBudgetExhaustedShare'] as const) {
    const value = config[key]
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`agent-router: canary.${key} must be within [0, 1], got ${JSON.stringify(value)}`)
    }
  }
  if (!Number.isFinite(config.minBenefitProxy) || config.minBenefitProxy < 0 || config.minBenefitProxy > 1) {
    throw new Error(`agent-router: canary.minBenefitProxy must be within [0, 1], got ${JSON.stringify(config.minBenefitProxy)}`)
  }
  return config
}

/**
 * canary health 证据投影：最近 `config.window` 次真实派发（router/route）
 * 上的派发、adopt/reject、预算终态与收益代理。
 * @param events - 会话事件日志。
 * @param config - canary 配置。
 * @returns canary 证据。
 */
export function canaryHealth(events: readonly SessionEvent[], config: CanaryConfig): CanaryHealthEvidence {
  const routes = events.filter(event => event.type === 'router/route').slice(-config.window)
  const windowChildIds = new Set(routes.map(event => (event.data as { subagentSessionId?: unknown }).subagentSessionId)
    .filter((id): id is string => typeof id === 'string'))
  let adopted = 0
  let rejected = 0
  let budgetExhausted = 0
  for (const event of events) {
    if (event.type === 'router/adoption') {
      const { subagentSessionId, verdict } = event.data as { subagentSessionId?: unknown; verdict?: unknown }
      if (typeof subagentSessionId === 'string' && windowChildIds.has(subagentSessionId)) {
        if (verdict === 'adopt') adopted++
        if (verdict === 'reject') rejected++
      }
      continue
    }
    if (event.type === 'router/outcome' && (event.data as { stopReason?: unknown }).stopReason === 'budget-exhausted') {
      const { subagentSessionId } = event.data as { subagentSessionId?: unknown }
      if (typeof subagentSessionId === 'string' && windowChildIds.has(subagentSessionId)) budgetExhausted++
    }
  }
  // 收益代理：真实派发（dispatched 的 delegate 决策）经评估后 recovered 占比。
  const dispatchedByDecision = new Map<string, string>()
  for (const event of events) {
    if (event.type !== 'router/decision') continue
    const data = event.data as { decisionId?: unknown; dispatched?: unknown; subagentSessionId?: unknown }
    if (data.dispatched === true && typeof data.decisionId === 'string' && typeof data.subagentSessionId === 'string') {
      dispatchedByDecision.set(data.decisionId, data.subagentSessionId)
    }
  }
  const evaluatedDispatches = evaluatedDecisions(events)
    .filter(entry => dispatchedByDecision.has(entry.decisionId))
  const recoveredShare = evaluatedDispatches.length > 0
    ? evaluatedDispatches.filter(entry => entry.classification === 'recovered').length / evaluatedDispatches.length
    : 0
  return {
    dispatches: routes.length,
    adopted,
    rejected,
    budgetExhausted,
    benefitProxy: recoveredShare,
    evaluatedDispatches: evaluatedDispatches.length,
  }
}
