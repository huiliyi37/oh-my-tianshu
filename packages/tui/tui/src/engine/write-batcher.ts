/**
 * T9 WriteBatcher — 渲染帧合并器（microtask 合并 + 16ms 帧节流）。
 *
 * 替代 Ink 的 RenderBatcher（依赖 React 调度），直接将多次 render 调用
 * 合并为一次 LiveEngine.render()。
 *
 * 策略（2026-07-24 P2，对标 pi-tui MIN_RENDER_INTERVAL_MS=16）：
 * - 距上次 flush ≥16ms：microtask 刷新（leading edge，低延迟路径不变）。
 * - 距上次 flush <16ms：setTimeout(剩余) 尾沿（trailing edge）——高吞吐
 *   小 delta（流式 token / IME 整段上屏）下帧率封顶 ~60fps，渲染成本从
 *   「每事件圈一帧」降为恒定上限；窗口内多次 schedule 合并为一帧。
 * - flushNow()：critical 路径（提交/commit/phase 切换）同步穿透，不受
 *   节流限制，并作废排队的 microtask 与定时器。
 *
 * BlockStreamWriter.onBlock → WriteBatcher.flush() → LiveEngine.render()
 *
 * 健壮性：onFlush 在 microtask/定时器中执行，若直接抛出会变成 unhandled
 * rejection 崩进程。故 flush 用 try/catch 包裹，错误交给 onError（默认
 * 记录到 stderr 但不中断 TUI），保证一次渲染异常不会让整个终端崩溃。
 */

/** 帧最小间隔（~60fps 上限）。 */
export const MIN_FRAME_INTERVAL_MS = 16

/**
 * 渲染帧合并器：schedule() 的多次调用合并为一次 onFlush（microtask 或 16ms
 * 尾沿），flushNow() 同步穿透。onFlush 抛错交给 onError（默认写 stderr），
 * 不会中断 TUI 进程。
 */
export class WriteBatcher {
  private pending = false
  private generation = 0
  private lastFlushAt = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private onFlush: () => void
  private onError: (err: unknown) => void

  constructor(onFlush: () => void, onError?: (err: unknown) => void) {
    this.onFlush = onFlush
    // 默认错误处理：写 stderr 但不 throw，避免渲染抖动杀死 TUI 进程。
    // 调用方可注入自己的 handler（如转发到诊断日志）覆盖此行为。
    this.onError = onError ?? ((err) => {
      try {
        process.stderr.write(`WriteBatcher flush error: ${String(err)}\n`)
      } catch {
        // stderr 不可写时彻底静默，绝不 throw
      }
    })
  }

  /** 请求刷新：距上次 flush ≥16ms 走 microtask，否则 16ms 尾沿（窗口内合并）。 */
  schedule(): void {
    if (this.pending) return
    this.pending = true
    const wait = MIN_FRAME_INTERVAL_MS - (Date.now() - this.lastFlushAt)
    if (wait <= 0) {
      const generation = this.generation
      void Promise.resolve().then(() => {
        if (!this.pending || generation !== this.generation) return
        this.pending = false
        this.runFlush()
      })
      return
    }
    this.timer = setTimeout(() => {
      this.timer = null
      if (!this.pending) return
      this.pending = false
      this.runFlush()
    }, wait)
    // 不拖住进程退出（shutdown/测试尾声的 pending 帧可丢弃）。
    this.timer.unref()
  }

  /** Immediately flush once and invalidate any previously queued microtask/timer. */
  flushNow(): void {
    this.generation++
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.pending = false
    this.runFlush()
  }

  private runFlush(): void {
    this.lastFlushAt = Date.now()
    try {
      this.onFlush()
    } catch (err) {
      this.onError(err)
    }
  }
}
