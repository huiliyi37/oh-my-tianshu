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
  lines: Array.from({ length: 21 }, (_, index) => `fox-${index}`),
  width: 56,
} as const

const WIDE_ART = {
  lines: Array.from({ length: 27 }, (_, index) => `fox-${index}`),
  width: 72,
} as const

function heroInput(over: Partial<FormatWelcomeHeroInput> = {}): FormatWelcomeHeroInput {
  return {
    width: 100,
    rows: 30,
    art: ART,
    modelId: 'deepseek-chat',
    reasoningEffort: 'high',
    cwd: '/work/tianshu',
    version: '0.4.0',
    ...over,
  }
}

describe('formatWelcomeHero', () => {
  it('selects 56 at 80–104 columns and 72 at 105+ when rows fit', () => {
    expect(WELCOME_HERO_WIDE_MIN).toBe(80)
    expect(resolveWelcomeArtWidth(79, 40)).toBeNull()
    expect(resolveWelcomeArtWidth(80, 26)).toBeNull()
    expect(resolveWelcomeArtWidth(80, 27)).toBe(56)
    expect(resolveWelcomeArtWidth(104, 33)).toBe(56)
    expect(resolveWelcomeArtWidth(105, 32)).toBe(56)
    expect(resolveWelcomeArtWidth(105, 33)).toBe(72)
  })

  it('places a one-line Oh My Tianshu title beside 56-column art', () => {
    const lines = plain(formatWelcomeHero(heroInput({
      width: 89,
      rows: 30,
      art: { lines: Array.from({ length: 21 }, (_, i) => `fox-${i}`), width: 56 },
    }), fakeTheme()))
    expect(lines.some(line => line.includes('Oh My Tianshu'))).toBe(true)
    expect(lines.some(line => line.includes('█'))).toBe(false)
    expect(lines.find(line => line.includes('DeepSeek ◆ Tianshu Harness'))).toBeDefined()
  })

  it('wraps the peer line at 80 columns and keeps the 56-column fox', () => {
    const lines = plain(formatWelcomeHero(heroInput({
      width: 80,
      rows: 30,
      art: { lines: Array.from({ length: 21 }, (_, i) => `fox-${i}`), width: 56 },
    }), fakeTheme()))
    const joined = lines.join('\n')
    expect(joined).toContain('fox-0')
    expect(joined).toContain('DeepSeek ◆')
    expect(joined).toContain('Tianshu Harness')
    expect(lines.filter(line => line.includes('DeepSeek ◆ Tianshu Harness'))).toHaveLength(0)
    for (const line of lines) expect(displayWidth(line)).toBeLessThanOrEqual(80)
  })

  it('places the 72-column fox once rows and columns allow the wide band', () => {
    const lines = plain(formatWelcomeHero(heroInput({
      width: 105,
      rows: 33,
      art: WIDE_ART,
    }), fakeTheme()))
    expect(lines.some(line => line.includes('fox-0'))).toBe(true)
    expect(lines.some(line => line.includes('Oh My Tianshu'))).toBe(true)
    expect(lines.some(line => line.includes('█'))).toBe(false)
  })

  it('renders peer harness brands at equal weight with an accented diamond', () => {
    const lines = formatWelcomeHero(heroInput(), fakeTheme())
    const peer = lines.find(line => plainLine(line).includes('DeepSeek ◆ Tianshu Harness'))

    expect(peer).toBeDefined()
    expect(peer).toContain('\x1B[38;2;17;17;17m\x1B[1mDeepSeek')
    expect(peer).toContain('\x1B[38;2;17;17;17m\x1B[1mTianshu Harness')
    expect(peer).toContain('\x1B[38;2;238;238;238m\x1B[1m◆')
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
      art: { lines: ['fox-only'], width: 56 },
    }), fakeTheme()))

    expect(lines[0]).toContain('fox-only')
    expect(lines[1]).not.toContain('fox-')
    expect(lines.some(line => line.includes('Oh My Tianshu'))).toBe(true)
  })

  it('keeps the mid-band layout wide while truncating long metadata', () => {
    const cwd = `/工作区/${'很长目录/'.repeat(20)}最终目录`
    const lines = formatWelcomeHero(heroInput({
      width: 92,
      rows: 30,
      cwd,
    }), fakeTheme())
    const flat = plain(lines)
    const cwdLine = lines.find(line => plainLine(line).includes('cwd /工作区/'))

    expect(flat.some(line => line.includes('fox-0'))).toBe(true)
    expect(flat.some(line => line.includes('Oh My Tianshu'))).toBe(true)
    expect(cwdLine).toBeDefined()
    expect(plainLine(cwdLine!)).not.toContain('最终目录')
    expect(cwdLine!.endsWith(ANSI.RESET)).toBe(true)
    for (const line of lines) expect(displayWidth(line)).toBeLessThanOrEqual(92)
  })

  it.each([
    ['narrow terminal', { width: 79 }],
    ['short terminal', { rows: 26 }],
    ['empty art', { art: { lines: [], width: 56 } }],
    ['mismatched band width', { art: { lines: ['fox-0'], width: 40 } }],
    ['non-positive art allocation', { art: { lines: ['fox-0'], width: 0 } }],
  ])('uses one compact text fallback for %s', (_name, over) => {
    const lines = plain(formatWelcomeHero(heroInput(over), fakeTheme()))
    const joined = lines.join('\n')

    expect(joined).toContain('Oh My Tianshu')
    expect(joined).toContain('DeepSeek ◆ Tianshu Harness')
    expect(joined).toContain('Model deepseek-chat · Effort high')
    expect(joined).toContain('cwd /work/tianshu')
    expect(joined).toContain('v0.4.0')
    expect(joined).not.toContain('fox-')
    expect(joined).not.toContain('█')
  })

  it('uses auto when reasoning effort is omitted and omits an absent version', () => {
    const lines = plain(formatWelcomeHero({
      width: 60,
      rows: 30,
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
    // 零宽流回退到 80 列：够放 56 档狐狸，详情行换行。
    const fallbackLines = plain(formatWelcomeHero(heroInput({ width: 0 }), fakeTheme()))
    expect(fallbackLines.join('\n')).toContain('Oh My Tianshu')
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
    // 零宽流回退到 80 列：hero 按 56 档换行，恢复区仍按其自身宽度截断。
    const fallbackLines = plain(formatWelcome({
      ...heroInput({ width: 0 }),
      restoreLines: ['[1] resize'],
      tip: 'Tip: hidden',
    }, fakeTheme()))
    expect(fallbackLines.join('\n')).toContain('Oh My Tianshu')
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
