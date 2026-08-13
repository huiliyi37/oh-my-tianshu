/** Shared surface-only post-policy selection for search result spill. @module dsh-tool-fs-search/surface */

import type { Context } from '@huiliyi37/cordis'
import type { JsonValue, PostToolDecision, ToolDefinition, ToolExecution, ToolExecutionResult } from '@huiliyi37/dsh-tools'

/**
 * Return the accepted canonical value only when this tool still owns a direct
 * successful surface call and no downstream policy replaced either projection.
 * @param ctx - the tool plugin context used to resolve the live scoped owner.
 * @param tool - the exact registered definition whose value may be projected.
 * @param exec - the completed execution identity.
 * @param result - the canonical result before post-policy decisions are applied.
 * @param decision - the composed downstream post-policy decision.
 * @returns the canonical value to project, or `undefined` when spill must defer.
 */
export function acceptedSurfaceValue(
  ctx: Context,
  tool: ToolDefinition,
  exec: ToolExecution,
  result: ToolExecutionResult,
  decision: PostToolDecision,
): JsonValue | undefined {
  if (decision.kind !== 'accept' || decision.content !== undefined || Object.hasOwn(decision, 'value')
    || exec.parent !== undefined || exec.name !== tool.name || result.isError
    || ctx.tools.get(exec.name, exec.agent) !== tool) return undefined
  return result.value
}
