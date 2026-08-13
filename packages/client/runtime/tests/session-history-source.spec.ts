import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionEvent } from '@huiliyi37/dsh-session/types'
import type { SessionId } from '@huiliyi37/dsh-client-connection/client'
import { SessionHistorySource } from '../src/client/session-history/source.ts'
import { FakeApiClient, deferred, err, ok } from './fake-api.ts'
import { entries, ev, plainTurn } from './event-script.ts'

const SID = 'history-s1' as SessionId

afterEach(() => {
  vi.unstubAllGlobals()
})

function histResponse(events: SessionEvent[], hasMore = false) {
  return Promise.resolve(ok({ events: entries(events) as never[], hasMore }))
}

describe('SessionHistorySource', () => {
  it('loads the tail first and prepends older pages on demand', async () => {
    const pages = [
      plainTurn(0, 0, '最早问', '最早答'),
      plainTurn(6, 1, '中间问', '中间答'),
      plainTurn(12, 2, '最新问', '最新答'),
    ]
    const api = new FakeApiClient()
    api.onHistory = (payload) => {
      if (payload.beforeSeq === undefined) return histResponse(pages[2]!, true)
      if (payload.beforeSeq === 12) return histResponse(pages[1]!, true)
      return histResponse(pages[0]!, false)
    }
    const source = new SessionHistorySource(SID, api)

    await source.loadTail()

    expect(api.callsOf('session.history')).toHaveLength(1)
    expect(source.getSnapshot().hasMore).toBe(true)
    expect(source.getSnapshot().baseSeq).toBe(12)
    expect(source.getSnapshot().inspection.eventNodes.map(node => node.seq))
      .toEqual([13, 15])

    expect(await source.loadOlder()).toBe(true)
    expect(await source.loadOlder()).toBe(true)
    expect(await source.loadOlder()).toBe(false)

    expect(api.callsOf('session.history')).toHaveLength(3)
    expect(source.getSnapshot().hasMore).toBe(false)
    expect(source.getSnapshot().baseSeq).toBe(0)
    expect(source.getSnapshot().inspection.eventNodes.map(node => node.seq))
      .toEqual([1, 3, 7, 9, 13, 15])
  })

  it('pins a lazy inspection to the entries in its source snapshot', async () => {
    const api = new FakeApiClient()
    api.onHistory = () => histResponse(plainTurn(0, 0, '问', '答'))
    const source = new SessionHistorySource(SID, api)
    await source.loadTail()
    const before = source.getSnapshot()

    source.handleMuxFrame({
      type: 'session/event',
      sessionId: SID,
      event: ev.user(6, 'later'),
    })

    expect(before.inspection.eventNodes.map(node => node.seq)).toEqual([1, 3])
    expect(source.getSnapshot().inspection.eventNodes.map(node => node.seq))
      .toEqual([1, 3, 6])
  })

  it('publishes multiple assistant chunks once per browser frame', async () => {
    const api = new FakeApiClient()
    api.onHistory = () => histResponse(plainTurn(0, 0, '问', '答'))
    const source = new SessionHistorySource(SID, api)
    await source.loadTail()
    const frames: Array<FrameRequestCallback> = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    let notifications = 0
    const unsubscribe = source.subscribe(() => { notifications++ })
    const before = source.getSnapshot().inspection
    const finalizedNodes = before.eventNodes
    const requests = before.requests
    const contexts = before.contexts

    for (const event of [
      ev.chunkStart(6, 1),
      ev.chunkText(7, 1, 'stream '),
      ev.chunkText(8, 1, 'content'),
    ]) {
      source.handleMuxFrame({
        type: 'session/event',
        sessionId: SID,
        event,
      })
    }

    expect(frames).toHaveLength(1)
    expect(notifications).toBe(0)
    frames[0]?.(0)
    await Promise.resolve()

    expect(notifications).toBe(1)
    const streamed = source.getSnapshot().inspection
    expect(streamed.eventNodes).toBe(finalizedNodes)
    expect(streamed.requests).toBe(requests)
    expect(streamed.contexts).toBe(contexts)
    expect(streamed.partial?.blocks).toEqual([
      { kind: 'text', text: 'stream content' },
    ])

    source.handleMuxFrame({
      type: 'session/event',
      sessionId: SID,
      event: ev.chunkText(9, 1, ' then final'),
    })
    source.handleMuxFrame({
      type: 'session/event',
      sessionId: SID,
      event: ev.assistant(10, 1, 'stream content then final'),
    })
    await Promise.resolve()

    expect(notifications).toBe(2)
    const finalized = source.getSnapshot().inspection
    expect(finalized.eventNodes).not.toBe(finalizedNodes)
    expect(finalized.partial).toBeNull()
    frames[1]?.(0)
    await Promise.resolve()
    expect(notifications).toBe(2)
    unsubscribe()
  })

  it('stops loading when an older page fails to advance', async () => {
    const api = new FakeApiClient()
    api.onHistory = payload => payload.beforeSeq === undefined
      ? histResponse(plainTurn(6, 1, '新问', '新答'), true)
      : Promise.resolve(err({
        code: 'internal',
        message: 'page unavailable',
        details: {},
      }))
    const source = new SessionHistorySource(SID, api)

    await source.loadTail()
    expect(await source.loadOlder()).toBe(false)

    expect(api.callsOf('session.history')).toHaveLength(2)
    expect(source.getSnapshot().hasMore).toBe(true)
  })

  it('finishes an already started older page after consumer cancellation', async () => {
    const middle = deferred<Awaited<ReturnType<FakeApiClient['onHistory']>>>()
    const olderStarted = deferred<undefined>()
    const api = new FakeApiClient()
    api.onHistory = (payload) => {
      if (payload.beforeSeq === undefined) {
        return histResponse(plainTurn(12, 2, '最新问', '最新答'), true)
      }
      olderStarted.resolve(undefined)
      return middle.promise
    }
    const source = new SessionHistorySource(SID, api)
    const controller = new AbortController()
    await source.loadTail(controller.signal)
    const complete = source.loadOlder(controller.signal)
    await olderStarted.promise
    controller.abort()
    middle.resolve(ok({
      events: entries(plainTurn(6, 1, '中间问', '中间答')) as never[],
      hasMore: true,
    }))

    expect(await complete).toBe(true)

    expect(api.callsOf('session.history')).toHaveLength(2)
    expect(source.getSnapshot().hasMore).toBe(true)
  })
})
