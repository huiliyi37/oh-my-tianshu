/**
 * 顶边状态栏（format/top-status-bar.ts）— 纯渲染。
 *
 * omp 签名形态：段式状态嵌进输入框顶轨——`╭─ 左段 › 左段 ───填充─── 右段 ‹ 右段 ─╮`。
 * 左段 primary 色（身份：模型 / effort），右段 muted 色（metrics：缓存/上下文/token/
 * API），分隔符 dim，中段横线填充 secondary。右段放不下时从尾部丢段，再挤不动
 * 回落纯横线轨。ascii 档分隔符降级为 `>`/`<`。宽度守恒：输出行 displayWidth ≤ width。
 *
 * @module @huiliyi37/dsh-tui/format/top-status-bar
 */
import { ANSI, bg, color } from '../engine/ansi.js'
import { useAsciiGlyphs } from '../term-caps.js'
import type { RivetTheme } from '../theme.js'
import { displayWidth, truncateToDisplayWidth } from '../width.js'

/** 整行着铬区底：每个 RESET 后重挂底色，保证全行（含各着色段间隙）连续成带。 */
function onChrome(line: string, chromeBg: string | undefined): string {
  if (chromeBg === undefined) return line
  const bgSeq = bg(chromeBg)
  return bgSeq + line.split(ANSI.RESET).join(ANSI.RESET + bgSeq) + ANSI.RESET
}

/** formatTopStatusBar 的渲染输入。 */
export interface TopStatusBarInput {
  /** 终端列数（轨线外宽 = width）。 */
  width: number
  /** 左段（身份：模型/effort 等），primary 色，` › ` 分隔。 */
  left: readonly string[]
  /** 右段（metrics：缓存/上下文/token/API 等），muted 色，` ‹ ` 分隔；窄宽从尾部丢。 */
  right: readonly string[]
  /** 边框色（与输入框同一条模式响应轨线色）。 */
  borderColor: string
}

/**
 * 渲染 omp 风格顶边状态栏单行。
 * @param input - 宽度、左右段与边框色。
 * @param theme - 当前主题。
 * @returns 单行 ANSI（displayWidth ≤ width）；width < 12 或段全空时回落纯横线轨。
 */
export function formatTopStatusBar(input: TopStatusBarInput, theme: RivetTheme): string {
  const { width } = input
  const border = (s: string): string => color(s, input.borderColor)
  const plainRail = (): string => onChrome(border(`╭${'─'.repeat(Math.max(0, width - 2))}╮`), theme.chromeBg)
  if (width < 12) return plainRail()
  const ascii = useAsciiGlyphs()
  const sepL = ascii ? '>' : '›'
  const sepR = ascii ? '<' : '‹'
  const left = input.left.filter(s => s !== '')
  const right = input.right.filter(s => s !== '')
  if (left.length === 0 && right.length === 0) return plainRail()

  const joinW = (segs: readonly string[], sep: string): number =>
    displayWidth(segs.join(` ${sep} `))
  let rightDropped = [...right]
  for (;;) {
    const lw = left.length > 0 ? joinW(left, sepL) : 0
    const rw = rightDropped.length > 0 ? joinW(rightDropped, sepR) : 0
    // ╭─(2) + 左 + 填充 + 右 + ─╮(2)；左右同在时填充至少 2 列作视觉分隔。
    const fill = width - 4 - lw - rw
    const need = lw > 0 && rw > 0 ? 2 : 1
    if (fill >= need) {
      const leftAnsi = left.map(s => color(s, theme.primary)).join(color(` ${sepL} `, theme.dim))
      const rightAnsi = rightDropped.map(s => color(s, theme.muted)).join(color(` ${sepR} `, theme.dim))
      const gap = color('─'.repeat(fill), theme.secondary)
      return onChrome(`${border('╭─')}${leftAnsi}${gap}${rightAnsi}${border('─╮')}`, theme.chromeBg)
    }
    if (rightDropped.length > 0) {
      // 从尾部丢右段（最次要先行）
      rightDropped = rightDropped.slice(0, -1)
      continue
    }
    // 只剩左段仍超宽：截断左段
    const budget = width - 4
    if (budget <= 0 || left.length === 0) return plainRail()
    const leftAnsi = color(truncateToDisplayWidth(left.join(` ${sepL} `), budget), theme.primary)
    return onChrome(`${border('╭─')}${leftAnsi}${border('─╮')}`, theme.chromeBg)
  }
}
