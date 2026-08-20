/**
 * LLM-backed task-card generation: one bounded streaming call with a fixed
 * text contract, zero retries. Any failure (no llm service, timeout, bad
 * finish, unparseable output) surfaces to the caller, which falls back to the
 * semantic template — a card must never block the first step.
 *
 * @module @huiliyi37/dsh-task-card/llm
 */

import type { Context } from '@huiliyi37/cordis'
import { BlockAssembler, createUserMessage, deepFreeze } from '@huiliyi37/dsh-llm'
import type { FinishReason, GenerateOptions, LlmService } from '@huiliyi37/dsh-llm'
import { deadline } from '@huiliyi37/dsh-timeout'

/** Timeout code surfaced when the card call exceeds its budget. */
export const TASK_CARD_TIMEOUT_CODE = 'task-card/timeout'

/** Fixed output contract (stable text; the parser validates at the boundary). */
export const TASK_CARD_SYSTEM_PROMPT = [
  'You rewrite the user\'s FIRST message of a coding-assistant session into a structured task card.',
  'Return ONLY markdown with exactly this shape:',
  '# {one-line title}',
  '',
  '## 目标',
  '{1-2 sentences restating the goal faithfully}',
  '',
  '## 约束',
  '- {constraint}',      // omit the whole section when the message supports none
  '',
  '## 验收',
  '- {verifiable criterion}',   // omit the whole section when none is inferable
  '',
  'Rules: never invent constraints or acceptance criteria the message does not support — omit the section instead.',
  'Use the message\'s language.',
].join('\n')

/** One card-generation call's inputs. */
export interface TaskCardLlmRequest {
  /** Fixed contract prompt. */
  system: string
  /** The user's first message text. */
  user: string
  /** Explicit route (first message has no assistant message to derive from). */
  route: { provider: string; model: string }
}

/** Call executor (plugin side uses ctx.llm; tests inject a scripted one). */
export type TaskCardLlmInvoke = (request: TaskCardLlmRequest, signal?: AbortSignal) => Promise<string>

/**
 * Assemble the plugin-side executor: probe the llm service, run one bounded
 * streaming call with a deadline, assemble text blocks, and reject on any
 * non-stop finish or empty output. Zero retries by design.
 *
 * @param ctx - plugin context (llm service probed via reflect).
 * @param config - resolved config (timeout, route, output budget).
 * @returns the executor.
 */
export function createTaskCardInvoke(
  ctx: Context,
  config: { provider: string; model: string; timeoutMs: number; maxOutputTokens: number },
): TaskCardLlmInvoke {
  return async ({ system, user, route }, upstream) => {
    const llm = ctx.reflect.get('llm', false) as LlmService | undefined
    if (llm === undefined) {
      throw new Error('task-card: mode "llm" needs an llm service (none mounted)')
    }
    using callDeadline = deadline(upstream, config.timeoutMs, TASK_CARD_TIMEOUT_CODE)
    const options: GenerateOptions = deepFreeze({
      provider: route.provider,
      model: route.model,
      messages: [createUserMessage({
        content: [{ type: 'text', text: user }],
        source: { kind: 'plugin', plugin: 'dsh-task-card' },
      })],
      system,
      maxTokens: config.maxOutputTokens,
      signal: callDeadline.signal,
    })
    const assembler = new BlockAssembler()
    for await (const chunk of llm.stream(options)) {
      assembler.push(chunk)
    }
    const finish: FinishReason = assembler.finish
    if (finish.kind !== 'stop') {
      throw new Error(
        finish.kind === 'error' || finish.kind === 'aborted'
          ? `task-card: card generation failed (${finish.failure.code}: ${finish.failure.message})`
          : `task-card: card generation ended with ${finish.kind}`,
      )
    }
    const text = assembler.blocks()
      .flatMap(block => block.type === 'text' ? [block.text] : [])
      .join('')
    if (text.trim() === '') throw new Error('task-card: card generation produced no text')
    return text
  }
}
