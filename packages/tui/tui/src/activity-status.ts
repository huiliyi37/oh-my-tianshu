/**
 * activity-status — 实时活动投影（纯状态机，无 IO）。
 *
 * 输入事件流（tool-call / tool-result / agent-status / assistant-chunk / turn-end）
 * 折叠为单条活动状态：phase（idle/tool/waiting/thinking/streaming）+ 状态
 * （idle/active/completed/failed）+ 起止时间。耗时/摘要格式化无假精度。
 */
import type { AgentStatus } from '@huiliyi37/dsh-agent'
import type { StreamChunk } from '@huiliyi37/dsh-llm'

/** 工具失败信息（tool-result 事件携带；出现即判定活动 failed）。 */
export interface ToolError {
  name: string
  code: string
}

/** 活动阶段：状态机折叠出的当前工作阶段（fluency-policy 消费）。 */
export type ActivityPhase = 'idle' | 'tool' | 'waiting' | 'thinking' | 'streaming'

/** 输入事件联合：上游事件流映射为的活动状态机输入（time 为事件时间戳）。 */
export type ActivityEvent =
  | { type: 'tool-call'; name: string; time: number }
  | { type: 'tool-result'; time: number; error?: ToolError }
  | { type: 'agent-status'; status: AgentStatus; time: number }
  | { type: 'assistant-chunk'; chunk: StreamChunk; time: number }
  | { type: 'turn-end'; time: number }

/** 折叠出的单条活动状态：阶段 + 完成态 + 起止时间（completedAt 仅完成/失败后有值）。 */
export interface ActivityState {
  phase: ActivityPhase
  label?: string
  startedAt: number
  lastEventAt: number
  status: 'idle' | 'active' | 'completed' | 'failed'
  completedAt?: number
}

/**
 * 空活动状态（idle，起止时间均为 now）。
 * @param now - 当前时间戳。
 * @returns idle 初始状态。
 */
export function emptyActivity(now: number): ActivityState {
  return { phase: 'idle', startedAt: now, lastEventAt: now, status: 'idle' }
}

/**
 * 已知工具 → 人类可读活动标签；未知回退 `Running <name>`。
 * @param name - 工具名。
 * @returns 活动标签。
 */
export function toolActivityLabel(name: string): string {
  switch (name) {
    case 'read_file': return 'Reading file'
    case 'write_file': return 'Writing file'
    case 'edit_file': return 'Editing file'
    case 'bash': return 'Running shell'
    case 'run_tests': return 'Running tests'
    default: return `Running ${name}`
  }
}

/**
 * 折叠一个事件进入活动状态（纯函数）：tool-call 开启活动、tool-result 定格
 * 完成/失败、agent-status idle 与 turn-end 重置、assistant-chunk 切 thinking/streaming。
 * @param state - 当前活动状态。
 * @param event - 输入事件。
 * @returns 新活动状态。
 */
export function applyActivityEvent(state: ActivityState, event: ActivityEvent): ActivityState {
  switch (event.type) {
    case 'tool-call':
      return {
        ...state,
        phase: 'tool',
        label: toolActivityLabel(event.name),
        startedAt: event.time,
        lastEventAt: event.time,
        status: 'active',
      }
    case 'tool-result':
      return {
        ...state,
        lastEventAt: event.time,
        status: event.error === undefined ? 'completed' : 'failed',
        completedAt: event.time,
      }
    case 'agent-status':
      if (event.status === 'idle') {
        return { ...emptyActivity(event.time) }
      }
      if (state.status === 'active' || state.status === 'idle') {
        return { ...state, phase: 'waiting', status: 'active', lastEventAt: event.time }
      }
      return { ...state, lastEventAt: event.time }
    case 'assistant-chunk': {
      const phase = event.chunk.type === 'reasoning-delta' ? 'thinking' : 'streaming'
      return { ...state, phase, lastEventAt: event.time, status: state.status === 'idle' ? 'active' : state.status }
    }
    case 'turn-end':
      return { ...emptyActivity(event.time) }
  }
}

/**
 * 耗时格式化（无假精度）：<60s 纯秒；≥60s 分+秒。
 * @param ms - 耗时（毫秒；负值按 0 处理）。
 * @returns 格式化文本（如 `42s` / `2m 5s`）。
 */
export function formatActivityDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${s % 60}s`
}

/**
 * 活动摘要：idle → undefined；active → `<label> · <elapsed>`；completed/failed → `<label> completed/failed in <elapsed>`。
 * @param state - 活动状态。
 * @param now - 当前时间戳（active 时计算进行中耗时）。
 * @returns 摘要文本；idle 返回 undefined。
 */
export function formatActivitySummary(state: ActivityState, now: number): string | undefined {
  if (state.status === 'idle') return undefined
  const label = state.label ?? 'Activity'
  if (state.status === 'active') {
    return `${label} · ${formatActivityDuration(now - state.startedAt)}`
  }
  const end = state.completedAt ?? now
  const verb = state.status === 'completed' ? 'completed' : 'failed'
  return `${label} ${verb} in ${formatActivityDuration(end - state.startedAt)}`
}
