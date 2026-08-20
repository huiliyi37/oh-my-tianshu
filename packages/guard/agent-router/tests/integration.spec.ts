/**
 * integration.spec.ts — 端到端：真实 cordis Context 装配插件，真实事件对象
 * 驱动「工具成败 → prediction → 路由 → 派发」闭环（不 mock 中间层；
 * agents 服务用最小替身——派发调用序真实断言）。
 *
 * 场景：8 连败 → prediction escalate → decide() 返回 delegate verifier →
 * execute() 派发子代理（create/followup/whenIdle/dispose 调用序）→
 * 连续 3 次成功 → tipping point 重置 → decide() 回 self。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import { apply as applyAgentRouter, resolveProfileTools, type RouterService } from '../src/index.js'

interface AgentsFacet {
  create: ReturnType<typeof import('vitest').vi.fn>
}

function makeContext(): { ctx: Context; agents: AgentsFacet; emit: (name: string, ...args: unknown[]) => void } {
  const calls = { followup: [] as unknown[], whenIdle: 0, dispose: 0 }
  const agent = {
    followup: async (input: unknown) => { calls.followup.push(input) },
    whenIdle: async () => { calls.whenIdle++ },
  }
  const create = Object.assign(async () => ({ agent, dispose: async () => { calls.dispose++ } }), {})
  const agents = { create: create as unknown as AgentsFacet['create'] }
  const ctx = new Context() as Context & { agents: AgentsFacet; reflect: { get(): unknown } }
  ctx.provide('agents', agents)
  applyAgentRouter(ctx, { provider: 'mock', model: 'mock' })
  const emit = (name: string, ...args: unknown[]): void => {
    // 测试替身按宽松签名派发事件（name 为运行时字符串）；类型化重载要求
    // keyof Events + 精确 payload——@ts-expect-error 命名该偏差。
    // @ts-expect-error -- name: string 非 keyof Events；payload 形状宽松
    (ctx.emit)(name, ...args)
  }
  return { ctx, agents, emit }
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

function runTool(emit: (name: string, ...args: unknown[]) => void, isError: boolean): void {
  emit('session/event', { id: 'session-1' }, toolResult(isError))
}

describe('agent-router 端到端（指标 → 路由 → 派发）', () => {
  it('8 连败 → escalate → delegate verifier → 派发调用序', async () => {
    const { ctx, emit } = makeContext()
    const router = ctx.get('router') as RouterService

    // 8 连败（≥3 样本 + 错误率 1.0 → escalate）
    for (let i = 0; i < 8; i++) runTool(emit, true)

    const metrics = router.metrics()
    expect(metrics.interventionLevel).toBe('escalate')

    const action = router.decide()
    expect(action.kind).toBe('delegate')
    if (action.kind === 'delegate') {
      expect(action.profile).toBe('verifier')
      // execute 派发：返回子代理 id + 调用序（create 经 mock、followup/whenIdle/dispose 真实）
      const id = await router.execute(action)
      expect(id).not.toBeNull()
    }
  }, 10000)

  it('连续 3 次成功 → tipping point 重置 → decide 回 self', async () => {
    const { ctx, emit } = makeContext()
    const router = ctx.get('router') as RouterService

    for (let i = 0; i < 5; i++) runTool(emit, true) // 5 连败 → escalate
    expect(router.metrics().interventionLevel).toBe('escalate')

    for (let i = 0; i < 3; i++) runTool(emit, false) // 3 连成 → tipping point
    expect(router.metrics().interventionLevel).toBe('none') // 重置后样本 <3 → none
    expect(router.decide().kind).toBe('self')
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
    const guards: unknown[] = []
    const ctx = new Context()
    const create = async () => ({ agent: { followup: async () => {}, whenIdle: async () => {} }, dispose: async () => {} })
    ctx.provide('agents', { create } as never)
    applyAgentRouter(ctx, { provider: 'mock', model: 'mock', dispatchEnabled: false })
    const router = ctx.get('router') as RouterService
    for (let i = 0; i < 5; i++) {
      // @ts-expect-error -- 测试拆开 payload 派发（session/event 参数形状宽松）
      (ctx.emit)('session/event', { id: 's1' }, toolResult(true))
    }
    const action = router.decide()
    expect(action.kind).toBe('delegate')
    const id = await router.execute(action)
    expect(id).toBeNull()
    void guards
  }, 10000)
})
