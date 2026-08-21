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
import { DEFAULT_PROFILE_TOOLS, dispatchSubagent, type DispatchOptions, type DispatchOutcome } from './dispatch.js'
import { mergeBudgetOverride, resolveBudgetConfig, shapeWriteBudget, type BudgetConfig } from './budget.js'
import { ADOPT_TOOL_NAME, DEFAULT_SYNTHESIS_SECTION, parseAdoptArgs, pendingOutcomes, renderSynthesisSection, verificationGap } from './synthesis.js'

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
     * Paired one-to-one with the acceptance `router/route` record.
     */
    'router/outcome': { subagentSessionId: string; stopReason: string }
    /**
     * Durable adoption record on the parent session's own log: log-only
     * (never reaches the model surface), whole-value append via the
     * `router_adopt` tool. Pairs with a `router/outcome` record — the main
     * agent declares adopt/reject with a reason; at most one per outcome.
     */
    'router/adoption': { subagentSessionId: string; verdict: 'adopt' | 'reject'; reason: string }
    /**
     * 触发评估的持久记录（父会话日志，log-only，不进模型面）：每次 turn-end
     * 评估落一条——profile/task/targets 是判定输入，mode 区分 shadow（只记录
     * 不派发）与 auto（真实派发），dispatched 与 subagentSessionId 记录派发
     * 结果（仅 auto 且真实派发时携带 subagentSessionId）。
     */
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
  const budgetConfig: BudgetConfig = resolveBudgetConfig(config.budget ?? {})
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

  // —— 派发执行（service.execute 与 turn-end 触发共用）——
  const executeAction = async (
    action: RouterAction,
    sessionId: SessionId,
    signal?: AbortSignal,
  ): Promise<DispatchOutcome | null> => {
    // 短路条件即 canDispatch 的展开（保留 undefined 收窄，TS 友好）。
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
      budget: mergeBudgetOverride(undefined, shapeWriteBudget(action.targets.length, budgetConfig)),
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
    // 禅阶段（对齐/锚定轮）整体跳过：会话尚在进入状态，受限工具面上的指标
    // 决策不出可信路由——不决策、不记录、不派发，晋升 full 后的下一轮起
    // 才参与。微任务出窗：runTrigger 的同步前缀（shadow 的记录 append）会
    // 重入 turn/end 尚在发布中的 Session.append，撞上重入守卫即 fatal。
    if (event.type === 'turn/end' && trigger.onTurnEnd && trigger.mode !== 'off') {
      void queueMicrotask(() => {
        if (foldZenPhase(owner.events) === 'zen') return
        void runTrigger(owner)
      })
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
export { dispatchSubagent, SUBAGENT_TASK_PREFIX, type DispatchOptions, type DispatchOutcome } from './dispatch.js'
export { ADOPT_TOOL_NAME, DEFAULT_SYNTHESIS_SECTION, parseAdoptArgs, pendingOutcomes, renderSynthesisSection, verificationGap, type AdoptArgs, type AdoptVerdict, type PendingOutcome } from './synthesis.js'
export { mergeBudgetOverride, resolveBudgetConfig, shapeWriteBudget, type BudgetConfig, type BudgetShape } from './budget.js'
export { MIN_MARGIN, MIN_SAMPLES, effectivePromotionMode, resolvePromotionGate, type PromotionEvidence, type PromotionGateResult, type PromotionMode } from './promotion.js'
