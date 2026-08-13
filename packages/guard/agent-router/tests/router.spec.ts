/**
 * router.spec.ts — 确定性路由表（指标 → 动作）。
 *
 * 覆盖：四规则优先级矩阵（escalate / gate+冷却 / 义务未决+零验证 / 默认 self）、
 * 义务提示进 task、无义务提示时 delegate 用通用任务描述。
 */
import { describe, expect, it } from 'vitest'
import { decideRouterAction, type RouterMetrics } from '../src/router.js'

function metrics(over: Partial<RouterMetrics> = {}): RouterMetrics {
  return {
    interventionLevel: 'none',
    unresolvedHigh: 0,
    verifications: 0,
    probeCooledTargets: 0,
    ...over,
  }
}

const obligationHint = { claim: '修复 X 崩溃', targets: ['src/foo.ts'] }

describe('decideRouterAction — 规则优先级', () => {
  it('escalate（错误率 ≥0.8）→ delegate verifier（最高优先级）', () => {
    const action = decideRouterAction(metrics({ interventionLevel: 'escalate', unresolvedHigh: 1 }), obligationHint)
    expect(action.kind).toBe('delegate')
    if (action.kind === 'delegate') {
      expect(action.profile).toBe('verifier')
      expect(action.task).toContain('修复 X 崩溃')
      expect(action.targets).toEqual(['src/foo.ts'])
    }
  })

  it('gate + 探针冷却耗尽 → delegate code_scout', () => {
    const action = decideRouterAction(metrics({ interventionLevel: 'gate', probeCooledTargets: 1 }), obligationHint)
    expect(action.kind).toBe('delegate')
    if (action.kind === 'delegate') {
      expect(action.profile).toBe('code_scout')
    }
  })

  it('gate 但探针未耗尽 → 不 delegate（保持 self，先让主循环自己试）', () => {
    const action = decideRouterAction(metrics({ interventionLevel: 'gate', probeCooledTargets: 0 }))
    expect(action.kind).toBe('self')
  })

  it('义务未决 + 零验证 → self（先写探针，证据门已拦编辑）', () => {
    const action = decideRouterAction(metrics({ unresolvedHigh: 1, verifications: 0 }))
    expect(action.kind).toBe('self')
  })

  it('义务未决但已有验证 → self（验证进行中，不打断）', () => {
    const action = decideRouterAction(metrics({ unresolvedHigh: 1, verifications: 2 }))
    expect(action.kind).toBe('self')
  })

  it('默认（无异常指标）→ self', () => {
    expect(decideRouterAction(metrics()).kind).toBe('self')
  })

  it('无义务提示时 delegate 用通用任务描述（不含 claim）', () => {
    const action = decideRouterAction(metrics({ interventionLevel: 'escalate' }))
    expect(action.kind).toBe('delegate')
    if (action.kind === 'delegate') {
      expect(action.task).toContain('独立复核')
      expect(action.targets).toEqual([])
    }
  })

  it('escalate 优先级高于 gate+冷却（同时触发取 escalate）', () => {
    const action = decideRouterAction(metrics({ interventionLevel: 'escalate', probeCooledTargets: 3 }))
    expect(action.kind).toBe('delegate')
    if (action.kind === 'delegate') expect(action.profile).toBe('verifier')
  })
})
