/**
 * `read_image` 纯函数面聚焦规格（分叉适配版）。
 *
 * 模块级门禁与呈现逻辑在此单测；完整分发生命周期（attachments 落盘、
 * dataUrl 回路、路由能力拒绝）由 examples/acp-agent 的 image 快照组合
 * 在 A 波后续批次接入后行使。存根实现保持零 I/O、确定性。
 */
import { describe, expect, it } from 'vitest'
import type { Context } from '@huiliyi37/cordis'
import {
  assertImageCapableRoute,
  formatImageReadOutput,
  imageMediaTypeForPath,
  imageRefFromValue,
} from '../src/read-image.ts'

const PNG = 'image/png' as const

function makeCtx(llm?: unknown): Context {
  return { get: (name: string) => (name === 'llm' ? llm : undefined) } as unknown as Context
}

function execWith(route?: { provider: string; model: string }): Parameters<typeof assertImageCapableRoute>[1] {
  return {
    signal: undefined,
    agent: {
      options: {},
      session: { requestHeader: () => (route === undefined ? undefined : { config: route }) },
    },
  } as never
}

describe('imageMediaTypeForPath', () => {
  it('按扩展名映射媒体类型并忽略大小写', () => {
    expect(imageMediaTypeForPath('a.PNG')).toBe('image/png')
    expect(imageMediaTypeForPath('b.jpeg')).toBe('image/jpeg')
    expect(imageMediaTypeForPath('c.webp')).toBe('image/webp')
    expect(imageMediaTypeForPath('d.gif')).toBe('image/gif')
  })
  it('非图片扩展返回 undefined', () => {
    expect(imageMediaTypeForPath('e.txt')).toBeUndefined()
    expect(imageMediaTypeForPath('noext')).toBeUndefined()
  })
})

describe('formatImageReadOutput', () => {
  const base = { attachmentId: 'sha256:abc', mediaType: PNG, bytes: 10, width: 2, height: 2 }

  it('原始尺寸读出只描述基本事实', () => {
    const out = formatImageReadOutput('/x/red.png', base)
    expect(out).toContain('<path>/x/red.png</path>')
    expect(out).toContain('image/png image, 2x2 px, 10 bytes')
    expect(out).not.toContain('downscaled')
  })
  it('降缩读出给出双轴一致的坐标倍率', () => {
    const out = formatImageReadOutput('/x/red.png', {
      ...base,
      originalDimensions: { width: 4, height: 4 },
    })
    expect(out).toContain('downscaled from 4x4 px')
    expect(out).toContain('multiply coordinates by 2.00')
  })
  it('两轴倍率不一致时分别提示', () => {
    const out = formatImageReadOutput('/x/red.png', {
      ...base,
      originalDimensions: { width: 8, height: 4 },
    })
    expect(out).toContain('multiply x coordinates by 4.00 and y coordinates by 2.00')
  })
})

describe('assertImageCapableRoute', () => {
  it('requestHeader 缺失时无法解析路由即拒绝', async () => {
    await expect(assertImageCapableRoute(makeCtx(), execWith(undefined), '/x/a.png'))
      .rejects.toThrow(/could not be resolved/)
  })
  it('llm 服务缺席时拒绝且不抛 TypeError', async () => {
    await expect(
      assertImageCapableRoute(makeCtx(undefined), execWith({ provider: 'p', model: 'm' }), '/x/a.png'),
    ).rejects.toThrow(/could not be resolved/)
  })
  it('supportsVision 布尔通过（本仓目录形态）', async () => {
    const ctx = makeCtx({ resolveModelInfo: async () => ({ supportsVision: true }) })
    await expect(assertImageCapableRoute(ctx, execWith({ provider: 'p', model: 'm' }), '/x/a.png')).resolves.toBeUndefined()
  })
  it('inputModalities 数组包含 image 时通过（上游 Files 形态）', async () => {
    const ctx = makeCtx({
      resolveModelInfo: async () => ({ inputModalities: ['text', 'image'] }),
    })
    await expect(assertImageCapableRoute(ctx, execWith({ provider: 'p', model: 'm' }), '/x/a.png')).resolves.toBeUndefined()
  })
  it('两种声明都缺席时从严拒绝', async () => {
    const ctx = makeCtx({ resolveModelInfo: async () => ({}) })
    await expect(
      assertImageCapableRoute(ctx, execWith({ provider: 'p', model: 'text-only' }), '/x/a.png'),
    ).rejects.toThrow(/does not declare image input/)
  })
})

describe('imageRefFromValue', () => {
  it('重建品牌化附件引用并保留可选字段', () => {
    const ref = imageRefFromValue({
      attachmentId: 'sha256:xyz',
      mediaType: PNG,
      bytes: 3,
      width: 1,
      height: 1,
      name: 'n.png',
      originalDimensions: { width: 2, height: 2 },
    })
    expect(ref.attachmentId).toBe('sha256:xyz')
    expect(ref.name).toBe('n.png')
    expect(ref.originalDimensions).toEqual({ width: 2, height: 2 })
  })
})
