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
import { SessionId } from '@huiliyi37/dsh-session'
import { apply as applyAgentRouter, resolveProfileTools, type RouterService } from '../src/index.js'

const PARENT_ID = SessionId('session-1')

function makeContext(): {
  ctx: Context
  seam: { start: ReturnType<typeof vi.fn> }
  counters: { result: number; dispose: number; append: Array<{ type: string; data: unknown }> }
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
      result: Promise.resolve({ stopReason: 'completed' }).then((r: unknown) => { counters.result++; return r }),
      dispose: vi.fn(async () => { counters.dispose++ }),
    })),
  }
  const ctx = new Context()
  ctx.provide('subagents', seam)
  const appended: Array<{ type: string; data: unknown }> = []
  ctx.provide('agents', {
    get: (_id: SessionId) => ({
      session: {
        header: { id: PARENT_ID },
        append: (type: string, data: unknown) => { appended.push({ type, data }) },
      },
    }),
  })
  applyAgentRouter(ctx, { provider: 'mock', model: 'mock' })
  counters.append = appended
  const emit = (name: string, ...args: unknown[]): void => {
    // 测试替身按宽松签名派发事件（name 为运行时字符串）；类型化重载要求
    // keyof Events + 精确 payload——@ts-expect-error 命名该偏差。
    // @ts-expect-error -- name: string 非 keyof Events；payload 形状宽松
    (ctx.emit)(name, ...args)
  }
  return { ctx, seam, counters, emit }
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
      const id = await router.execute(action, { sessionId: PARENT_ID })
      expect(id).toBe(SessionId('session-child-1'))
      expect(seam.start).toHaveBeenCalledTimes(1)
      expect(counters.result).toBe(1)
      expect(counters.dispose).toBe(1)
      const entry = seam.start.mock.calls[0] as unknown as [string, Record<string, unknown>]
      expect(entry[0]).toBe('spawn')
      expect(entry[1].toolFilter).toEqual({ allow: ['grep', 'read', 'glob', 'repo_graph', 'bash'] })
      // acceptance 时的路由决策记录（约束：决策可审计）
      expect(counters.append).toHaveLength(1)
      expect(counters.append[0]!.type).toBe('router/route')
      const record = counters.append[0]!.data as { profile: string; subagentSessionId: string }
      expect(record.profile).toBe('verifier')
      expect(record.subagentSessionId).toBe('session-child-1')
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
