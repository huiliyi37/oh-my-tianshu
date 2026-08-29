/**
 * 子浪 B 接线行为：`list_subagent_models` 发现工具、执行器 allowlist 强制、
 * 能力位拒绝（service 与挂载两侧）。回流上游 aefc083be7 弧。
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import { CallId } from '@huiliyi37/dsh-llm'
import { Session, SESSION_FORMAT_VERSION, SessionId } from '@huiliyi37/dsh-session'
import { ToolRegistry } from '@huiliyi37/dsh-tools'
import SystemPrompt from '@huiliyi37/dsh-system-prompt'
import SubagentService from '@huiliyi37/dsh-subagent'
import type { Agent } from '@huiliyi37/dsh-agent'
import type { SubagentCapabilities, SubagentProvider, SubagentStartRequest } from '@huiliyi37/dsh-subagent'
import * as tool from '../src/index.ts'
import { recordSubagentModelSelection } from '../src/model-selection-state.ts'

const TEST_SIGNAL = new AbortController().signal

/** 带 session 的最小 agent 替身（路由基线 + 策略事件读取面）。 */
function fakeAgent(id: string, opts: { options?: Record<string, unknown>; session?: Session } = {}): Agent {
  return {
    id: SessionId(id),
    options: opts.options ?? {},
    session: opts.session ?? Session.create(SessionId(id)),
  } as unknown as Agent
}

const ALL_CAPS: SubagentCapabilities = {
  agentOptions: true, outputSchema: false, depthLimit: false, toolFilter: false,
  persona: false, sandboxMode: false, runBudget: false,
}
const NO_CAPS: SubagentCapabilities = {
  agentOptions: false, outputSchema: false, depthLimit: false, toolFilter: false,
  persona: false, sandboxMode: false, runBudget: false,
}

function captureProvider(
  capabilities: SubagentCapabilities,
  seen: { request?: SubagentStartRequest },
): SubagentProvider {
  return {
    name: 'capture',
    capabilities,
    inheritsParentContext: false,
    start: async (request: SubagentStartRequest) => {
      seen.request = request
      return {
        id: SessionId('capture-child'),
        localAgent: undefined,
        result: Promise.resolve({ output: [{ type: 'text', text: 'ok' }], stopReason: 'completed' as const }),
        dispose: async () => {},
      }
    },
  } as unknown as SubagentProvider
}

describe('list_subagent_models（发现工具）', () => {
  it('无参列出策略内 provider；带 provider 列目录交集；带 model 列 efforts 与默认', async () => {
    const session = Session.create(SessionId('disc-session'))
    recordSubagentModelSelection(session, [{ provider: 'alpha', model: 'fast-model' }])
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRegistry)
    await ctx.plugin(SubagentService)
    ctx.provide('llm', {
      listProviders: () => [{ id: 'alpha', name: 'Alpha' }, { id: 'beta', name: 'Beta' }],
      listModels: async (provider: string) =>
        provider === 'alpha'
          ? [{ provider, id: 'fast-model', name: 'Fast' }, { provider, id: 'big-model', name: 'Big' }]
          : [{ provider, id: 'beta-model', name: 'Beta M' }],
      resolveModelInfo: async (provider: string, model: string) => ({
        provider,
        id: model,
        name: model,
        reasoning: {
          efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }],
          defaultEffort: 'low',
        },
      }),
    })
    ctx.subagents.registerProvider(captureProvider(ALL_CAPS, {}))
    tool.apply(ctx, { provider: 'capture', modelSelectionSettings: true })
    const agent = fakeAgent('disc-1', { session })

    const providers = await ctx.tools.execute({
      signal: TEST_SIGNAL, callId: CallId('d1'), name: 'list_subagent_models', arguments: {}, agent,
    })
    expect(providers.isError).toBe(false)
    if (!providers.isError) expect(providers.value).toEqual({ output: 'alpha — Alpha' })

    const models = await ctx.tools.execute({
      signal: TEST_SIGNAL, callId: CallId('d2'), name: 'list_subagent_models',
      arguments: { provider: 'alpha' }, agent,
    })
    expect(models.isError).toBe(false)
    if (!models.isError) expect(models.value).toEqual({ output: 'alpha/fast-model — Fast' })

    const efforts = await ctx.tools.execute({
      signal: TEST_SIGNAL, callId: CallId('d3'), name: 'list_subagent_models',
      arguments: { provider: 'alpha', model: 'fast-model' }, agent,
    })
    expect(efforts.isError).toBe(false)
    if (!efforts.isError) {
      expect(efforts.value).toEqual({
        output: 'alpha/fast-model — fast-model\nReasoning efforts:\nlow (default) — Low\nhigh — High',
      })
    }
  })

  it('策略外 provider 在发现侧即拒绝；无策略会话整体拒绝调用', async () => {
    const session = Session.create(SessionId('disc-session-2'))
    recordSubagentModelSelection(session, [{ provider: 'alpha', model: 'fast-model' }])
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRegistry)
    await ctx.plugin(SubagentService)
    ctx.provide('llm', { listProviders: () => [], listModels: async () => [], resolveModelInfo: async () => ({}) })
    ctx.subagents.registerProvider(captureProvider(ALL_CAPS, {}))
    tool.apply(ctx, { provider: 'capture', modelSelectionSettings: true })

    const denied = await ctx.tools.execute({
      signal: TEST_SIGNAL, callId: CallId('d4'), name: 'list_subagent_models',
      arguments: { provider: 'beta' }, agent: fakeAgent('disc-2', { session }),
    })
    expect(denied.isError).toBe(true)

    const noPolicy = await ctx.tools.execute({
      signal: TEST_SIGNAL, callId: CallId('d5'), name: 'list_subagent_models', arguments: {},
      agent: fakeAgent('disc-3', { session: Session.create(SessionId('disc-fresh')) }),
    })
    expect(noPolicy.isError).toBe(true)
  })
})

describe('执行器 allowlist 强制与能力位拒绝', () => {
  it('带外显式路由在执行器被拒；策略内路由放行并携带选中路由', async () => {
    const seen: { request?: SubagentStartRequest } = {}
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRegistry)
    await ctx.plugin(SubagentService)
    ctx.subagents.registerProvider(captureProvider(ALL_CAPS, seen))
    ctx.provide('llm', { resolveCallConfig: vi.fn(async (config: unknown) => config) })
    tool.apply(ctx, { provider: 'capture', modelSelectionSettings: true })
    const session = Session.create(SessionId('enforce-1'))
    recordSubagentModelSelection(session, [{ provider: 'allowed-p', model: 'allowed-m' }])
    const agent = fakeAgent('enforce-agent', { options: { provider: 'allowed-p', model: 'allowed-m' }, session })

    const denied = await ctx.tools.execute({
      signal: TEST_SIGNAL, callId: CallId('e1'), name: 'subagent',
      arguments: { description: 'd', prompt: 'p', provider: 'other-p', model: 'other-m' }, agent,
    })
    expect(denied.isError).toBe(true)
    expect(seen.request).toBeUndefined()

    const allowed = await ctx.tools.execute({
      signal: TEST_SIGNAL, callId: CallId('e2'), name: 'subagent',
      arguments: { description: 'd', prompt: 'p', provider: 'allowed-p', model: 'allowed-m' }, agent,
    })
    expect(allowed.isError).toBe(false)
    expect(seen.request?.agentOptions).toEqual({ provider: 'allowed-p', model: 'allowed-m' })
  })

  it('service 侧拒绝无能力 provider 上的 agentOptions 请求（accepted-then-ignored 不存在）', async () => {
    const seen: { request?: SubagentStartRequest } = {}
    const ctx = new Context()
    await ctx.plugin(SubagentService)
    ctx.subagents.registerProvider(captureProvider(NO_CAPS, seen))
    const rejection = await ctx.subagents.start('capture', {
      label: 'l',
      prompt: [{ type: 'text', text: 'p' }],
      parent: fakeAgent('svc-parent', { options: { provider: 'x', model: 'y' } }),
      signal: TEST_SIGNAL,
      agentOptions: { model: 'm' },
    }).then(() => undefined, (error: unknown) => error)
    expect(String((rejection as Error)?.message ?? rejection)).toMatch(/does not support the "agentOptions" capability/)
    expect(seen.request).toBeUndefined()
  })

  it('挂载侧拒绝无能力 provider 上的配置 agentOptions', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRegistry)
    await ctx.plugin(SubagentService)
    ctx.subagents.registerProvider(captureProvider(NO_CAPS, {}))
    const rejection = await ctx.plugin(tool, { provider: 'capture', agentOptions: { model: 'm' }, maxDepth: 'provider-managed' })
      .then(() => undefined, (error: unknown) => error)
    expect(String((rejection as Error)?.message ?? rejection)).toMatch(/cannot honor agentOptions/)
  })
})

describe('策略解析（resume 顶层与父不可达采样）', () => {
  const routedCtx = async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRegistry)
    await ctx.plugin(SubagentService)
    ctx.subagents.registerProvider(captureProvider(ALL_CAPS, {}))
    ctx.provide('llm', {
      listProviders: () => [{ id: 'alpha', name: 'Alpha' }, { id: 'beta', name: 'Beta' }],
      listModels: async () => [],
      resolveModelInfo: async () => ({}),
    })
    tool.apply(ctx, { provider: 'capture', modelSelectionSettings: true })
    return ctx
  }

  it('resume 的旧顶层会话（firstLiveSeq > 0 无锚定）采样设置', async () => {
    const ctx = await routedCtx()
    ctx.provide('subagentModelSelection', {
      current: () => ({ enabled: true, allowedModels: [{ provider: 'alpha', model: 'fast-model' }] }),
    })
    // 带 seed 构造的会话 firstLiveSeq > 0，模拟 resume 的旧顶层会话：日志无策略事件。
    const resumed = Session.create(SessionId('resumed-top'), [
      { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
    ])
    const result = await ctx.tools.execute({
      signal: TEST_SIGNAL, callId: CallId('r1'), name: 'list_subagent_models', arguments: {},
      agent: fakeAgent('resumed-1', { session: resumed }),
    })
    expect(result.isError).toBe(false)
    if (!result.isError) expect(result.value).toEqual({ output: 'alpha — Alpha' })
  })

  it('父可达的子会话继承父会话已锚定决策，而非采样当前设置', async () => {
    const ctx = await routedCtx()
    // 父会话锚定 alpha；设置此刻指向 beta——继承必须让子会话拿到 alpha。
    const parentSession = Session.create(SessionId('parent-anchored'))
    recordSubagentModelSelection(parentSession, [{ provider: 'alpha', model: 'fast-model' }])
    ctx.provide('agents', {
      get: (id: string) => id === 'parent-anchored' ? fakeAgent('parent-anchored', { session: parentSession }) : undefined,
    })
    ctx.provide('subagentModelSelection', {
      current: () => ({ enabled: true, allowedModels: [{ provider: 'beta', model: 'beta-model' }] }),
    })
    const child = Session.create(SessionId('child-inherits'), [], {
      version: SESSION_FORMAT_VERSION,
      id: SessionId('child-inherits'),
      createdAt: Date.now(),
      origin: 'subagent',
      parentSession: SessionId('parent-anchored'),
    })
    const result = await ctx.tools.execute({
      signal: TEST_SIGNAL, callId: CallId('r2'), name: 'list_subagent_models', arguments: {},
      agent: fakeAgent('child-1', { session: child }),
    })
    expect(result.isError).toBe(false)
    if (!result.isError) expect(result.value).toEqual({ output: 'alpha — Alpha' })
  })

  it('父不可达的子会话采样设置（上游 per-Agent 采样的等价路径）', async () => {
    const ctx = await routedCtx()
    ctx.provide('agents', { get: () => undefined })
    ctx.provide('subagentModelSelection', {
      current: () => ({ enabled: true, allowedModels: [{ provider: 'beta', model: 'beta-model' }] }),
    })
    const orphan = Session.create(SessionId('child-orphan'), [], {
      version: SESSION_FORMAT_VERSION,
      id: SessionId('child-orphan'),
      createdAt: Date.now(),
      origin: 'subagent',
      parentSession: SessionId('gone-parent'),
    })
    const result = await ctx.tools.execute({
      signal: TEST_SIGNAL, callId: CallId('r3'), name: 'list_subagent_models', arguments: {},
      agent: fakeAgent('orphan-1', { session: orphan }),
    })
    expect(result.isError).toBe(false)
    if (!result.isError) expect(result.value).toEqual({ output: 'beta — Beta' })
  })

  it('每次解析只扫一次本会话事件日志；重复解析不重复落盘', async () => {
    const ctx = await routedCtx()
    ctx.provide('agents', { get: () => undefined })
    ctx.provide('subagentModelSelection', {
      current: () => ({ enabled: true, allowedModels: [{ provider: 'alpha', model: 'fast-model' }] }),
    })
    const base = Session.create(SessionId('scan-1'), [
      { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
    ])
    const scans = { count: 0 }
    const session = new Proxy(base, {
      get(target, key, receiver) {
        if (key === 'events') scans.count += 1
        return Reflect.get(target, key, receiver)
      },
    }) as Session
    const agent = fakeAgent('scan-agent', { session })

    const first = await ctx.tools.execute({
      signal: TEST_SIGNAL, callId: CallId('s1'), name: 'list_subagent_models', arguments: {}, agent,
    })
    expect(first.isError).toBe(false)
    const second = await ctx.tools.execute({
      signal: TEST_SIGNAL, callId: CallId('s2'), name: 'list_subagent_models', arguments: {}, agent,
    })
    expect(second.isError).toBe(false)
    // 采样路径与已录路径各读一次事件日志；append 不再为幂等性重扫。
    expect(scans.count).toBe(2)
    // 幂等语义迁移不回归：策略事件只落一个。
    expect(base.events.filter(event => event.type === 'subagent/model-selection-policy')).toHaveLength(1)
  })
})
