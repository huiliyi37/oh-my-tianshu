/**
 * prediction.ts — 工具成败预测累计器（天枢 prediction-error 纯函数核心移植）。
 *
 * 从工具结果序列预测「下一次调用是否成功」：10 轮滑动窗口错误率
 * ≥0.4/0.6/0.8 → hint/gate/escalate 三级干预；连续 3 次正确 → 触发重置
 * （tipping point：环境恢复，干预撤销）。纯函数零依赖（只 import type），
 * EFE/season/vigor/sensorium 部分明确不移植（依赖天枢重状态）。
 *
 * @module @huiliyi37/dsh-agent-router/prediction
 */

/** 干预级别（路由消费：hint=提示 / gate=闸门 / escalate=升级）。 */
export type InterventionLevel = 'none' | 'hint' | 'gate' | 'escalate'

/** 预测累计器状态（不可变更新）。 */
export interface PredictionAccumulator {
  /** 滑动窗口大小（默认 10）。 */
  windowSize: number
  /** 预测结果序列（true = 正确, false = 错误），最多 windowSize 条。 */
  predictions: boolean[]
  /** 连续正确次数（错误时重置；≥3 触发 tipping point）。 */
  consecutiveCorrect: number
  /** 连续失败次数（正确时重置；路由升级迟滞的数据源）。 */
  consecutiveFailed: number
}

/** 错误率阈值 → 干预级别（与天枢一致）。 */
const HINT_THRESHOLD = 0.4
const GATE_THRESHOLD = 0.6
const ESCALATE_THRESHOLD = 0.8
/** 判定所需最少样本（不足不判，避免冷启动误触发）。 */
const MIN_SAMPLES = 3
/** tipping point：连续正确次数达到即建议重置。 */
export const TIPPING_POINT_CONSECUTIVE = 3

/**
 * 创建累计器。
 * @param windowSize - 滑动窗口大小（默认 10）。
 * @returns 空累计器。
 */
export function createPredictionAccumulator(windowSize = 10): PredictionAccumulator {
  return { windowSize, predictions: [], consecutiveCorrect: 0, consecutiveFailed: 0 }
}

/**
 * 重置累计器（环境恢复/干预撤销后清空历史）。
 * @param acc - 当前累计器。
 * @returns 重置后的累计器。
 */
export function resetAccumulator(acc: PredictionAccumulator): PredictionAccumulator {
  return { ...acc, predictions: [], consecutiveCorrect: 0, consecutiveFailed: 0 }
}

/**
 * 记录一次预测结果（不可变更新，窗口滑动丢弃最旧）。
 * @param acc - 当前累计器。
 * @param correct - 本次预测是否正确（工具调用成功 = true）。
 * @returns 新累计器。
 */
export function recordPrediction(
  acc: PredictionAccumulator,
  correct: boolean,
): PredictionAccumulator {
  const nextPredictions = [...acc.predictions, correct].slice(-acc.windowSize)
  const nextConsecutiveCorrect = correct ? acc.consecutiveCorrect + 1 : 0
  const nextConsecutiveFailed = correct ? 0 : acc.consecutiveFailed + 1
  return {
    ...acc,
    predictions: nextPredictions,
    consecutiveCorrect: nextConsecutiveCorrect,
    consecutiveFailed: nextConsecutiveFailed,
  }
}

/**
 * 连续失败次数（升级迟滞：达到阈值才允许 escalate）。
 * @param acc - 累计器。
 * @returns 连续失败计数。
 */
export function getConsecutiveFailures(acc: PredictionAccumulator): number {
  return acc.consecutiveFailed
}

/**
 * 当前错误率（窗口内错误比例；样本 <3 返回 0）。
 * @param acc - 累计器。
 * @returns 0-1 错误率。
 */
export function getErrorRate(acc: PredictionAccumulator): number {
  if (acc.predictions.length < MIN_SAMPLES) return 0
  const errors = acc.predictions.filter(p => !p).length
  return errors / acc.predictions.length
}

/**
 * 干预级别（按错误率阈值，含等于）。
 * @param acc - 累计器。
 * @returns none / hint / gate / escalate。
 */
export function getInterventionLevel(acc: PredictionAccumulator): InterventionLevel {
  if (acc.predictions.length < MIN_SAMPLES) return 'none'
  const rate = getErrorRate(acc)
  if (rate >= ESCALATE_THRESHOLD) return 'escalate'
  if (rate >= GATE_THRESHOLD) return 'gate'
  if (rate >= HINT_THRESHOLD) return 'hint'
  return 'none'
}

/**
 * 是否达到 tipping point（连续 3 次正确——环境已恢复，可撤销干预）。
 * @param acc - 累计器。
 * @returns 连续正确 ≥3。
 */
export function shouldTippingPointReset(acc: PredictionAccumulator): boolean {
  return acc.consecutiveCorrect >= TIPPING_POINT_CONSECUTIVE
}
