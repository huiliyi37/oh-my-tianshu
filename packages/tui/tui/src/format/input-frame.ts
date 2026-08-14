/**
 * 输入轨（format/input-frame.ts）— 纯渲染。
 *
 * Claude Code PromptInput 形态：`borderStyle=round` + `borderLeft/Right=false`。
 * 只画上下两条圆角横线（╭─╮ / ╰─╯），输入行本身不包左右 `│`。
 * 轨线色随模式：normal 雾蓝 promptBorder / plan warning / auto error。
 * ascii 降级由 boxCharsFor 走 +---+。columns < 4 时不加轨，原样返回输入行。
 */
import { color } from '../engine/ansi.js'
import { boxCharsFor } from '../box-chars.js'
import { CHROME_PROMPT_BORDER } from './chrome-colors.js'
import type { RivetTheme } from '../theme.js'
import { truncateToDisplayWidth } from '../width.js'

/** formatInputFrame 的渲染输入。 */
export interface FormatInputFrameInput {
  /** 终端列数（轨线外宽 = columns）。 */
  columns: number
  /** 输入行文本（含 ❯ 前缀/█ 光标/ANSI）。 */
  lines: readonly string[]
  /** 光标行在 lines 中的下标（硬件光标驻停行）。 */
  caretLine: number
  /** 光标列（█ 左侧 cell 数，含 ❯ 前缀；本函数不修正——无左边线）。 */
  caretCol: number
  /** 框线字符集名（thin/thick/dots/kimi；缺省 thin）。 */
  separator?: string
  /** plan 模式已生效（渲染 plan 色）。 */
  planActive?: boolean
  /** plan 切换待请求边界落地（plan 色，优先于 planActive）。 */
  planPending?: boolean
  /** always-approve 生效（渲染 auto 色）。 */
  alwaysApprove?: boolean
}

/** formatInputFrame 的渲染结果（轨线 + 输入行 + 修正后的硬件光标行）。 */
export interface FormatInputFrameOutput {
  lines: string[]
  caretLine: number
  caretCol: number
}

/**
 * 渲染输入轨：顶轨 + 输入行（无左右竖线）+ 底轨。
 * @param input - 列数、输入行、光标坐标与模式标志。
 * @param theme - 当前主题（plan warning / auto error；normal 用雾蓝轨线）。
 * @returns 轨线行数组与 caretLine+1；columns < 4 时原样返回输入行。
 */
export function formatInputFrame(input: FormatInputFrameInput, theme: RivetTheme): FormatInputFrameOutput {
  const { columns } = input
  if (columns < 4) {
    return { lines: [...input.lines], caretLine: input.caretLine, caretCol: input.caretCol }
  }
  const chars = boxCharsFor(input.separator ?? 'thin')
  const borderColor = input.planPending === true || input.planActive === true
    ? theme.warning
    : input.alwaysApprove === true ? theme.error : CHROME_PROMPT_BORDER
  const inner = Math.max(0, columns - 2)
  const top = color(`${chars.tl}${chars.h.repeat(inner)}${chars.tr}`, borderColor)
  const bottom = color(`${chars.bl}${chars.h.repeat(inner)}${chars.br}`, borderColor)
  const content = input.lines.map(line => truncateToDisplayWidth(line, columns))
  return {
    lines: [top, ...content, bottom],
    caretLine: input.caretLine + 1,
    caretCol: input.caretCol,
  }
}
