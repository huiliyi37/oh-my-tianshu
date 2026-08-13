import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createProcessShutdown,
  PROCESS_SHUTDOWN_TIMEOUT_MS,
} from '../src/process-shutdown.ts'

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void } {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((accept, fail) => {
    resolve = accept
    reject = fail
  })
  return { promise, resolve, reject }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('process shutdown', () => {
  it('exits once after graceful disposal resolves or rejects', async () => {
    const resolvedExit = vi.fn()
    const resolved = createProcessShutdown(() => Promise.resolve(), resolvedExit)
    await resolved.shutdown(0)
    expect(resolvedExit).toHaveBeenCalledOnce()
    expect(resolvedExit).toHaveBeenCalledWith(0)

    const rejectedExit = vi.fn()
    const rejected = createProcessShutdown(() => Promise.reject(new Error('dispose failed')), rejectedExit)
    await rejected.shutdown(1)
    expect(rejectedExit).toHaveBeenCalledOnce()
    expect(rejectedExit).toHaveBeenCalledWith(1)
  })

  it('uses process.exit as the default process boundary', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(_code => undefined as never)
    const shutdown = createProcessShutdown(() => Promise.resolve())

    await shutdown.shutdown(7)

    expect(exit).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledWith(7)
  })

  it('forces exit when graceful disposal reaches its bound', async () => {
    vi.useFakeTimers()
    const disposal = deferred()
    const exit = vi.fn()
    const shutdown = createProcessShutdown(() => disposal.promise, exit)
    const pending = shutdown.shutdown(0)

    await vi.advanceTimersByTimeAsync(PROCESS_SHUTDOWN_TIMEOUT_MS - 1)
    expect(exit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(exit).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledWith(0)

    disposal.resolve()
    await pending
    expect(exit).toHaveBeenCalledOnce()
  })

  it('honors a caller-supplied grace period', async () => {
    vi.useFakeTimers()
    const disposal = deferred()
    const exit = vi.fn()
    const shutdown = createProcessShutdown(() => disposal.promise, exit, 25)
    const pending = shutdown.shutdown(0)

    await vi.advanceTimersByTimeAsync(24)
    expect(exit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(exit).toHaveBeenCalledOnce()

    disposal.resolve()
    await pending
  })

  it('lets Ctrl+C force a normal shutdown already stuck in disposal', async () => {
    const disposal = deferred()
    const exit = vi.fn()
    const shutdown = createProcessShutdown(() => disposal.promise, exit)
    const pending = shutdown.shutdown(0)

    shutdown.interrupt(130)
    expect(exit).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledWith(130)

    disposal.resolve()
    await pending
    expect(exit).toHaveBeenCalledOnce()
  })

  it('drains on the first signal and forces on the second signal', async () => {
    const disposal = deferred()
    const dispose = vi.fn(() => disposal.promise)
    const exit = vi.fn()
    const shutdown = createProcessShutdown(dispose, exit)

    shutdown.interrupt(143)
    await Promise.resolve()
    expect(dispose).toHaveBeenCalledOnce()
    expect(exit).not.toHaveBeenCalled()

    shutdown.interrupt(130)
    expect(exit).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledWith(130)

    disposal.resolve()
    await shutdown.shutdown(0)
    expect(exit).toHaveBeenCalledOnce()
  })

  it('coalesces normal shutdown calls without treating them as escalation', async () => {
    const disposal = deferred()
    const exit = vi.fn()
    const shutdown = createProcessShutdown(() => disposal.promise, exit)

    const first = shutdown.shutdown(0)
    const second = shutdown.shutdown(1)
    expect(second).toBe(first)
    expect(exit).not.toHaveBeenCalled()

    disposal.resolve()
    await first
    expect(exit).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledWith(0)
  })
})
