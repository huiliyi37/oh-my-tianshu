/**
 * image-attach 自适应压缩 + 头部解析契约测试。
 *
 * - probeImageSize：PNG IHDR / JPEG SOF0 零工具解析；无法解析返回 null
 * - resizeJpegCandidates：darwin/linux/win32 命令形态（sips formatOptions /
 *   magick -quality / PowerShell EncoderParameter）
 * - loadImageAttachment 三级自适应：未超限原样、L1 PNG 保透明 / 非 PNG 转
 *   JPEG 0.82、L2 JPEG 0.55、L3 1024+0.55、全超限抛错、无工具抛错
 * - setImageToolRunner 注入替代真实系统工具（与 setClipboardReader 同款）
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FALLBACK_EDGE,
  FALLBACK_QUALITY,
  JPEG_QUALITY,
  loadImageAttachment,
  probeImageSize,
  setImageToolRunner,
  type ImageToolRunner,
} from '../src/engine/image-attach.js'
import { resizeJpegCandidates } from '../src/engine/image-tool.js'

// 1x1 transparent PNG (valid, complete — 68 bytes)
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const PNG_1X1 = Buffer.from(PNG_B64, 'base64')

/** PNG 签名 + 填充（magic 通过但内容填充；仅用于「超限」判定）。 */
function paddedPng(bytes: number): Buffer {
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(bytes)])
}

/** JPEG 签名 + 填充（magic 通过；用于「超限」判定与 JPEG 源场景）。 */
function paddedJpeg(bytes: number): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(bytes)])
}

/** 构造带 SOF0 头（512×256）的伪 JPEG：probeImageSize 只读头部，无需完整文件。 */
function jpegHeader(): Buffer {
  // FF C0 len=17 precision=8 height=256 width=512 3 components
  return Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x00, 0x02, 0x00, 0x03,
    0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00])
}

let dir = ''

async function withFile(buf: Buffer, name: string): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), 'rivet-attach-spec-'))
  const p = join(dir, name)
  await writeFile(p, buf)
  return p
}

afterEach(async () => {
  setImageToolRunner(null)
  if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {})
})

describe('probeImageSize（头部零工具解析）', () => {
  it('PNG：IHDR 宽高（big-endian）', () => {
    // 签名 + len=13 + 'IHDR' + width=200 + height=100 + 5 字节填充
    const buf = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]),
      Buffer.from([0x00, 0x00, 0x00, 0xc8, 0x00, 0x00, 0x00, 0x64]),
      Buffer.alloc(5),
    ])
    expect(probeImageSize(buf, 'image/png')).toEqual({ width: 200, height: 100 })
  })

  it('PNG：buffer 太短返回 null', () => {
    expect(probeImageSize(Buffer.alloc(10), 'image/png')).toBeNull()
  })

  it('JPEG：SOF0 段宽高', () => {
    expect(probeImageSize(jpegHeader(), 'image/jpeg')).toEqual({ width: 512, height: 256 })
  })

  it('JPEG：SOF 前有 APP0 等段时仍能扫到（跳过 FF E0）', () => {
    // SOI + APP0(len=16) + SOF0
    const app0 = Buffer.concat([Buffer.from([0xff, 0xe0]), Buffer.from([0x00, 0x10]), Buffer.alloc(14)])
    expect(probeImageSize(Buffer.concat([Buffer.from([0xff, 0xd8]), app0, jpegHeader().subarray(2)]), 'image/jpeg'))
      .toEqual({ width: 512, height: 256 })
  })

  it('非 PNG/JPEG 返回 null', () => {
    expect(probeImageSize(PNG_1X1, 'image/webp')).toBeNull()
  })
})

describe('resizeJpegCandidates（命令形态）', () => {
  it('darwin：sips formatOptions + -Z 只缩不放', () => {
    const [first] = resizeJpegCandidates('/in.png', '/out.jpg', 1568, JPEG_QUALITY, 'darwin')
    expect(first).toEqual({
      bin: 'sips',
      args: ['-s', 'format', 'jpeg', '-s', 'formatOptions', '82', '-Z', '1568', '/in.png', '--out', '/out.jpg'],
    })
  })

  it('linux：sips 优先（不存在自然失败）→ magick -quality + > 修饰符 → convert 兜底', () => {
    const list = resizeJpegCandidates('/in.png', '/out.jpg', 1024, FALLBACK_QUALITY, 'linux')
    expect(list[0]?.bin).toBe('sips')
    expect(list[1]).toEqual({ bin: 'magick', args: ['/in.png', '-resize', '1024x1024>', '-quality', '55', 'jpg:/out.jpg'] })
    expect(list[2]?.bin).toBe('convert')
    expect(list[2]?.args).toContain('-quality')
  })

  it('win32：magick + PowerShell EncoderParameter', () => {
    const list = resizeJpegCandidates('C:\\in.png', 'C:\\out.jpg', 1568, FALLBACK_QUALITY, 'win32')
    expect(list[0]?.bin).toBe('magick')
    expect(list[1]?.bin).toBe('powershell')
    const script = list[1]?.args.join(' ')
    expect(script).toContain('EncoderParameter')
    expect(script).toContain('55')
    expect(script).toContain('image/jpeg')
  })
})

describe('loadImageAttachment（未超限）', () => {
  it('小图原样返回：不调 runner、宽带高（头部零成本解析）、dataUrl 保留原格式', async () => {
    const calls: string[][] = []
    setImageToolRunner((async (candidates) => { calls.push(candidates.map(c => c.bin)); return PNG_1X1 }) satisfies ImageToolRunner)
    const p = await withFile(PNG_1X1, 'small.png')
    const attachment = await loadImageAttachment(p)
    expect(calls).toEqual([])
    expect(attachment.mime).toBe('image/png')
    expect(attachment.width).toBe(1)
    expect(attachment.height).toBe(1)
    expect(attachment.name).toBe('small.png')
    expect(attachment.dataUrl.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('非法格式（非图片 magic）抛错', async () => {
    const p = await withFile(Buffer.from('hello world, not an image at all!'), 'fake.png')
    await expect(loadImageAttachment(p)).rejects.toThrow('Unsupported image format')
  })
})

describe('loadImageAttachment（三级自适应压缩）', () => {
  // 集成测试断言 sips 命令形态（darwin 首候选）；命令形态的平台分支由
  // resizeCandidates 单测显式传 platform 覆盖——此处固定 darwin 保证跨平台稳定。
  const origPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!
  beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
  })
  afterEach(() => {
    Object.defineProperty(process, 'platform', { ...origPlatform })
  })

  it('L1：PNG 源保透明——走 resizeCandidates（PNG 输出），返回 1×1 宽高', async () => {
    const calls: Array<{ bin: string; args: string[] }> = []
    setImageToolRunner((async (candidates) => {
      calls.push(candidates[0]!)
      return PNG_1X1
    }) satisfies ImageToolRunner)
    const p = await withFile(paddedPng(200), 'big.png')
    const attachment = await loadImageAttachment(p, { maxBytes: 100 })
    // L1 命中：resizeCandidates 首候选 sips -Z 1568，输出 out.png；
    // -s format png 显式指定输出格式（不靠 out 路径扩展名猜，移植 dsh-tui ba45980）
    expect(calls.length).toBe(1)
    expect(calls[0]?.bin).toBe('sips')
    expect(calls[0]?.args).toContain('-Z')
    expect(calls[0]?.args).toContain('1568')
    expect(calls[0]?.args[0]).toBe('-Z')
    expect(calls[0]?.args).toEqual(expect.arrayContaining(['-s', 'format', 'png']))
    expect(attachment.mime).toBe('image/png')
    expect(attachment.width).toBe(1)
    expect(attachment.height).toBe(1)
  })

  it('L1：非 PNG 源转 JPEG 0.82——走 resizeJpegCandidates，宽高来自 SOF', async () => {
    const calls: Array<{ bin: string; args: string[] }> = []
    setImageToolRunner((async (candidates) => {
      calls.push(candidates[0]!)
      return jpegHeader()
    }) satisfies ImageToolRunner)
    const p = await withFile(paddedJpeg(200), 'big.jpg')
    const attachment = await loadImageAttachment(p, { maxBytes: 100 })
    expect(calls.length).toBe(1)
    expect(calls[0]?.bin).toBe('sips')
    expect(calls[0]?.args).toContain('jpeg')
    expect(calls[0]?.args).toContain(String(JPEG_QUALITY))
    expect(attachment.mime).toBe('image/jpeg')
    expect(attachment.width).toBe(512)
    expect(attachment.height).toBe(256)
  })

  it('L2：L1 输出仍超限 → JPEG 0.55 同分辨率', async () => {
    const calls: Array<{ args: string[] }> = []
    setImageToolRunner((async (candidates) => {
      calls.push({ args: candidates[0]!.args })
      // 第一次（L1）返回仍超限的 200B；第二次（L2）命中预算
      return calls.length === 1 ? Buffer.alloc(200) : PNG_1X1
    }) satisfies ImageToolRunner)
    const p = await withFile(paddedPng(200), 'big.png')
    const attachment = await loadImageAttachment(p, { maxBytes: 100 })
    expect(calls.length).toBe(2)
    // L2 是 JPEG 档：质量 55、分辨率仍 1568
    expect(calls[1]?.args).toContain(String(FALLBACK_QUALITY))
    expect(calls[1]?.args).toContain('1568')
    expect(attachment.mime).toBe('image/jpeg')
  })

  it('L3：L1/L2 均超限 → 1024 长边 + 0.55', async () => {
    const calls: Array<{ args: string[] }> = []
    setImageToolRunner((async (candidates) => {
      calls.push({ args: candidates[0]!.args })
      return calls.length < 3 ? Buffer.alloc(200) : PNG_1X1
    }) satisfies ImageToolRunner)
    const p = await withFile(paddedPng(200), 'big.png')
    const attachment = await loadImageAttachment(p, { maxBytes: 100 })
    expect(calls.length).toBe(3)
    expect(calls[2]?.args).toContain(String(FALLBACK_QUALITY))
    expect(calls[2]?.args).toContain(String(FALLBACK_EDGE))
    expect(attachment.mime).toBe('image/jpeg')
  })

  it('三级全超限 → 抛「压缩后仍超过上限」', async () => {
    setImageToolRunner((async () => Buffer.alloc(300)) satisfies ImageToolRunner)
    const p = await withFile(paddedPng(200), 'big.png')
    await expect(loadImageAttachment(p, { maxBytes: 100 })).rejects.toThrow('仍超过上限')
  })

  it('无可用图像工具（runner 返回 null）→ 抛「Install an image tool」', async () => {
    setImageToolRunner((async () => null) satisfies ImageToolRunner)
    const p = await withFile(paddedPng(200), 'big.png')
    await expect(loadImageAttachment(p, { maxBytes: 100 })).rejects.toThrow('Install an image tool')
  })
})
