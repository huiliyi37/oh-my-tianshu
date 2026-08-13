import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from 'cordis'
import type { WriteStream } from 'node:tty'
import type { Session } from '@deepseek-ai/dsh-session'
import { apply } from '../src/index.js'
import { TuiApp } from '../src/ui/app.js'

/** 最小可渲染 stdout 替身：宽/高/写入记录，以及 ResizeHandler 需要的 on/removeListener。 */
function makeStdout(): WriteStream {
  return {
    columns: 100,
    rows: 30,
    write: vi.fn(),
    isTTY: false,
    on: vi.fn(),
    removeListener: vi.fn(),
  } as unknown as WriteStream
}

/** 最小 stdin 替身：可 emit 事件，InputHandler 需要的流方法齐备。 */
function makeStdin(): NodeJS.ReadStream {
  const stdin = new EventEmitter() as unknown as NodeJS.ReadStream & {
    isTTY: boolean
    setRawMode(v: boolean): void
    resume(): void
    setEncoding(enc: string): void
  }
  stdin.isTTY = false
  stdin.setRawMode = vi.fn()
  stdin.resume = vi.fn()
  stdin.setEncoding = vi.fn()
  stdin.pause = vi.fn()
  return stdin
}

/** 带记录字段的 ctx 替身：sessions/agents 可注入，effect 记录 cleanup 并立即求值。 */
function makeCtx(): Context & {
  sessions: { list: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn>; flush: ReturnType<typeof vi.fn> }
  effect: ReturnType<typeof vi.fn>
} {
  const ctx = {
    sessions: {
      create: vi.fn(),
      get: vi.fn(),
      list: vi.fn(() => []),
      flush: vi.fn(async () => true),
    },
    agents: {
      create: vi.fn(),
      resume: vi.fn(),
      get: vi.fn(),
    },
    on: vi.fn(() => () => { }),
    get: vi.fn(),
    provide: vi.fn(() => () => { }),
    // effect 立即求值回调，返回其 cleanup——与 cordis 的插件卸载语义一致。
    effect: vi.fn((cb: () => () => void) => cb()),
    // inject 立即执行回调（mock 的 sessions/agents 已可用），与 effect 语义一致；
    // 真实 Cordis 中依赖就绪时才执行。
    inject: vi.fn((_deps: string[], cb: (injected: unknown) => void) =>{  cb(ctx) }),
  } as unknown as Context & {
    sessions: { list: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn>; flush: ReturnType<typeof vi.fn> }
    effect: ReturnType<typeof vi.fn>
  }
  return ctx
}

/** 最小 live session 替身：flushAll 遍历它。 */
function makeSession(id: string): Session {
  return {
    id: id as Session['id'],
    header: { id: id as Session['id'], version: 0, createdAt: 1 },
    events: [],
  } as unknown as Session
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('index apply() 装配与退出生命周期', () => {
  it('插件卸载（ctx dispose）触发 app.dispose 并 flushAll', async () => {
    const ctx = makeCtx()
    const session = makeSession('runner-1')
    ctx.sessions.list.mockReturnValue([session])
    // 跳过真实 attach 的引擎装配，只验证装配与卸载路径
    const attachSpy = vi.spyOn(TuiApp.prototype, 'attach').mockResolvedValue(undefined)
    const disposeSpy = vi.spyOn(TuiApp.prototype, 'dispose')

    apply(ctx, { stdin: makeStdin(), stdout: makeStdout() })

    expect(attachSpy).toHaveBeenCalledTimes(1)
    // effect cleanup（插件卸载路径）触发 teardown → dispose → flushAll
    const cleanup = ctx.effect.mock.results[0]?.value as (() => void) | undefined
    expect(cleanup).toBeTypeOf('function')
    cleanup?.()

    expect(disposeSpy).toHaveBeenCalledTimes(1)
    expect(ctx.sessions.flush).toHaveBeenCalled()
  })

  it('stdin SIGINT 触发同一 dispose 路径', async () => {
    const ctx = makeCtx()
    vi.spyOn(TuiApp.prototype, 'attach').mockResolvedValue(undefined)
    const disposeSpy = vi.spyOn(TuiApp.prototype, 'dispose')

    const stdin = makeStdin()
    apply(ctx, { stdin, stdout: makeStdout() })

    stdin.emit('SIGINT')
    expect(disposeSpy).toHaveBeenCalledTimes(1)
  })

  it('缺省 stdin/stdout 用 process 全局流', () => {
    const ctx = makeCtx()
    vi.spyOn(TuiApp.prototype, 'attach').mockResolvedValue(undefined)
    const disposeSpy = vi.spyOn(TuiApp.prototype, 'dispose')

    expect(() =>{  apply(ctx) }).not.toThrow()
    // 缺省装配也注册了 effect cleanup（插件卸载路径）
    const cleanup = ctx.effect.mock.results[0]?.value as (() => void) | undefined
    expect(cleanup).toBeTypeOf('function')
    cleanup!()
    expect(disposeSpy).toHaveBeenCalledTimes(1)
  })

  it('attach rejection 恢复终端（dispose 被调用，不吞错误）', async () => {
    const ctx = makeCtx()
    const attachErr = new Error('attach boom')
    vi.spyOn(TuiApp.prototype, 'attach').mockRejectedValue(attachErr)
    const disposeSpy = vi.spyOn(TuiApp.prototype, 'dispose').mockResolvedValue(undefined)

    const stdin = makeStdin()
    // apply 同步装配；attach 的 rejection 由 try/catch 接住并恢复终端。
    expect(() =>{  apply(ctx, { stdin, stdout: makeStdout() }) }).not.toThrow()

    // 给 attach 的 rejection 微任务留出时间
    await new Promise(resolve => setImmediate(resolve))
    expect(disposeSpy).toHaveBeenCalledTimes(1)
  })

  it('effect cleanup await dispose 完成（teardown 不等 flushAll 回归）', async () => {
    const ctx = makeCtx()
    vi.spyOn(TuiApp.prototype, 'attach').mockResolvedValue(undefined)
    let disposeResolved = false
    vi.spyOn(TuiApp.prototype, 'dispose').mockImplementation(async () => { disposeResolved = true })

    const stdin = makeStdin()
    apply(ctx, { stdin, stdout: makeStdout() })

    const cleanup = ctx.effect.mock.results[0]?.value as (() => void) | undefined
    cleanup?.()
    expect(disposeResolved).toBe(true)
  })
})
