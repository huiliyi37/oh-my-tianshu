import { describe, expect, it } from 'vitest'
import { parseCharRange, parseLineRange, extractSection } from '../src/read-section.ts'

describe('parseLineRange', () => {
  it('parses L100-L200', () => {
    expect(parseLineRange('L100-L200')).toEqual({ start: 100, end: 200 })
  })

  it('parses plain 100-200', () => {
    expect(parseLineRange('100-200')).toEqual({ start: 100, end: 200 })
  })

  it('parses l1-l5 case-insensitively', () => {
    expect(parseLineRange('l1-l5')).toEqual({ start: 1, end: 5 })
  })

  it('rejects start < 1', () => {
    expect(parseLineRange('L0-L5')).toBeNull()
  })

  it('rejects end < start', () => {
    expect(parseLineRange('L5-L3')).toBeNull()
  })

  it('rejects non-range formats', () => {
    expect(parseLineRange('L100')).toBeNull()
    expect(parseLineRange('abc')).toBeNull()
  })
})

describe('parseCharRange', () => {
  it('parses c0-c5000', () => {
    expect(parseCharRange('c0-c5000')).toEqual({ start: 0, end: 5000 })
  })

  it('rejects negative start', () => {
    expect(parseCharRange('c-1-c5')).toBeNull()
  })

  it('rejects end < start', () => {
    expect(parseCharRange('c5-c2')).toBeNull()
  })
})

describe('extractSection', () => {
  const content = 'line1\nline2\nline3\nline4\nline5'

  it('extracts a line range', () => {
    expect(extractSection(content, 'L2-L4')).toBe('line2\nline3\nline4')
  })

  it('clamps an end beyond the file', () => {
    expect(extractSection(content, 'L4-L99')).toBe('line4\nline5')
  })

  it('reports an out-of-range start', () => {
    expect(extractSection(content, 'L99-L100')).toContain('超出范围')
    expect(extractSection(content, 'L99-L100')).toContain('5')
  })

  it('extracts a char range', () => {
    // 'line1\n' is c0-c6, 'line2' is c6-c11, 'line2\n' is c6-c12.
    expect(extractSection(content, 'c6-c12')).toBe('line2\n')
  })

  it('clamps a char range beyond the content', () => {
    expect(extractSection(content, 'c0-c9999')).toBe(content)
  })

  it('returns an error message for an invalid format', () => {
    expect(extractSection(content, 'bogus')).toContain('无效的区段格式')
  })
})
