/**
 * Harness request-history conversion into pi-ai's Context vocabulary.
 *
 * @module dsh-llm-pi-ai/context
 */

import { CallId, contentHasImage, LlmError, offloadRequestImages } from '@huiliyi37/dsh-llm'
import type { ContentBlock, GenerateOptions, Message } from '@huiliyi37/dsh-llm'
import type { Context as PiContext, ImageContent, Message as PiMessage, TextContent, Tool as PiTool } from '@earendil-works/pi-ai'
import { toPiAssistant } from './replay.ts'

/** Join the text blocks of a harness message. */
function flattenText(message: Message): string {
  return message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

/** Reject image roles that pi-ai cannot replay before request-size offloading can replace them. */
function assertSupportedImageRoles(messages: readonly Message[]): void {
  for (const message of messages) {
    if (message.role !== 'user' && contentHasImage(message.content)) {
      throw new LlmError(
        `pi-ai cannot represent an image in an in-history ${message.role} message`,
        'UNSUPPORTED_CONTENT',
      )
    }
  }
}

/** Split an image block's data URL at the first comma into pi-ai's base64 payload + MIME pair. */
function imageContent(block: Extract<ContentBlock, { type: 'image' }>): ImageContent {
  const comma = block.dataUrl.indexOf(',')
  const header = comma === -1 ? '' : block.dataUrl.slice(0, comma)
  const data = comma === -1 ? block.dataUrl : block.dataUrl.slice(comma + 1)
  const mime = block.mime ?? /^data:([^;,]+)/.exec(header)?.[1] ?? 'image/png'
  return { type: 'image', data, mimeType: mime }
}

/**
 * Flatten user-position blocks into pi-ai user content: plain text stays a
 * joined string, while any image block upgrades the content to a part list.
 * Tool-result blocks nest recursively (their images ride the part list).
 */
function userContent(blocks: readonly ContentBlock[]): string | (TextContent | ImageContent)[] {
  const content: (TextContent | ImageContent)[] = []
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        if (block.text.length > 0) content.push({ type: 'text', text: block.text })
        break
      case 'image':
        content.push(imageContent(block))
        break
      case 'tool-result': {
        const nested = userContent(block.content)
        if (typeof nested === 'string') {
          if (nested.length > 0) content.push({ type: 'text', text: nested })
        } else {
          content.push(...nested)
        }
        break
      }
      default:
        // Other merge-extensible blocks are not user-input vocabulary for pi-ai.
        break
    }
  }
  if (content.every(block => block.type === 'text')) return content.map(block => block.text).join('')
  return content
}

/**
 * Convert harness history to a pi-ai Context. Tool results need the tool
 * NAME (pi-ai's `toolName`), which the harness doesn't carry on the result
 * block — it is recovered from the preceding assistant tool-call with the
 * same id. When the accumulated base64 image payload exceeds
 * `maxRequestImageBytes`, the oldest images are replaced by text
 * placeholders until the request fits, so an image-heavy session keeps
 * clearing gateway request-size caps.
 * @param options - the harness request; `options.system` maps to pi-ai's single `systemPrompt` slot.
 * @param onReplayDegrade - forwarded to {@link toPiAssistant} for each assistant message.
 * @param maxRequestImageBytes - request-level bound on base64-encoded image payload; omission leaves every image in place.
 * @returns the pi-ai context; `tools` is omitted entirely when the request declares none.
 */
export function toPiContext(
  options: GenerateOptions,
  onReplayDegrade?: (reason: string) => void,
  maxRequestImageBytes?: number,
): PiContext {
  assertSupportedImageRoles(options.messages)
  const requestMessages = offloadRequestImages(options.messages, maxRequestImageBytes)
  const toolNames = new Map<CallId, string>()
  const messages: Array<PiMessage> = []

  for (const message of requestMessages) {
    if (message.role === 'system') {
      // pi-ai has a single systemPrompt slot; in-history system messages are
      // folded into user messages to preserve order (rare in practice — the
      // harness sends the system prompt via options.system).
      messages.push({ role: 'user', content: flattenText(message), timestamp: 0 })
      continue
    }
    if (message.role === 'assistant') {
      const assistant = toPiAssistant(message, onReplayDegrade)
      for (const block of assistant.content) {
        if (block.type === 'toolCall') toolNames.set(CallId(block.id), block.name)
      }
      messages.push(assistant)
      continue
    }
    // user role: text + images + tool results (each result becomes its own message).
    const regular = message.content.filter(block => block.type !== 'tool-result')
    const content = userContent(regular)
    const results = message.content.filter((block): block is Extract<ContentBlock, { type: 'tool-result' }> => (
      block.type === 'tool-result'
    ))
    if (content.length > 0 || results.length === 0) {
      messages.push({ role: 'user', content, timestamp: 0 })
    }
    for (const result of results) {
      const resultContent = userContent(result.content)
      messages.push({
        role: 'toolResult',
        toolCallId: result.toolCallId,
        toolName: toolNames.get(result.toolCallId) ?? 'unknown',
        content: typeof resultContent === 'string'
          ? [{ type: 'text', text: resultContent || '(no output)' }]
          : resultContent,
        isError: result.isError ?? false,
        timestamp: 0,
      })
    }
  }

  const tools: Array<PiTool> | undefined = options.tools?.map(tool => ({
    name: tool.name,
    description: tool.description,
    // ToolSchema.parameters is a JSON Schema object; pi-ai's TSchema
    // (TypeBox) is structurally JSON Schema, so it assigns directly.
    parameters: tool.parameters,
  }))

  return {
    ...options.system !== undefined ? { systemPrompt: options.system } : {},
    messages,
    ...tools !== undefined && tools.length > 0 ? { tools } : {},
  }
}
