/**
 * top-status-bar.spec.ts — 顶边状态栏纯函数（omp 风格嵌入输入框顶轨）。
 *
 * 契约：左右段分色拼接、secondary 填充、右段从尾部丢、极窄回落纯横线轨、
 * 宽度守恒（任何输入下显示宽度 ≤ width）。
 */
import { describe, expect, it } from 'vitest'
import type { RivetTheme } from '../src/theme.js'
import { displayWidth } from '../src/width.js'
import { formatTopStatusBar } from '../src/format/top-status-bar.js'

function fakeTheme(): RivetTheme {
  return {
    primary: '#111111', secondary: '#222222', success: '#333333',
    warning: '#444444', error: '#555555', dim: '#666666', muted: '#777777',
    pulseQuiet: '#888888', pulseActive: '#999999', pulseAlert: '#aaaaaa',
    userColor: '#bbbbbb', assistantColor: '#cccccc', systemColor: '#dddddd',
    brandColor: '#eeeeee', toolColor: () => '#000000', contextColor: () => '#000000',
  }
}

function plain(s: string): string {
  return s.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
}

describe('formatTopStatusBar', () => {
  it('左段 + 填充 + 右段嵌进顶轨，宽度恰为 width', () => {
    const line = formatTopStatusBar({
      width: 60, left: ['deepseek-v4-flash', 'effort:max'], right: ['缓存 80%', 'API ✓'], borderColor: '#556677',
    }, fakeTheme())
    const flat = plain(line)
    // 分隔符随终端档位：unicode ›/‹，ascii 降级 >/<
    expect(flat).toMatch(/^╭─deepseek-v4-flash [>›] effort:max─+缓存 80% [<‹] API ✓─╮$/)
    expect(displayWidth(line)).toBe(60)
  })

  it('窄宽从尾部丢右段（最次要先行），左段保留', () => {
    const line = formatTopStatusBar({
      width: 20, left: ['mock'], right: ['缓存 80%', 'API ✗'], borderColor: '#556677',
    }, fakeTheme())
    const flat = plain(line)
    expect(flat).toContain('mock')
    expect(flat).toContain('缓存 80%') // 尾部的 API 先丢，缓存仍在
    expect(flat).not.toContain('API ✗')
    expect(displayWidth(line)).toBe(20)
  })

  it('再窄只剩左段；左段也放不下则截断；段全空回落纯横线轨', () => {
    const only = formatTopStatusBar({ width: 14, left: ['mock'], right: ['API ✗'], borderColor: '#556677' }, fakeTheme())
    expect(plain(only)).toMatch(/^╭─mock─+╮$/)
    const rail = formatTopStatusBar({ width: 20, left: [], right: [], borderColor: '#556677' }, fakeTheme())
    expect(plain(rail)).toBe('╭' + '─'.repeat(18) + '╮')
    const tiny = formatTopStatusBar({ width: 10, left: ['mock'], right: [], borderColor: '#556677' }, fakeTheme())
    expect(displayWidth(tiny)).toBeLessThanOrEqual(10)
  })

  it('宽度守恒扫频：8..60 任意宽度不破版', () => {
    for (let w = 8; w <= 60; w++) {
      const line = formatTopStatusBar({
        width: w, left: ['deepseek-v4-flash', 'effort:max'], right: ['缓存 80%', '上下文 12%', '◧ 11.7k/1.00M', 'API ✓'], borderColor: '#556677',
      }, fakeTheme())
      expect(displayWidth(line)).toBeLessThanOrEqual(w)
    }
  })
})
