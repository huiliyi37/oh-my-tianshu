/**
 * adapter/sessions — listSessions ordering.
 *
 * 纯单元：注入最小 ctx（sessionPersistence facet + 内存 live store），验证
 * listSessions 的排序语义——live 事件日志覆盖后端值、后端值回退 createdAt、
 * 无 persistence 时仅列 live header。
 */

import { describe, expect, it } from 'vitest'
import type { Context } from '@huiliyi37/cordis'
import type { SessionEvent, SessionHeader, SessionId } from '@huiliyi37/dsh-session'
import { listSessions } from '../src/adapter/sessions.js'

function header(id: string, createdAt: number): SessionHeader {
  return { version: 0, id: id as SessionId, createdAt }
}

function ev(seq: number, time: number): SessionEvent {
  return { type: 'turn/start', seq, time, data: { turn: 1 } } as unknown as SessionEvent
}

interface PersistenceFacetLike {
  list(): Promise<Array<{ header: SessionHeader; lastActivityAt?: number }>>
}

function fakeCtx(over: {
  persistence?: PersistenceFacetLike
  live?: Array<{ header: SessionHeader; events: SessionEvent[] }>
}): Context {
  const live = new Map((over.live ?? []).map(s => [s.header.id, s]))
  return {
    reflect: { get: () => over.persistence },
    sessions: {
      list: () => [...live.values()],
      get: (id: SessionId) => live.get(id),
    },
  } as unknown as Context
}

describe('listSessions ordering', () => {
  it('orders cold entries by lastActivityAt desc, falling back to createdAt when absent', async () => {
    const ctx = fakeCtx({
      persistence: {
        list: () => Promise.resolve([
          { header: header('s-active', 1000), lastActivityAt: 5000 },
          { header: header('s-created', 9000) },
          { header: header('s-old', 2000), lastActivityAt: 3000 },
        ]),
      },
    })
    const rows = await listSessions(ctx)
    // 无活动时间时回退 createdAt：最近创建的会话（9000）顶过仅靠活动值（5000）的会话。
    expect(rows.map(r => r.id)).toEqual(['s-created', 's-active', 's-old'])
    expect(rows[0]!.lastActivityAt).toBeUndefined() // 摘要字段不回退；回退只发生在排序键
    expect(rows[1]!.lastActivityAt).toBe(5000)
    expect(rows[2]!.lastActivityAt).toBe(3000)
  })

  it('folds the live in-memory activity over the backend value', async () => {
    const ctx = fakeCtx({
      persistence: {
        list: () => Promise.resolve([{ header: header('s-live', 1000), lastActivityAt: 4000 }]),
      },
      live: [{ header: header('s-live', 1000), events: [ev(0, 7000), ev(1, 8000)] }],
    })
    const rows = await listSessions(ctx)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.lastActivityAt).toBe(8000)
  })

  it('a live session with no usable events falls back to the backend value', async () => {
    const ctx = fakeCtx({
      persistence: {
        list: () => Promise.resolve([{ header: header('s-x', 1000), lastActivityAt: 5000 }]),
      },
      live: [{ header: header('s-x', 1000), events: [] }],
    })
    const rows = await listSessions(ctx)
    expect(rows[0]!.lastActivityAt).toBe(5000)
  })

  it('without persistence, lists only live headers, still most-recent-first', async () => {
    const ctx = fakeCtx({
      live: [
        { header: header('s-a', 1000), events: [ev(0, 6000)] },
        { header: header('s-b', 1000), events: [ev(0, 9000)] },
      ],
    })
    const rows = await listSessions(ctx)
    expect(rows.map(r => r.id)).toEqual(['s-b', 's-a'])
  })
})
