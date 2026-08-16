/**
 * pricing — 模型 → $/MTok 定价表与成本估算（纯函数，无 I/O）。
 *
 * 数据源：usage 折叠（TokenUsage）只给 token 数，不给金额——成本是展示层
 * 估算，内置官方档位定价表（flash = chat 档 / pro = reasoner 档，2025 公开价）。
 * 未知模型返回 undefined：诚实降级（同缓存% 未报不显示 0% 的语义）。
 *
 * @module @deepseek-ai/dsh-tianshu-tui/pricing
 */

import type { TokenUsage } from '@huiliyi37/dsh-llm'

/** 单位：$/MTok（每百万 token）。 */
export interface ModelPrice {
  /** 未命中缓存输入价。 */
  input: number
  /** 输出价。 */
  output: number
  /** 缓存命中读价；缺省 = input（无缓存优惠）。 */
  cacheRead?: number
}

/** 内置定价表；key = wire 模型 id（spark 别名展开后的 deepseek-v4-*）。 */
export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  'deepseek-v4-flash': { input: 0.27, output: 1.1, cacheRead: 0.07 },
  'deepseek-v4-pro': { input: 0.55, output: 2.19, cacheRead: 0.14 },
}

/**
 * 估算一次请求的美元成本（四舍五入到分）。
 * billed 输入 = inputTokens + cacheRead + cacheWrite（缓存写按未命中输入价计）。
 * @param modelName - wire 模型 id；不在定价表返回 undefined。
 * @param usage - TokenUsage（DISJOINT 计数，与 glanceMetrics 同源）。
 * @returns 成本（美元）；模型未知或 token 全零返回 undefined。
 */
export function estimateCost(modelName: string, usage: TokenUsage): number | undefined {
  const price = MODEL_PRICES[modelName]
  if (price === undefined) return undefined
  const billed = usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
  if (billed <= 0 && usage.outputTokens <= 0) return undefined
  const cost = (
    usage.inputTokens * price.input
    + (usage.cacheReadTokens ?? 0) * (price.cacheRead ?? price.input)
    + (usage.cacheWriteTokens ?? 0) * price.input
    + usage.outputTokens * price.output
  ) / 1_000_000
  return Math.round(cost * 100) / 100
}
