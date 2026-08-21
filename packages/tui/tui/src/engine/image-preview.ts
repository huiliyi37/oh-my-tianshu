/**
 * 半块字符图片预览 — 把 data URL 图片降采样为 `▀`（上色前景 + 下色背景）
 * 的真彩 ANSI 文本行。任意终端可用：不依赖 kitty/iTerm2 图形协议，是纯文本，
 * 因此 live 区重绘天然擦除（无图形协议的残影治理问题），也是无协议终端上
 * 用户气泡图片的回退渲染路径（见 app.commitUserPrompt）。
 *
 * 像素解码走 sharp（懒加载）：原生模块缺失或解码失败返回 null，调用方降级
 * 为纯文本占位——预览是装饰性能力，不构成发送路径的前置条件。
 */

import { ambiguousWideEnabled } from '../width.js'
import { parseImageDataUrl } from './term-image.js'

/** 字符 cell 高宽比（≈2，与 term-image 同一估计）。 */
const CELL_ASPECT = 2

/** composer 缩略图宽度上限（列）；实际取 min(本值, 终端宽-6)。 */
export const PREVIEW_MAX_COLS = 30

/** composer 缩略图高度上限（字符行）。 */
export const PREVIEW_MAX_ROWS = 10

/** 无协议终端气泡回退的高度上限（字符行）——每行都是真实 scrollback 行，收紧。 */
export const FALLBACK_MAX_ROWS = 16

/** 主题未给气泡底色时的透明像素合成底色（中性暗色，明暗终端都可读）。 */
export const NEUTRAL_PREVIEW_BACKGROUND: { r: number; g: number; b: number } = { r: 20, g: 20, b: 26 }

/**
 * `#rrggbb` → RGB；用于把主题 truecolor 底色喂给预览合成。
 * @param hex - 六位十六进制颜色字符串（带 # 前缀）
 * @returns RGB 分量；格式不符返回 null
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex)
  if (!m || m[1] === undefined) return null
  const n = Number.parseInt(m[1], 16)
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff }
}

/**
 * `▀` 是 East Asian Width Ambiguous：宽模式终端里占 2 格且我们的 displayWidth
 * 计 2 格。预算列数折半，使预览的显示宽度与行数计量在两种模式下都成立。
 */
function gridCols(maxCols: number): number {
  return Math.max(1, Math.floor(maxCols / (ambiguousWideEnabled() ? 2 : 1)))
}

/** 已渲染的半块预览。 */
export interface HalfBlockPreview {
  /** ANSI 真彩文本行（每行以 reset 结尾，无换行符）。 */
  lines: string[]
  /** 网格列数（▀ 字符数/行）。 */
  cols: number
  /** 网格行数（lines.length）。 */
  rows: number
}

/**
 * data URL → 半块字符预览。网格按图片宽高比适配进 maxCols×maxRows 超框
 * （cell 按 2:1 估计），正常情况不裁切；极端纵横比被上限截断时按剩余高度
 * 反推列数（fit 语义，cover 兜底取整误差）。
 * @param dataUrl - 图片 data URL（经 parseImageDataUrl 同规则校验）
 * @param opts - maxCols/maxRows 网格上限；background 透明像素合成底色（RGB）
 * @returns 渲染结果；校验失败、sharp 不可用或解码失败返回 null
 */
export async function renderHalfBlockPreview(
  dataUrl: string,
  opts: { maxCols: number; maxRows: number; background: { r: number; g: number; b: number } },
): Promise<HalfBlockPreview | null> {
  const parsed = parseImageDataUrl(dataUrl)
  if (!parsed) return null
  let sharp: typeof import('sharp').default
  try {
    ({ default: sharp } = await import('sharp'))
  } catch {
    return null
  }
  try {
    const input = sharp(Buffer.from(parsed.b64, 'base64'), { failOn: 'none' })
    const meta = await input.metadata()
    const width = meta.width
    const height = meta.height
    if (width <= 0 || height <= 0) return null
    const cols = gridCols(Math.max(1, Math.min(opts.maxCols, Math.max(width, 8))))
    // 宽高比适配：超框行数超限时按上限行数反推列数，整图可见优先于占满宽度
    // （极端竖图得到窄条而非 cover 裁切——不藏内容）。
    let rows = Math.max(1, Math.round((cols * height) / (width * CELL_ASPECT)))
    let fitCols = cols
    if (rows > opts.maxRows) {
      rows = opts.maxRows
      fitCols = Math.max(1, Math.round((rows * CELL_ASPECT * width) / height))
    }
    const pixels = await input
      // nearest：截图类图片的硬边缘不糊（抗锯齿会把文字边缘染成中间色），
      // 也让小网格的颜色语义与源像素一一对应。
      .resize(fitCols, rows * CELL_ASPECT, { fit: 'cover', kernel: 'nearest' })
      .flatten({ background: opts.background })
      .removeAlpha()
      .raw()
      .toBuffer()
    return { lines: halfBlockLines(pixels, fitCols, rows), cols: fitCols, rows }
  } catch {
    return null
  }
}

/**
 * RGB 原始像素 → 半块行。每行游程合并同色段（纯色截图的字节数量级下降）。
 * @param pixels - RGB 三通道行优先缓冲（cols×rows×2 像素）
 * @param cols - 网格列数
 * @param rows - 网格行数（每行上下两个像素行）
 * @returns ANSI 文本行数组
 */
function halfBlockLines(pixels: Buffer, cols: number, rows: number): string[] {
  const lines: string[] = []
  for (let y = 0; y < rows; y++) {
    let line = ''
    let runFg = -1
    let runBg = -1
    let runLen = 0
    for (let x = 0; x < cols; x++) {
      const top = (y * 2 * cols + x) * 3
      const bottom = ((y * 2 + 1) * cols + x) * 3
      const fg = (pixels.readUInt8(top) << 16) | (pixels.readUInt8(top + 1) << 8) | pixels.readUInt8(top + 2)
      const bg = (pixels.readUInt8(bottom) << 16) | (pixels.readUInt8(bottom + 1) << 8) | pixels.readUInt8(bottom + 2)
      if (fg === runFg && bg === runBg) {
        runLen += 1
        continue
      }
      line = appendRun(line, runFg, runBg, runLen)
      runFg = fg
      runBg = bg
      runLen = 1
    }
    line = appendRun(line, runFg, runBg, runLen)
    lines.push(line + '\x1B[0m')
  }
  return lines
}

/** 追加一段同色 ▀ 游程（首个游程 runLen=0 时原样返回）。 */
function appendRun(line: string, fg: number, bg: number, runLen: number): string {
  if (runLen === 0) return line
  const fgR = (fg >> 16) & 0xff
  const fgG = (fg >> 8) & 0xff
  const fgB = fg & 0xff
  const bgR = (bg >> 16) & 0xff
  const bgG = (bg >> 8) & 0xff
  const bgB = bg & 0xff
  return line + `\x1B[38;2;${fgR};${fgG};${fgB}m\x1B[48;2;${bgR};${bgG};${bgB}m` + '▀'.repeat(runLen)
}
