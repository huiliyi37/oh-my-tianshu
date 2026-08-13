/**
 * format/tool-view-card — presenter 结构化卡渲染契约测试。
 *
 * - renderFileDiff：修改（+/− + 上下文）、新建（oldText null 全 add）、
 *   无变更空数组、多 hunk gap 分隔、maxLines 头尾对半折叠。
 * - diff 卡：presenter 标题优先、大改动折叠为统计行、expanded 全量、
 *   compact 仅统计、多文件路径头。
 * - terminal 卡：命令标题 + exit/signal 徽标 + cwd 头 + 输出折叠、空输出。
 * - generic/无 presenter：回落 formatToolCard 文本折叠（content 块覆盖）。
 *
 * 纯函数层：输入 FormatToolViewCardInput + 主题 → ANSI 行数组。
 */

import { describe, expect, it } from 'vitest'
import type { ToolResultView } from '@huiliyi37/dsh-tools'
import type { RivetTheme } from '../src/theme.js'
import { resetTermCapsCache } from '../src/term-caps.js'
import {
  fileDiffStats,
  formatToolViewCard,
  renderFileDiff,
} from '../src/format/tool-view-card.js'
import { pinTuiEnvBaseline } from './env-baseline.js'

pinTuiEnvBaseline()

/** 假主题：每个 token 一个独特 hex（与 render.spec.ts 同构）。 */
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

describe('renderFileDiff', () => {
  it('修改 → − 旧行 / + 新行 / 上下文行', () => {
    const lines = plain(renderFileDiff(
      { path: 'a.ts', oldText: 'keep\nold\nkeep2', newText: 'keep\nnew\nkeep2' },
      {},
      fakeTheme(),
    ))
    expect(lines).toContain('- old')
    expect(lines).toContain('+ new')
    expect(lines).toContain('  keep')
  })

  it('新建文件（oldText null）→ 全部 + 行', () => {
    const lines = plain(renderFileDiff(
      { path: 'new.ts', oldText: null, newText: 'line1\nline2\n' },
      {},
      fakeTheme(),
    ))
    expect(lines).toEqual(['+ line1', '+ line2'])
  })

  it('old = new → 空数组', () => {
    expect(renderFileDiff({ path: 'a.ts', oldText: 'same', newText: 'same' }, {}, fakeTheme())).toEqual([])
  })

  it('相距远的两处修改 → hunk 间 gap ⋯', () => {
    const ctx = Array.from({ length: 10 }, (_, i) => `ctx${i}`).join('\n')
    const oldText = `first\n${ctx}\nlast`
    const newText = `FIRST\n${ctx}\nLAST`
    const lines = plain(renderFileDiff({ path: 'a.ts', oldText, newText }, {}, fakeTheme()))
    expect(lines).toContain('⋯')
    expect(lines).toContain('- first')
    expect(lines).toContain('+ LAST')
  })

  it('maxLines 超限 → 头尾对半 + 隐藏行标记', () => {
    const newText = Array.from({ length: 30 }, (_, i) => `n${i}`).join('\n')
    const lines = plain(renderFileDiff({ path: 'a.ts', oldText: null, newText }, { maxLines: 10 }, fakeTheme()))
    expect(lines).toHaveLength(11)
    expect(lines[0]).toBe('+ n0')
    expect(lines[5]).toContain('已隐藏 20 行')
    expect(lines[10]).toBe('+ n29')
  })
})

describe('fileDiffStats', () => {
  it('跨多个 FileDiff 统计增删行', () => {
    const stats = fileDiffStats([
      { path: 'a.ts', oldText: 'x', newText: 'y' },
      { path: 'b.ts', oldText: null, newText: 'l1\nl2' },
    ])
    expect(stats).toEqual({ adds: 3, dels: 1 })
  })
})

describe('formatToolViewCard: diff 卡', () => {
  const base = {
    toolName: 'edit_file',
    argumentsRaw: '{"file_path":"a.ts"}',
    content: '模型面 diff 文本',
    isError: false,
  }

  it('presenter 标题 + 红绿正文；模型面文本不出现', () => {
    const lines = plain(formatToolViewCard({
      ...base,
      resultView: { card: 'diff', title: 'Update(a.ts)', diffs: [{ path: 'a.ts', oldText: 'x = 1', newText: 'x = 2' }] },
      elapsedMs: 1200,
    }, fakeTheme()))
    expect(lines[0]).toContain('Update(a.ts)')
    expect(lines[0]).toContain('(1.2s)')
    const body = lines.join('\n')
    expect(body).toContain('- x = 1')
    expect(body).toContain('+ x = 2')
    expect(body).not.toContain('模型面 diff 文本')
  })

  it('大改动（>10 行）折叠为统计行；expanded 全量展开', () => {
    const newText = Array.from({ length: 20 }, (_, i) => `line${i}`).join('\n')
    const view: ToolResultView = { card: 'diff', diffs: [{ path: 'a.ts', oldText: null, newText }] }
    const folded = plain(formatToolViewCard({ ...base, resultView: view }, fakeTheme())).join('\n')
    expect(folded).toContain('1 处修改 (+20 −0)')
    expect(folded).not.toContain('line0')
    const expanded = plain(formatToolViewCard({ ...base, resultView: view, expanded: true }, fakeTheme())).join('\n')
    expect(expanded).toContain('line0')
    expect(expanded).toContain('line19')
  })

  it('compact → 仅标题 + 统计行（小改动也折叠）', () => {
    const lines = plain(formatToolViewCard({
      ...base,
      resultView: { card: 'diff', diffs: [{ path: 'a.ts', oldText: 'x', newText: 'y' }] },
      compact: true,
    }, fakeTheme()))
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain('1 处修改 (+1 −1)')
  })

  it('多文件 diff → 每个文件一个路径头', () => {
    const lines = plain(formatToolViewCard({
      ...base,
      resultView: {
        card: 'diff',
        diffs: [
          { path: 'a.ts', oldText: 'x', newText: 'y' },
          { path: 'b.ts', oldText: 'p', newText: 'q' },
        ],
      },
    }, fakeTheme())).join('\n')
    expect(lines).toContain('a.ts')
    expect(lines).toContain('b.ts')
  })
})

describe('formatToolViewCard: terminal 卡', () => {
  const base = {
    toolName: 'bash',
    argumentsRaw: '{"command":"npm test"}',
    content: 'ok\n',
    isError: false,
  }

  it('presenter 命令标题 + cwd 头 + 输出体', () => {
    const lines = plain(formatToolViewCard({
      ...base,
      callView: { card: 'terminal', title: 'npm test', cwd: '/repo' },
      resultView: { card: 'terminal', title: 'npm test', output: 'passed 3 tests' },
    }, fakeTheme()))
    expect(lines[0]).toContain('Run(npm test)')
    const body = lines.join('\n')
    expect(body).toContain('cwd: /repo')
    expect(body).toContain('passed 3 tests')
  })

  it('exitCode ≠ 0 → [exit N] 徽标；signal → [SIG] 徽标优先', () => {
    const exit = plain(formatToolViewCard({
      ...base,
      isError: true,
      resultView: { card: 'terminal', title: 'false', output: '', exitCode: 1 },
    }, fakeTheme()))
    expect(exit[0]).toContain('[exit 1]')
    const sig = plain(formatToolViewCard({
      ...base,
      resultView: { card: 'terminal', title: 'sleep 100', output: '', exitCode: 143, signal: 'SIGTERM' },
    }, fakeTheme()))
    expect(sig[0]).toContain('[SIGTERM]')
    expect(sig[0]).not.toContain('[exit 143]')
  })

  it('exitCode 0 → 无徽标；空输出 → (无输出)', () => {
    const lines = plain(formatToolViewCard({
      ...base,
      resultView: { card: 'terminal', title: 'true', output: '', exitCode: 0 },
    }, fakeTheme()))
    expect(lines[0]).not.toContain('[exit')
    expect(lines.join('\n')).toContain('(无输出)')
  })

  it('长输出折叠为头 N 行 + 截断提示；expanded 全量', () => {
    const output = Array.from({ length: 20 }, (_, i) => `row${i}`).join('\n')
    const view: ToolResultView = { card: 'terminal', title: 'seq 20', output }
    const folded = plain(formatToolViewCard({ ...base, resultView: view }, fakeTheme())).join('\n')
    expect(folded).toContain('row0')
    expect(folded).toContain('… +12 行')
    expect(folded).not.toContain('row19')
    const expanded = plain(formatToolViewCard({ ...base, resultView: view, expanded: true }, fakeTheme())).join('\n')
    expect(expanded).toContain('row19')
  })

  it('compact → 仅标题行', () => {
    const lines = formatToolViewCard({
      ...base,
      resultView: { card: 'terminal', title: 'npm test', output: 'lots of output' },
      compact: true,
    }, fakeTheme())
    expect(lines).toHaveLength(1)
  })
})

describe('formatToolViewCard: generic 与回落', () => {
  it('无 resultView → formatToolCard 文本折叠', () => {
    const lines = plain(formatToolViewCard({
      toolName: 'grep',
      argumentsRaw: '{"pattern":"foo"}',
      content: 'a.ts:1:foo',
      isError: false,
    }, fakeTheme()))
    expect(lines[0]).toContain('Search(foo)')
    expect(lines.join('\n')).toContain('a.ts:1:foo')
  })

  it('generic 卡 content 块覆盖模型面文本', () => {
    const lines = plain(formatToolViewCard({
      toolName: 'read_file',
      argumentsRaw: '{"file_path":"a.ts"}',
      content: '模型面原文',
      isError: false,
      resultView: { card: 'generic', content: [{ type: 'text', text: '展示面摘要' }] },
    }, fakeTheme())).join('\n')
    expect(lines).toContain('展示面摘要')
    expect(lines).not.toContain('模型面原文')
  })

  it('错误结果 → ✗ 标题（unicode 轨）', () => {
    process.env.RIVET_ASCII_UI = '0'
    resetTermCapsCache()
    const lines = plain(formatToolViewCard({
      toolName: 'bash',
      argumentsRaw: '{}',
      content: 'command not found',
      isError: true,
    }, fakeTheme()))
    expect(lines[0]).toContain('✗')
  })
})
