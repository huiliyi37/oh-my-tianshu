/**
 * Scrollback transcript parser — turns CommitEngine text into message-level units
 * for the `/scroll` (pager) overlay search and expansion.
 *
 * 预留：/scroll overlay 未接线——parseScrollbackTranscript 当前无消费端，仅登记 API。
 *
 * 解析策略（保守启发式）：
 * - 按行扫描，识别消息起始标记。
 * - 用户消息：行首（去 ANSI 后）为 `▌` 或 `❯`。
 * - 工具结果：行首（去 ANSI 后）为工具卡 bullet 之一（`›` 成功 / `✗` 失败 /
 *   `⠋` 进行中 / `?` 待答 / `●` live 卡）。
 * - 其余连续行归为一个 assistant/system 块。
 * - 截断检测：交给 truncation-marker.ts 的共享正则（同时认中文与历史英文标记）。
 */

import { displayWidth } from './width.js'
import { TRUNCATION_MARKER_RE } from './truncation-marker.js'

const ANSI_RE = /\x1B\[[0-9;]*[a-zA-Z]/g

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '')
}

/** 消息角色（首行标记推断；无标记的连续行归 assistant）。 */
export type TranscriptRole = 'user' | 'assistant' | 'tool' | 'system'

/** 解析出的消息级单元（行号区间 + 摘要 + 搜索用纯文本）。 */
export interface TranscriptMessage {
  /** 消息在 scrollback 中的起始行索引 */
  startLine: number
  /** 消息在 scrollback 中的结束行索引（不含） */
  endLine: number
  role: TranscriptRole
  /** 首行去 ANSI 后的摘要 */
  summary: string
  /** 完整 ANSI 行 */
  lines: string[]
  /** 是否包含被截断的工具输出 */
  isTruncated: boolean
  /** 去 ANSI 后的原始内容，用于搜索 */
  rawContent: string
}

const TOOL_BULLETS = ['\u25CF', '\u203A', '\u2717', '\u280B', '? '] as const

function detectRole(strippedFirstLine: string): TranscriptRole | null {
  const trimmed = strippedFirstLine.trimStart()
  // U+258C left half block (user marker) / U+276F heavy right-pointing angle bracket
  if (trimmed.startsWith('\u258C') || trimmed.startsWith('\u276F')) return 'user'
  // 工具卡 bullet 全集：U+25CF ● (live) / U+203A › (成功) / U+2717 ✗ (失败) /
  // U+280B ⠋ (进行中) / '?' (待答)。ASCII 降级轨的 '>' 'x' '-' 不在此列——
  // 它们与普通正文首字符撞车，误判代价高于漏判。
  if (TOOL_BULLETS.some(b => trimmed.startsWith(b))) return 'tool'
  // box-drawing corners for system blocks
  if (trimmed.startsWith('┌─') || trimmed.startsWith('╭─')) return 'system'
  return null
}

function isTruncatedMessage(lines: string[]): boolean {
  return lines.some(line => TRUNCATION_MARKER_RE.test(stripAnsi(line)))
}

function makeSummary(_role: TranscriptRole, firstLine: string): string {
  const stripped = stripAnsi(firstLine).trimStart()
  const maxLen = 80
  if (stripped.length > maxLen) return stripped.slice(0, maxLen - 1) + '…'
  return stripped
}

/**
 * 解析 scrollback 内容为消息列表。
 * @param content - CommitEngine 累积的 scrollback 全文（可含 ANSI）。
 * @returns 消息列表（空白内容返回空数组）。
 */
export function parseScrollbackTranscript(content: string): TranscriptMessage[] {
  if (!content.trim()) return []
  const allLines = content.split('\n')
  const messages: TranscriptMessage[] = []
  let currentStart = 0
  let currentRole: TranscriptRole = 'assistant'
  let currentLines: string[] = []

  function flush(end: number): void {
    if (currentLines.length === 0) return
    const firstLine = currentLines[0]
    /* v8 ignore next 1 -- unreachable: currentLines.length > 0 已在上方守卫，firstLine 恒有值 */
    if (firstLine === undefined) return // unreachable: length > 0
    messages.push({
      startLine: currentStart,
      endLine: end,
      role: currentRole,
      summary: makeSummary(currentRole, firstLine),
      lines: currentLines,
      isTruncated: isTruncatedMessage(currentLines),
      rawContent: currentLines.map(stripAnsi).join('\n').toLowerCase(),
    })
  }

  for (let i = 0; i < allLines.length; i++) {
    /* v8 ignore next 1 -- unreachable: split('\n') 数组无 hole，i < length 时 allLines[i] 恒非 undefined */
    const line = allLines[i] ?? ''
    const role = detectRole(stripAnsi(line))
    if (role !== null) {
      flush(i)
      currentStart = i
      currentRole = role
      currentLines = [line]
    } else {
      currentLines.push(line)
    }
  }
  flush(allLines.length)
  return messages
}

/**
 * 在消息列表中搜索 query（大小写不敏感）。
 * @param messages - 消息列表。
 * @param query - 查询串（trim 后为空返回空数组）。
 * @returns 匹配的消息索引数组（升序）。
 */
export function searchTranscript(messages: readonly TranscriptMessage[], query: string): number[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const matches: number[] = []
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]
    if (message !== undefined && message.rawContent.includes(q)) matches.push(i)
  }
  return matches
}

/**
 * 找到下一个匹配索引，循环（末尾之后绕回首个匹配）。
 * @param messages - 消息列表。
 * @param current - 当前消息索引。
 * @param query - 查询串。
 * @returns 下一个匹配索引；无匹配返回 current。
 */
export function findNextMatch(messages: readonly TranscriptMessage[], current: number, query: string): number {
  const matches = searchTranscript(messages, query)
  if (matches.length === 0) return current
  const first = matches[0]
  /* v8 ignore next 1 -- unreachable: matches.length > 0 已在上方守卫，first 恒有值 */
  if (first === undefined) return current // unreachable: length > 0
  const next = matches.find(idx => idx > current)
  return next ?? first
}

/**
 * 找到上一个匹配索引，循环（开头之前绕回最后匹配）。
 * @param messages - 消息列表。
 * @param current - 当前消息索引。
 * @param query - 查询串。
 * @returns 上一个匹配索引；无匹配返回 current。
 */
export function findPrevMatch(messages: readonly TranscriptMessage[], current: number, query: string): number {
  const matches = searchTranscript(messages, query)
  if (matches.length === 0) return current
  const last = matches[matches.length - 1]
  /* v8 ignore next 1 -- unreachable: matches.length > 0 已在上方守卫，last 恒有值 */
  if (last === undefined) return current // unreachable: length > 0
  const prev = [...matches].reverse().find(idx => idx < current)
  return prev ?? last
}

/**
 * 估算某条消息在 overlay 中占多少显示行（粗略，折行按显示宽度向上取整）。
 * @param message - 消息。
 * @param columns - 终端列数（<1 按 1 处理）。
 * @returns 估算显示行数（每逻辑行至少 1 行）。
 */
export function estimateMessageRows(message: TranscriptMessage, columns: number): number {
  let rows = 0
  for (const line of message.lines) {
    const w = displayWidth(line)
    rows += Math.max(1, Math.ceil(w / Math.max(1, columns)))
  }
  return rows
}

/**
 * 计算从第一条消息到指定消息起始处的累计显示行数。
 * @param messages - 消息列表。
 * @param targetIndex - 目标消息索引（不含自身；越界时累计到列表末尾）。
 * @param columns - 终端列数。
 * @returns 累计显示行数。
 */
export function cumulativeRowsToMessage(
  messages: readonly TranscriptMessage[],
  targetIndex: number,
  columns: number,
): number {
  let rows = 0
  for (let i = 0; i < targetIndex && i < messages.length; i++) {
    const message = messages[i]
    /* v8 ignore next 1 -- unreachable: i < messages.length 保证 message 恒非 undefined */
    if (message === undefined) continue
    rows += estimateMessageRows(message, columns)
  }
  return rows
}
