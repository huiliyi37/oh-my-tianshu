/**
 * Trusted repository-package runtime for code, skills, and common MCP definitions.
 * @module @deepseek-ai/dsh-repository-plugin
 */

import { readFile, stat } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from 'cordis'
import type {} from '@cordisjs/plugin-loader'
import { RepositoryCache } from '@cordisjs/plugin-loader/repository'
import * as SkillLocal from '@deepseek-ai/dsh-skill-local'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'
import { z } from 'zod'
import {
  REPOSITORY_PLUGIN_BUILTIN,
  isOutside,
  parsePreparedPluginConfig,
  type PreparedPluginConfig,
} from './format.ts'
import { parseMcpDocument, resolveMcpServers } from './mcp.ts'
import {
  loadPreparedRepository,
  resolveRepositoryCacheDirectory,
  resolveRepositorySpecifier,
} from './source.ts'

export {
  PREPARED_ASSET_DIRECTORY,
  PREPARED_ENTRY_FILENAME,
  REPOSITORY_PLUGIN_BUILTIN,
  REPOSITORY_PLUGIN_PACKAGE_NAME,
  REPOSITORY_PLUGIN_PREPARE_COMMAND,
  prepareDshPlugin,
  type PreparedPluginManifest,
} from './format.ts'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'repository-plugin'
/** Loader service required to register the fixed prepared-wrapper builtin. */
export const inject = ['loader']

/** Repository Plugin runtime and source-list configuration. */
export interface Config {
  /** GitHub repository sources with explicit refs and optional `.dsh-plugin` subpaths. */
  repositories?: string[]
  /** Persistent generation cache; defaults to `$DSH_HOME/cache/repository-plugins`. */
  cacheDir?: string
}

export const Config = z.object({
  repositories: z.array(z.string().min(1)).default([]),
  cacheDir: z.string().min(1).optional(),
}).strict().default({ repositories: [] })

function preparedPath(baseUrl: string, configured: string): string {
  if (isAbsolute(configured)) throw new Error(`prepared DSH plugin path must be relative: ${JSON.stringify(configured)}`)
  const directory = dirname(fileURLToPath(baseUrl))
  const path = resolve(directory, configured)
  if (isOutside(directory, path)) {
    throw new Error(`prepared DSH plugin path escapes its package: ${JSON.stringify(configured)}`)
  }
  return path
}

async function preparedDirectory(baseUrl: string, configured: string): Promise<string> {
  const path = preparedPath(baseUrl, configured)
  // A manifest-declared skill root missing from the installed package (files/
  // .npmignore dropping generated outputs, a damaged cache entry) must fail
  // the plugin load: the skill provider treats an absent root as legitimately
  // empty, which would silently mount a skill-less plugin.
  let info
  try {
    info = await stat(path)
  } catch (cause) {
    throw new Error(`prepared DSH plugin skill root is missing from the installed package: ${JSON.stringify(configured)}`, { cause })
  }
  if (!info.isDirectory()) {
    throw new Error(`prepared DSH plugin skill root is not a directory: ${JSON.stringify(configured)}`)
  }
  return path
}

async function applyPrepared(ctx: Context, value: PreparedPluginConfig): Promise<void> {
  const config = parsePreparedPluginConfig(value)
  const directory = dirname(fileURLToPath(config.baseUrl))
  const skillDirectories = await Promise.all(config.manifest.skills.map(path => preparedDirectory(config.baseUrl, path)))
  const mcpConfigs = config.manifest.mcpServers === undefined
    ? []
    : resolveMcpServers(
      parseMcpDocument(await readFile(preparedPath(config.baseUrl, config.manifest.mcpServers), 'utf8')),
      process.env,
      directory,
      // Schemastery call signatures collapse the parameter to `never` under
      // NodeNext; ResolvedMcpServer is shaped for the Config union by design.
    ).map(input => McpClient.Config(input as never))

  await ctx.effect(async function* () {
    if (skillDirectories.length > 0) {
      const skills = ctx.plugin(SkillLocal, {
        providerName: `repository:${config.manifest.name}`,
        includeDefaultRoots: false,
        customSkillDirs: skillDirectories,
        watch: false,
      })
      await skills
      yield skills.dispose
    }
    for (const mcpConfig of mcpConfigs) {
      const mcp = ctx.plugin(McpClient, mcpConfig)
      await mcp
      yield mcp.dispose
    }
  }, `repository-plugin(${config.manifest.name})`)
}

const preparedRuntime = {
  name: 'repository-plugin-runtime',
  apply: applyPrepared,
}

/**
 * Register the DSH-owned runtime as the Loader builtin used by fixed prepared wrappers.
 * @param ctx - plugin context carrying the Loader service.
 */
export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  if (ctx.loader.builtins[REPOSITORY_PLUGIN_BUILTIN] !== undefined) {
    throw new Error(`Loader builtin ${REPOSITORY_PLUGIN_BUILTIN} is already registered`)
  }
  const repositories = (config.repositories ?? []).map(resolveRepositorySpecifier)
  if (new Set(repositories).size !== repositories.length) {
    throw new Error('repository sources must resolve to unique exact specifiers')
  }
  const cache = new RepositoryCache(resolveRepositoryCacheDirectory(config.cacheDir))
  await ctx.effect(async function* () {
    ctx.loader.builtins[REPOSITORY_PLUGIN_BUILTIN] = preparedRuntime
    yield () => {
      if (ctx.loader.builtins[REPOSITORY_PLUGIN_BUILTIN] === preparedRuntime) {
        Reflect.deleteProperty(ctx.loader.builtins, REPOSITORY_PLUGIN_BUILTIN)
      }
    }
    for (const repository of repositories) {
      const plugin = await loadPreparedRepository(ctx, cache, repository)
      yield plugin.dispose
    }
  }, 'repository-plugin runtime and sources')
}
