import { afterEach, describe, expect, it, vi } from 'vitest'
import { boxCharsFor, boxInnerWidth, boxOuterWidth, INPUT_BOX_CHARS } from '../src/box-chars.js'
import { GUTTER, gutterGlyph } from '../src/gutter.js'
import { uiGlyphs } from '../src/ui-glyphs.js'
import { hiddenLinesMarker } from '../src/format/hidden-lines.js'
import { TRUNCATION_MARKER_RE, truncationHint } from '../src/truncation-marker.js'
import { resetTermCapsCache, useAsciiBorders, useAsciiGlyphs } from '../src/term-caps.js'
import { InputController } from '../src/engine/input-controller.js'

afterEach(() => {
  resetTermCapsCache()
  vi.unstubAllEnvs()
  vi.stubEnv('RIVET_ASCII_UI', '0')
})

describe('boxCharsFor', () => {
  it('returns the thin set by default and for unknown separators', () => {
    expect(boxCharsFor('thin')).toBe(INPUT_BOX_CHARS.thin)
    expect(boxCharsFor('anything-else')).toBe(INPUT_BOX_CHARS.thin)
  })

  it('selects thick/dots/kimi variants', () => {
    expect(boxCharsFor('thick')).toBe(INPUT_BOX_CHARS.thick)
    expect(boxCharsFor('dots')).toBe(INPUT_BOX_CHARS.dots)
    expect(boxCharsFor('kimi')).toBe(INPUT_BOX_CHARS.kimi)
  })

  it('falls back to the ascii set under legacy conhost', () => {
    // force ascii borders via RIVET_ASCII_UI=1
    vi.stubEnv('RIVET_ASCII_UI', '1')
    expect(useAsciiBorders()).toBe(true)
    expect(boxCharsFor('thin')).toBe(INPUT_BOX_CHARS.ascii)
    expect(boxCharsFor('kimi')).toBe(INPUT_BOX_CHARS.ascii)
  })
})

describe('box geometry', () => {
  it('computes inner width with breathing room on wide terminals', () => {
    expect(boxInnerWidth(80)).toBe(74)
    expect(boxOuterWidth(80)).toBe(78)
  })

  it('pins to columns - 4 on narrow terminals', () => {
    expect(boxInnerWidth(26)).toBe(20)
    expect(boxInnerWidth(25)).toBe(21)
    expect(boxOuterWidth(25)).toBe(25)
  })

  it('never returns a negative inner width', () => {
    expect(boxInnerWidth(3)).toBe(0)
    expect(boxOuterWidth(0)).toBe(4)
  })
})

describe('gutterGlyph', () => {
  it('maps each kind to its glyph', () => {
    expect(gutterGlyph('user')).toBe(GUTTER.user.glyph)
    expect(gutterGlyph('assistant')).toBe(GUTTER.assistant.glyph)
    expect(gutterGlyph('thinking')).toBe(GUTTER.thinking.glyph)
    expect(gutterGlyph('tool')).toBe(GUTTER.tool.glyph)
  })

  it('falls back to the system glyph for unknown kinds', () => {
    expect(gutterGlyph('bogus' as never)).toBe(GUTTER.system.glyph)
  })
})

describe('uiGlyphs', () => {
  it('returns unicode glyphs by default (non-ascii)', () => {
    vi.stubEnv('RIVET_ASCII_UI', '0')
    expect(uiGlyphs().sideQuestion).toBe('◇')
    expect(uiGlyphs().planApproved).toBe('✓')
    expect(uiGlyphs().planRejected).toBe('✗')
    expect(uiGlyphs().planExecuted).toBe('◆')
  })

  it('returns ascii glyphs when forced', () => {
    vi.stubEnv('RIVET_ASCII_UI', '1')
    expect(uiGlyphs().sideQuestion).toBe('?')
    expect(uiGlyphs().planSubmitted).toBe('-')
    expect(uiGlyphs().planApproved).toBe('+')
    expect(uiGlyphs().planRejected).toBe('x')
    expect(uiGlyphs().planExecuted).toBe('*')
  })
})

describe('hiddenLinesMarker', () => {
  it('builds the unicode collapsed marker by default', () => {
    vi.stubEnv('RIVET_ASCII_UI', '0')
    expect(hiddenLinesMarker(3)).toBe('─── ✂ 已隐藏 3 行 ───')
    expect(hiddenLinesMarker(12, 'earlier')).toBe('─── ✂ 已隐藏上文 12 行 ───')
  })

  it('builds the ascii collapsed marker when forced', () => {
    vi.stubEnv('RIVET_ASCII_UI', '1')
    expect(hiddenLinesMarker(3)).toBe('--- -- 已隐藏 3 行 ---')
  })
})

describe('truncation markers', () => {
  it('formats a counted hint without the expand shortcut', () => {
    expect(truncationHint(25)).toBe('… +25 行')
    expect(truncationHint(12, 'diff')).toBe('… +12 diff')
  })

  it('recognizes the count form with optional legacy expand hints', () => {
    expect(TRUNCATION_MARKER_RE.test('… +25 行')).toBe(true)
    expect(TRUNCATION_MARKER_RE.test('… +25 行 · ctrl+o 展开')).toBe(true)
    expect(TRUNCATION_MARKER_RE.test('… +5 lines [Ctrl+O]')).toBe(true)
    expect(TRUNCATION_MARKER_RE.test('no marker here')).toBe(false)
  })
})

describe('InputController', () => {
  it('holds the six input state fields with sane defaults', () => {
    const ic = new InputController()
    expect(ic.slashCommands).toEqual([])
    expect(ic.slashSelectedIdx).toBe(0)
    expect(ic.fileCompletion).toBeNull()
    expect(ic.inputHistory).toEqual([])
    expect(ic.ctrlCPendingSince).toBe(0)
    expect(ic.lastEscAt).toBe(0)
  })

  it('stores injected slash commands', () => {
    const ic = new InputController()
    ic.slashCommands = [{ name: '/resume', description: 'resume' }]
    ic.slashSelectedIdx = 1
    ic.inputHistory = ['old']
    expect(ic.slashCommands[0]?.name).toBe('/resume')
    expect(ic.slashSelectedIdx).toBe(1)
    expect(ic.inputHistory).toEqual(['old'])
  })
})

describe('useAsciiGlyphs / useAsciiBorders env override', () => {
  it('lets RIVET_ASCII_UI explicitly force both switches', () => {
    vi.stubEnv('RIVET_ASCII_UI', '1')
    expect(useAsciiGlyphs()).toBe(true)
    expect(useAsciiBorders()).toBe(true)
    vi.stubEnv('RIVET_ASCII_UI', '0')
    expect(useAsciiGlyphs()).toBe(false)
    expect(useAsciiBorders()).toBe(false)
  })
})
