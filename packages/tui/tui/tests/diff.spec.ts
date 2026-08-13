/**
 * format/diff.ts — unified diff 渲染与统计契约测试。
 *
 * 覆盖：
 * - computeDiffStats：adds/dels/hunks 计数（跳过 +++/--- 文件头）
 * - isDiffContent：diff --git / ---+++ / hunk+± 三类信号启发式
 * - formatDiff：summary 行、gutter 行号（有 hunk 才有）、header 路径 fileLink、
 *   截断（maxLines）隐藏标记、meta/header/hunk/context 分类着色
 */

import { describe, expect, it } from 'vitest'
import type { RivetTheme } from '../src/theme.js'
import {
  computeDiffStats,
  formatDiff,
  isDiffContent,
} from '../src/format/diff.js'

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

describe('computeDiffStats', () => {
  it('统计添加/删除/hunk 数，跳过 +++/--- 文件头', () => {
    const content = [
      'diff --git a/x b/x',
      '--- a/x',
      '+++ b/x',
      '@@ -1,2 +1,2 @@',
      '+add1',
      '+add2',
      '-del1',
      ' context',
    ].join('\n')
    expect(computeDiffStats(content)).toEqual({ adds: 2, dels: 1, hunks: 1 })
  })

  it('空内容零统计', () => {
    expect(computeDiffStats('')).toEqual({ adds: 0, dels: 0, hunks: 0 })
  })
})

describe('isDiffContent', () => {
  it('diff --git 信号（2 分）命中', () => {
    expect(isDiffContent('diff --git a/x.ts b/x.ts\nindex 123..456\n--- a/x.ts\n+++ b/x.ts')).toBe(true)
  })

  it('---/+++ 双文件头信号命中', () => {
    expect(isDiffContent('--- a\n+++ b')).toBe(true)
  })

  it('hunk 头 + 实际 ± 行命中', () => {
    expect(isDiffContent('@@ -1,3 +1,3 @@\n-old\n+new')).toBe(true)
  })

  it('普通文本（无 diff 信号）不命中', () => {
    expect(isDiffContent('hello world\nsecond line')).toBe(false)
  })

  it('只有 hunk 头无 ± 内容不命中', () => {
    expect(isDiffContent('@@ -1 +1 @@')).toBe(false)
  })

  it('空行跳过不参与信号累计（continue 分支）', () => {
    expect(isDiffContent('diff --git a b\n\n+content')).toBe(true)
  })
})

describe('formatDiff', () => {
  it('summary 行：diff: +N −M', () => {
    const lines = formatDiff({ content: '+a\n-b' }, fakeTheme())
    expect(plain(lines)[0]).toBe('diff: +1 −1')
  })

  it('无 hunk 的裸 ± 片段：不加 gutter', () => {
    const lines = formatDiff({ content: '+added\n-removed\ncontext' }, fakeTheme())
    const text = plain(lines).join('\n')
    expect(text).toContain('+added')
    expect(text).toContain('-removed')
    // 无 gutter：行首不是 " 1│" 这类
    expect(text).not.toMatch(/│/)
  })

  it('有 hunk：gutter 行号（add 用新文件号，del 用旧文件号）', () => {
    const content = [
      'diff --git a/x.ts b/x.ts',
      '--- a/x.ts',
      '+++ b/x.ts',
      '@@ -5,2 +8,2 @@',
      '-old',
      '+new',
      ' ctx',
    ].join('\n')
    const lines = formatDiff({ content }, fakeTheme())
    const text = plain(lines).join('\n')
    // del 行显示旧号 5；add 行显示新号 8；context 显示新号 9
    expect(text).toContain('5│-old')
    expect(text).toContain('8│+new')
    expect(text).toContain('9│ ctx')
  })

  it('header 行经 fileLink（剥 a// b/ 前缀作为链接目标）', () => {
    const content = '--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1 +1 @@\n+x'
    const lines = formatDiff({ content }, fakeTheme())
    // fileLink 在无超链接终端返回原文本；断言 header 行渲染不抛错且路径出现
    expect(plain(lines).join('\n')).toContain('src/foo.ts')
  })

  it('/dev/null 文件头不生成 fileLink（保持原样）', () => {
    const content = '--- /dev/null\n+++ b/new.ts\n@@ -0,0 +1 @@\n+hello'
    const lines = formatDiff({ content }, fakeTheme())
    expect(plain(lines).join('\n')).toContain('/dev/null')
  })

  it('纯文件头（--- 后无路径）：extractHeaderPath 返回 null，保持原样', () => {
    const content = '---\n+++\n@@ -1 +1 @@\n+x'
    const lines = formatDiff({ content }, fakeTheme())
    expect(plain(lines).join('\n')).toContain('---')
  })

  it('a/ 前缀剥空路径（--- a/）：返回 null 不 fileLink', () => {
    const content = '--- a/\n+++ b/x\n@@ -1 +1 @@\n+x'
    const lines = formatDiff({ content }, fakeTheme())
    expect(plain(lines).join('\n')).toContain('a/')
  })

  it('文件头带 tab 时间戳后缀：只取路径段', () => {
    const content = '--- a/src/x.ts\t2026-01-01 00:00:00\n+++ b/src/x.ts\n@@ -1 +1 @@\n+x'
    const lines = formatDiff({ content }, fakeTheme())
    expect(plain(lines).join('\n')).toContain('src/x.ts')
  })

  it('meta 行（diff/index）按 meta 分类渲染', () => {
    const content = 'diff --git a b\nindex 123..456\n@@ -1 +1 @@\n+x'
    const lines = formatDiff({ content }, fakeTheme())
    expect(plain(lines).join('\n')).toContain('diff --git a b')
    expect(plain(lines).join('\n')).toContain('index 123..456')
  })

  it('truncated：行数超 maxLines 时中间插入隐藏标记', () => {
    const content = ['@@ -1,9 +1,9 @@', ...Array.from({ length: 9 }, (_, i) => ` line${i}`)].join('\n')
    const lines = formatDiff({ content, maxLines: 4 }, fakeTheme())
    const text = plain(lines).join('\n')
    expect(text).toContain('已隐藏')
    // summary 附 total/showing
    expect(plain(lines)[0]).toContain('(10 total, showing 4)')
  })

  it('truncated 偶数切分：头尾各 maxLines/2', () => {
    const content = Array.from({ length: 9 }, (_, i) => ` line${i}`).join('\n')
    const lines = formatDiff({ content, maxLines: 4 }, fakeTheme())
    const text = plain(lines).join('\n')
    expect(text).toContain('line0')
    expect(text).toContain('line8')
  })

  it('hunk 头格式无法解析时：不进入行号模式', () => {
    const content = '@@ broken @@\n+x\n-y'
    const lines = formatDiff({ content }, fakeTheme())
    expect(plain(lines).join('\n')).not.toMatch(/│/)
  })
})
