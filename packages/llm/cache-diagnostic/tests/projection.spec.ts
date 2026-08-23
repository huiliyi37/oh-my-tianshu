import { describe, expect, it } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import { createAssistantMessage } from '@huiliyi37/dsh-llm'
import type { TokenUsage } from '@huiliyi37/dsh-llm'
import SessionStore from '@huiliyi37/dsh-session'
import type { Session } from '@huiliyi37/dsh-session'
import SessionProjectionRegistry from '@huiliyi37/dsh-session-projection'
import CacheDiagnosticService from '@huiliyi37/dsh-cache-diagnostic'
import type { CacheHealthProjection } from '@huiliyi37/dsh-cache-diagnostic'

async function harness(): Promise<{
  ctx: Context
  session: Session
  diagnosticFiber: Awaited<ReturnType<Context['plugin']>>
}> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  const diagnosticFiber = await ctx.plugin(CacheDiagnosticService)
  return { ctx, session: ctx.sessions.create(), diagnosticFiber }
}

/** TokenUsage buckets are disjoint: input = uncached share, then cacheRead, cacheWrite. */
function usage(input: number, cacheRead: number, cacheWrite: number): TokenUsage {
  return { inputTokens: input, outputTokens: 0, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite }
}

function appendUsage(session: Session, turn: number, step: number, u: TokenUsage): void {
  session.append('assistant/message', {
    turn,
    step,
    message: createAssistantMessage({ content: [], source: { provider: 'mock', model: 'm' } }),
    usage: u,
  }, { surfaceOp: 'append' })
}

async function read(
  ctx: Context,
  session: Session,
): Promise<CacheHealthProjection> {
  const value = ctx.sessionProjections.snapshot(session).values.cacheHealth
  if (value === undefined) throw new Error('cacheHealth projection not registered')
  return value
}

describe('cacheHealth projection', () => {
  it('starts empty and fills as usage lands', async () => {
    const { ctx, session } = await harness()
    expect(await read(ctx, session)).toEqual({})

    appendUsage(session, 1, 1, usage(1200, 1000, 200))
    const projection = await read(ctx, session)
    // Disjoint math: 1000 cached over 1200 + 1000 + 200 billed input.
    expect(projection.hitRate).toBeCloseTo(1000 / 2400, 5)
    expect(projection.recentTurnHitRate).toBeCloseTo(1000 / 2400, 5)
    expect(projection.lastMissReason).toBeUndefined()
  })

  it('reports cumulative and per-turn rates across turns', async () => {
    const { ctx, session } = await harness()
    appendUsage(session, 1, 1, usage(1000, 800, 200))
    appendUsage(session, 2, 1, usage(2000, 1500, 500))
    const projection = await read(ctx, session)
    expect(projection.hitRate).toBeCloseTo(2300 / 6000, 5)
    expect(projection.recentTurnHitRate).toBeCloseTo(1500 / 4000, 5)
  })

  it('exposes the latest miss reason for an unhealthy turn', async () => {
    const { ctx, session } = await harness()
    session.append('request/header', {
      header: { config: { provider: 'mock', model: 'm' }, system: 'first system' },
      reason: 'initial',
    })
    appendUsage(session, 1, 1, usage(1000, 500, 500))
    session.append('request/header', {
      header: { config: { provider: 'mock', model: 'm' }, system: 'second system, different bytes' },
      reason: 'change',
    })
    appendUsage(session, 2, 1, usage(2000, 1000, 1000))

    const projection = await read(ctx, session)
    expect(projection.lastMissReason).toBe('prefix_drift')
    expect(projection.drift).toEqual({
      systemChanged: true,
      toolsChanged: false,
      configChanged: false,
    })
  })

  it('unregisters the projection when the service is unloaded', async () => {
    const { ctx, diagnosticFiber } = await harness()
    expect(ctx.get('cacheDiagnostic')).toBeInstanceOf(CacheDiagnosticService)
    await diagnosticFiber.dispose()
    expect(ctx.get('cacheDiagnostic')).toBeUndefined()
  })
})
