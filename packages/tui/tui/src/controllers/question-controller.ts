/**
 * QuestionController — 挂起结构化提问状态机（Wave 1 从 ui/app.ts 提取）。
 *
 * 持有 pendingQuestion 挂起态（request + resolve/reject 句柄）与
 * questionFeedbackMode（plan-review 反馈输入态）。状态、行为、渲染三件事的
 * 对象边界：挂起/结算/取消收敛在本控制器，渲染经 peek() 快照由 renderLive
 * 消费，键仲裁由 app.ts handleKey 读 isPending/feedbackMode 后调 settle/cancel。
 *
 * 副作用注入（不 import app.ts、不碰渲染）：
 * - onEscapeImmediate(flag)：挂起期间 ESC 恒为「取消提问」而非 CSI 序列前缀，
 *   立即派发避免 80ms 窗口内后续按键被吞进序列缓冲（input-handler 语义）。
 * - onChanged()：状态实际变化（挂起/结算/取消）后回调，app 侧据此 flushLiveRender。
 *
 * 契约（与 user-interaction provider 对齐）：
 * - 重叠 ask → reject UserInteractionError(ASK_CANCELLED)（一次只呈现一个问题）。
 * - cancel → reject UserInteractionError(ASK_CANCELLED)（取消必须 reject，非 resolve）。
 *
 * @module @huiliyi37/dsh-tui/controllers/question-controller
 */

import { UserInteractionError } from '@huiliyi37/dsh-user-interaction'
import type { QuestionRequestInput } from '../question-panel.js'

/** 挂起态快照（renderLive 消费；无挂起时 peek() 返回 null）。 */
export interface QuestionPeek {
  /** 挂起中的提问请求（面板投影输入）。 */
  request: QuestionRequestInput
  /** plan-review 反馈输入态（f 键进入；结算/取消时复位）。 */
  feedbackMode: boolean
}

/** QuestionController 的副作用注入（不 import app.ts、不碰渲染）。 */
export interface QuestionControllerOptions {
  /** 挂起/解除挂起时同步切换 ESC 立即模式（保持挂起态 ESC 语义）。 */
  onEscapeImmediate: (flag: boolean) => void
  /** 状态实际变化（挂起/结算/取消）后回调（app 侧触发重绘）。 */
  onChanged?: () => void
}

/**
 * 挂起结构化提问状态机：一次只挂起一个问题（重叠 ask 即 reject），
 * settle/cancel 结算句柄，peek() 给 renderLive 出快照（见模块注释契约）。
 */
export class QuestionController {
  private pending: {
    request: QuestionRequestInput
    resolve: (answer: unknown) => void
    reject: (reason: unknown) => void
  } | null = null
  private feedback = false
  private readonly onEscapeImmediate: (flag: boolean) => void
  private readonly onChanged: (() => void) | undefined

  constructor(options: QuestionControllerOptions) {
    this.onEscapeImmediate = options.onEscapeImmediate
    this.onChanged = options.onChanged
  }

  /** 是否有挂起的提问（handleKey 分支入口判断）。 */
  get isPending(): boolean {
    return this.pending !== null
  }

  /** plan-review 反馈输入态（f 键进入；结算/取消时复位）。 */
  get feedbackMode(): boolean {
    return this.feedback
  }

  /**
   * 进入/退出反馈输入态（f 键 / Esc 返回选项态；不触发结算）。
   * @param flag - true 进入反馈输入态，false 返回选项态。
   */
  setFeedbackMode(flag: boolean): void {
    this.feedback = flag
  }

  /**
   * 挂起一个提问请求：存 resolve/reject 句柄，返回等用户结算的 promise。
   * 已有挂起时 reject ASK_CANCELLED（重叠保护，不覆盖首个挂起）。
   * @param request - user-interaction 的 AskUserQuestionRequest 形状（cast 自 unknown）。
   * @returns 结算值（settle 的 answer）或 UserInteractionError(ASK_CANCELLED)。
   */
  ask(request: unknown): Promise<unknown> {
    const req = request as QuestionRequestInput
    if (this.pending !== null) {
      return Promise.reject(new UserInteractionError(
        'a question is already pending; the user is answering it',
        'ASK_CANCELLED'))
    }
    const promise = new Promise<unknown>((resolve, reject) => {
      this.pending = { request: req, resolve, reject }
      this.onEscapeImmediate(true)
      this.onChanged?.()
    })
    // 防 dispose-cancel 的 unhandled rejection：挂起 promise 可能在无人 await
    // 时被 cancel() reject（如测试/装配方只发起不消费）。no-op catch 只标记
    // handled，await 该 promise 的消费者仍正常收到 rejection/值。
    promise.catch(() => { /* 消费分支由调用方承担；此守卫仅防事件循环未处理 */ })
    return promise
  }

  /**
   * 结算挂起的提问（用户选择/提交反馈）。
   * @param answer - provider 契约的结算值（{ answers: [{ id, selected[], custom? }] }）。
   */
  settle(answer: unknown): void {
    const pending = this.pending
    /* v8 ignore next -- 调用点均先断言 isPending，null 分支仅类型收窄 */
    if (pending === null) return
    this.pending = null
    this.feedback = false
    this.onEscapeImmediate(false)
    pending.resolve(answer)
    this.onChanged?.()
  }

  /**
   * 取消挂起的提问（Esc/Ctrl+C）——reject ASK_CANCELLED（provider 契约）。
   */
  cancel(): void {
    const pending = this.pending
    /* v8 ignore next -- 调用点均先断言 isPending，null 分支仅类型收窄 */
    if (pending === null) return
    this.pending = null
    this.feedback = false
    this.onEscapeImmediate(false)
    pending.reject(new UserInteractionError('the user cancelled the question', 'ASK_CANCELLED'))
    this.onChanged?.()
  }

  /**
   * 当前挂起态快照（renderLive 挂起段消费）。
   * @returns { request, feedbackMode }；无挂起 null。
   */
  peek(): QuestionPeek | null {
    if (this.pending === null) return null
    return { request: this.pending.request, feedbackMode: this.feedback }
  }
}
