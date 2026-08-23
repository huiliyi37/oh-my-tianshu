/** Shared boot helpers for the approval-rules tests. */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@huiliyi37/cordis'
import type { Agent } from '@huiliyi37/dsh-agent'
import { CallId } from '@huiliyi37/dsh-llm'
import SessionStore, { Session, SessionId } from '@huiliyi37/dsh-session'
import ApprovalService from '@huiliyi37/dsh-user-approval'
import CommandService from '@huiliyi37/dsh-commands'
import * as approvalRules from '@huiliyi37/dsh-approval-rules'
import type { Config, FileRule } from '@huiliyi37/dsh-approval-rules'
import { writeRules } from '@huiliyi37/dsh-approval-rules'

/** The plugin as a Cordis module with its runtime config and inject attached. */
export const approvalRulesPlugin = Object.assign(
  (ctx: Context, config: Config = {}) => approvalRules.apply(ctx, config),
  { inject: approvalRules.inject, Config: approvalRules.Config },
)

/** A minimal agent stand-in whose session is a real (detached) Session. */
export function makeAgent(id: string): Agent {
  return {
    id: SessionId(id),
    session: Session.create(SessionId(id)),
    status: 'idle',
    options: {},
    reserveTurnAdmission: () => () => undefined,
  } as unknown as Agent
}

let requestSeq = 0

/** A real session seeded with an open turn and one `tool/call` event. */
export function requestAgent(toolName: string, args: string): { agent: Agent; session: Session; callId: CallId } {
  requestSeq += 1
  const session = Session.create(SessionId(`req-${requestSeq}`))
  session.append('turn/start', { turn: 1 })
  const call = CallId(`call-${requestSeq}`)
  session.append('tool/call', { turn: 1, step: 1, callId: call, name: toolName, arguments: args })
  const agent = { id: session.id, session } as unknown as Agent
  return { agent, session, callId: call }
}

export interface Harness {
  ctx: Context
  fiber: Context['fiber']
  userFile: string
  projectFile: string
  dir: string
}

export interface BootOptions {
  user?: readonly FileRule[]
  project?: readonly FileRule[]
  config?: Config
  withCommands?: boolean
  approvalPolicy?: 'ask' | 'never'
}

/** Boot ApprovalService (+ optional CommandService) and the rules plugin over temp rule files. */
export async function bootRules(options: BootOptions = {}): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-approval-rules-'))
  const userFile = join(dir, 'permissions.yaml')
  const projectFile = join(dir, 'project-permissions.yaml')
  await writeRules(userFile, options.user ?? [])
  await writeRules(projectFile, options.project ?? [])
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(ApprovalService, options.approvalPolicy === undefined ? {} : { policy: options.approvalPolicy })
  if (options.withCommands === true) await ctx.plugin(CommandService)
  const fiber = ctx.plugin(approvalRulesPlugin, {
    userFile: options.config?.userFile ?? userFile,
    projectFile: options.config?.projectFile ?? projectFile,
  })
  await fiber.await()
  return { ctx, fiber, userFile, projectFile, dir }
}

/** Test-time cleanup for a booted harness. */
export async function teardown(harness: Harness): Promise<void> {
  await harness.ctx.fiber.dispose()
  await rm(harness.dir, { recursive: true, force: true })
}
