/** HMR safety: disposing the command-files plugin fiber unregisters its commands. */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import CommandService from '@huiliyi37/dsh-commands'
import type { Agent } from '@huiliyi37/dsh-agent'
import { Session, SessionId } from '@huiliyi37/dsh-session'
import * as commandFiles from '../src/index.ts'

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

describe('command-files HMR safety', () => {
  it('disposing the plugin fiber removes every file-backed command', async () => {
    const userDir = await tempDir('cf-user-')
    await writeCommand(userDir, 'hello.md', 'description: Say hello', 'Hello $1')
    await writeCommand(userDir, 'git/log.md', 'description: Show log', 'LOG $ARGUMENTS')

    const ctx = new Context()
    await ctx.plugin(CommandService)
    const session = Session.create(SessionId('cf-hmr'))
    const agent = {
      session,
      status: 'idle',
      options: {},
      reserveTurnAdmission: () => () => undefined,
      steer: () => undefined,
    } as unknown as Agent

    const pluginFiber = ctx.plugin(commandFiles, { userDir, projectDir: `${userDir}-project` })
    await pluginFiber
    expect(ctx.commands.find(agent, 'hello')).toBeDefined()
    expect(ctx.commands.find(agent, 'git-log')).toBeDefined()

    await pluginFiber.dispose()
    expect(ctx.commands.find(agent, 'hello')).toBeUndefined()
    expect(ctx.commands.find(agent, 'git-log')).toBeUndefined()
  })
})
