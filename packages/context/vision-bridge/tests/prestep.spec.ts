/**
 * vision-bridge 集成测试：真实装配（agent/pre-step waterfall + llm service
 * + 假视觉 adapter），不 mock 中间层。覆盖：含图消息描述替换、主控识图直发、
 * 桥失败降级提示、无图零干预。
 * @module dsh-vision-bridge/tests/prestep
 */

import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { agentEvents, Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as visionBridge from '@deepseek-ai/dsh-vision-bridge'

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const IMG = `data:image/png;base64,${PNG_B64}`

/** 含图用户消息（TUI 提交路径产出的形状）。 */
function imageMessage(text = '看图', images: string[] = [IMG]) {
  return createUserMessage({
    content: [
      { type: 'text', text },
      ...images.map(dataUrl => ({ type: 'image' as const, dataUrl })),
    ],
    source: { kind: 'user' },
  })
}

/** 纯文本用户消息（应零干预透传）。 */
function textMessage(text = '纯文本') {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  })
}

function sessionAgent(session: Session, id = 'agent'): Agent {
  return {
    id: SessionId(id),
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'running',
    ctx: new Context(),
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => {},
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => { return Promise.resolve() },
  }
}

/** 假视觉 adapter：按场景返回描述文本 / 空输出 / 报错。 */
class FakeVisionAdapter extends LlmAdapter {
  scene: 'ok' | 'empty' | 'error'
  constructor(scene: 'ok' | 'empty' | 'error' = 'ok') {
    super()
    this.scene = scene
  }
  override stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    const scene = this.scene
    return (async function* () {
      if (scene === 'error') {
        yield { type: 'finish', reason: { kind: 'error', failure: { message: 'vision down', code: 'VISION_ERR' } } }
        return
      }
      if (scene === 'empty') {
        yield { type: 'finish', reason: { kind: 'stop' } }
        return
      }
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: '截图显示 Error: foo' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: '截图显示 Error: foo' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })()
  }
}

async function mount(config: Partial<visionBridge.Config> = {}, scene: 'ok' | 'empty' | 'error' = 'ok') {
  const ctx = new Context()
  // mountAgentLoopTestDependencies 已装配 LlmService（含 llm 服务声明）
  await mountAgentLoopTestDependencies(ctx)
  ctx.llm.registerAdapter(['fake-vision'], new FakeVisionAdapter(scene))
  const fiber = await ctx.plugin(visionBridge, {
    provider: 'fake-vision',
    model: 'vision-m',
    ...config,
  })
  return {
    ctx,
    fiber,
    async dispose() { await fiber.dispose() },
  }
}

async function fire(ctx: Context, agent: Agent, messages: ReturnType<typeof createUserMessage>[]) {
  return await agentEvents(ctx, agent).waterfall(
    'agent/pre-step',
    { messages, turn: 1, step: 1, signal: new AbortController().signal },
    () => Promise.resolve({ kind: 'enter' as const, messages }),
  )
}

describe('agent/pre-step 视觉桥注入', () => {
  it('含图消息 → image block 替换为描述文本（[图片描述] 前缀 + 原文本）', async () => {
    const { ctx, dispose } = await mount()
    try {
      const session = Session.create(
        SessionId('s1'),
        [],
        { version: 0, id: SessionId('s1'), createdAt: 0, cwd: '/tmp' },
      )
      const decision = await fire(ctx, sessionAgent(session), [imageMessage('这个报错怎么回事')])
      expect(decision.kind).toBe('enter')
      const messages = (decision as { kind: 'enter'; messages: { content: { type: string; text?: string }[]; source: { kind: string; plugin?: string } }[] }).messages
      expect(messages).toHaveLength(1)
      const content = messages[0]?.content ?? []
      // 无 image block，text 含描述 + 原文本
      expect(content.some(b => b.type === 'image')).toBe(false)
      const text = content.map(b => b.text ?? '').join('')
      expect(text).toContain('[图片描述]')
      expect(text).toContain('截图显示 Error: foo')
      expect(text).toContain('这个报错怎么回事')
      // source 重归因为 vision-bridge 插件（invariant 据此校验注入，日志可归因）
      expect(messages[0]?.source).toEqual({ kind: 'plugin', plugin: 'vision-bridge' })
    } finally {
      await dispose()
    }
  })

  it('主控支持识图（primarySupportsVision）→ 零干预透传（图直发）', async () => {
    const { ctx, dispose } = await mount({ primarySupportsVision: true })
    try {
      const session = Session.create(
        SessionId('s1'),
        [],
        { version: 0, id: SessionId('s1'), createdAt: 0, cwd: '/tmp' },
      )
      const input = imageMessage('看图')
      const decision = await fire(ctx, sessionAgent(session), [input])
      const messages = (decision as { kind: 'enter'; messages: { content: { type: string }[] }[] }).messages
      expect(messages).toHaveLength(1)
      expect(messages[0]?.content.some(b => b.type === 'image')).toBe(true)
    } finally {
      await dispose()
    }
  })

  it('纯文本消息 → 零干预透传', async () => {
    const { ctx, dispose } = await mount()
    try {
      const session = Session.create(
        SessionId('s1'),
        [],
        { version: 0, id: SessionId('s1'), createdAt: 0, cwd: '/tmp' },
      )
      const input = textMessage('纯文本')
      const decision = await fire(ctx, sessionAgent(session), [input])
      const messages = (decision as { kind: 'enter'; messages: { content: { type: string; text?: string }[] }[] }).messages
      expect(messages).toHaveLength(1)
      expect(messages[0]?.content[0]).toMatchObject({ type: 'text', text: '纯文本' })
    } finally {
      await dispose()
    }
  })

  it('视觉模型返回空描述 → 降级提示（[图片桥接提示]，不炸轮）', async () => {
    const { ctx, dispose } = await mount({}, 'empty')
    try {
      const session = Session.create(
        SessionId('s1'),
        [],
        { version: 0, id: SessionId('s1'), createdAt: 0, cwd: '/tmp' },
      )
      const decision = await fire(ctx, sessionAgent(session), [imageMessage('看图')])
      const messages = (decision as { kind: 'enter'; messages: { content: { type: string; text?: string }[] }[] }).messages
      const text = (messages[0]?.content ?? []).map(b => b.text ?? '').join('')
      expect(text).toContain('[图片桥接提示]')
      expect(text).toContain('返回空描述')
    } finally {
      await dispose()
    }
  })

  it('视觉模型报错 → 降级提示（[图片桥接失败] 含原因，不炸轮）', async () => {
    const { ctx, dispose } = await mount({}, 'error')
    try {
      const session = Session.create(
        SessionId('s1'),
        [],
        { version: 0, id: SessionId('s1'), createdAt: 0, cwd: '/tmp' },
      )
      const decision = await fire(ctx, sessionAgent(session), [imageMessage('看图')])
      const messages = (decision as { kind: 'enter'; messages: { content: { type: string; text?: string }[] }[] }).messages
      const text = (messages[0]?.content ?? []).map(b => b.text ?? '').join('')
      expect(text).toContain('[图片桥接失败]')
      expect(text).toContain('vision down')
    } finally {
      await dispose()
    }
  })

  it('enabled=false → 监听不注册，消息原样透传', async () => {
    const { ctx, dispose } = await mount({ enabled: false })
    try {
      const session = Session.create(
        SessionId('s1'),
        [],
        { version: 0, id: SessionId('s1'), createdAt: 0, cwd: '/tmp' },
      )
      const input = imageMessage('看图')
      const decision = await fire(ctx, sessionAgent(session), [input])
      const messages = (decision as { kind: 'enter'; messages: { content: { type: string }[] }[] }).messages
      expect(messages[0]?.content.some(b => b.type === 'image')).toBe(true)
    } finally {
      await dispose()
    }
  })
})
