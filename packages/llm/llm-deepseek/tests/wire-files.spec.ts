/**
 * wire-files — 序列化后置 Files 置换的集成规格。
 *
 * 覆盖：可上传媒体类型的 dataUrl 置换为 `{type:'file'}`、minInlineBytes 门槛、
 * 非 dataUrl 引用跳过、上传失败保留 inline 的回退语义、跨 store 实例的持久
 * 索引去重、升级信号取消传播。fetch 以假传输层注入，索引落独立临时目录。
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DeepSeekFileStore } from '../src/file-store.ts'
import { DeepSeekUploadIndex } from '../src/upload-index.ts'
import { upgradeWireImages } from '../src/wire-files.ts'
import type { WireRequest } from '../src/types.ts'

const PNG_1X1 = Uint8Array.from(atob(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
))
const PNG_URL = `data:image/png;base64,${Buffer.from(PNG_1X1).toString('base64')}`

function requestWithImage(url: string): WireRequest {
  return {
    model: 'deepseek-vision',
    stream: true,
    stream_options: { include_usage: true },
    messages: [
      { role: 'system', content: 'sys' },
      { role: 'user', content: [{ type: 'text', text: '看图' }, { type: 'image_url', image_url: { url } }] },
    ],
  } as unknown as WireRequest
}

const PART_ERRORS: unknown[] = []
function collect(error: unknown): void {
  PART_ERRORS.push(error)
}

/** 独立临时目录 + 假传输层的组合；uploads 记录命中 URL。 */
function compose(dir: string, opts: { fail?: boolean } = {}): { upgrade: Parameters<typeof upgradeWireImages>[1]; uploads: string[] } {
  const uploads: string[] = []
  const store = new DeepSeekFileStore({
    index: new DeepSeekUploadIndex(join(dir, 'files-v3.json')),
    now: () => 1_700_000_000_000,
    fetch: (async (input: RequestInfo | URL): Promise<Response> => {
      uploads.push(String(input instanceof Request ? input.url : input))
      const json = opts.fail === true
        ? '{}'
        : JSON.stringify({
          id: 'file-x',
          object: 'file',
          bytes: PNG_1X1.byteLength,
          created_at: 1_700_000_000,
          filename: 'image.png',
          purpose: 'user_data',
          expires_at: 1_700_060_400,
        })
      // 最小 Response 桩：客户端只消费 ok/json。
      return {
        ok: opts.fail !== true,
        status: opts.fail === true ? 500 : 200,
        json: async (): Promise<unknown> => JSON.parse(json),
      } as Response
    }),
  })
  return {
    upgrade: {
      store,
      policy: { expiresAfterSeconds: 3_600, refreshMarginSeconds: 60, quotaCleanupBatch: 10 },
      minInlineBytes: 10,
      onPartError: collect,
    },
    uploads,
  }
}

describe('upgradeWireImages', () => {
  it('把内联图片置换为 file 引用，bytes 不再随请求上行', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wire-files-'))
    const { upgrade, uploads } = compose(dir)
    const req = requestWithImage(PNG_URL)
    await upgradeWireImages(req, upgrade, { baseURL: 'https://api.deepseek.com', apiKey: 'k' })
    expect(PART_ERRORS).toEqual([])
    expect(uploads.filter(u => u.endsWith('/files'))).toHaveLength(1)
    const user = req.messages[1] as { content: Array<{ type: string; file_id?: string }> }
    expect(user.content[1]?.type).toBe('file')
    expect(user.content[1]?.file_id).toBe('file-x')
  })

  it('同一 store 的并发/先后同字节请求只上传一次（inflight+索引去重）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wire-files-'))
    const { upgrade, uploads } = compose(dir)
    const reqA = requestWithImage(PNG_URL)
    const reqB = requestWithImage(PNG_URL)
    await Promise.all([
      upgradeWireImages(reqA, upgrade, { baseURL: 'https://api.deepseek.com', apiKey: 'k' }),
      upgradeWireImages(reqB, upgrade, { baseURL: 'https://api.deepseek.com', apiKey: 'k' }),
    ])
    expect(uploads.filter(u => u.endsWith('/files'))).toHaveLength(1)
    const userA = reqA.messages[1] as { content: Array<{ type: string; file_id?: string }> }
    const userB = reqB.messages[1] as { content: Array<{ type: string; file_id?: string }> }
    expect(userA.content[1]?.file_id).toBe('file-x')
    expect(userB.content[1]?.file_id).toBe('file-x') // 第二次直接命中持久索引
  })

  it('低于 minInlineBytes 的 part 保持 inline', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wire-files-'))
    const tiny = `data:image/png;base64,${PNG_URL.slice('data:image/png;base64,'.length).slice(0, 8)}`
    const { upgrade, uploads } = compose(dir)
    const req = requestWithImage(tiny)
    await upgradeWireImages(req, { ...upgrade, minInlineBytes: 100_000 },
      { baseURL: 'https://api.deepseek.com', apiKey: 'k' })
    const user = req.messages[1] as { content: Array<{ type: string }> }
    expect(user.content[1]?.type).toBe('image_url')
    expect(uploads).toEqual([])
  })

  it('非 data URL 的 https 图片引用原样跳过', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wire-files-'))
    const { upgrade, uploads } = compose(dir)
    const req = requestWithImage('https://cdn.example.com/cat.png')
    await upgradeWireImages(req, { ...upgrade, minInlineBytes: 0 },
      { baseURL: 'https://api.deepseek.com', apiKey: 'k' })
    const user = req.messages[1] as { content: Array<{ type: string }> }
    expect(user.content[1]?.type).toBe('image_url')
    expect(uploads).toEqual([])
  })

  it('上传失败保留 inline 并上报 onPartError（回退语义）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wire-files-'))
    PART_ERRORS.length = 0
    const { upgrade } = compose(dir, { fail: true })
    const req = requestWithImage(PNG_URL)
    await upgradeWireImages(req, upgrade, { baseURL: 'https://api.deepseek.com', apiKey: 'k' })
    const user = req.messages[1] as { content: Array<{ type: string }> }
    expect(user.content[1]?.type).toBe('image_url')
    expect(PART_ERRORS.length).toBeGreaterThan(0)
  })

  it('signal 取消立即中断升级', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wire-files-'))
    const { upgrade } = compose(dir)
    const controller = new AbortController()
    controller.abort()
    await expect(upgradeWireImages(requestWithImage(PNG_URL), upgrade,
      { baseURL: 'https://api.deepseek.com', apiKey: 'k' }, controller.signal)).rejects.toThrow()
  })
})
