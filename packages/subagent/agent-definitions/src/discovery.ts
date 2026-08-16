/**
 * Local filesystem discovery for agent role definitions: ranked roots, flat
 * `<name>.md` parsing with YAML frontmatter, and reads through `ctx.fs` when a
 * filesystem service is present (trusted-host roots read through node:fs
 * directly). The primitives mirror `dsh-skill-local`'s private ones, narrowed
 * to flat files — a role has no bundled resources, so there is no directory
 * bundle form.
 *
 * @module @huiliyi37/dsh-agent-definitions/discovery
 */

/* jscpd:ignore-start -- intentional copy of dsh-skill-local's private discovery
   primitives (plan C7-5/C1: the skill originals are not exported; extraction
   would couple two evolving packages for a few stable helpers). */
import { access, readdir, readFile, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { Context } from '@huiliyi37/cordis'
import { parse as parseYaml } from 'yaml'
import type { FileSystem, FsDirEntry, FsTarget } from '@huiliyi37/dsh-fs'
import { isSkillName } from '@huiliyi37/dsh-skill'

/** Precedence rank for the project `<root>/.dsh/agents` directory. */
export const PROJECT_DSH_RANK = 100
/** Precedence rank for the project `<root>/.agents/agents` directory. */
export const PROJECT_AGENTS_RANK = 200
/** Precedence rank for configured custom agent directories. */
export const CUSTOM_RANK = 300
/** Precedence rank for the user `~/.dsh/agents` directory. */
export const USER_DSH_RANK = 400
/** Precedence rank for the user `~/.agents/agents` directory. */
export const USER_AGENTS_RANK = 500
/** Precedence rank for a deployment's bundled agent directory. */
export const BUNDLED_AGENT_RANK = 600

/** Origin bucket for an agent definition. The value is prompt-visible metadata, not precedence by itself. */
export type AgentDefinitionSource =
  | 'project-dsh'
  | 'project-agents'
  | 'runtime'
  | 'user-dsh'
  | 'user-agents'
  | 'custom'
  | 'bundled'
  | (string & {})

/** One ranked discovery root. */
export interface AgentRoot {
  /** Absolute directory scanned for flat `<name>.md` role files. */
  readonly path: string
  /** Origin bucket reported on definitions discovered here. */
  readonly source: AgentDefinitionSource
  /** Lower ranks win duplicate role names. */
  readonly rank: number
  /** Owning project root for watch-capacity accounting; absent for shared roots. */
  readonly projectRoot?: string
  /** Trusted roots read through node:fs directly, bypassing any sandboxed `ctx.fs`. */
  readonly trustedHost?: boolean
}

/** Parsed content of one role file: validated frontmatter plus the persona body. */
export interface ParsedAgentDefinition {
  readonly name: string
  readonly description: string
  readonly tools?: readonly string[]
  readonly model?: string
  readonly content: string
}

interface AgentRootEntry {
  name: string
  type: 'directory' | 'file' | 'other'
  path: string
}

/** Opaque handle handed back at load time. */
export interface AgentLocator {
  readonly path: string
}

/**
 * Resolve the ranked discovery roots for one workspace. Project roots exist
 * only when a cwd selects a project; custom roots sit between project and
 * user roots; the bundled root loses to everything.
 * @param cwd - workspace selector; undefined skips project roots.
 * @param config - resolved root configuration.
 * @param ctx - context whose optional filesystem service answers existence probes.
 * @returns the ordered roots; earlier entries outrank later ones.
 */
export async function resolveAgentRoots(
  cwd: string | undefined,
  config: {
    includeDefaultRoots: boolean
    dshHome: string
    agentsHome: string
    customAgentDirs: readonly string[]
    bundledAgentDir: string | undefined
  },
  ctx: Context,
): Promise<AgentRoot[]> {
  const roots: AgentRoot[] = []
  if (config.includeDefaultRoots && cwd !== undefined) {
    const projectRoot = await findProjectRoot(resolve(cwd), optionalFileSystem(ctx))
    roots.push(
      { path: join(projectRoot, '.dsh/agents'), source: 'project-dsh', rank: PROJECT_DSH_RANK, projectRoot },
      { path: join(projectRoot, '.agents/agents'), source: 'project-agents', rank: PROJECT_AGENTS_RANK, projectRoot },
    )
  }
  roots.push(...config.customAgentDirs.map(path => ({ path, source: 'custom' as const, rank: CUSTOM_RANK })))
  if (config.includeDefaultRoots) {
    roots.push(
      { path: join(config.dshHome, 'agents'), source: 'user-dsh', rank: USER_DSH_RANK },
      { path: join(config.agentsHome, 'agents'), source: 'user-agents', rank: USER_AGENTS_RANK },
    )
  }
  if (config.bundledAgentDir !== undefined) {
    roots.push({ path: config.bundledAgentDir, source: 'bundled', rank: BUNDLED_AGENT_RANK, trustedHost: true })
  }
  return roots
}

/**
 * Discover and parse every readable flat role file under one root.
 * @param root - the ranked root to scan.
 * @param ctx - context carrying the optional filesystem service and logger.
 * @returns parsed definitions with their locators, in filename order.
 */
export async function discoverAgentRoot(
  root: AgentRoot,
  ctx: Context,
): Promise<{ parsed: ParsedAgentDefinition; locator: AgentLocator }[]> {
  const definitions: { parsed: ParsedAgentDefinition; locator: AgentLocator }[] = []
  const entries = await listAgentRootEntries(root, ctx)
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.type !== 'file' || !entry.name.endsWith('.md')) continue
    const locator: AgentLocator = { path: entry.path }
    const parsed = await parseAgentFile(locator.path, ctx, undefined, root.trustedHost === true)
    if (parsed === undefined) continue
    definitions.push({ parsed, locator })
  }
  return definitions
}

/**
 * Read and validate one flat role file.
 * @param path - absolute file path.
 * @param ctx - context carrying the optional filesystem service and logger.
 * @param signal - optional cancellation for the read.
 * @param trustedHost - read through node:fs directly, bypassing `ctx.fs`.
 * @returns the parsed definition, or `undefined` (with a warning) when the
 *   file is missing, unreadable, or invalid.
 */
export async function parseAgentFile(
  path: string,
  ctx: Context,
  signal?: AbortSignal,
  trustedHost = false,
): Promise<ParsedAgentDefinition | undefined> {
  const raw = await readAgentText(ctx, path, signal, trustedHost)
  signal?.throwIfAborted()
  if (raw === undefined) return undefined
  let parsed
  try {
    parsed = parseFrontmatter(raw)
  } catch (error) {
    ctx.logger.warn(`agent file ${path} ignored: invalid YAML frontmatter: ${errorMessage(error)}`)
    return undefined
  }
  if (!parsed) {
    ctx.logger.warn(`agent file ${path} ignored: missing YAML frontmatter`)
    return undefined
  }
  const name = stringField(parsed.data, 'name')
  const description = stringField(parsed.data, 'description')
  if (name === undefined || description === undefined) {
    ctx.logger.warn(`agent file ${path} ignored: frontmatter requires name and description`)
    return undefined
  }
  if (!isSkillName(name)) {
    ctx.logger.warn(`agent file ${path} ignored: invalid agent name "${name}"`)
    return undefined
  }
  let tools: readonly string[] | undefined
  try {
    tools = parseToolsField(parsed.data)
  } catch (error) {
    ctx.logger.warn(`agent file ${path} ignored: ${errorMessage(error)}`)
    return undefined
  }
  return {
    name,
    description,
    ...tools !== undefined ? { tools } : {},
    ...optionalString(parsed.data, 'model'),
    content: parsed.body.trim(),
  }
}

/** Validate the optional `tools` frontmatter field: an allow list of global tool names. */
function parseToolsField(data: Record<string, unknown>): string[] | undefined {
  if (!Object.hasOwn(data, 'tools')) return undefined
  const value = data['tools']
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || item.length === 0)) {
    throw new TypeError('frontmatter field "tools" must be an array of tool names')
  }
  return value as string[]
}

async function listAgentRootEntries(root: AgentRoot, ctx: Context): Promise<AgentRootEntry[]> {
  const fs = optionalFileSystem(ctx)
  if (fs !== undefined && root.trustedHost !== true) return await listAgentRootEntriesFromFileSystem(root, fs)
  return await listAgentRootEntriesFromNode(root, ctx)
}

async function listAgentRootEntriesFromFileSystem(root: AgentRoot, fs: FileSystem): Promise<AgentRootEntry[]> {
  try {
    return (await fsListDir(fs, root.path)).map(entryFromFs)
  } catch (error) {
    if (isAbsentAgentPathError(error)) return []
    throw error
  }
}

async function fsListDir(fs: FileSystem, path: string): Promise<FsDirEntry[]> {
  const target = await fs.resolve(path)
  return await fs.listDir(target)
}

function entryFromFs(entry: FsDirEntry): AgentRootEntry {
  return { name: entry.name, type: entry.type, path: entry.target.displayPath }
}

async function listAgentRootEntriesFromNode(root: AgentRoot, ctx: Context): Promise<AgentRootEntry[]> {
  let entries
  try {
    entries = await readdir(root.path, { withFileTypes: true, encoding: 'utf8' })
  } catch (error) {
    /* v8 ignore else -- Native non-absence directory failures are provider-dependent; the ctx.fs path pins incomplete discovery. */
    if (isAbsentAgentPathError(error)) return []
    /* v8 ignore next -- Same native error branch as above. */
    throw error
  }

  const result: AgentRootEntry[] = []
  for (const entry of entries) {
    const path = join(root.path, entry.name)
    const type = await nodeEntryKind(path, entry, ctx)
    result.push({ name: entry.name, type: type ?? 'other', path })
  }
  return result
}

function optionalFileSystem(ctx: Context): FileSystem | undefined {
  return ctx.get('fs')
}

async function readAgentText(ctx: Context, path: string, signal?: AbortSignal, trustedHost = false): Promise<string | undefined> {
  signal?.throwIfAborted()
  const fs = optionalFileSystem(ctx)
  if (fs !== undefined && !trustedHost) {
    return await readAgentTextFromFileSystem(ctx, fs, path, signal)
  }
  try {
    return await readFile(path, { encoding: 'utf8', signal })
  } catch (error) {
    signal?.throwIfAborted()
    if (isAbsentAgentPathError(error)) return undefined
    throw error
  }
}

async function readAgentTextFromFileSystem(ctx: Context, fs: FileSystem, path: string, signal?: AbortSignal): Promise<string | undefined> {
  // A missing or temporarily inaccessible role file is not fatal to discovery.
  signal?.throwIfAborted()
  let target
  try {
    target = await fs.resolve(path)
  } catch (error) {
    if (isAbsentAgentPathError(error)) return undefined
    throw error
  }
  signal?.throwIfAborted()
  let info
  try {
    info = await fs.stat(target, signal)
  } catch (error) {
    signal?.throwIfAborted()
    if (isAbsentAgentPathError(error)) return undefined
    throw error
  }
  if (info === undefined || info.type !== 'file') return undefined
  try {
    return await fs.readText(target, signal)
  } catch (error) {
    signal?.throwIfAborted()
    if (isAbsentAgentPathError(error)) return undefined
    if (!hasErrorCode(error, 'FS_NOT_TEXT')) throw error
    ctx.logger.warn(`agent file ${path} ignored: ${fsReadErrorMessage(target, error)}`)
    return undefined
  }
}

function fsReadErrorMessage(target: FsTarget, error: unknown): string {
  return `failed to read text file at ${target.displayPath}: ${errorMessage(error)}`
}

async function nodeEntryKind(fullPath: string, entry: { isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean }, ctx: Context): Promise<'directory' | 'file' | undefined> {
  if (entry.isDirectory()) return 'directory'
  if (entry.isFile()) return 'file'
  /* v8 ignore next -- Non-file directory entries such as FIFOs are platform-specific and intentionally skipped. */
  if (!entry.isSymbolicLink()) return undefined
  try {
    const info = await stat(fullPath)
    if (info.isDirectory()) return 'directory'
    /* v8 ignore else -- the special-file symlink branch relies on POSIX /dev/null. */
    if (info.isFile()) return 'file'
    /* v8 ignore next -- The special-file symlink fixture relies on POSIX /dev/null. */
    return undefined
  } catch (error) {
    ctx.logger.warn(`agent entry ${fullPath} ignored: failed to follow symbolic link: ${errorMessage(error)}`)
    return undefined
  }
}

function parseFrontmatter(raw: string): { data: Record<string, unknown>; body: string } | undefined {
  const firstLineEnd = raw.indexOf('\n')
  if (firstLineEnd < 0) return undefined
  const firstLine = raw.slice(0, firstLineEnd).replace(/\r$/, '')
  if (firstLine !== '---') return undefined
  const start = firstLineEnd + 1
  const closing = findClosingFrontmatter(raw, start)
  if (closing === undefined) return undefined
  const yaml = raw.slice(start, closing.start)
  const parsed = parseYaml(yaml) as unknown
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  return { data: parsed as Record<string, unknown>, body: raw.slice(closing.bodyStart) }
}

function findClosingFrontmatter(raw: string, start: number): { start: number; bodyStart: number } | undefined {
  let lineStart = start
  while (lineStart <= raw.length) {
    const nextNewline = raw.indexOf('\n', lineStart)
    const lineEnd = nextNewline < 0 ? raw.length : nextNewline
    const line = raw.slice(lineStart, lineEnd).replace(/\r$/, '')
    if (line === '---') {
      return { start: lineStart, bodyStart: nextNewline < 0 ? raw.length : nextNewline + 1 }
    }
    if (nextNewline < 0) return undefined
    lineStart = nextNewline + 1
  }
}

async function findProjectRoot(cwd: string, fs: FileSystem | undefined): Promise<string> {
  let current = cwd
  while (true) {
    if (await pathExists(join(current, '.git'), fs)) {
      return current
    }
    const parent = dirname(current)
    if (parent === current) return cwd
    current = parent
  }
}

async function pathExists(path: string, fs: FileSystem | undefined): Promise<boolean> {
  if (fs !== undefined) {
    return await pathExistsInFileSystem(path, fs)
  }
  return await pathExistsInNode(path)
}

async function pathExistsInFileSystem(path: string, fs: FileSystem): Promise<boolean> {
  let target
  try {
    target = await fs.resolve(path)
  } catch {
    // A backend may reject or hide this candidate; continue walking upward.
    return false
  }
  try {
    return await fs.stat(target) !== undefined
  } catch {
    // Transient stat failures make only this git-root candidate unusable.
    return false
  }
}

async function pathExistsInNode(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    // Missing host paths are expected while walking toward the filesystem root.
    return false
  }
}

function stringField(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function optionalString(data: Record<string, unknown>, key: string): { [K in typeof key]?: string } {
  const value = data[key]
  return typeof value === 'string' && value.length > 0 ? { [key]: value } : {}
}

function isAbsentPathError(error: unknown): boolean {
  return hasErrorCode(error, 'ENOENT') || hasErrorCode(error, 'ENOTDIR')
}

function isAbsentAgentPathError(error: unknown): boolean {
  return isAbsentPathError(error)
    || hasErrorCode(error, 'FS_NOT_FOUND')
    || hasErrorCode(error, 'FS_NOT_DIRECTORY')
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}

function errorMessage(error: unknown): string {
  return String(error)
}
/* jscpd:ignore-end */
