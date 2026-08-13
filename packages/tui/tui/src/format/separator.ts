/**
 * 消息间分隔线（format/separator.ts）— 纯渲染。
 *
 * 宽度守恒：任何输入下每行显示宽度 ≤ width（含 ambiguous 按 2 列度量）。
 * label 居中；label 超宽时截断为省略号而非折行。
 * ascii 入参决定线字符（`-` vs `─`/`·`）；dotted 档用点线。
 */
import { color } from '../engine/ansi.js'
import type { RivetTheme } from '../theme.js'
import { displayWidth } from '../width.js'

/** formatSeparator 的渲染输入。 */
export interface SeparatorInput {
  /** 目标总显示宽度（≤ 0 返回空数组）。 */
  width: number
  /** 居中标签；缺省为纯规则线。 */
  label?: string
  /** ascii 模式：用 `-` 而非 box-drawing。 */
  ascii?: boolean
  /** dotted 档：点线（`·`）。 */
  style?: 'solid' | 'dotted'
}

function fillChar(input: SeparatorInput): string {
  if (input.ascii) return '-'
  if (input.style === 'dotted') return '·'
  return '─'
}

/** 按显示宽度预算重复填充字符（fill 可能为 2 列，重复数取下取整保不破版）。 */
function fillTo(char: string, budget: number): string {
  const w = displayWidth(char, { ambiguousAsWide: true })
  /* v8 ignore next -- fillChar 只产出 '-','·','─'，displayWidth 恒 ≥1；w<=0 分支不可达 */
  if (w <= 0) return ''
  return char.repeat(Math.floor(budget / w))
}

/**
 * 分隔线单行渲染：无 label 铺满规则线；有 label 居中、两侧补线；
 * label 超宽逐字截断加 `…`，任何输入下不破版。
 * @param input - 宽度、可选 label 与线型/ascii 选项。
 * @param theme - 当前主题（整行 dim 色）。
 * @returns 单元素 ANSI 行数组；width ≤ 0 返回空数组。
 */
export function formatSeparator(input: SeparatorInput, theme: RivetTheme): string[] {
  const { width } = input
  if (width <= 0) return []
  const fill = fillChar(input)
  const label = input.label ?? ''
  if (!label) {
    // 无 label：普通度量下恰好铺满 width（spec：'·'.repeat(12) 等精确断言）。
    const w = displayWidth(fill)
    return [color(fill.repeat(Math.max(1, Math.floor(width / Math.max(1, w)))), theme.dim)]
  }
  // label 超宽（含省略号后仍超）：逐字截断，保 `…` 结尾且不破版。
  const labelW = displayWidth(label, { ambiguousAsWide: true })
  if (labelW >= width) {
    let out = ''
    for (const ch of label) {
      if (displayWidth(out + ch + '…', { ambiguousAsWide: true }) > width) break
      out += ch
    }
    return [color(out + '…', theme.dim)]
  }
  const side = width - labelW
  const left = Math.floor(side / 2)
  const right = side - left
  return [color(fillTo(fill, left) + label + fillTo(fill, right), theme.dim)]
}
