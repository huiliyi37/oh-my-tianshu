import { describe, expect, it } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import type { TokenUsage } from '@huiliyi37/dsh-llm'
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
    message: { role: 'assistant', content: [], source: { kind: 'model', provider: 'mock', model: 'm' } },
    usage: u,
  }, { surfaceOp: 'append' })
}

function appendTurnBoundaries(session: Session, turn: number): void {
  session.append('turn/start', { turn })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
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
    // 2500 / 3200 = 0.78125
    expect(s.hitRate(session)).toBeCloseTo(2500 / 3200, 5)
    expect(s.recentHitRate(session, 1)).toBeCloseTo(1500 / 2000, 5)
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
    appendHeader(session, canonicalHeader({ config: { provider: 'mock', model: 'm', reasoningEffort: 'max' }, system: 'sys' }))
    appendUsage(session, 2, 1, usage(2000, 1000, 1000))

    const d = s.diagnose(session)!
    expect(d.reason).toBe('prefix_drift')
    expect(d.message).toContain('call config')
  })

  it('detects compaction from compact/start events after the last usage', () => {
    const s = service()
    const session = Session.create(SessionId('compact'))
    appendHeader(session, header('sys'))
    appendUsage(session, 1, 1, usage(1000, 500, 500))
    appendUsage(session, 2, 1, usage(2000, 1000, 1000))
    session.append('compact/start', {})
    appendTurnBoundaries(session, 2)

    const d = s.diagnose(session)!
    expect(d.reason).toBe('compaction')
  })

  it('updates incrementally as events are appended', () => {
    const s = service()
    const session = Session.create(SessionId('inc'))
    appendHeader(session, header('sys'))
    appendUsage(session, 1, 1, usage(1000, 800, 200))
    expect(s.turnHistory(session)).toHaveLength(1)

    appendUsage(session, 2, 1, usage(2000, 1500, 500))
    expect(s.turnHistory(session)).toHaveLength(2)
    expect(s.hitRate(session)).toBeCloseTo(2300 / 3000, 5)
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
