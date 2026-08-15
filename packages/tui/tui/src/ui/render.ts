/**
 * 转录渲染 — 把 adapter/transcript 的 TranscriptView 投影渲染为终端行。
 *
 * 纯函数层：输入 TranscriptView + RivetTheme + 终端宽度（+ 可选 presenter
 * 意图解析器），输出 ANSI 行数组。零 IO、零全局状态，便于单测；TuiApp
 * 装配层只负责把这些行送进 CommitEngine / LiveEngine。
 *
 * 消息 → 行映射：
 * - user → formatUserMessage（▌ 导轨）
 * - assistant → 思考块（reasoning 折叠，暗色）+ formatMarkdown 正文
 * - tool/call+result 配对 → formatToolViewCard（presenter 意图优先，
 *   diff/terminal 结构化卡；无意图回落 formatToolCard 文本折叠）
 *
 * 顺序契约：renderTranscript 按事件 seq 交错消息与工具卡（卡插在其
 * `tool/call` 事件的位置）——与 live 路径的逐事件提交产出同一顺序，
 * resume 回放与实时会话渲染一致。
 */

import type { SessionEvent } from '@huiliyi37/dsh-session'
import type { RivetTheme } from '../theme.js'
import type { TranscriptMessage, TranscriptToolCall, TranscriptView } from '../adapter/transcript.js'
import type { ResolvedToolViews } from '../adapter/tool-view.js'
import { formatUserMessage } from '../format/user-message.js'
import { formatMarkdown } from '../format/markdown.js'
import { formatToolCard } from '../format/tool-card.js'
import { formatToolViewCard } from '../format/tool-view-card.js'
import { formatReasoningBlock } from '../format/reasoning.js'
import { parseToolArguments } from '../format/tool-meta.js'

export { parseToolArguments }

/** 一行渲染结果：ANSI 文本 + 该行占用的显示行数（wrap 感知由调用方度量）。 */
export interface RenderedRow {
  /** ANSI 格式化的终端行（含换行由调用方追加）。 */
  ansi: string
  /** 是否属于 tool 卡片体（供折叠/展开逻辑识别）。 */
  kind: 'user' | 'assistant' | 'tool' | 'system'
}

/** renderMessageRows / renderToolRows / renderTranscript 的共享渲染选项。 */
export interface RenderTranscriptOptions {
  /** 紧凑模式（/density）：思考块仅头行、卡片体收紧。 */
  compact?: boolean
  /** 完整展开工具卡（不折叠/不截断）。 */
  expanded?: boolean
  /** 终端列数（renderTranscript 按 columns 注入）：工具卡正文按状态垫底色的目标宽度。 */
  width?: number
  /**
   * presenter 意图解析器（adapter/tool-view 桥的闭包）；缺省不解析——
   * 全部工具卡走文本折叠回落。纯查询：对同一 tool 幂等（presenter 为
   * args 的纯函数），replay 安全。
   */
  resolveViews?: (tool: TranscriptToolCall) => ResolvedToolViews
}

/**
 * 从配对的 `tool/result` 事件提取模型面显示文本与错误标记。
 * live 结算提交（app.ts）与 resume 回放（renderToolRows）共用同一提取。
 * @param result - 配对的 tool/result 事件。
 * @returns tool-result 块内 text 块折叠文本 + 错误标记（事件 error 或块级 isError）。
 */
export function toolResultText(result: SessionEvent<'tool/result'>): { content: string; isError: boolean } {
  let content = ''
  // tool/result 的 message.content[0] 是 ToolResultBlock（type 'tool-result'），
  // 其 content 为嵌套 ContentBlock[]——折叠其中的 text 块为显示文本。
  // 类型断言放宽到运行时真实形状：transcript 数据可绕过静态类型（render.spec
  // 边界用例喂非 ToolResultBlock 首块），type/content 守卫是真实防护而非死代码。
  const first = result.data.message.content[0] as
    | { type: string; isError?: boolean; content: readonly { type: string; text?: string }[] | undefined }
    | undefined
  if (first !== undefined && first.type === 'tool-result' && first.content !== undefined) {
    content = first.content
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map(block => block.text)
      .join('\n')
  }
  const isError = result.data.error !== undefined || first?.isError === true
  return { content, isError }
}

/**
 * 渲染一条完成的 user/assistant 消息为终端行。
 * assistant 消息先渲染思考块（reasoning 折叠，暗色斜体），再渲染 markdown
 * 正文——与 live 路径「思考落底在正文前」的提交顺序一致。
 * @param message - TranscriptView.messages 中的一条。
 * @param theme - 当前主题。
 * @param columns - 终端列数（markdown 换行度量）。
 * @param options - 紧凑模式等渲染选项。
 * @returns ANSI 行数组。
 */
export function renderMessageRows(
  message: TranscriptMessage,
  theme: RivetTheme,
  columns: number,
  options: RenderTranscriptOptions = {},
): RenderedRow[] {
  if (message.kind === 'user') {
    return formatUserMessage({ content: message.text, width: columns, timestamp: message.time }, theme)
      .map(ansi => ({ ansi, kind: 'user' as const }))
  }
  const rows: RenderedRow[] = []
  if (message.reasoning !== '') {
    rows.push(...formatReasoningBlock({
      text: message.reasoning,
      ...(options.compact === undefined ? {} : { compact: options.compact }),
    }, theme).map(ansi => ({ ansi, kind: 'assistant' as const })))
  }
  rows.push(...formatMarkdown({ text: message.text, columns }, theme)
    .map(ansi => ({ ansi, kind: 'assistant' as const })))
  return rows
}

/**
 * 渲染一条工具调用（call → result 配对）为卡片行。
 * 已结算：presenter 意图分派 diff/terminal 结构化卡（意图缺省回落文本
 * 折叠）；进行中（无 result）：保留 formatToolCard 流式态。
 * @param tool - TranscriptView.tools 中的一条。
 * @param theme - 当前主题。
 * @param options - presenter 意图、展开与紧凑选项。
 * @returns ANSI 行数组。
 */
export function renderToolRows(
  tool: TranscriptToolCall,
  theme: RivetTheme,
  options: RenderTranscriptOptions = {},
): RenderedRow[] {
  const result = tool.result
  if (result === undefined) {
    const args = parseToolArguments(tool.arguments)
    const rows = formatToolCard({
      toolName: tool.name,
      content: '',
      ...(args === undefined ? {} : { toolInput: args }),
      streaming: true,
      ...(options.expanded === undefined ? {} : { expanded: options.expanded }),
      ...(options.width === undefined ? {} : { width: options.width }),
    }, theme)
    return rows.map(ansi => ({ ansi, kind: 'tool' as const }))
  }
  const { content, isError } = toolResultText(result)
  const views = options.resolveViews?.(tool) ?? {}
  /* jscpd:ignore-start */
  const rows = formatToolViewCard({
    toolName: tool.name,
    argumentsRaw: tool.arguments,
    content,
    isError,
    ...(views.call === undefined ? {} : { callView: views.call }),
    ...(views.result === undefined ? {} : { resultView: views.result }),
    elapsedMs: Math.max(0, result.time - tool.time),
    /* jscpd:ignore-end */
    ...(options.expanded === undefined ? {} : { expanded: options.expanded }),
    ...(options.compact === undefined ? {} : { compact: options.compact }),
    ...(options.width === undefined ? {} : { width: options.width }),
  }, theme)
  return rows.map(ansi => ({ ansi, kind: 'tool' as const }))
}

/**
 * 渲染整个 transcript 到 scrollback 的完整行序列。
 * 消息与工具卡按事件 seq 交错（两个来源各自按 seq 有序，双指针归并）：
 * assistant 正文（seq 于 assistant/message）先于其 step 的工具卡
 * （seq 于 tool/call）——与 live 提交顺序（文本 → 卡）一致。
 * @param view - 当前 transcript 投影。
 * @param theme - 当前主题。
 * @param columns - 终端列数。
 * @param options - presenter 意图解析器与紧凑/展开选项。
 * @returns 有序 RenderedRow 数组。
 */
export function renderTranscript(
  view: TranscriptView,
  theme: RivetTheme,
  columns: number,
  options: RenderTranscriptOptions = {},
): RenderedRow[] {
  const rows: RenderedRow[] = []
  const messages = view.messages
  const tools = view.tools
  let mi = 0
  let ti = 0
  while (mi < messages.length || ti < tools.length) {
    const message = messages[mi]
    const tool = tools[ti]
    if (tool === undefined || (message !== undefined && message.seq <= tool.seq)) {
      /* v8 ignore next -- 循环条件保证两指针至少一个未尽；tool undefined 时 message 必存在 */
      if (message === undefined) break
      rows.push(...renderMessageRows(message, theme, columns, options))
      mi++
    } else {
      rows.push(...renderToolRows(tool, theme, { ...options, width: columns }))
      ti++
    }
  }
  return rows
}
