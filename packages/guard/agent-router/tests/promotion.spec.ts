/**
 * promotion.spec.ts — 自适应影子评估门槛（veto 阶梯纯函数）。
 *
 * 覆盖：effectivePromotionMode 优先级、resolvePromotionGate 四级 veto 阶梯
 * （顺序敏感）与放行条件。
 */
import { describe, expect, it } from 'vitest'
import { effectivePromotionMode, MIN_MARGIN, MIN_SAMPLES, resolvePromotionGate } from '../src/promotion.js'

function evidence(over: Record<string, unknown> = {}): Parameters<typeof resolvePromotionGate>[0] {
  return {
    samples: MIN_SAMPLES + 1,
    falseGreenRate: 0,
    scopeHealth: 'healthy',
    margin: MIN_MARGIN + 0.01,
    ...over,
  }
}

describe('effectivePromotionMode', () => {
  it('kill switch 最优先；缺省 off', () => {
    expect(effectivePromotionMode('auto', true)).toBe('off')
    expect(effectivePromotionMode('shadow', false)).toBe('shadow')
    expect(effectivePromotionMode(undefined, false)).toBe('off')
  })
})

describe('resolvePromotionGate', () => {
  it('全绿证据放行', () => {
    expect(resolvePromotionGate(evidence()).enabled).toBe(true)
  })

  it('样本不足 → 否决', () => {
    const result = resolvePromotionGate(evidence({ samples: MIN_SAMPLES - 1 }))
    expect(result.enabled).toBe(false)
    expect(result.vetoSignals[0]).toContain('insufficient samples')
  })

  it('存在假绿 → 否决（顺序在样本之后）', () => {
    const result = resolvePromotionGate(evidence({ falseGreenRate: 0.1 }))
    expect(result.enabled).toBe(false)
    expect(result.vetoSignals[0]).toContain('false-green')
  })

  it('范围健康受损 → 否决', () => {
    const result = resolvePromotionGate(evidence({ scopeHealth: 'high' }))
    expect(result.enabled).toBe(false)
    expect(result.vetoSignals[0]).toContain('scope health')
  })

  it('收益边际不足 → 否决', () => {
    const result = resolvePromotionGate(evidence({ margin: MIN_MARGIN - 0.01 }))
    expect(result.enabled).toBe(false)
    expect(result.vetoSignals[0]).toContain('reward margin')
  })
})
