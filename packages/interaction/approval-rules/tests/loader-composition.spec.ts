/**
 * approval-rules real Loader composition: the plugin is discovered through the
 * Loader like any shipped package, registers `/permissions`, answers the
 * `approval/request` waterfall, and fails loud at load on a malformed rule file.
 * @module @huiliyi37/dsh-approval-rules/tests/loader-composition
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
import ApprovalService from '@huiliyi37/dsh-user-approval'
import { Session, SessionId } from '@huiliyi37/dsh-session'
import * as approvalRules from '@huiliyi37/dsh-approval-rules'
import { writeRules } from '@huiliyi37/dsh-approval-rules'
import type { FileRule } from '@huiliyi37/dsh-approval-rules'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function bootLoader(user: readonly FileRule[], project: readonly FileRule[]): Promise<{
  context: Context
  agent: Agent
  userFile: string
  projectFile: string
}> {
  root = await mkdtemp(join(tmpdir(), 'dsh-approval-rules-loader-'))
  const userFile = join(root, 'permissions.yaml')
  const projectFile = join(root, 'project-permissions.yaml')
  await writeRules(userFile, user)
  await writeRules(projectFile, project)

  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@huiliyi37/dsh-commands'",
    "- name: '@huiliyi37/dsh-user-approval'",
    "- name: '@huiliyi37/dsh-approval-rules'",
    '  config:',
    `    userFile: '${userFile}'`,
    `    projectFile: '${projectFile}'`,
    '',
  ].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@huiliyi37/dsh-commands', CommandService],
    ['@huiliyi37/dsh-user-approval', ApprovalService],
    ['@huiliyi37/dsh-approval-rules', approvalRules],
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

  const session = Session.create(SessionId('loader-approval-rules'))
  const agent = {
    session,
    status: 'idle',
    options: {},
    reserveTurnAdmission: () => () => undefined,
  } as unknown as Agent
  return { context, agent, userFile, projectFile }
}

describe('approval-rules real Loader composition', () => {
  it('registers /permissions and answers the approval waterfall', async () => {
    const { context: ctx, agent } = await bootLoader(
      [{ tool: 'echo', pattern: '*', decision: 'deny' }],
      [],
    )

    expect(ctx.commands.list(agent)).toEqual([
      {
        name: 'permissions',
        description: 'List or manage persistent approval rules (distinct from /permission preset switching)',
        input: { hint: '[add <tool> <pattern> <allow|deny> | remove <index>]' },
      },
    ])

    // The answerer is live: a matching rule rejects before any interactive stub.
    const session = Session.create(SessionId('loader-request'))
    session.append('turn/start', { turn: 1 })
    const callId = (await import('@huiliyi37/dsh-llm')).CallId('loader-call')
    session.append('tool/call', { turn: 1, step: 1, callId, name: 'echo', arguments: 'say hi' })
    const requestAgent = { id: session.id, session } as unknown as Agent
    const outcome = await ctx.approval.request({ agent: requestAgent, toolName: 'echo', callId })
    expect(outcome).toBe('rejected')
    const types = session.events
      .filter(event => event.type === 'approval/asked' || event.type === 'approval/rule' || event.type === 'approval/decided')
      .map(event => event.type)
    expect(types).toEqual(['approval/asked', 'approval/rule', 'approval/decided'])
  })

  it('fails loud at load when a rule file is malformed', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-approval-rules-loader-'))
    const userFile = join(root, 'permissions.yaml')
    const projectFile = join(root, 'project-permissions.yaml')
    await writeFile(userFile, '- tool: echo\n  pattern: [\n')
    await writeFile(projectFile, '[]\n')

    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@huiliyi37/dsh-commands'",
      "- name: '@huiliyi37/dsh-user-approval'",
      "- name: '@huiliyi37/dsh-approval-rules'",
      '  config:',
      `    userFile: '${userFile}'`,
      `    projectFile: '${projectFile}'`,
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@huiliyi37/dsh-commands', CommandService],
      ['@huiliyi37/dsh-user-approval', ApprovalService],
      ['@huiliyi37/dsh-approval-rules', approvalRules],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    const setupCtx = context
    const setup = (async () => {
      await setupCtx.loader.create({
        name: 'cordis:include',
        config: { path: pathToFileURL(configPath).href },
      })
      await setupCtx.loader.await()
    })()
    await expect(setup).rejects.toThrow(/malformed YAML/)
  })
})
