/**
 * Exact-specifier repository packages installed through the Loader's bundled
 * pnpm. The caller owns source validation and the cache root; this module owns
 * isolated installation, single-flight reuse, and atomic cache publication.
 */

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'

/** Exact pnpm release shipped with the Loader for repository installation. */
export const BUNDLED_PNPM_VERSION = '11.7.0'

const DEPENDENCY_NAME = 'repository'
const MARKER_NAME = '.repository-cache.json'
const MAX_ERROR_OUTPUT = 32 * 1024
const SENSITIVE_ENV_PATTERN = /KEY|PASSWORD|SECRET|TOKEN/i

/** Injectable isolated-install boundary used by {@link RepositoryCache}. */
export type RepositoryInstall = (directory: string) => Promise<void>

/** Installation controls for {@link RepositoryCache}. */
export interface RepositoryCacheOptions {
  /** Override the isolated package installation boundary. */
  install?: RepositoryInstall
}

interface CacheMarker {
  specifier: string
}

function scrubEnvironment(environment: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(environment).filter(([name]) => !SENSITIVE_ENV_PATTERN.test(name)))
}

function installEnvironment(commandDirectory: string): NodeJS.ProcessEnv {
  const scrubbed = scrubEnvironment()
  const path = Object.entries(scrubbed).find(([name]) => name.toUpperCase() === 'PATH')?.[1]
  const withoutPath = Object.fromEntries(Object.entries(scrubbed).filter(([name]) => name.toUpperCase() !== 'PATH'))
  return {
    ...withoutPath,
    PATH: [commandDirectory, ...(path === undefined ? [] : [path])].join(delimiter),
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function batchQuote(value: string): string {
  return `"${value.replaceAll('%', '%%')}"`
}

function appendOutput(current: string, chunk: Uint8Array): string {
  const combined = current + Buffer.from(chunk).toString('utf8')
  return combined.length <= MAX_ERROR_OUTPUT ? combined : combined.slice(-MAX_ERROR_OUTPUT)
}

async function installWithBundledPnpm(directory: string): Promise<void> {
  const require = createRequire(import.meta.url)
  const pnpmManifest = require.resolve('pnpm')
  const pnpmBin = join(dirname(pnpmManifest), 'bin', 'pnpm.mjs')
  const commandDirectory = await mkdtemp(join(tmpdir(), 'cordis-repository-pnpm-'))
  try {
    await Promise.all([
      writeFile(join(commandDirectory, 'pnpm'), [
        '#!/bin/sh',
        `exec ${shellQuote(process.execPath)} ${shellQuote(pnpmBin)} --ignore-workspace "$@"`,
        '',
      ].join('\n'), { mode: 0o700 }),
      writeFile(join(commandDirectory, 'pnpm.cmd'), [
        '@echo off',
        `${batchQuote(process.execPath)} ${batchQuote(pnpmBin)} --ignore-workspace %*`,
        '',
      ].join('\r\n'), { mode: 0o700 }),
    ])
    let output = ''
    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      const child = spawn(process.execPath, [
        pnpmBin,
        'install',
        '--no-frozen-lockfile',
        '--reporter=append-only',
      ], {
        cwd: directory,
        env: installEnvironment(commandDirectory),
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      child.stdout.on('data', (chunk: Uint8Array) => { output = appendOutput(output, chunk) })
      child.stderr.on('data', (chunk: Uint8Array) => { output = appendOutput(output, chunk) })
      child.once('error', reject)
      child.once('close', (code, signal) => { resolve({ code, signal }) })
    })
    if (result.signal !== null) {
      throw new Error(`bundled pnpm install was killed by ${result.signal}${output ? `\n${output.trimEnd()}` : ''}`)
    }
    if (result.code !== 0) {
      throw new Error(`bundled pnpm install exited with code ${String(result.code)}${output ? `\n${output.trimEnd()}` : ''}`)
    }
  } finally {
    await rm(commandDirectory, { recursive: true, force: true })
  }
}

function cacheKey(specifier: string): string {
  return createHash('sha256').update(specifier).digest('hex')
}

async function readCached(directory: string, specifier: string): Promise<string | undefined> {
  let content: string
  try {
    content = await readFile(join(directory, MARKER_NAME), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(content) as unknown
  } catch (error) {
    throw new Error(`repository cache marker is invalid: ${join(directory, MARKER_NAME)}`, { cause: error })
  }
  if (typeof parsed !== 'object' || parsed === null || typeof (parsed as Partial<CacheMarker>).specifier !== 'string') {
    throw new Error(`repository cache marker is invalid: ${join(directory, MARKER_NAME)}`)
  }
  const marker = parsed as CacheMarker
  if (marker.specifier !== specifier) {
    throw new Error(`repository cache key collision for ${JSON.stringify(specifier)}`)
  }
  const packageDirectory = join(directory, 'node_modules', DEPENDENCY_NAME)
  let packageStat
  try {
    packageStat = await stat(packageDirectory)
  } catch (error) {
    throw new Error(`repository cache entry is incomplete: ${directory}`, { cause: error })
  }
  if (!packageStat.isDirectory()) throw new Error(`repository cache package is not a directory: ${packageDirectory}`)
  return packageDirectory
}

async function removeStaging(directory: string, cause: unknown): Promise<never> {
  try {
    await rm(directory, { recursive: true, force: true })
  } catch (cleanupError) {
    throw new AggregateError([cause, cleanupError], `failed to clean repository staging directory ${directory}`)
  }
  throw cause
}

/**
 * Persistent exact-specifier package cache backed by bundled pnpm.
 *
 * One isolated project contains one dependency named `repository`. A successful
 * install is atomically renamed into its SHA-256 key, so failed installs never
 * become cache hits. The exact specifier is immutable: callers change the
 * specifier (normally its Git ref) to request another generation.
 */
export class RepositoryCache {
  /** Absolute directory containing immutable repository cache entries. */
  readonly directory: string

  private readonly tasks = new Map<string, Promise<string>>()
  private readonly install: RepositoryInstall

  /**
   * @param directory - caller-owned persistent cache root.
   * @param options - isolated installer override.
   */
  constructor(directory: string, options: RepositoryCacheOptions = {}) {
    this.directory = resolve(directory)
    this.install = options.install ?? installWithBundledPnpm
  }

  /**
   * Resolve one package-manager-native dependency specifier to its installed package directory.
   * @param specifier - exact immutable dependency specifier used as the permanent cache identity.
   * @returns the installed `repository` dependency directory.
   * @throws when the specifier is empty/padded, installation fails, or a published cache entry is corrupt.
   */
  resolve(specifier: string): Promise<string> {
    if (!specifier || specifier.trim() !== specifier) {
      throw new TypeError('repository specifier must be a non-empty unpadded string')
    }
    const existing = this.tasks.get(specifier)
    if (existing) return existing
    const task = this.resolveUncached(specifier).finally(() => {
      if (this.tasks.get(specifier) === task) this.tasks.delete(specifier)
    })
    this.tasks.set(specifier, task)
    return task
  }

  private async resolveUncached(specifier: string): Promise<string> {
    const finalDirectory = join(this.directory, cacheKey(specifier))
    const cached = await readCached(finalDirectory, specifier)
    if (cached) return cached

    await mkdir(this.directory, { recursive: true })
    const staging = await mkdtemp(join(this.directory, '.repository-'))
    try {
      await writeFile(join(staging, 'package.json'), `${JSON.stringify({
        name: 'cordis-repository-cache-entry',
        private: true,
        version: '0.0.0',
        packageManager: `pnpm@${BUNDLED_PNPM_VERSION}`,
        dependencies: { [DEPENDENCY_NAME]: specifier },
      }, undefined, 2)}\n`)
      await writeFile(join(staging, 'pnpm-workspace.yaml'), [
        'packages: []',
        'dangerouslyAllowAllBuilds: true',
        '',
      ].join('\n'))
      await this.install(staging)
      const packageDirectory = join(staging, 'node_modules', DEPENDENCY_NAME)
      const packageStat = await stat(packageDirectory)
      if (!packageStat.isDirectory()) throw new Error(`installed repository is not a directory: ${packageDirectory}`)
      await writeFile(join(staging, MARKER_NAME), `${JSON.stringify({ specifier })}\n`)
      try {
        await rename(staging, finalDirectory)
      } catch (error) {
        const winner = await readCached(finalDirectory, specifier)
        if (!winner) throw error
        await rm(staging, { recursive: true, force: true })
        return winner
      }
    } catch (error) {
      return removeStaging(staging, new Error(`failed to prepare repository ${JSON.stringify(specifier)}`, { cause: error }))
    }
    return (await readCached(finalDirectory, specifier))!
  }
}
