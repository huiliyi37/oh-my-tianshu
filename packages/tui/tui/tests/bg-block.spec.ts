/**
 * bg-block.spec.ts — 表面底色块纯函数（omp 风格消息面底色）。
 *
 * 契约：垫色补到整宽、ANSI 安全截断、行尾 RESET 防泄漏、token 缺省原样返回、
 * 宽度守恒。
 */
import { describe, expect, it } from 'vitest'
import { displayWidth } from '../src/width.js'
import { withBgFill, withBgFillLines } from '../src/format/bg-block.js'

const BG = '#221d1a'

describe('withBgFill', () => {
  it('短行补空格到整宽并带 48;2 底色与行尾 RESET', () => {
    const out = withBgFill('hello', 10, BG)
    expect(out).toContain('48;2;34;29;26')
    expect(out.endsWith('\x1B[0m')).toBe(true)
    expect(displayWidth(out)).toBe(10)
  })

  it('超宽行截断守宽；width ≤ 0 原样返回', () => {
    expect(displayWidth(withBgFill('a'.repeat(30), 12, BG))).toBeLessThanOrEqual(12)
    expect(withBgFill('x', 0, BG)).toBe('x')
  })

  it('含 ANSI 着色的内容按显示宽度补垫', () => {
    const colored = '\x1B[38;2;1;2;3m你好\x1B[0m'
    const out = withBgFill(colored, 10, BG)
    expect(displayWidth(out)).toBe(10)
    expect(out).toContain('你好')
  })
})

describe('withBgFillLines', () => {
  it('token 缺省（undefined）原样返回——16 色轨降级', () => {
    const lines = ['a', 'b']
    expect(withBgFillLines(lines, 10, undefined)).toEqual(['a', 'b'])
  })

  it('逐行垫色补到整宽', () => {
    const out = withBgFillLines(['短', '稍长一点'], 12, BG)
    expect(out).toHaveLength(2)
    for (const line of out) expect(displayWidth(line)).toBe(12)
  })
})
