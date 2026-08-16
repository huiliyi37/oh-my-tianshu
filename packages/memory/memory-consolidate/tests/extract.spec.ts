/**
 * memory-consolidate 启发式提取器单测（确定性、零模型调用）。
 *
 * 行为契约（extract.ts 模块文档的 R1–R4 + 失败路径）：
 * - R1 显式记忆信号 → observation（topic explicit；可解析形状附 stated 三元组）。
 * - R2 用户纠正 → experience（topic correction；sourceSeqs 含前一条 assistant）。
 * - R3 错误-解决 → experience（topic error-resolution；实体含工具名与错误码）。
 * - R4 决策陈述 → observation（topic decision；取含标记的一句）。
 * - failureCandidates：门控未通过会话的未解决失败 → failure-pattern 经验。
 *
 * @module @huiliyi37/dsh-memory-consolidate/tests/extract
 */

import { describe, expect, it } from 'vitest'
import { CallId, createAssistantMessage, createToolResultMessage, createUserMessage } from '@huiliyi37/dsh-llm'
import { Session, SessionId } from '@huiliyi37/dsh-session'
import { HeuristicExtractor, failureCandidates } from '../src/extract.ts'
import type { ExtractionBounds } from '../src/extract.ts'

const BOUNDS: ExtractionBounds = { maxTextChars: 280, maxEntities: 8 }

let seq = 0

/** 新建独立测试会话。 */
function makeSession(): Session {
  seq += 1
  return Session.create(SessionId(`extract-${seq}`))
}

/** 追加一条用户消息。 */
function appendUser(session: Session, text: string): void {
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
}

/** 追加一条 assistant 消息。 */
function appendAssistant(session: Session, text: string): void {
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      content: [{ type: 'text', text }],
      source: { provider: 'mock', model: 'mock' },
    }),
  }, { surfaceOp: 'append' })
}

/** 追加一次工具调用与结果。 */
function appendTool(
  session: Session,
  name: string,
  key: string,
  result: { text?: string; errorCode?: string },
): void {
  session.append('tool/call', {
    turn: 1, step: 1, callId: CallId(`call-${key}`), name, arguments: '{}',
  })
  session.append('tool/result', {
    turn: 1,
    step: 1,
    message: createToolResultMessage({
      callId: CallId(`call-${key}`),
      content: [{ type: 'text', text: result.text ?? 'ok' }],
      isError: result.errorCode !== undefined,
    }),
    ...(result.errorCode === undefined ? {} : { error: { name: 'ToolError', code: result.errorCode } }),
  }, { surfaceOp: 'append' })
}

/** 用缺省提取器跑一个会话。 */
async function extract(session: Session) {
  return new HeuristicExtractor().extract({ sessionId: session.id, events: session.events, bounds: BOUNDS })
}

describe('HeuristicExtractor', () => {
  it('R1：remember 信号 → observation + stated 三元组（英文 is 形状）', async () => {
    const session = makeSession()
    appendUser(session, 'remember: the default branch is main')
    const candidates = await extract(session)
    expect(candidates).toHaveLength(1)
    const candidate = candidates[0]!
    expect(candidate.kind).toBe('observation')
    expect(candidate.topic).toBe('explicit')
    expect(candidate.confidence).toBe(1)
    expect(candidate.fact).toEqual({ subject: 'the default branch', predicate: 'stated', value: 'main' })
    expect(candidate.sourceSeqs).toHaveLength(1)
  })

  it('R1：中文记住信号 → 是字形状三元组', async () => {
    const session = makeSession()
    appendUser(session, '记住：部署分支是 release')
    const candidates = await extract(session)
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.fact).toEqual({ subject: '部署分支', predicate: 'stated', value: 'release' })
  })

  it('R2：用户纠正 → experience（sourceSeqs 含前一条 assistant 消息）', async () => {
    const session = makeSession()
    appendUser(session, 'fix the build')
    appendAssistant(session, 'I will run npm install to fix it')
    appendUser(session, 'No, use pnpm in this repo')
    const candidates = await extract(session)
    expect(candidates).toHaveLength(1)
    const candidate = candidates[0]!
    expect(candidate.kind).toBe('experience')
    expect(candidate.topic).toBe('correction')
    expect(candidate.sourceSeqs).toHaveLength(2)
  })

  it('R3：错误后同工具成功 → error-resolution 经验（实体含工具与错误码）', async () => {
    const session = makeSession()
    appendTool(session, 'bash', 'a', { errorCode: 'ENOENT' })
    appendTool(session, 'bash', 'b', {})
    const candidates = await extract(session)
    expect(candidates).toHaveLength(1)
    const candidate = candidates[0]!
    expect(candidate.kind).toBe('experience')
    expect(candidate.topic).toBe('error-resolution')
    expect(candidate.entities).toEqual(['bash', 'ENOENT'])
    expect(candidate.sourceSeqs).toHaveLength(2)
  })

  it('R3：未解决的错误不产生候选（失败路径由 failureCandidates 负责）', async () => {
    const session = makeSession()
    appendTool(session, 'bash', 'a', { errorCode: 'ENOENT' })
    expect(await extract(session)).toHaveLength(0)
  })

  it('R4：决策陈述 → observation（topic decision，取含标记的一句）', async () => {
    const session = makeSession()
    appendAssistant(session, 'We decided to use SQLite for the LTM store. Other lines follow.')
    const candidates = await extract(session)
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.kind).toBe('observation')
    expect(candidates[0]?.topic).toBe('decision')
    expect(candidates[0]?.text).toContain('decided to use SQLite')
  })

  it('普通对话不产生候选；文本按 maxTextChars 截断', async () => {
    const session = makeSession()
    appendUser(session, 'thanks, looks good')
    appendAssistant(session, 'glad to help')
    expect(await extract(session)).toHaveLength(0)

    const long = makeSession()
    appendUser(long, `remember: ${'x'.repeat(400)}`)
    const candidates = await new HeuristicExtractor().extract({
      sessionId: long.id,
      events: long.events,
      bounds: { maxTextChars: 100, maxEntities: 8 },
    })
    expect(candidates[0]?.text.length).toBeLessThanOrEqual(100)
  })
})

describe('failureCandidates', () => {
  it('未解决失败 → failure-pattern 经验（低置信度；含来源 seq）', () => {
    const session = makeSession()
    appendTool(session, 'bash', 'a', { errorCode: 'ENOENT' })
    const candidates = failureCandidates(session.events, BOUNDS)
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.kind).toBe('experience')
    expect(candidates[0]?.topic).toBe('failure-pattern')
    expect(candidates[0]?.confidence).toBe(0.6)
    expect(candidates[0]?.sourceSeqs).toHaveLength(1)
  })
})
