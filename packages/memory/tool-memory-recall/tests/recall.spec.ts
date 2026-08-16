/**
 * tool-memory-recall 单测（mock ctx + scripted subagents，零模型调用）。
 *
 * 行为契约：
 * - 注册 memory_deep_recall + 静态指引 section（逐字节稳定）。
 * - execute：经 ctx.subagents.start 派出 reader（outputSchema/只读
 *   toolFilter/persona/maxDepth），返回预算钳制后的固定蒸馏形状。
 * - 能力缺失（sessionQuery 服务 / reader 工具 / provider / provider 能力）
 *   → 平实的模型可见错误（fail loud）。
 * - reader 未正常结束或无结构化输出 → 错误；蒸馏形状非法 → 错误。
 * - distillRecallResult：预算钳制（answer/evidence/quote/置信度）。
 *
 * @module @huiliyi37/dsh-tool-memory-recall/tests/recall
 */

import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@huiliyi37/cordis'
import type { Agent } from '@huiliyi37/dsh-agent'
import type { SubagentCapabilities, SubagentResult, SubagentRun, SubagentStartRequest } from '@huiliyi37/dsh-subagent'
import { SessionId } from '@huiliyi37/dsh-session'
import { apply, distillRecallResult } from '../src/index.ts'
import type { RecallResult } from '../src/index.ts'

const SIGNAL = new AbortController().signal

const FULL_CAPABILITIES: SubagentCapabilities = {
  outputSchema: true,
  depthLimit: true,
  toolFilter: true,
  persona: true,
  sandboxMode: true,
}

interface CapturedTool {
  name: string
  execute: (args: { question: string }, exec: { signal: AbortSignal; agent: Agent }) => Promise<RecallResult>
}

interface Harness {
  ctx: Context
  tools: CapturedTool[]
  sections: Array<{ name: string; order: number; text: unknown }>
  startSpy: ReturnType<typeof vi.fn>
  requests: SubagentStartRequest[]
}

/** 装配 mock ctx：捕获工具/section；脚本化 subagents 与能力开关。 */
function makeCtx(opts: {
  sessionQuery?: boolean
  subagents?: boolean
  readerTools?: string[]
  capabilities?: Partial<SubagentCapabilities>
  structured?: unknown
  stopReason?: SubagentResult['stopReason']
  provider?: boolean
} = {}): Harness {
  const tools: CapturedTool[] = []
  const sections: Array<{ name: string; order: number; text: unknown }> = []
  const requests: SubagentStartRequest[] = []
  const registeredTools = new Set(opts.readerTools ?? ['session_search', 'session_event_search', 'session_event_read'])
  const capabilities: SubagentCapabilities = { ...FULL_CAPABILITIES, ...opts.capabilities }
  const structured = 'structured' in opts
    ? opts.structured
    : {
      answer: '先前会话把 LTM 换成了 SQLite。',
      evidence: [{ sessionId: 's-1', eventSeqs: [12, 13], quote: 'decided to use SQLite' }],
      uncertainties: ['未曾记录回滚方案'],
      confidence: 0.8,
    }
  const result: SubagentResult = {
    output: [{ type: 'text', text: 'reader raw text' }],
    structured,
    stopReason: opts.stopReason ?? 'completed',
  }
  const run: SubagentRun = {
    id: SessionId('reader-run'),
    localAgent: undefined,
    result: Promise.resolve(result),
    dispose: () => Promise.resolve(),
  }
  const startSpy = vi.fn(async (_provider: string, request: SubagentStartRequest) => {
    requests.push(request)
    return run
  })
  const provider = { name: 'spawn', capabilities, inheritsParentContext: false }
  const ctx = {
    tools: {
      register: vi.fn((tool: CapturedTool) => { tools.push(tool) }),
      get: vi.fn((name: string) => registeredTools.has(name) ? { name } : undefined),
    },
    systemPrompt: {
      section: vi.fn((section: { name: string; order: number; text: unknown }) => {
        sections.push(section)
      }),
    },
    get: vi.fn((key: string) => {
      if (key === 'sessionQuery') return opts.sessionQuery === false ? undefined : {}
      if (key === 'subagents') {
        return opts.subagents === false
          ? undefined
          : {
            getProvider: (name: string) => (opts.provider === false ? undefined : name === 'spawn' ? provider : undefined),
            start: startSpy,
          }
      }
      return undefined
    }),
  } as unknown as Context
  return { ctx, tools, sections, startSpy, requests }
}

/** 执行捕获的 memory_deep_recall。 */
async function runRecall(h: Harness, question = '上次为什么改用 SQLite？'): Promise<RecallResult> {
  const tool = h.tools.find(t => t.name === 'memory_deep_recall')
  if (tool === undefined) throw new Error('memory_deep_recall not registered')
  return tool.execute({ question }, { signal: SIGNAL, agent: { id: 'agent' } as unknown as Agent })
}

describe('memory_deep_recall', () => {
  it('注册工具 + 静态指引 section（静态文本，前缀缓存安全）', () => {
    const h = makeCtx()
    apply(h.ctx, {})
    expect(h.tools.map(t => t.name)).toEqual(['memory_deep_recall'])
    expect(h.sections).toHaveLength(1)
    expect(h.sections[0]?.name).toBe('tool:memory-recall')
    expect(typeof h.sections[0]?.text).toBe('string')
  })

  it('成功路径：reader 以只读工具集 + 结构化 schema 启动，返回蒸馏形状', async () => {
    const h = makeCtx()
    apply(h.ctx, {})
    const result = await runRecall(h)
    expect(result.answer).toContain('SQLite')
    expect(result.evidence[0]).toEqual({ sessionId: 's-1', eventSeqs: [12, 13], quote: 'decided to use SQLite' })
    expect(result.uncertainties).toEqual(['未曾记录回滚方案'])
    expect(result.confidence).toBe(0.8)

    const request = h.requests[0]
    expect(request?.toolFilter).toEqual({ allow: ['session_search', 'session_event_search', 'session_event_read'] })
    expect(request?.outputSchema).toBeDefined()
    expect(typeof request?.persona).toBe('string')
    expect(request?.maxDepth).toBe(0)
    // 主上下文只收到蒸馏结果：reader 的原始输出不经由本工具返回。
    expect(JSON.stringify(result)).not.toContain('reader raw text')
  })

  it('预算钳制：超长 answer / 超额 evidence / 超长 quote / 越界 confidence', async () => {
    const h = makeCtx({
      structured: {
        answer: 'a'.repeat(5000),
        evidence: Array.from({ length: 20 }, (_, index) => ({
          sessionId: `s-${index}`,
          eventSeqs: [index],
          quote: 'q'.repeat(1000),
        })),
        uncertainties: ['u'.repeat(1000)],
        confidence: 7,
      },
    })
    apply(h.ctx, {})
    const result = await runRecall(h)
    expect(result.answer.length).toBeLessThanOrEqual(2000)
    expect(result.evidence.length).toBeLessThanOrEqual(5)
    expect(result.evidence.every(item => item.quote.length <= 240)).toBe(true)
    expect(result.uncertainties[0]?.length).toBeLessThanOrEqual(240)
    expect(result.confidence).toBe(1)
  })

  it('sessionQuery 缺失 → 平实报告不可用', async () => {
    const h = makeCtx({ sessionQuery: false })
    apply(h.ctx, {})
    await expect(runRecall(h)).rejects.toThrow('session-query')
    expect(h.startSpy).not.toHaveBeenCalled()
  })

  it('reader 搜索工具未注册 → 报告缺失的工具名', async () => {
    const h = makeCtx({ readerTools: ['session_search'] })
    apply(h.ctx, {})
    await expect(runRecall(h)).rejects.toThrow('session_event_search')
    expect(h.startSpy).not.toHaveBeenCalled()
  })

  it('provider 未注册 / 能力不足 → fail loud', async () => {
    const noProvider = makeCtx({ provider: false })
    apply(noProvider.ctx, {})
    await expect(runRecall(noProvider)).rejects.toThrow('spawn')

    const noOutputSchema = makeCtx({ capabilities: { outputSchema: false } })
    apply(noOutputSchema.ctx, {})
    await expect(runRecall(noOutputSchema)).rejects.toThrow('outputSchema')
  })

  it('reader 未正常结束 → 错误（不把部分输出当成功）', async () => {
    const h = makeCtx({ stopReason: 'error' })
    apply(h.ctx, {})
    await expect(runRecall(h)).rejects.toThrow('error')
  })

  it('reader 无结构化输出 → 错误', async () => {
    const h = makeCtx({ structured: undefined })
    apply(h.ctx, {})
    await expect(runRecall(h)).rejects.toThrow('structured')
  })
})

describe('distillRecallResult', () => {
  const budgets = {
    provider: 'spawn',
    readerTools: [],
    maxAnswerChars: 10,
    maxEvidence: 2,
    maxQuoteChars: 5,
    maxDepth: 0,
  }

  it('非对象/缺字段 → 错误', () => {
    expect(() => distillRecallResult(null, budgets)).toThrow()
    expect(() => distillRecallResult({ answer: 1 }, budgets)).toThrow()
    expect(() => distillRecallResult('text', budgets)).toThrow()
  })

  it('畸形 evidence 条目被过滤；seq 非整数被丢弃', () => {
    const result = distillRecallResult({
      answer: 'ok',
      evidence: [
        'garbage',
        { sessionId: 's', eventSeqs: [1, 'x', -1, 2.5], quote: 'q' },
        { quote: 'missing sessionId' },
      ],
      uncertainties: [],
      confidence: 0.5,
    }, budgets)
    expect(result.evidence).toEqual([{ sessionId: 's', eventSeqs: [1], quote: 'q' }])
  })
})
