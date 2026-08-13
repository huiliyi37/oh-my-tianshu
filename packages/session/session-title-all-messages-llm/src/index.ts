/** All-human-messages model provider for `ctx.sessionTitle`. */

import type { Context } from 'cordis'
import z from 'schemastery'
import {
  registerSessionTitleLlmProvider,
  SessionTitleLlmConfigFields,
} from '@deepseek-ai/dsh-session-title-llm'
import type { SessionTitleLlmConfig } from '@deepseek-ai/dsh-session-title-llm'

export const name = 'session-title-all-messages-llm'
export const inject = ['sessionTitle', 'llm', 'sessions']

/** Required LLM policy; this plugin adds no defaults. */
export type Config = SessionTitleLlmConfig
/** Loader schema shared with the first-message provider. */
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
 * Register the all-user-messages model provider.
 * @param ctx - context exposing session-title, LLM, and session services.
 * @param config - required route, target, byte, token, and timeout policy.
 */
export function apply(ctx: Context, config: Config): void {
  registerSessionTitleLlmProvider(ctx, config, name, 'all-user-messages', messages => messages)
}
