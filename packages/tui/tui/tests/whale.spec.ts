/**
 * Canonical welcome-whale rendering contracts.
 *
 * The whale binds the shared indexed half-block renderer to its generated
 * bands; these tests pin band geometry, glyph hygiene, and width validation.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { formatWhaleFrame } from '../src/format/whale.js'
import { displayWidth } from '../src/width.js'

const savedAmbiguous = process.env.RIVET_AMBIGUOUS_WIDTH

beforeEach(() => {
  process.env.RIVET_AMBIGUOUS_WIDTH = 'narrow'
})

afterEach(() => {
  if (savedAmbiguous === undefined) delete process.env.RIVET_AMBIGUOUS_WIDTH
  else process.env.RIVET_AMBIGUOUS_WIDTH = savedAmbiguous
})

function plain(line: string): string {
  return line.replace(/\x1B\[[0-9;?]*[ -/]*[@-~]/g, '')
}

describe('formatWhaleFrame', () => {
  it('renders the 28×30 rest band as 15 half-block rows', () => {
    const lines = formatWhaleFrame({ colorLevel: 3, width: 28 })
    expect(lines).toHaveLength(15)
    for (const line of lines) {
      expect(plain(line)).toMatch(/^[ ▀▄]*$/u)
      expect(plain(line)).not.toContain('█')
      expect(line.endsWith('\x1B[0m')).toBe(true)
      expect(displayWidth(line)).toBeLessThanOrEqual(28)
    }
  })

  it('renders the 36×38 rest band as 19 half-block rows', () => {
    const lines = formatWhaleFrame({ colorLevel: 3, width: 36 })
    expect(lines).toHaveLength(19)
    for (const line of lines) expect(displayWidth(line)).toBeLessThanOrEqual(36)
  })

  it('defaults to the 28 band and rejects any other width', () => {
    expect(formatWhaleFrame({ colorLevel: 3 })).toEqual(
      formatWhaleFrame({ colorLevel: 3, width: 28 }),
    )
    expect(() => formatWhaleFrame({ colorLevel: 3, width: 40 })).toThrow(
      /welcome whale band width must be 28 or 36/,
    )
  })

  it('returns no rows for a zero color level', () => {
    expect(formatWhaleFrame({ colorLevel: 0, width: 28 })).toEqual([])
  })
})
