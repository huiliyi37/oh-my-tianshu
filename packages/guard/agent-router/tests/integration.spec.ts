/**
 * integration.spec.ts — 端到端：真实 cordis Context 装配插件，真实事件对象
 * 驱动「工具成败 → prediction → 路由 → 派发」闭环（不 mock 中间层；
 * agents/subagents 服务用最小替身——派发调用序真实断言）。
 *
 * 场景：8 连败 → prediction escalate → decide() 返回 delegate verifier →
 * execute() 经 subagent seam 派发子代理（start/result/dispose 调用序）→
 * 连续 3 次成功 → tipping point 重置 → decide() 回 self。
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import { SessionId, type SessionEvent } from '@huiliyi37/dsh-session'
import { apply as applyAgentRouter, resolveProfileTools, type RouterService } from '../src/index.js'

const PARENT_ID = SessionId('session-1')

function makeContext(config: Record<string, unknown> = {}): {
  ctx: Context
  seam: { start: ReturnType<typeof vi.fn> }
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
  session: { id: string; header?: { parentSession?: string } } = { id: 'session-1' },
): void {
  emit('session/event', session, toolResult(isError))
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
    expect(() => applyAgentRouter(new Context(), { profileTools: { codeScout: [] } })).toThrow(/non-empty/)
    expect(() => applyAgentRouter(new Context(), { profileTools: { verifier: ['read', ''] } })).toThrow(/non-empty/)
    expect(() => applyAgentRouter(new Context(), { profileTools: { codeScout: ['read', 'read'] } })).toThrow(/duplicates/)
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
      (ctx.emit)('session/event', { id: PARENT_ID }, toolResult(true))
    }
    const action = router.decide({ sessionId: PARENT_ID })
    expect(action.kind).toBe('delegate')
    const id = await router.execute(action, { sessionId: PARENT_ID })
    expect(id).toBeNull()
    expect(seam.start).not.toHaveBeenCalled()
  }, 10000)

  it('subagentProvider 非法（空串）时装配 fail loud', () => {
    expect(() => applyAgentRouter(new Context(), { subagentProvider: '' })).toThrow(/non-empty provider name/)
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
    const session = { id: A, header: {}, append: (type: string, data: unknown) => { appended.push({ type, data }) } }

    for (let i = 0; i < 8; i++) runTool(emit, true, { id: A })
    expect(router.metrics({ sessionId: A }).interventionLevel).toBe('escalate')
    emit('session/event', session, {
      type: 'turn/end', seq: 1, time: 1, data: { turn: 1, reason: { kind: 'completed' } },
    })
    await vi.waitFor(() => expect(appended).toHaveLength(1))
    expect(appended[0]!.type).toBe('router/decision')
    const decision = appended[0]!.data as { profile: string; mode: string; dispatched: boolean; subagentSessionId?: string }
    expect(decision.profile).toBe('verifier')
    expect(decision.mode).toBe('shadow')
    expect(decision.dispatched).toBe(false)
    expect(decision.subagentSessionId).toBeUndefined()
    expect(seam.start).not.toHaveBeenCalled()
  }, 10000)

  it('trigger auto：turn/end 决策后经 seam 派发，决策记录 dispatched true', async () => {
    const { seam, emit } = makeContext({ trigger: { mode: 'auto', onTurnEnd: true } })
    const A = SessionId('session-a')
    const appended: Array<{ type: string; data: unknown }> = []
    const session = { id: A, header: {}, append: (type: string, data: unknown) => { appended.push({ type, data }) } }

    for (let i = 0; i < 8; i++) runTool(emit, true, { id: A })
    emit('session/event', session, {
      type: 'turn/end', seq: 1, time: 1, data: { turn: 1, reason: { kind: 'completed' } },
    })
    await vi.waitFor(() => expect(appended).toHaveLength(1))
    const decision = appended[0]!.data as { dispatched: boolean; subagentSessionId?: string }
    expect(decision.dispatched).toBe(true)
    expect(decision.subagentSessionId).toBe('session-child-1')
    expect(seam.start).toHaveBeenCalledTimes(1)
  }, 10000)

  it('trigger off / child 会话 turn/end 不触发决策', async () => {
    const offCtx = makeContext({ trigger: { mode: 'shadow', onTurnEnd: true } })
    const router = offCtx.ctx.get('router') as RouterService
    const A = SessionId('session-a')
    const appended: Array<{ type: string; data: unknown }> = []
    const session = { id: A, header: {}, append: (type: string, data: unknown) => { appended.push({ type, data }) } }
    for (let i = 0; i < 8; i++) runTool(offCtx.emit, true, { id: A })
    expect(router.metrics({ sessionId: A }).interventionLevel).toBe('escalate')
    // child 会话（header.parentSession）turn/end → 排除
    offCtx.emit('session/event', { id: 'session-child-1', header: { parentSession: A }, append: () => {} }, {
      type: 'turn/end', seq: 1, time: 1, data: { turn: 1, reason: { kind: 'completed' } },
    })
    // self 决策（连续 3 次成功重置）→ 不落记录
    for (let i = 0; i < 3; i++) runTool(offCtx.emit, false, { id: A })
    offCtx.emit('session/event', session, {
      type: 'turn/end', seq: 1, time: 1, data: { turn: 1, reason: { kind: 'completed' } },
    })
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(appended).toHaveLength(0)
    // 缺省配置（无 trigger）不触发
    const defaultCtx = makeContext()
    const defaultRouter = defaultCtx.ctx.get('router') as RouterService
    for (let i = 0; i < 8; i++) runTool(defaultCtx.emit, true, { id: 'session-a' })
    expect(defaultRouter.metrics({ sessionId: SessionId('session-a') }).interventionLevel).toBe('escalate')
    const defaultAppended: Array<{ type: string }> = []
    defaultCtx.emit('session/event', { id: 'session-a', header: {}, append: (type: string) => { defaultAppended.push({ type }) } }, {
      type: 'turn/end', seq: 1, time: 1, data: { turn: 1, reason: { kind: 'completed' } },
    })
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(defaultAppended).toHaveLength(0)
  }, 10000)

  it('trigger 配置非法 fail loud', () => {
    expect(() => applyAgentRouter(new Context(), { trigger: { mode: 'hyper' as never } })).toThrow(/trigger.mode/)
    expect(() => applyAgentRouter(new Context(), { trigger: { onTurnEnd: 'yes' as never } })).toThrow(/onTurnEnd/)
    expect(() => applyAgentRouter(new Context(), { escalation: { cap: 'strong' as never } })).toThrow(/escalation.cap/)
    expect(() => applyAgentRouter(new Context(), { escalation: { minConsecutiveFailures: 0 } })).toThrow(/minConsecutiveFailures/)
  })

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

  it('agent/disposed 时 evict 该会话的累计器', async () => {
    const { ctx, emit } = makeContext()
    const router = ctx.get('router') as RouterService
    const A = SessionId('session-a')

    for (let i = 0; i < 8; i++) runTool(emit, true, { id: A })
    expect(router.metrics({ sessionId: A }).interventionLevel).toBe('escalate')
    emit('agent/disposed', { agent: { session: { id: A } } })
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
