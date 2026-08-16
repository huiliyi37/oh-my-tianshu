/**
 * adaptive-memory intent 推导单测（纯启发式、确定性、零模型调用）。
 *
 * 行为契约：
 * - 目标锚点：首条用户消息；之后含目标动词的用户消息成为新锚点（序号递增、
 *   记录锚点轮次与事件 seq）；普通追问不切换锚点。
 * - intentKey：小写化切词、拉丁词长 ≥3 / 汉字词长 ≥2、去重、封顶、连字符
 *   连接；空签名回落 'general'。
 * - extractEntities：锚点之后的 tool/call 参数路径 + tool/result 错误码
 *   （error.code 字段与文本里的 E[A-Z]{3,} 形）；去重、首次出现序、封顶。
 *
 * @module @huiliyi37/dsh-adaptive-memory/tests/intent
 */

import { describe, expect, it } from 'vitest'
import { CallId, createToolResultMessage, createUserMessage } from '@huiliyi37/dsh-llm'
import { Session, SessionId } from '@huiliyi37/dsh-session'
import { extractEntities, findGoalAnchor, intentKeyOf } from '../src/intent.ts'

const GOAL_VERBS = ['fix', 'refactor', '修复', '重构']

/** 追加一轮：turn/start + 用户消息。 */
function appendUserTurn(session: Session, turn: number, text: string): void {
  session.append('turn/start', { turn })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
}

/** 追加一次工具调用与其结果（错误码载体）。 */
function appendToolCall(
  session: Session,
  turn: number,
  args: string,
  result: { text?: string; errorCode?: string },
): void {
  session.append('tool/call', {
    turn,
    step: 2,
    callId: CallId(`call-${turn}`),
    name: 'read_file',
    arguments: args,
  })
  session.append('tool/result', {
    turn,
    step: 2,
    message: createToolResultMessage({
      callId: CallId(`call-${turn}`),
      content: [{ type: 'text', text: result.text ?? 'ok' }],
      isError: result.errorCode !== undefined,
    }),
    ...(result.errorCode === undefined ? {} : { error: { name: 'IoError', code: result.errorCode } }),
  }, { surfaceOp: 'append' })
}

describe('findGoalAnchor', () => {
  it('首条用户消息是锚点；普通追问不切换；含目标动词的消息成为新锚点', () => {
    const session = Session.create(SessionId('intent-anchor'))
    appendUserTurn(session, 1, 'fix the login bug in src/auth/login.ts')
    const first = findGoalAnchor(session.events, GOAL_VERBS)
    expect(first?.anchorIndex).toBe(1)
    expect(first?.turn).toBe(1)

    appendUserTurn(session, 2, 'thanks, looks good')
    const steady = findGoalAnchor(session.events, GOAL_VERBS)
    expect(steady?.anchorIndex).toBe(1)

    appendUserTurn(session, 3, 'now refactor the payment module')
    const moved = findGoalAnchor(session.events, GOAL_VERBS)
    expect(moved?.anchorIndex).toBe(2)
    expect(moved?.turn).toBe(3)
    expect(moved?.text).toBe('now refactor the payment module')
  })

  it('CJK 目标动词按子串匹配；无用户消息 ⇒ undefined', () => {
    const empty = Session.create(SessionId('intent-empty'))
    expect(findGoalAnchor(empty.events, GOAL_VERBS)).toBeUndefined()

    const session = Session.create(SessionId('intent-cjk'))
    appendUserTurn(session, 1, '看一下登录页为什么白屏')
    expect(findGoalAnchor(session.events, GOAL_VERBS)?.anchorIndex).toBe(1)
    appendUserTurn(session, 2, '请重构支付模块的错误处理')
    expect(findGoalAnchor(session.events, GOAL_VERBS)?.anchorIndex).toBe(2)
  })
})

describe('intentKeyOf', () => {
  it('规范化：小写化、短词过滤、去重、封顶、连字符连接', () => {
    // 'the' 保留、'in'/'ts' 被长度过滤（无停用词表——刻意从简）；'login.ts' 在 '.' 处切词
    expect(intentKeyOf('Fix the LOGIN bug in src/auth/login.ts', 6)).toBe('fix-the-login-bug-src-auth')
    expect(intentKeyOf('fix fix fix', 6)).toBe('fix')
    expect(intentKeyOf('alpha beta gamma delta', 2)).toBe('alpha-beta')
    // CJK 不切词：整段汉字是一个 token
    expect(intentKeyOf('修复登录页的白屏问题', 6)).toBe('修复登录页的白屏问题')
    expect(intentKeyOf('a b c', 6)).toBe('general')
    expect(intentKeyOf('', 6)).toBe('general')
  })
})

describe('extractEntities', () => {
  it('提取路径与错误码；锚点之前的事件不计入；去重封顶', () => {
    const session = Session.create(SessionId('intent-entities'))
    appendUserTurn(session, 1, 'fix the login bug')
    const anchor = findGoalAnchor(session.events, GOAL_VERBS)
    if (anchor === undefined) throw new Error('missing anchor')
    appendToolCall(session, 1, '{"path":"src/auth/login.ts"}', { text: 'ENOENT: no such file' })
    appendToolCall(session, 1, '{"path":"src/auth/login.ts"}', { errorCode: 'EACCES' })
    const entities = extractEntities(session.events, anchor.seq, 24)
    expect(entities).toEqual(['src/auth/login.ts', 'ENOENT', 'EACCES'])

    const capped = extractEntities(session.events, anchor.seq, 2)
    expect(capped).toEqual(['src/auth/login.ts', 'ENOENT'])
  })

  it('锚点 seq 之前的事件被忽略（intent 切换重置实体）', () => {
    const session = Session.create(SessionId('intent-reset'))
    appendUserTurn(session, 1, 'fix the login bug')
    appendToolCall(session, 1, '{"path":"src/auth/login.ts"}', {})
    appendUserTurn(session, 2, 'refactor the payment module')
    const anchor = findGoalAnchor(session.events, GOAL_VERBS)
    if (anchor === undefined) throw new Error('missing anchor')
    appendToolCall(session, 2, '{"path":"src/pay/stripe.ts"}', {})
    expect(extractEntities(session.events, anchor.seq, 24)).toEqual(['src/pay/stripe.ts'])
  })
})
