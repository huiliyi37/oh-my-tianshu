/**
 * 欢迎页鲸鱼品牌像素画（format/whale.ts）— 纯渲染。
 *
 * 半块字符像素画：每个字符格用 `▀`（fg=上像素 + bg=下像素）表达 2 个纵向
 * 像素；单色格用 `█`、半透明格用 `▀`/`▄` 仅设前景，全透明格纯空格（不涂
 * 背景，终端底色透出）。块字符（U+2580–259F）在 narrow/wide 宽度档均按
 * 1 列计（width.ts isBoxOrBlock），居中数学与宽度守恒成立；legacy CJK
 * conhost（full 档）把块字符渲染成 2 列会拉伸错位——该档整体降级不出画。
 *
 * 品牌资产用固定色（不随主题变）：品牌蓝身体 + 白肚 + 深色眼。
 * 白肚在亮色主题下与终端底色融合，恰好还原 logo 在白纸上的原始观感。
 */
import chalk from 'chalk'
import { ANSI, bg, fg } from '../engine/ansi.js'
import { ambiguousWidthMode } from '../width.js'

/**
 * 像素网格（16 行 × 24 列 → 8 文本行）。图例：
 * `.` 透明 / `B` 身体蓝 / `W` 白肚 / `E` 眼睛 / `P` 腮红。
 * 形状对照品牌手绘鲸鱼：圆润身体、左下白肚、上中深色眼 + 腮红、右上翘尾。
 */
const GRID: readonly string[] = [
  '.................BB..BB.',
  '.................BBBBBB.',
  '......BBBBBBB....BBBB...',
  '....BBBBBBBBBBB..BBB....',
  '..BBBBBBBBBBBBBBBBBB....',
  '.BBBBBBBBBBBBBBBBBBB....',
  '.BBBBBBBBEEBBBBBBBBB....',
  'BBWWWWBBBEEBBBBBBBBB....',
  'BWWWWWWPPBBBBBBBBBB.....',
  'BWWWWWWPPBBBBBBBBBB.....',
  'BWWWWWWWWWWWBBBBBB......',
  'BWWWWWWWWWWWWWBBBB......',
  '.BWWWWWWWWWWWWWBBB......',
  '..BWWWWWWWWWWWBBB.......',
  '....BBWWWWWWWBBB........',
  '.......BBBBBBBB.........',
]

/** 像素画宽度（列数）。 */
export const WHALE_COLS = 24
/** 像素画高度（文本行数 = 像素行 / 2）。 */
export const WHALE_ROWS = GRID.length / 2

/** 出画最小终端列数（含两侧呼吸空间）。 */
export const WHALE_MIN_COLS = 40
/** 出画最小终端行数（画 8 行 + 品牌/菜单/环境行整块可容纳）。 */
export const WHALE_MIN_ROWS = 22

/** 鲸鱼调色板（品牌固定色，语义同 GRID 图例）。 */
interface WhalePalette {
  body: string
  belly: string
  eye: string
  blush: string
}

/** truecolor/256 轨：品牌蓝 + 近白肚（纯白在暗底刺眼）+ 深藏青眼。 */
const TRUECOLOR_PALETTE: WhalePalette = {
  body: '#4d6bfe',
  belly: '#f2f5fa',
  eye: '#14204a',
  blush: '#f5a8b8',
}

/** 16 色轨：命名色近似；腮红细节该档不表达（映射回身体色）。 */
const ANSI16_PALETTE: WhalePalette = {
  body: 'blueBright',
  belly: 'whiteBright',
  eye: 'blue',
  blush: 'blueBright',
}

/** SGR 背景回默认（49）：透明格前清背景，防止半块 bg 泄漏到空格。 */
const BG_DEFAULT = '\x1B[49m'

/** omp 风格对角渐变停靠点（粉 → 紫 → 长春花蓝 → 薄荷），仅 truecolor 轨。 */
const BODY_GRADIENT_STOPS = ['#ff5cc8', '#a06bfa', '#7aa2f7', '#4fd6be'] as const

/** hex '#rrggbb' → rgb 三元组。 */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) }
}

/** 对角渐变取样：t ∈ [0,1] 沿对角线方向，相邻停靠点线性插值。 */
function gradientColorAt(t: number): string {
  const pos = Math.min(0.9999, Math.max(0, t)) * (BODY_GRADIENT_STOPS.length - 1)
  const i = Math.floor(pos)
  const frac = pos - i
  /* v8 ignore next -- pos ∈ [0, len-1)，i 与 i+1 恒在界内（noUncheckedIndexedAccess 收窄） */
  const a = hexToRgb(BODY_GRADIENT_STOPS[i] ?? '#ff5cc8'), b = hexToRgb(BODY_GRADIENT_STOPS[i + 1] ?? '#4fd6be')
  const mix = (u: number, v: number): string => Math.round(u + (v - u) * frac).toString(16).padStart(2, '0')
  return `#${mix(a.r, b.r)}${mix(a.g, b.g)}${mix(a.b, b.b)}`
}

function pixelColor(ch: string, pal: WhalePalette): string | null {
  switch (ch) {
    case 'B': return pal.body
    case 'W': return pal.belly
    case 'E': return pal.eye
    case 'P': return pal.blush
    default: return null
  }
}

/** formatWhaleLogo 的渲染输入。 */
export interface FormatWhaleLogoInput {
  /** 终端列数。 */
  width: number
  /** 终端行数（整块可容纳性门禁）。 */
  rows: number
  /** 颜色能力等级（缺省 chalk.level）；≥2 走品牌 hex 轨，1 走命名色轨，0 不出画。 */
  colorLevel?: number
  /** 身体像素走 omp 风格对角渐变（仅 truecolor 轨；白肚/眼/腮红保持原色）。 */
  bodyGradient?: boolean
}

/**
 * 欢迎页鲸鱼像素画：返回在 width 内水平居中的 ANSI 行数组（WHALE_ROWS 行）。
 * 降级矩阵（任一不满足返回空数组，调用方回落纯文字品牌区）：
 * - `width ≥ WHALE_MIN_COLS` 且 `rows ≥ WHALE_MIN_ROWS`
 * - `colorLevel ≥ 1`（无色终端画不出品牌色，纯剪影无识别度）
 * - `ambiguousWidthMode() !== 'full'`（legacy conhost 块字符按 2 列渲染）
 * 宽度守恒：任何输出行 displayWidth ≤ width；画不截断，放不下即整体降级。
 * @param input - 终端尺寸与颜色能力等级。
 * @returns 居中 ANSI 行数组；降级时空数组。
 */
export function formatWhaleLogo(input: FormatWhaleLogoInput): string[] {
  const level = input.colorLevel ?? chalk.level
  if (level < 1) return []
  if (input.width < WHALE_MIN_COLS || input.rows < WHALE_MIN_ROWS) return []
  if (ambiguousWidthMode() === 'full') return []

  const pal = level >= 2 ? TRUECOLOR_PALETTE : ANSI16_PALETTE
  // 渐变轨（omp 风格）：仅 truecolor 且显式开启；身体像素按对角位置取样，
  // 白肚/眼/腮红不受影响（它们的像素色与 body 不同，天然豁免）。
  const gradient = input.bodyGradient === true && level >= 2
  const colorAt = (ch: string, x: number, y: number): string | null => {
    const c = pixelColor(ch, pal)
    if (gradient && c === pal.body) {
      return gradientColorAt((x / (WHALE_COLS - 1) + y / (GRID.length - 1)) / 2)
    }
    return c
  }
  const indent = ' '.repeat(Math.max(0, Math.floor((input.width - WHALE_COLS) / 2)))
  const out: string[] = []
  for (let y = 0; y < GRID.length; y += 2) {
    const top = GRID[y] ?? ''
    const bottom = GRID[y + 1] ?? ''
    let line = ''
    let curFg: string | null = null
    let curBg: string | null = null
    // 透明格先攒着：行尾透明段直接丢弃（右侧不补空格，宽度守恒），
    // 行中透明段在下一个可见格前一次性落盘。
    let pendingSpaces = 0
    for (let x = 0; x < WHALE_COLS; x++) {
      const t = colorAt(top[x] ?? '.', x, y)
      const b = colorAt(bottom[x] ?? '.', x, y + 1)
      let ch: string
      let wantFg: string
      let wantBg: string | null = null
      if (t === null) {
        if (b === null) {
          pendingSpaces++
          continue
        }
        ch = '▄'
        wantFg = b
      } else if (b === null) {
        ch = '▀'
        wantFg = t
      } else if (t === b) {
        ch = '█'
        wantFg = t
      } else {
        ch = '▀'
        wantFg = t
        wantBg = b
      }
      if (pendingSpaces > 0) {
        // 空格前必须清背景：上一格若有 bg，空格会被涂成色块。
        if (curBg !== null) {
          line += BG_DEFAULT
          curBg = null
        }
        line += ' '.repeat(pendingSpaces)
        pendingSpaces = 0
      }
      if (wantBg !== curBg) {
        line += wantBg === null ? BG_DEFAULT : bg(wantBg)
        curBg = wantBg
      }
      if (wantFg !== curFg) {
        line += fg(wantFg)
        curFg = wantFg
      }
      line += ch
    }
    out.push(line === '' ? '' : `${indent}${line}${ANSI.RESET}`)
  }
  return out
}
