/**
 * format/shimmer — 思考头行光带动画契约测试。
 *
 * - 纯函数确定性：同 (text, tick) 恒同输出；tick 按 periodTicks 周期回绕。
 * - 光带扫过：tick=0 中心在文本左侧 band 外 → 整行 base 色单段；中段 tick
 *   出现高亮段（与 base 段不同的 38;2 序列）。
 * - CJK 宽字符按 2 列参与光带定位（同 tick 下与等字符数 ASCII 的分段不同）。
 * - 降级：base/highlight 不可解析（16 色轨命名色）→ 静态整行着色。
 * - mixHex / shimmerHighlight：线性插值与提亮派生。
 */

import { describe, expect, it } from 'vitest'
import {
  mixHex,
  SHIMMER_PERIOD_TICKS,
  shimmerHighlight,
  shimmerLine,
} from '../src/format/shimmer.js'

const BASE = '#4060c0'
const HIGHLIGHT = '#c0d0ff'

/** 提取输出中的 38;2 前景序列（截断色段边界）。 */
function fgSegments(ansi: string): string[] {
  return ansi.match(/\x1B\[38;2;\d+;\d+;\d+m/g) ?? []
}

describe('mixHex', () => {
  it('t=0 → a，t=1 → b，t=0.5 → 中点；范围外截断', () => {
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000')
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff')
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080')
    expect(mixHex('#000000', '#ffffff', 2)).toBe('#ffffff')
  })

  it('不可解析输入原样返回 a', () => {
    expect(mixHex('cyan', '#ffffff', 0.5)).toBe('cyan')
  })
})

describe('shimmerHighlight', () => {
  it('hex base → 向白提亮；命名色原样返回', () => {
    const lifted = shimmerHighlight('#000000')
    expect(lifted).not.toBe('#000000')
    expect(lifted).toMatch(/^#[0-9a-f]{6}$/)
    expect(shimmerHighlight('cyan')).toBe('cyan')
  })
})

describe('shimmerLine', () => {
  it('同 (text, tick) 输出确定；周期回绕（tick=0 与 tick=period 相同）', () => {
    const at = (tick: number): string => shimmerLine({ text: '✻ 思考中…', tick, base: BASE, highlight: HIGHLIGHT })
    expect(at(3)).toBe(at(3))
    expect(at(0)).toBe(at(SHIMMER_PERIOD_TICKS))
    expect(at(-1)).toBe(at(SHIMMER_PERIOD_TICKS - 1))
  })

  it('tick=0 光带在文本外 → 整行 base 单色段', () => {
    const out = shimmerLine({ text: 'Deep diving', tick: 0, base: BASE, highlight: HIGHLIGHT })
    expect(fgSegments(out)).toEqual(['\x1B[38;2;64;96;192m'])
    expect(out.endsWith('\x1B[0m')).toBe(true)
  })

  it('中段 tick → 出现高于 base 的高亮段且相邻段不同色（同色合并）', () => {
    const mid = Math.floor(SHIMMER_PERIOD_TICKS / 2)
    const out = shimmerLine({ text: 'Deep diving into the problem', tick: mid, base: BASE, highlight: HIGHLIGHT })
    const segments = fgSegments(out)
    expect(segments.length).toBeGreaterThan(1)
    expect(segments.some(s => s !== '\x1B[38;2;64;96;192m')).toBe(true)
    for (let i = 1; i < segments.length; i++) expect(segments[i]).not.toBe(segments[i - 1])
  })

  it('剥掉转义后文本原样保留', () => {
    const out = shimmerLine({ text: '✻ 思考中… (3s)', tick: 7, base: BASE, highlight: HIGHLIGHT })
    expect(out.replace(/\x1B\[[0-9;]*m/g, '')).toBe('✻ 思考中… (3s)')
  })

  it('CJK 宽字符按 2 列定位：同 tick 下与等字符数 ASCII 分段不同', () => {
    const mid = Math.floor(SHIMMER_PERIOD_TICKS / 2)
    const cjk = shimmerLine({ text: '思考思考思考思考', tick: mid, base: BASE, highlight: HIGHLIGHT })
    const ascii = shimmerLine({ text: 'abcdefgh', tick: mid, base: BASE, highlight: HIGHLIGHT })
    const strip = (s: string): string[] => fgSegments(s)
    expect(strip(cjk)).not.toEqual(strip(ascii))
  })

  it('base/highlight 不可解析 → 静态整行着色降级', () => {
    const out = shimmerLine({ text: 'thinking', tick: 5, base: 'cyan', highlight: 'white' })
    expect(out).toBe('\x1B[36mthinking\x1B[0m')
  })
})
