/**
 * obligation.ts — 证据义务纯函数状态机（天枢 evidence-obligation 精简移植）。
 *
 * 零 IO、零依赖、纯状态迁移。义务生命周期：
 * open → attempted（有尝试）→ satisfied（证据到位，唯一终态）
 *                     → blocked（受阻，≠ satisfied——凭真实证据仍可关闭）
 *                     → superseded（新任务边界作废未决义务）
 *
 * RED 语义（bugfix 义务）：GREEN 必须由 RED 背书——测试先失败（记 red: 证据）
 * 才允许编辑放行，passed 而无 RED 记 pass-without-red（不满足）。
 *
 * @module @huiliyi37/dsh-evidence-gate/obligation
 */

/** 义务族：bugfix 需 RED→GREEN 闭环；delivery/regression/behavior 由通过验证关闭。 */
export type ObligationFamily = 'bugfix' | 'delivery' | 'regression' | 'behavior'
/** 风险档：high 参与 L1 编辑门；medium 仅跟踪。 */
export type ObligationRisk = 'high' | 'medium'
/** 状态机：satisfied 是唯一「证据到位」终态。 */
export type ObligationState = 'open' | 'attempted' | 'satisfied' | 'blocked' | 'superseded'

/** 一条证据义务。 */
export interface EvidenceObligation {
  /** 稳定 ID（family+claim 派生）。 */
  id: string
  family: ObligationFamily
  risk: ObligationRisk
  /** 义务陈述（用户可见，进编辑门拦截消息）。 */
  claim: string
  /** 关联目标路径（验证/编辑关联判定）。 */
  targets: string[]
  state: ObligationState
  /** 证据引用（`red:` 前缀为 RED 证据，`green:` 为通过证据）。 */
  evidenceRefs: string[]
  /** 尝试次数（驱动升级阶梯）。 */
  attempts: number
  /** 最近失败类别（edit_before_red / verification_blocked / …）。 */
  lastFailureClass?: string
}

/** 义务存储（不可变更新，返回新 store）。 */
export interface ObligationStore {
  obligations: EvidenceObligation[]
}

/** 创建义务的输入。 */
export interface ObligationInput {
  family: ObligationFamily
  risk: ObligationRisk
  claim: string
  targets: string[]
}

/** RED 证据引用前缀——bugfix 义务先 RED 再 GREEN。 */
export const RED_REF_PREFIX = 'red:'

/** FNV-1a 32-bit 哈希（稳定、无依赖）。 */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

/**
 * 义务稳定 ID：family + claim 派生（同义务重复创建幂等）。
 * @param family - 义务族。
 * @param claim - 义务陈述。
 * @returns 稳定 ID（`<family>-<hash>`）。
 */
export function deriveObligationId(family: ObligationFamily, claim: string): string {
  return `${family}-${fnv1a(claim)}`
}

/**
 * 创建义务（upsert 幂等：同 id 已存在时不重置已推进状态）。
 * @param store - 当前存储。
 * @param input - 义务声明。
 * @returns 新存储。
 */
export function createObligation(store: ObligationStore, input: ObligationInput): ObligationStore {
  const id = deriveObligationId(input.family, input.claim)
  if (store.obligations.some(o => o.id === id)) return store
  return {
    obligations: [...store.obligations, {
      id,
      family: input.family,
      risk: input.risk,
      claim: input.claim,
      targets: input.targets,
      state: 'open',
      evidenceRefs: [],
      attempts: 0,
    }],
  }
}

function mapObligation(
  store: ObligationStore,
  id: string,
  fn: (ob: EvidenceObligation) => EvidenceObligation,
): ObligationStore {
  const obligations = store.obligations.map((o) => {
    if (o.id !== id) return o
    return fn(o)
  })
  const changed = obligations.some((o, i) => o !== store.obligations[i])
  return changed ? { obligations } : store
}

/**
 * 登记一次尝试（编辑门拦截 / 失败信号 / 验证受阻）。
 * @param store - 当前存储。
 * @param id - 义务 id。
 * @param detail - 失败类别（可空）。
 * @returns 新存储。
 */
export function recordAttempt(store: ObligationStore, id: string, detail: { failureClass?: string } = {}): ObligationStore {
  return mapObligation(store, id, (ob) => {
    if (ob.state === 'satisfied' || ob.state === 'superseded') return ob
    return {
      ...ob,
      state: 'attempted',
      attempts: ob.attempts + 1,
      ...(detail.failureClass === undefined ? {} : { lastFailureClass: detail.failureClass }),
    }
  })
}

/**
 * 关闭义务（证据到位）。satisfied 是唯一「证据到位」终态。
 * @param store - 当前存储。
 * @param id - 义务 id。
 * @param evidenceRef - 证据引用（如 `green: test pass`）。
 * @returns 新存储。
 */
export function satisfyObligation(store: ObligationStore, id: string, evidenceRef: string): ObligationStore {
  return mapObligation(store, id, (ob) => {
    if (ob.state === 'superseded') return ob
    const evidenceRefs = ob.evidenceRefs.includes(evidenceRef) ? ob.evidenceRefs : [...ob.evidenceRefs, evidenceRef]
    return { ...ob, state: 'satisfied', evidenceRefs }
  })
}

/**
 * 标记受阻（环境/权限/依赖不可用）。不是 satisfied——受阻后凭真实证据仍可关闭，
 * 但「受阻」本身不构成「已证」。
 * @param store - 当前存储。
 * @param id - 义务 id。
 * @param reason - 受阻原因（记入 lastFailureClass）。
 * @returns 新存储。
 */
export function blockObligation(store: ObligationStore, id: string, reason: string): ObligationStore {
  return mapObligation(store, id, (ob) => {
    if (ob.state === 'satisfied' || ob.state === 'superseded') return ob
    return { ...ob, state: 'blocked', lastFailureClass: reason }
  })
}

/**
 * 任务边界：作废所有未决义务（不误伤 satisfied 历史）。
 * @param store - 当前存储。
 * @returns 新存储。
 */
export function supersedeOpenObligations(store: ObligationStore): ObligationStore {
  return {
    obligations: store.obligations.map(o =>
      o.state === 'open' || o.state === 'attempted' || o.state === 'blocked'
        ? { ...o, state: 'superseded' as const }
        : o,
    ),
  }
}

/**
 * 义务是否已有 RED 证据（bugfix 编辑门放行条件）。
 * @param ob - 义务。
 * @returns 有 `red:` 前缀证据引用。
 */
export function hasRedEvidence(ob: EvidenceObligation): boolean {
  return ob.evidenceRefs.some(r => r.startsWith(RED_REF_PREFIX))
}

/** 一次真实验证事件（来自工具结果检测，零测试框架耦合）。 */
export interface VerificationMetadata {
  /** passed / failed / blocked（受阻）。 */
  status: 'passed' | 'failed' | 'blocked'
  /** 验证命令文本（用于目标关联判定）。 */
  command: string
  /** 验证涉及的目标文件（可选）。 */
  targetFiles?: string[]
}

/**
 * 验证目标与义务目标关联判定：targetFiles 交集，或命令文本包含目标路径/词干。
 * @param meta - 验证事件。
 * @param targets - 义务目标。
 * @returns 是否关联。
 */
export function verificationMatchesTargets(meta: VerificationMetadata, targets: readonly string[]): boolean {
  if (targets.length === 0) return true // 无目标义务：任何验证都算相关
  const normalizedTargets = targets.map(t => t.replaceAll('\\', '/'))
  const metaFiles = (meta.targetFiles ?? []).map(t => t.replaceAll('\\', '/'))
  if (metaFiles.some(f => normalizedTargets.some(t => f.includes(t) || t.includes(f)))) return true
  const command = meta.command.replaceAll('\\', '/')
  return normalizedTargets.some((t) => {
    if (command.includes(t)) return true
    const base = t.split('/').pop() ?? t
    const stem = base.replace(/\.[^.]+$/, '')
    return stem.length > 2 && command.includes(stem)
  })
}

/**
 * 把一次验证事件归账到义务状态（RED 三规则）：
 * - blocked 只记 attempted（「尝试过验证」≠「关闭了事实义务」）
 * - failed 仅当失败目标与 bugfix 义务关联时记 red: 证据（状态仍 attempted，等待 GREEN）
 * - passed：bugfix 需先有 RED 才能 satisfied；delivery/regression/behavior 由关联通过关闭
 * 无 acceptance 类——本内核只含四族，未来新增族须显式加入 awaitsVerification 集合
 * （天枢 acceptance 刻意排除验证归账，防单测假绿关闭用户级验收）。
 * @param store - 当前存储。
 * @param meta - 验证事件。
 * @returns 新存储。
 */
export function applyVerificationEvent(store: ObligationStore, meta: VerificationMetadata): ObligationStore {
  let next = store
  for (const ob of store.obligations) {
    if (ob.state === 'satisfied' || ob.state === 'superseded') continue
    // 无 acceptance 类——本内核只含四族，未来新增族须显式加入此集合
    // （天枢 acceptance 刻意排除验证归账，防单测假绿关闭用户级验收）。
    switch (ob.family) {
      case 'bugfix':
      case 'delivery':
      case 'regression':
      case 'behavior':
        break
      default:
        continue
    }
    const matches = verificationMatchesTargets(meta, ob.targets)

    if (meta.status === 'blocked') {
      if (matches) next = recordAttempt(next, ob.id, { failureClass: 'verification_blocked' })
      continue
    }

    if (meta.status === 'failed') {
      if (ob.family === 'bugfix' && matches) {
        const ref = `${RED_REF_PREFIX} ${meta.command}`
        next = mapObligation(next, ob.id, (o) => {
          const evidenceRefs = o.evidenceRefs.includes(ref) ? o.evidenceRefs : [...o.evidenceRefs, ref]
          return { ...o, state: 'attempted', attempts: o.attempts + 1, evidenceRefs }
        })
      } else if (matches) {
        next = recordAttempt(next, ob.id, { failureClass: 'verification_failed' })
      }
      continue
    }

    // passed
    if (!matches) continue
    if (ob.family === 'bugfix' && !hasRedEvidence(ob)) continue // pass-without-red 不是证据
    next = satisfyObligation(next, ob.id, `green: ${meta.command}`)
  }
  return next
}
