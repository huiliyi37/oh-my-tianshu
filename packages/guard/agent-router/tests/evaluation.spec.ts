/**
 * evaluation.spec.ts — 决策评估投影（观察窗口分类 + readiness/canary 证据）。
 *
 * 覆盖：配置解析 fail loud、observeWindow/classifyObservation 分类矩阵、
 * pendingEvaluations 的闭合规则（样本满 / 更晚决策取代 / 已归账出列）、
 * shadowReadiness 的假绿与范围健康映射、canaryHealth 的派发/声明/预算/
 * 收益代理统计。
 */
import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@huiliyi37/dsh-session'
import {
  canaryHealth,
  classifyObservation,
  evaluatedDecisions,
  observeWindow,
  pendingEvaluations,
  resolveCanaryConfig,
  resolveEvaluationConfig,
  resolveReadinessConfig,
  shadowReadiness,
} from '../src/evaluation.js'

const CONFIG = resolveEvaluationConfig({})
const READINESS = resolveReadinessConfig({})
const CANARY = resolveCanaryConfig({})

let seq = 0
function toolResult(failed: boolean, exitCodeFail = false): SessionEvent {
  return {
    type: 'tool/result',
    seq: seq++,
    time: 0,
    data: {
      message: {
        content: [{
          content: [{ type: 'text', text: exitCodeFail ? '[exit code: 1] boom' : failed ? 'isError' : 'ok' }],
          isError: failed && !exitCodeFail,
        }],
      },
    },
  } as unknown as SessionEvent
}

function decision(id: string, over: Record<string, unknown> = {}): SessionEvent {
  return {
    type: 'router/decision',
    seq: seq++,
    time: 0,
    data: { decisionId: id, action: 'self', reason: 'turn-end', mode: 'shadow', dispatched: false, metrics: {}, ...over },
  } as unknown as SessionEvent
}

function evaluation(id: string, classification: string, windowFailures = 0): SessionEvent {
  return {
    type: 'router/evaluation',
    seq: seq++,
    time: 0,
    data: { decisionId: id, classification, samples: 8, windowFailures },
  } as unknown as SessionEvent
}

describe('resolve*Config fail loud', () => {
  it('evaluation：非正整数窗口与越界错误率拒绝', () => {
    expect(() => resolveEvaluationConfig({ windowToolResults: 0 })).toThrow(/windowToolResults/)
    expect(() => resolveEvaluationConfig({ minSamples: 1.5 })).toThrow(/minSamples/)
    expect(() => resolveEvaluationConfig({ recoveredConsecutive: -1 })).toThrow(/recoveredConsecutive/)
    expect(() => resolveEvaluationConfig({ persistedErrorRate: 1.2 })).toThrow(/persistedErrorRate/)
    expect(resolveEvaluationConfig({})).toEqual({
      windowToolResults: 8, minSamples: 3, recoveredConsecutive: 3, persistedErrorRate: 0.5,
    })
  })

  it('readiness / canary：形状非法拒绝', () => {
    expect(() => resolveReadinessConfig({ window: 0 })).toThrow(/window/)
    expect(() => resolveReadinessConfig({ maxFalseGreenRate: -0.1 })).toThrow(/maxFalseGreenRate/)
    expect(() => resolveCanaryConfig({ minDispatches: 0 })).toThrow(/minDispatches/)
    expect(() => resolveCanaryConfig({ minBenefitProxy: 2 })).toThrow(/minBenefitProxy/)
  })
})

describe('observeWindow + classifyObservation', () => {
  it('只统计决策之后的 tool/result，样本满即止', () => {
    const events = [decision('d1'), toolResult(true), { type: 'user/message' }, toolResult(false), toolResult(false)] as SessionEvent[]
    const stats = observeWindow(events, 0, CONFIG)
    expect(stats).toEqual({ samples: 3, failures: 1, trailingSuccesses: 2 })
  })

  it('样本不足 → inconclusive', () => {
    const stats = { samples: CONFIG.minSamples - 1, failures: 0, trailingSuccesses: 2 }
    expect(classifyObservation(stats, CONFIG)).toBe('inconclusive')
  })

  it('尾部连续成功达阈值 → recovered', () => {
    const stats = { samples: 5, failures: 2, trailingSuccesses: CONFIG.recoveredConsecutive }
    expect(classifyObservation(stats, CONFIG)).toBe('recovered')
  })

  it('错误率达阈值 → persisted', () => {
    const stats = { samples: 4, failures: 2, trailingSuccesses: 1 }
    expect(classifyObservation(stats, CONFIG)).toBe('persisted')
  })

  it('中间地带 → inconclusive', () => {
    const stats = { samples: 4, failures: 1, trailingSuccesses: 2 }
    expect(classifyObservation(stats, CONFIG)).toBe('inconclusive')
  })
})

describe('pendingEvaluations', () => {
  it('样本满即到期；已归账出列；更晚决策取代未满窗口', () => {
    const events: SessionEvent[] = [decision('d1')]
    expect(pendingEvaluations(events, CONFIG)).toHaveLength(0)
    for (let i = 0; i < 8; i++) events.push(toolResult(false))
    // 窗口满 → d1 到期
    let due = pendingEvaluations(events, CONFIG)
    expect(due.map(entry => entry.decisionId)).toEqual(['d1'])
    events.push(evaluation('d1', 'persisted', 8))
    // 已归账 → 出列
    expect(pendingEvaluations(events, CONFIG)).toHaveLength(0)
    // 未满窗口被更晚决策取代 → 旧决策到期，新决策未满不出
    events.push(decision('d2'))
    due = pendingEvaluations(events, CONFIG)
    expect(due.map(entry => entry.decisionId)).toEqual(['d1'])
    expect(due[0]!.decisionIndex).toBe(0)
  })

  it('多条在途决策各自独立计数（重叠窗口）', () => {
    const events: SessionEvent[] = [decision('d1'), toolResult(true), decision('d2'), toolResult(true)]
    // d1 被 d2 取代 → 到期；d2 样本 1 < 8 → 未到期
    const due = pendingEvaluations(events, CONFIG)
    expect(due.map(entry => entry.decisionId)).toEqual(['d1'])
  })

  it('final 模式：日志终结时所有未归账决策到期（会话尾部不漏记）', () => {
    const events: SessionEvent[] = [decision('d1'), toolResult(true), decision('d2')]
    // 常规模式：d1 被取代到期，d2 样本 0 未到期。
    expect(pendingEvaluations(events, CONFIG).map(entry => entry.decisionId)).toEqual(['d1'])
    // final 模式：d2 一并到期（样本即所得，分类交由 minSamples 判 inconclusive）。
    expect(pendingEvaluations(events, CONFIG, { final: true }).map(entry => entry.decisionId)).toEqual(['d1', 'd2'])
  })
})

describe('observeWindow 归属边界', () => {
  it('被取代窗口截断到更晚的决策点：不重复归账它决策的工具结果', () => {
    const events: SessionEvent[] = [
      decision('d1'),
      toolResult(true), toolResult(true),
      decision('d2'),
      toolResult(true), toolResult(true), toolResult(true), toolResult(true),
    ]
    // d1 窗口只含 d2 之前的 2 条失败；d2 之后的 4 条属于 d2 的窗口。
    const d1 = observeWindow(events, 0, CONFIG)
    expect(d1.samples).toBe(2)
    expect(d1.failures).toBe(2)
    const d2 = observeWindow(events, 3, CONFIG)
    expect(d2.samples).toBe(4)
  })
})

describe('evaluatedDecisions + shadowReadiness', () => {
  it('合并 decision+evaluation 视图；假绿 = delegate+recovered+零失败', () => {
    const events: SessionEvent[] = [
      decision('d1', { action: 'delegate', profile: 'verifier', task: 't', targets: [] }),
      evaluation('d1', 'recovered', 0), // 假绿：对已恢复环境开火
      decision('d2', { action: 'delegate', profile: 'verifier', task: 't', targets: [] }),
      evaluation('d2', 'recovered', 3), // 真恢复：窗口内有失败
      decision('d3', { action: 'delegate', profile: 'verifier', task: 't', targets: [] }),
      evaluation('d3', 'persisted', 8),
      decision('d4'), // self 无评估 → 不入证据
    ]
    const evaluated = evaluatedDecisions(events)
    expect(evaluated).toHaveLength(3)
    const readiness = shadowReadiness(events, READINESS)
    expect(readiness.samples).toBe(3)
    expect(readiness.delegateSamples).toBe(3)
    expect(readiness.falseGreenRate).toBeCloseTo(1 / 3)
    // persisted 占比 1/3 ∈ (0, 0.5) → medium
    expect(readiness.scopeHealth).toBe('medium')
  })

  it('persisted 占比达阈值 → scopeHealth high；零 delegate 评估 → healthy', () => {
    const persisted: SessionEvent[] = [
      decision('d1', { action: 'delegate', profile: 'verifier', task: 't', targets: [] }),
      evaluation('d1', 'persisted', 5),
      decision('d2', { action: 'delegate', profile: 'verifier', task: 't', targets: [] }),
      evaluation('d2', 'persisted', 5),
    ]
    expect(shadowReadiness(persisted, READINESS).scopeHealth).toBe('high')
    const none: SessionEvent[] = [decision('d1'), evaluation('d1', 'recovered', 0)]
    const evidence = shadowReadiness(none, READINESS)
    expect(evidence.delegateSamples).toBe(0)
    expect(evidence.falseGreenRate).toBe(0)
    expect(evidence.scopeHealth).toBe('healthy')
  })
})

describe('canaryHealth', () => {
  function route(id: string): SessionEvent {
    return {
      type: 'router/route',
      seq: seq++,
      time: 0,
      data: { profile: 'verifier', task: 't', targets: [], subagentSessionId: id },
    } as unknown as SessionEvent
  }
  function adoption(id: string, verdict: 'adopt' | 'reject'): SessionEvent {
    return { type: 'router/adoption', seq: seq++, time: 0, data: { subagentSessionId: id, verdict, reason: 'r' } } as unknown as SessionEvent
  }
  function outcome(id: string, stopReason: string): SessionEvent {
    return { type: 'router/outcome', seq: seq++, time: 0, data: { subagentSessionId: id, stopReason } } as unknown as SessionEvent
  }

  it('零派发 → 全零证据（收益代理不为造而造）', () => {
    const evidence = canaryHealth([decision('d1'), evaluation('d1', 'recovered', 0)], CANARY)
    expect(evidence).toEqual({
      dispatches: 0, adopted: 0, rejected: 0, budgetExhausted: 0, benefitProxy: 0, evaluatedDispatches: 0,
    })
  })

  it('统计窗口内派发的声明、预算终态与收益代理', () => {
    const events: SessionEvent[] = [
      decision('d1', { action: 'delegate', profile: 'verifier', task: 't', targets: [], mode: 'auto', dispatched: true, subagentSessionId: 'child-1' }),
      route('child-1'),
      outcome('child-1', 'completed'),
      adoption('child-1', 'adopt'),
      decision('d2', { action: 'delegate', profile: 'verifier', task: 't', targets: [], mode: 'auto', dispatched: true, subagentSessionId: 'child-2' }),
      route('child-2'),
      outcome('child-2', 'budget-exhausted'),
      adoption('child-2', 'reject'),
      evaluation('d1', 'recovered', 2),
      evaluation('d2', 'persisted', 6),
    ]
    const evidence = canaryHealth(events, CANARY)
    expect(evidence.dispatches).toBe(2)
    expect(evidence.adopted).toBe(1)
    expect(evidence.rejected).toBe(1)
    expect(evidence.budgetExhausted).toBe(1)
    expect(evidence.evaluatedDispatches).toBe(2)
    expect(evidence.benefitProxy).toBeCloseTo(0.5)
  })

  it('窗口外的派发不计入', () => {
    const events: SessionEvent[] = [
      route('old-1'),
      route('old-2'),
      route('old-3'),
    ]
    const evidence = canaryHealth(events, { ...CANARY, window: 2 })
    expect(evidence.dispatches).toBe(2)
  })

  it('收益代理与声明同窗口：窗口外的已评估派发不进分子分母', () => {
    const events: SessionEvent[] = [
      decision('d1', { action: 'delegate', profile: 'verifier', task: 't', targets: [], mode: 'auto', dispatched: true, subagentSessionId: 'child-1' }),
      route('child-1'),
      adoption('child-1', 'adopt'),
      evaluation('d1', 'recovered', 2),
      decision('d2', { action: 'delegate', profile: 'verifier', task: 't', targets: [], mode: 'auto', dispatched: true, subagentSessionId: 'child-2' }),
      route('child-2'),
      adoption('child-2', 'reject'),
      evaluation('d2', 'persisted', 6),
    ]
    // 窗口 1：只剩 child-2 的派发在窗口内——d1 的评估不再计入收益代理，
    // 声明比对（adopt+reject ≥ evaluatedDispatches）也按同窗口口径成立。
    const evidence = canaryHealth(events, { ...CANARY, window: 1 })
    expect(evidence.dispatches).toBe(1)
    expect(evidence.evaluatedDispatches).toBe(1)
    expect(evidence.benefitProxy).toBe(0)
  })
})
