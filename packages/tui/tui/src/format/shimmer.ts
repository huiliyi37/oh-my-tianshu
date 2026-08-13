/**
 * shimmer 光带动画 — 单行文本的「高亮带从左到右扫过」效果。
 * 样式源：用户提供的 deep-diving.gif（369×66、45 帧 @25fps ≈1.8s/轮，
 * 蓝色文字 + 光带循环扫过）；消费方为 live 区 reasoning 头行。
 *
 * 纯函数：同一 (text, tick) 恒产出同一 ANSI 串，动画由 app.ts 的 120ms
 * tick 循环驱动（braille spinner 同款模式）。光带定位按显示列计算（CJK
 * 宽字符占 2 列），逐字符把 base 色向 highlight 色插值；相邻同档字符合并
 * 为一段转义，序列段数受量化档数约束。
 *
 * 色深降级：仅当 base/highlight 均为可解析 hex（truecolor/256 色轨主题
 * token）时做逐字符插值——fg() 在 256 色终端自行量化；16 色轨（chalk
 * 命名色 token）降级为静态整行着色，不做逐字符伪动画。
 */

import { ANSI, color, fg, hexToRgb } from '../engine/ansi.js'
import { displayWidth } from '../width.js'

/** 一轮光带扫过的 tick 数（120ms/tick × 15 ≈ 1.8s，对齐 GIF 节奏）。 */
export const SHIMMER_PERIOD_TICKS = 15

/** 光带半宽（显示列）：中心两侧各 band 列内亮度按余弦缓落。 */
export const SHIMMER_BAND_COLS = 6

/** 亮度插值量化档数：限制每帧的转义段数（≤ 档数 + 1 段）。 */
const MIX_STEPS = 7

/** RGB 元组 → `#rrggbb`。 */
function rgbToHex(rgb: readonly [number, number, number]): string {
  const part = (v: number): string => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')
  return `#${part(rgb[0])}${part(rgb[1])}${part(rgb[2])}`
}

/**
 * 两个 hex 颜色的线性插值。
 * @param a - 起点色（hex）。
 * @param b - 终点色（hex）。
 * @param t - 插值系数（0 = a，1 = b；范围外截断）。
 * @returns 插值后的 `#rrggbb`；任一输入不可解析时原样返回 `a`。
 */
export function mixHex(a: string, b: string, t: number): string {
  const ra = hexToRgb(a)
  const rb = hexToRgb(b)
  if (ra === null || rb === null) return a
  const k = Math.max(0, Math.min(1, t))
  return rgbToHex([
    ra[0] + (rb[0] - ra[0]) * k,
    ra[1] + (rb[1] - ra[1]) * k,
    ra[2] + (rb[2] - ra[2]) * k,
  ])
}

/**
 * 光带高亮色派生：base 向白色混合 ~65%（GIF 光带的提亮感），不硬编码
 * GIF 原色以保持主题一致性。
 * @param base - 基色（主题语义 token）。
 * @returns 提亮后的 hex；base 不可解析（16 色轨）时原样返回。
 */
export function shimmerHighlight(base: string): string {
  return mixHex(base, '#ffffff', 0.65)
}

/** shimmerLine 的渲染输入。 */
export interface ShimmerInput {
  /** 要渲染的单行文本（不含换行）。 */
  text: string
  /** 动画帧序号（app.ts 120ms tick）。 */
  tick: number
  /** 基色（hex 或 16 色轨命名色；后者触发静态降级）。 */
  base: string
  /** 光带高亮色（hex；通常由 {@link shimmerHighlight} 派生）。 */
  highlight: string
  /** 一轮扫过的 tick 数；缺省 {@link SHIMMER_PERIOD_TICKS}。 */
  periodTicks?: number
  /** 光带半宽（显示列）；缺省 {@link SHIMMER_BAND_COLS}。 */
  bandCols?: number
}

/**
 * 渲染一帧 shimmer 行：光带中心随 tick 从文本左侧 band 列外扫到右侧
 * band 列外（进出场与 GIF 的循环「熄灭」帧一致），带内字符按与中心的
 * 显示列距离做余弦衰减插值。
 * @param input - 文本、tick 与颜色参数。
 * @returns 单行 ANSI 串（末尾 RESET）；base/highlight 任一不可解析时
 *   降级为静态 base 色整行。
 */
export function shimmerLine(input: ShimmerInput): string {
  const base = hexToRgb(input.base)
  const highlight = hexToRgb(input.highlight)
  if (base === null || highlight === null) return color(input.text, input.base)

  const period = Math.max(1, input.periodTicks ?? SHIMMER_PERIOD_TICKS)
  const band = Math.max(1, input.bandCols ?? SHIMMER_BAND_COLS)
  const cols = displayWidth(input.text)
  const phase = (((input.tick % period) + period) % period) / period
  const center = phase * (cols + 2 * band) - band

  let out = ''
  let col = 0
  let lastSeq = ''
  for (const ch of input.text) {
    const w = displayWidth(ch)
    const mid = col + w / 2
    col += w
    const dist = Math.abs(mid - center)
    // 带外为 0（保持 base），带内余弦缓落；量化到 MIX_STEPS 档合并同色段。
    const raw = dist >= band ? 0 : 0.5 * (1 + Math.cos((Math.PI * dist) / band))
    const t = Math.round(raw * MIX_STEPS) / MIX_STEPS
    const seq = fg(rgbToHex([
      base[0] + (highlight[0] - base[0]) * t,
      base[1] + (highlight[1] - base[1]) * t,
      base[2] + (highlight[2] - base[2]) * t,
    ]))
    if (seq !== lastSeq) {
      out += seq
      lastSeq = seq
    }
    out += ch
  }
  return `${out}${ANSI.RESET}`
}
