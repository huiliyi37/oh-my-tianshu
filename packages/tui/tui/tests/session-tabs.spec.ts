/**
 * session-tabs.spec.ts — 会话 tab 栏纯渲染（format/session-tabs.ts）。
 *
 * 覆盖：多 tab 渲染 + 当前 ● 高亮、窄宽丢旧 tab + 折叠 `+N`、当前 tab 恒保留、
 * 空态、宽度守恒。
 */
import { describe, expect, it } from 'vitest'
import type { RivetTheme } from '../src/theme.js'
import { displayWidth } from '../src/width.js'
import { formatSessionTabs, type SessionTab } from '../src/format/session-tabs.js'

function fakeTheme(): RivetTheme {
  return {
    primary: '#111111', secondary: '#222222', success: '#333333',
    warning: '#444444', error: '#555555', dim: '#666666', muted: '#777777',
    pulseQuiet: '#888888', pulseActive: '#999999', pulseAlert: '#aaaaaa',
    userColor: '#bbbbbb', assistantColor: '#cccccc', systemColor: '#dddddd',
    brandColor: '#eeeeee', toolColor: () => '#000000', contextColor: () => '#000000',
  }
}

function plain(lines: readonly { text: string }[]): string[] {
  return lines.map(l => l.text.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, ''))
}

const tabs: SessionTab[] = [
  { id: 'session-aaaa', label: 's-aaaa' },
  { id: 'session-bbbb', label: 's-bbbb' },
  { id: 'session-cccc', label: 's-cccc', current: true },
]

describe('formatSessionTabs', () => {
  it('多 tab 渲染,当前 ● 标记', () => {
    const rows = plain(formatSessionTabs(tabs, 60, fakeTheme()))
    expect(rows[0]).toBe('[s-aaaa] [s-bbbb] [s-cccc●]')
  })

  it('空数组 → 不渲染', () => {
    expect(formatSessionTabs([], 60, fakeTheme())).toEqual([])
  })

  it('单 tab(仅当前)→ 仍渲染一行', () => {
    const rows = plain(formatSessionTabs([tabs[2]!], 60, fakeTheme()))
    expect(rows[0]).toBe('[s-cccc●]')
  })

  it('窄宽:丢最旧非当前 tab,折叠为 +N', () => {
    // 全量 25 宽;[s-aaaa] [s-bbbb] [s-cccc●] +1 = 30 → 丢一个变 25
    const rows = plain(formatSessionTabs(tabs, 24, fakeTheme()))
    expect(rows[0]).toBe('[s-bbbb] [s-cccc●] +1')
  })

  it('当前 tab 恒保留(先丢非当前)', () => {
    // 极端窄:只放得下当前 tab + 折叠
    const rows = plain(formatSessionTabs(tabs, 15, fakeTheme()))
    expect(rows[0]).toContain('[s-cccc●]')
    expect(rows[0]).toContain('+2')
  })

  it('只剩当前仍超宽 → 截断补 …(不丢当前)', () => {
    const rows = formatSessionTabs([tabs[2]!], 5, fakeTheme())
    const text = plain(rows)[0]!
    expect(text.length).toBeLessThanOrEqual(5)
    expect(text).toMatch(/…$/)
  })

  it('宽度守恒:任意宽度下每行 ≤ width', () => {
    for (const width of [60, 30, 20, 12, 6]) {
      const rows = formatSessionTabs(tabs, width, fakeTheme())
      for (const row of rows) {
        expect(displayWidth(row.text)).toBeLessThanOrEqual(width)
      }
    }
  })
})
