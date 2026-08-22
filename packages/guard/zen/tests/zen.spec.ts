/**
 * Pure-function behavior of the zen package: config validation fails loud on
 * every malformed field, the phase fold is last-wins over any prefix, and the
 * anchor-evidence predicate counts only successful non-bookkeeping results.
 */

import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@huiliyi37/dsh-session'
import { foldZenPhase, hasAnchorEvidence, resolveConfig, selectFaceExtras, selectedFace, clipDescription, BASH_OVERLAP_TOOLS } from '@huiliyi37/dsh-zen'

describe('resolveConfig', () => {
  it('materializes every default around a section', () => {
    expect(resolveConfig({ section: 'guide' })).toEqual({
      section: 'guide',
      face: ['bash', 'str_replace_editor', 'todo_write'],
      timeoutSteps: 4,
      requireEvidence: true,
      triage: { enabled: true, maxChars: 80 },
      faceSelection: { enabled: false },
      diet: undefined,
      promoteDeny: [],
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
      faceSelection: { enabled: true },
      diet: { maxDescriptionChars: 80 },
      promoteDeny: ['read', 'grep'],
      enabled: false,
    })).toEqual({
      section: 'guide',
      face: ['bash'],
      timeoutSteps: 2,
      requireEvidence: false,
      triage: { enabled: false, maxChars: 10 },
      faceSelection: { enabled: true },
      diet: { maxDescriptionChars: 80 },
      promoteDeny: ['read', 'grep'],
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
    [{ section: 'g', faceSelection: { bogus: 1 } }, /`faceSelection` has unknown key\(s\) bogus/],
    [{ section: 'g', faceSelection: { enabled: 1 } }, /`faceSelection.enabled` must be a boolean/],
    [{ section: 'g', diet: { bogus: 1, maxDescriptionChars: 8 } }, /`diet` has unknown key\(s\) bogus/],
    [{ section: 'g', diet: { maxDescriptionChars: 0 } }, /`diet.maxDescriptionChars` must be a positive integer/],
    [{ section: 'g', promoteDeny: [''] }, /`promoteDeny` must be a list of non-empty tool names/],
    [{ section: 'g', promoteDeny: ['read', 'read'] }, /`promoteDeny` must not repeat tool names/],
    [{ section: 'g', promoteDeny: ['zen_anchor'] }, /`promoteDeny` must not name 'zen_anchor'/],
    [{ section: 'g', face: ['bash'], promoteDeny: ['bash'] }, /must not repeat a name from `face`/],
  ])('rejects malformed config %j', (config, pattern) => {
    expect(() => resolveConfig(config as never)).toThrow(pattern)
  })

  it('keeps BASH_OVERLAP_TOOLS off the default zen face', () => {
    const face = resolveConfig({ section: 'guide' }).face
    expect(BASH_OVERLAP_TOOLS.some(name => face.includes(name))).toBe(false)
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

describe('selectFaceExtras', () => {
  it('appends only non-bash-substitutable tools the first message names', () => {
    expect(selectFaceExtras('delegate this to a subagent that explores the tree')).toEqual(['subagent'])
    expect(selectFaceExtras('use the language server to go to definition')).toEqual(['lsp', 'semantic_search'])
    expect(selectFaceExtras('remember this across sessions')).toEqual(['memory_save', 'memory_search'])
    expect(selectFaceExtras('search the previous session for that decision')).toEqual(['session_search', 'session_trace'])
  })

  it('does not treat an ordinary coding task as needing extras', () => {
    expect(selectFaceExtras('Rename add to sum across src/ and keep tests green.')).toEqual([])
  })
})

describe('selectedFace', () => {
  it('keeps the alt-0 base and drops extras the deployment did not register', () => {
    const base = ['bash', 'todo_write']
    expect(selectedFace(base, ['subagent', 'lsp'], new Set(['bash', 'todo_write', 'subagent'])))
      .toEqual(['bash', 'todo_write', 'subagent'])
  })
})

describe('clipDescription', () => {
  it('leaves a short description alone and clips on a word boundary', () => {
    expect(clipDescription('short', 80)).toBe('short')
    expect(clipDescription('test tool probe', 8)).toBe('test')
  })
})
