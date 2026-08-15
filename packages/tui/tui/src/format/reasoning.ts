/**
 * think 推理渲染 — 对标 Claude Code 的思考通道两态：
 * - live 流式期：shimmer 头行（deep-diving.gif 光带样式）+ 尾 N 行暗色推理；
 * - 段结束落底：静态头行 + 推理全文（暗色斜体）。推理是模型的草稿流，
 *   不走 markdown 管线，保持原文样貌。
 *
 * 段边界与提交时机归 app.ts（首个 text-delta / tool/call / assistant/message
 * 是推理段的结束点）；本模块是纯渲染函数。
 */

import { color } from '../engine/ansi.js'
import type { RivetTheme } from '../theme.js'
import { wrapToDisplayWidth } from '../width.js'
import { formatElapsed } from './tool-meta.js'
import { shimmerHighlight, shimmerLine } from './shimmer.js'

/** live 推理尾巴显示行数下限（流式期只看得到最近的思路）。 */
export const REASONING_TAIL_LINES = 3

/** live 推理尾巴显示行数上限（高终端；对标 Tianshu THINKING_ROWS_MAX / CC 折叠尾）。 */
export const REASONING_ROWS_MAX = 6

/**
 * 推理尾巴随终端高度缩放：矮窗不少于 {@link REASONING_TAIL_LINES}，
 * 高窗不超过 {@link REASONING_ROWS_MAX}。按显示行预算，避免长句 wrap 撑破定高视口。
 * @param rows - 终端高度（行）；0/缺省按 24 计。
 * @returns 尾巴显示行预算（{@link REASONING_TAIL_LINES}–{@link REASONING_ROWS_MAX}）。
 */
export function reasoningTailBudget(rows: number): number {
  return Math.max(REASONING_TAIL_LINES, Math.min(REASONING_ROWS_MAX, Math.floor((rows || 24) / 6)))
}

/** 宽度口径：与 tool-card / LiveEngine.rowsForLine 一致（CJK + ambiguous 按宽）。 */
const WIDE = { ambiguousAsWide: true }

/** 思考头行 glyph（Claude Code 视觉词汇）。 */
const HEADER_GLYPH = '✻'

/** 头行文本（无色）：`✻ 思考中… (3.2s)` / `✻ 思考 (3.2s) · 12 行`。 */
function headerText(active: boolean, elapsedMs: number | undefined, lineCount?: number): string {
  const label = active ? '思考中…' : '思考'
  const elapsed = elapsedMs === undefined ? '' : ` (${formatElapsed(elapsedMs)})`
  const lines = lineCount === undefined ? '' : ` · ${lineCount} 行`
  return `${HEADER_GLYPH} ${label}${elapsed}${lines}`
}

/** 非空逻辑行数（折叠头行的隐藏内容提示；空文本 0）。 */
function contentLineCount(text: string): number {
  const count = text.split('\n').filter(line => line.trim() !== '').length
  return count
}

/**
 * 自尾部收取 wrap 后的显示行，使总数不超过 budget。
 * 长句先按列宽切开再取尾，避免一整段逻辑行撑破 3–6 行定高。
 */
function tailWithinRows(textLines: readonly string[], budget: number, width: number): string[] {
  const limit = Math.max(1, budget)
  const col = Math.max(10, width)
  const wrapped: string[] = []
  for (const line of textLines) {
    const parts = wrapToDisplayWidth(line, col, WIDE)
    if (parts.length === 0) wrapped.push('')
    else wrapped.push(...parts)
  }
  return wrapped.slice(-limit)
}

/** formatReasoningLive 的渲染输入。 */
export interface FormatReasoningLiveInput {
  /** 已累积的推理文本（reasoning-delta 折叠）。 */
  text: string
  /** 推理段已进行时长（毫秒）；<1s 或未知不显示。 */
  elapsedMs?: number
  /** 动画帧序号（shimmer 头行驱动）。 */
  tick: number
  /** 终端列数（尾巴 wrap 度量）。 */
  columns: number
  /** 紧凑模式：仅头行，省略推理尾巴。 */
  compact?: boolean
  /** 展开模式：渲染推理全文（不截尾），供手动展开查看。 */
  expanded?: boolean
  /**
   * 非展开时尾巴的显示行预算（wrap 后）。缺省 {@link REASONING_TAIL_LINES}。
   * 装配层传入 {@link reasoningTailBudget}。
   */
  maxRows?: number
}

/**
 * live 区流式推理段：shimmer 头行 +（非展开时）尾 N 行暗色推理文本
 * （N = {@link FormatReasoningLiveInput.maxRows}，缺省 {@link REASONING_TAIL_LINES}；
 * wrap 后按显示行封顶）。展开时渲染全部推理行。
 * @param input - 推理文本、tick、耗时与终端列数。
 * @param theme - 当前主题（头行基色取 primary；16 色轨自动静态降级）。
 * @returns ANSI 行数组：头行 +（非紧凑时）尾巴/全文行。
 */
export function formatReasoningLive(input: FormatReasoningLiveInput, theme: RivetTheme): string[] {
  const withElapsed = input.elapsedMs !== undefined && input.elapsedMs >= 1000
  const lines: string[] = [shimmerLine({
    text: headerText(true, withElapsed ? input.elapsedMs : undefined),
    tick: input.tick,
    base: theme.primary,
    highlight: shimmerHighlight(theme.primary),
  })]
  if (input.compact === true) return lines

  const trimmed = input.text.replace(/\n+$/, '')
  if (!trimmed) return lines
  const maxWidth = Math.max(10, input.columns - 3)
  const logical = trimmed.split('\n')
  const budget = Math.max(1, input.maxRows ?? REASONING_TAIL_LINES)
  const rows = input.expanded === true ? logical : tailWithinRows(logical, budget, maxWidth)
  for (const row of rows) {
    lines.push(`  ${color(row, theme.dim, { italic: true })}`)
  }
  return lines
}

/** formatReasoningBlock 的渲染输入。 */
export interface FormatReasoningBlockInput {
  /** 推理全文。 */
  text: string
  /** 推理段总耗时（毫秒）；未知不显示。 */
  elapsedMs?: number
  /** 紧凑模式：仅头行，正文跳过（与 /density 紧凑语义一致）。 */
  compact?: boolean
  /** 展开模式：正文全文渲染（折叠缺省仅头行；展开查看全文）。 */
  expanded?: boolean
}

/**
 * 结算推理块（scrollback 落底形态）：静态头行（shimmer 冻结为 dim，与
 * GIF 循环的「熄灭」帧一致）。默认折叠——只落头行（含隐藏行数提示），
 * 正文经 expanded 展开渲染（对标竞品：思考默认收起，按需查看全文）。
 * @param input - 推理全文、总耗时与折叠/展开/紧凑开关。
 * @param theme - 当前主题。
 * @returns ANSI 行数组：头行 +（expanded 且非 compact 时）全文行；空文本仅头行。
 */
export function formatReasoningBlock(input: FormatReasoningBlockInput, theme: RivetTheme): string[] {
  const lineCount = contentLineCount(input.text)
  const lines: string[] = [color(
    headerText(false, input.elapsedMs, lineCount === 0 ? undefined : lineCount),
    theme.dim,
    { italic: true },
  )]
  if (input.compact === true || input.expanded !== true) return lines
  const trimmed = input.text.replace(/\n+$/, '')
  if (!trimmed) return lines
  for (const row of trimmed.split('\n')) {
    lines.push(row === '' ? '' : `  ${color(row, theme.muted, { italic: true })}`)
  }
  return lines
}
