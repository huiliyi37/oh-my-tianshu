/**
 * ApprovalController — 待审批状态机契约测试（Wave 1 TDD：RED → GREEN）。
 *
 * 从 ui/app.ts 提取的 pendingApproval + alwaysApprove：
 * - handle()：alwaysApprove 且当前会话 → 短路 allowed-once（不挂起不消费）；
 *   非当前会话或已在挂起 → 委托 next()（waterfall 语义）；当前会话无挂起 →
 *   挂起存 resolve，返回用户决定 promise。
 * - settle()：resolve outcome + 清挂起；无挂起 no-op。
 * - peek()：返回 { req, since } 快照（renderLive 消费）；无挂起 null。
 * - setAlwaysApprove / alwaysApprove getter：C3 项 4 三态循环读写。
 */

import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@huiliyi37/dsh-session'
import {
  ApprovalController,
  type ApprovalControllerOptions,
  type ApprovalOutcome,
  type PendingApprovalRequest,
} from '../src/controllers/approval-controller.js'

/** 构造审批请求（sessionId 可覆盖）。 */
function approvalReq(sessionId: SessionId, toolName = 'bash'): PendingApprovalRequest {
  return { agent: { session: { id: sessionId } }, toolName, reason: 'sandbox' }
}

function boot(sessionId: SessionId, options: Partial<ApprovalControllerOptions> = {}) {
  const getCurrentSessionId = vi.fn(() => sessionId)
  const onChanged = vi.fn()
  const ctl = new ApprovalController({ getCurrentSessionId, onChanged, ...options })
  return { ctl, getCurrentSessionId, onChanged }
}

describe('ApprovalController', () => {
  it('handle 当前会话：挂起 → isPending true、peek 返回 req/since、onChanged 触发', async () => {
    const sid = 'approval-1' as SessionId
    const { ctl, onChanged } = boot(sid)

    const outcome = ctl.handle(approvalReq(sid), () => Promise.resolve('unavailable'))

    expect(ctl.isPending).toBe(true)
    const peek = ctl.peek()
    expect(peek?.req.toolName).toBe('bash')
    expect(typeof peek?.since).toBe('number')
    expect(onChanged).toHaveBeenCalledTimes(1)

    ctl.settle('allowed-once')
    await expect(outcome).resolves.toBe('allowed-once')
    expect(ctl.isPending).toBe(false)
  })

  it('settle：resolve outcome + 清挂起 + onChanged；无挂起 no-op', () => {
    const sid = 'approval-2' as SessionId
    const { ctl, onChanged } = boot(sid)

    const outcome = ctl.handle(approvalReq(sid), () => Promise.resolve('unavailable'))
    onChanged.mockClear()
    ctl.settle('rejected')
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(ctl.isPending).toBe(false)
    void outcome

    // 无挂起 settle no-op（不抛、不触发回调）
    onChanged.mockClear()
    expect(() =>{  ctl.settle('cancelled') }).not.toThrow()
    expect(onChanged).not.toHaveBeenCalled()
    expect(ctl.peek()).toBeNull()
  })

  it('alwaysApprove 且当前会话：短路 allowed-once，不挂起不消费、不触发 onChanged', async () => {
    const sid = 'approval-3' as SessionId
    const { ctl, onChanged } = boot(sid)
    ctl.setAlwaysApprove(true)
    expect(ctl.alwaysApprove).toBe(true)

    const next = vi.fn<() => Promise<ApprovalOutcome>>(async () => 'unavailable')
    const result = await ctl.handle(approvalReq(sid), next)

    expect(result).toBe('allowed-once')
    expect(next).not.toHaveBeenCalled()
    expect(ctl.isPending).toBe(false)
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('非当前会话：委托 next()（不挂起）', async () => {
    const sid = 'approval-4' as SessionId
    const { ctl, onChanged } = boot(sid)

    const next = vi.fn<() => Promise<ApprovalOutcome>>(async () => 'unavailable')
    const result = await ctl.handle(approvalReq('other-session' as SessionId), next)

    expect(result).toBe('unavailable')
    expect(next).toHaveBeenCalledTimes(1)
    expect(ctl.isPending).toBe(false)
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('已挂起中又来新请求：委托 next()（fail-closed，一次只呈现一个确认）', async () => {
    const sid = 'approval-5' as SessionId
    const { ctl, onChanged } = boot(sid)

    const first = ctl.handle(approvalReq(sid), () => Promise.resolve('unavailable'))
    const next = vi.fn<() => Promise<ApprovalOutcome>>(async () => 'cancelled')
    const second = await ctl.handle(approvalReq(sid, 'write'), next)

    expect(second).toBe('cancelled')
    expect(next).toHaveBeenCalledTimes(1)
    // 首个挂起未被消费
    expect(ctl.isPending).toBe(true)
    expect(onChanged).toHaveBeenCalledTimes(1)

    ctl.settle('allowed-once')
    await expect(first).resolves.toBe('allowed-once')
  })

  it('alwaysApprove 非当前会话：仍委托 next()（apiproxy 等链上 answerer 不截胡）', async () => {
    const sid = 'approval-6' as SessionId
    const { ctl } = boot(sid)
    ctl.setAlwaysApprove(true)

    const next = vi.fn<() => Promise<ApprovalOutcome>>(async () => 'unavailable')
    const result = await ctl.handle(approvalReq('remote-session' as SessionId), next)

    expect(result).toBe('unavailable')
    expect(next).toHaveBeenCalledTimes(1)
    expect(ctl.isPending).toBe(false)
  })

  it('挂起后 signal abort：自动结算 cancelled，清挂起并触发重绘（asker 拿 cancelled 而卡片不滞留）', async () => {
    const sid = 'approval-7' as SessionId
    const { ctl, onChanged } = boot(sid)
    const ac = new AbortController()

    const outcome = ctl.handle(
      { ...approvalReq(sid), signal: ac.signal },
      () => Promise.resolve('unavailable'),
    )

    expect(ctl.isPending).toBe(true)
    onChanged.mockClear()
    ac.abort()

    await expect(outcome).resolves.toBe('cancelled')
    expect(ctl.isPending).toBe(false)
    // abort 结算必须触发 onChanged——渲染侧依赖它移除滞留卡片
    expect(onChanged).toHaveBeenCalledTimes(1)
  })

  it('已 aborted 的 signal：handle 不挂起、不委托，直接 cancelled', async () => {
    const sid = 'approval-8' as SessionId
    const { ctl, onChanged } = boot(sid)
    const ac = new AbortController()
    ac.abort()

    const next = vi.fn<() => Promise<ApprovalOutcome>>(async () => 'unavailable')
    const result = await ctl.handle({ ...approvalReq(sid), signal: ac.signal }, next)

    expect(result).toBe('cancelled')
    expect(next).not.toHaveBeenCalled()
    expect(ctl.isPending).toBe(false)
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('用户先结算后 signal abort：结果不被覆盖（once 监听，无二次回调）', async () => {
    const sid = 'approval-9' as SessionId
    const { ctl, onChanged } = boot(sid)
    const ac = new AbortController()

    const outcome = ctl.handle(
      { ...approvalReq(sid), signal: ac.signal },
      () => Promise.resolve('unavailable'),
    )
    ctl.settle('allowed-once')
    onChanged.mockClear()

    ac.abort()

    await expect(outcome).resolves.toBe('allowed-once')
    expect(ctl.isPending).toBe(false)
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('挂起超过 timeoutMs：自动结算 cancelled（fail-closed，卡片不无限挂起）', async () => {
    vi.useFakeTimers()
    try {
      const sid = 'approval-timeout-1' as SessionId
      const { ctl, onChanged } = boot(sid, { timeoutMs: 5_000 })

      const outcome = ctl.handle(approvalReq(sid), () => Promise.resolve('unavailable'))

      expect(ctl.isPending).toBe(true)
      onChanged.mockClear()

      // 未到超时：仍挂起，不结算
      vi.advanceTimersByTime(4_999)
      expect(ctl.isPending).toBe(true)
      expect(onChanged).not.toHaveBeenCalled()

      // 越过超时：自动结算 cancelled，清挂起并触发重绘（渲染侧移除滞留卡片）
      vi.advanceTimersByTime(1)
      await expect(outcome).resolves.toBe('cancelled')
      expect(ctl.isPending).toBe(false)
      expect(onChanged).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('用户先结算后超时：结果不被覆盖（timer 已清除，无二次结算）', async () => {
    vi.useFakeTimers()
    try {
      const sid = 'approval-timeout-2' as SessionId
      const { ctl, onChanged } = boot(sid, { timeoutMs: 5_000 })

      const outcome = ctl.handle(approvalReq(sid), () => Promise.resolve('unavailable'))
      ctl.settle('allowed-once')
      onChanged.mockClear()

      vi.advanceTimersByTime(5_000)

      await expect(outcome).resolves.toBe('allowed-once')
      expect(ctl.isPending).toBe(false)
      expect(onChanged).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('signal abort 结算后超时：不二次结算', async () => {
    vi.useFakeTimers()
    try {
      const sid = 'approval-timeout-3' as SessionId
      const ac = new AbortController()
      const { ctl, onChanged } = boot(sid, { timeoutMs: 5_000 })

      const outcome = ctl.handle(
        { ...approvalReq(sid), signal: ac.signal },
        () => Promise.resolve('unavailable'),
      )
      ac.abort()
      onChanged.mockClear()

      vi.advanceTimersByTime(5_000)

      await expect(outcome).resolves.toBe('cancelled')
      expect(ctl.isPending).toBe(false)
      expect(onChanged).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
