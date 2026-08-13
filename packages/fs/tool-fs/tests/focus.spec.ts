import { describe, expect, it } from 'vitest'
import { focusedWindow, structuralSkeleton, tokenizeFocus } from '../src/focus.ts'

describe('tokenizeFocus', () => {
  it('filters stop words and keeps identifiers', () => {
    expect(tokenizeFocus('find the auth middleware')).toEqual(['auth', 'middleware'])
  })

  it('splits CJK runs into bigrams, dropping stop-word bigrams', () => {
    // '实现' is a stop-word bigram; 找缓/缓存/存实 survive.
    expect(tokenizeFocus('查找缓存实现')).toEqual(['找缓', '缓存', '存实'])
  })

  it('returns empty for empty or stop-word-only input', () => {
    expect(tokenizeFocus('')).toEqual([])
    expect(tokenizeFocus('the a and for')).toEqual([])
  })
})

describe('focusedWindow', () => {
  const content = [
    'import { x } from "./y"',
    '',
    'export function alpha() {',
    '  // auth token check',
    '  const token = requireAuth(req)',
    '  return token',
    '}',
    '',
    'export function beta() {',
    '  return 2',
    '}',
    '',
    '// unrelated color palette',
    'const palette = ["red"]',
  ].join('\n')

  it('returns only high-signal lines around focus matches, not the whole file', () => {
    const window = focusedWindow(content, 'auth token', 2000)
    expect(window.totalLines).toBe(14)
    expect(window.lines.length).toBeLessThan(14)
    expect(window.lines.length).toBeGreaterThan(0)
    for (const line of window.lines) {
      expect(line.number).toBeGreaterThan(0)
    }
    // The auth-relevant body is inside the selected ranges.
    const texts = window.lines.map(l => l.text).join('\n')
    expect(texts).toContain('requireAuth')
  })

  it('returns a structural skeleton even when no line matches', () => {
    const window = focusedWindow(content, 'zzz_no_such_term', 2000)
    expect(window.skeleton.length).toBeGreaterThan(0)
    expect(window.skeleton.join('\n')).toContain('function alpha')
  })

  it('bounds output by maxChars', () => {
    const window = focusedWindow(content, 'auth', 300)
    const total = window.lines.map(l => l.text).join('').length + window.skeleton.join('').length
    expect(total).toBeLessThanOrEqual(600) // lines + skeleton, both bounded
  })

  it('handles focus without any token (stop-word-only query)', () => {
    const window = focusedWindow(content, 'the and', 2000)
    expect(window.lines).toEqual([])
    expect(window.skeleton.length).toBeGreaterThan(0)
  })
})

describe('structuralSkeleton', () => {
  it('extracts top-level definition lines with a cap', () => {
    const lines = Array.from({ length: 30 }, (_, i) => i === 0 ? 'export function a() {}' : `  const v${i} = ${i}`)
    const skeleton = structuralSkeleton(lines.join('\n'), 5)
    expect(skeleton).toContain('export function a() {}')
    expect(skeleton.length).toBeLessThanOrEqual(5 * 120)
  })
})
