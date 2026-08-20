/**
 * router.ts — 确定性路由表（指标 → 动作，MoE 路由的纯函数核心）。
 *
 * 输入 RouterMetrics（prediction 干预级别 + evidence tracker 义务/验证/冷却），
 * 输出 RouterAction（self / delegate 子代理）。规则确定性、优先级降序、
 * 纯函数可单测——不做学习/bandit（天枢 bandit-promotion 太重，之后慢慢改造）。
 *
 * @module @huiliyi37/dsh-agent-router/router
 */

import type { InterventionLevel } from './prediction.js'

/** 升级迟滞策略（Config 经 resolveEscalationPolicy 解析后传入）。 */
export interface EscalationPolicy {
  /** 升级目标钳制：'verifier' 允许 escalate 派发；'off' 完全关闭升级分支。 */
  cap: 'verifier' | 'off'
  /** 允许 escalate 的最小连续失败次数。 */
  minConsecutiveFailures: number
}

/** 路由输入指标（由插件从 prediction 累计器 + evidence tracker 采集）。 */
export interface RouterMetrics {
  /** 工具成败预测干预级别（prediction）。 */
  interventionLevel: InterventionLevel
  /** 连续失败次数（升级迟滞数据源）。 */
  consecutiveFailures: number
  /** 未决高风险义务数（evidence tracker）。 */
  unresolvedHigh: number
  /** 验证计数（evidence tracker；>0 = 验证进行中）。 */
  verifications: number
  /** 探针冷却耗尽（uninformative ≥2）的目标数（evidence tracker cooldown）。 */
  probeCooledTargets: number
}

/** 路由动作。 */
export type RouterAction =
  | { kind: 'self' }
  | { kind: 'delegate'; profile: 'code_scout' | 'verifier'; task: string; targets: string[] }

/** 义务提示（delegate 任务描述素材）。 */
export interface ObligationHint {
  claim: string
  targets: string[]
}

/** verifier 任务描述前缀（独立通道复核）。 */
const VERIFIER_TASK_PREFIX = '独立复核'
/** code_scout 任务描述前缀（新角度侦查）。 */
const SCOUT_TASK_PREFIX = '新角度侦查'

/**
 * 路由决策（规则优先级降序；义务/验证计数已采集进 metrics，尚无规则消费）：
 * 1. escalate（错误率 ≥0.8 且连续失败 ≥ minConsecutiveFailures，cap 未关）
 *    → delegate verifier（独立通道复核）——迟滞防单次偶发失败触发升级
 * 2. gate（≥0.6）+ 探针冷却耗尽 → delegate code_scout（新角度侦查）
 * 3. 默认 self——先写探针的责任在证据门，路由不重复拦
 * @param metrics - 指标快照。
 * @param obligationHint - 义务提示（可选；delegate 时进任务描述）。
 * @param policy - 升级迟滞策略（cap 与最小连续失败次数）。
 * @returns 路由动作。
 */
export function decideRouterAction(
  metrics: RouterMetrics,
  obligationHint: ObligationHint | undefined,
  policy: EscalationPolicy,
): RouterAction {
  const claim = obligationHint?.claim
  const targets = obligationHint?.targets ?? []

  if (
    metrics.interventionLevel === 'escalate'
    && policy.cap === 'verifier'
    && metrics.consecutiveFailures >= policy.minConsecutiveFailures
  ) {
    const task = claim === undefined
      ? `${VERIFIER_TASK_PREFIX}当前工具反复失败——以独立验证视角复核未验证断言/复现缺陷，给出证据结论`
      : `${VERIFIER_TASK_PREFIX}「${claim}」——以独立验证视角复核，给出证据结论`
    return { kind: 'delegate', profile: 'verifier', task, targets }
  }

  if (metrics.interventionLevel === 'gate' && metrics.probeCooledTargets > 0) {
    const task = claim === undefined
      ? `${SCOUT_TASK_PREFIX}探针冷却耗尽——换个角度侦查目标文件，给出新的可验证假设`
      : `${SCOUT_TASK_PREFIX}「${claim}」——探针冷却耗尽，侦查目标文件并给出新的可验证假设`
    return { kind: 'delegate', profile: 'code_scout', task, targets }
  }

  return { kind: 'self' }
}
