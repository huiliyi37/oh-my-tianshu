/**
 * The agent-router invariant companion: router/route records carry a valid
 * payload (known profile, non-empty task, string-array targets, non-empty
 * subagentSessionId) and — when the routed child is live — lineage
 * consistency (the record's session is the child's parent) — on live appends
 * and on loaded history at late registration.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import SessionStore, { Session, SessionId, type SessionEvent } from '@huiliyi37/dsh-session'
import * as AgentRouterInvariant from '../src/invariant.ts'
import InvariantService from '@huiliyi37/dsh-invariants'
import type {} from '../src/index.ts' // 'router/route' 事件声明合并

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantService, { enabled: true })
  await ctx.plugin(AgentRouterInvariant)
  return ctx
}

function routeEvent(overrides: Record<string, unknown> = {}): SessionEvent {
  return {
    type: 'router/route',
    seq: 0,
    time: 0,
    data: {
      profile: 'verifier',
      task: '独立复核「claim」',
      targets: ['src/a.ts'],
      subagentSessionId: 'child-1',
      ...overrides,
    },
  }
}

describe('agent-router route-record invariants', () => {
  it('accepts a well-formed record whose live child names this session as parent', async () => {
    const ctx = await setup()
    const parent = Session.create(SessionId('parent-1'))
    ctx.sessions.create(SessionId('child-1'), { meta: { parentSession: SessionId('parent-1') } })
    expect(() => { ctx.emit('session/event', parent, routeEvent()) }).not.toThrow()
  })

  it('accepts a shape-valid record when the child is not live (shape-only downgrade)', async () => {
    const ctx = await setup()
    const parent = Session.create(SessionId('parent-1'))
    expect(() => { ctx.emit('session/event', parent, routeEvent()) }).not.toThrow()
  })

  it('rejects an unknown profile', async () => {
    const ctx = await setup()
    const parent = Session.create(SessionId('parent-1'))
    expect(() => { ctx.emit('session/event', parent, routeEvent({ profile: 'hacker' })) })
      .toThrow(/known profile/)
  })

  it('rejects an empty task', async () => {
    const ctx = await setup()
    const parent = Session.create(SessionId('parent-1'))
    expect(() => { ctx.emit('session/event', parent, routeEvent({ task: '' })) })
      .toThrow(/non-empty task/)
  })

  it('rejects non-string-array targets', async () => {
    const ctx = await setup()
    const parent = Session.create(SessionId('parent-1'))
    expect(() => { ctx.emit('session/event', parent, routeEvent({ targets: 'src/a.ts' })) })
      .toThrow(/string-array targets/)
  })

  it('rejects an empty subagentSessionId', async () => {
    const ctx = await setup()
    const parent = Session.create(SessionId('parent-1'))
    expect(() => { ctx.emit('session/event', parent, routeEvent({ subagentSessionId: '' })) })
      .toThrow(/non-empty subagentSessionId/)
  })

  it('rejects a lineage mismatch when the child is live with another parent', async () => {
    const ctx = await setup()
    const parent = Session.create(SessionId('parent-1'))
    ctx.sessions.create(SessionId('child-1'), { meta: { parentSession: SessionId('parent-2') } })
    expect(() => { ctx.emit('session/event', parent, routeEvent()) })
      .toThrow(/parentSession/)
  })

  it('ignores unrelated session events', async () => {
    const ctx = await setup()
    const parent = Session.create(SessionId('parent-1'))
    expect(() => {
      ctx.emit('session/event', parent, { type: 'turn/start', seq: 0, time: 0, data: { turn: 1 } } as SessionEvent)
    }).not.toThrow()
  })

  it('accepts well-formed self/delegate decision records and rejects malformed ones', async () => {
    const ctx = await setup()
    const parent = Session.create(SessionId('parent-1'))
    const metrics = { interventionLevel: 'none', consecutiveFailures: 0, unresolvedHigh: 0, verifications: 0, probeCooledTargets: 0 }
    const decision = (over: Record<string, unknown> = {}): SessionEvent => ({
      type: 'router/decision',
      seq: 0,
      time: 0,
      data: {
        decisionId: 'rtdec-3',
        action: 'self',
        reason: 'turn-end',
        mode: 'shadow',
        dispatched: false,
        metrics,
        ...over,
      },
    } as unknown as SessionEvent)
    expect(() => { ctx.emit('session/event', parent, decision()) }).not.toThrow()
    const delegate = decision({
      action: 'delegate',
      profile: 'verifier',
      task: '复核',
      targets: [],
      mode: 'auto',
      dispatched: true,
      subagentSessionId: 'child-7',
    })
    expect(() => { ctx.emit('session/event', parent, delegate) }).not.toThrow()
    // 判别联合卫生：self 不携带 delegate 字段、dispatched 恒 false
    expect(() => { ctx.emit('session/event', parent, decision({ task: 'x' })) })
      .toThrow(/delegate-only fields/)
    expect(() => { ctx.emit('session/event', parent, decision({ dispatched: true })) })
      .toThrow(/dispatched false/)
    // delegate 分支的既有约束
    expect(() => { ctx.emit('session/event', parent, decision({ action: 'delegate' })) })
      .toThrow(/known profile/)
    expect(() => { ctx.emit('session/event', parent, decision({ action: 'hyper' })) })
      .toThrow(/known action/)
    expect(() => { ctx.emit('session/event', parent, decision({ mode: 'hyper' })) })
      .toThrow(/known mode/)
    expect(() => { ctx.emit('session/event', parent, decision({ reason: 'boot' })) })
      .toThrow(/known reason/)
    expect(() => { ctx.emit('session/event', parent, decision({ decisionId: '' })) })
      .toThrow(/decisionId/)
    // 指标输入 fail loud
    expect(() => { ctx.emit('session/event', parent, decision({ metrics: undefined })) })
      .toThrow(/metrics object/)
    expect(() => { ctx.emit('session/event', parent, decision({ metrics: { ...metrics, interventionLevel: 'panic' } })) })
      .toThrow(/interventionLevel/)
    expect(() => { ctx.emit('session/event', parent, decision({ metrics: { ...metrics, consecutiveFailures: -1 } })) })
      .toThrow(/consecutiveFailures/)
  })

  it('rejects a dispatched decision whose live child names another parent', async () => {
    const ctx = await setup()
    const parent = Session.create(SessionId('parent-1'))
    ctx.sessions.create(SessionId('child-1'), { meta: { parentSession: SessionId('parent-2') } })
    const decision = {
      type: 'router/decision',
      seq: 0,
      time: 0,
      data: {
        decisionId: 'rtdec-1',
        action: 'delegate',
        profile: 'verifier',
        task: '复核',
        targets: [],
        reason: 'turn-end',
        mode: 'auto',
        dispatched: true,
        subagentSessionId: 'child-1',
        metrics: { interventionLevel: 'escalate', consecutiveFailures: 2, unresolvedHigh: 0, verifications: 0, probeCooledTargets: 0 },
      },
    } as unknown as SessionEvent
    expect(() => { ctx.emit('session/event', parent, decision) })
      .toThrow(/parentSession/)
  })

  it('accepts a well-formed outcome record and rejects malformed ones', async () => {
    const ctx = await setup()
    const parent = Session.create(SessionId('parent-1'))
    ctx.sessions.create(SessionId('child-1'), { meta: { parentSession: SessionId('parent-1') } })
    const outcome = (over: Record<string, unknown> = {}): SessionEvent => ({
      type: 'router/outcome',
      seq: 0,
      time: 0,
      data: { subagentSessionId: 'child-1', stopReason: 'completed', ...over },
    })
    expect(() => { ctx.emit('session/event', parent, outcome()) }).not.toThrow()
    expect(() => { ctx.emit('session/event', parent, outcome({ subagentSessionId: '' })) })
      .toThrow(/non-empty subagentSessionId/)
    expect(() => { ctx.emit('session/event', parent, outcome({ stopReason: '' })) })
      .toThrow(/non-empty stopReason/)
  })

  it('rejects a route record with a malformed budget', async () => {
    const ctx = await setup()
    const parent = Session.create(SessionId('parent-1'))
    const route = (budget: unknown): SessionEvent => ({
      type: 'router/route',
      seq: 0,
      time: 0,
      data: {
        profile: 'verifier',
        task: '复核',
        targets: [],
        subagentSessionId: 'child-1',
        budget,
      },
    } as SessionEvent)
    expect(() => { ctx.emit('session/event', parent, route(undefined)) }).not.toThrow()
    expect(() => { ctx.emit('session/event', parent, route({ maxTurns: 0, deadlineMs: 1 })) })
      .toThrow(/maxTurns/)
    expect(() => { ctx.emit('session/event', parent, route({ maxTurns: 1, deadlineMs: -5 })) })
      .toThrow(/deadlineMs/)
  })

  it('rejects an outcome whose live child names another parent', async () => {
    const ctx = await setup()
    const parent = Session.create(SessionId('parent-1'))
    ctx.sessions.create(SessionId('child-1'), { meta: { parentSession: SessionId('parent-2') } })
    const outcome = {
      type: 'router/outcome',
      seq: 0,
      time: 0,
      data: { subagentSessionId: 'child-1', stopReason: 'completed' },
    } as SessionEvent
    expect(() => { ctx.emit('session/event', parent, outcome) })
      .toThrow(/parentSession/)
  })

  it('accepts a well-formed adoption after its outcome and rejects violations', async () => {
    const ctx = await setup()
    const parent = Session.create(SessionId('parent-1'))
    ctx.sessions.create(SessionId('child-1'), { meta: { parentSession: SessionId('parent-1') } })
    const outcome = {
      type: 'router/outcome',
      seq: 0,
      time: 0,
      data: { subagentSessionId: 'child-1', stopReason: 'completed' },
    } as SessionEvent
    const adoption = (over: Record<string, unknown> = {}): SessionEvent => ({
      type: 'router/adoption',
      seq: 1,
      time: 1,
      data: { subagentSessionId: 'child-1', verdict: 'adopt', reason: '整合进结论', ...over },
    })
    ctx.emit('session/event', parent, outcome)
    expect(() => { ctx.emit('session/event', parent, adoption()) }).not.toThrow()
    // 每条 outcome 至多一条声明
    expect(() => { ctx.emit('session/event', parent, adoption()) }).toThrow(/at most one declaration/)
  })

  it('rejects an adoption without a prior outcome, a bad verdict, and a bad reason', async () => {
    const ctx = await setup()
    const parent = Session.create(SessionId('parent-1'))
    const adoption = (over: Record<string, unknown> = {}): SessionEvent => ({
      type: 'router/adoption',
      seq: 0,
      time: 0,
      data: { subagentSessionId: 'child-x', verdict: 'adopt', reason: 'r', ...over },
    })
    expect(() => { ctx.emit('session/event', parent, adoption()) }).toThrow(/without a prior outcome/)
    const withOutcome = Session.create(SessionId('parent-2'))
    ctx.emit('session/event', withOutcome, {
      type: 'router/outcome',
      seq: 0,
      time: 0,
      data: { subagentSessionId: 'child-x', stopReason: 'completed' },
    } as SessionEvent)
    expect(() => { ctx.emit('session/event', withOutcome, adoption({ verdict: 'maybe' })) }).toThrow(/known verdict/)
    expect(() => { ctx.emit('session/event', withOutcome, adoption({ reason: '' })) }).toThrow(/non-empty reason/)
  })

  it('accepts a well-formed evaluation after its decision and rejects violations', async () => {
    const ctx = await setup()
    const parent = Session.create(SessionId('parent-1'))
    const metrics = { interventionLevel: 'none', consecutiveFailures: 0, unresolvedHigh: 0, verifications: 0, probeCooledTargets: 0 }
    ctx.emit('session/event', parent, {
      type: 'router/decision',
      seq: 0,
      time: 0,
      data: { decisionId: 'rtdec-1', action: 'self', reason: 'turn-end', mode: 'shadow', dispatched: false, metrics },
    } as unknown as SessionEvent)
    const evaluation = (over: Record<string, unknown> = {}): SessionEvent => ({
      type: 'router/evaluation',
      seq: 1,
      time: 1,
      data: { decisionId: 'rtdec-1', classification: 'recovered', samples: 8, windowFailures: 2, ...over },
    } as unknown as SessionEvent)
    expect(() => { ctx.emit('session/event', parent, evaluation()) }).not.toThrow()
    // 每条 decision 至多一条 evaluation
    expect(() => { ctx.emit('session/event', parent, evaluation()) }).toThrow(/at most one evaluation/)
    // 引用不存在的决策 fail loud
    expect(() => { ctx.emit('session/event', parent, evaluation({ decisionId: 'rtdec-404' })) })
      .toThrow(/unknown decision/)
    // 形状违规
    expect(() => { ctx.emit('session/event', parent, evaluation({ classification: 'fine' })) })
      .toThrow(/known classification/)
    expect(() => { ctx.emit('session/event', parent, evaluation({ samples: -1 })) })
      .toThrow(/samples/)
    expect(() => { ctx.emit('session/event', parent, evaluation({ windowFailures: 1.5 })) })
      .toThrow(/windowFailures/)
  })

  it('rejects an evaluation without any prior decision on the same log', async () => {
    const ctx = await setup()
    const parent = Session.create(SessionId('parent-1'))
    const other = Session.create(SessionId('parent-2'))
    const metrics = { interventionLevel: 'none', consecutiveFailures: 0, unresolvedHigh: 0, verifications: 0, probeCooledTargets: 0 }
    // 决策在另一条日志上：本会话的评估引用不了它
    ctx.emit('session/event', other, {
      type: 'router/decision',
      seq: 0,
      time: 0,
      data: { decisionId: 'rtdec-9', action: 'self', reason: 'turn-end', mode: 'shadow', dispatched: false, metrics },
    } as unknown as SessionEvent)
    expect(() => { ctx.emit('session/event', parent, {
      type: 'router/evaluation',
      seq: 0,
      time: 0,
      data: { decisionId: 'rtdec-9', classification: 'persisted', samples: 3, windowFailures: 3 },
    } as unknown as SessionEvent) }).toThrow(/unknown decision/)
  })

  it('accepts well-formed gate records and rejects verdict/signal mismatches', async () => {
    const ctx = await setup()
    const parent = Session.create(SessionId('parent-1'))
    const gate = (over: Record<string, unknown> = {}): SessionEvent => ({
      type: 'router/gate',
      seq: 0,
      time: 0,
      data: { kind: 'shadow-readiness', verdict: 'pass', vetoSignals: [], ...over },
    } as unknown as SessionEvent)
    expect(() => { ctx.emit('session/event', parent, gate()) }).not.toThrow()
    expect(() => { ctx.emit('session/event', parent, gate({ kind: 'canary-health' })) }).not.toThrow()
    expect(() => { ctx.emit('session/event', parent, gate({ kind: 'vibes' })) }).toThrow(/known kind/)
    expect(() => { ctx.emit('session/event', parent, gate({ verdict: 'maybe' })) }).toThrow(/known verdict/)
    expect(() => { ctx.emit('session/event', parent, gate({ vetoSignals: 'samples' })) })
      .toThrow(/string-array vetoSignals/)
    expect(() => { ctx.emit('session/event', parent, gate({ verdict: 'pass', vetoSignals: ['x'] })) })
      .toThrow(/must cite no veto signals/)
    expect(() => { ctx.emit('session/event', parent, gate({ verdict: 'veto', vetoSignals: [] })) })
      .toThrow(/at least one veto signal/)
  })

  it('accepts a bounded finding on an outcome and rejects malformed ones', async () => {
    const ctx = await setup()
    const parent = Session.create(SessionId('parent-1'))
    const outcome = (finding: unknown): SessionEvent => ({
      type: 'router/outcome',
      seq: 0,
      time: 0,
      data: { subagentSessionId: 'child-1', stopReason: 'completed', ...(finding === undefined ? {} : { finding }) },
    } as unknown as SessionEvent)
    // 合法：verify 带三值裁定；scout 无 verdict
    expect(() => { ctx.emit('session/event', parent, outcome({
      kind: 'verify', summary: 'reproduced the crash', findings: ['test X fails on main'], verdict: 'supported',
    })) }).not.toThrow()
    expect(() => { ctx.emit('session/event', parent, outcome({
      kind: 'scout', summary: 'hot spot', findings: ['a', 'b'],
    })) }).not.toThrow()
    // 形状非法 fail loud
    expect(() => { ctx.emit('session/event', parent, outcome({ kind: 'alien' })) })
      .toThrow(/kind must be scout \| verify/)
    expect(() => { ctx.emit('session/event', parent, outcome({ kind: 'scout', summary: '', findings: [] })) })
      .toThrow(/summary/)
    expect(() => { ctx.emit('session/event', parent, outcome({ kind: 'scout', summary: 's'.repeat(1201), findings: [] })) })
      .toThrow(/summary/)
    expect(() => { ctx.emit('session/event', parent, outcome({ kind: 'scout', summary: 's', findings: Array.from({ length: 9 }, () => 'x') })) })
      .toThrow(/findings/)
    expect(() => { ctx.emit('session/event', parent, outcome({ kind: 'scout', summary: 's', findings: ['x'.repeat(401)] })) })
      .toThrow(/findings/)
    expect(() => { ctx.emit('session/event', parent, outcome({ kind: 'verify', summary: 's', findings: [], verdict: 'maybe' })) })
      .toThrow(/verdict/)
    expect(() => { ctx.emit('session/event', parent, outcome({ kind: 'scout', summary: 's', findings: [], verdict: 'supported' })) })
      .toThrow(/must not carry a verdict/)
  })

  it('rejects invalid existing state on late registration', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create()
    // 非法 payload 刻意违反声明类型（不变量测试的职责）；as never 命名该偏差。
    session.append('router/route', { profile: 'hacker', task: 't', targets: [], subagentSessionId: 'x' } as never)
    await ctx.plugin(InvariantService, { enabled: true })

    await expect(ctx.plugin(AgentRouterInvariant).then(() => undefined)).rejects.toThrow(/known profile/)
  })

  it('replays valid existing state and keeps constraining later appends', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create()
    session.append('router/route', { profile: 'verifier', task: 't', targets: [], subagentSessionId: 'child-9' })
    await ctx.plugin(InvariantService, { enabled: true })
    await ctx.plugin(AgentRouterInvariant)

    expect(() => {
      // 非法 payload 刻意违反声明类型（不变量测试的职责）；as never 命名该偏差。
      session.append('router/route', { profile: 'hacker', task: 't', targets: [], subagentSessionId: 'x' } as never)
    }).toThrow(/known profile/)
  })
})
