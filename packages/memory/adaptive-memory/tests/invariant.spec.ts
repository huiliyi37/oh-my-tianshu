/**
 * adaptive-memory invariant 伴侣单测。
 *
 * 行为契约：STM 快照（memory:stm section）渲染的短 id 必须由此前最近一次
 * memory/stm-selected 的 entryIds 前缀还原；memory/* 事件必须 log-only
 * （无 surfaceOp）且形状合法。独立 Session 不经 ctx 派发，被测事件一律
 * 手动 emit（与 time-context 伴侣测试同例）。
 *
 * @module @huiliyi37/dsh-adaptive-memory/tests/invariant
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import { createUserMessage } from '@huiliyi37/dsh-llm'
import SessionStore, { Session, SessionId } from '@huiliyi37/dsh-session'
import type { SessionEvent } from '@huiliyi37/dsh-session'
import InvariantService from '@huiliyi37/dsh-invariants'
import * as AdaptiveMemoryInvariant from '../src/invariant.ts'

const ENTRY_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantService, { enabled: true })
  await ctx.plugin(AdaptiveMemoryInvariant)
  return ctx
}

/** 造一个已记录 stm-selected 决策的会话（作为快照校验的历史）。 */
function sessionWithDecision(id: string, entryIds: string[]): Session {
  const session = Session.create(SessionId(id))
  session.append('turn/start', { turn: 1 })
  session.append('memory/cache-miss', { intentId: 'intent-1', intentKey: 'fix-login', turn: 1, reason: 'initial' })
  session.append('memory/stm-selected', { intentId: 'intent-1', intentKey: 'fix-login', turn: 1, entryIds })
  return session
}

/** 造一个含 memory:stm section 的 context-snapshot 事件。 */
function stmSnapshotEvent(text: string): SessionEvent {
  return {
    type: 'user/message',
    seq: 0,
    time: 0,
    data: createUserMessage({
      content: [{ type: 'text', text }],
      source: {
        kind: 'plugin',
        plugin: '@huiliyi37/dsh-system-prompt',
        form: 'snapshot',
        sections: [{ name: 'memory:stm', text }],
      },
    }),
    surfaceOp: 'append',
  }
}

describe('adaptive-memory invariants', () => {
  it('接受：快照短 id 由此前 stm-selected 的 entryIds 前缀还原', async () => {
    const ctx = await setup()
    const session = sessionWithDecision('adaptive-inv-ok', [ENTRY_ID])
    const snapshot = stmSnapshotEvent(`相关项目记忆：\n- ${ENTRY_ID.slice(0, 8)} | auth | 摘要 | 关键词`)
    expect(() => { ctx.emit('session/event', session, snapshot) }).not.toThrow()
  })

  it('拒绝：快照渲染了未被 stm-selected 记录的条目', async () => {
    const ctx = await setup()
    const session = sessionWithDecision('adaptive-inv-alien', [ENTRY_ID])
    expect(() => { ctx.emit('session/event', session, stmSnapshotEvent('相关项目记忆：\n- ffffffff | auth | 外来条目 | -')) })
      .toThrow(/not covered/)
  })

  it('拒绝：没有任何 stm-selected 就出现 STM 快照', async () => {
    const ctx = await setup()
    const session = Session.create(SessionId('adaptive-inv-orphan'))
    session.append('turn/start', { turn: 1 })
    const snapshot = stmSnapshotEvent(`相关项目记忆：\n- ${ENTRY_ID.slice(0, 8)} | auth | 摘要 | -`)
    expect(() => { ctx.emit('session/event', session, snapshot) }).toThrow(/must follow a memory\/stm-selected/)
  })

  it('拒绝：memory/* 事件带 surfaceOp（必须 log-only）', async () => {
    const ctx = await setup()
    const session = Session.create(SessionId('adaptive-inv-surface'))
    const event = {
      type: 'memory/cache-hit',
      seq: 0,
      time: 0,
      data: { intentId: 'intent-1', intentKey: 'fix-login', turn: 1 },
      surfaceOp: 'append',
    } as unknown as SessionEvent
    expect(() => { ctx.emit('session/event', session, event) }).toThrow(/log-only/)
  })

  it('拒绝：stm-selected 的 entryIds 重复', async () => {
    const ctx = await setup()
    const session = Session.create(SessionId('adaptive-inv-dup'))
    const event: SessionEvent = {
      type: 'memory/stm-selected',
      seq: 0,
      time: 0,
      data: { intentId: 'intent-1', intentKey: 'fix-login', turn: 1, entryIds: [ENTRY_ID, ENTRY_ID] },
    }
    expect(() => { ctx.emit('session/event', session, event) }).toThrow(/unique/)
  })

  it('拒绝：intent 名为空或 turn 非法', async () => {
    const ctx = await setup()
    const session = Session.create(SessionId('adaptive-inv-empty'))
    const emptyIntent: SessionEvent = {
      type: 'memory/cache-hit',
      seq: 0,
      time: 0,
      data: { intentId: '', intentKey: 'fix-login', turn: 1 },
    }
    expect(() => { ctx.emit('session/event', session, emptyIntent) }).toThrow(/non-empty intent/)
    const emptyKey: SessionEvent = {
      type: 'memory/cache-hit',
      seq: 0,
      time: 0,
      data: { intentId: 'intent-1', intentKey: '', turn: 1 },
    }
    expect(() => { ctx.emit('session/event', session, emptyKey) }).toThrow(/non-empty intent/)
    const badTurn: SessionEvent = {
      type: 'memory/cache-hit',
      seq: 0,
      time: 0,
      data: { intentId: 'intent-1', intentKey: 'fix-login', turn: 0 },
    }
    expect(() => { ctx.emit('session/event', session, badTurn) }).toThrow(/positive safe integer/)
  })

  it('非 STM 快照与无 memory:stm section 的 snapshot 不校验短 id', async () => {
    const ctx = await setup()
    const session = Session.create(SessionId('adaptive-inv-plain'))
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'hello' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    const otherSnapshot: SessionEvent = {
      type: 'user/message',
      seq: 0,
      time: 0,
      data: createUserMessage({
        content: [{ type: 'text', text: 'other' }],
        source: {
          kind: 'plugin',
          plugin: '@huiliyi37/dsh-system-prompt',
          form: 'snapshot',
          sections: [{ name: 'other:section', text: 'x' }],
        },
      }),
      surfaceOp: 'append',
    }
    expect(() => { ctx.emit('session/event', session, otherSnapshot) }).not.toThrow()
  })

  it('安装时扫描 store 里已有会话的既有 memory 事件', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(InvariantService, { enabled: true })
    let session: Session | undefined
    await ctx.plugin({
      name: 'seed-preloaded',
      inject: ['sessions'],
      apply(inner: Context) {
        session = inner.sessions.create(SessionId('adaptive-inv-preload'))
      },
    })
    if (session === undefined) throw new Error('missing seeded session')
    session.append('turn/start', { turn: 1 })
    session.append('memory/cache-miss', { intentId: 'intent-1', intentKey: 'fix-login', turn: 1, reason: 'initial' })
    session.append('memory/stm-selected', { intentId: 'intent-1', intentKey: 'fix-login', turn: 1, entryIds: [ENTRY_ID] })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'hello' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    await ctx.plugin(AdaptiveMemoryInvariant)
    const snapshot = stmSnapshotEvent(`相关项目记忆：\n- ${ENTRY_ID.slice(0, 8)} | auth | 摘要 | 关键词`)
    expect(() => { ctx.emit('session/event', session, snapshot) }).not.toThrow()
  })
})
