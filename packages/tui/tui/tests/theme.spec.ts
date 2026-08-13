/**
 * theme — 主题解析层契约测试。
 *
 * - THEMES/THEME_NAMES：内置主题双轨（truecolor/fallback）+ 元数据。
 * - resolveThemeEntry：内置名 / custom: 前缀 / 未知名 undefined。
 * - setTheme/getActiveThemeName/getActiveThemeBackground：切换与 no-op。
 * - getTheme(colorLevel)：level>=2 走 truecolor 轨，<=1 走 fallback 轨。
 * - 缺省 token 回退（userColor/brandColor=primary、muted=auxiliaryDefault）。
 * - toolColor/contextColor 语义映射与阈值分档。
 * - registerCustomTheme/listCustomThemes/clearCustomThemes 注册表生命周期。
 *
 * getTheme 显式传 colorLevel 以隔离 chalk.level 环境。
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  THEME_NAMES,
  THEMES,
  clearCustomThemes,
  getActiveThemeBackground,
  getActiveThemeName,
  getTheme,
  listCustomThemes,
  registerCustomTheme,
  resolveThemeEntry,
  setTheme,
} from '../src/theme.js'
import type { ColorSet } from '../src/theme-palettes.js'

beforeEach(() => {
  clearCustomThemes()
  setTheme('graphite')
})

describe('THEMES / THEME_NAMES', () => {
  it('默认主题 graphite 已注册，背景 dark', () => {
    expect(THEME_NAMES).toContain('graphite')
    expect(THEMES.graphite).toBeDefined()
    expect(THEMES.graphite.background).toBe('dark')
    expect(THEMES.graphite.description).toBeTruthy()
  })

  it('每个内置主题含 truecolor/fallback 双轨与描述', () => {
    for (const name of THEME_NAMES) {
      const t = THEMES[name]
      expect(t.truecolor.primary).toBeTruthy()
      expect(t.fallback.primary).toBeTruthy()
      expect(t.description).toBeTruthy()
    }
  })

  it('亮色主题 Paper/Light-ANSI 背景为 light', () => {
    expect(THEMES.paper.background).toBe('light')
    expect(THEMES['light-ansi'].background).toBe('light')
  })
})

describe('resolveThemeEntry', () => {
  it('内置名解析成功', () => {
    expect(resolveThemeEntry('cobalt')?.background).toBe('dark')
  })

  it('未知名 → undefined', () => {
    expect(resolveThemeEntry('nope')).toBeUndefined()
  })

  it('custom: 前缀读注册表，清空后不可解析', () => {
    registerCustomTheme('mine', { description: 'x' })
    expect(resolveThemeEntry('custom:mine')).toBeDefined()
    clearCustomThemes()
    expect(resolveThemeEntry('custom:mine')).toBeUndefined()
  })
})

describe('setTheme / active 状态', () => {
  it('setTheme 切换成功返回 true 并更新 active 名与背景', () => {
    expect(setTheme('paper')).toBe(true)
    expect(getActiveThemeName()).toBe('paper')
    expect(getActiveThemeBackground()).toBe('light')
  })

  it('未知名 no-op 返回 false，active 不变', () => {
    const before = getActiveThemeName()
    expect(setTheme('nope')).toBe(false)
    expect(getActiveThemeName()).toBe(before)
  })

  it('可切换回内置默认 graphite', () => {
    expect(setTheme('graphite')).toBe(true)
    expect(getActiveThemeBackground()).toBe('dark')
  })
})

describe('getTheme', () => {
  it('level >= 2 → truecolor 轨', () => {
    expect(getTheme(2).primary).toBe(THEMES.graphite.truecolor.primary)
  })

  it('level <= 1 → fallback 轨', () => {
    expect(getTheme(0).primary).toBe(THEMES.graphite.fallback.primary)
  })

  it('toolColor 家族语义映射', () => {
    const t = getTheme(2)
    const tc = THEMES.graphite.truecolor as ColorSet
    expect(t.toolColor('bash')).toBe(tc.toolShell ?? tc.primary)
    expect(t.toolColor('edit_file')).toBe(tc.toolEdit ?? tc.secondary)
    expect(t.toolColor('run_tests')).toBe(tc.toolTest ?? tc.success)
    expect(t.toolColor('delegate_task')).toBe(tc.toolDelegate ?? tc.warning)
  })

  it('fallback 轨 tool 字段缺省回退（toolShell 等未定义 → primary/secondary/success/warning）', () => {
    // fallback 轨全部主题均未定义 tool* 字段（命名色轨），?? 右侧兜底必达。
    const t = getTheme(0)
    const fc = THEMES.graphite.fallback
    expect(t.toolColor('bash')).toBe(fc.primary)
    expect(t.toolColor('edit_file')).toBe(fc.secondary)
    expect(t.toolColor('run_tests')).toBe(fc.success)
    expect(t.toolColor('delegate_task')).toBe(fc.warning)
  })

  it('toolColor 未知名 → default 兜底（toolShell ?? dim）', () => {
    const t = getTheme(0)
    expect(t.toolColor('no_such_tool')).toBe(THEMES.graphite.fallback.dim)
    expect(getTheme(2).toolColor('no_such_tool')).toBe((THEMES.graphite.truecolor as ColorSet).toolShell ?? THEMES.graphite.truecolor.dim)
  })

  it('contextColor 阈值分档', () => {
    const t = getTheme(2)
    const tc = THEMES.graphite.truecolor
    expect(t.contextColor(0.9)).toBe(tc.error)
    expect(t.contextColor(0.8)).toBe(tc.warning)
    expect(t.contextColor(0.5)).toBe(tc.dim)
  })

  it('无 overrides 主题缺省 token 回退（userColor/brandColor=primary、muted=默认灰）', () => {
    setTheme('cyberpunk')
    const t = getTheme(2)
    expect(t.userColor).toBe(THEMES.cyberpunk.truecolor.primary)
    expect(t.brandColor).toBe(THEMES.cyberpunk.truecolor.primary)
    expect(t.muted).toBe('#9aa2b1')
  })
})

describe('registerCustomTheme', () => {
  it('注册后 listCustomThemes 可见，可经 resolve 读取', () => {
    registerCustomTheme('mydark', { background: 'dark', colors: { primary: '#000000' }, description: 'd' })
    expect(listCustomThemes()).toContain('mydark')
    const e = resolveThemeEntry('custom:mydark')
    expect(e?.background).toBe('dark')
    expect(e?.truecolor.primary).toBe('#000000')
  })

  it('指定 base 时继承其 fallback 命名色轨', () => {
    registerCustomTheme('mybase', { base: 'cobalt', background: 'light', colors: { primary: '#111111' } })
    const e = resolveThemeEntry('custom:mybase')
    expect(e?.fallback.primary).toBe(THEMES.cobalt.fallback.primary)
    expect(e?.truecolor.primary).toBe('#111111')
  })

  it('无 base 且 background light → 默认继承 paper', () => {
    registerCustomTheme('mylight', { background: 'light', colors: { primary: '#222222' } })
    const e = resolveThemeEntry('custom:mylight')
    expect(e?.background).toBe('light')
    expect(e?.truecolor.primary).toBe('#222222')
    expect(e?.truecolor.muted).toBe(THEMES.paper.truecolor.muted)
  })

  it('清空后 activeTheme 不可解析 → getTheme/getActiveThemeBackground 兜底 cobalt/dark', () => {
    registerCustomTheme('ghost', {})
    expect(setTheme('custom:ghost')).toBe(true)
    clearCustomThemes()
    expect(getActiveThemeName()).toBe('custom:ghost')
    expect(getActiveThemeBackground()).toBe('dark')
    expect(getTheme(2).primary).toBe(THEMES.cobalt.truecolor.primary)
    // 无参调用走 colorLevel ?? chalk.level 兜底，不抛且返回 string
    expect(typeof getTheme().primary).toBe('string')
  })

  it('清空后 listCustomThemes 为空', () => {
    registerCustomTheme('tmp', { description: 'x' })
    clearCustomThemes()
    expect(listCustomThemes()).toEqual([])
  })
})
