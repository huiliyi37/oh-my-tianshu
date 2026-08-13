/**
 * /export 会话导出渲染（纯函数，Cordis-free）：session events → Markdown 文本。
 * 数据源是会话日志（权威事件流）——导出完整内容（无折叠/截断的渲染视图缺陷）；
 * 工具结果超长按 5000 字符截断并附标记。同输入恒同输出（可测）。
 * @module dsh-tui/format/export
 */

import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** 导出元信息（头块）。 */
export interface SessionExportMeta {
  /** 会话 id。 */
  sessionId: string
  /** 工作区路径（可选）。 */
  cwd?: string
}

/** 工具结果文本截断上限。 */
const TOOL_RESULT_CAP = 5000

/** 抽取消息的文本块（text + reasoning 分离）。 */
function messageText(message: Message): { text: string; reasoning: string } {
  let text = ''
  let reasoning = ''
  for (const block of message.content) {
    switch (block.type) {
      case 'text':
        text += block.text
        break
      case 'reasoning':
        reasoning += block.text
        break
      default:
        // tool-call 等块由调用方单独处理
        break
    }
  }
  return { text, reasoning }
}

/** 截断超长文本（保留头部 + 尾部 + 标记）。 */
function truncate(text: string, cap: number): string {
  if (text.length <= cap) return text
  return `${text.slice(0, cap)}\n…+${text.length - cap} 字符`
}

/** 渲染一条工具结果消息（ToolResultMessage 的 content 是 ToolResultBlock 元组）。 */
function renderToolResult(message: Message): string {
  const blocks = message.content.flatMap(block => block.type === 'tool-result' ? block.content : [])
  const text = blocks
    .filter((block): block is ContentBlock & { type: 'text' } => block.type === 'text')
    .map(block => block.text)
    .join('')
  return truncate(text, TOOL_RESULT_CAP)
}

/**
 * 把会话事件渲染为可分享的 Markdown 转录。
 * @param events - 会话事件日志（权威数据源）。
 * @param meta - 导出头信息。
 * @returns 完整 Markdown 文本。
 */
export function renderSessionExport(events: readonly SessionEvent[], meta: SessionExportMeta): string {
  const lines: string[] = []
  lines.push(`# Session export — ${meta.sessionId}`)
  if (meta.cwd !== undefined && meta.cwd !== '') lines.push(`工作区: ${meta.cwd}`)
  lines.push('')

  let count = 0
  for (const event of events) {
    switch (event.type) {
      case 'user/message': {
        const { text } = messageText(event.data)
        if (text !== '') {
          lines.push('## 用户', '', text, '')
          count++
        }
        break
      }
      case 'assistant/message': {
        const { text, reasoning } = messageText(event.data.message)
        const toolCalls = event.data.message.content
          .filter(block => block.type === 'tool-call')
          .map(block => `${block.name}(${block.arguments})`)
        if (text === '' && reasoning === '' && toolCalls.length === 0) break
        lines.push('## Assistant', '')
        if (reasoning !== '') lines.push(`> 推理: ${reasoning}`, '')
        if (text !== '') lines.push(text, '')
        for (const call of toolCalls) lines.push(`工具调用: \`${call}\``)
        lines.push('')
        count++
        break
      }
      case 'tool/result': {
        const text = renderToolResult(event.data.message)
        if (text !== '') {
          lines.push('## 工具结果', '', text, '')
          count++
        }
        break
      }
      default:
        break
    }
  }

  if (count === 0) lines.push('（无消息）')
  return lines.join('\n')
}
