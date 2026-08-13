/**
 * Internal create-sdk command composition used by the package bin.
 *
 * @module @deepseek-ai/create-sdk/command
 */

import { readFile } from 'node:fs/promises'
import {
  ClackPromptPort,
  HeadlessPromptError,
  HeadlessPromptPort,
  NodeCommandRunner,
  PromptCancelledError,
  type PackageManagerVersionProbe,
  type PromptPort,
} from '@deepseek-ai/dsh-helper'
import { parseCreateArgs, type CreateArgs } from './args.ts'
import { CreateWizard, type ResolvedCreateRequest } from './create-wizard.ts'
import { resolveHeadless } from './headless.ts'
import { scaffoldProject, type ScaffoldResult } from './project-scaffolder.ts'
import { CREATE_TEMPLATES, packageManagerTemplateModel } from './templates/create-templates.ts'

/** Process and terminal slice used by the initializer. */
export interface CreateCommandContext {
  cwd: string
  stdin: NodeJS.ReadStream
  stdout: NodeJS.WriteStream
  stderr: NodeJS.WriteStream
  releaseVersion?: string
  versionProbe?: PackageManagerVersionProbe
  port?: PromptPort
  setup?: (request: ResolvedCreateRequest) => Promise<void>
}

/** Read this initializer package's release version in source and built layouts. */
export async function readCreateSdkVersion(): Promise<string> {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version?: unknown }
  /* v8 ignore next -- this package's checked-in manifest always carries its version */
  if (typeof manifest.version !== 'string') throw new Error('create-sdk package version is missing')
  return manifest.version
}

/** Resolve, write, optionally install, and build one new project. */
export async function createProject(
  argv: readonly string[],
  context: CreateCommandContext,
): Promise<ScaffoldResult | undefined> {
  const args = parseCreateArgs(argv)
  // Under --json, stdout carries only NDJSON events: human-readable progress
  // and package-manager child output move to stderr.
  const progress = args.json === true ? context.stderr : context.stdout
  if (args.help) {
    context.stdout.write(CREATE_TEMPLATES.usage.render({}))
    return undefined
  }
  const headless = await resolveHeadless(args)
  if (!headless && !context.port && (!context.stdin.isTTY || !context.stdout.isTTY)) {
    throw new Error('create-sdk requires an interactive TTY, --config <file>, or --config-json <json>')
  }
  const wizard = new CreateWizard({
    args: headless ? headless.args : args,
    /* v8 ignore next -- production TTY wiring is exercised by the built-bin smoke */
    port: context.port ?? (headless ? new HeadlessPromptPort() : new ClackPromptPort(context.stdin, context.stdout)),
    cwd: context.cwd,
    releaseVersion: context.releaseVersion ?? await readCreateSdkVersion(),
    ...context.versionProbe ? { versionProbe: context.versionProbe } : {},
    ...headless?.features ? { features: headless.features } : {},
  })
  const resolved = await wizard.run()
  const result = await scaffoldProject(resolved.directory, resolved.request)
  progress.write(CREATE_TEMPLATES.created.render({
    name: resolved.request.name,
    directory: resolved.directory,
  }))
  if (resolved.install) {
    try {
      if (context.setup) await context.setup(resolved)
      else {
        const runner = args.json === true ? new NodeCommandRunner(context.stderr) : new NodeCommandRunner()
        await resolved.request.packageManager.install(resolved.directory, runner)
        await resolved.request.packageManager.build(resolved.directory, runner)
      }
    } catch (error) {
      context.stderr.write(CREATE_TEMPLATES.setupFailure.render({
        directory: resolved.directory,
        error: String(error),
        ...packageManagerTemplateModel(resolved.request.packageManager),
      }))
      throw error
    }
  }
  progress.write(CREATE_TEMPLATES.nextSteps.render({
    directory: resolved.directory,
    setupRequired: !resolved.install,
    ...packageManagerTemplateModel(resolved.request.packageManager),
  }))
  return result
}

/** Whether NDJSON lifecycle events were requested, tolerating unparseable argv. */
function wantsJsonEvents(argv: readonly string[]): boolean {
  let parsed: CreateArgs
  try {
    parsed = parseCreateArgs(argv)
  } catch {
    return false
  }
  return parsed.json === true
}

/** Run the create command with process defaults and convert cancellation to a clean exit. */
export async function runCreateCommand(
  argv: readonly string[] = process.argv.slice(2),
  context: CreateCommandContext = {
    cwd: process.cwd(),
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
  },
): Promise<number> {
  const json = wantsJsonEvents(argv)
  const emit = (event: Record<string, unknown>): void => {
    context.stdout.write(`${JSON.stringify(event)}\n`)
  }
  try {
    await createProject(argv, context)
    if (json) emit({ type: 'done' })
    return 0
  } catch (error) {
    if (error instanceof PromptCancelledError) {
      if (json) emit({ type: 'error', reason: 'cancelled' })
      else context.stderr.write('create-sdk: cancelled\n')
      return 1
    }
    if (json && error instanceof HeadlessPromptError) {
      emit({ type: 'action-required', prompt: error.prompt })
      return 1
    }
    const message = error instanceof Error ? error.message : String(error)
    if (json) emit({ type: 'error', message })
    else context.stderr.write(`create-sdk: ${message}\n`)
    return 1
  }
}
