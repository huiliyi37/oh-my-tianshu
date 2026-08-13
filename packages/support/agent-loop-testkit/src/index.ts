/**
 * Shared mounting for the services required before tests load the concrete
 * agent loop. The caller retains ownership of the context, loop, adapters,
 * optional plugins, and teardown.
 * @module @huiliyi37/dsh-agent-loop-testkit
 */

import type { Context } from '@huiliyi37/cordis'
import AgentRegistry from '@huiliyi37/dsh-agent'
import LlmService from '@huiliyi37/dsh-llm'
import SessionStore from '@huiliyi37/dsh-session'
import SystemPrompt from '@huiliyi37/dsh-system-prompt'
import type { Config as SystemPromptConfig } from '@huiliyi37/dsh-system-prompt'
import ToolRegistry from '@huiliyi37/dsh-tools'
import type { Config as ToolRegistryConfig } from '@huiliyi37/dsh-tools'

/** Configuration forwarded to the prerequisite service plugins. */
export interface AgentLoopTestDependenciesOptions {
  /** Configuration for the system-prompt registry. */
  readonly systemPrompt?: SystemPromptConfig
  /** Configuration for the tool registry. */
  readonly tools?: ToolRegistryConfig
}

/**
 * Mount the standard prerequisite services for an AgentLoop test.
 *
 * The function deliberately does not mount AgentLoop or register an adapter,
 * so tests retain control of load order and the topology under test. The
 * context owns every mounted service and remains responsible for disposal. A
 * plugin-load failure rejects the promise; services activated earlier in the
 * sequence remain context-owned and unwind with that context.
 * @param ctx - test context that owns the mounted services.
 * @param options - optional service configuration forwarded without mutation.
 * @returns after every prerequisite service has activated.
 */
export async function mountAgentLoopTestDependencies(
  ctx: Context,
  options: AgentLoopTestDependenciesOptions = {},
): Promise<void> {
  await ctx.plugin(LlmService)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, options.systemPrompt ?? {})
  await ctx.plugin(ToolRegistry, options.tools ?? {})
  await ctx.plugin(AgentRegistry)
}
