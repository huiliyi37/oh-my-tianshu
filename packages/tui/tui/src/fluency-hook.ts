/**
 * fluency-hook — 流利度追踪器（9d 移植）。
 *
 * FluencyTracker 消费工具事件流（tool/call、tool/result、agent 阶段、
 * turn 边界），维护连续 routine 计数 / 输出速率 / 静默时长等信号，
 * getPolicy() 折叠为渲染策略（见 format/fluency-policy.ts）。
 *
 * 移植自 .rivet/tui-source/tui/fluency-hook.ts（Apache-2.0；SOURCE-MAP.md）。
 * 差异：ActivityPhase 适配本包五值；contextPressure 由装配层喂入
 * （0..1，TUI 无 token 数据源时保持 0）。
 *
 * @module @huiliyi37/dsh-tui/fluency-hook
 */

import { computeFluencyPolicy, RoutineCounter, type FluencyPolicy, type FluencySignals } from './format/fluency-policy.js'
import type { ActivityPhase } from './activity-status.js'

const ROUTINE_TOOLS = new Set(['read_file', 'grep', 'glob', 'inspect_project', 'repo_map', 'related_tests', 'recall', 'diff'])

/** 一次工具结果事件的追踪输入：工具名、是否出错、结果文本长度。 */
export interface ToolResultEvent {
  name: string
  isError: boolean
  resultLength: number
}

/**
 * 流利度追踪器：消费工具/阶段/回合事件，维护连续 routine 计数、
 * 输出速率、静默时长等信号，供 getPolicy() 折叠为渲染策略。
 */
export class FluencyTracker {
  private routine = new RoutineCounter()
  private lastEventAt = Date.now()
  private contextPressure = 0
  private lastIsError = false
  private lastIsApproval = false
  private phase: ActivityPhase = 'idle'
  private outputRate = 0
  private resultLength = 0
  /** 是否有请求在途（turn/start 置位，turn/end 复位）。false 时静默提示不触发。 */
  private inFlight = false

  /**
   * 判定一次工具调用是否算 routine（只读检索类且未出错）。
   * @param name - 工具名。
   * @param isError - 该次调用是否出错；出错一律不算 routine。
   * @returns 属于 routine 工具集且未出错时为 true。
   */
  isRoutineTool(name: string, isError: boolean): boolean {
    if (isError) return false
    return ROUTINE_TOOLS.has(name)
  }

  /**
   * 记录一次工具结果：更新 routine 计数、输出速率与错误/审批标记，阶段切到 tool。
   * @param event - 工具结果事件。
   */
  recordToolResult(event: ToolResultEvent): void {
    const now = Date.now()
    const elapsedSeconds = Math.max((now - this.lastEventAt) / 1000, 1)
    this.routine.record(this.isRoutineTool(event.name, event.isError))
    this.outputRate = event.resultLength / elapsedSeconds
    this.resultLength = event.resultLength
    this.lastEventAt = now
    this.lastIsError = event.isError
    this.lastIsApproval = false
    this.phase = 'tool'
  }

  /** 记录一次审批交互：置审批标记并清零连续 routine 计数。 */
  recordApproval(): void {
    this.lastIsApproval = true
    this.routine.reset()
  }

  /**
   * 由装配层喂入上下文压力信号（TUI 无 token 数据源时保持 0）。
   * @param pressure - 上下文压力，0..1。
   */
  setContextPressure(pressure: number): void {
    this.contextPressure = pressure
  }

  /**
   * 切换当前活动阶段并重置静默计时起点。
   * @param phase - 新的活动阶段。
   */
  setPhase(phase: ActivityPhase): void {
    this.phase = phase
    this.inFlight = true
    this.lastEventAt = Date.now()
  }

  /**
   * 回填已静默的时长（把静默计时起点拨回 silentMs 毫秒前）。
   * @param silentMs - 已静默的毫秒数。
   */
  updateSilence(silentMs: number): void {
    this.lastEventAt = Date.now() - silentMs
  }

  /** 回合开始：标记请求在途，重置静默计时起点。静默提示仅在在途时有效。 */
  onTurnStart(): void {
    this.inFlight = true
    this.lastEventAt = Date.now()
  }

  /** 回合结束：清空全部信号、复位在途标记并回到 idle 阶段。 */
  onTurnComplete(): void {
    this.routine.reset()
    this.lastIsError = false
    this.lastIsApproval = false
    this.outputRate = 0
    this.resultLength = 0
    this.lastEventAt = Date.now()
    this.phase = 'idle'
    this.inFlight = false
  }

  /**
   * 把当前信号快照折叠为渲染策略。
   * @returns 由 computeFluencyPolicy 计算的当前流利度策略。
   */
  getPolicy(): FluencyPolicy {
    const signals: FluencySignals = {
      phase: this.phase,
      silentMs: Date.now() - this.lastEventAt,
      outputRate: this.outputRate,
      resultLength: this.resultLength,
      contextPressure: this.contextPressure,
      isError: this.lastIsError,
      isApproval: this.lastIsApproval,
      consecutiveRoutine: this.routine.count,
      inFlight: this.inFlight,
    }
    return computeFluencyPolicy(signals)
  }
}
