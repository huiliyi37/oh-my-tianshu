/**
 * 显示宽度度量 — 解决 string-width 的窄宽假设与终端实际渲染的错位。
 *
 * 背景：`string-width` 把 East-Asian **Ambiguous** 字符（如 `—` `…` `↑↓` `·`）
 * 一律按 1 列计；但很多终端（尤其 CJK 环境/字体）把这些符号按 2 列渲染。
 * LiveEngine 据 string-width 估算每行占几个显示行（`rowsForLine`），低估后
 * 相对光标回顶量不足 → 旧帧顶部泄漏进 scrollback（输入框重影/重叠）。
 *
 * 关键陷阱：Unicode 把 **box-drawing / block**（U+2500–U+259F，如 `─ │ ╭ █`）
 * 也归为 ambiguous，但 xterm 系终端普遍按 **1 列** 渲染它们。若把所有 ambiguous
 * 当宽，会把输入框边框算成双宽 → over-erase 反噬 scrollback。因此 wide 模式只对
 * **非 box/block 的 ambiguous 符号** 叠加 +1 宽度增量。
 *
 * 但 Windows legacy conhost（GBK 中文字体）连框线字符也按 **2 列** 渲染——
 * wide 档在那里仍会低估边框行宽度 → 折行 → 回顶欠擦。为此增设 **full 档**：
 * box/block 一并 +1。三档语义：
 * - narrow：= string-width（默认，xterm 系）
 * - wide：非 box/block 的 ambiguous +1（CJK xterm 终端）
 * - full：所有 ambiguous 含 box/block +1（legacy CJK conhost，自动探测默认）
 *
 * 度量建立在 `string-width` 之上（继承其对 emoji/ZWJ/组合符/控制符的正确处理），
 * narrow 模式与 string-width 完全一致（零回归）。
 */

import stringWidth from 'string-width'
import { eastAsianWidthType } from 'get-east-asian-width'
import { isLegacyCjkConsole } from './term-caps.js'

// CSI（\x1B[…m 等，中间字符含 ? 的 DEC private mode 如 \x1B[?25h 亦计入）
// + OSC（\x1B]…BEL / …ST，含 OSC 8 超链接）。OSC 的 payload 是可打印 ASCII
// （URL），若只剥 CSI 会把 URL 当可见字符计宽 → 截断/padding 错位。
const ANSI_RE = /\x1B(?:\[[0-9;?]*[a-zA-Z]|\][^\x07\x1B]*(?:\x07|\x1B\\))/g
/** 黏附匹配（按位置）用于截断时识别转义序列。 */
const ANSI_STICKY = /\x1B(?:\[[0-9;?]*[a-zA-Z]|\][^\x07\x1B]*(?:\x07|\x1B\\))/y
const RESET = '\x1B[0m'
const OSC8_OPEN_RE = /\x1B\]8;[^\x07\x1B]*(?:\x07|\x1B\\)/g
const OSC8_CLOSE = '\x1B]8;;\x07'

/** box-drawing（U+2500–257F）与 block elements（U+2580–259F）：终端均按 1 列渲染。 */
function isBoxOrBlock(cp: number): boolean {
  return cp >= 0x2500 && cp <= 0x259f
}

/** 一个 code point 在 wide/full 模式下相对 string-width 的额外宽度（0 或 1）。 */
function ambiguousExtraForCp(cp: number): number {
  if (isBoxOrBlock(cp)) return ambiguousWidthMode() === 'full' ? 1 : 0
  return eastAsianWidthType(cp) === 'ambiguous' ? 1 : 0
}

/** 去掉 ANSI 后逐 code point 累计的 ambiguous 额外宽度。 */
function ambiguousExtra(plain: string): number {
  let extra = 0
  for (const ch of plain) {
    const cp = ch.codePointAt(0)
    /* v8 ignore next -- for-of 迭代的单个字符必有值；noUncheckedIndexedAccess 收窄防御 */
    if (cp === undefined) continue
    extra += ambiguousExtraForCp(cp)
  }
  return extra
}

/** ambiguous 字符宽度档位（三档语义见模块头注释）。 */
export type AmbiguousWidthMode = 'narrow' | 'wide' | 'full'

let detectedModeCache: AmbiguousWidthMode | null = null

/**
 * 宽度模式：env `RIVET_AMBIGUOUS_WIDTH` 显式值优先（narrow/wide/full），
 * 未设时按终端探测——legacy CJK conhost（GBK 字体连框线都按 2 列渲染）
 * 默认 full，其余平台默认 narrow（与历史行为一致）。
 * @returns 生效的宽度档位（探测结果进程内缓存）。
 */
export function ambiguousWidthMode(): AmbiguousWidthMode {
  const env = (process.env.RIVET_AMBIGUOUS_WIDTH ?? '').toLowerCase()
  if (env === 'wide') return 'wide'
  if (env === 'full') return 'full'
  if (env === 'narrow') return 'narrow'
  if (detectedModeCache === null) {
    detectedModeCache = isLegacyCjkConsole() ? 'full' : 'narrow'
  }
  return detectedModeCache
}

/**
 * 兼容旧布尔口径：wide 或 full 均视为启用（消费方只区分「是否加宽」）。
 * @returns 是否启用 ambiguous 加宽。
 */
export function ambiguousWideEnabled(): boolean {
  return ambiguousWidthMode() !== 'narrow'
}

/** 测试钩子：重置探测缓存。 */
export function resetWidthModeCache(): void {
  detectedModeCache = null
}

/** 宽度度量选项（displayWidth / wrapToDisplayWidth / truncateToDisplayWidth 共用）。 */
export interface DisplayWidthOptions {
  /** 把非 box/block 的 ambiguous 符号按 2 列计。缺省跟随全局档位
   *  ambiguousWideEnabled()——与 LiveEngine.rowsForLine 的度量口径一致，
   *  避免折叠点与行数估算错位。 */
  ambiguousAsWide?: boolean
}

/**
 * 按显示宽度断行（ANSI 安全：转义序列原样保留、不计宽；不吞字符）。
 * 已在预算内的整段返回单行。每行从当前字符重新累积宽度——调用方若需
 * 每行带固定前缀（如说话人导轨），应把前缀宽度计入 max 或逐行拼装。
 * @param text - 待断行文本（可含 ANSI）。
 * @param max - 每行最大显示宽度。
 * @param opts - 宽度度量选项（透传 displayWidth）。
 * @returns 断行结果（不包含换行符的行数组）。
 */
export function wrapToDisplayWidth(text: string, max: number, opts: DisplayWidthOptions = {}): string[] {
  if (max <= 0) return []
  const wide = opts.ambiguousAsWide ?? ambiguousWideEnabled()
  const lines: string[] = []
  let current = ''
  let w = 0
  let i = 0
  let sawAnsi = false
  while (i < text.length) {
    ANSI_STICKY.lastIndex = i
    const m = ANSI_STICKY.exec(text)
    if (m && m.index === i) {
      current += m[0]
      i += m[0].length
      sawAnsi = true
      continue
    }
    const cp = text.codePointAt(i)
    /* v8 ignore next -- i 恒 < text.length，codePointAt 必有值；noUncheckedIndexedAccess 收窄防御 */
    if (cp === undefined) break
    const ch = String.fromCodePoint(cp)
    let cw = stringWidth(ch)
    if (wide) cw += ambiguousExtraForCp(cp)
    if (w + cw > max && w > 0) {
      // 行尾补 RESET 防止颜色泄漏到下一行（仅在确有 ANSI 时）
      lines.push(sawAnsi ? `${current}\u001b[0m` : current)
      current = ''
      w = 0
      sawAnsi = false
      continue
    }
    current += ch
    w += cw
    i += ch.length
  }
  lines.push(current)
  return lines
}

/**
 * 文本的显示宽度（已忽略 ANSI 转义）。
 * @param text - 待度量文本（可含 ANSI）。
 * @param opts - 宽度度量选项。
 * @returns 显示宽度（列数）。
 */
export function displayWidth(text: string, opts: DisplayWidthOptions = {}): number {
  const plain = text.replace(ANSI_RE, '')
  const base = stringWidth(plain)
  if (!(opts.ambiguousAsWide ?? ambiguousWideEnabled())) return base
  return base + ambiguousExtra(plain)
}

/**
 * 按显示宽度截断（ANSI 安全：转义序列原样保留、不计宽；截断发生时补一个 RESET
 * 防止颜色泄漏到后续行）。已在预算内则原样返回。
 * @param text - 待截断文本（可含 ANSI）。
 * @param max - 最大显示宽度（<=0 返回空串）。
 * @param opts - 宽度度量选项。
 * @returns 截断结果（含 ANSI 时补 RESET，OSC 8 链接被切开时先补闭合）。
 */
export function truncateToDisplayWidth(text: string, max: number, opts: DisplayWidthOptions = {}): string {
  if (max <= 0) return ''
  if (displayWidth(text, opts) <= max) return text
  const wide = opts.ambiguousAsWide ?? ambiguousWideEnabled()
  let out = ''
  let w = 0
  let i = 0
  let sawAnsi = false
  while (i < text.length) {
    ANSI_STICKY.lastIndex = i
    const m = ANSI_STICKY.exec(text)
    if (m && m.index === i) {
      /* jscpd:ignore-start */
      out += m[0]
      i += m[0].length
      sawAnsi = true
      continue
    }
    const cp = text.codePointAt(i)
    /* v8 ignore next -- i 恒 < text.length，codePointAt 必有值；noUncheckedIndexedAccess 收窄防御 */
    if (cp === undefined) break
    const ch = String.fromCodePoint(cp)
    let cw = stringWidth(ch)
    if (wide) cw += ambiguousExtraForCp(cp)
    if (w + cw > max) break
    /* jscpd:ignore-end */
    out += ch
    w += cw
    i += ch.length
  }
  if (!sawAnsi) return out
  // OSC 8 链接开在截断点之前、闭在截断点之后时补闭合，防止链接吞掉后续输出。
  const oscSeqs = out.match(OSC8_OPEN_RE) ?? []
  const lastOsc = oscSeqs[oscSeqs.length - 1]
  const unclosedLink = lastOsc !== undefined && !/^\x1B\]8;;(?:\x07|\x1B\\)$/.test(lastOsc)
  return unclosedLink ? out + OSC8_CLOSE + RESET : out + RESET
}
