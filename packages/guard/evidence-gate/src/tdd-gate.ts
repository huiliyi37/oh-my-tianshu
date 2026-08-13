/**
 * tdd-gate.ts — TDD 门纯函数（天枢 tdd-gate 精简移植）。
 *
 * 语义：编辑累积（无验证）达阈值时提醒/拦截先写失败测试。suggest 模式
 * 只提示不硬拦（默认）；enforce 模式硬拦截（config 显式开启）。
 * 写测试文件豁免；skipIfNoTests 且项目无测试设施时豁免（不误伤）。
 *
 * @module @deepseek-ai/dsh-evidence-gate/tdd-gate
 */

/** 模式：suggest（默认，提示不拦）| enforce（硬拦截）。 */
export type TddMode = 'suggest' | 'enforce'

/** 判定输入（由 tracker 的编辑/验证计数提供）。 */
export interface TddGateInput {
  mode: TddMode
  /** 距上次验证的编辑次数（验证后重置）。 */
  editsSinceLastTest: number
  /** 验证计数（>0 即放行——已有验证证据）。 */
  verifications: number
  /** 编辑目标是否为测试文件（写测试豁免）。 */
  targetIsTestFile: boolean
  /** 项目是否存在测试设施（skipIfNoTests 用）。 */
  hasTests: boolean
  /** 编辑阈值（默认 3）。 */
  threshold?: number
}

/** 判定：allow 放行 / suggest 提示 / block 拦截。 */
export type TddVerdict = 'allow' | 'suggest' | 'block'

/** 默认编辑阈值（与天枢一致）。 */
export const DEFAULT_TDD_THRESHOLD = 3

/** 硬拦截消息（enforce 模式）。 */
export const TDD_BLOCK_MESSAGE =
  'Edit blocked by TDD gate: 连续编辑无验证（≥threshold 次）——先写一个失败的测试（RED）再改源码：' +
  'run_tests 或测试命令应先失败（=RED），再实现通过（=GREEN）。'

/**
 * 评估一次编辑的 TDD 判定。
 * @param input - 模式/计数/豁免条件。
 * @returns allow / suggest / block。
 */
export function evaluateTddGate(input: TddGateInput): TddVerdict {
  const threshold = input.threshold ?? DEFAULT_TDD_THRESHOLD
  if (input.targetIsTestFile) return 'allow' // 写测试就是 TDD
  if (input.verifications > 0) return 'allow' // 已有验证证据
  if (input.editsSinceLastTest < threshold) return 'allow'
  if (!input.hasTests) return 'allow' // 无测试设施不误伤（skipIfNoTests 语义）
  return input.mode === 'enforce' ? 'block' : 'suggest'
}
