/**
 * promotion.spec.ts — 路由晋升的两道确定性关卡（veto 阶梯纯函数）。
 *
 * 覆盖：effectivePromotionMode 优先级、shadow readiness 三级 veto 阶梯
 * （顺序敏感）、canary health 四级 veto 阶梯与零真实派发短路（不伪造收益
 * 边际）。
 */
import { describe, expect, it } from 'vitest'
import type { CanaryHealthEvidence, ShadowReadinessEvidence } from '../src/evaluation.js'
import { effectivePromotionMode, resolveCanaryHealthGate, resolveShadowReadinessGate } from '../src/promotion.js'

/** readiness 关卡策略（resolveReadinessConfig 的解析产物形状）。 */
const READINESS_POLICY = { minSamples: 30, maxFalseGreenRate: 0 }

function readiness(over: Partial<ShadowReadinessEvidence> = {}): ShadowReadinessEvidence {
  return {
    samples: READINESS_POLICY.minSamples + 1,
    delegateSamples: READINESS_POLICY.minSamples + 1,
    falseGreenRate: 0,
    scopeHealth: 'healthy',
    ...over,
  }
}

function canary(over: Partial<CanaryHealthEvidence> = {}): CanaryHealthEvidence {
  return {
    dispatches: 12,
    adopted: 8,
    rejected: 4,
    budgetExhausted: 0,
    benefitProxy: 0.9,
    evaluatedDispatches: 12,
    ...over,
  }
}

/** canary 关卡策略（resolveCanaryConfig 的解析产物形状）。 */
const CANARY_POLICY = { maxBudgetExhaustedShare: 0.1, minBenefitProxy: 0.5 }

describe('effectivePromotionMode', () => {
  it('kill switch 最优先；缺省 off', () => {
    expect(effectivePromotionMode('auto', true)).toBe('off')
    expect(effectivePromotionMode('shadow', false)).toBe('shadow')
    expect(effectivePromotionMode(undefined, false)).toBe('off')
  })
})

describe('resolveShadowReadinessGate', () => {
  it('全绿证据放行', () => {
    expect(resolveShadowReadinessGate(readiness(), READINESS_POLICY).enabled).toBe(true)
  })

  it('已评估决策不足 → 否决', () => {
    const result = resolveShadowReadinessGate(
      readiness({ samples: READINESS_POLICY.minSamples - 1, delegateSamples: READINESS_POLICY.minSamples - 1 }),
      READINESS_POLICY,
    )
    expect(result.enabled).toBe(false)
    expect(result.vetoSignals[0]).toContain('insufficient evaluated decisions')
  })

  it('存在假绿 → 否决（顺序在样本之后）', () => {
    const result = resolveShadowReadinessGate(readiness({ falseGreenRate: 0.1 }), READINESS_POLICY)
    expect(result.enabled).toBe(false)
    expect(result.vetoSignals[0]).toContain('false-green')
  })

  it('范围健康受损 → 否决', () => {
    const result = resolveShadowReadinessGate(readiness({ scopeHealth: 'high' }), READINESS_POLICY)
    expect(result.enabled).toBe(false)
    expect(result.vetoSignals[0]).toContain('scope health')
  })

  it('策略阈值真实消费：minSamples/maxFalseGreenRate 来自 policy 而非常量', () => {
    const lenient = { minSamples: 5, maxFalseGreenRate: 0.2 }
    // 样本 6 ≥ 5、假绿 0.1 ≤ 0.2：宽松策略放行（缺省策略会双重否决）。
    const relaxed = resolveShadowReadinessGate(
      readiness({ samples: 6, delegateSamples: 6, falseGreenRate: 0.1 }),
      lenient,
    )
    expect(relaxed.enabled).toBe(true)
    // 同证据下更紧的阈值各自命中 veto 信号。
    expect(resolveShadowReadinessGate(readiness({ samples: 4, delegateSamples: 4 }), lenient).vetoSignals[0])
      .toContain('< 5')
    expect(resolveShadowReadinessGate(readiness({ samples: 6, delegateSamples: 6, falseGreenRate: 0.3 }), lenient).vetoSignals.join(' '))
      .toContain('> 0.2')
  })
})

describe('resolveCanaryHealthGate', () => {
  it('零真实派发短路：不伪造收益边际，直接否决', () => {
    const result = resolveCanaryHealthGate(canary({ dispatches: 0, evaluatedDispatches: 0 }), CANARY_POLICY)
    expect(result.enabled).toBe(false)
    expect(result.vetoSignals[0]).toContain('insufficient actual dispatches')
    expect(result.vetoSignals[0]).toContain('no benefit proxy')
  })

  it('派发在但无评估归账 → 否决（收益代理无从谈起）', () => {
    const result = resolveCanaryHealthGate(canary({ evaluatedDispatches: 0 }), CANARY_POLICY)
    expect(result.enabled).toBe(false)
    expect(result.vetoSignals[0]).toContain('insufficient actual dispatches')
  })

  it('全绿证据放行', () => {
    expect(resolveCanaryHealthGate(canary(), CANARY_POLICY)).toEqual({ enabled: true, vetoSignals: [] })
  })

  it('adopt/reject 声明缺失 → 否决（顺序在派发之后）', () => {
    const result = resolveCanaryHealthGate(canary({ adopted: 2, rejected: 1 }), CANARY_POLICY)
    expect(result.enabled).toBe(false)
    expect(result.vetoSignals[0]).toContain('adoption declarations missing')
  })

  it('预算耗尽占比超限 → 否决', () => {
    const result = resolveCanaryHealthGate(canary({ budgetExhausted: 3 }), CANARY_POLICY)
    expect(result.enabled).toBe(false)
    expect(result.vetoSignals.some(signal => signal.includes('budget-exhausted'))).toBe(true)
  })

  it('收益代理不足 → 否决（顺序在预算之后）', () => {
    const result = resolveCanaryHealthGate(canary({ benefitProxy: 0.2, budgetExhausted: 3 }), CANARY_POLICY)
    expect(result.enabled).toBe(false)
    expect(result.vetoSignals.filter(signal => signal.includes('benefit proxy'))).toHaveLength(1)
  })
})
