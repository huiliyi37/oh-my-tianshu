import { describe, expect, it } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import { createAssistantMessage, ReasoningEffortId } from '@huiliyi37/dsh-llm'
import type { TokenUsage } from '@huiliyi37/dsh-llm'
import { CompactionId } from '@huiliyi37/dsh-compact'
import { Session, SessionId, canonicalHeader } from '@huiliyi37/dsh-session'
import type { EpochHeader } from '@huiliyi37/dsh-session'
import CacheDiagnosticService from '../src/index.ts'

function header(system: string, extras: Omit<EpochHeader, 'config' | 'system'> = {}): EpochHeader {
  return canonicalHeader({
    config: { provider: 'mock', model: 'm' },
    system,
    ...extras,
  })
}

/** TokenUsage buckets are disjoint: input = uncached share, then cacheRead, cacheWrite. */
function usage(input: number, cacheRead: number, cacheWrite: number, output = 0): TokenUsage {
  return { inputTokens: input, outputTokens: output, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite }
}

function appendHeader(session: Session, value: EpochHeader): void {
  session.append('request/header', { header: value, reason: 'initial' })
}

function appendUsage(session: Session, turn: number, step: number, u: TokenUsage): void {
  session.append('assistant/message', {
    turn,
    step,
    message: createAssistantMessage({ content: [], source: { provider: 'mock', model: 'm' } }),
    usage: u,
  }, { surfaceOp: 'append' })
}

function appendTurnBoundaries(session: Session, turn: number): void {
  session.append('turn/start', { turn })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
}

/** A standalone manual compaction marker between turns. */
function appendCompactStart(session: Session): void {
  session.append('compact/start', { compactionId: CompactionId('c1'), turn: null })
}

function service(): CacheDiagnosticService {
  return new CacheDiagnosticService(new Context())
}

describe('CacheDiagnosticService', () => {
  it('reports nothing for an empty session', () => {
    const s = service()
    const session = Session.create(SessionId('empty'))
    expect(s.diagnose(session)).toBeNull()
    expect(s.turnHistory(session)).toEqual([])
    expect(s.hitRate(session)).toBeNull()
    expect(s.recentHitRate(session, 5)).toBeNull()
  })

  it('folds turn history from usage events and computes the cumulative hit rate', () => {
    const s = service()
    const session = Session.create(SessionId('h1'))
    appendHeader(session, header('sys'))
    appendUsage(session, 1, 1, usage(1200, 1000, 200))
    appendUsage(session, 2, 1, usage(2000, 1500, 500))
    appendTurnBoundaries(session, 2)

    const history = s.turnHistory(session)
    expect(history).toEqual([
      { turn: 1, cacheRead: 1000, cacheWrite: 200, inputTokens: 1200, outputTokens: 0 },
      { turn: 2, cacheRead: 1500, cacheWrite: 500, inputTokens: 2000, outputTokens: 0 },
    ])
    // Disjoint math: 2500 cached over (2400 + 4000) billed input.
    expect(s.hitRate(session)).toBeCloseTo(2500 / 6400, 5)
    expect(s.recentHitRate(session, 1)).toBeCloseTo(1500 / 4000, 5)
  })

  it('stays exact for a provider that never reports write tokens (DeepSeek shape)', () => {
    const s = service()
    const session = Session.create(SessionId('deepseek'))
    appendHeader(session, header('sys'))
    appendUsage(session, 1, 1, usage(7000, 0, 0))
    appendUsage(session, 2, 1, usage(3400, 7000, 0))
    appendUsage(session, 3, 1, usage(2000, 10000, 0))

    // Cumulative: 17000 cached over (7000 + 10400 + 12000) billed input.
    expect(s.hitRate(session)).toBeCloseTo(17000 / 29400, 5)
    // Per-turn: 10000 / 12000 — counter-only math would degenerate to 100%.
    expect(s.recentHitRate(session, 1)).toBeCloseTo(10000 / 12000, 5)
  })

  it('reports the first turn even when no cache counters exist yet', () => {
    const s = service()
    const session = Session.create(SessionId('first'))
    appendHeader(session, header('sys'))
    appendUsage(session, 1, 1, usage(7000, 0, 0))

    const d = s.diagnose(session)!
    expect(d.reason).toBe('first_turn')
    expect(d.severity).toBe('info')
  })

  it('attributes prefix_drift when the system prompt changes across headers', () => {
    const s = service()
    const session = Session.create(SessionId('drift'))
    appendHeader(session, header('first system'))
    appendUsage(session, 1, 1, usage(1000, 500, 500))
    appendHeader(session, header('second system, different bytes'))
    appendUsage(session, 2, 1, usage(2000, 1000, 1000))

    const d = s.diagnose(session)!
    expect(d.reason).toBe('prefix_drift')
    expect(d.severity).toBe('error')
  })

  it('attributes a header config change as drift (config is a fingerprint source)', () => {
    const s = service()
    const session = Session.create(SessionId('cfg'))
    appendHeader(session, header('sys'))
    appendUsage(session, 1, 1, usage(1000, 500, 500))
    appendHeader(session, canonicalHeader({ config: { provider: 'mock', model: 'm', reasoningEffort: ReasoningEffortId('max') }, system: 'sys' }))
    appendUsage(session, 2, 1, usage(2000, 1000, 1000))

    const d = s.diagnose(session)!
    expect(d.reason).toBe('prefix_drift')
    expect(d.message).toContain('call config')
  })

  it('attributes the first turn after compaction to compaction', () => {
    const s = service()
    const session = Session.create(SessionId('compact'))
    appendHeader(session, header('sys'))
    appendUsage(session, 1, 1, usage(200, 900, 0))
    appendCompactStart(session)
    // The turn measured after compaction pays the restructured history.
    appendUsage(session, 2, 1, usage(9000, 3000, 0))
    appendTurnBoundaries(session, 2)

    const d = s.diagnose(session)!
    expect(d.reason).toBe('compaction')
    expect(d.severity).toBe('warn')
  })

  it('does not blame compaction on a turn measured before it started', () => {
    const s = service()
    const session = Session.create(SessionId('compact-late'))
    appendHeader(session, header('sys'))
    appendUsage(session, 1, 1, usage(200, 900, 0))
    appendUsage(session, 2, 1, usage(200, 920, 0))
    // Compaction lands after the latest usage: no measured turn is affected yet.
    appendCompactStart(session)

    expect(s.diagnose(session)).toBeNull()
  })

  it('stops attributing compaction once the following turn is measured', () => {
    const s = service()
    const session = Session.create(SessionId('compact-window'))
    appendHeader(session, header('sys'))
    appendUsage(session, 1, 1, usage(200, 900, 0))
    appendCompactStart(session)
    appendUsage(session, 2, 1, usage(9000, 3000, 0))
    expect(s.diagnose(session)!.reason).toBe('compaction')

    // The next healthy turn is outside the compaction's window.
    appendUsage(session, 3, 1, usage(300, 11800, 0))
    expect(s.diagnose(session)).toBeNull()
  })

  it('updates incrementally as events are appended', () => {
    const s = service()
    const session = Session.create(SessionId('inc'))
    appendHeader(session, header('sys'))
    appendUsage(session, 1, 1, usage(1000, 800, 200))
    expect(s.turnHistory(session)).toHaveLength(1)

    appendUsage(session, 2, 1, usage(2000, 1500, 500))
    expect(s.turnHistory(session)).toHaveLength(2)
    expect(s.hitRate(session)).toBeCloseTo(2300 / 6000, 5)
  })

  it('accepts an explicit drift/wasCompacted override for callers that know better', () => {
    const s = service()
    const session = Session.create(SessionId('override'))
    appendHeader(session, header('sys'))
    appendUsage(session, 1, 1, usage(1000, 500, 500))
    appendUsage(session, 2, 1, usage(2000, 1000, 1000))

    const drift = { systemChanged: true, toolsChanged: false, configChanged: false, message: 'Prefix cache drift detected: system prompt changed' }
    expect(s.diagnose(session, { drift, wasCompacted: false })!.reason).toBe('prefix_drift')
    expect(s.diagnose(session, { drift: null, wasCompacted: true })!.reason).toBe('compaction')
  })
})
