/**
 * vision-bridge 纯函数与描述生成测试：prompt 模式选择、图片→描述调用契约、
 * 失败/截断降级。
 * @module dsh-vision-bridge/tests/vision-service
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import LlmService from '@huiliyi37/dsh-llm'
import { LlmAdapter } from '@huiliyi37/dsh-llm'
import type { GenerateOptions, StreamChunk, LlmModelInfo } from '@huiliyi37/dsh-llm'
import { describeImages, selectVisionPrompt, apply, Config } from '../src/index.ts'

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const IMG = `data:image/png;base64,${PNG_B64}`

describe('selectVisionPrompt（模式选择）', () => {
  it('显式配置的 prompt 永远优先', () => {
    expect(selectVisionPrompt('自定义 prompt', '报错：foo')).toBe('自定义 prompt')
    expect(selectVisionPrompt('   ', '报错：foo')).not.toBe('   ') // 空白视为未给
  })

  it('无配置 + UI/报错关键词 → 精确转写模式', () => {
    const prompt = selectVisionPrompt(undefined, '这个报错怎么回事')
    expect(prompt).toContain('逐字转写')
    expect(prompt).toContain('OCR')
  })

  it('无配置 + 普通文本 → 通用结构化模式', () => {
    const prompt = selectVisionPrompt(undefined, '看看这张风景照')
    expect(prompt).toContain('## 文字内容')
    expect(prompt).not.toContain('OCR')
  })

  it('无配置 + 无随图文本 → 通用模式', () => {
    expect(selectVisionPrompt(undefined, '')).toContain('## 文字内容')
  })
})

describe('Config（provider/model 显式 或 visionAutoBridge）', () => {
  it('schema 层 provider/model 可选，apply 层 fail-loud', () => {
    // schema 不再强制 provider/model
    const resolved = Config({})
    expect(resolved).toMatchObject({ enabled: true, visionAutoBridge: false })
    // 缺显式路由且未开自动桥 → apply 装配抛错
    expect(() => apply(new Context(), { enabled: true })).toThrow(/未配置视觉模型/)
    expect(() => apply(new Context(), { enabled: true, provider: 'p', model: 'm' })).not.toThrow()
    expect(() => apply(new Context(), { enabled: true, visionAutoBridge: true })).not.toThrow()
  })

  it('provider/model 齐全 → 通过并补缺省', () => {
    const resolved = Config({ provider: 'deepseek-official', model: 'deepseek-vl' })
    expect(resolved).toMatchObject({ provider: 'deepseek-official', model: 'deepseek-vl', enabled: true })
  })

  it('fallback 可选；给出时 provider/model 必填', () => {
    const none = Config({ provider: 'deepseek-official', model: 'deepseek-vl' })
    expect(none.fallback).toBeUndefined()
    const full = Config({ provider: 'deepseek-official', model: 'deepseek-vl', fallback: { provider: 'x', model: 'y' } })
    expect(full.fallback).toEqual({ provider: 'x', model: 'y' })
    expect(() => Config({ provider: 'deepseek-official', model: 'deepseek-vl', fallback: { provider: 'x' } } as never)).toThrow()
  })
})

/** 预置 chunk 流的假视觉 adapter：记录请求、按场景返回固定流。 */
class FakeVisionAdapter extends LlmAdapter {
  requests: GenerateOptions[] = []
  private scene: 'ok' | 'error' | 'max-tokens' | 'empty'

  constructor(scene: 'ok' | 'error' | 'max-tokens' | 'empty' = 'ok') {
    super()
    this.scene = scene
  }

  override stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const scene = this.scene
    return (async function* () {
      if (scene === 'error') {
        yield { type: 'finish', reason: { kind: 'error', failure: { message: 'vision boom', code: 'VISION_ERR' } } }
        return
      }
      if (scene === 'empty') {
        // 视觉模型返回空输出（无 text block）
        yield { type: 'finish', reason: { kind: 'stop' } }
        return
      }
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: '截图显示：' }
      yield { type: 'text-delta', index: 0, text: 'Error: foo' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: '截图显示：Error: foo' } }
      if (scene === 'max-tokens') {
        yield { type: 'finish', reason: { kind: 'max-tokens' } }
      } else {
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    })()
  }
}

async function mount(scene: 'ok' | 'error' | 'max-tokens' | 'empty' = 'ok') {
  const ctx = new Context()
  await ctx.plugin(LlmService)
  const adapter = new FakeVisionAdapter(scene)
  ctx.llm.registerAdapter(['fake-vision'], adapter)
  return { ctx, adapter }
}

const CONFIG = { provider: 'fake-vision', model: 'vision-m', maxTokens: 256 }

describe('describeImages（桥接描述生成）', () => {
  it('图片 + 随图文本 → 视觉模型描述文本（请求携带 image block 与 purpose）', async () => {
    const { ctx, adapter } = await mount('ok')
    const description = await describeImages(ctx, CONFIG, [IMG], '这个报错怎么回事')
    expect(description).toBe('截图显示：Error: foo')
    const request = adapter.requests[0]
    expect(request?.provider).toBe('fake-vision')
    expect(request?.model).toBe('vision-m')
    expect(request?.purpose).toBe('vision-description')
    const content = request?.messages[0]?.content ?? []
    expect(content[0]).toMatchObject({ type: 'text' })
    expect(content[1]).toMatchObject({ type: 'image', dataUrl: IMG })
  })

  it('空图片列表 → 直接返回空串，不发模型调用', async () => {
    const { ctx, adapter } = await mount('ok')
    expect(await describeImages(ctx, CONFIG, [], '')).toBe('')
    expect(adapter.requests).toHaveLength(0)
  })

  it('视觉模型 error finish → 抛 LlmError（调用方降级）', async () => {
    const { ctx } = await mount('error')
    await expect(describeImages(ctx, CONFIG, [IMG], 'hi')).rejects.toThrow('vision boom')
  })

  it('max-tokens finish → 文本追加截断标记', async () => {
    const { ctx } = await mount('max-tokens')
    const description = await describeImages(ctx, CONFIG, [IMG], 'hi')
    expect(description).toContain('[图片描述被截断]')
  })

  it('非法 data URL（非 data: 前缀）→ 发起模型调用前抛错', async () => {
    const { ctx, adapter } = await mount('ok')
    await expect(describeImages(ctx, CONFIG, ['https://example.com/x.png'], 'hi')).rejects.toThrow('不是 data URL')
    expect(adapter.requests).toHaveLength(0)
  })

  it('不支持图片格式 → 发起模型调用前抛错', async () => {
    const { ctx, adapter } = await mount('ok')
    await expect(describeImages(ctx, CONFIG, ['data:text/plain;base64,aGVsbG8='], 'hi')).rejects.toThrow('图片格式不受视觉模型支持')
    expect(adapter.requests).toHaveLength(0)
  })

  it('载荷异常短 → 发起模型调用前抛错', async () => {
    const { ctx, adapter } = await mount('ok')
    await expect(describeImages(ctx, CONFIG, ['data:image/png;base64,AAAA'], 'hi')).rejects.toThrow('异常短')
    expect(adapter.requests).toHaveLength(0)
  })

  it('主视觉模型 error → fallback 兜底成功（只多调一次）', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmService)
    const primary = new FakeVisionAdapter('error')
    const fallback = new FakeVisionAdapter('ok')
    ctx.llm.registerAdapter(['fake-vision'], primary)
    ctx.llm.registerAdapter(['fake-vision-fallback'], fallback)
    const description = await describeImages(
      ctx,
      { ...CONFIG, fallback: { provider: 'fake-vision-fallback', model: 'vision-m' } },
      [IMG],
      'hi',
    )
    expect(description).toBe('截图显示：Error: foo')
    expect(primary.requests).toHaveLength(1)
    expect(fallback.requests).toHaveLength(1)
  })

  it('主视觉模型 error → fallback 也 error → 抛 fallback 的错误', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmService)
    const primary = new FakeVisionAdapter('error')
    const fallback = new FakeVisionAdapter('error')
    ctx.llm.registerAdapter(['fake-vision'], primary)
    ctx.llm.registerAdapter(['fake-vision-fallback'], fallback)
    await expect(describeImages(
      ctx,
      { ...CONFIG, fallback: { provider: 'fake-vision-fallback', model: 'vision-m' } },
      [IMG],
      'hi',
    )).rejects.toThrow('vision boom')
    expect(primary.requests).toHaveLength(1)
    expect(fallback.requests).toHaveLength(1)
  })

  it('visionAutoBridge：自动选第一个 supportsVision 模型', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmService)
    const adapter = new class extends FakeVisionAdapter {
      override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
        return Promise.resolve([{ provider, id: 'auto-vl', name: 'Auto VL', supportsVision: true }])
      }
    }('ok')
    ctx.llm.registerAdapter(['fake-vision'], adapter)
    const description = await describeImages(ctx, { visionAutoBridge: true, maxTokens: 256 }, [IMG], 'hi')
    expect(description).toBe('截图显示：Error: foo')
    expect(adapter.requests[0]?.provider).toBe('fake-vision')
    expect(adapter.requests[0]?.model).toBe('auto-vl')
  })

  it('visionAutoBridge 但无识图模型 → 抛 NO_ADAPTER，且不发模型调用', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmService)
    const adapter = new class extends FakeVisionAdapter {
      override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
        return Promise.resolve([{ provider, id: 'text-only', name: 'Text Only' }])
      }
    }('ok')
    ctx.llm.registerAdapter(['fake-vision'], adapter)
    await expect(describeImages(ctx, { visionAutoBridge: true, maxTokens: 256 }, [IMG], 'hi'))
      .rejects.toMatchObject({ code: 'NO_ADAPTER' })
    expect(adapter.requests).toHaveLength(0)
  })
})
