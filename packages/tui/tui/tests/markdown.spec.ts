/**
 * format/markdown.ts — formatCodeBlock 内嵌 diff 段红绿渲染契约测试。
 *
 * 背景：assistant 输出含 diff 的代码块此前只走 highlightLine 普通高亮
 * （markdown.ts formatCodeBlock），红绿双色仅在 tool-card write 族/审批路径
 * （formatDiff）生效。本测试锁定：formatCodeBlock 识别 diff 段（+/- 行）
 * 套红绿（+ 绿 − 红，与 formatDiff 行分类一致），非 diff 代码块不受影响。
 */

import { describe, expect, it } from 'vitest'
import type { RivetTheme } from '../src/theme.js'
import { color } from '../src/engine/ansi.js'
import { formatMarkdown } from '../src/format/markdown.js'

function fakeTheme(): RivetTheme {
  return {
    primary: '#111111', secondary: '#222222', success: '#333333',
    warning: '#444444', error: '#555555', dim: '#666666', muted: '#777777',
    pulseQuiet: '#888888', pulseActive: '#999999', pulseAlert: '#aaaaaa',
    userColor: '#bbbbbb', assistantColor: '#cccccc', systemColor: '#dddddd',
    brandColor: '#eeeeee', toolColor: () => '#000000', contextColor: () => '#000000',
  }
}

function stripAnsi(line: string): string {
  return line.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
}

const DIFF_BLOCK = [
  '```diff',
  'diff --git a/x.ts b/x.ts',
  '--- a/x.ts',
  '+++ b/x.ts',
  '@@ -1,2 +1,2 @@',
  '-old line',
  '+new line',
  ' context',
  '```',
].join('\n')

describe('formatCodeBlock diff 段红绿', () => {
  it('diff 语言标签：+ 行套 success 绿、− 行套 error 红', () => {
    const theme = fakeTheme()
    const lines = formatMarkdown({ text: DIFF_BLOCK, columns: 80 }, theme)
    expect(lines.find(l => stripAnsi(l) === '+new line')).toBe(color('+new line', theme.success))
    expect(lines.find(l => stripAnsi(l) === '-old line')).toBe(color('-old line', theme.error))
  })

  it('未标注语言的完整 diff：isDiffContent 启发式命中同样套红绿', () => {
    const theme = fakeTheme()
    const text = ['```', ...DIFF_BLOCK.split('\n').slice(1, -1), '```'].join('\n')
    const lines = formatMarkdown({ text, columns: 80 }, theme)
    expect(lines.find(l => stripAnsi(l) === '+new line')).toBe(color('+new line', theme.success))
    expect(lines.find(l => stripAnsi(l) === '-old line')).toBe(color('-old line', theme.error))
    expect(lines.find(l => stripAnsi(l) === '@@ -1,2 +1,2 @@')).toBe(color('@@ -1,2 +1,2 @@', theme.secondary))
  })

  it('非 diff 代码块：- 行不误染红绿（保持普通渲染）', () => {
    const theme = fakeTheme()
    const text = ['```python', 'x = 1', '-y = 2', '```'].join('\n')
    const lines = formatMarkdown({ text, columns: 80 }, theme)
    const minusRaw = lines.find(l => stripAnsi(l) === '-y = 2')
    expect(minusRaw).not.toBe(color('-y = 2', theme.error))
    expect(minusRaw).not.toBe(color('-y = 2', theme.success))
  })
})
