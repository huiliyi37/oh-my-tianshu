/**
 * The task-card invariant companion: a carded user/message keeps a non-empty
 * verbatim original under the marker, keeps source.kind 'user', is the FIRST
 * user message of its session, and appears at most once — on live appends and
 * on loaded history at late registration.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import { createUserMessage } from '@huiliyi37/dsh-llm'
import SessionStore, { Session, SessionId, type SessionEvent } from '@huiliyi37/dsh-session'
import * as TaskCardInvariant from '@huiliyi37/dsh-task-card/invariant'
import InvariantService from '@huiliyi37/dsh-invariants'

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantService, { enabled: true })
  await ctx.plugin(TaskCardInvariant)
  return ctx
}

function cardedMessage(original: string | undefined): SessionEvent {
  const text = original === undefined
    ? '# 标题\n\n## 目标\n目标\n\n—— 原始请求 ——\n'
    : `# 标题\n\n## 目标\n目标\n\n—— 原始请求 ——\n${original}`
  return {
    type: 'user/message',
    seq: 0,
    time: 0,
    data: createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }),
  } as SessionEvent
}

function plainMessage(text = 'plain'): SessionEvent {
  return {
    type: 'user/message',
    seq: 0,
    time: 0,
    data: createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }),
  } as SessionEvent
}

describe('task-card stream invariants', () => {
  it('accepts a first carded message with a verbatim original', async () => {
    const ctx = await setup()
    const session = Session.create(SessionId('tc-ok'))
    expect(() => {
      ctx.emit('session/event', session, cardedMessage('帮我重构 src/auth.ts'))
    }).not.toThrow()
  })

  it('rejects a carded message whose original section is empty', async () => {
    const ctx = await setup()
    const session = Session.create(SessionId('tc-empty-original'))
    expect(() => { ctx.emit('session/event', session, cardedMessage(undefined)) })
      .toThrow(/non-empty verbatim original/)
  })

  it('rejects a carded message whose source is not user', async () => {
    const ctx = await setup()
    const session = Session.create(SessionId('tc-plugin-source'))
    const event = cardedMessage('原文')
    event.data = createUserMessage({
      content: [{ type: 'text', text: '# 标题\n\n—— 原始请求 ——\n原文' }],
      source: { kind: 'plugin', plugin: 'dsh-task-card' },
    })
    expect(() => { ctx.emit('session/event', session, event) })
      .toThrow(/source.kind 'user'/)
  })

  it('rejects a carded message that is not the first user message', async () => {
    const ctx = await setup()
    const session = Session.create(SessionId('tc-second'))
    ctx.emit('session/event', session, plainMessage('earlier'))
    expect(() => { ctx.emit('session/event', session, cardedMessage('原文')) })
      .toThrow(/first-message-only/)
  })

  it('rejects a second carded message (the first-message-only rule subsumes repeats)', async () => {
    const ctx = await setup()
    const session = Session.create(SessionId('tc-repeat'))
    ctx.emit('session/event', session, cardedMessage('原文一'))
    expect(() => { ctx.emit('session/event', session, cardedMessage('原文二')) })
      .toThrow(/first-message-only/)
  })

  it('ignores unrelated session events', async () => {
    const ctx = await setup()
    const session = Session.create(SessionId('tc-unrelated'))
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
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '# 标题\n\n—— 原始请求 ——\n' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    await ctx.plugin(InvariantService, { enabled: true })

    await expect(ctx.plugin(TaskCardInvariant).then(() => undefined)).rejects.toThrow(/non-empty verbatim original/)
  })

  it('replays valid existing state and keeps constraining later appends', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create()
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '# 标题\n\n## 目标\n目标\n\n—— 原始请求 ——\n原文' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    await ctx.plugin(InvariantService, { enabled: true })
    await ctx.plugin(TaskCardInvariant)

    expect(() => {
      session.append('user/message', createUserMessage({
        content: [{ type: 'text', text: '# 标题二\n\n—— 原始请求 ——\n原文二' }],
        source: { kind: 'user' },
      }), { surfaceOp: 'append' })
    }).toThrow(/first-message-only/)
  })
})
