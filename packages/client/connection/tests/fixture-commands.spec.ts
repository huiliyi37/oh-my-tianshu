/**
 * Fixture commands/skills domains: contract-shape conformance for the two
 * domains added to ApiProxy — rpcId echo, session-addressed catalogs, execute
 * parse/dispatch, skill.list session resolution, and the FixtureApiClient
 * dispatch rows.
 */
import { describe, expect, it } from 'vitest'
import type { SessionId } from '../src/client/api.ts'
import { RpcId } from '../src/client/api.ts'
import type { RpcRequest } from '../src/client/api.ts'
import { FixtureApiClient, createFixtureApi } from '../src/client/fixture.ts'

const sid = (id: string): SessionId => id as SessionId
let reqCount = 0
const req = <P>(payload: P): RpcRequest<P> => ({ rpcId: RpcId(`t-${reqCount++}`), payload })
const signal = new AbortController().signal

describe('createFixtureApi commands/skills', () => {
  it('serves the addressed session catalog with rpcId echo', async () => {
    const api = createFixtureApi()
    const request = req({ sessionId: sid('fx-alpha') })
    const response = await api.commands.list(request)
    expect(response.rpcId).toBe(request.rpcId)
    if (!response.result.ok) throw new Error('list failed')
    const commands = response.result.value.commands
    expect(commands.map(c => c.name)).toEqual(['compact', 'echo', 'goal', 'memory', 'permission', 'plan', 'remember'])
    // input hint rides only the commands declaring it.
    const echo = commands.find(c => c.name === 'echo')
    expect(echo?.input?.hint).toBeTruthy()
    expect(commands.find(c => c.name === 'compact')?.input).toBeUndefined()
  })

  it('rejects a catalog request for an unknown session', async () => {
    const api = createFixtureApi()
    const response = await api.commands.list(req({ sessionId: sid('fx-nope') }))
    expect(response.result).toMatchObject({ ok: false, error: { code: 'session-not-found' } })
  })

  it('executes a known command line: pure admission plus a mux-broadcast lifecycle pair', async () => {
    const api = createFixtureApi()
    const frames: unknown[] = []
    const abort = new AbortController()
    const stream = api.events.mux(req({}), abort.signal)
    const pump = (async () => {
      for await (const frame of stream) {
        frames.push(frame.payload)
        if (frames.filter(f => (f as { type: string }).type === 'session/event').length >= 2) abort.abort()
      }
    })()
    const response = await api.commands.execute(req({ sessionId: sid('fx-alpha'), line: '/echo hello world' }), signal)
    if (!response.result.ok) throw new Error('execute failed')
    expect(response.result.value).toMatchObject({ matched: true })
    expect(response.result.value.commandId).toBeTruthy()
    await pump
    const events = frames
      .filter((f): f is { type: string; event: { type: string; data: Record<string, unknown> } } => (f as { type: string }).type === 'session/event')
      .map(f => f.event)
    expect(events).toMatchObject([
      { type: 'command/run', data: { name: 'echo', args: ' hello world', source: { kind: 'user' } } },
      { type: 'command/done', data: { kind: 'success', text: 'hello world' } },
    ])
    expect(events[0]?.data.commandId).toBe(events[1]?.data.commandId)
  })

  it('addresses execute to the session; an unknown session errs', async () => {
    const api = createFixtureApi()
    const hit = await api.commands.execute(req({ sessionId: sid('fx-alpha'), line: '/goal ship' }), signal)
    if (!hit.result.ok) throw new Error('execute failed')
    expect(hit.result.value.matched).toBe(true)

    const missing = await api.commands.execute(req({ sessionId: sid('fx-nope'), line: '/goal ship' }), signal)
    expect(missing.result).toMatchObject({ ok: false, error: { code: 'session-not-found' } })
  })

  it('mirrors the host /remember and /memory without the memory plugin: matched with the unavailable text', async () => {
    const api = createFixtureApi()
    const events: Array<{ type: string; data: Record<string, unknown> }> = []
    const abort = new AbortController()
    const stream = api.events.mux(req({}), abort.signal)
    const pump = (async () => {
      for await (const frame of stream) {
        const payload = frame.payload as { type: string; event?: { type: string; data: Record<string, unknown> } }
        if (payload.type === 'session/event' && payload.event !== undefined) events.push(payload.event)
        if (events.length >= 2) abort.abort()
      }
    })()
    const response = await api.commands.execute(req({ sessionId: sid('fx-alpha'), line: '/remember ship it' }), signal)
    if (!response.result.ok) throw new Error('execute failed')
    expect(response.result.value.matched).toBe(true)
    await pump
    expect(events).toMatchObject([
      { type: 'command/run', data: { name: 'remember', args: ' ship it', source: { kind: 'user' } } },
      { type: 'command/done', data: { kind: 'error', text: '⚠ memory 服务不可用（未加载 memory 插件）' } },
    ])
    expect(events[0]?.data.commandId).toBe(events[1]?.data.commandId)

    const listed = await api.commands.execute(req({ sessionId: sid('fx-alpha'), line: '/memory' }), signal)
    if (!listed.result.ok) throw new Error('execute failed')
    expect(listed.result.value.matched).toBe(true)
  })

  it('falls to matched:false on unknown names and non-command lines', async () => {
    const api = createFixtureApi()
    for (const line of ['/nope', 'plain text', '/']) {
      const response = await api.commands.execute(req({ sessionId: sid('fx-alpha'), line }), signal)
      if (!response.result.ok) throw new Error('execute failed')
      // Pure admission value: the matched bit is the whole response shape.
      expect(response.result.value).toEqual({ matched: false })
    }
  })

  it('serves the skill catalog for the addressed session and rejects unknown sessions', async () => {
    const api = createFixtureApi()
    const response = await api.skills.list(req({ sessionId: sid('fx-alpha') }))
    if (!response.result.ok) throw new Error('skill list failed')
    expect(response.result.value.skills[0]?.name).toBe('fixture-demo')

    const missingSession = await api.skills.list(req({ sessionId: sid('fx-nope') }))
    expect(missingSession.result).toMatchObject({ ok: false, error: { code: 'session-not-found' } })
  })
})

describe('FixtureApiClient command/skill dispatch', () => {
  it('routes the three method keys through the in-memory dispatch table', async () => {
    const client = new FixtureApiClient()
    const list = await client.commands.list({ sessionId: sid('fx-alpha') })
    if (!list.result.ok) throw new Error('command.list failed')
    expect(list.result.value.commands.length).toBeGreaterThan(0)
    const executed = await client.commands.execute({ sessionId: sid('fx-alpha'), line: '/compact' })
    if (!executed.result.ok) throw new Error('command.execute failed')
    expect(executed.result.value.matched).toBe(true)
    const skills = await client.skills.list({ sessionId: sid('fx-alpha') })
    if (!skills.result.ok) { throw new Error('skill.list failed') }
    expect(skills.result.value.skills.length).toBeGreaterThan(0)
  })
})
