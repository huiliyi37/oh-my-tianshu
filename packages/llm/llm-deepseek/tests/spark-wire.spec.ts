/**
 * spark wire 接线测试：config 校验（fail loud）+ serialize 截断行为。
 * 行为断言：spark 开/关、route 判定、模型档、passback 规则不变、copy-on-write。
 * @module dsh-llm-deepseek/tests/spark-wire
 */

import { describe, expect, it } from 'vitest'
import { CallId, createMessage } from '@huiliyi37/dsh-llm'
import type { GenerateOptions } from '@huiliyi37/dsh-llm'
import { resolveAdapterOptions } from '../src/index.ts'
import { serializeMessages, serializeRequest } from '../src/serialize.ts'
import { SPARK_PROVIDER } from '../src/spark.ts'

/** 构造 400 个 CJK 单字的长推理（400 token > 默认 flash N=300）。 */
const LONG_REASONING = '字'.repeat(400)

function sparkRequest(overrides: Partial<GenerateOptions> = {}): GenerateOptions {
  return {
    provider: SPARK_PROVIDER,
    model: 'deepseek-v4-flash',
    messages: [
      createMessage({
        role: 'assistant',
        content: [
          { type: 'reasoning', text: LONG_REASONING },
          { type: 'tool-call', id: CallId('call-1'), name: 'tool', arguments: '{}' },
        ],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ],
    ...overrides,
  }
}

/** spark enabled 的完整配置（flash 300 / pro 0 缺省）。 */
const SPARK_ON = { spark: { enabled: true } }

function resolveSpark(config: unknown) {
  return resolveAdapterOptions(config as Parameters<typeof resolveAdapterOptions>[0])
}

describe('resolveAdapterOptions spark 配置', () => {
  it('缺省时 spark 策略不启用（defaults.spark undefined）', () => {
    const resolved = resolveSpark({})
    expect(resolved.defaults.spark).toBeUndefined()
  })

  it('spark.enabled 开启时带默认档位（flash 300 / pro 0）', () => {
    const resolved = resolveSpark(SPARK_ON)
    expect(resolved.defaults.spark).toEqual({ enabled: true, truncateN: { flash: 300, pro: 0 } })
  })

  it('自定义档位透传', () => {
    const resolved = resolveSpark({ spark: { enabled: true, truncateN: { flash: 100, pro: 50 } } })
    expect(resolved.defaults.spark).toEqual({ enabled: true, truncateN: { flash: 100, pro: 50 } })
  })

  it('truncateN 负值 fail loud', () => {
    expect(() => resolveSpark({ spark: { enabled: true, truncateN: { flash: -1 } } }))
      .toThrow(/spark/i)
  })

  it('truncateN 非整数 fail loud', () => {
    expect(() => resolveSpark({ spark: { enabled: true, truncateN: { pro: 1.5 } } }))
      .toThrow(/spark/i)
  })
})

describe('serializeRequest spark 截断', () => {
  it('spark route + enabled + flash：长推理截断为尾部 N token', () => {
    const wire = serializeRequest(sparkRequest(), { spark: { enabled: true, truncateN: { flash: 300, pro: 0 } } })
    const assistant = wire.messages[0] as { reasoning_content?: string }
    expect(assistant.reasoning_content).toBeDefined()
    // 400 个 CJK 单字 → 尾部 300 token = 300 字（连续子串）
    expect(assistant.reasoning_content!.length).toBe(300)
    expect(LONG_REASONING.endsWith(assistant.reasoning_content!)).toBe(true)
  })

  it('推理不超过 N 时原样保留', () => {
    const wire = serializeRequest(
      sparkRequest({ messages: [createMessage({
        role: 'assistant',
        content: [
          { type: 'reasoning', text: '短推理' },
          { type: 'tool-call', id: CallId('c1'), name: 'tool', arguments: '{}' },
        ],
        source: { kind: 'plugin', plugin: 'test' },
      })] }),
      { spark: { enabled: true, truncateN: { flash: 300, pro: 0 } } },
    )
    const assistant = wire.messages[0] as { reasoning_content?: string }
    expect(assistant.reasoning_content).toBe('短推理')
  })

  it('spark.enabled 缺省（false）时不截断', () => {
    const wire = serializeRequest(sparkRequest(), {})
    const assistant = wire.messages[0] as { reasoning_content?: string }
    expect(assistant.reasoning_content).toBe(LONG_REASONING)
  })

  it('非 spark route 不截断', () => {
    const wire = serializeRequest(
      sparkRequest({ provider: 'deepseek-official' }),
      { spark: { enabled: true, truncateN: { flash: 300, pro: 0 } } },
    )
    const assistant = wire.messages[0] as { reasoning_content?: string }
    expect(assistant.reasoning_content).toBe(LONG_REASONING)
  })

  it('pro 模型 + pro 档 N=0：不截断（需显式开启）', () => {
    const wire = serializeRequest(
      sparkRequest({ model: 'deepseek-v4-pro' }),
      { spark: { enabled: true, truncateN: { flash: 300, pro: 0 } } },
    )
    const assistant = wire.messages[0] as { reasoning_content?: string }
    expect(assistant.reasoning_content).toBe(LONG_REASONING)
  })

  it('pro 模型 + pro 档 N=5：截断为尾部 5 token', () => {
    const wire = serializeRequest(
      sparkRequest({ model: 'deepseek-v4-pro' }),
      { spark: { enabled: true, truncateN: { flash: 300, pro: 5 } } },
    )
    const assistant = wire.messages[0] as { reasoning_content?: string }
    expect(assistant.reasoning_content!.length).toBe(5)
  })

  it('无 tool_calls 的轮次不回传 reasoning（passback 规则不变）', () => {
    const wire = serializeRequest(
      sparkRequest({ messages: [createMessage({
        role: 'assistant',
        content: [{ type: 'reasoning', text: LONG_REASONING }, { type: 'text', text: '答案' }],
        source: { kind: 'plugin', plugin: 'test' },
      })] }),
      { spark: { enabled: true, truncateN: { flash: 300, pro: 0 } } },
    )
    const assistant = wire.messages[0] as { reasoning_content?: string }
    expect(assistant.reasoning_content).toBeUndefined()
  })

  it('copy-on-write：serialize 不 mutate 原 Message（原始推理保留）', () => {
    const messages = [createMessage({
      role: 'assistant',
      content: [
        { type: 'reasoning', text: LONG_REASONING },
        { type: 'tool-call', id: CallId('c1'), name: 'tool', arguments: '{}' },
      ],
      source: { kind: 'plugin', plugin: 'test' },
    })]
    serializeMessages(messages, 300)
    const reasoning = messages[0]!.content.find(block => block.type === 'reasoning')
    expect(reasoning?.type === 'reasoning' && reasoning.text).toBe(LONG_REASONING)
  })

  it('serializeMessages 显式传 N 也生效（与 serializeRequest 路径一致）', () => {
    const wire = serializeMessages([createMessage({
      role: 'assistant',
      content: [
        { type: 'reasoning', text: LONG_REASONING },
        { type: 'tool-call', id: CallId('c1'), name: 'tool', arguments: '{}' },
      ],
      source: { kind: 'plugin', plugin: 'test' },
    })], 300)
    const assistant = wire[0] as { reasoning_content?: string }
    expect(assistant.reasoning_content!.length).toBe(300)
  })
})
