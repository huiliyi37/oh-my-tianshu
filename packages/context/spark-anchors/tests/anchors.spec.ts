/**
 * spark-anchors 纯函数测试：锚点与 wire 截断的互补不变量、聚合语义（去重/cap）、渲染。
 * 互补判据：锚点只来自「截断丢失域」（前 len−N token 段）；无截断 → 无锚点。
 * @module dsh-spark-anchors/tests/anchors
 */

import { describe, expect, it } from 'vitest'
import { CallId, createMessage } from '@huiliyi37/dsh-llm'
import type { SparkTruncatePolicy } from '@huiliyi37/dsh-llm-deepseek'
import { truncateReasoningTail, defaultTokenizer } from '@huiliyi37/dsh-llm-deepseek'
import type { SessionEvent } from '@huiliyi37/dsh-session'
import { anchorsFromReasoning, collectAnchors, reasoningFromEvents, renderAnchors } from '../src/index.ts'

const POLICY: SparkTruncatePolicy = { flash: 300, pro: 0 }
/** 400 个 CJK 单字（400 token > flash N=300），尾部无排除句。 */
const TAIL = '字'.repeat(400)

function assistantEvent(reasoning: string, step = 1): SessionEvent {
  return {
    type: 'assistant/message',
    data: {
      turn: 1,
      step,
      message: createMessage({
        role: 'assistant',
        content: [
          { type: 'tool-call', id: CallId(`c${step}`), name: 'tool', arguments: '{}' },
          ...(reasoning === '' ? [] : [{ type: 'reasoning' as const, text: reasoning }]),
        ],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    },
    time: step,
    seq: step,
  } as unknown as SessionEvent
}

describe('anchorsFromReasoning（互补不变量）', () => {
  it('锚点只来自截断丢失域：丢失域提取的排除句入锚，保留尾段的排除句不入锚', () => {
    // 排除句在头部（丢失域），尾部全是"字"（无排除句）
    const reasoning = 'A不是最优解。' + TAIL
    const anchors = anchorsFromReasoning(reasoning, POLICY, 'deepseek-v4-flash')
    expect(anchors).toContain('A不是最优解')
    // 互补：锚点必须全部落在截断丢失段内
    const cutStart = reasoning.length - truncateReasoningTail(reasoning, 300, defaultTokenizer).length
    for (const anchor of anchors) {
      expect(reasoning.slice(0, cutStart)).toContain(anchor)
    }
  })

  it('排除句在保留尾段时不入锚（尾段随 wire 回传，无需锚点）', () => {
    // 构造尾部 300 token 内含排除句：前面 100 字 + 排除句 + 后面 200 字
    const reasoning = '字'.repeat(100) + 'B方案不可行。' + '字'.repeat(200)
    const anchors = anchorsFromReasoning(reasoning, POLICY, 'deepseek-v4-flash')
    // B方案不可行 位于尾部 300 token 内（100+6+200=306 token，尾部 300 从第 7 token 起）
    expect(anchors).not.toContain('B方案不可行')
  })

  it('无截断（token ≤ N）→ 无锚点（无丢失）', () => {
    expect(anchorsFromReasoning('A不是最优解。', POLICY, 'deepseek-v4-flash')).toEqual([])
  })

  it('N=0（pro 档默认）→ 无锚点', () => {
    expect(anchorsFromReasoning('A不是最优解。' + TAIL, POLICY, 'deepseek-v4-pro')).toEqual([])
  })

  it('pro 档显式开启 N=5 → 提取', () => {
    const policy: SparkTruncatePolicy = { flash: 300, pro: 5 }
    const anchors = anchorsFromReasoning('A不是最优解。' + TAIL, policy, 'deepseek-v4-pro')
    expect(anchors).toContain('A不是最优解')
  })

  it('空推理 → 无锚点', () => {
    expect(anchorsFromReasoning('', POLICY, 'deepseek-v4-flash')).toEqual([])
  })
})

describe('reasoningFromEvents', () => {
  it('按事件序提取 assistant reasoning 文本', () => {
    const events: SessionEvent[] = [
      {
        type: 'user/message',
        data: createMessage({
          role: 'user',
          content: [{ type: 'text', text: 'hi' }],
          source: { kind: 'user' },
        }),
        time: 0,
        seq: 0,
      } as unknown as SessionEvent,
      assistantEvent('第一段推理', 1),
      {
        type: 'tool/result',
        data: {
          turn: 1,
          step: 1,
          message: createMessage({
            role: 'user',
            content: [{ type: 'text', text: 'ok' }],
            source: { kind: 'plugin', plugin: 'test' },
            toolCallId: CallId('c1'),
          }),
        },
        time: 2,
        seq: 2,
      } as unknown as SessionEvent,
      assistantEvent('第二段推理', 2),
    ]
    expect(reasoningFromEvents(events)).toEqual(['第一段推理', '第二段推理'])
  })

  it('无 reasoning 的 assistant 消息跳过', () => {
    const events: SessionEvent[] = [assistantEvent('', 1)]
    expect(reasoningFromEvents(events)).toEqual([])
  })
})

describe('collectAnchors（聚合语义）', () => {
  it('跨多条推理聚合锚点', () => {
    const events: SessionEvent[] = [
      assistantEvent('A不是最优解。' + TAIL, 1),
      assistantEvent('B方案不可行，成本太高。' + TAIL, 2),
    ]
    const anchors = collectAnchors(events, POLICY, 'deepseek-v4-flash', 20)
    expect(anchors).toContain('A不是最优解')
    // 注：正则按句提取到句内逗号为止（[^，。；、] 排除逗号），claim 为「B方案不可行」
    expect(anchors).toContain('B方案不可行')
  })

  it('同一排除句重复出现 → 去重为一条', () => {
    const events: SessionEvent[] = [
      assistantEvent('A不是最优解。' + TAIL, 1),
      assistantEvent('之后再看，A不是最优解。' + TAIL, 2),
    ]
    // 注：正则按句提取，两条事件中「A不是最优解」的 claim 文本相同 → 去重为一条；
    // 不同文本的排除句（如带不同上下文）是不同 claim，不去重（正确行为）。
    const anchors = collectAnchors(events, POLICY, 'deepseek-v4-flash', 20)
    expect(anchors.filter(a => a === 'A不是最优解').length).toBe(1)
  })

  it('cap 溢出淘汰最旧：保留最近 maxAnchors 条', () => {
    const events: SessionEvent[] = [
      assistantEvent('甲不是第一。' + TAIL, 1),
      assistantEvent('乙不是第二。' + TAIL, 2),
      assistantEvent('丙不是第三。' + TAIL, 3),
    ]
    const anchors = collectAnchors(events, POLICY, 'deepseek-v4-flash', 2)
    expect(anchors).toHaveLength(2)
    expect(anchors).not.toContain('甲不是第一')
    expect(anchors).toContain('乙不是第二')
    expect(anchors).toContain('丙不是第三')
  })
})

describe('renderAnchors', () => {
  it('渲染为逐条列出的文本', () => {
    const text = renderAnchors(['A不是最优解', 'B不可行'])
    expect(text).toContain('A不是最优解')
    expect(text).toContain('B不可行')
    expect(text).toContain('- A不是最优解')
  })
})
