/**
 * Turn 结束统计摘要（format/turn-summary.ts）— 纯渲染契约测试。
 *
 * - 行结构：`turn N · trail · 读X 改Y · ✓Z · elapsed`
 * - trail 按 phase 顺序用 glyph 连接；窄宽时从尾部 drop 次要段。
 * - ascii 入参决定 trail glyph；任何宽度下不破版。
 */

import { describe, expect, it } from 'vitest'
import type { RivetTheme } from '../src/theme.js'
import { displayWidth } from '../src/width.js'
import { formatTurnSummary, type TurnPhase, type TurnSummaryInput } from '../src/format/turn-summary.js'

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

function base(over: Partial<TurnSummaryInput> = {}): TurnSummaryInput {
  return { turnNumber: 3, segments: ['thinking', 'tool', 'done'], filesRead: 12, filesModified: 2, width: 80, ...over }
}

describe('formatTurnSummary', () => {
  it('完整行：turn + trail + 读改 + ✓ + 耗时', () => {
    const [line] = formatTurnSummary(base({ verifiedCount: 4, elapsedMs: 65_000 }), fakeTheme())
    const text = plain([line!])[0]!
    expect(text).toContain('turn 3')
    expect(text).toContain('◐ → ● → ◆')
    expect(text).toContain('读12 改2')
    expect(text).toContain('✓4')
    expect(text).toContain('1m 5s')
  })

  it('无 verified 计数：不渲染 ✓ 段', () => {
    const [line] = formatTurnSummary(base(), fakeTheme())
    expect(plain([line!])[0]).not.toContain('✓')
  })

  it('verifiedCount: 0 → 不渲染 ✓ 段（>0 守卫）', () => {
    const [line] = formatTurnSummary(base({ verifiedCount: 0 }), fakeTheme())
    expect(plain([line!])[0]).not.toContain('✓')
  })

  it('无 segments：不渲染 trail 段', () => {
    const [line] = formatTurnSummary(base({ segments: [] }), fakeTheme())
    expect(plain([line!])[0]).not.toContain('→')
  })

  it('无 elapsedMs：不渲染耗时段', () => {
    const [line] = formatTurnSummary(base(), fakeTheme())
    expect(plain([line!])[0]).not.toMatch(/\d+s/)
  })

  it('ascii：trail 用 ASCII glyph，✓ 用 v', () => {
    const [line] = formatTurnSummary(base({ ascii: true, verifiedCount: 1 }), fakeTheme())
    const text = plain([line!])[0]!
    expect(text).toContain('o → * → !')
    expect(text).toContain('v1')
  })

  it('所有 phase 都有 glyph（含 verifying/streaming）', () => {
    const phases: TurnPhase[] = ['thinking', 'streaming', 'tool', 'verifying', 'done']
    const [line] = formatTurnSummary(base({ segments: phases }), fakeTheme())
    expect(plain([line!])[0]).toContain('◐ → ▸ → ● → ✓ → ◆')
  })

  it('窄宽：drop 尾部段（先掉耗时），仍不破版', () => {
    const [line] = formatTurnSummary(base({ verifiedCount: 4, elapsedMs: 65_000, width: 40 }), fakeTheme())
    const text = plain([line!])[0]!
    expect(displayWidth(text)).toBeLessThanOrEqual(40)
    // 40 列放不下全段（约 44 列），最次要的耗时被 drop
    expect(text).not.toContain('1m 5s')
  })

  it('极窄宽度：只剩 turn 段并截断，不破版', () => {
    const [line] = formatTurnSummary(base({ verifiedCount: 4, elapsedMs: 65_000, width: 12 }), fakeTheme())
    expect(displayWidth(line!)).toBeLessThanOrEqual(12)
  })

  it('超窄宽度（连 turn 段都放不下）→ truncateTo 逐字符截断', () => {
    const [line] = formatTurnSummary(base({ width: 3 }), fakeTheme())
    const text = plain([line!])[0]!
    expect(displayWidth(text)).toBeLessThanOrEqual(3)
  })
})
