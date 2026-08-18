/**
 * The intent-bridge invariant companion: at most one handoff record per
 * session with a valid payload, and a carded first user message after a
 * handoff keeps a non-empty verbatim original — on live appends and on loaded
 * history at late registration.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import { createUserMessage } from '@huiliyi37/dsh-llm'
import SessionStore, { Session, SessionId, type SessionEvent } from '@huiliyi37/dsh-session'
import * as IntentBridgeInvariant from '../src/invariant.ts'
import InvariantService from '@huiliyi37/dsh-invariants'

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantService, { enabled: true })
  await ctx.plugin(IntentBridgeInvariant)
  return ctx
}

function handoffEvent(alignSessionId = 'session-a', reason = 'anchor'): SessionEvent {
  return {
    type: 'intent-bridge/handoff',
    seq: 0,
    time: 0,
    data: { alignSessionId, reason },
  } as SessionEvent
}

function cardedMessage(original: string): SessionEvent {
  return {
    type: 'user/message',
    seq: 1,
    time: 1,
    surfaceOp: 'append',
    data: createUserMessage({
      content: [{ type: 'text', text: `# 标题\n\n—— 原始请求 ——\n${original}` }],
      source: { kind: 'user' },
    }),
  } as SessionEvent
}

describe('intent-bridge stream invariants', () => {
  it('accepts a single handoff followed by a carded first message', async () => {
    const ctx = await setup()
    const session = Session.create(SessionId('ib-ok'))
    expect(() => {
      ctx.emit('session/event', session, handoffEvent())
      ctx.emit('session/event', session, cardedMessage('帮我重构 src/auth.ts'))
    }).not.toThrow()
  })

  it('rejects a second handoff record', async () => {
    const ctx = await setup()
    const session = Session.create(SessionId('ib-repeat'))
    ctx.emit('session/event', session, handoffEvent())
    expect(() => { ctx.emit('session/event', session, handoffEvent()) })
      .toThrow(/at most one handoff/)
  })

  it('rejects a handoff without an alignSessionId', async () => {
    const ctx = await setup()
    const session = Session.create(SessionId('ib-no-align'))
    expect(() => { ctx.emit('session/event', session, handoffEvent('')) })
      .toThrow(/alignSessionId/)
  })

  it('rejects a handoff with an unknown reason', async () => {
    const ctx = await setup()
    const session = Session.create(SessionId('ib-reason'))
    const event = handoffEvent()
    event.data = { alignSessionId: 'session-a', reason: 'because' }
    expect(() => { ctx.emit('session/event', session, event) })
      .toThrow(/known reason/)
  })

  it('rejects a carded message with an empty original after a handoff', async () => {
    const ctx = await setup()
    const session = Session.create(SessionId('ib-empty'))
    ctx.emit('session/event', session, handoffEvent())
    expect(() => { ctx.emit('session/event', session, cardedMessage('')) })
      .toThrow(/non-empty verbatim original/)
  })

  it('ignores unrelated session events', async () => {
    const ctx = await setup()
    const session = Session.create(SessionId('ib-unrelated'))
    expect(() => {
      ctx.emit('session/event', session, {
        type: 'turn/start', seq: 0, time: 0, data: { turn: 1 },
      } as SessionEvent)
    }).not.toThrow()
  })

  it('rejects invalid existing state on late registration', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create()
    session.append('intent-bridge/handoff', { alignSessionId: '', reason: 'anchor' })
    await ctx.plugin(InvariantService, { enabled: true })

    await expect(ctx.plugin(IntentBridgeInvariant).then(() => undefined)).rejects.toThrow(/alignSessionId/)
  })

  it('replays valid existing state and keeps constraining later appends', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create()
    session.append('intent-bridge/handoff', { alignSessionId: 'session-a', reason: 'anchor' })
    await ctx.plugin(InvariantService, { enabled: true })
    await ctx.plugin(IntentBridgeInvariant)

    expect(() => {
      session.append('intent-bridge/handoff', { alignSessionId: 'session-b', reason: 'anchor' })
    }).toThrow(/at most one handoff/)
  })
})
