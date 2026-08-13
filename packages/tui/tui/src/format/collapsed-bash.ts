/**
 * Collapsed Bash 折叠组（format/collapsed-bash.ts）— 纯渲染。
 *
 * 预留：scrollback/live 接线未实现——formatCollapsedBashGroup 与
 * formatCollapsedBashGroupLive 当前无消费方，仅登记渲染 API。
 *
 * 折叠判定：短且非变更型命令可折叠；变更模式（重定向/git 变更/rm/包管理/
 * sed -i/find -exec/make/tsc -b）一律不折叠（宁可漏折叠不误折叠）。
 * 渲染：摘要行 + 逐个 entry 树形连接符；>3 条走紧凑命令列表。
 * elapsed 由投影器喂入（无 Date.now），任何宽度下预览行不破版。
 */
import { color } from '../engine/ansi.js'
import type { LiveRegionLine } from '../engine/live-engine.js'
import type { RivetTheme } from '../theme.js'
import { displayWidth } from '../width.js'
import { formatElapsed } from './tool-meta.js'

/** 可折叠命令的长度上限（trim 后字符数；超长命令不折叠）。 */
export const MAX_COLLAPSIBLE_COMMAND_LEN = 80

/** 折叠组内一条 bash 命令：命令文本 + 完成态与结果。 */
export interface CollapsedBashEntry {
  id: string
  command: string
  completed: boolean
  startMs: number
  content?: string
  isError?: boolean
}

/** 连续可折叠 bash 命令的聚合组（startMs 取组内首条起点）。 */
export interface CollapsedBashGroup {
  entries: CollapsedBashEntry[]
  startMs: number
}

/** formatCollapsedBashGroup（scrollback 版）的渲染选项。 */
export interface CollapsedBashGroupOptions {
  group: CollapsedBashGroup
  theme: RivetTheme
  elapsedMs?: number
  columns?: number
  expanded?: boolean
}

/** formatCollapsedBashGroupLive（live 区版）的渲染选项。 */
export interface CollapsedBashGroupLiveOptions {
  group: CollapsedBashGroup
  theme: RivetTheme
  elapsedMs?: number
  columns?: number
}

const MUTATING_PATTERNS: RegExp[] = [
  />\s*\S/,            // 重定向写
  /git\s+(push|commit|merge|rebase|reset|checkout|switch|branch|stash|tag|rm|mv)/,
  /\brm\b/,            // 删除
  /\b(npm|pnpm|yarn|bun)\b/, // 包管理
  /sed\s+-i/,          // 就地修改
  /find\s+.*\s+(-delete|-exec)/,
  /^make\b/,
  /^tsc\s+-b\b/,
]

/**
 * 折叠判定：短且非变更型命令可折叠；空/超长/变更模式不可折叠。
 * @param command - bash 命令文本（trim 后判定）。
 * @returns 可折叠时 true（宁可漏折叠不误折叠）。
 */
export function isCollapsibleBashCommand(command: string): boolean {
  const trimmed = command.trim()
  if (!trimmed) return false
  if (trimmed.length > MAX_COLLAPSIBLE_COMMAND_LEN) return false
  return !MUTATING_PATTERNS.some(p => p.test(trimmed))
}

/**
 * 从组实时派生统计（failed 只计已完成且出错的 entry）。
 * @param group - 目标折叠组。
 * @returns total/completed/pending/failed 计数。
 */
export function computeBashGroupStats(group: CollapsedBashGroup): { total: number; completed: number; pending: number; failed: number } {
  let completed = 0
  let failed = 0
  for (const e of group.entries) {
    if (e.completed) completed++
    if (e.completed && e.isError) failed++
  }
  return { total: group.entries.length, completed, pending: group.entries.length - completed, failed }
}

/**
 * 折叠摘要文本（非 live）：无 completed → …（active 追加 pending 计数）；否则 Ran N shell commands。
 * @param group - 目标折叠组。
 * @param active - 组内仍有进行中命令（无 completed 时追加 pending 计数）。
 * @returns 摘要文本（无色）；有失败时附 `, N failed`。
 */
export function buildBashSummaryText(group: CollapsedBashGroup, active = false): string {
  const stats = computeBashGroupStats(group)
  if (stats.completed === 0) {
    return active ? `…, ${stats.pending} pending` : '…'
  }
  const base = `Ran ${stats.completed} shell command${stats.completed === 1 ? '' : 's'}`
  return stats.failed > 0 ? `${base}, ${stats.failed} failed` : base
}

/**
 * live 摘要：有 pending → Running N shell command；全完成 → Ran N shell command。
 * @param group - 目标折叠组。
 * @returns 摘要文本（无色）。
 */
export function buildBashLiveSummaryText(group: CollapsedBashGroup): string {
  const stats = computeBashGroupStats(group)
  if (stats.pending > 0) {
    return `Running ${stats.pending} shell command${stats.pending === 1 ? '' : 's'}`
  }
  return `Ran ${stats.completed} shell command${stats.completed === 1 ? '' : 's'}`
}

/** 内容预览：成功取头部 3 行（藏下文），失败取尾部 3 行（藏上文）；超宽行截断。 */
function previewLines(content: string, isError: boolean, columns: number): { lines: string[]; hiddenTop: number; hiddenBottom: number } {
  const all = content.split('\n').filter((_, i, arr) => !(i === arr.length - 1 && _ === ''))
  const MAX = 3
  let lines: string[]
  let hiddenTop = 0
  let hiddenBottom = 0
  if (isError) {
    lines = all.slice(-MAX)
    hiddenTop = Math.max(0, all.length - MAX)
  } else {
    lines = all.slice(0, MAX)
    hiddenBottom = Math.max(0, all.length - MAX)
  }
  return {
    lines: lines.map(l => (columns > 0 && displayWidth(l) > columns ? truncateTo(l, columns) : l)),
    hiddenTop,
    hiddenBottom,
  }
}

function truncateTo(text: string, columns: number): string {
  let out = ''
  for (const ch of text) {
    if (displayWidth(out + ch) > columns) break
    out += ch
  }
  return out
}

/** 逐 entry 行：树形连接符 + 失败 ✗ + 预览。 */
function entryLines(g: CollapsedBashGroup, theme: RivetTheme, columns: number): string[] {
  const out: string[] = []
  const entries = g.entries
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    /* v8 ignore next -- 循环 i 恒在 entries 界内；noUncheckedIndexedAccess 收窄防御 */
    if (e === undefined) continue
    const last = i === entries.length - 1
    const prefix = last ? '╰─ ' : '├─ '
    const head = `${prefix}${e.command}${e.completed && e.isError ? ' ✗' : ''}`
    out.push(color(head, e.completed && e.isError ? theme.error : theme.dim))
    if (e.completed && e.content !== undefined) {
      const prev = previewLines(e.content, e.isError === true, columns)
      const indent = last ? '   ' : '│  '
      for (const pl of prev.lines) out.push(indent + color(pl, theme.muted))
      if (prev.hiddenTop > 0) out.push(indent + color(`… 已隐藏上文 ${prev.hiddenTop} 行`, theme.muted))
      if (prev.hiddenBottom > 0) out.push(indent + color(`… 已隐藏 ${prev.hiddenBottom} 行`, theme.muted))
    }
  }
  return out
}

/**
 * 折叠组渲染（scrollback 版）：摘要行 + 逐 entry 树形连接符；
 * >3 条且未展开时走紧凑命令列表。
 * @param opts - 折叠组、主题、耗时、列数与展开态。
 * @returns ANSI 行数组。
 */
export function formatCollapsedBashGroup(opts: CollapsedBashGroupOptions): string[] {
  const { group, theme, columns = 80, expanded = false } = opts
  const out: string[] = []
  const stats = computeBashGroupStats(group)
  const summary = buildBashSummaryText(group, stats.pending > 0)
  const elapsed = opts.elapsedMs !== undefined ? ` ${formatElapsed(opts.elapsedMs)}` : ''
  out.push(color(`▶ ${summary}${elapsed}`, theme.dim))
  if (stats.completed === 0) {
    out.push(color('(results pending…)', theme.muted))
  }
  if (stats.completed > 0) {
    if (group.entries.length > 3 && !expanded) {
      const cmds = group.entries.map(e => e.command).join(' · ')
      out.push(color(`[${cmds}]`, theme.muted))
    } else {
      out.push(...entryLines(group, theme, columns))
    }
  }
  return out
}

/**
 * live 区折叠组：进行体摘要 + 最近完成 entry 尾部 2 行预览。
 * @param opts - 折叠组、主题、耗时与列数。
 * @returns live 区行数组（超宽行按列数截断）。
 */
export function formatCollapsedBashGroupLive(opts: CollapsedBashGroupLiveOptions): LiveRegionLine[] {
  const { group, theme, columns = 80 } = opts
  const summary = buildBashLiveSummaryText(group)
  const elapsed = opts.elapsedMs !== undefined ? ` ${formatElapsed(opts.elapsedMs)}` : ''
  const out: LiveRegionLine[] = [{
    text: color(columns > 0 ? truncateTo(`▶ ${summary}${elapsed}`, columns) : `▶ ${summary}${elapsed}`, theme.dim),
  }]
  const lastDone = [...group.entries].reverse().find(e => e.completed)
  if (lastDone?.content !== undefined) {
    const tail = lastDone.content.split('\n').filter(line => line !== '').slice(-2)
    for (const pl of tail) {
      if (columns > 0 && displayWidth(pl) > columns) out.push({ text: color(truncateTo(pl, columns), theme.muted) })
      else out.push({ text: color(pl, theme.muted) })
    }
  }
  return out
}
