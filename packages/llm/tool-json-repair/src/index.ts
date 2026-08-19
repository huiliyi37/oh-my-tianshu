/**
 * Repair plugin for the DeepSeek tool-JSON-in-content failure shape: a model
 * response that serializes its tool calls as JSON text inside `content`
 * instead of the `tool_calls` wire field. A wrapping `llm/stream` listener
 * converts a text block that is exactly one tool-call JSON object into a
 * tool-call block, so the agent loop executes the call the model meant.
 * Everything else passes through unchanged; the repaired stream satisfies
 * the LLM stream protocol, which the `dsh-llm` invariant validates when it is
 * mounted. The conversion is logged like any model output: the loop records
 * the transformed `assistant/chunk` stream and the repaired `assistant/message`,
 * keeping model-visible ⟺ logged intact.
 * @module @huiliyi37/dsh-tool-json-repair
 */

import { createHash } from 'node:crypto'
import type { Context } from '@huiliyi37/cordis'
import z from '@huiliyi37/schemastery'
import { CallId } from '@huiliyi37/dsh-llm'
import type { StreamChunk } from '@huiliyi37/dsh-llm'
import { detectToolCallJson } from './detect.ts'
import type { DetectedToolCall, DetectOptions } from './detect.ts'

export const name = 'tool-json-repair'

/**
 * Plugin config, validated by the same-named schemastery schema plus the
 * load-time checks in `apply` (misconfiguration fails loud: a non-integer or
 * sub-1 `maxBlockChars` throws at plugin load, never a silent fall-back).
 */
export interface Config {
  /** Whether the stream wrapper converts tool-JSON text blocks (default `true`). */
  enabled?: boolean
  /** Text blocks longer than this never convert (default `65536`). */
  maxBlockChars?: number
  /** Accept one ```json … ``` fence around the object (default `true`). */
  allowFenced?: boolean
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  maxBlockChars: z.number().default(65536),
  allowFenced: z.boolean().default(true),
})

/**
 * Derive the call id for a converted block: deterministic from the block
 * index and the call content, so replaying the same stream produces the
 * same durable log and snapshots stay stable. The index prefix keeps two
 * identical JSON objects in one message distinct.
 * @param index - the source block index.
 * @param call - the detected call.
 * @returns the branded call id.
 */
function mintCallId(index: number, call: DetectedToolCall): string {
  const digest = createHash('sha256')
    .update(call.name)
    .update('\u0000')
    .update(call.arguments)
    .digest('hex')
    .slice(0, 12)
  return `repair-${index}-${digest}`
}

/**
 * Wrap one LLM chunk stream. Text blocks are buffered until their
 * `block-end`; a matching block re-emits as `tool-call` chunks with the same
 * index, while every other chunk passes through in order. Conversion is
 * skipped once a proper tool-call block has opened, so a stream that already
 * carries real tool calls keeps its text intact.
 * @param source - the downstream stream (the adapter's own output).
 * @param options - validated {@link DetectOptions}.
 * @returns the transformed stream.
 */
export async function* repairStream(
  source: AsyncIterable<StreamChunk>,
  options: DetectOptions,
): AsyncGenerator<StreamChunk> {
  // Per-index text buffers: the protocol permits interleaved blocks, and the
  // block-end decision needs the complete text.
  const textBlocks = new Map<number, StreamChunk[]>()
  let sawToolCallBlock = false

  for await (const chunk of source) {
    if (chunk.type === 'block-start' && chunk.blockType === 'text') {
      // The block-start is part of the buffer: a non-matching block must
      // replay byte-identically, and a matching one replaces all three.
      textBlocks.set(chunk.index, [chunk])
      continue
    }
    if (chunk.type === 'text-delta') {
      const buffered = textBlocks.get(chunk.index)
      if (buffered !== undefined) {
        buffered.push(chunk)
        continue
      }
      yield chunk
      continue
    }
    if (chunk.type === 'block-end') {
      const buffered = textBlocks.get(chunk.index)
      if (buffered !== undefined && chunk.block.type === 'text') {
        textBlocks.delete(chunk.index)
        const detected = sawToolCallBlock ? undefined : detectToolCallJson(chunk.block.text, options)
        if (detected === undefined) {
          yield* buffered
          yield chunk
          continue
        }
        const callId = CallId(mintCallId(chunk.index, detected))
        yield { type: 'block-start', index: chunk.index, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index: chunk.index, id: callId, name: detected.name, argumentsDelta: detected.arguments }
        yield { type: 'block-end', index: chunk.index, block: { type: 'tool-call', id: callId, name: detected.name, arguments: detected.arguments } }
        continue
      }
      yield chunk
      continue
    }
    if (chunk.type === 'block-start' && chunk.blockType === 'tool-call') {
      sawToolCallBlock = true
    }
    yield chunk
  }
}

/**
 * Install the repair wrapper. With `enabled: false` the plugin registers
 * nothing, so a disabled deployment costs exactly the plugin load.
 * @param ctx - plugin context carrying the LLM service.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  if (!config.enabled) return
  const maxBlockChars = config.maxBlockChars as number
  const allowFenced = config.allowFenced as boolean
  if (!Number.isInteger(maxBlockChars) || maxBlockChars < 1) {
    throw new Error(`tool-json-repair: invalid maxBlockChars ${maxBlockChars} — must be an integer >= 1`)
  }
  ctx.on('llm/stream', (_options, next) => repairStream(next(), { maxBlockChars, allowFenced }))
}
