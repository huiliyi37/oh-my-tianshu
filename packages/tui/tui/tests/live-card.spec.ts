/**
 * format/live-card.ts — 活区共享卡片 chrome。
 *
 * 覆盖：状态形、header+optional ⎿ body、suffix 从右丢、终态 muted、ascii 回退。
 */
import { describe, expect, it } from 'vitest'
import type { RivetTheme } from '../src/theme.js'
import { color } from '../src/engine/ansi.js'
import { displayWidth } from '../src/width.js'
import {
  LIVE_CARD_BODY_CONT,
  LIVE_CARD_BODY_FIRST,
  assembleLiveCardSuffixes,
  formatLiveCard,
  liveCardGlyph,
  truncateToLiveWidth,
} from '../src/format/live-card.js'
import { pinTuiEnvBaseline } from './env-baseline.ts'

pinTuiEnvBaseline()

const THEME = {
  primary: '#111111',
  secondary: '#222222',
  success: '#333333',
  warning: '#444444',
  error: '#555555',
  dim: '#666666',
  muted: '#777777',
  pulseQuiet: '#888888',
  pulseActive: '#999999',
  pulseAlert: '#aaaaaa',
  userColor: '#bbbbbb',
  assistantColor: '#cccccc',
  systemColor: '#dddddd',
  brandColor: '#eeeeee',
  toolColor: () => '#000000',
  contextColor: () => '#000000',
} as RivetTheme

describe('liveCardGlyph', () => {
  it('running → ⠋；ascii → -', () => {
    expect(liveCardGlyph('running')).toBe('⠋')
    expect(liveCardGlyph('running', { ascii: true })).toBe('-')
  })

  it('success → ›', () => {
    expect(liveCardGlyph('success')).toBe('›')
  })

  it('error → ✗；ascii → x', () => {
    expect(liveCardGlyph('error')).toBe('✗')
    expect(liveCardGlyph('error', { ascii: true })).toBe('x')
  })

  it('question → ?', () => {
    expect(liveCardGlyph('question')).toBe('?')
  })

  it('running + tick 走盲文帧；ascii 走 -/\\/|', () => {
    expect(liveCardGlyph('running', { tick: 0 })).toBe('⠋')
    expect(liveCardGlyph('running', { tick: 0, ascii: true })).toBe('-')
    expect(liveCardGlyph('running', { tick: 1, ascii: true })).toBe('\\')
  })
})

describe('formatLiveCard', () => {
  it('无 body → 单行 header：glyph + title', () => {
    expect(formatLiveCard({ glyph: '›', title: '↻ 主探索', width: 80 })).toEqual(['› ↻ 主探索'])
  })

  it('有 body → 第二行 ⎿ 前缀', () => {
    const rows = formatLiveCard({
      glyph: '⠋',
      title: '↻ 主探索',
      body: ['Running: bash · 12.3k tok · 1 工具'],
      width: 80,
    })
    expect(rows).toEqual([
      '⠋ ↻ 主探索',
      `${LIVE_CARD_BODY_FIRST}Running: bash · 12.3k tok · 1 工具`,
    ])
  })

  it('indent 同时加在 header 与 body', () => {
    const rows = formatLiveCard({
      glyph: '⠋',
      title: '↻ 主探索',
      body: ['Running: bash'],
      indent: '  ',
      width: 80,
    })
    expect(rows[0]).toBe('  ⠋ ↻ 主探索')
    expect(rows[1]).toBe(`  ${LIVE_CARD_BODY_FIRST}Running: bash`)
  })

  it('header suffix 从右往左丢，title 最后截', () => {
    const rows = formatLiveCard({
      glyph: '›',
      title: '↻ 主探索',
      suffixes: ['✓ 已完成', '2.3s'],
      width: 14,
    })
    expect(rows).toHaveLength(1)
    expect(displayWidth(rows[0] ?? '')).toBeLessThanOrEqual(14)
    expect(rows[0]).toContain('主探索')
    expect(rows[0]).not.toContain('2.3s')
  })

  it('body 多行：首行 ⎿、续行三空格', () => {
    const rows = formatLiveCard({
      glyph: '⠋',
      title: 'pnpm build',
      body: ['compiling', 'still going'],
      width: 80,
    })
    expect(rows[1]).toBe(`${LIVE_CARD_BODY_FIRST}compiling`)
    expect(rows[2]).toBe(`${LIVE_CARD_BODY_CONT}still going`)
  })

  it('dim + theme 把 title 涂 muted；无 theme 时 dim 不着色', () => {
    const muted = formatLiveCard({
      glyph: '›',
      title: '↻ 主探索',
      dim: true,
      theme: THEME,
      width: 80,
    })
    expect(muted[0]).toContain(color('↻ 主探索', THEME.muted))
    const plainDim = formatLiveCard({
      glyph: '›',
      title: '↻ 主探索',
      dim: true,
      width: 80,
    })
    expect(plainDim).toEqual(['› ↻ 主探索'])
  })

  it('空 body 数组视为无 body（单行）', () => {
    expect(formatLiveCard({ glyph: '›', title: 'vitest', body: [], width: 80 })).toEqual(['› vitest'])
  })

  it('极端窄宽不抛错', () => {
    expect(() => formatLiveCard({ glyph: '›', title: '↻ 主探索', body: ['Running: bash'], width: 1 })).not.toThrow()
  })
})

describe('assembleLiveCardSuffixes / truncateToLiveWidth', () => {
  it('suffix 用 · 拼接，超宽从右丢', () => {
    const out = assembleLiveCardSuffixes('› 标题', ['a', 'b', 'c'], 10)
    expect(displayWidth(out)).toBeLessThanOrEqual(10)
    expect(out).toContain('标题')
    expect(out).not.toContain('c')
  })

  it('max ≤ 1 退化为 …', () => {
    expect(truncateToLiveWidth('hello', 1)).toBe('…')
  })
})
