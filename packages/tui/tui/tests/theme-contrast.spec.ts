/**
 * theme-contrast + NO_COLOR — 可达性两项（回流 dsh-tui 3e2cb2f）：
 * - WCAG 对比度数学（亮度/比值/校验器）
 * - NO_COLOR（no-color.org）显式压制：fg/bg 输出空串、color() 保留属性
 * - 自定义主题加载时的低对比警告（fail-open，仍注册）
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  bg,
  color,
  fg,
  isColorSuppressed,
  noColorRequested,
  setColorSuppressed,
} from '../src/engine/ansi.js'
import {
  CONTRAST_MIN_RATIO,
  contrastRatio,
  relativeLuminance,
  validateThemeContrast,
} from '../src/theme-contrast.js'
import { loadCustomThemes } from '../src/theme-custom.js'

describe('WCAG 对比度数学', () => {
  it('亮度边界：黑 0 / 白 1', () => {
    expect(relativeLuminance('#000000')).toBe(0)
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5)
  })

  it('黑白对比度 21；同色 1；阈值常量为 3.0', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1)
    expect(contrastRatio('#888888', '#888888')).toBe(1)
    expect(CONTRAST_MIN_RATIO).toBe(3.0)
  })

  it('无法解析返回 null', () => {
    expect(contrastRatio('cyan', '#ffffff')).toBe(null)
    expect(relativeLuminance('nope')).toBe(null)
  })

  it('暗底主题过暗色、亮底主题过亮色各被判低对比', () => {
    expect(validateThemeContrast({ dim: '#555555' }, 'dark').map(i => i.token)).toEqual(['dim'])
    expect(validateThemeContrast({ primary: '#61afef' }, 'light').map(i => i.token)).toEqual(['primary'])
    // 同色换到对侧背景则通过
    expect(validateThemeContrast({ dim: '#555555' }, 'light')).toEqual([])
    expect(validateThemeContrast({ primary: '#61afef' }, 'dark')).toEqual([])
  })

  it('非 hex（chalk 命名色）跳过不误报', () => {
    expect(validateThemeContrast({ primary: 'cyan', secondary: '#ffffff' }, 'dark')).toEqual([])
  })
})

describe('NO_COLOR 显式处理', () => {
  afterEach(() => {
    setColorSuppressed(false)
  })

  it('noColorRequested：存在且非空才生效（no-color.org）', () => {
    expect(noColorRequested({ NO_COLOR: '1' })).toBe(true)
    expect(noColorRequested({ NO_COLOR: '' })).toBe(false)
    expect(noColorRequested({})).toBe(false)
  })

  it('压制时 fg/bg 返回空串，color() 保留 bold/dim 属性；用后复原', () => {
    const prev = isColorSuppressed()
    try {
      setColorSuppressed(true)
      expect(fg('#ff0000')).toBe('')
      expect(bg('#ff0000')).toBe('')
      expect(color('x', '#ff0000', { bold: true })).toBe('\x1B[1mx\x1B[0m')
    } finally {
      setColorSuppressed(prev)
    }
    expect(fg('#ff0000')).not.toBe('')
  })
})

describe('自定义主题低对比警告（fail-open）', () => {
  it('两背景都低对比时写 stderr 警告且主题仍注册', () => {
    const base = mkdtempSync(join(tmpdir(), 'dsh-theme-'))
    try {
      mkdirSync(join(base, 'themes'))
      writeFileSync(
        join(base, 'themes', 'lowkontrast.json'),
        JSON.stringify({ base: 'cobalt', background: 'dark', colors: { primary: '#555555' } }),
      )
      const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
      try {
        const loaded = loadCustomThemes(base)
        // 注册未被阻断：名字出现在成功列表（registerCustomTheme 之后才 push）
        expect(loaded).toContain('lowkontrast')
        expect(err).toHaveBeenCalledWith(expect.stringContaining('[theme] low contrast in lowkontrast.json'))
        expect(err).toHaveBeenCalledWith(expect.stringContaining('primary(#555555'))
      } finally {
        err.mockRestore()
      }
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })
})
