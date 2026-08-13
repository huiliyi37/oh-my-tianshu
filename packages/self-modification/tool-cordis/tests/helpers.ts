import { Context } from 'cordis'
import Timer from '@cordisjs/plugin-timer'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRegistry from '@deepseek-ai/dsh-tools'
import type { ToolDefinition, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import * as tool from '../src/index.ts'

const testToolSignal = new AbortController().signal

/**
 * Shared spec helpers: a real `SystemPrompt` + `ToolRegistry` + timer +
 * tool-cordis tree (only the model is absent — the code strings below stand in
 * for what it would write), plus the canonical mount-code fixtures the suites
 * share.
 */

/** Mount the plugin on a fresh context with a real ToolRegistry and the timer service. */
export async function setup(config?: tool.Config): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(Timer)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRegistry)
  await ctx.plugin(tool, config)
  return ctx
}

let callCounter = 0

/** Execute a registered tool through the real registry pipeline. */
export function call(ctx: Context, name: string, args: unknown): Promise<ToolExecutionResult> {
  return ctx.tools.execute({ signal: testToolSignal, callId: CallId(`call-${++callCounter}`), name, arguments: args })
}

/** Concatenated text blocks of one tool result. */
export function text(result: ToolExecutionResult): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

/** Mount code for a listener plugin: logs on every `tools/change`. */
export const LISTENER_CODE = `
  return {
    name: 'change-logger',
    apply(ctx) {
      ctx.on('tools/change', () => console.log('tools changed'))
    },
  }
`

/** Explicit content-array output declaration for dynamic-tool behavior fixtures. */
export const CONTENT_OUTPUT_CODE = `
              output: {
                schema: { type: 'array', items: { type: 'json' } },
                render(_args, value) { return value },
              },`

/** Mount code for a self-made tool: registers `reverse_text` via the sandbox's harness helpers. */
export const REVERSE_TOOL_CODE = `
  return {
    name: 'reverse-text',
    inject: ['tools'],
    apply(ctx) {
      harness.registerTool(ctx, harness.defineTool({
        name: 'reverse_text',
        description: 'Reverse a string.',
        parameters: { text: { type: 'string', required: true } },
        output: {
          schema: { type: 'string' },
          render(_args, value) {
            return [{ type: 'text', text: value }]
          },
        },
        async execute(args) {
          return args.text.split('').reverse().join('')
        },
      }))
    },
  }
`

/** Mount code providing a `greeter` service other mounts can inject. */
export const PROVIDER_CODE = `
  return {
    name: 'greeter-provider',
    apply(ctx) {
      ctx.provide('greeter', { greet: (name) => 'hi ' + name })
    },
  }
`

/** Mount code consuming the `greeter` service through inject, exposing it as a tool. */
export const CONSUMER_CODE = `
  return {
    name: 'greeter-consumer',
    inject: ['greeter', 'tools'],
    apply(ctx) {
      harness.registerTool(ctx, harness.defineTool({
        name: 'greet',
        description: 'Greet someone via the greeter service.',
        parameters: { name: { type: 'string', required: true } },
        output: {
          schema: { type: 'string' },
          render(_args, value) {
            return [{ type: 'text', text: value }]
          },
        },
        async execute(args) {
          return ctx.greeter.greet(args.name)
        },
      }))
    },
  }
`

/** A registrable no-op tool the tests use to trigger a real `tools/change`. */
export function dummyTool(name: string): ToolDefinition {
  return {
    name,
    description: 'test trigger',
    parameters: { type: 'object' as const, properties: {} },
    output: { schema: { type: 'null' }, render: () => [] },
    async execute(): Promise<null> {
      return null
    },
  }
}
