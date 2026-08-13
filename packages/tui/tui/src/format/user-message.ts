/**
 * T9 格式化函数 — 用户消息与转向消息共用「说话人导轨」制式。
 *
 * 源出 .rivet/tui-source/tui/format/user-message.ts（Apache-2.0 来源，见
 * LICENSE/NOTICE/SOURCE-MAP.md）。本文件为 dsh-tui 移植的基础版，无天枢耦合。
 *
 * 渲染结构（导轨制式，marker + 颜色承担说话人识别）：
 * ▌ 消息首行             (markerColor + bold 导轨；regular 中性正文)
 * ▌ 消息后续行           (同一导轨；regular 中性正文)
 * ▌                       (空行只保留导轨)
 *
 * 说话人：
 * - user：marker `❯`/`▌` + userColor（formatUserMessage）
 * - steer：marker `>>`/`➤` + warning（formatSteerMessage，见 steer-message.ts）
 */

import chalk from 'chalk'
import { color } from '../engine/ansi.js'
import type { RivetTheme } from '../theme.js'
import { displayWidth, wrapToDisplayWidth } from '../width.js'

/** formatUserMessage 的渲染输入。 */
export interface FormatUserMessageInput {
  /** 消息文本内容 */
  content: string
  /** 终端宽度（列数） */
  width: number
  /** 消息时间戳（Unix epoch ms）；提供且宽度足够时首行附 [HH:MM]。 */
  timestamp?: number
}

/** 说话人导轨渲染输入（user/steer 共用；marker 与 markerColor 由调用方给出）。 */
export interface FormatRailedMessageInput {
  content: string
  width: number
  /** 说话人导轨 marker 字符（ascii 轨由调用方给出 fallback）。 */
  marker: string
  /** marker 着色（语义 token，如 theme.userColor / theme.warning）。 */
  markerColor: string
  /** 消息时间戳（Unix epoch ms）；提供且宽度足够时首行附 [HH:MM]。 */
  timestamp?: number
}

/**
 * 消息时间戳 → `[HH:MM]` 显示段（本地时区）。
 * @param ms - Unix epoch 毫秒。
 * @returns 形如 `[14:32]` 的显示文本。
 */
export function formatTimestamp(ms: number): string {
  const d = new Date(ms)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `[${hh}:${mm}]`
}

/**
 * 渲染一条「说话人导轨」消息：markerColor+bold 导轨前缀 + 中性正文。
 * 首行与正文同行；后续行维持同一导轨，空行只保留导轨。
 * 正文按 width 折叠（导轨前缀宽度计入每行预算；CJK 宽字符按显示宽度度量）。
 * 提供 timestamp 且正文宽度足够时，首行最后一块后附 `[HH:MM]`（宽度预算
 * 从首行折叠扣除，窄宽隐藏不破版）。
 * @param input - 文本、宽度、marker 与 markerColor。
 * @param theme - 当前主题（正文用 assistantColor 中性色；时间戳用 secondary）。
 * @returns 渲染行数组（每行含导轨前缀）。
 */
export function formatRailedMessage(input: FormatRailedMessageInput, theme: RivetTheme): string[] {
  const lines: string[] = []
  const prefix = color(input.marker, input.markerColor, { bold: true })
  // 正文可用宽度：总宽 − 导轨（marker + 空格）
  const railWidth = displayWidth(input.marker) + 1
  const bodyWidth = Math.max(0, input.width - railWidth)
  // 时间戳段：宽度足够（含前缀空格共 8 列）才渲染；不足时整体隐藏
  const stampText = input.timestamp !== undefined && bodyWidth >= 12
    ? ` ${color(formatTimestamp(input.timestamp), theme.secondary)}`
    : ''
  const stampWidth = displayWidth(stampText)

  for (const [index, contentLine] of input.content.split('\n').entries()) {
    if (contentLine.trim().length === 0) {
      lines.push(prefix)
      continue
    }
    // 窄宽退化：导轨已占满预算时不折叠，正文整体一行（不破版即可）
    if (bodyWidth <= 0) {
      lines.push(`${prefix} ${color(contentLine, theme.assistantColor)}`)
      continue
    }
    // 按显示宽度折叠正文；每行都带导轨。首行预算扣除时间戳宽度，
    // 时间戳挂在首行第一块后（消息时间跟随首行）。
    const firstChunkBudget = index === 0 ? Math.max(1, bodyWidth - stampWidth) : bodyWidth
    const chunks = wrapToDisplayWidth(contentLine, firstChunkBudget)
    for (const [chunkIndex, chunk] of chunks.entries()) {
      const stamp = index === 0 && chunkIndex === 0 ? stampText : ''
      lines.push(`${prefix} ${color(chunk, theme.assistantColor)}${stamp}`)
    }
  }

  return lines
}

/**
 * 渲染用户消息为 scrollback 行：userColor `❯`/`▌` 导轨 + 中性正文。
 * @param input - 用户消息文本与宽度。
 * @param theme - 当前主题（marker 用 userColor）。
 * @returns 渲染行数组（每行含导轨前缀）。
 */
export function formatUserMessage(input: FormatUserMessageInput, theme: RivetTheme): string[] {
  const useAscii = chalk.level < 3
  const marker = useAscii ? '❯' : '▌'
  return formatRailedMessage({ ...input, marker, markerColor: theme.userColor }, theme)
}
