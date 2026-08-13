/**
 * Collapsed Bash 折叠组（format/collapsed-bash.ts）— 纯渲染契约测试。
 *
 * - 折叠判定：短且非变更型命令可折叠；变更模式（重定向/git 变更/rm/包管理/
 *   sed -i/find -exec/make/tsc -b）一律不折叠（宁可漏折叠不误折叠）。
 * - 渲染：摘要行 + 逐个 entry 树形连接符；>3 条走紧凑命令列表。
 * - elapsed 由投影器喂入（无 Date.now），任何宽度下预览行不破版。
 */

import { describe, expect, it } from 'vitest'
import type { RivetTheme } from '../src/theme.js'
import { displayWidth } from '../src/width.js'
import {
  MAX_COLLAPSIBLE_COMMAND_LEN,
  buildBashLiveSummaryText,
  buildBashSummaryText,
  computeBashGroupStats,
  formatCollapsedBashGroup,
  formatCollapsedBashGroupLive,
  isCollapsibleBashCommand,
  type CollapsedBashEntry,
  type CollapsedBashGroup,
} from '../src/format/collapsed-bash.js'

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

function entry(over: Partial<CollapsedBashEntry> = {}): CollapsedBashEntry {
  return { id: 'call_1', command: 'ls', completed: false, startMs: 0, ...over }
}

function group(entries: CollapsedBashEntry[]): CollapsedBashGroup {
  return { entries, startMs: 0 }
}

describe('isCollapsibleBashCommand', () => {
  it('空/纯空白 → false', () => {
    expect(isCollapsibleBashCommand('')).toBe(false)
    expect(isCollapsibleBashCommand('   ')).toBe(false)
  })

  it('短且非变更 → true', () => {
    expect(isCollapsibleBashCommand('ls -la')).toBe(true)
    expect(isCollapsibleBashCommand('git status')).toBe(true)
  })

  it('超长 → false', () => {
    expect(isCollapsibleBashCommand('x'.repeat(MAX_COLLAPSIBLE_COMMAND_LEN + 1))).toBe(false)
  })

  it('变更模式 → false（重定向/git 变更/rm/npm/sed -i/find -delete/make/tsc -b）', () => {
    expect(isCollapsibleBashCommand('echo hi > out.txt')).toBe(false)
    expect(isCollapsibleBashCommand('git push origin main')).toBe(false)
    expect(isCollapsibleBashCommand('rm -rf build')).toBe(false)
    expect(isCollapsibleBashCommand('npm install lodash')).toBe(false)
    expect(isCollapsibleBashCommand('sed -i s/a/b/ f.txt')).toBe(false)
    expect(isCollapsibleBashCommand('find . -name "*.ts" -delete')).toBe(false)
    expect(isCollapsibleBashCommand('make build')).toBe(false)
    expect(isCollapsibleBashCommand('tsc -b')).toBe(false)
  })
})

describe('computeBashGroupStats / buildBashSummaryText', () => {
  it('计数：completed / pending / failed', () => {
    const g = group([
      entry({ id: 'a', completed: true }),
      entry({ id: 'b', completed: true, isError: true }),
      entry({ id: 'c', completed: false }),
    ])
    expect(computeBashGroupStats(g)).toEqual({ total: 3, completed: 2, pending: 1, failed: 1 })
  })

  it('无 completed：省略号；active 追加 pending 计数', () => {
    const g = group([entry({ id: 'a' }), entry({ id: 'b' })])
    expect(buildBashSummaryText(g)).toBe('…')
    expect(buildBashSummaryText(g, true)).toBe('…, 2 pending')
  })

  it('completed：Ran N shell commands + failed', () => {
    const g = group([
      entry({ id: 'a', completed: true }),
      entry({ id: 'b', completed: true, isError: true }),
    ])
    expect(buildBashSummaryText(g)).toBe('Ran 2 shell commands, 1 failed')
  })

  it('live：pending 进行体；无 pending 回退摘要', () => {
    expect(buildBashLiveSummaryText(group([entry({ id: 'a' })]))).toBe('Running 1 shell command')
    expect(buildBashLiveSummaryText(group([entry({ id: 'a', completed: true })]))).toBe('Ran 1 shell command')
  })

  it('live：pending/completed 复数用 commands', () => {
    const pending = group([entry({ id: 'a' }), entry({ id: 'b' })])
    expect(buildBashLiveSummaryText(pending)).toBe('Running 2 shell commands')
    const done = group([entry({ id: 'a', completed: true }), entry({ id: 'b', completed: true })])
    expect(buildBashLiveSummaryText(done)).toBe('Ran 2 shell commands')
  })

  it('live：columns<=0 时不截断摘要行', () => {
    const g = group([entry({ id: 'a' })])
    const lines = formatCollapsedBashGroupLive({ group: g, theme: fakeTheme(), columns: 0 })
    expect(plain(lines.map(l => l.text))[0]).toBe('▶ Running 1 shell command')
  })

  it('live：无已完成 entry 时不渲染预览', () => {
    const g = group([entry({ id: 'a' }), entry({ id: 'b' })])
    const lines = formatCollapsedBashGroupLive({ group: g, theme: fakeTheme(), columns: 60 })
    expect(lines).toHaveLength(1)
  })
})

describe('formatCollapsedBashGroup', () => {
  it('摘要行：▶ + 摘要 + 耗时（elapsed 由投影器喂入）', () => {
    const lines = formatCollapsedBashGroup({
      group: group([entry({ id: 'a', completed: true })]),
      theme: fakeTheme(),
      elapsedMs: 1500,
    })
    expect(plain(lines)[0]).toContain('Ran 1 shell command')
    expect(plain(lines)[0]).toContain('1.5s')
  })

  it('无 completed + pending：显示 pending 提示', () => {
    const lines = formatCollapsedBashGroup({
      group: group([entry({ id: 'a' })]),
      theme: fakeTheme(),
    })
    expect(plain(lines)[1]).toContain('(results pending…)')
  })

  it('逐 entry：树形连接符（末项 ╰─）+ 失败 ✗ + 内容预览', () => {
    const g = group([
      entry({ id: 'a', command: 'ls', completed: true, content: 'src\nlib' }),
      entry({ id: 'b', command: 'git log', completed: true, isError: true, content: 'err1\nerr2\nerr3' }),
    ])
    const lines = formatCollapsedBashGroup({ group: g, theme: fakeTheme(), columns: 60 })
    const text = plain(lines).join('\n')
    expect(text).toContain('├─ ls')
    expect(text).toContain('╰─ git log')
    expect(text).toContain('✗')
    expect(text).toContain('src')
  })

  it('scrollback 预览行超宽时截断（columns 小 + 长行）', () => {
    const g = group([
      entry({ id: 'a', command: 'ls', completed: true, content: 'x'.repeat(200) }),
    ])
    const lines = formatCollapsedBashGroup({ group: g, theme: fakeTheme(), columns: 20 })
    // 预览正文被截断：包含 ⎿ 前缀后不超过 20+4（前缀宽）
    const text = plain(lines).join('\n')
    expect(text).not.toContain('x'.repeat(40))
  })

  it('失败 entry 预览取尾部 + earlier 标记；成功取头部 + hidden 标记', () => {
    const g = group([
      entry({ id: 'a', command: 'ok', completed: true, content: 'h1\nh2\nh3\nh4\nh5' }),
      entry({ id: 'b', command: 'bad', completed: true, isError: true, content: 'e1\ne2\ne3\ne4\ne5' }),
    ])
    const lines = formatCollapsedBashGroup({ group: g, theme: fakeTheme(), columns: 60 })
    const text = plain(lines).join('\n')
    expect(text).toContain('已隐藏上文 2 行') // 失败尾部 3 行，藏上文
    expect(text).toContain('已隐藏 2 行')     // 成功头部 3 行，藏下文
  })

  it('>3 个大折叠：紧凑命令列表（无展开快捷键提示），预览不破版', () => {
    const entries = [1, 2, 3, 4].map(n => entry({ id: `c${n}`, command: `cmd${n}`, completed: true }))
    const lines = formatCollapsedBashGroup({ group: group(entries), theme: fakeTheme(), columns: 40 })
    const text = plain(lines).join('\n')
    expect(text).toContain('cmd1 · cmd2 · cmd3 · cmd4')
    expect(text).not.toContain('ctrl+o')
    for (const l of lines) expect(displayWidth(l)).toBeLessThanOrEqual(40)
  })

  it('expanded：逐 entry 展开不受 3 条上限约束', () => {
    const entries = [1, 2, 3, 4].map(n => entry({ id: `c${n}`, command: `cmd${n}`, completed: true }))
    const lines = formatCollapsedBashGroup({ group: group(entries), theme: fakeTheme(), expanded: true, columns: 40 })
    expect(plain(lines).join('\n')).toContain('cmd4')
  })
})

describe('formatCollapsedBashGroupLive', () => {
  it('进行体摘要 + 最近完成 entry 的尾部 2 行预览', () => {
    const g = group([
      entry({ id: 'a', command: 'one', completed: true, content: 'l1\nl2\nl3\nl4' }),
      entry({ id: 'b', command: 'two', completed: false }),
    ])
    const lines = formatCollapsedBashGroupLive({ group: g, theme: fakeTheme(), columns: 60, elapsedMs: 2000 })
    const text = plain(lines.map(l => l.text)).join('\n')
    expect(text).toContain('Running 1 shell command')
    expect(text).toContain('2.0s')
    expect(text).toContain('l3')
    expect(text).toContain('l4')
  })

  it('预览行超宽时截断，不破版', () => {
    const g = group([entry({ id: 'a', command: 'one', completed: true, content: 'x'.repeat(200) })])
    const lines = formatCollapsedBashGroupLive({ group: g, theme: fakeTheme(), columns: 20 })
    for (const l of lines) expect(displayWidth(l.text)).toBeLessThanOrEqual(20)
  })
})
