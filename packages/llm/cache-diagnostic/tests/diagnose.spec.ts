import { describe, expect, it } from 'vitest'
import { diagnoseCacheMiss } from '../src/diagnose.ts'
import type { TurnCacheSnapshot } from '../src/diagnose.ts'

function turn(
  index: number,
  cacheRead: number,
  cacheWrite: number,
  inputTokens: number,
  outputTokens = 0,
): TurnCacheSnapshot {
  return { turn: index, cacheRead, cacheWrite, inputTokens, outputTokens }
}

/** A normal growing conversation: cacheRead monotonically climbs. */
function growingHistory(): TurnCacheSnapshot[] {
  return [
    turn(1, 0, 1200, 1200),
    turn(2, 1200, 200, 1400),
    turn(3, 1400, 400, 1800),
    turn(4, 1800, 300, 2100),
  ]
}

describe('diagnoseCacheMiss', () => {
  it('returns null for an empty history', () => {
    expect(diagnoseCacheMiss([], 1, null, false)).toBeNull()
  })

  it('returns null when the provider reported no cache counters at all', () => {
    const history = [turn(1, 0, 0, 500)]
    expect(diagnoseCacheMiss(history, 1, null, false)).toBeNull()
  })

  it('labels the first turn as first_turn', () => {
    const history = [turn(1, 0, 1200, 1200)]
    const d = diagnoseCacheMiss(history, 1, null, false)!
    expect(d.reason).toBe('first_turn')
    expect(d.severity).toBe('info')
    expect(d.turnHitRate).toBe(0)
  })

  it('returns null when the turn hit rate is high (>= 0.8)', () => {
    const history = [turn(1, 0, 1000, 1000), turn(2, 900, 100, 1000)]
    expect(diagnoseCacheMiss(history, 2, null, false)).toBeNull()
  })

  it('attributes prefix_drift when a drift event is present', () => {
    // Hit rate 0.5 (< 0.8) so the drift branch is reachable.
    const history = [
      turn(1, 0, 1000, 1000),
      turn(2, 1000, 1000, 2000),
    ]
    const drift = { systemChanged: true, toolsChanged: false, configChanged: false, message: 'Prefix cache drift detected: system prompt changed' }
    const d = diagnoseCacheMiss(history, 2, drift, false)!
    expect(d.reason).toBe('prefix_drift')
    expect(d.severity).toBe('error')
    expect(d.message).toContain('system prompt')
  })

  it('attributes compaction when it ran this turn', () => {
    // Hit rate 0.5 (< 0.8) so the compaction branch is reachable.
    const history = [
      turn(1, 0, 1000, 1000),
      turn(2, 1000, 1000, 2000),
    ]
    const d = diagnoseCacheMiss(history, 2, null, true)!
    expect(d.reason).toBe('compaction')
    expect(d.severity).toBe('warn')
  })

  it('detects prefix_truncation when cacheRead REGRESSES (the 8396ac51 class)', () => {
    // A mid-history divergence: cacheRead drops from 30K to 2K while the
    // conversation only grew — previously mislabeled normal_growth, hiding
    // ~30K-token rebuild events (upstream opencode-tui investigation).
    // The final turn's hit rate stays below 0.8 so truncation (not the
    // high-hit-rate short-circuit) is the branch under test.
    const history = [
      turn(1, 0, 2000, 2000),
      turn(2, 2000, 300, 2300),
      turn(3, 30000, 500, 30500),
      turn(4, 2000, 4000, 6000),
    ]
    const d = diagnoseCacheMiss(history, 4, null, false)!
    expect(d.reason).toBe('prefix_truncation')
    expect(d.severity).toBe('error')
    expect(d.message).toContain('28000')
    expect(d.message).toContain('30000')
  })

  it('does NOT flag prefix_truncation for ordinary monotonic growth', () => {
    const history = growingHistory()
    const d = diagnoseCacheMiss(history, 4, null, false)!
    // Hit rate stays high enough to be unexplained? No: hitRate is 1800/2100
    // = 0.857 >= 0.8, so no diagnosis at all.
    expect(d).toBeNull()
  })

  it('attributes cache_eviction for a low hit rate with no other cause', () => {
    // cacheRead keeps climbing (no regression), but the hit rate drops below
    // 0.4 — eviction, not truncation.
    const history = [
      turn(1, 0, 1000, 1000),
      turn(2, 1000, 200, 1200),
      turn(3, 1500, 2500, 4000),
    ]
    const d = diagnoseCacheMiss(history, 3, null, false)!
    expect(d.reason).toBe('cache_eviction')
    expect(d.severity).toBe('warn')
  })

  it('falls back to normal_growth for a moderate miss', () => {
    // Hit rate 0.5: below 0.8, above 0.4, no drift/compaction/regression.
    const history = [
      turn(1, 0, 1000, 1000),
      turn(2, 1000, 1000, 2000),
    ]
    const d = diagnoseCacheMiss(history, 2, null, false)!
    expect(d.reason).toBe('normal_growth')
    expect(d.severity).toBe('info')
  })

  it('reports the turn hit rate on every diagnosis', () => {
    const history = [turn(1, 0, 1000, 1000), turn(2, 1000, 1000, 2000)]
    const d = diagnoseCacheMiss(history, 2, null, false)!
    expect(d.turnHitRate).toBeCloseTo(0.5, 5)
  })
})
