/** Execution of a file-backed command through the host command registry. */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import CommandService from '@huiliyi37/dsh-commands'
import type { Agent } from '@huiliyi37/dsh-agent'
import { Session, SessionId } from '@huiliyi37/dsh-session'
import type { UserMessage } from '@huiliyi37/dsh-session'
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

/** Boot the command-files plugin against a single temp user layer. */
async function boot(config: { userDir: string; projectDir: string }): Promise<{
  ctx: Context
  agent: Agent
  steer: ReturnType<typeof vi.fn>
}> {
  const ctx = new Context()
  await ctx.plugin(CommandService)
  await ctx.plugin(commandFiles, config)
  const session = Session.create(SessionId('cf-exec'))
  const steer = vi.fn()
  const agent = {
    session,
    status: 'idle',
    options: {},
    reserveTurnAdmission: () => () => undefined,
    steer,
  } as unknown as Agent
  return { ctx, agent, steer }
}

describe('file-backed command execution', () => {
  it('steers the rendered template and logs the lifecycle pair', async () => {
    const userDir = await tempDir('cf-user-')
    await writeCommand(userDir, 'hello.md', 'description: Say hello', 'Hello $1')
    const { ctx, agent, steer } = await boot({ userDir, projectDir: `${userDir}-project` })

    const execution = await ctx.commands.execute(agent, '/hello world', new AbortController().signal)
    expect(execution).toBeDefined()
    expect(execution!.result).toEqual({ kind: 'success', text: 'Hello world' })

    expect(steer).toHaveBeenCalledTimes(1)
    const firstCall = steer.mock.calls[0]
    if (firstCall === undefined) throw new Error('expected one steer call')
    const steered = firstCall[0] as UserMessage
    expect(steered.role).toBe('user')
    expect(steered.source).toEqual({ kind: 'user' })
    expect(steered.content).toEqual([{ type: 'text', text: 'Hello world' }])

    expect(agent.session.events.map(event => event.type)).toEqual(['command/run', 'command/done'])
    const run = agent.session.events[0]
    const done = agent.session.events[1]
    if (run === undefined || done === undefined) throw new Error('expected command/run and command/done events')
    expect(run.type === 'command/run' && run.data).toMatchObject({ name: 'hello' })
    expect(done.type === 'command/done' && done.data).toMatchObject({ kind: 'success', text: 'Hello world' })
  })

  it('substitutes $ARGUMENTS and positional arguments from the raw input', async () => {
    const userDir = await tempDir('cf-user-')
    await writeCommand(userDir, 'summarize.md', 'description: Summarize', 'ARGS=$ARGUMENTS FIRST=$1 SECOND=$2')
    const { ctx, agent } = await boot({ userDir, projectDir: `${userDir}-project` })

    const execution = await ctx.commands.execute(agent, '/summarize alpha beta', new AbortController().signal)
    expect(execution?.result).toEqual({ kind: 'success', text: 'ARGS= alpha beta FIRST=alpha SECOND=beta' })
  })

  it('settles an empty template body as an execution-time error without steering', async () => {
    const userDir = await tempDir('cf-user-')
    await writeCommand(userDir, 'blank.md', 'description: Blank', '   ')
    const { ctx, agent, steer } = await boot({ userDir, projectDir: `${userDir}-project` })

    const execution = await ctx.commands.execute(agent, '/blank', new AbortController().signal)
    expect(execution?.result.kind).toBe('error')
    expect(execution?.result.kind === 'error' ? execution.result.text : '').toContain('empty template body')
    expect(steer).not.toHaveBeenCalled()
  })
})
