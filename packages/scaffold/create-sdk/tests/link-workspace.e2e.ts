import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import {
  LocalPluginBlueprint,
  featureId,
  createPackageManager,
  type PackageManagerName,
} from '@deepseek-ai/dsh-helper'
import { scrubEnvironment } from '../../helper/src/package-managers/package-manager.ts'
import { scaffoldProject } from '../src/project-scaffolder.ts'

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const builtScripts = join(repoRoot, 'packages/scaffold/scripts/lib/bin.js')
const temporary: string[] = []

function resolveCorepackHome(): string {
  return process.env.COREPACK_HOME ?? join(
    process.env.XDG_CACHE_HOME
      ?? process.env.LOCALAPPDATA
      ?? join(homedir(), process.platform === 'win32' ? 'AppData/Local' : '.cache'),
    'node/corepack',
  )
}

afterEach(async () => {
  await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function managerVersion(name: PackageManagerName): Promise<string | undefined> {
  try {
    return (await execFileAsync(name, ['--version'], { encoding: 'utf8' })).stdout.trim()
  } catch {
    // An unavailable optional manager skips only its own live-link case.
    return undefined
  }
}

const managers: Array<PackageManagerName> = ['npm', 'pnpm', 'yarn']

describe.skipIf(!existsSync(builtScripts))('live-linked generated projects', () => {
  for (const name of managers) {
    it(`${name}: installs the local closure and resolves plugin TypeScript in dev`, async (context) => {
      const version = await managerVersion(name)
      if (!version) {
        context.skip()
        return
      }
      const parent = await mkdtemp(join(tmpdir(), `dsh-link-${name}-`))
      const root = join(parent, 'project')
      temporary.push(parent)
      const manager = createPackageManager(name, version)
      await scaffoldProject(root, {
        name: `linked-${name}`,
        description: 'link e2e',
        runtime: { model: 'deepseek-v4-flash' },
        packageManager: manager,
        releaseVersion: '0.0.1',
        linkWorkspaceRoot: repoRoot,
        features: [
          { id: featureId('provider'), options: ['deepseek-official'], secrets: { apiKey: 'test-key' } },
          { id: featureId('bash'), options: ['local'] },
          { id: featureId('app'), options: ['embed'] },
          { id: featureId('persistence'), options: ['jsonl'] },
        ],
        localPlugins: [new LocalPluginBlueprint('probe', 'plugin')],
      })
      await writeFile(join(root, 'plugins/probe/src/index.ts'), `
        import { writeFileSync } from 'node:fs'
        import type { Context } from 'cordis'
        export const name = 'probe'
        export function apply(_ctx: Context): void {
          writeFileSync(new URL('../../../plugin-loaded', import.meta.url), 'loaded\\n')
        }
      `)
      const cacheRoot = join(tmpdir(), 'dsh-sdk-link-cache', name)
      const pnpmStore = name === 'pnpm'
        ? (await execFileAsync(name, ['store', 'path', '--silent'], { encoding: 'utf8' })).stdout.trim()
        : undefined
      const commandEnvironment = {
        ...scrubEnvironment(),
        COREPACK_HOME: resolveCorepackHome(),
        ...name === 'pnpm' ? {} : { XDG_CACHE_HOME: join(cacheRoot, 'cache') },
        XDG_DATA_HOME: join(cacheRoot, 'data'),
        npm_config_cache: join(cacheRoot, 'npm'),
        ...pnpmStore === undefined ? {} : { pnpm_config_store_dir: pnpmStore },
        // A generated project has no lockfile yet; ambient CI must not make its first Yarn install immutable.
        ...name === 'yarn' ? { YARN_ENABLE_IMMUTABLE_INSTALLS: 'false' } : {},
      }
      await execFileAsync(name, manager.installCommand(), {
        cwd: root,
        env: commandEnvironment,
        encoding: 'utf8',
        timeout: 120_000,
      })
      await execFileAsync(name, manager.buildCommand(), {
        cwd: root,
        env: commandEnvironment,
        encoding: 'utf8',
        timeout: 120_000,
      })
      expect(existsSync(join(root, 'index.js'))).toBe(true)
      expect(existsSync(join(root, 'plugins/probe/lib/index.js'))).toBe(true)
      const dshSdk = join(root, 'node_modules/@deepseek-ai/dsh-scripts/lib/bin.js')
      const run = await execFileAsync(process.execPath, [dshSdk, 'dev', 'index.ts'], {
        cwd: root,
        env: { ...commandEnvironment, DEEPSEEK_API_KEY: 'test-key' },
        encoding: 'utf8',
        timeout: 30_000,
      })
      expect(run.stderr).not.toContain('without inject')
      expect(await readFile(join(root, 'plugin-loaded'), 'utf8')).toBe('loaded\n')
      const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
        dependencies: Record<string, string>
      }
      expect(manifest.dependencies.cordis).toMatch(name === 'npm' ? /^file:/ : name === 'pnpm' ? /^link:/ : /^portal:/)
      expect(manifest.dependencies).not.toHaveProperty('node-addon-require-builtin')
    }, 180_000)
  }
})
