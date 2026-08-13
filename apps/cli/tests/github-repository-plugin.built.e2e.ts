import { createHash } from 'node:crypto'
import { cpSync, existsSync, globSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startMockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const dshBin = join(repoRoot, 'apps/cli/lib/bin.js')
const repositoryPluginPackage = join(repoRoot, 'packages/self-modification/repository-plugin')
const releasePackageNames = new Set(globSync([
  'vendor/*/package.json',
  'packages/*/*/package.json',
  'apps/*/package.json',
], { cwd: repoRoot }).map((filename) => {
  const manifest = JSON.parse(readFileSync(join(repoRoot, filename), 'utf8')) as Record<string, unknown>
  if (typeof manifest.name !== 'string') throw new Error(`workspace package name is missing: ${filename}`)
  return manifest.name
}))
const source = process.env.DSH_GITHUB_REPOSITORY_PLUGIN_SOURCE
const required = process.env.DSH_REQUIRE_GITHUB_REPOSITORY_PLUGIN_E2E === '1'
const enabled = required || source !== undefined

interface PublishedPackageRegistry {
  url: string
  requests: string[]
  close(): Promise<void>
}

function publishedManifest(): Record<string, unknown> {
  const manifest = JSON.parse(readFileSync(join(repositoryPluginPackage, 'package.json'), 'utf8')) as Record<string, unknown>
  const version = manifest.version
  if (typeof version !== 'string') throw new Error('repository Plugin package version is missing')
  Reflect.deleteProperty(manifest, 'private')
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    const dependencies = manifest[field]
    if (typeof dependencies !== 'object' || dependencies === null || Array.isArray(dependencies)) continue
    const entries = dependencies as Record<string, unknown>
    for (const name of Object.keys(entries)) {
      if (releasePackageNames.has(name)) {
        entries[name] = version
      }
    }
  }
  return manifest
}

async function startPublishedPackageRegistry(root: string): Promise<PublishedPackageRegistry> {
  const staging = join(root, 'published-repository-plugin')
  const artifacts = join(root, 'npm-registry-artifacts')
  mkdirSync(staging)
  mkdirSync(artifacts)
  cpSync(join(repositoryPluginPackage, 'lib'), join(staging, 'lib'), { recursive: true })
  for (const filename of ['README.md', 'README.zh.md', 'README.i18n.yaml']) {
    cpSync(join(repositoryPluginPackage, filename), join(staging, filename))
  }
  cpSync(join(repoRoot, 'LICENSE'), join(staging, 'LICENSE'))
  const manifest = publishedManifest()
  writeFileSync(join(staging, 'package.json'), `${JSON.stringify(manifest, undefined, 2)}\n`)
  const packed = await execa('pnpm', ['pack', '--pack-destination', artifacts], {
    cwd: staging,
    reject: false,
  })
  if (packed.exitCode !== 0) {
    throw new Error(`failed to pack the simulated published prepare package:\n${packed.stderr}\n${packed.stdout}`)
  }
  const tarballs = readdirSync(artifacts).filter(filename => filename.endsWith('.tgz'))
  if (tarballs.length !== 1) throw new Error(`expected one simulated published tarball, found ${tarballs.length}`)
  const tarball = readFileSync(join(artifacts, tarballs[0]!))
  const name = manifest.name as string
  const version = manifest.version as string
  const requests: string[] = []
  let registryUrl = ''
  const server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? '/', registryUrl).pathname)
    requests.push(`${request.method ?? 'GET'} ${path}`)
    if (path === `/${name}`) {
      const metadata = {
        name,
        'dist-tags': { latest: version },
        versions: {
          [version]: {
            ...manifest,
            dist: {
              tarball: `${registryUrl}${name}/-/${name.split('/').at(-1)}-${version}.tgz`,
              shasum: createHash('sha1').update(tarball).digest('hex'),
              integrity: `sha512-${createHash('sha512').update(tarball).digest('base64')}`,
            },
          },
        },
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(metadata))
      return
    }
    if (path === `/${name}/-/${name.split('/').at(-1)}-${version}.tgz`) {
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': String(tarball.length),
      })
      response.end(tarball)
      return
    }
    response.writeHead(404, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: 'not found' }))
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('simulated npm registry did not expose a TCP address')
  registryUrl = `http://127.0.0.1:${address.port}/`
  return {
    url: registryUrl,
    requests,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => { if (error === undefined) resolve(); else reject(error) })
    }),
  }
}

describe.skipIf(!enabled)('dsh run GitHub repository Plugin installation', () => {
  it('installs the published prepare dependency, then builds and runs skill, MCP, and TypeScript Plugin contributions from a private exact GitHub source', async () => {
    expect(existsSync(dshBin), 'the repository Plugin acceptance must run the built dsh entry').toBe(true)
    expect(source, 'DSH_GITHUB_REPOSITORY_PLUGIN_SOURCE is required by this CI lane').toMatch(
      /^github:[^/\s#&]+\/[^/\s#&]+#[0-9a-f]{40}&path:\/.*\/\.dsh-plugin$/u,
    )

    const apiKey = 'github-repository-plugin-e2e-key'
    const server = await startMockLlmServer({
      sequence: ['tool_call_success', 'success'],
      apiKey,
      toolName: 'mcp__github_repository__proof',
      toolArguments: '{}',
      successText: 'trusted GitHub repository package reached dsh run',
    })
    const home = mkdtempSync(join(tmpdir(), 'dsh-github-repository-plugin-'))
    const registry = await startPublishedPackageRegistry(home)
    const npmrc = join(home, 'npmrc')
    writeFileSync(npmrc, `@deepseek-ai:registry=${registry.url}\n`)
    const hostBin = join(home, 'host-bin')
    mkdirSync(hostBin)
    writeFileSync(join(hostBin, 'dsh-plugin-prepare'), [
      '#!/bin/sh',
      'echo "host PATH supplied dsh-plugin-prepare instead of the declared npm dependency" >&2',
      'exit 91',
      '',
    ].join('\n'), { mode: 0o700 })
    const patch = join(home, 'github-repository-plugin.cordis.patch.yml')
    writeFileSync(patch, [
      '- id: repository-plugins',
      '  config:',
      '    repositories:',
      `      - ${JSON.stringify(source)}`,
      '- id: session-title-llm',
      '  disabled: true',
      '',
    ].join('\n'))

    try {
      const result = await execa(process.execPath, [
        dshBin,
        'run',
        '--patch',
        patch,
        'prove the private GitHub repository Plugin is active',
      ], {
        cwd: repoRoot,
        input: '',
        timeout: 180_000,
        killSignal: 'SIGKILL',
        reject: false,
        env: {
          ...process.env,
          DSH_HOME: home,
          DSH_TELEMETRY_DISABLED: '1',
          DEEPSEEK_API_KEY: apiKey,
          DEEPSEEK_BASE_URL: server.baseURL,
          NPM_CONFIG_USERCONFIG: npmrc,
          // A warm runner cache could satisfy the exact tarball without
          // contacting this test's registry, which would stop proving the
          // unpublished package was installed through the simulated release.
          PNPM_CONFIG_CACHE_DIR: join(home, 'pnpm-cache'),
          PNPM_CONFIG_STORE_DIR: join(home, 'pnpm-store'),
          PATH: process.env.PATH === undefined ? hostBin : `${hostBin}${delimiter}${process.env.PATH}`,
        },
      })
      if (result.timedOut) {
        throw new Error(`dsh GitHub repository Plugin run did not exit within 180s. stdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
      }
      expect(result.exitCode, `${result.stderr}\nstdout:\n${result.stdout}`).toBe(0)
      expect(result.stdout).toBe('trusted GitHub repository package reached dsh run')
      expect(server.requests).toHaveLength(2)
      const runtimeDiagnostic = `${result.stderr}\nstdout:\n${result.stdout}`
      expect(registry.requests, runtimeDiagnostic).toContain('GET /@deepseek-ai/dsh-repository-plugin')
      expect(registry.requests, runtimeDiagnostic).toContain('GET /@deepseek-ai/dsh-repository-plugin/-/dsh-repository-plugin-0.0.1.tgz')
      const firstRequest = JSON.stringify(server.requests[0]!.body)
      const secondRequest = JSON.stringify(server.requests[1]!.body)
      expect(firstRequest, runtimeDiagnostic).toContain(
        'Proves that dsh installed a private repository Plugin from an exact GitHub source.',
      )
      expect(firstRequest, runtimeDiagnostic).toContain('mcp__github_repository__proof')
      expect(firstRequest, runtimeDiagnostic).toContain('Proves that an MCP server compiled from the exact GitHub repository package is active.')
      expect(secondRequest, runtimeDiagnostic).toContain('MCP_FROM_GITHUB_REPOSITORY')
      expect(secondRequest, runtimeDiagnostic).toContain('TS_PLUGIN_FROM_GITHUB_REPOSITORY')

      const cacheRoot = join(home, 'cache', 'repository-plugins')
      const generations = readdirSync(cacheRoot, { withFileTypes: true }).filter(entry => entry.isDirectory())
      expect(generations).toHaveLength(1)
      const installed = join(cacheRoot, generations[0]!.name, 'node_modules', 'repository')
      const manifest = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8')) as Record<string, unknown>
      expect(manifest).toMatchObject({
        name: 'dsh-github-repository-plugin-e2e-fixture',
        private: true,
        scripts: {
          prepack: 'tsc --noEmit && tsdown src/plugin.ts src/mcp-server.ts --no-config --tsconfig tsconfig.json --out-dir lib --platform node --target es2024 --clean && dsh-plugin-prepare',
        },
        dsh: {
          skills: ['../skills'],
          mcpServers: './.mcp.json',
          entry: './lib/plugin.mjs',
        },
        dependencies: {
          '@modelcontextprotocol/sdk': '1.29.0',
        },
        devDependencies: {
          '@deepseek-ai/dsh-repository-plugin': '0.0.1',
          cordis: '4.0.0-rc.7',
          tsdown: '0.22.2',
          typescript: '6.0.3',
        },
      })
      expect(readFileSync(join(installed, 'dsh-plugin-assets/skills/0/github-source-proof/SKILL.md'), 'utf8'))
        .toContain('This skill exists only in the GitHub repository source fixture.')
      expect(readFileSync(join(installed, 'dsh-plugin-assets/.mcp.json'), 'utf8')).toContain('lib/mcp-server.mjs')
      expect(readFileSync(join(installed, 'lib/plugin.mjs'), 'utf8')).toContain('TS_PLUGIN_FROM_GITHUB_REPOSITORY')
      expect(readFileSync(join(installed, 'lib/mcp-server.mjs'), 'utf8')).toContain('MCP_FROM_GITHUB_REPOSITORY')
      expect(existsSync(join(installed, 'src'))).toBe(false)
      const installedRequire = createRequire(join(installed, 'lib/mcp-server.mjs'))
      expect(existsSync(installedRequire.resolve('@modelcontextprotocol/sdk/server/mcp.js'))).toBe(true)
      const wrapper = readFileSync(join(installed, 'dsh-plugin.mjs'), 'utf8')
      expect(wrapper).toContain('dsh-repository-plugin')
      expect(wrapper).toContain('await import(manifest.entry)')
      expect(wrapper).toContain('"entry":"./lib/plugin.mjs"')
    } finally {
      await server.close()
      await registry.close()
      rmSync(home, { recursive: true, force: true })
    }
  }, 190_000)
})
