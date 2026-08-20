/**
 * agent-router — Cordis 插件接线：指标采集 → 路由决策 → dsh 原生子代理派发。
 *
 * 三个钩子（全部走 dsh 既有机制）：
 * 1. 指标采集：`ctx.on('session/event')` tool/result → recordPrediction
 *    （工具成败累计器，按 session 隔离、child 会话排除）；evidence tracker
 *    指标经 reflect.get('evidence', false) 读取（无 evidence-gate 时缺省
 *    空值，prediction 独立工作）。
 * 2. 路由决策：`ctx.router.decide()` 返回 RouterAction（纯函数 decideRouterAction）。
 * 3. 子代理派发：delegate 动作 → dispatchSubagent（dsh 子代理 seam：
 *    ctx.subagents.start；血统/深度/投影由 seam 自动写）。
 *
 * 未装配时零行为（可选插件）；子代理结果经 session/event 自动归账回
 * evidence-gate（零新通道）。
 *
 * @module @huiliyi37/dsh-agent-router
 */

import type { Context } from '@huiliyi37/cordis'
import type { Session, SessionEvent, SessionId } from '@huiliyi37/dsh-session'
import type {} from '@huiliyi37/dsh-agent' // 'agent/disposed' 事件声明合并'
import {
  createPredictionAccumulator,
  getConsecutiveFailures,
  getInterventionLevel,
  recordPrediction,
  resetAccumulator,
  shouldTippingPointReset,
} from './prediction.js'
import { decideRouterAction, type EscalationPolicy, type RouterAction, type RouterMetrics } from './router.js'
import { DEFAULT_PROFILE_TOOLS, dispatchSubagent, type DispatchOptions, type DispatchOutcome } from './dispatch.js'

/** 插件名（cordis.yml 装配用）。 */
export const name = 'agent-router'

declare module '@huiliyi37/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Durable route record on the PARENT session's log: log-only (never
     * reaches the model surface), whole-value append at acceptance. One per
     * accepted delegate — a session may route many delegates.
     */
    'router/route': { profile: 'code_scout' | 'verifier'; task: string; targets: string[]; subagentSessionId: string }
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
     * Paired one-to-one with the acceptance `router/route` record.
     */
    'router/outcome': { subagentSessionId: string; stopReason: string }
    'router/decision': {
      profile: 'code_scout' | 'verifier'
      task: string
      targets: string[]
      reason: 'turn-end'
      mode: 'shadow' | 'auto'
      dispatched: boolean
      subagentSessionId?: string
    }
  }
}

/** evidence 服务最小面（可选——无 evidence-gate 时 metrics 缺省）。 */
interface EvidenceFacet {
  unresolvedHigh(): { id: string; claim: string; targets: string[] }[]
  cooldownTable(): Record<string, number>
  verificationCount(): number
}

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
  /** 派发子代理所用 provider；缺省随子代理服务的默认路由。 */
  provider?: string
  /** 派发子代理所用模型名；缺省随子代理服务的默认路由。 */
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
   * 升级迟滞（escalate 分支的钳制与最小连续失败数）。缺省 cap 'verifier'、
   * minConsecutiveFailures 2——单次偶发失败不触发升级。
   */
  escalation?: {
    /** 升级目标钳制（'off' 关闭升级分支）。 */
    cap?: 'off' | 'verifier'
    /** 允许 escalate 的最小连续失败次数（正整数）。 */
    minConsecutiveFailures?: number
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
  const predictions = new Map<SessionId, ReturnType<typeof createPredictionAccumulator>>()
  const dispatchEnabled = config.dispatchEnabled ?? true

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

  // —— 派发执行（service.execute 与 turn-end 触发共用）——
  const executeAction = async (
    action: RouterAction,
    sessionId: SessionId,
    signal?: AbortSignal,
  ): Promise<DispatchOutcome | null> => {
    if (action.kind !== 'delegate' || !dispatchEnabled) return null
    if (config.provider === undefined || config.model === undefined) return null
    const opts: DispatchOptions = {
      profile: action.profile,
      task: action.task,
      targets: action.targets,
      provider: config.provider,
      model: config.model,
      tools: profileTools[action.profile],
      subagentProvider,
      parentSessionId: sessionId,
      signal: signal ?? new AbortController().signal,
    }
    return dispatchSubagent(ctx, opts)
  }

  // —— turn-end 触发：自动 decide + 决策记录（shadow）/ seam 派发（auto）——
  const runTrigger = async (owner: Session): Promise<void> => {
    const action = decideRouterAction(collectMetrics(owner.id), obligationHint(), escalationPolicy)
    if (action.kind !== 'delegate') return // self 决策不落记录（避免逐轮噪声）
    if (trigger.mode === 'shadow') {
      owner.append('router/decision', {
        profile: action.profile,
        task: action.task,
        targets: action.targets,
        reason: 'turn-end',
        mode: 'shadow',
        dispatched: false,
      })
      return
    }
    // auto：决策 + 派发；派发失败不打断 turn，但必须留痕（决策记录 + 错误日志）。
    const decision: { dispatched: boolean; subagentSessionId?: string } = { dispatched: true }
    try {
      const outcome = await executeAction(action, owner.id)
      if (outcome === null) {
        // 缺 provider/model 等短路：决策记录 dispatched false（原因在装配态）。
        decision.dispatched = false
      } else {
        decision.subagentSessionId = outcome.sessionId
      }
    } catch (error) {
      decision.dispatched = false
      ctx.logger.error('agent-router: turn-end dispatch failed for %s: %o', owner.id, error)
    }
    owner.append('router/decision', {
      profile: action.profile,
      task: action.task,
      targets: action.targets,
      reason: 'turn-end',
      mode: 'auto',
      ...decision,
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
    }
    // turn-end 触发（生产触发点）：shadow 只决策并记录；auto 决策并派发。
    if (event.type === 'turn/end' && trigger.onTurnEnd && trigger.mode !== 'off') {
      void runTrigger(owner)
    }
  })

  // —— 会话终结回收：agent 注销时 evict 该会话的累计器（长驻进程防无界增长）——
  ctx.on('agent/disposed', ({ agent }) => {
    predictions.delete(agent.session.id)
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
export { dispatchSubagent, SUBAGENT_TASK_PREFIX, type DispatchOptions } from './dispatch.js'
