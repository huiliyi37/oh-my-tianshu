/**
 * 输入轨（format/input-frame.ts）— 纯渲染契约测试。
 *
 * rails-only：顶 ╭─╮、底 ╰─╯，输入行无左右 │；caret 行 +1、列不修正。
 */

import { describe, expect, it } from 'vitest'
import type { RivetTheme } from '../src/theme.js'
import { displayWidth } from '../src/width.js'
import { formatInputFrame } from '../src/format/input-frame.js'

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

describe('formatInputFrame（rails-only）', () => {
  it('顶底圆角横线，输入行无左右竖线', () => {
    const out = formatInputFrame({
      columns: 40,
      lines: ['❯ hello'],
      caretLine: 0,
      caretCol: 2,
    }, fakeTheme())
    const rows = plain(out.lines)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatch(/^╭─+╮$/)
    expect(rows[1]).toBe('❯ hello')
    expect(rows[1]).not.toMatch(/│/)
    expect(rows[2]).toMatch(/^╰─+╯$/)
    expect(displayWidth(rows[0]!)).toBe(40)
    expect(displayWidth(rows[2]!)).toBe(40)
  })

  it('caret 行 +1、列不修正', () => {
    const out = formatInputFrame({
      columns: 40,
      lines: ['❯ hello'],
      caretLine: 0,
      caretCol: 2,
    }, fakeTheme())
    expect(out.caretLine).toBe(1)
    expect(out.caretCol).toBe(2)
  })

  it('plan 轨线用 warning 色', () => {
    const out = formatInputFrame({
      columns: 20,
      lines: ['❯ '],
      caretLine: 0,
      caretCol: 2,
      planActive: true,
    }, fakeTheme())
    expect(out.lines[0]).toContain('\x1B[38;2;68;68;68m')
  })

  it('normal 轨线用雾蓝 promptBorder', () => {
    const out = formatInputFrame({
      columns: 20,
      lines: ['❯ '],
      caretLine: 0,
      caretCol: 2,
    }, fakeTheme())
    expect(out.lines[0]).toContain('\x1B[38;2;85;96;111m')
    expect(out.lines[0]).not.toContain('\x1B[38;2;34;34;34m')
  })

  it('columns < 4：不加轨，caret 不修正', () => {
    const out = formatInputFrame({
      columns: 3,
      lines: ['❯ '],
      caretLine: 0,
      caretCol: 2,
    }, fakeTheme())
    expect(out.lines).toEqual(['❯ '])
    expect(out.caretLine).toBe(0)
    expect(out.caretCol).toBe(2)
  })

  it('多行输入：轨包住全部内容行', () => {
    const out = formatInputFrame({
      columns: 20,
      lines: ['❯ one', '  two'],
      caretLine: 1,
      caretCol: 4,
    }, fakeTheme())
    expect(out.lines).toHaveLength(4)
    expect(plain(out.lines)[1]).toBe('❯ one')
    expect(plain(out.lines)[2]).toBe('  two')
    expect(out.caretLine).toBe(2)
  })
})
