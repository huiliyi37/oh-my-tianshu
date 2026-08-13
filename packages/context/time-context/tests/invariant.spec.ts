import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import * as TimeInvariant from '@deepseek-ai/dsh-time-context/invariant'
import InvariantService from '@deepseek-ai/dsh-invariants'

const SECOND = Date.parse('2026-07-14T00:00:00Z')

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantService, { enabled: true })
  await ctx.plugin(TimeInvariant)
  return ctx
}

function event(
  text: string,
  time = SECOND + 456,
  content?: unknown[],
  plugin = 'time-context',
): SessionEvent<'user/message'> {
  return {
    type: 'user/message',
    seq: 0,
    time,
    data: createUserMessage({
      content: (content ?? [{ type: 'text', text }]) as ContentBlock[],
      source: { kind: 'plugin', plugin },
    }),
  }
}

function reading(
  turn = '1',
  step = '1',
  baseline = 'model-visible message',
  timestamp = '2026-07-14T00:00:00+00:00[UTC]',
): string {
  return `Time sampled while preparing turn ${turn}, step ${step}: ${timestamp}\n`
    + `Elapsed since the preceding ${baseline}: unavailable.`
}

function preparing(turn: number, step: number): Session {
  const session = Session.create(SessionId(`time-invariant-${turn}-${step}`))
  for (let priorTurn = 1; priorTurn < turn; priorTurn += 1) {
    session.append('turn/start', { turn: priorTurn })
    session.append('turn/end', { turn: priorTurn, reason: { kind: 'completed' } })
  }
  session.append('turn/start', { turn })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: `turn ${turn}` }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  for (let priorStep = 1; priorStep < step; priorStep += 1) {
    session.append('step/start', { turn, step: priorStep })
    session.append('step/end', { turn, step: priorStep })
  }
  session.append('step/start', { turn, step })
  return session
}

function appendReading(session: Session, text: string): void {
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: 'time-context' },
  }), { surfaceOp: 'append' })
}

describe('time-context invariants', () => {
  it('accepts a reading whose turn, step, baseline, and timestamp agree', async () => {
    const ctx = await setup()
    const text = 'Time sampled while preparing turn 2, step 3: 2026-07-14T00:00:00+00:00[UTC]\n'
      + 'Elapsed since the preceding step context: 4m 2s.'
    expect(() => { ctx.emit('session/event', preparing(2, 3), event(text)) }).not.toThrow()
  })

  it('accepts a reading durably appended after a long process pause', async () => {
    const ctx = await setup()
    expect(() => {
      ctx.emit('session/event', preparing(1, 1), event(reading(), SECOND + 60_000))
    }).not.toThrow()
  })

  it('validates each existing reading against its preceding durable prefix', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('time-invariant-late-valid'))
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'prepare' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    appendReading(session, reading())

    await ctx.plugin(InvariantService, { enabled: true })
    await expect(ctx.plugin(TimeInvariant)).resolves.toBeDefined()
  })

  it('rejects an invalid existing reading on late registration', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('time-invariant-late-invalid'))
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'prepare' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    appendReading(session, reading('1', '2', 'step context'))

    await ctx.plugin(InvariantService, { enabled: true })
    await expect(ctx.plugin(TimeInvariant).then(() => undefined)).rejects.toThrow(/expected turn 1\/step 1/)
  })

  it.each([
    [reading('1', '3', 'step context'), /expected turn 2\/step 3/],
    [reading('2', '2', 'step context'), /expected turn 2\/step 3/],
  ])('rejects a reading that disagrees with its session position', async (text, message) => {
    const ctx = await setup()
    expect(() => { ctx.emit('session/event', preparing(2, 3), event(text)) }).toThrow(message)
  })

  it('rejects a reading after cancellation closes the turn', async () => {
    const ctx = await setup()
    const session = preparing(1, 2)
    session.append('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } })
    expect(() => { ctx.emit('session/event', session, event(reading('1', '2', 'step context'))) })
      .toThrow(/at a prompt boundary/)
  })

  it('rejects a reading outside a prompt boundary', async () => {
    const ctx = await setup()
    const ended = preparing(1, 1)
    ended.append('step/end', { turn: 1, step: 1 })
    expect(() => { ctx.emit('session/event', ended, event(reading())) }).toThrow(/at a prompt boundary/)
    const notEntered = Session.create(SessionId('time-invariant-turn-only'))
    notEntered.append('turn/start', { turn: 1 })
    expect(() => { ctx.emit('session/event', notEntered, event(reading())) }).toThrow(/at a prompt boundary/)
    expect(() => {
      ctx.emit('session/event', Session.create(SessionId('time-invariant-empty')), event(reading()))
    }).toThrow(/at a prompt boundary/)
  })

  it.each([
    ['not a reading', SECOND, undefined, /durable reading format/],
    [reading('0'), SECOND, undefined, /positive safe integers/],
    [reading('999999999999999999999'), SECOND, undefined, /positive safe integers/],
    [reading('1', '0', 'step context'), SECOND, undefined, /positive safe integers/],
    [reading('1', '999999999999999999999', 'step context'), SECOND, undefined, /positive safe integers/],
    [reading('1', '1', 'step context'), SECOND, undefined, /wrong elapsed-time baseline/],
    [reading('1', '2', 'model-visible message'), SECOND, undefined, /wrong elapsed-time baseline/],
    [reading('1', '1', 'model-visible message', '2026-99-99T00:00:00+00:00[UTC]'), SECOND, undefined, /must parse and not postdate/],
    [reading(), Number.NaN, undefined, /must parse and not postdate/],
    [reading(), SECOND - 1, undefined, /must parse and not postdate/],
    ['ignored', SECOND, [], /exactly one text block/],
    ['ignored', SECOND, [{ type: 'image', data: 'x', mimeType: 'image/png' }], /exactly one text block/],
    ['ignored', SECOND, [{ type: 'text', text: 'one' }, { type: 'text', text: 'two' }], /exactly one text block/],
  ] as const)('rejects an incoherent durable reading', async (text, time, content, message) => {
    const ctx = await setup()
    const preparationStep = text.includes('turn 1, step 2:') ? 2 : 1
    expect(() => {
      ctx.emit('session/event', preparing(1, preparationStep), event(
        text,
        time,
        content === undefined ? undefined : [...content],
      ))
    }).toThrow(message)
  })

  it('ignores context messages owned by another package', async () => {
    const ctx = await setup()
    const other = event('unrelated', SECOND + 456, undefined, 'other')
    expect(() => { ctx.emit('session/event', preparing(1, 1), other) }).not.toThrow()
    const user: SessionEvent<'user/message'> = {
      ...event('unrelated'),
      data: createUserMessage({
        content: [{ type: 'text', text: 'unrelated' }],
        source: { kind: 'user' },
      }),
    }
    expect(() => { ctx.emit('session/event', preparing(1, 1), user) }).not.toThrow()
    expect(() => {
      ctx.emit('session/event', preparing(1, 1), {
        type: 'turn/start', seq: 0, time: 0, data: { turn: 1 },
      })
      ctx.emit('tools/change')
    }).not.toThrow()
  })
})
