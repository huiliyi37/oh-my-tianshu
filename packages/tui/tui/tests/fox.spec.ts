/**
 * Indexed half-block and canonical welcome-fox rendering contracts.
 */

import chalk from 'chalk'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  formatFoxFrame,
  renderIndexedHalfBlocks,
} from '../src/format/fox.js'
import { displayWidth } from '../src/width.js'

const PALETTE = [
  null,
  { rgb: '#112233', ansi16: 31 },
  { rgb: '#445566', ansi16: 96 },
] as const

const savedAmbiguous = process.env.RIVET_AMBIGUOUS_WIDTH
const savedLevel = chalk.level

beforeEach(() => {
  process.env.RIVET_AMBIGUOUS_WIDTH = 'narrow'
})

afterEach(() => {
  chalk.level = savedLevel
  if (savedAmbiguous === undefined) delete process.env.RIVET_AMBIGUOUS_WIDTH
  else process.env.RIVET_AMBIGUOUS_WIDTH = savedAmbiguous
})

function plain(line: string): string {
  return line.replace(/\x1B\[[0-9;?]*[ -/]*[@-~]/g, '')
}

function render(
  rows: readonly string[],
  colorLevel = 3,
  width = rows[0]?.length ?? 0,
): string[] {
  return renderIndexedHalfBlocks({
    width,
    rows,
    palette: PALETTE,
    colorLevel,
  })
}

describe('renderIndexedHalfBlocks', () => {
  it('selects upper, lower, and mixed upper glyphs without using full blocks', () => {
    const [line] = render([
      '1200',
      '0210',
    ])

    expect(plain(line!)).toBe('▀▀▄')
    expect(plain(line!)).not.toContain('█')
  })

  it('emits explicit truecolor foreground and background sequences at level 3', () => {
    const [line] = render(['1', '2'], 3)

    expect(line).toContain('\x1B[38;2;17;34;51m')
    expect(line).toContain('\x1B[48;2;68;85;102m')
  })

  it('uses explicit xterm-256 sequences at level 2 regardless of ambient chalk level', () => {
    chalk.level = 3
    const [line] = render(['1', '2'], 2)

    expect(line).toContain('\x1B[38;5;')
    expect(line).toContain('\x1B[48;5;')
    expect(line).not.toContain('\x1B[38;2;')
    expect(line).not.toContain('\x1B[48;2;')
  })

  it('uses fixed ANSI16 foreground and background approximations at level 1', () => {
    const [line] = render(['1', '2'], 1)

    expect(line).toContain('\x1B[31m')
    expect(line).toContain('\x1B[106m')
    expect(line).not.toContain('\x1B[38;')
    expect(line).not.toContain('\x1B[48;')
  })

  it('returns no art for color level zero or full-width block glyphs', () => {
    expect(render(['1', '2'], 0)).toEqual([])
    process.env.RIVET_AMBIGUOUS_WIDTH = 'full'
    expect(render(['1', '2'], 3)).toEqual([])
  })

  it('rejects malformed non-transparent palette RGB values', () => {
    expect(() => renderIndexedHalfBlocks({
      width: 1,
      rows: ['1'],
      palette: [null, { rgb: '#zzzzzz', ansi16: 31 }],
      colorLevel: 3,
    })).toThrow(new TypeError('invalid indexed RGB color: #zzzzzz'))
  })

  it('resets a mixed-cell background before internal transparent spaces', () => {
    const [line] = render([
      '1002',
      '2000',
    ])
    const firstSpace = line!.indexOf(' ')

    expect(plain(line!)).toBe('▀  ▀')
    expect(firstSpace).toBeGreaterThan(0)
    expect(line!.slice(0, firstSpace)).toContain('\x1B[49m')
    expect(line!.endsWith('\x1B[0m')).toBe(true)
  })

  it('treats missing columns in short indexed rows as transparent', () => {
    const [line] = render(['1', '1'], 3, 2)

    expect(plain(line!)).toBe('▀')
  })

  it('renders the final odd pixel row as top-only half blocks', () => {
    const [line] = render(['1'])

    expect(plain(line!)).toBe('▀')
  })
})

describe('formatFoxFrame', () => {
  it('renders the 28×30 rest band as 15 half-block rows', () => {
    const lines = formatFoxFrame({ colorLevel: 3, width: 28 })
    expect(lines).toHaveLength(15)
    for (const line of lines) {
      expect(plain(line)).toMatch(/^[ ▀▄]*$/u)
      expect(plain(line)).not.toContain('█')
      expect(line.endsWith('\x1B[0m')).toBe(true)
      expect(displayWidth(line)).toBeLessThanOrEqual(28)
    }
  })

  it('renders the 36×38 rest band as 19 half-block rows', () => {
    const lines = formatFoxFrame({ colorLevel: 3, width: 36 })
    expect(lines).toHaveLength(19)
    for (const line of lines) expect(displayWidth(line)).toBeLessThanOrEqual(36)
  })

  it('defaults to the 28 band and rejects any other width', () => {
    expect(formatFoxFrame({ colorLevel: 3 })).toEqual(
      formatFoxFrame({ colorLevel: 3, width: 28 }),
    )
    expect(() => formatFoxFrame({ colorLevel: 3, width: 40 })).toThrow(
      /welcome fox band width must be 28 or 36/,
    )
  })
})
