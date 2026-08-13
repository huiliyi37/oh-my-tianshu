/**
 * spark 推理尾部截断纯函数测试（行为测试，非 plumbing）。
 * 用例移植自桌面端 src/pro/spark/__tests__/（外部参照：opencode-tui），
 * 按 spec 语义重写：token 边界、N=0、确定性、连续子串不变量、排除句式锚点。
 * @module dsh-llm-deepseek/tests/spark
 */

import { describe, expect, it } from 'vitest'
import {
  defaultTokenizer,
  extractExcludedClaims,
  resolveTruncateN,
  truncateCutStart,
  truncateReasoningTail,
  type SparkTruncatePolicy,
} from '../src/spark.ts'

const POLICY: SparkTruncatePolicy = { flash: 300, pro: 0 }

/** 用退化分词器辅助构造长文本：重复 N+1 个词，保证 token 数确定。 */
function repeatedWords(word: string, count: number): string {
  return Array.from({ length: count }, () => word).join(' ')
}

// 注：退化分词把空白符当作独立 token（桌面端同款），因此「尾部 N token」可含
// 前导空白；涉及切点精确断言的用例改用无空白的 CJK 输入（每字一 token）。

describe('truncateReasoningTail', () => {
  it('returns the original text when token count is at most N', () => {
    const reasoning = '甲乙丙' // 3 个 token
    expect(truncateReasoningTail(reasoning, 3, defaultTokenizer)).toBe(reasoning)
    expect(truncateReasoningTail(reasoning, 10, defaultTokenizer)).toBe(reasoning)
  })

  it('truncates to the tail N tokens when longer', () => {
    const reasoning = '甲乙丙丁戊' // 5 个 CJK token，无空白
    expect(truncateReasoningTail(reasoning, 2, defaultTokenizer)).toBe('丁戊')
  })

  it('returns empty string for N <= 0 (full truncation)', () => {
    expect(truncateReasoningTail('some reasoning', 0, defaultTokenizer)).toBe('')
    expect(truncateReasoningTail('some reasoning', -3, defaultTokenizer)).toBe('')
  })

  it('returns empty string for empty input', () => {
    expect(truncateReasoningTail('', 300, defaultTokenizer)).toBe('')
  })

  it('keeps exactly one token for N=1', () => {
    const reasoning = '甲乙丙丁'
    expect(truncateReasoningTail(reasoning, 1, defaultTokenizer)).toBe('丁')
  })

  it('output is always a contiguous substring of the input (invariant)', () => {
    const reasoning = '前段排除分析，后段结论。the answer is 42'
    const result = truncateReasoningTail(reasoning, 5, defaultTokenizer)
    expect(reasoning.includes(result)).toBe(true)
  })

  it('is deterministic: same input + same tokenizer → same output', () => {
    const reasoning = repeatedWords('token', 8)
    const a = truncateReasoningTail(reasoning, 3, defaultTokenizer)
    const b = truncateReasoningTail(reasoning, 3, defaultTokenizer)
    expect(a).toBe(b)
  })

  it('cuts at a token boundary: result starts at a token span start', () => {
    const reasoning = '甲乙丙丁戊己' // 6 个 token
    const result = truncateReasoningTail(reasoning, 3, defaultTokenizer)
    expect(result).toBe('丁戊己')
  })
})

describe('defaultTokenizer', () => {
  it('tokenizes CJK as single characters', () => {
    const spans = defaultTokenizer('排除分析')
    expect(spans.map(s => s.start)).toEqual([0, 1, 2, 3])
    expect(spans.map(s => s.end)).toEqual([1, 2, 3, 4])
  })

  it('tokenizes contiguous latin/digit/underscore runs as one token', () => {
    const text = 'the_answer is 42'
    const spans = defaultTokenizer(text)
    // 连续拉丁/数字/下划线串为一个 token；空白为独立 token（退化分词语义）
    expect(spans[0]).toEqual({ start: 0, end: 10 })
    expect(text.slice(spans[0]!.start, spans[0]!.end)).toBe('the_answer')
    expect(text.slice(spans[2]!.start, spans[2]!.end)).toBe('is')
    expect(text.slice(spans[4]!.start, spans[4]!.end)).toBe('42')
  })

  it('does not split surrogate pairs (u flag)', () => {
    const spans = defaultTokenizer('a😀b')
    // 😀 是 astral 字符，作为一个码点一个 token，不得切成两个半符
    expect(spans).toEqual([
      { start: 0, end: 1 },
      { start: 1, end: 3 },
      { start: 3, end: 4 },
    ])
  })

  it('covers the whole input without gaps or overlaps', () => {
    const text = 'A 排除 B 12_ab，x'
    const spans = defaultTokenizer(text)
    expect(spans[0]!.start).toBe(0)
    expect(spans.at(-1)!.end).toBe(text.length)
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i]!.start).toBe(spans[i - 1]!.end)
    }
  })
})

describe('truncateCutStart', () => {
  it('returns -1 when token count is at most N (no truncation)', () => {
    expect(truncateCutStart('甲乙丙', 3)).toBe(-1)
    expect(truncateCutStart('甲乙', 10)).toBe(-1)
  })

  it('returns the lost prefix end offset when truncating', () => {
    const reasoning = '甲乙丙丁戊' // 5 个 token
    const cut = truncateCutStart(reasoning, 2)
    // 丢前 3 个 token，切点在第三个 token 的起点
    expect(cut).toBe(3)
    expect(reasoning.slice(cut)).toBe('丁戊')
  })

  it('returns 0-compatible boundary when N=0 (whole text lost)', () => {
    // N=0：全部丢失，切点 = 0（与 truncateReasoningTail 返回空串一致）
    expect(truncateCutStart('a b c', 0)).toBe(0)
  })
})

describe('resolveTruncateN', () => {
  it('uses the flash tier for flash models', () => {
    expect(resolveTruncateN('deepseek-v4-flash', POLICY)).toBe(300)
  })

  it('uses the pro tier for pro models (segmented word match)', () => {
    expect(resolveTruncateN('deepseek-v4-pro', POLICY)).toBe(0)
  })

  it('does not false-positive on substrings containing "pro"', () => {
    // 分段词匹配：'provider' / 'prophet' 不得命中 pro 档
    expect(resolveTruncateN('deepseek-v4-provider', POLICY)).toBe(300)
    expect(resolveTruncateN('deepseek-prophet', POLICY)).toBe(300)
  })

  it('handles model names with different separators and case', () => {
    expect(resolveTruncateN('DeepSeek-V4-PRO', POLICY)).toBe(0)
    expect(resolveTruncateN('deepseek/v4/pro', POLICY)).toBe(0)
  })

  it('defaults to flash tier when model is undefined', () => {
    expect(resolveTruncateN(undefined, POLICY)).toBe(300)
  })
})

describe('extractExcludedClaims', () => {
  it('extracts Chinese exclusion sentences (不是/不可行/排除)', () => {
    // 注：中文排除正则的 [^，。；、\s] 排除空白——词间不留空格（桌面端固有语义）
    const reasoning = '先看A方案，但A不是最优解。B不可行，因为成本太高。最终选C。'
    const claims = extractExcludedClaims(reasoning)
    expect(claims.length).toBeGreaterThanOrEqual(2)
    expect(claims.join(' ')).toContain('不是最优解')
    expect(claims.join(' ')).toContain('不可行')
  })

  it('extracts English exclusion sentences', () => {
    const reasoning = 'Option A is not viable. Try B instead; C is unlikely to help.'
    const claims = extractExcludedClaims(reasoning)
    expect(claims.length).toBeGreaterThanOrEqual(2)
    expect(claims.join(' ')).toContain('is not viable')
    expect(claims.join(' ')).toContain('unlikely')
  })

  it('filters overly short sentences (宁缺毋滥)', () => {
    // "不对" 单独出现（长度 ≤4）不提取
    const claims = extractExcludedClaims('不对，换个思路。')
    expect(claims.length).toBe(0)
  })

  it('does not let the EN branch cross a CJK sentence boundary (regression)', () => {
    // 中文句号不是 ASCII '.'——旧 `[^.;]` 会让 EN 分支从上一句一路吞到
    // "not the root cause"，把未排除的中文分析误当已排除路径。
    const reasoning = '再检查一下 session 的事件流，确认 token 刷新发生在正确的时机。\nThe token refresh is not the root cause — the test asserts early.'
    const claims = extractExcludedClaims(reasoning)
    expect(claims.length).toBe(1)
    expect(claims[0]).toContain('token refresh is not the root cause')
    expect(claims[0]).not.toContain('再检查一下')
  })

  it('returns [] for empty input', () => {
    expect(extractExcludedClaims('')).toEqual([])
  })

  it('is deterministic', () => {
    const reasoning = 'A 不是最优解。B 不可行。'
    expect(extractExcludedClaims(reasoning)).toEqual(extractExcludedClaims(reasoning))
  })
})
