import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@huiliyi37/cordis'
import { FileSystem, FsVersion } from '@huiliyi37/dsh-fs'
import type { FsDirEntry, FsInfo, FsTarget } from '@huiliyi37/dsh-fs'
import AgentDefinitionService from '../src/index.ts'
import type { Config } from '../src/index.ts'

async function tempDir(name: string): Promise<string> {
  return await mkdtemp(join(tmpdir(), `dsh-${name}-`))
}

async function writeAgent(root: string, fileName: string, content: string): Promise<void> {
  await mkdir(root, { recursive: true })
  await writeFile(join(root, fileName), content)
}

function roleFile(name: string, description: string, extra = '', body = 'Role instructions.'): string {
  return `---\nname: ${name}\ndescription: ${description}\n${extra}---\n\n${body}\n`
}

async function setup(home: string, config: Config = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(AgentDefinitionService, {
    dshHome: join(home, '.dsh'),
    agentsHome: join(home, '.agents'),
    watch: false,
    ...config,
  })
  return ctx
}

/** Minimal in-memory-passthrough filesystem service: proves discovery reads through `ctx.fs` when present. */
class PassthroughFileSystem extends FileSystem {
  readonly listDirCalls: string[] = []

  override async resolve(path: string): Promise<FsTarget> {
    return { targetKey: path as never, displayPath: path }
  }

  override processPath(target: FsTarget): string { return String(target.targetKey) }

  override fileUrl(target: FsTarget): string { return `file://${target.targetKey}` }

  override contains(parent: FsTarget, child: FsTarget): boolean {
    return child.targetKey === parent.targetKey || String(child.targetKey).startsWith(`${parent.targetKey}/`)
  }

  override async stat(target: FsTarget): Promise<FsInfo | undefined> {
    try {
      const fs = await import('node:fs/promises')
      const info = await fs.stat(target.displayPath)
      return {
        version: FsVersion(String(info.mtimeMs)),
        type: info.isFile() ? 'file' : info.isDirectory() ? 'directory' : 'other',
        size: info.size,
      }
    } catch {
      return undefined
    }
  }

  override async lstat(path: string) {
    try {
      const fs = await import('node:fs/promises')
      const info = await fs.lstat(path)
      return {
        version: FsVersion(String(info.mtimeMs)),
        type: info.isSymbolicLink() ? 'symlink' as const : info.isFile() ? 'file' as const : info.isDirectory() ? 'directory' as const : 'other' as const,
        size: info.size,
      }
    } catch {
      return undefined
    }
  }

  override async readText(target: FsTarget): Promise<string> {
    const fs = await import('node:fs/promises')
    return await fs.readFile(target.displayPath, 'utf8')
  }

  override async streamText(): Promise<AsyncIterable<string>> {
    throw new Error('not needed in agent-definition tests')
  }

  override async listDir(target: FsTarget): Promise<FsDirEntry[]> {
    this.listDirCalls.push(target.displayPath)
    const fs = await import('node:fs/promises')
    const entries = await fs.readdir(target.displayPath, { withFileTypes: true, encoding: 'utf8' })
    return entries.map(entry => ({
      name: entry.name,
      type: entry.isDirectory() ? 'directory' as const : entry.isFile() ? 'file' as const : 'other' as const,
      target: { targetKey: join(target.displayPath, entry.name) as never, displayPath: join(target.displayPath, entry.name) },
      version: FsVersion('test'),
    }))
  }

  override async writeText(): Promise<never> {
    throw new Error('not needed in agent-definition tests')
  }

  override async editText(): Promise<never> {
    throw new Error('not needed in agent-definition tests')
  }
}

describe('dsh-agent-definitions', () => {
  it('discovers flat role files across ranked roots with first-wins duplicates', async () => {
    const home = await tempDir('agents-home')
    const project = await tempDir('agents-project')
    const custom = await tempDir('agents-custom')
    await mkdir(join(project, '.git'), { recursive: true })
    await writeAgent(join(project, '.dsh/agents'), 'shared.md', roleFile('shared', 'from project-dsh'))
    await writeAgent(join(project, '.agents/agents'), 'shared.md', roleFile('shared', 'from project-agents'))
    await writeAgent(join(project, '.agents/agents'), 'proj-two.md', roleFile('proj-two', 'project agents role'))
    await writeAgent(join(home, '.dsh/agents'), 'shared.md', roleFile('shared', 'from user-dsh'))
    await writeAgent(join(home, '.dsh/agents'), 'user-role.md', roleFile('user-role', 'user role'))
    await writeAgent(custom, 'shared.md', roleFile('shared', 'from custom'))
    await writeAgent(custom, 'custom-role.md', roleFile('custom-role', 'custom role'))
    const ctx = await setup(home, { customAgentDirs: [custom], builtinExplore: false })

    // A cwd BELOW the project root still selects the project's roots.
    const list = await ctx.agentDefinitions.list({ cwd: join(project, 'src/nested') })
    expect(list.map(entry => `${entry.name}:${entry.source}`)).toEqual([
      'custom-role:custom',
      'proj-two:project-agents',
      'shared:project-dsh',
      'user-role:user-dsh',
      'verify:runtime',
    ])
  })

  it('runtime registrations sit between project and custom roots; duplicates are first-wins', async () => {
    const home = await tempDir('agents-runtime')
    const project = await tempDir('agents-runtime-project')
    await mkdir(join(project, '.git'), { recursive: true })
    await writeAgent(join(project, '.dsh/agents'), 'explore.md', roleFile('explore', 'project explore wins'))
    await writeAgent(join(home, '.dsh/agents'), 'explore.md', roleFile('explore', 'user explore loses'))
    const ctx = await setup(home)

    // Runtime (built-in explore) outranks the user root but loses to the project.
    const userList = await ctx.agentDefinitions.list()
    expect(userList.find(entry => entry.name === 'explore')?.description).not.toBe('user explore loses')
    const projectList = await ctx.agentDefinitions.list({ cwd: project })
    expect(projectList.find(entry => entry.name === 'explore')?.description).toBe('project explore wins')

    const duplicate = ctx.agentDefinitions.register({
      name: 'explore',
      description: 'duplicate ignored',
      content: 'Ignored body.',
    })
    expect((await ctx.agentDefinitions.get('explore', { cwd: project }))?.description).toBe('project explore wins')
    duplicate()
    expect(await ctx.agentDefinitions.list({ cwd: project })).toHaveLength(projectList.length)

    const added = ctx.agentDefinitions.register({
      name: 'reviewer',
      description: 'runtime reviewer',
      content: 'Review body.',
    })
    expect((await ctx.agentDefinitions.list()).map(entry => entry.name)).toContain('reviewer')
    added()
    expect((await ctx.agentDefinitions.list()).map(entry => entry.name)).not.toContain('reviewer')
  })

  it('parses tools and model frontmatter into the loaded definition only', async () => {
    const home = await tempDir('agents-fields')
    await writeAgent(join(home, '.dsh/agents'), 'scout.md', roleFile(
      'scout',
      'fielded role',
      'tools:\n  - grep\n  - read\nmodel: fast-model\n',
      'Persona body.',
    ))
    const ctx = await setup(home, { builtinExplore: false })

    const summary = (await ctx.agentDefinitions.list())[0]
    expect(summary).toEqual({
      name: 'scout',
      description: 'fielded role',
      source: 'user-dsh',
      path: join(home, '.dsh/agents/scout.md'),
    })
    expect(summary).not.toHaveProperty('tools')
    const definition = await ctx.agentDefinitions.get('scout')
    expect(definition).toMatchObject({
      name: 'scout',
      description: 'fielded role',
      tools: ['grep', 'read'],
      model: 'fast-model',
      content: 'Persona body.',
    })
  })

  it('skips invalid role files without failing discovery', async () => {
    const home = await tempDir('agents-invalid')
    const root = join(home, '.dsh/agents')
    await writeAgent(root, 'no-frontmatter.md', 'plain markdown\n')
    await writeAgent(root, 'no-description.md', '---\nname: no-description\n---\n\nBody.\n')
    await writeAgent(root, 'bad-name.md', roleFile('Bad_Name', 'invalid name'))
    await writeAgent(root, 'bad-tools.md', roleFile('bad-tools', 'bad tools', 'tools: not-an-array\n'))
    await writeAgent(root, 'good.md', roleFile('good', 'valid role'))
    await mkdir(join(root, 'nested'), { recursive: true })
    await writeAgent(join(root, 'nested'), 'ignored.md', roleFile('ignored', 'subdirectories are not scanned'))
    const ctx = await setup(home, { builtinExplore: false })

    expect((await ctx.agentDefinitions.list()).map(entry => entry.name)).toEqual(['good', 'verify'])
  })

  it('returns undefined for unknown and invalid names', async () => {
    const home = await tempDir('agents-unknown')
    const ctx = await setup(home)
    expect(await ctx.agentDefinitions.get('missing')).toBeUndefined()
    expect(await ctx.agentDefinitions.get('Not_A_Name')).toBeUndefined()
  })

  it('registers the built-in read-only explore role unless disabled', async () => {
    const home = await tempDir('agents-builtin')
    const ctx = await setup(home)
    const explore = await ctx.agentDefinitions.get('explore')
    expect(explore).toMatchObject({
      name: 'explore',
      source: 'runtime',
      sandbox: 'read-only',
    })
    expect(explore?.tools).toEqual(['grep', 'read', 'glob', 'semantic_search', 'bash'])
    expect(explore?.content).toContain('read-only')

    const off = await setup(await tempDir('agents-builtin-off'), { builtinExplore: false })
    expect(await off.agentDefinitions.get('explore')).toBeUndefined()
  })

  it('rejects invalid runtime registrations at the boundary', async () => {
    const home = await tempDir('agents-bad-register')
    const ctx = await setup(home, { builtinExplore: false })
    expect(() => ctx.agentDefinitions.register({ name: 'Bad', description: 'x', content: 'b' })).toThrow('invalid agent name')
    expect(() => ctx.agentDefinitions.register({ name: 'ok-name', description: '', content: 'b' })).toThrow('requires a description')
    expect(() => ctx.agentDefinitions.register({ name: 'ok-name', description: 'x', content: 'b', tools: [''] })).toThrow('tools')
  })

  it('invalidates the cached catalog on a first-party write under a retained root', async () => {
    const home = await tempDir('agents-observed')
    const root = join(home, '.dsh/agents')
    const ctx = await setup(home)
    expect((await ctx.agentDefinitions.list()).map(entry => entry.name)).toEqual(['explore', 'verify'])

    await writeAgent(root, 'observed.md', roleFile('observed', 'observed role'))
    // Without a watcher the cached catalog still serves the stale view…
    expect((await ctx.agentDefinitions.list()).map(entry => entry.name)).toEqual(['explore', 'verify'])
    // …until a first-party write/edit observation synchronously invalidates it.
    const path = join(root, 'observed.md')
    ctx.emit(
      'fs/observed',
      { targetKey: path as never, displayPath: path },
      { kind: 'present', version: FsVersion('observed') },
      { name: 'write' },
    )
    expect((await ctx.agentDefinitions.list()).map(entry => entry.name)).toEqual(['explore', 'observed', 'verify'])
    // Irrelevant actors and non-role paths do not invalidate.
    await writeAgent(root, 'notes.txt', 'not a role')
    ctx.emit(
      'fs/observed',
      { targetKey: join(root, 'notes.txt') as never, displayPath: join(root, 'notes.txt') },
      { kind: 'present', version: FsVersion('observed') },
      { name: 'write' },
    )
    expect((await ctx.agentDefinitions.list()).map(entry => entry.name)).toEqual(['explore', 'observed', 'verify'])
  })

  it('reads through the filesystem service when one is present', async () => {
    const home = await tempDir('agents-fs')
    const custom = await tempDir('agents-fs-custom')
    await writeAgent(custom, 'via-fs.md', roleFile('via-fs', 'fs-backed role', '', 'Fs body.'))
    const ctx = await setup(home, { customAgentDirs: [custom], builtinExplore: false })
    await ctx.plugin(PassthroughFileSystem)
    const fs = ctx.fs as PassthroughFileSystem

    const list = await ctx.agentDefinitions.list()
    expect(list.map(entry => entry.name)).toEqual(['verify', 'via-fs'])
    expect(fs.listDirCalls).toContain(custom)
    expect((await ctx.agentDefinitions.get('via-fs'))?.content).toBe('Fs body.')
  })

  it('reports a complete snapshot on the happy path', async () => {
    const home = await tempDir('agents-snapshot')
    const ctx = await setup(home)
    const snapshot = await ctx.agentDefinitions.snapshot()
    expect(snapshot.complete).toBe(true)
    expect(snapshot.definitions.map(entry => entry.name)).toEqual(['explore', 'verify'])
  })
})
