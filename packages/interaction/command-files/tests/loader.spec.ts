/** Loader unit tests over real temp Markdown command files. */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { commandNameFromPath, loadCommandFiles } from '../src/loader.ts'

let roots: string[] = []

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

async function writeCommand(dir: string, rel: string, frontmatter: string, body: string): Promise<void> {
  const file = join(dir, rel)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, `---\n${frontmatter}\n---\n${body}`)
}

afterEach(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true })
  roots = []
})

describe('commandNameFromPath', () => {
  it('flattens nested directories with - and lowercases the stem', () => {
    expect(commandNameFromPath('git/log.md')).toBe('git-log')
    expect(commandNameFromPath('Foo.md')).toBe('foo')
    expect(commandNameFromPath('a/b/C.md')).toBe('a-b-c')
  })
})

describe('loadCommandFiles', () => {
  it('loads every valid command file from both layers', async () => {
    const userDir = await tempDir('cf-user-')
    await writeCommand(userDir, 'hello.md', 'description: Say hello', 'Hello $1')
    await writeCommand(userDir, 'git/log.md', 'description: Show the log\nimages: true', 'LOG $ARGUMENTS')

    const commands = await loadCommandFiles(userDir, '/nonexistent-project')
    expect([...commands.keys()].sort()).toEqual(['git-log', 'hello'])
    expect(commands.get('hello')).toMatchObject({
      name: 'hello', source: 'user', description: 'Say hello', body: 'Hello $1', images: false,
    })
    expect(commands.get('git-log')).toMatchObject({ images: true })
  })

  it('fails loud when a file is missing a non-empty frontmatter description', async () => {
    const userDir = await tempDir('cf-user-')
    await writeCommand(userDir, 'hello.md', 'foo: bar', 'Hello')
    await expect(loadCommandFiles(userDir, '/nonexistent')).rejects.toThrow(/missing a non-empty frontmatter description/)
  })

  it('fails loud on an invalid command name (leading digit) and reports the file', async () => {
    const userDir = await tempDir('cf-user-')
    await writeCommand(userDir, '1foo.md', 'description: bad', 'body')
    await expect(loadCommandFiles(userDir, '/nonexistent')).rejects.toThrow(/derives name "1foo" which must match/)
  })

  it('fails loud on a same-layer flattened-name collision', async () => {
    const userDir = await tempDir('cf-user-')
    await writeCommand(userDir, 'git-log.md', 'description: a', 'A')
    await writeCommand(userDir, 'git/log.md', 'description: b', 'B')
    await expect(loadCommandFiles(userDir, '/nonexistent')).rejects.toThrow(/duplicated in the user layer/)
  })

  it('fails loud when the frontmatter fence is malformed or YAML is invalid', async () => {
    const userDir = await tempDir('cf-user-')
    await writeFile(join(userDir, 'bad.md'), 'no fence here\n')
    await expect(loadCommandFiles(userDir, '/nonexistent')).rejects.toThrow(/must start with a YAML frontmatter fence/)

    await writeFile(join(userDir, 'bad.md'), '---\ndescription: [unclosed\n---\nbody')
    await expect(loadCommandFiles(userDir, '/nonexistent')).rejects.toThrow(/invalid YAML frontmatter/)
  })

  it('lets a project command shadow a homonymous user command and keeps unique ones', async () => {
    const userDir = await tempDir('cf-user-')
    const projectDir = await tempDir('cf-project-')
    await writeCommand(userDir, 'greet.md', 'description: user greet', 'USER BODY')
    await writeCommand(userDir, 'only-user.md', 'description: only user', 'ONLY USER')
    await writeCommand(projectDir, 'greet.md', 'description: project greet', 'PROJECT BODY')

    const commands = await loadCommandFiles(userDir, projectDir)
    expect(commands.size).toBe(2)
    expect(commands.get('greet')).toMatchObject({ source: 'project', description: 'project greet', body: 'PROJECT BODY' })
    expect(commands.get('only-user')).toMatchObject({ source: 'user', body: 'ONLY USER' })
  })

  it('treats a missing layer directory as an empty layer', async () => {
    const userDir = await tempDir('cf-user-')
    await writeCommand(userDir, 'hi.md', 'description: hi', 'HI')
    const commands = await loadCommandFiles('/missing-user', '/missing-project')
    expect(commands.size).toBe(0)
  })
})
