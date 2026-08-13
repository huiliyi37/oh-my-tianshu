/**
 * ask-tool — ask_image 工具契约测试（注入 mock llm/ctx，不依赖真实模型）。
 *
 * - 参数校验：question 必填
 * - 三路径：动态判定 text-only → 描述（含缓存命中）；supportsVision 声明
 *   → 原图直发；配置强制 primarySupportsVision 覆盖动态判定
 * - 错误路径：无 agent / 会话无图 / imageId 不存在 / 视觉模型空输出
 */

import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@huiliyi37/dsh-agent'
import type { StreamChunk } from '@huiliyi37/dsh-llm'
import type { ToolRunContext } from '@huiliyi37/dsh-tools'
import { askToolDefinition } from '../src/ask-tool.ts'
import { ImageRegistry } from '../src/registry.ts'
import type { AskImageDeps } from '../src/ask-tool.ts'
import type { RegisteredImageSource } from '../src/registry.ts'

function src(): RegisteredImageSource {
  return { dataUrl: 'data:image/png;base64,iVBORw==' }
}

function agent(over: Partial<Agent> = {}): Agent {
  // Agent.id 与 session 共享同一身份；测试替身只带 ask_image 触达的字段。
  return {
    id: 's1',
    options: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    ...over,
  } as unknown as Agent
}

function exec(agentValue: Agent | undefined): ToolRunContext {
  // 测试替身只提供 ask_image 实际触达的字段（agent/signal）。
  return {
    agent: agentValue,
    signal: new AbortController().signal,
  } as unknown as ToolRunContext
}

/** mock ctx：llm.stream 产出给定文本块，resolveModelInfo 返回给定识图声明。 */
function mockCtx(options: {
  supportsVision?: boolean
  streamText?: string
  streamFinish?: 'finish' | 'error'
} = {}) {
  const { supportsVision = false, streamText = '这是一张图的描述', streamFinish = 'finish' } = options
  const stream = vi.fn(async function* (): AsyncGenerator<StreamChunk> {
    if (streamText.length > 0) {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: streamText }
    }
    yield { type: 'finish', reason: streamFinish === 'finish' ? { kind: 'stop' } : { kind: 'error', failure: { message: '模型错误', code: 'X' } } }
  })
  const resolveModelInfo = vi.fn(async () => ({ provider: 'p', id: 'm', supportsVision }))
  return { ctx: { llm: { stream, resolveModelInfo } } as never, stream, resolveModelInfo }
}

function deps(over: Partial<AskImageDeps> = {}): AskImageDeps {
  return {
    registries: new Map(),
    visionProvider: 'vision-ask',
    visionModel: 'vl-model',
    maxTokens: 256,
    ...over,
  }
}

describe('ask_image 参数校验', () => {
  it('question 缺失 → 框架 INVALID_ARGS；空白 → ASK_IMAGE_INVALID_QUESTION', async () => {
    const definition = askToolDefinition(mockCtx().ctx, deps())
    // 缺 question：defineTool 框架层在 execute 前校验参数（INVALID_ARGS）。
    await expect(definition.execute({}, exec(agent()))).rejects.toMatchObject({ code: 'INVALID_ARGS' })
    // 空白 question：通过参数校验，工具内拒绝。
    await expect(definition.execute({ question: '   ' }, exec(agent()))).rejects.toMatchObject({ code: 'ASK_IMAGE_INVALID_QUESTION' })
  })
})

describe('ask_image 三路径', () => {
  it('text-only 主控（动态判定）→ 描述路径 + 缓存二次命中', async () => {
    const { ctx, stream, resolveModelInfo } = mockCtx({ supportsVision: false, streamText: '第一行是红色报错' })
    const registries = new Map()
    const r = new ImageRegistry()
    r.register([src()])
    registries.set('s1', r)
    const definition = askToolDefinition(ctx, deps({ registries }))

    const first = await definition.execute({ question: '逐字念出报错' }, exec(agent()))
    expect(resolveModelInfo).toHaveBeenCalled()
    expect(stream).toHaveBeenCalledTimes(1)
    expect(first).toMatchObject({ kind: 'answer', answer: '第一行是红色报错', cached: false, imageId: 'img_1' })

    const second = await definition.execute({ question: '逐字念出报错' }, exec(agent()))
    expect(stream).toHaveBeenCalledTimes(1) // 缓存命中，零额外调用
    expect(second).toMatchObject({ kind: 'answer', cached: true })
  })

  it('多模态主控（supportsVision 声明）→ 原图引用直发', async () => {
    const { ctx, stream } = mockCtx({ supportsVision: true })
    const registries = new Map()
    const r = new ImageRegistry()
    r.register([src()])
    registries.set('s1', r)
    const definition = askToolDefinition(ctx, deps({ registries }))

    const result = await definition.execute({ question: '这个按钮的坐标？' }, exec(agent()))
    expect(stream).not.toHaveBeenCalled()
    expect(result).toMatchObject({ kind: 'forwarded', imageId: 'img_1' })
    const rendered = (definition.output as { render: (a: unknown, v: unknown) => unknown[] }).render?.({}, result)
    expect(rendered).toHaveLength(2)
    expect(rendered?.[1]).toMatchObject({ type: 'image' })
  })

  it('primarySupportsVision=true 强制直发（即使动态判定 text-only）', async () => {
    const { ctx, stream } = mockCtx({ supportsVision: false })
    const registries = new Map()
    const r = new ImageRegistry()
    r.register([src()])
    registries.set('s1', r)
    const definition = askToolDefinition(ctx, deps({ registries, primarySupportsVision: true }))
    const result = await definition.execute({ question: '问' }, exec(agent()))
    expect(stream).not.toHaveBeenCalled()
    expect(result).toMatchObject({ kind: 'forwarded' })
  })
})

describe('ask_image 错误路径', () => {
  it('无 agent → ASK_IMAGE_AGENT_REQUIRED', async () => {
    const definition = askToolDefinition(mockCtx().ctx, deps())
    await expect(definition.execute({ question: '问' }, exec(undefined))).rejects.toMatchObject({ code: 'ASK_IMAGE_AGENT_REQUIRED' })
  })

  it('会话无图片 → ASK_IMAGE_NO_IMAGE', async () => {
    const definition = askToolDefinition(mockCtx().ctx, deps())
    await expect(definition.execute({ question: '问' }, exec(agent()))).rejects.toMatchObject({ code: 'ASK_IMAGE_NO_IMAGE' })
  })

  it('imageId 不存在 → ASK_IMAGE_NOT_FOUND', async () => {
    const registries = new Map()
    const r = new ImageRegistry()
    r.register([src()])
    registries.set('s1', r)
    const definition = askToolDefinition(mockCtx().ctx, deps({ registries }))
    await expect(definition.execute({ question: '问', imageId: 'img_9' }, exec(agent())))
      .rejects.toMatchObject({ code: 'ASK_IMAGE_NOT_FOUND' })
  })

  it('视觉模型错误 finish → 结构化错误上抛', async () => {
    const { ctx } = mockCtx({ streamText: '', streamFinish: 'error' })
    const registries = new Map()
    const r = new ImageRegistry()
    r.register([src()])
    registries.set('s1', r)
    const definition = askToolDefinition(ctx, deps({ registries }))
    await expect(definition.execute({ question: '问' }, exec(agent()))).rejects.toMatchObject({ code: 'X' })
  })

  it('视觉模型空输出 → EMPTY_RESPONSE', async () => {
    const { ctx } = mockCtx({ streamText: '', streamFinish: 'finish' })
    const registries = new Map()
    const r = new ImageRegistry()
    r.register([src()])
    registries.set('s1', r)
    const definition = askToolDefinition(ctx, deps({ registries }))
    await expect(definition.execute({ question: '问' }, exec(agent()))).rejects.toMatchObject({ code: 'EMPTY_RESPONSE' })
  })
})
