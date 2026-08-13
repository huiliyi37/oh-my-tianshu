import { describe, expect, it } from 'vitest'
import {
  cumulativeRowsToMessage,
  estimateMessageRows,
  findNextMatch,
  findPrevMatch,
  parseScrollbackTranscript,
  searchTranscript,
  type TranscriptMessage,
} from '../src/scrollback-transcript.js'

function msg(overrides: Partial<TranscriptMessage>): TranscriptMessage {
  return {
    startLine: 0,
    endLine: 1,
    role: 'assistant',
    summary: '',
    lines: ['hello'],
    isTruncated: false,
    rawContent: 'hello',
    ...overrides,
  }
}

describe('parseScrollbackTranscript', () => {
  it('returns [] for blank content', () => {
    expect(parseScrollbackTranscript('')).toEqual([])
    expect(parseScrollbackTranscript('   \n  ')).toEqual([])
  })

  it('groups user messages by the ▌ marker', () => {
    const lines = ['▌ first user', 'continuation', '▌ second user']
    const messages = parseScrollbackTranscript(lines.join('\n'))
    expect(messages).toHaveLength(2)
    expect(messages[0]!.role).toBe('user')
    expect(messages[0]!.summary).toBe('▌ first user')
    expect(messages[0]!.endLine).toBe(2)
    expect(messages[1]!.role).toBe('user')
    expect(messages[1]!.startLine).toBe(2)
  })

  it('recognises tool cards by their bullets', () => {
    const lines = ['› read_file ok', '✗ write_file failed', '● live card']
    const messages = parseScrollbackTranscript(lines.join('\n'))
    expect(messages.every(m => m.role === 'tool')).toBe(true)
    expect(messages.map(m => m.summary)).toEqual(['› read_file ok', '✗ write_file failed', '● live card'])
  })

  it('recognises system blocks by box-drawing corners', () => {
    const messages = parseScrollbackTranscript('╭─ system block\n│ body')
    expect(messages[0]!.role).toBe('system')
  })

  it('treats unmarked lines as one assistant block', () => {
    const messages = parseScrollbackTranscript('plain line one\nplain line two')
    expect(messages).toHaveLength(1)
    expect(messages[0]!.role).toBe('assistant')
    expect(messages[0]!.lines).toEqual(['plain line one', 'plain line two'])
  })

  it('flags truncated tool output via the truncation marker', () => {
    const messages = parseScrollbackTranscript('› long output\n… +25 行 · ctrl+o 展开')
    expect(messages[0]!.isTruncated).toBe(true)
  })

  it('flags truncated output without the expand hint (new form)', () => {
    const messages = parseScrollbackTranscript('› long output\n… +25 行')
    expect(messages[0]!.isTruncated).toBe(true)
  })

  it('strips ANSI from summaries and raw content', () => {
    const messages = parseScrollbackTranscript('\x1B[32m▌ \x1B[0mcolored user')
    expect(messages[0]!.summary).toBe('▌ colored user')
    expect(messages[0]!.rawContent).toBe('▌ colored user')
  })

  it('truncates over-long summaries at 80 chars with an ellipsis', () => {
    const messages = parseScrollbackTranscript(`▌ ${'x'.repeat(100)}`)
    // stripped = '▌ ' + 100×x（102 字符）> 80 → slice(0, 79) + '…' = '▌ ' + 77×x + '…'
    expect(messages[0]!.summary).toBe(`▌ ${'x'.repeat(77)}…`)
    expect(messages[0]!.summary).toHaveLength(80)
  })
})

describe('searchTranscript / findNextMatch / findPrevMatch', () => {
  const messages = [
    msg({ rawContent: 'alpha beta' }),
    msg({ rawContent: 'gamma delta' }),
    msg({ rawContent: 'beta gamma' }),
  ]

  it('finds case-insensitive matches', () => {
    expect(searchTranscript(messages, 'BETA')).toEqual([0, 2])
  })

  it('trims and rejects empty queries', () => {
    expect(searchTranscript(messages, '   ')).toEqual([])
  })

  it('findNextMatch wraps around', () => {
    expect(findNextMatch(messages, -1, 'gamma')).toBe(1)
    expect(findNextMatch(messages, 1, 'gamma')).toBe(2)
    expect(findNextMatch(messages, 2, 'gamma')).toBe(1)
  })

  it('findPrevMatch wraps backwards', () => {
    expect(findPrevMatch(messages, 2, 'beta')).toBe(0)
    expect(findPrevMatch(messages, 0, 'beta')).toBe(2)
  })

  it('returns current index when nothing matches', () => {
    expect(findNextMatch(messages, 1, 'zzz')).toBe(1)
    expect(findPrevMatch(messages, 1, 'zzz')).toBe(1)
  })
})

describe('estimateMessageRows / cumulativeRowsToMessage', () => {
  it('estimates at least one row per line', () => {
    const m = msg({ lines: ['short'] })
    expect(estimateMessageRows(m, 80)).toBe(1)
  })

  it('wraps long lines across multiple rows', () => {
    const m = msg({ lines: ['x'.repeat(200)] })
    expect(estimateMessageRows(m, 80)).toBe(3)
  })

  it('accumulates rows up to but excluding the target index', () => {
    const a = msg({ lines: ['x'.repeat(200)] }) // 3 rows @80
    const b = msg({ lines: ['y'.repeat(160)] }) // 2 rows @80
    expect(cumulativeRowsToMessage([a, b], 0, 80)).toBe(0)
    expect(cumulativeRowsToMessage([a, b], 1, 80)).toBe(3)
    expect(cumulativeRowsToMessage([a, b], 2, 80)).toBe(5)
    expect(cumulativeRowsToMessage([a, b], 9, 80)).toBe(5)
  })
})
