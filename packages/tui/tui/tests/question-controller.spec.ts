/**
 * QuestionController — 挂起提问状态机契约测试（Wave 1 TDD：RED → GREEN）。
 *
 * 从 ui/app.ts 提取的 pendingQuestion 状态机 + questionFeedbackMode：
 * - ask() 挂起：存 resolve/reject 句柄，立即 onEscapeImmediate(true)（挂起期间
 *   ESC 永非 CSI 前缀）；重叠 ask 直接 reject UserInteractionError(ASK_CANCELLED)。
 * - settle()/cancel() 结算：清挂起 + feedbackMode 复位 + onEscapeImmediate(false)
 *   + resolve/reject；无挂起时 no-op（不触发回调）。
 * - peek() 返回 { request, feedbackMode } 快照（renderLive 消费）；无挂起 null。
 * - setFeedbackMode 由 handleKey 的 f 键进入反馈态时调用。
 */

import { describe, expect, it, vi } from 'vitest'
import { QuestionController } from '../src/controllers/question-controller.js'

/** 最小提问请求（结构兼容 user-interaction 的 AskUserQuestionRequest）。 */
function questionRequest(overrides: Partial<{ id: string; question: string }> = {}) {
  return {
    questions: [{
      id: overrides.id ?? 'q1',
      question: overrides.question ?? '继续？',
      options: [{ label: '是' }, { label: '否' }],
    }],
  }
}

describe('QuestionController', () => {
  it('ask 挂起：isPending true、peek 返回 request/feedbackMode、escapeImmediate(true)、onChanged 触发', async () => {
    const onEscapeImmediate = vi.fn()
    const onChanged = vi.fn()
    const ctl = new QuestionController({ onEscapeImmediate, onChanged })

    const p = ctl.ask(questionRequest({ id: 'opt-1' }))

    expect(ctl.isPending).toBe(true)
    expect(ctl.feedbackMode).toBe(false)
    expect(ctl.peek()).toEqual({ request: questionRequest({ id: 'opt-1' }), feedbackMode: false })
    expect(onEscapeImmediate).toHaveBeenCalledWith(true)
    expect(onChanged).toHaveBeenCalledTimes(1)

    // 结算后 promise resolve
    ctl.settle({ answers: [{ id: 'opt-1', selected: ['是'] }] })
    await expect(p).resolves.toEqual({ answers: [{ id: 'opt-1', selected: ['是'] }] })
  })

  it('重叠 ask：reject UserInteractionError(ASK_CANCELLED)，不覆盖首个挂起', async () => {
    const ctl = new QuestionController({ onEscapeImmediate: vi.fn(), onChanged: vi.fn() })
    const first = ctl.ask(questionRequest({ id: 'q1', question: '第一次' }))
    const second = ctl.ask(questionRequest({ id: 'q2', question: '第二次' }))

    await expect(second).rejects.toMatchObject({ code: 'ASK_CANCELLED' })
    // 首个挂起未被覆盖——仍可结算
    expect(ctl.peek()?.request.questions[0]?.id).toBe('q1')
    ctl.cancel()
    await expect(first).rejects.toMatchObject({ code: 'ASK_CANCELLED' })
  })

  it('cancel：reject ASK_CANCELLED + 状态复位（isPending false、feedbackMode false、escape false、onChanged）', async () => {
    const onEscapeImmediate = vi.fn()
    const onChanged = vi.fn()
    const ctl = new QuestionController({ onEscapeImmediate, onChanged })
    const p = ctl.ask(questionRequest())
    ctl.setFeedbackMode(true)
    onChanged.mockClear()

    ctl.cancel()

    expect(ctl.isPending).toBe(false)
    expect(ctl.feedbackMode).toBe(false)
    expect(ctl.peek()).toBeNull()
    expect(onEscapeImmediate).toHaveBeenLastCalledWith(false)
    expect(onChanged).toHaveBeenCalledTimes(1)
    await expect(p).rejects.toMatchObject({ code: 'ASK_CANCELLED' })
  })

  it('settle：resolve answer + 状态复位 + feedbackMode 清', async () => {
    const onEscapeImmediate = vi.fn()
    const onChanged = vi.fn()
    const ctl = new QuestionController({ onEscapeImmediate, onChanged })
    const p = ctl.ask(questionRequest())
    ctl.setFeedbackMode(true)
    onChanged.mockClear()

    ctl.settle({ answers: [{ id: 'q1', selected: ['否'] }] })

    expect(ctl.isPending).toBe(false)
    expect(ctl.feedbackMode).toBe(false)
    expect(ctl.peek()).toBeNull()
    expect(onEscapeImmediate).toHaveBeenLastCalledWith(false)
    expect(onChanged).toHaveBeenCalledTimes(1)
    await expect(p).resolves.toEqual({ answers: [{ id: 'q1', selected: ['否'] }] })
  })

  it('无挂起时 settle/cancel no-op：不触发回调、不抛错', () => {
    const onEscapeImmediate = vi.fn()
    const onChanged = vi.fn()
    const ctl = new QuestionController({ onEscapeImmediate, onChanged })

    expect(() =>{  ctl.settle('x') }).not.toThrow()
    expect(() =>{  ctl.cancel() }).not.toThrow()
    expect(onEscapeImmediate).not.toHaveBeenCalled()
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('feedbackMode 独立读写：setFeedbackMode(true) 后 peek 可见、isPending 不受影响', () => {
    const ctl = new QuestionController({ onEscapeImmediate: vi.fn(), onChanged: vi.fn() })
    expect(ctl.feedbackMode).toBe(false)
    ctl.setFeedbackMode(true)
    expect(ctl.feedbackMode).toBe(true)
    expect(ctl.isPending).toBe(false)
    expect(ctl.peek()).toBeNull()
    ctl.setFeedbackMode(false)
    expect(ctl.feedbackMode).toBe(false)
  })

  it('onChanged 可选：未注入时 ask/settle 不抛', async () => {
    const ctl = new QuestionController({ onEscapeImmediate: vi.fn() })
    const p = ctl.ask(questionRequest())
    ctl.settle('ok')
    await expect(p).resolves.toBe('ok')
  })
})
