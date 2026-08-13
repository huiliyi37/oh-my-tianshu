/**
 * MetricsGlanceController — 底部 glance 数据收集与刷新节流契约测试（RED→GREEN）。
 *
 * - deriveGlanceStatus：WorkflowStatusLine.current 优先，否则 agent 状态回退
 *   （running「● 运行中」/ 空闲「○ 空闲」/ 已停止「✗ 已停止」）。
 * - deriveGlanceError：lastError 无 → null；有 → glyph（ascii 降级）+ 首行
 *   截断至 cols-2。
 * - 控制器节流：首次 refresh 恒同步；窗口内重复 refresh 合并到窗口末重算；
 *   数据变化经 onChange 推送，未变化不推送。
 *
 * 纯投影纪律：数据全部来自既有 LiveAgentState / statusLine，不发明事件类型。
 */

import chalk from 'chalk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LiveAgentState } from '../src/adapter/live.js'
import { resetTermCapsCache } from '../src/term-caps.js'
import { pinTuiEnvBaseline } from './env-baseline.ts'
import {
  MetricsGlanceController,
  deriveGlanceError,
  deriveGlanceStatus,
} from '../src/engine/metrics-glance-controller.js'

/** 最小 live 状态：status/live 可覆盖，其余字段置空。 */
type MutableLiveState = { -readonly [K in keyof LiveAgentState]: LiveAgentState[K] }
function liveState(over: Partial<LiveAgentState> = {}): MutableLiveState {
  return {
    id: 's1' as LiveAgentState['id'],
    status: 'idle',
    inbox: [],
    lastError: undefined,
    live: true,
    activity: undefined,
    ...over,
  }
}

// 包级环境基线：RIVET_ASCII_UI 清除 + 探测缓存重置收敛到一处。
pinTuiEnvBaseline()

afterEach(() => {
  vi.restoreAllMocks()
})

describe('deriveGlanceStatus（状态行回退派生）', () => {
  it('工作流投影优先：有 wfText 时忽略 agent 状态', () => {
    expect(deriveGlanceStatus('实施 · bash', liveState({ status: 'idle' }))).toBe('实施 · bash')
    expect(deriveGlanceStatus('实施 · bash', liveState({ status: 'running' }))).toBe('实施 · bash')
  })

  it('无投影且未挂载（undefined）→ 空闲', () => {
    expect(deriveGlanceStatus(null, undefined)).toBe('○ 空闲')
  })

  it('running → ● 运行中', () => {
    expect(deriveGlanceStatus(null, liveState({ status: 'running' }))).toBe('● 运行中')
  })

  it('idle → ○ 空闲', () => {
    expect(deriveGlanceStatus(null, liveState({ status: 'idle' }))).toBe('○ 空闲')
  })

  it('已停止（live=false）→ ✗ 已停止', () => {
    expect(deriveGlanceStatus(null, liveState({ status: 'idle', live: false }))).toBe('✗ 已停止')
  })
})

describe('deriveGlanceError（错误行派生）', () => {
  it('无 lastError → null', () => {
    expect(deriveGlanceError(liveState(), 80)).toBeNull()
    expect(deriveGlanceError(undefined, 80)).toBeNull()
  })

  it('Error 实例取 message，ascii 降级用 x 字形', () => {
    process.env.RIVET_ASCII_UI = '1'
    resetTermCapsCache()
    const line = deriveGlanceError(liveState({ lastError: { turn: 1, step: 0, error: new Error('boom') } }), 80)
    expect(line).toBe('x boom')
  })

  it('非 Error 原样 String()', () => {
    process.env.RIVET_ASCII_UI = '1'
    resetTermCapsCache()
    const line = deriveGlanceError(liveState({ lastError: { turn: 1, step: 0, error: 'plain' } }), 80)
    expect(line).toBe('x plain')
  })

  it('多行错误只取首行，截断至 cols-2', () => {
    process.env.RIVET_ASCII_UI = '1'
    resetTermCapsCache()
    const line = deriveGlanceError(
      liveState({ lastError: { turn: 1, step: 0, error: new Error('abcdefghijklmnop\nsecond line') } }),
      10,
    )
    // cols-2 = 8 → 首行截断为前 8 字符
    expect(line).toBe('x abcdefgh')
    expect(line).not.toContain('second')
  })
})

describe('MetricsGlanceController 刷新节流', () => {
  it('首次 refresh 恒同步重算（构造后立即可读）', () => {
    const onChange = vi.fn()
    const ctrl = new MetricsGlanceController({
      getStatusText: () => null,
      getLiveState: () => liveState({ status: 'running' }),
      getColumns: () => 80,
      onChange,
    })
    expect(ctrl.current()).toEqual({ status: '○ 空闲', error: null }) // 构造安全默认
    ctrl.refresh()
    expect(ctrl.current().status).toBe('● 运行中')
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('窗口内重复 refresh 合并，不重复推送；数据变化在窗口末重算推送', () => {
    // 显式冻结 Date：节流窗口判定用 Date.now，不冻结则全量跑负载高时
    // 两行代码间隔超 throttleMs 会误判「窗口外同步重算」，测试 flaky。
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    try {
      const onChange = vi.fn()
      const state = liveState({ status: 'idle' })
      const ctrl = new MetricsGlanceController({
        getStatusText: () => null,
        getLiveState: () => state,
        getColumns: () => 80,
        throttleMs: 100,
        onChange,
      })
      ctrl.refresh()
      expect(onChange).toHaveBeenCalledTimes(1)
      // 窗口内重复 refresh：数据未变，不重复推送
      ctrl.refresh()
      ctrl.refresh()
      expect(onChange).toHaveBeenCalledTimes(1)
      // 状态变化 + 窗口内 refresh：合并到窗口末，期间 current() 仍为缓存旧值
      state.status = 'running'
      ctrl.refresh()
      expect(ctrl.current().status).toBe('○ 空闲')
      expect(onChange).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(100)
      expect(ctrl.current().status).toBe('● 运行中')
      expect(onChange).toHaveBeenCalledTimes(2)
      expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ status: '● 运行中' }))
    } finally {
      vi.useRealTimers()
    }
  })

  it('窗口外 refresh 同步重算（无需等定时器）', () => {
    // 显式冻结 Date：节流窗口判定用 Date.now，不冻结则全量跑负载高时
    // 两行代码间隔超 throttleMs 会误判「窗口外同步重算」，测试 flaky。
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    try {
      const onChange = vi.fn()
      const state = liveState({ status: 'idle' })
      const ctrl = new MetricsGlanceController({
        getStatusText: () => null,
        getLiveState: () => state,
        getColumns: () => 80,
        throttleMs: 100,
        onChange,
      })
      ctrl.refresh()
      state.status = 'running'
      vi.advanceTimersByTime(150) // 越过窗口
      ctrl.refresh() // 同步重算
      expect(ctrl.current().status).toBe('● 运行中')
      expect(onChange).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('错误行纳入数据变化判定（错误出现 → onChange 推送）', () => {
    // 显式冻结 Date：节流窗口判定用 Date.now，不冻结则全量跑负载高时
    // 两行代码间隔超 throttleMs 会误判「窗口外同步重算」，测试 flaky。
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    try {
      const onChange = vi.fn()
      const state = liveState({ status: 'idle' })
      const ctrl = new MetricsGlanceController({
        getStatusText: () => null,
        getLiveState: () => state,
        getColumns: () => 80,
        throttleMs: 100,
        onChange,
      })
      ctrl.refresh()
      state.lastError = { turn: 1, step: 0, error: new Error('kaboom') }
      ctrl.refresh()
      vi.advanceTimersByTime(100)
      expect(ctrl.current().error).toContain('kaboom')
      expect(onChange).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('dispose 清空待执行定时器', () => {
    // 显式冻结 Date：节流窗口判定用 Date.now，不冻结则全量跑负载高时
    // 两行代码间隔超 throttleMs 会误判「窗口外同步重算」，测试 flaky。
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    try {
      const onChange = vi.fn()
      const state = liveState({ status: 'idle' })
      const ctrl = new MetricsGlanceController({
        getStatusText: () => null,
        getLiveState: () => state,
        getColumns: () => 80,
        throttleMs: 100,
        onChange,
      })
      ctrl.refresh()
      state.status = 'running'
      ctrl.refresh() // 窗口内 → 挂定时器
      ctrl.dispose()
      vi.advanceTimersByTime(200)
      expect(onChange).toHaveBeenCalledTimes(1) // 定时器已清，不再推送
    } finally {
      vi.useRealTimers()
    }
  })

  it('dispose 无挂起定时器时幂等（timer 分支不进入）', () => {
    const ctrl = new MetricsGlanceController({
      getStatusText: () => null,
      getLiveState: () => undefined,
      getColumns: () => 80,
    })
    expect(() =>{  ctrl.dispose() }).not.toThrow()
    expect(() =>{  ctrl.dispose() }).not.toThrow() // 再次调用仍安全
  })

  it('窗口末重算数据未变化时不推送 onChange（changed 判定 false 分支）', () => {
    // 显式冻结 Date：节流窗口判定用 Date.now，不冻结则全量跑负载高时
    // 两行代码间隔超 throttleMs 会误判「窗口外同步重算」，测试 flaky。
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    try {
      const onChange = vi.fn()
      const state = liveState({ status: 'idle' })
      const ctrl = new MetricsGlanceController({
        getStatusText: () => null,
        getLiveState: () => state,
        getColumns: () => 80,
        throttleMs: 100,
        onChange,
      })
      ctrl.refresh() // 首次 → 推送一次
      ctrl.refresh() // 窗口内挂定时器
      vi.advanceTimersByTime(100) // 重算：状态/错误均未变 → 不推送
      expect(onChange).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('deriveGlanceError Unicode 轨（非 ascii 降级）', () => {
  it('默认 glyph 用 ✗（truecolor 终端，非 ascii 轨）', () => {
    delete process.env.RIVET_ASCII_UI
    const saved = chalk.level
    chalk.level = 3 // truecolor → useAsciiGlyphs false
    try {
      resetTermCapsCache()
      const line = deriveGlanceError(liveState({ lastError: { turn: 1, step: 0, error: 'boom' } }), 80)
      expect(line).toBe('✗ boom')
    } finally {
      chalk.level = saved
      resetTermCapsCache()
    }
  })
})
