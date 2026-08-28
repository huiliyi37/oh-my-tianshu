import { describe, expect, it } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import { scopeTarget } from '@huiliyi37/dsh-scope'
import { SessionId } from '@huiliyi37/dsh-session'
import SubagentService, { SubagentRunId } from '@huiliyi37/dsh-subagent'
import type {
  SubagentProvider,
  SubagentRunEndInfo,
  SubagentRunInfo,
} from '@huiliyi37/dsh-subagent'
import * as SubagentInvariant from '@huiliyi37/dsh-subagent/invariant'
import InvariantService from '@huiliyi37/dsh-invariants'

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SubagentService)
  await ctx.plugin(InvariantService)
  await ctx.plugin(SubagentInvariant)
  return ctx
}

const provider = (name: string): SubagentProvider => ({
  name,
  capabilities: { agentOptions: false, outputSchema: false, depthLimit: false, toolFilter: false, persona: false, sandboxMode: false, runBudget: false },
  inheritsParentContext: false,
  start: async () => { throw new Error('not used') },
})

const start = (overrides: Partial<SubagentRunInfo> = {}): SubagentRunInfo => ({
  runId: SubagentRunId('run-1'),
  provider: 'mock',
  id: SessionId('child-1'),
  local: false,
  ...overrides,
})

const end = (overrides: Partial<SubagentRunEndInfo> = {}): SubagentRunEndInfo => ({
  ...start(),
  stopReason: 'completed',
  ...overrides,
})

function emitRun(ctx: Context, name: 'subagent/start', info: SubagentRunInfo): void
function emitRun(ctx: Context, name: 'subagent/end', info: SubagentRunEndInfo): void
function emitRun(ctx: Context, name: 'subagent/start' | 'subagent/end', info: SubagentRunInfo | SubagentRunEndInfo): void {
  // 事件 map 的 merge-extensible fallback 重载使 Parameters<Events[K]> 取
  // { parentId; id } 形状，类型化 emit 无法派发真实形状；监听器按 Scoped
  // 重载消费，此处按 Scoped 重载直接派发（scopeTarget 返回 phantom Scoped，
  // 结构兼容任意载体）。

  ctx.emit(scopeTarget(ctx.subagents, {}), name, info)
}

describe('subagent invariants', () => {
  it('accepts provider and run lifecycle pairs', async () => {
    const ctx = await setup()
    const mock = provider('mock')
    ctx.emit('subagent/provider-added', mock)
    emitRun(ctx, 'subagent/start', start())
    emitRun(ctx, 'subagent/end', end())
    ctx.emit('subagent/provider-removed', 'mock')
    ctx.emit('tools/change')
  })

  it('rejects malformed provider transitions', async () => {
    const ctx = await setup()
    expect(() => { ctx.emit('subagent/provider-added', provider('')) }).toThrow(/names must be non-empty/)
    const mock = provider('mock')
    ctx.emit('subagent/provider-added', mock)
    expect(() => { ctx.emit('subagent/provider-added', mock) }).toThrow(/repeated "mock"/)
    expect(() => { ctx.emit('subagent/provider-removed', 'missing') }).toThrow(/unknown provider/)
  })

  it('rejects malformed and unpaired run transitions', async () => {
    const ctx = await setup()
    expect(() => { emitRun(ctx, 'subagent/start', start({ provider: '' })) })
      .toThrow(/provider, runId, and child id must be non-empty/)
    expect(() => { emitRun(ctx, 'subagent/start', start({ runId: SubagentRunId('') })) })
      .toThrow(/provider, runId, and child id must be non-empty/)
    emitRun(ctx, 'subagent/start', start())
    expect(() => { emitRun(ctx, 'subagent/start', start()) }).toThrow(/repeated run id/)
    expect(() => { emitRun(ctx, 'subagent/end', end({ runId: SubagentRunId('missing') })) })
      .toThrow(/no matching subagent\/start/)
    expect(() => { emitRun(ctx, 'subagent/end', end({ id: SessionId('other') })) })
      .toThrow(/identity diverges/)
  })

  it('accepts the recorded provider name after registration ends', async () => {
    const ctx = await setup()
    const historical = provider('historical')
    ctx.emit('subagent/provider-added', historical)
    ctx.emit('subagent/provider-removed', historical.name)

    emitRun(ctx, 'subagent/start', start({ provider: historical.name }))
    emitRun(ctx, 'subagent/end', end({ provider: historical.name }))
  })
})
