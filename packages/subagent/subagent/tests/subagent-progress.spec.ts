import { describe, expect, it } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import SessionStore from '@huiliyi37/dsh-session'
import type { SessionEvent } from '@huiliyi37/dsh-session'
import SessionProjectionRegistry from '@huiliyi37/dsh-session-projection'
import SubagentService from '../src/index.ts'
import { subagentProgressProjectionDefinition } from '../src/projection.ts'

function event(
  type: SessionEvent['type'],
  seq: number,
  time: number,
  data: Record<string, unknown>,
): SessionEvent {
  return { type, seq, time, data } as SessionEvent
}

function fold(events: SessionEvent[]) {
  let state = subagentProgressProjectionDefinition.init()
  for (const item of events) { state = subagentProgressProjectionDefinition.apply(state, item) }
  return subagentProgressProjectionDefinition.view(state)
}

/** Empty-log view: every counter zero, no open turn, nothing in flight. */
const ZERO = { turns: 0, toolCalls: 0, tokensUsed: 0, toolInFlight: false, running: false }

describe('subagent progress projection', () => {
  it('registers with the optional session projection registry', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    const serviceFiber = await ctx.plugin(SubagentService)

    const before = ctx.sessionProjections.snapshot(ctx.sessions.create()).values
    expect(before.subagentProgress).toEqual(ZERO)
    await serviceFiber.dispose()
    const after = ctx.sessionProjections.snapshot(ctx.sessions.create()).values
    expect(after.subagentProgress).toBeUndefined()
  })

  it('resets inherited seed activity at the child descriptor and counts later turns and tools', () => {
    // Seed replay: a completed pre-descriptor turn must not leak into the child.
    expect(fold([
      event('turn/start', 0, 100, { turn: 1, trigger: { kind: 'message', source: { kind: 'user' } } }),
      event('turn/end', 1, 200, { turn: 1, reason: { kind: 'completed' } }),
      event('subagent/descriptor', 2, 300, { version: 1, mode: 'continuable', provider: 'spawn', label: 'child' }),
      event('tool/call', 3, 400, { turn: 2, step: 1, callId: 'c1', name: 'bash', arguments: '{}' }),
      event('tool/result', 4, 500, { turn: 2, step: 1, message: { source: { callId: 'c1' } } }),
      event('turn/end', 5, 600, { turn: 2, reason: { kind: 'completed' } }),
    ])).toEqual({
      turns: 1,
      toolCalls: 1,
      tokensUsed: 0,
      lastTool: 'bash',
      toolInFlight: false,
      lastTurnEnd: 'completed',
      running: false,
    })
  })

  it('tracks the latest in-flight tool call through out-of-order results', () => {
    // c1 resolves while a newer c2 is still pending: still in flight.
    expect(fold([
      event('subagent/descriptor', 0, 0, { version: 1, mode: 'continuable', provider: 'spawn', label: 'child' }),
      event('tool/call', 1, 1, { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: '{}' }),
      event('tool/call', 2, 2, { turn: 1, step: 2, callId: 'c2', name: 'grep', arguments: '{}' }),
      event('tool/result', 3, 3, { turn: 1, step: 1, message: { source: { callId: 'c1' } } }),
    ])).toEqual({ ...ZERO, toolCalls: 2, lastTool: 'grep', toolInFlight: true })
    // The latest call's result lands: no longer in flight.
    expect(fold([
      event('subagent/descriptor', 0, 0, { version: 1, mode: 'continuable', provider: 'spawn', label: 'child' }),
      event('tool/call', 1, 1, { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: '{}' }),
      event('tool/call', 2, 2, { turn: 1, step: 2, callId: 'c2', name: 'grep', arguments: '{}' }),
      event('tool/result', 3, 3, { turn: 1, step: 1, message: { source: { callId: 'c1' } } }),
      event('tool/result', 4, 4, { turn: 1, step: 2, message: { source: { callId: 'c2' } } }),
    ])).toEqual({ ...ZERO, toolCalls: 2, lastTool: 'grep', toolInFlight: false })
  })

  it('clears lastTurnEnd when a later turn opens, so a running child is not terminal', () => {
    expect(fold([
      event('subagent/descriptor', 0, 0, { version: 1, mode: 'continuable', provider: 'spawn', label: 'child' }),
      event('turn/end', 1, 1, { turn: 1, reason: { kind: 'completed' } }),
      event('turn/start', 2, 2, { turn: 2, trigger: { kind: 'message', source: { kind: 'user' } } }),
      event('tool/call', 3, 3, { turn: 2, step: 1, callId: 'c3', name: 'bash', arguments: '{}' }),
    ])).toEqual({
      turns: 1,
      toolCalls: 1,
      tokensUsed: 0,
      lastTool: 'bash',
      toolInFlight: true,
      running: true,
    })
  })

  it('treats a prototype-named tool/result as unmatched (own-key, same state)', () => {
    const afterCall = subagentProgressProjectionDefinition.apply(
      subagentProgressProjectionDefinition.apply(
        subagentProgressProjectionDefinition.init(),
        event('subagent/descriptor', 0, 0, { version: 1, mode: 'continuable', provider: 'spawn', label: 'child' }),
      ),
      event('tool/call', 1, 1, { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: '{}' }),
    )
    expect(subagentProgressProjectionDefinition.apply(
      afterCall,
      event('tool/result', 2, 2, { turn: 1, step: 1, message: { source: { callId: 'constructor' } } }),
    )).toBe(afterCall)
  })

  it('folds billed tokens from the latest assistant/message usage, last-wins', () => {
    expect(fold([
      event('subagent/descriptor', 0, 0, { version: 1, mode: 'continuable', provider: 'spawn', label: 'child' }),
      event('assistant/message', 1, 1, {
        turn: 1, step: 1,
        message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
        usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 30, cacheWriteTokens: 20 },
      }),
      event('assistant/message', 2, 2, {
        turn: 1, step: 2,
        message: { role: 'assistant', content: [{ type: 'text', text: 'again' }] },
        usage: { inputTokens: 10, outputTokens: 5, reasoningTokens: 3 },
      }),
    ])).toEqual({ ...ZERO, tokensUsed: 15, reasoningTokens: 3 })
    expect(fold([
      event('subagent/descriptor', 0, 0, { version: 1, mode: 'continuable', provider: 'spawn', label: 'child' }),
      event('assistant/message', 1, 1, {
        turn: 1, step: 1,
        message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
        usage: { inputTokens: 100, outputTokens: 50, reasoningTokens: 9 },
      }),
      event('assistant/message', 2, 2, {
        turn: 1, step: 2,
        message: { role: 'assistant', content: [{ type: 'text', text: 'again' }] },
        usage: { inputTokens: 10, outputTokens: 5 },
      }),
    ])).toEqual({ ...ZERO, tokensUsed: 15 })
  })

  it('records the ending reason kind and counts post-descriptor turns', () => {
    expect(fold([
      event('subagent/descriptor', 0, 0, { version: 1, mode: 'continuable', provider: 'spawn', label: 'child' }),
      event('turn/end', 1, 1, { turn: 1, reason: { kind: 'completed' } }),
      event('turn/end', 2, 2, { turn: 2, reason: { kind: 'error', error: { message: 'boom', code: 'UNKNOWN' } } }),
    ])).toEqual({ ...ZERO, turns: 2, lastTurnEnd: 'error' })
  })

  it('ignores pre-descriptor work and unrelated events without reallocating', () => {
    const initial = subagentProgressProjectionDefinition.init()
    expect(subagentProgressProjectionDefinition.apply(
      initial,
      event('assistant/chunk', 0, 1, { turn: 1, step: 1, chunk: { type: 'text', text: 'x' } }),
    )).toBe(initial)
    expect(subagentProgressProjectionDefinition.apply(
      initial,
      event('turn/end', 1, 2, { turn: 1, reason: { kind: 'completed' } }),
    )).toBe(initial)
    const descriptor = subagentProgressProjectionDefinition.apply(
      initial,
      event('subagent/descriptor', 2, 3, { version: 1, mode: 'continuable', provider: 'spawn', label: 'child' }),
    )
    expect(descriptor).not.toBe(initial)
    expect(subagentProgressProjectionDefinition.apply(
      descriptor,
      event('todo/write', 3, 4, { todos: [] }),
    )).toBe(descriptor)
    expect(fold([
      event('turn/start', 0, 100, { turn: 1, trigger: { kind: 'message', source: { kind: 'user' } } }),
      event('turn/end', 1, 200, { turn: 1, reason: { kind: 'completed' } }),
      event('subagent/descriptor', 2, 300, { version: 1, mode: 'continuable', provider: 'spawn', label: 'child' }),
    ])).toEqual(ZERO)
  })

  it('running bit: turn/start opens, turn/end closes, descriptor resets', () => {
    expect(fold([
      event('subagent/descriptor', 0, 0, { version: 1, mode: 'continuable', provider: 'spawn', label: 'child' }),
      event('turn/start', 1, 1, { turn: 1, trigger: { kind: 'message', source: { kind: 'user' } } }),
    ])).toEqual({ ...ZERO, running: true })
    expect(fold([
      event('subagent/descriptor', 0, 0, { version: 1, mode: 'continuable', provider: 'spawn', label: 'child' }),
      event('turn/start', 1, 1, { turn: 1, trigger: { kind: 'message', source: { kind: 'user' } } }),
      event('turn/end', 2, 2, { turn: 1, reason: { kind: 'completed' } }),
    ])).toEqual({ ...ZERO, turns: 1, lastTurnEnd: 'completed', running: false })
    // Seed 里的 pre-descriptor turn 不翻 running 位
    expect(fold([
      event('turn/start', 0, 100, { turn: 1, trigger: { kind: 'message', source: { kind: 'user' } } }),
      event('subagent/descriptor', 1, 200, { version: 1, mode: 'continuable', provider: 'spawn', label: 'child' }),
    ])).toEqual(ZERO)
  })

  it('counts an unknown merged turn-end kind without guessing its label', () => {
    expect(fold([
      event('subagent/descriptor', 0, 0, { version: 1, mode: 'continuable', provider: 'spawn', label: 'child' }),
      event('turn/end', 1, 1, {
        turn: 1,
        reason: { kind: 'future-variant' },
      }),
    ])).toEqual({ ...ZERO, turns: 1 })
  })
})
