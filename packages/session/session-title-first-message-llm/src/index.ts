/** First-human-message model provider for `ctx.sessionTitle`. */

import type { Context } from '@huiliyi37/cordis'
import z from '@huiliyi37/schemastery'
import {
  registerSessionTitleLlmProvider,
  SessionTitleLlmConfigFields,
} from '@huiliyi37/dsh-session-title-llm'
import type { SessionTitleLlmConfig } from '@huiliyi37/dsh-session-title-llm'

export const name = 'session-title-first-message-llm'
export const inject = ['sessionTitle', 'llm', 'sessions']

/** Required LLM policy; this plugin adds no defaults. */
export type Config = SessionTitleLlmConfig
/** Loader schema shared with the all-messages provider. */
/* jscpd:ignore-start -- Loader requires each plugin to export its own statically walkable schema; the field validators remain shared. */
export const Config: z<Config> = z.object({
  targetWords: SessionTitleLlmConfigFields.targetWords,
  targetCjkCharacters: SessionTitleLlmConfigFields.targetCjkCharacters,
  maxInputBytes: SessionTitleLlmConfigFields.maxInputBytes,
  maxOutputTokens: SessionTitleLlmConfigFields.maxOutputTokens,
  timeoutMs: SessionTitleLlmConfigFields.timeoutMs,
  provider: SessionTitleLlmConfigFields.provider,
  model: SessionTitleLlmConfigFields.model,
})
/* jscpd:ignore-end */

/**
 * Register the first-message model provider.
 * @param ctx - context exposing session-title, LLM, and session services.
 * @param config - required route, target, byte, token, and timeout policy.
 */
export function apply(ctx: Context, config: Config): void {
  registerSessionTitleLlmProvider(ctx, config, name, 'first-message', (messages) => {
    const first = messages[0]
    if (first === undefined) { throw new Error('first-message title provider requires one human message') }
    return [first]
  })
}
