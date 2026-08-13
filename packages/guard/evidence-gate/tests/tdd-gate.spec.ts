/**
 * tdd-gate.spec.ts — TDD 门纯函数（天枢 tdd-gate 精简移植）。
 *
 * 覆盖：阈值/验证计数/测试文件豁免/skipIfNoTests/enforce 拦截矩阵、
 * suggest 模式不拦截但给出提示档。
 */
import { describe, expect, it } from 'vitest'
import { evaluateTddGate, type TddGateInput } from '../src/tdd-gate.js'

function gate(over: Partial<TddGateInput> = {}): ReturnType<typeof evaluateTddGate> {
  return evaluateTddGate({
    mode: 'suggest',
    editsSinceLastTest: 0,
    verifications: 0,
    targetIsTestFile: false,
    hasTests: true,
    ...over,
  })
}

describe('evaluateTddGate — 放行条件', () => {
  it('编辑未达阈值（<3）→ allow', () => {
    expect(gate({ editsSinceLastTest: 2 })).toBe('allow')
  })

  it('已有验证 → allow（验证后编辑计数已重置）', () => {
    expect(gate({ editsSinceLastTest: 5, verifications: 1 })).toBe('allow')
  })

  it('目标是测试文件 → allow（写测试豁免）', () => {
    expect(gate({ editsSinceLastTest: 5, verifications: 0, targetIsTestFile: true })).toBe('allow')
  })

  it('skipIfNoTests 且项目无测试文件 → allow（不误伤无测试设施项目）', () => {
    expect(gate({ editsSinceLastTest: 5, verifications: 0, hasTests: false })).toBe('allow')
  })
})

describe('evaluateTddGate — 拦截', () => {
  it('编辑达阈值且无验证 → suggest（默认模式不硬拦）', () => {
    expect(gate({ editsSinceLastTest: 3, verifications: 0 })).toBe('suggest')
  })

  it('enforce 模式 → block', () => {
    expect(gate({ mode: 'enforce', editsSinceLastTest: 3, verifications: 0 })).toBe('block')
  })

  it('enforce 但未达阈值 → allow', () => {
    expect(gate({ mode: 'enforce', editsSinceLastTest: 2, verifications: 0 })).toBe('allow')
  })

  it('threshold 可配（默认 3）', () => {
    expect(gate({ editsSinceLastTest: 4, verifications: 0, threshold: 5 })).toBe('allow')
    expect(gate({ mode: 'enforce', editsSinceLastTest: 5, verifications: 0, threshold: 5 })).toBe('block')
  })
})
