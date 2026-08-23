import { describe, expect, it } from 'vitest'
import { validateTurnSnapshots } from '../src/invariant.ts'
import type { TurnCacheSnapshot } from '../src/diagnose.ts'

function snapshot(turn: number, cacheRead = 0, cacheWrite = 0, inputTokens = 0): TurnCacheSnapshot {
  return { turn, cacheRead, cacheWrite, inputTokens, outputTokens: 0 }
}

describe('validateTurnSnapshots', () => {
  it('accepts an empty fold', () => {
    expect(validateTurnSnapshots([])).toBeNull()
  })

  it('accepts a well-formed ascending fold', () => {
    expect(validateTurnSnapshots([snapshot(1), snapshot(2), snapshot(3)])).toBeNull()
  })

  it('rejects a descending turn sequence', () => {
    expect(validateTurnSnapshots([snapshot(2), snapshot(1)])).toContain('strictly turn-ascending')
  })

  it('rejects duplicate turns', () => {
    expect(validateTurnSnapshots([snapshot(1), snapshot(1)])).toContain('strictly turn-ascending')
  })

  it('rejects negative buckets', () => {
    expect(validateTurnSnapshots([snapshot(1, -5)])).toContain('negative bucket')
  })

  it('rejects a negative input bucket on a later turn', () => {
    expect(validateTurnSnapshots([snapshot(1), snapshot(2, 0, 0, -1)])).toContain('negative bucket')
  })
})
