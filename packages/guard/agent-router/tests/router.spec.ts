/**
 * router.spec.ts — 确定性路由表（指标 → 动作）。
 *
 * 覆盖：四规则优先级矩阵（escalate / gate+冷却 / 义务未决+零验证 / 默认 self）、
 * 义务提示进 task、无义务提示时 delegate 用通用任务描述。
 */
import { describe, expect, it } from 'vitest'
import { decideRouterAction, type EscalationPolicy, type RouterMetrics } from '../src/router.js'

function metrics(over: Partial<RouterMetrics> = {}): RouterMetrics {
  return {
    interventionLevel: 'none',
    consecutiveFailures: 0,
    unresolvedHigh: 0,
    verifications: 0,
    probeCooledTargets: 0,
    ...over,
  }
}

/** 缺省迟滞策略（cap verifier、连续失败 ≥2）。 */
const POLICY: EscalationPolicy = { cap: 'verifier', minConsecutiveFailures: 2 }

function decide(over: Partial<RouterMetrics> = {}, hint?: { claim: string; targets: string[] }, policy: EscalationPolicy = POLICY) {
  return decideRouterAction(metrics(over), hint, policy)
}

const obligationHint = { claim: '修复 X 崩溃', targets: ['src/foo.ts'] }

describe('decideRouterAction — 规则优先级', () => {
  it('escalate（错误率 ≥0.8）→ delegate verifier（最高优先级）', () => {
    const action = decide({ interventionLevel: 'escalate', consecutiveFailures: 2, unresolvedHigh: 1 }, obligationHint)
    expect(action.kind).toBe('delegate')
    if (action.kind === 'delegate') {
      expect(action.profile).toBe('verifier')
      expect(action.task).toContain('修复 X 崩溃')
      expect(action.targets).toEqual(['src/foo.ts'])
    }
  })

  it('gate + 探针冷却耗尽 → delegate code_scout', () => {
    const action = decide({ interventionLevel: 'gate', probeCooledTargets: 1 }, obligationHint)
    expect(action.kind).toBe('delegate')
    if (action.kind === 'delegate') {
      expect(action.profile).toBe('code_scout')
    }
  })

  it('gate 但探针未耗尽 → 不 delegate（保持 self，先让主循环自己试）', () => {
    const action = decide({ interventionLevel: 'gate', probeCooledTargets: 0 })
    expect(action.kind).toBe('self')
  })

  it('义务未决 + 零验证 → self（先写探针，证据门已拦编辑）', () => {
    const action = decide({ unresolvedHigh: 1, verifications: 0 })
    expect(action.kind).toBe('self')
  })

  it('义务未决但已有验证 → self（验证进行中，不打断）', () => {
    const action = decide({ unresolvedHigh: 1, verifications: 2 })
    expect(action.kind).toBe('self')
  })

  it('默认（无异常指标）→ self', () => {
    expect(decide().kind).toBe('self')
  })

  it('无义务提示时 delegate 用通用任务描述（不含 claim）', () => {
    const action = decide({ interventionLevel: 'escalate', consecutiveFailures: 2 })
    expect(action.kind).toBe('delegate')
    if (action.kind === 'delegate') {
      expect(action.task).toContain('独立复核')
      expect(action.targets).toEqual([])
    }
  })

  it('escalate 优先级高于 gate+冷却（同时触发取 escalate）', () => {
    const action = decide({ interventionLevel: 'escalate', consecutiveFailures: 2, probeCooledTargets: 3 })
    expect(action.kind).toBe('delegate')
    if (action.kind === 'delegate') expect(action.profile).toBe('verifier')
  })

  it('迟滞：escalate 但连续失败不足阈值 → self（单次偶发失败不升级）', () => {
    const action = decide({ interventionLevel: 'escalate', consecutiveFailures: 1 })
    expect(action.kind).toBe('self')
  })

  it('迟滞：escalate 且连续失败达阈值 → delegate verifier', () => {
    const action = decide({ interventionLevel: 'escalate', consecutiveFailures: 3 })
    expect(action.kind).toBe('delegate')
    if (action.kind === 'delegate') expect(action.profile).toBe('verifier')
  })

  it('cap off 关闭升级分支（即使指标与失败计数都满足）', () => {
    const action = decide(
      { interventionLevel: 'escalate', consecutiveFailures: 5 },
      obligationHint,
      { cap: 'off', minConsecutiveFailures: 2 },
    )
    expect(action.kind).toBe('self')
  })

  it('minConsecutiveFailures 可配（阈值 3 时连续失败 2 不升级）', () => {
    const action = decide(
      { interventionLevel: 'escalate', consecutiveFailures: 2 },
      undefined,
      { cap: 'verifier', minConsecutiveFailures: 3 },
    )
    expect(action.kind).toBe('self')
  })
})
