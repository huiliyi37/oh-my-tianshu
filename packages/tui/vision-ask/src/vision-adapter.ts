/**
 * OpenAI-compatible vision adapter — streams image-carrying requests to a
 * chat-completions endpoint that accepts `image_url` content parts.
 *
 * Why this adapter exists: a text-only primary wire route cannot carry the
 * vision co-pilot's description calls. This plugin registers its own provider
 * route with an adapter that serializes image blocks (data URLs carried
 * inline on the block, harness image vocabulary) as OpenAI-style `image_url`
 * parts and parses the standard SSE chat-completions stream.
 *
 * @module @huiliyi37/dsh-vision-ask/vision-adapter
 */

import { createUserMessage, LlmAdapter, LlmError } from '@huiliyi37/dsh-llm'
import type {
  ContentBlock,
  FinishReason,
  GenerateOptions,
  LlmModelInfo,
  LlmResolvedModelInfo,
  Message,
  StreamChunk,
  TokenUsage,
} from '@huiliyi37/dsh-llm'

/** The terminal payload OpenAI-compatible servers send after the last chunk. */
export const DONE = '[DONE]'

/**
 * Parse an SSE byte stream into event `data` payloads (spec framing: frames
 * split on blank lines, `data:` lines joined with `\n`, `:` comments and other
 * fields skipped, CRLF/LF both accepted). `[DONE]` is yielded as the final
 * value; a stream ending without it simply ends (the caller decides truncation
 * from the absence of a finish chunk). Implemented inline to keep the plugin
 * free of runtime dependencies.
 * @param stream - raw SSE bytes; reads may split anywhere, including mid-UTF-8 sequence.
 * @returns each event's data payload in arrival order, the `[DONE]` sentinel last.
 */
export async function* parseSse(stream: ReadableStream<BufferSource>): AsyncGenerator<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let idx: number
      // 帧分隔：一个空行（\n\n 或 \r\n\r\n）。
      while ((idx = buffer.search(/\r?\n\r?\n/)) !== -1) {
        const frame = buffer.slice(0, idx)
        buffer = buffer.slice(idx + (buffer[idx + 1] === '\n' ? 2 : 4))
        const data = frameData(frame)
        if (data !== null) {
          yield data
          if (data === DONE) return
        }
      }
    }
    // EOF 前未以空行收尾的残留帧（规范上属截断，但数据仍交付，由调用方裁决）。
    const data = frameData(buffer)
    if (data !== null) yield data
  } finally {
    reader.releaseLock()
  }
}

/** 提取一帧中的 `data:` 字段（多行拼接）；无 data 字段返回 null。 */
function frameData(frame: string): string | null {
  const lines: string[] = []
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith('data:')) lines.push(line.slice(5).replace(/^ /, ''))
  }
  return lines.length > 0 ? lines.join('\n') : null
}

/** Wire chunk: one SSE `data:` payload of a chat-completions stream. */
interface WireChunk {
  choices?: Array<{
    delta?: { content?: string }
    finish_reason?: string | null
  }>
  usage?: WireUsage
}

/** Wire usage fields (disjoint counts after cache subtraction happens here). */
interface WireUsage {
  prompt_tokens?: number
  completion_tokens?: number
  prompt_tokens_details?: { cached_tokens?: number }
}

/**
 * Map the wire finish_reason vocabulary to the harness FinishReason.
 * @param reason - the wire finish_reason string.
 * @returns the harness finish reason (unknown values become typed errors).
 */
export function mapFinishReason(reason: string): FinishReason {
  switch (reason) {
    case 'stop': return { kind: 'stop' }
    case 'length': return { kind: 'max-tokens' }
    case 'content_filter': return {
      kind: 'error',
      failure: { message: 'model stopped: content_filter', code: 'CONTENT_FILTER' },
    }
    default:
      return {
        kind: 'error',
        failure: { message: `model stopped: ${reason}`, code: reason.toUpperCase() },
      }
  }
}

/**
 * Map wire usage to disjoint harness counts (cache reads subtracted out).
 * @param usage - the wire usage payload.
 * @returns disjoint input/output token counts with optional cache reads.
 */
export function mapUsage(usage: WireUsage): TokenUsage {
  const cacheRead = usage.prompt_tokens_details?.cached_tokens
  return {
    inputTokens: (usage.prompt_tokens ?? 0) - (cacheRead ?? 0),
    outputTokens: usage.completion_tokens ?? 0,
    ...cacheRead !== undefined ? { cacheReadTokens: cacheRead } : {},
  }
}

/**
 * Translate one parsed wire chunk into harness chunks (text block at index 0).
 * @param chunk - one parsed SSE wire chunk.
 * @returns harness stream chunks derived from the wire chunk.
 */
export function* translateChunk(chunk: WireChunk): Generator<StreamChunk> {
  if (chunk.usage !== undefined) yield { type: 'usage', usage: mapUsage(chunk.usage) }
  const choice = chunk.choices?.[0]
  if (!choice) return
  if (choice.delta?.content !== undefined && choice.delta.content.length > 0) {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: choice.delta.content }
  }
}

/** Classify a non-2xx wire error into a structured code. */
function classifyHttpError(status: number, body: string): string {
  if (status === 401 || status === 403) return 'AUTH'
  if (status === 429) return 'RATE_LIMIT'
  if (status >= 500) return 'SERVER'
  if (status === 400) return 'INVALID_REQUEST'
  return body.length > 0 ? body.slice(0, 40).toUpperCase().replace(/\W+/g, '_') : String(status)
}

/** Serialize one user message: join text blocks, image blocks become `image_url` parts. */
function serializeUserContent(
  content: readonly ContentBlock[],
): Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> {
  const parts: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = []
  for (const block of content) {
    if (block.type === 'text') {
      parts.push({ type: 'text', text: block.text })
    } else if (block.type === 'image') {
      // 图片块自带 data URL（harness image 词汇），wire 序列化零转换直通。
      parts.push({ type: 'image_url', image_url: { url: block.dataUrl } })
    }
    // reasoning/tool blocks do not appear in vision-description requests; skip.
  }
  return parts
}

/** Deployment-resolved facts for one vision request. */
export interface VisionAdapterConfig {
  /** Endpoint base; `/chat/completions` is appended. */
  baseUrl: string
  /** Environment variable name holding the API key (never an inline secret). */
  apiKeyEnv: string
  /** Vision model id sent on the wire. */
  model: string
  /** Default per-request output cap. */
  maxTokens: number
}

/**
 * One OpenAI-compatible vision provider route. The adapter serializes image
 * blocks as `image_url` parts and parses the standard SSE stream; requests go
 * through `ctx.llm.stream` like any other model call (retry/error/cancel
 * semantics preserved by the harness), and the description output lands in the
 * tool result, so Model-visible ⟺ logged holds.
 */
export class VisionAdapter extends LlmAdapter {
  constructor(
    private readonly config: VisionAdapterConfig,
  ) {
    super()
  }

  /** @inheritdoc */
  override listModels(_provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve([{ provider: _provider, id: this.config.model, name: this.config.model }])
  }

  /** @inheritdoc */
  override resolveModel(provider: string, model: string, _signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      context: { contextWindow: 128_000 },
      defaultMaxTokens: this.config.maxTokens,
    })
  }

  /** @inheritdoc */
  async *stream(options: GenerateOptions): AsyncGenerator<StreamChunk> {
    const apiKey = process.env[this.config.apiKeyEnv]
    if (!apiKey) {
      throw new LlmError(
        `vision adapter: 缺少 API key（环境变量 ${this.config.apiKeyEnv} 未设置）`,
        'AUTH',
      )
    }
    const parts: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = []
    for (const message of options.messages) {
      if (message.role === 'user' || message.role === 'assistant') {
        parts.push(...serializeUserContent(message.content))
      }
    }
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: [{ role: 'user', content: parts }],
      stream: true,
      ...options.maxTokens === undefined ? { max_tokens: this.config.maxTokens } : { max_tokens: options.maxTokens },
    }
    const url = `${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`
    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: options.signal ?? null,
      })
    } catch (err) {
      throw new LlmError(
        `vision adapter 请求失败：${err instanceof Error ? err.message : String(err)}`,
        'TRANSPORT',
      )
    }
    if (!response.ok || response.body === null) {
      const text = await response.text().catch(() => '')
      throw new LlmError(
        `vision adapter HTTP ${response.status}: ${text.slice(0, 200)}`,
        classifyHttpError(response.status, text),
      )
    }
    // finish 由流层统一裁决：wire 的 finish_reason 只记录不转发，保证
    // 恰好一个 finish 且在 usage/text 之后；空输出在 stop 时改判错误。
    let finishReason: FinishReason | null = null
    let text = ''
    for await (const data of parseSse(response.body)) {
      if (data === DONE) break
      let chunk: WireChunk
      try {
        chunk = JSON.parse(data) as WireChunk
      } catch {
        continue // 忽略非 JSON 事件（keep-alive 注释等）
      }
      const choice = chunk.choices?.[0]
      if (choice?.finish_reason !== undefined && choice.finish_reason !== null && finishReason === null) {
        finishReason = mapFinishReason(choice.finish_reason)
      }
      for (const translated of translateChunk(chunk)) {
        if (translated.type === 'text-delta') text += translated.text
        yield translated
      }
    }
    if (finishReason === null) {
      // 流结束但无 finish（截断）：以 error finish 收尾，已产出的文本保留。
      yield {
        type: 'finish',
        reason: { kind: 'error', failure: { message: 'vision adapter stream truncated', code: 'STREAM_CLOSED' } },
      }
    } else if (finishReason.kind === 'stop' && text.length === 0) {
      yield {
        type: 'finish',
        reason: { kind: 'error', failure: { message: 'vision model returned empty response', code: 'EMPTY_RESPONSE' } },
      }
    } else {
      yield { type: 'finish', reason: finishReason }
    }
  }
}

/**
 * 组装一次视觉描述请求的消息（提示词 + 原图 data URL）。
 * @param prompt - 面向视觉模型的问题/指令文本。
 * @param dataUrls - 原图 data URL 列表（按序作为 image 块附加）。
 * @returns 可直接交给 llm 请求的 plugin-source user message。
 */
export function buildVisionMessage(prompt: string, dataUrls: readonly string[]): Message {
  return createUserMessage({
    content: [
      { type: 'text', text: prompt },
      ...dataUrls.map(dataUrl => ({ type: 'image' as const, dataUrl })),
    ],
    source: { kind: 'plugin', plugin: 'vision-ask' },
  })
}
