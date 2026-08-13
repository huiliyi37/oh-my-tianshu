import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isCjkLocale,
  isLegacyCjkConsole,
  isLegacyWindowsConsole,
  resetTermCapsCache,
  useAsciiBorders,
  useAsciiGlyphs,
} from '../src/term-caps.js'
import {
  ambiguousWidthMode,
  ambiguousWideEnabled,
  displayWidth,
  resetWidthModeCache,
  truncateToDisplayWidth,
} from '../src/width.js'
import {
  autoThemeFor,
  detectTerminalBackground,
  parseColorFgBg,
  parseOsc11Luminance,
} from '../src/theme-detect.js'
import { pinTuiEnvBaseline } from './env-baseline.ts'

// 包级环境基线：固定 LANG 为非 CJK 并清 RIVET 覆盖——中文机器的 zh 环境会让
// 隐式检测路径（isLegacyCjkConsole → full 宽度模式）与英文机器行为不同，
// 导致 displayWidth/ambiguous 断言换台机器就红。
pinTuiEnvBaseline()

describe('isLegacyWindowsConsole', () => {
  it('returns false on non-win32 platforms', () => {
    expect(isLegacyWindowsConsole({}, 'darwin')).toBe(false)
    expect(isLegacyWindowsConsole({ WT_SESSION: 'x' }, 'win32')).toBe(false)
  })

  it('treats a bare win32 without modern terminal markers as legacy', () => {
    expect(isLegacyWindowsConsole({}, 'win32')).toBe(true)
  })

  it('recognizes modern terminal markers on win32', () => {
    expect(isLegacyWindowsConsole({ WT_SESSION: 'wt' }, 'win32')).toBe(false)
    expect(isLegacyWindowsConsole({ TERM_PROGRAM: 'vscode' }, 'win32')).toBe(false)
    expect(isLegacyWindowsConsole({ ConEmuANSI: 'ON' }, 'win32')).toBe(false)
    expect(isLegacyWindowsConsole({ TERM: 'xterm-256color' }, 'win32')).toBe(false)
  })
})

describe('isCjkLocale', () => {
  it('detects zh/ja/ko prefixes from env candidates', () => {
    expect(isCjkLocale({ LANG: 'zh_CN.UTF-8' })).toBe(true)
    expect(isCjkLocale({ LC_ALL: 'ja_JP.UTF-8' })).toBe(true)
    expect(isCjkLocale({ LC_CTYPE: 'ko_KR.UTF-8' })).toBe(true)
  })

  it('returns false for non-CJK locales', () => {
    expect(isCjkLocale({ LANG: 'en_US.UTF-8' })).toBe(false)
  })

  it('falls back to Intl locale when env is empty', () => {
    // The OS locale may or may not be CJK; the function must not throw and
    // must return a boolean either way.
    const result = isCjkLocale({})
    expect(typeof result).toBe('boolean')
  })
})

describe('useAsciiGlyphs / useAsciiBorders', () => {
  it('honors the RIVET_ASCII_UI override', () => {
    expect(useAsciiGlyphs({ RIVET_ASCII_UI: '1' })).toBe(true)
    expect(useAsciiGlyphs({ RIVET_ASCII_UI: '0' })).toBe(false)
    expect(useAsciiBorders({ RIVET_ASCII_UI: '1' })).toBe(true)
    expect(useAsciiBorders({ RIVET_ASCII_UI: '0' })).toBe(false)
  })

  it('honors the ASCII override env without platform dependence', () => {
    resetTermCapsCache()
    expect(useAsciiGlyphs({ RIVET_ASCII_UI: '1' })).toBe(true)
    expect(useAsciiGlyphs({ RIVET_ASCII_UI: '0' })).toBe(false)
  })

  it('returns a boolean without override', () => {
    resetTermCapsCache()
    expect(typeof useAsciiBorders({})).toBe('boolean')
  })

  it('useAsciiGlyphs 无 override 时探测一次并缓存', () => {
    resetTermCapsCache()
    expect(typeof useAsciiGlyphs({})).toBe('boolean')
    // 二次调用：asciiGlyphCache 非 null → 缓存命中分支
    expect(typeof useAsciiGlyphs({})).toBe('boolean')
  })

  it('useAsciiBorders 无 override 时缓存命中', () => {
    resetTermCapsCache()
    expect(typeof useAsciiBorders({})).toBe('boolean')
    // 二次调用：asciiBorderCache 非 null → 缓存命中分支
    expect(typeof useAsciiBorders({})).toBe('boolean')
  })
})

describe('isLegacyCjkConsole', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    resetTermCapsCache()
  })

  it('win32 无标记 + CJK env → true，且 && 右侧与缓存命中均被覆盖', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const saved = new Map<string, string | undefined>()
    for (const key of ['WT_SESSION', 'TERM_PROGRAM', 'ConEmuANSI', 'TERM']) {
      saved.set(key, process.env[key])
      // oxlint no-dynamic-delete：Reflect.deleteProperty 等价删除动态键
      Reflect.deleteProperty(process.env, key)
    }
    try {
      // beforeEach 固定 LANG 为非 CJK（防跨机器 flakiness）——本用例需要 CJK env
      process.env.LANG = 'zh_CN.UTF-8'
      resetTermCapsCache()
      // 首次调用：legacyCjkCache 为 null → 进入 if 体，isLegacyWindowsConsole() && isCjkLocale()
      // 右侧（win32 + CJK）被求值
      expect(isLegacyCjkConsole()).toBe(true)
      // 二次调用：缓存命中，跳过探测
      expect(isLegacyCjkConsole()).toBe(true)
    } finally {
      process.env.LANG = 'en_US.UTF-8'
      for (const [key, value] of saved) {
        if (value === undefined) Reflect.deleteProperty(process.env, key)
        else process.env[key] = value
      }
    }
  })
})

describe('displayWidth', () => {
  it('counts ASCII width', () => {
    expect(displayWidth('hello')).toBe(5)
  })

  it('counts CJK as 2 columns', () => {
    expect(displayWidth('你好')).toBe(4)
  })

  it('ignores ANSI escape sequences', () => {
    expect(displayWidth('\x1B[31mred\x1B[0m')).toBe(3)
  })

  it('ignores OSC 8 hyperlink sequences', () => {
    expect(displayWidth('\x1B]8;;https://example.com\x07link\x1B]8;;\x07')).toBe(4)
  })

  it('adds ambiguous-width increments when ambiguousAsWide is set', () => {
    // U+2014 em dash is East-Asian Ambiguous: narrow counts 1, wide counts 2.
    // 固定 narrow 模式：无 env 时 ambiguousWidthMode 依赖 OS locale 检测
    // （CJK 机器 → full），会让「narrow=1」断言换台机器就红。
    process.env.RIVET_AMBIGUOUS_WIDTH = 'narrow'
    resetWidthModeCache()
    expect(displayWidth('—')).toBe(1)
    expect(displayWidth('—', { ambiguousAsWide: true })).toBe(2)
  })
})

describe('truncateToDisplayWidth', () => {
  it('returns the text unchanged when within budget', () => {
    expect(truncateToDisplayWidth('abc', 5)).toBe('abc')
  })

  it('truncates by display width', () => {
    expect(truncateToDisplayWidth('abcdef', 3)).toBe('abc')
  })

  it('counts CJK width while truncating', () => {
    expect(truncateToDisplayWidth('你好世界', 4)).toBe('你好')
  })

  it('returns empty for non-positive budgets', () => {
    expect(truncateToDisplayWidth('abc', 0)).toBe('')
    expect(truncateToDisplayWidth('abc', -1)).toBe('')
  })

  it('appends a reset when ANSI was truncated', () => {
    const out = truncateToDisplayWidth('\x1B[31mabcdef', 3)
    expect(out.startsWith('\x1B[31mabc')).toBe(true)
    expect(out.endsWith('\x1B[0m')).toBe(true)
  })

  it('preserves ANSI sequences before the cut point', () => {
    const out = truncateToDisplayWidth('\x1B[1mbold text here', 4)
    expect(out).toBe('\x1B[1mbold\x1B[0m')
  })

  it('截断未闭合的 OSC 8 链接时补闭合', () => {
    const out = truncateToDisplayWidth('\x1B]8;;https://example.com\x07click here', 8)
    expect(out.startsWith('\x1B]8;;https://example.com\x07click')).toBe(true)
    expect(out.endsWith('\x1B]8;;\x07\x1B[0m')).toBe(true)
  })

  it('wide 模式下非 ambiguous 字符不加宽', () => {
    expect(displayWidth('abc', { ambiguousAsWide: true })).toBe(3)
    expect(truncateToDisplayWidth('abcdef', 4, { ambiguousAsWide: true })).toBe('abcd')
  })

  it('full 模式把 box/block 字符也按双宽计', () => {
    const original = process.env.RIVET_AMBIGUOUS_WIDTH
    process.env.RIVET_AMBIGUOUS_WIDTH = 'full'
    try {
      resetWidthModeCache()
      expect(displayWidth('─', { ambiguousAsWide: true })).toBe(2)
      expect(truncateToDisplayWidth('───', 3, { ambiguousAsWide: true })).toBe('─')
    } finally {
      if (original === undefined) delete process.env.RIVET_AMBIGUOUS_WIDTH
      else process.env.RIVET_AMBIGUOUS_WIDTH = original
      resetWidthModeCache()
    }
  })
})

describe('ambiguousWidthMode', () => {
  const original = process.env.RIVET_AMBIGUOUS_WIDTH
  afterEach(() => {
    if (original === undefined) delete process.env.RIVET_AMBIGUOUS_WIDTH
    else process.env.RIVET_AMBIGUOUS_WIDTH = original
  })

  it('prefers the explicit env value', () => {
    process.env.RIVET_AMBIGUOUS_WIDTH = 'wide'
    expect(ambiguousWidthMode()).toBe('wide')
    expect(ambiguousWideEnabled()).toBe(true)
    process.env.RIVET_AMBIGUOUS_WIDTH = 'full'
    expect(ambiguousWidthMode()).toBe('full')
    process.env.RIVET_AMBIGUOUS_WIDTH = 'narrow'
    expect(ambiguousWidthMode()).toBe('narrow')
    expect(ambiguousWideEnabled()).toBe(false)
  })

  it('falls back to a detected mode without env', () => {
    delete process.env.RIVET_AMBIGUOUS_WIDTH
    resetWidthModeCache()
    expect(['narrow', 'full']).toContain(ambiguousWidthMode())
  })
})

describe('parseOsc11Luminance', () => {
  it('parses rgb payloads with normalized component widths', () => {
    // dcdc/dcdc/dcdc ≈ 0.8627 each → luminance ~0.8627 (light)
    const lum = parseOsc11Luminance(']11;rgb:dcdc/dcdc/dcdc\x07')
    expect(lum).not.toBeNull()
    expect(lum!).toBeGreaterThan(0.8)
  })

  it('returns null for unparsable responses', () => {
    expect(parseOsc11Luminance(']11;rgb:zz/zz/zz\x07')).toBeNull()
    expect(parseOsc11Luminance('hello')).toBeNull()
    expect(parseOsc11Luminance('')).toBeNull()
  })

  it('distinguishes dark backgrounds', () => {
    const lum = parseOsc11Luminance('rgb:0000/0000/0000')
    expect(lum).toBe(0)
  })
})

describe('parseColorFgBg', () => {
  it('parses COLORFGBG-style strings', () => {
    expect(parseColorFgBg('15;0')).toBe('dark')
    expect(parseColorFgBg('0;15')).toBe('light')
    expect(parseColorFgBg('12;7')).toBe('light')
    expect(parseColorFgBg('0;8')).toBe('dark')
  })

  it('returns null for missing or malformed input', () => {
    expect(parseColorFgBg(undefined)).toBeNull()
    expect(parseColorFgBg('')).toBeNull()
    expect(parseColorFgBg('abc')).toBeNull()
    expect(parseColorFgBg('15;')).toBeNull()
  })
})

describe('autoThemeFor', () => {
  it('maps dark to graphite and light to paper', () => {
    expect(autoThemeFor('dark')).toBe('graphite')
    expect(autoThemeFor('light')).toBe('paper')
  })
})

describe('detectTerminalBackground', () => {
  /** TTY stdin 替身：模拟 InputHandler 接管后的状态（raw mode 已开、流动态）。 */
  function makeTtyStdin(): { stdin: NodeJS.ReadStream & { paused: boolean }; setRawMode: ReturnType<typeof vi.fn> } {
    const stdin = new EventEmitter() as unknown as NodeJS.ReadStream & { paused: boolean }
    const setRawMode = vi.fn()
    stdin.isTTY = true
    stdin.isRaw = true
    stdin.paused = false
    stdin.setRawMode = setRawMode
    stdin.resume = vi.fn(() => { stdin.paused = false; return stdin })
    stdin.pause = vi.fn(() => { stdin.paused = true; return stdin })
    stdin.isPaused = vi.fn(() => stdin.paused)
    return { stdin, setRawMode }
  }

  const makeTtyStdout = (): NodeJS.WriteStream =>
    ({ isTTY: true, write: vi.fn() }) as unknown as NodeJS.WriteStream

  it('parses a light-background OSC 11 response and keeps stdin flowing', async () => {
    const { stdin, setRawMode } = makeTtyStdin()
    const pending = detectTerminalBackground({ stdin, stdout: makeTtyStdout(), env: {} })
    stdin.emit('data', Buffer.from('\x1B]11;rgb:ffff/ffff/ffff\x07', 'latin1'))
    await expect(pending).resolves.toBe('light')
    // 回归：检测结束不得 pause 已被 InputHandler resume 的 stdin，否则 TUI 输入全死
    expect(stdin.paused).toBe(false)
    // wasRaw=true：raw mode 是进入时就有的，退出时不应关
    expect(setRawMode).not.toHaveBeenCalled()
  })

  it('keeps stdin flowing when the OSC 11 query times out', async () => {
    const { stdin } = makeTtyStdin()
    await expect(
      detectTerminalBackground({ stdin, stdout: makeTtyStdout(), env: {}, timeoutMs: 10 }),
    ).resolves.toBe('dark')
    expect(stdin.paused).toBe(false)
  })

  it('restores a paused-at-entry stdin to paused', async () => {
    const { stdin } = makeTtyStdin()
    stdin.paused = true
    await expect(
      detectTerminalBackground({ stdin, stdout: makeTtyStdout(), env: {}, timeoutMs: 10 }),
    ).resolves.toBe('dark')
    expect(stdin.paused).toBe(true)
  })

  it('非 TTY（管道）直接走 COLORFGBG 兜底，无 COLORFGBG 时落到 dark', async () => {
    const nonTty = { isTTY: false, write: vi.fn() } as unknown as NodeJS.ReadStream & NodeJS.WriteStream
    await expect(
      detectTerminalBackground({ stdin: nonTty, stdout: nonTty, env: { COLORFGBG: '0;15' } }),
    ).resolves.toBe('light')
    await expect(
      detectTerminalBackground({ stdin: nonTty, stdout: nonTty, env: {} }),
    ).resolves.toBe('dark')
  })

  it('OSC 11 超时但 COLORFGBG 有效 → 用 COLORFGBG 兜底', async () => {
    const { stdin } = makeTtyStdin()
    await expect(
      detectTerminalBackground({ stdin, stdout: makeTtyStdout(), env: { COLORFGBG: '0;15' }, timeoutMs: 10 }),
    ).resolves.toBe('light')
  })

  it('深色 OSC 11 响应 → dark', async () => {
    const { stdin } = makeTtyStdin()
    const pending = detectTerminalBackground({ stdin, stdout: makeTtyStdout(), env: {} })
    stdin.emit('data', Buffer.from('\x1B]11;rgb:0000/0000/0000\x07', 'latin1'))
    await expect(pending).resolves.toBe('dark')
  })

  it('不可解析的 OSC 11 响应 → 兜底 dark', async () => {
    const { stdin } = makeTtyStdin()
    const pending = detectTerminalBackground({ stdin, stdout: makeTtyStdout(), env: {} })
    stdin.emit('data', Buffer.from('\x1B]11;rgb:zz/zz/zz\x07', 'latin1'))
    await expect(pending).resolves.toBe('dark')
  })

  it('OSC 响应不含终止符时不提前结束，超时兜底 dark', async () => {
    const { stdin } = makeTtyStdin()
    const pending = detectTerminalBackground({ stdin, stdout: makeTtyStdout(), env: {}, timeoutMs: 10 })
    // 无 BEL/ST 终止符 → onData 不 finish，等 timer 超时
    stdin.emit('data', Buffer.from('garbage', 'latin1'))
    await expect(pending).resolves.toBe('dark')
  })

  it('wasRaw=false 时进入打开 raw mode、退出时恢复', async () => {
    const { stdin, setRawMode } = makeTtyStdin()
    stdin.isRaw = false
    await expect(
      detectTerminalBackground({ stdin, stdout: makeTtyStdout(), env: {}, timeoutMs: 10 }),
    ).resolves.toBe('dark')
    expect(setRawMode).toHaveBeenCalledWith(true)
    expect(setRawMode).toHaveBeenCalledWith(false)
  })

  it('raw mode 启动失败（resume 抛异常）→ 内层兜底 dark', async () => {
    const { stdin } = makeTtyStdin()
    stdin.resume = vi.fn(() => { throw new Error('resume boom') })
    await expect(
      detectTerminalBackground({ stdin, stdout: makeTtyStdout(), env: {} }),
    ).resolves.toBe('dark')
  })

  it('finish 恢复流程抛异常 → 外层兜底 dark', async () => {
    const { stdin } = makeTtyStdin()
    stdin.resume = vi.fn(() => { throw new Error('resume boom') })
    stdin.off = vi.fn(() => { throw new Error('off boom') })
    await expect(
      detectTerminalBackground({ stdin, stdout: makeTtyStdout(), env: {} }),
    ).resolves.toBe('dark')
  })
})
