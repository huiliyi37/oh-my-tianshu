/**
 * 审批卡纯渲染：圆角轨、键位行、compact 省略 diff、宽度守恒。
 */
import { describe, expect, it } from 'vitest'
import type { RivetTheme } from '../src/theme.js'
import { displayWidth } from '../src/width.js'
import {
  formatApprovalCard,
  formatRailsBlock,
} from '../src/format/approval-card.js'

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

/** 键位段全集：断言提示（含折行）覆盖每个按键段。 */
const HINT_SEGMENTS = ['[y] 允许', '[n] 拒绝', '[a] 本会话总是允许', '[p] 永久允许', '[esc] 取消']

describe('formatApprovalCard', () => {
  it('圆角轨 + 允许执行 + 键位；无 diff 标盲批', () => {
    const rows = plain(formatApprovalCard({ columns: 60, toolName: 'bash', reason: 'sandbox' }, fakeTheme()))
    expect(rows[0]).toMatch(/^╭─ 审批 · bash ─+╮$/)
    expect(rows.join('\n')).toContain('允许执行 bash？（sandbox）（diff 不可见）')
    for (const segment of HINT_SEGMENTS) expect(rows.join('\n')).toContain(segment)
    expect(rows.at(-1)).toMatch(/^╰─+╯$/)
  })

  it('有 diff：正文出现在提示与键位之间', () => {
    const rows = plain(formatApprovalCard({
      columns: 60,
      toolName: 'write_file',
      diffLines: ['+ hello', '- world'],
    }, fakeTheme()))
    const text = rows.join('\n')
    expect(text).toContain('+ hello')
    expect(text).not.toContain('diff 不可见')
    expect(text.indexOf('+ hello')).toBeGreaterThan(text.indexOf('允许执行'))
    expect(text.indexOf('[p] 永久允许')).toBeGreaterThan(text.indexOf('+ hello'))
  })

  it('compact：省略 diff 体，仍保留键位', () => {
    const rows = plain(formatApprovalCard({
      columns: 60,
      toolName: 'write_file',
      diffLines: ['+ hello'],
      compact: true,
    }, fakeTheme()))
    expect(rows.join('\n')).not.toContain('+ hello')
    for (const segment of HINT_SEGMENTS) expect(rows.join('\n')).toContain(segment)
  })

  it('columns < 4：不画轨', () => {
    const rows = plain(formatApprovalCard({ columns: 3, toolName: 'bash' }, fakeTheme()))
    expect(rows.join('\n')).not.toContain('╭')
    expect(rows.length).toBeGreaterThan(0)
  })

  it('宽度守恒', () => {
    for (const columns of [80, 40, 20, 8, 3]) {
      const lines = formatApprovalCard({
        columns,
        toolName: 'str_replace_editor',
        diffLines: ['+ ' + 'x'.repeat(100)],
      }, fakeTheme())
      for (const line of lines) expect(displayWidth(line)).toBeLessThanOrEqual(Math.max(0, columns))
    }
  })
})

describe('formatRailsBlock', () => {
  it('空标题：顶轨仍铺满 columns', () => {
    const rows = plain(formatRailsBlock(20, '', ['hi'], '#fff'))
    expect(displayWidth(rows[0]!)).toBe(20)
    expect(rows).toHaveLength(3)
  })
})
