/**
 * tracker.spec.ts — ObligationTracker 有状态封装 + L1 编辑门（天枢 obligation-tracker 精简移植）。
 *
 * 覆盖：L1 门三分支（无 RED block / 测试路径豁免 / once latch 重发放行）、
 * 目标关联、risk/family 过滤、unresolvedHigh 与 supersedeAll。
 */
import { describe, expect, it } from 'vitest'
import { ObligationTracker } from '../src/tracker.js'
import { applyVerificationEvent } from '../src/obligation.js'

function makeTracker(overrides: { targets?: string[]; risk?: 'high' | 'medium'; family?: 'bugfix' | 'delivery' } = {}): ObligationTracker {
  const tracker = new ObligationTracker()
  tracker.create({
    family: overrides.family ?? 'bugfix',
    risk: overrides.risk ?? 'high',
    claim: '修复 X 崩溃',
    targets: overrides.targets ?? ['src/foo.ts'],
  })
  return tracker
}

describe('evaluateSourceEditGate — L1 编辑门', () => {
  it('high bugfix 无 RED 时编辑目标源文件 → block + 最短动作', () => {
    const tracker = makeTracker()
    const decision = tracker.evaluateSourceEditGate('src/foo.ts')
    expect(decision.block).toBe(true)
    expect(decision.message).toContain('RED')
    expect(decision.message).toContain('src/foo.ts')
  })

  it('测试/scratch 路径豁免（写测试就是 RED）', () => {
    const tracker = makeTracker()
    expect(tracker.evaluateSourceEditGate('src/foo.spec.ts').block).toBe(false)
    expect(tracker.evaluateSourceEditGate('tests/foo.spec.ts').block).toBe(false)
    expect(tracker.evaluateSourceEditGate('.rivet/scratch/probe.ts').block).toBe(false)
  })

  it('once latch：同一义务只拦一次，原样重发放行（不制造死锁）', () => {
    const tracker = makeTracker()
    expect(tracker.evaluateSourceEditGate('src/foo.ts').block).toBe(true)
    expect(tracker.evaluateSourceEditGate('src/foo.ts').block).toBe(false)
  })

  it('已有 RED 证据后放行', () => {
    const tracker = makeTracker()
    const store = applyVerificationEvent(
      tracker.snapshot(),
      { status: 'failed', command: 'pnpm vitest run foo.spec.ts', targetFiles: ['src/foo.ts'] },
    )
    tracker.restore(store)
    expect(tracker.evaluateSourceEditGate('src/foo.ts').block).toBe(false)
  })

  it('目标不关联的编辑不拦', () => {
    const tracker = makeTracker()
    expect(tracker.evaluateSourceEditGate('src/other.ts').block).toBe(false)
  })

  it('medium risk 或非 bugfix 不参与编辑门', () => {
    expect(makeTracker({ risk: 'medium' }).evaluateSourceEditGate('src/foo.ts').block).toBe(false)
    expect(makeTracker({ family: 'delivery' }).evaluateSourceEditGate('src/foo.ts').block).toBe(false)
  })

  it('无义务时全部放行', () => {
    const tracker = new ObligationTracker()
    expect(tracker.evaluateSourceEditGate('src/anything.ts').block).toBe(false)
  })
})

describe('unresolvedHigh / supersedeAll', () => {
  it('unresolvedHigh 列出 open/attempted 的 high 义务', () => {
    const tracker = makeTracker()
    expect(tracker.unresolvedHigh()).toHaveLength(1)
    expect(tracker.unresolvedHigh()[0]!.family).toBe('bugfix')
  })

  it('supersedeAll 作废未决义务，后续编辑放行', () => {
    const tracker = makeTracker()
    expect(tracker.evaluateSourceEditGate('src/foo.ts').block).toBe(true)
    tracker.supersedeAll()
    expect(tracker.evaluateSourceEditGate('src/foo.ts').block).toBe(false)
    expect(tracker.unresolvedHigh()).toHaveLength(0)
  })

  it('snapshot/restore 往返保持状态', () => {
    const tracker = makeTracker()
    const snap = tracker.snapshot()
    const restored = new ObligationTracker()
    restored.restore(snap)
    expect(restored.unresolvedHigh()).toHaveLength(1)
    expect(restored.evaluateSourceEditGate('src/foo.ts').block).toBe(true)
  })
})

describe('evaluateFinal 完整版（S4 once latch）', () => {
  it('无未决 high → allow', () => {
    const tracker = new ObligationTracker()
    expect(tracker.evaluateFinal().verdict).toBe('allow')
  })

  it('首次未决 → continue_once + 探针建议', () => {
    const tracker = makeTracker()
    const final = tracker.evaluateFinal()
    expect(final.verdict).toBe('continue_once')
    expect(final.nextAction?.obligationId).toBeDefined()
    expect(final.nextAction?.probes).toBeDefined()
    expect(final.nextAction?.probes![0]!.kind).toBe('targeted_test')
  })

  it('markContinued 后 → honest_blocked + 未决披露', () => {
    const tracker = makeTracker()
    const first = tracker.evaluateFinal()
    tracker.markContinued(first.nextAction!.obligationId)
    const second = tracker.evaluateFinal()
    expect(second.verdict).toBe('honest_blocked')
    expect(second.unresolved).toHaveLength(1)
    expect(second.unresolved![0]!.claim).toContain('修复 X 崩溃')
  })

  it('RED 后 satisfied → 后续 final allow（latch 不误伤）', () => {
    const tracker = makeTracker()
    tracker.applyVerification({ status: 'failed', command: 'pnpm vitest run foo.spec.ts', targetFiles: ['src/foo.ts'] })
    tracker.applyVerification({ status: 'passed', command: 'pnpm vitest run foo.spec.ts', targetFiles: ['src/foo.ts'] })
    expect(tracker.evaluateFinal().verdict).toBe('allow')
  })
})

describe('buildRedGateMessage（S4 探针建议）', () => {
  it('拦截消息含探针建议行（targeted_test + 测试路径）', () => {
    const tracker = makeTracker()
    const obligation = tracker.all()[0]!
    const message = tracker.buildRedGateMessage('src/foo.ts', obligation)
    expect(message).toContain('RED')
    expect(message).toContain('建议探针')
    expect(message).toContain('tests/foo.spec.ts')
    expect(message).toContain('期望失败')
  })

  it('已验证目标时建议降级 grep', () => {
    const tracker = makeTracker()
    tracker.applyVerification({ status: 'failed', command: 'pnpm vitest run tests/foo.spec.ts', targetFiles: ['src/foo.ts'] })
    const obligation = tracker.all()[0]!
    const message = tracker.buildRedGateMessage('src/foo.ts', obligation)
    expect(message).toContain('grep')
  })

  it('无可用探针（目标已冷却）时消息不含建议段', () => {
    const tracker = makeTracker()
    tracker.recordProbeFeedback('targeted_test:src/foo.ts', false)
    tracker.recordProbeFeedback('targeted_test:src/foo.ts', false) // 冷却 ≥2
    const obligation = tracker.all()[0]!
    const message = tracker.buildRedGateMessage('src/foo.ts', obligation)
    expect(message).toContain('RED')
    expect(message).not.toContain('建议探针')
  })

  it('targeted_test 无法派生 testPath 时建议行回退到 target', () => {
    const tracker = new ObligationTracker()
    tracker.create({ family: 'bugfix', risk: 'high', claim: '修复 X', targets: ['.git'] })
    const obligation = tracker.all()[0]!
    const message = tracker.buildRedGateMessage('.git', obligation)
    expect(message).toContain('.git')
    expect(message).toContain('targeted_test')
  })
})

describe('ObligationTracker 其余方法', () => {
  it('recordAttempt / satisfy / block 包装义务纯函数', () => {
    const tracker = makeTracker()
    const id = tracker.all()[0]!.id
    tracker.recordAttempt(id, 'edit_before_red')
    expect(tracker.all()[0]!.state).toBe('attempted')
    expect(tracker.all()[0]!.lastFailureClass).toBe('edit_before_red')
    tracker.satisfy(id, 'green: test pass')
    expect(tracker.all()[0]!.state).toBe('satisfied')
    expect(tracker.all()[0]!.evidenceRefs).toContain('green: test pass')
    tracker.block(id, 'verification_blocked')
    expect(tracker.all()[0]!.state).toBe('satisfied') // 终态保护
  })

  it('recordProbeFeedback 双向更新冷却表', () => {
    const tracker = makeTracker()
    tracker.recordProbeFeedback('targeted_test:src/foo.ts', false)
    expect(tracker.cooldownTable()['targeted_test:src/foo.ts']).toBe(1)
    tracker.recordProbeFeedback('targeted_test:src/foo.ts', true)
    expect(tracker.cooldownTable()['targeted_test:src/foo.ts']).toBe(0)
  })

  it('trackFileModified / tddState 维护编辑计数', () => {
    const tracker = makeTracker()
    expect(tracker.tddState()).toEqual({ editsSinceLastTest: 0, verifications: 0 })
    tracker.trackFileModified()
    tracker.trackFileModified()
    expect(tracker.tddState().editsSinceLastTest).toBe(2)
  })

  it('verificationCount 累计验证次数', () => {
    const tracker = makeTracker()
    expect(tracker.verificationCount()).toBe(0)
    tracker.applyVerification({ status: 'failed', command: 'pnpm vitest run foo.spec.ts', targetFiles: ['src/foo.ts'] })
    tracker.applyVerification({ status: 'passed', command: 'pnpm vitest run foo.spec.ts', targetFiles: ['src/foo.ts'] })
    expect(tracker.verificationCount()).toBe(2)
  })

  it('applyVerification 后编辑计数重置且命令入历史', () => {
    const tracker = makeTracker()
    tracker.trackFileModified()
    tracker.trackFileModified()
    tracker.applyVerification({ status: 'failed', command: 'pnpm vitest run foo.spec.ts', targetFiles: ['src/foo.ts'] })
    expect(tracker.tddState().editsSinceLastTest).toBe(0)
    // 已验证命令使 buildRedGateMessage 建议降级 grep（verifiedCommands 历史生效）
    const obligation = tracker.all()[0]!
    expect(tracker.buildRedGateMessage('src/foo.ts', obligation)).toContain('grep')
  })
})
