import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BUNDLED_PNPM_VERSION, RepositoryCache, type RepositoryInstall } from '@huiliyi37/cordis-plugin-loader/repository'

const execFileAsync = promisify(execFile)
const roots: string[] = []

async function temporaryRoot(name: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `cordis-${name}-`))
  roots.push(root)
  return root
}

async function fakePackage(directory: string): Promise<void> {
  const target = join(directory, 'node_modules', 'repository')
  await mkdir(target, { recursive: true })
  await writeFile(join(target, 'package.json'), '{"name":"fixture"}\n')
}

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('RepositoryCache', () => {
  it('single-flights and permanently reuses an exact specifier', async () => {
    const root = await temporaryRoot('repository-cache')
    const calls: Array<string> = []
    const install: RepositoryInstall = async (directory) => {
      calls.push(directory)
      await fakePackage(directory)
    }
    const cache = new RepositoryCache(root, { install })
    const specifier = 'github:owner/repository#0123456789abcdef'

    const [first, concurrent] = await Promise.all([cache.resolve(specifier), cache.resolve(specifier)])
    expect(concurrent).toBe(first)
    expect(calls).toHaveLength(1)

    const reopened = new RepositoryCache(root, { install: async () => { throw new Error('cache miss') } })
    expect(await reopened.resolve(specifier)).toBe(first)
    expect(JSON.parse(await readFile(join(first, '..', '..', 'package.json'), 'utf8'))).toMatchObject({
      packageManager: `pnpm@${BUNDLED_PNPM_VERSION}`,
      dependencies: { repository: specifier },
    })

    const second = await cache.resolve('github:owner/repository#fedcba9876543210')
    expect(second).not.toBe(first)
    expect(calls).toHaveLength(2)
  })

  it('accepts the valid winner when independent cache instances race', async () => {
    const root = await temporaryRoot('repository-race')
    const bothStarted = Promise.withResolvers<undefined>()
    let starts = 0
    const install: RepositoryInstall = async (directory) => {
      await fakePackage(directory)
      starts += 1
      if (starts === 2) bothStarted.resolve(undefined)
      await bothStarted.promise
    }
    const specifier = 'github:owner/repository#race'

    const [first, second] = await Promise.all([
      new RepositoryCache(root, { install }).resolve(specifier),
      new RepositoryCache(root, { install }).resolve(specifier),
    ])

    expect(second).toBe(first)
    expect(starts).toBe(2)
    expect(await readdir(root)).toHaveLength(1)
  })

  it('removes a failed staging tree and permits an exact retry', async () => {
    const root = await temporaryRoot('repository-retry')
    let attempts = 0
    const cache = new RepositoryCache(root, { install: async (directory) => {
      attempts += 1
      if (attempts === 1) throw new Error('install failed')
      await fakePackage(directory)
    } })

    await expect(cache.resolve('github:owner/repository#ref')).rejects.toThrow('failed to prepare repository')
    expect(await readdir(root)).toEqual([])
    await expect(cache.resolve('github:owner/repository#ref')).resolves.toContain('node_modules')
    expect(attempts).toBe(2)
  })

  it('rejects empty or padded specifiers before touching the cache', async () => {
    const root = await temporaryRoot('repository-input')
    const cache = new RepositoryCache(root, { install: fakePackage })
    expect(() => cache.resolve('')).toThrow('non-empty unpadded string')
    expect(() => cache.resolve(' github:owner/repository#ref')).toThrow('non-empty unpadded string')
    await expect(readdir(root)).resolves.toEqual([])
  })

  it('fails loud on a corrupt published marker instead of reinstalling it', async () => {
    const root = await temporaryRoot('repository-corrupt')
    const specifier = 'github:owner/repository#corrupt'
    const key = createHash('sha256').update(specifier).digest('hex')
    const entry = join(root, key)
    await mkdir(join(entry, 'node_modules', 'repository'), { recursive: true })
    await writeFile(join(entry, '.repository-cache.json'), '{}\n')
    const cache = new RepositoryCache(root, { install: async () => { throw new Error('must not reinstall') } })

    await expect(cache.resolve(specifier)).rejects.toThrow('repository cache marker is invalid')
  })

  it('isolates and prepares a .dsh-plugin Git subpath from an enclosing pnpm workspace', { timeout: 60_000 }, async () => {
    const root = await temporaryRoot('repository-pnpm')
    const repository = join(root, 'source')
    await mkdir(join(repository, '.dsh-plugin'), { recursive: true })
    await mkdir(join(repository, 'build-helper'), { recursive: true })
    await mkdir(join(repository, 'prepare-helper'), { recursive: true })
    await mkdir(join(repository, 'skills', 'fixture'), { recursive: true })
    await writeFile(join(repository, 'package.json'), `${JSON.stringify({
      name: 'repository-fixture',
      private: true,
      version: '1.0.0',
      packageManager: `pnpm@${BUNDLED_PNPM_VERSION}`,
    })}\n`)
    await writeFile(join(repository, 'pnpm-workspace.yaml'), 'packages: []\n')
    await writeFile(join(repository, 'pnpm-lock.yaml'), [
      "lockfileVersion: '9.0'",
      'settings:',
      '  autoInstallPeers: true',
      '  excludeLinksFromLockfile: false',
      'importers:',
      '  .: {}',
      '',
    ].join('\n'))
    await writeFile(join(repository, 'build-helper', 'package.json'), `${JSON.stringify({
      name: 'repository-build-helper',
      version: '1.0.0',
      bin: 'index.js',
    })}\n`)
    await writeFile(join(repository, 'build-helper', 'index.js'), [
      '#!/usr/bin/env node',
      "require('node:fs').writeFileSync('dependency-built.txt', 'dependency available\\n')",
      '',
    ].join('\n'), { mode: 0o700 })
    await writeFile(join(repository, 'prepare-helper', 'package.json'), `${JSON.stringify({
      name: 'repository-prepare-helper',
      version: '1.0.0',
      bin: { 'dsh-plugin-prepare': 'index.js' },
    })}\n`)
    await writeFile(join(repository, 'prepare-helper', 'index.js'), [
      '#!/usr/bin/env node',
      "const { cpSync, mkdirSync, writeFileSync } = require('node:fs')",
      "mkdirSync('dsh-plugin-assets/skills', { recursive: true })",
      "cpSync('../skills', 'dsh-plugin-assets/skills/0', { recursive: true })",
      "writeFileSync('dsh-plugin.mjs', 'export function apply() {}\\n')",
      "writeFileSync('prepared.txt', `${process.env.REPOSITORY_TEST_VISIBLE ?? 'absent'}|${process.env.REPOSITORY_TEST_TOKEN ?? 'absent'}\\n`)",
      '',
    ].join('\n'), { mode: 0o700 })
    await writeFile(join(repository, 'skills', 'fixture', 'SKILL.md'), 'repository skill source\n')
    await writeFile(join(repository, '.dsh-plugin', 'package.json'), `${JSON.stringify({
      name: 'repository-plugin-fixture',
      version: '1.0.0',
      scripts: { prepack: 'repository-build-helper && dsh-plugin-prepare' },
      devDependencies: {
        'repository-build-helper': 'file:../build-helper',
        'repository-prepare-helper': 'file:../prepare-helper',
      },
      dsh: { skills: ['../skills'] },
    })}\n`)
    await execFileAsync('git', ['init', '--quiet'], { cwd: repository })
    await execFileAsync('git', ['add', '.'], { cwd: repository })
    await execFileAsync('git', [
      '-c', 'user.name=Repository Fixture',
      '-c', 'user.email=repository@example.invalid',
      'commit', '--quiet', '-m', 'fixture',
    ], { cwd: repository })
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' })
    const specifier = `git+${pathToFileURL(repository).href}#${stdout.trim()}&path:/.dsh-plugin`
    vi.stubEnv('REPOSITORY_TEST_VISIBLE', 'visible')
    vi.stubEnv('REPOSITORY_TEST_TOKEN', 'hidden')

    const installed = await new RepositoryCache(join(root, 'cache')).resolve(specifier)
    await expect(readFile(join(installed, 'dependency-built.txt'), 'utf8')).resolves.toBe('dependency available\n')
    await expect(readFile(join(installed, 'prepared.txt'), 'utf8')).resolves.toBe('visible|absent\n')
    await expect(readFile(join(installed, 'dsh-plugin.mjs'), 'utf8')).resolves.toContain('export function apply')
    await expect(readFile(join(installed, 'dsh-plugin-assets/skills/0/fixture/SKILL.md'), 'utf8'))
      .resolves.toBe('repository skill source\n')
    await expect(readFile(join(installed, 'package.json'), 'utf8'))
      .resolves.toContain('repository-plugin-fixture')
  })
})
