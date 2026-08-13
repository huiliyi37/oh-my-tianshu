/**
 * probe-candidates.ts — 探针候选生成（天枢 probe-candidates 精简移植）。
 *
 * 从存活假设（candidate/inconclusive）的未探过 targets 生成探针候选：
 * - 默认 targeted_test 且 expect:'fail'（RED 优先——为证据门服务的核心：
 *   先让缺陷红起来，再编辑）
 * - 预算紧张（≤3）只出 grep（轻量侦查）
 * - cooldown：同 kind+target 已冷却（uninformative ≥2）则跳过
 * 纯函数零 IO；宿主拿到候选后执行探针，结果经反馈更新假设与冷却。
 *
 * @module @deepseek-ai/dsh-evidence-gate/probe-candidates
 */

/** 探针类型。 */
export type ProbeKind = 'targeted_test' | 'grep' | 'micro_probe'

/** 假设状态（存活 = candidate/inconclusive 参与生成）。 */
export type HypothesisStatus = 'candidate' | 'supported' | 'refuted' | 'inconclusive'

/** 一条待验证假设（宿主维护：诊断循环中存活/终结）。 */
export interface Hypothesis {
  id: string
  /** 假设陈述（进探针 note）。 */
  claim: string
  status: HypothesisStatus
  /** 关联目标路径。 */
  targets: string[]
  /** 已探过的 target（不重复生成）。 */
  probed: string[]
}

/** 探针候选。 */
export interface ProbeCandidate {
  kind: ProbeKind
  /** 探针目标（文件路径）。 */
  target: string
  /** 期望结果：fail = 复现缺陷（RED）；pass = 行为保持；inspect = 侦查。 */
  expect: 'fail' | 'pass' | 'inspect'
  /** 给执行方的提示（假设陈述/搜索词）。 */
  note?: string
}

/** 生成选项。 */
export interface ProbeOptions {
  /** 本轮候选预算。 */
  budget: number
  /** 冷却表：`<kind>:<target>` → uninformative 累计次数（≥2 冷却）。 */
  cooldown?: Record<string, number>
}

/** 冷却阈值（同 kind+target 连续无信息次数）。 */
export const COOLDOWN_THRESHOLD = 2
/** 预算紧张阈值：≤此值只出 grep。 */
export const BUDGET_LOW_THRESHOLD = 3

/**
 * 生成探针候选。
 * @param hypotheses - 存活假设（candidate/inconclusive）。
 * @param options - 预算与冷却表。
 * @returns 候选清单（按假设顺序，最多 budget 条）。
 */
export function generateProbeCandidates(
  hypotheses: readonly Hypothesis[],
  options: ProbeOptions,
): ProbeCandidate[] {
  const out: ProbeCandidate[] = []
  const alive = hypotheses.filter(h => h.status === 'candidate' || h.status === 'inconclusive')
  for (const hypothesis of alive) {
    if (out.length >= options.budget) break
    for (const target of hypothesis.targets) {
      if (out.length >= options.budget) break
      if (hypothesis.probed.includes(target)) continue
      const kind: ProbeKind = options.budget <= BUDGET_LOW_THRESHOLD ? 'grep' : 'targeted_test'
      const key = `${kind}:${target}`
      if ((options.cooldown?.[key] ?? 0) >= COOLDOWN_THRESHOLD) continue
      out.push({
        kind,
        target,
        expect: kind === 'targeted_test' ? 'fail' : 'inspect', // RED 优先
        note: hypothesis.claim,
      })
    }
  }
  return out
}

/**
 * 反馈一次探针结果：有信息（informative）清除冷却；无信息（uninformative）
 * 累计冷却。宿主在探针执行后调用。
 * @param cooldown - 冷却表（就地更新）。
 * @param key - `<kind>:<target>`。
 * @param informative - 本次探针是否产出信息。
 * @returns 更新后的冷却计数。
 */
export function recordProbeFeedback(cooldown: Record<string, number>, key: string, informative: boolean): number {
  if (informative) {
    cooldown[key] = 0 // 置 0 = 未冷却（与缺失等价，避免 delete 的动态键惩罚）
    return 0
  }
  const next = (cooldown[key] ?? 0) + 1
  cooldown[key] = next
  return next
}
