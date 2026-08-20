/**
 * budget.ts — 派发预算纯函数（天枢 budget-shape 的 DSH 形态）。
 *
 * 预算 = turns + wall-clock（天枢同构，无 token 维度）；shape 按目标文件
 * 数线性定价、显式覆盖逐字段优先、双绝对帽钳制。tunables 全部由 Config
 * 注入（no hardcoded tunables）；history 自调样本推导列为候选优化
 * （见 proposed note），本轮只做计算与记录（方案 a：提示级预算）。
 *
 * @module @huiliyi37/dsh-agent-router/budget
 */

/** 预算形状（计算输出；记录时 timeoutMs 折算为 deadlineMs）。 */
export interface BudgetShape {
  /** 回合预算。 */
  maxTurns: number
  /** 墙钟预算（毫秒）。 */
  timeoutMs: number
}

/** 预算配置（Config `budget` 字段，全部校验为正数）。 */
export interface BudgetConfig {
  /** 缺省回合预算。 */
  defaultMaxTurns: number
  /** 回合预算绝对帽（超出钳回）。 */
  ceilMaxTurns: number
  /** 墙钟预算（毫秒；即单发绝对帽——天枢同构，超时靠外层信号）。 */
  ceilTimeoutMs: number
  /** 每多一个目标文件增加的回合数。 */
  turnsPerExtraFile: number
}

/** 校验并默认预算配置（形状非法 fail loud；帽必须 ≥ 缺省）。 */
export function resolveBudgetConfig(raw: {
  defaultMaxTurns?: number
  ceilMaxTurns?: number
  ceilTimeoutMs?: number
  turnsPerExtraFile?: number
}): BudgetConfig {
  const config: BudgetConfig = {
    defaultMaxTurns: raw.defaultMaxTurns ?? 48,
    ceilMaxTurns: raw.ceilMaxTurns ?? 100,
    ceilTimeoutMs: raw.ceilTimeoutMs ?? 1_800_000,
    turnsPerExtraFile: raw.turnsPerExtraFile ?? 6,
  }
  for (const [key, value] of Object.entries(config) as Array<[string, number]>) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`agent-router: budget.${key} must be a non-negative finite number, got ${JSON.stringify(value)}`)
    }
  }
  if (config.ceilMaxTurns < config.defaultMaxTurns) {
    throw new Error('agent-router: budget.ceilMaxTurns must be >= budget.defaultMaxTurns')
  }
  return config
}

/**
 * 按目标文件数定价（线性 + 双帽钳制）。文件数不足 2 用缺省（单一目标不
 * 追加）。
 * @param files - 目标文件数。
 * @param config - 预算配置。
 * @returns 预算形状。
 */
export function shapeWriteBudget(files: number, config: BudgetConfig): BudgetShape {
  const extra = Math.max(0, files - 1)
  return {
    maxTurns: Math.min(config.defaultMaxTurns + extra * config.turnsPerExtraFile, config.ceilMaxTurns),
    // 墙钟预算即单发绝对帽（天枢同构：45s/文件 的增量永远被 30min 帽钳回，
    // 故不设无用旋钮）；超时强制属候选优化（seam 信号 deadline）。
    timeoutMs: config.ceilTimeoutMs,
  }
}

/**
 * 显式覆盖逐字段优先（调用方声明优先于 shape）。
 * @param explicit - 显式预算（可为空）。
 * @param shape - shape 计算值。
 * @returns 合并后的预算形状。
 */
export function mergeBudgetOverride(
  explicit: { maxTurns?: number; timeoutMs?: number } | undefined,
  shape: BudgetShape,
): BudgetShape {
  return {
    maxTurns: explicit?.maxTurns ?? shape.maxTurns,
    timeoutMs: explicit?.timeoutMs ?? shape.timeoutMs,
  }
}
