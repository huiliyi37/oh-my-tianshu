/**
 * promotion.ts — 自适应影子评估的确定性门槛（天枢 bandit-promotion /
 * model-tier-gate veto 阶梯的 DSH 纯函数形态）。
 *
 * 四模式语义（off/shadow/auto/forced）与四级 veto 阶梯（样本数 → 假绿 →
 * 范围健康 → 收益边际）作为纯函数；本轮只落地纯函数面（仅 shadow），
 * per-session tally 接线与 auto 模式列为候选优化（见 proposed note）。
 * LinUCB 与跨会话数据库学习明确不搬（违反按会话隔离与先 shadow 后自适应）。
 *
 * @module @huiliyi37/dsh-agent-router/promotion
 */

/** 自适应模式（天枢四模式语义）。 */
export type PromotionMode = 'off' | 'shadow' | 'auto' | 'forced'

/** 影子评估证据（per-session tally 注入；纯函数不持有状态）。 */
export interface PromotionEvidence {
  /** 样本数（窗口内工具成败计数）。 */
  samples: number
  /** 假绿率（预测正确实际失败的比例，0-1）。 */
  falseGreenRate: number
  /** 范围健康（最差严重度）。 */
  scopeHealth: 'healthy' | 'medium' | 'high'
  /** 收益边际（候选策略相对现状的收益差）。 */
  margin: number
}

/** 门槛判定结果。 */
export interface PromotionGateResult {
  /** 是否放行（auto 才可据此切策略；shadow 只记录）。 */
  enabled: boolean
  /** 否决信号（空 = 放行）。 */
  vetoSignals: string[]
}

/** 最小样本数（天枢 MIN_TOTAL_TIER_SAMPLES 同源）。 */
export const MIN_SAMPLES = 30
/** 最小收益边际（天枢 TIER_REWARD_MARGIN 同源）。 */
export const MIN_MARGIN = 0.05

/**
 * 有效模式（天枢 effectiveBanditMode 语义）：kill switch（'off'）最优先；
 * 显式模式次之。DSH 无 legacy 旗标对账。
 * @param mode - 配置模式。
 * @param killSwitch - 装配级 kill switch。
 * @returns 有效模式。
 */
export function effectivePromotionMode(mode: PromotionMode | undefined, killSwitch: boolean): PromotionMode {
  if (killSwitch) return 'off'
  return mode ?? 'off'
}

/**
 * 四级 veto 阶梯（顺序敏感）：样本不足 → 存在假绿 → 范围健康受损 →
 * 收益边际不足。任何一级命中即不放行。
 * @param evidence - 影子评估证据。
 * @returns 判定结果。
 */
export function resolvePromotionGate(evidence: PromotionEvidence): PromotionGateResult {
  const vetoSignals: string[] = []
  if (evidence.samples < MIN_SAMPLES) {
    vetoSignals.push(`insufficient samples (${evidence.samples} < ${MIN_SAMPLES})`)
  }
  if (evidence.falseGreenRate > 0) {
    vetoSignals.push(`false-green rate ${evidence.falseGreenRate} > 0`)
  }
  if (evidence.scopeHealth !== 'healthy') {
    vetoSignals.push(`scope health ${evidence.scopeHealth}`)
  }
  if (evidence.margin < MIN_MARGIN) {
    vetoSignals.push(`reward margin ${evidence.margin} < ${MIN_MARGIN}`)
  }
  return { enabled: vetoSignals.length === 0, vetoSignals }
}
