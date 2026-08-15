/**
 * LSP 诊断展示纯函数（徽标 / 分组 / 面板行）。
 */

import { describe, expect, it } from 'vitest'
import type { RivetTheme } from '../src/theme.js'
import type { LspDiagnosticView } from '../src/lsp/lsp-bridge.js'
import { fg } from '../src/engine/ansi.js'
import {
  groupLspDiagnostics,
  lspBadgeText,
  lspDiagnosticLine,
  projectLspPanel,
} from '../src/format/lsp-diagnostics.js'

const THEME = {
  primary: '#111111',
  warning: '#444444',
  error: '#555555',
  dim: '#666666',
  muted: '#777777',
} as RivetTheme

function diag(partial: Partial<LspDiagnosticView> = {}): LspDiagnosticView {
  return {
    file: 'src/a.ts',
    line: 3,
    character: 5,
    severity: 1,
    message: '类型不匹配',
    ...partial,
  }
}

describe('lspBadgeText', () => {
  it('undefined / 空数组 → null（不渲染）', () => {
    expect(lspBadgeText(undefined)).toBeNull()
    expect(lspBadgeText([])).toBeNull()
  })

  it('仅错误 → N错', () => {
    expect(lspBadgeText([diag()])).toBe('1错')
    expect(lspBadgeText([diag(), diag({ message: 'x2' }), diag({ severity: 3 })])).toBe('2错 1提示')
  })

  it('错误/警告/提示混合计数', () => {
    const diags = [
      diag({ severity: 1 }),
      diag({ severity: 1 }),
      diag({ severity: 2 }),
      diag({ severity: 2 }),
      diag({ severity: 2 }),
      diag({ severity: 4 }),
    ]
    expect(lspBadgeText(diags)).toBe('2错 3警 1提示')
  })
})

describe('groupLspDiagnostics', () => {
  it('按文件分组且保持首现顺序', () => {
    const groups = groupLspDiagnostics([
      diag({ file: 'b.ts', line: 1 }),
      diag({ file: 'a.ts', line: 1 }),
      diag({ file: 'b.ts', line: 2 }),
    ])
    expect(groups.map(g => g.file)).toEqual(['b.ts', 'a.ts'])
    expect(groups[0]?.diags.map(d => d.line)).toEqual([1, 2])
  })

  it('空输入 → []', () => {
    expect(groupLspDiagnostics([])).toEqual([])
  })
})

describe('lspDiagnosticLine', () => {
  it('error 用主题错误色、warning 用警告色、其余 muted', () => {
    const line = lspDiagnosticLine(diag({ severity: 1, message: 'boom' }), THEME)
    expect(line).toContain(fg(THEME.error))
    expect(line).toContain('3:5')
    expect(line).toContain('boom')
    const warn = lspDiagnosticLine(diag({ severity: 2 }), THEME)
    expect(warn).toContain(fg(THEME.warning))
    const hint = lspDiagnosticLine(diag({ severity: 4 }), THEME)
    expect(hint).toContain(fg(THEME.muted))
  })

  it('超长消息截断（不劈码点，… 收尾）', () => {
    const long = 'x'.repeat(200)
    const line = lspDiagnosticLine(diag({ message: long }), THEME)
    expect(line).toContain('…')
    // 截断后正文不超过预算：剥离 ANSI 后长度 < 200
    const plain = line.replace(/\x1B\[[0-9;]*m/g, '')
    expect(plain.length).toBeLessThan(200)
  })
})

describe('projectLspPanel', () => {
  it('空诊断 + server 可用 → 无诊断空态', () => {
    const rows = projectLspPanel([], THEME, true)
    expect(rows.join('\n')).toContain('无 LSP 诊断')
  })

  it('空诊断 + server 不可用 → 未安装空态', () => {
    const rows = projectLspPanel([], THEME, false)
    expect(rows.join('\n')).toContain('LSP server 未安装')
  })

  it('有诊断 → 文件头行 + 缩进诊断行', () => {
    const rows = projectLspPanel([
      { file: 'src/a.ts', diags: [diag({ line: 3, severity: 1 }), diag({ line: 9, severity: 2 })] },
    ], THEME, true)
    expect(rows[0]).toContain('◆ src/a.ts')
    expect(rows[1]).toContain('3:5')
    expect(rows[1]).toContain('类型不匹配')
    expect(rows[1]).toContain(fg(THEME.error))
    expect(rows[2]).toContain('9:5')
    expect(rows[2]).toContain(fg(THEME.warning))
  })
})
