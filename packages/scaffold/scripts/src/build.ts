/**
 * User-owned tsdown configuration wrappers and child-process invocation.
 *
 * @module @huiliyi37/dsh-scripts/build
 */

import { createRequire } from 'node:module'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { UserConfig } from 'tsdown'
import { NodeCommandRunner, type CommandRunner } from '@huiliyi37/dsh-helper'

function hasLocalPluginPackages(root: string): boolean {
  const directory = resolve(root, 'plugins')
  return existsSync(directory) && readdirSync(directory, { withFileTypes: true }).some(
    item => item.isDirectory() && existsSync(resolve(directory, item.name, 'package.json')),
  )
}

function hasTsdownConfig(root: string): boolean {
  const hasConfigFile = [
    'tsdown.config.ts', 'tsdown.config.mts', 'tsdown.config.cts',
    'tsdown.config.js', 'tsdown.config.mjs', 'tsdown.config.cjs',
    'tsdown.config.json',
  ]
    .some(name => existsSync(resolve(root, name)))
  if (hasConfigFile) return true
  let manifestText: string
  try {
    manifestText = readFileSync(resolve(root, 'package.json'), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
  const manifest: unknown = JSON.parse(manifestText)
  return manifest !== null && !Array.isArray(manifest) && typeof manifest === 'object'
    && Object.hasOwn(manifest, 'tsdown')
}

/**
 * Preserve the developer's root config and append a separate workspace pass
 * when generated local plugin packages exist.
 * @param tsdownConfig - developer-owned root tsdown config.
 * @returns root tsdown config and optional local-plugin workspace pass.
 */
export function ProjectBuild(tsdownConfig: UserConfig): UserConfig[] {
  if (tsdownConfig.workspace !== undefined) {
    throw new Error('ProjectBuild owns workspace discovery; remove config.workspace')
  }
  const root = resolve(tsdownConfig.cwd ?? process.cwd())
  return hasLocalPluginPackages(root)
    ? [{ ...tsdownConfig }, { workspace: { include: ['plugins/*'] } }]
    : [{ ...tsdownConfig }]
}

/**
 * Preserve a local plugin package's developer-owned tsdown config.
 * @param tsdownConfig - developer-owned plugin tsdown config.
 * @returns validated tsdown config copy.
 */
export function PluginBuild(tsdownConfig: UserConfig): UserConfig {
  if (tsdownConfig.workspace !== undefined) throw new Error('PluginBuild does not accept nested workspace config')
  return { ...tsdownConfig }
}

function resolveTsdownBin(cwd: string): string {
  const require = createRequire(resolve(cwd, 'package.json'))
  let manifestPath: string
  try {
    manifestPath = require.resolve('tsdown/package.json')
  } catch (error) {
    throw new Error(`dsh-sdk build requires tsdown in this project: ${String(error)}`)
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { bin?: unknown }
  const bin = typeof manifest.bin === 'string'
    ? manifest.bin
    : manifest.bin && typeof manifest.bin === 'object'
      ? (manifest.bin as Record<string, unknown>).tsdown
      : undefined
  if (typeof bin !== 'string') { throw new Error('installed tsdown package has no executable') }
  return resolve(dirname(manifestPath), bin)
}

/** Invoke the project's installed tsdown, forwarding all build arguments. */
export async function runProjectBuild(
  args: readonly string[],
  cwd: string = process.cwd(),
  runner: CommandRunner = new NodeCommandRunner(),
): Promise<void> {
  if (!hasTsdownConfig(cwd)) return
  const result = await runner.run(process.execPath, [resolveTsdownBin(cwd), ...args], resolve(cwd))
  if (result.signal) throw new Error(`tsdown was killed by ${result.signal}`)
  if (result.exitCode !== 0) throw new Error(`tsdown exited with code ${String(result.exitCode)}`)
}
