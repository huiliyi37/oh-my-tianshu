/**
 * live-tail-cap — 实时 tail 显示行数封顶（wrap 感知）。
 *
 * - displayRowsForText：按行累加 wrap 后的显示行数；width<=0 每行恒 1 行。
 * - capLiveTail：从尾保留 maxRows 显示行，超出的最老行头部截断 + `… ` 标记。
 * - capLiveTailMarkdownSafe：dropped head 含奇数 ``` fence 时前插合成 opener，
 *   使 tail 从代码块内开始也能对齐 fence 配对。
 *
 * 度量基准为 displayWidth（ASCII 每字符 1 列，行首/行尾无 ambiguous 符号）。
 */

import { describe, expect, it } from 'vitest'
import { capLiveTail, capLiveTailMarkdownSafe, displayRowsForText } from '../src/live-tail-cap.js'

describe('displayRowsForText', () => {
  it('空文本 → 1 行（split 得单元素数组）', () => {
    expect(displayRowsForText('', 80)).toBe(1)
  })

  it('多行 ASCII 各占 1 行时累加', () => {
    expect(displayRowsForText('a\nb\nc', 80)).toBe(3)
  })

  it('超宽行按 ceil(宽度/列宽) wrap', () => {
    // 'abcd' 宽 4，width 2 → ceil(4/2)=2
    expect(displayRowsForText('abcd', 2)).toBe(2)
  })

  it('width <= 0 时每行恒 1 行（不 wrap）', () => {
    expect(displayRowsForText('ab\ncdef', 0)).toBe(2)
  })
})

describe('capLiveTail', () => {
  it('maxRows <= 0 → 空串', () => {
    expect(capLiveTail('abc', 80, 0)).toBe('')
  })

  it('空文本 → 空串', () => {
    expect(capLiveTail('', 80, 5)).toBe('')
  })

  it('短文本全部保留', () => {
    expect(capLiveTail('a\nb', 80, 5)).toBe('a\nb')
  })

  it('超 maxRows 只保留尾部行，省略时首行加标记', () => {
    expect(capLiveTail('1\n2\n3\n4', 80, 2)).toBe('… 3\n4')
  })

  it('最老行部分保留时头部截断并加省略标记', () => {
    // 'abcdef' 宽 6、width 3 → 每行 2 显示行；maxRows 1 只容 1 行 → 'x' 保留、
    // 'abcdef' 全弃，'x' 加 `… ` 前缀标记上文被省略。
    expect(capLiveTail('abcdef\nx', 3, 1)).toBe('… x')
  })

  it('余量容纳更老行尾部时保留截断行', () => {
    // 'abcdef'（2 显示行）+ 'x'（1 行）= 3 行；maxRows 2 → 保留 'x' +
    // 'abcdef' 尾部 1 显示行。'…' 按 ambiguous 2 列计，available 余 1 宽 → 只留 'f'。
    expect(capLiveTail('abcdef\nx', 3, 2)).toBe('… f\nx')
  })

  it('width <= 0 时省略标记直接前置（markOmittedHead 的 width<=0 兜底）', () => {
    // width 0 → 每行恒 1 显示行；maxRows 1 保留 'b'，'a' 被省略 → 整行前置 '… '。
    expect(capLiveTail('a\nb', 0, 1)).toBe('… b')
  })

  it('width 为 1 时省略标记用窄版 …，且被截行余量为 0', () => {
    // 'abcdef'（6 显示行）+ 'x'；maxRows 2 → 保留 'x' + 'abcdef' 尾部 1 宽 'f'。
    // width 1 ≤ charWidth('… ')（2）→ 窄标记 '…'；available = 1*1-1 = 0 → 截断余量为空。
    expect(capLiveTail('abcdef\nx', 1, 2)).toBe('…\nx')
  })

  it('width 为 2 时省略标记用窄版 …，余量容纳被截行 1 字符', () => {
    // 同上，width 2 > charWidth('…')（1）→ 窄标记 '…'；available = 1*2-1 = 1 → 留 'f'。
    expect(capLiveTail('abcdef\nx', 2, 2)).toBe('…f\nx')
  })
})

describe('capLiveTailMarkdownSafe', () => {
  it('maxRows <= 0 → 空串', () => {
    expect(capLiveTailMarkdownSafe('abc', 80, 0)).toBe('')
  })

  it('dropped head 含奇数 fence → 前插合成 opener', () => {
    // head=[A,```,B] 含 1 个 ```（奇数），tail 从 'C' 开始（在代码块内）。
    // 为 opener 预留 1 显示行 → tail 裁到 1 行并加省略标记。
    expect(capLiveTailMarkdownSafe('A\n```\nB\nC\nD', 80, 2)).toBe('```\n… D')
  })

  it('dropped head 含偶数 fence → 不插 opener', () => {
    // head=[```,code,```] 含 2 个 ```（偶数），tail 从 'out' 开始（块外）。
    expect(capLiveTailMarkdownSafe('```\ncode\n```\nout\ntail', 80, 2)).toBe('out\ntail')
  })

  it('tail 未超 maxRows 时整段保留且不插 opener', () => {
    expect(capLiveTailMarkdownSafe('a\nb\nc', 80, 3)).toBe('a\nb\nc')
  })

  it('首行即超 maxRows 时 firstKept 停在末尾（slice 取末行尾部）', () => {
    // 'abcdef' 宽 6、width 3 → 2 显示行 > maxRows 1 → firstKept === lines.length，
    // tail 从末行（即首行）整体进入 capLiveTail 做部分保留。
    expect(capLiveTailMarkdownSafe('abcdef', 3, 1)).toBe('… f')
  })
})
