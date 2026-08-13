/**
 * obligation.spec.ts — 证据义务纯状态机（天枢 evidence-obligation 精简移植）。
 *
 * 覆盖：创建/upsert 幂等、attempt 计数、satisfy/block/supersede 状态迁移、
 * RED 语义三规则（failed 记 red / passed 需先 RED / blocked≠satisfied）、
 * 验证-目标关联判定、acceptance 类不参与验证归账。
 */
import { describe, expect, it } from 'vitest'
import {
  applyVerificationEvent,
  blockObligation,
  createObligation,
  deriveObligationId,
  hasRedEvidence,
  recordAttempt,
  satisfyObligation,
  supersedeOpenObligations,
  verificationMatchesTargets,
  type EvidenceObligation,
  type ObligationStore,
  type VerificationMetadata,
} from '../src/obligation.js'

function makeStore(): ObligationStore {
  return { obligations: [] }
}

function find(store: ObligationStore, id: string): EvidenceObligation {
  const ob = store.obligations.find(o => o.id === id)
  if (ob === undefined) throw new Error(`obligation not found: ${id}`)
  return ob
}

const bugfixInput = {
  family: 'bugfix' as const,
  risk: 'high' as const,
  claim: '修复 X 崩溃',
  targets: ['src/foo.ts'],
}

describe('deriveObligationId / createObligation', () => {
  it('同 claim+family 派生稳定 ID', () => {
    expect(deriveObligationId('bugfix', '修复 X 崩溃')).toBe(deriveObligationId('bugfix', '修复 X 崩溃'))
    expect(deriveObligationId('bugfix', 'A')).not.toBe(deriveObligationId('bugfix', 'B'))
    expect(deriveObligationId('bugfix', 'A')).not.toBe(deriveObligationId('delivery', 'A'))
  })

  it('创建后状态 open，重复创建幂等（upsert 不重置）', () => {
    let store = makeStore()
    store = createObligation(store, bugfixInput)
    const id = find(store, deriveObligationId('bugfix', '修复 X 崩溃')).id
    store = recordAttempt(store, id, { failureClass: 'edit_before_red' })
    store = createObligation(store, bugfixInput)
    expect(find(store, id).state).toBe('attempted') // upsert 不覆盖已推进状态
    expect(store.obligations).toHaveLength(1)
  })
})

describe('recordAttempt / satisfy / block / supersede', () => {
  it('recordAttempt 计数并置 attempted', () => {
    let store = createObligation(makeStore(), bugfixInput)
    const id = store.obligations[0]!.id
    store = recordAttempt(store, id, { failureClass: 'edit_before_red' })
    const ob = find(store, id)
    expect(ob.state).toBe('attempted')
    expect(ob.attempts).toBe(1)
    expect(ob.lastFailureClass).toBe('edit_before_red')
  })

  it('satisfy 是唯一「证据到位」终态', () => {
    let store = createObligation(makeStore(), bugfixInput)
    const id = store.obligations[0]!.id
    store = satisfyObligation(store, id, 'green: test pass')
    const ob = find(store, id)
    expect(ob.state).toBe('satisfied')
    expect(ob.evidenceRefs).toContain('green: test pass')
  })

  it('block ≠ satisfied——受阻后仍可凭真实证据关闭', () => {
    let store = createObligation(makeStore(), bugfixInput)
    const id = store.obligations[0]!.id
    store = blockObligation(store, id, 'verification_blocked')
    expect(find(store, id).state).toBe('blocked')
    // blocked 义务凭真实证据仍可 satisfy
    store = satisfyObligation(store, id, 'green: test pass')
    expect(find(store, id).state).toBe('satisfied')
  })

  it('supersede 作废未决义务，不动 satisfied 历史', () => {
    let store = makeStore()
    store = createObligation(store, bugfixInput)
    const bugfixId = store.obligations[0]!.id
    store = createObligation(store, { family: 'delivery', risk: 'high', claim: '交付验证', targets: [] })
    const deliveryId = store.obligations[1]!.id
    store = satisfyObligation(store, deliveryId, 'green: full pass')
    store = supersedeOpenObligations(store)
    expect(find(store, bugfixId).state).toBe('superseded')
    expect(find(store, deliveryId).state).toBe('satisfied')
  })
})

describe('hasRedEvidence', () => {
  it('evidenceRefs 含 red: 前缀即真', () => {
    const ob: EvidenceObligation = {
      id: 'x', family: 'bugfix', risk: 'high', claim: '', targets: [],
      state: 'attempted', attempts: 0, evidenceRefs: ['red: test failed as expected'],
    }
    expect(hasRedEvidence(ob)).toBe(true)
  })

  it('仅 green: 或空引用为假', () => {
    expect(hasRedEvidence({ ...({ id: 'x', family: 'bugfix', risk: 'high', claim: '', targets: [], state: 'open', attempts: 0, evidenceRefs: [] } as EvidenceObligation) })).toBe(false)
    expect(hasRedEvidence({ ...({ id: 'x', family: 'bugfix', risk: 'high', claim: '', targets: [], state: 'attempted', attempts: 0, evidenceRefs: ['green: pass'] } as EvidenceObligation) })).toBe(false)
  })
})

describe('verificationMatchesTargets', () => {
  const meta = (over: Partial<VerificationMetadata> = {}): VerificationMetadata => ({
    status: 'passed', command: 'pnpm vitest run src/foo.spec.ts', ...over,
  })

  it('targetFiles 交集命中（命令无词干干扰时）', () => {
    expect(verificationMatchesTargets(meta({ targetFiles: ['src/foo.ts'], command: 'pnpm vitest run other' }), ['src/foo.ts'])).toBe(true)
    expect(verificationMatchesTargets(meta({ targetFiles: ['src/bar.ts'], command: 'pnpm vitest run other' }), ['src/foo.ts'])).toBe(false)
  })

  it('命令文本含目标路径或词干命中', () => {
    expect(verificationMatchesTargets(meta({ command: 'pnpm vitest run tests/foo.spec.ts' }), ['src/foo.ts'])).toBe(true)
    expect(verificationMatchesTargets(meta({ command: 'pnpm vitest run foo' }), ['src/foo.ts'])).toBe(true)
    expect(verificationMatchesTargets(meta({ command: 'pnpm test' }), ['src/foo.ts'])).toBe(false)
  })

  it('无目标义务：任何验证都算相关', () => {
    expect(verificationMatchesTargets(meta({ command: 'pnpm test' }), [])).toBe(true)
  })
})

describe('applyVerificationEvent — RED 三规则', () => {
  const bugfixMeta = (status: VerificationMetadata['status']): VerificationMetadata => ({
    status, command: 'pnpm vitest run tests/foo.spec.ts', targetFiles: ['src/foo.ts'],
  })

  it('blocked 只记 attempt，不满足 RED、不关闭义务', () => {
    let store = createObligation(makeStore(), bugfixInput)
    store = applyVerificationEvent(store, bugfixMeta('blocked'))
    const ob = find(store, deriveObligationId('bugfix', '修复 X 崩溃'))
    expect(ob.state).toBe('attempted') // recordAttempt 语义
    expect(ob.attempts).toBe(1)
    expect(hasRedEvidence(ob)).toBe(false)
  })

  it('failed + bugfix + 目标关联 → 记 red: 证据（状态仍 attempted）', () => {
    let store = createObligation(makeStore(), bugfixInput)
    store = applyVerificationEvent(store, bugfixMeta('failed'))
    const ob = find(store, deriveObligationId('bugfix', '修复 X 崩溃'))
    expect(ob.state).toBe('attempted')
    expect(hasRedEvidence(ob)).toBe(true)
  })

  it('failed 但目标无关 → 不归账（无 attempt、无 RED）', () => {
    let store = createObligation(makeStore(), bugfixInput)
    store = applyVerificationEvent(store, { status: 'failed', command: 'pnpm vitest run unrelated', targetFiles: ['src/other.ts'] })
    const ob = find(store, deriveObligationId('bugfix', '修复 X 崩溃'))
    expect(ob.attempts).toBe(0)
    expect(hasRedEvidence(ob)).toBe(false)
  })

  it('passed + bugfix + 无 RED → 不 satisfied（pass-without-red 不是证据）', () => {
    let store = createObligation(makeStore(), bugfixInput)
    store = applyVerificationEvent(store, bugfixMeta('passed'))
    const ob = find(store, deriveObligationId('bugfix', '修复 X 崩溃'))
    expect(ob.state).not.toBe('satisfied')
  })

  it('passed + bugfix + 已有 RED → satisfied（GREEN 由 RED 背书）', () => {
    let store = createObligation(makeStore(), bugfixInput)
    store = applyVerificationEvent(store, bugfixMeta('failed')) // RED
    store = applyVerificationEvent(store, bugfixMeta('passed')) // GREEN
    const ob = find(store, deriveObligationId('bugfix', '修复 X 崩溃'))
    expect(ob.state).toBe('satisfied')
    expect(ob.evidenceRefs.some(r => r.startsWith('red:'))).toBe(true)
  })

  it('passed + delivery → 直接 satisfied（无 RED 要求）', () => {
    let store = createObligation(makeStore(), { family: 'delivery', risk: 'high', claim: '交付', targets: [] })
    store = applyVerificationEvent(store, { status: 'passed', command: 'pnpm test', targetFiles: [] })
    expect(find(store, deriveObligationId('delivery', '交付')).state).toBe('satisfied')
  })

  it('已 satisfied / superseded 义务不再被验证事件改动', () => {
    let store = createObligation(makeStore(), { family: 'delivery', risk: 'high', claim: '交付', targets: [] })
    const id = store.obligations[0]!.id
    store = satisfyObligation(store, id, 'green: pass')
    store = applyVerificationEvent(store, { status: 'failed', command: 'pnpm test', targetFiles: [] })
    expect(find(store, id).state).toBe('satisfied')
  })
})

describe('mapObligation 无变化路径与状态保护', () => {
  it('recordAttempt 对不存在的 id 返回原 store（引用相等）', () => {
    const store = createObligation(makeStore(), bugfixInput)
    expect(recordAttempt(store, 'missing-id')).toBe(store)
  })

  it('recordAttempt 不带 failureClass 时保持 lastFailureClass 为空', () => {
    let store = createObligation(makeStore(), bugfixInput)
    const id = store.obligations[0]!.id
    store = recordAttempt(store, id) // detail 缺省 → failureClass undefined
    const ob = find(store, id)
    expect(ob.state).toBe('attempted')
    expect(ob.attempts).toBe(1)
    expect(ob.lastFailureClass).toBeUndefined()
  })

  it('recordAttempt 对 satisfied 义务原样返回（终态保护）', () => {
    let store = createObligation(makeStore(), bugfixInput)
    const id = store.obligations[0]!.id
    store = satisfyObligation(store, id, 'green: pass')
    const next = recordAttempt(store, id, { failureClass: 'edit_before_red' })
    expect(next).toBe(store)
    expect(find(next, id).attempts).toBe(0)
  })

  it('satisfy 对 superseded 义务原样返回（不复活）', () => {
    let store = createObligation(makeStore(), bugfixInput)
    const id = store.obligations[0]!.id
    store = supersedeOpenObligations(store)
    const next = satisfyObligation(store, id, 'green: pass')
    expect(next).toBe(store)
    expect(find(next, id).state).toBe('superseded')
  })

  it('satisfy 同一证据引用不重复追加', () => {
    let store = createObligation(makeStore(), bugfixInput)
    const id = store.obligations[0]!.id
    store = satisfyObligation(store, id, 'green: pass')
    const refs = find(store, id).evidenceRefs
    store = satisfyObligation(store, id, 'green: pass')
    expect(find(store, id).evidenceRefs).toEqual(refs)
  })

  it('block 对 satisfied 义务原样返回（终态保护）', () => {
    let store = createObligation(makeStore(), bugfixInput)
    const id = store.obligations[0]!.id
    store = satisfyObligation(store, id, 'green: pass')
    const next = blockObligation(store, id, 'verification_blocked')
    expect(next).toBe(store)
    expect(find(next, id).state).toBe('satisfied')
  })
})

describe('verificationMatchesTargets 补充', () => {
  const meta = (over: Partial<VerificationMetadata> = {}): VerificationMetadata => ({
    status: 'passed', command: 'pnpm vitest run src/foo.spec.ts', ...over,
  })

  it('命令文本含完整目标路径命中（includes 完整路径分支）', () => {
    expect(verificationMatchesTargets(meta({ command: 'pnpm vitest run src/foo.ts' }), ['src/foo.ts'])).toBe(true)
    expect(verificationMatchesTargets(meta({ command: 'pnpm vitest run src/bar.ts' }), ['src/foo.ts'])).toBe(false)
  })
})

describe('applyVerificationEvent — 边界与防御', () => {
  const bugfixMeta = (status: VerificationMetadata['status']): VerificationMetadata => ({
    status, command: 'pnpm vitest run tests/foo.spec.ts', targetFiles: ['src/foo.ts'],
  })

  it('未知义务族（非四族）不参与归账（switch default）', () => {
    const store: ObligationStore = {
      obligations: [{
        id: 'weird',
        family: 'acceptance' as never,
        risk: 'high' as const,
        claim: 'x',
        targets: [],
        state: 'open',
        evidenceRefs: [],
        attempts: 0,
      }],
    }
    const next = applyVerificationEvent(store, { status: 'passed', command: 'pnpm test', targetFiles: [] })
    expect(next.obligations[0]!.state).toBe('open')
    expect(next.obligations[0]!.attempts).toBe(0)
  })

  it('blocked 且目标不关联 → 不记录 attempt', () => {
    let store = createObligation(makeStore(), bugfixInput)
    store = applyVerificationEvent(store, {
      status: 'blocked', command: 'pnpm vitest run other', targetFiles: ['src/other.ts'],
    })
    const ob = find(store, deriveObligationId('bugfix', '修复 X 崩溃'))
    expect(ob.state).toBe('open')
    expect(ob.attempts).toBe(0)
  })

  it('failed 同一命令重复 → 证据引用不重复追加', () => {
    let store = createObligation(makeStore(), bugfixInput)
    const meta = bugfixMeta('failed')
    store = applyVerificationEvent(store, meta)
    const refs = find(store, deriveObligationId('bugfix', '修复 X 崩溃')).evidenceRefs
    store = applyVerificationEvent(store, meta)
    expect(find(store, deriveObligationId('bugfix', '修复 X 崩溃')).evidenceRefs).toEqual(refs)
  })

  it('failed + 非 bugfix 族 + 目标关联 → 记 verification_failed attempt', () => {
    let store = createObligation(makeStore(), { family: 'delivery', risk: 'high', claim: '交付', targets: ['src/foo.ts'] })
    store = applyVerificationEvent(store, {
      status: 'failed', command: 'pnpm vitest run foo', targetFiles: ['src/foo.ts'],
    })
    const ob = find(store, deriveObligationId('delivery', '交付'))
    expect(ob.state).toBe('attempted')
    expect(ob.lastFailureClass).toBe('verification_failed')
  })

  it('passed 但目标不关联 → 不关闭（continue）', () => {
    let store = createObligation(makeStore(), bugfixInput)
    store = applyVerificationEvent(store, {
      status: 'passed', command: 'pnpm vitest run other', targetFiles: ['src/other.ts'],
    })
    const ob = find(store, deriveObligationId('bugfix', '修复 X 崩溃'))
    expect(ob.state).toBe('open')
  })
})
