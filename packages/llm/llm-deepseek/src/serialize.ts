/**
 * Serialize harness messages into DeepSeek chat completions. User text is joined; assistant text
 * becomes `content`, tool calls become `tool_calls`, and tool results become separate tool messages.
 * Assistant reasoning is replayed as `reasoning_content` on every reasoning-carrying turn: required
 * on tool-call turns by thinking-mode passback, and the only place a gateway re-encoding the
 * conversation for another vendor can recover a plain turn's thinking signature.
 * Unknown declaration-merged block types are skipped rather than rejected.
 * @module dsh-llm-deepseek/serialize
 */

import { LlmError } from '@huiliyi37/dsh-llm'
import type { ContentBlock, GenerateOptions, Message } from '@huiliyi37/dsh-llm'
import {
  defaultTokenizer,
  resolveTruncateN,
  truncateReasoningTail,
  SPARK_PROVIDER,
} from './spark.ts'
import type { SparkRequestPolicy } from './spark.ts'
import type { WireContentPart, WireMessage, WireRequest, WireTool } from './types.ts'

/** Adapter-level request defaults (from plugin config). */
export interface RequestDefaults {
  thinking?: 'enabled' | 'disabled' | undefined
  reasoningEffort?: 'off' | 'high' | 'max' | undefined
  /**
   * spark 推理尾部截断策略（内部能力）。enabled 时仅 {@link SPARK_PROVIDER}
   * route 生效；truncateN 按模型档取 N（pro 档默认 0 = 不截断）。
   */
  spark?: SparkRequestPolicy
}

interface ResolvedThinking {
  thinking?: 'enabled' | 'disabled'
  reasoningEffort?: 'high' | 'max'
}

/** Validate the adapter-owned effort before resolving its DeepSeek wire fields. */
function reasoningEffort(effort: NonNullable<GenerateOptions['reasoningEffort']>): 'off' | 'high' | 'max' {
  if (effort === 'off' || effort === 'high' || effort === 'max') {
    return effort as 'off' | 'high' | 'max'
  }
  throw new LlmError(
    `DeepSeek does not support reasoning effort "${effort}"`,
    'UNSUPPORTED_REASONING_EFFORT',
  )
}

/** Resolve one legal thinking/effort pair without exposing `off` as a wire effort. */
function resolveThinking(options: GenerateOptions, defaults: RequestDefaults): ResolvedThinking {
  if (options.purpose === 'session-title') return { thinking: 'disabled' }
  const effort = options.reasoningEffort === undefined
    ? defaults.reasoningEffort
    : reasoningEffort(options.reasoningEffort)
  if (defaults.thinking === 'disabled' && effort !== undefined && effort !== 'off') {
    throw new LlmError(
      `DeepSeek deployment does not support reasoning effort "${effort}"`,
      'UNSUPPORTED_REASONING_EFFORT',
    )
  }
  if (effort === 'off') return { thinking: 'disabled' }
  if (effort === 'high' || effort === 'max') {
    return { thinking: 'enabled', reasoningEffort: effort }
  }
  return defaults.thinking === undefined ? {} : { thinking: defaults.thinking }
}

/** Join the text blocks of a message (used for user/tool-result content). */
function flattenText(blocks: ContentBlock[]): string {
  return blocks
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

/**
 * Serialize one assistant message (text + reasoning + tool calls).
 * @param message - the harness assistant message.
 * @param sparkN - spark 截断 N（仅 spark route + enabled 时传入；N<=0 表示不截断）。
 *   截断发生在 wire 对象构造时（copy-on-write），session log 中的原始
 *   Message 块不受影响——原始推理完整落盘，仅回传截断态。
 */
function serializeAssistant(message: Message, sparkN?: number): WireMessage {
  const text = flattenText(message.content)
  const reasoning = message.content
    .filter(block => block.type === 'reasoning')
    .map(block => block.text)
    .join('')
  const toolCalls = message.content
    .filter(block => block.type === 'tool-call')
    .map(block => ({
      id: block.id,
      type: 'function' as const,
      function: { name: block.name, arguments: block.arguments },
    }))

  return {
    role: 'assistant',
    // Text-less turns send "" — NEVER null. Pure tool-call turns: the
    // official samples replay message.content verbatim (which is "") and
    // some gateways reject null outright. Reasoning-ONLY turns (the model
    // can answer entirely in the reasoning channel, e.g. a v4-flash
    // greeting): the live API rejects null-content/no-tool_calls assistant
    // messages with a 400 ("content or tool_calls must be set"), and since
    // the message sits durably in the session log, a null here bricks every
    // later turn of that session.
    content: text,
    // CoT passback on every reasoning-carrying turn. The official rule
    // (guides/thinking_mode.mdx) requires it on tool-call turns and ignores it
    // elsewhere; a gateway re-encoding the conversation for another vendor
    // recovers that turn's upstream thinking signature by hashing this exact
    // text, which a tool-call-free turn carries nowhere else. spark 截断
    // 照常生效（回传体有界，与 tool-call 轮同源）。
    ...reasoning.length > 0
      ? {
        reasoning_content: sparkN !== undefined && sparkN > 0
          ? truncateReasoningTail(reasoning, sparkN, defaultTokenizer)
          : reasoning,
      }
      : {},
    ...toolCalls.length > 0 ? { tool_calls: toolCalls } : {},
  }
}

/**
 * Serialize the conversation. `tool-result` blocks become standalone
 * `{role: 'tool'}` messages; the harness puts each tool result in its own
 * user-role message, so a mixed user message contributes its text first and
 * its tool results as separate wire messages after.
 * @param messages - the harness conversation, in order.
 * @param sparkN - spark 截断 N（N<=0 或缺省 = 不截断），仅由 serializeRequest
 *   在 spark route + enabled 时传入；直接调用此函数时保持非 spark 行为。
 * @returns the wire messages; order preserved, each tool result expanded into its own entry.
 */
export function serializeMessages(messages: Message[], sparkN?: number): WireMessage[] {
  const wire: WireMessage[] = []
  for (const message of messages) {
    if (message.role === 'system') {
      wire.push({ role: 'system', content: flattenText(message.content) })
      continue
    }
    if (message.role === 'assistant') {
      wire.push(serializeAssistant(message, sparkN))
      continue
    }
    // user role: tool results ride in user messages in the harness
    // vocabulary, but DeepSeek wants them as role:'tool' messages.
    const toolResults = message.content.filter(block => block.type === 'tool-result')
    const text = flattenText(message.content)
    const images = message.content.filter(block => block.type === 'image')
    if (text.length > 0 || images.length > 0 || toolResults.length === 0) {
      if (images.length > 0) {
        // 多模态 user 消息：text + image_url parts（OpenAI 兼容，视觉模型接受）。
        // data URL 在 harness 侧（TUI normalize / vision 桥）已校验，此处透传。
        const parts: WireContentPart[] = []
        if (text.length > 0) parts.push({ type: 'text', text })
        for (const img of images) {
          parts.push({ type: 'image_url', image_url: { url: img.dataUrl } })
        }
        wire.push({ role: 'user', content: parts })
      } else {
        wire.push({ role: 'user', content: text })
      }
    }
    for (const result of toolResults) {
      wire.push({
        role: 'tool',
        tool_call_id: result.toolCallId,
        // Empty tool output still needs SOME content on the wire.
        content: flattenText(result.content) || '(no output)',
      })
    }
  }
  return wire
}

/**
 * Build the full wire request. Always streaming (`stream: true`, usage
 * reporting on); optional fields are omitted rather than sent as null, so
 * provider defaults apply.
 * @param options - the harness request (model, history, system, tools, sampling).
 * @param defaults - adapter-level thinking defaults; undefined fields put nothing on the wire.
 * @returns the chat-completions request body.
 */
export function serializeRequest(
  options: GenerateOptions,
  defaults: RequestDefaults = {},
): WireRequest {
  const messages: WireMessage[] = []
  if (options.system !== undefined) {
    messages.push({ role: 'system', content: options.system })
  }
  // spark 截断：仅 spark route + enabled 时按模型档取 N；N<=0（pro 档默认
  // 0 = 需显式开启）不截断。N 来自 adapter config（settings 文档持久化）——
  // 配置稳定则 N 稳定，同批消息截断结果字节一致（前缀缓存前提）。
  const sparkN = options.provider === SPARK_PROVIDER && defaults.spark?.enabled === true
    ? resolveTruncateN(options.model, defaults.spark.truncateN)
    : undefined
  messages.push(...serializeMessages(options.messages, sparkN))

  const tools: WireTool[] | undefined = options.tools?.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }))
  // A short title budget must produce visible text; conversation and
  // compaction calls continue to inherit the adapter's thinking defaults.
  const resolvedThinking = resolveThinking(options, defaults)

  return {
    model: options.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    ...resolvedThinking.thinking !== undefined ? { thinking: { type: resolvedThinking.thinking } } : {},
    ...resolvedThinking.reasoningEffort !== undefined
      ? { reasoning_effort: resolvedThinking.reasoningEffort }
      : {},
    ...tools !== undefined && tools.length > 0 ? { tools } : {},
    ...options.temperature !== undefined ? { temperature: options.temperature } : {},
    ...options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens },
    ...options.stop !== undefined ? { stop: options.stop } : {},
  }
}
