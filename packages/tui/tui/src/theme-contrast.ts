/**
 * theme-contrast — 主题色的可读性校验（WCAG 2.x 相对亮度 + 对比度比）。
 *
 * 自定义主题只覆盖前景 token，背景是用户终端自己的——真实背景无法精确知道，
 * 因此用主题声明 background 档位对应的名义背景近似校验；低于阈值时加载
 * 警告但不阻断（fail-open，保留用户意图，警告给出知情权）。
 * 回流自 dsh-tianshu-tui 3e2cb2f。
 *
 * @module @huiliyi37/dsh-tui/theme-contrast
 */

import { hexToRgb } from './engine/ansi.js'

/** WCAG AA 大文本阈值（< 3.0 视为低对比）。 */
export const CONTRAST_MIN_RATIO = 3.0

/** 名义背景（对应主题声明 background 档位的代表值）。 */
const NOMINAL_BG = { dark: '#202124', light: '#fafafa' } as const

/** sRGB 通道线性化（WCAG 2.x 公式）。 */
function linearizeChannel(v: number): number {
  const s = v / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

/**
 * hex 颜色的 WCAG 相对亮度（0 近黑 ~ 1 近白）。
 * @param hex - `#rgb` / `#rrggbb`；无法解析返回 null。
 * @returns WCAG 相对亮度；无法解析为 null。
 */
export function relativeLuminance(hex: string): number | null {
  const rgb = hexToRgb(hex)
  if (rgb === null) return null
  return 0.2126 * linearizeChannel(rgb[0]) + 0.7152 * linearizeChannel(rgb[1]) + 0.0722 * linearizeChannel(rgb[2])
}

/**
 * 两色对比度比（1.0 同色 ~ 21.0 黑白）；任一色无法解析返回 null。
 * @param a - 一侧颜色（hex）。
 * @param b - 另一侧颜色（hex）。
 * @returns 对比度比；任一色不可解析为 null。
 */
export function contrastRatio(a: string, b: string): number | null {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  if (la === null || lb === null) return null
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/** 单个低对比颜色问题。 */
export interface ContrastIssue {
  /** 语义 token 名（如 primary）。 */
  token: string
  /** 颜色值（原样）。 */
  value: string
  /** 与名义背景的对比度。 */
  ratio: number
}

/**
 * 校验前景色集合对主题声明背景的可读性。自定义主题只覆盖前景 token，真实
 * 终端背景未知，因此用声明档位的名义背景近似；< 3.0（WCAG AA 大文本）判低对比。
 * 非 hex 值（chalk 命名色等）跳过——16 色轨语义由内置主题维护，不在此校验。
 * @param colors - token → 颜色值。
 * @param declaredBg - 主题声明的背景档位（缺省 dark）。
 * @returns 问题列表（保持输入键序；全部可读时为空）。
 */
export function validateThemeContrast(
  colors: Record<string, string>,
  declaredBg: 'dark' | 'light' = 'dark',
): ContrastIssue[] {
  const nominal = NOMINAL_BG[declaredBg]
  const issues: ContrastIssue[] = []
  for (const [token, value] of Object.entries(colors)) {
    if (!value.startsWith('#')) continue
    const ratio = contrastRatio(value, nominal)
    if (ratio === null) continue
    if (ratio < CONTRAST_MIN_RATIO) issues.push({ token, value, ratio })
  }
  return issues
}
