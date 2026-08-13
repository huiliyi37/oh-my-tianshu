/**
 * Shared start/dev runtime and project-local module resolution.
 *
 * @module @deepseek-ai/dsh-scripts/runtime
 */

import { register as registerHook } from 'node:module'
import { access, readFile, readdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { Context } from 'cordis'
import { boot, installFailLoud, loadEnv, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { parseSdkBootArgs } from './args.ts'

/** Options that distinguish dev boot from production boot. */
interface BootProjectOptions {
  cwd?: string
  dev?: boolean
  argv?: readonly string[]
}

/** Startup context passed to a generated project's exported `main()`. */
export interface SdkBootContext {
  /** Developer arguments forwarded after the launcher's `--` separator. */
  readonly argv: readonly string[]
  /** SDK-recognized structured arguments parsed from {@link argv}. */
  readonly args: Record<string, string | boolean | undefined>
  /** Absolute project working directory selected by the launcher. */
  readonly cwd: string
  /** Whether the launcher is running the built or TypeScript development entry. */
  readonly mode: 'start' | 'dev'
}

async function localPluginMappings(cwd: string): Promise<Record<string, string>> {
  const mappings: Record<string, string> = {}
  let directories
  try {
    directories = await readdir(resolve(cwd, 'plugins'), { withFileTypes: true })
  } catch (error) {
    /* v8 ignore else -- the other arm requires a filesystem permission/IO fault from readdir */
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return mappings
    /* v8 ignore next -- paired with the ignored defensive readdir-error arm above */
    throw error
  }
  for (const directory of directories) {
    if (!directory.isDirectory()) continue
    const root = resolve(cwd, 'plugins', directory.name)
    let manifest: { name?: unknown }
    try {
      manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as { name?: unknown }
      await access(resolve(root, 'src/index.ts'))
    } catch (error) {
      throw new Error(`cannot load local plugin metadata from ${root}: ${String(error)}`)
    }
    if (typeof manifest.name !== 'string' || manifest.name.length === 0) {
      throw new Error(`local plugin package has no name: ${root}`)
    }
    if (mappings[manifest.name]) throw new Error(`duplicate local plugin package name: ${manifest.name}`)
    mappings[manifest.name] = pathToFileURL(resolve(root, 'src/index.ts')).href
  }
  return mappings
}

/** Register tsx and exact local-plugin source mappings for the current process. */
async function registerDevRuntime(cwd: string = process.cwd()): Promise<void> {
  let registerTsx: typeof import('tsx/esm/api')['register']
  try {
    ({ register: registerTsx } = await import('tsx/esm/api'))
  } catch (error) {
    /* v8 ignore next -- tsx is a declared project NPM dependency; missing-package behavior is defensive */
    throw new Error(`dsh-sdk dev requires the project's tsx NPM dependency: ${String(error)}`)
  }
  registerTsx()
  const mappings = await localPluginMappings(resolve(cwd))
  const hook = new URL(
    /* v8 ignore next -- the .js arm is exercised by the built-bin smoke rather than source coverage */
    import.meta.url.endsWith('.ts')
      ? './local-plugin-loader-hooks.ts'
      : './local-plugin-loader-hooks.js', import.meta.url)
  registerHook(hook, { data: { mappings } })
}

/**
 * Boot one cordis.yml after loading its sibling .env.
 * @param source - file path or file URL to cordis.yml.
 * @param options - working directory and development-runtime options.
 * @returns live Cordis context.
 */
export async function startSDK(
  source: string | URL = './cordis.yml',
  options: BootProjectOptions = {},
): Promise<Context> {
  const cwd = resolve(options.cwd ?? process.cwd())
  if (options.dev) await registerDevRuntime(cwd)
  if (source instanceof URL && source.protocol !== 'file:') {
    throw new Error(`cordis.yml URL must use file:, got ${source.protocol}`)
  }
  const requested = source instanceof URL ? fileURLToPath(source) : source
  const absolute = resolveConfigPath(requested, undefined, cwd)
  loadEnv('dsh-sdk', dirname(absolute))
  installFailLoud('dsh-sdk')
  return boot('dsh-sdk', absolute)
}

/**
 * Import and invoke a module target's main(), or directly boot cordis.yml.
 * @param target - module path relative to the project, or absent for cordis.yml.
 * @param options - working directory and development-runtime options.
 * @returns target main result or live Cordis context.
 */
export async function runSDK(
  target?: string,
  options: BootProjectOptions = {},
): Promise<unknown> {
  /* v8 ignore next -- the bin always supplies cwd; direct consumers normally accept process.cwd() */
  const cwd = resolve(options.cwd ?? process.cwd())
  if (options.dev) await registerDevRuntime(cwd)
  if (!target) return startSDK('./cordis.yml', { cwd })
  const absolute = resolve(cwd, target)
  try {
    await access(absolute)
  } catch (error) {
    const hint = options.dev ? '' : ' Run dsh-sdk build first if this is a TypeScript project.'
    throw new Error(`cannot start missing target ${target}.${hint} ${String(error)}`)
  }
  const module = await import(pathToFileURL(absolute).href) as { main?: (context: SdkBootContext) => unknown }
  if (typeof module.main !== 'function') {
    throw new Error(`dsh-sdk target ${target} must export function main()`)
  }
  const argv = [...options.argv ?? []]
  return module.main({
    argv,
    args: parseSdkBootArgs(argv),
    cwd,
    mode: options.dev ? 'dev' : 'start',
  })
}
