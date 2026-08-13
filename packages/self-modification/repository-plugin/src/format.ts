/**
 * Trusted repository-package preparation and prepared-manifest validation.
 * @module
 */

import { cp, copyFile, mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { z } from 'zod'
import { parseMcpDocument } from './mcp.ts'

/** Fixed module filename loaded from an installed prepared plugin package. */
export const PREPARED_ENTRY_FILENAME = 'dsh-plugin.mjs'
/** Fixed directory containing copied static plugin assets. */
export const PREPARED_ASSET_DIRECTORY = 'dsh-plugin-assets'
/** Loader builtin used by every generated repository wrapper. */
export const REPOSITORY_PLUGIN_BUILTIN = 'dsh-repository-plugin'
/** Dependency-provided command that repository package `prepack` lifecycles must invoke. */
export const REPOSITORY_PLUGIN_PREPARE_COMMAND = 'dsh-plugin-prepare'
/** Published package whose direct development dependency supplies the prepare command. */
export const REPOSITORY_PLUGIN_PACKAGE_NAME = '@huiliyi37/dsh-repository-plugin'

/**
 * Whether a package lifecycle declaration names the preparation dependency's helper.
 * @param script - package-authored lifecycle command.
 * @returns true when the required helper command is present.
 */
export function hasRepositoryPrepareCommand(script: string): boolean {
  return script.includes(REPOSITORY_PLUGIN_PREPARE_COMMAND)
}

const prepackSchema = z.string().min(1).refine(
  hasRepositoryPrepareCommand,
  { message: `must invoke ${REPOSITORY_PLUGIN_PREPARE_COMMAND}` },
)

const sourceMetadataSchema = z.object({
  skills: z.array(z.string().min(1)).default([]),
  mcpServers: z.string().min(1).optional(),
  entry: z.string().min(1).optional(),
}).strict().refine(value => value.skills.length > 0 || value.mcpServers !== undefined || value.entry !== undefined, {
  message: 'declare at least one skill root, mcpServers file, or compiled entry',
})
const sourcePackageSchema = z.looseObject({
  name: z.string().min(1),
  devDependencies: z.looseObject({
    [REPOSITORY_PLUGIN_PACKAGE_NAME]: z.string().min(1),
  }),
  scripts: z.looseObject({
    prepack: prepackSchema,
  }),
  dsh: sourceMetadataSchema,
})
const preparedManifestSchema = z.object({
  name: z.string().min(1),
  skills: z.array(z.string().min(1)),
  mcpServers: z.string().min(1).optional(),
  entry: z.string().min(1).optional(),
}).strict()
const preparedConfigSchema = z.object({
  // Wrappers pass import.meta.url, which is always file: for an installed
  // package; any other scheme would only fail later inside fileURLToPath with
  // an uncontextualized TypeError, so reject it at this validation boundary.
  baseUrl: z.url({ protocol: /^file$/ }),
  manifest: preparedManifestSchema,
}).strict()

/** Prepared manifest embedded in the generated wrapper. */
export interface PreparedPluginManifest {
  name: string
  skills: string[]
  mcpServers?: string
  entry?: string
}

/** Untrusted generated-wrapper config accepted by the DSH-owned runtime builtin. */
export interface PreparedPluginConfig {
  baseUrl: string
  manifest: PreparedPluginManifest
}

function formatZodError(label: string, error: z.ZodError): Error {
  return new Error(`${label}:\n${z.prettifyError(error)}`)
}

/**
 * Validate the config passed by an installed prepared wrapper.
 * @param value - wrapper-provided value crossing the file/module boundary.
 * @returns a detached typed config.
 */
export function parsePreparedPluginConfig(value: unknown): PreparedPluginConfig {
  const result = preparedConfigSchema.safeParse(value)
  if (!result.success) { throw formatZodError('invalid prepared DSH plugin', result.error) }
  return {
    baseUrl: result.data.baseUrl,
    manifest: {
      name: result.data.manifest.name,
      skills: result.data.manifest.skills,
      ...result.data.manifest.mcpServers === undefined ? {} : { mcpServers: result.data.manifest.mcpServers },
      ...result.data.manifest.entry === undefined ? {} : { entry: result.data.manifest.entry },
    },
  }
}

/**
 * Whether `candidate` resolves outside `root` — the containment check shared
 * by prepare-time asset copying and runtime prepared-path resolution.
 * @param root - directory that must contain the candidate.
 * @param candidate - absolute path to test.
 * @returns true when the candidate escapes the root.
 */
export function isOutside(root: string, candidate: string): boolean {
  const path = relative(root, candidate)
  /* v8 ignore next -- Different-drive Windows relative paths cannot be produced on POSIX coverage hosts. */
  return path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)
}

async function sourcePath(pluginDirectory: string, sourceRoot: string, configured: string, kind: 'directory' | 'file'): Promise<string> {
  if (isAbsolute(configured)) throw new Error(`DSH plugin asset path must be relative: ${JSON.stringify(configured)}`)
  let path: string
  try {
    path = await realpath(resolve(pluginDirectory, configured))
  } catch (cause) {
    throw new Error(`DSH plugin asset does not exist: ${JSON.stringify(configured)}`, { cause })
  }
  if (isOutside(sourceRoot, path)) {
    throw new Error(`DSH plugin asset escapes its plugin source root: ${JSON.stringify(configured)}`)
  }
  const info = await stat(path)
  if (kind === 'directory' ? !info.isDirectory() : !info.isFile()) {
    throw new Error(`DSH plugin asset is not a ${kind}: ${JSON.stringify(configured)}`)
  }
  return path
}

function wrapperSource(manifest: PreparedPluginManifest): string {
  // The manifest is static, so the wrapper's service dependencies are too:
  // declaring them gates the wrapper fiber until the composition provides
  // them, which means the runtime's SkillLocal/McpClient children activate
  // within the wrapper's own load epoch and their failures (duplicate
  // provider names, damaged packages) reject the wrapper's Loader
  // transaction instead of leaving a silently PENDING or FAILED child.
  const inject = [
    'loader',
    ...manifest.skills.length > 0 ? ['skills'] : [],
    ...manifest.mcpServers === undefined ? [] : ['tools'],
  ]
  const entryHelpers = manifest.entry === undefined ? [] : [
    'function unwrap(exports) {',
    '  const value = exports?.default ?? exports',
    '  return value?.__esModule ? (value.default ?? value) : value',
    '}',
  ]
  const entryApply = manifest.entry === undefined ? [] : [
    '  const repositoryPlugin = unwrap(await import(manifest.entry))',
    "  await mount(ctx, repositoryPlugin, 'repository Plugin entry')",
  ]
  return [
    '// Generated by dsh-plugin-prepare. Do not edit.',
    `const manifest = ${JSON.stringify(manifest)}`,
    '// Value mirror: Cordis const enum FiberState.ACTIVE; keep aligned with dsh-repository-plugin source.ts.',
    'const FIBER_ACTIVE = 2',
    `export const name = ${JSON.stringify(manifest.name)}`,
    `export const inject = ${JSON.stringify(inject)}`,
    ...entryHelpers,
    'async function mount(ctx, plugin, label, config) {',
    '  const fiber = ctx.plugin(plugin, config)',
    '  await fiber',
    '  if (fiber.state !== FIBER_ACTIVE) {',
    '    const missing = Object.keys(fiber.inject).filter(service => fiber.ctx.get(service) === undefined)',
    "    throw new Error(`${label} did not activate (waiting for services: ${missing.join(', ') || 'unknown'})`)",
    '  }',
    '}',
    'export async function apply(ctx) {',
    `  const runtime = ctx.loader.builtins[${JSON.stringify(REPOSITORY_PLUGIN_BUILTIN)}]`,
    `  if (runtime === undefined) throw new Error(${JSON.stringify(`missing Cordis builtin ${REPOSITORY_PLUGIN_BUILTIN}`)})`,
    "  await mount(ctx, runtime, 'repository Plugin runtime', { baseUrl: import.meta.url, manifest })",
    ...entryApply,
    '}',
    '',
  ].join('\n')
}

/**
 * Validate and package one `.dsh-plugin` directory into copied assets plus a generated wrapper.
 * Outputs are staged and committed by rename, but the final publish (remove
 * old outputs, rename assets, rename entry) is not one atomic step: a crash
 * mid-publish can leave assets without an entry or neither. Rerunning prepare
 * repairs the package; partial outputs are never importable as a plugin.
 * @param directory - `.dsh-plugin` package directory; defaults to the prepare process cwd.
 * @returns the generated prepared manifest.
 */
export async function prepareDshPlugin(directory: string = process.cwd()): Promise<PreparedPluginManifest> {
  const pluginDirectory = await realpath(resolve(directory))
  let packageValue: unknown
  try {
    packageValue = JSON.parse(await readFile(join(pluginDirectory, 'package.json'), 'utf8')) as unknown
  } catch (cause) {
    throw new Error(`failed to read DSH plugin package metadata in ${pluginDirectory}`, { cause })
  }
  const parsed = sourcePackageSchema.safeParse(packageValue)
  if (!parsed.success) throw formatZodError('invalid DSH plugin package.json', parsed.error)

  const sourceRoot = await realpath(dirname(pluginDirectory))
  const skillSources: string[] = []
  for (const configured of parsed.data.dsh.skills) {
    const source = await sourcePath(pluginDirectory, sourceRoot, configured, 'directory')
    if (!isOutside(source, pluginDirectory)) {
      throw new Error(`DSH skill root cannot contain the .dsh-plugin package: ${JSON.stringify(configured)}`)
    }
    skillSources.push(source)
  }
  let mcpSource: string | undefined
  if (parsed.data.dsh.mcpServers !== undefined) {
    mcpSource = await sourcePath(pluginDirectory, sourceRoot, parsed.data.dsh.mcpServers, 'file')
    parseMcpDocument(await readFile(mcpSource, 'utf8'))
  }
  let entry: string | undefined
  if (parsed.data.dsh.entry !== undefined) {
    const entrySource = await sourcePath(pluginDirectory, pluginDirectory, parsed.data.dsh.entry, 'file')
    entry = `./${relative(pluginDirectory, entrySource).split(sep).join('/')}`
  }

  const manifest: PreparedPluginManifest = {
    name: parsed.data.name,
    skills: skillSources.map((_, index) => `${PREPARED_ASSET_DIRECTORY}/skills/${index}`),
    ...mcpSource === undefined ? {} : { mcpServers: `${PREPARED_ASSET_DIRECTORY}/.mcp.json` },
    ...entry === undefined ? {} : { entry },
  }
  const staging = await mkdtemp(join(pluginDirectory, '.dsh-plugin-prepare-'))
  try {
    const stagedAssets = join(staging, PREPARED_ASSET_DIRECTORY)
    await mkdir(join(stagedAssets, 'skills'), { recursive: true })
    await Promise.all(skillSources.map((source, index) => cp(source, join(stagedAssets, 'skills', String(index)), {
      recursive: true,
      force: false,
      errorOnExist: true,
    })))
    if (mcpSource !== undefined) await copyFile(mcpSource, join(stagedAssets, '.mcp.json'))
    await writeFile(join(staging, PREPARED_ENTRY_FILENAME), wrapperSource(manifest))

    await rm(join(pluginDirectory, PREPARED_ASSET_DIRECTORY), { recursive: true, force: true })
    await rm(join(pluginDirectory, PREPARED_ENTRY_FILENAME), { force: true })
    await rename(stagedAssets, join(pluginDirectory, PREPARED_ASSET_DIRECTORY))
    await rename(join(staging, PREPARED_ENTRY_FILENAME), join(pluginDirectory, PREPARED_ENTRY_FILENAME))
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
  return manifest
}
