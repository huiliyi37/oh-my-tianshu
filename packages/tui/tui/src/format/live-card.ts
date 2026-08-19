/**
 * 活区共享卡片 chrome — 工具卡、委派树与后台任务行的同一套 header/body。
 *
 * 状态形与 `formatToolCardHeader` 对齐：进行中 `⠋`、成功 `›`、失败 `✗`、
 * 待答 `?`。正文第一行 `⎿  `，续行三空格。header suffix 从右往左丢，title
 * 最后截。进行中可带 body（第二行）；空闲/已结束只留标题行，提供 theme 时
 * title 涂 muted。无 theme 时输出纯文本（委派树单测不传 theme）。
 *
 * 不处理行选中、鼠标 hit-rect，也不合并 /tasks 与 /subagents。
 *
 * @module @huiliyi37/dsh-tui/format/live-card
 */

import { color } from '../engine/ansi.js'
import { brailleSpinnerFrame } from '../braille-spinner.js'
import { displayWidth, truncateToDisplayWidth } from '../width.js'
import type { RivetTheme } from '../theme.js'

/** 卡片 body 首行前缀（与工具卡 ⎿ 同一常量）。 */
export const LIVE_CARD_BODY_FIRST = '⎿  '

/** 卡片 body 续行对齐前缀（三空格，对齐 ⎿ 后的正文列）。 */
export const LIVE_CARD_BODY_CONT = '   '

const ASCII_SPIN = ['-', '\\', '|', '/'] as const

/** 活区卡片状态形（与工具卡 bullet 同一闭集）。 */
export type LiveCardStatus = 'running' | 'success' | 'error' | 'question'

/** liveCardGlyph 的可选降级与动画。 */
export interface LiveCardGlyphOptions {
  /** 终端不能画 unicode 时改用 ASCII（`-` / `x`）。 */
  readonly ascii?: boolean
  /** 单调递增帧；status 为 running 时替换静态 ⠋。 */
  readonly tick?: number
}

/**
 * 活区卡片状态形。
 * @param status - running / success / error / question。
 * @param opts - ascii 降级与可选 spinner 帧。
 * @returns 单列（或 ascii 单字节）状态字形。
 */
export function liveCardGlyph(status: LiveCardStatus, opts?: LiveCardGlyphOptions): string {
  const ascii = opts?.ascii === true
  switch (status) {
    case 'question':
      return '?'
    case 'error':
      return ascii ? 'x' : '✗'
    case 'success':
      return '›'
    case 'running': {
      if (opts?.tick !== undefined) {
        if (ascii) {
          const idx = ((opts.tick % ASCII_SPIN.length) + ASCII_SPIN.length) % ASCII_SPIN.length
          return ASCII_SPIN[idx] ?? '-'
        }
        return brailleSpinnerFrame(opts.tick)
      }
      return ascii ? '-' : '⠋'
    }
  }
}

/** formatLiveCard 的渲染输入。 */
export interface FormatLiveCardInput {
  /** 已解析的状态形（调用方经 liveCardGlyph）。 */
  readonly glyph: string
  /** 标题（无色；dim+theme 时本函数涂 muted）。 */
  readonly title: string
  /** header 尾段，超宽从右往左丢。 */
  readonly suffixes?: readonly string[]
  /** 可选 body；空或缺省 → 仅 header。 */
  readonly body?: readonly string[]
  /** 终端列数（截断预算）。 */
  readonly width: number
  /** 整卡缩进（委派树 depth）。 */
  readonly indent?: string
  /** 终态后退；仅在提供 theme 时把 title 涂 muted。 */
  readonly dim?: boolean
  /** 着色主题；缺省输出纯文本。 */
  readonly theme?: RivetTheme
}

/**
 * 组装一张活区卡：header（glyph + title + suffix）+ 可选 ⎿ body。
 * @param input - 状态形、标题、可选 suffix/body 与宽度。
 * @returns 纯文本或带 muted/dim ANSI 的行数组（至少一行 header）。
 */
export function formatLiveCard(input: FormatLiveCardInput): string[] {
  const indent = input.indent ?? ''
  const title = input.dim === true && input.theme !== undefined
    ? color(input.title, input.theme.muted)
    : input.title
  const header = assembleLiveCardSuffixes(
    `${indent}${input.glyph} ${title}`,
    input.suffixes ?? [],
    input.width,
  )
  const bodyLines = input.body ?? []
  if (bodyLines.length === 0) return [header]
  return [header, ...indentLiveCardBody(bodyLines, indent, input.theme, input.width)]
}

/**
 * 缩进卡片 body：首行 `⎿  `（有 theme 时 dim），续行三空格。
 * @param bodyLines - 已是调用方着色后的正文（或纯文本）。
 * @param indent - 整卡缩进前缀。
 * @param theme - 可选；提供时只给首行前缀涂 dim。
 * @param width - 可选截断预算；缺省不截。
 * @returns 带前缀的 body 行。
 */
export function indentLiveCardBody(
  bodyLines: readonly string[],
  indent: string,
  theme?: RivetTheme,
  width?: number,
): string[] {
  return bodyLines.map((line, i) => {
    const prefix = i === 0 ? LIVE_CARD_BODY_FIRST : LIVE_CARD_BODY_CONT
    const painted = theme !== undefined && i === 0 ? color(prefix, theme.dim) : prefix
    const out = `${indent}${painted}${line}`
    return width === undefined ? out : truncateToLiveWidth(out, width)
  })
}

/**
 * 行 + 后缀：后缀从右往左丢弃，剩余整体再截断（title 最后才被截）。
 * @param line - 已含 indent/glyph/title 的 header。
 * @param suffixes - 按保留优先级从左到右。
 * @param width - 列预算。
 * @returns 不超过 width 的单行。
 */
export function assembleLiveCardSuffixes(
  line: string,
  suffixes: readonly string[],
  width: number,
): string {
  let out = line
  for (const suffix of suffixes) {
    const candidate = `${out} · ${suffix}`
    if (displayWidth(candidate) > width - 1) break
    out = candidate
  }
  return truncateToLiveWidth(out, width)
}

/**
 * 按显示宽度截断（仅截断时尾部补 …；极端窄宽退化为 …）。
 * @param text - 可含 ANSI；宽度按剥色后的显示列。
 * @param max - 列预算。
 * @returns displayWidth ≤ max 的字符串。
 */
export function truncateToLiveWidth(text: string, max: number): string {
  if (max <= 1) return '…'
  if (displayWidth(text) <= max) return text
  return `${truncateToDisplayWidth(text, max - 1)}…`
}
