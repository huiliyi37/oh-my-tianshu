/**
 * session.rewind over the proxy (P2④ stage 2): the web mirror of the TUI's
 * /rewind — convo truncates (persisted first, then in-memory), code restores
 * post-boundary write-tool files through fs-snapshot's FileHistory, both does
 * both. Unattached sessions answer session-not-found; a deployment without
 * fs-snapshot answers rewind-file-history-unavailable for code/both.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import AgentRegistry from '@huiliyi37/dsh-agent'
import SessionStore from '@huiliyi37/dsh-session'
import UserInteractionService from '@huiliyi37/dsh-user-interaction'
import { SessionId, type Session } from '@huiliyi37/dsh-session'
import type { Agent } from '@huiliyi37/dsh-agent'
import { createUserMessage } from '@huiliyi37/dsh-llm'
import type { ApiProxy } from '@huiliyi37/dsh-host-apiproxy/api'
import { RpcId } from '@huiliyi37/dsh-host-apiproxy/api/rpc'
import { createApiProxy } from '../src/api-proxy.ts'

interface RewindHarness {
  ctx: Context
  api: ApiProxy
  session: Session
  agent: Agent
  histories: Map<string, { rewindToBoundary: ReturnType<typeof vi.fn> }>
  truncateStored: ReturnType<typeof vi.fn>
}

/** A live session + registered agent with a two-turn event log (turn 2 carries a write call). */
async function harness(options: { withFsSnapshot?: boolean } = {}): Promise<RewindHarness> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(UserInteractionService)
  await ctx.plugin(AgentRegistry)
  const histories = new Map<string, { rewindToBoundary: ReturnType<typeof vi.fn> }>()
  const truncateStored = vi.fn(async () => {})
  if (options.withFsSnapshot !== false) ctx.provide('fsSnapshot.histories', histories)
  ctx.provide('sessionPersistence', { truncateStored })
  const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp', workspaceRoot: '/tmp' })

  const session = ctx.sessions.create()
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'one' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  session.append('turn/start', { turn: 2 })
  session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'two' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  session.append('tool/call', { callId: 'write-1' as never, name: 'write', arguments: '{}', turn: 2, step: 0 })
  session.append('tool/call', { callId: 'read-1' as never, name: 'read', arguments: '{}', turn: 2, step: 0 })
  const agent = { id: session.id, session, status: 'idle' as const, ctx } as unknown as Agent
  ctx.agents.register(agent)
  return { ctx, api, session, agent, histories, truncateStored }
}

/** A second turn's user message seq (the checkpoint boundary every case rewinds to). */
function boundarySeq(harness: RewindHarness): number {
  const event = harness.session.events.findLast(e => e.type === 'user/message')
  if (event === undefined) throw new Error('fixture boundary missing')
  return event.seq
}

function request(sessionId: SessionId, atSeq: number, mode: 'convo' | 'code' | 'both') {
  return { rpcId: RpcId('r-rewind'), payload: { sessionId, atSeq, mode } }
}

describe('session.rewind', () => {
  it('convo truncates the session (persisted first, then in-memory) and reports the boundary', async () => {
    const h = await harness()
    const atSeq = boundarySeq(h)
    const order: string[] = []
    h.truncateStored.mockImplementation(() => { order.push('stored') })
    const response = await h.api.sessions.rewind(request(h.session.id, atSeq, 'convo'))
    expect(response.result.ok).toBe(true)
    if (!response.result.ok) throw new Error('expected ok')
    expect(response.result.value).toEqual({ filesChanged: 0, truncatedTo: atSeq })
    expect(h.session.events.every(e => e.seq <= atSeq)).toBe(true)
    expect(h.truncateStored).toHaveBeenCalledWith(h.session.id, atSeq)
    order.push('memory')
    expect(order).toEqual(['stored', 'memory'])
  })

  it('code restores exactly the post-boundary write-tool calls and leaves the log intact', async () => {
    const h = await harness()
    const atSeq = boundarySeq(h)
    const rewindToBoundary = vi.fn(async () => ({ changed: ['f.txt'], skipped: 1 }))
    h.histories.set(String(h.session.id), { rewindToBoundary })
    const response = await h.api.sessions.rewind(request(h.session.id, atSeq, 'code'))
    expect(response.result.ok).toBe(true)
    if (!response.result.ok) throw new Error('expected ok')
    expect(response.result.value).toEqual({ filesChanged: 1, filesSkipped: 1 })
    expect(rewindToBoundary).toHaveBeenCalledWith(new Set(['write-1']))
    // code alone never truncates
    expect(h.session.events.length).toBeGreaterThan(atSeq)
    expect(h.truncateStored).not.toHaveBeenCalled()
  })

  it('both truncates and restores in one call', async () => {
    const h = await harness()
    const atSeq = boundarySeq(h)
    const rewindToBoundary = vi.fn(async () => ({ changed: [], skipped: 0 }))
    h.histories.set(String(h.session.id), { rewindToBoundary })
    const response = await h.api.sessions.rewind(request(h.session.id, atSeq, 'both'))
    expect(response.result.ok).toBe(true)
    if (!response.result.ok) throw new Error('expected ok')
    expect(response.result.value).toEqual({ filesChanged: 0, filesSkipped: 0, truncatedTo: atSeq })
    expect(rewindToBoundary).toHaveBeenCalled()
    expect(h.session.events.every(e => e.seq <= atSeq)).toBe(true)
  })

  it('an unattached session answers session-not-found', async () => {
    const h = await harness()
    const response = await h.api.sessions.rewind(request(SessionId('session-ghost'), 1, 'convo'))
    expect(response.result.ok).toBe(false)
    if (response.result.ok) throw new Error('expected error')
    expect(response.result.error.code).toBe('session-not-found')
  })

  it('a code/both rewind without fs-snapshot answers rewind-file-history-unavailable', async () => {
    const h = await harness({ withFsSnapshot: false })
    const response = await h.api.sessions.rewind(request(h.session.id, boundarySeq(h), 'code'))
    expect(response.result.ok).toBe(false)
    if (response.result.ok) throw new Error('expected error')
    expect(response.result.error.code).toBe('rewind-file-history-unavailable')
  })

  it('a session with no snapshot record restores empty (0 changed, 0 skipped)', async () => {
    const h = await harness()
    // histories map is present but holds no entry for this session
    const response = await h.api.sessions.rewind(request(h.session.id, boundarySeq(h), 'code'))
    expect(response.result.ok).toBe(true)
    if (!response.result.ok) throw new Error('expected ok')
    expect(response.result.value).toEqual({ filesChanged: 0, filesSkipped: 0 })
  })
})
