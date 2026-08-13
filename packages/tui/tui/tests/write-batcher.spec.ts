/**
 * engine/write-batcher — 渲染帧合并器契约测试。
 *
 * - schedule()：距上次 flush ≥16ms 走 microtask（leading，低延迟）；<16ms
 *   走 setTimeout 尾沿（trailing，窗口内多次 schedule 合并为一帧）。
 * - flushNow()：同步穿透，作废排队的 microtask/定时器，不受节流限制。
 * - 幂等：pending 期间重复 schedule 不重复排队。
 * - 健壮性：onFlush 抛错走 onError 不崩溃；timer unref 不拖住进程退出。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WriteBatcher } from '../src/engine/write-batcher.js'

function tick(ms: number): void {
  vi.advanceTimersByTime(ms)
}

describe('WriteBatcher.schedule — leading microtask 路径', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('距上次 flush ≥16ms 时经 microtask 立即刷新（leading）', async () => {
    const onFlush = vi.fn()
    const batcher = new WriteBatcher(onFlush)
    batcher.schedule()
    // microtask 不受 fake timers 控制：await 一个 microtask 即可观察到
    await Promise.resolve()
    expect(onFlush).toHaveBeenCalledTimes(1)
  })

  it('16ms 窗口内多次 schedule 合并为一帧（trailing）', async () => {
    const onFlush = vi.fn()
    const batcher = new WriteBatcher(onFlush)
    batcher.schedule() // 触发 leading microtask，lastFlushAt 更新
    await Promise.resolve()
    expect(onFlush).toHaveBeenCalledTimes(1)

    onFlush.mockClear()
    batcher.schedule() // 距上次 flush <16ms → trailing setTimeout
    batcher.schedule()
    batcher.schedule()
    expect(onFlush).not.toHaveBeenCalled() // 尚未到帧边界
    tick(16)
    expect(onFlush).toHaveBeenCalledTimes(1) // 窗口内 3 次合并为 1 帧
  })

  it('pending 期间重复 schedule 幂等（不重复排队）', async () => {
    const onFlush = vi.fn()
    const batcher = new WriteBatcher(onFlush)
    batcher.schedule()
    batcher.schedule()
    batcher.schedule()
    // 首次 schedule 走 leading microtask（lastFlushAt=0 → wait≤0）；fake timers
    // 不 mock Promise，await 一个 microtask 让出当前宏任务即可观察到。
    await Promise.resolve()
    expect(onFlush).toHaveBeenCalledTimes(1)
  })
})

describe('WriteBatcher.flushNow — 同步穿透', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('立即同步刷新并作废排队的定时器', () => {
    const onFlush = vi.fn()
    const batcher = new WriteBatcher(onFlush)
    batcher.schedule() // 排队 trailing
    batcher.flushNow()
    expect(onFlush).toHaveBeenCalledTimes(1)
    // 排队的定时器已作废：推进时钟不再触发第二帧
    tick(16)
    expect(onFlush).toHaveBeenCalledTimes(1)
  })

  it('无排队时 flushNow 也执行一帧（critical 穿透语义）', () => {
    const onFlush = vi.fn()
    const batcher = new WriteBatcher(onFlush)
    batcher.flushNow()
    expect(onFlush).toHaveBeenCalledTimes(1)
  })

  it('flushNow 后紧跟 schedule 重新开始 16ms 窗口', () => {
    const onFlush = vi.fn()
    const batcher = new WriteBatcher(onFlush)
    batcher.flushNow()
    expect(onFlush).toHaveBeenCalledTimes(1)
    // flushNow 同步更新 lastFlushAt；同刻 schedule 的 wait=16>0 → trailing 帧
    batcher.schedule()
    expect(onFlush).toHaveBeenCalledTimes(1) // 尚未到帧边界
    tick(16)
    expect(onFlush).toHaveBeenCalledTimes(2)
  })
})

describe('WriteBatcher 健壮性', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('onFlush 抛错走 onError，不向调用方扩散', () => {
    const onError = vi.fn()
    const batcher = new WriteBatcher(() => { throw new Error('render boom') }, onError)
    expect(() =>{  batcher.flushNow() }).not.toThrow()
    expect(onError).toHaveBeenCalledWith(expect.any(Error))
  })

  it('默认 onError 写 stderr 不抛（渲染抖动不杀 TUI）', () => {
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      const batcher = new WriteBatcher(() => { throw new Error('boom') })
      expect(() =>{  batcher.flushNow() }).not.toThrow()
      expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('WriteBatcher flush error'))
    } finally {
      stderrWrite.mockRestore()
    }
  })
})
