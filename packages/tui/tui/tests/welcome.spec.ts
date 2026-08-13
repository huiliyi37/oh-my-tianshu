/**
 * 启动欢迎面（format/welcome.ts）— 纯渲染契约测试。
 *
 * - 品牌区 formatBrandWelcome：主标/副标各一行，水平居中
 * - 菜单 formatWelcomeMenu：整块居中，label 左 BOLD + keyHint 右对齐
 * - 环境行 formatEnvCheckLine：单行 API/Git/终端/背景
 * - 宽度守恒：任何输入下每行显示宽度 ≤ width
 */

import { describe, expect, it } from 'vitest'
import type { RivetTheme } from '../src/theme.js'
import { displayWidth } from '../src/width.js'
import {
  formatBrandWelcome,
  formatEnvCheckLine,
  formatWelcomeMenu,
  type FormatWelcomeMenuInput,
  type WelcomeEnvCheck,
} from '../src/format/welcome.js'

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

describe('formatBrandWelcome（欢迎页品牌区）', () => {
  it('两行：主标 DSH 居中 BOLD + 副标居中 muted，宽度守恒', () => {
    const lines = formatBrandWelcome({ width: 80 }, fakeTheme())
    expect(lines.length).toBe(2)
    const [brand, sub] = plain(lines)
    expect(brand!.trim()).toBe('DSH')
    expect(brand!.indexOf('DSH')).toBeGreaterThan(0) // 居中（前导空格）
    expect(sub!.trim()).toBe('Tianshu Harness')
    expect(lines[0]).toContain('\x1B[1m') // 主标 BOLD
    expect(displayWidth(lines[0]!)).toBeLessThanOrEqual(80)
    expect(displayWidth(lines[1]!)).toBeLessThanOrEqual(80)
  })

  it('自定义 brand/subtitle 生效', () => {
    const lines = formatBrandWelcome({ width: 40, brand: 'X', subtitle: 'Hello' }, fakeTheme())
    const [brand, sub] = plain(lines)
    expect(brand!.trim()).toBe('X')
    expect(sub!.trim()).toBe('Hello')
  })

  it('窄宽：主标/副标截断，宽度守恒', () => {
    const lines = formatBrandWelcome({ width: 6, subtitle: 'Very Long Subtitle' }, fakeTheme())
    for (const line of lines) {
      expect(displayWidth(line)).toBeLessThanOrEqual(6)
    }
    expect(plain(lines)[1]).toBe('Very L') // 副标截断到 6 列
  })

  it('width ≤ 0 → 空数组', () => {
    expect(formatBrandWelcome({ width: 0 }, fakeTheme())).toEqual([])
  })
})

describe('formatWelcomeMenu（欢迎页菜单入口，居中）', () => {
  function items() {
    return [
      { id: 'new', label: '新会话', keyHint: 'ctrl+n' },
      { id: 'resume', label: '恢复会话', keyHint: 'ctrl+s' },
      { id: 'quit', label: '退出', keyHint: 'ctrl+q' },
    ]
  }

  function menu(over: Partial<FormatWelcomeMenuInput> = {}): FormatWelcomeMenuInput {
    return { width: 80, items: items(), ...over }
  }

  it('整块水平居中：label 左对齐同一列、keyHint 右对齐到行尾', () => {
    const lines = plain(formatWelcomeMenu(menu(), fakeTheme()))
    expect(lines.length).toBe(3)
    expect(lines[0]).toContain('新会话')
    expect(lines[0]!.trimEnd().endsWith('ctrl+n')).toBe(true)
    expect(lines[1]!.trimEnd().endsWith('ctrl+s')).toBe(true)
    expect(lines[2]!.trimEnd().endsWith('ctrl+q')).toBe(true)
    // 居中：首行前导空格 > 0（非左对齐贴边）
    const col0 = lines[0]!.indexOf('新会话')
    expect(col0).toBeGreaterThan(0)
    // 三行 label 左对齐到同一列
    expect(col0).toBe(lines[1]!.indexOf('恢复会话'))
    expect(col0).toBe(lines[2]!.indexOf('退出'))
  })

  it('宽度守恒：任意宽度下每行显示宽度 ≤ width', () => {
    for (const width of [80, 60, 40, 30, 20]) {
      const lines = formatWelcomeMenu(menu({ width }), fakeTheme())
      for (const line of lines) {
        expect(displayWidth(line)).toBeLessThanOrEqual(width)
      }
    }
  })

  it('available=false：整行 muted 降级，label 仍在', () => {
    const item = { id: 'resume', label: '恢复会话', keyHint: 'ctrl+s', available: false }
    const [line] = plain(formatWelcomeMenu(menu({ items: [item] }), fakeTheme()))
    expect(line).toContain('恢复会话')
    expect(line).not.toContain('ctrl+s') // 不可用项不显示快捷键
    const raw = formatWelcomeMenu(menu({ items: [item] }), fakeTheme())
    expect(raw[0]).toContain('\x1B[')
  })

  it('超长 label：截断保留 label、丢弃 keyHint（label 优先）', () => {
    const long = 'x'.repeat(100)
    const lines = formatWelcomeMenu(menu({ width: 40, items: [{ id: 'a', label: long, keyHint: 'ctrl+x' }] }), fakeTheme())
    expect(displayWidth(lines[0]!)).toBeLessThanOrEqual(40)
    expect(plain(lines)[0]).not.toContain('ctrl+x')
  })

  it('空 items：返回空数组', () => {
    expect(formatWelcomeMenu(menu({ items: [] }), fakeTheme())).toEqual([])
  })
})

describe('formatEnvCheckLine（环境检查紧凑行）', () => {
  function env(over: Partial<WelcomeEnvCheck> = {}): WelcomeEnvCheck {
    return { hasApiKey: true, isGitRepo: true, background: 'dark', cols: 100, rows: 30, ...over }
  }

  it('单行含 API/Git/终端/背景，宽度守恒', () => {
    const [line] = formatEnvCheckLine(env(), fakeTheme())
    const text = plain([line!])[0]
    expect(text).toBe('API Key ✓ · Git ✓ · 100×30 · dark')
    expect(displayWidth(line!)).toBeLessThanOrEqual(100)
  })

  it('缺 API key / 非 git → ✗', () => {
    const [line] = formatEnvCheckLine(env({ hasApiKey: false, isGitRepo: false }), fakeTheme())
    expect(plain([line!])[0]).toBe('API Key ✗ · Git ✗ · 100×30 · dark')
  })

  it('cols ≤ 0 → 空数组', () => {
    expect(formatEnvCheckLine(env({ cols: 0 }), fakeTheme())).toEqual([])
  })
})
