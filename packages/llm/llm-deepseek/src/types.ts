/**
 * DeepSeek chat-completions wire format (OpenAI-compatible). Types only.
 *
 * Source of truth: the official API docs at
 * `~/repos/deepsuite-docs/apps/docs/docs` (api/create-chat-completion,
 * guides/thinking_mode.mdx, guides/tool_calls.md), cross-checked against
 * live streams from the internal endpoint (2026-06).
 *
 * @module dsh-llm-deepseek/types
 */

/** Request body for `POST {baseURL}/chat/completions`. */
export interface WireRequest {
  model: string
  messages: WireMessage[]
  stream: true
  stream_options: { include_usage: true }
  /** Thinking-mode toggle (top level, NOT inside extra_body on the wire). */
  thinking?: { type: 'enabled' | 'disabled' }
  /** Thinking effort (official levels; low/medium map to high server-side). */
  reasoning_effort?: 'high' | 'max'
  tools?: WireTool[]
  temperature?: number
  max_tokens?: number
  /**
   * Stop sequences (OpenAI `stop`): generation halts as soon as the model
   * produces any one of these strings. Mapped from `GenerateOptions.stop`.
   */
  stop?: string[]
}

/** System-role message: a single string of instructions. */
export interface WireSystemMessage {
  role: 'system'
  content: string
}

/** 多模态 content part（OpenAI 兼容；视觉模型接受 image_url）。 */
export interface WireContentTextPart {
  type: 'text'
  text: string
}

/** 图片 content part：url 为 data:image/...;base64,... data URL。 */
export interface WireContentImagePart {
  type: 'image_url'
  image_url: { url: string }
}

/** Files API 引用 part（启用 filesApi 后由序列化后置置换产生；见 wire-files.ts）。 */
export interface WireFileContentPart {
  type: 'file'
  file_id: string
}

/** 用户消息的多模态 content parts（text + 图片 inline/dataUrl/文件引用）。 */
export type WireContentPart = WireContentTextPart | WireContentImagePart | WireFileContentPart

/** User-role message: 纯文本字符串，或含图片的多模态 parts 数组。 */
export interface WireUserMessage {
  role: 'user'
  content: string | WireContentPart[]
}

/** Tool-role message: the result of one tool call, keyed by its call id. */
export interface WireToolMessage {
  role: 'tool'
  tool_call_id: string
  content: string
}

/** One entry of the request `messages` array, discriminated on `role`. */
export type WireMessage =
  | WireSystemMessage
  | WireUserMessage
  | WireAssistantMessage
  | WireToolMessage

/**
 * Assistant-role history message. The harness replays `content: ""` (never
 * null) on tool-call-only turns — some gateways reject null — and sends null
 * only when the turn carried neither text nor tool calls.
 */
export interface WireAssistantMessage {
  role: 'assistant'
  content: string | null
  /**
   * CoT passback, present on every turn whose assistant content carried
   * reasoning. REQUIRED on tool-call turns in thinking mode (see
   * guides/thinking_mode.mdx § Tool Calls); DeepSeek ignores it elsewhere,
   * while a gateway re-encoding for another vendor recovers that turn's
   * thinking signature by hashing it.
   */
  reasoning_content?: string
  tool_calls?: WireToolCall[]
}

/** A completed tool call replayed on an assistant history message; `arguments` is the raw JSON string. */
export interface WireToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

/** One entry of the request `tools` array; `parameters` is a JSON Schema object. */
export interface WireTool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

/** One parsed SSE `data:` payload (a chat.completion.chunk). */
export interface WireChunk {
  choices?: WireChoice[]
  /** Arrives attached to the finish chunk and/or as a trailing usage-only chunk. */
  usage?: WireUsage | null
}

/** One streamed choice (requests always ask for a single one); `finish_reason` is non-null only on its terminal chunk. */
export interface WireChoice {
  delta?: WireDelta
  finish_reason?: string | null
}

/** The incremental content of one streamed choice; any subset of fields may be present per chunk. */
export interface WireDelta {
  role?: string
  /** Visible text. Null/empty on reasoning/tool-call chunks. */
  content?: string | null
  /**
   * Thinking-mode CoT. The FIRST chunk carries an empty string (must not
   * open a reasoning block); absent entirely in non-thinking mode.
   */
  reasoning_content?: string | null
  tool_calls?: WireToolCallDelta[]
}

/** A streamed fragment of one tool call; fragments sharing an `index` concatenate into one call. */
export interface WireToolCallDelta {
  /** Disambiguates parallel tool calls; stable across a call's deltas. */
  index: number
  /** Present on the first delta of each call only. */
  id?: string
  type?: 'function'
  function?: {
    /** Present on the first delta of each call only. */
    name?: string
    /** Argument JSON fragment (concatenate across deltas). */
    arguments?: string
  }
}

/**
 * Wire token accounting. `prompt_tokens` INCLUDES cache hits (it equals
 * `prompt_cache_hit_tokens + prompt_cache_miss_tokens`); `mapUsage` subtracts
 * them to keep the harness convention of disjoint counts.
 * `prompt_tokens_details.cached_tokens` is the OpenAI-compat spelling of the
 * hit count.
 */
export interface WireUsage {
  prompt_tokens: number
  completion_tokens: number
  prompt_cache_hit_tokens?: number
  prompt_cache_miss_tokens?: number
  prompt_tokens_details?: { cached_tokens?: number }
  completion_tokens_details?: { reasoning_tokens?: number }
}

/** Non-2xx error body. */
export interface WireError {
  error?: { message?: string; type?: string; code?: string }
}
