/**
 * format/reasoning — think 推理渲染契约测试。
 *
 * - formatReasoningLive：shimmer 头行（✻ 思考中…）+ 尾 N 行暗色推理，
 *   wrap 显示行封顶、compact 仅头行、<1s 不显示耗时、expanded 渲染全文。
 * - formatReasoningBlock：静态头行（✻ 思考 (Ns) · N 行），默认折叠
 *   （仅头行，对标竞品）；expanded 渲染全文；compact 仅头行。
 *
 * 纯函数层：文本 + tick/耗时 + 主题 → ANSI 行数组。
 */

import { describe, expect, it } from 'vitest'
import type { RivetTheme } from '../src/theme.js'
import {
  formatReasoningBlock,
  formatReasoningLive,
  reasoningTailBudget,
  REASONING_TAIL_LINES,
} from '../src/format/reasoning.js'
import { pinTuiEnvBaseline } from './env-baseline.js'

pinTuiEnvBaseline()

function fakeTheme(): RivetTheme {
  return {
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
  }
}

/** 剥离 ANSI 转义。 */
function plain(lines: readonly string[]): string[] {
  return lines.map(l => l.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, ''))
}

describe('formatReasoningLive', () => {
  it('头行 ✻ 思考中… + 尾 N 行推理文本', () => {
    const text = ['step1', 'step2', 'step3', 'step4'].join('\n')
    const lines = plain(formatReasoningLive({ text, tick: 0, columns: 80 }, fakeTheme()))
    expect(lines[0]).toContain('✻ 思考中…')
    expect(lines).toHaveLength(1 + REASONING_TAIL_LINES)
    expect(lines.join('\n')).not.toContain('step1')
    expect(lines.join('\n')).toContain('step4')
  })

  it('耗时 ≥1s 显示秒数；<1s 不显示', () => {
    const withElapsed = plain(formatReasoningLive({ text: '', tick: 0, columns: 80, elapsedMs: 3200 }, fakeTheme()))
    expect(withElapsed[0]).toContain('(3.2s)')
    const fresh = plain(formatReasoningLive({ text: '', tick: 0, columns: 80, elapsedMs: 400 }, fakeTheme()))
    expect(fresh[0]).not.toContain('(')
  })

  it('超宽逻辑行先 wrap 再取尾，显示行不超过 maxRows', () => {
    const long = 'x'.repeat(80)
    const lines = plain(formatReasoningLive({
      text: `old\n${long}`,
      tick: 0,
      columns: 20,
      maxRows: 3,
    }, fakeTheme()))
    const body = lines.slice(1).map(l => l.trim())
    expect(body.join('\n')).not.toContain('old')
    expect(body).toHaveLength(3)
    expect(body.join('').replace(/x/g, '').length).toBe(0)
    expect(body.join('').length).toBeLessThan(80)
  })

  it('compact → 仅头行', () => {
    const lines = formatReasoningLive({ text: 'a\nb\nc', tick: 0, columns: 80, compact: true }, fakeTheme())
    expect(lines).toHaveLength(1)
  })

  it('expanded → 渲染全部推理行（不截尾）', () => {
    const text = ['step1', 'step2', 'step3', 'step4'].join('\n')
    const lines = plain(formatReasoningLive({ text, tick: 0, columns: 80, expanded: true }, fakeTheme()))
    expect(lines).toHaveLength(1 + 4)
    expect(lines.join('\n')).toContain('step1')
    expect(lines.join('\n')).toContain('step4')
  })

  it('空文本 → 仅头行', () => {
    expect(formatReasoningLive({ text: '', tick: 0, columns: 80 }, fakeTheme())).toHaveLength(1)
  })

  it('maxRows 覆盖默认尾巴行数', () => {
    const text = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].join('\n')
    const lines = plain(formatReasoningLive({ text, tick: 0, columns: 80, maxRows: 6 }, fakeTheme()))
    expect(lines).toHaveLength(1 + 6)
    expect(lines.join('\n')).not.toContain('a')
    expect(lines.join('\n')).toContain('b')
    expect(lines.join('\n')).toContain('g')
  })
})

describe('reasoningTailBudget', () => {
  it('随终端高度在 3–6 之间缩放', () => {
    expect(reasoningTailBudget(50)).toBe(6)
    expect(reasoningTailBudget(40)).toBe(6)
    expect(reasoningTailBudget(24)).toBe(4)
    expect(reasoningTailBudget(18)).toBe(3)
    expect(reasoningTailBudget(0)).toBe(4)
  })
})

describe('formatReasoningBlock', () => {
  it('默认折叠：静态头行 ✻ 思考 (Ns) · N 行，正文不渲染', () => {
    const lines = plain(formatReasoningBlock({ text: '第一段\n\n第二段', elapsedMs: 5000 }, fakeTheme()))
    expect(lines[0]).toContain('✻ 思考 (5.0s)')
    expect(lines[0]).toContain('· 2 行')
    expect(lines[0]).not.toContain('思考中')
    expect(lines).toHaveLength(1)
  })

  it('expanded → 头行 + 推理全文（含空行段落）', () => {
    const lines = plain(formatReasoningBlock({ text: '第一段\n\n第二段', elapsedMs: 5000, expanded: true }, fakeTheme()))
    expect(lines[0]).toContain('✻ 思考 (5.0s)')
    expect(lines[0]).not.toContain('思考中')
    expect(lines.slice(1)).toEqual(['  第一段', '', '  第二段'])
  })

  it('无耗时 → 头行不带括号；空文本不计数', () => {
    const lines = plain(formatReasoningBlock({ text: 'x' }, fakeTheme()))
    expect(lines[0]).toBe('✻ 思考 · 1 行')
    const empty = plain(formatReasoningBlock({ text: '' }, fakeTheme()))
    expect(empty[0]).toBe('✻ 思考')
  })

  it('compact → 仅头行，正文跳过（expanded 也不渲染）', () => {
    const lines = formatReasoningBlock({ text: '很长的内心戏', elapsedMs: 1000, compact: true, expanded: true }, fakeTheme())
    expect(lines).toHaveLength(1)
  })

  it('空文本 → 仅头行；尾随换行剥除', () => {
    expect(formatReasoningBlock({ text: '' }, fakeTheme())).toHaveLength(1)
    expect(plain(formatReasoningBlock({ text: 'x\n\n\n', expanded: true }, fakeTheme()))).toHaveLength(2)
  })
})
