/**
 * agent-router — Cordis 插件接线：指标采集 → 路由决策 → dsh 原生子代理派发。
 *
 * 三个钩子（全部走 dsh 既有机制）：
 * 1. 指标采集：`ctx.on('session/event')` tool/result → recordPrediction
 *    （工具成败累计器）；evidence tracker 指标经 reflect.get('evidence', false)
 *    读取（无 evidence-gate 时缺省空值，prediction 独立工作）。
 * 2. 路由决策：`ctx.router.decide()` 返回 RouterAction（纯函数 decideRouterAction）。
 * 3. 子代理派发：delegate 动作 → dispatchSubagent（dsh 原生 agents.create）。
 *
 * 未装配时零行为（可选插件）；子代理结果经 session/event 自动归账回
 * evidence-gate（零新通道）。
 *
 * @module @huiliyi37/dsh-agent-router
 */

import type { Context } from '@huiliyi37/cordis'
import type { SessionEvent, SessionId } from '@huiliyi37/dsh-session'
import {
  createPredictionAccumulator,
  getInterventionLevel,
  recordPrediction,
  resetAccumulator,
  shouldTippingPointReset,
} from './prediction.js'
import { decideRouterAction, type RouterAction, type RouterMetrics } from './router.js'
import { DEFAULT_PROFILE_TOOLS, dispatchSubagent, type DispatchOptions } from './dispatch.js'

/** 插件名（cordis.yml 装配用）。 */
export const name = 'agent-router'

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
  /** 当前指标快照。 */
  metrics(): RouterMetrics
  /** 路由决策（纯函数；可重复调用）。 */
  decide(): RouterAction
  /** 执行动作（delegate → 派发子代理；self → no-op）。 */
  execute(action: RouterAction): Promise<SessionId | null>
  /** 重置预测累计器（环境恢复后调用）。 */
  resetPrediction(): void
}

/** 插件装配：指标采集 + 路由服务面 + 派发。 */
export function apply(ctx: Context, config: AgentRouterConfig = {}): void {
  const profileTools = resolveProfileTools(config)
  let prediction = createPredictionAccumulator()
  const dispatchEnabled = config.dispatchEnabled ?? true

  // —— 指标采集：tool/result 成败喂 prediction ——
  ctx.on('session/event', (_owner: { id: SessionId }, event: SessionEvent) => {
    if (event.type !== 'tool/result') return
    const block = event.data.message.content[0]
    // 成败判定：isError 标记（工具异常）或输出含非零退出码（dsh bash 对
    // 非零退出码不标 isError，退出码在文本 `[exit code: N]`——真实装配实证）。
    const text = extractResultText(event.data.message)
    const exitFail = /\[exit code: [1-9]\d*\]/.test(text)
    const isError = block.isError === true || exitFail
    prediction = recordPrediction(prediction, !isError)
    // tipping point：连续 3 次正确 → 环境恢复，重置累计器（干预撤销）
    if (shouldTippingPointReset(prediction)) {
      prediction = resetAccumulator(prediction)
    }
  })

  // —— 指标组装（evidence 可选）——
  const collectMetrics = (): RouterMetrics => {
    const evidence = ctx.reflect.get('evidence', false) as unknown as EvidenceFacet | undefined
    const high = evidence?.unresolvedHigh() ?? []
    const cooled = evidence?.cooldownTable() ?? {}
    const cooledTargets = Object.values(cooled).filter(v => v >= 2).length
    return {
      interventionLevel: getInterventionLevel(prediction),
      unresolvedHigh: high.length,
      verifications: evidence?.verificationCount() ?? 0,
      probeCooledTargets: cooledTargets,
    }
  }

  // —— 义务提示（delegate 任务描述素材）——
  const obligationHint = (): { claim: string; targets: string[] } | undefined => {
    const evidence = ctx.reflect.get('evidence', false) as unknown as EvidenceFacet | undefined
    const first = evidence?.unresolvedHigh()[0]
    return first === undefined
      ? undefined
      : { claim: first.claim, targets: first.targets }
  }

  const service: RouterService = {
    metrics: collectMetrics,
    decide: () => decideRouterAction(collectMetrics(), obligationHint()),
    execute: async (action) => {
      if (action.kind !== 'delegate' || !dispatchEnabled) return null
      if (config.provider === undefined || config.model === undefined) return null
      const opts: DispatchOptions = {
        profile: action.profile,
        task: action.task,
        targets: action.targets,
        provider: config.provider,
        model: config.model,
        tools: profileTools[action.profile],
      }
      return dispatchSubagent(ctx, opts)
    },
    resetPrediction: () => { prediction = resetAccumulator(prediction) },
  }
  ctx.provide('router', service)
}

export { createPredictionAccumulator, getErrorRate, getInterventionLevel, recordPrediction, resetAccumulator, shouldTippingPointReset } from './prediction.js'
export { decideRouterAction, type RouterAction, type RouterMetrics } from './router.js'
export { dispatchSubagent, SUBAGENT_TASK_PREFIX, type DispatchOptions } from './dispatch.js'
