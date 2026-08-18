/**
 * memory-consolidate LLM 提取器单测（脚本化 invoke，零真实模型调用）。
 *
 * 行为契约（extract-llm.ts 模块文档）：
 * - 合法 JSON 输出 → session-summary（observation，按 maxSummaryChars 截断）
 *   + 校验后的候选 + 可选 procedure（experience，formatProcedure 形状）。
 * - 边界校验：非 JSON / 非对象 / 缺 summary → 抛错（插件侧回退启发式）；
 *   单条候选非法只丢弃该条；sourceSeqs 非法回退为日志跨度。
 * - 路由：显式配置对优先，否则取最后一条 assistant 消息的来源路由；两者
 *   皆无 → 抛错。
 * - 输入有界：renderTranscript 按 maxChars 截断；无可转写内容时不发调用。
 * - FallbackExtractor：主提取器失败 → 记一次 onFallback 后用回退提取器。
 *
 * @module @huiliyi37/dsh-memory-consolidate/tests/extract-llm
 */

import { describe, expect, it } from 'vitest'
import { CallId, createAssistantMessage, createToolResultMessage, createUserMessage } from '@huiliyi37/dsh-llm'
import { Session, SessionId } from '@huiliyi37/dsh-session'
import { HeuristicExtractor } from '../src/extract.ts'
import type { ExtractionBounds, ExtractionInput } from '../src/extract.ts'
import {
  FallbackExtractor,
  LlmExtractor,
  parseExtractionOutput,
  renderTranscript,
} from '../src/extract-llm.ts'
import type { LlmInvokeRequest } from '../src/extract-llm.ts'

const BOUNDS: ExtractionBounds = { maxTextChars: 280, maxEntities: 8, proceduresEnabled: true }

let seq = 0

/** 新建独立测试会话。 */
function makeSession(): Session {
  seq += 1
  return Session.create(SessionId(`llm-extract-${seq}`))
}

/** 追加一条用户消息。 */
function appendUser(session: Session, text: string): void {
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
}

/** 追加一条 assistant 消息（mock 路由 source，供路由推导断言）。 */
function appendAssistant(session: Session, text: string): void {
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      content: [{ type: 'text', text }],
      source: { provider: 'mock', model: 'mock-1' },
    }),
  }, { surfaceOp: 'append' })
}

/** 会话的提取输入。 */
function inputOf(session: Session, bounds: ExtractionBounds = BOUNDS): ExtractionInput {
  return { sessionId: session.id, events: session.events, bounds }
}

/** 脚本化 invoke：记录请求并返回固定输出（或抛错）。 */
function scripted(result: string | Error): { invoke: (req: LlmInvokeRequest) => Promise<string>; requests: LlmInvokeRequest[] } {
  const requests: LlmInvokeRequest[] = []
  return {
    requests,
    invoke: (req) => {
      requests.push(req)
      return result instanceof Error ? Promise.reject(result) : Promise.resolve(result)
    },
  }
}

/** 一份合法的提取输出 JSON。 */
function validOutput(): string {
  return JSON.stringify({
    summary: 'Fixed the padLeft bug in src/format.ts. The task was a small string utility module. The bug was a padEnd/padStart mix-up. Outcome: fixed and verified via node -e.',
    candidates: [
      {
        kind: 'fact',
        topic: 'project-layout',
        text: 'String utilities live in src/format.ts',
        keywords: ['format'],
        entities: ['src/format.ts'],
        confidence: 1.4,
        fact: { subject: 'string utilities', predicate: 'live-in', value: 'src/format.ts' },
        sourceSeqs: [1, 999],
      },
      { kind: 'nonsense', topic: 'bad', text: '' },
      'garbage',
    ],
    procedure: { name: 'Strip-types check', when: 'Verifying a TS module quickly', steps: ['Run node --experimental-strip-types', 'Assert the output'] },
  })
}

describe('renderTranscript', () => {
  it('渲染 user/assistant/tool 行（带 [seq N] 前缀），其余事件跳过', () => {
    const session = makeSession()
    appendUser(session, 'fix the bug')
    appendAssistant(session, 'looking into it')
    session.append('tool/call', { turn: 1, step: 1, callId: CallId('c1'), name: 'bash', arguments: '{"cmd":"ls"}' })
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({ callId: CallId('c1'), content: [{ type: 'text', text: 'ok' }], isError: false }),
    }, { surfaceOp: 'append' })
    const transcript = renderTranscript(session.events, 10_000)
    expect(transcript).toContain('user: fix the bug')
    expect(transcript).toContain('assistant: looking into it')
    expect(transcript).toContain('tool bash: {"cmd":"ls"}')
    expect(transcript).toContain('tool result: ok')
    for (const event of session.events) {
      if (event.type === 'user/message') expect(transcript).toContain(`[seq ${event.seq}]`)
    }
  })

  it('错误结果行带 code；空文本/image 用户行跳过', () => {
    const session = makeSession()
    session.append('user/message', createUserMessage({
      content: [{ type: 'image', dataUrl: 'data:image/png;base64,xx' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('tool/call', { turn: 1, step: 1, callId: CallId('c-err'), name: 'bash', arguments: '{}' })
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: CallId('c-err'),
        content: [{ type: 'image', dataUrl: 'data:image/png;base64,yy' }],
        isError: true,
      }),
      error: { name: 'ToolError', code: 'ENOENT' },
    }, { surfaceOp: 'append' })
    const transcript = renderTranscript(session.events, 10_000)
    expect(transcript).not.toContain('user:')
    expect(transcript).toContain('tool result: error ENOENT')
  })

  it('空 assistant 文本跳过；错误结果带正文', () => {
    const session = makeSession()
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'image', dataUrl: 'data:image/png;base64,xx' }],
        source: { provider: 'mock', model: 'mock-1' },
      }),
    }, { surfaceOp: 'append' })
    session.append('tool/call', { turn: 1, step: 1, callId: CallId('c-txt'), name: 'bash', arguments: '{}' })
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: CallId('c-txt'),
        content: [{ type: 'text', text: 'no such file' }],
        isError: true,
      }),
      error: { name: 'ToolError', code: 'ENOENT' },
    }, { surfaceOp: 'append' })
    const transcript = renderTranscript(session.events, 10_000)
    expect(transcript).not.toContain('assistant:')
    expect(transcript).toContain('tool result: error ENOENT — no such file')
  })

  it('总量超过 maxChars 时截断并标记', () => {
    const session = makeSession()
    for (let i = 0; i < 20; i++) appendUser(session, `message ${'x'.repeat(100)}`)
    const transcript = renderTranscript(session.events, 500)
    expect(transcript.length).toBeLessThanOrEqual(600)
    expect(transcript).toContain('(transcript truncated at 500 chars)')
  })
})

describe('LlmExtractor', () => {
  it('合法输出 → summary + 校验后候选 + procedure；路由取自会话', async () => {
    const session = makeSession()
    appendUser(session, 'create src/format.ts')
    appendAssistant(session, 'done')
    const { invoke, requests } = scripted(validOutput())
    const extractor = new LlmExtractor({
      invoke,
      maxInputChars: 20_000,
      maxSummaryChars: 600,
      proceduresEnabled: true,
    })
    const candidates = await extractor.extract(inputOf(session))
    expect(requests).toHaveLength(1)
    expect(requests[0]?.route).toEqual({ provider: 'mock', model: 'mock-1' })
    expect(requests[0]?.user).toContain('create src/format.ts')
    // summary 在前：observation / session-summary
    expect(candidates[0]?.kind).toBe('observation')
    expect(candidates[0]?.topic).toBe('session-summary')
    expect(candidates[0]?.text).toContain('padLeft bug')
    // 合法候选保留（confidence 封顶 1；非法 sourceSeq 999 被过滤回退跨度）
    const fact = candidates[1]!
    expect(fact.topic).toBe('project-layout')
    expect(fact.confidence).toBe(1)
    expect(fact.fact).toEqual({ subject: 'string utilities', predicate: 'live-in', value: 'src/format.ts' })
    expect(fact.sourceSeqs).toEqual([1])
    // 非法候选被丢弃；procedure 殿后
    expect(candidates.some(c => c.topic === 'bad')).toBe(false)
    const procedure = candidates.at(-1)!
    expect(procedure.kind).toBe('experience')
    expect(procedure.topic).toBe('procedure')
    expect(procedure.text).toContain('Procedure: Strip-types check')
    expect(procedure.text).toContain('1. Run node --experimental-strip-types')
  })

  it('显式路由对优先于会话路由；summary 按 maxSummaryChars 截断', async () => {
    const session = makeSession()
    appendUser(session, 'hello')
    appendAssistant(session, 'hi')
    const { invoke, requests } = scripted(JSON.stringify({ summary: 'x'.repeat(100), candidates: [] }))
    const extractor = new LlmExtractor({
      invoke,
      maxInputChars: 20_000,
      maxSummaryChars: 40,
      provider: 'cfg',
      model: 'cfg-model',
      proceduresEnabled: true,
    })
    const candidates = await extractor.extract(inputOf(session))
    expect(requests[0]?.route).toEqual({ provider: 'cfg', model: 'cfg-model' })
    expect(candidates[0]?.text.length).toBeLessThanOrEqual(40)
  })

  it('proceduresEnabled 关闭时丢弃 procedure；summary/候选不受影响', async () => {
    const session = makeSession()
    appendUser(session, 'task')
    appendAssistant(session, 'done')
    const { invoke } = scripted(validOutput())
    const extractor = new LlmExtractor({
      invoke,
      maxInputChars: 20_000,
      maxSummaryChars: 600,
      proceduresEnabled: false,
    })
    const candidates = await extractor.extract(inputOf(session))
    expect(candidates.some(c => c.topic === 'procedure')).toBe(false)
    expect(candidates[0]?.topic).toBe('session-summary')
  })

  it('边界校验：非 JSON / 缺 summary → 抛错；无路由 → 抛错；空转写 → 不发调用', async () => {
    const session = makeSession()
    appendUser(session, 'task')
    appendAssistant(session, 'done')
    const options = { maxInputChars: 20_000, maxSummaryChars: 600, proceduresEnabled: true }
    await expect(new LlmExtractor({ ...options, invoke: scripted('not json').invoke })
      .extract(inputOf(session))).rejects.toThrow('JSON')
    await expect(new LlmExtractor({ ...options, invoke: scripted('{"candidates":[]}').invoke })
      .extract(inputOf(session))).rejects.toThrow('summary')
    await expect(new LlmExtractor({ ...options, invoke: scripted('[]').invoke })
      .extract(inputOf(session))).rejects.toThrow('JSON 对象')
    await expect(new LlmExtractor({ ...options, invoke: scripted('null').invoke })
      .extract(inputOf(session))).rejects.toThrow('JSON 对象')
    await expect(new LlmExtractor({ ...options, invoke: scripted('{"summary":"   "}').invoke })
      .extract(inputOf(session))).rejects.toThrow('summary')

    const routeless = makeSession()
    appendUser(routeless, 'task')
    await expect(new LlmExtractor({ ...options, invoke: scripted(validOutput()).invoke })
      .extract(inputOf(routeless))).rejects.toThrow('路由')

    const empty = makeSession()
    const { invoke, requests } = scripted(validOutput())
    expect(await new LlmExtractor({ ...options, invoke }).extract(inputOf(empty))).toEqual([])
    expect(requests).toHaveLength(0)
  })

  it('invoke 失败直接抛出（零重试；回退是 FallbackExtractor 的职责）', async () => {
    const session = makeSession()
    appendUser(session, 'task')
    appendAssistant(session, 'done')
    const { invoke } = scripted(new Error('boom'))
    const extractor = new LlmExtractor({
      invoke,
      maxInputChars: 20_000,
      maxSummaryChars: 600,
      proceduresEnabled: true,
    })
    await expect(extractor.extract(inputOf(session))).rejects.toThrow('boom')
  })
})

describe('parseExtractionOutput', () => {
  it('容忍 ```json 围栏；缺省字段回落（keywords/entities/confidence）', () => {
    const session = makeSession()
    appendUser(session, 'task')
    const raw = `\`\`\`json\n${JSON.stringify({
      summary: 'A short summary.',
      candidates: [{ kind: 'experience', topic: 'deploy', text: 'Deploy via pnpm release' }],
    })}\n\`\`\``
    const candidates = parseExtractionOutput(raw, inputOf(session), { maxSummaryChars: 600, proceduresEnabled: true })
    expect(candidates).toHaveLength(2)
    // topic 置首进 keywords（tags[0] 是消费侧的 topic 代理）
    expect(candidates[1]?.keywords).toEqual(['deploy'])
    expect(candidates[1]?.confidence).toBe(0.7)
  })

  it('非法 keywords/entities/sourceSeqs 回落；空事件 span 为空；多合法 seq 排序', () => {
    const empty = makeSession()
    const emptyOut = parseExtractionOutput(JSON.stringify({ summary: 'Empty log summary.' }), inputOf(empty), {
      maxSummaryChars: 600, proceduresEnabled: true,
    })
    expect(emptyOut[0]?.sourceSeqs).toEqual([])

    const session = makeSession()
    appendUser(session, 'first')
    appendAssistant(session, 'second')
    appendUser(session, 'third')
    const positiveSeqs = session.events.map(event => event.seq).filter(seq => seq > 0)
    const firstSeq = positiveSeqs[0]
    const lastSeq = positiveSeqs[positiveSeqs.length - 1]
    if (firstSeq === undefined || lastSeq === undefined) throw new Error('missing seq')
    const spanStart = session.events[0]?.seq
    const spanEnd = session.events[session.events.length - 1]?.seq
    if (spanStart === undefined || spanEnd === undefined) throw new Error('missing span')
    const raw = JSON.stringify({
      summary: 'A short summary.',
      candidates: [
        [],
        { kind: 'experience', topic: 'deploy', text: 'Deploy', keywords: 1, entities: ['ok', 2], sourceSeqs: 'nope' },
        {
          kind: 'experience',
          topic: 'order',
          text: 'Ordered seqs',
          keywords: ['a'],
          entities: ['e'],
          sourceSeqs: [lastSeq, firstSeq, lastSeq, 0, 'x'],
        },
        { kind: 'experience', topic: 'deploy', text: 'Skip fact array', fact: [] },
        { kind: 'experience', topic: 'deploy', text: 'Topic already in keywords', keywords: ['deploy'] },
      ],
      procedure: { name: 'x', when: 'y', steps: [] },
    })
    const candidates = parseExtractionOutput(raw, inputOf(session), { maxSummaryChars: 600, proceduresEnabled: true })
    const deploy = candidates.find(c => c.text === 'Deploy')
    expect(deploy?.keywords).toEqual(['deploy'])
    expect(deploy?.entities).toEqual([])
    expect(deploy?.sourceSeqs).toEqual([spanStart, spanEnd])
    const ordered = candidates.find(c => c.topic === 'order')
    expect(ordered?.sourceSeqs).toEqual([firstSeq, lastSeq])
    const keyed = candidates.find(c => c.text === 'Topic already in keywords')
    expect(keyed?.keywords).toEqual(['deploy'])
    expect(candidates.some(c => c.topic === 'procedure')).toBe(false)
  })
})

describe('FallbackExtractor', () => {
  it('主提取器失败 → onFallback 记一次 + 回退提取器产出', async () => {
    const session = makeSession()
    appendUser(session, 'remember: the default branch is main')
    const { invoke } = scripted(new Error('llm down'))
    const primary = new LlmExtractor({
      invoke,
      maxInputChars: 20_000,
      maxSummaryChars: 600,
      provider: 'mock',
      model: 'mock-1',
      proceduresEnabled: true,
    })
    const errors: unknown[] = []
    const extractor = new FallbackExtractor(primary, new HeuristicExtractor(), (error) => { errors.push(error) })
    const candidates = await extractor.extract(inputOf(session))
    expect(errors).toHaveLength(1)
    expect(candidates.some(c => c.topic === 'explicit')).toBe(true)
  })

  it('主提取器成功时不触发回退', async () => {
    const session = makeSession()
    appendUser(session, 'task')
    const { invoke } = scripted(validOutput())
    const primary = new LlmExtractor({
      invoke,
      maxInputChars: 20_000,
      maxSummaryChars: 600,
      provider: 'mock',
      model: 'mock-1',
      proceduresEnabled: true,
    })
    let fellBack = false
    const extractor = new FallbackExtractor(primary, new HeuristicExtractor(), () => { fellBack = true })
    const candidates = await extractor.extract(inputOf(session))
    expect(fellBack).toBe(false)
    expect(candidates[0]?.topic).toBe('session-summary')
  })
})
