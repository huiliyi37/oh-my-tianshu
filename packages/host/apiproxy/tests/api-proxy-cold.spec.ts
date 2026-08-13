/**
 * Cold-session and degenerate-composition paths of the host ApiProxy:
 * metadata-only listing, Agent-free history reads, subagent ownership
 * isolation, and prompt failure mapping.
 */

import { mkdtempSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Context } from 'cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { TypeRTLookupFailure } from '@deepseek-ai/dsh-type-meta'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { MessageId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import UserInteractionService from '@deepseek-ai/dsh-user-interaction'
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import {
  PersistenceCoordinator,
  SessionPersistenceRevision,
  type PersistenceBackend,
  type StoredPrefix,
} from '@deepseek-ai/dsh-session-persistence'
import type { RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { createApiProxy } from '@deepseek-ai/dsh-host-apiproxy'

const sid = (id: string): SessionId => id as SessionId

let nextRpc = 1
function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`cold-${String(nextRpc++)}`), payload }
}

function header(id: string, createdAt: number, extra: Partial<SessionHeader> = {}): SessionHeader {
  return { version: 0, id: sid(id), createdAt, cwd: '/proj', ...extra }
}

describe('sessions.list cold merge', () => {
  it('summarizes unattached sessions: log mtime, locate-less and vanished-log createdAt fallbacks, lineage', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(UserInteractionService)
    const root = mkdtempSync(join(tmpdir(), 'dsh-cold-'))
    const logPath = join(root, 'a.log')
    writeFileSync(logPath, 'log-bytes')
    utimesSync(logPath, 5000, 5000) // mtime 5_000_000 ms — newer than every createdAt below
    const metas = [
      header('session-a', 1000),
      header('session-b', 2000, { parentSession: sid('session-parent'), origin: 'subagent' }),
      header('session-c', 1500),
    ]
    // Structural fake of the persistence face list() consumes: list + locate.
    // locate: a real per-session file (mtime wins), a backend without one
    // (SQLite shape → createdAt), and a path whose file vanished (stat ENOENT
    // → createdAt).
    ctx.provide('sessionPersistence', {
      list: () => Promise.resolve(metas),
      locate: (meta: SessionHeader) => {
        if (meta.id === sid('session-a')) return { kind: 'jsonl', path: logPath }
        if (meta.id === sid('session-c')) { return { kind: 'jsonl', path: join(root, 'vanished.log') } }
        return undefined
      },
    })
    const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp', workspaceRoot: '/tmp' })

    const response = await api.sessions.list(request({}))
    expect(response.result.ok).toBe(true)
    if (!response.result.ok) throw new Error('unreachable')
    const items = response.result.value.items
    expect(items.map(item => item.sessionId)).toEqual(['session-a', 'session-b', 'session-c'])
    const [a, b, c] = items
    expect(a?.updatedAt).toBeCloseTo(5_000_000, -3)
    expect(a?.running).toBe(false)
    // Cold summaries are never blank: lazy persistence keeps never-appended
    // sessions out of list(), so a listed session necessarily has events.
    expect(items.every(item => !item.blank)).toBe(true)
    expect(a?.cwd).toBe('/proj')
    expect(a?.parentSessionId).toBeUndefined()
    expect(b?.updatedAt).toBe(2000)
    expect(b?.parentSessionId).toBe('session-parent')
    expect(b?.origin).toBe('subagent')
    expect(c?.updatedAt).toBe(1500)
  })
})

describe('attached updatedAt excludes end-seed', () => {
  it('reports the last real work, not the pickup, so a resumed-untouched session does not float', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(UserInteractionService)
    await ctx.plugin(AgentRegistry)
    const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp', workspaceRoot: '/tmp' })

    // Old work, resumed just now: the log tail would report the pickup.
    const worked = 1_000_000
    const resumed = ctx.sessions.create(sid('resumed-untouched'), {
      seed: [
        { type: 'turn/start', seq: 0, time: worked, data: { turn: 1 } },
        { type: 'turn/end', seq: 1, time: worked, data: { turn: 1, reason: { kind: 'completed' } } },
      ],
      meta: { cwd: '/proj', createdAt: 500 },
    })
    ctx.agents.register({ id: resumed.id, session: resumed, status: 'idle', ctx } as Agent)
    const boundary = resumed.events.at(-1)
    expect(boundary?.type).toBe('session/end-seed')
    expect(boundary?.time).toBeGreaterThan(worked)

    const listed = await api.sessions.list(request({}))
    if (!listed.result.ok) throw new Error('list failed')
    const summary = listed.result.value.items.find(item => item.sessionId === 'resumed-untouched')
    expect(summary?.updatedAt).toBe(worked)

    // Real work appended after end-seed does move it.
    resumed.append('turn/start', { turn: 2 })
    const after = await api.sessions.list(request({}))
    if (!after.result.ok) throw new Error('list failed')
    const moved = after.result.value.items.find(item => item.sessionId === 'resumed-untouched')
    expect(moved?.updatedAt).toBeGreaterThan(worked)
  })
})

describe('cold history recovery view', () => {
  it('shows in-memory interruption repair without activating the session', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(UserInteractionService)
    const sessionId = sid('session-interrupted')
    const meta = header(sessionId, 1000)
    const stored: StoredPrefix<never> = {
      meta,
      events: [{ type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } }],
      revision: SessionPersistenceRevision('history-recovery-test:1'),
    }
    const backend: PersistenceBackend<never> = {
      name: 'history-recovery-test',
      loadStored: id => Promise.resolve(id === sessionId ? structuredClone(stored) : undefined),
      readStoredRevision: id => Promise.resolve(
        id === sessionId ? SessionPersistenceRevision('history-recovery-test:1') : undefined,
      ),
      appendBatch: () => Promise.resolve(),
      commitRepair: () => Promise.resolve(),
      deleteFrom: () => Promise.resolve(),
      list: () => Promise.resolve([structuredClone(meta)]),
    }
    const coordinator = new PersistenceCoordinator(ctx, backend)
    ctx.provide('sessionPersistence', {
      list: (signal?: AbortSignal) => backend.list(signal),
      inspect: (id: SessionId, signal?: AbortSignal) => coordinator.inspect(id, signal),
      locate: () => undefined,
    } as never)
    const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp', workspaceRoot: '/tmp' })

    const history = await api.sessions.history(request({ sessionId, beforeSeq: 2, maxMessages: 10 }))
    if (!history.result.ok) throw new Error('history failed')
    expect(history.result.value.events.map(entry => entry.event)).toMatchInlineSnapshot(`
      [
        {
          "data": {
            "turn": 1,
          },
          "seq": 0,
          "time": 1,
          "type": "turn/start",
        },
        {
          "data": {
            "reason": {
              "kind": "interrupted",
            },
            "turn": 1,
          },
          "seq": 1,
          "time": 1,
          "type": "turn/end",
        },
      ]
    `)
    expect(ctx.sessions.get(sessionId)).toBeUndefined()
    await ctx.fiber.dispose()
  })
})

describe('Remote Agent and Session lookup policy', () => {
  it('deduplicates a cold resume across Agent and Session parameters', async () => {
    const ctx = new Context()
    await ctx.plugin(TypertRegistry)
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(UserInteractionService)
    const sessionId = sid('session-remote-cold')
    const meta = header(sessionId, 1000)
    const inspect = vi.fn(() => Promise.resolve({ meta, events: [] as SessionEvent[] }))
    ctx.provide('sessionPersistence', {
      list: () => Promise.resolve([meta]),
      inspect,
      locate: () => undefined,
    } as never)
    const resumedSession = { id: sessionId, header: meta, events: [] } as unknown as import('@deepseek-ai/dsh-session').Session
    const resumedAgent = { id: sessionId, session: resumedSession, status: 'idle', ctx } as Agent
    const release = Promise.withResolvers<undefined>()
    const resume = vi.spyOn(ctx.agents, 'resume').mockImplementation(async () => {
      await release.promise
      return { agent: resumedAgent, dispose: () => Promise.resolve() }
    })
    const defaultAgentLookup = ctx.typert.lookups.get('agent')
    const defaultSessionLookup = ctx.typert.lookups.get('session')
    createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp', workspaceRoot: '/tmp' })
    await vi.waitFor(() => {
      expect(ctx.typert.lookups.get('agent')).not.toBe(defaultAgentLookup)
      expect(ctx.typert.lookups.get('session')).not.toBe(defaultSessionLookup)
    })
    const agentLookup = ctx.typert.lookups.get('agent')
    const sessionLookup = ctx.typert.lookups.get('session')
    if (agentLookup === undefined || sessionLookup === undefined) throw new Error('core lookup providers were not mounted')

    const resolvedAgent = Promise.resolve(agentLookup.resolve(sessionId))
    const resolvedSession = Promise.resolve(sessionLookup.resolve(sessionId))
    await vi.waitFor(() => { expect(resume).toHaveBeenCalledOnce() })
    release.resolve(undefined)

    await expect(resolvedAgent).resolves.toBe(resumedAgent)
    await expect(resolvedSession).resolves.toBe(resumedSession)
    expect(inspect).toHaveBeenCalledOnce()
  })

  it('preserves the subagent ownership fence for cold and live Remote lookups', async () => {
    const ctx = new Context()
    await ctx.plugin(TypertRegistry)
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(UserInteractionService)
    const coldId = sid('session-remote-cold-child')
    const coldMeta = header(coldId, 1000, {
      parentSession: sid('session-parent'),
      origin: 'subagent',
    })
    const inspect = vi.fn(() => Promise.resolve({ meta: coldMeta, events: [] as SessionEvent[] }))
    ctx.provide('sessionPersistence', {
      list: () => Promise.resolve([coldMeta]),
      inspect,
      locate: () => undefined,
    } as never)
    const liveSession = ctx.sessions.create(sid('session-remote-live-child'), {
      meta: { cwd: '/proj', parentSession: sid('session-parent'), origin: 'subagent' },
    })
    const liveAgent = { id: liveSession.id, session: liveSession, status: 'idle', ctx } as Agent
    ctx.agents.register(liveAgent)
    const resume = vi.spyOn(ctx.agents, 'resume')
    const defaultAgentLookup = ctx.typert.lookups.get('agent')
    const defaultSessionLookup = ctx.typert.lookups.get('session')
    createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp', workspaceRoot: '/tmp' })
    await vi.waitFor(() => {
      expect(ctx.typert.lookups.get('agent')).not.toBe(defaultAgentLookup)
      expect(ctx.typert.lookups.get('session')).not.toBe(defaultSessionLookup)
    })
    const agentLookup = ctx.typert.lookups.get('agent')
    const sessionLookup = ctx.typert.lookups.get('session')
    if (agentLookup === undefined || sessionLookup === undefined) throw new Error('core lookup providers were not mounted')
    const ownershipFailure = {
      failure: {
        code: 'agent-busy',
        details: { reason: 'use subagent delivery for this child session' },
      },
    }

    const coldFailure = Promise.resolve(agentLookup.resolve(coldId))
    const liveFailure = Promise.resolve(sessionLookup.resolve(liveSession.id))
    await expect(coldFailure).rejects.toBeInstanceOf(TypeRTLookupFailure)
    await expect(coldFailure).rejects.toMatchObject(ownershipFailure)
    await expect(liveFailure).rejects.toBeInstanceOf(TypeRTLookupFailure)
    await expect(liveFailure).rejects.toMatchObject(ownershipFailure)
    expect(resume).not.toHaveBeenCalled()
    expect(inspect).toHaveBeenCalledOnce()
  })
})

describe('subagent ownership fence', () => {
  it('reads a cold child without an Agent and rejects generic resume or adoption', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(UserInteractionService)
    const sessionId = sid('session-child')
    const meta = header('session-child', 1000, {
      parentSession: sid('session-parent'),
      seedLength: 0,
      origin: 'subagent',
    })
    const events = [
      { type: 'turn/start', seq: 0, time: 1, data: { turn: 1, trigger: { kind: 'message', source: { kind: 'user' } } } },
      {
        type: 'user/message',
        seq: 1,
        time: 2,
        data: { content: [{ type: 'text', text: 'work' }], source: { kind: 'user' } },
        surfaceOp: 'append',
      },
      {
        type: 'subagent/descriptor',
        seq: 2,
        time: 3,
        data: { version: 2, mode: 'continuable', provider: 'spawn', label: 'child' },
      },
      { type: 'turn/end', seq: 3, time: 4, data: { turn: 1, reason: { kind: 'completed' } } },
    ] as SessionEvent[]
    const inspect = vi.fn(() => Promise.resolve({ meta, events }))
    ctx.provide('sessionPersistence', {
      list: () => Promise.resolve([meta]),
      inspect,
      locate: () => undefined,
    } as never)
    const resume = vi.spyOn(ctx.agents, 'resume')
    const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp', workspaceRoot: '/tmp' })

    const history = await api.sessions.history(request({ sessionId }))
    expect(history.result.ok).toBe(true)
    if (history.result.ok) {
      expect(history.result.value.events.map(entry => entry.event.type)).toEqual(events.map(event => event.type))
    }
    expect(ctx.agents.get(sessionId)).toBeUndefined()

    const prompt = await api.sessions.prompt(request({
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: 'follow up' }],
    }))
    expect(prompt.result.ok).toBe(false)
    if (!prompt.result.ok) {
      expect(prompt.result.error).toMatchObject({
        code: 'agent-busy',
        details: { reason: 'use subagent delivery for this child session' },
      })
    }

    const create = await api.sessions.create(request({ sessionId, cwd: '/proj' }))
    expect(create.result.ok).toBe(false)
    if (!create.result.ok) expect(create.result.error.code).toBe('agent-busy')
    expect(resume).not.toHaveBeenCalled()
    expect(ctx.agents.get(sessionId)).toBeUndefined()
    expect(inspect).toHaveBeenCalledTimes(3)
  })

  it('no longer treats a descriptor-only cold child without origin as subagent-owned', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(UserInteractionService)
    const sessionId = sid('session-legacy-child')
    const meta = header('session-legacy-child', 1000, {
      parentSession: sid('session-parent'),
      seedLength: 0,
    })
    const events = [
      {
        type: 'subagent/descriptor',
        seq: 0,
        time: 1,
        data: { version: 2, mode: 'continuable', provider: 'spawn', label: 'child' },
      },
    ] as SessionEvent[]
    ctx.provide('sessionPersistence', {
      list: () => Promise.resolve([meta]),
      inspect: () => Promise.resolve({ meta, events }),
      locate: () => undefined,
    } as never)
    // Pre-#1569 stores classify a child only through the descriptor event and
    // carry no header `origin`; the pre-release decision stops recognizing
    // them, so the ownership fence lets generic resume reach the registry
    // instead of answering `agent-busy`.
    const resume = vi.spyOn(ctx.agents, 'resume')
      .mockRejectedValue(new Error('registry unavailable in this bench'))
    const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp', workspaceRoot: '/tmp' })

    const prompt = await api.sessions.prompt(request({
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: 'follow up' }],
    }))
    expect(resume).toHaveBeenCalledTimes(1)
    expect(prompt.result.ok).toBe(false)
    if (!prompt.result.ok) expect(prompt.result.error.code).toBe('internal')
  })

  it('rejects origin-marked and runtime-owned live children from generic controls', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(UserInteractionService)
    const parentSession = ctx.sessions.create(sid('session-parent'), { meta: { cwd: '/proj' } })
    const parent = { id: parentSession.id, session: parentSession, status: 'idle', ctx } as Agent
    ctx.agents.register(parent)

    const originSession = ctx.sessions.create(sid('session-origin-child'), {
      meta: { cwd: '/proj', parentSession: parent.id, origin: 'subagent' },
    })
    const cancel = vi.fn()
    const updateInbox = vi.fn(() => 'applied' as const)
    const originChild = {
      id: originSession.id,
      session: originSession,
      status: 'idle',
      ctx,
      cancel,
      updateInbox,
    } as unknown as Agent
    ctx.agents.register(originChild)

    const startingSession = ctx.sessions.create(sid('session-starting-child'), {
      meta: { cwd: '/proj', parentSession: parent.id },
    })
    const startingChild = { id: startingSession.id, session: startingSession, status: 'idle', ctx } as Agent
    ctx.agents.enter(startingChild, parent)
    const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp', workspaceRoot: '/tmp' })

    const stopped = await api.sessions.cancel(request({ sessionId: originChild.id }))
    expect(stopped.result.ok).toBe(false)
    if (!stopped.result.ok) expect(stopped.result.error.code).toBe('agent-busy')
    expect(cancel).not.toHaveBeenCalled()

    const queued = await api.sessions.updateQueue(request({
      sessionId: originChild.id,
      itemId: MessageId('queued-item'),
      action: { kind: 'remove' },
    }))
    expect(queued.result.ok).toBe(false)
    if (!queued.result.ok) expect(queued.result.error.code).toBe('agent-busy')
    expect(updateInbox).not.toHaveBeenCalled()

    const models = await api.sessions.models(request({ sessionId: startingChild.id }))
    expect(models.result.ok).toBe(false)
    if (!models.result.ok) expect(models.result.error.code).toBe('agent-busy')

    const create = await api.sessions.create(request({ sessionId: originChild.id, cwd: '/proj' }))
    expect(create.result.ok).toBe(false)
    if (!create.result.ok) expect(create.result.error.code).toBe('agent-busy')

    const history = await api.sessions.history(request({ sessionId: originChild.id }))
    expect(history.result.ok).toBe(true)
    expect(ctx.agents.get(originChild.id)).toBe(originChild)
  })

  it('does not classify an ordinary fork from an inherited ancestor descriptor', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(UserInteractionService)
    const session = ctx.sessions.create(sid('session-ordinary-fork'), {
      seed: [{
        type: 'subagent/descriptor',
        seq: 0,
        time: 1,
        data: { version: 2, mode: 'continuable', provider: 'spawn', label: 'ancestor' },
      }],
      meta: { cwd: '/proj', parentSession: sid('session-source'), seedLength: 1 },
    })
    const followup = vi.fn()
    const agent = { id: session.id, session, status: 'idle', ctx, followup } as unknown as Agent
    ctx.agents.register(agent)
    const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp', workspaceRoot: '/tmp' })

    const response = await api.sessions.prompt(request({
      sessionId: agent.id,
      mode: 'queue',
      content: [{ type: 'text', text: 'ordinary work' }],
    }))
    expect(response.result.ok).toBe(true)
    expect(followup).toHaveBeenCalledOnce()
  })
})

describe('degenerate composition (no persistence, no factory)', () => {
  it('list skips the cold merge and history reports missing persistence as internal', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(UserInteractionService)
    const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp', workspaceRoot: '/tmp' })

    const listed = await api.sessions.list(request({}))
    expect(listed.result.ok).toBe(true)
    if (listed.result.ok) expect(listed.result.value.items).toEqual([])

    // No persistence means cold history cannot inspect a transcript.
    const response = await api.sessions.history(request({ sessionId: sid('session-ghost') }))
    expect(response.result.ok).toBe(false)
    if (!response.result.ok) {
      expect(response.result.error.code).toBe('internal')
      expect(response.result.error.message).toMatch(/history unavailable for session "session-ghost"/)
    }
  })

  it('maps a persistence catalog miss to session-not-found without inspection', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(UserInteractionService)
    const inspect = vi.fn()
    ctx.provide('sessionPersistence', {
      list: () => Promise.resolve([]),
      inspect,
    } as never)
    const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp', workspaceRoot: '/tmp' })

    const response = await api.sessions.history(request({ sessionId: sid('session-missing') }))
    expect(response.result.ok).toBe(false)
    if (!response.result.ok) expect(response.result.error.code).toBe('session-not-found')
    expect(inspect).not.toHaveBeenCalled()
  })
})

describe('sessions.prompt synchronous rejection', () => {
  it('maps a synchronous send throw (disposed/invalid input) to agent-busy with the reason attached', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(UserInteractionService)
    const session = ctx.sessions.create(sid('session-throwing'))
    // A live structural stub whose delivery verbs throw synchronously, the
    // shape a disposed loop presents at this gateway boundary.
    ctx.agents.register({
      id: session.id,
      session,
      status: 'idle',
      ctx,
      followup: () => { throw new Error('agent "session-throwing" lifecycle disposed') },
      steer: () => { throw new Error('agent "session-throwing" lifecycle disposed') },
    } as unknown as Agent)
    const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp', workspaceRoot: '/tmp' })

    for (const mode of ['queue', 'steer'] as const) {
      const response = await api.sessions.prompt(request({
        sessionId: session.id, mode, content: [{ type: 'text' as const, text: 'x' }],
      }))
      expect(response.result.ok).toBe(false)
      if (!response.result.ok) {
        expect(response.result.error.code).toBe('agent-busy')
        expect(response.result.error.message).toBe('prompt rejected')
        expect(response.result.error.details).toEqual({
          reason: 'Error: agent "session-throwing" lifecycle disposed',
        })
      }
    }
  })

  it('classifies a raced cold-resume ID collision as agent-busy', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(UserInteractionService)
    const sessionId = sid('race-resume')
    const meta: SessionHeader = header('race-resume', 1000)
    ctx.provide('sessionPersistence', {
      list: () => Promise.resolve([meta]),
      inspect: () => Promise.resolve({ meta, events: [] as SessionEvent[] }),
      locate: () => undefined,
    } as never)
    // The raced winner: a live parent-owned subagent publishes the identity
    // while the generic cold resume is in flight, so the resume collides.
    const parentSession = ctx.sessions.create(sid('race-parent'), { meta: { cwd: '/proj' } })
    const parent = { id: parentSession.id, session: parentSession, status: 'idle', ctx } as Agent
    ctx.agents.register(parent)
    const childSession = ctx.sessions.create(sessionId, {
      meta: { cwd: '/proj', parentSession: parent.id, origin: 'subagent' },
    })
    const child = { id: sessionId, session: childSession, status: 'idle', ctx } as unknown as Agent
    vi.spyOn(ctx.agents, 'resume').mockImplementationOnce(async () => {
      // The parent's `enter()` wins the identity between the pre-resume
      // re-check and publication; the generic resume then collides.
      ctx.agents.register(child)
      throw new Error('session id already published')
    })
    const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp', workspaceRoot: '/tmp' })

    const models = await api.sessions.models(request({ sessionId }))
    expect(models.result.ok).toBe(false)
    if (!models.result.ok) {
      expect(models.result.error).toMatchObject({
        code: 'agent-busy',
        details: { reason: 'use subagent delivery for this child session' },
      })
    }
  })
})
