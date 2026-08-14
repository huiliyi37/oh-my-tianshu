/**
 * TUI image attachment loader — turns an on-disk image path into a base64 data URL
 * suitable for the vision model pipeline.
 *
 * Terminals can only bracketed-paste text, so users paste an image file path; this
 * module reads the file, validates the format, and adaptively compresses it so the
 * payload stays under the server cap while the resolution stays as high as possible.
 *
 * 自适应压缩（对齐 opencode-tui desktop 的 compressImageSafe 语义，Node 侧以系统
 * 工具实现）：只在超限时压缩；压缩是三级渐进，每级从原图重新编码（不链式再压，
 * 避免累积失真）：
 *   1. 长边 ≤ maxEdge（默认 1568）：PNG 源保透明输出 PNG，其余格式转 JPEG 0.82
 *      （同时完成 provider 白名单转码，BMP/TIFF 等不再原样外发）；
 *   2. 仍超限 → JPEG 0.55 同分辨率；
 *   3. 仍超限 → 长边 ≤ 1024 + JPEG 0.55。
 * 所有档位只缩不放（sips -Z / magick `>` 语义），小图原样发送。
 * 压缩成功后可零工具解析出实际宽高（PNG IHDR / JPEG SOF），供气泡展示。
 */

import { readFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import {
  makeImageTempDir,
  removeImageTempDir,
  resizeCandidates,
  resizeJpegCandidates,
  runImageTool,
  type ImageToolCommand,
} from './image-tool.js'

/** Provider cap: 10 MB decoded per image (matches common vision API limits). */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
/** Long-edge clamp. 1568px keeps token cost bounded while staying legible. */
export const MAX_EDGE = 1568
/** Max number of images per prompt (matches desktop Composer). */
export const MAX_IMAGES = 4
/** JPEG quality for the first compression tier. */
export const JPEG_QUALITY = 82
/** Fallback JPEG quality when the first tier's output still exceeds the cap. */
export const FALLBACK_QUALITY = 55
/** Fallback long edge when quality reduction alone is not enough. */
export const FALLBACK_EDGE = 1024

const IMAGE_MIMES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',
  '.bmp': 'image/bmp',
}

/** 已加载图片附件：data URL + MIME + 文件名，供 vision 消息管线消费。 */
export interface ImageAttachment {
  /** data:image/...;base64,... */
  dataUrl: string
  mime: string
  name: string
  /** 发送图的实际宽（压缩路径解析自输出头部）；原样发送（未压缩）时为 undefined。 */
  width?: number
  /** 发送图的实际高（压缩路径解析自输出头部）；原样发送（未压缩）时为 undefined。 */
  height?: number
}

/** loadImageAttachment 的上限覆盖（缺省用 MAX_IMAGE_BYTES / MAX_EDGE）。 */
export interface LoadImageOptions {
  maxBytes?: number
  maxEdge?: number
}

// ── Image tool runner injection (for testing) ──

/** 图像工具执行器契约（测试注入与真实实现共用）。 */
export interface ImageToolRunner {
  /** 依序尝试候选命令，返回首个产出内容；全部失败返回 null。 */
  (candidates: ImageToolCommand[], outputPath: string): Promise<Buffer | null>
}

let _runner: ImageToolRunner | null = null

/**
 * 注入/清除测试 runner。
 * @param runner - 替身执行器；传 null 恢复真实 runImageTool。
 */
export function setImageToolRunner(runner: ImageToolRunner | null): void {
  _runner = runner
}

/** 执行候选命令链：测试注入优先，否则走真实系统工具。 */
function runCandidates(candidates: ImageToolCommand[], outputPath: string): Promise<Buffer | null> {
  return _runner ? _runner(candidates, outputPath) : runImageTool(candidates, outputPath)
}

// ── 头部解析（零工具调用）──────────────────────────────────

/**
 * 从图片头部解析宽高（零工具调用）：PNG 读 IHDR（偏移 16/20，big-endian），
 * JPEG 扫描 SOF0/1/2 段标记（排除 DHT/DAC/JPG 干扰标记）。解析失败返回 null
 * （不阻塞发送——宽高只是展示信息）。
 * @param buf - 图片内容（至少包含头部）
 * @param mime - 图片 MIME（决定解析分支）
 * @returns 宽高；无法解析返回 null
 */
export function probeImageSize(buf: Buffer, mime: string): { width: number; height: number } | null {
  if (mime === 'image/png') {
    // 签名 8B + IHDR chunk 头 8B（len + type）→ 宽高在 16/20 偏移
    if (buf.length < 24) return null
    const width = buf.readUInt32BE(16)
    const height = buf.readUInt32BE(20)
    if (width === 0 || height === 0) return null
    return { width, height }
  }
  if (mime === 'image/jpeg') {
    // 标记段扫描：FF xx len(2) …；SOF0-CF 段内 precision(1) height(2) width(2)。
    // 排除 C4 (DHT) / C8 (JPG) / CC (DAC)——它们是同类号但非 SOF 段。
    let i = 2
    while (i + 8 < buf.length) {
      if (buf[i] !== 0xff) {
        i += 1
        continue
      }
      const marker = buf[i + 1]
      if (marker === undefined) return null
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || marker === 0xff) {
        i += 2
        continue
      }
      const len = buf.readUInt16BE(i + 2)
      if (len < 2 || i + 2 + len > buf.length) return null
      const isSof = marker >= 0xc0 && marker <= 0xcf
        && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
      if (isSof) {
        if (len < 8) return null
        const height = buf.readUInt16BE(i + 5)
        const width = buf.readUInt16BE(i + 7)
        if (width === 0 || height === 0) return null
        return { width, height }
      }
      i += 2 + len
    }
    return null
  }
  return null
}

// ── 压缩执行 ───────────────────────────────────────────────

/** 按 keepPng/maxEdge/quality 生成候选并执行，返回首个产出；工具全部失败返回 null。 */
async function tryCompress(
  inPath: string,
  dir: string,
  keepPng: boolean,
  maxEdge: number,
  quality: number,
): Promise<Buffer | null> {
  const outPath = join(dir, keepPng ? 'out.png' : 'out.jpg')
  const candidates = keepPng
    ? resizeCandidates(inPath, outPath, maxEdge)
    : resizeJpegCandidates(inPath, outPath, maxEdge, quality)
  return runCandidates(candidates, outPath)
}

/**
 * 三级自适应压缩，直到字节 ≤ maxBytes。每级从原图重编码。
 * @returns 命中预算的输出与格式；无可用图像工具（候选全部失败）返回 null。
 * @throws 有工具但三级全部超限——错误带最后一级的实际大小。
 */
async function compressToBudget(
  absolutePath: string,
  dir: string,
  maxEdge: number,
  maxBytes: number,
  sourceMime: string,
): Promise<{ buf: Buffer; mime: string } | null> {
  const attempts: Array<{ keepPng: boolean; edge: number; quality: number }> = [
    // L1：PNG 保透明（无损格式无质量档），其余转 JPEG 0.82。
    { keepPng: sourceMime === 'image/png', edge: maxEdge, quality: JPEG_QUALITY },
    // L2：JPEG 0.55 降质，同分辨率。
    { keepPng: false, edge: maxEdge, quality: FALLBACK_QUALITY },
    // L3：再降分辨率到 FALLBACK_EDGE + 0.55。
    { keepPng: false, edge: Math.min(maxEdge, FALLBACK_EDGE), quality: FALLBACK_QUALITY },
  ]
  let last: Buffer | null = null
  for (const attempt of attempts) {
    const out = await tryCompress(absolutePath, dir, attempt.keepPng, attempt.edge, attempt.quality)
    if (out === null) {
      // 任一档工具失败（未安装/转码失败）：后续档同样无工具可用，归为「无法压缩」。
      return null
    }
    last = out
    if (out.length <= maxBytes) {
      return { buf: out, mime: attempt.keepPng ? 'image/png' : 'image/jpeg' }
    }
  }
  const mb = ((last?.length ?? 0) / (1024 * 1024)).toFixed(1)
  throw new Error(`图片压缩后仍超过上限（${mb} MB），请改用更小的源图`)
}

/**
 * 仅按 magic bytes 识别 MIME；不识别即返回 null。
 * 不做扩展名 fallback——真实图片（png/jpeg/webp/gif/tiff/bmp）都有可靠 magic，
 * 任意内容改名 .png 不应进入转码流程。保留 filePath 参数仅为兼容既有调用签名。
 * @param buf - 文件内容（至少前 12 字节参与识别）
 * @param _filePath - 未使用；仅为兼容既有调用签名保留
 * @returns 识别出的 MIME；无法识别返回 null
 */
export function detectImageMime(buf: Buffer, _filePath: string): string | null {
  if (buf.length >= 8) {
    // PNG: 89 50 4E 47
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) {
      return 'image/png'
    }
    // JPEG: FF D8 FF
    if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) {
      return 'image/jpeg'
    }
    // WebP: RIFF....WEBP
    if (
      buf.length >= 12 &&
      buf[0] === 0x52 &&
      buf[1] === 0x49 &&
      buf[2] === 0x46 &&
      buf[3] === 0x46 &&
      buf[8] === 0x57 &&
      buf[9] === 0x45 &&
      buf[10] === 0x42 &&
      buf[11] === 0x50
    ) {
      return 'image/webp'
    }
    // GIF: GIF87a or GIF89a
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
      return 'image/gif'
    }
    // TIFF: II (little-endian) or MM (big-endian) at offset 0, magic 42 at offset 2-3
    if (
      (buf[0] === 0x49 && buf[1] === 0x49 && buf[2] === 0x2A && buf[3] === 0x00) ||
      (buf[0] === 0x4D && buf[1] === 0x4D && buf[2] === 0x00 && buf[3] === 0x2A)
    ) {
      return 'image/tiff'
    }
    // BMP: BM
    if (buf[0] === 0x42 && buf[1] === 0x4D) {
      return 'image/bmp'
    }
  }
  return null
}

/**
 * 按文件扩展名判断文本是否像受支持的图片路径（仅粗筛，真实格式以 magic bytes 为准）。
 * @param text - 待判断的路径文本（首尾空白会被忽略）
 * @returns 扩展名命中受支持图片格式时为 true
 */
export function looksLikeImagePath(text: string): boolean {
  const ext = extname(text.trim()).toLowerCase()
  return ext in IMAGE_MIMES
}

/** 组装附件：data URL + 头部解析宽高（解析失败省略宽高，不阻塞发送）。 */
function toAttachment(buf: Buffer, mime: string, name: string): ImageAttachment {
  const size = probeImageSize(buf, mime)
  return {
    dataUrl: `data:${mime};base64,${buf.toString('base64')}`,
    mime,
    name,
    ...(size === null ? {} : { width: size.width, height: size.height }),
  }
}

/**
 * Load an image from disk and return it as a base64 data URL.
 *
 * - Validates format by magic bytes (no extension fallback).
 * - Rejects unsupported formats.
 * - If the decoded file exceeds maxBytes, adaptively compresses it: 1568px
 *   (PNG keeps transparency) → JPEG 0.55 → 1024px + 0.55, never upscaling.
 * @param absolutePath - 图片文件的绝对路径
 * @param options - maxBytes/maxEdge 上限覆盖
 * @returns 图片附件（data URL + MIME + 文件名 + 压缩后的宽高）；格式不支持抛错
 * @throws 无可用图像工具，或压缩后仍超限（错误信息区分两种原因）
 */
export async function loadImageAttachment(
  absolutePath: string,
  options: LoadImageOptions = {},
): Promise<ImageAttachment> {
  const maxBytes = options.maxBytes ?? MAX_IMAGE_BYTES
  const maxEdge = options.maxEdge ?? MAX_EDGE

  const raw = await readFile(absolutePath)
  const mime = detectImageMime(raw, absolutePath)
  if (!mime) {
    throw new Error(`Unsupported image format: ${absolutePath}`)
  }

  // 未超限：原样发送（不无谓重编码，保留原始质量与格式）。
  if (raw.length <= maxBytes) {
    return toAttachment(raw, mime, basename(absolutePath))
  }

  const dir = await makeImageTempDir()
  try {
    const result = await compressToBudget(absolutePath, dir, maxEdge, maxBytes, mime)
    if (result === null) {
      throw new Error(
        'Image too large and no image tool produced output. '
        + 'Install an image tool (sips on macOS, ImageMagick on Linux/Windows) to compress.',
      )
    }
    return toAttachment(result.buf, result.mime, basename(absolutePath))
  } finally {
    await removeImageTempDir(dir)
  }
}
