/**
 * 格式化函数 — diff 输出（基础版，直移 .rivet/tui-source/tui/format/diff.ts）。
 *
 * 源出 .rivet/tui-source/tui/format/diff.ts（Apache-2.0 来源，见
 * LICENSE/NOTICE/SOURCE-MAP.md）。本文件与源保持一致（本地依赖
 * hidden-lines.ts 已存在），未做裁剪。
 */

import { color, fileLink } from '../engine/ansi.js'
import type { RivetTheme } from '../theme.js'
import { hiddenLinesMarker } from './hidden-lines.js'

/** formatDiff 的渲染输入。 */
export interface FormatDiffInput {
  /** diff 文本内容 */
  content: string
  /** 最大显示行数 */
  maxLines?: number
}

const DEFAULT_MAX_LINES = 50

/** diff 统计信息（adds/dels 不含文件头，hunks 为 @@ 头数量） */
export interface DiffStats {
  adds: number
  dels: number
  hunks: number
}

/**
 * 从 diff 文本提取统计：添加行数、删除行数、hunk 数。
 * @param content - unified diff 文本（+++/--- 文件头不计入增删）。
 * @returns adds/dels/hunks 计数。
 */
export function computeDiffStats(content: string): DiffStats {
  const lines = content.split('\n')
  let adds = 0
  let dels = 0
  let hunks = 0
  for (const line of lines) {
    if (line.startsWith('@@')) { hunks++; continue }
    if (line.startsWith('+') && !line.startsWith('+++')) { adds++; continue }
    if (line.startsWith('-') && !line.startsWith('---')) { dels++; continue }
  }
  return { adds, dels, hunks }
}

type DiffLineType = 'add' | 'del' | 'hunk' | 'context' | 'meta' | 'header'

/**
 * 启发式检测文本是否为 unified diff 内容。
 * 前 20 行内计 diff 信号（diff --git / 文件头 / hunk 头）；有 hunk 头且
 * 存在 +/- 行即判真，否则要求信号 ≥ 2。
 * @param text - 待检测文本。
 * @returns 判定为 diff 内容时 true。
 */
export function isDiffContent(text: string): boolean {
  let diffSignals = 0
  let hasHunk = false
  const lines = text.split('\n')
  for (const line of lines.slice(0, 20)) {
    if (!line) continue
    if (/^diff --git/.test(line)) { diffSignals += 2; continue }
    if (/^(---|\+\+\+)\s/.test(line)) { diffSignals++; continue }
    if (/^@@[^@]+@@/.test(line)) { hasHunk = true; diffSignals++; continue }
  }
  if (hasHunk && /^[-+]/m.test(text)) return true
  return diffSignals >= 2
}

/** 从 hunk 头解析起始行号。`@@ -a,b +c,d @@` → { old: a, new: c }。 */
function parseHunkStart(line: string): { old: number; new: number } | null {
  const m = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
  if (!m) return null
  return { old: Number(m[1]), new: Number(m[2]) }
}

/**
 * 为每一行计算行号 gutter 标签（不含着色）。
 * 有 hunk 头才有行号语义：add/context 显示新文件行号，del 显示旧文件行号。
 * 无 hunk 的裸 +/- 片段返回 null（不加 gutter）。
 */
function computeLineNumbers(allLines: string[]): (string | null)[] | null {
  let oldNo = 0
  let newNo = 0
  let inHunk = false
  let sawHunk = false
  const labels: (string | null)[] = []
  for (const line of allLines) {
    const type = classifyLine(line)
    if (type === 'hunk') {
      const start = parseHunkStart(line)
      if (start) { oldNo = start.old; newNo = start.new; inHunk = true; sawHunk = true }
      labels.push(null)
      continue
    }
    if (!inHunk || type === 'meta' || type === 'header') { labels.push(null); continue }
    if (type === 'add') { labels.push(String(newNo)); newNo++; continue }
    if (type === 'del') { labels.push(String(oldNo)); oldNo++; continue }
    labels.push(String(newNo)); oldNo++; newNo++
  }
  return sawHunk ? labels : null
}

/**
 * 格式化 diff 为 ANSI 行数组。
 *
 * 颜色映射：
 * - 添加行 (+): theme.success (绿)
 * - 删除行 (-): theme.error (红)
 * - hunk header (@@): theme.secondary
 * - 文件头 (---/+++): theme.warning
 * - 上下文行: theme.muted
 * - meta (diff --git 等): theme.dim
 * @param input - diff 文本与可选行数上限（超限时头尾各留一半 + 隐藏标记）。
 * @param theme - 当前主题。
 * @returns ANSI 行数组：`diff: +N −M` 摘要头 + 染色内容行（有 hunk 时附行号 gutter）。
 */
export function formatDiff(input: FormatDiffInput, theme: RivetTheme): string[] {
  const maxLines = input.maxLines ?? DEFAULT_MAX_LINES
  const allLines = input.content.split('\n')

  const stats = computeDiffStats(input.content)

  const lineNumbers = computeLineNumbers(allLines)
  const gutterWidth = lineNumbers
    ? Math.max(3, ...lineNumbers.filter((l): l is string => l !== null).map(l => l.length))
    : 0

  const truncated = allLines.length > maxLines
  const headCount = Math.floor(maxLines / 2)
  type Row = { line: string; label: string | null }
  const rows: Row[] = allLines.map((line, i) => ({ line, label: lineNumbers?.[i] ?? null }))
  const displayRows: Row[] = truncated
    ? [...rows.slice(0, headCount), { line: hiddenLinesMarker(allLines.length - maxLines), label: null }, ...rows.slice(-headCount)]
    : rows

  const lines: string[] = []

  // Summary header
  lines.push(color(`diff: +${stats.adds} −${stats.dels}${truncated ? ` (${allLines.length} total, showing ${maxLines})` : ''}`, theme.secondary))

  // Content
  for (const row of displayRows) {
    const type = classifyLine(row.line)
    const lineColor = getDiffColor(type, theme)
    let rendered = color(row.line, lineColor)
    if (type === 'header') {
      const filePath = extractHeaderPath(row.line)
      if (filePath) rendered = fileLink(rendered, filePath)
    }
    if (lineNumbers) {
      const gutter = color(`${(row.label ?? '').padStart(gutterWidth)}│`, theme.dim)
      lines.push(`${gutter}${rendered}`)
    } else {
      lines.push(rendered)
    }
  }

  return lines
}

/** 从 ---/+++ 文件头提取路径（剥 a// b/ 前缀；/dev/null 与时间戳后缀跳过）。 */
function extractHeaderPath(line: string): string | null {
  const m = /^(?:---|\+\+\+)\s+(.+)$/.exec(line)
  if (!m) return null
  const group = m[1]
  /* v8 ignore next -- 正则 ^.+$ 匹配成功时捕获组必存在；noUncheckedIndexedAccess 收窄防御 */
  if (group === undefined) return null
  /* v8 ignore next -- split('\t') 恒返回非空数组，?? 右侧不可达；noUncheckedIndexedAccess 收窄防御 */
  let p = group.split('\t')[0] ?? ''
  p = p.trim()
  if (p === '/dev/null') return null
  if (p.startsWith('a/') || p.startsWith('b/')) p = p.slice(2)
  return p || null
}

function classifyLine(line: string): DiffLineType {
  if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('new ') || line.startsWith('old ') || line.startsWith('rename ') || line.startsWith('similarity ')) return 'meta'
  if (line.startsWith('---') || line.startsWith('+++')) return 'header'
  if (line.startsWith('@@')) return 'hunk'
  if (line.startsWith('+')) return 'add'
  if (line.startsWith('-')) return 'del'
  return 'context'
}

function getDiffColor(type: DiffLineType, theme: RivetTheme): string {
  switch (type) {
    case 'add': return theme.success
    case 'del': return theme.error
    case 'hunk': return theme.secondary
    case 'header': return theme.warning
    case 'meta': return theme.dim
    case 'context': return theme.muted
  }
}

/**
 * 单行 diff 分类 → 主题色。供 formatCodeBlock 渲染内嵌 diff 段复用，
 * 与 formatDiff 的行分类着色保持一致（+ 绿 − 红 @@ 次色 头 warning）。
 * @param line - 单行 diff 文本。
 * @param theme - 当前主题。
 * @returns 该行对应主题色。
 */
export function diffLineColor(line: string, theme: RivetTheme): string {
  return getDiffColor(classifyLine(line), theme)
}
