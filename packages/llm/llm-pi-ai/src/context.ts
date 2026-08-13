/**
 * Harness request-history conversion into pi-ai's Context vocabulary.
 *
 * @module dsh-llm-pi-ai/context
 */

import { CallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import type { Context as PiContext, Message as PiMessage, Tool as PiTool } from '@earendil-works/pi-ai'
import { toPiAssistant } from './replay.ts'

/** Join the text blocks of a harness message. */
function flattenText(message: Message): string {
  return message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

/**
 * Convert harness history to a pi-ai Context. Tool results need the tool
 * NAME (pi-ai's `toolName`), which the harness doesn't carry on the result
 * block — it is recovered from the preceding assistant tool-call with the
 * same id.
 * @param options - the harness request; `options.system` maps to pi-ai's single `systemPrompt` slot.
 * @returns the pi-ai context; `tools` is omitted entirely when the request declares none.
 */
export function toPiContext(options: GenerateOptions): PiContext {
  const toolNames = new Map<CallId, string>()
  const messages: Array<PiMessage> = []

  for (const message of options.messages) {
    if (message.role === 'system') {
      // pi-ai has a single systemPrompt slot; in-history system messages are
      // folded into user messages to preserve order (rare in practice — the
      // harness sends the system prompt via options.system).
      messages.push({ role: 'user', content: flattenText(message), timestamp: 0 })
      continue
    }
    if (message.role === 'assistant') {
      const assistant = toPiAssistant(message)
      for (const block of assistant.content) {
        if (block.type === 'toolCall') toolNames.set(CallId(block.id), block.name)
      }
      messages.push(assistant)
      continue
    }
    // user role: text + tool results (each result becomes its own message).
    const text = flattenText(message)
    const results = message.content.filter(block => block.type === 'tool-result')
    if (text.length > 0 || results.length === 0) {
      messages.push({ role: 'user', content: text, timestamp: 0 })
    }
    for (const result of results) {
      messages.push({
        role: 'toolResult',
        toolCallId: result.toolCallId,
        toolName: toolNames.get(result.toolCallId) ?? 'unknown',
        content: [{
          type: 'text',
          text: result.content
            .filter(block => block.type === 'text')
            .map(block => block.text)
            .join('') || '(no output)',
        }],
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
