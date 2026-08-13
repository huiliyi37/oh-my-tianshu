/**
 * slash 命令下拉菜单（format/slash-menu.ts）— 纯渲染契约测试（grok slash_dropdown 移植）。
 *
 * - 行形态：选中 ❯ /name + label 列对齐 + 描述截断；未选中两空格前缀
 * - 选中行 label primary+bold，未选中 muted，描述 muted
 * - argsHint 并入 label 列；maxRows 滚动窗口 + 「↑↓ 还有 N 项」提示
 * - ascii 降级（❯ → >、↑↓ → ^v）；宽度守恒：任意宽度下每行 ≤ width
 */

import { describe, expect, it } from 'vitest'
import type { RivetTheme } from '../src/theme.js'
import { displayWidth } from '../src/width.js'
import { formatSlashMenu, SLASH_MENU_MAX_ROWS, type FormatSlashMenuInput } from '../src/format/slash-menu.js'

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

function base(over: Partial<FormatSlashMenuInput> = {}): FormatSlashMenuInput {
  return {
    width: 100,
    items: [
      { name: 'model', description: '切换模型', argsHint: '<name>' },
      { name: 'clear', description: '清空当前会话' },
      { name: 'theme', description: '切换主题' },
    ],
    selected: 0,
    ...over,
  }
}

describe('formatSlashMenu — 基础形态', () => {
  it('空 items → 空数组；width ≤ 0 → 空数组', () => {
    expect(formatSlashMenu(base({ items: [] }), fakeTheme())).toEqual([])
    expect(formatSlashMenu(base({ width: 0 }), fakeTheme())).toEqual([])
    expect(formatSlashMenu(base({ width: -5 }), fakeTheme())).toEqual([])
  })

  it('选中行 ❯ 前缀 + primary+bold；未选中行两空格前缀 + muted', () => {
    const lines = formatSlashMenu(base({ selected: 0 }), fakeTheme())
    const [first] = plain(lines)
    expect(first).toContain('❯ /model <name>')
    expect(lines[0]).toContain('\x1B[38;2;17;17;17m') // #111111 primary
    const second = plain(lines)[1] ?? ''
    expect(second).toContain('  /clear')
    expect(lines[1]).toContain('\x1B[38;2;119;119;119m') // #777777 muted
  })

  it('描述在 label 列后对齐（固定间隙 + 剩余宽度截断）', () => {
    const [line] = plain(formatSlashMenu(base(), fakeTheme()))
    expect(line).toContain('切换模型')
    // selected=1 时选中行是第二行（/clear）：label 列 = 最长 label
    // （/model <name> = 13 字符）→ 描述起点对齐
    const lines = plain(formatSlashMenu(base({ selected: 1 }), fakeTheme()))
    expect(lines[1]).toContain('清空当前会话')
  })

  it('无 argsHint 命令：label 列只含 /name', () => {
    const lines = plain(formatSlashMenu(base({ selected: 1 }), fakeTheme()))
    expect(lines[1]).toContain('❯ /clear')
    expect(lines[1]).not.toContain('clear <')
  })

  it('宽度守恒：任意宽度下每行显示宽度 ≤ width', () => {
    for (const width of [4, 8, 20, 48, 100, 140]) {
      for (const selected of [0, 1, 2]) {
        const lines = formatSlashMenu(base({ width, selected }), fakeTheme())
        for (const line of lines) {
          expect(displayWidth(line)).toBeLessThanOrEqual(width)
        }
      }
    }
  })

  it('极端窄宽（<4 列）：退化为一截断前缀行（不破版）', () => {
    for (const width of [1, 2, 3]) {
      for (const ascii of [false, true]) {
        const lines = plain(formatSlashMenu(base({ width, ascii }), fakeTheme()))
        expect(displayWidth(lines[0] ?? '')).toBeLessThanOrEqual(width)
        if (ascii) expect(lines[0]).toContain('>')
      }
    }
  })

  it('ascii：❯ → >、↑↓ → ^v', () => {
    const lines = plain(formatSlashMenu(base({ ascii: true }), fakeTheme()))
    expect(lines[0]).toContain('> /model')
    expect(lines[0]).not.toContain('❯')
    // ascii 滚动提示
    const many = Array.from({ length: 20 }, (_, i) => ({ name: `c${i}`, description: `d${i}` }))
    const scrolled = plain(formatSlashMenu(base({ items: many, ascii: true, width: 60 }), fakeTheme()))
    expect(scrolled[scrolled.length - 1]).toContain('^v')
  })
})

describe('formatSlashMenu — 滚动窗口', () => {
  const many = Array.from({ length: 20 }, (_, i) => ({
    name: `cmd${String(i).padStart(2, '0')}`,
    description: `命令 ${i}`,
  }))

  it('总数 ≤ maxRows：全量展示、无提示行', () => {
    const lines = formatSlashMenu(base({ items: many.slice(0, 5) }), fakeTheme())
    expect(lines).toHaveLength(5)
  })

  it('总数 > maxRows：窗口 + 「↑↓ 还有 N 项」提示', () => {
    const lines = formatSlashMenu(base({ items: many, selected: 0, width: 60 }), fakeTheme())
    expect(lines).toHaveLength(SLASH_MENU_MAX_ROWS + 1)
    const last = plain(lines)[lines.length - 1] ?? ''
    expect(last).toContain(`还有 ${many.length - SLASH_MENU_MAX_ROWS} 项`)
  })

  it('selected 越出窗口时窗口平移保持其可见（末尾选中）', () => {
    const lines = plain(formatSlashMenu(base({ items: many, selected: 19, width: 60 }), fakeTheme()))
    expect(lines[0]).toContain('/cmd12') // 窗口 [12, 20)
    expect(lines[SLASH_MENU_MAX_ROWS - 1]).toContain('❯ /cmd19')
  })

  it('selected 越出窗口时窗口平移保持其可见（开头选中）', () => {
    const lines = plain(formatSlashMenu(base({ items: many, selected: 0, width: 60 }), fakeTheme()))
    expect(lines[0]).toContain('❯ /cmd00')
    expect(lines[SLASH_MENU_MAX_ROWS - 1]).toContain('/cmd07')
  })

  it('maxRows ≤ 0：按缺省 SLASH_MENU_MAX_ROWS 处理', () => {
    const lines = formatSlashMenu(base({ items: many, selected: 0, maxRows: 0, width: 60 }), fakeTheme())
    expect(lines).toHaveLength(SLASH_MENU_MAX_ROWS + 1)
  })

  it('自定义 maxRows（> 0）：窗口按该值截断', () => {
    const lines = formatSlashMenu(base({ items: many, selected: 0, maxRows: 3, width: 60 }), fakeTheme())
    expect(lines).toHaveLength(4) // 3 行窗口 + 提示行
  })
})
