/**
 * 底色块（format/bg-block.ts）— 纯渲染。
 *
 * omp 风格消息面底色：把一行内容垫上表面底色并补到整宽（用户气泡暖底、
 * 工具块状态底色共用）。无依赖注入：调用方按主题 token 是否缺省决定走不走
 * 底色（16 色轨 token 恒缺省 → 调用方保持无底色样式）。
 *
 * @module @huiliyi37/dsh-tui/format/bg-block
 */
import { ANSI, bg } from '../engine/ansi.js'
import { displayWidth, truncateToDisplayWidth } from '../width.js'

/**
 * 单行垫底色并补到 width 列（ANSI 安全：超宽截断，行尾 RESET 防底色泄漏）。
 * @param line - 内容行（可含 ANSI 着色）。
 * @param width - 目标列数；≤ 0 时原样返回。
 * @param bgHex - 表面底色（hex，truecolor 轨）。
 * @returns 垫色行（displayWidth ≤ width）。
 */
export function withBgFill(line: string, width: number, bgHex: string): string {
  if (width <= 0) return line
  const w = displayWidth(line)
  const padded = w >= width ? truncateToDisplayWidth(line, width) : line + ' '.repeat(width - w)
  return `${bg(bgHex)}${padded}${ANSI.RESET}`
}

/**
 * 多行垫底色（withBgFill 的批量形）。
 * @param lines - 内容行数组。
 * @param width - 目标列数。
 * @param bgHex - 表面底色；undefined 时原样返回（调用方降级）。
 * @returns 垫色行数组。
 */
export function withBgFillLines(lines: readonly string[], width: number, bgHex: string | undefined): string[] {
  if (bgHex === undefined) return [...lines]
  return lines.map(line => withBgFill(line, width, bgHex))
}
