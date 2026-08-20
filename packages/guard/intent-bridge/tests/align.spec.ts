/**
 * Alignment contract and finalize-argument validation. The contract text is a
 * fixed prompt section (stable bytes); `parseFinalizeArgs` is the boundary
 * validator for the model-facing `finalize_alignment` tool arguments.
 */

import { describe, expect, it } from 'vitest'
import { ALIGN_FACE_STATEMENT, ALIGN_SECTION } from '../src/align.ts'
import { parseFinalizeArgs } from '../src/finalize.ts'

describe('ALIGN_SECTION', () => {
  it('is a non-empty fixed contract covering the alignment process', () => {
    expect(ALIGN_SECTION.length).toBeGreaterThan(200)
    expect(ALIGN_SECTION).toContain('Intent alignment')
    expect(ALIGN_SECTION).toContain('finalize_alignment')
  })

  it('covers restate → classify → clarify → confirm → finalize', () => {
    expect(ALIGN_SECTION).toContain('Restate')
    expect(ALIGN_SECTION).toContain('problem level')
    expect(ALIGN_SECTION).toContain('Ask the user')
    expect(ALIGN_SECTION).toContain('Confirm')
  })

  it('forbids performing the task itself', () => {
    expect(ALIGN_SECTION).toContain('never perform')
    expect(ALIGN_SECTION).toContain('ask instead')
  })

  it('declares the single available tool so the model never reaches for bash/glob', () => {
    // The guard's denial returns this same constant — the section must carry
    // it verbatim so declared face and enforced face never drift apart.
    expect(ALIGN_SECTION).toContain(ALIGN_FACE_STATEMENT)
    expect(ALIGN_SECTION).toContain('no shell')
  })
})

describe('parseFinalizeArgs', () => {
  it('accepts a complete argument set', () => {
    expect(parseFinalizeArgs({
      title: '重构登录逻辑',
      goal: '重写 src/auth.ts 的登录流程，加入 refresh token 轮换。',
      constraints: ['不改变 API 签名'],
      acceptance: ['pnpm test 全绿'],
    })).toEqual({
      title: '重构登录逻辑',
      goal: '重写 src/auth.ts 的登录流程，加入 refresh token 轮换。',
      constraints: ['不改变 API 签名'],
      acceptance: ['pnpm test 全绿'],
    })
  })

  it('defaults missing constraints and acceptance to empty arrays', () => {
    expect(parseFinalizeArgs({ title: 'T', goal: 'G' })).toEqual({
      title: 'T',
      goal: 'G',
      constraints: [],
      acceptance: [],
    })
  })

  it('trims entries and drops blank ones', () => {
    expect(parseFinalizeArgs({
      title: '  T  ',
      goal: '  G  ',
      constraints: ['  a  ', '   ', 'b'],
    })).toEqual({ title: 'T', goal: 'G', constraints: ['a', 'b'], acceptance: [] })
  })

  it.each([
    [{ goal: 'G' }, /title/],
    [{ title: 'T' }, /goal/],
    [{ title: '', goal: 'G' }, /title/],
    [{ title: 'T', goal: '   ' }, /goal/],
    [{ title: 'T', goal: 'G', constraints: 'not-an-array' }, /constraints/],
    [{ title: 'T', goal: 'G', constraints: ['a', 'b', 'c', 'd', 'e'] }, /at most 4/],
    [{ title: 'T', goal: 'G', acceptance: [42] }, /acceptance/],
    ['nonsense', /object/],
    [null, /object/],
  ])('rejects malformed input %j', (args, pattern) => {
    expect(() => parseFinalizeArgs(args as never)).toThrow(pattern)
  })
})
