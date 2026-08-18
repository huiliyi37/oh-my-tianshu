/**
 * memory-consolidate 成功门控单测（纯函数、确定性）。
 *
 * 行为契约：
 * - 至少一个 completed turn 是底线（两级共同）。
 * - 未解决工具错误：standard 只看最后一个 turn；strict 看全会话。
 * - 其后出现同工具名成功结果的错误视为已解决。
 * - 可观察的测试运行（call 名称/参数含 test 特征）结果含失败计数而其后无
 *   通过计数 → 未解决测试失败。
 *
 * @module @huiliyi37/dsh-memory-consolidate/tests/gate
 */

import { describe, expect, it } from 'vitest'
import { CallId, createToolResultMessage, createUserMessage } from '@huiliyi37/dsh-llm'
import { Session, SessionId } from '@huiliyi37/dsh-session'
import { evaluateSuccessGate, toolResultText, unresolvedFailures } from '../src/gate.ts'

let seq = 0

/** 新建独立测试会话（id 单调）。 */
function makeSession(): Session {
  seq += 1
  return Session.create(SessionId(`gate-${seq}`))
}

/** 追加一个 completed turn（turn/start + 用户消息 + turn/end）。 */
function appendCompletedTurn(session: Session, turn: number): void {
  session.append('turn/start', { turn })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: `turn ${turn}` }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
}

/** 追加一次工具调用与结果（errorCode 存在 = 错误结果）。 */
function appendToolResult(
  session: Session,
  turn: number,
  name: string,
  key: string,
  result: { text?: string; errorCode?: string },
): void {
  session.append('tool/call', {
    turn,
    step: 1,
    callId: CallId(`call-${key}`),
    name,
    arguments: '{}',
  })
  session.append('tool/result', {
    turn,
    step: 1,
    message: createToolResultMessage({
      callId: CallId(`call-${key}`),
      content: [{ type: 'text', text: result.text ?? 'ok' }],
      isError: result.errorCode !== undefined,
    }),
    ...(result.errorCode === undefined ? {} : { error: { name: 'ToolError', code: result.errorCode } }),
  }, { surfaceOp: 'append' })
}

describe('evaluateSuccessGate', () => {
  it('无 completed turn ⇒ 否决（no-completed-turn）', () => {
    const session = makeSession()
    session.append('turn/start', { turn: 1 })
    const verdict = evaluateSuccessGate(session.events, 'standard')
    expect(verdict.passed).toBe(false)
    expect(verdict.reasons).toContain('no-completed-turn')
  })

  it('completed turn 且无失败 ⇒ 通过', () => {
    const session = makeSession()
    appendCompletedTurn(session, 1)
    expect(evaluateSuccessGate(session.events, 'standard').passed).toBe(true)
    expect(evaluateSuccessGate(session.events, 'strict').passed).toBe(true)
  })

  it('末轮未解决工具错误：standard 否决', () => {
    const session = makeSession()
    appendCompletedTurn(session, 1)
    appendToolResult(session, 2, 'bash', 'a', { errorCode: 'ENOENT' })
    session.append('turn/start', { turn: 2 })
    session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
    const verdict = evaluateSuccessGate(session.events, 'standard')
    expect(verdict.passed).toBe(false)
    expect(verdict.reasons.some(reason => reason.startsWith('unresolved-tool-error:bash:ENOENT'))).toBe(true)
  })

  it('较早轮的未解决错误：standard 通过、strict 否决', () => {
    const session = makeSession()
    appendToolResult(session, 1, 'bash', 'a', { errorCode: 'ENOENT' })
    session.append('turn/start', { turn: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    appendCompletedTurn(session, 2)
    expect(evaluateSuccessGate(session.events, 'standard').passed).toBe(true)
    expect(evaluateSuccessGate(session.events, 'strict').passed).toBe(false)
  })

  it('其后同工具名成功 ⇒ 错误已解决', () => {
    const session = makeSession()
    session.append('turn/start', { turn: 1 })
    appendToolResult(session, 1, 'bash', 'a', { errorCode: 'ENOENT' })
    appendToolResult(session, 1, 'bash', 'b', {})
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(evaluateSuccessGate(session.events, 'strict').passed).toBe(true)
  })

  it('可观察的测试失败：末轮失败且无通过 ⇒ 否决；其后通过 ⇒ 解决', () => {
    const failing = makeSession()
    failing.append('turn/start', { turn: 1 })
    failing.append('tool/call', {
      turn: 1, step: 1, callId: CallId('call-t1'), name: 'bash', arguments: JSON.stringify({ command: 'pnpm test' }),
    })
    failing.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: CallId('call-t1'),
        content: [{ type: 'text', text: '12 passed, 2 failed' }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
    failing.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const verdict = evaluateSuccessGate(failing.events, 'standard')
    expect(verdict.passed).toBe(false)
    expect(verdict.reasons.some(reason => reason.startsWith('unresolved-test-failure:'))).toBe(true)

    const resolved = makeSession()
    resolved.append('turn/start', { turn: 1 })
    resolved.append('tool/call', {
      turn: 1, step: 1, callId: CallId('call-t2'), name: 'bash', arguments: JSON.stringify({ command: 'pnpm test' }),
    })
    resolved.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: CallId('call-t2'),
        content: [{ type: 'text', text: '12 passed, 2 failed' }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
    resolved.append('tool/call', {
      turn: 1, step: 1, callId: CallId('call-t3'), name: 'bash', arguments: JSON.stringify({ command: 'pnpm test' }),
    })
    resolved.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: CallId('call-t3'),
        content: [{ type: 'text', text: '14 passed' }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
    resolved.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(evaluateSuccessGate(resolved.events, 'standard').passed).toBe(true)
  })

  it('unresolvedFailures：同工具后续成功解决；不同工具不解决', () => {
    const session = makeSession()
    appendToolResult(session, 1, 'read_file', 'a', { errorCode: 'EACCES' })
    appendToolResult(session, 1, 'bash', 'b', {})
    const failures = unresolvedFailures(session.events)
    expect(failures).toHaveLength(1)
    expect(failures[0]?.subject).toBe('read_file')
    expect(failures[0]?.detail).toBe('EACCES')
  })

  it('非文本内层不构成测试失败文本', () => {
    const session = makeSession()
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'turn 1' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('tool/call', {
      turn: 1, step: 1, callId: CallId('call-img'), name: 'bash', arguments: '{}',
    })
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: CallId('call-img'),
        content: [{ type: 'image', dataUrl: 'data:image/png;base64,xx' }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const resultEvent = session.events.find(event => event.type === 'tool/result')
    if (resultEvent === undefined || resultEvent.type !== 'tool/result') throw new Error('missing result')
    expect(toolResultText(resultEvent)).toBe('')
    expect(evaluateSuccessGate(session.events, 'standard').passed).toBe(true)
  })
})
