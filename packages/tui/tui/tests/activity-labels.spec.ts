/**
 * 实时活动标签（format/activity-labels.ts）— 纯渲染契约测试。
 *
 * - 词池轮换是纯函数：`seq` 入参决定池内下标（投影器维护单调序号），
 *   无模块级计数器 → 同一 seq 恒同一词（可复现）。
 * - tool_use / lifecycle 的 detail 截断到 40 字符。
 * - 返回 LiveRegionLine[]，单行。
 */

import { describe, expect, it } from 'vitest'
import type { RivetTheme } from '../src/theme.js'
import {
  activityPhrase,
  formatActivityLabel,
  type ActivityKind,
} from '../src/format/activity-labels.js'

function fakeTheme(): RivetTheme {
  return {
    primary: '#111111', secondary: '#222222', success: '#333333',
    warning: '#444444', error: '#555555', dim: '#666666', muted: '#777777',
    pulseQuiet: '#888888', pulseActive: '#999999', pulseAlert: '#aaaaaa',
    userColor: '#bbbbbb', assistantColor: '#cccccc', systemColor: '#dddddd',
    brandColor: '#eeeeee', toolColor: () => '#000000', contextColor: () => '#000000',
  }
}

function plain(line: { text: string }): string {
  return line.text.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
}

describe('activityPhrase', () => {
  it('tool_use：调用 <detail>；无 detail 回退「调用工具」', () => {
    expect(activityPhrase({ kind: 'tool_use', detail: 'read_file', seq: 0 })).toBe('调用 read_file')
    expect(activityPhrase({ kind: 'tool_use', seq: 0 })).toBe('调用工具')
  })

  it('tool_use：detail 超过 40 字符截断', () => {
    const long = 'x'.repeat(100)
    const phrase = activityPhrase({ kind: 'tool_use', detail: long, seq: 0 })
    expect(phrase).toBe(`调用 ${'x'.repeat(40)}`)
    expect(phrase.length).toBeLessThanOrEqual(44)
  })

  it('thinking：seq 轮换词池，周期回绕', () => {
    const first = activityPhrase({ kind: 'thinking', seq: 0 })
    expect(first).toBeTruthy()
    // 周期 = 池长；seq 0 与 seq 池长 同词
    expect(activityPhrase({ kind: 'thinking', seq: 6 })).toBe(first)
    // 相邻 seq 换词
    expect(activityPhrase({ kind: 'thinking', seq: 1 })).not.toBe(first)
  })

  it('tool_result：词池轮换', () => {
    const a = activityPhrase({ kind: 'tool_result', seq: 0 })
    const b = activityPhrase({ kind: 'tool_result', seq: 1 })
    expect(a).not.toBe(b)
    expect(activityPhrase({ kind: 'tool_result', seq: 4 })).toBe(a)
  })

  it('text：写作态词池轮换', () => {
    const a = activityPhrase({ kind: 'text', seq: 0 })
    const b = activityPhrase({ kind: 'text', seq: 1 })
    expect(a).not.toBe(b)
    expect(activityPhrase({ kind: 'text', seq: 6 })).toBe(a)
  })

  it('seq 为 NaN：取模结果 NaN，回退池首（防御分支）', () => {
    expect(activityPhrase({ kind: 'thinking', seq: NaN })).toBe('思考中')
  })

  it('lifecycle：detail 优先，无则「补偿轮」', () => {
    expect(activityPhrase({ kind: 'lifecycle', detail: '进入验证阶段', seq: 0 })).toBe('进入验证阶段')
    expect(activityPhrase({ kind: 'lifecycle', seq: 0 })).toBe('补偿轮')
  })
})

describe('formatActivityLabel', () => {
  it('返回单行 LiveRegionLine，含前缀 glyph 与短语', () => {
    const line = formatActivityLabel({ kind: 'tool_use', detail: 'bash', seq: 0 }, fakeTheme())
    expect(line).toHaveLength(1)
    expect(plain(line[0]!)).toContain('调用 bash')
  })

  it('ascii glyph：`>` 前缀', () => {
    expect(plain(formatActivityLabel({ kind: 'thinking', seq: 0, ascii: true }, fakeTheme())[0]!)).toMatch(/^>/)
  })

  it('每个 kind 都渲染（颜色映射不抛错）', () => {
    const kinds: ActivityKind[] = ['tool_use', 'tool_result', 'thinking', 'lifecycle', 'text']
    for (const kind of kinds) {
      const line = formatActivityLabel({ kind, seq: 0 }, fakeTheme())
      expect(line).toHaveLength(1)
      expect(plain(line[0]!)).toBeTruthy()
    }
  })
})
