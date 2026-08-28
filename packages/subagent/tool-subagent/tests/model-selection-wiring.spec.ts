/**
 * 子浪 B 接线行为：`list_subagent_models` 发现工具、执行器 allowlist 强制、
 * 能力位拒绝（service 与挂载两侧）。回流上游 aefc083be7 弧。
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import { CallId } from '@huiliyi37/dsh-llm'
import { Session, SessionId } from '@huiliyi37/dsh-session'
import { ToolRegistry } from '@huiliyi37/dsh-tools'
import SystemPrompt from '@huiliyi37/dsh-system-prompt'
import SubagentService from '@huiliyi37/dsh-subagent'
import type { Agent, SubagentCapabilities, SubagentProvider, SubagentStartRequest } from '@huiliyi37/dsh-subagent'
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
    start: async (request) => {
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

const STUB_LLM = { resolveCallConfig: vi.fn(async (config: unknown) => config) }

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
