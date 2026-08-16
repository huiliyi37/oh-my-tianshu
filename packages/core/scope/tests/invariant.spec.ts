import { freezeMessage, MessageId } from '@huiliyi37/dsh-llm'
import { describe, expect, it } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import type { Events } from '@huiliyi37/cordis'
import type { Agent } from '@huiliyi37/dsh-agent'
import { scopeTarget } from '@huiliyi37/dsh-scope'
import * as ScopeInvariant from '@huiliyi37/dsh-scope/invariant'
import InvariantService from '@huiliyi37/dsh-invariants'

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(InvariantService)
  await ctx.plugin(ScopeInvariant)
  return ctx
}

function emit(ctx: Context, receiver: object | undefined, event: string, args: unknown[]): void {
  const dispatch = ctx.emit.bind(ctx)
  // 测试替身按宽松签名派发任意事件形状；Events 联合在此处不具名（receiver
  // 可能是任意 scope），类型化重载无法表达——@ts-expect-error 命名该偏差。
  // @ts-expect-error -- event: string 非 keyof Events；测试事件形状宽松
  if (receiver === undefined) dispatch(event, ...args)
  // @ts-expect-error -- receiver 为任意 scope 载体；重载 2 的 thisArg 形状不匹配
  else dispatch(receiver, event, ...args)
}

describe('scoped-dispatch invariants', () => {
  type AgentEventName = Extract<keyof Events, `agent/${string}`>
  type EventArgs<K extends keyof Events> = Events[K] extends (...args: infer Args) => unknown ? Args : never

  it('ignores ordinary events and rejects a scoped dispatch without a carrier', async () => {
    const ctx = await setup()
    expect(() => { emit(ctx, undefined, 'ordinary/event', []) }).not.toThrow()
    const agent = { id: 'a1' }
    expect(() => { emit(ctx, undefined, 'agent/error', [{ agent, turn: 1, step: 0, error: new Error('x') }]) })
      .toThrow(/dispatched without a scope carrier/)
  })

  it('checks every generated subject resolver against the carrier key', async () => {
    const ctx = await setup()
    const agent = { id: 'a1' } as unknown as Agent
    const other = { id: 'a2' } as unknown as Agent
    const signal = new AbortController().signal
    const config = { provider: 'p', model: 'm' }
    const message = freezeMessage({
      id: MessageId('m'),
      role: 'user',
      content: [],
      source: { kind: 'user' },
    })
    const agentRows = {
      'agent/created': [{ agent }],
      'agent/disposed': [{ agent }],
      'agent/status': [{ agent, status: 'idle' }],
      'agent/inbox/inserted': [{ agent, message }],
      'agent/inbox/claimed': [{ agent, message, turn: 1 }],
      'agent/inbox/discarded': [{ agent, message }],
      'agent/session-start': [{ agent, source: 'startup' }],
      'agent/pre-step': [{ agent, messages: [message], turn: 1, step: 1, signal }, () => Promise.resolve({ kind: 'enter', messages: [message] })],
      'agent/pre-tool-commit': [{ agent, calls: [], turn: 1, step: 1, signal }, () => Promise.resolve({ calls: [] })],
      'agent/request': [{ agent, turn: 1, step: 1, signal }, () => Promise.resolve(config)],
      'agent/request-error': [
        {
          agent,
          turn: 1,
          step: 1,
          provider: 'p',
          failure: { message: 'request', code: 'UNKNOWN' },
          retryPolicy: undefined,
          signal,
        },
        () => Promise.resolve(undefined),
      ],
      'agent/turn-stopping': [{ agent, turn: 1, signal }],
      'agent/error': [{ agent, turn: 1, step: 0, error: new Error('x') }],
    } satisfies { [K in AgentEventName]: EventArgs<K> }
    const rows: Array<[string, unknown[]]> = [
      ...Object.entries(agentRows),
      ['approval/request', [{ agent, toolName: 'echo' }, () => Promise.resolve('unavailable')]],
      ['goal/changed', [{ agent, change: { operation: 'create', ref: { id: 'goal-a', revision: 1 } } }]],
      ['system-prompt/assemble', [[], { scope: agent }]],
      ['tools/code-dispatch-log', [{ exec: { callId: 'c', name: 't', arguments: {} }, agent, subCallId: 'c:code:1', name: 't', isError: false, content: [] }, () => Promise.resolve([])]],
      ['tools/execute', [{ callId: 'c', name: 't', arguments: {}, agent }, () => Promise.resolve({ content: [], isError: false })]],
      ['tools/post-execute', [{ callId: 'c', name: 't', arguments: {}, agent }, { content: [], isError: false }, () => Promise.resolve({ kind: 'accept' })]],
      ['tools/pre-execute', [{ callId: 'c', name: 't', arguments: {}, agent }, () => Promise.resolve({ kind: 'allow' })]],
      ['tools/result', [{ callId: 'c', name: 't', arguments: {}, agent }, { content: [], isError: false }]],
    ]

    for (const [event, args] of rows) {
      expect(() => { emit(ctx, scopeTarget(agent, agent), event, args) }, `${event} matching`).not.toThrow()
      expect(() => { emit(ctx, scopeTarget(agent, other), event, args) }, `${event} mismatched`)
        .toThrow(/DIFFERENT subject/)
    }
  })

  it('requires carriers for generated presence-only scoped events without comparing a payload subject', async () => {
    const ctx = await setup()
    const agent = { id: 'a1' }
    const rows: Array<[string, unknown[]]> = [
      ['session/created', [{}]],
      ['session/disposed', [{}]],
      ['session/event', [{}, {}]],
      ['session/flush', [{}]],
      ['subagent/end', [{}]],
      ['subagent/start', [{}]],
    ]
    for (const [event, args] of rows) {
      expect(() => { emit(ctx, scopeTarget(agent, agent), event, args) }, `${event} carrier`).not.toThrow()
      expect(() => { emit(ctx, undefined, event, args) }, `${event} no carrier`)
        .toThrow(/dispatched without a scope carrier/)
    }
  })
})
