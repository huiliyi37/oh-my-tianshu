/**
 * Commander adapter for the create-sdk command surface.
 *
 * @module @deepseek-ai/create-sdk/args
 */

import { Command, Option } from 'commander'
import type { PackageManagerName, RunInterface } from '@deepseek-ai/dsh-helper'

/** Parsed create command flags before interactive resolution. */
export interface CreateArgs {
  directory?: string
  description?: string
  provider?: 'deepseek-official' | 'custom'
  baseURL?: string
  apiKey?: string
  model?: string
  runInterface?: RunInterface
  packageManager?: PackageManagerName
  install?: boolean
  linkWorkspace?: boolean
  config?: string
  configJson?: string
  json?: boolean
  help: boolean
}

interface CommanderCreateOptions {
  description?: string
  provider?: 'deepseek-official' | 'custom'
  baseUrl?: string
  apiKey?: string
  model?: string
  interface?: RunInterface
  pm?: PackageManagerName
  install?: boolean
  linkWorkspace?: boolean
  config?: string
  configJson?: string
  json?: boolean
  help?: boolean
}

function createProgram(): Command {
  return new Command()
    .name('create-sdk')
    .description('Create a DeepSeek Harness SDK project')
    .helpOption(false)
    .showHelpAfterError(false)
    .exitOverride()
    .configureOutput({
      /* v8 ignore next -- the command wrapper renders the package-owned usage template */
      writeOut: () => {},
      /* v8 ignore next -- Commander output is deliberately suppressed; errors are returned to the bin wrapper */
      writeErr: () => {},
    })
    .argument('[directory]')
    .option('-h, --help')
    .option('--description <text>')
    .addOption(new Option('--provider <name>').choices(['deepseek-official', 'custom']))
    .option('--base-url <url>')
    .option('--api-key <key>')
    .option('--model <name>')
    .addOption(new Option('--interface <name>').choices(['acp', 'embed']))
    .addOption(new Option('--pm <name>').choices(['npm', 'pnpm', 'yarn']))
    .addOption(new Option('--install').default(undefined))
    .addOption(new Option('--no-install').default(undefined))
    .option('--link-workspace')
    .option('--config <path>')
    .option('--config-json <json>')
    .addOption(new Option('--json').default(undefined))
}

/** Parse create-sdk positionals/options through Commander into a domain-neutral value. */
export function parseCreateArgs(argv: readonly string[]): CreateArgs {
  const program = createProgram()
  program.parse([...argv], { from: 'user' })
  const options = program.opts<CommanderCreateOptions>()
  const directory = program.processedArgs[0] as string | undefined
  return {
    ...directory === undefined ? {} : { directory },
    ...options.description === undefined ? {} : { description: options.description },
    ...options.provider === undefined ? {} : { provider: options.provider },
    ...options.baseUrl === undefined ? {} : { baseURL: options.baseUrl },
    ...options.apiKey === undefined ? {} : { apiKey: options.apiKey },
    ...options.model === undefined ? {} : { model: options.model },
    ...options.interface === undefined ? {} : { runInterface: options.interface },
    ...options.pm === undefined ? {} : { packageManager: options.pm },
    ...options.install === undefined ? {} : { install: options.install },
    ...options.linkWorkspace ? { linkWorkspace: true } : {},
    ...options.config === undefined ? {} : { config: options.config },
    ...options.configJson === undefined ? {} : { configJson: options.configJson },
    ...options.json === undefined ? {} : { json: options.json },
    help: options.help ?? false,
  }
}
