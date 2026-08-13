/**
 * 状态行（format/turn-status.ts）— 纯渲染（C4 概念稿 A「航图」turn_status）。
 *
 * statusline 文本的活动态呈现：agent 运行中 → braille spinner（tick 驱动帧
 * 循环）；等待输入 → pulsing ◆。statusText 为 null/空时不渲染（不占位）。
 * ascii 档：spinner 降级 `*`、等待降级 `-`（legacy 终端宽度稳定）。
 * 宽度守恒：statusText 超宽截断（spinner 前缀保留）。
 */
import { brailleSpinnerFrame } from '../braille-spinner.js'
import { color } from '../engine/ansi.js'
import type { RivetTheme } from '../theme.js'
import { displayWidth } from '../width.js'

/** formatTurnStatus 的渲染输入。 */
export interface FormatTurnStatusInput {
  /** statusline 文本（阶段 · 工具名 + 徽标）；null/空 → 不渲染。 */
  statusText: string | null
  /** spinner 帧计数（120ms ticker 驱动；负值安全）。 */
  tick: number
  /** agent 是否运行中：true → braille spinner；false → pulsing ◆。 */
  active: boolean
  /** legacy 终端：spinner 降级 `*`、等待降级 `-`。 */
  ascii?: boolean
  /** 终端列数；缺省不限制（调用方恒传）。 */
  width?: number
}

function truncateTo(text: string, columns: number): string {
  let out = ''
  for (const ch of text) {
    if (displayWidth(out + ch) > columns) break
    out += ch
  }
  return out
}

/**
 * 渲染状态行：spinner（或 ◆）+ statusText。
 * @param input - statusline 文本、tick、运行态、可选 ascii/width。
 * @param theme - 当前主题（整行 primary 色）。
 * @returns 单行 ANSI；无可渲染内容返回空数组。
 */
export function formatTurnStatus(input: FormatTurnStatusInput, theme: RivetTheme): string[] {
  const { statusText, tick, active, ascii, width } = input
  if (statusText === null || statusText === '') return []
  const prefix = active
    ? (ascii === true ? '*' : brailleSpinnerFrame(tick))
    : (ascii === true ? '-' : '◆')
  let text = `${prefix} ${statusText}`
  if (width !== undefined && width > 0) {
    text = truncateTo(text, width)
  }
  return [color(text, theme.primary)]
}
