/**
 * Internal dsh-sdk command composition used by the package bin.
 *
 * @module @deepseek-ai/dsh-scripts/command
 */

import { parseDshSdkArgs } from './args.ts'
import { runProjectBuild } from './build.ts'
import { runConfigCommand, type ConfigCommandContext } from './config.ts'
import { runCreatePluginCommand } from './create-plugin.ts'
import { runSDK } from './runtime.ts'
import { reportCommandTelemetry, type CommandTelemetryEvent } from './telemetry.ts'
import { DSH_SDK_TEMPLATES } from './templates/dsh-sdk-templates.ts'

/** Injectable process and command boundaries used by the dsh-sdk bin. */
export interface DshSdkCommandContext extends ConfigCommandContext {
  cwd: string
  stdin: NodeJS.ReadStream
  stdout: NodeJS.WriteStream
  stderr: NodeJS.WriteStream
  run?: typeof runSDK
  build?: typeof runProjectBuild
  config?: typeof runConfigCommand
  createPlugin?: typeof runCreatePluginCommand
  telemetry?: (event: CommandTelemetryEvent) => Promise<void>
}

/** Run one parsed dsh-sdk command and return its process exit code. */
export async function runDshSdkCommand(
  argv: readonly string[] = process.argv.slice(2),
  context: DshSdkCommandContext = {
    cwd: process.cwd(),
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
  },
): Promise<number> {
  const startedAt = Date.now()
  let command: string | undefined
  let success = true
  try {
    const args = parseDshSdkArgs(argv)
    if (args.help || !args.command) {
      context.stdout.write(DSH_SDK_TEMPLATES.usage.render({}))
      return 0
    }
    command = args.command
    const run = context.run ?? runSDK
    const build = context.build ?? runProjectBuild
    const config = context.config ?? runConfigCommand
    const createPlugin = context.createPlugin ?? runCreatePluginCommand
    switch (args.command) {
      case 'start': await run(args.target, { cwd: context.cwd, argv: args.forwarded }); break
      case 'dev': await run(args.target, { cwd: context.cwd, dev: true, argv: args.forwarded }); break
      case 'build': await build(args.forwarded, context.cwd); break
      case 'config': {
        const result = await config(context)
        if (result.installError) { success = false; return 1 }
        break
      }
      /* v8 ignore next -- Commander requires <source>, so create never dispatches without it */
      case 'create': await createPlugin(args.source ?? '', context); break
    }
    return 0
  } catch (error) {
    success = false
    context.stderr.write(`dsh-sdk: ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  } finally {
    if (command !== undefined) {
      /* v8 ignore next -- production telemetry wiring is exercised by the built-bin smoke */
      const telemetry = context.telemetry ?? reportCommandTelemetry
      await telemetry({ command, cwd: context.cwd, durationMs: Date.now() - startedAt, success })
    }
  }
}
