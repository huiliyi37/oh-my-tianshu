/**
 * 输入框完整框体（format/input-frame.ts）— 纯渲染。
 *
 * 替换 C4 概念稿 B「只画底边线」的 formatInputDivider：输入区四周带完整
 * 圆角框（顶框 ╭─╮ + 两侧 │ + 底框 ╰─╯），对齐 grok prompt_widget 的 chrome
 * 边框。几何复用 box-chars.ts（首屏欢迎框与输入框同宽咬合的单一事实源）。
 * 边框色随模式：normal secondary / plan（active/pending）warning /
 * auto（alwaysApprove）error——与 footer 徽标同源词汇。
 * ascii 降级由 boxCharsFor 内部走 useAsciiBorders。宽度守恒：框体外宽
 * = boxOuterWidth(columns) ≤ columns；columns 过窄（框体无法成立）时原样
 * 返回输入行、不加框。
 */
import { color } from '../engine/ansi.js'
import { boxCharsFor, boxInnerWidth, boxOuterWidth } from '../box-chars.js'
import type { RivetTheme } from '../theme.js'
import { displayWidth } from '../width.js'

/** formatInputFrame 的渲染输入。 */
export interface FormatInputFrameInput {
  /** 终端列数（框体外宽基准）。 */
  columns: number
  /** 输入行文本（已按 boxInnerWidth(columns) 软换行；含 ❯ 前缀/█ 光标/ANSI）。 */
  lines: readonly string[]
  /** 光标行在 lines 中的下标（硬件光标驻停行）。 */
  caretLine: number
  /** 光标列（█ 左侧 cell 数，含 ❯ 前缀；本函数 +2 修正到框内）。 */
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

/** formatInputFrame 的渲染结果（框体行 + 修正后的硬件光标坐标）。 */
export interface FormatInputFrameOutput {
  lines: string[]
  caretLine: number
  caretCol: number
}

/**
 * 渲染输入框完整框体：顶框 + 两侧边线包裹的输入行 + 底框。
 * @param input - 列数、输入行、光标坐标与模式标志。
 * @param theme - 当前主题（normal secondary / plan warning / auto error）。
 * @returns 框体行数组与修正后的光标坐标；columns 过窄时原样返回输入行。
 */
export function formatInputFrame(input: FormatInputFrameInput, theme: RivetTheme): FormatInputFrameOutput {
  const { columns } = input
  const outer = boxOuterWidth(columns)
  // 框体外宽超出终端（columns < 4，boxInnerWidth 触底 0）→ 降级不加框。
  if (outer > columns) {
    return { lines: [...input.lines], caretLine: input.caretLine, caretCol: input.caretCol }
  }
  const chars = boxCharsFor(input.separator ?? 'thin')
  const inner = boxInnerWidth(columns)
  const borderColor = input.planPending === true || input.planActive === true
    ? theme.warning
    : input.alwaysApprove === true ? theme.error : theme.secondary

  const top = color(`${chars.tl}${chars.h.repeat(inner + 2)}${chars.tr}`, borderColor)
  const bottom = color(`${chars.bl}${chars.h.repeat(inner + 2)}${chars.br}`, borderColor)
  const content = input.lines.map((line) => {
    const pad = Math.max(0, inner - displayWidth(line))
    return `${color(chars.v, borderColor)} ${line}${' '.repeat(pad)} ${color(chars.v, borderColor)}`
  })
  return {
    lines: [top, ...content, bottom],
    caretLine: input.caretLine + 1,
    caretCol: input.caretCol + 2,
  }
}
