/**
 * subagent 对话流状态行（format/subagent-line.ts）— 纯渲染契约测试
 * （grok scrollback/blocks/subagent.rs 移植，dsh 精简版）。
 *
 * - 运行中：`⠋ 子代理 <label>`（braille spinner 帧随 tick），ascii 降级 `*`
 * - 终态：completed ✓（success 色）/ aborted ◌（muted）/ 其余 ✗（error 色）
 *   + 耗时；error/max-tokens/refusal/未知带 reason 后缀
 * - 宽度守恒：任意宽度下每行 ≤ width（label 截断优先于 reason）
 */

import { describe, expect, it } from 'vitest'
import { brailleSpinnerFrame } from '../src/braille-spinner.js'
import type { RivetTheme } from '../src/theme.js'
import { displayWidth } from '../src/width.js'
import { formatSubagentDone, formatSubagentRunning } from '../src/format/subagent-line.js'

function fakeTheme(): RivetTheme {
  return {
    primary: '#111111', secondary: '#222222', success: '#333333',
    warning: '#444444', error: '#555555', dim: '#666666', muted: '#777777',
    pulseQuiet: '#888888', pulseActive: '#999999', pulseAlert: '#aaaaaa',
    userColor: '#bbbbbb', assistantColor: '#cccccc', systemColor: '#dddddd',
    brandColor: '#eeeeee', toolColor: () => '#000000', contextColor: () => '#000000',
  }
}

function plain(line: string): string {
  return line.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
}

describe('formatSubagentRunning', () => {
  it('braille spinner 帧随 tick 变化', () => {
    const [l0 = ''] = formatSubagentRunning({ width: 80, label: 'abc12345', tick: 0 }, fakeTheme())
    const [l1 = ''] = formatSubagentRunning({ width: 80, label: 'abc12345', tick: 1 }, fakeTheme())
    expect(plain(l0)).toBe('⠋ 子代理 abc12345')
    expect(plain(l1)).toBe(`${brailleSpinnerFrame(1)} 子代理 abc12345`)
    expect(plain(l0)).not.toBe(plain(l1))
  })

  it('ascii：spinner 降级为 *', () => {
    const [line = ''] = formatSubagentRunning({ width: 80, label: 'abc', ascii: true }, fakeTheme())
    expect(plain(line)).toBe('* 子代理 abc')
  })

  it('tick 缺省（非 ascii）：回退第 0 帧', () => {
    const [line = ''] = formatSubagentRunning({ width: 80, label: 'abc' }, fakeTheme())
    expect(plain(line)).toBe(`${brailleSpinnerFrame(0)} 子代理 abc`)
  })

  it('宽度守恒：任意宽度下 ≤ width', () => {
    for (const width of [8, 20, 80, 140]) {
      const [line = ''] = formatSubagentRunning({ width, label: 'very-long-label-123456', tick: 3 }, fakeTheme())
      expect(displayWidth(line)).toBeLessThanOrEqual(width)
    }
  })
})

describe('formatSubagentDone', () => {
  it('completed：✓ + success 色 + 耗时（无 reason 后缀）', () => {
    const line = formatSubagentDone({ width: 80, label: 'abc12345', elapsedMs: 43_000, stopReason: 'completed' }, fakeTheme())
    expect(plain(line)).toBe('✓ 子代理 abc12345 · 43.0s')
    expect(line).toContain('\x1B[38;2;51;51;51m') // #333333 success
  })

  it('aborted：◌ + muted 色', () => {
    const line = formatSubagentDone({ width: 80, label: 'abc', elapsedMs: 8_000, stopReason: 'aborted' }, fakeTheme())
    expect(plain(line)).toBe('◌ 子代理 abc · 8.0s')
    expect(line).not.toContain('(aborted)')
    expect(line).toContain('\x1B[38;2;119;119;119m') // #777777 muted
  })

  it('error：✗ + error 色 + (error) 后缀', () => {
    const line = formatSubagentDone({ width: 80, label: 'abc', elapsedMs: 12_000, stopReason: 'error' }, fakeTheme())
    expect(plain(line)).toBe('✗ 子代理 abc · 12.0s (error)')
    expect(line).toContain('\x1B[38;2;85;85;85m') // #555555 error
  })

  it('max-tokens / refusal：✗ + reason 后缀', () => {
    expect(plain(formatSubagentDone({ width: 80, label: 'a', elapsedMs: 100, stopReason: 'max-tokens' }, fakeTheme()))).toContain('(max-tokens)')
    expect(plain(formatSubagentDone({ width: 80, label: 'a', elapsedMs: 100, stopReason: 'refusal' }, fakeTheme()))).toContain('(refusal)')
  })

  it('未知 stopReason（merge-extensible 默认）：✗ + 原样后缀', () => {
    const line = plain(formatSubagentDone({ width: 80, label: 'a', elapsedMs: 100, stopReason: 'future-reason' }, fakeTheme()))
    expect(line).toContain('✗')
    expect(line).toContain('(future-reason)')
  })

  it('宽度守恒：label 截断优先于 reason 后缀', () => {
    const line = plain(formatSubagentDone({ width: 20, label: 'very-long-subagent-label', elapsedMs: 12_000, stopReason: 'error' }, fakeTheme()))
    expect(displayWidth(line)).toBeLessThanOrEqual(20)
    // 窄到 reason 放不下时 suffix 被截断
    const narrow = plain(formatSubagentDone({ width: 12, label: 'abc', elapsedMs: 12_000, stopReason: 'error' }, fakeTheme()))
    expect(displayWidth(narrow)).toBeLessThanOrEqual(12)
  })
})
