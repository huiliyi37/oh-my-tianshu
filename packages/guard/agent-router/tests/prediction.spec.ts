/**
 * prediction.spec.ts — 工具成败预测累计器（天枢 prediction-error 纯函数核心移植）。
 *
 * 覆盖：窗口滑动、<3 样本返回 0、阈值边界（0.4/0.6/0.8 含等于）、
 * 连续 3 次正确触发重置判定、不可变更新。
 */
import { describe, expect, it } from 'vitest'
import {
  createPredictionAccumulator,
  getErrorRate,
  getInterventionLevel,
  recordPrediction,
  resetAccumulator,
  shouldTippingPointReset,
} from '../src/prediction.js'

describe('createPredictionAccumulator / resetAccumulator', () => {
  it('默认窗口 10，空预测', () => {
    const acc = createPredictionAccumulator()
    expect(acc.windowSize).toBe(10)
    expect(acc.predictions).toEqual([])
    expect(acc.consecutiveCorrect).toBe(0)
  })

  it('可配置窗口大小', () => {
    expect(createPredictionAccumulator(5).windowSize).toBe(5)
  })

  it('reset 清空预测与连续正确计数', () => {
    let acc = createPredictionAccumulator()
    acc = recordPrediction(acc, true)
    acc = recordPrediction(acc, true)
    acc = resetAccumulator(acc)
    expect(acc.predictions).toEqual([])
    expect(acc.consecutiveCorrect).toBe(0)
  })
})

describe('recordPrediction — 不可变更新 + 窗口滑动', () => {
  it('记录正确/错误，不可变', () => {
    const acc = createPredictionAccumulator()
    const next = recordPrediction(acc, true)
    expect(acc.predictions).toEqual([]) // 原对象不变
    expect(next.predictions).toEqual([true])
    expect(next.consecutiveCorrect).toBe(1)
  })

  it('错误重置连续正确计数', () => {
    let acc = createPredictionAccumulator()
    acc = recordPrediction(acc, true)
    acc = recordPrediction(acc, true)
    acc = recordPrediction(acc, false)
    expect(acc.consecutiveCorrect).toBe(0)
  })

  it('超过窗口大小滑动丢弃最旧', () => {
    let acc = createPredictionAccumulator(3)
    acc = recordPrediction(acc, true)
    acc = recordPrediction(acc, false)
    acc = recordPrediction(acc, true)
    acc = recordPrediction(acc, true)
    expect(acc.predictions).toEqual([false, true, true])
  })
})

describe('getErrorRate', () => {
  it('少于 3 样本返回 0（不足不判）', () => {
    let acc = createPredictionAccumulator()
    acc = recordPrediction(acc, false)
    acc = recordPrediction(acc, false)
    expect(getErrorRate(acc)).toBe(0)
  })

  it('3+ 样本按错误比例', () => {
    let acc = createPredictionAccumulator()
    acc = recordPrediction(acc, false)
    acc = recordPrediction(acc, false)
    acc = recordPrediction(acc, true)
    expect(getErrorRate(acc)).toBeCloseTo(2 / 3)
  })

  it('全对为 0', () => {
    let acc = createPredictionAccumulator()
    for (let i = 0; i < 5; i++) acc = recordPrediction(acc, true)
    expect(getErrorRate(acc)).toBe(0)
  })
})

describe('getInterventionLevel — 阈值边界', () => {
  function accWith(errors: number, total: number): ReturnType<typeof createPredictionAccumulator> {
    let acc = createPredictionAccumulator()
    for (let i = 0; i < total; i++) acc = recordPrediction(acc, i >= errors)
    return acc
  }

  it('少于 3 样本 → none', () => {
    expect(getInterventionLevel(accWith(1, 2))).toBe('none')
  })

  it('错误率 <0.4 → none', () => {
    expect(getInterventionLevel(accWith(1, 5))).toBe('none') // 0.2
  })

  it('≥0.4 → hint（含等于）', () => {
    expect(getInterventionLevel(accWith(2, 5))).toBe('hint') // 0.4
  })

  it('≥0.6 → gate（含等于）', () => {
    expect(getInterventionLevel(accWith(3, 5))).toBe('gate') // 0.6
    expect(getInterventionLevel(accWith(3, 4))).toBe('gate') // 0.75
  })

  it('≥0.8 → escalate（含等于）', () => {
    expect(getInterventionLevel(accWith(4, 5))).toBe('escalate') // 0.8
    expect(getInterventionLevel(accWith(5, 5))).toBe('escalate') // 1.0
  })
})

describe('shouldTippingPointReset', () => {
  it('连续 3 次正确 → true（含等于）', () => {
    let acc = createPredictionAccumulator()
    for (let i = 0; i < 3; i++) acc = recordPrediction(acc, true)
    expect(shouldTippingPointReset(acc)).toBe(true)
  })

  it('少于 3 次连续 → false', () => {
    let acc = createPredictionAccumulator()
    acc = recordPrediction(acc, true)
    acc = recordPrediction(acc, true)
    expect(shouldTippingPointReset(acc)).toBe(false)
  })

  it('中间有错误则重置计数（不误触发）', () => {
    let acc = createPredictionAccumulator()
    for (let i = 0; i < 3; i++) acc = recordPrediction(acc, true)
    acc = recordPrediction(acc, false)
    expect(shouldTippingPointReset(acc)).toBe(false)
  })
})
