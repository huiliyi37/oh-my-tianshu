/**
 * next-workflow real Loader composition: the command is discovered through the
 * Loader like any shipped plugin, and a composition without the subagent seam
 * answers a plain unavailable error instead of pretending to run.
 * @module @huiliyi37/dsh-next-workflow/tests/loader-composition
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import Loader from '@huiliyi37/cordis-plugin-loader'
import Include from '@huiliyi37/cordis-plugin-include'
import type { Agent } from '@huiliyi37/dsh-agent'
import CommandService from '@huiliyi37/dsh-commands'
import * as nextWorkflow from '@huiliyi37/dsh-next-workflow'
import { Session, SessionId } from '@huiliyi37/dsh-session'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('next-workflow real Loader composition', () => {
  it('discovers /next-workflow and fails loud without the subagent seam', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-next-workflow-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@huiliyi37/dsh-commands'",
      "- name: '@huiliyi37/dsh-next-workflow'",
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@huiliyi37/dsh-commands', CommandService],
      ['@huiliyi37/dsh-next-workflow', nextWorkflow],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(configPath).href },
    })
    await context.loader.await()

    const session = Session.create(SessionId('loader-next-workflow'))
    const agent = {
      session,
      status: 'idle',
      options: {},
      reserveTurnAdmission: () => () => undefined,
    } as unknown as Agent
    expect(context.commands.list(agent)).toEqual([
      {
        name: 'next-workflow',
        description: 'Run the fixed intent pipeline: INTENT → PLAN → CRITIQUE → IMPLEMENT → VERIFY → REVIEW',
        input: { hint: '<objective>' },
      },
    ])
    const execution = await context.commands.execute(agent, '/next-workflow add tests for foo', new AbortController().signal)
    if (execution === undefined) throw new Error('Loader composition did not resolve /next-workflow')
    expect(execution.result.kind).toBe('error')
    expect(execution.result.kind === 'error' ? execution.result.text : '').toContain('subagents')
    // The lifecycle pair is logged; the failed admission runs no phase machine.
    expect(session.events.map(event => event.type)).toEqual(['command/run', 'command/done'])
    expect(session.surface.nodes).toEqual([])
    expect(session.deriveMessages()).toEqual([])
  })
})
