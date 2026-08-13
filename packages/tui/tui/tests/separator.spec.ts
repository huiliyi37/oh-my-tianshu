/**
 * 消息间分隔线（format/separator.ts）— 纯渲染契约测试。
 *
 * - 宽度守恒：任何输入下每行显示宽度 ≤ width（窄宽不破版）。
 * - label 居中；label 超宽时截断而非折行。
 * - ascii 入参决定线字符（`-` vs `─`/`·`）；dotted 档用点线。
 */

import { describe, expect, it } from 'vitest'
import type { RivetTheme } from '../src/theme.js'
import { displayWidth } from '../src/width.js'
import { formatSeparator } from '../src/format/separator.js'

function fakeTheme(): RivetTheme {
  return {
    primary: '#111111', secondary: '#222222', success: '#333333',
    warning: '#444444', error: '#555555', dim: '#666666', muted: '#777777',
    pulseQuiet: '#888888', pulseActive: '#999999', pulseAlert: '#aaaaaa',
    userColor: '#bbbbbb', assistantColor: '#cccccc', systemColor: '#dddddd',
    brandColor: '#eeeeee', toolColor: () => '#000000', contextColor: () => '#000000',
  }
}

function plain(lines: readonly string[]): string[] {
  return lines.map(l => l.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, ''))
}

describe('formatSeparator', () => {
  it('width ≤ 0 返回空数组（防御）', () => {
    expect(formatSeparator({ width: 0 }, fakeTheme())).toEqual([])
    expect(formatSeparator({ width: -5 }, fakeTheme())).toEqual([])
  })

  it('无 label：单行规则线，宽度等于 width', () => {
    const [line] = formatSeparator({ width: 20 }, fakeTheme())
    expect(plain([line!])[0]).toBe('─'.repeat(20))
    expect(displayWidth(line!)).toBe(20)
  })

  it('ascii=true：用 `-` 而非 box-drawing', () => {
    const [line] = formatSeparator({ width: 10, ascii: true }, fakeTheme())
    expect(plain([line!])[0]).toBe('-'.repeat(10))
  })

  it('dotted 档：点线', () => {
    const [line] = formatSeparator({ width: 12, style: 'dotted' }, fakeTheme())
    expect(plain([line!])[0]).toBe('·'.repeat(12))
  })

  it('有 label：居中，总宽度守恒', () => {
    const [line] = formatSeparator({ width: 40, label: 'turn 3' }, fakeTheme())
    const text = plain([line!])[0]!
    expect(displayWidth(text)).toBe(40)
    expect(text).toContain('turn 3')
    // 居中：左段与右段字符数近似（40-6=34 → 17/17）
    expect(text).toBe('─'.repeat(17) + 'turn 3' + '─'.repeat(17))
  })

  it('label 超宽（占满 width）：截断为省略号，仍不破版', () => {
    const long = '分隔线标签内容非常长'.repeat(10)
    const [line] = formatSeparator({ width: 30, label: long }, fakeTheme())
    expect(displayWidth(line!)).toBeLessThanOrEqual(30)
    expect(plain([line!])[0]).toContain('…')
  })

  it('dotted + WIDE 度量下兜底截断（ambiguous 按 2 列时仍不破版）', () => {
    const [line] = formatSeparator({ width: 10, label: 'A', style: 'dotted' }, fakeTheme())
    expect(displayWidth(line!, { ambiguousAsWide: true })).toBeLessThanOrEqual(10)
  })

  it('label 带 ANSI 阈值边缘：width 恰好容纳 label 时截断', () => {
    const [line] = formatSeparator({ width: 5, label: 'abc' }, fakeTheme())
    const text = plain([line!])[0]!
    expect(displayWidth(text)).toBeLessThanOrEqual(5)
    expect(text).toContain('abc')
  })
})
