/**
 * session-cost — 会话成本汇总(纯函数;Claude Code /cost 形态)。
 *
 * 数据源:assistant/message 事件的 usage(TokenUsage,每次请求计量)按模型
 * 分桶累计;模型 key 取最近一次 request/header 的 config.model(wire id)。
 * 成本估算复用 pricing.ts(未知模型不猜价);token 计数复用 formatTokenCount。
 *
 * @module @huiliyi37/dsh-tui/session-cost
 */

import type { TokenUsage } from '@huiliyi37/dsh-llm'
import { estimateCost } from './pricing.js'
import { formatTokenCount } from './glance-bar.js'

/** 单模型的累计用量桶(字段兼容 TokenUsage 形状,可直接喂 estimateCost)。 */
export interface SessionCostBucket {
  /** wire 模型 id(未知时为 'unknown')。 */
  model: string
  inputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
  reasoningTokens: number
}

/**
 * 空桶(缺省值)。
 * @param model - 桶所属模型名。
 * @returns 全零计量的新桶。
 */
export function emptyBucket(model: string): SessionCostBucket {
  return {
    model,
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
  }
}

/**
 * 累加一次请求计量进桶(纯函数;usage 的缓存字段缺省按 0)。
 * @param bucket - 现有桶(undefined → 以 usage 建桶)。
 * @param usage - 本次请求的 TokenUsage。
 * @param model - 建新桶时的模型名(已有桶时忽略;缺省 'unknown')。
 * @returns 新桶。
 */
export function accumulateUsage(
  bucket: SessionCostBucket | undefined,
  usage: TokenUsage,
  model = 'unknown',
): SessionCostBucket {
  // ?? 右侧分支恒为「无桶」场景,model 由调用方提供(已知桶 key 时避免 'unknown')。
  const base = bucket ?? emptyBucket(model)
  return {
    ...base,
    inputTokens: base.inputTokens + usage.inputTokens,
    cacheReadTokens: base.cacheReadTokens + (usage.cacheReadTokens ?? 0),
    cacheWriteTokens: base.cacheWriteTokens + (usage.cacheWriteTokens ?? 0),
    outputTokens: base.outputTokens + usage.outputTokens,
    reasoningTokens: base.reasoningTokens + (usage.reasoningTokens ?? 0),
  }
}

/**
 * 渲染会话成本报告行:标题 + 每模型明细(输入/缓存读/写/输出/推理/$)+ 合计。
 * 空桶列表 → 占位提示行。
 * @param buckets - 各模型累计桶(顺序 = 传入序,建议按首次出现序)。
 * @returns 报告行数组(纯文本,无 ANSI)。
 */
export function formatSessionCostReport(buckets: readonly SessionCostBucket[]): string[] {
  const rows = ['会话成本统计']
  if (buckets.length === 0) {
    rows.push('（本会话尚无用量数据）')
    return rows
  }
  let totalInput = 0
  let totalCacheRead = 0
  let totalCacheWrite = 0
  let totalOutput = 0
  let totalCost = 0
  for (const bucket of buckets) {
    const usage: TokenUsage = {
      inputTokens: bucket.inputTokens,
      outputTokens: bucket.outputTokens,
      cacheReadTokens: bucket.cacheReadTokens,
      cacheWriteTokens: bucket.cacheWriteTokens,
      reasoningTokens: bucket.reasoningTokens,
    }
    const cost = estimateCost(bucket.model, usage)
    if (cost !== undefined) totalCost += cost
    const parts = [`· ${bucket.model}`]
    if (bucket.inputTokens > 0 || bucket.cacheReadTokens > 0 || bucket.cacheWriteTokens > 0) {
      const input = [`输入 ${formatTokenCount(bucket.inputTokens)}`]
      if (bucket.cacheReadTokens > 0) input.push(`缓存读 ${formatTokenCount(bucket.cacheReadTokens)}`)
      if (bucket.cacheWriteTokens > 0) input.push(`写 ${formatTokenCount(bucket.cacheWriteTokens)}`)
      parts.push(input.join(' · '))
    }
    if (bucket.outputTokens > 0) parts.push(`输出 ${formatTokenCount(bucket.outputTokens)}`)
    if (bucket.reasoningTokens > 0) parts.push(`推理 ${formatTokenCount(bucket.reasoningTokens)}`)
    if (cost !== undefined) parts.push(`$${cost}`)
    rows.push(parts.join(' — '))
    totalInput += bucket.inputTokens
    totalCacheRead += bucket.cacheReadTokens
    totalCacheWrite += bucket.cacheWriteTokens
    totalOutput += bucket.outputTokens
  }
  const total: string[] = [`合计:输入 ${formatTokenCount(totalInput)}`]
  if (totalCacheRead > 0) total.push(`缓存读 ${formatTokenCount(totalCacheRead)}`)
  if (totalCacheWrite > 0) total.push(`写 ${formatTokenCount(totalCacheWrite)}`)
  total.push(`输出 ${formatTokenCount(totalOutput)}`)
  if (totalCost > 0) total.push(`$${Math.round(totalCost * 100) / 100}`)
  rows.push(total.join(' · '))
  return rows
}
