/**
 * 输入框完整框体（format/input-frame.ts）— 纯渲染契约测试。
 *
 * - 完整圆角框：顶框 ╭─╮ + 两侧边线 │ │ + 底框 ╰─╯
 * - 外宽 = boxOuterWidth(columns) ≤ columns
 * - caret 坐标修正：caretLine +1（顶框）、caretCol +2（左边线 `│ `）
 * - 色随模式：normal secondary / plan warning / auto error
 * - columns 过窄（<4）降级：原样返回不加框
 */

import { describe, expect, it } from 'vitest'
import type { RivetTheme } from '../src/theme.js'
import { displayWidth } from '../src/width.js'
import { boxOuterWidth } from '../src/box-chars.js'
import { formatInputFrame, type FormatInputFrameInput } from '../src/format/input-frame.js'

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

function base(over: Partial<FormatInputFrameInput> = {}): FormatInputFrameInput {
  return { columns: 100, lines: ['❯ █placeholder'], caretLine: 0, caretCol: 2, ...over }
}

describe('formatInputFrame', () => {
  it('完整框体：顶框 + 两侧边线内容行 + 底框，外宽 = boxOuterWidth', () => {
    const cols = 100
    const frame = formatInputFrame(base({ columns: cols }), fakeTheme())
    const rows = plain(frame.lines)
    // noUncheckedIndexedAccess：destructuring 元素可能 undefined，空串回退无害
    const top = rows[0] ?? ''
    const mid = rows[1] ?? ''
    const bottom = rows[2] ?? ''
    expect(frame.lines.length).toBe(3)
    expect(top).toMatch(/^╭─+╮$/)
    expect(mid.startsWith('│ ')).toBe(true)
    expect(mid).toContain('❯ █placeholder')
    expect(mid.endsWith(' │')).toBe(true)
    expect(bottom).toMatch(/^╰─+╯$/)
    for (const line of frame.lines) {
      expect(displayWidth(line)).toBe(boxOuterWidth(cols))
    }
  })

  it('caret 坐标修正：caretLine +1（顶框行）、caretCol +2（左边线 `│ `）', () => {
    const frame = formatInputFrame(base({ caretLine: 1, caretCol: 5 }), fakeTheme())
    expect(frame.caretLine).toBe(2)
    expect(frame.caretCol).toBe(7)
  })

  it('normal：secondary 边框色', () => {
    expect(formatInputFrame(base(), fakeTheme()).lines[0]).toContain('\x1B[38;2;34;34;34m')
  })

  it('planActive / planPending：warning 边框色', () => {
    expect(formatInputFrame(base({ planActive: true }), fakeTheme()).lines[0]).toContain('\x1B[38;2;68;68;68m')
    expect(formatInputFrame(base({ planActive: true, planPending: true }), fakeTheme()).lines[0]).toContain('\x1B[38;2;68;68;68m')
  })

  it('alwaysApprove：error 边框色', () => {
    expect(formatInputFrame(base({ alwaysApprove: true }), fakeTheme()).lines[0]).toContain('\x1B[38;2;85;85;85m')
  })

  it('separator=thick：粗框字符（┏ ┓ ┗ ┛）', () => {
    const frame = formatInputFrame(base({ separator: 'thick' }), fakeTheme())
    const rows = plain(frame.lines)
    // noUncheckedIndexedAccess：destructuring 元素可能 undefined，空串回退无害
    const top = rows[0] ?? ''
    const bottom = rows[2] ?? ''
    expect(top.startsWith('┏')).toBe(true)
    expect(top.endsWith('┓')).toBe(true)
    expect(bottom.startsWith('┗')).toBe(true)
    expect(bottom.endsWith('┛')).toBe(true)
  })

  it('columns 过窄（<4）降级：原样返回输入行、不加框、不修正 caret', () => {
    const frame = formatInputFrame(base({ columns: 3 }), fakeTheme())
    expect(frame.lines).toEqual(['❯ █placeholder'])
    expect(frame.caretLine).toBe(0)
    expect(frame.caretCol).toBe(2)
  })

  it('多行输入：每行两侧边线，框体行数 = 输入行数 + 2，宽度守恒', () => {
    const lines = ['❯ █first line', '  second line', '  third line']
    const frame = formatInputFrame(base({ lines }), fakeTheme())
    expect(frame.lines.length).toBe(lines.length + 2)
    for (const line of frame.lines) {
      expect(displayWidth(line)).toBeLessThanOrEqual(100)
    }
  })
})
