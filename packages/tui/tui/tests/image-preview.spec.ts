/**
 * 半块字符图片预览测试（真实 sharp 解码——渲染正确性依赖真实像素管线，
 * mock 掉 sharp 就只剩断言自己的模拟）。
 *
 * 覆盖：双色平图 → 单游程 ANSI 行；宽高比超框 → 按行上限反推列数；
 * 逐列渐变 → 每像素一游程；非法 data URL → null；渲染行宽与 displayWidth
 * 计量一致（live 区行数预算的正确性前提）。
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { displayWidth } from '../src/width.js'
import {
  hexToRgb,
  NEUTRAL_PREVIEW_BACKGROUND,
  renderHalfBlockPreview,
} from '../src/engine/image-preview.js'

/** 上/下两色纯色图（h 为偶数，上半 top、下半 bottom）→ data URL。 */
async function twoToneDataUrl(
  w: number,
  h: number,
  top: [number, number, number],
  bottom: [number, number, number],
): Promise<string> {
  const { default: sharp } = await import('sharp')
  const buf = Buffer.alloc(w * h * 3)
  for (let y = 0; y < h; y++) {
    const c = y < h / 2 ? top : bottom
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3
      buf[i] = c[0]
      buf[i + 1] = c[1]
      buf[i + 2] = c[2]
    }
  }
  const b64 = await sharp(buf, { raw: { width: w, height: h, channels: 3 } })
    .png()
    .toBuffer()
    .then(b => b.toString('base64'))
  return `data:image/png;base64,${b64}`
}

/** 逐列渐变图（列 x 灰度 = x*40）→ data URL。 */
async function columnGradientDataUrl(w: number, h: number): Promise<string> {
  const { default: sharp } = await import('sharp')
  const buf = Buffer.alloc(w * h * 3)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3
      buf[i] = x * 40
      buf[i + 1] = x * 40
      buf[i + 2] = x * 40
    }
  }
  const b64 = await sharp(buf, { raw: { width: w, height: h, channels: 3 } })
    .png()
    .toBuffer()
    .then(b => b.toString('base64'))
  return `data:image/png;base64,${b64}`
}

describe('renderHalfBlockPreview', () => {
  let flat: string
  let gradient: string
  beforeAll(async () => {
    flat = await twoToneDataUrl(4, 2, [255, 0, 0], [0, 0, 255])
    gradient = await columnGradientDataUrl(2, 2)
  })

  it('双色平图 → 单行单游程：上色前景红、下色背景蓝', async () => {
    const preview = await renderHalfBlockPreview(flat, {
      maxCols: 4,
      maxRows: 1,
      background: NEUTRAL_PREVIEW_BACKGROUND,
    })
    expect(preview).not.toBeNull()
    expect(preview?.cols).toBe(4)
    expect(preview?.rows).toBe(1)
    expect(preview?.lines).toEqual(['\x1B[38;2;255;0;0m\x1B[48;2;0;0;255m▀▀▀▀\x1B[0m'])
    // live 区行数计量前提：ANSI 剥离后宽度 = 列数。
    expect(displayWidth(preview!.lines[0]!)).toBe(4)
  })

  it('横向超宽图按行上限反推列数：8×4 图 maxRows=1 → 4 列整图可见', async () => {
    const wide = await twoToneDataUrl(8, 4, [0, 255, 0], [255, 255, 0])
    const preview = await renderHalfBlockPreview(wide, {
      maxCols: 8,
      maxRows: 1,
      background: NEUTRAL_PREVIEW_BACKGROUND,
    })
    expect(preview?.cols).toBe(4)
    expect(preview?.rows).toBe(1)
    expect(preview?.lines[0]).toContain('▀▀▀▀')
  })

  it('逐列渐变 → 每像素一游程（两列两段前景/背景对）', async () => {
    const preview = await renderHalfBlockPreview(gradient, {
      maxCols: 2,
      maxRows: 1,
      background: NEUTRAL_PREVIEW_BACKGROUND,
    })
    // 列 0 灰度 0、列 1 灰度 40：上=下（纯灰列）→ 两段独立 SGR。
    const line = preview?.lines[0] ?? ''
    expect(line).toContain('\x1B[38;2;0;0;0m\x1B[48;2;0;0;0m▀')
    expect(line).toContain('\x1B[38;2;40;40;40m\x1B[48;2;40;40;40m▀')
  })

  it('非法 data URL / 非白名单 MIME → null（预览降级为纯文本占位）', async () => {
    expect(await renderHalfBlockPreview('not-a-data-url', {
      maxCols: 4, maxRows: 1, background: NEUTRAL_PREVIEW_BACKGROUND,
    })).toBeNull()
    expect(await renderHalfBlockPreview('data:image/svg+xml;base64,PHN2Zy8+', {
      maxCols: 4, maxRows: 1, background: NEUTRAL_PREVIEW_BACKGROUND,
    })).toBeNull()
    // 载荷非法 base64：解析层拒绝。
    expect(await renderHalfBlockPreview('data:image/png;base64,!!!!', {
      maxCols: 4, maxRows: 1, background: NEUTRAL_PREVIEW_BACKGROUND,
    })).toBeNull()
  })

  it('损坏载荷（合法 base64、非图片内容）→ 解码失败返回 null', async () => {
    expect(await renderHalfBlockPreview('data:image/png;base64,AAAA', {
      maxCols: 4, maxRows: 1, background: NEUTRAL_PREVIEW_BACKGROUND,
    })).toBeNull()
  })
})

describe('hexToRgb', () => {
  it('六位 hex → RGB；格式不符返回 null', () => {
    expect(hexToRgb('#0f14ff')).toEqual({ r: 15, g: 20, b: 255 })
    expect(hexToRgb('#ABCDEF')).toEqual({ r: 171, g: 205, b: 239 })
    expect(hexToRgb('0f14ff')).toBeNull()
    expect(hexToRgb('#0f14f')).toBeNull()
    expect(hexToRgb('#0f14fg')).toBeNull()
  })
})
