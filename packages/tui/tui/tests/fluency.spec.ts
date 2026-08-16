/**
 * fluency-policy.spec.ts + fluency-hook.spec.ts — Phase 9d 流利度控制（staged spec 契约）。
 *
 * 覆盖：策略折叠全分支（error/approval/stress/stale/高量/quiet/normal）、
 * 阶段 stale 分档提示、RoutineCounter 计数/复位、FluencyTracker 信号推进
 * 与 turn 边界复位。
 */
import { describe, expect, it, vi } from 'vitest'
import { computeFluencyPolicy, getPhaseStaleMessage, RoutineCounter, type FluencySignals } from '../src/format/fluency-policy.js'
import { FluencyTracker } from '../src/fluency-hook.js'

function base(over: Partial<FluencySignals> = {}): FluencySignals {
  return {
    phase: 'streaming',
    silentMs: 0,
    outputRate: 0,
    resultLength: 0,
    contextPressure: 0,
    isError: false,
    isApproval: false,
    consecutiveRoutine: 0,
    ...over,
  }
}

describe('computeFluencyPolicy', () => {
  it('error 恒 inspect 且不折叠', () => {
    const policy = computeFluencyPolicy(base({ isError: true }))
    expect(policy).toEqual({ visibility: 'inspect', foldRoutine: false, coalesceMs: 0 })
  })

  it('approval 恒 inspect 且不折叠', () => {
    const policy = computeFluencyPolicy(base({ isApproval: true }))
    expect(policy).toEqual({ visibility: 'inspect', foldRoutine: false, coalesceMs: 0 })
  })

  it('contextPressure ≥0.8 → stress 折叠 + 随压力增长的 coalesce', () => {
    const policy = computeFluencyPolicy(base({ contextPressure: 0.9 }))
    expect(policy.visibility).toBe('stress')
    expect(policy.foldRoutine).toBe(true)
    expect(policy.coalesceMs).toBe(1000 + Math.round(0.9 * 2000))
  })

  it('静默超 15s 且命中阶段档 → stale 提示（action 档明确 Ctrl+C）', () => {
    const policy = computeFluencyPolicy(base({ phase: 'tool', silentMs: 200_000 }))
    expect(policy.visibility).toBe('inspect')
    expect(policy.staleMessage).toContain('Ctrl+C')
    expect(policy.staleLevel).toBe('action')
  })

  it('静默超 15s 但低于该 phase info 档（stale 为 null）→ 不返回 stale', () => {
    // thinking 的 info 阈值 30s；20s ≥ 15s 外层触发但 getPhaseStaleMessage 返回 null
    const policy = computeFluencyPolicy(base({ phase: 'thinking', silentMs: 20_000 }))
    expect(policy).toEqual({ visibility: 'normal', foldRoutine: false, coalesceMs: 0 })
    expect(policy.staleMessage).toBeUndefined()
  })

  it('A5：inFlight=false（回合已结束）时静默超时也不触发 stale', () => {
    const policy = computeFluencyPolicy(base({ phase: 'idle', silentMs: 200_000, inFlight: false }))
    expect(policy.staleMessage).toBeUndefined()
    expect(policy.visibility).toBe('normal')
  })

  it('A5：inFlight 缺省（在途）时 idle 静默超时仍触发 stale（初始等待场景）', () => {
    const policy = computeFluencyPolicy(base({ phase: 'idle', silentMs: 20_000 }))
    expect(policy.staleMessage).toContain('Waiting for response')
    expect(policy.staleLevel).toBe('info')
  })

  it('大结果 / 高速率 → inspect 折叠 coalesce 1s', () => {
    const policy = computeFluencyPolicy(base({ resultLength: 60_000 }))
    expect(policy).toEqual({ visibility: 'inspect', foldRoutine: true, coalesceMs: 1000 })
  })

  it('outputRate 单独超阈值（resultLength 未超）→ inspect 折叠', () => {
    const policy = computeFluencyPolicy(base({ outputRate: 60_000 }))
    expect(policy).toEqual({ visibility: 'inspect', foldRoutine: true, coalesceMs: 1000 })
  })

  it('连续 4+ routine → quiet 折叠 coalesce 500ms', () => {
    const policy = computeFluencyPolicy(base({ consecutiveRoutine: 4 }))
    expect(policy).toEqual({ visibility: 'quiet', foldRoutine: true, coalesceMs: 500 })
  })

  it('无异常信号 → normal 不折叠', () => {
    const policy = computeFluencyPolicy(base())
    expect(policy).toEqual({ visibility: 'normal', foldRoutine: false, coalesceMs: 0 })
  })
})

describe('getPhaseStaleMessage', () => {
  it('低于 info 档返回 null', () => {
    expect(getPhaseStaleMessage('tool', 5_000)).toBeNull()
  })

  it('info 档返回秒级提示', () => {
    const msg = getPhaseStaleMessage('tool', 50_000)
    expect(msg?.level).toBe('info')
    expect(msg?.message).toContain('50s')
  })

  it('warn 档返回分级提示', () => {
    const msg = getPhaseStaleMessage('thinking', 100_000)
    expect(msg?.level).toBe('warn')
    expect(msg?.message).toContain('Collecting context')
  })

  it('warn 档 tool → Tool running long', () => {
    const msg = getPhaseStaleMessage('tool', 100_000)
    expect(msg?.level).toBe('warn')
    expect(msg?.message).toContain('Tool running long')
  })

  it('warn 档 idle/waiting（非 thinking/tool）→ Still waiting', () => {
    expect(getPhaseStaleMessage('idle', 100_000)?.message).toContain('Still waiting')
    expect(getPhaseStaleMessage('waiting', 100_000)?.message).toContain('Still waiting')
  })

  it('info 档 thinking → Thinking deeply', () => {
    const msg = getPhaseStaleMessage('thinking', 50_000)
    expect(msg?.level).toBe('info')
    expect(msg?.message).toContain('Thinking deeply')
  })

  it('info 档 idle/waiting（非 thinking/tool）→ Waiting for response', () => {
    expect(getPhaseStaleMessage('idle', 50_000)?.message).toContain('Waiting for response')
    expect(getPhaseStaleMessage('waiting', 50_000)?.message).toContain('Waiting for response')
  })

  it('action 档 tool → Tool may be stuck', () => {
    const msg = getPhaseStaleMessage('tool', 200_000)
    expect(msg?.level).toBe('action')
    expect(msg?.message).toContain('Tool may be stuck')
  })

  it('action 档 thinking 明确 Long think', () => {
    const msg = getPhaseStaleMessage('thinking', 200_000)
    expect(msg?.level).toBe('action')
    expect(msg?.message).toContain('Long think')
  })

  it('未知阶段回退 streaming 档位', () => {
    // 本包 ActivityPhase 已收窄，直接以 streaming 档为兜底路径验证不抛
    const msg = getPhaseStaleMessage('streaming', 200_000)
    expect(msg?.message).toContain('Ctrl+C')
  })
})

describe('RoutineCounter', () => {
  it('routine 递增、非 routine 清零、shouldFold 阈值 4', () => {
    const counter = new RoutineCounter()
    expect(counter.count).toBe(0)
    counter.record(true)
    counter.record(true)
    counter.record(true)
    expect(counter.shouldFold).toBe(false)
    counter.record(true)
    expect(counter.shouldFold).toBe(true)
    counter.record(false)
    expect(counter.count).toBe(0)
    expect(counter.shouldFold).toBe(false)
  })

  it('reset 归零', () => {
    const counter = new RoutineCounter()
    counter.record(true)
    counter.reset()
    expect(counter.count).toBe(0)
  })
})

describe('FluencyTracker', () => {
  it('tool result 推进信号：routine 计数 / 速率 / phase', () => {
    vi.useFakeTimers()
    try {
      const tracker = new FluencyTracker()
      expect(tracker.isRoutineTool('read_file', false)).toBe(true)
      expect(tracker.isRoutineTool('read_file', true)).toBe(false)
      expect(tracker.isRoutineTool('bash', false)).toBe(false)

      tracker.recordToolResult({ name: 'read_file', isError: false, resultLength: 1000 })
      tracker.recordToolResult({ name: 'grep', isError: false, resultLength: 500 })
      tracker.recordToolResult({ name: 'glob', isError: false, resultLength: 100 })
      tracker.recordToolResult({ name: 'diff', isError: false, resultLength: 200 })

      const policy = tracker.getPolicy()
      expect(policy.visibility).toBe('quiet')
      expect(policy.foldRoutine).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('error result 打断 routine 链', () => {
    const tracker = new FluencyTracker()
    tracker.recordToolResult({ name: 'read_file', isError: false, resultLength: 10 })
    tracker.recordToolResult({ name: 'read_file', isError: true, resultLength: 10 })
    expect(tracker.getPolicy().visibility).toBe('inspect') // isError 优先
    tracker.recordToolResult({ name: 'read_file', isError: false, resultLength: 10 })
    expect(tracker.getPolicy().visibility).toBe('normal')  // 链已断
  })

  it('recordApproval 复位 routine 并置 approval 信号', () => {
    const tracker = new FluencyTracker()
    tracker.recordToolResult({ name: 'read_file', isError: false, resultLength: 10 })
    tracker.recordToolResult({ name: 'read_file', isError: false, resultLength: 10 })
    tracker.recordApproval()
    expect(tracker.getPolicy().visibility).toBe('inspect')
    tracker.recordToolResult({ name: 'read_file', isError: false, resultLength: 10 })
    expect(tracker.getPolicy().visibility).toBe('normal')
  })

  it('setPhase / setContextPressure / updateSilence 生效', () => {
    const tracker = new FluencyTracker()
    tracker.setPhase('tool')
    tracker.setContextPressure(0.9)
    expect(tracker.getPolicy().visibility).toBe('stress')
    tracker.setContextPressure(0)
    tracker.updateSilence(200_000)
    expect(tracker.getPolicy().staleMessage).toBeDefined()
  })

  it('A5：onTurnStart 置在途 → 静默提示生效；onTurnComplete 复位后不再触发', () => {
    const tracker = new FluencyTracker()
    // 初始不在途：静默再久也不提示（欢迎页/空闲场景）
    tracker.updateSilence(200_000)
    expect(tracker.getPolicy().staleMessage).toBeUndefined()
    // 回合开始 → 在途 → 静默提示恢复
    tracker.onTurnStart()
    tracker.updateSilence(20_000)
    expect(tracker.getPolicy().staleMessage).toContain('Waiting for response')
    expect(tracker.getPolicy().staleLevel).toBe('info')
    // 回合结束 → 复位 → 静默提示消失
    tracker.onTurnComplete()
    tracker.updateSilence(200_000)
    expect(tracker.getPolicy().staleMessage).toBeUndefined()
  })

  it('onTurnComplete 复位全部信号', () => {
    const tracker = new FluencyTracker()
    tracker.recordToolResult({ name: 'read_file', isError: false, resultLength: 1000 })
    tracker.recordToolResult({ name: 'read_file', isError: false, resultLength: 1000 })
    tracker.onTurnComplete()
    expect(tracker.getPolicy()).toEqual({ visibility: 'normal', foldRoutine: false, coalesceMs: 0 })
  })
})
