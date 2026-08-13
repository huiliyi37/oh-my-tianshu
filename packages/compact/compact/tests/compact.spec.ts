import { createUserMessage } from '@huiliyi37/dsh-llm'
import { describe, expect, it } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import {
  CompactionId,
  CompactService,
  compactCheckpointSource,
  isCompactCheckpointSource,
} from '@huiliyi37/dsh-compact'
import type { CompactionResult, CompactionTrigger } from '@huiliyi37/dsh-compact'
import { Session, SessionId } from '@huiliyi37/dsh-session'
import type { CompactAgentContext } from '@huiliyi37/dsh-compact'
import type { ManualCompactAgentContext } from '@huiliyi37/dsh-compact'

/**
 * A trivial concrete CompactService implementing the abstract contract. The
 * Service Definition package owns no algorithm — these tests exercise its contract:
 * service registration, the abstract method shape, and the `compact/*` event
 * declaration merge.
 */
class StubCompactService extends CompactService {
  /** Records the signal handed to the most recent call, to prove it threads through. */
  lastSignal: AbortSignal | undefined

  override async compactIfNeeded(
    _agent: CompactAgentContext,
    _trigger: CompactionTrigger,
    signal: AbortSignal,
  ): Promise<CompactionResult | null> {
    this.lastSignal = signal
    return null
  }

  override async compactNow(
    _agent: ManualCompactAgentContext,
    signal: AbortSignal,
  ): Promise<CompactionResult | null> {
    this.lastSignal = signal
    return null
  }

  override async compactRegion(
    start: number,
    end: number,
    agent: CompactAgentContext,
    signal?: AbortSignal,
  ): Promise<CompactionResult> {
    this.lastSignal = signal
    const session = agent.session
    const summary = [{ type: 'text' as const, text: 'stub' }]
    const surface = session.surface.nodes
    const startIndex = surface.indexOf(start)
    const endIndex = surface.indexOf(end)
    if (startIndex < 0 || endIndex < startIndex) { throw new Error('stub compact range is invalid') }
    const shadowedSeqs = surface.slice(startIndex, endIndex + 1)
    const compactionId = CompactionId('stub-compaction')
    // Minimal stub honoring the lock + log-only event contract.
    const startEvent = session.append('compact/start', { compactionId, turn: 0 })
    const summaryEvent = session.append('compact/summary', {
      compactionId,
      summary,
      shadowedRange: { start, end },
      shadowedSeqs,
      shadowedTokenCount: 0,
      provider: 'mock',
      model: 'stub',
    })
    session.append('user/message', createUserMessage({
      content: summary,
      source: compactCheckpointSource(compactionId),
    }), {
      surfaceOp: { op: 'replace', start, end },
      sourceEventSeqs: [startEvent.seq, summaryEvent.seq, ...shadowedSeqs],
    })
    const endEvent = session.append('compact/end', { compactionId, turn: 0 })
    return {
      compactionId,
      startSeq: startEvent.seq,
      summarySeq: summaryEvent.seq,
      endSeq: endEvent.seq,
      summary,
      shadowedRange: { start, end },
      shadowedSeqs,
      shadowedTokenCount: 0,
    }
  }
}

describe('CompactService seam', () => {
  function stubAgent(session: Session, model?: string): CompactAgentContext {
    return { session, options: model !== undefined ? { model } : {} }
  }

  it('registers as ctx.compact', () => {
    const ctx = new Context()
    void new StubCompactService(ctx)
    expect(ctx.compact).toBeDefined()
    expect(ctx.compact).toBeInstanceOf(StubCompactService)
  })

  it('disposing the fiber unregisters ctx.compact (HMR safety)', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(StubCompactService)
    expect(ctx.compact).toBeInstanceOf(StubCompactService)
    await fiber.dispose()
    expect(ctx.compact).toBeUndefined()
  })

  it('exposes the abstract contract methods', async () => {
    const ctx = new Context()
    const svc = new StubCompactService(ctx)
    const session = Session.create(SessionId('s'))
    expect(await svc.compactIfNeeded(stubAgent(session), 'pressure', new AbortController().signal)).toBeNull()
    const signal = new AbortController().signal
    expect(await svc.compactNow({
      ...stubAgent(session),
      runMaintenance: task => task(new AbortController().signal),
    }, signal)).toBeNull()
    expect(svc.lastSignal).toBe(signal)
  })

  it('compact/* events merge into SessionEventMap and are log-only', async () => {
    const ctx = new Context()
    const svc = new StubCompactService(ctx)
    const session = Session.create(SessionId('s'))
    const original = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'original' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    const result = await svc.compactRegion(original.seq, original.seq, stubAgent(session, 'm'))

    const startEvent = session.events.find(e => e.type === 'compact/start')
    expect(startEvent).toBeDefined()
    // Log-only: the compiler rejects surfaceOp on compact/* (not a SurfaceEventType);
    // verify the runtime value is absent.
    const raw = startEvent as unknown as { surfaceOp?: unknown }
    expect(raw.surfaceOp).toBeUndefined()
    expect(result.summary).toEqual([{ type: 'text', text: 'stub' }])
    expect(result.summarySeq).toBeGreaterThan(result.startSeq)
    expect(result.endSeq).toBeGreaterThan(result.summarySeq)
    expect(result.shadowedRange).toEqual({ start: original.seq, end: original.seq })
    expect(result.shadowedSeqs).toEqual([original.seq])
    const checkpoint = session.events.find(event => event.type === 'user/message'
      && isCompactCheckpointSource(event.data.source))
    expect(checkpoint?.type === 'user/message' && checkpoint.data.source)
      .toEqual(compactCheckpointSource(result.compactionId))
    expect(isCompactCheckpointSource({ kind: 'plugin', plugin: 'other' })).toBe(false)
    expect(isCompactCheckpointSource({ kind: 'user' })).toBe(false)
    expect(session.events.filter(e => e.type.startsWith('compact/')).map(e => e.type))
      .toEqual(['compact/start', 'compact/summary', 'compact/end'])
  })

  it('threads the cancellation signal through to the backend', async () => {
    const ctx = new Context()
    const svc = new StubCompactService(ctx)
    const session = Session.create(SessionId('s'))
    const controller = new AbortController()
    const original = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'original' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    await svc.compactRegion(original.seq, original.seq, stubAgent(session, 'm'), controller.signal)
    expect(svc.lastSignal).toBe(controller.signal)

    await svc.compactIfNeeded(stubAgent(session), 'context-overflow', controller.signal)
    expect(svc.lastSignal).toBe(controller.signal)
  })
})
