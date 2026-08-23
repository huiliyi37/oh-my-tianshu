/** Direct one-shot Agent driving, durable aggregation, flushing, and exit mapping. */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import AgentRegistry, { Inbox } from '@huiliyi37/dsh-agent'
import type { Agent, AgentHandle, AgentSetup, CreateAgentOptions } from '@huiliyi37/dsh-agent'
import AgentDefaultModelService from '@huiliyi37/dsh-agent-default-model'
import { createAssistantMessage } from '@huiliyi37/dsh-llm'
import SessionStore, { SessionId } from '@huiliyi37/dsh-session'
import type { Session, UserMessage } from '@huiliyi37/dsh-session'
import { apply, Config, type HeadlessIo } from '../src/index.ts'

interface Script {
  before?(session: Session): void
  afterPrompt(session: Session, message: UserMessage): Promise<void> | void
}

function appendTurn(
  session: Session,
  turn: number,
  message: UserMessage,
  text: string | undefined,
  completed: boolean,
): void {
  session.append('turn/start', { turn })
  session.append('step/start', { turn, step: 1 })
  session.append('user/message', message, { surfaceOp: 'append' })
  if (text !== undefined) {
    session.append('assistant/message', {
      turn,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'text', text }],
        source: { provider: 'test-provider', model: 'test-model' },
      }),
    }, { surfaceOp: 'append' })
  }
  session.append('step/end', { turn, step: 1 })
  session.append('turn/end', {
    turn,
    reason: completed
      ? { kind: 'completed' }
      : { kind: 'aborted', reason: { kind: 'user' } },
  })
}

/** Mount the real registries around a small scripted Agent factory. */
async function bench(
  script: Script,
  options: { resume?: boolean } = {},
): Promise<{
  ctx: Context
  run(config?: { task?: string; sessionId?: string }): Promise<{ code: number; out: string; err: string; order: string[] }>
}> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentDefaultModelService, { provider: 'test-provider', model: 'test-model' })
  const buildAgent = async (
    ownerCtx: Context,
    session: Session,
    setup: AgentSetup | undefined,
  ): Promise<AgentHandle> => {
    let idle = Promise.resolve()
    const agent = {} as Agent
    const agentCtx = ownerCtx.extend({ agent })
    Object.assign(agent, {
      id: session.id,
      options: {},
      session,
      inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
      status: 'idle',
      ctx: agentCtx,
      cancel: () => {},
      runMaintenance: () => Promise.reject(new Error('not used')),
      send: () => {},
      followup: (message: UserMessage) => {
        agent.inbox.append('next-turn', message)
        idle = Promise.resolve().then(() => script.afterPrompt(session, message))
      },
      steer: () => {},
      inject: () => {},
      whenIdle: () => idle,
    } satisfies Partial<Agent>)
    await setup?.(agentCtx)
    script.before?.(session)
    ctx.agents.register(agent)
    return { agent, dispose: () => Promise.resolve() }
  }
  ctx.agents.setFactory({
    async createAgent(ownerCtx: Context, createOptions: CreateAgentOptions): Promise<AgentHandle> {
      const session = ctx.sessions.create(createOptions.sessionId, {
        ...createOptions.meta === undefined ? {} : { meta: createOptions.meta },
      })
      return buildAgent(ownerCtx, session, createOptions.setup)
    },
    // session-resume 1.4: --session drives the resume factory; the runner must
    // never fall back to create for an unknown id.
    resume: options.resume === true
      ? async (ownerCtx: Context, resumeOptions: { resumeSessionId: string; setup?: (agentCtx: Context) => void }) => {
        const session = ctx.sessions.create(SessionId(resumeOptions.resumeSessionId), {})
        return buildAgent(ownerCtx, session, resumeOptions.setup)
      }
      : () => Promise.reject(new Error('not used')),
  })
  return {
    ctx,
    run: async (config: { task?: string; sessionId?: string } = {}) => {
      let out = ''
      let err = ''
      const order: string[] = []
      ctx.on('session/flush', () => { order.push('flush') })
      const exited = new Promise<number>((resolve) => {
        const io: HeadlessIo = {
          stdout: { write: (chunk: string) => { out += chunk; return true } },
          stderr: { write: (chunk: string) => { err += chunk; return true } },
          exit: (code) => { order.push('exit'); resolve(code) },
        }
        ctx.provide('headlessIo', io)
      })
      apply(ctx, { task: config.task ?? 'do the thing', ...config.sessionId === undefined ? {} : { sessionId: config.sessionId } })
      return { code: await exited, out, err, order }
    },
  }
}

describe('headless runner', () => {
  it('aggregates the final text across the complete idle-to-idle interval and flushes before exit', async () => {
    const test = await bench({
      before(session) {
        const setupMessage = {
          role: 'user', content: [{ type: 'text', text: 'setup' }], source: { kind: 'user' }, id: 'setup',
        } as UserMessage
        appendTurn(session, 0, setupMessage, 'pre-task noise', true)
      },
      async afterPrompt(session, message) {
        await Promise.resolve()
        appendTurn(session, 1, message, '', true)
        appendTurn(session, 2, message, 'final answer', true)
      },
    })
    const result = await test.run()
    expect(result).toEqual({
      code: 0,
      out: 'final answer\n',
      err: '',
      order: ['flush', 'exit'],
    })
    await test.ctx.fiber.dispose()
  })

  it('waits for asynchronously appended events instead of racing Agent idleness', async () => {
    const test = await bench({
      afterPrompt: async (session, message) => {
        await new Promise(resolve => setTimeout(resolve, 5))
        appendTurn(session, 1, message, 'race-free answer', true)
      },
    })
    expect(await test.run()).toMatchObject({ code: 0, out: 'race-free answer\n', err: '' })
    await test.ctx.fiber.dispose()
  })

  it('exits 1 when the final turn does not complete', async () => {
    const test = await bench({
      afterPrompt(session, message) { appendTurn(session, 1, message, undefined, false) },
    })
    expect(await test.run()).toMatchObject({ code: 1, out: '\n', err: '' })
    await test.ctx.fiber.dispose()
  })

  it('prints the durable model failure when the final turn ends in error', async () => {
    const test = await bench({
      afterPrompt(session, message) {
        session.append('turn/start', { turn: 1 })
        session.append('step/start', { turn: 1, step: 1 })
        session.append('user/message', message, { surfaceOp: 'append' })
        session.append('step/end', { turn: 1, step: 1 })
        session.append('turn/end', {
          turn: 1,
          reason: { kind: 'error', error: { code: 'SERVER', message: 'provider unavailable' } },
        })
      },
    })
    expect(await test.run()).toMatchObject({
      code: 1,
      out: '\n',
      err: 'dsh: SERVER: provider unavailable\n',
    })
    await test.ctx.fiber.dispose()
  })

  it('exits 1 when the owned interval contains no turn', async () => {
    const test = await bench({ afterPrompt: () => {} })
    expect(await test.run()).toMatchObject({ code: 1, out: '\n', err: '' })
    await test.ctx.fiber.dispose()
  })

  it('--session 走 resume 工厂而非 create，任务提交到既有会话', async () => {
    const test = await bench({
      async afterPrompt(session, message) { appendTurn(session, 1, message, 'resumed answer', true) },
    }, { resume: true })
    const result = await test.run({ sessionId: 'session-abc' })
    expect(result).toMatchObject({ code: 0, out: 'resumed answer\n', err: '' })
    expect(result.order).toEqual(['flush', 'exit'])
    expect(test.ctx.sessions.list().length).toBe(1) // 只创建了恢复目标会话，未新建
    await test.ctx.fiber.dispose()
  })

  it('--session 未知 id → fails loud + 入口指引，绝不静默新建', async () => {
    const ctx = new Context()
    let err = ''
    const create = vi.fn(() => Promise.reject(new Error('create must not run')))
    const exited = new Promise<number>((resolve) => {
      ctx.provide('headlessIo', {
        stdout: { write: () => true },
        stderr: { write: (chunk: string) => { err += chunk; return true } },
        exit: resolve,
      } satisfies HeadlessIo)
    })
    ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    ctx.provide('sessions', { flush: () => Promise.resolve(true) } as never)
    ctx.provide('agents', {
      create,
      resume: () => Promise.reject(new Error('session "session-nope" not found')),
    } as never)
    apply(ctx, { task: 't', sessionId: 'session-nope' })
    expect(await exited).toBe(1)
    expect(err).toContain('session "session-nope" not found')
    expect(err).toContain('session not found')
    expect(err).toContain('--session <id>')
    expect(create).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('reports a direct Agent creation failure', async () => {
    const ctx = new Context()
    let err = ''
    const exited = new Promise<number>((resolve) => {
      ctx.provide('headlessIo', {
        stdout: { write: () => true },
        stderr: { write: (chunk: string) => { err += chunk; return true } },
        exit: resolve,
      } satisfies HeadlessIo)
    })
    ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    ctx.provide('sessions', { flush: () => Promise.resolve(true) } as never)
    ctx.provide('agents', { create: () => Promise.reject(new Error('factory exploded')) } as never)
    apply(ctx, { task: 't' })
    expect(await exited).toBe(1)
    expect(err).toBe('dsh: factory exploded\n')
    await ctx.fiber.dispose()
  })

  it('stringifies a non-Error Agent creation failure', async () => {
    const ctx = new Context()
    let err = ''
    const exited = new Promise<number>((resolve) => {
      ctx.provide('headlessIo', {
        stdout: { write: () => true },
        stderr: { write: (chunk: string) => { err += chunk; return true } },
        exit: resolve,
      } satisfies HeadlessIo)
    })
    ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    ctx.provide('sessions', { flush: () => Promise.resolve(true) } as never)
    const rejected = {
      then(_resolve: (value: never) => void, reject: (reason: unknown) => void): void {
        reject('factory exploded')
      },
    }
    ctx.provide('agents', { create: () => rejected } as never)
    apply(ctx, { task: 't' })
    expect(await exited).toBe(1)
    expect(err).toBe('dsh: factory exploded\n')
    await ctx.fiber.dispose()
  })

  it('abandons a run when the tree is disposed during Loader settlement', async () => {
    const ctx = new Context()
    let exited = false
    ctx.provide('headlessIo', {
      stdout: { write: () => true },
      stderr: { write: () => true },
      exit: () => { exited = true },
    } satisfies HeadlessIo)
    const services = ctx.plugin((child: Context) => {
      child.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'p', model: 'm' }) } as never)
      child.provide('sessions', {} as never)
      child.provide('agents', {} as never)
    })
    await services
    let release: () => void
    const settlement = new Promise<void>((resolve) => { release = resolve })
    ctx.provide('loader', { await: () => settlement } as never)
    apply(ctx, { task: 't' })
    await services.dispose()
    release!()
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(exited).toBe(false)
    await ctx.fiber.dispose()
  })

  it('fails loud without the launcher-owned headlessIo seam', () => {
    const ctx = new Context()
    expect(() => { apply(ctx, { task: 't' }) }).toThrow('must provide ctx.headlessIo')
  })

  it('validates config: the task is required', () => {
    expect(() => new Config({} as never)).toThrow()
    expect(new Config({ task: 'x' })).toEqual({ task: 'x' })
  })
})
