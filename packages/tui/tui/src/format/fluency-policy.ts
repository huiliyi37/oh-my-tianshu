/**
 * fluency-policy — 流利度策略（9d 移植，ActivityPhase 适配本包 5 值）。
 *
 * 从信号（phase/silentMs/outputRate/resultLength/contextPressure/isError/
 * isApproval/consecutiveRoutine）推出渲染策略：visibility（normal/quiet/
 * inspect/stress）、foldRoutine、coalesceMs、stale 提示。
 *
 * 移植自 .rivet/tui-source/tui/fluency-policy.ts（Apache-2.0；SOURCE-MAP.md）。
 * 差异：本包 ActivityPhase 为 idle/tool/waiting/thinking/streaming 五值，
 * 源的 analyzing/mcp/compacting/preflight 档位及其分支已删除。
 *
 * @module @huiliyi37/dsh-tui/format/fluency-policy
 */

import type { ActivityPhase } from '../activity-status.js'

// --- Fluency Policy ---

/** 渲染可见度档位：normal 常规 / quiet 折叠例行 / inspect 醒目呈现 / stress 高压聚合。 */
export type FluencyVisibility = 'normal' | 'quiet' | 'inspect' | 'stress'

/** 策略输入信号：活动相位、静默时长、输出速率与错误/审批标记等。 */
export interface FluencySignals {
  phase: ActivityPhase
  silentMs: number
  outputRate: number       // chars/sec
  resultLength: number
  contextPressure: number  // 0..1
  isError: boolean
  isApproval: boolean
  consecutiveRoutine: number
}

/** 策略输出：可见度、是否折叠例行事件、聚合窗口与可选停滞提示。 */
export interface FluencyPolicy {
  visibility: FluencyVisibility
  foldRoutine: boolean
  coalesceMs: number
  staleMessage?: string
  staleLevel?: 'info' | 'warn' | 'action'
}

const HIGH_VOLUME_RESULT_LENGTH = 50_000
const HIGH_OUTPUT_RATE = 50_000

// Phase-aware stale tiers: [info threshold, warn threshold, actionable threshold]
const PHASE_STALE_TIERS: Record<ActivityPhase, [number, number, number]> = {
  thinking:  [30_000,  90_000, 180_000],
  streaming: [15_000,  60_000, 120_000],
  tool:      [45_000,  90_000, 180_000],
  waiting:   [15_000,  60_000, 120_000],
  idle:      [15_000,  60_000, 120_000],
}

/** 按阶段分档的等待提示。到 action 档会明确告诉用户可以 Ctrl+C——长等待里
 *  「还活着吗 / 我能做什么」是唯一真正要回答的两个问题。
 *
 *  由 TuiApp.renderLive 的 spinner 区直接消费。
 * @param phase - 当前活动相位（决定分档阈值与文案）。
 * @param silentMs - 静默时长（毫秒）。
 * @returns 达到 info/warn/action 档时返回提示与级别；未达 info 档返回 null。 */
export function getPhaseStaleMessage(phase: ActivityPhase, silentMs: number): { message: string; level: 'info' | 'warn' | 'action' } | null {
  // noUncheckedIndexedAccess 下 Record 索引返回 | undefined；本表全 phase 覆盖，
  // ?? streaming 兜底是类型收窄而非运行时分支（全 phase 键均存在）。
  /* v8 ignore next -- ActivityPhase 收窄为五值且 PHASE_STALE_TIERS 全键覆盖，?? 右分支运行时不可达 */
  const raw = PHASE_STALE_TIERS[phase] as [number, number, number] | undefined
  const tiers = raw ?? PHASE_STALE_TIERS.streaming
  const [info, warn, action] = tiers
  const sec = Math.round(silentMs / 1000)
  const min = Math.round(silentMs / 60_000)

  if (silentMs >= action) {
    if (phase === 'thinking') return { message: `Long think — Ctrl+C to stop (${min}m)`, level: 'action' }
    if (phase === 'tool') return { message: `Tool may be stuck — Ctrl+C (${min}m)`, level: 'action' }
    return { message: `No response — Ctrl+C to interrupt (${min}m)`, level: 'action' }
  }
  if (silentMs >= warn) {
    if (phase === 'thinking') return { message: `Collecting context... ${min}m`, level: 'warn' }
    if (phase === 'tool') return { message: `Tool running long... ${min}m`, level: 'warn' }
    return { message: `Still waiting... ${min}m`, level: 'warn' }
  }
  if (silentMs >= info) {
    if (phase === 'thinking') return { message: `Thinking deeply... ${sec}s`, level: 'info' }
    if (phase === 'tool') return { message: `Executing tools... ${sec}s`, level: 'info' }
    return { message: `Waiting for response... ${sec}s`, level: 'info' }
  }
  return null
}

/**
 * 从信号推出渲染策略。优先级：错误/审批（恒 inspect）> 高上下文压力
 * （stress + 聚合）> 长静默（inspect + stale 提示）> 大结果/高输出速率
 * （inspect + 折叠）> 连续例行（quiet）> normal。
 * @param signals - 当前信号快照。
 * @returns 命中的首个策略档位。
 */
export function computeFluencyPolicy(signals: FluencySignals): FluencyPolicy {
  // Errors and approvals always surface
  if (signals.isError) {
    return { visibility: 'inspect', foldRoutine: false, coalesceMs: 0 }
  }
  if (signals.isApproval) {
    return { visibility: 'inspect', foldRoutine: false, coalesceMs: 0 }
  }

  // High context pressure → stress mode with coalescing
  if (signals.contextPressure >= 0.8) {
    return { visibility: 'stress', foldRoutine: true, coalesceMs: 1000 + Math.round(signals.contextPressure * 2000) }
  }

  // Silent too long → stale inspection (phase-aware thresholds)
  if (signals.silentMs >= 15_000) {
    const stale = getPhaseStaleMessage(signals.phase, signals.silentMs)
    if (stale) {
      return {
        visibility: 'inspect',
        foldRoutine: false,
        coalesceMs: 0,
        staleMessage: stale.message,
        staleLevel: stale.level,
      }
    }
  }

  if (signals.resultLength >= HIGH_VOLUME_RESULT_LENGTH || signals.outputRate >= HIGH_OUTPUT_RATE) {
    return { visibility: 'inspect', foldRoutine: true, coalesceMs: 1000 }
  }

  // Many consecutive routine events → quiet mode
  if (signals.consecutiveRoutine >= 4) {
    return { visibility: 'quiet', foldRoutine: true, coalesceMs: 500 }
  }

  return { visibility: 'normal', foldRoutine: false, coalesceMs: 0 }
}

// --- Routine Counter ---

/** 连续例行事件计数器：非例行事件即清零，连续 ≥4 次触发折叠。 */
export class RoutineCounter {
  private _count = 0

  /** 当前连续例行事件计数。 */
  get count(): number { return this._count }

  /**
   * 记录一个事件：例行则累加，非例行则清零。
   * @param isRoutine - 该事件是否例行。
   */
  record(isRoutine: boolean): void {
    this._count = isRoutine ? this._count + 1 : 0
  }

  /** 清零计数。 */
  reset(): void { this._count = 0 }

  /** 是否应折叠例行事件（连续 ≥4 次）。 */
  get shouldFold(): boolean { return this._count >= 4 }
}
