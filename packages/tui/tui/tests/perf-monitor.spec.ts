import { describe, expect, it } from 'vitest'
import { TuiPerfMonitor, isTuiPerfEnabled, type EventLoopHistogram } from '../src/engine/perf-monitor.js'

/** 可控时钟：now 返回手动推进的时间。 */
function makeClock() {
  let t = 0
  return {
    now: () => t,
    advance: (ms: number) => { t += ms },
  }
}

/** 无真实 event loop 依赖的 histogram 替身（值以纳秒计，同 monitorEventLoopDelay）。 */
function makeHistogram(): EventLoopHistogram & { resetCalls: number; disableCalls: number } {
  let resetCalls = 0
  let disableCalls = 0
  return {
    max: 123_000_000, // 123ms
    enable: () => {},
    disable: () => { disableCalls++ },
    reset: () => { resetCalls++ },
    percentile: () => 45_000_000, // 45ms
    get resetCalls() { return resetCalls },
    get disableCalls() { return disableCalls },
  }
}

describe('isTuiPerfEnabled', () => {
  it('默认关闭（无 --debug-perf 参数、无 RIVET_DEBUG_TELEMETRY）', () => {
    expect(isTuiPerfEnabled([], {})).toBe(false)
  })

  it('--debug-perf 参数启用', () => {
    expect(isTuiPerfEnabled(['--debug-perf'], {})).toBe(true)
    // 参数列表中出现即启用，位置无关
    expect(isTuiPerfEnabled(['run', '--debug-perf', '--config=x'], {})).toBe(true)
  })

  it('RIVET_DEBUG_TELEMETRY=1 启用', () => {
    expect(isTuiPerfEnabled([], { RIVET_DEBUG_TELEMETRY: '1' })).toBe(true)
  })

  it('RIVET_DEBUG_TELEMETRY 非 1 不启用', () => {
    expect(isTuiPerfEnabled([], { RIVET_DEBUG_TELEMETRY: '0' })).toBe(false)
  })
})

describe('TuiPerfMonitor disabled', () => {
  it('enabled=false 时 record 零开销：不累积样本、summary 返回 undefined', () => {
    const monitor = new TuiPerfMonitor({ enabled: false })
    monitor.record('renderLive', 42)
    monitor.recordCache(true)
    expect(monitor.summary()).toBeUndefined()
    // 不抛错、不污染任何状态
    expect(monitor.getLoopLagWindow()).toEqual({ p99Ms: 0, maxMs: 0 })
  })

  it('enabled=false 时 measure 直接执行 operation，不包计时', () => {
    const clock = makeClock()
    const monitor = new TuiPerfMonitor({ enabled: false, now: clock.now })
    let ran = 0
    const result = monitor.measure('formatMarkdown', () => { ran++; return 'out' })
    expect(result).toBe('out')
    expect(ran).toBe(1)
    expect(monitor.summary()).toBeUndefined()
  })
})

describe('TuiPerfMonitor enabled', () => {
  it('record 累积 count/max；summary 给出 p50/p99/max', () => {
    const clock = makeClock()
    const monitor = new TuiPerfMonitor({ enabled: true, now: clock.now, createHistogram: makeHistogram })
    for (const ms of [10, 20, 30, 40]) {
      clock.advance(ms)
      monitor.record('renderLive', ms)
    }
    const summary = monitor.summary()
    expect(summary).toBeDefined()
    expect(summary?.samples.renderLive.count).toBe(4)
    expect(summary?.samples.renderLive.maxMs).toBe(40)
    // 4 个样本 [10,20,30,40]：p50 = 第 2 个（ceil(0.5*4)=2）→ 20
    expect(summary?.samples.renderLive.p50Ms).toBe(20)
    // p99 = 第 4 个（ceil(0.99*4)=4）→ 40
    expect(summary?.samples.renderLive.p99Ms).toBe(40)
  })

  it('measure 记录 operation 耗时（now 差异）', () => {
    const clock = makeClock()
    const monitor = new TuiPerfMonitor({ enabled: true, now: clock.now, createHistogram: makeHistogram })
    clock.advance(100)
    monitor.measure('flush', () => { clock.advance(15) })
    const summary = monitor.summary()
    expect(summary?.samples.flush.count).toBe(1)
    expect(summary?.samples.flush.maxMs).toBe(15)
  })

  it('recordCache 统计命中/未命中', () => {
    const monitor = new TuiPerfMonitor({ enabled: true, createHistogram: makeHistogram })
    monitor.recordCache(true)
    monitor.recordCache(true)
    monitor.recordCache(false)
    const summary = monitor.summary()
    expect(summary?.cache).toEqual({ hits: 2, misses: 1 })
  })

  it('summary 的 loopLag 来自 histogram（p99/max 纳秒→毫秒）', () => {
    const monitor = new TuiPerfMonitor({ enabled: true, createHistogram: makeHistogram })
    const loop = monitor.getLoopLagWindow()
    // fake histogram: p99=45000ns→45ms, max=123000ns→123ms
    expect(loop.p99Ms).toBe(45)
    expect(loop.maxMs).toBe(123)
  })

  it('stop() 幂等，仅禁 histogram（采样仍可用）', () => {
    const hist = makeHistogram()
    const monitor = new TuiPerfMonitor({ enabled: true, createHistogram: () => hist })
    monitor.record('renderLive', 5)
    monitor.stop()
    monitor.stop() // 幂等：第二次不再 disable
    expect(hist.disableCalls).toBe(1)
    // stop 只禁 event loop histogram；record/summary 采样通道仍工作
    monitor.record('renderLive', 7)
    expect(monitor.summary()?.samples.renderLive.count).toBe(2)
  })
})
