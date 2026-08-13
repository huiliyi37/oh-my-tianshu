/**
 * 状态行（format/turn-status.ts）— 纯渲染契约测试（C4 概念稿 A「航图」turn_status）。
 *
 * - statusText 为 null/空 → 不渲染（空数组，不占位）。
 * - agent 运行中 → braille spinner 帧（随 tick 循环）；等待输入 → pulsing ◆。
 * - ascii 档：spinner 降级 `*`、等待降级 `-`（legacy 终端宽度稳定）。
 * - 宽度守恒：statusText 超宽截断。
 */

import { describe, expect, it } from 'vitest'
import type { RivetTheme } from '../src/theme.js'
import { displayWidth } from '../src/width.js'
import { formatTurnStatus, type FormatTurnStatusInput } from '../src/format/turn-status.js'

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

function base(over: Partial<FormatTurnStatusInput> = {}): FormatTurnStatusInput {
  return { statusText: '实施 · edit_file', tick: 0, active: true, ...over }
}

describe('formatTurnStatus', () => {
  it('statusText null：空数组（不占位）', () => {
    expect(formatTurnStatus(base({ statusText: null }), fakeTheme())).toEqual([])
  })

  it('statusText 空串：空数组', () => {
    expect(formatTurnStatus(base({ statusText: '' }), fakeTheme())).toEqual([])
  })

  it('active：braille spinner 帧随 tick 循环（⠋ → ⠙ → ⠹）', () => {
    const t0 = plain(formatTurnStatus(base({ tick: 0 }), fakeTheme()))[0]!
    const t1 = plain(formatTurnStatus(base({ tick: 1 }), fakeTheme()))[0]!
    const t2 = plain(formatTurnStatus(base({ tick: 2 }), fakeTheme()))[0]!
    expect(t0.startsWith('⠋')).toBe(true)
    expect(t1.startsWith('⠙')).toBe(true)
    expect(t2.startsWith('⠹')).toBe(true)
    expect(t0).toContain('实施 · edit_file')
  })

  it('active：tick 回卷（10 → 0 帧）', () => {
    const t10 = plain(formatTurnStatus(base({ tick: 10 }), fakeTheme()))[0]!
    const t0 = plain(formatTurnStatus(base({ tick: 0 }), fakeTheme()))[0]!
    expect(t10.startsWith('⠋')).toBe(true)
    expect(t10).toBe(t0)
  })

  it('idle（等待输入）：pulsing ◆ 前缀', () => {
    const [line] = plain(formatTurnStatus(base({ active: false }), fakeTheme()))
    expect(line!.startsWith('◆')).toBe(true)
    expect(line).toContain('实施 · edit_file')
  })

  it('ascii：active 降级 *、idle 降级 -', () => {
    const [a] = plain(formatTurnStatus(base({ ascii: true }), fakeTheme()))
    expect(a!.startsWith('*')).toBe(true)
    const [i] = plain(formatTurnStatus(base({ ascii: true, active: false }), fakeTheme()))
    expect(i!.startsWith('-')).toBe(true)
  })

  it('宽度守恒：超长 statusText 截断', () => {
    const lines = formatTurnStatus(base({ width: 20, statusText: 'x'.repeat(80) }), fakeTheme())
    expect(displayWidth(lines[0]!)).toBeLessThanOrEqual(20)
  })

  it('宽度守恒：任意宽度 ≤ width', () => {
    for (const width of [80, 40, 20]) {
      for (const line of formatTurnStatus(base({ width }), fakeTheme())) {
        expect(displayWidth(line)).toBeLessThanOrEqual(width)
      }
    }
  })
})
