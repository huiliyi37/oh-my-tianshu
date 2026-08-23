import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@huiliyi37/cordis'
import type { WriteStream } from 'node:tty'
import type { Session } from '@huiliyi37/dsh-session'
import { apply } from '../src/index.js'
import { TuiApp } from '../src/ui/app.js'
import { spawnSelfRestart } from '../src/restart.js'

// 重启装配测试：spawnSelfRestart 缺省 mock 为成功（不真 spawn 新进程——
// 会重放 vitest 自身 argv）；断言其被调用而非真的重启。
vi.mock('../src/restart.js', () => ({
  spawnSelfRestart: vi.fn(async () => true),
}))

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
  inject: ReturnType<typeof vi.fn>
  reflect: { get: ReturnType<typeof vi.fn> }
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
    // reflect.get：宿主能力探测（appExit 等）；缺省返回 undefined（无宿主能力）。
    reflect: { get: vi.fn(() => undefined) },
  } as unknown as Context & {
    sessions: { list: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn>; flush: ReturnType<typeof vi.fn> }
    effect: ReturnType<typeof vi.fn>
    inject: ReturnType<typeof vi.fn>
    reflect: { get: ReturnType<typeof vi.fn> }
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

/** process.exit spy（beforeEach 安装；断言引用 spy 而非未绑定方法本身）。 */
let exitSpy: ReturnType<typeof vi.fn>

afterEach(() => {
  vi.restoreAllMocks()
})

beforeEach(() => {
  // process.exit 会真杀测试进程——mock 掉，断言其被调用而非真的退出。
  exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as typeof process.exit)
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
    // 插件卸载路径只 dispose，把进程生命周期留给宿主（#22）。
    expect(exitSpy).not.toHaveBeenCalled()
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

  it('SIGINT dispose 后经 appExit(0) 退出（#22 把 TTY 还给 shell）', async () => {
    const ctx = makeCtx()
    const appExit = vi.fn()
    ctx.reflect.get.mockImplementation((name: string) => name === 'appExit' ? appExit : undefined)
    vi.spyOn(TuiApp.prototype, 'attach').mockResolvedValue(undefined)
    vi.spyOn(TuiApp.prototype, 'dispose').mockResolvedValue(undefined)

    const stdin = makeStdin()
    apply(ctx, { stdin, stdout: makeStdout() })
    stdin.emit('SIGINT')

    await vi.waitFor(() => {
      expect(appExit).toHaveBeenCalledWith(0)
    })
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it('用户退出且无 appExit 时 process.exit(0)', async () => {
    const ctx = makeCtx()
    vi.spyOn(TuiApp.prototype, 'attach').mockResolvedValue(undefined)
    vi.spyOn(TuiApp.prototype, 'dispose').mockResolvedValue(undefined)

    const stdin = makeStdin()
    apply(ctx, { stdin, stdout: makeStdout() })
    stdin.emit('SIGINT')

    await vi.waitFor(() => {
      expect(exitSpy).toHaveBeenCalledWith(0)
    })
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

describe('index apply() welcomeAnimation 配置边界', () => {
  it('fails loud during plugin load for an unknown welcomeAnimation value', () => {
    const ctx = makeCtx()

    expect(() => {
      apply(ctx, {
        stdin: makeStdin(),
        stdout: makeStdout(),
        welcomeAnimation: 'sometimes',
      } as unknown as Parameters<typeof apply>[1])
    }).toThrow(
      '[tui-runner] welcomeAnimation must be "auto" or "off", got sometimes',
    )
    expect(ctx.inject.mock.calls).toHaveLength(0)
  })

  // 51824216f3 落定：欢迎开档是静态的，auto/off 无应用内行为差异——选项在
  // 装载时校验并保持稳定配置面（未知值响亮失败），两个合法值都正常构造并
  // attach 应用。原「透传到 app 字段」断言随被删字段一并退役。
  it.each(['auto', 'off'] as const)(
    'welcomeAnimation=%s constructs and attaches the app',
    (welcomeAnimation) => {
      const ctx = makeCtx()
      const attach = vi.spyOn(TuiApp.prototype, 'attach').mockResolvedValue(undefined)
      vi.spyOn(TuiApp.prototype, 'dispose').mockResolvedValue(undefined)
      apply(ctx, { stdin: makeStdin(), stdout: makeStdout(), welcomeAnimation })
      expect(attach).toHaveBeenCalledTimes(1)
    },
  )

  it('welcomeAnimation omitted keeps the stable default load path', () => {
    const ctx = makeCtx()
    const attach = vi.spyOn(TuiApp.prototype, 'attach').mockResolvedValue(undefined)
    vi.spyOn(TuiApp.prototype, 'dispose').mockResolvedValue(undefined)
    apply(ctx, { stdin: makeStdin(), stdout: makeStdout() })
    expect(attach).toHaveBeenCalledTimes(1)
  })
})

describe('index apply() — /restart 重启装配（#34）', () => {
  beforeEach(() => {
    vi.mocked(spawnSelfRestart).mockReset().mockResolvedValue(true)
  })

  /** 捕获 apply 内部构造的 app 实例（attach mock 的 this 即实例），经 /restart 触发 onRestart 链路。 */
  function bootWithAppRef(ctx: Context) {
    let appRef: TuiApp | undefined
    // no-this-alias：不把 this 存局部变量，经回调参数捕获实例。
    const hold = (app: TuiApp): void => { appRef = app }
    vi.spyOn(TuiApp.prototype, 'attach').mockImplementation(function (this: TuiApp) {
      hold(this)
      return Promise.resolve(undefined)
    })
    vi.spyOn(TuiApp.prototype, 'dispose').mockResolvedValue(undefined)
    apply(ctx, { stdin: makeStdin(), stdout: makeStdout() })
    if (appRef === undefined) throw new Error('apply 未构造 app（attach 未被调用）')
    return appRef
  }

  it('/restart teardown：dispose 后 spawn 同 argv 并退出宿主（appExit(0)）', async () => {
    const ctx = makeCtx()
    const appExit = vi.fn()
    ctx.reflect.get.mockImplementation((name: string) => name === 'appExit' ? appExit : undefined)
    const disposeSpy = vi.spyOn(TuiApp.prototype, 'dispose').mockResolvedValue(undefined)

    const app = bootWithAppRef(ctx)
    app.handleSubmit('/restart')

    // teardown(true, true)：dispose → spawnSelfRestart（同命令重启）→ 退出宿主
    await vi.waitFor(() => { expect(spawnSelfRestart).toHaveBeenCalledTimes(1) })
    await vi.waitFor(() => { expect(appExit).toHaveBeenCalledWith(0) })
    expect(disposeSpy).toHaveBeenCalledTimes(1)
  })

  it('重启 spawn 失败：仍退出宿主（fails loud——console.error 上报，不阻塞退出）', async () => {
    const ctx = makeCtx()
    const appExit = vi.fn()
    ctx.reflect.get.mockImplementation((name: string) => name === 'appExit' ? appExit : undefined)
    vi.mocked(spawnSelfRestart).mockResolvedValue(false)
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => { })

    const app = bootWithAppRef(ctx)
    app.handleSubmit('/restart')

    await vi.waitFor(() => { expect(appExit).toHaveBeenCalledWith(0) })
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('重启失败'))
  })
})
