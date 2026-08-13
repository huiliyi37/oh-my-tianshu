/**
 * Commander adapter for the dsh-sdk subcommand surface.
 *
 * @module @deepseek-ai/dsh-scripts/args
 */

import { parseArgs as parseNodeArgs } from 'node:util'
import { Command } from 'commander'

/** Commands implemented by the dsh-sdk launcher. */
type DshSdkCommand = 'start' | 'dev' | 'build' | 'config' | 'create'

/** Parsed dsh-sdk invocation. */
export interface DshSdkArgs {
  command?: DshSdkCommand
  target?: string
  source?: string
  forwarded: readonly string[]
  help: boolean
}

/** Parse arbitrary project flags through Node's zero-schema argument parser. */
export function parseSdkBootArgs(argv: readonly string[]): Record<string, string | boolean | undefined> {
  return parseNodeArgs({
    args: [...argv],
    strict: false,
    allowPositionals: true,
    allowNegative: true,
  }).values
}

/** Parse one launcher invocation through real Commander subcommands. */
export function parseDshSdkArgs(argv: readonly string[]): DshSdkArgs {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    return { forwarded: [], help: true }
  }
  const separator = argv.indexOf('--')
  const launcherArgv = separator === -1 ? argv : argv.slice(0, separator)
  const passthrough = separator === -1 ? [] : argv.slice(separator + 1)
  let parsed: DshSdkArgs | undefined
  const program = new Command()
    .name('dsh-sdk')
    .helpOption(false)
    .showHelpAfterError(false)
    .exitOverride()
    .configureOutput({
      /* v8 ignore next -- the command wrapper renders the package-owned usage template */
      writeOut: () => {},
      /* v8 ignore next -- Commander errors are returned to the command wrapper */
      writeErr: () => {},
    })
  program.command('start [target]').helpOption(false).action((target?: string) => {
    parsed = { command: 'start', ...target ? { target } : {}, forwarded: [], help: false }
  })
  program.command('dev [target]').helpOption(false).action((target?: string) => {
    parsed = { command: 'dev', ...target ? { target } : {}, forwarded: [], help: false }
  })
  program.command('build [args...]').helpOption(false).allowUnknownOption(true).action((args: string[] = []) => {
    parsed = { command: 'build', forwarded: args, help: false }
  })
  program.command('config').helpOption(false).action(() => {
    parsed = { command: 'config', forwarded: [], help: false }
  })
  program.command('create <source>').helpOption(false).action((source: string) => {
    parsed = { command: 'create', source, forwarded: [], help: false }
  })
  program.parse([...launcherArgv], { from: 'user' })
  /* v8 ignore next -- every registered Commander action above assigns parsed or Commander throws */
  if (!parsed) throw new Error('dsh-sdk command did not resolve')
  if (parsed.command === 'config' && passthrough.length > 0) {
    throw new Error('dsh-sdk config does not accept forwarded arguments')
  }
  return { ...parsed, forwarded: [...parsed.forwarded, ...passthrough] }
}
