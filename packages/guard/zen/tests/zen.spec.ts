/**
 * Pure-function behavior of the zen package: config validation fails loud on
 * every malformed field, the phase fold is last-wins over any prefix, and the
 * anchor-evidence predicate counts only successful non-bookkeeping results.
 */

import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@huiliyi37/dsh-session'
import { foldZenPhase, hasAnchorEvidence, resolveConfig } from '@huiliyi37/dsh-zen'

describe('resolveConfig', () => {
  it('materializes every default around a section', () => {
    expect(resolveConfig({ section: 'guide' })).toEqual({
      section: 'guide',
      face: ['bash', 'str_replace_editor', 'todo_write'],
      timeoutSteps: 4,
      requireEvidence: true,
      triage: { enabled: true, maxChars: 80 },
      enabled: true,
    })
  })

  it('keeps explicit values', () => {
    expect(resolveConfig({
      section: 'guide',
      face: ['bash'],
      timeoutSteps: 2,
      requireEvidence: false,
      triage: { enabled: false, maxChars: 10 },
      enabled: false,
    })).toEqual({
      section: 'guide',
      face: ['bash'],
      timeoutSteps: 2,
      requireEvidence: false,
      triage: { enabled: false, maxChars: 10 },
      enabled: false,
    })
  })

  it.each([
    [{}, /non-empty string `section`/],
    [{ section: '  ' }, /non-empty string `section`/],
    [{ section: 'g', bogus: 1 }, /unknown key\(s\) bogus/],
    [{ section: 'g', face: [] }, /non-empty list/],
    [{ section: 'g', face: ['bash', ' '] }, /non-empty list of non-empty tool names/],
    [{ section: 'g', face: ['bash', 'bash'] }, /must not repeat/],
    [{ section: 'g', face: ['bash', 'zen_anchor'] }, /must not name 'zen_anchor'/],
    [{ section: 'g', timeoutSteps: 0 }, /positive integer/],
    [{ section: 'g', timeoutSteps: 1.5 }, /positive integer/],
    [{ section: 'g', requireEvidence: 1 }, /must be a boolean/],
    [{ section: 'g', triage: { bogus: 1 } }, /`triage` has unknown key\(s\) bogus/],
    [{ section: 'g', triage: { enabled: 1 } }, /`triage.enabled` must be a boolean/],
    [{ section: 'g', triage: { maxChars: 0 } }, /`triage.maxChars` must be a positive integer/],
    [{ section: 'g', enabled: 'yes' }, /`enabled` must be a boolean/],
  ])('rejects malformed config %j', (config, pattern) => {
    expect(() => resolveConfig(config as never)).toThrow(pattern)
  })
})

function zenEvent(phase: 'zen' | 'full', reason: string, seq: number): SessionEvent {
  return { type: 'zen/phase', seq, time: seq, data: { phase, reason } } as SessionEvent
}

describe('foldZenPhase', () => {
  it('folds an empty or unrelated log to full (never armed)', () => {
    expect(foldZenPhase([])).toBe('full')
    const unrelated = [{ type: 'turn/start', seq: 0, time: 0, data: { turn: 1 } } as SessionEvent]
    expect(foldZenPhase(unrelated)).toBe('full')
  })

  it('last zen/phase wins and the end bound folds prefixes', () => {
    const events = [zenEvent('zen', 'arm', 0), zenEvent('full', 'anchor', 1)]
    expect(foldZenPhase(events)).toBe('full')
    expect(foldZenPhase(events, 1)).toBe('zen')
    expect(foldZenPhase(events, 0)).toBe('full')
  })
})

function toolCall(callId: string, tool: string, seq: number): SessionEvent {
  return {
    type: 'tool/call', seq, time: seq,
    data: { turn: 1, step: 1, callId, name: tool, arguments: '{}' },
  } as SessionEvent
}

function toolResult(callId: string, isError: boolean, seq: number): SessionEvent {
  return {
    type: 'tool/result', seq, time: seq,
    data: {
      turn: 1, step: 1,
      message: {
        source: { callId },
        content: [{ type: 'tool-result', ...isError ? { isError: true } : {} }],
      },
    },
  } as SessionEvent
}

describe('hasAnchorEvidence', () => {
  it('is false on an empty log and false for a failed call', () => {
    expect(hasAnchorEvidence([])).toBe(false)
    expect(hasAnchorEvidence([toolCall('c1', 'bash', 0), toolResult('c1', true, 1)])).toBe(false)
  })

  it('counts one successful non-bookkeeping result', () => {
    expect(hasAnchorEvidence([toolCall('c1', 'bash', 0), toolResult('c1', false, 1)])).toBe(true)
  })

  it('ignores bookkeeping tools (todo_write, zen_anchor)', () => {
    expect(hasAnchorEvidence([
      toolCall('c1', 'todo_write', 0), toolResult('c1', false, 1),
      toolCall('c2', 'zen_anchor', 2), toolResult('c2', false, 3),
    ])).toBe(false)
  })
})
