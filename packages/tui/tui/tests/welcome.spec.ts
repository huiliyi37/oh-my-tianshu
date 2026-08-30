/**
 * Fox welcome composition contracts.
 *
 * The hero owns band selection, the one-line title, and capability fallback,
 * while the final composer owns restore rows and the startup tip.
 */

import { describe, expect, it } from 'vitest'
import { ANSI } from '../src/engine/ansi.js'
import type { RivetTheme } from '../src/theme.js'
import { displayWidth } from '../src/width.js'
import {
  CHROME_GUTTER,
  RESUME_TIP,
  WELCOME_HERO_WIDE_MIN,
  WELCOME_TIPS,
  formatWelcome,
  formatWelcomeHero,
  pickWelcomeTip,
  resolveWelcomeArtWidth,
  type FormatWelcomeHeroInput,
} from '../src/format/welcome.js'

function fakeTheme(): RivetTheme {
  return {
    primary: '#111111', secondary: '#222222', success: '#333333',
    warning: '#444444', error: '#555555', dim: '#666666', muted: '#777777',
    pulseQuiet: '#888888', pulseActive: '#999999', pulseAlert: '#aaaaaa',
    userColor: '#bbbbbb', assistantColor: '#cccccc', systemColor: '#dddddd',
    brandColor: '#eeeeee', toolColor: () => '#000000', contextColor: () => '#000000',
  }
}

function plainLine(line: string): string {
  return line.replace(/\x1B\[[0-9;?]*[ -/]*[@-~]/g, '')
}

function plain(lines: readonly string[]): string[] {
  return lines.map(plainLine)
}

const ART = {
  lines: Array.from({ length: 15 }, (_, index) => `fox-${index}`),
  width: 28,
} as const

const WIDE_ART = {
  lines: Array.from({ length: 19 }, (_, index) => `fox-${index}`),
  width: 36,
} as const

function heroInput(over: Partial<FormatWelcomeHeroInput> = {}): FormatWelcomeHeroInput {
  return {
    width: 100,
    rows: 40,
    art: ART,
    modelId: 'deepseek-chat',
    reasoningEffort: 'high',
    cwd: '/work/tianshu',
    version: '0.4.0',
    ...over,
  }
}

describe('formatWelcomeHero', () => {
  it('selects 28 at 80–104 columns, 36 at 105+, and 44 at 140+ when rows fit', () => {
    expect(WELCOME_HERO_WIDE_MIN).toBe(80)
    expect(resolveWelcomeArtWidth(79, 40)).toBeNull()
    expect(resolveWelcomeArtWidth(80, 20)).toBeNull()
    expect(resolveWelcomeArtWidth(80, 21)).toBe(28)
    expect(resolveWelcomeArtWidth(104, 25)).toBe(28)
    expect(resolveWelcomeArtWidth(105, 24)).toBe(28)
    expect(resolveWelcomeArtWidth(105, 25)).toBe(36)
    expect(resolveWelcomeArtWidth(140, 28)).toBe(36)
    expect(resolveWelcomeArtWidth(140, 29)).toBe(44)
    expect(resolveWelcomeArtWidth(139, 29)).toBe(36)
  })

  it('places the half-block Tianshu wordmark beside 28-column art', () => {
    const lines = plain(formatWelcomeHero(heroInput({
      width: 89,
      rows: 40,
    }), fakeTheme()))
    expect(lines.some(line => line.includes('Oh My Tianshu'))).toBe(false)
    expect(lines.some(line => /[█▀▄]/.test(line))).toBe(true)
    expect(lines.find(line => line.includes('< tianshu harness · from deepseek >'))).toBeDefined()
    const wordmarkLine = lines.find(line => /[█▀▄]/.test(line))
    expect(wordmarkLine).toMatch(/fox-\d/)
    expect(lines.findIndex(line => /[█▀▄]/.test(line)))
      .toBeGreaterThanOrEqual(lines.findIndex(line => /fox-\d/.test(line)))
  })

  it('keeps the block brand beside the 28-column art at 80 columns', () => {
    const lines = plain(formatWelcomeHero(heroInput({
      width: 80,
      rows: 40,
    }), fakeTheme()))
    const joined = lines.join('\n')
    expect(joined).toContain('fox-0')
    expect(joined).toContain('Oh My')
    expect(joined).toContain('< tianshu harness · from deepseek >')
    expect(lines.some(line => line.includes('fox-') && /[█▀▄]/.test(line))).toBe(true)
    for (const line of lines) expect(displayWidth(line)).toBeLessThanOrEqual(80)
  })

  it('places the 36-column fox once rows and columns allow the wide band', () => {
    const lines = plain(formatWelcomeHero(heroInput({
      width: 105,
      rows: 25,
      art: WIDE_ART,
    }), fakeTheme()))
    expect(lines.some(line => line.includes('fox-0'))).toBe(true)
    // 105 列细节栏 61 列：品牌字渲染为块字母（'Oh My' 文本行 + 块行）。
    expect(lines.some(line => line.includes('Oh My'))).toBe(true)
    expect(lines.some(line => line.includes('█'))).toBe(true)
    expect(lines.some(line => line.includes('Oh My Tianshu'))).toBe(false)
  })

  it('renders the splash title with a mark caret and Harness line in the compact fallback', () => {
    // 无图案（窄/无色终端）时品牌退化为单行文本标题。
    const lines = formatWelcomeHero(heroInput({ art: { lines: [], width: 0 } }), fakeTheme())
    const title = lines.find(line => plainLine(line).includes('Oh My Tianshu'))
    const harness = lines.find(line => plainLine(line).includes('< Harness >'))

    expect(title).toBeDefined()
    expect(title).toContain('\x1B[38;2;238;238;238m\x1B[1mOh My Tianshu')
    expect(title).toContain('\x1B[38;2;180;140;255m\x1B[1m >')
    expect(harness).toBeDefined()
    expect(harness).toContain('\x1B[38;2;180;140;255m\x1B[1m< Harness >')
  })

  it('renders the oversized block-letter brand when the details column fits', () => {
    const lines = formatWelcomeHero(heroInput(), fakeTheme())
    const flat = lines.map(plainLine)

    // 'Oh My' kicker 文本行 + Tianshu 半块字标（5 行）+ 由来小字行。
    expect(flat.some(line => line.includes('Oh My'))).toBe(true)
    const brandRows = lines.filter(line => /[█▀▄]/.test(line))
    expect(brandRows.length).toBe(5)
    expect(brandRows.every(line => line.includes('\x1B[38;2;238;238;238m\x1B[1m'))).toBe(true)
    expect(lines.some(line => line.includes('\x1B[38;2;180;140;255m\x1B[1m< tianshu harness · from deepseek >'))).toBe(true)
    expect(flat.some(line => line.includes('Oh My Tianshu'))).toBe(false)
    expect(flat.some(line => line.includes('< Harness >'))).toBe(false)
    for (const line of lines) expect(displayWidth(line)).toBeLessThanOrEqual(100)
  })

  it('shows model, effort, cwd, and optional version in the balanced right column', () => {
    const joined = plain(formatWelcomeHero(heroInput(), fakeTheme())).join('\n')

    expect(joined).toContain('Model deepseek-chat · Effort high')
    expect(joined).toContain('cwd /work/tianshu')
    expect(joined).toContain('v0.4.0')
  })

  it('keeps an existing version prefix unchanged', () => {
    const joined = plain(formatWelcomeHero(heroInput({
      width: 60,
      version: 'v0.4.0',
    }), fakeTheme())).join('\n')

    expect(joined).toContain('v0.4.0')
    expect(joined).not.toContain('vv0.4.0')
  })

  it('pads missing wide-art rows when the details column is longer', () => {
    const lines = plain(formatWelcomeHero(heroInput({
      art: { lines: ['fox-only'], width: 28 },
    }), fakeTheme()))

    expect(lines[0]).toContain('fox-only')
    expect(lines[1]).not.toContain('fox-')
    expect(lines.some(line => line.includes('Oh My'))).toBe(true)
  })

  it('keeps the mid-band layout wide while truncating long metadata', () => {
    const cwd = `/工作区/${'很长目录/'.repeat(20)}最终目录`
    const lines = formatWelcomeHero(heroInput({
      width: 92,
      rows: 40,
      cwd,
    }), fakeTheme())
    const flat = plain(lines)
    const cwdLine = lines.find(line => plainLine(line).includes('cwd /工作区/'))

    expect(flat.some(line => line.includes('fox-0'))).toBe(true)
    expect(flat.some(line => line.includes('Oh My'))).toBe(true)
    expect(cwdLine).toBeDefined()
    expect(plainLine(cwdLine!)).not.toContain('最终目录')
    expect(cwdLine!.endsWith(ANSI.RESET)).toBe(true)
    for (const line of lines) expect(displayWidth(line)).toBeLessThanOrEqual(92)
  })

  it.each([
    ['narrow terminal', { width: 79 }],
    ['short terminal', { rows: 20 }],
    ['empty art', { art: { lines: [], width: 28 } }],
    ['mismatched band width', { art: { lines: ['fox-0'], width: 40 } }],
    ['non-positive art allocation', { art: { lines: ['fox-0'], width: 0 } }],
  ])('uses one compact text fallback for %s', (_name, over) => {
    const lines = plain(formatWelcomeHero(heroInput(over), fakeTheme()))
    const joined = lines.join('\n')

    expect(joined).toContain('Oh My')
    expect(joined).toContain('< Harness >')
    expect(joined).toContain('Model deepseek-chat · Effort high')
    expect(joined).toContain('cwd /work/tianshu')
    expect(joined).toContain('v0.4.0')
    expect(joined).not.toContain('fox-')
    expect(joined).not.toContain('█')
  })

  it('uses auto when reasoning effort is omitted and omits an absent version', () => {
    const lines = plain(formatWelcomeHero({
      width: 60,
      rows: 40,
      art: ART,
      modelId: 'deepseek-chat',
      cwd: '/work/tianshu',
    }, fakeTheme()))
    const joined = lines.join('\n')

    expect(joined).toContain('Model deepseek-chat · Effort auto')
    expect(joined).not.toContain('v0.4.0')
  })

  it('keeps every ANSI line within the terminal width', () => {
    for (const width of [1, 8, 24, 60, 91, 92, 100, 120]) {
      const lines = formatWelcomeHero(heroInput({ width }), fakeTheme())
      for (const line of lines) expect(displayWidth(line)).toBeLessThanOrEqual(width)
    }
    // 零宽流回退到 80 列：够放 28 档狐狸，标题留在右侧。
    const fallbackLines = plain(formatWelcomeHero(heroInput({ width: 0 }), fakeTheme()))
    expect(fallbackLines.join('\n')).toContain('Oh My')
    for (const line of fallbackLines) expect(displayWidth(line)).toBeLessThanOrEqual(80)
  })

  it('does not mix restore rows or the startup tip into the preview hero', () => {
    const joined = plain(formatWelcomeHero(heroInput(), fakeTheme())).join('\n')
    expect(joined).not.toContain('恢复会话')
    expect(joined).not.toContain('Tip:')
  })
})

describe('formatWelcome', () => {
  it('owns the leading gap, hero, restore section, italic tip, and trailing gap', () => {
    const lines = formatWelcome({
      ...heroInput(),
      restoreLines: ['[1] ○ 会话一', '[2] ● 会话二'],
      tip: 'Tip: 保持专注',
    }, fakeTheme())
    const flat = plain(lines)
    const restoreAt = flat.indexOf(`${' '.repeat(CHROME_GUTTER)}恢复会话`)

    expect(lines[0]).toBe('')
    expect(restoreAt).toBeGreaterThan(0)
    expect(flat.slice(restoreAt, restoreAt + 4)).toEqual([
      `${' '.repeat(CHROME_GUTTER)}恢复会话`,
      `${' '.repeat(CHROME_GUTTER)}[1] ○ 会话一`,
      `${' '.repeat(CHROME_GUTTER)}[2] ● 会话二`,
      `${' '.repeat(CHROME_GUTTER)}[1-9] 恢复 · ctrl+n 新会话`,
    ])
    expect(flat.at(-2)).toBe(`${' '.repeat(CHROME_GUTTER)}Tip: 保持专注`)
    expect(lines.at(-2)).toContain('\x1B[3m')
    expect(lines.at(-2)).toContain('\x1B[38;2;119;119;119m')
    expect(lines.at(-1)).toBe('')
  })

  it('omits the complete restore section when no restore rows are supplied', () => {
    const lines = plain(formatWelcome({
      ...heroInput({ width: 60 }),
      restoreLines: [],
      tip: 'Tip: hello',
    }, fakeTheme()))

    expect(lines[0]).toBe('')
    expect(lines).not.toContain(`${' '.repeat(CHROME_GUTTER)}恢复会话`)
    expect(lines.join('\n')).not.toContain('[1-9] 恢复')
    expect(lines.at(-2)).toContain('Tip: hello')
    expect(lines.at(-1)).toBe('')
  })

  it('ANSI-safely bounds hero, restore, and tip lines', () => {
    for (const width of [1, 8, 24, 60, 100]) {
      const lines = formatWelcome({
        ...heroInput({ width }),
        restoreLines: [`[1] ${'会话'.repeat(80)}`],
        tip: `Tip: ${'x'.repeat(200)}`,
      }, fakeTheme())
      for (const line of lines) expect(displayWidth(line)).toBeLessThanOrEqual(width)
    }
    // 零宽流回退到 80 列：hero 按 28 档并排，恢复区仍按其自身宽度截断。
    const fallbackLines = plain(formatWelcome({
      ...heroInput({ width: 0 }),
      restoreLines: ['[1] resize'],
      tip: 'Tip: hidden',
    }, fakeTheme()))
    expect(fallbackLines.join('\n')).toContain('Oh My')
    expect(fallbackLines.join('\n')).toContain('Tip: hidden')
    for (const line of fallbackLines) expect(displayWidth(line)).toBeLessThanOrEqual(80)
  })
})

describe('pickWelcomeTip', () => {
  it('returns deterministic entries with the Tip prefix', () => {
    expect(pickWelcomeTip(() => 0)).toBe(`Tip: ${WELCOME_TIPS[0]}`)
    for (const tip of WELCOME_TIPS) {
      expect(pickWelcomeTip(() => WELCOME_TIPS.indexOf(tip) / WELCOME_TIPS.length)).toBe(`Tip: ${tip}`)
    }
  })

  it('adds the resume tip only when requested', () => {
    expect(pickWelcomeTip(() => 0.9999, { resumeVisible: true })).toBe(`Tip: ${RESUME_TIP}`)
    expect(pickWelcomeTip(() => 0.9999)).not.toBe(`Tip: ${RESUME_TIP}`)
  })

  it('falls back to the first tip when rng yields no valid index', () => {
    expect(pickWelcomeTip(() => Number.NaN)).toBe(`Tip: ${WELCOME_TIPS[0]}`)
  })
})
