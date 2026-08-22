/**
 * promotion.ts — 路由晋升的两道确定性关卡（天枢 bandit-promotion /
 * model-tier-gate veto 阶梯的 DSH 纯函数形态）。
 *
 * 两道关卡职责分离，证据一律由 evaluation.ts 从会话日志投影：
 * - **shadow readiness**（样本、假绿、范围健康）——回答「shadow 数据是否
 *   可信到值得人工评审切 auto」；无真实派发时不产生任何收益边际。
 * - **canary health**（实际派发、adopt/reject、预算终态、收益代理）——
 *   回答「auto 灰度本身是否健康」；仅在真实派发存在时有意义。
 *
 * 关卡是纯函数：只判定并产出 veto 信号，绝不自行切换模式；产品始终通过
 * 配置人工晋升（`router/gate` 记录只留痕）。LinUCB 与跨会话数据库学习
 * 明确不搬（违反按会话隔离与先 shadow 后自适应）。
 *
 * @module @huiliyi37/dsh-agent-router/promotion
 */

import type { CanaryHealthEvidence, ShadowReadinessEvidence } from './evaluation.js'

/** 自适应模式（天枢四模式语义）。 */
export type PromotionMode = 'off' | 'shadow' | 'auto' | 'forced'

/** 关卡判定结果（两道关卡共用形状）。 */
export interface PromotionGateResult {
  /** 是否放行（仅供人工评审参考；关卡绝不自行切换模式）。 */
  enabled: boolean
  /** 否决信号（空 = 放行）。 */
  vetoSignals: string[]
}

/** 最小 readiness 样本数（天枢 MIN_TOTAL_TIER_SAMPLES 同源）。 */
export const MIN_SAMPLES = 30

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
 * shadow readiness 否决阶梯（顺序敏感）：已评估决策不足 → 存在假绿 →
 * 范围健康受损。任何一级命中即不放行。
 * @param evidence - readiness 证据（evaluation.ts 投影）。
 * @returns 判定结果。
 */
export function resolveShadowReadinessGate(evidence: ShadowReadinessEvidence): PromotionGateResult {
  const vetoSignals: string[] = []
  if (evidence.samples < MIN_SAMPLES) {
    vetoSignals.push(`insufficient evaluated decisions (${evidence.samples} < ${MIN_SAMPLES})`)
  }
  if (evidence.falseGreenRate > 0) {
    vetoSignals.push(`false-green rate ${evidence.falseGreenRate} > 0`)
  }
  if (evidence.scopeHealth !== 'healthy') {
    vetoSignals.push(`scope health ${evidence.scopeHealth}`)
  }
  return { enabled: vetoSignals.length === 0, vetoSignals }
}

/** canary 关卡策略（Config 经 resolveCanaryConfig 解析后传入）。 */
export interface CanaryGatePolicy {
  /** 预算耗尽占比上限（> 即 veto）。 */
  maxBudgetExhaustedShare: number
  /** 收益代理下限（低于即 veto）。 */
  minBenefitProxy: number
}

/**
 * canary health 否决阶梯（顺序敏感）：实际派发不足 → adopt/reject 声明
 * 缺失 → 预算终态失控 → 收益代理不足。任何一级命中即不放行；零真实派发
 * 时以「insufficient actual dispatches」短路——绝不伪造收益边际。
 * @param evidence - canary 证据（evaluation.ts 投影）。
 * @param policy - 阈值策略（Config 解析产物，无插件内默认）。
 * @returns 判定结果。
 */
export function resolveCanaryHealthGate(evidence: CanaryHealthEvidence, policy: CanaryGatePolicy): PromotionGateResult {
  const vetoSignals: string[] = []
  if (evidence.dispatches < 1 || evidence.evaluatedDispatches < 1) {
    vetoSignals.push(`insufficient actual dispatches (${evidence.dispatches} dispatched, ${evidence.evaluatedDispatches} evaluated) — no benefit proxy without real runs`)
    return { enabled: false, vetoSignals }
  }
  if (evidence.adopted + evidence.rejected < evidence.evaluatedDispatches) {
    vetoSignals.push(`adoption declarations missing (${evidence.adopted} adopt + ${evidence.rejected} reject < ${evidence.evaluatedDispatches} evaluated dispatches)`)
  }
  const budgetShare = evidence.budgetExhausted / evidence.dispatches
  if (budgetShare > policy.maxBudgetExhaustedShare) {
    vetoSignals.push(`budget-exhausted share ${budgetShare} > ${policy.maxBudgetExhaustedShare}`)
  }
  if (evidence.benefitProxy < policy.minBenefitProxy) {
    vetoSignals.push(`benefit proxy ${evidence.benefitProxy} < ${policy.minBenefitProxy}`)
  }
  return { enabled: vetoSignals.length === 0, vetoSignals }
}
