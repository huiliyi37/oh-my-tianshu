/**
 * probe-suggest.ts — 精准 RED 探针建议算法（S4）。
 *
 * 给 agent 的下一步动作（而非"你该做点什么"）：
 * - 未验证目标 → targeted_test（tests/<同名>.spec.ts，expect fail = RED 优先）
 * - 已验证命令含目标（已试过该测试）→ 降级 grep（换侦查方式，避免重复）
 * - 冷却表 ≥2 → 跳过（无信息探针不重复）
 * 纯函数零 IO；tracker 提供已验证命令历史与冷却表。
 *
 * @module @huiliyi37/dsh-evidence-gate/probe-suggest
 */

/** RED 探针建议。 */
export interface RedProbeSuggestion {
  kind: 'targeted_test' | 'grep'
  /** 探针目标（义务 target）。 */
  target: string
  /** targeted_test 的建议测试文件路径（tests/<basename>.spec.ts）。 */
  testPath?: string
  /** 期望结果：fail = 复现缺陷（RED）；inspect = 侦查。 */
  expect: 'fail' | 'inspect'
  /** 选择理由/假设陈述（进拦截消息）。 */
  note?: string
}

/** 建议输入状态。 */
export interface RedProbeState {
  /** 已跑过的验证命令（applyVerification 历史）。 */
  verifiedCommands: readonly string[]
  /** 探针冷却表：`targeted_test:<target>` → 无信息累计。 */
  cooldown: Record<string, number>
}

/** 冷却阈值（同目标无信息 ≥2 跳过）。 */
export const SUGGEST_COOLDOWN_THRESHOLD = 2

/**
 * 判断目标是否已被验证命令覆盖（命令含目标路径或词干——近似匹配）。
 * @param command - 验证命令。
 * @param target - 目标路径。
 * @returns 覆盖判定。
 */
function commandCoversTarget(command: string, target: string): boolean {
  const normalized = command.replaceAll('\\', '/')
  const targetNorm = target.replaceAll('\\', '/')
  if (normalized.includes(targetNorm)) return true
  const base = targetNorm.split('/').pop() ?? targetNorm
  const stem = base.replace(/\.[^.]+$/, '')
  return stem.length > 2 && normalized.includes(stem)
}

/**
 * 生成测试文件路径建议：`tests/<basename>.spec.ts`。
 * @param target - 目标源码路径。
 * @returns 建议测试路径；无法派生时 undefined。
 */
export function deriveTestPath(target: string): string | undefined {
  const base = target.split('/').pop()
  if (base === undefined || base === '') return undefined
  const stem = base.replace(/\.[^.]+$/, '')
  if (stem === '') return undefined
  return `tests/${stem}.spec.ts`
}

/**
 * 生成精准 RED 探针建议（预算内按目标顺序，排除已验证/冷却目标）。
 * @param obligation - 义务（claim 作假设陈述，targets 作探针目标）。
 * @param state - 已验证命令历史 + 冷却表。
 * @param budget - 建议数量上限（默认 2）。
 * @returns 探针建议数组（无可用目标时为空）。
 */
export function suggestRedProbe(
  obligation: { claim: string; targets: string[] },
  state: RedProbeState,
  budget = 2,
): RedProbeSuggestion[] {
  const out: RedProbeSuggestion[] = []
  const seen = new Set<string>()
  for (const target of obligation.targets) {
    if (out.length >= budget) break
    if (seen.has(target)) continue
    seen.add(target)
    const tested = state.verifiedCommands.some(c => commandCoversTarget(c, target))
    const key = `targeted_test:${target}`
    const cooled = (state.cooldown[key] ?? 0) >= SUGGEST_COOLDOWN_THRESHOLD
    if (cooled) continue
    if (tested) {
      // 已验证目标：降级 grep（换侦查方式，避免重复 targeted_test）
      out.push({ kind: 'grep', target, expect: 'inspect', note: obligation.claim })
      continue
    }
    const testPath = deriveTestPath(target)
    out.push({
      kind: 'targeted_test',
      target,
      expect: 'fail',
      ...(testPath === undefined ? {} : { testPath }),
      note: obligation.claim,
    })
  }
  return out
}
