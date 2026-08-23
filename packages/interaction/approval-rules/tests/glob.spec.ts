import { describe, expect, it } from 'vitest'
import { matchesPattern, normalizeArguments } from '@huiliyi37/dsh-approval-rules'

describe('matchesPattern (full-string-anchored glob)', () => {
  it('anchors the whole string: a longer string cannot match a shorter pattern', () => {
    expect(matchesPattern('git push', 'git push')).toBe(true)
    expect(matchesPattern('safe-git push', 'git push')).toBe(false)
    expect(matchesPattern('git push origin', 'git push')).toBe(false)
  })

  it('lets * cross any characters, including spaces and segments', () => {
    expect(matchesPattern('git push origin main', 'git*')).toBe(true)
    expect(matchesPattern('git push', '*')).toBe(true)
    expect(matchesPattern('git push', 'git*push')).toBe(true)
    expect(matchesPattern('git push', 'g*sh')).toBe(true)
    // A trailing literal must be anchored, not a prefix match.
    expect(matchesPattern('git push', 'g*t')).toBe(false)
    expect(matchesPattern('git push origin', 'git*push*')).toBe(true)
  })

  it('treats every non-* character as a literal (a glob, not a regex)', () => {
    expect(matchesPattern('a.b', 'a.b')).toBe(true)
    expect(matchesPattern('axb', 'a.b')).toBe(false)
    expect(matchesPattern('a+b', 'a+b')).toBe(true)
    expect(matchesPattern('axb', 'a+b')).toBe(false)
  })

  it('matches multibyte text', () => {
    expect(matchesPattern('你好 世界', '你好*')).toBe(true)
    expect(matchesPattern('你好世界', '你好*世界')).toBe(true)
    expect(matchesPattern('x你好', '你好')).toBe(false)
    expect(matchesPattern('世界', '你好*')).toBe(false)
  })

  it('requires exact equality when no wildcard is present', () => {
    expect(matchesPattern('echo', 'echo')).toBe(true)
    expect(matchesPattern('echo ', 'echo')).toBe(false)
    expect(matchesPattern('echo', 'echo ')).toBe(false)
    expect(matchesPattern('', '')).toBe(true)
  })
})

describe('normalizeArguments', () => {
  it('collapses whitespace runs and trims', () => {
    expect(normalizeArguments('  git   push  ')).toBe('git push')
    expect(normalizeArguments('\n\tgit\tpush\n')).toBe('git push')
    expect(normalizeArguments('')).toBe('')
  })
})
