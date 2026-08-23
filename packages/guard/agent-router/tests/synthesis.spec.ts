/**
 * synthesis.spec.ts — 主代理综合提示与采用声明的纯函数面。
 *
 * 覆盖：pendingOutcomes 配对扣除（含顺序无关）、verificationGap 新鲜度、
 * renderSynthesisSection 渲染形态、parseAdoptArgs 边界校验。
 */
import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@huiliyi37/dsh-session'
import {
  parseAdoptArgs,
  pendingOutcomes,
  renderSynthesisSection,
  verificationGap,
} from '../src/synthesis.js'

function outcomeEvent(id: string, stopReason = 'completed'): SessionEvent {
  return { type: 'router/outcome', seq: 0, time: 0, data: { subagentSessionId: id, stopReason } }
}

function adoptionEvent(id: string, verdict: 'adopt' | 'reject' = 'adopt'): SessionEvent {
  return { type: 'router/adoption', seq: 0, time: 0, data: { subagentSessionId: id, verdict, reason: 'r' } }
}

function toolCallEvent(name: string): SessionEvent {
  return { type: 'tool/call', seq: 0, time: 0, data: { name, callId: 'c', turn: 1, step: 1, message: {} } } as unknown as SessionEvent
}

describe('pendingOutcomes', () => {
  it('outcome 无配对 adoption → 未综合', () => {
    const pending = pendingOutcomes([outcomeEvent('c1')])
    expect(pending).toHaveLength(1)
    expect(pending[0]!.subagentSessionId).toBe('c1')
    expect(pending[0]!.stopReason).toBe('completed')
  })

  it('adoption 配对后清除（含 adoption 先于 outcome 的顺序无关性）', () => {
    expect(pendingOutcomes([outcomeEvent('c1'), adoptionEvent('c1')])).toHaveLength(0)
    expect(pendingOutcomes([adoptionEvent('c1'), outcomeEvent('c1')])).toHaveLength(0)
  })

  it('只清配对的那条，其余保留', () => {
    const pending = pendingOutcomes([outcomeEvent('c1'), outcomeEvent('c2'), adoptionEvent('c1')])
    expect(pending.map(e => e.subagentSessionId)).toEqual(['c2'])
  })
})

describe('verificationGap', () => {
  it('写/改类工具之后无新验证 → 缺口', () => {
    expect(verificationGap([toolCallEvent('write'), toolCallEvent('run_tests')])).toBe(false)
    expect(verificationGap([toolCallEvent('run_tests'), toolCallEvent('write')])).toBe(true)
    expect(verificationGap([toolCallEvent('edit'), toolCallEvent('related_tests')])).toBe(false)
    expect(verificationGap([toolCallEvent('str_replace_editor')])).toBe(true)
  })

  it('无相关工具事件 → 无缺口', () => {
    expect(verificationGap([toolCallEvent('grep')])).toBe(false)
    expect(verificationGap([])).toBe(false)
  })
})

describe('renderSynthesisSection', () => {
  const rubric = 'RUBRIC'

  it('无未综合结论 → 空串', () => {
    expect(renderSynthesisSection([], false, rubric)).toBe('')
  })

  it('列出未综合结论 + rubric；有验证缺口时附软提醒', () => {
    const text = renderSynthesisSection(
      [{ subagentSessionId: 'c1', stopReason: 'completed' }],
      true,
      rubric,
    )
    expect(text).toContain('c1')
    expect(text).toContain('router_adopt')
    expect(text).toContain('fresh verification')
    expect(text).toContain('RUBRIC')
    const noGap = renderSynthesisSection(
      [{ subagentSessionId: 'c1', stopReason: 'completed' }],
      false,
      rubric,
    )
    expect(noGap).not.toContain('fresh verification')
  })
})

describe('parseAdoptArgs', () => {
  it('接受合法参数（reason 去首尾空白）', () => {
    const parsed = parseAdoptArgs({ subagentSessionId: 'c1', verdict: 'adopt', reason: '  理由  ' })
    expect(parsed).toEqual({ subagentSessionId: 'c1', verdict: 'adopt', reason: '理由' })
  })

  it('非法参数按契约消息拒绝', () => {
    expect(() => parseAdoptArgs(null)).toThrow(/arguments must be an object/)
    expect(() => parseAdoptArgs({ subagentSessionId: '', verdict: 'adopt', reason: 'r' })).toThrow(/non-empty string/)
    expect(() => parseAdoptArgs({ subagentSessionId: 'c1', verdict: 'maybe', reason: 'r' })).toThrow(/verdict/)
    expect(() => parseAdoptArgs({ subagentSessionId: 'c1', verdict: 'adopt', reason: '  ' })).toThrow(/reason/)
  })
})
