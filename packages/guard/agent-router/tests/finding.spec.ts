/**
 * finding.spec.ts — 有界结构化 finding（父边界净化与闭合形状）。
 *
 * 覆盖：boundFinding 形状门（非法形状 → undefined）、控制字符/换行折叠、
 * 截断上限（摘要/条目/条数）、verifier verdict 校验与 scout 禁带 verdict。
 */
import { describe, expect, it } from 'vitest'
import {
  boundFinding,
  boundFindingText,
  FINDING_ITEM_MAX_CHARS,
  FINDING_ITEMS_MAX,
  FINDING_SUMMARY_MAX_CHARS,
  FINDING_SCHEMA_BY_PROFILE,
} from '../src/finding.js'

describe('boundFindingText', () => {
  it('折叠换行与控制字符为单行并截断', () => {
    expect(boundFindingText('a\nb\tc\rd', 50)).toBe('a b c d')
    expect(boundFindingText('ok\u0007!', 50)).toBe('ok!')
    expect(boundFindingText('  trimmed  ', 50)).toBe('trimmed')
    const long = 'x'.repeat(FINDING_ITEM_MAX_CHARS + 10)
    expect(boundFindingText(long, FINDING_ITEM_MAX_CHARS)).toHaveLength(FINDING_ITEM_MAX_CHARS)
  })

  it('非字符串输入返回空串', () => {
    expect(boundFindingText(42, 10)).toBe('')
    expect(boundFindingText(undefined, 10)).toBe('')
  })
})

describe('boundFinding', () => {
  it('合法 scout finding 通过且字段有界', () => {
    const finding = boundFinding({
      kind: 'scout',
      summary: 'found the bug in src/a.ts',
      findings: ['line 3 imports missing dep', 'duplicate export at line 40'],
    })
    expect(finding).toEqual({
      kind: 'scout',
      summary: 'found the bug in src/a.ts',
      findings: ['line 3 imports missing dep', 'duplicate export at line 40'],
    })
  })

  it('合法 verify finding 带 verdict', () => {
    const finding = boundFinding({ kind: 'verify', summary: 'reproduced', findings: ['test fails'], verdict: 'supported' })
    expect(finding).toMatchObject({ kind: 'verify', verdict: 'supported' })
  })

  it('形状非法 → undefined（不伪造 finding）', () => {
    expect(boundFinding(undefined)).toBeUndefined()
    expect(boundFinding('text')).toBeUndefined()
    expect(boundFinding({ kind: 'scout' })).toBeUndefined()
    expect(boundFinding({ kind: 'scout', summary: '', findings: [] })).toBeUndefined()
    expect(boundFinding({ kind: 'scout', summary: 's', findings: 'not-array' })).toBeUndefined()
    expect(boundFinding({ kind: 'alien', summary: 's', findings: [] })).toBeUndefined()
    // verify 缺 verdict / verdict 非法
    expect(boundFinding({ kind: 'verify', summary: 's', findings: [] })).toBeUndefined()
    expect(boundFinding({ kind: 'verify', summary: 's', findings: [], verdict: 'maybe' })).toBeUndefined()
    // scout 带了 verdict → 拒绝（判别卫生）
    expect(boundFinding({ kind: 'scout', summary: 's', findings: [], verdict: 'supported' })).toBeUndefined()
  })

  it('超限截断：长摘要、多条目、非字符串条目被过滤', () => {
    const longSummary = 'y'.repeat(FINDING_SUMMARY_MAX_CHARS + 5)
    const many = Array.from({ length: FINDING_ITEMS_MAX + 4 }, (_, i) => `item ${i}`)
    many.push(42 as unknown as string)
    const finding = boundFinding({ kind: 'scout', summary: longSummary, findings: many })
    expect(finding).toBeDefined()
    expect(finding?.summary).toHaveLength(FINDING_SUMMARY_MAX_CHARS)
    expect(finding?.findings).toHaveLength(FINDING_ITEMS_MAX)
    for (const item of finding!.findings) expect(item.length).toBeLessThanOrEqual(FINDING_ITEM_MAX_CHARS)
  })

  it('截断不落半个字符：上限劈开代理对时丢弃尾部孤立高代理', () => {
    // '😀' = U+1F600 = 高代理 + 低代理两个 code unit；上限取在中间。
    const emojiRun = '😀'.repeat(10)
    const bounded = boundFindingText(emojiRun, 5)
    expect(bounded).toHaveLength(4)
    expect(bounded).toBe('😀'.repeat(2))
  })
})

describe('FINDING_SCHEMA_BY_PROFILE', () => {
  it('闭合判别：kind/verdict 都是 enum 单值或三值；additionalProperties 关闭', () => {
    expect(FINDING_SCHEMA_BY_PROFILE.code_scout.properties?.kind).toMatchObject({ enum: ['scout'] })
    expect(FINDING_SCHEMA_BY_PROFILE.verifier.properties?.kind).toMatchObject({ enum: ['verify'] })
    expect(FINDING_SCHEMA_BY_PROFILE.verifier.properties?.verdict).toMatchObject({
      enum: ['supported', 'unsupported', 'inconclusive'],
    })
    expect(FINDING_SCHEMA_BY_PROFILE.code_scout.additionalProperties).toBe(false)
    expect(FINDING_SCHEMA_BY_PROFILE.verifier.required).toContain('verdict')
    expect(FINDING_SCHEMA_BY_PROFILE.code_scout.required).not.toContain('verdict')
  })
})
