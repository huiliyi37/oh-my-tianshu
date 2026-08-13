/**
 * tool-status — 工具卡状态形色双通道辅助（RED 基线）。
 *
 * 覆盖：
 * - toolRunStatus：isError/isQuestion/streaming → 状态枚举（错误 > 待答 > 进行中）
 * - toolStatusColor：状态 → 主题语义色（error/warning/dim/success）
 * - toolStatusGlyph：状态 → 字形（成功 › / 错误 ✗x / 待答 ? / 进行中 ⠋ 或动画）
 */

import { describe, expect, it } from 'vitest'
import type { RivetTheme } from '../src/theme.js'
import {
  toolRunStatus,
  toolStatusColor,
  toolStatusGlyph,
  type ToolRunStatus,
} from '../src/tool-status.js'

function fakeTheme(): RivetTheme {
  return {
    primary: '#111111', secondary: '#222222', success: '#333333',
    warning: '#444444', error: '#555555', dim: '#666666', muted: '#777777',
    pulseQuiet: '#888888', pulseActive: '#999999', pulseAlert: '#aaaaaa',
    userColor: '#bbbbbb', assistantColor: '#cccccc', systemColor: '#dddddd',
    brandColor: '#eeeeee', toolColor: () => '#000000', contextColor: () => '#000000',
  }
}

describe('toolRunStatus — 状态推导（错误 > 待答 > 进行中 > 成功）', () => {
  it('isError 优先', () => {
    expect(toolRunStatus({ isError: true, streaming: true })).toBe('error')
    expect(toolRunStatus({ isError: true, isQuestion: true })).toBe('error')
  })

  it('isQuestion 次之', () => {
    expect(toolRunStatus({ isQuestion: true, streaming: true })).toBe('question')
  })

  it('streaming → running；缺省 → success', () => {
    expect(toolRunStatus({ streaming: true })).toBe('running')
    expect(toolRunStatus({})).toBe('success')
  })
})

describe('toolStatusColor — 状态 → 主题语义色', () => {
  const theme = fakeTheme()

  it('success → success 色', () => {
    expect(toolStatusColor('success', theme)).toBe(theme.success)
  })
  it('error → error 色', () => {
    expect(toolStatusColor('error', theme)).toBe(theme.error)
  })
  it('question → warning 色', () => {
    expect(toolStatusColor('question', theme)).toBe(theme.warning)
  })
  it('running → dim 色', () => {
    expect(toolStatusColor('running', theme)).toBe(theme.dim)
  })
})

describe('toolStatusGlyph — 状态 → 字形', () => {
  it('success → ›；error → ✗（ascii x）；question → ?', () => {
    expect(toolStatusGlyph('success', false)).toBe('›')
    expect(toolStatusGlyph('error', false)).toBe('✗')
    expect(toolStatusGlyph('error', true)).toBe('x')
    expect(toolStatusGlyph('question', false)).toBe('?')
  })

  it('running 无 tick → 静态 ⠋（ascii -）', () => {
    expect(toolStatusGlyph('running', false)).toBe('⠋')
    expect(toolStatusGlyph('running', true)).toBe('-')
  })

  it('running 带 tick → 动画帧（盲文 / ascii 四帧）', () => {
    const braille = toolStatusGlyph('running', false, { tick: 0 })
    const ascii = toolStatusGlyph('running', true, { tick: 0 })
    // 动画帧必须不同于静态 glyph，且 ascii 帧在四帧池内
    expect(braille).not.toBe('⠋')
    expect(['-', '\\', '|', '/']).toContain(ascii)
  })

  it('running 静态可覆盖 idleGlyph（live 卡 ●）', () => {
    expect(toolStatusGlyph('running', false, { idleGlyph: '●' })).toBe('●')
  })

  it('negative tick 归一化到帧池（tick -1 → 帧 3）', () => {
    expect(toolStatusGlyph('running', true, { tick: -1 })).toBe('/')
  })

  it('状态枚举齐全（编译期契约）', () => {
    const statuses: readonly ToolRunStatus[] = ['success', 'error', 'running', 'question']
    for (const s of statuses) {
      expect(typeof toolStatusGlyph(s, false)).toBe('string')
      expect(typeof toolStatusColor(s, fakeTheme())).toBe('string')
    }
  })
})
