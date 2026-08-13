/**
 * 线框字符集与框体几何 —— 输入框、首屏欢迎框等「圆角盒」的单一事实源。
 *
 * 拆出来的原因是**等宽契约**：首屏欢迎框必须与输入框逐列咬合（左右边线同列、
 * 总宽相同），否则两个框上下叠在一起时会错位。宽度公式若在 app.ts 与
 * welcome.ts 各写一份，改其中一处就会静默破坏对齐——放这里共享。
 */

import { useAsciiBorders } from './term-caps.js'

/** 一套线框字符：四角（tl/tr/bl/br）、横线 h、竖线 v、顶框中缝 m。 */
export interface BoxCharSet { tl: string; tr: string; bl: string; br: string; h: string; v: string; m: string }

/**
 * 输入框线框字符集（按 separator 主题）。纯字面量，提升到模块级避免 renderLive
 * 每帧重建对象字面量。getInputChrome 据此缓存着色后的 leftBar/rightBar/botBorder。
 */
export const INPUT_BOX_CHARS = {
  thin:  { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│', m: '┬' },
  thick: { tl: '┏', tr: '┓', bl: '┗', br: '┛', h: '━', v: '┃', m: '┳' },
  dots:  { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '┄', v: '┊', m: '┬' },
  /** Kimi Code 风格：圆角 thin 字面 + 顶框内嵌模型名标签。字面量与 thin 一致。 */
  kimi:  { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│', m: '┬' },
  /**
   * legacy conhost 降级档：GBK 点阵字体把框线字符按 2 列渲染（或缺字形出
   * tofu），边框行实际宽度超过 cols → 折行 → LiveEngine 回顶欠擦 → 输入框
   * 逐帧重影。ASCII 字符宽度确定为 1 列，任何字体/代码页下都不折行。
   */
  ascii: { tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: '|', m: '+' },
} as const

/**
 * 按 separator 取线框字符集，未知 separator 回退到 thin。返回值确定非空。
 * legacy conhost（useAsciiBorders）下无条件走 ascii 档——该开关进程内恒定
 * （term-caps 缓存），getInputChrome 的 memo key 无需包含它。
 * @param separator - separator 主题名（thin/thick/dots/kimi）。
 * @returns 对应的线框字符集；未知名回退 thin，ASCII 降级档优先。
 */
export function boxCharsFor(separator: string): BoxCharSet {
  if (useAsciiBorders()) return INPUT_BOX_CHARS.ascii
  switch (separator) {
    case 'thick': return INPUT_BOX_CHARS.thick
    case 'dots': return INPUT_BOX_CHARS.dots
    case 'kimi': return INPUT_BOX_CHARS.kimi
    default: return INPUT_BOX_CHARS.thin
  }
}

/**
 * 框内内容区宽度（不含 `│ ` 与 ` │`）。首屏欢迎框与输入框共用，保证等宽。
 *
 * 硬约束：框体外宽 = inner + 4（`│ ` + inner + ` │`）必须 ≤ columns，否则
 * 右边线折到下一行。故 inner 上限 = columns - 4。
 *
 * - columns >= 26：`columns - 6`（在上限内再留 2 列呼吸）—— 正常终端
 * - columns < 26：`columns - 4`（框体顶满，外宽 = columns，贴右边界不超出）
 * - 下限 0：columns < 4 时框体无法成立，返回 0 让上层降级（极罕见）
 *
 * 此前固定下限 20 会让 < 26 列终端的框体外宽(24)超出边界、右边线折行。
 * @param columns - 终端列数。
 * @returns 内容区宽度（列），下限 0。
 */
export function boxInnerWidth(columns: number): number {
  if (columns >= 26) return columns - 6
  return Math.max(0, columns - 4)
}

/**
 * 框体外宽（含左右边线）。顶/底框 = tl + h×(inner+2) + tr，
 * 内容行 = `│ ` + inner + ` │`，两者恒等于 inner + 4。
 * @param columns - 终端列数。
 * @returns 框体外宽（列），恒为 boxInnerWidth(columns) + 4。
 */
export function boxOuterWidth(columns: number): number {
  return boxInnerWidth(columns) + 4
}
