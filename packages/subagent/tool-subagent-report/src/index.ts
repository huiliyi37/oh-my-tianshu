/**
 * The child-scoped `report` tool, installed into every continuable in-process
 * child's unpublished context. Roots, one-shot children, remote providers, and
 * agentless executions never see the registration.
 *
 * @module @huiliyi37/dsh-tool-subagent-report
 */

import type { Context } from '@huiliyi37/cordis'
import z from '@huiliyi37/schemastery'
import type { Agent } from '@huiliyi37/dsh-agent'
import type { ContentBlock } from '@huiliyi37/dsh-llm'
import { escapeText } from '@huiliyi37/dsh-skill'
import type { SubagentReportDelivery } from '@huiliyi37/dsh-subagent'
import { defineTool } from '@huiliyi37/dsh-tools'

export const name = 'tool-subagent-report'
// The contribution registers only through childCtx.tools, but declaring tools
// makes Loader ordering fail at load instead of the next child materialization.
export const inject = ['subagents', 'tools']

/** Config: how accepted reports are scheduled on the parent. */
export interface Config {
  /**
   * Parent scheduling (default `next-step`). `next-step` wakes the parent and
   * enters at its nearest step boundary; `quiet` adds the same context without
   * waking, so a parked parent waits for another waking input.
   */
  reportDelivery?: SubagentReportDelivery
}

export const Config: z<Config> = z.object({
  reportDelivery: z.union(['quiet', 'next-step'] as const).default('next-step'),
})

/**
 * Install `report` into one continuable child's scope.
 * @param childCtx - child-scoped context receiving the tool.
 * @param ctx - service context used for delivery.
 * @param delivery - resolved deployment scheduling policy.
 * @returns disposer for this one registration.
 */
export function installReportTool(
  childCtx: Context,
  ctx: Context,
  delivery: SubagentReportDelivery,
): () => void {
  return childCtx.tools.register(defineTool({
    name: 'report',
    description:
      'Report selected content to the agent that started you. Call this zero or more times for progress, '
      + 'findings, or a final answer. Reporting does not end your turn or finish your work, and only your '
      + 'direct parent receives it. A failed call may still have arrived, so do not blindly repeat it.',
    parameters: {
      output: {
        type: 'string',
        required: true,
        description: 'Self-contained content for your parent; it does not see your private work.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          messageId: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `report accepted by the agent that started you as message ${value.messageId}`,
      }],
    },
    async execute(args, exec) {
      // The report text crosses into the parent's conversation as a user
      // message: escape pseudo-XML framing so a child that read hostile
      // content cannot inject markup the parent parses as harness instructions.
      const content: ContentBlock[] = [{ type: 'text', text: escapeText(args.output) }]
      // Scope-local resolution guarantees an Agent. The service still verifies
      // its exact live Activation identity at the authority boundary.
      const messageId = await ctx.subagents.reportFrom(exec.agent as Agent, content, {
        delivery,
        signal: exec.signal,
      })
      return { messageId }
    },
  }))
}

/**
 * Register the continuable-child contribution.
 * @param ctx - context carrying tools and the subagent service.
 * @param config - deployment scheduling policy.
 */
export function apply(ctx: Context, config: Config = {}): void {
  // Config() applies the schema default ('next-step') at runtime; the schemastery
  // return type keeps the input's optional shape, so assert the resolved
  // shape here — no runtime fallback exists or is wanted.
  const { reportDelivery } = Config(config) as { reportDelivery: SubagentReportDelivery }
  ctx.subagents.registerContinuableSetup(childCtx =>
    installReportTool(childCtx, ctx, reportDelivery))
}
