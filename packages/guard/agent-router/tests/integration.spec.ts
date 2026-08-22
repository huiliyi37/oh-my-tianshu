/**
 * integration.spec.ts — 端到端：真实 cordis Context 装配插件，真实事件对象
 * 驱动「工具成败 → prediction → 路由 → 派发」闭环（不 mock 中间层；
 * agents/subagents 服务用最小替身——派发调用序真实断言）。
 *
 * 场景：8 连败 → prediction escalate → decide() 返回 delegate verifier →
 * execute() 经 subagent seam 派发子代理（start/result/dispose 调用序）→
 * 连续 3 次成功 → tipping point 重置 → decide() 回 self。
 */
import { describe, expect, it, vi, type Mock } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import { SessionId, type SessionEvent } from '@huiliyi37/dsh-session'
import type {} from '@huiliyi37/dsh-zen' // 'zen/phase' 事件声明合并（类型面）
import { apply as applyAgentRouter, resolveProfileTools, type RouterService } from '../src/index.js'

const PARENT_ID = SessionId('session-1')

function makeContext(config: Record<string, unknown> = {}): {
  ctx: Context
  seam: { start: Mock<() => Promise<{ id: SessionId; result: Promise<unknown>; dispose(): Promise<void> }>> }
  counters: { result: number; dispose: number; append: Array<{ type: string; data: unknown }> }
  registeredTools: Array<Record<string, unknown>>
  registeredSections: Array<{ name: string; text: (context: { agent?: { session: { events: SessionEvent[] } } }) => string }>
  parentSession: { header: { id: SessionId }; events: SessionEvent[]; append(type: string, data: unknown): void }
  emit: (name: string, ...args: unknown[]) => void
} {
  const counters: { result: number; dispose: number; append: Array<{ type: string; data: unknown }> } = {
    result: 0,
    dispose: 0,
    append: [],
  }
  const seam = {
    start: vi.fn(async () => ({
      id: SessionId('session-child-1'),
      result: Promise.resolve({ stopReason: 'completed', output: [] }).then((r: unknown) => { counters.result++; return r }),
      dispose: vi.fn(async () => { counters.dispose++ }),
    })),
  }
  const ctx = new Context()
  const registeredTools: Array<Record<string, unknown>> = []
  const registeredSections: Array<{ name: string; text: (context: { agent?: { session: { events: SessionEvent[] } } }) => string }> = []
  ctx.provide('tools', { register: (definition: Record<string, unknown>) => { registeredTools.push(definition); return () => {} } })
  ctx.provide('systemPrompt', { section: (section: { name: string; text: (context: unknown) => string }) => { registeredSections.push(section); return () => {} } })
  ctx.provide('subagents', seam)
  const appended: Array<{ type: string; data: unknown }> = []
  const parentEvents: SessionEvent[] = []
  const parentSession = {
    header: { id: PARENT_ID },
    events: parentEvents,
    append: (type: string, data: unknown) => {
      appended.push({ type, data })
      parentEvents.push({ type, data } as SessionEvent)
    },
  }
  ctx.provide('agents', {
    get: (_id: SessionId) => ({ session: parentSession }),
  })
  applyAgentRouter(ctx, { provider: 'mock', model: 'mock', ...config })
  counters.append = appended
  const emit = (name: string, ...args: unknown[]): void => {
    // 测试替身按宽松签名派发事件（name 为运行时字符串）；类型化重载要求
    // keyof Events + 精确 payload——@ts-expect-error 命名该偏差。
    // @ts-expect-error -- name: string 非 keyof Events；payload 形状宽松
    (ctx.emit)(name, ...args)
  }
  return { ctx, seam, counters, registeredTools, registeredSections, parentSession, emit }
}

function toolResult(isError: boolean): unknown {
  return {
    type: 'tool/result',
    seq: 1,
    time: Date.now(),
    data: {
      turn: 0,
      step: 0,
      message: {
        id: 'm1',
        role: 'user',
        source: { kind: 'tool', callId: 'c1' },
        content: [{
          type: 'tool-result',
          toolCallId: 'c1',
          isError,
          content: isError ? [] : [{ type: 'text', text: 'ok' }],
        }],
      },
    },
  }
}

function runTool(
  emit: (name: string, ...args: unknown[]) => void,
  isError: boolean,
  session: { id: string; header?: { parentSession?: string }; events?: unknown[] } = { id: 'session-1' },
): void {
  // 归账投影读取 owner.events（真 Session 恒有）；替身缺省补空数组。
  emit('session/event', { events: [], ...session }, toolResult(isError))
}

/**
 * 归账测试替身：session.append 同步落 records + events（镜像真实 Session 的
 * 日志面），emitTool 双面落（emit 喂指标面、append 落日志面——真实装配中
 * 工具结果由 agent-loop 写入 Session.append）。
 */
function makeLedgerSession(
  emit: (name: string, ...args: unknown[]) => void,
  id: SessionId,
): {
  records: Array<{ type: string; data: Record<string, unknown> }>
  session: { id: SessionId; header: object; events: SessionEvent[]; append: (type: string, data: unknown) => void }
  emitTool: (failed: boolean) => void
} {
  const records: Array<{ type: string; data: Record<string, unknown> }> = []
  const events: SessionEvent[] = []
  const session = {
    id,
    header: {},
    events,
    append: (type: string, data: unknown) => {
      records.push({ type, data: data as Record<string, unknown> })
      events.push({ type, data } as SessionEvent)
    },
  }
  const emitTool = (failed: boolean): void => {
    const event = toolResult(failed) as { type: string; data: unknown }
    emit('session/event', session, event)
    session.append(event.type, event.data)
  }
  return { records, session, emitTool }
}

describe('agent-router 端到端（指标 → 路由 → 派发）', () => {
  it('8 连败 → escalate → delegate verifier → 派发调用序', async () => {
    const { ctx, seam, counters, emit } = makeContext()
    const router = ctx.get('router') as RouterService

    // 8 连败（≥3 样本 + 错误率 1.0 → escalate）
    for (let i = 0; i < 8; i++) runTool(emit, true)

    const metrics = router.metrics({ sessionId: PARENT_ID })
    expect(metrics.interventionLevel).toBe('escalate')

    const action = router.decide({ sessionId: PARENT_ID })
    expect(action.kind).toBe('delegate')
    if (action.kind === 'delegate') {
      expect(action.profile).toBe('verifier')
      // execute 派发：返回子代理 id + 调用序（start/result/dispose 真实）
      const outcome = await router.execute(action, { sessionId: PARENT_ID })
      expect(outcome?.sessionId).toBe(SessionId('session-child-1'))
      expect(outcome?.stopReason).toBe('completed')
      expect(seam.start).toHaveBeenCalledTimes(1)
      expect(counters.result).toBe(1)
      expect(counters.dispose).toBe(1)
      const entry = seam.start.mock.calls[0] as unknown as [string, Record<string, unknown>]
      expect(entry[0]).toBe('spawn')
      expect(entry[1].toolFilter).toEqual({ allow: ['grep', 'read', 'glob', 'repo_graph', 'bash'] })
      // acceptance 的 router/route + settle 后的 router/outcome（终态可自日志重建）
      expect(counters.append).toHaveLength(2)
      expect(counters.append[0]!.type).toBe('router/route')
      const route = counters.append[0]!.data as { profile: string; subagentSessionId: string }
      expect(route.profile).toBe('verifier')
      expect(route.subagentSessionId).toBe('session-child-1')
      expect(counters.append[1]!.type).toBe('router/outcome')
      const outcomeRecord = counters.append[1]!.data as { stopReason: string }
      expect(outcomeRecord.stopReason).toBe('completed')
    }
  }, 10000)

  it('连续 3 次成功 → tipping point 重置 → decide 回 self', async () => {
    const { ctx, emit } = makeContext()
    const router = ctx.get('router') as RouterService

    for (let i = 0; i < 5; i++) runTool(emit, true) // 5 连败 → escalate
    expect(router.metrics({ sessionId: PARENT_ID }).interventionLevel).toBe('escalate')

    for (let i = 0; i < 3; i++) runTool(emit, false) // 3 连成 → tipping point
    expect(router.metrics({ sessionId: PARENT_ID }).interventionLevel).toBe('none') // 重置后样本 <3 → none
    expect(router.decide({ sessionId: PARENT_ID }).kind).toBe('self')
  }, 10000)

  it('profileTools 配置非法时装配 fail loud', () => {
    expect(() => { applyAgentRouter(new Context(), { profileTools: { codeScout: [] } }) }).toThrow(/non-empty/)
    expect(() => { applyAgentRouter(new Context(), { profileTools: { verifier: ['read', ''] } }) }).toThrow(/non-empty/)
    expect(() => { applyAgentRouter(new Context(), { profileTools: { codeScout: ['read', 'read'] } }) }).toThrow(/duplicates/)
  })

  it('resolveProfileTools 缺省用内置真实工具名，覆盖生效', () => {
    const defaults = resolveProfileTools({})
    expect(defaults.code_scout).toContain('read')
    expect(defaults.code_scout).not.toContain('read_file')
    expect(defaults.code_scout).toContain('repo_graph')
    expect(defaults.verifier).toContain('repo_graph')
    const overridden = resolveProfileTools({ profileTools: { codeScout: ['read', 'bash'], verifier: ['read'] } })
    expect(overridden.code_scout).toEqual(['read', 'bash'])
    expect(overridden.verifier).toEqual(['read'])
  })

  it('dispatchEnabled: false 时 execute 不派发（返回 null）', async () => {
    const ctx = new Context()
    ctx.provide('tools', { register: () => () => {} })
    ctx.provide('systemPrompt', { section: () => () => {} })
    const seam = { start: vi.fn(async () => ({ id: SessionId('session-child-1'), result: Promise.resolve({}), dispose: async () => {} })) }
    ctx.provide('subagents', seam)
    ctx.provide('agents', { get: () => ({}) })
    applyAgentRouter(ctx, { provider: 'mock', model: 'mock', dispatchEnabled: false })
    const router = ctx.get('router') as RouterService
    for (let i = 0; i < 5; i++) {
      // @ts-expect-error -- 测试拆开 payload 派发（session/event 参数形状宽松）
      (ctx.emit)('session/event', { id: PARENT_ID, events: [] }, toolResult(true))
    }
    const action = router.decide({ sessionId: PARENT_ID })
    expect(action.kind).toBe('delegate')
    const id = await router.execute(action, { sessionId: PARENT_ID })
    expect(id).toBeNull()
    expect(seam.start).not.toHaveBeenCalled()
  }, 10000)

  it('subagentProvider 非法（空串）时装配 fail loud', () => {
    expect(() => { applyAgentRouter(new Context(), { subagentProvider: '' }) }).toThrow(/non-empty provider name/)
  })

  it('指标按会话隔离：A 连败不影响 B 的决策', async () => {
    const { ctx, emit } = makeContext()
    const router = ctx.get('router') as RouterService
    const A = SessionId('session-a')
    const B = SessionId('session-b')

    for (let i = 0; i < 8; i++) runTool(emit, true, { id: A })
    expect(router.metrics({ sessionId: A }).interventionLevel).toBe('escalate')
    expect(router.metrics({ sessionId: B }).interventionLevel).toBe('none')
    expect(router.decide({ sessionId: B }).kind).toBe('self')
  }, 10000)

  it('child 会话（header.parentSession）的工具结果不进任何累计器', async () => {
    const { ctx, emit } = makeContext()
    const router = ctx.get('router') as RouterService
    const A = SessionId('session-a')

    for (let i = 0; i < 8; i++) {
      runTool(emit, true, { id: 'session-child-1', header: { parentSession: A } })
    }
    expect(router.metrics({ sessionId: A }).interventionLevel).toBe('none')
    expect(router.decide({ sessionId: A }).kind).toBe('self')
  }, 10000)

  it('trigger shadow：turn/end 的 delegate 决策落 router/decision（不派发）', async () => {
    const { ctx, seam, emit } = makeContext({ trigger: { mode: 'shadow', onTurnEnd: true } })
    const router = ctx.get('router') as RouterService
    const A = SessionId('session-a')
    const appended: Array<{ type: string; data: unknown }> = []
    const session = {
      id: A,
      header: {},
      // foldZenPhase 读取 events（禅阶段跳过触发）；无 zen/phase 事件折为 full。
      events: [] as SessionEvent[],
      append: (type: string, data: unknown) => { appended.push({ type, data }) },
    }

    for (let i = 0; i < 8; i++) runTool(emit, true, { id: A })
    expect(router.metrics({ sessionId: A }).interventionLevel).toBe('escalate')
    emit('session/event', session, {
      type: 'turn/end', seq: 1, time: 1, data: { turn: 1, reason: { kind: 'completed' } },
    })
    await vi.waitFor(() => { expect(appended).toHaveLength(1) })
    expect(appended[0]!.type).toBe('router/decision')
    const decision = appended[0]!.data as {
      decisionId: string
      profile: string
      mode: string
      dispatched: boolean
      subagentSessionId?: string
      metrics: { interventionLevel: string }
    }
    expect(decision.decisionId).toBe('rtdec-0')
    expect(decision.profile).toBe('verifier')
    expect(decision.mode).toBe('shadow')
    expect(decision.dispatched).toBe(false)
    expect(decision.subagentSessionId).toBeUndefined()
    // 完整指标输入随决策落盘（判定依据可从日志重建）
    expect(decision.metrics.interventionLevel).toBe('escalate')
    expect(seam.start).not.toHaveBeenCalled()
  }, 10000)

  it('trigger auto：turn/end 决策后经 seam 派发，决策记录 dispatched true', async () => {
    const { seam, emit } = makeContext({ trigger: { mode: 'auto', onTurnEnd: true }, auto: { maxConcurrent: 1, maxTotal: 999, cooldownTurns: 1, maxSteps: 24, timeoutMs: 600000 } })
    const A = SessionId('session-a')
    const appended: Array<{ type: string; data: unknown }> = []
    const session = {
      id: A,
      header: {},
      // foldZenPhase 读取 events（禅阶段跳过触发）；无 zen/phase 事件折为 full。
      events: [] as SessionEvent[],
      append: (type: string, data: unknown) => { appended.push({ type, data }) },
    }

    for (let i = 0; i < 8; i++) runTool(emit, true, { id: A })
    emit('session/event', session, {
      type: 'turn/end', seq: 1, time: 1, data: { turn: 1, reason: { kind: 'completed' } },
    })
    await vi.waitFor(() => { expect(appended).toHaveLength(1) })
    const decision = appended[0]!.data as { dispatched: boolean; subagentSessionId?: string }
    expect(decision.dispatched).toBe(true)
    expect(decision.subagentSessionId).toBe('session-child-1')
    expect(seam.start).toHaveBeenCalledTimes(1)
  }, 10000)

  it('trigger auto：seam.start 拒绝时失败收敛（decision 落 dispatched false + 错误日志，turn 不被打断）', async () => {
    const { ctx, seam, emit } = makeContext({ trigger: { mode: 'auto', onTurnEnd: true }, auto: { maxConcurrent: 1, maxTotal: 999, cooldownTurns: 1, maxSteps: 24, timeoutMs: 600000 } })
    const A = SessionId('session-a')
    const appended: Array<{ type: string; data: unknown }> = []
    const session = {
      id: A,
      header: {},
      // foldZenPhase 读取 events（禅阶段跳过触发）；无 zen/phase 事件折为 full。
      events: [] as SessionEvent[],
      append: (type: string, data: unknown) => { appended.push({ type, data }) },
    }
    const loggerError = vi.spyOn(ctx.logger, 'error').mockImplementation(() => undefined)
    seam.start.mockImplementationOnce(async () => { throw new Error('seam down') })

    for (let i = 0; i < 8; i++) runTool(emit, true, { id: A })
    // emit 同步返回即证明后台触发不打断 turn；catch 被删则 promise 无人接管，
    // vitest 的 unhandled rejection 会让套件变红——回归保护成立。
    emit('session/event', session, {
      type: 'turn/end', seq: 1, time: 1, data: { turn: 1, reason: { kind: 'completed' } },
    })
    await vi.waitFor(() => { expect(appended).toHaveLength(1) })
    const decision = appended[0]!.data as { mode: string; dispatched: boolean; subagentSessionId?: string }
    expect(decision.mode).toBe('auto')
    expect(decision.dispatched).toBe(false)
    expect(decision.subagentSessionId).toBeUndefined()
    expect(seam.start).toHaveBeenCalledTimes(1)
    expect(loggerError).toHaveBeenCalledOnce()
    loggerError.mockRestore()
  }, 10000)

  it('trigger auto：子代理 result reject（基础设施故障）时失败收敛——route 已落、outcome 不落', async () => {
    const { ctx, seam, counters, emit } = makeContext({ trigger: { mode: 'auto', onTurnEnd: true }, auto: { maxConcurrent: 1, maxTotal: 999, cooldownTurns: 1, maxSteps: 24, timeoutMs: 600000 } })
    const A = SessionId('session-a')
    const appended: Array<{ type: string; data: unknown }> = []
    const session = {
      id: A,
      header: {},
      // foldZenPhase 读取 events（禅阶段跳过触发）；无 zen/phase 事件折为 full。
      events: [] as SessionEvent[],
      append: (type: string, data: unknown) => { appended.push({ type, data }) },
    }
    const loggerError = vi.spyOn(ctx.logger, 'error').mockImplementation(() => undefined)
    seam.start.mockImplementationOnce(async () => ({
      id: SessionId('session-child-1'),
      result: Promise.reject(new Error('infra boom')),
      dispose: vi.fn(async () => { counters.dispose++ }),
    }))

    for (let i = 0; i < 8; i++) runTool(emit, true, { id: A })
    emit('session/event', session, {
      type: 'turn/end', seq: 1, time: 1, data: { turn: 1, reason: { kind: 'completed' } },
    })
    await vi.waitFor(() => { expect(appended).toHaveLength(1) })
    const decision = appended[0]!.data as { dispatched: boolean; subagentSessionId?: string }
    expect(decision.dispatched).toBe(false)
    expect(decision.subagentSessionId).toBeUndefined()
    expect(loggerError).toHaveBeenCalledOnce()
    // acceptance 的 router/route 在 result 结算前已落父会话；无 settle 则无 outcome，
    // 孤儿 route 不进 synthesis 的 pending（pendingOutcomes 只认 outcome）。
    expect(counters.append.map(entry => entry.type)).toEqual(['router/route'])
    expect(counters.dispose).toBe(1)
    loggerError.mockRestore()
  }, 10000)

  it('trigger auto：缺 provider/model 时短路——decision 落 dispatched false 且 seam 未调用', async () => {
    const { seam, emit } = makeContext({ provider: undefined, model: undefined, trigger: { mode: 'auto', onTurnEnd: true }, auto: { maxConcurrent: 1, maxTotal: 999, cooldownTurns: 1, maxSteps: 24, timeoutMs: 600000 } })
    const A = SessionId('session-a')
    const appended: Array<{ type: string; data: unknown }> = []
    const session = {
      id: A,
      header: {},
      // foldZenPhase 读取 events（禅阶段跳过触发）；无 zen/phase 事件折为 full。
      events: [] as SessionEvent[],
      append: (type: string, data: unknown) => { appended.push({ type, data }) },
    }

    for (let i = 0; i < 8; i++) runTool(emit, true, { id: A })
    emit('session/event', session, {
      type: 'turn/end', seq: 1, time: 1, data: { turn: 1, reason: { kind: 'completed' } },
    })
    await vi.waitFor(() => { expect(appended).toHaveLength(1) })
    const decision = appended[0]!.data as { action: string; mode: string; dispatched: boolean; subagentSessionId?: string }
    expect(decision.action).toBe('delegate')
    expect(decision.mode).toBe('auto')
    expect(decision.dispatched).toBe(false)
    expect(decision.subagentSessionId).toBeUndefined()
    expect(seam.start).not.toHaveBeenCalled()
  }, 10000)

  it('trigger off / child 会话 turn/end 不触发决策；self 决策全量记账', async () => {
    const offCtx = makeContext({ trigger: { mode: 'shadow', onTurnEnd: true } })
    const router = offCtx.ctx.get('router') as RouterService
    const A = SessionId('session-a')
    const appended: Array<{ type: string; data: unknown }> = []
    const session = {
      id: A,
      header: {},
      // foldZenPhase 读取 events（禅阶段跳过触发）；无 zen/phase 事件折为 full。
      events: [] as SessionEvent[],
      append: (type: string, data: unknown) => { appended.push({ type, data }) },
    }
    for (let i = 0; i < 8; i++) runTool(offCtx.emit, true, { id: A })
    expect(router.metrics({ sessionId: A }).interventionLevel).toBe('escalate')
    // child 会话（header.parentSession）turn/end → 排除
    offCtx.emit('session/event', { id: 'session-child-1', header: { parentSession: A }, append: () => {} }, {
      type: 'turn/end', seq: 1, time: 1, data: { turn: 1, reason: { kind: 'completed' } },
    })
    // self 决策（连续 3 次成功重置）→ Phase 1 全量记账：self 也落一条带完整
    // 指标输入的决策（消除只有 delegate 分子的偏差）。
    for (let i = 0; i < 3; i++) runTool(offCtx.emit, false, { id: A })
    offCtx.emit('session/event', session, {
      type: 'turn/end', seq: 1, time: 1, data: { turn: 1, reason: { kind: 'completed' } },
    })
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(appended).toHaveLength(1)
    const selfDecision = appended[0]!.data as { action: string; mode: string; dispatched: boolean; metrics: Record<string, unknown> }
    expect(selfDecision.action).toBe('self')
    expect(selfDecision.mode).toBe('shadow')
    expect(selfDecision.dispatched).toBe(false)
    expect(selfDecision.metrics).toEqual(router.metrics({ sessionId: A }))
    // 缺省配置（无 trigger）不触发
    const defaultCtx = makeContext()
    const defaultRouter = defaultCtx.ctx.get('router') as RouterService
    for (let i = 0; i < 8; i++) runTool(defaultCtx.emit, true, { id: 'session-a' })
    expect(defaultRouter.metrics({ sessionId: SessionId('session-a') }).interventionLevel).toBe('escalate')
    const defaultAppended: Array<{ type: string }> = []
    defaultCtx.emit('session/event', { id: 'session-a', header: {}, events: [], append: (type: string) => { defaultAppended.push({ type }) } }, {
      type: 'turn/end', seq: 1, time: 1, data: { turn: 1, reason: { kind: 'completed' } },
    })
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(defaultAppended).toHaveLength(0)
  }, 10000)

  it('禅阶段（zen/phase 折叠为 zen）turn/end 不触发：不决策、不记录、不派发', async () => {
    const { seam, emit } = makeContext({ trigger: { mode: 'auto', onTurnEnd: true }, auto: { maxConcurrent: 1, maxTotal: 999, cooldownTurns: 1, maxSteps: 24, timeoutMs: 600000 } })
    const A = SessionId('session-a')
    const appended: Array<{ type: string; data: unknown }> = []
    const events: SessionEvent[] = [
      { type: 'zen/phase', seq: 0, time: 1, data: { phase: 'zen', reason: 'arm' } },
    ]
    const session = {
      id: A,
      header: {},
      events,
      append: (type: string, data: unknown) => { appended.push({ type, data }) },
    }

    // 8 连败（escalate）也无效：禅阶段是对齐/锚定轮，指标决策不出可信路由。
    for (let i = 0; i < 8; i++) runTool(emit, true, { id: A })
    emit('session/event', session, {
      type: 'turn/end', seq: 1, time: 1, data: { turn: 1, reason: { kind: 'completed' } },
    })
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(appended).toHaveLength(0)
    expect(seam.start).not.toHaveBeenCalled()
  }, 10000)

  it('禅阶段晋升 full 后的 turn/end 恢复触发', async () => {
    const { ctx, emit } = makeContext({ trigger: { mode: 'shadow', onTurnEnd: true } })
    const router = ctx.get('router') as RouterService
    const A = SessionId('session-a')
    const appended: Array<{ type: string; data: unknown }> = []
    const events: SessionEvent[] = [
      { type: 'zen/phase', seq: 0, time: 1, data: { phase: 'zen', reason: 'arm' } },
      { type: 'zen/phase', seq: 1, time: 2, data: { phase: 'full', reason: 'anchor' } },
    ]
    const session = {
      id: A,
      header: {},
      events,
      append: (type: string, data: unknown) => { appended.push({ type, data }) },
    }

    for (let i = 0; i < 8; i++) runTool(emit, true, { id: A })
    expect(router.metrics({ sessionId: A }).interventionLevel).toBe('escalate')
    emit('session/event', session, {
      type: 'turn/end', seq: 2, time: 3, data: { turn: 1, reason: { kind: 'completed' } },
    })
    await vi.waitFor(() => { expect(appended).toHaveLength(1) })
    expect(appended[0]!.type).toBe('router/decision')
  }, 10000)

  it('触发出窗：turn/end 发布窗口内不落记录（Session.append 重入回归）', async () => {
    const { emit } = makeContext({ trigger: { mode: 'shadow', onTurnEnd: true } })
    const A = SessionId('session-a')
    const appended: Array<{ type: string; data: unknown }> = []
    const session = {
      id: A,
      header: {},
      events: [] as SessionEvent[],
      append: (type: string, data: unknown) => { appended.push({ type, data }) },
    }

    for (let i = 0; i < 8; i++) runTool(emit, true, { id: A })
    emit('session/event', session, {
      type: 'turn/end', seq: 1, time: 1, data: { turn: 1, reason: { kind: 'completed' } },
    })
    // emit 同步返回时记录必须仍未落：runTrigger 若在观察者内同步执行，真实
    // Session.append 会在 turn/end 的发布窗口内重入并 fatal；替身装配下则
    // 直接同步落记录。两种装配都由「先零后有」钉住微任务出窗语义。
    expect(appended).toHaveLength(0)
    await vi.waitFor(() => { expect(appended).toHaveLength(1) })
  }, 10000)

  it('决策归账：窗口闭合落 router/evaluation + readiness gate 留痕（shadow 零派发）', async () => {
    const { seam, emit } = makeContext({ trigger: { mode: 'shadow', onTurnEnd: true } })
    const { records, session, emitTool } = makeLedgerSession(emit, SessionId('session-a'))
    // 决策 d1：8 连败 → delegate（shadow 只记录）
    for (let i = 0; i < 8; i++) emitTool(true)
    emit('session/event', session, {
      type: 'turn/end', seq: 1, time: 1, data: { turn: 1, reason: { kind: 'completed' } },
    })
    await vi.waitFor(() => { expect(records.map(record => record.type)).toContain('router/decision') })
    // 窗口闭合：8 条父会话工具结果（3 败 + 5 成，尾部连续成功 ≥3 → recovered）
    for (let i = 0; i < 3; i++) emitTool(true)
    for (let i = 0; i < 5; i++) emitTool(false)
    await vi.waitFor(() => { expect(records.map(record => record.type)).toContain('router/gate') })
    const ledger = records.filter(record => record.type.startsWith('router/'))
    expect(ledger.map(record => record.type)).toEqual(['router/decision', 'router/evaluation', 'router/gate'])
    const decisionId = (ledger[0]!.data as { decisionId: string }).decisionId
    const evaluationRecord = ledger[1]!.data as { decisionId: string; classification: string; samples: number; windowFailures: number }
    expect(evaluationRecord.decisionId).toBe(decisionId)
    expect(evaluationRecord.classification).toBe('recovered')
    expect(evaluationRecord.samples).toBe(8)
    expect(evaluationRecord.windowFailures).toBe(3)
    const gate = ledger[2]!.data as { kind: string; verdict: string; vetoSignals: string[] }
    expect(gate.kind).toBe('shadow-readiness')
    // 样本 1 < 30：关卡只留痕否决理由，绝不自行切换模式
    expect(gate.verdict).toBe('veto')
    expect(gate.vetoSignals[0]).toContain('insufficient evaluated decisions')
    expect(seam.start).not.toHaveBeenCalled()
  }, 10000)

  it('auto 装配归账加记 canary-health gate：零真实派发不伪造收益边际', async () => {
    const { emit } = makeContext({ provider: undefined, model: undefined, trigger: { mode: 'auto', onTurnEnd: true }, auto: { maxConcurrent: 1, maxTotal: 999, cooldownTurns: 1, maxSteps: 24, timeoutMs: 600000 } })
    const { records, session, emitTool } = makeLedgerSession(emit, SessionId('session-a'))
    for (let i = 0; i < 8; i++) emitTool(true)
    emit('session/event', session, {
      type: 'turn/end', seq: 1, time: 1, data: { turn: 1, reason: { kind: 'completed' } },
    })
    await vi.waitFor(() => { expect(records.map(record => record.type)).toContain('router/decision') })
    for (let i = 0; i < 8; i++) emitTool(false)
    await vi.waitFor(() => { expect(records.filter(record => record.type === 'router/gate')).toHaveLength(2) })
    const kinds = records.filter(record => record.type === 'router/gate').map(record => record.data as { kind: string; verdict: string })
    expect(kinds[0]).toMatchObject({ kind: 'shadow-readiness', verdict: 'veto' })
    expect(kinds[1]).toMatchObject({ kind: 'canary-health', verdict: 'veto' })
    const canarySignals = (records.find(record => record.type === 'router/gate' && (record.data as { kind: string }).kind === 'canary-health')!.data as { vetoSignals: string[] }).vetoSignals
    expect(canarySignals[0]).toContain('insufficient actual dispatches')
    expect(canarySignals[0]).toContain('no benefit proxy')
  }, 10000)

  it('trigger 配置非法 fail loud', () => {
    expect(() => { applyAgentRouter(new Context(), { trigger: { mode: 'hyper' as never } }) }).toThrow(/trigger.mode/)
    expect(() => { applyAgentRouter(new Context(), { trigger: { onTurnEnd: 'yes' as never } }) }).toThrow(/onTurnEnd/)
    expect(() => { applyAgentRouter(new Context(), { escalation: { cap: 'strong' as never } }) }).toThrow(/escalation.cap/)
    expect(() => { applyAgentRouter(new Context(), { escalation: { minConsecutiveFailures: 0 } }) }).toThrow(/minConsecutiveFailures/)
    expect(() => { applyAgentRouter(new Context(), { budget: { defaultMaxTurns: -1 } }) }).toThrow(/budget.defaultMaxTurns/)
  })

  it('mode auto 缺显式 auto 策略 fail loud（灰度上限是装配值，不设插件默认）', () => {
    expect(() => { applyAgentRouter(new Context(), { trigger: { mode: 'auto', onTurnEnd: true } }) })
      .toThrow(/requires explicit auto\.maxConcurrent/)
    expect(() => {
      applyAgentRouter(new Context(), {
        trigger: { mode: 'auto', onTurnEnd: true },
        auto: { maxConcurrent: 1, maxTotal: 1, cooldownTurns: 1, maxSteps: 0, timeoutMs: 1000 },
      })
    }).toThrow(/auto\.maxSteps/)
  })

  it('canary 门：单飞锁/冷却/总帽拦下重复派发，决策仍全量落盘（dispatched false）', async () => {
    const { seam, emit } = makeContext({
      trigger: { mode: 'auto', onTurnEnd: true },
      auto: { maxConcurrent: 1, maxTotal: 2, cooldownTurns: 3, maxSteps: 24, timeoutMs: 600000 },
    })
    const appended: Array<{ type: string; data: Record<string, unknown> }> = []
    let releaseFirst: (() => void) | undefined
    const firstResult = new Promise<{ stopReason: string; output: [] }>((resolve) => { releaseFirst = () => resolve({ stopReason: 'completed', output: [] }) })
    seam.start.mockImplementationOnce(async () => ({
      id: SessionId('session-child-1'),
      result: firstResult,
      dispose: async () => {},
    }))
    const A = SessionId('session-a')
    const session = {
      id: A,
      header: {},
      events: [] as SessionEvent[],
      append: (type: string, data: unknown) => { appended.push({ type, data: data as Record<string, unknown> }) },
    }
    const endTurn = (): void => {
      emit('session/event', session, {
        type: 'turn/end', seq: appended.length, time: 1, data: { turn: appended.length, reason: { kind: 'completed' } },
      })
    }
    for (let i = 0; i < 8; i++) runTool(emit, true, { id: A })
    // 第 1 个合格 turn-end：真实派发（挂起不结算；其决策记录待结算后落盘）
    endTurn()
    await vi.waitFor(() => { expect(seam.start).toHaveBeenCalledTimes(1) })
    // 第 2、3 个 turn-end：单飞锁 + 冷却拦下——先落 dispatched:false 决策
    endTurn()
    endTurn()
    await vi.waitFor(() => { expect(appended).toHaveLength(2) })
    expect(seam.start).toHaveBeenCalledTimes(1)
    expect(appended.every(entry => (entry.data as { dispatched: boolean }).dispatched === false)).toBe(true)
    // 放行在飞 run：首条真实决策（dispatched true）此刻才落盘
    releaseFirst!()
    await vi.waitFor(() => { expect(appended.some(entry => (entry.data as { dispatched?: boolean }).dispatched === true)).toBe(true) })
    expect(seam.start).toHaveBeenCalledTimes(1)
    for (let i = 0; i < 8; i++) runTool(emit, true, { id: A })
    // 第 4 个合格 turn-end：距首次派发已过 3 个合格 turn 且无在飞 → 第二次派发
    endTurn()
    await vi.waitFor(() => { expect(seam.start).toHaveBeenCalledTimes(2) })
    await vi.waitFor(() => {
      expect(appended.filter(entry => (entry.data as { dispatched?: boolean }).dispatched === true)).toHaveLength(2)
    })
    // 总帽（maxTotal 2）已到：后续 turn-end 只落决策不再派发
    for (let i = 0; i < 8; i++) runTool(emit, true, { id: A })
    endTurn()
    endTurn()
    await vi.waitFor(() => { expect(appended).toHaveLength(6) })
    expect(seam.start).toHaveBeenCalledTimes(2)
    const dispatches = appended.filter(entry => (entry.data as { dispatched?: boolean }).dispatched === true)
    expect(dispatches).toHaveLength(2)
  }, 10000)

  it('冷却按合格 turn 全量计数：self 决策轮也推进冷却间隔', async () => {
    const { seam, emit } = makeContext({
      trigger: { mode: 'auto', onTurnEnd: true },
      auto: { maxConcurrent: 1, maxTotal: 5, cooldownTurns: 2, maxSteps: 24, timeoutMs: 600000 },
    })
    const A = SessionId('session-a')
    const appended: Array<{ type: string; data: Record<string, unknown> }> = []
    const session = {
      id: A,
      header: {},
      events: [] as SessionEvent[],
      append: (type: string, data: unknown) => { appended.push({ type, data: data as Record<string, unknown> }) },
    }
    const endTurn = (): void => {
      emit('session/event', session, {
        type: 'turn/end', seq: appended.length, time: 1, data: { turn: appended.length, reason: { kind: 'completed' } },
      })
    }
    // t1：连败 → 首次派发（冷却起点，qualifiedTurns=1）。
    for (let i = 0; i < 8; i++) runTool(emit, true, { id: A })
    endTurn()
    await vi.waitFor(() => { expect(seam.start).toHaveBeenCalledTimes(1) })
    // t2：全成功 → self 决策（qualifiedTurns=2；self 轮也计入冷却分母）。
    for (let i = 0; i < 8; i++) runTool(emit, false, { id: A })
    endTurn()
    await vi.waitFor(() => {
      expect(appended.some(entry => (entry.data as { action?: string }).action === 'self')).toBe(true)
    })
    // t3：再连败 → 距首派发已过 2 个合格 turn（3-1 ≥ cooldown 2）→ 第二次派发。
    for (let i = 0; i < 8; i++) runTool(emit, true, { id: A })
    endTurn()
    await vi.waitFor(() => { expect(seam.start).toHaveBeenCalledTimes(2) }, { timeout: 5_000 })
  }, 10000)

  it('综合提示：存在未综合 child 结论时渲染，adoption 后清除', async () => {
    const { ctx, registeredTools, registeredSections, parentSession, emit } = makeContext()
    const router = ctx.get('router') as RouterService
    const A = SessionId('session-a')
    for (let i = 0; i < 8; i++) runTool(emit, true, { id: A })
    const action = router.decide({ sessionId: A })
    if (action.kind !== 'delegate') throw new Error('expected delegate')
    await router.execute(action, { sessionId: A })

    const section = registeredSections.find(s => s.name === 'router:synthesis')
    if (section === undefined) throw new Error('router:synthesis section missing')
    const text = section.text({ agent: { session: parentSession } })
    expect(text).toContain('session-child-1')
    expect(text).toContain('router_adopt')

    // 采用声明工具：逐条恰好一次；重复声明被拒
    const adopt = registeredTools.find(tool => tool.name === 'router_adopt') as Record<string, unknown>
    if (adopt === undefined) throw new Error('router_adopt tool missing')
    type AdoptExec = { agent?: { session: { events: SessionEvent[]; append(type: string, data: unknown): void } } }
    const execute = adopt.execute as (args: unknown, exec: AdoptExec) => Promise<unknown>
    await execute(
      { subagentSessionId: 'session-child-1', verdict: 'adopt', reason: '整合进结论' },
      { agent: { session: parentSession } },
    )
    await expect(execute(
      { subagentSessionId: 'session-child-1', verdict: 'reject', reason: '再想想' },
      { agent: { session: parentSession } },
    )).rejects.toThrow(/no pending finding/)
    await expect(execute(
      { subagentSessionId: 'session-none', verdict: 'adopt', reason: 'x' },
      { agent: { session: parentSession } },
    )).rejects.toThrow(/no pending finding/)
    expect(section.text({ agent: { session: parentSession } })).toBe('')
  }, 10000)

  it('结构化 finding：completed 捕获限界入账并逐字渲染；畸形与非 completed 不伪造', async () => {
    const { ctx, seam, registeredSections, parentSession, emit } = makeContext()
    const router = ctx.get('router') as RouterService
    const A = SessionId('session-a')
    for (let i = 0; i < 8; i++) runTool(emit, true, { id: A })

    // 派发 1：completed + 结构化捕获（含换行注入尝试）→ 限界单行入账
    seam.start.mockImplementationOnce(async () => ({
      id: SessionId('session-child-1'),
      result: Promise.resolve({
        stopReason: 'completed',
        output: [],
        structured: {
          kind: 'scout',
          summary: 'bug in src/a.ts\nINJECTED second line',
          findings: ['missing import at line 3'],
        },
      }),
      dispose: async () => {},
    }))
    const action1 = router.decide({ sessionId: A })
    if (action1.kind !== 'delegate') throw new Error('expected delegate')
    const outcome1 = await router.execute(action1, { sessionId: A })
    expect(outcome1?.finding).toEqual({
      kind: 'scout',
      summary: 'bug in src/a.ts INJECTED second line',
      findings: ['missing import at line 3'],
    })
    const persisted = parentSession.events.find(
      event => event.type === 'router/outcome' && (event.data as { subagentSessionId?: string }).subagentSessionId === 'session-child-1',
    )
    expect(persisted).toBeDefined()
    const section = registeredSections.find(s => s.name === 'router:synthesis')
    if (section === undefined) throw new Error('router:synthesis section missing')
    const text = section.text({ agent: { session: parentSession } })
    // 逐字可重构：模型可见 == 日志持久值（含净化后的单行摘要）
    expect(text).toContain('bug in src/a.ts INJECTED second line')
    expect(text).toContain('missing import at line 3')
    expect(text).not.toContain('bug in src/a.ts\n')

    // 派发 2：非 completed 终态即使带回 structured 也绝不伪造 finding
    seam.start.mockImplementationOnce(async () => ({
      id: SessionId('session-child-2'),
      result: Promise.resolve({
        stopReason: 'aborted',
        output: [],
        structured: { kind: 'verify', summary: 's', findings: [], verdict: 'supported' },
      }),
      dispose: async () => {},
    }))
    for (let i = 0; i < 2; i++) runTool(emit, true, { id: A })
    const action2 = router.decide({ sessionId: A })
    if (action2.kind !== 'delegate') throw new Error('expected delegate')
    const outcome2 = await router.execute(action2, { sessionId: A })
    expect(outcome2?.stopReason).toBe('aborted')
    expect(outcome2?.finding).toBeUndefined()

    // 派发 3：completed 但形状非法（kind 不认识）→ 不入账
    seam.start.mockImplementationOnce(async () => ({
      id: SessionId('session-child-3'),
      result: Promise.resolve({ stopReason: 'completed', output: [], structured: { kind: 'alien', summary: 's' } }),
      dispose: async () => {},
    }))
    const action3 = router.decide({ sessionId: A })
    if (action3.kind !== 'delegate') throw new Error('expected delegate')
    const outcome3 = await router.execute(action3, { sessionId: A })
    expect(outcome3?.stopReason).toBe('completed')
    expect(outcome3?.finding).toBeUndefined()
  }, 10000)

  it('综合面按可派发性门控：缺 provider/model（shadow 重挂形状）或 dispatchEnabled:false 时不注册，可派发时装配齐', () => {
    // 发货 TUI 形状：shadow 重挂、无 provider/model——综合节恒空、adopt 每调必抛，
    // 常驻模型面只是白占请求 token，故两者都不注册。
    const gated = makeContext({ provider: undefined, model: undefined, trigger: { mode: 'shadow', onTurnEnd: true } })
    expect(gated.registeredTools.some(tool => tool.name === 'router_adopt')).toBe(false)
    expect(gated.registeredSections.some(section => section.name === 'router:synthesis')).toBe(false)
    const disabled = makeContext({ dispatchEnabled: false })
    expect(disabled.registeredTools.some(tool => tool.name === 'router_adopt')).toBe(false)
    expect(disabled.registeredSections.some(section => section.name === 'router:synthesis')).toBe(false)
    // 可派发装配注册两者（行为面由「综合提示」用例钉住，这里钉注册面）。
    const open = makeContext()
    expect(open.registeredTools.some(tool => tool.name === 'router_adopt')).toBe(true)
    expect(open.registeredSections.some(section => section.name === 'router:synthesis')).toBe(true)
  })

  it('agent/disposed 时 evict 累计器，并以 final 模式归账尾部未闭合窗口', async () => {
    const { ctx, emit } = makeContext({ trigger: { mode: 'shadow', onTurnEnd: true } })
    const router = ctx.get('router') as RouterService
    const A = SessionId('session-a')
    const { records, session, emitTool } = makeLedgerSession(emit, A)

    for (let i = 0; i < 8; i++) emitTool(true)
    expect(router.metrics({ sessionId: A }).interventionLevel).toBe('escalate')
    emit('session/event', session, { type: 'turn/end', seq: 90, time: 1, data: { turn: 1, reason: { kind: 'completed' } } })
    await vi.waitFor(() => { expect(records.some(record => record.type === 'router/decision')).toBe(true) })
    // 尾部：2 条成功后日志终结——窗口未满也未被取代。
    emitTool(false)
    emitTool(false)
    // dispose 载荷携带真 Session（events 可读）；handler 先 final 归账再 evict。
    emit('agent/disposed', { agent: { session } })
    const finalEvaluation = records.find(record => record.type === 'router/evaluation')?.data as
      | { classification: string; samples: number }
      | undefined
    expect(finalEvaluation).toMatchObject({ classification: 'inconclusive', samples: 2 })
    expect(router.metrics({ sessionId: A }).interventionLevel).toBe('none')
  }, 10000)

  it('resetPrediction 按会话重置（不影响其他会话）', async () => {
    const { ctx, emit } = makeContext()
    const router = ctx.get('router') as RouterService
    const A = SessionId('session-a')
    const B = SessionId('session-b')

    for (let i = 0; i < 8; i++) runTool(emit, true, { id: A })
    for (let i = 0; i < 8; i++) runTool(emit, true, { id: B })
    expect(router.metrics({ sessionId: A }).interventionLevel).toBe('escalate')
    router.resetPrediction(A)
    expect(router.metrics({ sessionId: A }).interventionLevel).toBe('none')
    expect(router.metrics({ sessionId: B }).interventionLevel).toBe('escalate')
    router.resetPrediction()
    expect(router.metrics({ sessionId: B }).interventionLevel).toBe('none')
  }, 10000)
})
