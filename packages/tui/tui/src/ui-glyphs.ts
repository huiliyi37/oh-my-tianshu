/**
 * 高频 UI chrome 的宽度稳定字形。
 *
 * 核心界面不使用彩色 emoji：它们由宿主字体决定颜色与字面，通常占两列，
 * 会让主题语义色失效。legacy 终端继续走纯 ASCII 降级。
 */

import { useAsciiGlyphs } from './term-caps.js'

/** 高频 UI chrome 的宽度稳定字形集（侧问标记与计划状态四态）。 */
export interface UiGlyphs {
  readonly sideQuestion: string
  readonly planSubmitted: string
  readonly planApproved: string
  readonly planRejected: string
  readonly planExecuted: string
}

const UNICODE_GLYPHS = {
  sideQuestion: '◇',
  planSubmitted: '◈', // 原为 '◇' 与 sideQuestion 撞字形——提问与「计划已提交」两种语义要有别
  planApproved: '✓',
  planRejected: '✗',
  planExecuted: '◆',
} as const satisfies UiGlyphs

const ASCII_GLYPHS = {
  sideQuestion: '?',
  planSubmitted: '-',
  planApproved: '+',
  planRejected: 'x',
  planExecuted: '*',
} as const satisfies UiGlyphs

/**
 * 当前终端应使用的字形集。
 * @returns legacy 终端为 ASCII 降级档，其余为 Unicode 档。
 */
export function uiGlyphs(): UiGlyphs {
  return useAsciiGlyphs() ? ASCII_GLYPHS : UNICODE_GLYPHS
}
