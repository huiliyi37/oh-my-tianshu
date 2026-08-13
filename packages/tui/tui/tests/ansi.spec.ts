import chalk from 'chalk'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  ANSI,
  bg,
  color,
  cursorBack,
  cursorDown,
  cursorForward,
  cursorTo,
  cursorToCol,
  cursorUp,
  detectHyperlinkSupport,
  detectImageProtocol,
  fg,
  fileLink,
  hyperlink,
  imageProtocol,
  osc52Clipboard,
  rgbToXterm256,
  setHyperlinksEnabled,
  setImageProtocol,
} from '../src/engine/ansi.js'

// detectHyperlinkSupport reads process.stdout.isTTY as a live gate; the unit
// process runs without a TTY, so pin it for the hyperlink-detection suites.
let originalIsTTY: PropertyDescriptor | undefined
beforeAll(() => {
  originalIsTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY') ?? undefined
  Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true })
})
afterAll(() => {
  if (originalIsTTY === undefined) delete (process.stdout as { isTTY?: unknown }).isTTY
  else Object.defineProperty(process.stdout, 'isTTY', originalIsTTY)
})

afterEach(() => {
  setHyperlinksEnabled(null)
  setImageProtocol(null)
  vi.unstubAllEnvs()
})

describe('cursor movement builders', () => {
  it('clamps to at least one row/column and floors fractions', () => {
    expect(cursorUp(3)).toBe('\x1B[3A')
    expect(cursorUp(0)).toBe('\x1B[1A')
    expect(cursorUp(2.9)).toBe('\x1B[2A')
    expect(cursorDown(5)).toBe('\x1B[5B')
    expect(cursorForward(7)).toBe('\x1B[7C')
    expect(cursorBack(1)).toBe('\x1B[1D')
  })

  it('builds absolute and column-only cursor positions (1-based, clamped)', () => {
    expect(cursorTo(3, 5)).toBe('\x1B[3;5H')
    expect(cursorTo(0, 0)).toBe('\x1B[1;1H')
    expect(cursorToCol(4)).toBe('\x1B[4G')
    expect(cursorToCol(0)).toBe('\x1B[1G')
  })
})

describe('rgbToXterm256', () => {
  it('maps cube colors into the 16-231 range', () => {
    expect(rgbToXterm256(0, 0, 0)).toBe(16)
    expect(rgbToXterm256(255, 255, 255)).toBe(231)
    expect(rgbToXterm256(255, 0, 0)).toBe(196)
    expect(rgbToXterm256(0, 255, 0)).toBe(46)
  })

  it('prefers the gray ramp when closer than the cube', () => {
    // 灰阶 232+i 亮度 8+10i：r=g=b=128 → i=(128-8)/10=12 → gv=128 → 232+12=244
    expect(rgbToXterm256(128, 128, 128)).toBe(244)
  })
})

describe('fg / bg / color', () => {
  it('renders hex colors as 24-bit SGR when not on a 256-color terminal', () => {
    expect(fg('#a8e6cf')).toBe('\x1B[38;2;168;230;207m')
    expect(bg('#a8e6cf')).toBe('\x1B[48;2;168;230;207m')
  })

  it('supports 3-digit hex shorthand', () => {
    expect(fg('#abc')).toBe('\x1B[38;2;170;187;204m')
  })

  it('maps named chalk colors to base 16 SGR codes', () => {
    expect(fg('cyan')).toBe('\x1B[36m')
    expect(bg('red')).toBe('\x1B[41m')
    expect(fg('redBright')).toBe('\x1B[91m')
    expect(bg('whiteBright')).toBe('\x1B[107m')
    expect(fg('grey')).toBe('\x1B[90m')
  })

  it('returns an empty string for unresolvable colors', () => {
    expect(fg('not-a-color')).toBe('')
    expect(bg('not-a-color')).toBe('')
  })

  it('wraps text with the color and a trailing reset', () => {
    expect(color('hi', '#ffffff')).toBe('\x1B[38;2;255;255;255mhi\x1B[0m')
    expect(color('hi', '#ffffff', { bold: true, dim: true, italic: true, underline: true }))
      .toBe('\x1B[38;2;255;255;255m\x1B[1m\x1B[2m\x1B[3m\x1B[4mhi\x1B[0m')
  })
})

describe('osc52Clipboard', () => {
  it('base64-encodes the payload', () => {
    expect(osc52Clipboard('hi')).toBe('\x1B]52;c;aGk=\x07')
  })
})

describe('detectHyperlinkSupport', () => {
  it('honors explicit environment switches', () => {
    expect(detectHyperlinkSupport({ RIVET_HYPERLINKS: '0' })).toBe(false)
    expect(detectHyperlinkSupport({ RIVET_HYPERLINKS: '1' })).toBe(true)
    expect(detectHyperlinkSupport({ FORCE_HYPERLINK: '1' })).toBe(true)
  })

  it('rejects dumb terminals and non-TTY stdout', () => {
    expect(detectHyperlinkSupport({ TERM: 'dumb' })).toBe(false)
    expect(detectHyperlinkSupport({})).toBe(false)
  })

  it('rejects tmux/screen passthrough-less environments', () => {
    expect(detectHyperlinkSupport({ TMUX: '/tmp/tmux', TERM_PROGRAM: 'WezTerm' })).toBe(false)
    expect(detectHyperlinkSupport({ TERM: 'screen' })).toBe(false)
  })

  it('accepts known terminal programs and kitty', () => {
    expect(detectHyperlinkSupport({ TERM_PROGRAM: 'iTerm.app' })).toBe(true)
    expect(detectHyperlinkSupport({ TERM_PROGRAM: 'ghostty' })).toBe(true)
    expect(detectHyperlinkSupport({ TERM: 'xterm-kitty' })).toBe(true)
    expect(detectHyperlinkSupport({ WT_SESSION: 'x' })).toBe(true)
  })

  it('accepts VTE >= 0.50', () => {
    expect(detectHyperlinkSupport({ VTE_VERSION: '6000' })).toBe(true)
    expect(detectHyperlinkSupport({ VTE_VERSION: '4000' })).toBe(false)
  })
})

describe('hyperlink', () => {
  it('returns plain text when hyperlinks are unsupported', () => {
    setHyperlinksEnabled(false)
    expect(hyperlink('text', 'https://example.com')).toBe('text')
  })

  it('wraps text in an OSC 8 sequence when enabled', () => {
    setHyperlinksEnabled(true)
    expect(hyperlink('text', 'https://example.com')).toBe('\x1B]8;;https://example.com\x07text\x1B]8;;\x07')
  })

  it('strips control characters from the url', () => {
    setHyperlinksEnabled(true)
    // \x1B and \x07 are stripped; ']8;;evil' is ordinary text and survives.
    expect(hyperlink('x', 'a\x1B]8;;evil\x07b')).toBe('\x1B]8;;a]8;;evilb\x07x\x1B]8;;\x07')
  })

  it('returns text when the sanitized url is empty', () => {
    setHyperlinksEnabled(true)
    expect(hyperlink('x', '\x1B\x07')).toBe('x')
  })
})

describe('fileLink', () => {
  it('resolves relative paths against cwd', () => {
    setHyperlinksEnabled(true)
    expect(fileLink('a.ts', 'src/a.ts', '/proj')).toBe('\x1B]8;;file:///proj/src/a.ts\x07a.ts\x1B]8;;\x07')
  })

  it('keeps absolute paths as-is', () => {
    setHyperlinksEnabled(true)
    expect(fileLink('a.ts', '/abs/a.ts')).toContain('file:///abs/a.ts')
  })
})

describe('detectImageProtocol', () => {
  it('honors explicit environment overrides', () => {
    expect(detectImageProtocol({ RIVET_IMAGES: '0' }, true)).toBe('none')
    expect(detectImageProtocol({ RIVET_IMAGES: 'off' }, true)).toBe('none')
    expect(detectImageProtocol({ RIVET_IMAGES: 'kitty' }, true)).toBe('kitty')
    expect(detectImageProtocol({ RIVET_IMAGES: 'iterm2' }, true)).toBe('iterm2')
  })

  it('rejects dumb/non-TTY/tmux', () => {
    expect(detectImageProtocol({ TERM: 'dumb' }, true)).toBe('none')
    expect(detectImageProtocol({}, false)).toBe('none')
    expect(detectImageProtocol({ TMUX: 'x' }, true)).toBe('none')
  })

  it('detects by terminal program', () => {
    expect(detectImageProtocol({ TERM_PROGRAM: 'iTerm.app' }, true)).toBe('iterm2')
    expect(detectImageProtocol({ TERM: 'xterm-kitty' }, true)).toBe('kitty')
    expect(detectImageProtocol({ TERM_PROGRAM: 'WezTerm' }, true)).toBe('kitty')
    expect(detectImageProtocol({ KONSOLE_VERSION: '220000' }, true)).toBe('kitty')
    expect(detectImageProtocol({}, true)).toBe('none')
  })
})

describe('imageProtocol', () => {
  it('returns the override when set', () => {
    setImageProtocol('kitty')
    expect(imageProtocol()).toBe('kitty')
  })

  it('falls back to live detection without an override', () => {
    // The unit process may run under a hyperlink-capable TERM_PROGRAM (e.g.
    // WarpTerminal), so assert consistency with the direct detector rather
    // than a hardcoded 'none'.
    expect(imageProtocol()).toBe(detectImageProtocol(process.env, process.stdout.isTTY))
  })
})

describe('ANSI constants', () => {
  it('exposes the expected raw sequences', () => {
    expect(ANSI.SAVE_CURSOR).toBe('\x1B[s')
    expect(ANSI.RESTORE_CURSOR).toBe('\x1B[u')
    expect(ANSI.ERASE_LINE_END).toBe('\x1B[0K')
    expect(ANSI.ERASE_SCREEN).toBe('\x1B[2J')
    expect(ANSI.ALT_SCREEN_ON).toBe('\x1B[?1049h')
    expect(ANSI.BEGIN_SYNC).toBe('\x1B[?2026h')
    expect(ANSI.RESET).toBe('\x1B[0m')
    expect(ANSI.BOLD).toBe('\x1B[1m')
  })
})

describe('rgbToXterm256 中间档（48 <= v < 115 → cube 档 1）', () => {
  it('覆盖 toCubeIdx 的中段分支（此前只有 0 与 255 两端）', () => {
    // toCubeIdx(100)：100 >= 48 且 < 115 → 1；cube 距 < 灰阶距 → 走立方
    expect(rgbToXterm256(100, 0, 0)).toBe(16 + 36 * 1) // 52
  })
})

describe('fg / bg 256 色量化（chalk.level === 2）', () => {
  it('hex 在 256 色终端量化为 38;5 / 48;5', () => {
    const saved = chalk.level
    chalk.level = 2
    try {
      expect(fg('#a8e6cf')).toMatch(/^\x1B\[38;5;\d+m$/)
      expect(bg('#a8e6cf')).toMatch(/^\x1B\[48;5;\d+m$/)
    } finally {
      chalk.level = saved
    }
  })
})

describe('hyperlink 无 override 时的检测缓存路径', () => {
  it('override 为 null 时走 detectHyperlinkSupport 并缓存结果', () => {
    setHyperlinksEnabled(null)
    const r1 = hyperlink('a', 'https://x.com')
    const r2 = hyperlink('b', 'https://x.com')
    // 同一支持状态下两次结果一致（第二次命中 detectedSupport 缓存）；
    // 两次差异仅在被包装文本（a/b），包装形态相同。
    expect(r1.replace('a', 'x')).toBe(r2.replace('b', 'x'))
  })
})

describe('imageProtocol 检测缓存二次命中', () => {
  it('override 为 null 且已检测后复用缓存', () => {
    setImageProtocol(null)
    const first = imageProtocol()
    const second = imageProtocol()
    expect(second).toBe(first)
  })
})
