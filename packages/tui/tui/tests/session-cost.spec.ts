/**
 * session-cost.spec.ts — 会话成本汇总纯函数（format/session-cost.ts）。
 *
 * 覆盖：accumulateUsage（累加/缓存字段缺省/首次建桶）、
 * formatSessionCostReport（多模型明细/合计/未知模型无价/空数据占位）。
 */
import { describe, expect, it } from 'vitest'
import { accumulateUsage, formatSessionCostReport, emptyBucket } from '../src/format/session-cost.js'
import type { TokenUsage } from '@huiliyi37/dsh-llm'

const flashUsage: TokenUsage = {
  inputTokens: 1_000_000,
  outputTokens: 200_000,
  cacheReadTokens: 500_000,
  reasoningTokens: 50_000,
}

describe('accumulateUsage', () => {
  it('首次（无桶）按 usage 建桶；缓存字段缺省按 0', () => {
    const b = accumulateUsage(undefined, { inputTokens: 10, outputTokens: 5 })
    expect(b.model).toBe('unknown')
    expect(b.inputTokens).toBe(10)
    expect(b.cacheReadTokens).toBe(0)
    expect(b.outputTokens).toBe(5)
    expect(b.reasoningTokens).toBe(0)
  })

  it('重复累加（各字段相加）', () => {
    const once = accumulateUsage(emptyBucket('deepseek-v4-flash'), flashUsage)
    const twice = accumulateUsage(once, { inputTokens: 500_000, outputTokens: 100_000 })
    expect(twice.inputTokens).toBe(1_500_000)
    expect(twice.cacheReadTokens).toBe(500_000)
    expect(twice.outputTokens).toBe(300_000)
    expect(twice.reasoningTokens).toBe(50_000)
  })
})

describe('formatSessionCostReport', () => {
  it('空桶列表 → 占位提示', () => {
    expect(formatSessionCostReport([])).toEqual(['会话成本统计', '（本会话尚无用量数据）'])
  })

  it('单模型明细:token 分段 + $ 估算（flash 定价）', () => {
    const rows = formatSessionCostReport([accumulateUsage(emptyBucket('deepseek-v4-flash'), flashUsage)])
    expect(rows[0]).toBe('会话成本统计')
    // 1M×0.27 + 0.2M×1.1 + 0.5M×0.07 = 0.27+0.22+0.035 = 0.525 → 0.53
    expect(rows[1]).toContain('deepseek-v4-flash')
    expect(rows[1]).toContain('输入 1.00M')
    expect(rows[1]).toContain('缓存读 500k')
    expect(rows[1]).toContain('输出 200k')
    expect(rows[1]).toContain('推理 50k')
    expect(rows[1]).toContain('$0.53')
    expect(rows[2]).toContain('合计:输入 1.00M')
    expect(rows[2]).toContain('输出 200k')
  })

  it('未知模型不猜价（无 $ 段,合计 $ 缺省）', () => {
    const rows = formatSessionCostReport([accumulateUsage(undefined, { inputTokens: 1000, outputTokens: 0 })])
    expect(rows[1]).not.toContain('$')
    expect(rows[2]).not.toContain('$')
  })

  it('多模型分桶:各自明细 + 合计汇总', () => {
    const buckets = [
      accumulateUsage(emptyBucket('deepseek-v4-flash'), { inputTokens: 1_000_000, outputTokens: 0 }),
      accumulateUsage(emptyBucket('deepseek-v4-pro'), { inputTokens: 500_000, outputTokens: 100_000 }),
    ]
    const rows = formatSessionCostReport(buckets)
    expect(rows).toHaveLength(4)
    expect(rows[1]).toContain('deepseek-v4-flash')
    expect(rows[2]).toContain('deepseek-v4-pro')
    expect(rows[3]).toContain('合计:输入 1.50M')
    expect(rows[3]).toContain('输出 100k')
    // 0.27 + (0.275+0.219) = 0.764 → 0.76
    expect(rows[3]).toContain('$0.76')
  })
})
