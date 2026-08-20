/**
 * The agent-router invariant companion: router/route records carry a valid
 * payload (known profile, non-empty task, string-array targets, non-empty
 * subagentSessionId) and — when the routed child is live — lineage
 * consistency (the record's session is the child's parent) — on live appends
 * and on loaded history at late registration.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import SessionStore, { Session, SessionId, type SessionEvent } from '@huiliyi37/dsh-session'
import * as AgentRouterInvariant from '../src/invariant.ts'
import InvariantService from '@huiliyi37/dsh-invariants'
import type {} from '../src/index.ts' // 'router/route' 事件声明合并

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantService, { enabled: true })
  await ctx.plugin(AgentRouterInvariant)
  return ctx
}

function routeEvent(overrides: Record<string, unknown> = {}): SessionEvent {
  return {
    type: 'router/route',
    seq: 0,
    time: 0,
    data: {
      profile: 'verifier',
      task: '独立复核「claim」',
      targets: ['src/a.ts'],
      subagentSessionId: 'child-1',
      ...overrides,
    },
  } as SessionEvent
}

describe('agent-router route-record invariants', () => {
  it('accepts a well-formed record whose live child names this session as parent', async () => {
    const ctx = await setup()
    const parent = Session.create(SessionId('parent-1'))
    ctx.sessions.create(SessionId('child-1'), { meta: { parentSession: SessionId('parent-1') } })
    expect(() => { ctx.emit('session/event', parent, routeEvent()) }).not.toThrow()
  })

  it('accepts a shape-valid record when the child is not live (shape-only downgrade)', async () => {
    const ctx = await setup()
    const parent = Session.create(SessionId('parent-1'))
    expect(() => { ctx.emit('session/event', parent, routeEvent()) }).not.toThrow()
  })

  it('rejects an unknown profile', async () => {
    const ctx = await setup()
    const parent = Session.create(SessionId('parent-1'))
    expect(() => { ctx.emit('session/event', parent, routeEvent({ profile: 'hacker' })) })
      .toThrow(/known profile/)
  })

  it('rejects an empty task', async () => {
    const ctx = await setup()
    const parent = Session.create(SessionId('parent-1'))
    expect(() => { ctx.emit('session/event', parent, routeEvent({ task: '' })) })
      .toThrow(/non-empty task/)
  })

  it('rejects non-string-array targets', async () => {
    const ctx = await setup()
    const parent = Session.create(SessionId('parent-1'))
    expect(() => { ctx.emit('session/event', parent, routeEvent({ targets: 'src/a.ts' })) })
      .toThrow(/string-array targets/)
  })

  it('rejects an empty subagentSessionId', async () => {
    const ctx = await setup()
    const parent = Session.create(SessionId('parent-1'))
    expect(() => { ctx.emit('session/event', parent, routeEvent({ subagentSessionId: '' })) })
      .toThrow(/non-empty subagentSessionId/)
  })

  it('rejects a lineage mismatch when the child is live with another parent', async () => {
    const ctx = await setup()
    const parent = Session.create(SessionId('parent-1'))
    ctx.sessions.create(SessionId('child-1'), { meta: { parentSession: SessionId('parent-2') } })
    expect(() => { ctx.emit('session/event', parent, routeEvent()) })
      .toThrow(/parentSession/)
  })

  it('ignores unrelated session events', async () => {
    const ctx = await setup()
    const parent = Session.create(SessionId('parent-1'))
    expect(() => {
      ctx.emit('session/event', parent, { type: 'turn/start', seq: 0, time: 0, data: { turn: 1 } } as SessionEvent)
    }).not.toThrow()
  })

  it('rejects invalid existing state on late registration', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create()
    // 非法 payload 刻意违反声明类型（不变量测试的职责）；as never 命名该偏差。
    session.append('router/route', { profile: 'hacker', task: 't', targets: [], subagentSessionId: 'x' } as never)
    await ctx.plugin(InvariantService, { enabled: true })

    await expect(ctx.plugin(AgentRouterInvariant).then(() => undefined)).rejects.toThrow(/known profile/)
  })

  it('replays valid existing state and keeps constraining later appends', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create()
    session.append('router/route', { profile: 'verifier', task: 't', targets: [], subagentSessionId: 'child-9' })
    await ctx.plugin(InvariantService, { enabled: true })
    await ctx.plugin(AgentRouterInvariant)

    expect(() => {
      // 非法 payload 刻意违反声明类型（不变量测试的职责）；as never 命名该偏差。
      session.append('router/route', { profile: 'hacker', task: 't', targets: [], subagentSessionId: 'x' } as never)
    }).toThrow(/known profile/)
  })
})
