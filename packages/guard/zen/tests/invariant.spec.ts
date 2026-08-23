/**
 * The zen-invariant companion: payload shape and the once-armed forward-only
 * sequence, on live appends and on loaded history at late registration.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import SessionStore, { Session, SessionId, type SessionEvent } from '@huiliyi37/dsh-session'
import * as ZenInvariant from '@huiliyi37/dsh-zen/invariant'
import InvariantService from '@huiliyi37/dsh-invariants'

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantService, { enabled: true })
  await ctx.plugin(ZenInvariant)
  return ctx
}

function event(data: unknown, seq = 0): SessionEvent {
  return { type: 'zen/phase', seq, time: seq, data } as SessionEvent
}

describe('zen-phase stream invariants', () => {
  it('accepts the armed → promoted sequence', async () => {
    const ctx = await setup()
    const session = Session.create(SessionId('zen-ok'))
    expect(() => {
      ctx.emit('session/event', session, event({ phase: 'zen', reason: 'arm' }, 0))
      ctx.emit('session/event', session, event({ phase: 'full', reason: 'anchor' }, 1))
    }).not.toThrow()
  })

  it.each([
    [{ phase: 'zen', reason: 'anchor' }, /must carry reason 'arm'/],
    [{ phase: 'full', reason: 'arm' }, /must carry a promotion reason/],
    [{ phase: 'full', reason: 'because' }, /must carry a promotion reason/],
    [{ phase: 'sideways', reason: 'arm' }, /invalid phase/],
    [{}, /invalid phase/],
  ])('rejects malformed payload %j', async (data, pattern) => {
    const ctx = await setup()
    const session = Session.create(SessionId(`zen-bad-${JSON.stringify(data)}`))
    expect(() => { ctx.emit('session/event', session, event(data)) }).toThrow(pattern)
  })

  it('rejects a second arm and a repeated promotion', async () => {
    const ctx = await setup()
    const rearm = Session.create(SessionId('zen-rearm'))
    ctx.emit('session/event', rearm, event({ phase: 'zen', reason: 'arm' }, 0))
    expect(() => { ctx.emit('session/event', rearm, event({ phase: 'zen', reason: 'arm' }, 1)) })
      .toThrow(/arms at most once/)

    const repeat = Session.create(SessionId('zen-repeat'))
    ctx.emit('session/event', repeat, event({ phase: 'zen', reason: 'arm' }, 0))
    ctx.emit('session/event', repeat, event({ phase: 'full', reason: 'timeout' }, 1))
    expect(() => { ctx.emit('session/event', repeat, event({ phase: 'full', reason: 'timeout' }, 2)) })
      .toThrow(/after 'full'/)
  })

  it('rejects a promotion on a never-armed session', async () => {
    const ctx = await setup()
    const session = Session.create(SessionId('zen-unarmed'))
    expect(() => { ctx.emit('session/event', session, event({ phase: 'full', reason: 'triage' })) })
      .toThrow(/without a prior 'zen'/)
  })

  it('rejects invalid existing state on late registration', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create()
    session.append('zen/phase', { phase: 'zen', reason: 'anchor' })
    await ctx.plugin(InvariantService, { enabled: true })

    await expect(ctx.plugin(ZenInvariant).then(() => undefined)).rejects.toThrow(/must carry reason 'arm'/)
  })

  it('replays valid existing state and keeps constraining later appends', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create()
    session.append('zen/phase', { phase: 'zen', reason: 'arm' })
    await ctx.plugin(InvariantService, { enabled: true })
    await ctx.plugin(ZenInvariant)

    expect(() => { session.append('zen/phase', { phase: 'zen', reason: 'arm' }) })
      .toThrow(/arms at most once/)
  })

  it('ignores unrelated dispatches and session events', async () => {
    const ctx = await setup()
    const session = Session.create(SessionId('zen-unrelated'))
    expect(() => {
      ctx.emit('tools/change')
      ctx.emit('session/event', session, {
        type: 'turn/start', seq: 0, time: 0, data: { turn: 1 },
      })
    }).not.toThrow()
  })
})
