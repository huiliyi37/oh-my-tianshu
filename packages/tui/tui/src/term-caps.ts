/**
 * 终端能力探测 — Windows legacy conhost（经典控制台）识别与降级开关。
 *
 * 背景：PowerShell/cmd 直启的经典 conhost（非 Windows Terminal）配中文点阵
 * 字体时，East-Asian Ambiguous 字符与 GBK 框线字符均按 2 列渲染，且大量
 * Unicode 字形（✶ ◐ ╭ ❯…）缺失显示为 tofu。LiveEngine 的相对光标回顶依赖
 * 逐行宽度估算，估算与实际渲染错位 → 回顶欠擦 → 旧帧逐帧堆叠进 scrollback。
 * 本模块提供判定信号，width.ts / 字形降级据此选择保守档。
 */

import chalk from 'chalk'

/**
 * 是否运行在 Windows legacy conhost（经典控制台）。
 * 启发式（supports-hyperlinks 等库同款）：win32 且无任何现代终端标记——
 * Windows Terminal 设 WT_SESSION、VS Code 设 TERM_PROGRAM、ConEmu 设
 * ConEmuANSI、mintty/Git Bash 设 TERM。全无 → 经典 conhost。
 * @param env - 环境变量（测试注入用，缺省 process.env）。
 * @param platform - 平台标识（测试注入用，缺省 process.platform）。
 * @returns 是否为经典 conhost。
 */
export function isLegacyWindowsConsole(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform !== 'win32') return false
  if (env.WT_SESSION || env.TERM_PROGRAM || env.ConEmuANSI) return false
  if (env.TERM) return false
  return true
}

/**
 * locale 是否 CJK（zh/ja/ko 前缀）。优先 env（POSIX 约定），Intl（OS locale）兜底。
 * @param env - 环境变量（测试注入用，缺省 process.env）。
 * @returns 是否为 CJK locale。
 */
export function isCjkLocale(env: NodeJS.ProcessEnv = process.env): boolean {
  const candidates = [env.LC_ALL ?? '', env.LC_CTYPE ?? '', env.LANG ?? '']
  if (candidates.some(l => /^(zh|ja|ko)/i.test(l.trim()))) return true
  // env 有显式值（无论 CJK 与否）时以 env 为准；仅 env 全空才用 Intl 兜底
  if (candidates.some(l => l.trim() !== '')) return false
  try {
    const locale = new Intl.DateTimeFormat().resolvedOptions().locale as string | undefined
    return /^(zh|ja|ko)/i.test(locale ?? '')
  } catch { /* ICU 缺失（WSL/Alpine 精简版）时仅用 env */ }
  return false
}

let legacyCjkCache: boolean | null = null

/**
 * legacy conhost 且 CJK 环境（宽度 full 档的触发条件）。进程内缓存一次。
 * @returns 是否命中 legacy CJK conhost。
 */
export function isLegacyCjkConsole(): boolean {
  if (legacyCjkCache === null) {
    legacyCjkCache = isLegacyWindowsConsole() && isCjkLocale()
  }
  return legacyCjkCache
}

let asciiGlyphCache: boolean | null = null

/**
 * 是否使用 ASCII 安全字形（spinner/thinking/工具卡的月相、星形等装饰字形）。
 * 原有门槛 chalk.level<3 保留；legacy conhost 无条件降级（字形缺失 + 宽度
 * 不可预测，与颜色能力无关）。env `RIVET_ASCII_UI=0/1` 显式覆盖。
 * @param env - 环境变量（测试注入用，缺省 process.env）。
 * @returns 是否降级为 ASCII 字形。
 */
export function useAsciiGlyphs(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.RIVET_ASCII_UI === '1') return true
  if (env.RIVET_ASCII_UI === '0') return false
  if (asciiGlyphCache === null) {
    /* v8 ignore next -- 测试进程非 TTY，chalk.level<3 恒短路；右侧为高色深终端专属场景 */
    asciiGlyphCache = chalk.level < 3 || isLegacyWindowsConsole()
  }
  return asciiGlyphCache
}

let asciiBorderCache: boolean | null = null

/**
 * 是否使用 ASCII 边框（输入框 chrome）。与字形开关分离：低色深终端
 * （tmux/screen 的 chalk.level 2）渲染 Unicode 框线完全正常，边框降级只在
 * 框线宽度不可预测的 legacy conhost 触发。env `RIVET_ASCII_UI=0/1` 显式覆盖。
 * @param env - 环境变量（测试注入用，缺省 process.env）。
 * @returns 是否降级为 ASCII 边框。
 */
export function useAsciiBorders(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.RIVET_ASCII_UI === '1') return true
  if (env.RIVET_ASCII_UI === '0') return false
  if (asciiBorderCache === null) {
    asciiBorderCache = isLegacyWindowsConsole()
  }
  return asciiBorderCache
}

/** 测试钩子：重置探测缓存。 */
export function resetTermCapsCache(): void {
  legacyCjkCache = null
  asciiGlyphCache = null
  asciiBorderCache = null
}
