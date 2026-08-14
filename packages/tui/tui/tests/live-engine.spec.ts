/**
 * padDynamicRegion — 溢出裁剪契约测试。
 *
 * 动态段超过 budget 时从顶裁；短于 budget 不垫空行（不填视口）。
 * budget ≤ 0 原样返回。
 */

import { describe, expect, it } from 'vitest'
import { padDynamicRegion, type LiveRegionLine } from '../src/engine/live-engine.js'

function L(...texts: string[]): LiveRegionLine[] {
  return texts.map(text => ({ text }))
}

describe('padDynamicRegion', () => {
  it('budget ≤ 0：原样返回', () => {
    const lines = L('a', 'b', 'chrome')
    expect(padDynamicRegion(lines, 2, 0)).toEqual({ lines, chromeStart: 2 })
    expect(padDynamicRegion(lines, 2, -1).lines).toEqual(lines)
  })

  it('动态段短于 budget：不垫空行，chrome 贴尾', () => {
    const { lines, chromeStart } = padDynamicRegion(L('think', '❯', 'foot'), 1, 4)
    expect(lines.map(l => l.text)).toEqual(['think', '❯', 'foot'])
    expect(chromeStart).toBe(1)
    expect(lines.slice(chromeStart).map(l => l.text)).toEqual(['❯', 'foot'])
  })

  it('动态段空：不垫，chrome 原样', () => {
    const { lines, chromeStart } = padDynamicRegion(L('❯', 'foot'), 0, 3)
    expect(lines.map(l => l.text)).toEqual(['❯', 'foot'])
    expect(chromeStart).toBe(0)
  })

  it('动态段超过 budget：从顶部丢掉最旧行', () => {
    const { lines, chromeStart } = padDynamicRegion(
      L('old', 'mid', 'new', '❯', 'foot'),
      3,
      2,
    )
    expect(lines.map(l => l.text)).toEqual(['mid', 'new', '❯', 'foot'])
    expect(chromeStart).toBe(2)
  })

  it('短于 budget：内容紧贴 chrome，前方无空行', () => {
    const { lines, chromeStart } = padDynamicRegion(L('think', 'tool', '❯'), 2, 5)
    expect(lines.map(l => l.text)).toEqual(['think', 'tool', '❯'])
    expect(lines[chromeStart - 1]?.text).toBe('tool')
    expect(lines[chromeStart]?.text).toBe('❯')
  })

  it('wrapping-aware：budget 按 display rows 计，短则不垫', () => {
    const rowsForLine = (text: string) => (text === 'wide' ? 3 : 1)
    const { lines, chromeStart } = padDynamicRegion(
      L('wide', '❯'),
      1,
      5,
      rowsForLine,
    )
    // wide 占 3 < budget 5 → 不垫
    expect(lines.map(l => l.text)).toEqual(['wide', '❯'])
    expect(chromeStart).toBe(1)
  })

  it('超预算裁掉多 display-row 行后不垫齐', () => {
    const rowsForLine = (text: string) => (text === 'wide' ? 3 : 1)
    const { lines } = padDynamicRegion(
      L('wide', 'keep', '❯'),
      2,
      2,
      rowsForLine,
    )
    // drop wide (3 rows) → keep=1，不垫空行补到 2
    expect(lines.map(l => l.text)).toEqual(['keep', '❯'])
  })
})
