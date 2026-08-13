/**
 * 顶部栏（format/top-bar.ts）— 纯渲染契约测试（C4 概念稿 A「航图」）。
 *
 * - 启动信息行：cwd + 模型（可选）+ git 分支（可选）；快捷键提示由底部
 *   footer（format/prompt-footer.ts）承担，不在本行。
 * - 分支段 brandColor 强调；📁 图标 ascii 档降级为 `~`（宽度稳定）。
 * - 段优先级：model 先于 branch（窄宽丢 branch 保 model）。
 * - 宽度守恒：任意输入下每行显示宽度 ≤ width，超宽截断尾部。
 */

import { describe, expect, it } from 'vitest'
import type { RivetTheme } from '../src/theme.js'
import { displayWidth } from '../src/width.js'
import { formatTopBar, type FormatTopBarInput } from '../src/format/top-bar.js'

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

function base(over: Partial<FormatTopBarInput> = {}): FormatTopBarInput {
  return { width: 100, cwd: '/app/deepseek-tui/test', modelName: 'deepseek/deepseek-v4', ...over }
}

describe('formatTopBar', () => {
  it('基础行：cwd + 模型（无快捷键提示——由 footer 承担）', () => {
    const [line] = plain(formatTopBar(base(), fakeTheme()))
    expect(line).toContain('/app/deepseek-tui/test')
    expect(line).toContain('deepseek/deepseek-v4')
    expect(line).not.toContain('Ctrl+P')
  })

  it('分支段：branch 提供时以 (branch) 形态渲染', () => {
    const [line] = plain(formatTopBar(base({ branch: 'main' }), fakeTheme()))
    expect(line).toContain('(main)')
  })

  it('无分支：不渲染分支段', () => {
    const [line] = plain(formatTopBar(base(), fakeTheme()))
    expect(line).not.toContain('(')
    expect(line).not.toContain(')')
  })

  it('窄宽丢段顺序：branch 先于 model（model 优先保留）', () => {
    // width 55：base(29) + model(19) = 51 放得下，+ branch(6) = 60 超 → 丢 branch 保 model
    const [line] = plain(formatTopBar(base({ width: 55, branch: 'main' }), fakeTheme()))
    expect(line).toContain('deepseek/deepseek-v4')
    expect(line).not.toContain('main')
  })

  it('ascii：📁 降级为 ~（宽度稳定字符）', () => {
    const [line] = plain(formatTopBar(base({ ascii: true }), fakeTheme()))
    if (line === undefined) throw new Error('top bar must render at least one line')
    expect(line.startsWith('~')).toBe(true)
    const [unicode] = plain(formatTopBar(base(), fakeTheme()))
    if (unicode === undefined) throw new Error('top bar must render at least one line')
    expect(unicode.startsWith('📁')).toBe(true)
  })

  it('宽度守恒：任意宽度下每行显示宽度 ≤ width', () => {
    for (const width of [100, 80, 60, 40, 20]) {
      const lines = formatTopBar(base({ width }), fakeTheme())
      for (const line of lines) {
        expect(displayWidth(line)).toBeLessThanOrEqual(width)
      }
    }
  })

  it('超宽截断：尾部省略号（宽度守恒优先）', () => {
    const lines = formatTopBar(base({ width: 18 }), fakeTheme())
    expect(displayWidth(lines[0]!)).toBeLessThanOrEqual(18)
    expect(plain(lines)[0]).toMatch(/…$/)
  })
})
