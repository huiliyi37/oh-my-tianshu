/**
 * T9 格式化函数 — 转向消息（中轮 steer，marker 与颜色区分 user）。
 *
 * 渲染结构与 user-message 同一导轨制式（说话人识别靠 marker + 颜色）：
 * - marker：`➤`（truecolor 轨）/ `>>`（ascii 轨），warning 色 + bold
 * - 正文：assistantColor 中性色（同 user 正文层级）
 *
 * @module @huiliyi37/dsh-tianshu-tui/format/steer-message
 */

import chalk from 'chalk'
import type { RivetTheme } from '../theme.js'
import { formatRailedMessage } from './user-message.js'

/** formatSteerMessage 的渲染输入。 */
export interface FormatSteerMessageInput {
  /** 转向文本内容 */
  content: string
  /** 终端宽度（列数） */
  width: number
  /** 消息时间戳（Unix epoch ms）；提供且宽度足够时首行附 [HH:MM]。 */
  timestamp?: number
}

/**
 * 渲染转向消息为 scrollback 行：warning 色 `➤`/`>>` 导轨 + 中性正文，
 * 与 user 消息（`▌`/`❯` + userColor）在 marker 与颜色上区分。
 * @param input - 转向文本与宽度。
 * @param theme - 当前主题（marker 用 warning 色）。
 * @returns 渲染行数组（每行含导轨前缀）。
 */
export function formatSteerMessage(input: FormatSteerMessageInput, theme: RivetTheme): string[] {
  const useAscii = chalk.level < 3
  const marker = useAscii ? '>>' : '➤'
  return formatRailedMessage({ ...input, marker, markerColor: theme.warning }, theme)
}
