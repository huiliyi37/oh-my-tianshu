/**
 * 底部 footer（format/prompt-footer.ts）— 纯渲染契约测试（C4 概念稿 C 三行底部区）。
 *
 * - 模式 badge 段（normal / [plan] / [plan…] / [auto]）在前，快捷键提示在后。
 * - 窄宽从后往前丢段（ctrl+p → / 命令 → Enter 发送 → mode），mode 恒保留。
 * - 宽度守恒：任何输入下每行显示宽度 ≤ width。
 */

import { describe, expect, it } from 'vitest'
import type { RivetTheme } from '../src/theme.js'
import { displayWidth } from '../src/width.js'
import { formatPromptFooter, type FormatPromptFooterInput } from '../src/format/prompt-footer.js'

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

function base(over: Partial<FormatPromptFooterInput> = {}): FormatPromptFooterInput {
  return { width: 100, ...over }
}

describe('formatPromptFooter', () => {
  it('默认：normal + 快捷键提示（Enter 发送 / 命令 ctrl+p）', () => {
    const [line = ''] = plain(formatPromptFooter(base(), fakeTheme()))
    expect(line).toContain('normal')
    expect(line).toContain('Enter 发送')
    expect(line).toContain('/ 命令')
    expect(line).toContain('ctrl+p')
  })

  it('planActive：mode 段含 [plan]', () => {
    const [line = ''] = plain(formatPromptFooter(base({ planActive: true }), fakeTheme()))
    expect(line).toContain('normal [plan]')
  })

  it('planPending：mode 段含 [plan…]（优先于 planActive）', () => {
    const [line = ''] = plain(formatPromptFooter(base({ planActive: true, planPending: true }), fakeTheme()))
    expect(line).toContain('[plan…]')
    expect(line).not.toContain('[plan] ·')
  })

  it('approvalPending：快捷键换成 y/n/a/esc', () => {
    const [line = ''] = plain(formatPromptFooter(base({ approvalPending: true }), fakeTheme()))
    expect(line).toContain('y 允许')
    expect(line).toContain('n 拒绝')
    expect(line).toContain('a 放行')
    expect(line).not.toContain('Enter 发送')
  })

  it('宽度守恒：任意宽度下每行显示宽度 ≤ width', () => {
    for (const width of [100, 80, 60, 40, 20]) {
      const lines = formatPromptFooter(base({ width }), fakeTheme())
      for (const line of lines) {
        expect(displayWidth(line)).toBeLessThanOrEqual(width)
      }
    }
  })

  it('窄宽丢段：mode 恒保留，快捷键段从后往前丢', () => {
    // width 12：mode 段（normal=6）放得下，快捷键全部丢弃
    const [line = ''] = plain(formatPromptFooter(base({ width: 12 }), fakeTheme()))
    expect(line).toContain('normal')
    expect(line).not.toContain('ctrl+p')
    // width 30：mode + Enter 发送，/ 命令与 ctrl+p 丢弃
    const [mid = ''] = plain(formatPromptFooter(base({ width: 30 }), fakeTheme()))
    expect(mid).toContain('Enter 发送')
    expect(mid).not.toContain('ctrl+p')
  })

  it('极窄（mode 段也放不下）：退化为 mode 单段（mode 恒保留）', () => {
    const [line = ''] = plain(formatPromptFooter(base({ width: 5 }), fakeTheme()))
    expect(line).toBe('normal')
  })

  it('宽终端：右侧状态段右对齐合并进同一行', () => {
    const [line = ''] = plain(formatPromptFooter(base({
      width: 100,
      rightSegments: ['12.3k', 'deepseek-chat', 'API ✓'],
    }), fakeTheme()))
    expect(line).toContain('normal')
    expect(line).toContain('deepseek-chat')
    expect(line).toContain('API ✓')
    // 左侧在前、右侧在后（右对齐）
    expect(line.indexOf('normal')).toBeLessThan(line.indexOf('deepseek-chat'))
    expect(displayWidth(line)).toBe(100)
  })

  it('右侧段放不下：从后往前丢段，末尾段先丢', () => {
    const [narrow = ''] = plain(formatPromptFooter(base({
      width: 80,
      rightSegments: ['AA', 'BB', 'CC', 'DD', 'EE', 'FF', 'GG', 'HH', 'II', 'JJ', 'KK'],
    }), fakeTheme()))
    expect(narrow).toContain('normal')
    expect(narrow).toContain('AA')
    expect(narrow).not.toContain('KK')
    expect(narrow).not.toContain('AA · BB · CC · DD · EE · FF · GG · HH · II · JJ · KK')
  })

  it('任意宽度：右侧段合并进同一行，不另起第二行', () => {
    const lines = formatPromptFooter(base({
      width: 79,
      rightSegments: ['deepseek-chat', 'effort:high'],
    }), fakeTheme())
    expect(lines).toHaveLength(1)
    const [line = ''] = plain(lines)
    expect(line).toContain('normal')
    expect(line).toContain('deepseek-chat')
    expect(displayWidth(lines[0] ?? '')).toBe(79)
  })

  it('窄宽仍从右丢段，左侧与右侧同处一行', () => {
    const lines = formatPromptFooter(base({
      width: 39,
      rightSegments: ['AA', 'BB', 'CC'],
    }), fakeTheme())
    expect(lines).toHaveLength(1)
    const [line = ''] = plain(lines)
    expect(line).toContain('normal')
    expect(line).toContain('AA')
    expect(line).not.toContain('CC')
  })

  it('右侧段恰好填满：pad=0 仍合并，不丢末段', () => {
    // width 18 → 左侧只剩 `normal`(6)；right 12 → pad=0。旧逻辑 pad>0 会误丢右段。
    const [line = ''] = plain(formatPromptFooter(base({
      width: 18,
      rightSegments: ['xxxxxxxxxxxx'],
    }), fakeTheme()))
    expect(line).toContain('normal')
    expect(line).toContain('xxxxxxxxxxxx')
    expect(displayWidth(formatPromptFooter(base({
      width: 18,
      rightSegments: ['xxxxxxxxxxxx'],
    }), fakeTheme())[0] ?? '')).toBe(18)
  })

  it('空右侧段：与缺省行为一致', () => {
    const [line = ''] = plain(formatPromptFooter(base({ width: 100, rightSegments: [] }), fakeTheme()))
    expect(line).toContain('normal')
    expect(line).toContain('Enter 发送')
  })

  it('雾蓝 chrome：mode 用 inactiveShimmer，提示用 subtle', () => {
    const [line = ''] = formatPromptFooter(base(), fakeTheme())
    expect(line).toContain('\x1B[38;2;170;178;194m')
    expect(line).toContain('\x1B[38;2;94;102;115m')
    expect(line).not.toContain('\x1B[38;2;17;17;17m')
  })
})
