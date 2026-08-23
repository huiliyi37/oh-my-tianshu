import { execFileSync, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PassThrough } from 'node:stream'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from 'vitest'
import type { Context } from '@huiliyi37/cordis'
import type { WriteStream } from 'node:tty'
import { Terminal } from '@xterm/headless'
import { ReasoningEffortId } from '@huiliyi37/dsh-llm'
import { SessionId, type SessionEvent } from '@huiliyi37/dsh-session'
import type { Agent, AgentHandle } from '@huiliyi37/dsh-agent'
import { TuiApp, parseSlashCommand } from '../src/ui/app.js'
import { CommitEngine } from '../src/engine/commit-engine.js'
import { LiveEngine } from '../src/engine/live-engine.js'
import { getActiveThemeName, setTheme } from '../src/theme.js'
import { readImageFromClipboard, readTextFromClipboard } from '../src/engine/clipboard-image.js'
import { setImageProtocol } from '../src/engine/ansi.js'
import { decodeMessages, encodeMessage } from '../src/lsp/rpc.js'

// 剪贴板读图/读文本走真实 shell（osascript / wl-paste 等），单元测试不可控——
// 默认 mock 为「剪贴板无图/无文本」；图片粘贴行为测试用 vi.mocked 调整返回值。
vi.mock('../src/engine/clipboard-image.js', () => ({
  readImageFromClipboard: vi.fn(async () => null),
  readTextFromClipboard: vi.fn(async () => null),
  FOCUS_DEBOUNCE_MS: 1_000,
}))

/** 输入轨顶框前连续空行数（定高垫行 vs 欢迎帧不垫的装配断言）。 */
function blankLinesBeforeRail(written: string): number {
  const plain = written.replace(/\x1B\[[0-9;?]*[ -/]*[@-~]/g, '')
  const idx = plain.lastIndexOf('╭')
  if (idx < 0) return 0
  const m = plain.slice(0, idx).match(/(?:\n[ \t]*)+$/)
  if (m === null) return 0
  return m[0].split('\n').length - 1
}

/** 最小可渲染 stdout 替身：宽/高/写入记录，以及 ResizeHandler 需要的 on/removeListener。 */
function makeStdout(): WriteStream & { write: ReturnType<typeof vi.fn> } {
  return {
    columns: 100,
    rows: 30,
    write: vi.fn(),
    isTTY: false,
    on: vi.fn(),
    removeListener: vi.fn(),
  } as unknown as WriteStream & { write: ReturnType<typeof vi.fn> }
}

/** 最小 stdin 替身：EventEmitter + InputHandler 需要的流方法。 */
function makeStdin(): NodeJS.ReadStream & {
  setRawMode: ReturnType<typeof vi.fn>
  resume: ReturnType<typeof vi.fn>
  setEncoding: ReturnType<typeof vi.fn>
  isTTY: boolean
} {
  const stdin = Object.assign(new EventEmitter(), {
    isTTY: false,
    setRawMode: vi.fn(),
    resume: vi.fn(),
    setEncoding: vi.fn(),
    pause: vi.fn(),
  }) as unknown as NodeJS.ReadStream & {
    setRawMode: ReturnType<typeof vi.fn>
    resume: ReturnType<typeof vi.fn>
    setEncoding: ReturnType<typeof vi.fn>
    isTTY: boolean
  }
  createdStdins.push(stdin)
  return stdin
}

/** recording ctx 的订阅台账条目：一次 on() 与其 disposer 是否已被调用。 */
interface SubscriptionRecord {
  event: string
  released: boolean
}

/** 本文件当前测试创建的台账/stdin（afterEach 平衡断言后清空）。 */
const createdLedgers: SubscriptionRecord[][] = []
const createdStdins: NodeJS.ReadStream[] = []

/** makeCtx 的 mock 字段类型：保留 vi.fn 的 mock 方法（mockResolvedValue/mockReturnValue 等）。 */
interface MockCtx {
  sessions: {
    create: ReturnType<typeof vi.fn>
    get: ReturnType<typeof vi.fn>
    list: ReturnType<typeof vi.fn>
    flush: ReturnType<typeof vi.fn>
    fork: ReturnType<typeof vi.fn>
  }
  agents: {
    create: ReturnType<typeof vi.fn>
    resume: ReturnType<typeof vi.fn>
    get: ReturnType<typeof vi.fn>
  }
  agentDefaultModel: {
    currentSelection: ReturnType<typeof vi.fn>
  }
  /** T4：sessionProjections 服务替身（可选——缺失时窗格降级并在切换时回显警告）。 */
  sessionProjections?: {
    snapshot: ReturnType<typeof vi.fn>
    onChanged: ReturnType<typeof vi.fn>
  }
  /** Cordis 注入代理的可选服务读取面（reflect.get：未注册返回 undefined）。 */
  reflect: {
    get: ReturnType<typeof vi.fn>
  }
  on: ReturnType<typeof vi.fn>
  get: ReturnType<typeof vi.fn>
  provide: ReturnType<typeof vi.fn>
  /** recording ctx 的订阅台账（afterEach 断言订阅/释放平衡）。 */
  subscriptions: SubscriptionRecord[]
}

/** 带记录字段的 ctx 替身：agents/sessions 可注入；on 记录订阅并返回
 *  记录释放的 disposer（订阅/释放平衡在 afterEach 统一断言）。 */
function makeCtx(): Context & MockCtx {
  const subscriptions: SubscriptionRecord[] = []
  createdLedgers.push(subscriptions)
  const ctx = {
    sessions: {
      create: vi.fn(),
      get: vi.fn(),
      list: vi.fn(() => []),
      flush: vi.fn(async () => true),
      fork: vi.fn(),
    },
    agents: {
      create: vi.fn(),
      resume: vi.fn(),
      get: vi.fn(),
    },
    agentDefaultModel: {
      currentSelection: vi.fn(() => ({ provider: 'mock', model: 'mock' })),
    },
    // 注入代理：可选服务必须经 reflect.get 读取（属性访问在 Cordis 4 抛
    // "without inject"——真实装配已复现；mock 默认无服务返回 undefined）。
    reflect: {
      get: vi.fn(() => undefined),
    },
    on: vi.fn((event: string) => {
      const record: SubscriptionRecord = { event, released: false }
      subscriptions.push(record)
      return vi.fn(() => {
        record.released = true
        return true
      })
    }),
    get: vi.fn(),
    provide: vi.fn(() => () => { }),
    subscriptions,
  } as unknown as Context & MockCtx
  return ctx
}

/** makeAgent 的 mock 字段类型：驱动方法可断言（mock/mockReturnValue）。 */
interface MockAgent {
  session: { requestHeader: ReturnType<typeof vi.fn> }
  followup: ReturnType<typeof vi.fn>
  steer: ReturnType<typeof vi.fn>
  inject: ReturnType<typeof vi.fn>
  cancel: ReturnType<typeof vi.fn>
  whenIdle: ReturnType<typeof vi.fn>
}

/** 最小 live agent 替身：驱动方法可断言。 */
function makeAgent(id: string): Agent & MockAgent {
  return {
    id: SessionId(id),
    options: {},
    session: {
      id: SessionId(id),
      header: { id: SessionId(id), version: 0, createdAt: 1 },
      events: [],
      requestHeader: vi.fn(() => undefined),
      requestContext: vi.fn(() => undefined),
    },
    inbox: { nextTurn: [], nextStep: [] },
    status: 'idle',
    ctx: { on: vi.fn(() => () => {}) },
    followup: vi.fn(),
    steer: vi.fn(),
    inject: vi.fn(),
    cancel: vi.fn(),
    whenIdle: vi.fn(async () => { }),
  } as unknown as Agent & MockAgent
}

/** 最小 handle 替身：dispose 可断言。可传入局部 mock 句柄以便断言引用局部变量。 */
function makeHandle(
  agent: Agent,
  dispose: ReturnType<typeof vi.fn> = vi.fn(),
): AgentHandle & { dispose: ReturnType<typeof vi.fn> } {
  return { agent, dispose } as unknown as AgentHandle & { dispose: ReturnType<typeof vi.fn> }
}

/** 驱动 mock（followup/steer 等）单次调用首参的 content[0].text 提取（mock 参数 any 收窄）。 */
function firstCallText(mock: ReturnType<typeof vi.fn>): string {
  const arg = mock.mock.calls[0]?.[0] as { content?: Array<{ text?: string }> } | undefined
  return arg?.content?.[0]?.text ?? ''
}

/** 驱动 mock（followup/steer 等）全部调用的首参 content[0].text 列表。 */
function allCallTexts(mock: ReturnType<typeof vi.fn>): string[] {
  return mock.mock.calls.flatMap((c) => {
    const arg = c[0] as { content?: Array<{ text?: string }> } | undefined
    const text = arg?.content?.[0]?.text
    if (text === undefined) return []
    return [text]
  })
}

/** 捕获所有 session/event 订阅（transcript/live/statusline/流式供给/streamFeed），
 *  模拟总线广播。文件级共享（流式提交与 glance 数据接线两个 describe 复用）。 */
function sessionEventBus(ctx: ReturnType<typeof makeCtx>): (id: SessionId, event: Record<string, unknown>) => void {
  const handlers = (ctx.on as ReturnType<typeof vi.fn>).mock.calls
    .filter((call: unknown[]) => call[0] === 'session/event')
    .map(call => call[1] as (owner: { id: SessionId }, event: unknown) => void)
  if (handlers.length === 0) throw new Error('session/event handler not registered')
  return (id, event) => {
    for (const handler of handlers) handler({ id }, event)
  }
}

/** 向 transcript 灌一条 user/message（rewind 检查点过滤用；默认真人用户源）。 */
function emitTranscriptUser(
  bus: (id: SessionId, event: Record<string, unknown>) => void,
  id: SessionId,
  seq: number,
  text: string,
  source: { kind: 'user' } | { kind: 'plugin'; plugin: string } = { kind: 'user' },
): void {
  bus(id, {
    seq,
    time: seq,
    type: 'user/message',
    data: {
      id: `m-${seq}`,
      role: 'user',
      source,
      content: [{ type: 'text', text }],
    },
  })
}

afterEach(() => {
  // 订阅/释放平衡：InputHandler.dispose() 恒调 stdin.pause()，本文件一测一
  // app——出现过 pause 即该用例走完了 app.dispose()；此时每个 recording ctx
  // 的全部 on() 订阅都必须已释放。部分释放（如 ?? 短路吞掉 disposer、
  // detach 漏收集）在此现形；未 dispose 的用例不做此断言。
  const fullyDisposed = createdStdins.some(
    stdin => (stdin.pause as unknown as ReturnType<typeof vi.fn>).mock.calls.length > 0,
  )
  if (fullyDisposed) {
    for (const ledger of createdLedgers) {
      const leaked = ledger.filter(record => !record.released).map(record => record.event)
      expect(leaked, 'app.dispose() 后仍存活的 ctx.on 订阅').toEqual([])
    }
  }
  createdLedgers.length = 0
  createdStdins.length = 0
  vi.restoreAllMocks()
})

describe('TuiApp agent-ensure 三分支', () => {
  it('newSession 经 ctx.agents.create 拿 handle，controls 来自 handle', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('fresh-1')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)

    const app = new TuiApp({ ctx, stdout: makeStdout(), stdin: makeStdin() })
    const id = await app.newSession()

    expect(ctx.agents.create).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: id,
      agentOptions: { provider: 'mock', model: 'mock' },
    }))
    expect('reasoningEffort' in (
      (ctx.agents.create.mock.calls[0]?.[0] as { agentOptions: object }).agentOptions
    )).toBe(false)
    expect(ctx.sessions.create).not.toHaveBeenCalled()
    // controls 来自 handle.agent：followup 打到 handle 下的 agent
    app.handleSubmit('hello')
    expect(agent.followup).toHaveBeenCalledTimes(1)
    await app.dispose()
    // 自有 handle 由本层 dispose
    expect(handle.dispose).toHaveBeenCalledTimes(1)
  })

  it('newSession 无桥时把当前 reasoningEffort 写入 agentOptions', async () => {
    const ctx = makeCtx()
    ctx.agentDefaultModel.currentSelection.mockReturnValue({
      provider: 'deepseek-spark',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'max',
    })
    const agent = makeAgent('effort-create-1')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)

    const app = new TuiApp({ ctx, stdout: makeStdout(), stdin: makeStdin() })
    await app.newSession()

    expect(ctx.agents.create).toHaveBeenCalledWith(expect.objectContaining({
      agentOptions: {
        provider: 'deepseek-spark',
        model: 'deepseek-v4-flash',
        reasoningEffort: 'max',
      },
    }))
    await app.dispose()
  })

  it('newSession 把 process.cwd() 写入 create meta.cwd（Web 会话列表可见）', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('cwd-1')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)

    const app = new TuiApp({ ctx, stdout: makeStdout(), stdin: makeStdin() })
    await app.newSession()

    expect(ctx.agents.create).toHaveBeenCalledWith(expect.objectContaining({
      meta: { cwd: process.cwd() },
    }))
    await app.dispose()
  })

  it('newSession 经 reflect.get 读 intentBridge：属性访问抛 without inject 时仍建常规会话', async () => {
    const ctx = makeCtx()
    Object.defineProperty(ctx, 'intentBridge', {
      get(): never {
        throw new Error('cannot get property "intentBridge" without inject')
      },
      configurable: true,
    })
    const agent = makeAgent('bridge-proxy-1')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)

    const app = new TuiApp({ ctx, stdout: makeStdout(), stdin: makeStdin() })
    await expect(app.newSession()).resolves.toEqual(expect.any(String))
    expect(ctx.agents.create).toHaveBeenCalledTimes(1)
    await app.dispose()
  })

  it('newSession 在 intentBridge enabled:false 时回退常规创建（createAlignedSession 在关闭态会抛）', async () => {
    const ctx = makeCtx()
    const createAlignedSession = vi.fn()
    ctx.reflect.get.mockImplementation((name: string) => (
      name === 'intentBridge' ? { enabled: false, createAlignedSession } : undefined
    ))
    const agent = makeAgent('bridge-disabled-1')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)

    const app = new TuiApp({ ctx, stdout: makeStdout(), stdin: makeStdin() })
    await expect(app.newSession()).resolves.toEqual(expect.any(String))
    expect(createAlignedSession).not.toHaveBeenCalled()
    expect(ctx.agents.create).toHaveBeenCalledTimes(1)
    await app.dispose()
  })

  it('newSession 在 intentBridge 装配时走 createAlignedSession，主会话跟随当前模型', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('align-1')
    const handle = makeHandle(agent)
    const createAlignedSession = vi.fn(async () => ({ sessionId: 'align-session', handle }))
    ctx.reflect.get.mockImplementation((name: string) => (
      name === 'intentBridge' ? { enabled: true, createAlignedSession } : undefined
    ))
    ctx.sessions.get.mockReturnValue(agent.session)

    const app = new TuiApp({ ctx, stdout: makeStdout(), stdin: makeStdin() })
    const id = await app.newSession()

    expect(id).toBe(SessionId('align-session'))
    expect(createAlignedSession).toHaveBeenCalledWith({
      cwd: process.cwd(),
      exec: { provider: 'mock', model: 'mock' },
    })
    // The zero-arg mock widens calls to an empty tuple; read the first
    // argument through unknown, then guard before the `in` probe.
    const firstOptions = (createAlignedSession.mock.calls[0] as unknown as Array<{ exec: object }>)[0]
    expect(firstOptions !== undefined && 'reasoningEffort' in firstOptions.exec)
      .toBe(false)
    expect(ctx.agents.create).not.toHaveBeenCalled()
    await app.dispose()
  })

  it('newSession 对齐会话（带种子事件）→ 不误报「已恢复会话」横幅与回放分隔', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('align-seeded')
    const handle = makeHandle(agent)
    const createAlignedSession = vi.fn(async () => ({ sessionId: 'align-session', handle }))
    ctx.reflect.get.mockImplementation((name: string) => (
      name === 'intentBridge' ? { enabled: true, createAlignedSession } : undefined
    ))
    // 对齐会话的真实种子形状（intent-bridge createAlignedSession）：zen/phase ×2
    // + end-seed + session/title——事件数非零，按事件数猜测会把新建误报成恢复。
    ;(agent.session as unknown as { events: SessionEvent[] }).events = [
      { type: 'zen/phase', seq: 0, time: 1, data: { phase: 'zen', reason: 'arm' } },
      { type: 'zen/phase', seq: 1, time: 2, data: { phase: 'full', reason: 'timeout' } },
      { type: 'session/end-seed', seq: 2, time: 3, data: {} },
      { type: 'session/title', seq: 3, time: 4, data: { title: '意图对齐', messageSeqs: [], source: { kind: 'fallback' } } },
    ] as unknown as SessionEvent[]
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin: makeStdin() })
    await app.newSession()
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).not.toContain('已恢复会话')
    expect(written).not.toContain('上次进行到此处')
    await app.dispose()
  })

  it('newSession 在 intentBridge 装配时把当前 reasoningEffort 传给主会话 exec', async () => {
    const ctx = makeCtx()
    ctx.agentDefaultModel.currentSelection.mockReturnValue({
      provider: 'deepseek-spark',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'max',
    })
    const agent = makeAgent('align-effort')
    const handle = makeHandle(agent)
    const createAlignedSession = vi.fn(async () => ({ sessionId: 'align-session', handle }))
    ctx.reflect.get.mockImplementation((name: string) => (
      name === 'intentBridge' ? { enabled: true, createAlignedSession } : undefined
    ))
    ctx.sessions.get.mockReturnValue(agent.session)

    const app = new TuiApp({ ctx, stdout: makeStdout(), stdin: makeStdin() })
    await app.newSession()

    expect(createAlignedSession).toHaveBeenCalledWith({
      cwd: process.cwd(),
      exec: {
        provider: 'deepseek-spark',
        model: 'deepseek-v4-flash',
        reasoningEffort: 'max',
      },
    })
    await app.dispose()
  })

  it('提交路径在 followup 前先画一帧：驱动同步阻塞不吞输入框（提交卡顿回归）', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('order-1')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdout = makeStdout()

    const app = new TuiApp({ ctx, stdout, stdin: makeStdin() })
    await app.newSession()
    const write = stdout.write as ReturnType<typeof vi.fn>
    write.mockClear()
    // followup 触发时刻截屏：此刻 stdout 已写入的内容必须已含输入轨 chrome
    //（❯ 提示符）——commitUserPrompt 擦除 live 区后、进入可能同步阻塞数秒的
    // 驱动调用前，先画回一帧（2026-08-16 semantic-index 同步重建根修的防御层）。
    let writtenAtFollowup = ''
    agent.followup.mockImplementation(() => {
      writtenAtFollowup = write.mock.calls.map(call => String(call[0])).join('')
    })
    app.handleSubmit('hello')
    expect(agent.followup).toHaveBeenCalledTimes(1)
    expect(writtenAtFollowup).toContain('❯')
    await app.dispose()
  })

  it('switchSession 旧会话无 agent → resume，controls 来自 handle', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('old-1')
    const handle = makeHandle(agent)
    ctx.agents.get.mockReturnValue(undefined)
    ctx.agents.resume.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)

    const app = new TuiApp({ ctx, stdout: makeStdout(), stdin: makeStdin() })
    await app.switchSession(SessionId('old-1'))

    expect(ctx.agents.resume).toHaveBeenCalledWith(expect.objectContaining({
      resumeSessionId: SessionId('old-1'),
      agentOptions: { provider: 'mock', model: 'mock' },
    }))
    expect(ctx.agents.create).not.toHaveBeenCalled()
    app.handleSubmit('hi')
    expect(agent.followup).toHaveBeenCalledTimes(1)
    await app.dispose()
    expect(handle.dispose).toHaveBeenCalledTimes(1)
  })

  it('switchSession 旧会话已有 agent → registry 兜底，不 create 不 resume', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('live-1')
    ctx.agents.get.mockReturnValue(agent)
    ctx.sessions.get.mockReturnValue(agent.session)

    const app = new TuiApp({ ctx, stdout: makeStdout(), stdin: makeStdin() })
    await app.switchSession(SessionId('live-1'))

    expect(ctx.agents.create).not.toHaveBeenCalled()
    expect(ctx.agents.resume).not.toHaveBeenCalled()
    // registry 兜底仍可驱动
    app.handleSubmit('hi')
    expect(agent.followup).toHaveBeenCalledTimes(1)
    await app.dispose()
    // 非自有 agent：无 handle 可 dispose，且 bare agent 无 dispose 语义
  })

  it('dispose 时 flushAll 遍历 live sessions 并 flush', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('flush-1')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    ctx.sessions.list.mockReturnValue([agent.session])

    const app = new TuiApp({ ctx, stdout: makeStdout(), stdin: makeStdin() })
    await app.newSession()
    await app.dispose()

    expect(ctx.sessions.flush).toHaveBeenCalled()
    expect(handle.dispose).toHaveBeenCalledTimes(1)
  })

  it('P3 side conversation：切换保留旧会话 agent（keepHandle 让渡），切回走 registry 兜底', async () => {
    const ctx = makeCtx()
    const agentA = makeAgent('keep-a')
    const handleA = makeHandle(agentA)
    const agentB = makeAgent('keep-b')
    const handleB = makeHandle(agentB)
    ctx.agents.create
      .mockResolvedValueOnce(handleA)
      .mockResolvedValueOnce(handleB)
    ctx.sessions.get.mockReturnValue(agentA.session)
    let idA: SessionId = SessionId('')
    // 切回 A 时 registry 命中（A 的 agent 在 keepHandle 后仍 live；id 闭包
    // 匹配 newSession 实际铸造的 session id）
    ctx.agents.get.mockImplementation((id: SessionId) => id === idA ? agentA : undefined)

    const app = new TuiApp({ ctx, stdout: makeStdout(), stdin: makeStdin() })
    idA = await app.newSession()
    await app.newSession() // /session new：旧会话保留

    // keepHandle 语义：切换不销毁旧 agent（side conversation 成立条件）
    expect(handleA.dispose).not.toHaveBeenCalled()

    // 切回 A：registry 兜底——不 create 不 resume，直接驱动原 agent
    await app.switchSession(idA)
    expect(ctx.agents.create).toHaveBeenCalledTimes(2)
    expect(ctx.agents.resume).not.toHaveBeenCalled()
    app.handleSubmit('hi')
    expect(agentA.followup).toHaveBeenCalledTimes(1)

    // 所有权已让渡 registry：退出时本层不再 dispose（释放由 agent-loop factory
    // 在 ctx teardown 统一承担——mock 无 factory，此处断言"不再持有"语义）。
    await app.dispose()
    expect(handleA.dispose).not.toHaveBeenCalled()
    expect(handleB.dispose).not.toHaveBeenCalled()
  })
})

describe('TuiApp 模型定路', () => {
  it('newSession 的 setup 经 installModelSelection 接线装配与请求路由', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('route-1')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)

    const app = new TuiApp({ ctx, stdout: makeStdout(), stdin: makeStdin() })
    await app.newSession()

    const setup = (ctx.agents.create.mock.calls[0]?.[0] as { setup?: (c: unknown) => void } | undefined)?.setup
    expect(setup).toBeTypeOf('function')
    const agentCtx = { on: vi.fn((_name: string, _handler: unknown) => () => { }) }
    setup?.(agentCtx)
    expect(agentCtx.on.mock.calls.map(call => call[0])).toEqual(['system-prompt/assemble', 'agent/request'])
    await app.dispose()
  })

  it('resume 沿用会话持久化 request header 的模型，无 header 才落默认选择', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('route-2')
    agent.session.requestHeader.mockReturnValue({ config: { provider: 'deepseek', model: 'deepseek-reasoner' } })
    ctx.agents.get.mockReturnValue(undefined)
    ctx.agents.resume.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)

    const app = new TuiApp({ ctx, stdout: makeStdout(), stdin: makeStdin() })
    await app.switchSession(SessionId('route-2'))

    expect(ctx.agents.resume).toHaveBeenCalledWith(expect.objectContaining({
      agentOptions: { provider: 'deepseek', model: 'deepseek-reasoner' },
    }))
    // 持久化路由存在时不读默认选择
    expect(ctx.agentDefaultModel.currentSelection).not.toHaveBeenCalled()
    await app.dispose()
  })
})

describe('TuiApp 审查 HIGH 修复回归（177c12e）', () => {
  it('attach 无参时使用构造 initialSessionId，优先恢复而非新建', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('init-1')
    const handle = makeHandle(agent)
    ctx.agents.get.mockReturnValue(undefined)
    ctx.agents.resume.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    ctx.sessions.list.mockReturnValue([agent.session])

    const app = new TuiApp({ ctx, stdout: makeStdout(), stdin: makeStdin(), initialSessionId: SessionId('init-1') })
    await app.attach()

    expect(ctx.agents.resume).toHaveBeenCalledWith(expect.objectContaining({
      resumeSessionId: SessionId('init-1'),
      agentOptions: { provider: 'mock', model: 'mock' },
    }))
    expect(ctx.agents.create).not.toHaveBeenCalled()
    await app.dispose()
  })

  it('theme 选项生效：显式主题不经背景探测', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('theme-1')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)

    const app = new TuiApp({ ctx, stdout: makeStdout(), stdin: makeStdin(), theme: 'paper' })
    await app.attach()

    expect(getActiveThemeName()).toBe('paper')
    await app.dispose()
  })

  it('auto 主题走背景探测落点（omp/paper 之一）', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('theme-auto')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)

    const app = new TuiApp({ ctx, stdout: makeStdout(), stdin: makeStdin(), theme: 'auto' })
    await app.attach()

    expect(['omp', 'paper']).toContain(getActiveThemeName())
    await app.dispose()
  })

  it('ctrl_c 空闲空输入：第一次提示不退出，窗口内第二次才 onExit', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('exit-1')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    const onExit = vi.fn()
    const stdin = makeStdin()
    const stdout = makeStdout()

    const app = new TuiApp({ ctx, stdout, stdin, onExit })
    await app.attach()

    stdin.emit('data', '\x03') // raw-mode Ctrl+C 作为 0x03 字节进入数据流
    await new Promise(resolve => setImmediate(resolve))
    expect(onExit).not.toHaveBeenCalled()
    expect(agent.cancel).not.toHaveBeenCalled()
    const afterFirst = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(afterFirst).toContain('再按 Ctrl+C 退出进程')

    stdin.emit('data', '\x03')
    await new Promise(resolve => setImmediate(resolve))
    expect(onExit).toHaveBeenCalledTimes(1)
    expect(agent.cancel).not.toHaveBeenCalled()
    await app.dispose()
  })

  it('Kitty CSI 99;5u 空闲空输入：窗口内第二次才 onExit', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('exit-csi-c')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    const onExit = vi.fn()
    const stdin = makeStdin()
    const stdout = makeStdout()

    const app = new TuiApp({ ctx, stdout, stdin, onExit })
    await app.attach()

    stdin.emit('data', '\x1b[99;5u')
    await new Promise(resolve => setImmediate(resolve))
    expect(onExit).not.toHaveBeenCalled()
    expect(stdout.write.mock.calls.map(c => `${c[0]}`).join('')).toContain('再按 Ctrl+C 退出进程')

    stdin.emit('data', '\x1b[99;5u')
    await new Promise(resolve => setImmediate(resolve))
    expect(onExit).toHaveBeenCalledTimes(1)
    await app.dispose()
  })

  it('ctrl_c 空闲非空：清输入行，不退出、不打印已取消', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('clear-line')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    const onExit = vi.fn()
    const stdin = makeStdin()
    const stdout = makeStdout()

    const app = new TuiApp({ ctx, stdout, stdin, onExit })
    await app.attach()
    stdin.emit('data', 'hello')
    await new Promise(resolve => setImmediate(resolve))
    stdout.write.mockClear()
    stdin.emit('data', '\x03')
    await new Promise(resolve => setImmediate(resolve))
    expect(onExit).not.toHaveBeenCalled()
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).not.toContain('已取消')
    expect(written).not.toContain('hello')
    // 清空草稿同时布防连按窗口：窗口内第二次 Ctrl+C 即退出
    stdin.emit('data', '\x03')
    await new Promise(resolve => setImmediate(resolve))
    expect(onExit).toHaveBeenCalledTimes(1)
    await app.dispose()
  })

  it('ctrl_c 空闲空输入：超过连按窗口的第二次仍不退出', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('exit-window')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    const onExit = vi.fn()
    const stdin = makeStdin()

    const app = new TuiApp({ ctx, stdout: makeStdout(), stdin, onExit })
    await app.attach()

    const now = Date.now()
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now)
    stdin.emit('data', '\x03')
    await new Promise(resolve => setImmediate(resolve))
    nowSpy.mockReturnValue(now + 2_001)
    stdin.emit('data', '\x03')
    await new Promise(resolve => setImmediate(resolve))
    expect(onExit).not.toHaveBeenCalled()
    nowSpy.mockReturnValue(now + 2_002)
    stdin.emit('data', '\x03')
    await new Promise(resolve => setImmediate(resolve))
    expect(onExit).toHaveBeenCalledTimes(1)
    nowSpy.mockRestore()
    await app.dispose()
  })

  it('agent running 时空输入 Ctrl+C → handleAbort，不 onExit', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('abort-run')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    const onExit = vi.fn()
    const stdin = makeStdin()
    const stdout = makeStdout()

    const app = new TuiApp({ ctx, stdout, stdin, onExit })
    await app.attach()
    const id = app.sessionId
    if (id === null) throw new Error('sessionId missing after attach')
    const statusHandlers = ctx.on.mock.calls
      .filter((call: unknown[]) => call[0] === 'agent/status')
      .map(call => call[1] as (payload: { agent: { id: SessionId }; status: string }) => void)
    for (const handler of statusHandlers) handler({ agent: { id }, status: 'running' })

    stdin.emit('data', '\x03')
    await new Promise(resolve => setImmediate(resolve))
    expect(onExit).not.toHaveBeenCalled()
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('已取消')
    await app.dispose()
  })

  it('agent running 时空输入连按两次 Ctrl+C：第一次打断，窗口内第二次 onExit', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('abort-then-exit')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    const onExit = vi.fn()
    const stdin = makeStdin()
    const stdout = makeStdout()

    const app = new TuiApp({ ctx, stdout, stdin, onExit })
    await app.attach()
    const id = app.sessionId
    if (id === null) throw new Error('sessionId missing after attach')
    const statusHandlers = ctx.on.mock.calls
      .filter((call: unknown[]) => call[0] === 'agent/status')
      .map(call => call[1] as (payload: { agent: { id: SessionId }; status: string }) => void)
    for (const handler of statusHandlers) handler({ agent: { id }, status: 'running' })

    stdin.emit('data', '\x03')
    await new Promise(resolve => setImmediate(resolve))
    expect(onExit).not.toHaveBeenCalled()
    expect(agent.cancel).toHaveBeenCalledTimes(1)

    stdin.emit('data', '\x03')
    await new Promise(resolve => setImmediate(resolve))
    expect(onExit).toHaveBeenCalledTimes(1)
    await app.dispose()
  })

  it('agent running 且输入行有草稿：第一次打断并布防，窗口内第二次仍 onExit', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('abort-draft-exit')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    const onExit = vi.fn()
    const stdin = makeStdin()
    const stdout = makeStdout()

    const app = new TuiApp({ ctx, stdout, stdin, onExit })
    await app.attach()
    stdin.emit('data', 'draft')
    await new Promise(resolve => setImmediate(resolve))
    const id = app.sessionId
    if (id === null) throw new Error('sessionId missing after attach')
    const statusHandlers = ctx.on.mock.calls
      .filter((call: unknown[]) => call[0] === 'agent/status')
      .map(call => call[1] as (payload: { agent: { id: SessionId }; status: string }) => void)
    for (const handler of statusHandlers) handler({ agent: { id }, status: 'running' })

    stdin.emit('data', '\x03')
    await new Promise(resolve => setImmediate(resolve))
    expect(onExit).not.toHaveBeenCalled()
    expect(agent.cancel).toHaveBeenCalledTimes(1)

    stdin.emit('data', '\x03')
    await new Promise(resolve => setImmediate(resolve))
    expect(onExit).toHaveBeenCalledTimes(1)
    await app.dispose()
  })

  it('agent running 时 Esc → handleAbort（对齐 Claude Code 单次 Esc 打断）', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('abort-esc')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    const onExit = vi.fn()
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin, onExit })
    await app.attach()
    const id = app.sessionId
    if (id === null) throw new Error('sessionId missing after attach')
    const statusHandlers = ctx.on.mock.calls
      .filter((call: unknown[]) => call[0] === 'agent/status')
      .map(call => call[1] as (payload: { agent: { id: SessionId }; status: string }) => void)
    for (const handler of statusHandlers) handler({ agent: { id }, status: 'running' })

    // lone ESC 走 80ms 防误触超时才派发
    stdin.emit('data', '\x1b')
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(onExit).not.toHaveBeenCalled()
    expect(agent.cancel).toHaveBeenCalledTimes(1)
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('已取消')
    await app.dispose()
  })

  it('agent running 时 Kitty CSI 27 u Esc → handleAbort', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('abort-esc-csi')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    const onExit = vi.fn()
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin, onExit })
    await app.attach()
    const id = app.sessionId
    if (id === null) throw new Error('sessionId missing after attach')
    const statusHandlers = ctx.on.mock.calls
      .filter((call: unknown[]) => call[0] === 'agent/status')
      .map(call => call[1] as (payload: { agent: { id: SessionId }; status: string }) => void)
    for (const handler of statusHandlers) handler({ agent: { id }, status: 'running' })

    stdin.emit('data', '\x1b[27u')
    await new Promise(resolve => setImmediate(resolve))
    expect(onExit).not.toHaveBeenCalled()
    expect(agent.cancel).toHaveBeenCalledTimes(1)
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('已取消')
    await app.dispose()
  })

  it('空闲时 Esc → 无操作（不退出、不打断）', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('idle-esc')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    const onExit = vi.fn()
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin, onExit })
    await app.attach()
    const written0 = stdout.write.mock.calls.length
    stdin.emit('data', '\x1b')
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(onExit).not.toHaveBeenCalled()
    expect(agent.cancel).not.toHaveBeenCalled()
    const written = stdout.write.mock.calls.slice(written0).map(c => `${c[0]}`).join('')
    expect(written).not.toContain('已取消')
    await app.dispose()
  })

  it('slash 菜单打开 + running + Esc → 关菜单不打断', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('slash-esc')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin })
    await app.attach()
    const id = app.sessionId
    if (id === null) throw new Error('sessionId missing after attach')
    const statusHandlers = ctx.on.mock.calls
      .filter((call: unknown[]) => call[0] === 'agent/status')
      .map(call => call[1] as (payload: { agent: { id: SessionId }; status: string }) => void)
    for (const handler of statusHandlers) handler({ agent: { id }, status: 'running' })
    // 打开 slash 菜单（输入 / 触发）
    stdin.emit('data', '/')
    await new Promise(resolve => setTimeout(resolve, 50))
    stdin.emit('data', '\x1b')
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(agent.cancel).not.toHaveBeenCalled() // 关菜单优先,不打断
    await app.dispose()
  })

  it('空闲双击 Esc → 打开 rewind overlay（CC 的 Esc+Esc 时间回溯）', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('dbl-esc')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin })
    await app.attach()
    // session.id 同步:transcript 过滤 owner.id === session.id
    ;(agent.session as { id: SessionId }).id = app.sessionId ?? SessionId('dbl-esc')
    // 会话需有用户检查点（rewindSession 无用户消息不打开）
    const bus = sessionEventBus(ctx)
    const id = app.sessionId
    if (id === null) throw new Error('sessionId missing')
    emitTranscriptUser(bus, id, 1, 'hi')
    // 单次 Esc → 不打开（断言 overlay 标题而非裸 'rewind'——随机欢迎 Tip
    // 可能抽中 "/rewind 回退到一条用户消息"，裸关键字会误伤）
    stdin.emit('data', '\x1b')
    await new Promise(resolve => setTimeout(resolve, 150))
    let written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).not.toContain('⟲ rewind 回退')
    // 非 Esc 键清除待定双击窗口（避免单次检查污染下面的双击）
    stdin.emit('data', 'x')
    await new Promise(resolve => setTimeout(resolve, 50))
    // 窗口内双击 Esc → 打开（两次间隔 200ms < 1s 窗口；lone ESC 各走 80ms 派发）
    stdin.emit('data', '\x1b')
    await new Promise(resolve => setTimeout(resolve, 200))
    stdin.emit('data', '\x1b')
    await new Promise(resolve => setTimeout(resolve, 150))
    written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('⟲ rewind 回退')
    await app.dispose()
  })

  it('空闲双击 Esc：窗口外（>1s）第二次不触发 rewind', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('dbl-esc-out')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin })
    await app.attach()
    ;(agent.session as { id: SessionId }).id = app.sessionId ?? SessionId('dbl-esc-out')
    const bus = sessionEventBus(ctx)
    const id = app.sessionId
    if (id === null) throw new Error('sessionId missing')
    emitTranscriptUser(bus, id, 1, 'hi')
    // 第一次 Esc → 记时间戳
    stdin.emit('data', '\x1b')
    await new Promise(resolve => setTimeout(resolve, 150))
    // 等窗口过期(1s)后再按第二次
    await new Promise(resolve => setTimeout(resolve, 1100))
    stdin.emit('data', '\x1b')
    await new Promise(resolve => setTimeout(resolve, 150))
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).not.toContain('⟲ rewind 回退')
    await app.dispose()
  })

  it('vim 开启时双击 Esc 不触发 rewind（含 insert→normal 的第一次 Esc）', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('vim-dbl-esc')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin, vimEnabled: true })
    await app.attach()
    ;(agent.session as { id: SessionId }).id = app.sessionId ?? SessionId('vim-dbl-esc')
    // 会话需有用户检查点（rewindSession 无用户消息不打开）——确保窗口内双击本会触发
    const bus = sessionEventBus(ctx)
    const id = app.sessionId
    if (id === null) throw new Error('sessionId missing')
    emitTranscriptUser(bus, id, 1, 'hi')
    // 默认 insert：第一次 Esc 切到 normal；vim 开启时空闲 Esc 不布防 rewind
    stdin.emit('data', '\x1b')
    await new Promise(resolve => setTimeout(resolve, 150))
    // 习惯性补按：仍不触发（若只守卫 normal，第一次会布防、这次会弹出）
    stdin.emit('data', '\x1b')
    await new Promise(resolve => setTimeout(resolve, 150))
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).not.toContain('⟲ rewind 回退')
    await app.dispose()
  })

  it('rewind 打开后第三次 Esc 关闭 overlay（不立刻重开）', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('rewind-esc-close')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin })
    await app.attach()
    ;(agent.session as { id: SessionId }).id = app.sessionId ?? SessionId('rewind-esc-close')
    const bus = sessionEventBus(ctx)
    const id = app.sessionId
    if (id === null) throw new Error('sessionId missing')
    emitTranscriptUser(bus, id, 1, '检查点')
    stdin.emit('data', '\x1b')
    await new Promise(resolve => setTimeout(resolve, 200))
    stdin.emit('data', '\x1b')
    await new Promise(resolve => setTimeout(resolve, 150))
    const opened = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(opened).toContain('⟲ rewind 回退')
    expect(opened).toContain('\x1B[?1049h')
    const altOnCount = opened.split('\x1B[?1049h').length - 1
    stdin.emit('data', '\x1b')
    await new Promise(resolve => setTimeout(resolve, 150))
    const closed = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(closed).toContain('\x1B[?1049l')
    expect(closed.split('\x1B[?1049h').length - 1).toBe(altOnCount)
    await app.dispose()
  })

  it('rewind 打开时 Ctrl+C 关闭 overlay（不退出进程）', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('rewind-ctrl-c-close')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdin = makeStdin()
    const stdout = makeStdout()
    const onExit = vi.fn()
    const app = new TuiApp({ ctx, stdout, stdin, onExit })
    await app.attach()
    ;(agent.session as { id: SessionId }).id = app.sessionId ?? SessionId('rewind-ctrl-c-close')
    const bus = sessionEventBus(ctx)
    const id = app.sessionId
    if (id === null) throw new Error('sessionId missing')
    emitTranscriptUser(bus, id, 1, '检查点')
    stdin.emit('data', '\x1b')
    await new Promise(resolve => setTimeout(resolve, 200))
    stdin.emit('data', '\x1b')
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(stdout.write.mock.calls.map(c => `${c[0]}`).join('')).toContain('⟲ rewind 回退')
    stdin.emit('data', '\x03')
    await new Promise(resolve => setTimeout(resolve, 150))
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('\x1B[?1049l')
    expect(onExit).not.toHaveBeenCalled()
    await app.dispose()
  })

  it('rewind 列表只收真人用户检查点：插件源与空助手行不出现', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('rewind-filter')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin: makeStdin() })
    await app.attach()
    ;(agent.session as { id: SessionId }).id = app.sessionId ?? SessionId('rewind-filter')
    const bus = sessionEventBus(ctx)
    const id = app.sessionId
    if (id === null) throw new Error('sessionId missing')
    emitTranscriptUser(bus, id, 1, '我说过的话')
    emitTranscriptUser(bus, id, 2, '禅已超时', { kind: 'plugin', plugin: 'zen' })
    bus(id, {
      seq: 3,
      time: 3,
      type: 'assistant/message',
      data: {
        turn: 1,
        step: 0,
        message: { role: 'assistant', content: [] },
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    })
    expect(app.rewindSession()).toBe(true)
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('⟲ rewind 回退')
    expect(written).toContain('我说过的话')
    expect(written).not.toContain('禅已超时')
    expect(written.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')).not.toMatch(/✦/)
    await app.dispose()
  })

  it('没有用户检查点时不打开 rewind，并回显原因', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('rewind-empty')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin: makeStdin() })
    await app.attach()
    ;(agent.session as { id: SessionId }).id = app.sessionId ?? SessionId('rewind-empty')
    const bus = sessionEventBus(ctx)
    const id = app.sessionId
    if (id === null) throw new Error('sessionId missing')
    emitTranscriptUser(bus, id, 1, '插件锚点', { kind: 'plugin', plugin: 'spark-anchors' })
    bus(id, {
      seq: 2,
      time: 2,
      type: 'assistant/message',
      data: {
        turn: 1,
        step: 0,
        message: { role: 'assistant', content: [] },
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    })
    expect(app.rewindSession()).toBe(false)
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).not.toContain('⟲ rewind 回退')
    expect(written).toContain('没有可回退的用户消息')
    await app.dispose()
  })

  describe('/cost 会话成本汇总', () => {
    async function costSetup(agentId: string) {
      const ctx = makeCtx()
      const agent = makeAgent(agentId)
      ctx.agents.create.mockResolvedValue(makeHandle(agent))
      ctx.sessions.get.mockReturnValue(agent.session)
      const stdout = makeStdout()
      const app = new TuiApp({ ctx, stdout, stdin: makeStdin() })
      await app.attach()
      return { ctx, stdout, app }
    }

    it('usage 事件按模型累计；/cost 输出明细与合计', async () => {
      const { ctx, stdout, app } = await costSetup('cost-1')
      const bus = sessionEventBus(ctx)
      const id = app.sessionId
      if (id === null) throw new Error('no active session')
      // 模型 A 两次请求(累计)
      bus(id, {
        seq: 1, time: 1, type: 'request/header',
        data: { header: { config: { provider: 'mock', model: 'deepseek-v4-flash' } }, reason: 'initial' },
      })
      bus(id, {
        seq: 2, time: 2, type: 'assistant/message',
        data: { turn: 1, step: 0, message: { role: 'assistant', content: [{ type: 'text', text: 'a' }] }, usage: { inputTokens: 1_000_000, outputTokens: 200_000 } },
      })
      bus(id, {
        seq: 3, time: 3, type: 'assistant/message',
        data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'b' }] }, usage: { inputTokens: 500_000, outputTokens: 100_000 } },
      })
      // 模型 B 一次请求
      bus(id, {
        seq: 4, time: 4, type: 'request/header',
        data: { header: { config: { provider: 'mock', model: 'deepseek-v4-pro' } }, reason: 'change' },
      })
      bus(id, {
        seq: 5, time: 5, type: 'assistant/message',
        data: { turn: 1, step: 2, message: { role: 'assistant', content: [{ type: 'text', text: 'c' }] }, usage: { inputTokens: 500_000, outputTokens: 100_000 } },
      })
      app.handleSubmit('/cost')
      await new Promise(resolve => setImmediate(resolve))
      const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
      expect(written).toContain('会话成本统计')
      expect(written).toContain('deepseek-v4-flash')
      expect(written).toContain('输入 1.50M')
      expect(written).toContain('输出 300k')
      expect(written).toContain('deepseek-v4-pro')
      expect(written).toContain('合计:输入 2.00M')
      await app.dispose()
    })

    it('/cost 无用量数据 → 占位提示', async () => {
      const { stdout, app } = await costSetup('cost-empty')
      app.handleSubmit('/cost')
      await new Promise(resolve => setImmediate(resolve))
      const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
      expect(written).toContain('（本会话尚无用量数据）')
      await app.dispose()
    })
  })

  it('会话 tab 栏已移除：多会话也不渲染 tab 行，Ctrl+X/Alt+数字不再切换', async () => {
    // chrome tab 栏（短 id 列表）曾把全部持久化会话挤成一排无意义 hex，
    // 被产品判定移除；会话切换由 /resume、Ctrl+S（带标题的选择器）承载。
    // live 区的 side-conversation 状态行（renderSessionTabs，≥2 个 mounted
    // 会话）是另一表面，不受影响。
    const ctx = makeCtx()
    const agent = makeAgent('tab-1')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    const s1 = SessionId('session-tab-one')
    const s2 = SessionId('session-tab-two')
    const s3 = SessionId('session-tab-three')
    const headerOf = (id: SessionId, createdAt: number) => ({
      id, createdAt, version: 0, cwd: undefined, parentSession: undefined,
    })
    ctx.sessions.list.mockReturnValue([
      { id: s1, header: headerOf(s1, Date.now() - 1_000), events: [] },
      { id: s2, header: headerOf(s2, Date.now() - 2_000), events: [] },
      { id: s3, header: headerOf(s3, Date.now() - 3_000), events: [] },
    ])
    ctx.agents.get.mockReturnValue(agent)
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin })
    await app.attach()
    expect(app.sessionId).toBe(s1)
    await new Promise(resolve => setTimeout(resolve, 50))
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    // 不渲染 tab 行（`[短id]` 形态；欢迎页列表的 `#短id` 形态不受影响）
    expect(written).not.toContain('[tab-one')
    expect(written).not.toContain('[tab-two')
    // Ctrl+X / Alt+数字 回归输入行语义：不再切换会话
    stdin.emit('data', '\x18')
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(app.sessionId).toBe(s1)
    stdin.emit('data', '\x1b3')
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(app.sessionId).toBe(s1)
    await app.dispose()
  })

  it('#31 空输入框 Tab → execute 模式：过滤 /exit 回车直接执行（onExit 触发，不经输入框回填）', async () => {
    const onExit = vi.fn()
    const ctx = makeCtx()
    const agent = makeAgent('tab-exec-1')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdin = makeStdin()
    const app = new TuiApp({ ctx, stdout: makeStdout(), stdin, onExit })
    await app.attach()

    stdin.emit('data', '\x09') // Tab（空输入框）→ execute 模式命令菜单
    await new Promise(resolve => setImmediate(resolve))
    stdin.emit('data', 'exit') // 过滤 → /exit（'ex' 会同时命中 export，输入完整名）
    stdin.emit('data', '\r')   // Enter → 直接执行 /exit（无参）→ onExit
    await new Promise(resolve => setImmediate(resolve))

    expect(onExit).toHaveBeenCalledTimes(1)
    await app.dispose()
  })

  it('#31 空输入框 Tab 打开 execute 模式后 Esc 关闭（不执行、不回填）', async () => {
    const onExit = vi.fn()
    const ctx = makeCtx()
    const agent = makeAgent('tab-exec-2')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin, onExit })
    await app.attach()

    stdin.emit('data', '\x09') // Tab → execute 模式菜单
    await new Promise(resolve => setImmediate(resolve))
    stdin.emit('data', '\x1b') // Esc 关闭
    await new Promise(resolve => setTimeout(resolve, 200))

    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('\x1B[?1049l') // 退出 alt screen（菜单已关闭）
    expect(onExit).not.toHaveBeenCalled()     // 未执行任何命令
    await app.dispose()
  })

  describe('TuiApp slash 路径豁免（/ 开头文件路径不误判为命令）', () => {
    async function boot() {
      const ctx = makeCtx()
      const agent = makeAgent('slash-path-1')
      const handle = makeHandle(agent)
      ctx.agents.create.mockResolvedValue(handle)
      ctx.sessions.get.mockReturnValue(agent.session)
      const app = new TuiApp({ ctx, stdout: makeStdout(), stdin: makeStdin() })
      await app.newSession()
      return { app, agent }
    }

    it('/src/main.ts 走普通消息（followup），不报未知命令', async () => {
      const { app, agent } = await boot()
      app.handleSubmit('/src/main.ts')
      expect(agent.followup).toHaveBeenCalledTimes(1)
      expect(firstCallText(agent.followup)).toBe('/src/main.ts')
      await app.dispose()
    })

    it('/tmp/foo bar（路径含空格）走普通消息', async () => {
      const { app, agent } = await boot()
      app.handleSubmit('/tmp/foo bar')
      expect(agent.followup).toHaveBeenCalledTimes(1)
      await app.dispose()
    })

    it('已知命令 /exit 仍走命令通道（不豁免）', async () => {
      const { app, agent } = await boot()
      app.handleSubmit('/exit')
      expect(agent.followup).not.toHaveBeenCalled()
      await app.dispose()
    })

    it('/st 歧义前缀仍进命令通道（未知命令回显，不豁免）', async () => {
      const { app, agent } = await boot()
      app.handleSubmit('/st')
      expect(agent.followup).not.toHaveBeenCalled()
      await app.dispose()
    })
  })

  describe('Issue #31 交互式选择器（/model /theme /session 无参打开）', () => {
    /** attach 模式 boot（键盘链路在 attach 注册）。 */
    async function bootPicker() {
      const ctx = makeCtx()
      const handlers = new Map<string, Array<(...args: unknown[]) => void>>()
      ctx.on.mockImplementation((name: string, h: (...args: unknown[]) => void) => {
        const list = handlers.get(name) ?? []
        list.push(h)
        handlers.set(name, list)
        return () => { }
      })
      ctx.agents.create.mockImplementation(({ sessionId }: { sessionId: string }) => {
        const agent = makeAgent(sessionId)
        ctx.sessions.get.mockReturnValue(agent.session)
        return makeHandle(agent)
      })
      const stdin = makeStdin()
      const stdout = makeStdout()
      const app = new TuiApp({ ctx, stdout, stdin })
      await app.attach()
      const written = () => stdout.write.mock.calls.map(c => `${c[0]}`).join('')
      const type = async (text: string) => {
        for (const ch of text) stdin.emit('data', ch)
        stdin.emit('data', '\r')
        await new Promise(resolve => setTimeout(resolve, 30))
      }
      return { ctx, stdin, stdout, app, written, type }
    }

    it('/theme 无参 → 选择器打开（当前 ● 高亮）；↑ 选择 + Enter 切换主题', async () => {
      const { stdin, app, written, type } = await bootPicker()
      // attach 的 autoTheme 会覆盖测试预设主题——在 attach 后固定。
      setTheme('graphite')
      await type('/theme')
      expect(written()).toContain('选择主题')
      expect(written()).toContain('graphite（当前）')
      // graphite 前一档是 cobalt（THEME_PALETTES 键序）；↑ 选中 + Enter 确认
      stdin.emit('data', '\x1b[A')
      stdin.emit('data', '\r')
      await new Promise(resolve => setTimeout(resolve, 30))
      expect(getActiveThemeName()).toBe('cobalt')
      await app.dispose()
    })

    it('/theme 打开后 Esc 关闭选择器（不切换）', async () => {
      const { stdin, stdout, app, written, type } = await bootPicker()
      // attach 的 autoTheme 会覆盖测试预设主题——在 attach 后固定。
      setTheme('graphite')
      await type('/theme')
      expect(written()).toContain('选择主题')
      stdin.emit('data', '\x1b') // Esc
      await new Promise(resolve => setTimeout(resolve, 30))
      const before = stdout.write.mock.calls.length
      stdin.emit('data', '\r') // 空输入 Enter：选择器已关闭，无操作
      await new Promise(resolve => setTimeout(resolve, 30))
      const after = stdout.write.mock.calls.slice(before).map(c => `${c[0]}`).join('')
      expect(after).not.toContain('选择主题')
      expect(getActiveThemeName()).toBe('graphite')
      await app.dispose()
    })

    it('/model 无参 → 模型选择器（llm 目录 + 当前 ● 高亮）；Enter 确认持久化 + 热切', async () => {
      const { ctx, stdin, app, written, type } = await bootPicker()
      const currentSelection = vi.fn(() => ({ provider: 'deepseek-official', model: 'deepseek-v4-pro' }))
      const saveSelection = vi.fn(async () => {})
      ctx.agentDefaultModel = { currentSelection, saveSelection } as never
      ctx.reflect.get.mockImplementation((name: string) => {
        if (name === 'llm') {
          return {
            listProviders: () => [{ id: 'deepseek-official', name: 'DeepSeek' }],
            listModels: async () => [
              { id: 'deepseek-v4-flash', name: 'Flash' },
              { id: 'deepseek-v4-pro', name: 'Pro' },
            ],
            // switchLiveModel → refreshVisionForSelection 会查模型识图能力
            resolveModelInfo: async () => ({ supportsVision: undefined }),
          }
        }
        return undefined
      })
      await type('/model')
      expect(written()).toContain('选择模型')
      expect(written()).toContain('deepseek-official/deepseek-v4-pro（当前）')
      // 当前 pro 已选中；Enter 确认 → saveSelection + 热切（不重新选择）
      stdin.emit('data', '\r')
      await new Promise(resolve => setTimeout(resolve, 30))
      expect(saveSelection).toHaveBeenCalledWith({ provider: 'deepseek-official', model: 'deepseek-v4-pro' })
      await app.dispose()
    })

    it('选择器确认含斜杠的模型 id（openrouter 风格）不截断', async () => {
      const { ctx, stdin, app, written, type } = await bootPicker()
      const saveSelection = vi.fn(async () => {})
      ctx.agentDefaultModel = {
        currentSelection: vi.fn(() => ({ provider: 'openrouter', model: 'stealth/ox-alpha' })),
        saveSelection,
      } as never
      ctx.reflect.get.mockImplementation((name: string) => {
        if (name === 'llm') {
          return {
            listProviders: () => [{ id: 'openrouter', name: 'openrouter' }],
            listModels: async () => [{ id: 'stealth/ox-alpha', name: 'Ox Alpha' }],
            resolveModelInfo: async () => ({ supportsVision: true }),
          }
        }
        return undefined
      })
      await type('/model')
      expect(written()).toContain('openrouter/stealth/ox-alpha（当前）')
      // 当前项已选中；Enter 确认 → 整个 id 原样落盘，不再只剩首段
      stdin.emit('data', '\r')
      await new Promise(resolve => setTimeout(resolve, 30))
      expect(saveSelection).toHaveBeenCalledWith({ provider: 'openrouter', model: 'stealth/ox-alpha' })
      await app.dispose()
    })

    /** 角色 picker 测试的 modelRoles 服务桩（resolve/pin/unpin 可断言）。 */
    function rolesStub(pins: Record<string, { provider: string; model: string } | undefined> = {}) {
      return {
        resolve: vi.fn((role: string) => pins[role]),
        pin: vi.fn(async () => {}),
        unpin: vi.fn(async () => {}),
      }
    }

    /** 角色 picker 测试的 llm 目录装配（flash 不识图、pro 识图）。 */
    function wireRolePicker(ctx: ReturnType<typeof makeCtx>, roles: ReturnType<typeof rolesStub>) {
      ctx.get.mockImplementation((name: string) => name === 'modelRoles' ? roles : undefined)
      ctx.reflect.get.mockImplementation((name: string) => {
        if (name === 'llm') {
          return {
            listProviders: () => [{ id: 'deepseek-official', name: 'DeepSeek' }],
            listModels: async () => [
              { id: 'deepseek-v4-flash', name: 'Flash', supportsVision: false },
              { id: 'deepseek-v4-pro', name: 'Pro', supportsVision: true },
            ],
          }
        }
        return undefined
      })
    }

    it('/model vision 无参 → 角色选择器（首行「跟随默认」+ 当前 pin ● 高亮）', async () => {
      const { ctx, app, written, type } = await bootPicker()
      wireRolePicker(ctx, rolesStub({ vision: { provider: 'deepseek-official', model: 'deepseek-v4-pro' } }))
      await type('/model vision')
      expect(written()).toContain('选择视觉模型')
      expect(written()).toContain('跟随默认（清除 pin）')
      expect(written()).toContain('deepseek-official/deepseek-v4-pro（当前）')
      await app.dispose()
    })

    it('角色选择器首行「跟随默认」Enter → unpin + 回显（未 pin 时首行即当前）', async () => {
      const { ctx, stdin, app, written, type } = await bootPicker()
      const roles = rolesStub()
      wireRolePicker(ctx, roles)
      await type('/model secondary')
      expect(written()).toContain('选择副模型')
      expect(written()).toContain('跟随默认（清除 pin）（当前）')
      stdin.emit('data', '\r')
      await new Promise(resolve => setTimeout(resolve, 30))
      expect(roles.unpin).toHaveBeenCalledWith('secondary')
      expect(roles.pin).not.toHaveBeenCalled()
      expect(written()).toContain('副模型已恢复跟随默认（热生效，无需重启）')
      await app.dispose()
    })

    it('角色选择器 ↓ 选目录行 + Enter → pin + 热生效回显', async () => {
      const { ctx, stdin, app, written, type } = await bootPicker()
      const roles = rolesStub()
      wireRolePicker(ctx, roles)
      await type('/model subagent')
      expect(written()).toContain('选择子代理模型')
      stdin.emit('data', '\x1b[B') // ↓ 到第一行目录行
      stdin.emit('data', '\r')
      await new Promise(resolve => setTimeout(resolve, 30))
      expect(roles.pin).toHaveBeenCalledWith('subagent', { provider: 'deepseek-official', model: 'deepseek-v4-flash' })
      expect(written()).toContain('子代理模型已 pin: deepseek-official/deepseek-v4-flash')
      expect(written()).toContain('热生效，无需重启')
      await app.dispose()
    })

    it('vision 角色选 supportsVision=false 的目录行：警告但允许 pin', async () => {
      const { ctx, stdin, app, written, type } = await bootPicker()
      const roles = rolesStub()
      wireRolePicker(ctx, roles)
      await type('/model vision')
      stdin.emit('data', '\x1b[B') // ↓ 选中 flash（supportsVision: false）
      stdin.emit('data', '\r')
      await new Promise(resolve => setTimeout(resolve, 30))
      expect(roles.pin).toHaveBeenCalledWith('vision', { provider: 'deepseek-official', model: 'deepseek-v4-flash' })
      expect(written()).toContain('未声明识图能力')
      await app.dispose()
    })

    it('modelRoles 服务缺席 → 角色子命令回显降级错误（不开 picker）', async () => {
      const { app, written, type } = await bootPicker()
      await type('/model vision')
      expect(written()).toContain('未装配 model-roles 服务')
      expect(written()).not.toContain('选择视觉模型')
      await app.dispose()
    })

    it('/session 无参 → 会话选择器（2.2 摘要行：标题 · 年龄 · cwd · 当前标记）', async () => {
      const { ctx, app, written, type } = await bootPicker()
      const headerOf = (id: string, createdAt: number) => ({
        id: SessionId(id), createdAt, version: 0, cwd: undefined, parentSession: undefined,
      })
      ctx.sessions.list.mockReturnValue([
        { id: 's-1', header: headerOf('s-1', 1_000) },
        { id: 's-2', header: headerOf('s-2', 2_000) },
      ])
      await type('/session')
      expect(written()).toContain('选择会话')
      // 2.2：单行摘要替代裸 UUID——标题（新对话）+ 短 id
      expect(written()).toContain('新对话')
      expect(written()).toContain('#s-1')
      expect(written()).toContain('#s-2')
      await app.dispose()
    })

    it('/session 选择器：损坏会话行标注「不可恢复」', async () => {
      const { ctx, app, written, type } = await bootPicker()
      const headerOf = (id: string, createdAt: number) => ({
        id: SessionId(id), createdAt, version: 0, cwd: undefined, parentSession: undefined,
      })
      ctx.sessions.list.mockReturnValue([
        { id: 's-ok', header: headerOf('s-ok', 2_000) },
        { id: 's-bad', header: { ...headerOf('s-bad', 1_000), version: -1 } },
      ])
      await type('/session')
      expect(written()).toContain('不可恢复')
      expect(written()).toContain('#s-bad')
      await app.dispose()
    })
  })

  it('dispose 先 flushAll 再释放 owned handle', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('order-1')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    ctx.sessions.list.mockReturnValue([agent.session])
    const order: string[] = []
    ctx.sessions.flush.mockImplementation(() => { order.push('flush'); return true })
    handle.dispose = vi.fn(async () => { order.push('dispose') })

    const app = new TuiApp({ ctx, stdout: makeStdout(), stdin: makeStdin() })
    await app.newSession()
    await app.dispose()

    expect(order).toEqual(['flush', 'dispose'])
  })
})

describe('TuiApp Phase 6.4 外部编辑器', () => {
  /** 生成把临时文件内容改为指定文本的编辑器替身脚本（win32 用 .cmd，其余平台 .sh）。 */
  function makeEditorScript(replacement: string): { script: string; dir: string } {
    const dir = mkdtempSync(join(tmpdir(), 'tui-edit-spec-'))
    if (process.platform === 'win32') {
      const script = join(dir, 'editor.cmd')
      writeFileSync(script, `@echo off\r\npowershell -NoProfile -Command "Set-Content -Path '%1' -Value '${replacement}' -NoNewline -Encoding ascii"\r\n`)
      return { script, dir }
    }
    const script = join(dir, 'editor.sh')
    writeFileSync(script, `#!/bin/sh\nprintf '%s' "${replacement}" > "$1"\n`, { mode: 0o755 })
    return { script, dir }
  }

  it('Ctrl+O 触发编辑器，保存退出后内容回填输入行，raw-mode 恢复', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('edit-1')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdin = makeStdin()
    const { script } = makeEditorScript('EDITED')
    const stdout = makeStdout()

    const app = new TuiApp({ ctx, stdout, stdin, editorCommand: script, editorKey: 'ctrl_o' })
    await app.attach()

    stdin.emit('data', 'hello')
    stdin.emit('data', '\x0f') // Ctrl+O = 0x0f（editorKey 显式回退到 ctrl_o——缺省已改为 ctrl_e）
    stdin.emit('data', '\r')   // Enter 提交回填后的内容
    await new Promise(resolve => setImmediate(resolve))

    expect(agent.followup).toHaveBeenCalledTimes(1)
    const submittedTexts = allCallTexts(agent.followup)
    expect(submittedTexts).toEqual(['EDITED'])
    // raw-mode 恢复：spawn 前退出（false）、spawn 后恢复（true）
    expect(stdin.setRawMode).toHaveBeenCalledWith(false)
    expect(stdin.setRawMode).toHaveBeenCalledWith(true)
    await app.dispose()
  })

  it('编辑器失败（命令不存在）不回填，原内容保留', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('edit-2')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdin = makeStdin()
    const stdout = makeStdout()

    const app = new TuiApp({ ctx, stdout, stdin, editorCommand: '/nonexistent/editor-xyz', editorKey: 'ctrl_o' })
    await app.attach()

    stdin.emit('data', '保留原文')
    stdin.emit('data', '\x0f') // Ctrl+O → 编辑器不存在 → null
    stdin.emit('data', '\r')
    await new Promise(resolve => setImmediate(resolve))

    expect(agent.followup).toHaveBeenCalledTimes(1)
    const keptTexts = allCallTexts(agent.followup)
    expect(keptTexts).toEqual(['保留原文'])
    // P1-1：失败回显（含实际命令与原因）
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('外部编辑器启动失败')
    expect(written).toContain('/nonexistent/editor-xyz')
    expect(written).toContain('ENOENT')
    await app.dispose()
  })
})

describe('TuiApp Phase 6.5 Vim 模式', () => {
  it('vimEnabled 时 ESC 进入 normal，模式标签渲染', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('vim-1')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdin = makeStdin()
    const stdout = makeStdout()

    const app = new TuiApp({ ctx, stdout, stdin, vimEnabled: true })
    await app.attach()

    stdin.emit('data', 'abc')
    stdin.emit('data', '\x1b') // ESC → normal（孤立 ESC 需 escapeTimeoutMs 派发）
    await new Promise(resolve => setTimeout(resolve, 120))

    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('-- NORMAL --')
    // normal 态下 i 回 insert，标签消失
    stdout.write.mockClear()
    stdin.emit('data', 'i')
    await new Promise(resolve => setImmediate(resolve))
    const after = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(after).not.toContain('-- NORMAL --')
    await app.dispose()
  })

  it('vimEnabled 缺省 false：ESC 不切模式，无模式标签', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('vim-2')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdin = makeStdin()
    const stdout = makeStdout()

    const app = new TuiApp({ ctx, stdout, stdin })
    await app.attach()

    stdin.emit('data', 'abc')
    stdin.emit('data', '\x1b')
    await new Promise(resolve => setTimeout(resolve, 120))

    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).not.toContain('-- NORMAL --')
    await app.dispose()
  })

  it('vim 字符/行视觉模式标签渲染（v → VISUAL，V → VISUAL LINE）', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('vim-3')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdin = makeStdin()
    const stdout = makeStdout()

    const app = new TuiApp({ ctx, stdout, stdin, vimEnabled: true })
    await app.attach()

    stdin.emit('data', '\x1b') // ESC → normal
    await new Promise(resolve => setTimeout(resolve, 120))
    stdout.write.mockClear()

    stdin.emit('data', 'v') // 字符视觉模式
    await new Promise(resolve => setImmediate(resolve))
    let written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('-- VISUAL --')
    expect(written).not.toContain('-- VISUAL LINE --')

    stdout.write.mockClear()
    stdin.emit('data', '\x1b') // ESC 回 normal（visual 态 ESC → collapse + normal）
    await new Promise(resolve => setTimeout(resolve, 120))
    stdin.emit('data', 'V') // normal 态 V → 行视觉模式
    await new Promise(resolve => setImmediate(resolve))
    written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('-- VISUAL LINE --')
    await app.dispose()
  })
})

describe('TuiApp Phase 5.3 glance 装配', () => {
  it('attach 后 glance 状态行渲染（agent 未注册 → ✗ 已停止）', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('glance-1')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdout = makeStdout()

    const app = new TuiApp({ ctx, stdout, stdin: makeStdin() })
    await app.attach()

    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    // mock 环境 agent 未注册（trackAgent 种子 live=false）→ 回退派生 ✗ 已停止；
    // glance metrics 行含 model（agentDefaultModel mock 'mock'）
    expect(written).toContain('✗ 已停止')
    expect(written).toContain('mock')
    await app.dispose()
  })

  it('glance 错误行上屏（liveAgent lastError 经 agent/error 事件）', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('glance-2')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdout = makeStdout()

    const app = new TuiApp({ ctx, stdout, stdin: makeStdin(), theme: 'paper' })
    await app.attach()

    // trackAgent 在 mountSession 时经 ctx.on('agent/error') 注册了处理器。
    const onError = ctx.on.mock.calls.find(call => call[0] === 'agent/error')?.[1] as
      | ((payload: { agent: { id: SessionId }; turn: number; step: number; error: unknown }) => void)
      | undefined
    if (onError === undefined) throw new Error('agent/error handler not registered')
    const id = app.sessionId
    if (id === null) throw new Error('no active session')
    onError({ agent: { id }, turn: 1, step: 0, error: new Error('boom glance') })
    // handleSubmit 顺带触发 renderLive（渲染 read glance.current()）
    app.handleSubmit('retry')
    await new Promise(resolve => setImmediate(resolve))

    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('boom glance')
    await app.dispose()
  })
})

describe('TuiApp glance 数据接线（usage/effort/contextWindow）', () => {
  async function setupApp(agentId: string): Promise<{
    ctx: ReturnType<typeof makeCtx>
    agent: ReturnType<typeof makeAgent>
    stdout: ReturnType<typeof makeStdout>
    app: TuiApp
  }> {
    const ctx = makeCtx()
    const agent = makeAgent(agentId)
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin: makeStdin() })
    await app.attach()
    return { ctx, agent, stdout, app }
  }

  it('assistant/message usage 折叠 → glance 行含缓存命中率/上下文占比/tokens 段', async () => {
    const { ctx, stdout, app } = await setupApp('glance-usage')
    const bus = sessionEventBus(ctx)
    const id = app.sessionId
    if (id === null) throw new Error('no active session')
    bus(id, { seq: 1, time: 1, type: 'request/context', data: { provider: 'mock', model: 'mock', contextWindow: 128000 } })
    bus(id, {
      seq: 2, time: 2, type: 'assistant/message',
      data: {
        turn: 1, step: 0,
        message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
        usage: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 4000 },
      },
    })
    // handleSubmit 顺带触发 renderLive（glance 行重渲染）
    app.handleSubmit('hi')
    await new Promise(resolve => setImmediate(resolve))

    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('缓存 80%') // 4000 / (1000+4000) = 0.8
    expect(written).toContain('上下文 4%') // 5000 / 128000 ≈ 3.9%
    expect(written).toContain('◧ 5k/128k')
    await app.dispose()
  })

  it('request/header 事件更新 effort 段（requestHeader 兜底 currentSelection）', async () => {
    const { ctx, stdout, app } = await setupApp('glance-effort')
    // 挂载时 requestHeader 未记录 → 落 currentSelection（mock 无 reasoningEffort → null）
    const bus = sessionEventBus(ctx)
    const id = app.sessionId
    if (id === null) throw new Error('no active session')
    bus(id, {
      seq: 1, time: 1, type: 'request/header',
      data: { header: { config: { provider: 'mock', model: 'mock', reasoningEffort: 'max' } }, reason: 'initial' },
    })
    app.handleSubmit('hi')
    await new Promise(resolve => setImmediate(resolve))

    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('◎max')
    await app.dispose()
  })

  it('无 usage/无 contextWindow/无 effort → 对应段不渲染（降级不破版）', async () => {
    const { stdout, app } = await setupApp('glance-bare')
    app.handleSubmit('hi')
    await new Promise(resolve => setImmediate(resolve))

    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).not.toContain('缓存')
    expect(written).not.toContain('上下文')
    expect(written).not.toContain('◧')
    expect(written).not.toContain('effort:')
    await app.dispose()
  })

  it('切会话后 usage/contextWindow 复位（detachProjections 清理）', async () => {
    const { ctx, stdout, app } = await setupApp('glance-reset')
    const bus = sessionEventBus(ctx)
    const id = app.sessionId
    if (id === null) throw new Error('no active session')
    bus(id, { seq: 1, time: 1, type: 'request/context', data: { provider: 'mock', model: 'mock', contextWindow: 128000 } })
    bus(id, {
      seq: 2, time: 2, type: 'assistant/message',
      data: {
        turn: 1, step: 0,
        message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
        usage: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 4000 },
      },
    })
    app.handleSubmit('hi')
    await new Promise(resolve => setImmediate(resolve))
    const before = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(before).toContain('缓存 80%')

    // 切到新会话（switchSession 走 detachProjections）→ 折叠字段复位。
    // 先清空 write 历史：after 只统计切换后的输出（第一次 handleSubmit 的
    // 缓存段属于旧会话，不在复位断言范围内）。
    stdout.write.mockClear()
    const second = makeAgent('glance-reset-2')
    ctx.agents.get.mockReturnValue(second)
    ctx.sessions.get.mockReturnValue(second.session)
    await app.switchSession(second.session.id)
    app.handleSubmit('hi')
    await new Promise(resolve => setImmediate(resolve))
    const after = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(after).not.toContain('缓存 80%')
    await app.dispose()
  })
})

describe('TuiApp Phase 9a @mention 摘要展开装配', () => {
  it('handleSubmit 展开 @文件 → followup 收到摘要而非裸路径', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('mention-1')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdout = makeStdout()

    const app = new TuiApp({ ctx, stdout, stdin: makeStdin() })
    await app.newSession()
    // process.cwd() 是仓库根：用仓库内真实文件（mention-parser.ts）验证展开
    app.handleSubmit('查看 @packages/tui/tui/src/mention-parser.ts')
    await new Promise(resolve => setImmediate(resolve))

    expect(agent.followup).toHaveBeenCalledTimes(1)
    const text = firstCallText(agent.followup)
    expect(text).toContain('@packages/tui/tui/src/mention-parser.ts')
    expect(text).toContain('mention-parser — @路径展开解析器')
    // 用户消息渲染也含展开内容
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('mention-parser — @路径展开解析器')
    await app.dispose()
  })

  it('@不存在的文件 → 降级为引用名（followup 原样）', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('mention-2')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)

    const app = new TuiApp({ ctx, stdout: makeStdout(), stdin: makeStdin() })
    await app.newSession()
    app.handleSubmit('查看 @no-such-file-xyz.md')
    await new Promise(resolve => setImmediate(resolve))

    const text = firstCallText(agent.followup)
    expect(text).toBe('查看 @no-such-file-xyz.md')
    await app.dispose()
  })
})

describe('TuiApp Phase 9b + 1.1 欢迎页会话恢复入口', () => {
  it('存在其他可恢复会话 → 编号列表可见（标题 · 年龄 · cwd 摘要）', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('restore-1')
    ctx.agentDefaultModel.currentSelection.mockReturnValue({
      provider: 'default-provider',
      model: 'default-model',
      reasoningEffort: 'low',
    })
    agent.session.requestHeader.mockReturnValue({
      config: {
        provider: 'restored-provider',
        model: 'restored-model',
        reasoningEffort: 'high',
      },
    })
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    // live store 已有旧会话（非当前），registry 有 live agent（兜底分支），
    // persistence 未配置 → listSessions 走 ctx.sessions.list() 取 .header
    const oldHeader = {
      id: SessionId('session-old-1'),
      version: 0,
      createdAt: Date.now() - 3_600_000,
      cwd: undefined,
      parentSession: undefined,
    }
    ctx.sessions.list.mockReturnValue([
      { id: oldHeader.id, header: oldHeader },
      { id: SessionId('session-old-2'), header: { ...oldHeader, id: SessionId('session-old-2') } },
    ])
    // attach 的 target 取 list()[0] = session-old-1 → switchSession → registry 兜底
    ctx.agents.get.mockReturnValue(agent)
    const stdout = makeStdout()

    const app = new TuiApp({ ctx, stdout, stdin: makeStdin() })
    await app.attach()

    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('DeepSeek')
    expect(written).toContain('Tianshu Harness')
    expect(written).toContain('restored-provider/restored-model')
    expect(written).toContain('Model restored-model · Effort high')
    expect(written).not.toContain('default-provider/default-model')
    expect(written).not.toContain('Model default-model · Effort low')
    expect(written).not.toContain('Tips')
    // 1.1：编号列表（[N] + 标题「新对话」占位 + 8 位短 id；裸 UUID 不出现）。
    expect(written).toContain('[1]')
    expect(written).toContain('新对话')
    expect(written).not.toContain('session-old-2')
    expect(written).not.toContain('session-old-1')
    expect(written).toContain('[1-9] 恢复')
    await app.dispose()
  })

  it('无可恢复会话 → 不渲染恢复区', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('restore-2')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    ctx.sessions.list.mockReturnValue([]) // 无任何既有会话
    const stdout = makeStdout()

    const app = new TuiApp({ ctx, stdout, stdin: makeStdin() })
    await app.attach()

    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).not.toContain('恢复会话')
    expect(written).not.toContain('小时前') // 无摘要
    expect(written).not.toContain('[1]') // 无编号列表
    expect(written).not.toContain('[1-9] 恢复')
    await app.dispose()
  })

  it('欢迎阶段数字键 → 恢复对应编号会话（switchSession）', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('restore-3')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    ctx.agents.get.mockReturnValue(agent) // registry 兜底分支（不 resume）
    const oldHeader = {
      id: SessionId('session-old-a'),
      version: 0,
      createdAt: Date.now() - 3_600_000,
      cwd: undefined,
      parentSession: undefined,
    }
    ctx.sessions.list.mockReturnValue([
      { id: oldHeader.id, header: oldHeader },
      { id: SessionId('session-old-b'), header: { ...oldHeader, id: SessionId('session-old-b') } },
    ])
    const stdin = makeStdin()
    const stdout = makeStdout()

    const app = new TuiApp({ ctx, stdout, stdin })
    await app.attach()
    // 欢迎列表第 1 行 = session-old-b（others[0]，排除当前 session-old-a）
    stdin.emit('data', '1')
    await new Promise(resolve => setImmediate(resolve))
    expect(app.sessionId).toBe(SessionId('session-old-b'))
    await app.dispose()
  })

  it('首次输入字符后欢迎阶段结束 → 数字键回到输入行（不劫持打字）', async () => {

    const ctx = makeCtx()
    const agent = makeAgent('restore-4')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    ctx.agents.get.mockReturnValue(agent)
    const oldHeader = {
      id: SessionId('session-old-c'),
      version: 0,
      createdAt: Date.now() - 3_600_000,
      cwd: undefined,
      parentSession: undefined,
    }
    ctx.sessions.list.mockReturnValue([
      { id: oldHeader.id, header: oldHeader },
      { id: SessionId('session-old-d'), header: { ...oldHeader, id: SessionId('session-old-d') } },
    ])
    const stdin = makeStdin()
    const stdout = makeStdout()

    const app = new TuiApp({ ctx, stdout, stdin })
    await app.attach()
    // 先输入一个普通字符（结束欢迎阶段），再按数字键 → 输入行接收
    stdin.emit('data', 'x')
    await new Promise(resolve => setImmediate(resolve))
    const before = app.sessionId
    stdin.emit('data', '1')
    await new Promise(resolve => setImmediate(resolve))
    expect(app.sessionId).toBe(before) // 未切换会话
    await app.dispose()
  })
})

describe('TuiApp welcome intro 一次性 settle 生命周期', () => {
  const previousAmbiguousWidth = process.env.RIVET_AMBIGUOUS_WIDTH

  type WelcomeStdout = ReturnType<typeof makeStdout> & {
    emitResize(): void
  }

  beforeEach(() => {
    process.env.RIVET_AMBIGUOUS_WIDTH = 'narrow'
  })

  afterEach(() => {
    vi.useRealTimers()
    if (previousAmbiguousWidth === undefined) delete process.env.RIVET_AMBIGUOUS_WIDTH
    else process.env.RIVET_AMBIGUOUS_WIDTH = previousAmbiguousWidth
  })

  function makeColorTtyStdout(): WelcomeStdout {
    const events = new EventEmitter()
    const stdout = Object.assign(makeStdout(), {
      emitResize: () => { events.emit('resize') },
    })
    Object.assign(stdout, {
      isTTY: true,
      getColorDepth: vi.fn(() => 24),
      on: (...args: Parameters<EventEmitter['on']>) => {
        events.on(...args)
        return stdout
      },
      removeListener: (...args: Parameters<EventEmitter['removeListener']>) => {
        events.removeListener(...args)
        return stdout
      },
      listenerCount: (...args: Parameters<EventEmitter['listenerCount']>) => (
        events.listenerCount(...args)
      ),
    })
    return stdout
  }

  interface NormalBufferCellSnapshot {
    chars: string
    width: number
    fg: { mode: number; color: number }
    bg: { mode: number; color: number }
    style: {
      bold: number
      italic: number
      dim: number
      underline: number
      blink: number
      inverse: number
      invisible: number
      strikethrough: number
      overline: number
    }
  }

  interface NormalBufferSnapshot {
    type: 'normal'
    cols: number
    rows: number
    modes: TerminalModesSnapshot
    length: number
    baseY: number
    viewportY: number
    cursorX: number
    cursorY: number
    lines: BufferLineSnapshot[]
  }

  interface BufferLineSnapshot {
    isWrapped: boolean
    text: string
    cells: NormalBufferCellSnapshot[]
  }

  interface ViewportBufferSnapshot {
    type: 'normal'
    cols: number
    rows: number
    modes: TerminalModesSnapshot
    cursorX: number
    cursorY: number
    lines: BufferLineSnapshot[]
  }

  interface TerminalModesSnapshot {
    applicationCursorKeysMode: boolean
    applicationKeypadMode: boolean
    bracketedPasteMode: boolean
    insertMode: boolean
    mouseTrackingMode: 'none' | 'x10' | 'vt200' | 'drag' | 'any'
    originMode: boolean
    reverseWraparoundMode: boolean
    sendFocusMode: boolean
    synchronizedOutputMode: boolean
    wraparoundMode: boolean
  }

  interface HeadlessTerminalHarness {
    stdout: WelcomeStdout
    drain(): Promise<void>
    pendingWrites(): number
    resize(columns: number, rows: number): void
    visibleTextLines(): string[]
    normalBufferSnapshot(): NormalBufferSnapshot
    normalScrollbackPrefixSnapshot(): BufferLineSnapshot[]
    normalViewportSnapshot(): ViewportBufferSnapshot
    dispose(): void
  }

  /**
   * Truecolor TTY whose writes are interpreted by xterm's production parser.
   * drain() waits until every queued ANSI write has reached the terminal buffer.
   */
  function makeHeadlessTerminal(
    columns = 100,
    rows = 30,
  ): HeadlessTerminalHarness {
    const terminal = new Terminal({
      allowProposedApi: true,
      cols: columns,
      convertEol: true,
      rows,
      scrollback: 1_000,
    })
    let pendingWrites = 0
    const drainWaiters: Array<() => void> = []
    const write = vi.fn((chunk: string | Uint8Array): boolean => {
      pendingWrites++
      terminal.write(chunk, () => {
        pendingWrites--
        if (pendingWrites !== 0) return
        for (const resolve of drainWaiters.splice(0)) resolve()
      })
      return true
    })
    const stdout = makeColorTtyStdout()
    stdout.columns = columns
    stdout.rows = rows
    stdout.write = write
    const snapshotNormalLine = (y: number): BufferLineSnapshot => {
      const line = terminal.buffer.normal.getLine(y)
      if (line === undefined) throw new Error(`xterm normal buffer line ${y} is missing`)
      return {
        isWrapped: line.isWrapped,
        text: line.translateToString(false),
        cells: Array.from({ length: line.length }, (_, x) => {
          const cell = line.getCell(x)
          if (cell === undefined) {
            throw new Error(`xterm normal buffer cell ${x},${y} is missing`)
          }
          return {
            chars: cell.getChars(),
            width: cell.getWidth(),
            fg: {
              mode: cell.getFgColorMode(),
              color: cell.getFgColor(),
            },
            bg: {
              mode: cell.getBgColorMode(),
              color: cell.getBgColor(),
            },
            style: {
              bold: cell.isBold(),
              italic: cell.isItalic(),
              dim: cell.isDim(),
              underline: cell.isUnderline(),
              blink: cell.isBlink(),
              inverse: cell.isInverse(),
              invisible: cell.isInvisible(),
              strikethrough: cell.isStrikethrough(),
              overline: cell.isOverline(),
            },
          }
        }),
      }
    }
    const snapshotModes = (): TerminalModesSnapshot => ({
      applicationCursorKeysMode: terminal.modes.applicationCursorKeysMode,
      applicationKeypadMode: terminal.modes.applicationKeypadMode,
      bracketedPasteMode: terminal.modes.bracketedPasteMode,
      insertMode: terminal.modes.insertMode,
      mouseTrackingMode: terminal.modes.mouseTrackingMode,
      originMode: terminal.modes.originMode,
      reverseWraparoundMode: terminal.modes.reverseWraparoundMode,
      sendFocusMode: terminal.modes.sendFocusMode,
      synchronizedOutputMode: terminal.modes.synchronizedOutputMode,
      wraparoundMode: terminal.modes.wraparoundMode,
    })

    return {
      stdout,
      drain: async () => {
        if (pendingWrites > 0) {
          await new Promise<void>(resolve => drainWaiters.push(resolve))
        }
        await Promise.resolve()
      },
      pendingWrites: () => pendingWrites,
      resize: (nextColumns, nextRows) => {
        stdout.columns = nextColumns
        stdout.rows = nextRows
        terminal.resize(nextColumns, nextRows)
        stdout.emitResize()
      },
      visibleTextLines: () => {
        const buffer = terminal.buffer.active
        return Array.from({ length: terminal.rows }, (_, offset) => (
          buffer.getLine(buffer.viewportY + offset)?.translateToString(true) ?? ''
        ))
      },
      normalBufferSnapshot: () => {
        const buffer = terminal.buffer.normal
        if (buffer.type !== 'normal') throw new Error(`expected normal buffer, got ${buffer.type}`)
        return {
          type: buffer.type,
          cols: terminal.cols,
          rows: terminal.rows,
          modes: snapshotModes(),
          length: buffer.length,
          baseY: buffer.baseY,
          viewportY: buffer.viewportY,
          cursorX: buffer.cursorX,
          cursorY: buffer.cursorY,
          lines: Array.from({ length: buffer.length }, (_, y) => snapshotNormalLine(y)),
        }
      },
      normalScrollbackPrefixSnapshot: () => {
        const buffer = terminal.buffer.normal
        return Array.from({ length: buffer.baseY }, (_, y) => snapshotNormalLine(y))
      },
      normalViewportSnapshot: () => {
        const buffer = terminal.buffer.normal
        if (buffer.type !== 'normal') throw new Error(`expected normal buffer, got ${buffer.type}`)
        return {
          type: buffer.type,
          cols: terminal.cols,
          rows: terminal.rows,
          modes: snapshotModes(),
          cursorX: buffer.cursorX,
          cursorY: buffer.cursorY,
          lines: Array.from(
            { length: terminal.rows },
            (_, offset) => snapshotNormalLine(buffer.viewportY + offset),
          ),
        }
      },
      dispose: () => { terminal.dispose() },
    }
  }

  /**
   * Flushes xterm's zero-delay parser task without reaching the 120ms app tick.
   * Sinon schedules zero-delay timers created inside another timer at +1ms.
   */
  async function flushHeadlessTerminal(harness: HeadlessTerminalHarness): Promise<void> {
    await vi.advanceTimersByTimeAsync(1)
    if (harness.pendingWrites() > 0) {
      throw new Error(`xterm parser left ${harness.pendingWrites()} writes pending`)
    }
    await harness.drain()
  }

  async function cleanupHeadlessTerminal(
    app: TuiApp | undefined,
    harness: HeadlessTerminalHarness,
  ): Promise<void> {
    try {
      if (app !== undefined) await app.dispose()
    } finally {
      try {
        await flushHeadlessTerminal(harness)
      } finally {
        harness.dispose()
      }
    }
  }

  async function cleanupHeadlessPair(
    first: { app: TuiApp | undefined; terminal: HeadlessTerminalHarness },
    second: { app: TuiApp | undefined; terminal: HeadlessTerminalHarness },
  ): Promise<void> {
    try {
      await cleanupHeadlessTerminal(first.app, first.terminal)
    } finally {
      await cleanupHeadlessTerminal(second.app, second.terminal)
    }
  }

  async function bootWelcome(options: {
    welcomeAnimation?: 'auto' | 'off'
    inputTty?: boolean
    cmdline?: string[]
    restorable?: boolean
    stdout?: WelcomeStdout
    columns?: number
    rows?: number
  } = {}) {
    const ctx = makeCtx()
    const agent = makeAgent('welcome-current')
    // Keep committed top-bar geometry stable so buffer comparisons isolate the welcome surface.
    Object.assign(agent.session, {
      header: { ...agent.session.header, cwd: '/workspace' },
    })
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    if (options.restorable === true) {
      const current = {
        id: SessionId('session-welcome-current'),
        header: {
          id: SessionId('session-welcome-current'),
          version: 0,
          createdAt: 2,
        },
        events: [],
      }
      const other = {
        id: SessionId('session-welcome-other'),
        header: {
          id: SessionId('session-welcome-other'),
          version: 0,
          createdAt: 1,
        },
        events: [],
      }
      ctx.sessions.list.mockReturnValue([current, other])
      ctx.agents.get.mockReturnValue(agent)
    }
    const credentials = {
      describe: vi.fn(async () => ({ configured: false, writable: true })),
    }
    ctx.reflect.get.mockImplementation((name: string) => {
      if (name === 'credentials') return credentials
      if (name === 'cmdlineArgs' && options.cmdline !== undefined) {
        return { get: () => options.cmdline }
      }
      return undefined
    })
    const stdin = makeStdin()
    stdin.isTTY = options.inputTty ?? false
    const stdout = options.stdout ?? makeColorTtyStdout()
    if (options.columns !== undefined) stdout.columns = options.columns
    if (options.rows !== undefined) stdout.rows = options.rows
    const app = new TuiApp({
      ctx,
      stdout,
      stdin,
      theme: 'graphite',
      welcomeAnimation: options.welcomeAnimation ?? 'auto',
    })
    try {
      await app.attach()
    } catch (attachError) {
      try {
        await app.dispose()
      } catch {
        // Preserve the attach failure; partial-attach teardown is best-effort.
      }
      throw attachError
    }
    return { app, ctx, agent, stdin, stdout }
  }

  function batchText(
    spy: MockInstance<CommitEngine['writeBatch']>,
    index = -1,
  ): string {
    const call = spy.mock.calls.at(index)
    const entries = call?.[0]
    return entries?.map(entry => entry.text).join('\n') ?? ''
  }

  async function commitPreparedWelcome(options: {
    selection: { provider: string; model: string; reasoningEffort?: string }
    resolveModelInfo: (provider: string, model: string, signal?: AbortSignal) => Promise<{
      reasoning?: { defaultEffort?: string }
    }>
  }): Promise<{ app: TuiApp; writeBatch: MockInstance<CommitEngine['writeBatch']> }> {
    const ctx = makeCtx()
    ctx.agentDefaultModel.currentSelection.mockReturnValue(options.selection)
    ctx.get.mockImplementation((name: string) => (
      name === 'llm' ? { resolveModelInfo: options.resolveModelInfo } : undefined
    ))
    const writeBatch = vi.spyOn(CommitEngine.prototype, 'writeBatch')
    const app = new TuiApp({
      ctx,
      stdout: makeColorTtyStdout(),
      stdin: makeStdin(),
      theme: 'graphite',
      welcomeAnimation: 'off',
    })
    const welcome = app as unknown as {
      prepareWelcome(): Promise<void>
      settleWelcome(reason: 'skipped'): boolean
    }
    await welcome.prepareWelcome()
    expect(welcome.settleWelcome('skipped')).toBe(true)
    return { app, writeBatch }
  }

  function createPendingWelcomeAttach(options: {
    selection: { provider: string; model: string; reasoningEffort?: string }
    resolveModelInfo: (provider: string, model: string, signal?: AbortSignal) => Promise<{
      reasoning?: { defaultEffort?: string }
    }>
    welcomeAnimation?: 'auto' | 'off'
  }): {
    app: TuiApp
    agent: ReturnType<typeof makeAgent>
    stdin: ReturnType<typeof makeStdin>
    stdout: WelcomeStdout
    writeBatch: MockInstance<CommitEngine['writeBatch']>
  } {
    const ctx = makeCtx()
    const agent = makeAgent('welcome-pending')
    ctx.agentDefaultModel.currentSelection.mockReturnValue(options.selection)
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    ctx.get.mockImplementation((name: string) => (
      name === 'llm' ? { resolveModelInfo: options.resolveModelInfo } : undefined
    ))
    const writeBatch = vi.spyOn(CommitEngine.prototype, 'writeBatch')
    const stdout = makeColorTtyStdout()
    const stdin = makeStdin()
    const app = new TuiApp({
      ctx,
      stdout,
      stdin,
      theme: 'graphite',
      welcomeAnimation: options.welcomeAnimation ?? 'off',
    })
    return { app, agent, stdin, stdout, writeBatch }
  }

  it('bootWelcome attach 失败时清理 app 且保留原始错误', async () => {
    const attachError = new Error('attach failed')
    vi.spyOn(TuiApp.prototype, 'attach').mockRejectedValueOnce(attachError)
    // oxlint-disable-next-line typescript/unbound-method -- captured before the spy; rebound to the intercepted instance below
    const originalDispose = TuiApp.prototype.dispose
    const dispose = vi.spyOn(TuiApp.prototype, 'dispose')
      .mockImplementationOnce(async function (this: TuiApp) {
        const boundDispose = originalDispose.bind(this)
        await boundDispose()
        throw new Error('dispose failed')
      })

    await expect(bootWelcome()).rejects.toBe(attachError)
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('off 立即用一个 final batch 提交静态欢迎且不发布动画 hero', async () => {
    const writeBatch = vi.spyOn(CommitEngine.prototype, 'writeBatch')
    const render = vi.spyOn(LiveEngine.prototype, 'render')
    const { app } = await bootWelcome({ welcomeAnimation: 'off' })

    expect(writeBatch).toHaveBeenCalledTimes(2)
    expect(batchText(writeBatch)).toContain('Tianshu Harness')
    expect(batchText(writeBatch)).toContain('Tip:')
    expect(render.mock.calls.some(call => (
      (call[0] as readonly { text: string }[]).some(line => line.text.includes('Tianshu Harness'))
    ))).toBe(false)

    await app.dispose()
  })

  it('欢迎终态显示目录解析出的默认推理档位', async () => {
    const resolveModelInfo = vi.fn(async () => ({
      reasoning: { defaultEffort: 'max' },
    }))
    const { app, writeBatch } = await commitPreparedWelcome({
      selection: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      resolveModelInfo,
    })

    expect(resolveModelInfo).toHaveBeenCalledOnce()
    expect(resolveModelInfo).toHaveBeenCalledWith(
      'deepseek-official',
      'deepseek-v4-flash',
      expect.any(AbortSignal),
    )
    expect(batchText(writeBatch)).toContain('Model deepseek-v4-flash · Effort max')
    await app.dispose()
  })

  it('欢迎终态优先显示显式推理档位且不查询目录', async () => {
    const resolveModelInfo = vi.fn(async () => ({
      reasoning: { defaultEffort: 'max' },
    }))
    const { app, writeBatch } = await commitPreparedWelcome({
      selection: {
        provider: 'deepseek-official',
        model: 'deepseek-v4-flash',
        reasoningEffort: 'high',
      },
      resolveModelInfo,
    })

    expect(resolveModelInfo).not.toHaveBeenCalled()
    expect(batchText(writeBatch)).toContain('Model deepseek-v4-flash · Effort high')
    await app.dispose()
  })

  it('欢迎目录查询忽略 signal 且永不 settle 时在 UX 边界降级继续 attach', async () => {
    vi.useFakeTimers()
    let lookupSignal: AbortSignal | undefined
    const resolveModelInfo = vi.fn((
      _provider: string,
      _model: string,
      signal?: AbortSignal,
    ) => {
      lookupSignal = signal
      return new Promise<never>(() => {})
    })
    const { app, writeBatch } = createPendingWelcomeAttach({
      selection: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      resolveModelInfo,
    })

    const attaching = app.attach()
    await vi.waitFor(() => { expect(resolveModelInfo).toHaveBeenCalledOnce() })
    await vi.advanceTimersByTimeAsync(1_001)
    await attaching

    expect(lookupSignal?.aborted).toBe(true)
    expect(batchText(writeBatch)).toContain('Model deepseek-v4-flash · Effort auto')
    await app.dispose()
  })

  it('欢迎目录查询 pending 期间 dispose 会 abort 并阻止迟到 welcome 写屏', async () => {
    vi.useFakeTimers()
    let lookupSignal: AbortSignal | undefined
    let completeLookup: ((info: {
      reasoning?: { defaultEffort?: string }
    }) => void) | undefined
    const resolveModelInfo = vi.fn((
      _provider: string,
      _model: string,
      signal?: AbortSignal,
    ) => {
      lookupSignal = signal
      return new Promise<{ reasoning?: { defaultEffort?: string } }>((resolve) => {
        completeLookup = resolve
      })
    })
    const render = vi.spyOn(LiveEngine.prototype, 'render')
    const { app, stdout, writeBatch } = createPendingWelcomeAttach({
      selection: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      resolveModelInfo,
    })

    const attaching = app.attach()
    await vi.waitFor(() => { expect(resolveModelInfo).toHaveBeenCalledOnce() })
    await app.dispose()
    await attaching

    expect(lookupSignal?.aborted).toBe(true)
    const committedAfterDispose = writeBatch.mock.calls.length
    const stdoutWritesAfterDispose = stdout.write.mock.calls.length
    const liveRendersAfterDispose = render.mock.calls.length
    if (completeLookup === undefined) throw new Error('model-info lookup did not expose completion')
    completeLookup({ reasoning: { defaultEffort: 'max' } })
    await Promise.resolve()
    await vi.runAllTimersAsync()

    expect(writeBatch).toHaveBeenCalledTimes(committedAfterDispose)
    expect(stdout.write).toHaveBeenCalledTimes(stdoutWritesAfterDispose)
    expect(render).toHaveBeenCalledTimes(liveRendersAfterDispose)
  })

  it('欢迎准备期间的首个按键会先结算 final，再原样进入输入路由', async () => {
    let completeLookup: ((info: { reasoning?: { defaultEffort?: string } }) => void) | undefined
    const resolveModelInfo = vi.fn(() => (
      new Promise<{ reasoning?: { defaultEffort?: string } }>((resolve) => {
        completeLookup = resolve
      })
    ))
    const { app, agent, stdin, writeBatch } = createPendingWelcomeAttach({
      selection: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      resolveModelInfo,
      welcomeAnimation: 'auto',
    })

    const attaching = app.attach()
    await vi.waitFor(() => { expect(resolveModelInfo).toHaveBeenCalledOnce() })
    stdin.emit('data', 'x')
    if (completeLookup === undefined) throw new Error('model-info lookup did not expose completion')
    completeLookup({ reasoning: { defaultEffort: 'max' } })
    await attaching

    expect(writeBatch).toHaveBeenCalledTimes(2)
    expect(batchText(writeBatch)).toContain('Tip:')
    stdin.emit('data', '\r')
    await vi.waitFor(() => { expect(agent.followup).toHaveBeenCalledOnce() })
    expect(firstCallText(agent.followup)).toBe('x')
    await app.dispose()
  })

  it('欢迎准备期间的 bracketed paste 会在 final 后原样重放', async () => {
    let completeLookup: ((info: { reasoning?: { defaultEffort?: string } }) => void) | undefined
    const resolveModelInfo = vi.fn(() => (
      new Promise<{ reasoning?: { defaultEffort?: string } }>((resolve) => {
        completeLookup = resolve
      })
    ))
    const { app, agent, stdin, writeBatch } = createPendingWelcomeAttach({
      selection: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      resolveModelInfo,
      welcomeAnimation: 'auto',
    })

    const attaching = app.attach()
    await vi.waitFor(() => { expect(resolveModelInfo).toHaveBeenCalledOnce() })
    stdin.emit('data', '\x1B[200~pasted while preparing\x1B[201~')
    if (completeLookup === undefined) throw new Error('model-info lookup did not expose completion')
    completeLookup({})
    await attaching

    expect(writeBatch).toHaveBeenCalledTimes(2)
    stdin.emit('data', '\r')
    await vi.waitFor(() => { expect(agent.followup).toHaveBeenCalledOnce() })
    expect(firstCallText(agent.followup)).toBe('pasted while preparing')
    await app.dispose()
  })

  it('欢迎准备期间的 resize 会按最新尺寸直接结算 compact final', async () => {
    vi.useFakeTimers()
    let completeLookup: ((info: { reasoning?: { defaultEffort?: string } }) => void) | undefined
    const resolveModelInfo = vi.fn(() => (
      new Promise<{ reasoning?: { defaultEffort?: string } }>((resolve) => {
        completeLookup = resolve
      })
    ))
    const { app, stdout, writeBatch } = createPendingWelcomeAttach({
      selection: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      resolveModelInfo,
      welcomeAnimation: 'auto',
    })

    const attaching = app.attach()
    await vi.waitFor(() => { expect(resolveModelInfo).toHaveBeenCalledOnce() })
    stdout.columns = 72
    stdout.rows = 17
    stdout.emitResize()
    await vi.advanceTimersByTimeAsync(150)
    if (completeLookup === undefined) throw new Error('model-info lookup did not expose completion')
    completeLookup({})
    await attaching

    expect(writeBatch).toHaveBeenCalledTimes(2)
    expect(batchText(writeBatch)).toContain('Oh My Tianshu')
    expect(batchText(writeBatch)).not.toContain('███')
    expect((app as unknown as {
      welcomeIntro: { settleReason: string | null }
    }).welcomeIntro.settleReason).toBe('resize')
    await app.dispose()
  })

  it('欢迎准备期间的后台 scrollback 会延迟到 canonical final 之后', async () => {
    let completeLookup: ((info: { reasoning?: { defaultEffort?: string } }) => void) | undefined
    const resolveModelInfo = vi.fn(() => (
      new Promise<{ reasoning?: { defaultEffort?: string } }>((resolve) => {
        completeLookup = resolve
      })
    ))
    const write = vi.spyOn(CommitEngine.prototype, 'write')
    const { app, writeBatch } = createPendingWelcomeAttach({
      selection: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      resolveModelInfo,
      welcomeAnimation: 'auto',
    })
    const inspect = app as unknown as {
      commitToScrollback(entry: { text: string; trailingNewline?: boolean }): void
    }

    const attaching = app.attach()
    await vi.waitFor(() => { expect(resolveModelInfo).toHaveBeenCalledOnce() })
    inspect.commitToScrollback({ text: 'early background entry', trailingNewline: true })
    expect(write).not.toHaveBeenCalled()
    if (completeLookup === undefined) throw new Error('model-info lookup did not expose completion')
    completeLookup({})
    await attaching

    const finalIndex = writeBatch.mock.calls.findIndex(([entries]) =>
      entries.some(entry => entry.text.includes('Tip:')))
    const messageIndex = write.mock.calls.findIndex(([entry]) =>
      entry.text === 'early background entry')
    expect(finalIndex).toBeGreaterThanOrEqual(0)
    expect(messageIndex).toBeGreaterThanOrEqual(0)
    expect(writeBatch.mock.invocationCallOrder[finalIndex]).toBeLessThan(
      write.mock.invocationCallOrder[messageIndex] ?? Number.POSITIVE_INFINITY,
    )
    await app.dispose()
  })

  it('欢迎准备期间的输入与 scrollback 按实际到达顺序重放', async () => {
    let completeLookup: ((info: { reasoning?: { defaultEffort?: string } }) => void) | undefined
    const resolveModelInfo = vi.fn(() => (
      new Promise<{ reasoning?: { defaultEffort?: string } }>((resolve) => {
        completeLookup = resolve
      })
    ))
    const write = vi.spyOn(CommitEngine.prototype, 'write')
    const { app, agent, stdin } = createPendingWelcomeAttach({
      selection: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      resolveModelInfo,
      welcomeAnimation: 'auto',
    })
    const inspect = app as unknown as {
      commitToScrollback(entry: { text: string; trailingNewline?: boolean }): void
    }

    const attaching = app.attach()
    await vi.waitFor(() => { expect(resolveModelInfo).toHaveBeenCalledOnce() })
    stdin.emit('data', 'first action')
    stdin.emit('data', '\r')
    inspect.commitToScrollback({ text: 'second action', trailingNewline: true })
    if (completeLookup === undefined) throw new Error('model-info lookup did not expose completion')
    completeLookup({})
    await attaching

    expect(agent.followup).toHaveBeenCalledOnce()
    const backgroundIndex = write.mock.calls.findIndex(([entry]) => entry.text === 'second action')
    expect(backgroundIndex).toBeGreaterThanOrEqual(0)
    expect(agent.followup.mock.invocationCallOrder[0]).toBeLessThan(
      write.mock.invocationCallOrder[backgroundIndex] ?? Number.POSITIVE_INFINITY,
    )
    await app.dispose()
  })

  it('auto 与 off 立即提交同一静态半块 hero，不含盲文', async () => {
    const writeBatch = vi.spyOn(CommitEngine.prototype, 'writeBatch')
    const render = vi.spyOn(LiveEngine.prototype, 'render')
    const { app } = await bootWelcome({ welcomeAnimation: 'auto' })
    const committed = batchText(writeBatch)

    expect(writeBatch).toHaveBeenCalledTimes(2)
    expect(committed).toContain('Oh My Tianshu')
    expect(committed).toMatch(/[▀▄]/)
    expect(committed).not.toMatch(/[\u2800-\u28FF]/)
    expect(committed).toContain('Tip:')
    expect(render.mock.calls.some(call => (
      (call[0] as readonly { text: string }[]).some(line => line.text.includes('Tianshu Harness'))
    ))).toBe(false)
    await app.dispose()
  })

  it('uses the 72-column fox once the terminal is at least 105×33', async () => {
    const writeBatch = vi.spyOn(CommitEngine.prototype, 'writeBatch')
    const { app } = await bootWelcome({
      welcomeAnimation: 'auto',
      columns: 105,
      rows: 33,
    })
    const committed = batchText(writeBatch)
    expect(committed).toContain('Oh My Tianshu')
    expect(committed.split('\n').filter(line => /[▀▄]/.test(line)).length).toBeGreaterThan(21)
    expect(committed.match(/[▀▄]/g)?.length).toBeGreaterThan(21)
    await app.dispose()
  })

  it('后台 scrollback commit 先结算 canonical welcome 再追加外部消息', async () => {
    vi.useFakeTimers()
    const writeBatch = vi.spyOn(CommitEngine.prototype, 'writeBatch')
    const write = vi.spyOn(CommitEngine.prototype, 'write')
    const { app } = await bootWelcome()
    const inspect = app as unknown as {
      commitToScrollback(entry: { text: string; trailingNewline?: boolean }): void
      welcomeIntro: {
        active: boolean
        settleReason: string | null
      } | null
    }

    inspect.commitToScrollback({
      text: 'background scrollback message',
      trailingNewline: true,
    })

    const finalIndex = writeBatch.mock.calls.findIndex(([entries]) => (
      entries.some(entry => entry.text.includes('Tianshu Harness'))
      && entries.some(entry => entry.text.includes('Tip:'))
    ))
    const messageIndex = write.mock.calls.findIndex(([entry]) => (
      entry.text === 'background scrollback message'
    ))
    expect(finalIndex).toBeGreaterThanOrEqual(0)
    expect(messageIndex).toBeGreaterThanOrEqual(0)
    expect(writeBatch.mock.invocationCallOrder[finalIndex]).toBeLessThan(
      write.mock.invocationCallOrder[messageIndex] ?? Number.POSITIVE_INFINITY,
    )
    expect(batchText(writeBatch, finalIndex)).toContain('Tianshu Harness')
    expect(batchText(writeBatch, finalIndex)).toContain('Tip:')
    expect(write.mock.calls[messageIndex]?.[0]).toEqual({
      text: 'background scrollback message',
      trailingNewline: true,
    })
    expect(inspect.welcomeIntro?.active).toBe(false)
    expect(inspect.welcomeIntro?.settleReason).toBe('skipped')

    const canonicalFinals = (): number => writeBatch.mock.calls.filter(([entries]) => (
      entries.some(entry => entry.text.includes('Tip:'))
    )).length
    expect(canonicalFinals()).toBe(1)
    await vi.advanceTimersByTimeAsync(3_241)
    expect(canonicalFinals()).toBe(1)
    await app.dispose()
  }, 15_000)

  it('xterm buffer：auto 终态等价于 off，且保留输入轨', async () => {
    vi.useFakeTimers()
    const random = vi.spyOn(Math, 'random').mockReturnValue(0)
    const render = vi.spyOn(LiveEngine.prototype, 'render')
    const animatedTerminal = makeHeadlessTerminal()
    const staticTerminal = makeHeadlessTerminal()
    let animatedApp: TuiApp | undefined
    let staticApp: TuiApp | undefined

    try {
      const animated = await bootWelcome({
        welcomeAnimation: 'auto',
        stdout: animatedTerminal.stdout,
      })
      animatedApp = animated.app
      await flushHeadlessTerminal(animatedTerminal)

      const introRenders = render.mock.calls.filter(([lines]) => (
        lines.some(line => line.text.includes('Tianshu Harness'))
      ))
      expect(introRenders).toHaveLength(0)

      const animatedSnapshot = animatedTerminal.normalBufferSnapshot()
      const animatedText = animatedTerminal.visibleTextLines().join('\n')
      expect(animatedText).toContain('Oh My Tianshu')
      expect(animatedText).toContain('Tianshu Harness')
      expect(animatedText).toContain('Tip:')
      expect(animatedText).toMatch(/[▀▄]/)
      expect(animatedText).not.toMatch(/[\u2800-\u28FF]/)
      expect(animatedText).toContain('╭')
      expect(animatedText).toContain('❯')

      await animatedApp.dispose()
      animatedApp = undefined
      await flushHeadlessTerminal(animatedTerminal)

      const staticWelcome = await bootWelcome({
        welcomeAnimation: 'off',
        stdout: staticTerminal.stdout,
      })
      staticApp = staticWelcome.app
      await flushHeadlessTerminal(staticTerminal)

      expect(random).toHaveBeenCalledTimes(2)
      expect(animatedSnapshot).toEqual(staticTerminal.normalBufferSnapshot())
    } finally {
      await cleanupHeadlessPair(
        { app: animatedApp, terminal: animatedTerminal },
        { app: staticApp, terminal: staticTerminal },
      )
    }
  }, 15_000)

  it('xterm buffer：auto 在 72×17 上与 off compact 终态等价', async () => {
    vi.useFakeTimers()
    const random = vi.spyOn(Math, 'random').mockReturnValue(0)
    const autoTerminal = makeHeadlessTerminal(72, 17)
    const offTerminal = makeHeadlessTerminal(72, 17)
    let autoApp: TuiApp | undefined
    let offApp: TuiApp | undefined

    try {
      const auto = await bootWelcome({
        welcomeAnimation: 'auto',
        stdout: autoTerminal.stdout,
      })
      autoApp = auto.app
      await flushHeadlessTerminal(autoTerminal)
      const autoText = autoTerminal.visibleTextLines().join('\n')
      expect(autoText).toContain('Oh My Tianshu')
      expect(autoText).not.toContain('███')
      expect(autoText).not.toMatch(/[\u2800-\u28FF]/)

      const off = await bootWelcome({
        welcomeAnimation: 'off',
        stdout: offTerminal.stdout,
      })
      offApp = off.app
      await flushHeadlessTerminal(offTerminal)

      expect(random).toHaveBeenCalledTimes(2)
      expect(autoTerminal.normalBufferSnapshot()).toEqual(offTerminal.normalBufferSnapshot())
    } finally {
      await cleanupHeadlessPair(
        { app: autoApp, terminal: autoTerminal },
        { app: offApp, terminal: offTerminal },
      )
    }
  }, 15_000)

  it('已结算的静态 welcome 不再因 resize 二次提交', async () => {
    vi.useFakeTimers()
    const writeBatch = vi.spyOn(CommitEngine.prototype, 'writeBatch')
    const { app, stdout } = await bootWelcome({ welcomeAnimation: 'auto' })

    expect(writeBatch).toHaveBeenCalledTimes(2)
    stdout.columns = 72
    stdout.rows = 17
    stdout.emitResize()
    await vi.advanceTimersByTimeAsync(150)
    expect(writeBatch).toHaveBeenCalledTimes(2)
    await app.dispose()
  })

  it('headless stdout 在 app dispose 后不再触发已卸载的 resize 回调', async () => {
    vi.useFakeTimers()
    const terminal = makeHeadlessTerminal()
    const setMaxRows = vi.spyOn(LiveEngine.prototype, 'setMaxRows')
    const { app } = await bootWelcome({
      welcomeAnimation: 'off',
      stdout: terminal.stdout,
    })

    try {
      await flushHeadlessTerminal(terminal)
      expect(terminal.stdout.listenerCount('resize')).toBe(1)
      await app.dispose()
      expect(terminal.stdout.listenerCount('resize')).toBe(0)
      const settledCalls = setMaxRows.mock.calls.length

      terminal.resize(72, 17)
      await vi.advanceTimersByTimeAsync(150)

      expect(setMaxRows).toHaveBeenCalledTimes(settledCalls)
    } finally {
      await cleanupHeadlessTerminal(app, terminal)
    }
  })

  it('静态挂载后首个字符进入输入路由', async () => {
    const writeBatch = vi.spyOn(CommitEngine.prototype, 'writeBatch')
    const { app, agent, stdin } = await bootWelcome({ welcomeAnimation: 'auto' })

    expect(writeBatch).toHaveBeenCalledTimes(2)
    stdin.emit('data', 'x')
    stdin.emit('data', '\r')
    await vi.waitFor(() => { expect(agent.followup).toHaveBeenCalledTimes(1) })
    expect(firstCallText(agent.followup)).toBe('x')
    await app.dispose()
  })

  it('欢迎数字键先 settle final，再继续路由既有 restore row', async () => {
    const writeBatch = vi.spyOn(CommitEngine.prototype, 'writeBatch')
    const { app, stdin } = await bootWelcome({ restorable: true })

    stdin.emit('data', '1')
    await vi.waitFor(() => {
      expect(writeBatch).toHaveBeenCalledTimes(2)
      expect(app.sessionId).toBe(SessionId('session-welcome-other'))
    })
    await app.dispose()
  })

  it('resize 先采用新尺寸，再 settle 为 compact final 且不重播', async () => {
    vi.useFakeTimers()
    const writeBatch = vi.spyOn(CommitEngine.prototype, 'writeBatch')
    const render = vi.spyOn(LiveEngine.prototype, 'render')
    const { app, stdout } = await bootWelcome()

    stdout.columns = 72
    stdout.rows = 17
    stdout.emitResize()
    await vi.advanceTimersByTimeAsync(150)

    expect(writeBatch).toHaveBeenCalledTimes(2)
    expect(batchText(writeBatch)).toContain('Oh My Tianshu')
    expect(batchText(writeBatch)).not.toContain('███')
    await vi.advanceTimersByTimeAsync(4_000)
    expect(writeBatch).toHaveBeenCalledTimes(2)
    expect(render.mock.calls.at(-1)?.[0].some(line => line.text.includes('Tianshu Harness'))).toBe(false)
    await app.dispose()
  })

  it('dispose 后不再追加 welcome final', async () => {
    const writeBatch = vi.spyOn(CommitEngine.prototype, 'writeBatch')
    const { app } = await bootWelcome()

    expect(writeBatch).toHaveBeenCalledTimes(2)
    await app.dispose()
    expect(writeBatch).toHaveBeenCalledTimes(2)
  })

  it('静态 welcome 结算后立即打开缺 key dialog', async () => {
    const { app } = await bootWelcome({ inputTty: true })
    const overlay = (app as unknown as {
      overlay: { activeId(): string | null }
    }).overlay

    expect(overlay.activeId()).toBe('key-dialog')
    await app.dispose()
  })

  it('bracketed paste 入口先 settle，粘贴文本仍可正常提交', async () => {
    const writeBatch = vi.spyOn(CommitEngine.prototype, 'writeBatch')
    const { app, agent, stdin } = await bootWelcome()

    stdin.emit('data', '\x1B[200~pasted task\x1B[201~')
    await vi.waitFor(() => { expect(writeBatch).toHaveBeenCalledTimes(2) })
    stdin.emit('data', '\r')
    await vi.waitFor(() => { expect(agent.followup).toHaveBeenCalledTimes(1) })
    expect(firstCallText(agent.followup)).toBe('pasted task')
    await app.dispose()
  })

  it('command-line initial prompt 经 handleSubmit settle 且不丢任务文本', async () => {
    const writeBatch = vi.spyOn(CommitEngine.prototype, 'writeBatch')
    const { app, agent } = await bootWelcome({ cmdline: ['initial task'] })

    expect(writeBatch).toHaveBeenCalledTimes(2)
    expect(firstCallText(agent.followup)).toBe('initial task')
    await app.dispose()
  })
})

describe('TuiApp 1.2/1.3 恢复横幅、历史结束标记与崩溃修复告知', () => {
  /** 构造带事件历史的 live session 替身（attach 目标 = list()[0]）。 */
  async function attachToHistory(events: SessionEvent[], cwd?: string): Promise<{ app: TuiApp; stdout: ReturnType<typeof makeStdout> }> {
    const ctx = makeCtx()
    const agent = makeAgent('resume-banner')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    // registry 兜底分支（get 返回 agent，不走 resume）
    ctx.agents.get.mockReturnValue(agent)
    ;(agent.session as unknown as { events: SessionEvent[] }).events = events
    if (cwd !== undefined) {
      ;(agent.session as unknown as { header: { id: SessionId; version: number; createdAt: number; cwd?: string } }).header = {
        id: SessionId('resume-banner'), version: 0, createdAt: 1, cwd,
      }
    }
    ctx.sessions.get.mockReturnValue(agent.session)
    ctx.sessions.list.mockReturnValue([
      { id: SessionId('resume-banner'), header: agent.session.header as never },
    ])
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin: makeStdin() })
    await app.attach()
    return { app, stdout }
  }

  const NOW = Date.now() - 60_000
  const historyEvents = (): SessionEvent[] => [
    { type: 'user/message', seq: 0, time: NOW, data: { turn: 0, source: { kind: 'user' }, content: [{ type: 'text', text: 'hello resume' }] }, surfaceOp: 'append' },
    { type: 'assistant/message', seq: 1, time: NOW, data: { turn: 0, step: 0, message: { content: [{ type: 'text', text: 'world' }] } }, surfaceOp: 'append' },
    { type: 'session/end-seed', seq: 2, time: NOW, data: {} },
  ] as unknown as SessionEvent[]

  it('恢复挂载 → 横幅（标题 · 最后活动 · cwd）+ 回放末尾「上次进行到此处」', async () => {
    const { app, stdout } = await attachToHistory(historyEvents(), '/app/x')
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('已恢复会话 hello resume')
    expect(written).toContain('1 分钟前')
    expect(written).toContain('/app/x')
    expect(written).toContain('上次进行到此处')
    expect(written.indexOf('已恢复会话 hello resume')).toBeLessThan(written.indexOf('Tip:'))
    expect(written.indexOf('上次进行到此处')).toBeLessThan(written.indexOf('Tip:'))
    await app.dispose()
  })

  it('新会话（无历史）→ 无横幅、无分隔', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('resume-fresh')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    ctx.sessions.list.mockReturnValue([]) // live store 为空 → attach 走 newSession
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin: makeStdin() })
    await app.attach()
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).not.toContain('已恢复会话')
    expect(written).not.toContain('上次进行到此处')
    await app.dispose()
  })

  it('崩溃修复会话（interrupted turn/end）→ 恢复时提示自动闭合', async () => {
    const events = [
      { type: 'turn/start', seq: 0, time: NOW, data: { turn: 0 } },
      { type: 'user/message', seq: 1, time: NOW, data: { turn: 0, source: { kind: 'user' }, content: [{ type: 'text', text: 'hello resume' }] }, surfaceOp: 'append' },
      { type: 'turn/end', seq: 2, time: NOW, data: { turn: 0, reason: { kind: 'interrupted' } } },
      { type: 'session/end-seed', seq: 3, time: NOW, data: {} },
    ] as unknown as SessionEvent[]
    const { app, stdout } = await attachToHistory(events)
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('上次运行被中断，已自动闭合未完成回合')
    await app.dispose()
  })

  it('未修复会话 → 不提示自动闭合', async () => {
    const { app, stdout } = await attachToHistory(historyEvents())
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).not.toContain('上次运行被中断')
    await app.dispose()
  })
})

describe('TuiApp 1.4 --session 命令行会话参数', () => {
  /** reflect.get 替身：cmdlineArgs 返回固定内参，其余服务缺失。 */
  function withCmdline(ctx: ReturnType<typeof makeCtx>, args: string[]): void {
    ctx.reflect.get.mockImplementation((name: string) => name === 'cmdlineArgs' ? { get: () => args } : undefined)
  }

  it('--session <id> 存在 → attach 恢复指定会话', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('cli-session')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.agents.get.mockReturnValue(agent)
    ctx.sessions.get.mockReturnValue(agent.session)
    const header = { id: SessionId('session-cli-1'), version: 0, createdAt: Date.now() - 1000, cwd: undefined, parentSession: undefined }
    ctx.sessions.list.mockReturnValue([{ id: header.id, header }])
    withCmdline(ctx, ['--session', 'session-cli-1'])
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin: makeStdin() })
    await app.attach()
    expect(app.sessionId).toBe(SessionId('session-cli-1'))
    await app.dispose()
  })

  it('--session 与初始 prompt 并存 → 恢复会话且位置参数仍作 prompt', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('cli-session-2')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.agents.get.mockReturnValue(agent)
    ctx.sessions.get.mockReturnValue(agent.session)
    const header = { id: SessionId('session-cli-2'), version: 0, createdAt: Date.now() - 1000, cwd: undefined, parentSession: undefined }
    ctx.sessions.list.mockReturnValue([{ id: header.id, header }])
    withCmdline(ctx, ['--session', 'session-cli-2', 'hello'])
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin: makeStdin() })
    await app.attach()
    expect(app.sessionId).toBe(SessionId('session-cli-2'))
    const followups = (agent.followup as ReturnType<typeof vi.fn>)
    expect(allCallTexts(followups)).toContain('hello')
    await app.dispose()
  })

  it('--session 未知 id → 报错 + 指引，回落到正常启动路径', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('cli-session-3')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    ctx.agents.get.mockReturnValue(agent)
    // live store 有 1 个会话（attach 回落目标）→ 不新建
    const header = { id: SessionId('session-live-3'), version: 0, createdAt: Date.now() - 1000, cwd: undefined, parentSession: undefined }
    ctx.sessions.list.mockReturnValue([{ id: header.id, header }])
    withCmdline(ctx, ['--session', 'session-nope'])
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin: makeStdin() })
    await app.attach()
    expect(app.sessionId).toBe(SessionId('session-live-3'))
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('会话不存在: session-nope')
    expect(written).toContain('/session list')
    await app.dispose()
  })
})

describe('TuiApp 会话切换失败安全（损坏行/恢复失败不进入半切换状态）', () => {
  /** attach 到唯一 live 会话；list 另含损坏行与可恢复行，agents.get 只认 live。 */
  async function attachWithCorrupt(): Promise<{
    app: TuiApp
    ctx: Context
    stdout: ReturnType<typeof makeStdout>
    stdin: ReturnType<typeof makeStdin>
    agent: ReturnType<typeof makeAgent>
    current: SessionId
    corrupt: SessionId
    valid: SessionId
  }> {
    const ctx = makeCtx()
    const agent = makeAgent('switch-safe')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    const current = SessionId('session-live-safe')
    const corrupt = SessionId('session-corrupt-x')
    const valid = SessionId('session-valid-x')
    const headerOf = (id: SessionId, createdAt: number, version = 0) => ({
      id, createdAt, version, cwd: undefined, parentSession: undefined,
    })
    // 损坏行 createdAt 最新：任何「取最近其他会话」的路径若不过滤都会先撞上它。
    // （SessionManager.list 读 session.events.length——mock 必须带 events 数组。）
    ctx.sessions.list.mockReturnValue([
      { id: current, header: headerOf(current, Date.now() - 10_000), events: [] },
      { id: corrupt, header: headerOf(corrupt, Date.now() - 1_000, -1), events: [] },
      { id: valid, header: headerOf(valid, Date.now() - 5_000), events: [] },
    ])
    // registry 只认 live 会话：corrupt/valid 走 resume 路径（resume 由各测试定）。
    ctx.agents.get.mockImplementation((id: SessionId) => id === current ? agent : undefined)
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin })
    await app.attach()
    return { app, ctx, stdout, stdin, agent, current, corrupt, valid }
  }

  it('switchSession 到损坏行 → 抛出损坏原因且状态不提交（activeSessionId 不变）', async () => {
    const { app, current, corrupt } = await attachWithCorrupt()
    await expect(app.switchSession(corrupt)).rejects.toThrow('会话工件损坏，不可恢复')
    expect(app.sessionId).toBe(current)
    await app.dispose()
  })

  it('switchSession 恢复被拒 → 状态留在原会话（无半切换）', async () => {
    const { app, ctx, current, valid } = await attachWithCorrupt()
    ;(ctx.agents.resume as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('session "x" not found'))
    await expect(app.switchSession(valid)).rejects.toThrow('not found')
    expect(app.sessionId).toBe(current)
    await app.dispose()
  })

  it('欢迎页数字键选中损坏行 → 回显失败警告，会话不切换（不逃逸 unhandled）', async () => {
    const { app, stdout, stdin, current } = await attachWithCorrupt()
    // 欢迎列表第 1 行 = 损坏行（others[0]，createdAt 最新）
    stdin.emit('data', '1')
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(app.sessionId).toBe(current)
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('会话切换失败')
    expect(written).toContain('会话工件损坏，不可恢复')
    await app.dispose()
  })

  it('ctrl+s 跳过损坏行 → 切到最近一个「可恢复」的其他会话', async () => {
    const { app, ctx, stdin, agent, valid } = await attachWithCorrupt()
    // valid 改走 registry 分支（agents.get 认它）——本测试只验证目标选择跳过了损坏行。
    ;(ctx.agents.get as ReturnType<typeof vi.fn>).mockImplementation(
      (id: SessionId) => id === valid ? agent : undefined,
    )
    stdin.emit('data', '\x13') // Ctrl+S
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(app.sessionId).toBe(valid)
    await app.dispose()
  })
})

describe('TuiApp 输入行 IME 硬件光标锚定（caretCol 接线）', () => {
  it('renderLive 给输入行设 caretCol → LiveEngine 驻停序列上屏', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('caret-1')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    ctx.sessions.list.mockReturnValue([])
    const stdout = makeStdout()

    const app = new TuiApp({ ctx, stdout, stdin: makeStdin() })
    await app.attach()

    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    // 空输入行 caret.col = `❯ ` 前缀宽 2，再加 CHROME_GUTTER=2 → 4
    // → 驻停列 = col+1 = 5（CHA `\x1B[5G`）。未接线时 caretCol 恒缺，LiveEngine
    // 不驻停，stdout 里不会出现任何 CHA 序列。
    expect(written).toContain('\x1B[5G')
    await app.dispose()
  })
})

describe('TuiApp Phase 8 审批 answerer', () => {
  it('当前会话请求 → 挂起提示 + y 放行（allowed-once）', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('approval-1')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdin = makeStdin()
    const stdout = makeStdout()

    const app = new TuiApp({ ctx, stdout, stdin })
    await app.attach()

    // 注册的 approval/request handler
    const handler = ctx.on.mock.calls.find(call => call[0] === 'approval/request')?.[1] as
      | ((req: unknown, next: () => Promise<string>) => Promise<string>)
      | undefined
    if (handler === undefined) throw new Error('approval/request handler not registered')

    const owner = { id: app.sessionId ?? SessionId('approval-1') }
    const outcome = handler(
      { agent: { session: { id: owner.id } }, toolName: 'bash', reason: 'sandbox' },
      () => Promise.resolve('unavailable'),
    )

    // 挂起提示上屏
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('允许执行 bash')
    expect(written).toContain('[y] 允许')
    expect(written).toContain('[a] 本会话放行')
    expect(written).toContain('╭─ 审批 · bash')

    // y 放行
    stdin.emit('data', 'y')
    await expect(outcome).resolves.toBe('allowed-once')
    await app.dispose()
  })

  it('审批挂起按 a → 本会话放行（always-approve + 当前请求 allowed-once）', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('approval-a')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin })
    await app.attach()
    const handler = ctx.on.mock.calls.find(call => call[0] === 'approval/request')?.[1] as
      | ((req: unknown, next: () => Promise<string>) => Promise<string>)
      | undefined
    if (handler === undefined) throw new Error('approval/request handler not registered')
    const owner = { id: app.sessionId ?? SessionId('approval-a') }
    const outcome = handler(
      { agent: { session: { id: owner.id } }, toolName: 'bash' },
      () => Promise.resolve('unavailable'),
    )
    stdin.emit('data', 'a')
    await expect(outcome).resolves.toBe('allowed-once')
    const next = handler(
      { agent: { session: { id: owner.id } }, toolName: 'bash' },
      () => Promise.resolve('unavailable'),
    )
    await expect(next).resolves.toBe('allowed-once')
    await app.dispose()
  })

  it('str_replace 审批带 callId → 内联 diff 预览（C2 项 1）', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('approval-diff-1')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    // attach 前注入 tool/call 事件（transcript 在 mountSession 时 replay fold；
    // Agent 接口声明 events 为 readonly，测试替身 cast 注入）
    const events = agent.session.events as unknown as unknown[]
    events.push({
      type: 'tool/call',
      seq: 1,
      time: 1,
      data: {
        turn: 1,
        step: 1,
        callId: 'call-diff-1',
        name: 'str_replace_editor',
        arguments: JSON.stringify({
          command: 'str_replace',
          path: '/repo/a.ts',
          old_str: 'const x = 1',
          new_str: 'const x = 2',
        }),
      },
    })
    const stdin = makeStdin()
    const stdout = makeStdout()

    const app = new TuiApp({ ctx, stdout, stdin })
    await app.attach()
    const handler = ctx.on.mock.calls.find(call => call[0] === 'approval/request')?.[1] as
      | ((req: unknown, next: () => Promise<string>) => Promise<string>)
      | undefined
    if (handler === undefined) throw new Error('approval/request handler not registered')

    const owner = { id: app.sessionId ?? SessionId('approval-diff-1') }
    void handler(
      { agent: { session: { id: owner.id } }, toolName: 'str_replace_editor', callId: 'call-diff-1' },
      () => Promise.resolve('unavailable'),
    )

    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    // diff 块在审批卡内；行前缀与结算卡共享 renderFileDiff（`+ ` 带空格）
    expect(written).toContain('- const x = 1')
    expect(written).toContain('+ const x = 2')
    expect(written).toContain('允许执行 str_replace_editor')
    await app.dispose()
  })

  it('矮屏审批卡 compact：有 diff 也不展开体，键位仍在', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('approval-tight')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    const events = agent.session.events as unknown as unknown[]
    events.push({
      type: 'tool/call',
      seq: 1,
      time: 1,
      data: {
        turn: 1,
        step: 1,
        callId: 'call-tight-1',
        name: 'str_replace_editor',
        arguments: JSON.stringify({
          command: 'str_replace',
          path: '/repo/a.ts',
          old_str: 'const x = 1',
          new_str: 'const x = 2',
        }),
      },
    })
    const stdin = makeStdin()
    const stdout = makeStdout()
    stdout.rows = 16
    const app = new TuiApp({ ctx, stdout, stdin })
    await app.attach()
    const handler = ctx.on.mock.calls.find(call => call[0] === 'approval/request')?.[1] as
      | ((req: unknown, next: () => Promise<string>) => Promise<string>)
      | undefined
    if (handler === undefined) throw new Error('approval/request handler not registered')
    const owner = { id: app.sessionId ?? SessionId('approval-tight') }
    void handler(
      { agent: { session: { id: owner.id } }, toolName: 'str_replace_editor', callId: 'call-tight-1' },
      () => Promise.resolve('unavailable'),
    )
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('允许执行 str_replace_editor')
    expect(written).toContain('[y] 允许')
    expect(written).not.toContain('- const x = 1')
    await app.dispose()
  })

  it('审批带非 diff 工具 callId → diff null 分支（仅 y/N 提示）', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('approval-3')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdin = makeStdin()
    const stdout = makeStdout()

    const app = new TuiApp({ ctx, stdout, stdin })
    await app.attach()
    const handler = ctx.on.mock.calls.find(call => call[0] === 'approval/request')?.[1] as
      | ((req: unknown, next: () => Promise<string>) => Promise<string>)
      | undefined
    if (handler === undefined) throw new Error('approval/request handler not registered')

    const next = vi.fn(async () => 'allowed-once')
    const result = await handler({
      agent: { session: { id: agent.session.id } },
      req: { callId: 'call-unknown-1', reason: 'approve' },
    }, next)
    expect(result).toBe('allowed-once')
    await new Promise(resolve => setImmediate(resolve))
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    // 无 diff 渲染（callId 未知 → toolCall undefined → diff 分支不执行）
    expect(written).not.toContain('-const x')
    await app.dispose()
  })

  it('审批命中 callId 但工具不可 diff → formatPermissionDiff null 分支（仅 y/N）', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('approval-diff-null')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    // attach 前注入 bash tool/call（callId 命中 transcript.tools；bash 无替换语义
    // → formatPermissionDiff 返回 null，走 if (diff !== null) 的 null 侧）
    const events = agent.session.events as unknown as unknown[]
    events.push({
      type: 'tool/call',
      seq: 1,
      time: 1,
      data: {
        turn: 1,
        step: 1,
        callId: 'call-bash-1',
        name: 'bash',
        arguments: JSON.stringify({ command: 'echo hi' }),
      },
    })
    const stdin = makeStdin()
    const stdout = makeStdout()

    const app = new TuiApp({ ctx, stdout, stdin })
    await app.attach()
    const handler = ctx.on.mock.calls.find(call => call[0] === 'approval/request')?.[1] as
      | ((req: unknown, next: () => Promise<string>) => Promise<string>)
      | undefined
    if (handler === undefined) throw new Error('approval/request handler not registered')

    const owner = { id: app.sessionId ?? SessionId('approval-diff-null') }
    void handler(
      { agent: { session: { id: owner.id } }, toolName: 'bash', callId: 'call-bash-1' },
      () => Promise.resolve('unavailable'),
    )
    await new Promise(resolve => setImmediate(resolve))
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    // toolCall 命中 + arguments 存在，但 bash 不可 diff → 无 diff 块，仅 y/N 提示
    expect(written).not.toContain('-const')
    expect(written).toContain('允许执行 bash')
    await app.dispose()
  })

  it('盲批降级提示：diff 不可见时 y/N 行合并「（diff 不可见）」（A2）', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('approval-blind')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    // attach 前注入 bash tool/call（场景 3：callId 命中但 bash 不可 diff
    // → formatPermissionDiff 返回 null）
    const events = agent.session.events as unknown as unknown[]
    events.push({
      type: 'tool/call',
      seq: 1,
      time: 1,
      data: {
        turn: 1,
        step: 1,
        callId: 'call-bash-blind',
        name: 'bash',
        arguments: JSON.stringify({ command: 'echo hi' }),
      },
    })
    const stdin = makeStdin()
    const stdout = makeStdout()

    const app = new TuiApp({ ctx, stdout, stdin })
    await app.attach()
    const handler = ctx.on.mock.calls.find(call => call[0] === 'approval/request')?.[1] as
      | ((req: unknown, next: () => Promise<string>) => Promise<string>)
      | undefined
    if (handler === undefined) throw new Error('approval/request handler not registered')

    const owner = { id: app.sessionId ?? SessionId('approval-blind') }
    const writtenSince = (baseline: number): string =>
      stdout.write.mock.calls.slice(baseline).map(c => `${c[0]}`).join('')

    // 场景 1：callId 缺失 → 无 diff 可查，y/N 行合并降级提示（净零行）
    const b1 = stdout.write.mock.calls.length
    const o1 = handler(
      { agent: { session: { id: owner.id } }, toolName: 'bash' },
      () => Promise.resolve('unavailable'),
    )
    await new Promise(resolve => setImmediate(resolve))
    expect(writtenSince(b1)).toContain('允许执行 bash')
    expect(writtenSince(b1)).toContain('（diff 不可见）')
    stdin.emit('data', 'y')
    await expect(o1).resolves.toBe('allowed-once')

    // 场景 2：callId 存在但 transcript 未命中（findLast 返回 undefined）→ 同样降级
    const b2 = stdout.write.mock.calls.length
    const o2 = handler(
      { agent: { session: { id: owner.id } }, toolName: 'bash', callId: 'call-miss' },
      () => Promise.resolve('unavailable'),
    )
    await new Promise(resolve => setImmediate(resolve))
    expect(writtenSince(b2)).toContain('（diff 不可见）')
    stdin.emit('data', 'y')
    await expect(o2).resolves.toBe('allowed-once')

    // 场景 3：callId 命中但 formatPermissionDiff 返回 null → 同样降级
    const b3 = stdout.write.mock.calls.length
    const o3 = handler(
      { agent: { session: { id: owner.id } }, toolName: 'bash', callId: 'call-bash-blind' },
      () => Promise.resolve('unavailable'),
    )
    await new Promise(resolve => setImmediate(resolve))
    expect(writtenSince(b3)).toContain('（diff 不可见）')
    stdin.emit('data', 'y')
    await expect(o3).resolves.toBe('allowed-once')

    await app.dispose()
  })

  it('n 拒绝 / Ctrl+C 取消', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('approval-2')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdin = makeStdin()

    const app = new TuiApp({ ctx, stdout: makeStdout(), stdin })
    await app.attach()
    const handler = ctx.on.mock.calls.find(call => call[0] === 'approval/request')?.[1] as
      | ((req: unknown, next: () => Promise<string>) => Promise<string>)
      | undefined
    if (handler === undefined) throw new Error('approval/request handler not registered')

    const owner = { id: app.sessionId ?? SessionId('approval-2') }
    const rejected = handler(
      { agent: { session: { id: owner.id } }, toolName: 'bash' },
      () => Promise.resolve('unavailable'),
    )
    stdin.emit('data', 'n')
    await expect(rejected).resolves.toBe('rejected')

    const cancelled = handler(
      { agent: { session: { id: owner.id } }, toolName: 'bash' },
      () => Promise.resolve('unavailable'),
    )
    stdin.emit('data', '\x03') // Ctrl+C
    await expect(cancelled).resolves.toBe('cancelled')
    await app.dispose()
  })

  it('非当前会话请求 → next() 委托（不挂起）', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('approval-3')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdout = makeStdout()

    const app = new TuiApp({ ctx, stdout, stdin: makeStdin() })
    await app.attach()
    const handler = ctx.on.mock.calls.find(call => call[0] === 'approval/request')?.[1] as
      | ((req: unknown, next: () => Promise<string>) => Promise<string>)
      | undefined
    if (handler === undefined) throw new Error('approval/request handler not registered')

    const next = vi.fn(() => Promise.resolve('unavailable'))
    const outcome = handler(
      { agent: { session: { id: SessionId('session-other') } }, toolName: 'bash' },
      next,
    )
    await expect(outcome).resolves.toBe('unavailable')
    expect(next).toHaveBeenCalledTimes(1)
    // 未挂起：无提示
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).not.toContain('允许执行')
    await app.dispose()
  })
})

describe('TuiApp Phase 6.2 中轮转向 + statusline 接入', () => {
  it('/steer 提交走 steer API，不触发 followup，消息差异化渲染进 scrollback', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('steer-1')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdout = makeStdout()

    const app = new TuiApp({ ctx, stdout, stdin: makeStdin() })
    await app.newSession()
    app.handleSubmit('/steer 收敛到最小方案')

    expect(agent.steer).toHaveBeenCalledTimes(1)
    expect(agent.followup).not.toHaveBeenCalled()
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toMatch(/>>|➤/)
    expect(written).toContain('收敛到最小方案')
    await app.dispose()
  })

  it('普通输入不受影响，仍走 followup', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('plain-1')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)

    const app = new TuiApp({ ctx, stdout: makeStdout(), stdin: makeStdin() })
    await app.newSession()
    app.handleSubmit('继续下一步')
    expect(agent.followup).toHaveBeenCalledTimes(1)
    expect(agent.steer).not.toHaveBeenCalled()
    await app.dispose()
  })

  it('Ctrl+T 触发 steer 并清空输入行（两次输入不粘连）', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('ctrl-t-1')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdin = makeStdin()

    const app = new TuiApp({ ctx, stdout: makeStdout(), stdin })
    await app.attach()

    stdin.emit('data', '转向')
    stdin.emit('data', '\x14') // Ctrl+T = 0x14
    stdin.emit('data', '再转')
    stdin.emit('data', '\x14')
    await new Promise(resolve => setImmediate(resolve))

    expect(agent.steer).toHaveBeenCalledTimes(2)
    const texts = allCallTexts(agent.steer)
    expect(texts).toEqual(['转向', '再转'])
    await app.dispose()
  })

  it('输入为空时 Ctrl+T 不触发 steer', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('ctrl-t-3')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdin = makeStdin()

    const app = new TuiApp({ ctx, stdout: makeStdout(), stdin })
    await app.attach()

    stdin.emit('data', '\x14')
    await new Promise(resolve => setImmediate(resolve))
    expect(agent.steer).not.toHaveBeenCalled()
    await app.dispose()
  })

  it('statusline 接入：session/event 折叠驱动状态行更新', async () => {
    const ctx = makeCtx()
    const handlers = new Map<string, ((...args: unknown[]) => void)[]>()
    Object.assign(ctx, {
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        const list = handlers.get(event) ?? []
        list.push(handler)
        handlers.set(event, list)
        return () => { }
      }),
    }) as unknown as Context['on']
    const agent = makeAgent('wf-1')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdout = makeStdout()

    const app = new TuiApp({ ctx, stdout, stdin: makeStdin() })
    await app.newSession()

    const sessionHandlers = handlers.get('session/event') ?? []
    expect(sessionHandlers.length).toBeGreaterThan(0)
    const event = {
      type: 'tool/call',
      seq: 0,
      time: 1,
      data: { callId: 'call-1', name: 'read_file', arguments: '{}', turn: 1, step: 0 },
    }
    // newSession 铸造的 sessionId 是 session-<uuid>，与 mock agent 的 'wf-1' 不同——
    // 必须用 app.sessionId 作为事件 owner 才能命中 WorkflowStatusLine 的会话过滤。
    // 注意：app 的 streamFeed 与 WorkflowStatusLine 各自注册了 session/event handler，
    // 状态行折叠只发生在 statusline 自己的 handler 里——必须驱动全部 handler。
    const owner = { id: app.sessionId ?? SessionId('wf-1') }
    for (const handler of sessionHandlers) handler(owner, event)
    // C2 渲染管线：WriteBatcher 16ms 帧合并 + glance 16ms 节流窗口——setImmediate
    // 等不到合并帧，需等待超过节流窗口。
    await new Promise(resolve => setTimeout(resolve, 30))

    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('调研 · read_file')
    await app.dispose()
  })

  it('dispose 解绑 statusline 的 agent/status 与 session/event 订阅', async () => {
    const ctx = makeCtx()
    const disposers = new Map<string, (() => void)[]>()
    Object.assign(ctx, {
      on: vi.fn((event: string, _handler: unknown) => {
        const list = disposers.get(event) ?? []
        const disposer = vi.fn()
        list.push(disposer)
        disposers.set(event, list)
        return disposer
      }),
    })
    const agent = makeAgent('wf-dispose')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)

    const app = new TuiApp({ ctx, stdout: makeStdout(), stdin: makeStdin() })
    await app.newSession()
    await app.dispose()

    for (const event of ['agent/status', 'session/event']) {
      const list = disposers.get(event) ?? []
      expect(list.length).toBeGreaterThan(0)
      for (const d of list) expect(d).toHaveBeenCalled()
    }
  })
})

describe('TuiApp Phase 9d 流利度装配', () => {
  it('tool/result 喂 FluencyTracker：连续 routine 触发 quiet 折叠策略', async () => {
    const ctx = makeCtx()
    const handlers = new Map<string, ((...args: unknown[]) => void)[]>()
    Object.assign(ctx, {
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        const list = handlers.get(event) ?? []
        list.push(handler)
        handlers.set(event, list)
        return () => { }
      }),
    })
    const agent = makeAgent('flu-1')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)

    const app = new TuiApp({ ctx, stdout: makeStdout(), stdin: makeStdin() })
    await app.newSession()
    const sessionHandlers = handlers.get('session/event') ?? []
    const owner = { id: app.sessionId ?? SessionId('flu-1') }

    // 4 次连续 routine tool/result（read_file/grep/glob/diff）→ quiet 策略
    const routines = [
      { callId: 'c1', name: 'read_file', text: 'a'.repeat(500) },
      { callId: 'c2', name: 'grep', text: 'b'.repeat(500) },
      { callId: 'c3', name: 'glob', text: 'c'.repeat(500) },
      { callId: 'c4', name: 'diff', text: 'd'.repeat(500) },
    ]
    for (const r of routines) {
      for (const handler of sessionHandlers) handler(owner, {
        type: 'tool/call',
        seq: 0,
        time: 1,
        data: { callId: r.callId, name: r.name, arguments: '{}', turn: 1, step: 0 },
      })
    }
    for (const r of routines) {
      for (const handler of sessionHandlers) handler(owner, {
        type: 'tool/result',
        seq: 0,
        time: 2,
        data: {
          callId: r.callId,
          turn: 1,
          step: 0,
          message: {
            id: `m-${r.callId}`,
            role: 'user',
            source: { kind: 'tool', callId: r.callId },
            content: [{ type: 'tool-result', toolCallId: r.callId, content: [{ type: 'text', text: r.text }] }],
          },
        },
      })
    }
    await new Promise(resolve => setImmediate(resolve))

    // turn/end 后流利度复位：再次渲染不出现 stale 提示（策略回 normal）
    for (const handler of sessionHandlers) handler(owner, {
      type: 'turn/end',
      seq: 0,
      time: 3,
      data: { reason: { kind: 'completed' } },
    })
    await app.dispose()
    // 装配路径无异常即通过（策略内部折叠不直接渲染；渲染断言见下例）
  })

  it('长静默 tool 阶段 → stale 提示上屏（action 档）', { timeout: 20_000 }, async () => {
    const ctx = makeCtx()
    const handlers = new Map<string, ((...args: unknown[]) => void)[]>()
    Object.assign(ctx, {
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        const list = handlers.get(event) ?? []
        list.push(handler)
        handlers.set(event, list)
        return () => { }
      }),
    })
    const agent = makeAgent('flu-2')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdout = makeStdout()

    // fake timers 先于 attach：ticker 在 fake 时钟下创建，advance 才能驱动
    // renderLive 读到推进后的 Date.now()（stale 判定依赖真实流逝模拟）。
    vi.useFakeTimers()
    const app = new TuiApp({ ctx, stdout, stdin: makeStdin() })
    await app.attach()
    const sessionHandlers = handlers.get('session/event') ?? []
    const owner = { id: app.sessionId ?? SessionId('flu-2') }

    try {
      // tool/call + tool/result 派发（fake 时钟起点）
      for (const handler of sessionHandlers) handler(owner, {
        type: 'tool/call',
        seq: 0,
        time: 1,
        data: { callId: 'c1', name: 'bash', arguments: '{}', turn: 1, step: 0 },
      })
      for (const handler of sessionHandlers) handler(owner, {
        type: 'tool/result',
        seq: 0,
        time: 2,
        data: {
          callId: 'c1',
          turn: 1,
          step: 0,
          message: {
            id: 'm-c1',
            role: 'user',
            source: { kind: 'tool', callId: 'c1' },
            content: [{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'x' }] }],
          },
        },
      })
      // stale 判定 = renderLive 时的 Date.now() - lastEventAt（fluency-hook
      // 快照），与经过多少轮 ticker 无关——时间跳跃而非逐帧推进：
      // setSystemTime 直接跨过 tool action 档（180s），再推进 1s 触发少量
      // ticker/batcher 渲染即可。此前 advanceTimersByTime(200_000) 要同步跑
      // ~1700 次全量 renderLive，真实 CPU 耗时随全量并发负载膨胀直至撞穿
      // 20s 测试预算（跨四批复现的 flaky 根因；移植 dsh-tui 86cea46）。
      // async 版在每轮定时器间排空微任务，写入顺序确定。
      vi.setSystemTime(Date.now() + 200_000)
      await vi.advanceTimersByTimeAsync(1_000)
    } finally {
      vi.useRealTimers()
    }
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('Tool may be stuck')
    await app.dispose()
  })
})

describe('TuiApp Phase 6.1 slash 命令系统', () => {
  beforeEach(() => { setTheme('graphite') })

  it('/theme 经注册表生效并回显', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('slash-theme')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdout = makeStdout()

    const app = new TuiApp({ ctx, stdout, stdin: makeStdin() })
    await app.newSession()
    app.handleSubmit('/theme paper')
    await new Promise(resolve => setImmediate(resolve))

    expect(getActiveThemeName()).toBe('paper')
    expect(stdout.write.mock.calls.map(c => `${c[0]}`).join('')).toContain('主题已切换: paper')
    await app.dispose()
  })

  it('/clear 重置 scrollback 并回显', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('slash-clear')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdout = makeStdout()

    const app = new TuiApp({ ctx, stdout, stdin: makeStdin() })
    await app.newSession()
    app.handleSubmit('第一行')
    app.handleSubmit('/clear')
    await new Promise(resolve => setImmediate(resolve))

    expect(stdout.write.mock.calls.map(c => `${c[0]}`).join('')).toContain('已清空')
    await app.dispose()
  })

  it('/clear 收起命令切换的 live 面板（/skills 不再重绘；/config 已改 overlay 不受影响）', async () => {
    const ctx = makeCtx()
    const fallback = ctx.reflect.get.getMockImplementation() as ((name: string) => unknown) | undefined
    ctx.reflect.get.mockImplementation((name: string) => {
      if (name === 'settings') return { describe: vi.fn(() => [{ ns: 'model', value: 'deepseek' }]) }
      if (name === 'permission') return { names: ['run_shell'], current: vi.fn(() => 'ask') }
      if (name === 'credentials') return { describe: vi.fn(async () => ({ configured: true, source: 'file', writable: false })) }
      if (name === 'skills') return { list: vi.fn(async () => [{ name: 'code-review', description: '代码审查', provider: 'mock', source: 'builtin', invocation: 'manual' }]) }
      return fallback ? fallback(name) : undefined
    })
    const agent = makeAgent('slash-clear-panels')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin: makeStdin() })
    await app.attach()

    app.handleSubmit('/skills')
    await new Promise(resolve => setTimeout(resolve, 40))
    let written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('code-review') // 技能面板已渲染

    app.handleSubmit('/clear')
    await new Promise(resolve => setTimeout(resolve, 40))
    written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('已清空')
    // /clear 光标回顶（\x1b[H）之后的 live 区全量重绘不应再包含命令面板
    const tail = written.slice(written.lastIndexOf('\x1b[H'))
    expect(tail).not.toContain('code-review')
    await app.dispose()
  })

  it('/export 带 path：完整链路导出会话转录为 Markdown（真实文件系统）', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('slash-export')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    // 塞一条用户消息事件（权威形状：data 即 UserMessage）。
    // Agent 接口声明 events 为 readonly；tsc 需要 cast，oxlint 视 mock 推断为可变——按 tsc 写并豁免。
    // oxlint-disable-next-line no-unnecessary-type-assertion
    ;(agent.session.events as unknown as unknown[]).push({
      type: 'user/message',
      seq: 0,
      time: 1,
      data: {
        id: 'm-export-1',
        role: 'user',
        source: { kind: 'user' },
        content: [{ type: 'text', text: '导出这段对话' }],
      },
    } as unknown as SessionEvent)
    const dir = mkdtempSync(join(tmpdir(), 'dsh-export-'))
    const target = join(dir, 'out.md')
    const stdout = makeStdout()

    const app = new TuiApp({ ctx, stdout, stdin: makeStdin() })
    await app.newSession()
    app.handleSubmit(`/export ${target}`)
    // exportTranscript 是真实异步 IO——轮询文件落盘（非 setImmediate 单轮）。
    await vi.waitFor(() => {
      expect(readFileSync(target, 'utf8')).toContain('# Session export — slash-export')
    }, { timeout: 2_000, interval: 20 })

    const written = readFileSync(target, 'utf8')
    expect(written).toContain('导出这段对话')
    // runSlash 末尾 flushLiveRender 异步落盘渲染——轮询等待回显上屏。
    await vi.waitFor(() => {
      const rendered = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
      expect(rendered).toContain('会话已导出')
    }, { timeout: 2_000, interval: 20 })
    rmSync(dir, { recursive: true, force: true })
    await app.dispose()
  })

  it('/export 无参：默认写到会话 header.cwd 下 dsh-export-<id>.md（真实文件系统）', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('slash-export-default')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    // 会话 header 缺省无 cwd——测试显式注入（默认路径分支依赖 header.cwd）。
    const dir = mkdtempSync(join(tmpdir(), 'dsh-export-default-'))
    ;(agent.session.header as { cwd?: string }).cwd = dir
    const stdout = makeStdout()

    const app = new TuiApp({ ctx, stdout, stdin: makeStdin() })
    await app.newSession()
    app.handleSubmit('/export')
    // 默认路径 = join(header.cwd, `dsh-export-${session.id}.md`)；轮询落盘。
    const target = join(dir, 'dsh-export-slash-export-default.md')
    await vi.waitFor(() => {
      expect(readFileSync(target, 'utf8')).toContain('# Session export — slash-export-default')
    }, { timeout: 2_000, interval: 20 })

    await vi.waitFor(() => {
      const rendered = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
      expect(rendered).toContain('会话已导出')
    }, { timeout: 2_000, interval: 20 })
    rmSync(dir, { recursive: true, force: true })
    await app.dispose()
  })

  it('/export 无会话：exportTranscript 抛错，runSlash 回显失败（fails loud）', async () => {
    const ctx = makeCtx()
    const stdout = makeStdout()

    const app = new TuiApp({ ctx, stdout, stdin: makeStdin() })
    // 不 attach / 不 newSession——activeSessionId 为 null，exportTranscript 抛「当前无会话」。
    app.handleSubmit('/export')
    await vi.waitFor(() => {
      const rendered = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
      expect(rendered).toContain('命令执行失败')
    }, { timeout: 2_000, interval: 20 })
    await app.dispose()
  })

  it('/session list 经 listSessions 列出已知会话', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('slash-sess')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    ctx.sessions.list.mockReturnValue([agent.session])
    const stdout = makeStdout()

    const app = new TuiApp({ ctx, stdout, stdin: makeStdin() })
    await app.newSession()
    app.handleSubmit('/session list')
    await new Promise(resolve => setImmediate(resolve))

    expect(stdout.write.mock.calls.map(c => `${c[0]}`).join('')).toContain('slash-sess')
    await app.dispose()
  })

  it('未知 / 命令回显未知命令提示，不触发 followup', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('slash-unknown')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdout = makeStdout()

    const app = new TuiApp({ ctx, stdout, stdin: makeStdin() })
    await app.newSession()
    app.handleSubmit('/st')
    await new Promise(resolve => setImmediate(resolve))

    expect(agent.followup).not.toHaveBeenCalled()
    expect(stdout.write.mock.calls.map(c => `${c[0]}`).join('')).toContain('未知命令: /st')
    await app.dispose()
  })

  it('构造时把注册表注册为 tui.commands 服务（外部插件可扩展）', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('slash-svc')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)

    const app = new TuiApp({ ctx, stdout: makeStdout(), stdin: makeStdin() })
    await app.newSession()
    expect(ctx.provide).toHaveBeenCalledWith('tui.commands', expect.any(Object))
    await app.dispose()
  })

  it('构造后经 tui.commands 追加的命令进入斜杠菜单（含中文描述）', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('slash-ext')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdin = makeStdin()
    const stdout = makeStdout()

    const app = new TuiApp({ ctx, stdout, stdin, theme: 'paper' })
    const tuiCommands = ctx.provide.mock.calls.find(call => call[0] === 'tui.commands')?.[1] as {
      register(command: {
        name: string
        description: string
        argsHint?: string
        run: (args: { text: string; echo: (t: string) => void }) => void
      }): void
    }
    // 模拟外部插件在构造后注册（/next-workflow 的中文菜单项）。
    tuiCommands.register({
      name: 'next-workflow',
      description: '固定意图管线：规范 → 计划 → 批判 → 实现 → 验证 → 评审',
      argsHint: '[candidates] <objective>',
      run: () => {},
    })
    await app.attach()
    stdin.emit('data', '/next-w')
    await new Promise(resolve => setImmediate(resolve))

    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('/next-workflow [candidates] <objective>')
    expect(written).toContain('固定意图管线')
    await app.dispose()
  })

  it('/ 前缀输入渲染内联命令提示', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('slash-hint')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdin = makeStdin()
    const stdout = makeStdout()

    const app = new TuiApp({ ctx, stdout, stdin })
    await app.attach()
    stdin.emit('data', '/th')
    await new Promise(resolve => setImmediate(resolve))

    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('/theme <name>')
    await app.dispose()
  })

  it('用户键入 /theme paper 并回车：scrollback 回显切换确认（用户级验收）', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('slash-ux')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdin = makeStdin()
    const stdout = makeStdout()

    // 真实输入流水线：键盘字节流 → InputHandler → InputLine → onSubmit。
    // 显式主题 'paper' 跳过 attach 的背景探测，聚焦命令提交路径。
    const app = new TuiApp({ ctx, stdout, stdin, theme: 'paper' })
    await app.attach()
    stdin.emit('data', '/theme paper\r') // 键入命令 + 回车
    await new Promise(resolve => setTimeout(resolve, 40))

    expect(getActiveThemeName()).toBe('paper')
    expect(stdout.write.mock.calls.map(c => `${c[0]}`).join('')).toContain('主题已切换: paper')
    await app.dispose()
  })
})

describe('TuiApp agent 错误上屏', () => {
  it('agent/error 后 live 区渲染错误行（LLM 失败不再静默回到空闲）', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('err-1')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdout = makeStdout()

    // 显式主题跳过 attach 的背景探测，聚焦错误渲染路径。
    const app = new TuiApp({ ctx, stdout, stdin: makeStdin(), theme: 'paper' })
    await app.attach()

    // trackAgent 在 mountSession 时经 ctx.on('agent/error') 注册了处理器。
    const onError = ctx.on.mock.calls.find(call => call[0] === 'agent/error')?.[1] as
      | ((payload: { agent: { id: SessionId }; turn: number; step: number; error: unknown }) => void)
      | undefined
    if (onError === undefined) throw new Error('agent/error handler not registered')
    const id = app.sessionId
    if (id === null) throw new Error('no active session')
    onError({ agent: { id }, turn: 1, step: 0, error: new Error('AUTH: Authentication Fails') })
    // followup 是 mock（不会真发 running 清掉错误）；handleSubmit 顺带触发 renderLive。
    app.handleSubmit('retry')
    await new Promise(resolve => setImmediate(resolve))

    expect(stdout.write.mock.calls.map(c => `${c[0]}`).join('')).toContain('AUTH: Authentication Fails')
    await app.dispose()
  })
})

describe('TuiApp 流式提交', () => {
  it('assistant 流式文本在 message 边界 commit 进 scrollback', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('stream-1')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdout = makeStdout()

    const app = new TuiApp({ ctx, stdout, stdin: makeStdin(), theme: 'paper' })
    await app.attach()
    const id = app.sessionId
    if (id === null) throw new Error('no active session')
    const emit = sessionEventBus(ctx)
    emit(id, { seq: 1, time: 1, type: 'turn/start', data: { turn: 1 } })
    emit(id, { seq: 2, time: 2, type: 'assistant/chunk', data: { turn: 1, step: 0, chunk: { type: 'text-delta', text: '流式回复文本' } } })
    emit(id, { seq: 3, time: 3, type: 'assistant/message', data: { turn: 1, step: 0, message: { role: 'assistant', content: [{ type: 'text', text: '流式回复文本' }] } } })
    await new Promise(resolve => setImmediate(resolve))

    expect(stdout.write.mock.calls.map(c => `${c[0]}`).join('')).toContain('流式回复文本')
    await app.dispose()
  })

  it('hook/result 的 systemMessage 渲染为 scrollback 系统行,常规结果不渲染', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('hook-1')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdout = makeStdout()

    const app = new TuiApp({ ctx, stdout, stdin: makeStdin(), theme: 'paper' })
    await app.attach()
    const id = app.sessionId
    if (id === null) throw new Error('no active session')
    const emit = sessionEventBus(ctx)
    emit(id, { seq: 1, time: 1, type: 'turn/start', data: { turn: 1 } })
    emit(id, { seq: 2, time: 2, type: 'hook/result', data: { turn: 1, point: 'UserPromptSubmit', handlerId: 'h1', decision: 'pass', durationMs: 3, systemMessage: 'heads up from hook' } })
    emit(id, { seq: 3, time: 3, type: 'hook/result', data: { turn: 1, point: 'Stop', handlerId: 'h2', decision: 'pass', durationMs: 1 } })
    await new Promise(resolve => setImmediate(resolve))

    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('[hook] heads up from hook')
    await app.dispose()
  })

  it('aborted turn 的流式残文不进 scrollback', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('stream-2')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdout = makeStdout()

    const app = new TuiApp({ ctx, stdout, stdin: makeStdin(), theme: 'paper' })
    await app.attach()
    const id = app.sessionId
    if (id === null) throw new Error('no active session')
    const emit = sessionEventBus(ctx)
    emit(id, { seq: 1, time: 1, type: 'turn/start', data: { turn: 1 } })
    emit(id, { seq: 2, time: 2, type: 'assistant/chunk', data: { turn: 1, step: 0, chunk: { type: 'text-delta', text: '不应出现的残文' } } })
    app.handleAbort()
    emit(id, { seq: 3, time: 3, type: 'turn/end', data: { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } } })
    await new Promise(resolve => setImmediate(resolve))

    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('已取消')
    expect(written).not.toContain('不应出现的残文')
    await app.dispose()
  })

  it('aborted turn 的打断落定消息不把残文带回 scrollback', async () => {
    // 打断后 agent-loop 会把已流出的前缀落定成 interrupted assistant/message；
    // 该事件触发的 flushStream 在 discard 之后必须是 no-op——残文只靠 resume 重现。
    const ctx = makeCtx()
    const agent = makeAgent('stream-interrupted')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdout = makeStdout()

    const app = new TuiApp({ ctx, stdout, stdin: makeStdin(), theme: 'paper' })
    await app.attach()
    const id = app.sessionId
    if (id === null) throw new Error('no active session')
    const emit = sessionEventBus(ctx)
    emit(id, { seq: 1, time: 1, type: 'turn/start', data: { turn: 1 } })
    emit(id, { seq: 2, time: 2, type: 'assistant/chunk', data: { turn: 1, step: 0, chunk: { type: 'text-delta', text: '已流出的前缀残文' } } })
    app.handleAbort()
    emit(id, {
      seq: 3,
      time: 3,
      type: 'assistant/message',
      data: {
        turn: 1,
        step: 0,
        message: { content: [{ type: 'text', text: '已流出的前缀残文' }] },
        interrupted: true,
      },
    })
    emit(id, { seq: 4, time: 4, type: 'turn/end', data: { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } } })
    await new Promise(resolve => setImmediate(resolve))

    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('已取消')
    expect(written).not.toContain('已流出的前缀残文')
    await app.dispose()
  })
})

describe('TuiApp 命令面板（Ctrl+P overlay）', () => {
  async function bootPaletteApp() {
    const ctx = makeCtx()
    const agent = makeAgent('palette-1')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin, theme: 'paper' })
    await app.attach()
    return { app, stdin, stdout }
  }

  it('ctrl_p 打开面板（进 alt screen 并列出命令）', async () => {
    const { app, stdin, stdout } = await bootPaletteApp()

    stdin.emit('data', '\x10') // Ctrl+P = 0x10 → 打开命令面板
    await new Promise(resolve => setImmediate(resolve))

    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('\x1B[?1049h') // 进入 alternate screen buffer
    expect(written).toContain('/theme')      // 面板列出 slash 命令
    await app.dispose()
  })

  it('面板过滤 + Enter 回填 /clear 到输入行，再回车执行命令', async () => {
    const { app, stdin, stdout } = await bootPaletteApp()

    stdin.emit('data', '\x10') // Ctrl+P 打开
    await new Promise(resolve => setImmediate(resolve))
    stdin.emit('data', 'cl')   // 过滤 → /clear
    stdin.emit('data', '\r')   // Enter → 回填并关闭面板
    await new Promise(resolve => setImmediate(resolve))

    let written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('\x1B[?1049l') // 退出 alternate screen buffer

    stdin.emit('data', '\r')   // 提交 /clear
    await new Promise(resolve => setImmediate(resolve))
    written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('已清空') // 命令执行回显（回填文本真正进了输入行）
    await app.dispose()
  })

  it('ctrl_p 再按关闭面板（toggle）', async () => {
    const { app, stdin, stdout } = await bootPaletteApp()

    stdin.emit('data', '\x10')
    await new Promise(resolve => setImmediate(resolve))
    stdin.emit('data', '\x10') // 再按 Ctrl+P → 关闭
    await new Promise(resolve => setImmediate(resolve))

    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('\x1B[?1049l')
    await app.dispose()
  })

  it('Esc 关闭面板（不提交、不回填输入行——底栏 "Esc 关闭" 提示真实生效）', async () => {
    const { app, stdin, stdout } = await bootPaletteApp()

    stdin.emit('data', '\x10') // Ctrl+P 打开
    await new Promise(resolve => setImmediate(resolve))
    stdin.emit('data', '\x1b') // Esc：input-handler 经 escapeTimeoutMs(80ms) 后派发 'escape'
    await new Promise(resolve => setTimeout(resolve, 200)) // 等派发 + ticker 补绘主屏

    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('\x1B[?1049l')  // 退出 alternate screen buffer（面板已关闭）
    expect(written).not.toContain('❯ /theme') // 未提交：输入行不出现 /命令 回填
    await app.dispose()
  })

  it('Ctrl+C 关闭面板（与 Esc 同分支，不提交）', async () => {
    const { app, stdin, stdout } = await bootPaletteApp()

    stdin.emit('data', '\x10') // Ctrl+P 打开
    await new Promise(resolve => setImmediate(resolve))
    stdin.emit('data', '\x03') // Ctrl+C → 关闭面板（消费在面板块，不触发退出）
    await new Promise(resolve => setTimeout(resolve, 200))

    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('\x1B[?1049l')
    expect(written).not.toContain('❯ /theme')
    await app.dispose()
  })

  it('↓ 移动选中，Enter 回填第二项（方向键选择路径）', async () => {
    const { app, stdin, stdout } = await bootPaletteApp()

    stdin.emit('data', '\x10')    // Ctrl+P 打开
    await new Promise(resolve => setImmediate(resolve))
    stdin.emit('data', '\x1b[B')  // ↓ → 第二项（/session）
    await new Promise(resolve => setImmediate(resolve))
    stdin.emit('data', '\r')      // Enter → 回填并关闭面板
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setTimeout(resolve, 200)) // 等 ticker 补绘主屏输入行

    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('\x1B[?1049l') // 退出 alternate screen buffer
    // 回填的是第二项（❯ 输入行前缀 + /session），而非第一项 /theme
    expect(written).toContain('❯ /session')
    expect(written).not.toContain('❯ /theme')
    await app.dispose()
  })
})

describe('TuiApp T4 任务窗格（/tasks + sessionProjections）', () => {
  it('/tasks 打开后渲染投影快照；onChanged 变更实时更新', async () => {
    const ctx = makeCtx()
    let changeListener: ((s: { id: string }, key: string, value: unknown) => void) | null = null
    let mountedAgent: { session: { id: string } } | null = null
    // create 按传入 sessionId 铸造 agent（session.id 须与 mountSession 的 id 一致，
    // onChanged 回调按 id 过滤）
    ctx.agents.create.mockImplementation(({ sessionId }: { sessionId: string }) => {
      const agent = makeAgent(sessionId)
      mountedAgent = agent
      ctx.sessions.get.mockReturnValue(agent.session)
      return makeHandle(agent)
    })
    const onChanged = vi.fn((l: (s: { id: string }, key: string, value: unknown) => void) => {
      changeListener = l
      return () => { }
    })
    const snapshot = vi.fn(() => ({ values: { todos: [{ content: '理解问题', status: 'completed' }] } }))
    // 可选服务经 reflect.get 读取（Cordis 4 注入代理；未注册返回 undefined）
    const projections = { snapshot, onChanged }
    ctx.reflect.get.mockImplementation((name: string) => {
      if (name === 'sessionProjections') return projections
      return undefined
    })
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin })
    await app.attach()

    // 初始：面板未打开 → 无任务行
    let written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).not.toContain('📋 任务')

    // /tasks 打开 → 渲染任务行（attach 时 snapshot 已读）
    for (const ch of '/tasks') stdin.emit('data', ch)
    stdin.emit('data', '\r')
    await new Promise(resolve => setImmediate(resolve))
    written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('📋 任务')
    expect(written).toContain('[x] 理解问题')

    // onChanged 推送新快照 → 实时更新（mountedAgent.session.id 与 mountSession id 一致）
    expect(changeListener).not.toBeNull()
    stdout.write.mockClear()
    // 闭包变量经 as unknown 断言读取（TS 对闭包赋值的控制流推断不可靠，测试场景直读）
    const listener = changeListener as unknown as (s: { id: string }, key: string, value: unknown) => void
    const mounted = mountedAgent as unknown as { session: { id: string } }
    listener({ id: mounted.session.id }, 'todos', [{ content: '新任务', status: 'in_progress' }])
    await new Promise(resolve => setTimeout(resolve, 200))
    written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('⏳ 新任务')
    await app.dispose()
  })

  it('sessionProjections 服务缺失时 /tasks 打开回显警告（不渲染窗格）', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('task-2')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin })
    await app.attach()

    for (const ch of '/tasks') stdin.emit('data', ch)
    stdin.emit('data', '\r')
    await new Promise(resolve => setImmediate(resolve))
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).not.toContain('📋 任务')
    // fails loud：服务缺失回显警告，不再静默降级
    expect(written).toContain('sessionProjections 服务不可用')
    await app.dispose()
  })
})

describe('TuiApp T1.1 投影总线（ProjectionFacet 5 域）', () => {
  it('mountSession 一次性快照 5 域，onChanged 按 key 分流缓存', async () => {
    const ctx = makeCtx()
    let changeListener: ((s: { id: string }, key: string, value: unknown) => void) | null = null
    let mountedAgent: { session: { id: string } } | null = null
    ctx.agents.create.mockImplementation(({ sessionId }: { sessionId: string }) => {
      const agent = makeAgent(sessionId)
      mountedAgent = agent
      ctx.sessions.get.mockReturnValue(agent.session)
      return makeHandle(agent)
    })
    const onChanged = vi.fn((l: (s: { id: string }, key: string, value: unknown) => void) => {
      changeListener = l
      return () => { }
    })
    const snapshot = vi.fn(() => ({
      values: {
        todos: [{ content: '理解问题', status: 'completed' }],
        plan: { active: true, pending: false },
        goal: {
          goal: {
            id: 'g1',
            phase: 'active',
            objective: '测试目标',
            maxGoalRounds: 5,
          },
          roundsStarted: 1,
          createdAt: 0,
          updatedAt: 0,
        },
        subagent: { children: [] },
        subagentTiming: { runs: {} },
      },
    }))
    const projections = { snapshot, onChanged }
    ctx.reflect.get.mockImplementation((name: string) => {
      if (name === 'sessionProjections') return projections
      return undefined
    })
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin })
    await app.attach()

    // snapshot 一次性读取 5 域（T1.1 总线）
    expect(snapshot).toHaveBeenCalledTimes(1)
    let written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    // plan active → statusline 渲染 [plan] 徽标（T1.4 数据源）
    expect(written).toContain('[plan]')

    // /tasks 打开 → todos 域驱动任务窗格（T4 行为不回归）
    for (const ch of '/tasks') stdin.emit('data', ch)
    stdin.emit('data', '\r')
    await new Promise(resolve => setImmediate(resolve))
    written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('📋 任务')
    expect(written).toContain('[x] 理解问题')

    const listener = changeListener as unknown as (s: { id: string }, key: string, value: unknown) => void
    const mounted = mountedAgent as unknown as { session: { id: string } }

    // onChanged plan → 徽标随 active 切换（分流缓存）
    stdout.write.mockClear()
    listener({ id: mounted.session.id }, 'plan', { active: false, pending: false })
    await new Promise(resolve => setTimeout(resolve, 200))
    written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).not.toContain('[plan]')

    // onChanged todos → 任务窗格实时更新（分流缓存）
    stdout.write.mockClear()
    listener({ id: mounted.session.id }, 'todos', [{ content: '新任务', status: 'in_progress' }])
    await new Promise(resolve => setTimeout(resolve, 200))
    written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('⏳ 新任务')

    // onChanged 其他会话 id → 忽略（不污染当前会话投影）
    stdout.write.mockClear()
    listener({ id: 'other-session' }, 'plan', { active: true, pending: false })
    await new Promise(resolve => setTimeout(resolve, 200))
    written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).not.toContain('[plan]')

    // onChanged 其他域（goal/subagent/subagentTiming）→ 仅更新缓存（/status 数据源），不崩
    stdout.write.mockClear()
    listener({ id: mounted.session.id }, 'goal', { goal: { id: 'g2' } })
    listener({ id: mounted.session.id }, 'subagentTiming', { runs: { r1: 1 } })
    await new Promise(resolve => setTimeout(resolve, 200))
    await app.dispose()
  })

  it('sessionProjections 缺失时整体降级（任务窗格 / plan 徽标均不可用）', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('t11-2')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin })
    await app.attach()

    let written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).not.toContain('[plan]')
    for (const ch of '/tasks') stdin.emit('data', ch)
    stdin.emit('data', '\r')
    await new Promise(resolve => setImmediate(resolve))
    written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).not.toContain('📋 任务')
    // /status 打开 → 投影缓存缺失（整体降级）→ 状态面板不渲染
    for (const ch of '/status') stdin.emit('data', ch)
    stdin.emit('data', '\r')
    await new Promise(resolve => setImmediate(resolve))
    written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).not.toContain('◆ 目标')
    await app.dispose()
  })
})

describe('TuiApp T1.2 /status 面板接线（renderLive + 投影缓存）', () => {
  it('/status 打开后经 projectStatusPanel 渲染面板行（数据源为投影缓存）', async () => {
    const ctx = makeCtx()
    ctx.agents.create.mockImplementation(({ sessionId }: { sessionId: string }) => {
      const agent = makeAgent(sessionId)
      ctx.sessions.get.mockReturnValue(agent.session)
      return makeHandle(agent)
    })
    const snapshot = vi.fn(() => ({
      values: {
        todos: null,
        plan: { active: true, pending: false },
        goal: {
          goal: {
            id: 'g1',
            phase: 'active',
            objective: '测试目标',
            maxGoalRounds: 5,
          },
          roundsStarted: 1,
          createdAt: 0,
          updatedAt: 0,
        },
        subagent: { children: [] },
        subagentTiming: { runs: {} },
      },
    }))
    const projections = { snapshot, onChanged: vi.fn(() => () => { }) }
    ctx.reflect.get.mockImplementation((name: string) => {
      if (name === 'sessionProjections') return projections
      return undefined
    })
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin })
    await app.attach()

    // 初始：面板未打开 → 无状态面板行
    let written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).not.toContain('◆ 目标')

    // /status 打开 → 投影缓存进 projectStatusPanel，渲染行进 live 区
    for (const ch of '/status') stdin.emit('data', ch)
    stdin.emit('data', '\r')
    await new Promise(resolve => setImmediate(resolve))
    written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('◆ 目标')
    expect(written).toContain('📐 计划 · 进行中')

    // /status 关闭 → 面板行从 live 区消失（不渲染）。逐字符输入期间面板仍开
    // （Enter 才切换），中间帧合法含面板行——断言必须看最后一次写入的帧。
    stdout.write.mockClear()
    for (const ch of '/status') stdin.emit('data', ch)
    stdin.emit('data', '\r')
    await new Promise(resolve => setImmediate(resolve))
    const calls = stdout.write.mock.calls
    const lastFrame = String(calls[calls.length - 1]?.[0] ?? '')
    expect(lastFrame).not.toContain('◆ 目标')
    expect(lastFrame).not.toContain('📐 计划')
    await app.dispose()
  })
})

describe('TuiApp 投影层接线（turn-summary 摘要行 + /status 会话段）', () => {
  function bootApp(name = 'proj-1') {
    const ctx = makeCtx()
    const agent = makeAgent(name)
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin })
    return { ctx, agent, stdin, stdout, app }
  }

  /** 喂一个完整 turn：read_file（读，100ms）+ edit_file（改，1000ms）→ completed。 */
  function feedToolTurn(bus: ReturnType<typeof sessionEventBus>, id: SessionId): void {
    bus(id, { seq: 1, time: 1000, type: 'turn/start', data: { turn: 1 } })
    bus(id, { seq: 2, time: 1100, type: 'tool/call', data: { callId: 'c1', name: 'read_file', arguments: '{}', turn: 1, step: 0 } })
    bus(id, { seq: 3, time: 1200, type: 'tool/result', data: { turn: 1, step: 0, message: { id: 'm-c1', role: 'user', source: { kind: 'tool', callId: 'c1' }, content: [{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'ok' }] }] } } })
    bus(id, { seq: 4, time: 1300, type: 'tool/call', data: { callId: 'c2', name: 'edit_file', arguments: '{}', turn: 1, step: 1 } })
    bus(id, { seq: 5, time: 2300, type: 'tool/result', data: { turn: 1, step: 1, message: { id: 'm-c2', role: 'user', source: { kind: 'tool', callId: 'c2' }, content: [{ type: 'tool-result', toolCallId: 'c2', content: [{ type: 'text', text: 'done' }] }] } } })
    bus(id, { seq: 6, time: 2400, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  }

  it('turn/end（completed）且有工具调用 → 提交 turn 摘要行（读/改计数复用 tool-meta 家族）', async () => {
    const { ctx, app, stdout } = bootApp()
    await app.attach()
    const bus = sessionEventBus(ctx)
    const id = app.sessionId
    if (id === null) throw new Error('no active session')
    stdout.write.mockClear()
    feedToolTurn(bus, id)
    // 摘要行接在异步 flushStream 之后（等微任务/定时器链落定）
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('turn 1')
    expect(written).toContain('读1 改1')
    await app.dispose()
  })

  it('turn/end 无工具调用 → 不渲染摘要行', async () => {
    const { ctx, app, stdout } = bootApp()
    await app.attach()
    const bus = sessionEventBus(ctx)
    const id = app.sessionId
    if (id === null) throw new Error('no active session')
    stdout.write.mockClear()
    bus(id, { seq: 1, time: 1000, type: 'turn/start', data: { turn: 1 } })
    bus(id, { seq: 2, time: 2000, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).not.toContain('读0 改0')
    await app.dispose()
  })

  it('aborted turn 有工具调用也不渲染摘要行（部分统计会误导）', async () => {
    const { ctx, app, stdout } = bootApp()
    await app.attach()
    const bus = sessionEventBus(ctx)
    const id = app.sessionId
    if (id === null) throw new Error('no active session')
    stdout.write.mockClear()
    bus(id, { seq: 1, time: 1000, type: 'turn/start', data: { turn: 1 } })
    bus(id, { seq: 2, time: 1100, type: 'tool/call', data: { callId: 'c1', name: 'bash', arguments: '{}', turn: 1, step: 0 } })
    bus(id, { seq: 3, time: 2000, type: 'turn/end', data: { turn: 1, reason: { kind: 'aborted' } } })
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).not.toContain('读0 改0')
    await app.dispose()
  })

  it('/status 面板渲染会话汇总段（summary-state 本地 fold，不依赖宿主投影总线）', async () => {
    const { ctx, app, stdin, stdout } = bootApp()
    await app.attach()
    const bus = sessionEventBus(ctx)
    const id = app.sessionId
    if (id === null) throw new Error('no active session')
    feedToolTurn(bus, id)
    await new Promise(resolve => setImmediate(resolve))
    stdout.write.mockClear()
    for (const ch of '/status') stdin.emit('data', ch)
    stdin.emit('data', '\r')
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setTimeout(resolve, 150)) // 等一帧 ticker 渲染
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('Σ 会话')
    expect(written).toContain('回合 1')
    expect(written).toContain('工具 2')
    await app.dispose()
  })
})

describe('TuiApp T2.1/T2.2 多 agent 面板接线（委派树 + workflow 运行态）', () => {
  it('/subagents 打开后经 projectDelegationTree 渲染委派树行（listDescendants 预取缓存）', async () => {
    const ctx = makeCtx()
    ctx.agents.create.mockImplementation(({ sessionId }: { sessionId: string }) => {
      const agent = makeAgent(sessionId)
      ctx.sessions.get.mockReturnValue(agent.session)
      return makeHandle(agent)
    })
    ctx.reflect.get.mockImplementation((name: string) => {
      if (name === 'sessionProjections') return {
        snapshot: () => ({ values: {} }),
        onChanged: () => () => { },
      }
      if (name === 'subagents') return {
        activeExternalRuns: () => [],
        listDescendants: vi.fn(async () => ([
          { kind: 'child', id: 'child-1', parentId: 'root', depth: 1, activity: 'running', hasChildren: false, mode: 'continuable', label: '子代理A' },
        ])),
      }
      return undefined
    })
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin })
    await app.attach()
    await new Promise(resolve => setImmediate(resolve))
    for (const ch of '/subagents') stdin.emit('data', ch)
    stdin.emit('data', '\r')
    await new Promise(resolve => setImmediate(resolve))
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('🌳 委派')
    expect(written).toContain('子代理A')
    await app.dispose()
  })

  it('subagents 服务缺失时 /subagents 打开回显警告（不渲染树）', async () => {
    const ctx = makeCtx()
    ctx.agents.create.mockImplementation(({ sessionId }: { sessionId: string }) => {
      const agent = makeAgent(sessionId)
      ctx.sessions.get.mockReturnValue(agent.session)
      return makeHandle(agent)
    })
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin })
    await app.attach()
    await new Promise(resolve => setImmediate(resolve))
    for (const ch of '/subagents') stdin.emit('data', ch)
    stdin.emit('data', '\r')
    await new Promise(resolve => setImmediate(resolve))
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).not.toContain('🌳 委派')
    // fails loud：服务缺失回显警告，不再静默降级
    expect(written).toContain('subagents 服务不可用')
    await app.dispose()
  })

  it('/workflow 事件订阅驱动面板渲染（start 带 meta/agent-start/end → 缓存行）', async () => {
    const ctx = makeCtx()
    ctx.agents.create.mockImplementation(({ sessionId }: { sessionId: string }) => {
      const agent = makeAgent(sessionId)
      ctx.sessions.get.mockReturnValue(agent.session)
      return makeHandle(agent)
    })
    // 捕获事件监听器（makeCtx 的 on 是记录型 mock，不转发）；手动触发模拟事件流。
    const listeners = new Map<string, (...args: unknown[]) => void>()
    ctx.on.mockImplementation((name: string, handler: (...args: unknown[]) => void) => {
      listeners.set(name, handler)
      return () => { listeners.delete(name) }
    })
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin })
    await app.attach()
    const fire = (name: string, ...args: unknown[]) => { listeners.get(name)?.(...args) }
    fire('workflow/start', {
      id: 'wf-1',
      meta: { name: '调研脚本', description: '多 agent 调研', phases: [{ title: '准备' }, { title: '调研' }, { title: '收尾' }] },
    })
    fire('workflow/phase', { id: 'wf-1' }, '调研') // 属主第二参为裸 string（dsh-workflow Events）
    fire('workflow/agent-start', { id: 'wf-1' }, { seq: 1, label: '调研员' })
    fire('workflow/agent-end', { id: 'wf-1' }, { seq: 1, label: '调研员', outcome: 'completed' })
    fire('workflow/end', { id: 'wf-1' }, { stopReason: 'completed' })
    await new Promise(resolve => setImmediate(resolve))
    for (const ch of '/workflow') stdin.emit('data', ch)
    stdin.emit('data', '\r')
    await new Promise(resolve => setImmediate(resolve))
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('📜 工作流')
    // 终态 run 折叠进缓存：列表行含真实 run 名（meta.name，非 phase）、阶段数、
    // 描述（含注入的 run id 后缀）与 agent 计数。
    expect(written).toContain('[调研脚本]')
    expect(written).toContain('3 阶段')
    expect(written).toContain('1 个 agent')
    expect(written).toContain('多 agent 调研 (wf-1)')
    await app.dispose()
  })
})

describe('TuiApp T6 启动 context bar（C4 概念稿 A 顶部栏）', () => {
  it('attach 后 scrollback 含 cwd + 模型（+ 分支，可检测时）', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('start-1')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin })
    await app.attach()
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain(process.cwd())
    expect(written).toContain('mock/mock') // currentSelection 的 provider/model
    await app.dispose()
  })
})

describe('TuiApp API key 就绪（credentials 分层，非仅 env）', () => {
  const previousKey = process.env.DEEPSEEK_API_KEY

  afterEach(() => {
    if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = previousKey
  })

  function boot(opts: {
    credentials?: { configured: boolean; source?: string }
    credentialsError?: boolean
    envKey?: string
  } = {}): {
    app: TuiApp
    stdout: WriteStream & { write: ReturnType<typeof vi.fn> }
    describe: ReturnType<typeof vi.fn>
  } {
    if (opts.envKey === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = opts.envKey

    const ctx = makeCtx()
    const agent = makeAgent('key-1')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const describe = vi.fn(async () => {
      if (opts.credentialsError === true) throw new Error('bad facet')
      return {
        writable: true,
        configured: opts.credentials?.configured ?? false,
        ...(opts.credentials?.source === undefined ? {} : { source: opts.credentials.source }),
      }
    })
    if (opts.credentials !== undefined || opts.credentialsError === true) {
      const fallback = ctx.reflect.get.getMockImplementation() as (name: string) => unknown
      ctx.reflect.get.mockImplementation((name: string) => {
        if (name === 'credentials') return { describe }
        return fallback(name)
      })
    }
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin })
    return { app, stdout, describe }
  }

  it('credentials 报 file 已配置、env 未设 → footer 最终为 API ✓', async () => {
    const { app, stdout, describe } = boot({ credentials: { configured: true, source: 'file' } })
    await app.attach()
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written.lastIndexOf('API ✓')).toBeGreaterThan(written.lastIndexOf('API ✗'))
    expect(describe).toHaveBeenCalledWith('DEEPSEEK_API_KEY')
    await app.dispose()
  })

  it('credentials 未配置且 env 未设 → footer 最终为 API ✗', async () => {
    const { app, stdout } = boot({ credentials: { configured: false } })
    await app.attach()
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written.lastIndexOf('API ✗')).toBeGreaterThan(written.lastIndexOf('API ✓'))
    await app.dispose()
  })

  it('无 credentials 服务、env 已设 → footer 最终为 API ✓（env 兜底）', async () => {
    const { app, stdout, describe } = boot({ envKey: 'sk-test' })
    await app.attach()
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written.lastIndexOf('API ✓')).toBeGreaterThan(written.lastIndexOf('API ✗'))
    expect(describe).not.toHaveBeenCalled()
    await app.dispose()
  })

  it('credentials.describe 抛错、env 已设 → 回退 env，footer 最终为 API ✓', async () => {
    const { app, stdout, describe } = boot({ credentialsError: true, envKey: 'sk-test' })
    await app.attach()
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written.lastIndexOf('API ✓')).toBeGreaterThan(written.lastIndexOf('API ✗'))
    expect(describe).toHaveBeenCalledWith('DEEPSEEK_API_KEY')
    await app.dispose()
  })
})

describe('TuiApp /key 设置对话框与首启引导', () => {
  const previousKey = process.env.DEEPSEEK_API_KEY
  const ALT_ON = '\x1B[?1049h'
  const ALT_OFF = '\x1B[?1049l'

  afterEach(() => {
    if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = previousKey
    vi.unstubAllGlobals()
  })

  function bootKeyApp(opts: {
    configured: boolean
    writable?: boolean
    tty?: boolean
    set?: ReturnType<typeof vi.fn>
  }) {
    delete process.env.DEEPSEEK_API_KEY
    const ctx = makeCtx()
    const agent = makeAgent('key-dialog-1')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    let configured = opts.configured
    const describe = vi.fn(async () => ({ configured, writable: opts.writable ?? true }))
    const set = opts.set ?? vi.fn(async () => { configured = true })
    const fallback = ctx.reflect.get.getMockImplementation() as (name: string) => unknown
    ctx.reflect.get.mockImplementation((name: string) => {
      if (name === 'credentials') return { describe, set }
      return fallback(name)
    })
    const stdin = makeStdin()
    stdin.isTTY = opts.tty ?? false
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin })
    const written = () => stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    const altOnCount = () => stdout.write.mock.calls.filter(c => `${c[0]}`.includes(ALT_ON)).length
    return { app, stdin, stdout, written, altOnCount, describe, set }
  }

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

  it('缺 key 且交互 TTY → 首启自动打开一次设置对话框（Esc 可跳过）', async () => {
    const { app, stdin, written } = bootKeyApp({ configured: false, tty: true })
    await app.attach()
    await sleep(30) // openKeyDialog 的 describe 预检落定后才 activate
    expect(written()).toContain('设置 DeepSeek API Key')
    expect(written()).toContain(ALT_ON)
    stdin.emit('data', '\x1b') // Esc 跳过（孤立 ESC 经 escapeTimeoutMs 派发）
    await sleep(120)
    expect(written()).toContain(ALT_OFF)
    await app.dispose()
  })

  it('同 run 不重复弹（keyPromptShown 守护：restore/重进流程再次触发判定也不弹）', async () => {
    const { app, stdin, altOnCount } = bootKeyApp({ configured: false, tty: true })
    await app.attach()
    await sleep(30)
    expect(altOnCount()).toBe(1)
    stdin.emit('data', '\x1b')
    await sleep(120)
    const before = altOnCount()
    // 直接再触发首启判定（后续 restore 等流程的同款入口）——守护拒绝重弹
    ;(app as unknown as { maybeAutoOpenKeyDialog(): void }).maybeAutoOpenKeyDialog()
    await sleep(30)
    expect(altOnCount()).toBe(before)
    await app.dispose()
  })

  it('已配置 key（credentials 报 configured）→ 首启不自动弹', async () => {
    const { app, written } = bootKeyApp({ configured: true, tty: true })
    await app.attach()
    await sleep(30)
    expect(written()).not.toContain('设置 DeepSeek API Key')
    expect(written()).not.toContain(ALT_ON)
    await app.dispose()
  })

  it('非 TTY（管道/测试）缺 key 也不自动弹', async () => {
    const { app, written } = bootKeyApp({ configured: false, tty: false })
    await app.attach()
    await sleep(30)
    expect(written()).not.toContain(ALT_ON)
    expect(written()).toContain('API ✗')
    await app.dispose()
  })

  it('/key 打开对话框：探测 ok 保存后 onSaved 刷新（footer 翻 ✓），明文 key 不进渲染帧', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
    const { app, stdin, written, set } = bootKeyApp({ configured: false })
    await app.attach()
    for (const ch of '/key') stdin.emit('data', ch)
    stdin.emit('data', '\r')
    await sleep(40)
    expect(written()).toContain('设置 DeepSeek API Key')
    for (const ch of 'sk-testkey12345') stdin.emit('data', ch)
    stdin.emit('data', '\r') // Enter 提交 → 探测 ok → set 落盘 → 成功态
    await sleep(40)
    expect(set).toHaveBeenCalledWith('DEEPSEEK_API_KEY', 'sk-testkey12345')
    expect(written()).toContain('已保存并生效')
    expect(written()).not.toContain('sk-testkey12345')
    stdin.emit('data', '\r') // 成功态 Enter 关闭 → overlay 退出时 footer 重绘
    await sleep(40)
    expect(written()).toMatch(/API ✓/)
    await app.dispose()
  })

  it('/login 别名同入口打开对话框', async () => {
    const { app, stdin, written } = bootKeyApp({ configured: false })
    await app.attach()
    for (const ch of '/login') stdin.emit('data', ch)
    stdin.emit('data', '\r')
    await sleep(40)
    expect(written()).toContain('设置 DeepSeek API Key')
    await app.dispose()
  })
})

describe('TuiApp /key 供应商向导（多供应商密钥配置）', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

  /** 装配带 llm 目录/settings/credentials 三面替身的向导应用。 */
  function bootWizardApp() {
    const ctx = makeCtx()
    const agent = makeAgent('key-wizard-1')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const describe = vi.fn(async (ref: string) => ({ configured: ref === 'ANTHROPIC_API_KEY', writable: true }))
    const set = vi.fn(async () => {})
    const mutate = vi.fn(async () => {})
    const discover = vi.fn(async () => [{ id: 'claude-x' }])
    const fallback = ctx.reflect.get.getMockImplementation() as (name: string) => unknown
    ctx.reflect.get.mockImplementation((name: string) => {
      if (name === 'credentials') return { describe, set }
      if (name === 'settings') {
        return { describe: () => [{ ns: 'llm-pi-ai', value: { providers: {} } }], mutate }
      }
      if (name === 'llm') {
        return {
          listConfigurableProviders: () => [
            { provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [] },
            { provider: 'openrouter', displayName: 'openrouter', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openrouter'] },
            { provider: 'anthropic', displayName: 'anthropic', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'anthropic'] },
          ],
          discoverModels: discover,
          // 会话挂载的视觉刷新会读该面（与向导无关，桩齐避免炸桩）。
          resolveModelInfo: async () => ({ supportsVision: false }),
        }
      }
      return fallback(name)
    })
    // 默认模型在 openrouter → 供应商列表置首（● 当前）。
    ctx.agentDefaultModel = {
      currentSelection: () => ({ provider: 'openrouter', model: 'stealth/ox-alpha' }),
      saveSelection: vi.fn(async () => {}),
    } as never
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin })
    const written = () => stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    return { app, stdin, written, set, mutate, discover }
  }

  it('/key → 供应商列表（默认置首 + 已配置 ✓）→ 选中 → 参数化对话框 → 探测 ok 落盘并激活路由', async () => {
    const { app, stdin, written, set, mutate, discover } = bootWizardApp()
    await app.attach()
    for (const ch of '/key') stdin.emit('data', ch)
    stdin.emit('data', '\r')
    await sleep(60) // 各供应商 describe 状态 join 落定后才 activate picker
    const text = written()
    expect(text).toContain('选择供应商')
    // 已配置的 anthropic 带 ✓；默认 openrouter 排在 DeepSeek 之前（置首）。
    expect(text).toContain('anthropic ✓')
    expect(text.indexOf('openrouter')).toBeLessThan(text.indexOf('DeepSeek'))

    stdin.emit('data', '\r') // Enter 选中默认项 openrouter → 微任务链到 key 对话框
    await sleep(60)
    expect(written()).toContain('设置 openrouter API Key')

    for (const ch of 'sk-or-v1-wizard') stdin.emit('data', ch)
    stdin.emit('data', '\r')
    await sleep(80)
    // 探测走发现探针（带草稿 key 的真鉴权）；落盘用派生引用；激活补写最小 profile。
    expect(discover).toHaveBeenCalledWith('llm-pi-ai', { provider: 'openrouter', apiKey: 'sk-or-v1-wizard' })
    expect(set).toHaveBeenCalledWith('OPENROUTER_API_KEY', 'sk-or-v1-wizard')
    expect(mutate).toHaveBeenCalledWith('llm-pi-ai', [{
      op: 'set',
      path: ['providers', 'openrouter', 'apiKeyEnv'],
      value: 'OPENROUTER_API_KEY',
    }])
    expect(written()).toContain('✓ 已保存并生效')
    expect(written()).not.toContain('sk-or-v1-wizard')
    await app.dispose()
  })

  it('探测 AUTH 拒绝回输入态（key 不落盘、profile 不激活）', async () => {
    const { app, stdin, written, set, mutate, discover } = bootWizardApp()
    discover.mockImplementation(async () => { throw Object.assign(new Error('401'), { code: 'AUTH' }) })
    await app.attach()
    for (const ch of '/key') stdin.emit('data', ch)
    stdin.emit('data', '\r')
    await sleep(60)
    stdin.emit('data', '\r')
    await sleep(60)
    for (const ch of 'sk-or-v1-bad') stdin.emit('data', ch)
    stdin.emit('data', '\r')
    await sleep(60)
    expect(written()).toContain('Key 无效')
    expect(set).not.toHaveBeenCalled()
    expect(mutate).not.toHaveBeenCalled()
    await app.dispose()
  })

  it('llm 目录缺席 → 降级 DeepSeek 直开（既有行为不变）', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('key-wizard-2')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const describe = vi.fn(async () => ({ configured: false, writable: true }))
    const set = vi.fn(async () => {})
    const fallback = ctx.reflect.get.getMockImplementation() as (name: string) => unknown
    ctx.reflect.get.mockImplementation((name: string) => {
      if (name === 'credentials') return { describe, set }
      return fallback(name)
    })
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin })
    await app.attach()
    for (const ch of '/key') stdin.emit('data', ch)
    stdin.emit('data', '\r')
    await sleep(40)
    expect(stdout.write.mock.calls.map(c => `${c[0]}`).join('')).toContain('设置 DeepSeek API Key')
    await app.dispose()
  })
})

describe('TuiApp 会话交互 UX 对齐（显示层 = 实际能力）', () => {
  const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

  it('/config 凭据类目：llm 目录 + describe 状态行（Enter 进 /key 向导）', async () => {
    const ctx = makeCtx()
    const describe = vi.fn(async (ref: string) => {
      expect(ref).toBe('DEEPSEEK_API_KEY')
      return { configured: true, source: 'file', writable: true }
    })
    const fallback = ctx.reflect.get.getMockImplementation() as (name: string) => unknown
    ctx.reflect.get.mockImplementation((name: string) => {
      if (name === 'credentials') return { describe }
      if (name === 'llm') {
        return {
          listConfigurableProviders: () => [
            { provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [] },
          ],
          resolveModelInfo: async () => ({ supportsVision: false }),
        }
      }
      if (name === 'settings') {
        // llm-deepseek 段经 schema 缺省解析出 apiKeyEnv（真实 settings 行为）。
        return { describe: () => [{ ns: 'llm-deepseek', value: { apiKeyEnv: 'DEEPSEEK_API_KEY' } }] }
      }
      return fallback ? fallback(name) : undefined
    })
    const agent = makeAgent('cfg-key')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin })
    await app.attach()
    app.handleSubmit('/config')
    await new Promise(resolve => setTimeout(resolve, 40))
    // 类目序：模型 → 凭据（下移一次后其字段行可见）。
    stdin.emit('data', '[B')
    await new Promise(resolve => setTimeout(resolve, 60))
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('凭据')
    expect(written).toContain('DeepSeek')
    expect(written).toContain('file')
    expect(describe).toHaveBeenCalledWith('DEEPSEEK_API_KEY')
    await app.dispose()
  })

  it('/model 热切后 footer 显示新模型名（不再停在挂载时的旧名）', async () => {
    const ctx = makeCtx()
    Object.assign(ctx.agentDefaultModel, {
      currentSelection: vi.fn(() => ({ provider: 'deepseek', model: 'v4-flash' })),
      saveSelection: vi.fn(async () => { }),
    })
    const agent = makeAgent('mdl-footer')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin: makeStdin() })
    await app.attach()
    app.handleSubmit('/model deepseek/v4-turbo')
    await new Promise(resolve => setTimeout(resolve, 40))
    expect((app as unknown as { glanceModelName: string | null }).glanceModelName).toBe('v4-turbo')
    await app.dispose()
  })

  it('切到无 image 模态的模型后，发图走「图片未发送」（不沿用启动时的识图标志）', async () => {
    const ctx = makeCtx()
    const resolveModelInfo = vi.fn(async () => ({ supportsVision: false }))
    const fallback = ctx.reflect.get.getMockImplementation() as (name: string) => unknown
    ctx.reflect.get.mockImplementation((name: string) => {
      if (name === 'llm') return { resolveModelInfo }
      return fallback(name)
    })
    const agent = makeAgent('vision-hot')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdout = makeStdout()
    const app = new TuiApp({
      ctx, stdout, stdin: makeStdin(),
      vision: { supportsVision: true, bridgeEnabled: false },
    })
    await app.newSession()
    expect(app.switchLiveModel({ provider: 'deepseek', model: 'text-only' })).toBe(true)
    await new Promise(resolve => setTimeout(resolve, 40))
    app.handleSubmit('hi', [PNG_DATA_URL])
    await new Promise(resolve => setTimeout(resolve, 40))
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('图片未发送')
    const msg = agent.followup.mock.calls[0]?.[0] as { content?: unknown[] } | undefined
    expect(msg?.content).toEqual([{ type: 'text', text: 'hi' }])
    expect(resolveModelInfo).toHaveBeenCalledWith('deepseek', 'text-only')
    await app.dispose()
  })

  it('ctrl_s：persistence 有磁盘会话、live 只有当前 → resume 该磁盘会话', async () => {
    const ctx = makeCtx()
    const live = makeAgent('live-now')
    ctx.agents.create.mockResolvedValue(makeHandle(live))
    ctx.sessions.get.mockReturnValue(live.session)
    ctx.sessions.list.mockReturnValue([])
    const diskId = SessionId('session-disk-1')
    const diskHeader = {
      id: diskId, version: 0, createdAt: Date.now() - 1_000,
      cwd: '/tmp/disk-ws', parentSession: undefined,
    }
    const fallback = ctx.reflect.get.getMockImplementation() as (name: string) => unknown
    ctx.reflect.get.mockImplementation((name: string) => {
      if (name === 'sessionPersistence') {
        return { list: vi.fn(async () => [{ header: diskHeader }]) }
      }
      return fallback(name)
    })
    ctx.agents.get.mockReturnValue(undefined)
    const disk = makeAgent('disk-1')
    // session.id/header 在 Agent 类型上只读：mock 替身经 Object.assign 改形。
    Object.assign(disk.session, { id: diskId, header: { ...disk.session.header, id: diskId, cwd: '/tmp/disk-ws' } })
    ctx.agents.resume.mockResolvedValue(makeHandle(disk))
    const stdin = makeStdin()
    const app = new TuiApp({ ctx, stdout: makeStdout(), stdin })
    await app.attach()
    expect(app.sessionId).not.toBe(diskId)
    stdin.emit('data', '\x13')
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(ctx.agents.resume).toHaveBeenCalledWith(expect.objectContaining({ resumeSessionId: diskId }))
    expect(app.sessionId).toBe(diskId)
    await app.dispose()
  })

  it('顶栏与 @mention 使用会话 header.cwd，不是启动进程 cwd', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'session-cwd-'))
    writeFileSync(join(ws, 'notes.md'), '会话工作区笔记')
    const ctx = makeCtx()
    const id = SessionId('session-cwd-1')
    const agent = makeAgent('cwd-1')
    // session.id/header 在 Agent 类型上只读：mock 替身经 Object.assign 改形。
    Object.assign(agent.session, { id, header: { ...agent.session.header, id, cwd: ws } })
    ctx.sessions.list.mockReturnValue([{ id, header: agent.session.header, events: [] }])
    ctx.sessions.get.mockReturnValue(agent.session)
    ctx.agents.get.mockReturnValue(agent)
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin: makeStdin() })
    await app.attach()
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain(ws)
    app.handleSubmit('看 @notes.md')
    await new Promise(resolve => setTimeout(resolve, 40))
    expect(firstCallText(agent.followup)).toContain('会话工作区笔记')
    await app.dispose()
  })
})

describe('TuiApp forkSession（A3 会话分叉）', () => {
  it('fork 当前会话并切换：sessions.fork 被调、resume 到 child、返回新 id', async () => {
    const ctx = makeCtx()
    const parent = makeAgent('parent-1')
    const parentHandle = makeHandle(parent)
    ctx.agents.create.mockResolvedValue(parentHandle)
    ctx.sessions.get.mockReturnValue(parent.session)
    const child = makeAgent('child-1')
    const childHandle = makeHandle(child)
    ctx.sessions.fork.mockReturnValue(child.session)
    ctx.agents.resume.mockResolvedValue(childHandle)

    const app = new TuiApp({ ctx, stdout: makeStdout(), stdin: makeStdin() })
    const parentId = await app.newSession()
    const id = await app.forkSession()

    // 分叉源 = 当前会话 id（newSession 铸造的 id）
    expect(ctx.sessions.fork).toHaveBeenCalledWith(parentId)
    // 切换路径：child 无 live agent → resume
    expect(ctx.agents.resume).toHaveBeenCalledWith(expect.objectContaining({
      resumeSessionId: child.session.id,
    }))
    expect(id).toBe(child.session.id)
    await app.dispose()
  })

  it('无活跃会话时 forkSession 抛错', async () => {
    const ctx = makeCtx()
    const app = new TuiApp({ ctx, stdout: makeStdout(), stdin: makeStdin() })
    await expect(app.forkSession()).rejects.toThrow('无会话')
    expect(ctx.sessions.fork).not.toHaveBeenCalled()
    await app.dispose()
  })

  it('forkSession 带 directive → fork + 切换后 followup 提交 directive 为首条消息', async () => {
    const ctx = makeCtx()
    const parent = makeAgent('parent-2')
    const parentHandle = makeHandle(parent)
    ctx.agents.create.mockResolvedValue(parentHandle)
    ctx.sessions.get.mockReturnValue(parent.session)
    const child = makeAgent('child-2')
    const childHandle = makeHandle(child)
    ctx.sessions.fork.mockReturnValue(child.session)
    ctx.agents.resume.mockResolvedValue(childHandle)

    const app = new TuiApp({ ctx, stdout: makeStdout(), stdin: makeStdin() })
    const parentId = await app.newSession()
    const id = await app.forkSession({ directive: '探索另一种方案' })

    expect(ctx.sessions.fork).toHaveBeenCalledWith(parentId)
    expect(id).toBe(child.session.id)
    // followup 首条消息 = directive（转 user message 走 controls）
    expect(child.followup).toHaveBeenCalledTimes(1)
    expect(firstCallText(child.followup)).toBe('探索另一种方案')
    await app.dispose()
  })
})

describe('TuiApp switchLiveModel（C2 项 4 模型热切）', () => {
  it('newSession 后热切生效（返回 true）', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('hot-1')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    const app = new TuiApp({ ctx, stdout: makeStdout(), stdin: makeStdin() })
    await app.newSession()
    expect(app.switchLiveModel({ provider: 'openai', model: 'gpt-5' })).toBe(true)
    await app.dispose()
  })

  it('无活跃会话时热切不可用（返回 false）', async () => {
    const ctx = makeCtx()
    const app = new TuiApp({ ctx, stdout: makeStdout(), stdin: makeStdin() })
    expect(app.switchLiveModel({ provider: 'openai', model: 'gpt-5' })).toBe(false)
    await app.dispose()
  })

  it('switchSession 到 registry 已有 live agent → 仍可热切（交接主会话）', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('hot-registry-1')
    ctx.agents.get.mockReturnValue(agent)
    ctx.sessions.get.mockReturnValue(agent.session)
    const app = new TuiApp({ ctx, stdout: makeStdout(), stdin: makeStdin() })
    await app.switchSession(SessionId('hot-registry-1'))
    expect(app.switchLiveModel({ provider: 'openai', model: 'gpt-5', reasoningEffort: ReasoningEffortId('max') })).toBe(true)
    await app.dispose()
  })

  it('switchSession 到 resume 会话（无 live agent）→ 热切生效', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('hot-resume-1')
    const handle = makeHandle(agent)
    ctx.agents.get.mockReturnValue(undefined)
    ctx.agents.resume.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    const app = new TuiApp({ ctx, stdout: makeStdout(), stdin: makeStdin() })
    await app.switchSession(SessionId('hot-resume-1'))
    expect(app.switchLiveModel({ provider: 'openai', model: 'gpt-5' })).toBe(true)
    await app.dispose()
  })
})

describe('TuiApp 历史搜索 overlay（C2 项 2）', () => {
  async function setupApp() {
    const ctx = makeCtx()
    const agent = makeAgent('search-1')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin })
    await app.attach() // overlay 在 attach 中注册
    await app.newSession()
    return { app, stdin, stdout }
  }

  it('Ctrl+F 打开 overlay（渲染搜索提示），Esc 关闭', async () => {
    const { app, stdin, stdout } = await setupApp()
    stdin.emit('data', '\x06') // Ctrl+F → ctrl_f
    await new Promise(resolve => setTimeout(resolve, 30)) // 等 renderBatcher flush（16ms 合并）
    let written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('输入搜索词')
    stdout.write.mockClear()
    stdin.emit('data', '\x1b') // Esc 关闭
    await new Promise(resolve => setTimeout(resolve, 30))
    written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).not.toContain('输入搜索词')
    await app.dispose()
  })

  it('overlay 打开时字符进 query，n 跳转', async () => {
    const { app, stdin, stdout } = await setupApp()
    stdin.emit('data', '\x06') // Ctrl+F
    await new Promise(resolve => setTimeout(resolve, 30))
    stdout.write.mockClear()
    stdin.emit('data', 'w')
    await new Promise(resolve => setTimeout(resolve, 30))
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('w')
    stdin.emit('data', 'n') // goNext（空消息集 no-op，不抛错）
    stdin.emit('data', '\x1b')
    await app.dispose()
  })
})

describe('runSlash fallback 到 CommandService（A1）', () => {
  /** 带 commands 服务的 ctx 替身：reflect.get 按名字返回。 */
  async function setupApp(commands: { execute: ReturnType<typeof vi.fn>; find?: ReturnType<typeof vi.fn> } | undefined) {
    const ctx = makeCtx()
    const agent = makeAgent('fallback-1')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    ctx.agents.get.mockReturnValue(agent)
    ctx.reflect.get.mockImplementation((name: string) => (name === 'commands' ? commands : undefined))
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin: makeStdin() })
    await app.newSession()
    return { app, ctx, agent, stdout }
  }

  /** runSlash 是 async 且 handleSubmit 不 await——等一拍让执行落定。 */
  async function flush(): Promise<void> {
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))
  }

  it('未知名命令 + commands 可用 → execute 被调，回显 success 文本', async () => {
    const execute = vi.fn().mockResolvedValue({ result: { kind: 'success', text: '已进入 plan 模式' } })
    const { app, agent, stdout } = await setupApp({ execute })
    app.handleSubmit('/st')
    await flush()
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute.mock.calls[0]![0]).toBe(agent)
    expect(execute.mock.calls[0]![1]).toBe('/st')
    expect(execute.mock.calls[0]![2]).toBeInstanceOf(AbortSignal)
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('已进入 plan 模式')
    await app.dispose()
  })

  it('execute 返回 error → 回显 ⚠ 与错误文本', async () => {
    const execute = vi.fn().mockResolvedValue({ result: { kind: 'error', text: 'plan mode 不可用' } })
    const { app, stdout } = await setupApp({ execute })
    app.handleSubmit('/st')
    await flush()
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('⚠')
    expect(written).toContain('plan mode 不可用')
    await app.dispose()
  })

  it('execute 返回 undefined（未知名）→ 回显未知命令与可用列表', async () => {
    const execute = vi.fn().mockResolvedValue(undefined)
    const { app, stdout } = await setupApp({ execute })
    app.handleSubmit('/st')
    await flush()
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('未知命令')
    expect(written).toContain('/status')
    await app.dispose()
  })

  it('无会话 → 不调 execute，回显未知命令', async () => {
    const execute = vi.fn()
    const ctx = makeCtx()
    ctx.reflect.get.mockImplementation((name: string) => (name === 'commands' ? { execute } : undefined))
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin: makeStdin() })
    // 未 attach/newSession：activeSessionId 为 null
    app.handleSubmit('/st')
    await flush()
    expect(execute).not.toHaveBeenCalled()
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('未知命令')
    await app.dispose()
  })

  it('commands 服务不可用 → 不调 execute，回显未知命令（降级）', async () => {
    const execute = vi.fn()
    const { app, stdout } = await setupApp(undefined)
    app.handleSubmit('/st')
    await flush()
    expect(execute).not.toHaveBeenCalled()
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('未知命令')
    await app.dispose()
  })

  it('slash 提交携带图片 → ImageBlock 信封透传，成功后清空输入框图片', async () => {
    const execute = vi.fn().mockResolvedValue({ result: { kind: 'success', text: 'ok' } })
    // /plan 仅由插件注册（内置表无）：facet.find 命中使路径谓词不误判为文件路径。
    const find = vi.fn((_: unknown, name: string) => (name === 'plan' ? { name: 'plan' } : undefined))
    const { app, agent } = await setupApp({ execute, find })
    const clearImages = vi.spyOn(
      (app as unknown as { inputLine: { clearImages(): void } }).inputLine, 'clearImages',
    )
    app.handleSubmit('/plan 先起草迁移方案', ['data:image/png;base64,AAAA'])
    await flush()
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute.mock.calls[0]![0]).toBe(agent)
    expect(execute.mock.calls[0]![1]).toBe('/plan 先起草迁移方案')
    expect(execute.mock.calls[0]![2]).toBeInstanceOf(AbortSignal)
    expect(execute.mock.calls[0]![3]).toEqual([{ type: 'image', dataUrl: 'data:image/png;base64,AAAA' }])
    expect(clearImages).toHaveBeenCalledTimes(1)
    await app.dispose()
  })

  it('execute 返回 error → 保留输入框图片供修正重发', async () => {
    const execute = vi.fn().mockResolvedValue({ result: { kind: 'error', text: 'Image attachments cannot accompany /plan off.' } })
    const find = vi.fn((_: unknown, name: string) => (name === 'plan' ? { name: 'plan' } : undefined))
    const { app } = await setupApp({ execute, find })
    const clearImages = vi.spyOn(
      (app as unknown as { inputLine: { clearImages(): void } }).inputLine, 'clearImages',
    )
    app.handleSubmit('/plan off', ['data:image/png;base64,AAAA'])
    await flush()
    expect(execute).toHaveBeenCalledTimes(1)
    expect(clearImages).not.toHaveBeenCalled()
    await app.dispose()
  })

  it('slash 提交无图片 → execute 第 4 参为 undefined', async () => {
    const execute = vi.fn().mockResolvedValue({ result: { kind: 'success', text: 'ok' } })
    const { app } = await setupApp({ execute })
    app.handleSubmit('/st')
    await flush()
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute.mock.calls[0]![3]).toBeUndefined()
    await app.dispose()
  })
})

describe('TuiApp parseSlashCommand 导出', () => {
  it('内置命令唯一前缀命中并剥离参数', () => {
    expect(parseSlashCommand('/clear')).toEqual({ kind: 'clear', text: '' })
    expect(parseSlashCommand('/session new')).toEqual({ kind: 'session', text: 'new' })
  })

  it('未知名命令 → null', () => {
    expect(parseSlashCommand('/st')).toBeNull()
  })
})

describe('TuiApp slash 命令分发路径（deps 闭包）', () => {
  it('/session new 触发 newSession 闭包并回显新 id', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('cmd-new-1')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin: makeStdin() })
    await app.attach()
    const before = ctx.agents.create.mock.calls.length

    app.handleSubmit('/session new')
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))

    expect(ctx.agents.create.mock.calls.length).toBe(before + 1)
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('已新建会话')
    await app.dispose()
  })

  it('/fork 无活跃会话 → runSlash catch 回显 ⚠ 命令执行失败', async () => {
    const ctx = makeCtx()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin: makeStdin() })
    app.handleSubmit('/fork')
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))

    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('命令执行失败')
    expect(written).toContain('可分叉')
    await app.dispose()
  })

  it('slash handler 抛字符串 → String(err) 分支回显（runSlash catch 非 Error）', async () => {
    const ctx = makeCtx()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin: makeStdin() })
    // 注册一个会抛字符串的扩展命令（经 ctx.provide 暴露的 registry）
    const registry = (ctx as unknown as { provide(name: string, svc: unknown): void })
    const slash = (app as unknown as { slash: { register(c: unknown): void } }).slash
    slash.register({
      name: 'boomcmd',
      description: '抛字符串',
      run: () => { throw 'kaboom string' },
    })
    void registry
    app.handleSubmit('/boomcmd')
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))

    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('命令执行失败')
    expect(written).toContain('kaboom string')
    await app.dispose()
  })
})

describe('TuiApp /config /skills /density 面板命令', () => {
  it('/config 打开再关闭：服务缺失 → projection null 不渲染（双分支）', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('cfg-1')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin: makeStdin() })
    await app.attach()

    app.handleSubmit('/config') // 打开 → refreshConfigProjection（全缺失 → null）
    await new Promise(resolve => setImmediate(resolve))
    app.handleSubmit('/config') // 关闭 → configPanelVisible=false 不再刷新
    await new Promise(resolve => setImmediate(resolve))
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).not.toContain('未知命令') // 命令已注册，不走未知命令分支
    await app.dispose()
  })

  it('/config 打开：settings/permission 服务存在 → 投影渲染', async () => {
    const ctx = makeCtx()
    ctx.reflect.get.mockImplementation((name: string) => {
      if (name === 'settings') return { describe: vi.fn(() => [{ ns: 'model', value: 'deepseek' }]) }
      if (name === 'permission') return { names: ['run_shell'], current: vi.fn(() => 'ask') }
      return undefined
    })
    const agent = makeAgent('cfg-2')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin: makeStdin() })
    await app.attach()

    app.handleSubmit('/config')
    await new Promise(resolve => setImmediate(resolve))
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('model')
    await app.dispose()
  })

  it('/config 模型类目：默认模型 + 三角色 pin/跟随默认 两态渲染（modelRoles 经 ctx.get 现取）', async () => {
    const ctx = makeCtx()
    ctx.get.mockImplementation((name: string) => name === 'modelRoles'
      ? { resolve: vi.fn((role: string) => role === 'vision' ? { provider: 'openai', model: 'gpt-5-vision' } : undefined) }
      : undefined)
    ctx.reflect.get.mockImplementation((name: string) => {
      if (name === 'settings') return { describe: vi.fn(() => [{ ns: 'model', value: 'deepseek' }]) }
      return undefined
    })
    const agent = makeAgent('cfg-roles')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin: makeStdin() })
    await app.attach()

    app.handleSubmit('/config')
    await new Promise(resolve => setTimeout(resolve, 40))
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('模型')
    expect(written).toContain('默认模型')
    expect(written).toContain('mock/mock')
    expect(written).toContain('openai/gpt-5-vision')
    expect(written).toContain('跟随默认')
    await app.dispose()
  })

  it('/skills 打开：服务缺失 → 空态占位；服务存在 → 列表渲染', async () => {
    const ctx = makeCtx()
    ctx.reflect.get.mockImplementation((name: string) => {
      if (name === 'skills') return {
        list: vi.fn(async () => [{ name: 'code-review', description: '代码审查', provider: 'mock', source: 'builtin', invocation: 'manual' }]),
      }
      return undefined
    })
    const agent = makeAgent('skill-1')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin: makeStdin() })
    await app.attach()

    app.handleSubmit('/skills')
    await new Promise(resolve => setImmediate(resolve))
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('code-review')
    await app.dispose()
  })

  it('/skills 服务缺失 → skillItems 空数组，面板渲染空态', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('skill-2')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin: makeStdin() })
    await app.attach()

    app.handleSubmit('/skills')
    await new Promise(resolve => setImmediate(resolve))
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('技能')
    await app.dispose()
  })

  it('skills.list reject → 空数组降级', async () => {
    const ctx = makeCtx()
    ctx.reflect.get.mockImplementation((name: string) => {
      if (name === 'skills') return { list: vi.fn(async () => { throw new Error('boom') }) }
      return undefined
    })
    const agent = makeAgent('skill-3')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin: makeStdin() })
    await app.attach()

    app.handleSubmit('/skills')
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('技能')
    await app.dispose()
  })

  it('/skills 二次切换 → 面板关闭，refreshSkillItems 不再调用（L476 分支）', async () => {
    const ctx = makeCtx()
    const list = vi.fn(async () => [])
    ctx.reflect.get.mockImplementation((name: string) => {
      if (name === 'skills') return { list }
      return undefined
    })
    const agent = makeAgent('skill-4')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin: makeStdin() })
    await app.attach()

    app.handleSubmit('/skills')
    await new Promise(resolve => setTimeout(resolve, 30))
    const firstCalls = list.mock.calls.length
    app.handleSubmit('/skills')
    await new Promise(resolve => setTimeout(resolve, 30))
    // 第二次切换时面板已开 → 只翻转可见性，不再刷新快照
    expect(list.mock.calls.length).toBe(firstCalls)
    await app.dispose()
  })

  it('/density 切换 compactMode（两次调用不崩）', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('density-1')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin: makeStdin() })
    await app.attach()

    app.handleSubmit('/density')
    await new Promise(resolve => setImmediate(resolve))
    app.handleSubmit('/density')
    await new Promise(resolve => setImmediate(resolve))
    // 输入行渲染仍正常（compactMode 只影响工具卡）
    app.handleSubmit('ok')
    await new Promise(resolve => setImmediate(resolve))
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('ok')
    await app.dispose()
  })
})

describe('TuiApp 生命周期边界', () => {
  it('dispose 后再 attach 抛错（已处置保护）', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('re-attach')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const app = new TuiApp({ ctx, stdout: makeStdout(), stdin: makeStdin() })
    await app.attach()
    await app.dispose()
    await expect(app.attach()).rejects.toThrow('TuiApp already disposed')
  })

  it('dispose 幂等（二次调用直接返回）', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('dispose-2')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    const app = new TuiApp({ ctx, stdout: makeStdout(), stdin: makeStdin() })
    await app.attach()
    await app.dispose()
    await app.dispose()
    expect(handle.dispose).toHaveBeenCalledTimes(1)
  })

  it('refreshSessions 委托 listSessions 返回会话列表', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('refresh-1')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.agents.get.mockReturnValue(agent) // attach 的 target 走 registry 兜底
    ctx.sessions.get.mockReturnValue(agent.session)
    ctx.sessions.list.mockReturnValue([agent.session])
    const app = new TuiApp({ ctx, stdout: makeStdout(), stdin: makeStdin() })
    await app.attach()
    const summaries = await app.refreshSessions()
    expect(Array.isArray(summaries)).toBe(true)
    expect(summaries.length).toBeGreaterThan(0)
    await app.dispose()
  })
})

describe('TuiApp 事件回调驱动（resize / keymap / userInteraction）', () => {
  it('resize 事件触发 renderLive（onResize 防抖回调）', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('resize-1')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdout = makeStdout()
    let resizeHandler: (() => void) | null = null
    stdout.on = vi.fn((ev: string, h: () => void) => {
      if (ev === 'resize') resizeHandler = h
    }) as unknown as typeof stdout.on
    const app = new TuiApp({ ctx, stdout, stdin: makeStdin() })
    await app.attach()
    stdout.write.mockClear()
    stdout.columns = 101 // 尺寸变化才触发 resize 回调（scheduleCallback 比对缓存值）
    ;(resizeHandler as (() => void) | null)?.()
    await new Promise(resolve => setTimeout(resolve, 200))
    expect(stdout.write).toHaveBeenCalled()
    await app.dispose()
  })

  it('Ctrl+. 打开/关闭快捷键面板（keymap overlay 渲染回调）', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('keymap-1')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin, theme: 'paper' })
    await app.attach()

    stdin.emit('data', '\x1e') // Ctrl+. = 0x1e（RS）→ 打开 keymap
    await new Promise(resolve => setImmediate(resolve))
    let written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('\x1B[?1049h')

    stdin.emit('data', '\x1e') // 再按 → 关闭
    await new Promise(resolve => setImmediate(resolve))
    written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('\x1B[?1049l')
    await app.dispose()
  })

  it('userInteraction 服务存在 → attach 时注册 ask provider', async () => {
    const ctx = makeCtx()
    let provider: { ask: (request: unknown) => Promise<unknown> } | null = null
    const registerProvider = vi.fn((p: { ask: (request: unknown) => Promise<unknown> }) => {
      provider = p
      return () => { }
    })
    ctx.reflect.get.mockImplementation((name: string) => {
      if (name === 'userInteraction') return { registerProvider }
      return undefined
    })
    const agent = makeAgent('ui-1')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const app = new TuiApp({ ctx, stdout: makeStdout(), stdin: makeStdin() })
    await app.attach()

    expect(registerProvider).toHaveBeenCalledTimes(1)
    expect(provider).not.toBeNull()
    await app.dispose()
  })
})

describe('TuiApp T3.1 结构化提问结算', () => {
  /** 装配带 userInteraction 服务的 app，返回 provider 引用。 */
  async function bootQuestionApp() {
    const ctx = makeCtx()
    let provider: { ask: (request: unknown) => Promise<unknown> } | null = null
    ctx.reflect.get.mockImplementation((name: string) => {
      if (name === 'userInteraction') return {
        registerProvider: (p: { ask: (request: unknown) => Promise<unknown> }) => {
          provider = p
          return () => { }
        },
      }
      return undefined
    })
    const agent = makeAgent('q-1')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin })
    await app.attach()
    return { app, stdin, stdout, provider: () => provider }
  }

  it('ask 挂起 → 数字键选选项结算（resolve 带选项值）', async () => {
    const { app, stdin, stdout, provider } = await bootQuestionApp()

    const askPromise = provider()!.ask({
      questions: [{ id: 'opt-1', question: '继续执行？', options: [{ label: '是' }, { label: '否' }] }],
    })
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('继续执行？')

    stdout.write.mockClear()
    stdin.emit('data', '1')
    await expect(askPromise).resolves.toEqual({ answers: [{ id: 'opt-1', selected: ['是'] }] })
    await app.dispose()
  })

  it('Esc 取消提问 → reject UserInteractionError(ASK_CANCELLED)', async () => {
    const { app, stdin, provider } = await bootQuestionApp()

    const askPromise = provider()!.ask({
      questions: [{ id: 'q1', question: '继续？' }],
    })
    stdin.emit('data', '\x1b')
    await expect(askPromise).rejects.toMatchObject({ code: 'ASK_CANCELLED' })
    await app.dispose()
  })

  it('挂起中重复 ask → reject UserInteractionError(ASK_CANCELLED)（重叠保护）', async () => {
    const { app, provider } = await bootQuestionApp()

    void provider()!.ask({ questions: [{ id: 'q1', question: '第一次' }] })
    const second = provider()!.ask({ questions: [{ id: 'q2', question: '第二次' }] })
    await expect(second).rejects.toMatchObject({ code: 'ASK_CANCELLED' })
    await app.dispose()
  })

  it('切会话（newSession）→ 挂起提问 reject ASK_CANCELLED（跨会话残留修复）', async () => {
    const { app, provider } = await bootQuestionApp()

    const askPromise = provider()!.ask({
      questions: [{ id: 'q-leak', question: '会话 A 挂起？' }],
    })
    // 会话 A 挂起的 plan-review 卡不得残留到新会话：detachProjections
    // 卸载投影时 cancel（与 approval settle('cancelled') 对齐），否则会话 B
    // 按键/渲染仍命中会话 A 的 ask promise。
    await app.newSession()
    await expect(askPromise).rejects.toMatchObject({ code: 'ASK_CANCELLED' })
    await app.dispose()
  })

  it('plan-review：f 键进入反馈模式，Enter 提交 Keep planning + custom 反馈', async () => {
    const { app, stdin, stdout, provider } = await bootQuestionApp()

    const askPromise = provider()!.ask({
      questions: [{
        id: 'plan-review',
        question: '批准该计划？',
        options: [{ label: 'Approve' }, { label: 'Keep planning' }],
        intent: { kind: 'plan-review', approve: 'Approve' },
      }],
    })
    stdout.write.mockClear()
    stdin.emit('data', 'f')
    // 反馈模式提示渲染
    const hint = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(hint).toContain('反馈')
    // 输入反馈文本并提交
    stdin.emit('data', 'x')
    stdin.emit('data', 'y')
    stdin.emit('data', '\r')
    await expect(askPromise).resolves.toEqual({
      answers: [{ id: 'plan-review', selected: ['Keep planning'], custom: 'xy' }],
    })
    await app.dispose()
  })

  it('plan-review：反馈模式下 Esc 返回选项态（不结算）', async () => {
    const { app, stdin, stdout, provider } = await bootQuestionApp()

    const askPromise = provider()!.ask({
      questions: [{
        id: 'plan-review',
        question: '批准该计划？',
        options: [{ label: 'Approve' }, { label: 'Keep planning' }],
        intent: { kind: 'plan-review', approve: 'Approve' },
      }],
    })
    stdout.write.mockClear()
    stdin.emit('data', 'f')
    stdin.emit('data', '\x1b') // 退出反馈模式
    stdin.emit('data', '1') // 回到选项态：数字键批准
    await expect(askPromise).resolves.toEqual({
      answers: [{ id: 'plan-review', selected: ['Approve'] }],
    })
    await app.dispose()
  })
})

describe('TuiApp resume 模型定路分支', () => {
  it('resume 沿用持久化 header 的 reasoningEffort（三元展开）', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('eff-1')
    agent.session.requestHeader.mockReturnValue({
      config: { provider: 'deepseek', model: 'deepseek-r1', reasoningEffort: 'high' },
    })
    ctx.agents.get.mockReturnValue(undefined)
    ctx.agents.resume.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const app = new TuiApp({ ctx, stdout: makeStdout(), stdin: makeStdin() })
    await app.switchSession(SessionId('eff-1'))
    expect(ctx.agents.resume).toHaveBeenCalledTimes(1)
    const options = ctx.agents.resume.mock.calls[0]?.[0] as {
      agentOptions?: { provider: string; model: string; reasoningEffort?: string }
      setup?: (c: unknown) => void
    }
    expect(options.agentOptions).toEqual({
      provider: 'deepseek',
      model: 'deepseek-r1',
      reasoningEffort: 'high',
    })
    expect(options.setup).toBeTypeOf('function')
    await app.dispose()
  })

  it('resume 的 setup 经 installModelSelection 接线', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('setup-1')
    ctx.agents.get.mockReturnValue(undefined)
    ctx.agents.resume.mockImplementation((options: { setup?: (c: unknown) => void }) => {
      const agentCtx = { on: vi.fn(() => () => { }) }
      options.setup?.(agentCtx)
      return makeHandle(agent)
    })
    ctx.sessions.get.mockReturnValue(agent.session)
    const app = new TuiApp({ ctx, stdout: makeStdout(), stdin: makeStdin() })
    await app.switchSession(SessionId('setup-1'))
    await app.dispose()
  })

  it('mountSession 未知会话抛错（sessions.get undefined）', async () => {
    const ctx = makeCtx()
    ctx.agents.create.mockResolvedValue(makeHandle(makeAgent('ghost')))
    ctx.sessions.get.mockReturnValue(undefined)
    const app = new TuiApp({ ctx, stdout: makeStdout(), stdin: makeStdin() })
    await expect(app.newSession()).rejects.toThrow('unknown session')
    await app.dispose()
  })
})

/** 装配捕获事件监听器的 app，返回 fire 辅助（多个同名 handler 全量派发）。 */
async function bootEventApp() {
  const ctx = makeCtx()
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>()
  ctx.on.mockImplementation((name: string, h: (...args: unknown[]) => void) => {
    const list = handlers.get(name) ?? []
    list.push(h)
    handlers.set(name, list)
    return () => { }
  })
  const agent = makeAgent('evt-1')
  ctx.agents.create.mockResolvedValue(makeHandle(agent))
  ctx.sessions.get.mockReturnValue(agent.session)
  const stdout = makeStdout()
  const stdin = makeStdin()
  const app = new TuiApp({ ctx, stdout, stdin })
  await app.newSession()
  // 真实装配语义：newSession 铸造的 session 其 id === 铸造 id，transcript/statusline/
  // streamFeed 三处过滤都匹配同一 id。mock 需把 session.id 同步为 app.sessionId，
  // 否则 transcript 用 evt-1、其余两处用 session-<uuid>，事件无法同时命中三处。
  ;(agent.session as { id: SessionId }).id = app.sessionId ?? SessionId('evt-1')
  ;(agent as { id: SessionId }).id = agent.session.id
  ctx.sessions.get.mockReturnValue(agent.session)
  const owner = { id: app.sessionId ?? SessionId('evt-1') }
  return {
    app,
    ctx,
    stdout,
    stdin,
    owner,
    fire: (name: string, ...args: unknown[]) => {
      for (const h of handlers.get(name) ?? []) h(...args)
    },
  }
}

describe('TuiApp 会话事件流防御分支', () => {
  it('session/event 其他会话 owner → 订阅过滤不处理', async () => {
    const { app, fire } = await bootEventApp()
    fire('session/event', { id: SessionId('session-other') }, {
      type: 'assistant/chunk',
      seq: 0,
      time: 1,
      data: { chunk: { type: 'text-delta', text: '应被过滤' } },
    })
    await new Promise(resolve => setTimeout(resolve, 30))
    await app.dispose()
  })

  it('assistant/chunk 非 text-delta → 跳过 blockWriter（分支 2）', async () => {
    const { app, owner, fire } = await bootEventApp()
    fire('session/event', owner, {
      type: 'assistant/chunk',
      seq: 0,
      time: 1,
      data: { chunk: { type: 'tool-call', text: 'x' } },
    })
    await new Promise(resolve => setImmediate(resolve))
    await app.dispose()
  })

  it('流式尾巴：无稳定边界的 text-delta 留在 live 区渲染（getLiveTailLines 路径）', async () => {
    const { app, owner, fire, stdout } = await bootEventApp()
    // 无空行/闭合围栏 → findStableBoundary 0 → pending 累积，live 尾巴原始文本渲染。
    // blockWriter minChars 60 > 文本长度 → 走 idleMs 180ms 超时吐块，等 300ms 覆盖
    // 吐块 + WriteBatcher 16ms 帧两段延迟。
    fire('session/event', owner, {
      type: 'assistant/chunk',
      seq: 0,
      time: 1,
      data: { chunk: { type: 'text-delta', text: '你好，世界' } },
    })
    await new Promise(resolve => setTimeout(resolve, 300))
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('你好，世界')
    await app.dispose()
  })

  it('turn/start 推进 glance turn 计数（turn >= 0 分支）', async () => {
    const { app, stdout, owner, fire } = await bootEventApp()
    fire('session/event', owner, { type: 'turn/start', seq: 0, time: 1, data: { turn: 0 } })
    app.handleSubmit('推进渲染')
    // C2 渲染管线：WriteBatcher 16ms 帧合并——setImmediate 等不到合并帧。
    await new Promise(resolve => setTimeout(resolve, 30))
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written.length).toBeGreaterThan(0)
    await app.dispose()
  })

  it('turn 内有消息时 glance 含 elapsedMs（firstInTurn 命中分支）', async () => {
    const { app, stdout, owner, fire } = await bootEventApp()
    fire('session/event', owner, { type: 'turn/start', seq: 0, time: 1, data: { turn: 0 } })
    fire('session/event', owner, { type: 'assistant/message', seq: 1, time: 2, data: { turn: 0, step: 0, message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] } } })
    app.handleSubmit('推进渲染')
    await new Promise(resolve => setTimeout(resolve, 30))
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written.length).toBeGreaterThan(0)
    await app.dispose()
  })

  it('tool/result：文本长度统计 + 非 text 块 + 未知 callId 降级 name', async () => {
    const { app, owner, fire } = await bootEventApp()
    // 先 tool/call 进 tools（findLast 有记录可遍历）
    fire('session/event', owner, {
      type: 'tool/call',
      seq: 0,
      time: 1,
      data: { callId: 'c1', name: 'read_file', arguments: '{}', turn: 1, step: 0 },
    })
    // 匹配 c1：block.content 含非 text 块（reduce 0 分支）+ 命中 name
    fire('session/event', owner, {
      type: 'tool/result',
      seq: 1,
      time: 2,
      data: {
        message: { content: [{ type: 'tool-result', content: [{ type: 'image' }] }], source: { callId: 'c1' } },
      },
    })
    // 未知 callId：findLast 遍历不命中 → ?? 'tool' 降级
    fire('session/event', owner, {
      type: 'tool/result',
      seq: 2,
      time: 3,
      data: {
        message: { content: [{ type: 'tool-result', content: [{ type: 'text', text: 'abc' }] }], source: { callId: 'ghost' } },
      },
    })
    await new Promise(resolve => setImmediate(resolve))
    await app.dispose()
  })

  it('进行中工具卡渲染：参数可解析与不可解析两分支', async () => {
    const { app, stdout, owner, fire } = await bootEventApp()
    fire('session/event', owner, {
      type: 'tool/call',
      seq: 0,
      time: 1,
      data: { callId: 'pc1', name: 'bash', arguments: '{"cmd":"ls"}', turn: 1, step: 0 },
    })
    fire('session/event', owner, {
      type: 'tool/call',
      seq: 1,
      time: 2,
      data: { callId: 'pc2', name: 'grep', arguments: 'not-json', turn: 1, step: 1 },
    })
    app.handleSubmit('刷新渲染')
    // C2 渲染管线：WriteBatcher 16ms 帧合并——setImmediate 等不到合并帧。
    await new Promise(resolve => setTimeout(resolve, 30))
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    // 工具卡标题用语义动词（family verb 映射）：bash → Run、grep → Search。
    expect(written).toContain('Run')
    expect(written).toContain('Search')
    await app.dispose()
  })

  it('进行中工具超过 LIVE_TOOL_CARD_MAX：只展开最新一张，溢出一行', async () => {
    const { app, stdout, owner, fire } = await bootEventApp()
    stdout.rows = 40
    const tools = [
      { callId: 't1', name: 'bash' },
      { callId: 't2', name: 'grep' },
      { callId: 't3', name: 'read_file' },
      { callId: 't4', name: 'web_fetch' },
    ]
    for (const [i, tool] of tools.entries()) {
      fire('session/event', owner, {
        type: 'tool/call',
        seq: i,
        time: i + 1,
        data: { callId: tool.callId, name: tool.name, arguments: '{}', turn: 1, step: i },
      })
    }
    app.handleSubmit('刷新渲染')
    await new Promise(resolve => setTimeout(resolve, 30))
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('…(+1) 个工具进行中')
    expect(written).toContain('Search')
    expect(written).toContain('Read')
    expect(written).toContain('Fetch')
    const plain = written.replace(/\x1B\[[0-9;?]*[ -/]*[@-~]/g, '')
    expect((plain.match(/⎿  …/g) ?? []).length).toBe(1)
    await app.dispose()
  })
})

describe('TuiApp 结算卡与推理通道', () => {
  it('tool/result → 结算卡实时 commit 进 scrollback（流式文本在前）', async () => {
    const { app, stdout, owner, fire } = await bootEventApp()
    fire('session/event', owner, {
      type: 'assistant/chunk',
      seq: 0,
      time: 1,
      data: { turn: 1, step: 0, chunk: { type: 'text-delta', text: '先看目录。\n\n' } },
    })
    fire('session/event', owner, {
      type: 'tool/call',
      seq: 1,
      time: 2,
      data: { callId: 'settle-1', name: 'bash', arguments: '{"command":"ls"}', turn: 1, step: 0 },
    })
    fire('session/event', owner, {
      type: 'tool/result',
      seq: 2,
      time: 3,
      data: {
        turn: 1,
        step: 0,
        message: {
          content: [{ type: 'tool-result', content: [{ type: 'text', text: 'file.txt\nREADME.md' }] }],
          source: { callId: 'settle-1' },
        },
      },
    })
    // flushStream 串行链（blockWriter.flush → commit）+ WriteBatcher 16ms 帧。
    await new Promise(resolve => setTimeout(resolve, 300))
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('Run(ls)')
    expect(written).toContain('file.txt')
    // 事件序：流式文本先于结算卡出现。
    expect(written.indexOf('先看目录')).toBeGreaterThanOrEqual(0)
    expect(written.indexOf('先看目录')).toBeLessThan(written.indexOf('Run(ls)'))
    await app.dispose()
  })

  it('presenter 意图接线：tools 服务 presentResult → 结构化 diff 卡', async () => {
    const { app, ctx, stdout, owner, fire } = await bootEventApp()
    ctx.reflect.get.mockImplementation((name: string) => {
      if (name !== 'tools') return undefined
      return {
        get: (toolName: string) => (toolName === 'edit_file' ? {
          presentResult: () => ({
            card: 'diff',
            title: 'Update(a.ts)',
            diffs: [{ path: 'a.ts', oldText: 'x = 1', newText: 'x = 2' }],
          }),
        } : undefined),
      }
    })
    fire('session/event', owner, {
      type: 'tool/call',
      seq: 0,
      time: 1,
      data: { callId: 'diff-1', name: 'edit_file', arguments: '{"file_path":"a.ts"}', turn: 1, step: 0 },
    })
    fire('session/event', owner, {
      type: 'tool/result',
      seq: 1,
      time: 2,
      data: {
        turn: 1,
        step: 0,
        message: {
          content: [{ type: 'tool-result', content: [{ type: 'text', text: '模型面 diff 文本' }] }],
          source: { callId: 'diff-1' },
        },
      },
    })
    await new Promise(resolve => setTimeout(resolve, 300))
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('Update(a.ts)')
    expect(written).toContain('+ x = 2')
    expect(written).toContain('- x = 1')
    await app.dispose()
  })

  it('reasoning-delta → live 思考尾巴可见；段结束折叠头行落底，正文不落', async () => {
    const { app, stdout, owner, fire } = await bootEventApp()
    fire('session/event', owner, {
      type: 'assistant/chunk',
      seq: 0,
      time: Date.now(),
      data: { turn: 1, step: 0, chunk: { type: 'reasoning-delta', text: '先分析需求边界' } },
    })
    await new Promise(resolve => setTimeout(resolve, 30))
    const streaming = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(streaming).toContain('✻ 思考中…')
    expect(streaming).toContain('先分析需求边界')

    // 首个 text-delta = 推理段结束点 → 折叠头行落底（对标竞品：正文不落
    // scrollback，经 Ctrl+O 展开查看）。
    stdout.write.mockClear()
    fire('session/event', owner, {
      type: 'assistant/chunk',
      seq: 1,
      time: Date.now(),
      data: { turn: 1, step: 0, chunk: { type: 'text-delta', text: '结论是……' } },
    })
    await new Promise(resolve => setTimeout(resolve, 300))
    const settled = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(settled).toContain('✻ 思考')
    expect(settled).not.toContain('思考中')
    expect(settled).not.toContain('先分析需求边界')
    await app.dispose()
  })

  it('Ctrl+O 展开/收起已落底推理块：正文进 live 区，scrollback 保持折叠', async () => {
    const ctx = makeCtx()
    const handlers = new Map<string, Array<(...args: unknown[]) => void>>()
    ctx.on.mockImplementation((name: string, h: (...args: unknown[]) => void) => {
      const list = handlers.get(name) ?? []
      list.push(h)
      handlers.set(name, list)
      return () => { }
    })
    const agent = makeAgent('expand-1')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdout = makeStdout()
    const stdin = makeStdin()
    const app = new TuiApp({ ctx, stdout, stdin })
    // attach 才接线 stdin → handleKey（bootEventApp 不 attach，键事件不可达）。
    await app.attach()
    ;(agent.session as { id: SessionId }).id = app.sessionId ?? SessionId('expand-1')
    ;(agent as { id: SessionId }).id = agent.session.id
    ctx.sessions.get.mockReturnValue(agent.session)
    const owner = { id: app.sessionId ?? SessionId('expand-1') }
    const fire = (name: string, ...args: unknown[]) => {
      for (const h of handlers.get(name) ?? []) h(...args)
    }

    fire('session/event', owner, {
      type: 'assistant/chunk',
      seq: 0,
      time: Date.now(),
      data: { turn: 1, step: 0, chunk: { type: 'reasoning-delta', text: '展开可见的推理正文' } },
    })
    fire('session/event', owner, {
      type: 'assistant/chunk',
      seq: 1,
      time: Date.now(),
      data: { turn: 1, step: 0, chunk: { type: 'text-delta', text: '结论' } },
    })
    await new Promise(resolve => setTimeout(resolve, 300))
    stdout.write.mockClear()

    // Ctrl+O（0x0f）展开：推理全文出现在 live 区（含收起提示），scrollback 不重复。
    stdin.emit('data', '\x0f')
    await new Promise(resolve => setTimeout(resolve, 60))
    const expanded = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(expanded).toContain('展开可见的推理正文')
    expect(expanded).toContain('✻ 思考')
    expect(expanded).toContain('ctrl+o 收起')

    // 再按一次收起：正文从 live 区消失。
    stdout.write.mockClear()
    stdin.emit('data', '\x0f')
    await new Promise(resolve => setTimeout(resolve, 60))
    const collapsed = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(collapsed).not.toContain('展开可见的推理正文')
    await app.dispose()
  })

  it('abort → 推理缓冲丢弃不落底', async () => {
    const { app, stdout, owner, fire } = await bootEventApp()
    fire('session/event', owner, {
      type: 'assistant/chunk',
      seq: 0,
      time: Date.now(),
      data: { turn: 1, step: 0, chunk: { type: 'reasoning-delta', text: '将被丢弃的思路' } },
    })
    await new Promise(resolve => setTimeout(resolve, 30))
    stdout.write.mockClear()
    fire('session/event', owner, {
      type: 'turn/end',
      seq: 1,
      time: Date.now(),
      data: { turn: 1, reason: { kind: 'aborted' } },
    })
    await new Promise(resolve => setTimeout(resolve, 100))
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).not.toContain('✻ 思考 (')
    expect(written).not.toContain('将被丢弃的思路')
    await app.dispose()
  })
})

describe('TuiApp subagent / workflow / tasks 服务接线', () => {
  it('subagent/start 事件触发委派树刷新（listDescendants 再查）', async () => {
    const ctx = makeCtx()
    // 事件可能注册多个 handler（委派树刷新 + 对话流行）：数组收集，触发取第一个。
    const handlers = new Map<string, Array<(...args: unknown[]) => void>>()
    const listDescendants = vi.fn(async () => [{ id: 'd1', label: '子代理A', parentId: 'p', startedAt: 0 }])
    ctx.on.mockImplementation((name: string, h: (...args: unknown[]) => void) => {
      const list = handlers.get(name)
      if (list !== undefined) list.push(h)
      else handlers.set(name, [h])
      return () => { }
    })
    ctx.reflect.get.mockImplementation((name: string) => {
      if (name === 'subagents') return { listDescendants, activeExternalRuns: () => [] }
      return undefined
    })
    const agent = makeAgent('sub-1')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const app = new TuiApp({ ctx, stdout: makeStdout(), stdin: makeStdin() })
    await app.newSession()
    const before = listDescendants.mock.calls.length
    handlers.get('subagent/start')?.[0]?.({ parentId: 'p', id: 'd1' })
    await new Promise(resolve => setImmediate(resolve))
    expect(listDescendants.mock.calls.length).toBeGreaterThan(before)
    await app.dispose()
  })

  it('subagent/start|end 均订阅委派树刷新（ctx.on 恒返回 disposer；旧 ?? 短路吞掉 end 是 bug）', async () => {
    const ctx = makeCtx()
    const handlers = new Map<string, (...args: unknown[]) => void>()
    ctx.on.mockImplementation((name: string, h: (...args: unknown[]) => void) => {
      handlers.set(name, h)
      return () => { }
    })
    ctx.reflect.get.mockImplementation((name: string) => {
      if (name === 'subagents') return { listDescendants: vi.fn(async () => []), activeExternalRuns: () => [] }
      return undefined
    })
    const agent = makeAgent('sub-2')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const app = new TuiApp({ ctx, stdout: makeStdout(), stdin: makeStdin() })
    await app.newSession()
    // cordis 契约：ctx.on 恒返回 disposer（非 undefined）——start/end 分别注册，
    // 旧实现用 ?? 连接导致 end 永不注册（订阅缺失场景不成立，原 mock 违反契约）。
    expect(handlers.has('subagent/start')).toBe(true)
    expect(handlers.has('subagent/end')).toBe(true)
    await app.dispose()
  })

  it('委派树 listDescendants reject → 置 null 降级', async () => {
    const ctx = makeCtx()
    ctx.reflect.get.mockImplementation((name: string) => {
      if (name === 'subagents') return { listDescendants: vi.fn(async () => { throw new Error('boom') }), activeExternalRuns: () => [] }
      return undefined
    })
    const agent = makeAgent('deleg-err')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const app = new TuiApp({ ctx, stdout: makeStdout(), stdin: makeStdin() })
    await app.attach()
    await new Promise(resolve => setImmediate(resolve))
    await app.dispose()
  })

  it('委派树 resolve 在 dispose 之后 → 不写缓存不渲染', async () => {
    let resolveEntries: ((e: unknown[]) => void) | null = null
    const ctx = makeCtx()
    ctx.reflect.get.mockImplementation((name: string) => {
      if (name === 'subagents') return {
        activeExternalRuns: () => [],
        listDescendants: () => new Promise<unknown[]>((r) => { resolveEntries = r }),
      }
      return undefined
    })
    const agent = makeAgent('deleg-late')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const app = new TuiApp({ ctx, stdout: makeStdout(), stdin: makeStdin() })
    await app.attach()
    await app.dispose()
    ;(resolveEntries as ((e: unknown[]) => void) | null)?.([{ id: 'x' }])
    await new Promise(resolve => setImmediate(resolve))
  })

  it('workflow 事件带未知 run id → 忽略（防御分支）', async () => {
    const ctx = makeCtx()
    const handlers = new Map<string, (...args: unknown[]) => void>()
    ctx.on.mockImplementation((name: string, h: (...args: unknown[]) => void) => {
      handlers.set(name, h)
      return () => { }
    })
    const agent = makeAgent('wf-u')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const app = new TuiApp({ ctx, stdout: makeStdout(), stdin: makeStdin() })
    await app.newSession()
    const fire = (name: string, ...args: unknown[]) => { handlers.get(name)?.(...args) }
    fire('workflow/phase', { id: 'missing' }, '调研')
    fire('workflow/agent-start', { id: 'missing' }, { seq: 1, label: 'x' })
    fire('workflow/agent-end', { id: 'missing' }, { seq: 1, label: 'x', outcome: 'completed' })
    fire('workflow/end', { id: 'missing' }, { stopReason: 'completed' })
    await app.dispose()
  })

  it('/workflow 渲染运行中 run（meta 缺省 → name 回退 id）与终态 error 折叠', async () => {
    const ctx = makeCtx()
    const handlers = new Map<string, Array<(...args: unknown[]) => void>>()
    ctx.on.mockImplementation((name: string, h: (...args: unknown[]) => void) => {
      const list = handlers.get(name) ?? []
      list.push(h)
      handlers.set(name, list)
      return () => { }
    })
    const agent = makeAgent('wf-run')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin: makeStdin() })
    // workflow/approval 订阅在 attach 注册——newSession 不注册，必须走 attach
    await app.attach()
    const fire = (name: string, ...args: unknown[]) => {
      for (const h of handlers.get(name) ?? []) h(...args)
    }
    // 运行中：start + agent-start（无 agent-end）→ outcome 缺省 completed
    fire('workflow/start', { id: 'wf-running' })
    fire('workflow/agent-start', { id: 'wf-running' }, { seq: 1, label: '研究员' })
    // 终态：start + agent-start + end（无 meta/phase、带 error）→ name 回退 id、
    // error 进汇总；agent 无 outcome → 折叠视图 outcome 缺省 completed（?? 右侧）
    fire('workflow/start', { id: 'wf-done' })
    fire('workflow/agent-start', { id: 'wf-done' }, { seq: 1, label: '助手' })
    fire('workflow/end', { id: 'wf-done' }, { stopReason: 'error', error: '网络失败' })
    app.handleSubmit('/workflow') // 命令分发打开 workflow 面板
    await new Promise(resolve => setImmediate(resolve))
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('wf-running')
    expect(written).toContain('wf-done')
    await app.dispose()
  })

  it('workflow run 时长渲染真实流逝（startedAt 差值,非时间戳）', async () => {
    const ctx = makeCtx()
    const handlers = new Map<string, Array<(...args: unknown[]) => void>>()
    ctx.on.mockImplementation((name: string, h: (...args: unknown[]) => void) => {
      const list = handlers.get(name) ?? []
      list.push(h)
      handlers.set(name, list)
      return () => { }
    })
    const agent = makeAgent('wf-elapsed')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdout = makeStdout()
    // 只 fake Date（不动 setTimeout/setImmediate——ticker 与渲染调度保持真实，
    // 避免 runAllTimers 无限 flush setInterval）：startedAt 与渲染时点都在
    // fake 时钟下取值，差值可精确断言。
    vi.useFakeTimers({ toFake: ['Date'] })
    const app = new TuiApp({ ctx, stdout, stdin: makeStdin() })
    try {
      await app.attach()
      const fire = (name: string, ...args: unknown[]) => {
        for (const h of handlers.get(name) ?? []) h(...args)
      }
      vi.setSystemTime(1_000_000)
      fire('workflow/start', { id: 'wf-live' })
      fire('workflow/start', { id: 'wf-settled' })
      vi.setSystemTime(1_080_000) // +80s
      fire('workflow/end', { id: 'wf-settled' }, { stopReason: 'completed' })
      app.handleSubmit('/workflow')
      await new Promise(resolve => setImmediate(resolve))
      const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
      // 运行中与已结算 run 都按 startedAt 差值渲染（此前误填时间戳 → 数十万年，
      // 绝不可能出现 '1m20s'）——两个 run 各一段时长
      expect(written.match(/1m20s/g)).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
    await app.dispose()
  })

  it('workflow/log 叙述行进运行中 run 展开视图（⤷ 行 + roster 自动展开）', async () => {
    const ctx = makeCtx()
    ctx.agents.create.mockImplementation(({ sessionId }: { sessionId: string }) => {
      const agent = makeAgent(sessionId)
      ctx.sessions.get.mockReturnValue(agent.session)
      return makeHandle(agent)
    })
    const listeners = new Map<string, (...args: unknown[]) => void>()
    ctx.on.mockImplementation((name: string, handler: (...args: unknown[]) => void) => {
      listeners.set(name, handler)
      return () => { listeners.delete(name) }
    })
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin })
    await app.attach()
    const fire = (name: string, ...args: unknown[]) => { listeners.get(name)?.(...args) }
    fire('workflow/start', { id: 'wf-log', meta: { name: '日志脚本' } })
    fire('workflow/log', { id: 'wf-log' }, '第一批任务完成') // 属主第二参为裸 string
    fire('workflow/log', { id: 'wf-log' }, '第二批任务完成')
    fire('workflow/agent-start', { id: 'wf-log' }, { seq: 1, label: '执行员' })
    await new Promise(resolve => setImmediate(resolve))
    for (const ch of '/workflow') stdin.emit('data', ch)
    stdin.emit('data', '\r')
    await new Promise(resolve => setImmediate(resolve))
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    // 运行中 run 自动展开：叙述行与 roster 行可见
    expect(written).toContain('⤷ 第一批任务完成')
    expect(written).toContain('⤷ 第二批任务完成')
    expect(written).toContain('1. 执行员')
    await app.dispose()
  })

  it('tasks 服务接线：快照渲染（状态/详情分支）+ onTaskDone 通知', async () => {
    const ctx = makeCtx()
    let taskDone: ((s: { label: string }) => void) | null = null
    const list = vi.fn(() => [
      { id: 't1', kind: 'shell', label: '跑测试', status: 'running', startedAt: 0 },
      { id: 't2', kind: 'shell', label: '构建', status: 'completed', detail: 'ok', startedAt: 0 },
      { id: 't3', kind: 'shell', label: '清理', status: 'killed', startedAt: 0 },
    ])
    ctx.reflect.get.mockImplementation((name: string) => {
      if (name === 'tasks') return {
        list,
        onTaskDone: (l: (s: { label: string }) => void) => { taskDone = l; return () => { } },
        attachSurface: vi.fn(() => () => { }),
      }
      return undefined
    })
    const agent = makeAgent('task-svc')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin })
    await app.attach()

    for (const ch of '/tasks') stdin.emit('data', ch)
    stdin.emit('data', '\r')
    await new Promise(resolve => setImmediate(resolve))
    let written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    // 完成/失败卡的标题走 muted 着色，剥掉 SGR 后断言用户可见行。
    const plain = written.replaceAll(/\u001b\[[0-9;]*m/g, '')
    expect(plain).toContain('⠋ 跑测试')
    expect(plain).toContain('› 构建 · ok')
    expect(plain).toContain('✗ 清理')

    stdout.write.mockClear()
    ;(taskDone as ((s: { label: string }) => void) | null)?.({ label: '编译' })
    await new Promise(resolve => setImmediate(resolve))
    written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('✓ 任务完成: 编译')
    await app.dispose()
  })

  it('taskDone 随 detachProjections 释放、taskSurface 随 dispose 释放（瑶光缺口回归）', async () => {
    // 缺口取证：taskDoneDisposer 注释『随会话挂载/卸载』、taskSurfaceDisposer
    // 注释『attach 声明、dispose 释放』——但 detachProjections/dispose 均未释放，
    // 仅靠 mountSession 末尾的预释放兜底（切会话不累积；单次挂载后 dispose 即泄漏）。
    // ledger 只记录 ctx.on 订阅，tasks facet 的 onTaskDone/attachSurface 不走 ctx.on，
    // 覆盖不到——此处直接断言其 disposer 的调用时机与顺序。
    const ctx = makeCtx()
    const released: string[] = []
    const list = vi.fn(() => [])
    ctx.reflect.get.mockImplementation((name: string) => {
      if (name === 'tasks') return {
        list,
        onTaskDone: vi.fn(() => () => { released.push('taskDone:released') }),
        attachSurface: vi.fn(() => () => { released.push('taskSurface:released') }),
      }
      return undefined
    })
    const agent = makeAgent('task-dispose')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const app = new TuiApp({ ctx, stdout: makeStdout(), stdin: makeStdin() })
    await app.attach()
    // 首次挂载：注册但未释放（预释放兜底只在重挂载时触发）。
    expect(released).toEqual([])
    await app.dispose()
    // taskDone 在 detachProjections 释放（先于 dispose 尾部），taskSurface 在
    // dispose 释放——顺序断言区分两个释放点（修复前两者均不释放，此断言红）。
    expect(released).toEqual(['taskDone:released', 'taskSurface:released'])
  })
})

describe('TuiApp handleKey 边界', () => {
  it('Tab 无 @ token → 不补全（onTabComplete 回调返回 false 无副作用）', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('tab-1')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin })
    await app.attach()

    stdin.emit('data', '普通文本')
    stdin.emit('data', '\t')
    await new Promise(resolve => setImmediate(resolve))
    // 未补全：后续 Enter 提交原样文本
    stdout.write.mockClear()
    stdin.emit('data', '\r')
    await new Promise(resolve => setImmediate(resolve))
    expect(agent.followup).toHaveBeenCalledTimes(1)
    const text = firstCallText(agent.followup)
    expect(text).toBe('普通文本')
    await app.dispose()
  })

  it('Tab 有 @ token → 补全应用（输入行更新 + Enter 提交补全结果）', async () => {
    // 补全走 handleTabComplete → process.cwd() 下的真实 git ls-files。指向
    // 一个两文件的临时仓库：断言不再随本仓文件名漂移，也不会在负载下撞上
    // 补全器 500ms 的子进程超时（本仓 6.8k 文件，并发跑测时超时会静默返回
    // 空候选，Tab 保持原行为，用例随机翻红）。
    const repo = mkdtempSync(join(tmpdir(), 'dsh-tui-tab-'))
    writeFileSync(join(repo, 'mention-parser.ts'), '// mention parser')
    execFileSync('git', ['init', '-q'], { cwd: repo })
    execFileSync('git', ['add', '.'], { cwd: repo })
    vi.spyOn(process, 'cwd').mockReturnValue(repo)

    const ctx = makeCtx()
    const agent = makeAgent('tab-2')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin })
    await app.attach()

    for (const ch of '@me') stdin.emit('data', ch)
    stdin.emit('data', '\t')
    await new Promise(resolve => setImmediate(resolve))
    stdin.emit('data', '\r')
    await new Promise(resolve => setImmediate(resolve))
    expect(agent.followup).toHaveBeenCalledTimes(1)
    const text = firstCallText(agent.followup)
    expect(text).toContain('mention') // @路径补全到 mention-*.ts（首项按字母序）
    await app.dispose()
  })

  it('面板打开 ↑ 移动选中（up 分支）', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('pal-up')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin, theme: 'paper' })
    await app.attach()

    stdin.emit('data', '\x10')    // Ctrl+P 打开
    await new Promise(resolve => setImmediate(resolve))
    stdin.emit('data', '\x1b[A')  // ↑（selected 已为 0，回绕）
    stdin.emit('data', '\r')
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setTimeout(resolve, 200))
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('\x1B[?1049l') // 正常关闭面板
    await app.dispose()
  })

  it('审批挂起时按其他键 → 忽略不结算（条件 2 分支）', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('ap-key')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdin = makeStdin()
    const app = new TuiApp({ ctx, stdout: makeStdout(), stdin })
    await app.attach()
    const handler = ctx.on.mock.calls.find(call => call[0] === 'approval/request')?.[1] as
      | ((req: unknown, next: () => Promise<string>) => Promise<string>)
      | undefined
    if (handler === undefined) throw new Error('approval/request handler not registered')

    const owner = { id: app.sessionId ?? SessionId('ap-key') }
    const outcome = handler(
      { agent: { session: { id: owner.id } }, toolName: 'bash' },
      () => Promise.resolve('unavailable'),
    )
    stdin.emit('data', 'x') // 非 y/n/ctrl_c/escape → 忽略
    stdin.emit('data', 'y') // 仍可正常放行
    await expect(outcome).resolves.toBe('allowed-once')
    await app.dispose()
  })

  it('无 onExit 时空输入 Ctrl+C → 取消当前活动（handleAbort）', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('abort-1')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin })
    await app.attach()

    stdin.emit('data', '\x03') // Ctrl+C，输入为空且无 onExit
    await new Promise(resolve => setImmediate(resolve))
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('已取消')
    await app.dispose()
  })

  it('↑ 键走 InputLine 历史导航（up 分支）', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('hist-1')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin })
    await app.attach()

    stdin.emit('data', '\x1b[A') // up → 历史导航（空历史也走 handleKey）
    await new Promise(resolve => setImmediate(resolve))
    expect(stdout.write).toHaveBeenCalled()
    await app.dispose()
  })
})

describe('TuiApp 输入与转向边界', () => {
  it('handleSubmit 纯空白 → no-op（不驱动 followup）', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('blank-1')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const app = new TuiApp({ ctx, stdout: makeStdout(), stdin: makeStdin() })
    await app.newSession()
    app.handleSubmit('   ')
    expect(agent.followup).not.toHaveBeenCalled()
    await app.dispose()
  })

  it('相同输入重复提交 → 历史去重（filter 回调命中）', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('dup-1')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const app = new TuiApp({ ctx, stdout: makeStdout(), stdin: makeStdin() })
    await app.newSession()
    app.handleSubmit('重复文本')
    app.handleSubmit('重复文本')
    app.handleSubmit('另一条')
    expect(agent.followup).toHaveBeenCalledTimes(3)
    await app.dispose()
  })

  it('/steer 无参数 → no-op（不调 steer）', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('steer-empty')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const app = new TuiApp({ ctx, stdout: makeStdout(), stdin: makeStdin() })
    await app.newSession()
    app.handleSubmit('/steer')
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))
    expect(agent.steer).not.toHaveBeenCalled()
    await app.dispose()
  })
})

describe('runCordisCommand 余下分支', () => {
  /** 带 commands 服务 + 有会话的 ctx 替身。 */
  async function setupAppWithAgent(agentImpl: () => unknown) {
    const ctx = makeCtx()
    const agent = makeAgent('cordis-1')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    ctx.agents.get.mockImplementation(agentImpl as () => Agent)
    const execute = vi.fn()
    ctx.reflect.get.mockImplementation((name: string) => (name === 'commands' ? { execute } : undefined))
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin: makeStdin() })
    await app.newSession()
    return { app, ctx, execute, stdout }
  }

  it('agent undefined（有会话但 registry 无 live agent）→ 未知命令', async () => {
    const { app, execute, stdout } = await setupAppWithAgent(() => undefined)
    app.handleSubmit('/st')
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))
    expect(execute).not.toHaveBeenCalled()
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('未知命令')
    await app.dispose()
  })

  it('execute success 无 text → 回显默认已执行', async () => {
    const { app, execute, stdout } = await setupAppWithAgent(() => makeAgent('cordis-1'))
    execute.mockResolvedValue({ result: { kind: 'success' } })
    app.handleSubmit('/st')
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('已执行')
    await app.dispose()
  })

  it('execute 抛错 → ⚠ 命令执行失败（catch 分支）', async () => {
    const { app, execute, stdout } = await setupAppWithAgent(() => makeAgent('cordis-1'))
    execute.mockRejectedValue(new Error('cordis boom'))
    app.handleSubmit('/st')
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('命令执行失败')
    expect(written).toContain('cordis boom')
    await app.dispose()
  })

  it('execute 抛字符串 → String(err) 分支回显（非 Error 抛出）', async () => {
    const { app, execute, stdout } = await setupAppWithAgent(() => makeAgent('cordis-2'))
    execute.mockRejectedValue('plain string failure')
    app.handleSubmit('/st')
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('命令执行失败')
    expect(written).toContain('plain string failure')
    await app.dispose()
  })
})

describe('TuiApp 投影缓存防御与 status 面板降级', () => {
  it('onChanged 在投影缓存为 null 时安全跳过赋值（detach 后）', async () => {
    const ctx = makeCtx()
    let changeListener: ((s: { id: string }, key: string, value: unknown) => void) | null = null
    let mountSeq = 0
    ctx.agents.create.mockImplementation(({ sessionId }: { sessionId: string }) => {
      const agent = makeAgent(sessionId)
      ctx.sessions.get.mockReturnValue(agent.session)
      return makeHandle(agent)
    })
    ctx.reflect.get.mockImplementation((name: string) => {
      if (name === 'sessionProjections') return {
        snapshot: vi.fn(() => ({ values: {} })),
        onChanged: (l: (s: { id: string }, key: string, value: unknown) => void) => {
          changeListener = l
          mountSeq += 1
          return () => { mountSeq -= 1 }
        },
      }
      return undefined
    })
    const app = new TuiApp({ ctx, stdout: makeStdout(), stdin: makeStdin() })
    await app.attach()
    // detach（切到新会话）→ projectionCache 置 null，但 mock disposer 未真正解绑
    const second = makeAgent('second')
    ctx.agents.get.mockReturnValue(undefined)
    ctx.agents.resume.mockResolvedValue(makeHandle(second))
    await app.switchSession(SessionId('second'))
    // 触发旧会话的 onChanged（闭包 id = 第一会话）→ projectionCache null 分支
    ;(changeListener as ((s: { id: string }, key: string, value: unknown) => void) | null)?.({ id: String(app.sessionId) }, 'plan', null)
    await new Promise(resolve => setImmediate(resolve))
    await app.dispose()
  })

  it('onChanged plan 值为 null → planState 落 false（?? 分支）', async () => {
    const ctx = makeCtx()
    let changeListener: ((s: { id: string }, key: string, value: unknown) => void) | null = null
    let mountedAgent: { session: { id: string } } | null = null
    ctx.agents.create.mockImplementation(({ sessionId }: { sessionId: string }) => {
      const agent = makeAgent(sessionId)
      mountedAgent = agent
      ctx.sessions.get.mockReturnValue(agent.session)
      return makeHandle(agent)
    })
    ctx.reflect.get.mockImplementation((name: string) => {
      if (name === 'sessionProjections') return {
        snapshot: vi.fn(() => ({ values: { plan: { active: true, pending: false } } })),
        onChanged: (l: (s: { id: string }, key: string, value: unknown) => void) => {
          changeListener = l
          return () => { }
        },
      }
      return undefined
    })
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin: makeStdin() })
    await app.attach()
    const listener = changeListener as unknown as (s: { id: string }, key: string, value: unknown) => void
    const mounted = mountedAgent as unknown as { session: { id: string } }
    stdout.write.mockClear() // 清掉 attach 时的 [plan] 渲染，只断言变更后的输出
    listener({ id: mounted.session.id }, 'plan', null)
    await new Promise(resolve => setTimeout(resolve, 200))
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).not.toContain('[plan]')
    await app.dispose()
  })

  it('/status 打开时投影缓存缺 goal/plan → 面板降级渲染（?? null 分支）', async () => {
    const ctx = makeCtx()
    ctx.agents.create.mockImplementation(({ sessionId }: { sessionId: string }) => {
      const agent = makeAgent(sessionId)
      ctx.sessions.get.mockReturnValue(agent.session)
      return makeHandle(agent)
    })
    ctx.reflect.get.mockImplementation((name: string) => {
      if (name === 'sessionProjections') return {
        snapshot: vi.fn(() => ({ values: { todos: [{ content: '任务', status: 'completed' }] } })),
        onChanged: vi.fn(() => () => { }),
      }
      return undefined
    })
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin })
    await app.attach()
    // /status 打开 → goal/plan 缺失 → ?? null 渲染（只渲染 todos 段）
    for (const ch of '/status') stdin.emit('data', ch)
    stdin.emit('data', '\r')
    await new Promise(resolve => setImmediate(resolve))
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('任务')
    await app.dispose()
  })
})

describe('TuiApp /config 服务组合分支', () => {
  async function bootWithReflect(impl: (name: string) => unknown) {
    const ctx = makeCtx()
    ctx.reflect.get.mockImplementation(impl)
    const agent = makeAgent('cfg-x')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdout = makeStdout()
    const stdin = makeStdin()
    const app = new TuiApp({ ctx, stdout, stdin })
    await app.attach()
    app.handleSubmit('/config')
    await new Promise(resolve => setTimeout(resolve, 40))
    const written = () => stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    return { app, stdin, written }
  }

  it('仅 credentials（无 llm 目录）→ 凭据类目缺席，面板仍开（模型类目在）', async () => {
    const describe = vi.fn(async () => ({ configured: false, writable: true }))
    const { app, written } = await bootWithReflect((name: string) => {
      if (name === 'credentials') return { describe }
      return undefined
    })
    expect(written()).toContain('⚙ 配置')
    expect(written()).toContain('默认模型')
    expect(written()).not.toContain('凭据')
    await app.dispose()
  })

  it('credentials describe reject → catch 兜底不崩溃（该行显示未配置）', async () => {
    const { app, stdin, written } = await bootWithReflect((name: string) => {
      if (name === 'credentials') return { describe: vi.fn(async () => { throw new Error('boom') }) }
      if (name === 'llm') {
        return {
          listConfigurableProviders: () => [{ provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [] }],
          resolveModelInfo: async () => ({ supportsVision: false }),
        }
      }
      return undefined
    })
    // 双栏一次显示一个类目：下移到凭据类目后其字段行可见。
    stdin.emit('data', '\x1b[B')
    await new Promise(resolve => setTimeout(resolve, 80))
    expect(written()).toContain('⚙ 配置')
    expect(written()).toContain('DeepSeek')
    await app.dispose()
  })

  it('仅 permission 服务存在 → 权限类目渲染当前预设', async () => {
    const { app, stdin, written } = await bootWithReflect((name: string) => {
      if (name === 'permission') return { names: ['run_shell'], current: vi.fn(() => 'ask') }
      return undefined
    })
    stdin.emit('data', '\x1b[B')
    await new Promise(resolve => setTimeout(resolve, 80))
    expect(written()).toContain('权限')
    expect(written()).toContain('ask')
    await app.dispose()
  })

  it('仅 settings 服务存在 → 概览类目渲染命名空间', async () => {
    const { app, written } = await bootWithReflect((name: string) => {
      if (name === 'settings') return { describe: vi.fn(() => [{ ns: 'model', value: 'deepseek' }]) }
      return undefined
    })
    expect(written()).toContain('概览')
    expect(written()).toContain('model')
    await app.dispose()
  })

  it('服务全缺失 → 面板仍开（仅模型类目，字段只读显示 —，无渲染崩溃）', async () => {
    const { app, written } = await bootWithReflect(() => undefined)
    expect(written()).toContain('⚙ 配置')
    expect(written()).toContain('模型')
    await app.dispose()
  })
})

describe('TuiApp /config 编辑分派（即时生效 + 回开编舞）', () => {
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

  /** 带 llm 目录/settings/credentials/permission 面的向导装配。 */
  function bootConfigApp(opts: {
    permission?: { names: string[]; current: string; apply?: ReturnType<typeof vi.fn> }
  } = {}) {
    const ctx = makeCtx()
    const saveSelection = vi.fn(async () => {})
    Object.assign(ctx.agentDefaultModel, {
      currentSelection: vi.fn(() => ({ provider: 'deepseek', model: 'v4-flash' })),
      saveSelection,
    })
    const describe = vi.fn(async (ref: string) => ({ configured: false, writable: true, source: undefined, ref }))
    const apply = opts.permission?.apply ?? vi.fn()
    const fallback = ctx.reflect.get.getMockImplementation() as ((name: string) => unknown) | undefined
    ctx.reflect.get.mockImplementation((name: string) => {
      if (name === 'credentials') return { describe, set: vi.fn(async () => {}) }
      if (name === 'settings') {
        return { describe: () => [{ ns: 'llm-deepseek', value: { apiKeyEnv: 'DEEPSEEK_API_KEY' } }] }
      }
      if (name === 'permission' && opts.permission !== undefined) {
        return { names: opts.permission.names, current: vi.fn(() => opts.permission!.current), apply }
      }
      if (name === 'llm') {
        return {
          listConfigurableProviders: () => [
            { provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [] },
          ],
          listProviders: () => [{ id: 'deepseek-official', name: 'DeepSeek' }],
          listModels: async () => [{ id: 'v4-flash', name: 'Flash' }, { id: 'v4-pro', name: 'Pro' }],
          resolveModelInfo: async () => ({ supportsVision: false, reasoning: { efforts: [{ id: 'off' }, { id: 'low' }, { id: 'high' }] } }),
        }
      }
      return fallback ? fallback(name) : undefined
    })
    const agent = makeAgent('cfg-edit-1')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.agents.get.mockReturnValue(agent)
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin })
    const written = () => stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    return { app, stdin, written, saveSelection, apply }
  }

  it('默认模型 Enter → /model picker → 确认即 saveSelection → 回开面板', async () => {
    const { app, stdin, written, saveSelection } = bootConfigApp()
    await app.attach()
    app.handleSubmit('/config')
    await sleep(50)
    stdin.emit('data', '\x1b[C')  // → 字段栏
    await sleep(30)
    stdin.emit('data', '\r')     // Enter 默认模型
    await sleep(50)
    expect(written()).toContain('选择模型')
    stdin.emit('data', '\x1b[B') // ↓ v4-pro
    await sleep(30)
    stdin.emit('data', '\r')
    await sleep(60)
    expect(saveSelection).toHaveBeenCalledWith({ provider: 'deepseek-official', model: 'v4-pro' })
    // 编辑器关闭后回开 config（Esc 关面板验证存活）。
    expect(written()).toContain('⚙ 配置')
    await app.dispose()
  })

  it('推理档位 Enter → 档位 picker（选项取 resolveModelInfo efforts）→ saveSelection 带 effort', async () => {
    const { app, stdin, written, saveSelection } = bootConfigApp()
    await app.attach()
    app.handleSubmit('/config')
    await sleep(50)
    stdin.emit('data', '\x1b[C')
    await sleep(30)
    stdin.emit('data', '\x1b[B') // ↓ 推理档位
    await sleep(30)
    stdin.emit('data', '\r')
    await sleep(50)
    expect(written()).toContain('选择推理档位')
    stdin.emit('data', '\x1b[B') // ↓ low
    await sleep(30)
    stdin.emit('data', '\r')
    await sleep(60)
    expect(saveSelection).toHaveBeenCalledWith({ provider: 'deepseek', model: 'v4-flash', reasoningEffort: 'low' })
    await app.dispose()
  })

  it('权限预设 Enter → preset picker → permission.apply（与 /permission 同写路径）', async () => {
    const { app, stdin, written, apply } = bootConfigApp({
      permission: { names: ['workspace-write', 'read-only'], current: 'workspace-write', apply: vi.fn() },
    })
    await app.attach()
    app.handleSubmit('/config')
    await sleep(50)
    stdin.emit('data', '\x1b[B') // ↓ 权限类目
    await sleep(30)
    stdin.emit('data', '\r')     // 下钻字段
    await sleep(30)
    stdin.emit('data', '\r')     // Enter 预设字段
    await sleep(50)
    expect(written()).toContain('选择权限预设')
    stdin.emit('data', '\r')
    await sleep(60)
    expect(apply).toHaveBeenCalledTimes(1)
    const [sessionArg, nameArg] = apply.mock.calls[0] as [unknown, string]
    expect(nameArg).toBe('workspace-write')
    expect(sessionArg).toBeDefined()
    await app.dispose()
  })

  it('凭据字段 Enter → 直接进该供应商的 /key 对话框', async () => {
    const { app, stdin, written } = bootConfigApp()
    await app.attach()
    app.handleSubmit('/config')
    await sleep(50)
    stdin.emit('data', '\x1b[B') // ↓ 凭据类目（模型 → 凭据）
    await sleep(30)
    stdin.emit('data', '\r')     // 下钻
    await sleep(30)
    stdin.emit('data', '\r')     // Enter DeepSeek 行
    await sleep(60)
    expect(written()).toContain('设置 DeepSeek API Key')
    await app.dispose()
  })
})

describe('TuiApp /model 热切切换 saveSelection', () => {
  it('/model provider/model 切换 → saveSelection 调用 + 热切当前会话', async () => {
    const ctx = makeCtx()
    const saveSelection = vi.fn(async () => { })
    // /model 命令经 ctx.agentDefaultModel 属性访问（非 reflect.get）
    Object.assign(ctx.agentDefaultModel, {
      currentSelection: vi.fn(() => ({ provider: 'deepseek', model: 'v4-flash' })),
      saveSelection,
    })
    const agent = makeAgent('mdl-1')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin: makeStdin() })
    await app.attach()

    app.handleSubmit('/model deepseek/v4-turbo')
    // runSlash 是 async 且 handleSubmit 不 await——等一拍让执行落定。
    await new Promise(resolve => setTimeout(resolve, 30))
    await app.dispose()
    // saveSelection 路径被触达（/model 命令 run 内调用）
    expect(saveSelection).toHaveBeenCalledWith({ provider: 'deepseek', model: 'v4-turbo' })
  })
})

describe('TuiApp /model slash 走 switchLiveModel 闭包', () => {
  it('/model 命令经注入闭包热切当前会话（L425 闭包）', async () => {
    const ctx = makeCtx()
    Object.assign(ctx.agentDefaultModel, {
      currentSelection: vi.fn(() => ({ provider: 'deepseek', model: 'v4-flash' })),
      saveSelection: vi.fn(async () => { }),
    })
    const agent = makeAgent('mdl-2')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin: makeStdin() })
    await app.attach()

    app.handleSubmit('/model deepseek/v4-turbo')
    await new Promise(resolve => setTimeout(resolve, 30))
    // 热切路径：modelRef.current 更新（switchLiveModel 闭包生效）。
    // dispose 会清空 modelRef（a63f90de 拆除语义），先读后拆。
    const hotSwitch = (app as unknown as { modelRef: { current: unknown } | null }).modelRef?.current
    await app.dispose()
    expect(hotSwitch).toEqual({ provider: 'deepseek', model: 'v4-turbo' })
  })
})

describe('TuiApp glance turn 投影', () => {
  it('turn 已开时 glance 含 turnCount', async () => {
    const ctx = makeCtx()
    const handlers = new Map<string, Array<(...args: unknown[]) => void>>()
    ctx.on.mockImplementation((name: string, h: (...args: unknown[]) => void) => {
      const list = handlers.get(name) ?? []
      list.push(h)
      handlers.set(name, list)
      return () => { }
    })
    const agent = makeAgent('glc-1')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin: makeStdin() })
    await app.newSession()
    ;(agent.session as { id: SessionId }).id = app.sessionId ?? SessionId('glc-1')
    ;(agent as { id: SessionId }).id = agent.session.id
    ctx.sessions.get.mockReturnValue(agent.session)
    const owner = { id: app.sessionId ?? SessionId('glc-1') }
    for (const h of handlers.get('session/event') ?? []) {
      h(owner, { type: 'turn/start', seq: 0, time: 1, data: { turn: 0, step: 0, reason: { kind: 'kick' } } })
    }
    await new Promise(resolve => setTimeout(resolve, 30))
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written.length).toBeGreaterThan(0)
    await app.dispose()
  })
})

describe('TuiApp 监听器生命周期（?? 短路 + 泄漏回归）', () => {
  it('subagent/start 与 end 均注册委派树刷新（ctx.on 返回 disposer 非空，?? 不得短路右侧）', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('sub-short-1')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const app = new TuiApp({ ctx, stdout: makeStdout(), stdin: makeStdin() })
    await app.attach()
    const names = ctx.on.mock.calls.map(c => `${c[0]}`)
    expect(names).toContain('subagent/start')
    expect(names).toContain('subagent/end')
    await app.dispose()
  })

  it('会话卸载注销全部 workflow 监听器（仅 start 收集 disposer 的泄漏回归）', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('wf-leak-1')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const app = new TuiApp({ ctx, stdout: makeStdout(), stdin: makeStdin() })
    await app.attach()
    // 收集 attach 时注册的 workflow 监听器及其 disposer（mock on 每次返回新 vi.fn）
    const wfIdx = ctx.on.mock.calls
      .map((c, i) => ({ name: `${c[0]}`, i }))
      .filter(x => x.name.startsWith('workflow/'))
      .map(x => x.i)
    expect(wfIdx.length).toBe(6) // start/phase/log/agent-start/agent-end/end
    const disposers = wfIdx.map(i => ctx.on.mock.results[i]!.value as () => boolean)
    // 切换会话 → detachProjections 应注销全部六个（当前实现只保存 start 的）
    const second = makeAgent('wf-leak-2')
    ctx.agents.resume.mockResolvedValue(makeHandle(second))
    ctx.sessions.get.mockReturnValue(second.session)
    await app.switchSession(SessionId('wf-leak-2'))
    for (const d of disposers) expect(d).toHaveBeenCalled()
    await app.dispose()
  })
})

describe('C4 概念稿 菜单快捷键与三行底部区（提交后审查补测）', () => {
  function boot(over: Partial<ConstructorParameters<typeof TuiApp>[0]> = {}) {
    const ctx = makeCtx()
    const agent = makeAgent('c4-key')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin, ...over })
    return { ctx, agent, handle, stdin, stdout, app }
  }

  it('ctrl_n（0x0e）→ newSession：agents.create 再次被调用（保留旧会话）', async () => {
    const { ctx, app, stdin } = boot()
    await app.attach()
    expect(ctx.agents.create).toHaveBeenCalledTimes(1) // attach 铸造
    stdin.emit('data', '\x0e') // Ctrl+N
    await new Promise(resolve => setImmediate(resolve))
    expect(ctx.agents.create).toHaveBeenCalledTimes(2)
    await app.dispose()
  })

  it('ctrl_s（0x13）→ 切到最近创建的非当前会话（list 末元素）', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('c4-s')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    // 两个既有会话：attach target = list()[0]（old），ctrl_s 应切到 list 末（new）
    const oldS = SessionId('session-other-old')
    const newS = SessionId('session-other-new')
    const headerOf = (id: SessionId, createdAt: number) => ({
      id, createdAt, version: 0, cwd: undefined, parentSession: undefined,
    })
    ctx.sessions.list.mockReturnValue([
      // SessionManager.list 读 session.events.length——mock 必须带 events 数组
      { id: oldS, header: headerOf(oldS, Date.now() - 3_600_000), events: [] },
      { id: newS, header: headerOf(newS, Date.now() - 1_000), events: [] },
    ])
    // registry 兜底路径（agents.get 恒返回 agent）：attach 的 switchSession(oldS)
    // 与 ctrl_s 的 switchSession(newS) 都经 agents.get 探测，不触发 resume。
    ctx.agents.get.mockReturnValue(agent)
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin })
    await app.attach()
    expect(app.sessionId).toBe(oldS) // attach 落到 list 首元素
    stdin.emit('data', '\x13') // Ctrl+S
    await new Promise(resolve => setTimeout(resolve, 50))
    // ctrl_s 切到「最近创建」= list 末元素（others[last]，非 others[0]）
    expect(app.sessionId).toBe(newS)
    await app.dispose()
  })

  it('ctrl_q（0x11）→ onExit 触发退出', async () => {
    const onExit = vi.fn()
    const { app, stdin } = boot({ onExit })
    await app.attach()
    stdin.emit('data', '\x11') // Ctrl+Q
    await new Promise(resolve => setImmediate(resolve))
    expect(onExit).toHaveBeenCalledTimes(1)
    await app.dispose()
  })

  it('/exit 触发 onExit（与 Ctrl+Q 同一退出路径）', async () => {
    const onExit = vi.fn()
    const { app } = boot({ onExit })
    await app.attach()
    app.handleSubmit('/exit')
    await new Promise(resolve => setImmediate(resolve))
    expect(onExit).toHaveBeenCalledTimes(1)
    await app.dispose()
  })

  it('/restart 触发 onRestart（#34：dispose + 同命令重启装配方回调）', async () => {
    const onRestart = vi.fn()
    const { app } = boot({ onRestart })
    await app.attach()
    app.handleSubmit('/restart')
    await new Promise(resolve => setImmediate(resolve))
    expect(onRestart).toHaveBeenCalledTimes(1)
    await app.dispose()
  })

  it('三行底部区：输入行下方渲染 footer（模式/快捷键）与 metrics 行', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('c4-bottom')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin })
    await app.attach()
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    // footer 恒渲染（formatPromptFooter 单行）；metrics 需 glance 数据（此处无，
    // 不占位——纯函数 spec 已覆盖渲染，此处断言装配不抛且 footer 在输出中）
    // 新 hint 集：/ 命令 + ctrl+p 面板（Enter 发送不再提示）
    expect(written).toContain('/ 命令')
    expect(written).not.toContain('Enter 发送')
    expect(written).toContain('normal')
    await app.dispose()
  })

  it('B 布局：输入轨（╭─╮/╰─╯ 无左右竖线）+ 宽屏 footer 右侧合并 metrics/API 段', async () => {
    // 开发机 shell 可能带着真实 key——本用例断言的是「无 key → ✗」路径，先摘掉。
    const savedKey = process.env.DEEPSEEK_API_KEY
    Reflect.deleteProperty(process.env, 'DEEPSEEK_API_KEY')
    try {
      const { stdout, app } = boot()
      await app.attach()
      app.handleSubmit('hi')
      await new Promise(resolve => setImmediate(resolve))
      const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
      expect(written).toContain('❯')
      // 完整框体：顶框 ╭─╮ 在输入行上方、底框 ╰─╯ 在下方，无左右竖线
      expect(written).toMatch(/╭─+/)
      expect(written).toMatch(/╰─+/)
      expect(written).not.toMatch(/│ ❯/)
      // 宽屏（mock 100 列 ≥ 80）合并路径：API 状态段进 footer 右侧
      // （无 DEEPSEEK_API_KEY → ✗；区别于欢迎页的「API Key」环境检查行）
      expect(written).toContain('API ✗')
      await app.dispose()
    } finally {
      if (savedKey !== undefined) process.env.DEEPSEEK_API_KEY = savedKey
    }
  })

  it('B 布局：窄屏 footer 仍单行合并，不纵排 theme.primary 第二行', async () => {
    const savedKey = process.env.DEEPSEEK_API_KEY
    Reflect.deleteProperty(process.env, 'DEEPSEEK_API_KEY')
    try {
      const { stdout, app } = boot()
      stdout.columns = 70
      await app.attach()
      stdout.write.mockClear()
      app.handleSubmit('hi')
      await new Promise(resolve => setImmediate(resolve))
      const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
      expect(written).toContain('❯')
      expect(written).toMatch(/╭─+/)
      expect(written).not.toMatch(/│ ❯/)
      // 70 列放得下 left + mock + API ✗，应留在同一行雾蓝 chrome；不得另起 primary 行。
      expect(written).toContain('API ✗')
      expect(written).toContain('\x1B[38;2;170;178;194m')
      await app.dispose()
    } finally {
      if (savedKey !== undefined) process.env.DEEPSEEK_API_KEY = savedKey
    }
  })

  it('B 布局：metrics 上移输入框顶边状态栏（50 列容得下模型 + API 段）', async () => {
    const savedKey = process.env.DEEPSEEK_API_KEY
    Reflect.deleteProperty(process.env, 'DEEPSEEK_API_KEY')
    try {
      const { stdout, app } = boot()
      stdout.columns = 50
      await app.attach()
      stdout.write.mockClear()
      app.handleSubmit('hi')
      await new Promise(resolve => setImmediate(resolve))
      const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
      expect(written).toContain('❯')
      expect(written).toMatch(/╭─+/)
      expect(written).toContain('normal')
      expect(written).toContain('mock')
      // 顶边状态栏：mock（左）与 API ✗（右）同嵌输入框顶轨
      expect(written).toContain('API ✗')
      expect(written).toContain('\x1B[38;2;170;178;194m')
      await app.dispose()
    } finally {
      if (savedKey !== undefined) process.env.DEEPSEEK_API_KEY = savedKey
    }
  })

  it('顶边状态栏：极窄时从右丢 API 段，模型段保留', async () => {
    const savedKey = process.env.DEEPSEEK_API_KEY
    Reflect.deleteProperty(process.env, 'DEEPSEEK_API_KEY')
    try {
      const { stdout, app } = boot()
      // termCols 18 → gutter 2、有效 14 列：左 mock(4) + 右 API ✗(5) 超出即丢右段
      stdout.columns = 18
      await app.attach()
      stdout.write.mockClear()
      app.handleSubmit('hi')
      await new Promise(resolve => setImmediate(resolve))
      const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
      expect(written).toContain('mock')
      expect(written).not.toContain('API ✗')
      await app.dispose()
    } finally {
      if (savedKey !== undefined) process.env.DEEPSEEK_API_KEY = savedKey
    }
  })

  it('idle live 区不按剩余视口垫空行', async () => {
    const { stdout, app } = boot()
    stdout.rows = 40
    await app.attach()
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    const idx = written.lastIndexOf('╭')
    expect(idx).toBeGreaterThan(0)
    expect(written).toContain('DeepSeek')
    expect(written).toContain('Tianshu Harness')
    expect(written).not.toContain('Tips')
    expect(written.slice(idx)).toMatch(/╰─+/)
    expect(blankLinesBeforeRail(written)).toBeLessThanOrEqual(2)
    await app.dispose()
  })

  it('提交后输入轨仍在，轨前无整屏连续空行', async () => {
    const { stdout, app } = boot()
    stdout.rows = 40
    await app.attach()
    app.handleSubmit('hi')
    await new Promise(resolve => setImmediate(resolve))
    const after = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(after).toMatch(/╭─+/)
    expect(after).toMatch(/╰─+/)
    expect(blankLinesBeforeRail(after)).toBeLessThanOrEqual(2)
    await app.dispose()
  })
})

describe('TuiApp live 区高水位钉住输入轨', () => {
  it('流式推理撑高后，段结束 live 区不回缩', async () => {
    const { app, stdout, owner, fire } = await bootEventApp()
    stdout.rows = 40
    fire('session/event', owner, {
      type: 'user/message',
      seq: 0,
      time: 1,
      data: { content: [{ type: 'text', text: '开始' }] },
    })
    const chunk = Array.from({ length: 20 }, (_, i) => `思路步骤${i}`).join('\n')
    fire('session/event', owner, {
      type: 'assistant/chunk',
      seq: 1,
      time: Date.now(),
      data: { turn: 1, step: 0, chunk: { type: 'reasoning-delta', text: chunk } },
    })
    await new Promise(resolve => setTimeout(resolve, 30))
    const streaming = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    const blanksDuring = blankLinesBeforeRail(streaming)

    stdout.write.mockClear()
    fire('session/event', owner, {
      type: 'assistant/chunk',
      seq: 2,
      time: Date.now(),
      data: { turn: 1, step: 0, chunk: { type: 'text-delta', text: '结论。' } },
    })
    await new Promise(resolve => setTimeout(resolve, 300))
    const settled = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    const blanksAfter = blankLinesBeforeRail(settled)
    expect(blanksDuring).toBeGreaterThanOrEqual(0)
    expect(blanksAfter).toBeGreaterThan(2)
    expect(blanksAfter).toBeGreaterThanOrEqual(blanksDuring)
    expect(settled).toMatch(/╭─+/)
    await app.dispose()
  })
})

describe('slash 命令菜单接线（grok slash_dropdown 移植）', () => {
  function boot() {
    const ctx = makeCtx()
    const agent = makeAgent('slash-menu')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin })
    return { ctx, agent, handle, stdin, stdout, app }
  }

  async function writtenOf(stdout: ReturnType<typeof makeStdout>): Promise<string> {
    await new Promise(resolve => setImmediate(resolve))
    return stdout.write.mock.calls.map(c => `${c[0]}`).join('')
  }

  it('输入 / 渲染命令列表（第一项选中），↓ 移动选择', async () => {
    const { stdin, stdout, app } = boot()
    await app.attach()
    stdin.emit('data', '/')
    let written = await writtenOf(stdout)
    // 内置命令注册序第一个为 /theme（菜单行含 desc，区别于欢迎页）
    expect(written).toMatch(/❯ \/theme/)
    expect(written).toContain('切换主题')
    // ↓ → 选中第二项 /session
    stdin.emit('data', '\x1b[B')
    written = await writtenOf(stdout)
    expect(written).toMatch(/❯ \/session/)
    await app.dispose()
  })

  it('菜单打开时 ↑ 环绕到最后一项', async () => {
    const { stdin, stdout, app } = boot()
    await app.attach()
    stdin.emit('data', '/')
    await writtenOf(stdout)
    stdout.write.mockClear() // 只统计 ↑ 后的渲染
    stdin.emit('data', '\x1b[A')
    const written = await writtenOf(stdout)
    expect(written).toMatch(/❯ \/density/) // 环绕到最后一项（含外部插件命令）
    await app.dispose()
  })

  it('Tab 接受补全：输入行填入 /theme、菜单关闭', async () => {
    const { stdin, stdout, app } = boot()
    await app.attach()
    stdin.emit('data', '/')
    await writtenOf(stdout)
    stdout.write.mockClear() // 只统计 Tab 后的渲染
    stdin.emit('data', '\t')
    const written = await writtenOf(stdout)
    // 菜单关闭（desc 不再渲染）；输入行已补全 /theme
    expect(written).not.toContain('切换主题')
    expect(written).toContain('/theme')
    await app.dispose()
  })

  it('Enter 精确命令：菜单关闭、提交且输入行清空', async () => {
    const { stdin, stdout, app } = boot()
    await app.attach()
    // /theme 无参现会打开选择器（#31）——用无回显的 /effort 测「精确命令 Enter 提交」
    for (const ch of ['/', 'e', 'f', 'f', 'o', 'r', 't']) stdin.emit('data', ch)
    await writtenOf(stdout)
    stdout.write.mockClear() // 只统计 Enter 后的渲染
    stdin.emit('data', '\r')
    const written = await writtenOf(stdout)
    expect(written).not.toContain('❯ /effort')
    // 输入行清空（对齐正常提交路径；菜单提交不清空会残留 /effort）
    expect(written.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')).toContain('❯ █')
    expect(written).not.toContain('询问任何事')
    await app.dispose()
  })

  it('Esc 关闭菜单（输入行保留 /）', async () => {
    const { stdin, stdout, app } = boot()
    await app.attach()
    stdin.emit('data', '/')
    await writtenOf(stdout)
    stdout.write.mockClear() // 只统计 Esc 后的渲染
    stdin.emit('data', '\x1b')
    // lone ESC 走 80ms 超时后才 dispatch escape（input-handler 防误触）
    await new Promise(resolve => setTimeout(resolve, 150))
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).not.toContain('切换主题')
    await app.dispose()
  })

  it('PageUp/PageDown：菜单选择翻页（clamp）', async () => {
    const { stdin, stdout, app } = boot()
    await app.attach()
    stdin.emit('data', '/')
    await writtenOf(stdout)
    stdout.write.mockClear()
    // PageDown → 翻一页：选择离开顶部（落点随命令集/页宽变化，不断言具体命令，
    // 只断言「离开了 /theme 且仍有选中项」——避免每次加命令都改断言）。
    stdin.emit('data', '\x1b[6~')
    let written = await writtenOf(stdout)
    expect(written).not.toMatch(/❯ \/theme/)
    expect(written).toMatch(/❯ \//)
    stdout.write.mockClear()
    stdin.emit('data', '\x1b[5~') // PageUp → 回顶部（clamp）
    written = await writtenOf(stdout)
    expect(written).toMatch(/❯ \/theme/)
    await app.dispose()
  })

  it('菜单过滤/关闭时输入轨行位钉住（slash 行计入高水位垫高）', async () => {
    const { stdin, app } = boot()
    // 捕获每帧传给 LiveEngine.render 的行数组，量输入轨（╭ 顶框）在帧内的行下标。
    // 渲染走 WriteBatcher 合并，帧时机不可预定——按帧内容轮询到目标状态再量，
    // 不用固定 sleep（并行跑时 setImmediate 可能先于菜单帧）。
    const spy = vi.spyOn(LiveEngine.prototype, 'render')
    try {
      await app.attach()
      const railRow = (lines: readonly { text: string }[]): number => {
        const idx = lines.findIndex(line => line.text.includes('╭'))
        if (idx < 0) throw new Error('帧中无输入轨顶框')
        return idx
      }
      const awaitFrame = async (pred: (lines: readonly { text: string }[]) => boolean): Promise<readonly { text: string }[]> => {
        for (let i = 0; i < 200; i++) {
          const call = spy.mock.calls.at(-1)
          if (call !== undefined && pred(call[0])) return call[0]
          await new Promise(resolve => setTimeout(resolve, 10))
        }
        throw new Error('等待目标帧超时')
      }
      const menuOpen = (lines: readonly { text: string }[]): boolean =>
        lines.some(line => line.text.includes('切换主题'))
      // 打开菜单（全量命令 > 8 → 9 行菜单），输入轨落定位置。
      stdin.emit('data', '/')
      const pinned = railRow(await awaitFrame(menuOpen))
      // 逐键过滤到单一匹配（菜单 9 → 1 行）：行位不变（垫高吸收）。
      for (const ch of ['t', 'h', 'e', 'm', 'e']) stdin.emit('data', ch)
      const filtered = await awaitFrame(lines => menuOpen(lines) && !lines.some(line => line.text.includes('还有')))
      expect(railRow(filtered)).toBe(pinned)
      // Esc 关闭菜单（输入行保留 /theme）：菜单让出的行变垫高，行位仍不变。
      stdin.emit('data', '\x1b')
      const closed = await awaitFrame(lines => !menuOpen(lines))
      expect(railRow(closed)).toBe(pinned)
    } finally {
      spy.mockRestore()
      await app.dispose()
    }
  })
})

describe('slash 菜单阶段 2 接线（ghost 预览 / 参数模式 / MRU）', () => {
  function boot() {
    const ctx = makeCtx()
    const agent = makeAgent('slash-m2')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin })
    return { ctx, agent, handle, stdin, stdout, app }
  }

  async function writtenOf(stdout: ReturnType<typeof makeStdout>): Promise<string> {
    await new Promise(resolve => setImmediate(resolve))
    return stdout.write.mock.calls.map(c => `${c[0]}`).join('')
  }

  it('菜单选中命令：输入行 ghost 预览补全剩余（dim 样式）', async () => {
    const { stdin, stdout, app } = boot()
    await app.attach()
    for (const ch of ['/', 't', 'h']) stdin.emit('data', ch)
    const written = await writtenOf(stdout)
    // ghost 显示补全剩余 'eme'（dim \x1B[2m），与菜单行并存
    expect(written).toContain('\x1B[2meme\x1B[22m')
    await app.dispose()
  })

  it('参数模式：/cmd + 尾空格 → ghost 显示参数占位，Enter 提交完整行', async () => {
    const { stdin, stdout, app } = boot()
    await app.attach()
    // /theme 无参现会打开选择器（#31）——用带 argsHint 且无参安全的 /effort
    for (const ch of ['/', 'e', 'f', 'f', 'o', 'r', 't', ' ']) stdin.emit('data', ch)
    await writtenOf(stdout)
    // ghost 显示 argsHint 参数占位（/effort 的 argsHint 为 [off|high|max|auto]）
    const before = await writtenOf(stdout)
    expect(before).toContain('\x1B[2m[off|high|max|auto]\x1B[22m')
    stdout.write.mockClear()
    stdin.emit('data', '\r')
    const after = await writtenOf(stdout)
    // 提交后输入行清空（命令执行走 /effort 无参回显）
    expect(after.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')).toContain('❯ █')
    expect(after).not.toContain('询问任何事')
    await app.dispose()
  })

  it('MRU：执行 /density 后重新打开菜单排第一', async () => {
    const { stdin, stdout, app } = boot()
    await app.attach()
    // 执行 /density（精确命令 Enter 提交）
    for (const ch of ['/', 'd', 'e', 'n', 's', 'i', 't', 'y']) stdin.emit('data', ch)
    await writtenOf(stdout)
    stdin.emit('data', '\r')
    await writtenOf(stdout)
    // 重新输入 / 打开菜单：density 因 MRU 排第一
    stdout.write.mockClear()
    stdin.emit('data', '/')
    const written = await writtenOf(stdout)
    expect(written).toMatch(/❯ \/density/)
    await app.dispose()
  })
})

describe('subagent 活动带接线（CC 对标统一固定带）', () => {
  function boot() {
    const ctx = makeCtx()
    const agent = makeAgent('sub-line')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    ctx.reflect.get.mockImplementation((name: string) => {
      if (name === 'subagents') return {
        activeExternalRuns: () => [],
        listDescendants: vi.fn(async () => ([
          { kind: 'child', id: 'child-1', parentId: 'root', depth: 1, activity: 'running', hasChildren: false, mode: 'one-shot', label: '探索鉴权' },
        ])),
      }
      return undefined
    })
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin })
    return { ctx, agent, handle, stdin, stdout, app }
  }

  function handlerOf(ctx: ReturnType<typeof makeCtx>, name: string): ((info: unknown) => void) | undefined {
    // 同一事件注册多个 handler（委派树刷新 + 对话流行）：取最后一个（对话流行）。
    const calls = ctx.on.mock.calls.filter(call => call[0] === name)
    return calls[calls.length - 1]?.[1] as ((info: unknown) => void) | undefined
  }

  const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 40))

  it('subagent/start → 活动带行（label 取委派树缓存 + 常驻入口尾行）', async () => {
    const { ctx, stdout, app } = boot()
    await app.attach()
    await settle() // 等 listDescendants 预取 + renderBatcher
    const onStart = handlerOf(ctx, 'subagent/start')
    if (onStart === undefined) throw new Error('subagent/start handler not registered')
    stdout.write.mockClear()
    onStart({ runId: 'run-1', id: 'child-1' })
    await settle()
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('探索鉴权')
    expect(written).toContain('/workflow 管理') // 活动带常驻入口尾行
    await app.dispose()
  })

  it('activityBand:false 逃生门 → 回退旧散行（⠋ 子代理 label）', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('sub-legacy')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    ctx.reflect.get.mockImplementation((name: string) => {
      if (name === 'subagents') return {
        activeExternalRuns: () => [],
        listDescendants: vi.fn(async () => ([
          { kind: 'child', id: 'child-1', parentId: 'root', depth: 1, activity: 'running', hasChildren: false, mode: 'one-shot', label: '探索鉴权' },
        ])),
      }
      return undefined
    })
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin, activityBand: false })
    await app.attach()
    await settle()
    const onStart = handlerOf(ctx, 'subagent/start')
    if (onStart === undefined) throw new Error('subagent/start handler not registered')
    stdout.write.mockClear()
    onStart({ runId: 'run-1', id: 'child-1' })
    await settle()
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('子代理 探索鉴权')
    expect(written).not.toContain('/workflow 管理')
    await app.dispose()
  })

  it('subagent/end（completed）→ 终态行提交 scrollback、运行行移除', async () => {
    const { ctx, stdout, app } = boot()
    await app.attach()
    await settle()
    const onStart = handlerOf(ctx, 'subagent/start')
    const onEnd = handlerOf(ctx, 'subagent/end')
    if (onStart === undefined || onEnd === undefined) throw new Error('subagent handlers not registered')
    onStart({ runId: 'run-1', id: 'child-1' })
    await settle()
    stdout.write.mockClear()
    onEnd({ runId: 'run-1', stopReason: 'completed' })
    await settle()
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    // ✓ 与文本间有 ANSI 色码，分段断言
    expect(written).toContain('✓')
    expect(written).toContain('探索鉴权') // 终态提交（CC 单行格式，无「子代理」前缀）
    expect(written).not.toContain('⠋ 探索鉴权') // 带行移除
    await app.dispose()
  })

  it('subagent/end（error）→ ✗ 终态行带 reason 后缀', async () => {
    const { ctx, stdout, app } = boot()
    await app.attach()
    await settle()
    const onStart = handlerOf(ctx, 'subagent/start')
    const onEnd = handlerOf(ctx, 'subagent/end')
    if (onStart === undefined || onEnd === undefined) throw new Error('subagent handlers not registered')
    onStart({ runId: 'run-2', id: 'child-1' })
    await settle()
    stdout.write.mockClear()
    onEnd({ runId: 'run-2', stopReason: 'error' })
    await settle()
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('✗')
    expect(written).toContain('探索鉴权')
    expect(written).toContain('(error)')
    await app.dispose()
  })

  it('未配对 end（未知 runId）→ 不渲染（跨会话事件免疫）', async () => {
    const { ctx, stdout, app } = boot()
    await app.attach()
    await settle()
    const onEnd = handlerOf(ctx, 'subagent/end')
    if (onEnd === undefined) throw new Error('subagent/end handler not registered')
    stdout.write.mockClear()
    onEnd({ runId: 'unknown-run', stopReason: 'completed' })
    await settle()
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).not.toContain('子代理')
    await app.dispose()
  })
})

describe('活动带 child 投影缓存与 workflow/task 折叠接线', () => {
  function boot() {
    const ctx = makeCtx()
    const agent = makeAgent('band-child')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    let projectionListener: ((s: { id: string }, key: string, value: unknown, seq: number) => void) | null = null
    ctx.reflect.get.mockImplementation((name: string) => {
      if (name === 'sessionProjections') return {
        snapshot: vi.fn(() => ({ values: {} })),
        onChanged: vi.fn((listener: (s: { id: string }, key: string, value: unknown, seq: number) => void) => {
          projectionListener = listener
          return () => { }
        }),
      }
      if (name === 'subagents') return {
        activeExternalRuns: () => [],
        listDescendants: vi.fn(async () => ([
          { kind: 'child', id: 'child-1', parentId: 'root', depth: 1, activity: 'running', hasChildren: false, mode: 'one-shot', label: '探索鉴权' },
        ])),
      }
      if (name === 'tasks') return {
        list: vi.fn(() => [
          { id: 't1', kind: 'bash', label: 'pnpm test', status: 'running', startedAt: Date.now() },
        ]),
        kill: vi.fn(() => 'requested'),
        onTaskDone: vi.fn(() => () => { }),
        attachSurface: vi.fn(() => () => { }),
      }
      return undefined
    })
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin })
    return { ctx, agent, handle, stdin, stdout, app, projection: () => projectionListener }
  }

  function handlerOf(ctx: ReturnType<typeof makeCtx>, name: string): ((info: unknown) => void) | undefined {
    const calls = ctx.on.mock.calls.filter(call => call[0] === name)
    return calls[calls.length - 1]?.[1] as ((info: unknown) => void) | undefined
  }

  const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 40))
  const writtenOf = (stdout: ReturnType<typeof makeStdout>): string =>
    stdout.write.mock.calls.map(c => `${c[0]}`).join('')

  it('child subagentProgress 投影 → 带行统计段 + ⎿ 子行；end 完成行带统计', async () => {
    const { ctx, stdout, app, projection } = boot()
    await app.attach()
    await settle()
    const onStart = handlerOf(ctx, 'subagent/start')
    const onEnd = handlerOf(ctx, 'subagent/end')
    if (onStart === undefined || onEnd === undefined) throw new Error('subagent handlers not registered')
    onStart({ runId: 'run-1', id: 'child-1' })
    await settle()
    stdout.write.mockClear()
    // 运行中：child 投影回调喂 progress → 带行显示统计与最近工具子行
    projection()?.({ id: 'child-1' }, 'subagentProgress', {
      turns: 1, toolCalls: 3, tokensUsed: 12_300, lastTool: 'bash', toolInFlight: true,
    }, 1)
    await settle()
    const running = writtenOf(stdout)
    expect(running).toContain('3 工具')
    expect(running).toContain('12.3k tok')
    expect(running).toContain('⎿ bash')
    // 结束：完成行携带统计段（end 时刻取缓存快照）
    stdout.write.mockClear()
    onEnd({ runId: 'run-1', stopReason: 'completed' })
    await settle()
    const done = writtenOf(stdout)
    // ✓ 与文本间有 ANSI 色码，分段断言（与 subagent 完成行测试同款）
    expect(done).toContain('✓')
    expect(done).toContain('探索鉴权')
    expect(done).toContain('3 工具')
    expect(done).toContain('12.3k tok')
    expect(done).not.toContain('⎿ bash') // 带行随 end 移除
    await app.dispose()
  })

  it('非运行中子会话的投影 → 不进缓存（带行无统计段）', async () => {
    const { ctx, stdout, app, projection } = boot()
    await app.attach()
    await settle()
    const onStart = handlerOf(ctx, 'subagent/start')
    if (onStart === undefined) throw new Error('subagent/start handler not registered')
    onStart({ runId: 'run-2', id: 'child-1' })
    await settle()
    stdout.write.mockClear()
    // 无关子会话的 progress（非运行中子代）→ 缓存守卫拒绝
    projection()?.({ id: 'unrelated-child' }, 'subagentProgress', {
      turns: 1, toolCalls: 9, tokensUsed: 99_000, lastTool: 'read', toolInFlight: true,
    }, 1)
    await settle()
    const written = writtenOf(stdout)
    expect(written).not.toContain('9 工具')
    await app.dispose()
  })

  it('workflow/start → 带行 ⏳；workflow/end → scrollback 摘要一行；活跃任务 → › 行', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('band-wf')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    const listeners = new Map<string, Array<(...args: unknown[]) => void>>()
    ctx.on.mockImplementation((name: string, h: (...args: unknown[]) => void) => {
      const list = listeners.get(name) ?? []
      list.push(h)
      listeners.set(name, list)
      return () => { }
    })
    ctx.reflect.get.mockImplementation((name: string) => {
      if (name === 'tasks') return {
        list: vi.fn(() => [
          { id: 't1', kind: 'bash', label: 'pnpm test', status: 'running', startedAt: Date.now() },
        ]),
        kill: vi.fn(() => 'requested'),
        onTaskDone: vi.fn(() => () => { }),
        attachSurface: vi.fn(() => () => { }),
      }
      return undefined
    })
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin: makeStdin() })
    await app.attach()
    const fire = (name: string, ...args: unknown[]) => {
      for (const h of listeners.get(name) ?? []) h(...args)
    }
    fire('workflow/start', { id: 'wf-1', meta: { name: 'workflow', description: '客观目标' } })
    fire('workflow/agent-start', { id: 'wf-1' }, { seq: 1, label: '执行员', childId: 'child-9' })
    await settle()
    const running = writtenOf(stdout)
    // 字形与文本间有 ANSI 色码，分段断言
    expect(running).toContain('⏳')
    expect(running).toContain('[workflow] 客观目标')
    expect(running).toContain('1 个 agent')
    expect(running).toContain('bash: pnpm test') // 活跃后台任务并入带
    // 结束：摘要一行 commit 进 scrollback
    stdout.write.mockClear()
    fire('workflow/end', { id: 'wf-1' }, { stopReason: 'completed' })
    await settle()
    const done = writtenOf(stdout)
    expect(done).toContain('✓')
    expect(done).toContain('[workflow] 客观目标 · 1 个 agent') // 摘要 commit
    expect(done).not.toContain('⏳') // 带行移除
    await app.dispose()
  })
})

describe('委派面板外部 run 段接线（G3）', () => {
  it('activeExternalRuns 命中 → /subagents 面板渲染 ⤷ 外部段', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('ext-run')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    ctx.reflect.get.mockImplementation((name: string) => {
      if (name === 'subagents') return {
        listDescendants: vi.fn(async () => []),
        activeExternalRuns: vi.fn(() => ([
          { id: 'ext-1', provider: 'acp', label: '外部检索', startedAt: 1000 },
        ])),
      }
      return undefined
    })
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin })
    await app.attach()
    await new Promise(resolve => setTimeout(resolve, 40))
    stdout.write.mockClear()
    app.handleSubmit('/subagents')
    await new Promise(resolve => setTimeout(resolve, 40))
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('⤷ 外部子代理')
    expect(written).toContain('外部检索')
    expect(written).toContain('acp')
    await app.dispose()
  })

  it('旧形状 subagents 服务（无 activeExternalRuns）→ 不渲染外部段不抛错', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('ext-legacy')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    ctx.reflect.get.mockImplementation((name: string) => {
      if (name === 'subagents') return { listDescendants: vi.fn(async () => []), activeExternalRuns: () => [] }
      return undefined
    })
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin })
    await app.attach()
    await new Promise(resolve => setTimeout(resolve, 40))
    stdout.write.mockClear()
    app.handleSubmit('/subagents')
    await new Promise(resolve => setTimeout(resolve, 40))
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).not.toContain('⤷ 外部子代理')
    await app.dispose()
  })
})

describe('bracketed paste 接线（多行/长文本粘贴不逐行提交）', () => {
  function boot() {
    const ctx = makeCtx()
    const agent = makeAgent('paste-test')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin })
    return { ctx, agent, handle, stdin, stdout, app }
  }

  it('attach 启用 bracketed paste，dispose 关闭', async () => {
    const { stdout, app } = boot()
    await app.attach()
    let written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('\x1b[?2004h') // DECSET 2004 on
    expect(written).toContain('\x1b[>1u') // Kitty disambiguate
    await app.dispose()
    written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('\x1b[?2004l') // DECSET 2004 off
    expect(written).toContain('\x1b[<u')
  })

  it('Shift+Enter（CSI 13;2u）切换手工换行：Enter 插换行，再切回后提交', async () => {
    const { agent, stdin, stdout, app } = boot()
    await app.attach()
    stdin.emit('data', '\x1b[13;2u')
    await new Promise(resolve => setImmediate(resolve))
    expect(stdout.write.mock.calls.map(c => `${c[0]}`).join('')).toContain('换行中')
    stdin.emit('data', 'hello\r')
    await new Promise(resolve => setTimeout(resolve, 40))
    expect(agent.followup).not.toHaveBeenCalled()
    stdin.emit('data', '\x1b[13;2u')
    await new Promise(resolve => setImmediate(resolve))
    stdin.emit('data', '\r')
    await new Promise(resolve => setTimeout(resolve, 40))
    expect(agent.followup).toHaveBeenCalledTimes(1)
    expect(firstCallText(agent.followup)).toBe('hello')
    await app.dispose()
  })

  it('非 bracketed paste 终端粘贴多行（\\r 逐行裸入）→ 合并为一次发送', async () => {
    const { agent, stdin, app } = boot()
    await app.attach()
    // 模拟不支持 DECSET 2004 的终端：粘贴文本逐行裸入（行尾 CR 无包裹）
    stdin.emit('data', '第一行\r第二行\r第三行\r')
    await new Promise(resolve => setTimeout(resolve, 120))
    // 三行合并为一次 followup（多行文本），而非逐行三次发送
    expect(agent.followup).toHaveBeenCalledTimes(1)
    const sent = agent.followup.mock.calls[0]?.[0] as { content: Array<{ type: string; text: string }> }
    expect(sent?.content?.[0]?.text).toBe('第一行\n第二行\n第三行')
    await app.dispose()
  })

  it('多行粘贴整段进入输入行（不逐行提交）', async () => {
    const { stdin, stdout, app } = boot()
    await app.attach()
    stdout.write.mockClear()
    const pasted = '第一行报错\n  第二行\n第三行'
    stdin.emit('data', `\x1b[200~${pasted}\x1b[201~`)
    await new Promise(resolve => setTimeout(resolve, 40))
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    // 整段进输入行（多行渲染），无逐行提交痕迹
    expect(written).toContain('第一行报错')
    expect(written).toContain('第二行')
    expect(written).toContain('第三行')
    // 无提交：输入行仍处于编辑态（占位符不出现 = 输入行非空且未清空）
    await app.dispose()
  })

  it('长粘贴（超折叠阈值）收纳为标记，不撑爆输入行', async () => {
    const { stdin, stdout, app } = boot()
    await app.attach()
    stdout.write.mockClear()
    const longText = Array.from({ length: 120 }, (_, i) => `line-${i}`).join('\n')
    stdin.emit('data', `\x1b[200~${longText}\x1b[201~`)
    await new Promise(resolve => setTimeout(resolve, 40))
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('[paste #1 +120 lines]') // 折叠标记（阈值已抬至 100 行/10K 字符）
    await app.dispose()
  })
})

describe('TuiApp 剪贴板图片与复制（opencode 接线移植）', () => {
  const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  const PNG_DATA_URL = `data:image/png;base64,${PNG_B64}`

  function boot(vision?: { supportsVision?: boolean; bridgeEnabled?: boolean; bridgeSource?: 'configured' | 'auto' | 'none' }) {
    const ctx = makeCtx()
    const agent = makeAgent('clipboard-test')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({
      ctx,
      stdout,
      stdin,
      ...(vision === undefined ? {} : { vision }),
    })
    return { ctx, agent, handle, stdin, stdout, app }
  }

  afterEach(() => {
    vi.mocked(readImageFromClipboard).mockReset()
    vi.mocked(readTextFromClipboard).mockReset()
  })

  it('Ctrl+V：剪贴板有图 → 附图，live 区渲染 📎 标记', async () => {
    vi.mocked(readImageFromClipboard).mockResolvedValueOnce({ dataUrl: PNG_DATA_URL, mime: 'image/png', name: 'clipboard.png', source: 'png' })
    const { stdin, stdout, app } = boot()
    await app.attach()
    stdout.write.mockClear()
    stdin.emit('data', '\x16') // ctrl_v (0x16)
    await new Promise(resolve => setTimeout(resolve, 30))
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('📎 1 image')
    await app.dispose()
  })

  it('Ctrl+V：剪贴板无图 → fallback 剪贴板文本进输入行', async () => {
    vi.mocked(readTextFromClipboard).mockResolvedValueOnce('pasted from ctrl-v')
    const { stdin, stdout, app } = boot()
    await app.attach()
    stdout.write.mockClear()
    stdin.emit('data', '\x16')
    await new Promise(resolve => setTimeout(resolve, 30))
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('pasted from ctrl-v')
    await app.dispose()
  })

  it('Ctrl+V：剪贴板无图且无文本 → 回显读图不可用警告（P1-1）', async () => {
    vi.mocked(readImageFromClipboard).mockResolvedValueOnce(null)
    vi.mocked(readTextFromClipboard).mockResolvedValueOnce(null)
    const { stdin, stdout, app } = boot()
    await app.attach()
    stdout.write.mockClear()
    stdin.emit('data', '\x16') // ctrl_v
    await new Promise(resolve => setTimeout(resolve, 30))
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('剪贴板无内容可粘贴（读图需 osascript / wl-paste / xclip / PowerShell）')
    await app.dispose()
  })

  it('onPaste：剪贴板有图 → 附图并吞掉乱码 paste（输入行无乱码文本）', async () => {
    vi.mocked(readImageFromClipboard).mockResolvedValueOnce({ dataUrl: PNG_DATA_URL, mime: 'image/png', name: 'clipboard.png', source: 'png' })
    const { stdin, stdout, app } = boot()
    await app.attach()
    stdout.write.mockClear()
    // 右键粘贴图片：终端把图片字节作为文本 paste 进来（乱码）
    stdin.emit('data', '\x1b[200~���PNG\x1b[201~')
    // 条件轮询替代固定 40ms：附图渲染异步落定，全量并发负载下固定等待
    // 曾欠额（与本文件流利度 flaky 同类根因；移植 dsh-tui 86cea46）
    await vi.waitFor(() => {
      const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
      expect(written).toContain('📎 1 image')
    }, { timeout: 5_000, interval: 25 })
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).not.toContain('���PNG') // 乱码被吞
    await app.dispose()
  })

  it('onPaste：粘贴内容像图片路径 → 加载为附件', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tui-paste-img-'))
    const pngPath = join(dir, 'shot.png')
    writeFileSync(pngPath, Buffer.from(PNG_B64, 'base64'))
    try {
      const { stdin, stdout, app } = boot()
      await app.attach()
      stdout.write.mockClear()
      stdin.emit('data', `\x1b[200~${pngPath}\x1b[201~`)
      // 条件轮询替代固定 60ms（同上：异步加载 + 渲染在全量并发下不定时落定）
      await vi.waitFor(() => {
        const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
        expect(written).toContain('📎 1 image')
      }, { timeout: 5_000, interval: 25 })
      await app.dispose()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('onPaste：图片路径加载失败 → 警告 + 回退普通文本', async () => {
    const { stdin, stdout, app } = boot()
    await app.attach()
    stdout.write.mockClear()
    stdin.emit('data', '\x1b[200~/nonexistent/does-not-exist.png\x1b[201~')
    await new Promise(resolve => setTimeout(resolve, 60))
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('图片加载失败')
    await app.dispose()
  })

  it('Alt+W 选区复制 → OSC52 序列写 stdout（app drain）', async () => {
    const { stdin, stdout, app } = boot()
    await app.attach()
    stdout.write.mockClear()
    // 输入 'hello'，shift+home 全选，Alt+W 复制（ESC+w）→ _clipboardOut → OSC52 drain
    for (const ch of 'hello') stdin.emit('data', ch)
    stdin.emit('data', '\x1b[1;2H') // shift+home
    stdin.emit('data', '\x1bw') // Alt+W
    await new Promise(resolve => setTimeout(resolve, 30))
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('\x1b]52;c;') // OSC52 clipboard write
    await app.dispose()
  })

  it('Alt+W 且终端不支持 OSC52 → 首次回显警告一次，二次静默（序列仍写出，P1-1）', async () => {
    const prevProg = process.env.TERM_PROGRAM
    const prevTerm = process.env.TERM
    process.env.TERM_PROGRAM = 'Apple_Terminal' // macOS Terminal.app 不支持 OSC52
    delete process.env.TERM
    try {
      const { stdin, stdout, app } = boot()
      await app.attach()
      stdout.write.mockClear()
      for (const ch of 'hello') stdin.emit('data', ch)
      stdin.emit('data', '\x1b[1;2H') // shift+home 全选
      stdin.emit('data', '\x1bw')     // Alt+W
      await new Promise(resolve => setTimeout(resolve, 30))
      const first = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
      expect(first).toContain('OSC52')          // 警告出现
      expect(first).toContain('\x1b]52;c;')     // 降级不变：序列仍写出（无害忽略）
      // 二次 Alt+W：重新选区（光标在行首，shift+end 全选）后复制，警告不重复
      stdout.write.mockClear()
      stdin.emit('data', '\x1b[1;2F') // shift+end
      stdin.emit('data', '\x1bw')
      await new Promise(resolve => setTimeout(resolve, 30))
      const second = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
      expect(second).not.toContain('OSC52')
      expect(second).toContain('\x1b]52;c;')
      await app.dispose()
    } finally {
      if (prevProg === undefined) delete process.env.TERM_PROGRAM
      else process.env.TERM_PROGRAM = prevProg
      if (prevTerm === undefined) delete process.env.TERM
      else process.env.TERM = prevTerm
    }
  })

  it('提交带图：用户气泡含 📎 行 + followup 收到含 image block 的 UserMessage', async () => {
    const { agent, app } = boot({ supportsVision: true })
    await app.attach()
    app.handleSubmit('看图', [PNG_DATA_URL])
    const msg = agent.followup.mock.calls[0]?.[0] as { content: unknown[] } | undefined
    expect(msg).toBeDefined()
    expect(msg?.content).toEqual([
      { type: 'text', text: '看图' },
      { type: 'image', dataUrl: PNG_DATA_URL },
    ])
    await app.dispose()
  })

  it('提交带图：空文本 + 图 → 占位 prompt 📎 图片消息', async () => {
    const { agent, app } = boot({ supportsVision: true })
    await app.attach()
    app.handleSubmit('', [PNG_DATA_URL])
    const msg = agent.followup.mock.calls[0]?.[0] as { content: unknown[] } | undefined
    expect(msg?.content[0]).toMatchObject({ type: 'text', text: '📎 图片消息' })
    await app.dispose()
  })

  it('vision 三态气泡：主控不识图 + 无桥 → 警告图片未发送', async () => {
    const { stdout, app, agent } = boot({ supportsVision: false, bridgeEnabled: false })
    await app.attach()
    app.handleSubmit('hi', [PNG_DATA_URL])
    await new Promise(resolve => setTimeout(resolve, 40))
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('图片未发送')
    // 图片不可达时不发送：followup 只含 text block，无 image block。
    const msg = agent.followup.mock.calls[0]?.[0] as { content: unknown[] } | undefined
    expect(msg?.content).toEqual([{ type: 'text', text: 'hi' }])
    await app.dispose()
  })

  it('只发图但主控不识图无桥 → 仅回显警告气泡，不触发 followup', async () => {
    const { stdout, app, agent } = boot({ supportsVision: false, bridgeEnabled: false })
    await app.attach()
    app.handleSubmit('', [PNG_DATA_URL])
    await new Promise(resolve => setTimeout(resolve, 40))
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('图片未发送')
    expect(agent.followup).not.toHaveBeenCalled()
    await app.dispose()
  })

  it('vision 三态气泡：识图桥启用 → 经桥描述提示', async () => {
    const { stdout, app, agent } = boot({ supportsVision: false, bridgeEnabled: true, bridgeSource: 'configured' })
    await app.attach()
    app.handleSubmit('hi', [PNG_DATA_URL])
    await new Promise(resolve => setTimeout(resolve, 40))
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('经识图桥')
    // 有桥时图片照发（经 agent/pre-step 视觉桥转描述）。
    const msg = agent.followup.mock.calls[0]?.[0] as { content: unknown[] } | undefined
    expect(msg?.content).toEqual([
      { type: 'text', text: 'hi' },
      { type: 'image', dataUrl: PNG_DATA_URL },
    ])
    await app.dispose()
  })

  it('视觉桥探测：未注入 vision 配置但宿主 provide visionBridge 服务 → 图片照发', async () => {
    const { ctx, stdout, app, agent } = boot() // 无 vision 配置（npm 装配形态）
    const fallback = ctx.reflect.get.getMockImplementation()! as (name: string) => unknown
    ctx.reflect.get.mockImplementation((name: string) =>
      name === 'visionBridge' ? { describeImage: vi.fn() } : fallback(name))
    await app.attach()
    app.handleSubmit('hi', [PNG_DATA_URL])
    await new Promise(resolve => setTimeout(resolve, 40))
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('经识图桥')
    expect(written).not.toContain('图片未发送')
    const msg = agent.followup.mock.calls[0]?.[0] as { content: unknown[] } | undefined
    expect(msg?.content).toEqual([
      { type: 'text', text: 'hi' },
      { type: 'image', dataUrl: PNG_DATA_URL },
    ])
    await app.dispose()
  })

  it('vision 三态气泡：主控支持识图 → 无提示行', async () => {
    const { stdout, app, agent } = boot({ supportsVision: true })
    await app.attach()
    app.handleSubmit('hi', [PNG_DATA_URL])
    await new Promise(resolve => setTimeout(resolve, 40))
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).not.toContain('识图')
    // 识图主控直发：图片照发。
    const msg = agent.followup.mock.calls[0]?.[0] as { content: unknown[] } | undefined
    expect(msg?.content).toEqual([
      { type: 'text', text: 'hi' },
      { type: 'image', dataUrl: PNG_DATA_URL },
    ])
    await app.dispose()
  })

  it('空行 Alt+Backspace → 移除末张附件（📎 行消失，键位提示随行展示）', async () => {
    vi.mocked(readImageFromClipboard).mockResolvedValueOnce({ dataUrl: PNG_DATA_URL, mime: 'image/png', name: 'clipboard.png', source: 'png' })
    const { stdin, stdout, app } = boot()
    await app.attach()
    stdin.emit('data', '\x1b[200~\x1b[201~') // 触发剪贴板读图（右键粘贴路由）
    await vi.waitFor(() => {
      const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
      expect(written).toContain('📎 1 image · Alt+⌫ 移除末张')
    }, { timeout: 5_000, interval: 25 })
    stdout.write.mockClear()
    stdin.emit('data', '\x1b\x7f') // Alt+Backspace（ESC + DEL）
    await vi.waitFor(() => {
      const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
      expect(written).not.toContain('📎')
    }, { timeout: 5_000, interval: 25 })
    await app.dispose()
  })

  it('非空行 Alt+Backspace → 仍是词删除，不动附件', async () => {
    vi.mocked(readImageFromClipboard).mockResolvedValueOnce({ dataUrl: PNG_DATA_URL, mime: 'image/png', name: 'clipboard.png', source: 'png' })
    const { stdin, stdout, app } = boot()
    await app.attach()
    stdin.emit('data', '\x1b[200~\x1b[201~')
    await vi.waitFor(() => {
      const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
      expect(written).toContain('📎 1 image')
    }, { timeout: 5_000, interval: 25 })
    for (const ch of 'hi ') stdin.emit('data', ch)
    await new Promise(resolve => setTimeout(resolve, 40))
    // 删词后画面回到与打字前相同的一帧（内容去重 → 零输出），像素断言不可
    // 用；直接断言状态：词被删、图保留。
    stdin.emit('data', '\x1b\x7f') // 词删除（光标在文本尾）：删词不删图
    await new Promise(resolve => setTimeout(resolve, 60))
    const line = (app as unknown as { inputLine: { images: string[]; value: string } }).inputLine
    expect(line.images).toHaveLength(1)
    expect(line.value).toBe('')
  })
})

describe('TuiApp 图片预览（composer 半块缩略图 + 无协议回退）', () => {
  /**
   * 上红下蓝双色 PNG（8×2）：真实 sharp 解码路径。8 宽使 composer 网格
   * （min(30, 宽) 下限 8）做恒等缩放，色界恰好落在字符行上下半之间——
   * 缩略图行可精确断言「红前景 + 蓝背景」。
   */
  let twoToneUrl: string
  beforeAll(async () => {
    const { default: sharp } = await import('sharp')
    const buf = Buffer.alloc(8 * 2 * 3)
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 8; x++) {
        const i = (y * 8 + x) * 3
        buf[i] = y === 0 ? 255 : 0
        buf[i + 1] = 0
        buf[i + 2] = y === 0 ? 0 : 255
      }
    }
    const b64 = await sharp(buf, { raw: { width: 8, height: 2, channels: 3 } })
      .png()
      .toBuffer()
      .then(b => b.toString('base64'))
    twoToneUrl = `data:image/png;base64,${b64}`
  })

  function boot() {
    const ctx = makeCtx()
    const agent = makeAgent('preview-test')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin })
    return { ctx, agent, handle, stdin, stdout, app }
  }

  afterEach(() => {
    vi.mocked(readImageFromClipboard).mockReset()
    setImageProtocol(null)
  })

  it('附图后 composer 在 📎 行上方渲染最后一张的半块缩略图', async () => {
    vi.mocked(readImageFromClipboard).mockResolvedValueOnce({ dataUrl: twoToneUrl, mime: 'image/png', name: 'clipboard.png', source: 'png' })
    const { stdin, stdout, app } = boot()
    await app.attach()
    stdin.emit('data', '\x1b[200~\x1b[201~')
    await vi.waitFor(() => {
      const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
      expect(written).toContain('📎 1 image')
      // 上半红前景 + 下半蓝背景的单游程行（真实像素解码结果）。
      expect(written).toContain('\x1B[38;2;255;0;0m\x1B[48;2;0;0;255m▀')
    }, { timeout: 5_000, interval: 25 })
    await app.dispose()
  })

  it('移除末张后缩略图随附件清空（不留过期图片）', async () => {
    vi.mocked(readImageFromClipboard).mockResolvedValueOnce({ dataUrl: twoToneUrl, mime: 'image/png', name: 'clipboard.png', source: 'png' })
    const { stdin, app } = boot()
    await app.attach()
    stdin.emit('data', '\x1b[200~\x1b[201~')
    await vi.waitFor(() => {
      const state = app as unknown as { attachmentPreview: { lines: string[] } | null }
      expect(state.attachmentPreview).not.toBeNull()
    }, { timeout: 5_000, interval: 25 })
    stdin.emit('data', '\x1b\x7f') // Alt+Backspace 移除末张
    await vi.waitFor(() => {
      const state = app as unknown as { attachmentPreview: { lines: string[] } | null }
      expect(state.attachmentPreview).toBeNull()
    }, { timeout: 5_000, interval: 25 })
    await app.dispose()
  })

  it('无图形协议终端：提交后气泡下方追加半块回退，而非 kitty/iTerm2 序列', async () => {
    setImageProtocol('none')
    vi.mocked(readImageFromClipboard).mockResolvedValueOnce({ dataUrl: twoToneUrl, mime: 'image/png', name: 'clipboard.png', source: 'png' })
    const { stdin, stdout, app } = boot()
    await app.attach()
    stdin.emit('data', '\x1b[200~\x1b[201~')
    await vi.waitFor(() => {
      const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
      expect(written).toContain('📎 1 image')
    }, { timeout: 5_000, interval: 25 })
    for (const ch of 'hi') stdin.emit('data', ch)
    stdin.emit('data', '\r')
    await vi.waitFor(() => {
      const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
      // 半块回退写入 scrollback（与图形路径同编舞：清 live 区 → writeRaw）。
      expect(written).toContain('\x1B[38;2;255;0;0m\x1B[48;2;0;0;255m▀')
      // 协议序列未发出（none 路径不出 kitty APC / iTerm2 OSC 1337）。
      expect(written).not.toContain('\x1B_G')
      expect(written).not.toContain('1337;File')
    }, { timeout: 5_000, interval: 25 })
    await app.dispose()
  })
})
describe('LSP 诊断桥（黑盒：假 server 注入）', () => {
  /** 假诊断行（FakeLspServer 与 tsError 共用；line/character 为 0-based LSP 坐标）。 */
  type FakeRange = { start: { line: number; character: number }; end: { line: number; character: number } }
  type FakeLspDiagnostic = { range: FakeRange; severity: 1 | 2 | 3 | 4; message: string }

  /** 假 LSP server（stdin 收请求、stdout 回响应；pull 模型）。 */
  class FakeLspServer {
    readonly proc = {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      on: vi.fn(),
      kill: vi.fn(),
    } as unknown as ChildProcess
    diagnosticItems: FakeLspDiagnostic[] = []

    constructor() {
      const stdin = this.proc.stdin as unknown as PassThrough
      const stdout = this.proc.stdout as unknown as PassThrough
      stdin.on('data', (chunk: Buffer) => {
        const { messages } = decodeMessages(chunk)
        for (const msg of messages) {
          if (!('id' in msg) || 'result' in msg || 'error' in msg) continue
          const req = msg as { id: number; method: string }
          if (req.method === 'initialize') {
            stdout.write(encodeMessage({ jsonrpc: '2.0', id: req.id, result: { capabilities: { diagnosticProvider: {} } } }))
          } else if (req.method === 'textDocument/diagnostic') {
            stdout.write(encodeMessage({ jsonrpc: '2.0', id: req.id, result: { items: this.diagnosticItems } }))
          } else {
            stdout.write(encodeMessage({ jsonrpc: '2.0', id: req.id, result: null }))
          }
        }
      })
    }
  }

  function tsError(message: string): FakeLspDiagnostic {
    return { range: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } }, severity: 1, message }
  }

  function written(stdout: WriteStream & { write: ReturnType<typeof vi.fn> }): string {
    return stdout.write.mock.calls.map(c => `${c[0]}`).join('')
  }

  /**
   * 装配 LSP 黑盒 ctx：newSession 给 agents.create 传 `sessionId: session-<uuid>`，
   * mock 必须返回同 id 的 session——否则 mountSession 的绑定 id（uuid）、
   * streamFeed 过滤 id（uuid）与 transcript 的 session.id（agent 替身 id）
   * 三处不一致，事件广播对不上。live 替身随 create 入参构造，get 按 id 返回。
   */
  function makeLspCtx(agent: Agent & MockAgent): ReturnType<typeof makeCtx> {
    const ctx = makeCtx()
    let live = agent.session
    // mockImplementation 需异步返回值；vitest 的 NormalizedProcedure 推断把它当 void
    // 期望触发 no-misused-promises 误报——真实语义是 mock 工厂，豁免并说明。
    // oxlint-disable-next-line no-misused-promises
    ctx.agents.create.mockImplementation(async (opts?: { sessionId?: SessionId }) => {
      const sid = opts?.sessionId ?? agent.session.id
      // 复制 live 替身并改 id（class 实例不可 spread——Object.assign 保持原值语义）
      // oxlint-disable-next-line no-unnecessary-type-assertion -- Object.assign 交叉类型 tsc 需要收窄
      live = Object.assign({}, agent.session, {
        id: sid,
        header: { ...agent.session.header, id: sid },
      }) as unknown as typeof agent.session
      return makeHandle({ ...agent, id: sid, session: live })
    })
    ctx.sessions.get.mockImplementation(() => live)
    return ctx
  }

  it('tool/call 触碰文件 → 工具卡标题带 LSP 诊断徽标', async () => {
    const ctx = makeLspCtx(makeAgent('lsp-badge-1'))
    const server = new FakeLspServer()
    server.diagnosticItems = [tsError('类型不匹配')]
    const stdout = makeStdout()
    const app = new TuiApp({
      ctx, stdout, stdin: makeStdin(),
      lsp: { timeoutMs: 200, spawnFor: () => server.proc },
    })
    await app.attach()
    const emit = sessionEventBus(ctx)
    const sid = app.sessionId
    if (sid === null) throw new Error('attach 后应有活跃会话')
    emit(sid, {
      type: 'tool/call',
      seq: 1,
      time: 1,
      data: {
        turn: 1, step: 1, callId: 'lsp-call-1', name: 'write_file',
        arguments: JSON.stringify({ path: '/work/src/a.ts', content: 'const x: number = "s"' }),
      },
    })
    // 第一步：工具卡标题出现（事件已处理；transcript fold 渲染）
    await vi.waitFor(() => {
      expect(written(stdout)).toContain('Write(')
    }, { timeout: 3_000, interval: 50 })
    // 第二步：诊断拉取完成，徽标上卡（异步，慢于事件渲染）
    await vi.waitFor(() => {
      expect(written(stdout)).toContain('⚠ 1错')
    }, { timeout: 5_000, interval: 50 })
    await app.dispose()
  })

  it('/lsp 打开面板：无诊断缓存时渲染空态行', async () => {
    const ctx = makeLspCtx(makeAgent('lsp-panel-1'))
    const stdout = makeStdout()
    const app = new TuiApp({
      ctx, stdout, stdin: makeStdin(),
      lsp: { timeoutMs: 200, spawnFor: () => new FakeLspServer().proc },
    })
    await app.attach()
    app.handleSubmit('/lsp')
    await vi.waitFor(() => {
      expect(written(stdout)).toContain('无 LSP 诊断')
    }, { timeout: 3_000, interval: 50 })
    await app.dispose()
  })

  it('未知扩展名文件触碰 + /lsp：不 spawn、空态不崩', async () => {
    const ctx = makeLspCtx(makeAgent('lsp-unsupported-1'))
    const server = new FakeLspServer()
    const stdout = makeStdout()
    const app = new TuiApp({
      ctx, stdout, stdin: makeStdin(),
      lsp: { timeoutMs: 200, spawnFor: () => server.proc },
    })
    await app.attach()
    const emit = sessionEventBus(ctx)
    const sid = app.sessionId
    if (sid === null) throw new Error('attach 后应有活跃会话')
    emit(sid, {
      type: 'tool/call',
      seq: 1,
      time: 1,
      data: {
        turn: 1, step: 1, callId: 'lsp-call-2', name: 'read',
        arguments: JSON.stringify({ path: '/work/notes.xyz' }),
      },
    })
    app.handleSubmit('/lsp')
    await vi.waitFor(() => {
      expect(written(stdout)).toContain('无 LSP 诊断')
    }, { timeout: 3_000, interval: 50 })
    // 未知扩展名未 spawn 任何 server
    // oxlint-disable-next-line unbound-method -- proc 整体 cast 成 ChildProcess 后 kill 是方法面；测试只断言调用
    expect(server.proc.kill as unknown as ReturnType<typeof vi.fn>).not.toHaveBeenCalled()
    await app.dispose()
  })

  it('伴生插件 provide(lsp) 服务存在 → 徽标走服务（不 spawn 内置 server）', async () => {
    const ctx = makeLspCtx(makeAgent('lsp-source-1'))
    // 假官方 ctx.lsp 服务（结构类型：query(getDiagnostics) 五操作 seam）
    const serviceQuery = vi.fn(async () => ({
      kind: 'diagnostics',
      diagnostics: [
        { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }, severity: 1 as const, message: '服务源诊断' },
      ],
    }))
    ctx.reflect.get.mockImplementation((name: string) => {
      if (name === 'lsp') return { query: serviceQuery }
      return undefined
    })
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin: makeStdin(), lsp: { timeoutMs: 200 } })
    await app.attach()
    const emit = sessionEventBus(ctx)
    const sid = app.sessionId
    if (sid === null) throw new Error('attach 后应有活跃会话')
    emit(sid, {
      type: 'tool/call',
      seq: 1,
      time: 1,
      data: {
        turn: 1, step: 1, callId: 'lsp-call-3', name: 'write_file',
        arguments: JSON.stringify({ path: '/work/src/a.ts', content: 'x' }),
      },
    })
    await vi.waitFor(() => {
      expect(written(stdout)).toContain('⚠ 1错')
    }, { timeout: 3_000, interval: 50 })
    // 服务被消费（无需内置 spawn——未注入 spawnFor，若走内置会真 spawn）
    expect(serviceQuery).toHaveBeenCalled()
    await app.dispose()
  })
})
describe('TuiApp 首帧渲染等待 settings/credentials 服务（A1/A2）', () => {
  it('服务已注册但未激活时，attach 等待激活后再创建会话/渲染（API ✓ + settings 模型生效）', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('svc-1')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    ctx.sessions.list.mockReturnValue([])
    const stdin = makeStdin()
    const stdout = makeStdout()

    // 模拟 dsh-base 的 credentials/settings：已注册（非严格可取）但 fiber 未激活
    // （严格取不到），随后在 attach 进行中完成激活。currentSelection 在激活前
    // 返回 config 默认值、激活后返回 settings 值（真实行为）。
    let activated = false
    const credentials = { describe: vi.fn(async () => ({ configured: true, source: 'file' as const, writable: true })) }
    ctx.agentDefaultModel.currentSelection.mockImplementation(() => activated
      ? { provider: 'deepseek-official', model: 'deepseek' }
      : { provider: 'deepseek-official', model: 'deepseek-v4-flash' })
    ctx.reflect.get.mockImplementation((name: string, strict = true) => {
      if (name === 'settings') return strict ? (activated ? {} : undefined) : {}
      if (name === 'credentials') return strict ? (activated ? credentials : undefined) : credentials
      return undefined
    })

    const app = new TuiApp({ ctx, stdout, stdin })
    const attachPromise = app.attach()
    // 服务在 attach 等待窗口内激活（真实场景：文件读 + watcher 初始化，毫秒级）。
    setTimeout(() => { activated = true }, 50)
    await attachPromise

    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    // 等待生效 → refreshApiKeyReady 经 credentials.describe 读到 configured → footer 最终 ✓
    expect(written.lastIndexOf('API ✓')).toBeGreaterThan(written.lastIndexOf('API ✗'))
    // A2：会话创建时快照的是 settings 的模型（deepseek），而非 config 默认
    // （deepseek-v4-flash）——等待发生在 newSession 之前。
    const createArg = ctx.agents.create.mock.calls[0]?.[0] as { agentOptions?: { provider: string; model: string } } | undefined
    expect(createArg?.agentOptions).toEqual({ provider: 'deepseek-official', model: 'deepseek' })
    await app.dispose()
  })

  it('服务未注册（mock 缺省）时 attach 不被等待阻塞，走 env 回退（API ✗）', async () => {
    // 显式清掉 DEEPSEEK_API_KEY：该用例断言 env 回退路径，宿主环境可能已设
    // 该变量（setx 持久化等），避免测试环境相关的不稳定。
    const prevKey = process.env.DEEPSEEK_API_KEY
    delete process.env.DEEPSEEK_API_KEY
    try {
      const ctx = makeCtx()
      const agent = makeAgent('svc-2')
      const handle = makeHandle(agent)
      ctx.agents.create.mockResolvedValue(handle)
      ctx.sessions.get.mockReturnValue(agent.session)
      ctx.sessions.list.mockReturnValue([])
      const stdin = makeStdin()
      const stdout = makeStdout()

      const app = new TuiApp({ ctx, stdout, stdin })
      await app.attach()

      const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
      // 无 credentials 服务 → process.env 回退（已清空）→ ✗
      expect(written.lastIndexOf('API ✗')).toBeGreaterThan(written.lastIndexOf('API ✓'))
      await app.dispose()
    } finally {
      if (prevKey !== undefined) process.env.DEEPSEEK_API_KEY = prevKey
    }
  })
})


describe('TuiApp cmdline 参数处理（A3）', () => {
  it('--help 输出用法并经 appExit(0) 退出，不进入交互', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('arg-help')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    const exit = vi.fn()
    ctx.reflect.get.mockImplementation((name: string) => {
      if (name === 'cmdlineArgs') return { get: () => ['--help'] }
      if (name === 'appExit') return exit
      return undefined
    })
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin })
    await app.attach()
    const written = stdout.write.mock.calls.map(c => `${c[0]}`).join('')
    expect(written).toContain('oh-my-tianshu tui')
    expect(exit).toHaveBeenCalledWith(0)
    // 未进入交互：没有创建会话/订阅（attach 提前返回）
    expect(ctx.agents.create).not.toHaveBeenCalled()
    await app.dispose()
  })

  it('纯位置参数作为初始 prompt 发送', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('arg-prompt')
    const handle = makeHandle(agent)
    ctx.agents.create.mockResolvedValue(handle)
    ctx.sessions.get.mockReturnValue(agent.session)
    ctx.reflect.get.mockImplementation((name: string) => {
      if (name === 'cmdlineArgs') return { get: () => ['修复这个', 'bug'] }
      return undefined
    })
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin })
    await app.attach()
    expect(firstCallText(agent.followup)).toBe('修复这个 bug')
    await app.dispose()
  })
})

describe('会话切换稳健性（switchSession 竞态 / restore 失败 / 委派树重绘）', () => {
  it('快速连续切换：迟到的 resume 不得覆盖新会话的挂载', async () => {
    const ctx = makeCtx()
    ctx.sessions.list.mockReturnValue([])
    const sA = SessionId('session-race-a')
    const sB = SessionId('session-race-b')
    // 完整 session 形状（requestHeader/events 等）——mountSession 会读
    ctx.sessions.get.mockImplementation((id: SessionId) => makeAgent(String(id)).session)
    ctx.agents.create.mockResolvedValue(makeHandle(makeAgent('race-boot')))
    // A 的 resume 挂起（手动放行），B 的立即完成
    let releaseA!: (handle: AgentHandle) => void
    const resumeA = new Promise<AgentHandle>((resolve) => { releaseA = resolve })
    const disposeB = vi.fn()
    const handleB = makeHandle(makeAgent('race-b'), disposeB)
    // 与 L7031 同款误报：mock 工厂返回 Promise，vitest 推断把期望当 void。
    // oxlint-disable-next-line no-misused-promises
    ctx.agents.resume.mockImplementation((req: { resumeSessionId: SessionId }) =>
      req.resumeSessionId === sA ? resumeA : Promise.resolve(handleB))
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin })
    await app.attach()
    // 先切 A（resume 挂起中），B 随即跟上并先完成
    const switchA = app.switchSession(sA)
    await new Promise(resolve => setImmediate(resolve))
    const switchB = app.switchSession(sB)
    await switchB
    expect(app.sessionId).toBe(sB)
    // A 的 resume 这时才完成（迟到）：不得挂载 A / 覆盖 ownedHandle
    releaseA(makeHandle(makeAgent('race-a')))
    await switchA
    await app.dispose()
    // 退出时 dispose 的是当前挂载（B）的 handle——若迟到的 A 覆盖过
    // ownedHandle，这里 dispose 的会是 A 的 handle 而 B 泄漏
    expect(disposeB).toHaveBeenCalledTimes(1)
  })

  it('restoreRecentOtherSession：listSessions 拒绝 → 静默降级不产生 unhandled rejection', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('restore-fail')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    ctx.agents.get.mockReturnValue(agent)
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin })
    await app.attach()
    // attach 完成后再让 list 失败（attach 自身要读 live store 判空）
    ctx.sessions.list.mockImplementation(() => { throw new Error('boom') })
    const internal = app as unknown as { restoreRecentOtherSession(): Promise<void> }
    await expect(internal.restoreRecentOtherSession()).resolves.toBeUndefined()
    await app.dispose()
  })

  it('委派树刷新失败 → 置空并调度重绘（面板不滞留旧树）', async () => {
    const ctx = makeCtx()
    const agent = makeAgent('deleg-fail')
    ctx.agents.create.mockResolvedValue(makeHandle(agent))
    ctx.sessions.get.mockReturnValue(agent.session)
    ctx.sessions.list.mockReturnValue([])
    const okEntries = [{
      kind: 'child', id: 'child-1', parentId: 'root', depth: 1,
      activity: 'running', hasChildren: false, mode: 'one-shot', label: '探查',
    }]
    let descendants: (id: SessionId) => Promise<typeof okEntries> = async () => okEntries
    ctx.reflect.get.mockImplementation((name: string) => {
      if (name === 'subagents') return { listDescendants: (id: SessionId) => descendants(id), activeExternalRuns: () => [] }
      return undefined
    })
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin })
    await app.attach()
    const internal = app as unknown as {
      refreshDelegationTree(id: SessionId): void
      subagentsPanelVisible: boolean
    }
    // 委派树面板门控打开（renderDelegationPanel 只在可见时渲染）
    internal.subagentsPanelVisible = true
    internal.refreshDelegationTree(SessionId('session-deleg'))
    await new Promise(resolve => setTimeout(resolve, 60))
    const writesAfterOk = stdout.write.mock.calls.length
    expect(writesAfterOk).toBeGreaterThan(0)
    // 刷新失败：面板须清空（重绘），而不是滞留旧树
    descendants = () => Promise.reject(new Error('boom'))
    internal.refreshDelegationTree(SessionId('session-deleg'))
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(stdout.write.mock.calls.length).toBeGreaterThan(writesAfterOk)
    await app.dispose()
  })
})

describe('TuiApp todos 紧凑面板（/todos + sessionProjections）', () => {
  const joinedWrites = (stdout: { write: ReturnType<typeof vi.fn> }): string =>
    stdout.write.mock.calls.map(c => `${c[0]}`).join('')
  /**
   * 渲染走增量 diff + WriteBatcher 16ms 尾沿批处理：帧写入相对事件触发有
   * 至少一拍的延迟，固定 sleep 与批处理时序存在竞态——用 waitFor 轮询断言。
   */
  async function waitForPanel(
    stdout: { write: ReturnType<typeof vi.fn> },
    assert: (written: string) => void,
  ): Promise<void> {
    await vi.waitFor(() => { assert(joinedWrites(stdout)) }, { timeout: 2000, interval: 20 })
  }

  it('/todos 打开渲染保留快照摘要；onChanged 实时更新；turn/start 清空（null）不回退', async () => {
    const ctx = makeCtx()
    let changeListener: ((s: { id: string }, key: string, value: unknown) => void) | null = null
    let mountedAgent: { session: { id: string } } | null = null
    ctx.agents.create.mockImplementation(({ sessionId }: { sessionId: string }) => {
      const agent = makeAgent(sessionId)
      mountedAgent = agent
      ctx.sessions.get.mockReturnValue(agent.session)
      return makeHandle(agent)
    })
    const onChanged = vi.fn((l: (s: { id: string }, key: string, value: unknown) => void) => {
      changeListener = l
      return () => { }
    })
    // attach 快照已有一份清单（重放/重挂载场景）。
    const snapshot = vi.fn(() => ({ values: { todos: [{ content: '理解问题', status: 'completed' }] } }))
    ctx.reflect.get.mockImplementation((name: string) => {
      if (name === 'sessionProjections') return { snapshot, onChanged }
      return undefined
    })
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin })
    await app.attach()

    // 初始：面板未打开 → 无待办卡行
    expect(joinedWrites(stdout)).not.toContain('📋 待办')

    // /todos 打开 → 摘要卡渲染计数，不渲染明细行
    for (const ch of '/todos') stdin.emit('data', ch)
    stdin.emit('data', '\r')
    await waitForPanel(stdout, (w) => {
      expect(w).toContain('📋 待办 ✓1 ⏳0 □0')
      expect(w).not.toContain('[x] 理解问题')
    })

    // onChanged 推送新快照 → 摘要实时更新（含当前进行项）
    expect(changeListener).not.toBeNull()
    const listener = changeListener as unknown as (s: { id: string }, key: string, value: unknown) => void
    const mounted = mountedAgent as unknown as { session: { id: string } }
    listener({ id: mounted.session.id }, 'todos', [
      { content: '理解问题', status: 'completed' },
      { content: '写测试', status: 'in_progress' },
      { content: '跑门禁', status: 'pending' },
    ])
    await waitForPanel(stdout, (w) => { expect(w).toContain('· 写测试') })

    // turn/start 把投影清成 null → 面板黏滞在上一份清单：若保留快照被 null
    // 回退，随后的重绘会渲染「尚无待办」空态行落入缓冲，此处即失败。
    listener({ id: mounted.session.id }, 'todos', null)
    await new Promise(resolve => setTimeout(resolve, 300))
    const writtenAfterReset = joinedWrites(stdout)
    expect(writtenAfterReset).toContain('· 写测试')
    expect(writtenAfterReset).not.toContain('尚无待办')
    // 状态直查：保留快照吸收了最后一次非空投影值。
    expect((app as unknown as { todosRetained: unknown }).todosRetained).toEqual([
      { content: '理解问题', status: 'completed' },
      { content: '写测试', status: 'in_progress' },
      { content: '跑门禁', status: 'pending' },
    ])

    // /todos all 展开 → 明细行渲染（封顶内全量）
    for (const ch of '/todos all') stdin.emit('data', ch)
    stdin.emit('data', '\r')
    await waitForPanel(stdout, (w) => { expect(w).toContain('[ ] 跑门禁') })
    await app.dispose()
  }, 15_000)

  it('/todos 再次执行隐藏面板；隐藏态下 all 直接展开显示；非法参数回显用法', async () => {
    const ctx = makeCtx()
    ctx.agents.create.mockImplementation(({ sessionId }: { sessionId: string }) => {
      const agent = makeAgent(sessionId)
      ctx.sessions.get.mockReturnValue(agent.session)
      return makeHandle(agent)
    })
    const snapshot = vi.fn(() => ({ values: { todos: [{ content: '任务一', status: 'pending' }] } }))
    ctx.reflect.get.mockImplementation((name: string) => {
      if (name === 'sessionProjections') {
        return { snapshot, onChanged: () => () => { } }
      }
      return undefined
    })
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin })
    await app.attach()

    const typeAndEnter = async (cmd: string): Promise<void> => {
      for (const ch of cmd) stdin.emit('data', ch)
      await new Promise(resolve => setImmediate(resolve))
      // 只保留 Enter 之后的写入：输入过程中的中间帧（斜杠菜单开着、显隐未变）
      // 会把旧面板行带进缓冲，不能作为切换后的断言依据。
      stdout.write.mockClear()
      stdin.emit('data', '\r')
      await new Promise(resolve => setImmediate(resolve))
    }

    // 非法参数：回显用法且不打开面板
    await typeAndEnter('/todos foo')
    const written = joinedWrites(stdout)
    expect(written).toContain('用法: /todos [all]')
    expect(written).not.toContain('📋 待办 ✓')

    // 隐藏态 all：直接显示并展开明细
    await typeAndEnter('/todos all')
    await waitForPanel(stdout, (w) => { expect(w).toContain(' [ ] 任务一') })

    // 再 /todos：隐藏面板——Enter 后的最后一帧不含面板行
    await typeAndEnter('/todos')
    await waitForPanel(stdout, (w) => {
      expect(w.length).toBeGreaterThan(0)
      expect(w).not.toContain('📋 待办 ✓')
    })

    // all 两连按：先展开显示，再收起明细。摘要行与展开态同文（同一份清单），
    // diff 渲染不会重写标题行——可观察信号是明细行从 Enter 后的帧里消失。
    await typeAndEnter('/todos all')
    await waitForPanel(stdout, (w) => { expect(w).toContain(' [ ] 任务一') })
    await typeAndEnter('/todos all')
    await new Promise(resolve => setTimeout(resolve, 200))
    expect(joinedWrites(stdout)).not.toContain('[ ] 任务一')
    await app.dispose()
  }, 15_000)

  it('/clear 收起待办面板（live 区命令面板随清屏一并收起）', async () => {
    const ctx = makeCtx()
    ctx.agents.create.mockImplementation(({ sessionId }: { sessionId: string }) => {
      const agent = makeAgent(sessionId)
      ctx.sessions.get.mockReturnValue(agent.session)
      return makeHandle(agent)
    })
    const snapshot = vi.fn(() => ({ values: { todos: [{ content: '任务一', status: 'pending' }] } }))
    ctx.reflect.get.mockImplementation((name: string) => {
      if (name === 'sessionProjections') {
        return { snapshot, onChanged: () => () => { } }
      }
      return undefined
    })
    const stdin = makeStdin()
    const stdout = makeStdout()
    const app = new TuiApp({ ctx, stdout, stdin })
    await app.attach()

    for (const ch of '/todos') stdin.emit('data', ch)
    stdin.emit('data', '\r')
    await waitForPanel(stdout, (w) => { expect(w).toContain('📋 待办 ✓') })

    for (const ch of '/clear') stdin.emit('data', ch)
    stdin.emit('data', '\r')
    await new Promise(resolve => setTimeout(resolve, 200))
    // 清屏后的全量重绘不再含面板行（检查最新一帧；缓冲里清屏前的旧行不算）。
    const lastFrame = stdout.write.mock.calls.at(-1)?.map((c: unknown[]) => `${c[0]}`).join('') ?? ''
    expect(lastFrame).not.toContain('📋 待办 ✓')
    await app.dispose()
  }, 15_000)
})
