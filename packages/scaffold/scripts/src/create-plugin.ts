/**
 * dsh-sdk create command: add an external Cordis plugin (github or npm) as a
 * native package-manager dependency and mount it in cordis.yml.
 *
 * @module @deepseek-ai/dsh-scripts/create-plugin
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  ClackPromptPort,
  ConfirmQuestion,
  SdkProject,
  createBuiltinRegistry,
  requireAnswer,
  type PackageManager,
  type ProjectCommitResult,
  type PromptPort,
} from '@deepseek-ai/dsh-helper'

/** Process and interaction slice required by dsh-sdk create. */
export interface CreatePluginContext {
  cwd: string
  stdin: NodeJS.ReadStream
  stdout: NodeJS.WriteStream
  port?: PromptPort
  add?: (manager: PackageManager, spec: string, cwd: string) => Promise<void>
}

/** Result of a create run; `undefined` when the confirmation was declined. */
export type CreatePluginResult = ProjectCommitResult<SdkProject> | undefined

/** Derive a stable cordis entry id from a package name's last path segment. */
function pluginId(packageName: string): string {
  const base = packageName.startsWith('@') ? packageName.slice(packageName.indexOf('/') + 1) : packageName
  const id = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  /* v8 ignore next -- a valid npm package name always yields a non-empty id */
  if (!id) throw new Error(`cannot derive a plugin id from package name: ${packageName}`)
  return id
}

/** Read the direct dependency names declared in a project's package.json. */
async function dependencyNames(cwd: string): Promise<Set<string>> {
  const manifest = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, unknown>
  }
  /* v8 ignore next -- generated projects always declare a dependencies map */
  return new Set(Object.keys(manifest.dependencies ?? {}))
}

/**
 * Add one external plugin dependency to the current project and mount it.
 * @param source - a package-manager-native source (`pkg@version` or `github:owner/repo#ref`).
 * @param context - process, interaction, and dependency-add boundaries.
 * @returns the commit result, or `undefined` when the confirmation was declined.
 */
export async function runCreatePluginCommand(
  source: string,
  context: CreatePluginContext,
): Promise<CreatePluginResult> {
  const spec = source.trim()
  if (!spec) throw new Error('dsh-sdk create requires a plugin source (pkg@version or github:owner/repo#ref)')
  if (!context.port && (!context.stdin.isTTY || !context.stdout.isTTY)) {
    throw new Error('dsh-sdk create requires an interactive TTY')
  }
  const project = await SdkProject.open(context.cwd)
  /* v8 ignore next -- production TTY wiring is exercised by the built-bin smoke */
  const port = context.port ?? new ClackPromptPort(context.stdin, context.stdout)
  const confirmed = requireAnswer(await new ConfirmQuestion({
    id: 'create.confirm',
    message: `Add plugin '${spec}' as a dependency and mount it in cordis.yml?`,
    initialValue: true,
  }).resolve(port))
  if (!confirmed) { return undefined }

  const before = await dependencyNames(context.cwd)
  /* v8 ignore next -- production package-manager wiring is exercised by the built-bin smoke */
  const add = context.add ?? ((manager, source, cwd) => manager.add(source, cwd))
  await add(project.profile.packageManager, spec, context.cwd)
  const after = await dependencyNames(context.cwd)
  const added = [...after].filter(name => !before.has(name))
  if (added.length === 0) throw new Error(`dsh-sdk create: '${spec}' added no new dependency`)

  const reopened = await SdkProject.open(context.cwd)
  const registry = createBuiltinRegistry(reopened.profile)
  const edit = reopened.edit(registry)
  for (const packageName of added) edit.addExternalPlugin(pluginId(packageName), packageName)
  const commit = await edit.commit()
  context.stdout.write(`Mounted ${added.join(', ')} in cordis.yml.\n`)
  return commit
}
