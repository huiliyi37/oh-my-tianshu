/**
 * pricing.spec.ts — 成本估算纯函数（format/pricing.ts）。
 *
 * 覆盖：flash/pro 定价计算（输入/缓存读/缓存写/输出分项计价）、
 * 缓存读缺省回退输入价、token 全零与未知模型返回 undefined。
 */
import { describe, expect, it } from 'vitest'
import { estimateCost, MODEL_PRICES } from '../src/format/pricing.js'

describe('MODEL_PRICES', () => {
  it('flash / pro 两档已登记', () => {
    expect(MODEL_PRICES['deepseek-v4-flash']).toBeDefined()
    expect(MODEL_PRICES['deepseek-v4-pro']).toBeDefined()
  })
})

describe('estimateCost', () => {
  it('flash：输入 + 输出 + 缓存读分项计价', () => {
    const cost = estimateCost('deepseek-v4-flash', {
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      cacheReadTokens: 2_000_000,
    })
    // 1M×0.27 + 0.5M×1.1 + 2M×0.07 = 0.27 + 0.55 + 0.14 = 0.96
    expect(cost).toBe(0.96)
  })

  it('pro：按 reasoner 档计价', () => {
    const cost = estimateCost('deepseek-v4-pro', {
      inputTokens: 1_000_000,
      outputTokens: 100_000,
    })
    // 1M×0.55 + 0.1M×2.19 = 0.55 + 0.219 = 0.769 → 0.77
    expect(cost).toBe(0.77)
  })

  it('缓存写按未命中输入价计；cacheRead 缺省回退 input 价', () => {
    const cost = estimateCost('deepseek-v4-flash', {
      inputTokens: 0,
      outputTokens: 0,
      cacheWriteTokens: 1_000_000,
    })
    expect(cost).toBe(0.27)
  })

  it('token 全零 → undefined（不显示 $0）', () => {
    expect(estimateCost('deepseek-v4-flash', { inputTokens: 0, outputTokens: 0 })).toBeUndefined()
  })

  it('未知模型 → undefined（不猜价）', () => {
    expect(estimateCost('deepseek-v4-custom', { inputTokens: 1000, outputTokens: 0 })).toBeUndefined()
  })
})
