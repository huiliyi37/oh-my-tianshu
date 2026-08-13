/** Project-local model-facing tool. */
import type { Context } from 'cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = '{{pluginName}}'
export const inject = ['tools']

/** Register the {{toolName}} tool. */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: '{{toolName}}',
    description: 'Project-local {{toolTitle}} tool.',
    parameters: {},
    execute: async () => [{ type: 'text', text: '{{toolName}} completed.' }],
    presentCall: args => ({ card: 'generic', title: '{{toolTitle}}', kind: 'other', rawInput: args }),
  }))
}
