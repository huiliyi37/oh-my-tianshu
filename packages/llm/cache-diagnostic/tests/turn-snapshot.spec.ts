import { describe, expect, it } from 'vitest'
import type { TokenUsage } from '@huiliyi37/dsh-llm'
import type { SessionEvent } from '@huiliyi37/dsh-session'
import { foldTurnSnapshots } from '../src/turn-snapshot.ts'

function usage(input: number, cacheRead: number, cacheWrite: number, output = 0): TokenUsage {
  return { inputTokens: input, outputTokens: output, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite }
}

function assistantMessage(turn: number, step: number, usage?: TokenUsage): SessionEvent<'assistant/message'> {
  return {
    type: 'assistant/message',
    seq: turn * 10 + step,
    time: turn * 100 + step,
    data: { turn, step, message: { role: 'assistant', content: [], source: { kind: 'model', provider: 'mock', model: 'm' } }, ...usage === undefined ? {} : { usage } },
  }
}

describe('foldTurnSnapshots', () => {
  it('returns an empty list for an empty log', () => {
    expect(foldTurnSnapshots([])).toEqual([])
  })

  it('aggregates one turn with a single usage', () => {
    const events = [assistantMessage(1, 1, usage(1200, 1000, 200))]
    expect(foldTurnSnapshots(events)).toEqual([
      { turn: 1, cacheRead: 1000, cacheWrite: 200, inputTokens: 1200, outputTokens: 0 },
    ])
  })

  it('accumulates multiple steps of the same turn into one snapshot', () => {
    const events = [
      assistantMessage(1, 1, usage(1000, 900, 100)),
      assistantMessage(1, 2, usage(500, 400, 100)),
    ]
    expect(foldTurnSnapshots(events)).toEqual([
      { turn: 1, cacheRead: 1300, cacheWrite: 200, inputTokens: 1500, outputTokens: 0 },
    ])
  })

  it('emits one snapshot per turn in chronological order', () => {
    const events = [
      assistantMessage(1, 1, usage(1000, 900, 100)),
      assistantMessage(3, 1, usage(2000, 1500, 500)),
      assistantMessage(2, 1, usage(300, 200, 100)),
    ]
    const snapshots = foldTurnSnapshots(events)
    expect(snapshots.map(s => s.turn)).toEqual([1, 2, 3])
  })

  it('skips assistant messages without usage', () => {
    const events = [
      assistantMessage(1, 1),
      assistantMessage(1, 2, usage(1000, 900, 100)),
    ]
    expect(foldTurnSnapshots(events)).toEqual([
      { turn: 1, cacheRead: 900, cacheWrite: 100, inputTokens: 1000, outputTokens: 0 },
    ])
  })

  it('ignores non-usage events (headers, turn boundaries, tool results)', () => {
    const events: SessionEvent[] = [
      { type: 'request/header', seq: 1, time: 1, data: { header: { config: { provider: 'mock', model: 'm' } }, reason: 'initial' } },
      { type: 'turn/start', seq: 2, time: 2, data: { turn: 1 } },
      assistantMessage(1, 1, usage(1000, 900, 100)),
      { type: 'turn/end', seq: 4, time: 4, data: { turn: 1, reason: { kind: 'completed' } } },
    ]
    expect(foldTurnSnapshots(events)).toEqual([
      { turn: 1, cacheRead: 900, cacheWrite: 100, inputTokens: 1000, outputTokens: 0 },
    ])
  })

  it('treats optional cache fields as zero when absent', () => {
    const events = [assistantMessage(1, 1, { inputTokens: 500, outputTokens: 100 })]
    expect(foldTurnSnapshots(events)).toEqual([
      { turn: 1, cacheRead: 0, cacheWrite: 0, inputTokens: 500, outputTokens: 100 },
    ])
  })
})
