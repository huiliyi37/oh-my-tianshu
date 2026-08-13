/**
 * Wire-to-typed-event bridge (web input-triggers cut 1): host/commands-changed
 * → ctx 'commands/changed'; each established connection generation →
 * ctx 'connection/reset' (the forced cache-invalidation broadcast).
 */
import { Context } from 'cordis'
import { describe, expect, it } from 'vitest'
import type { ConnectionHandle, ConnectionSinks } from '@deepseek-ai/dsh-client-connection/client'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import * as RuntimeClient from '../src/client/index.ts'
import { FakeApiClient } from './fake-api.ts'

interface Bench {
  ctx: Context
  sinks: ConnectionSinks | undefined
}

async function mount(): Promise<Bench> {
  const ctx = new Context()
  await ctx.plugin(TypertRegistry)
  const api = new FakeApiClient()
  const bench: Bench = { ctx, sinks: undefined }
  const handle: ConnectionHandle = {
    api,
    isLoopback: true,
    rpc: {
      call: () => Promise.reject(new Error('unexpected generic RPC call')),
    },
    start: (sinks) => {
      bench.sinks = sinks
      return { stop: () => {} }
    },
  }
  ctx.reflect.provide('connection', handle)
  ctx.reflect.provide('remote', {})
  await ctx.plugin(RuntimeClient).await()
  return bench
}

describe('wire event bridge', () => {
  it('broadcasts commands/changed on a host/commands-changed frame, not on other host frames', async () => {
    const bench = await mount()
    let changed = 0
    bench.ctx.on('commands/changed', () => { changed++ })
    bench.sinks?.onHostEnvelope?.({ rpcId: 'r1' as never, payload: { type: 'host/commands-changed' } })
    expect(changed).toBe(1)
    bench.sinks?.onHostEnvelope?.({
      rpcId: 'r2' as never,
      payload: { type: 'host/session-status', sessionId: 's1' as never, running: true },
    })
    expect(changed).toBe(1)
  })

  it('broadcasts the settings/credentials/models invalidations with their frame payloads', async () => {
    const bench = await mount()
    const seen: unknown[][] = []
    bench.ctx.on('settings/changed', ns => seen.push(['settings', ns]))
    bench.ctx.on('credentials/changed', ref => seen.push(['credentials', ref]))
    bench.ctx.on('models/changed', () => seen.push(['models']))
    bench.sinks?.onHostEnvelope?.({ rpcId: 'r3' as never, payload: { type: 'host/settings-changed', ns: 'llm-pi-ai' } })
    bench.sinks?.onHostEnvelope?.({ rpcId: 'r4' as never, payload: { type: 'host/credentials-changed', ref: 'OPENAI_API_KEY' } })
    bench.sinks?.onHostEnvelope?.({ rpcId: 'r5' as never, payload: { type: 'host/models-changed' } })
    expect(seen).toEqual([
      ['settings', 'llm-pi-ai'],
      ['credentials', 'OPENAI_API_KEY'],
      ['models'],
    ])
  })

  it('broadcasts connection/reset on every established generation (reconnect invalidation)', async () => {
    const bench = await mount()
    let resets = 0
    bench.ctx.on('connection/reset', () => { resets++ })
    bench.sinks?.onConnected?.()
    bench.sinks?.onConnected?.() // second generation after a reconnect
    expect(resets).toBe(2)
  })
})
