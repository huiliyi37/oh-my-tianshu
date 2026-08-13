/**
 * tracker.ts — ObligationTracker 有状态封装（天枢 obligation-tracker 精简移植）。
 *
 * 持有义务存储 + L1 编辑门（evaluateSourceEditGate）+ once latch + 快照/恢复。
 * 编辑门语义（与天枢一致）：
 * - high bugfix 义务、状态 open/attempted、无 RED 证据、目标关联、从未拦过
 *   → 返回 block + 最短动作消息；测试/scratch 路径豁免（写测试就是 RED）。
 * - 同一义务只拦一次（once latch）——模型坚持编辑（重发）则放行，不制造死锁。
 *
 * @module @huiliyi37/dsh-evidence-gate/tracker
 */

import {
  applyVerificationEvent,
  blockObligation,
  createObligation,
  hasRedEvidence,
  recordAttempt,
  satisfyObligation,
  supersedeOpenObligations,
  type EvidenceObligation,
  type ObligationInput,
  type ObligationStore,
  type VerificationMetadata,
} from './obligation.js'
import { suggestRedProbe, type RedProbeSuggestion } from './probe-suggest.js'

/** 编辑门豁免路径：测试文件与 scratch 探针（写测试就是 RED 动作）。 */
export const RED_EXEMPT_PATH_RE = /(^|\/)(tests?|__tests__|\.rivet\/scratch)\//i

/** 编辑门判定结果。 */
export interface SourceEditGateDecision {
  /** true = 拒绝本次编辑。 */
  block: boolean
  /** 拦截消息（含最短动作指引）；放行时为空串。 */
  message: string
}

/** final 判定（S4 完整版：continue_once 带探针建议；honest_blocked 披露未决清单）。 */
export interface FinalEvaluation {
  verdict: 'allow' | 'continue_once' | 'honest_blocked'
  nextAction?: {
    obligationId: string
    probes?: RedProbeSuggestion[]
  }
  /** honest_blocked 披露的未决义务清单。 */
  unresolved?: { id: string; claim: string }[]
}

/**
 * 有状态义务追踪器。零依赖（只依赖本包 obligation 纯函数），
 * 线程内单例持有；插件层负责接线工具门与验证事件。
 */
export class ObligationTracker {
  private store: ObligationStore = { obligations: [] }
  /** once latch：同一义务只拦一次编辑。 */
  private readonly redGateFired = new Set<string>()
  /** TDD 门状态：距上次验证的编辑次数（验证后重置）。 */
  private editsSinceLastTest = 0
  /** TDD 门状态：验证计数（测试命令归账次数）。 */
  private verifications = 0
  /** 已验证命令历史（探针建议去重用）。 */
  private verifiedCommands: string[] = []
  /** 探针冷却表（无信息累计；probe-suggest 消费）。 */
  private cooldown: Record<string, number> = {}
  /** final once latch：未决 high 义务只 continue_once 一次。 */
  private readonly continuedOnce = new Set<string>()

  /**
   * 创建义务（upsert 幂等）。
   * @param input - 义务声明（同 id 重复创建按 upsert 处理）。
   */
  create(input: ObligationInput): void {
    this.store = createObligation(this.store, input)
  }

  /**
   * 登记尝试（工具失败信号等）。
   * @param id - 目标义务 id。
   * @param failureClass - 失败归类标签（如 `edit_before_red`）。
   */
  recordAttempt(id: string, failureClass: string): void {
    this.store = recordAttempt(this.store, id, { failureClass })
  }

  /**
   * 关闭义务（证据到位）。
   * @param id - 目标义务 id。
   * @param evidenceRef - 证据引用（验证命令、事件 id 等可追溯标识）。
   */
  satisfy(id: string, evidenceRef: string): void {
    this.store = satisfyObligation(this.store, id, evidenceRef)
  }

  /**
   * 标记受阻（环境/权限/依赖不可用）。
   * @param id - 目标义务 id。
   * @param reason - 受阻原因，进入 final 披露。
   */
  block(id: string, reason: string): void {
    this.store = blockObligation(this.store, id, reason)
  }

  /** 任务边界：作废所有未决义务。 */
  supersedeAll(): void {
    this.store = supersedeOpenObligations(this.store)
  }

  /**
   * 归账一次验证事件（RED 三规则见 obligation.applyVerificationEvent）。
   * @param meta - 验证元数据（命令、状态、目标文件）。
   */
  applyVerification(meta: VerificationMetadata): void {
    this.store = applyVerificationEvent(this.store, meta)
    this.verifications++
    this.editsSinceLastTest = 0 // 验证后编辑计数重置
    if (!this.verifiedCommands.includes(meta.command)) this.verifiedCommands.push(meta.command)
  }

  /**
   * 探针反馈：有信息清除冷却；无信息累计（probe-suggest 消费）。
   * @param key - 探针标识（命令或目标）。
   * @param informative - 该探针本次是否产出了有用信息。
   */
  recordProbeFeedback(key: string, informative: boolean): void {
    if (informative) {
      this.cooldown[key] = 0
      return
    }
    this.cooldown[key] = (this.cooldown[key] ?? 0) + 1
  }

  /** 编辑计数（编辑工具放行后调用；供 TDD 门使用）。 */
  trackFileModified(): void {
    this.editsSinceLastTest++
  }

  /**
   * TDD 门输入（编辑/验证计数快照）。
   * @returns 距上次验证的编辑次数与累计验证次数。
   */
  tddState(): { editsSinceLastTest: number; verifications: number } {
    return { editsSinceLastTest: this.editsSinceLastTest, verifications: this.verifications }
  }

  /**
   * 验证计数（agent-router 消费）。
   * @returns 本会话已归账的验证次数。
   */
  verificationCount(): number {
    return this.verifications
  }

  /**
   * 探针冷却表（agent-router 消费：冷却 ≥2 的目标数）。
   * @returns 探针标识 → 连续无信息次数的副本快照。
   */
  cooldownTable(): Record<string, number> {
    return { ...this.cooldown }
  }

  /**
   * L1 编辑门：high bugfix 义务尚无 RED 证据时，对目标源文件的首次编辑
   * 返回 block + 最短动作；测试/scratch 豁免；once latch 防死锁。
   * @param filePath - 编辑目标文件路径。
   * @returns block 判定 + 消息。
   */
  evaluateSourceEditGate(filePath: string | undefined): SourceEditGateDecision {
    if (!filePath || RED_EXEMPT_PATH_RE.test(filePath)) return { block: false, message: '' }
    const normalized = filePath.replaceAll('\\', '/')
    for (const ob of this.store.obligations) {
      if (ob.family !== 'bugfix' || ob.risk !== 'high') continue
      if (ob.state !== 'open' && ob.state !== 'attempted') continue
      if (hasRedEvidence(ob)) continue
      if (this.redGateFired.has(ob.id)) continue
      const matches = ob.targets.length === 0
        || ob.targets.some(t => normalized.includes(t) || t.includes(normalized))
      if (!matches) continue
      this.redGateFired.add(ob.id)
      this.store = recordAttempt(this.store, ob.id, { failureClass: 'edit_before_red' })
      return {
        block: true,
        message: `Edit blocked by evidence gate (once): 该任务的 bugfix 义务「${ob.claim}」还没有 RED 复现——` +
          `修复未被证明存在的缺陷是最常见的假修复。先写一个失败的测试（或 .rivet/scratch/ 探针）复现目标缺陷，看到 RED 再改 ${filePath}。` +
          '如果你确认不需要复现（例如纯重构/文案），原样重发本次编辑即可放行。',
      }
    }
    return { block: false, message: '' }
  }

  /**
   * 未决高风险义务（供宿主展示/升级）。
   * @returns 处于 open/attempted 的 high 风险义务。
   */
  unresolvedHigh(): readonly EvidenceObligation[] {
    return this.store.obligations.filter(
      o => o.risk === 'high' && (o.state === 'open' || o.state === 'attempted'),
    )
  }

  /**
   * 所有义务（只读视图）。
   * @returns 当前 store 内的全部义务，含已关闭与已作废。
   */
  all(): readonly EvidenceObligation[] {
    return this.store.obligations
  }

  /**
   * final 判定（完整版，天枢 once latch 语义）：
   * - 无未决 high → allow
   * - 首次未决 → continue_once + nextAction（含精准探针建议）
   * - 已续过（markContinued）→ honest_blocked + 未决清单披露
   * @returns final 判定（allow / continue_once + 下一步动作 / honest_blocked + 未决清单）。
   */
  evaluateFinal(): FinalEvaluation {
    const high = this.unresolvedHigh()
    const first = high[0]
    if (first === undefined) return { verdict: 'allow' }
    if (!this.continuedOnce.has(first.id)) {
      return {
        verdict: 'continue_once',
        nextAction: {
          obligationId: first.id,
          probes: suggestRedProbe(first, {
            verifiedCommands: this.verifiedCommands,
            cooldown: this.cooldown,
          }),
        },
      }
    }
    return {
      verdict: 'honest_blocked',
      unresolved: high.map(o => ({ id: o.id, claim: o.claim })),
    }
  }

  /**
   * 登记 final 续轮（宿主在注入 continue_once 动作后调用；保证只续一次）。
   * @param obligationId - 已续轮的义务 id。
   */
  markContinued(obligationId: string): void {
    this.continuedOnce.add(obligationId)
  }

  /**
   * 构建 L1 编辑门拦截消息（含精准探针建议行）。
   * @param filePath - 被拦编辑目标。
   * @param obligation - 触发的义务。
   * @returns 拦截消息（含建议行；无可用探针时退回纯文本）。
   */
  buildRedGateMessage(filePath: string, obligation: EvidenceObligation): string {
    const probes = suggestRedProbe(obligation, {
      verifiedCommands: this.verifiedCommands,
      cooldown: this.cooldown,
    })
    let message = `Edit blocked by evidence gate (once): 该任务的 bugfix 义务「${obligation.claim}」还没有 RED 复现——` +
      `修复未被证明存在的缺陷是最常见的假修复。先写一个失败的测试（或 .rivet/scratch/ 探针）复现目标缺陷，看到 RED 再改 ${filePath}。`
    if (probes.length > 0) {
      const lines = probes.map((p) => {
        const path = p.kind === 'targeted_test' ? ` → ${p.testPath ?? p.target}` : ''
        return `  - ${p.kind === 'targeted_test' ? 'targeted_test（期望失败）' : 'grep（侦查）'}: ${p.target}${path}`
      })
      message += `\n建议探针:\n${lines.join('\n')}`
    }
    message += '\n如果你确认不需要复现（例如纯重构/文案），原样重发本次编辑即可放行。'
    return message
  }

  /**
   * 快照（供持久化/测试）。义务逐条浅拷贝，调用方改动不回写本 tracker。
   * @returns 当前义务 store 的拷贝。
   */
  snapshot(): ObligationStore {
    return { obligations: this.store.obligations.map(o => ({ ...o })) }
  }

  /**
   * 恢复快照（测试/重启）。直接接管传入对象，不做拷贝，也不重置 once latch
   * 与 TDD 计数（那些是进程内状态）。
   * @param store - 待接管的义务 store。
   */
  restore(store: ObligationStore): void {
    this.store = store
  }
}
