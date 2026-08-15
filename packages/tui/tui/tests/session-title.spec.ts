/**
 * Session title adapter — `/session list` 展示标题（官方 session/title 事件
 * fold → 确定性 fallback → 「新对话」）。纯函数只读层，无 API/无 sidecar。
 */

import { describe, expect, it } from 'vitest'
import type { SessionEvent, SessionId } from '@huiliyi37/dsh-session'
import {
  EMPTY_TITLE,
  FALLBACK_MAX_BYTES,
  FALLBACK_MAX_WORDS,
  sessionTitleFor,
} from '../src/adapter/session-title.js'

/** 构造一条真人用户消息。 */
function userEvent(seq: number, text: string, kind: 'user' | 'plugin' = 'user'): SessionEvent {
  return {
    seq,
    time: seq * 1000,
    type: 'user/message',
    data: {
      content: text === '' ? [] : [{ type: 'text', text }],
      source: { kind },
    },
  } as unknown as SessionEvent
}

/** 构造一条 session/title 事件（官方 log-backed 事件形状）。 */
function titleEvent(seq: number, title: string, source: { kind: 'fallback' } | { kind: 'provider'; provider: string }): SessionEvent {
  return {
    seq,
    time: seq * 1000,
    type: 'session/title',
    data: {
      title,
      messageSeqs: [1],
      source,
    },
  } as unknown as SessionEvent
}

describe('sessionTitleFor', () => {
  it('fold 官方标题事件（fallback 源）', () => {
    const events = [
      userEvent(1, '写个脚本计算两个数组的交集'),
      titleEvent(2, '数组交集计算脚本', { kind: 'fallback' }),
    ]
    expect(sessionTitleFor(events)).toBe('数组交集计算脚本')
  })

  it('fold 官方标题事件（provider/LLM 源）', () => {
    const events = [
      userEvent(1, '评估某模型的识别准确率'),
      titleEvent(2, '评估某模型的识别准确率', { kind: 'provider', provider: 'session-title-llm' }),
    ]
    expect(sessionTitleFor(events)).toBe('评估某模型的识别准确率')
  })

  it('多标题事件取最新（last-wins）', () => {
    const events = [
      userEvent(1, '问题一'),
      titleEvent(2, '标题一', { kind: 'fallback' }),
      userEvent(3, '问题二'),
      titleEvent(4, '标题二', { kind: 'fallback' }),
    ]
    expect(sessionTitleFor(events)).toBe('标题二')
  })

  it('无标题事件时用首条真人消息的确定性 fallback（前 5 词）', () => {
    const events = [userEvent(1, '写个脚本计算两个数组的交集并输出结果')]
    const title = sessionTitleFor(events)
    expect(title).toBe('写个脚本计算两个数组的交集')
    expect(title.split(' ').length).toBeLessThanOrEqual(FALLBACK_MAX_WORDS)
  })

  it('fallback 受字节预算约束（40 字节，不劈码点）', () => {
    const long = '这是一个非常长的中文用户消息用于验证确定性回退的字节预算截断行为'
    const title = sessionTitleFor([userEvent(1, long)])
    expect(Buffer.byteLength(title, 'utf8')).toBeLessThanOrEqual(FALLBACK_MAX_BYTES)
    expect(long.startsWith(title)).toBe(true)
  })

  it('合成注入消息（plugin source）不参与 fallback', () => {
    const events = [
      userEvent(1, '来自视觉桥的描述', 'plugin'),
      userEvent(2, '真实用户问题'),
    ]
    const title = sessionTitleFor(events)
    expect(title).not.toContain('视觉桥')
    expect(title).toContain('真实用户问题')
  })

  it('空文本真人消息被跳过，取后续有文本的消息', () => {
    const events = [userEvent(1, ''), userEvent(2, '真实用户问题')]
    expect(sessionTitleFor(events)).toContain('真实用户问题')
  })

  it('无任何真人消息返回「新对话」', () => {
    expect(sessionTitleFor([])).toBe(EMPTY_TITLE)
    const onlyAssistant = [
      { seq: 1, time: 1000, type: 'assistant/message', data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: '回答' }] } } },
    ] as unknown as SessionEvent[]
    expect(sessionTitleFor(onlyAssistant)).toBe(EMPTY_TITLE)
  })

  it('fold 原样返回事件标题（规范化由官方服务写入前保证，TUI 不重复清洗）', () => {
    const events = [
      userEvent(1, '评估某模型'),
      // 官方服务在 append 前已 normalizeSessionTitle（cleanTitleText 全套）——
      // 事件中的标题恒为清洗后文本，TUI 层不需要也不应该再清洗。
      titleEvent(2, '评估某模型的准确率', { kind: 'provider', provider: 'session-title-llm' }),
    ]
    expect(sessionTitleFor(events)).toBe('评估某模型的准确率')
  })

  it('常量与 dsh-base 装配配置对齐', () => {
    expect(FALLBACK_MAX_WORDS).toBe(5)
    expect(FALLBACK_MAX_BYTES).toBe(40)
  })
})

// 类型冒烟：SessionId 导出保持（测试文件公共面）
void (null as unknown as SessionId)
