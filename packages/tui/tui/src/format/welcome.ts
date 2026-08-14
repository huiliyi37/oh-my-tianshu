/**
 * 启动欢迎面（format/welcome.ts）— 纯渲染。
 *
 * 首屏骨架对齐 Claude Code LogoV2：左栏鲸鱼 + 品牌 + 环境行，右栏 Tips
 * （实用快捷键，不是可点菜单）。窄屏回落为垂直居中叠放。输入轨
 * 由 format/input-frame 承担，本模块只出欢迎块。
 * 宽度守恒：任何输入下每行显示宽度 ≤ width。
 */
import { color } from '../engine/ansi.js'
import type { RivetTheme } from '../theme.js'
import { displayWidth, truncateToDisplayWidth } from '../width.js'
import { WHALE_COLS } from './whale.js'

function truncateTo(text: string, columns: number): string {
  let out = ''
  for (const ch of text) {
    if (displayWidth(out + ch) > columns) break
    out += ch
  }
  return out
}

/** 在 width 内水平居中（左侧填充；右侧不补，宽度守恒即 ≤ width）。 */
function center(text: string, width: number): string {
  const left = Math.max(0, Math.floor((width - displayWidth(text)) / 2))
  return `${' '.repeat(left)}${text}`
}

/** 右侧空格补到 width；超宽 ANSI 安全截断。 */
function padTo(text: string, width: number): string {
  const w = displayWidth(text)
  if (w >= width) return truncateToDisplayWidth(text, width)
  return `${text}${' '.repeat(width - w)}`
}

/** 鲸鱼行前导空格（居中 indent）在左栏 zip 前剥掉；ANSI 码在空格之后。 */
function stripLeadingSpaces(line: string): string {
  let i = 0
  while (i < line.length && line[i] === ' ') i++
  return line.slice(i)
}

/** formatBrandWelcome 的渲染输入。 */
export interface FormatBrandWelcomeInput {
  width: number
  /** 品牌名（缺省 'DSH'）。 */
  brand?: string
  /** 副标题（缺省 'dsh × Tianshu Harness'）。 */
  subtitle?: string
  /** 水平对齐；hero 左栏用 left，窄屏叠放用 center（缺省）。 */
  align?: 'center' | 'left'
}

/**
 * 欢迎页品牌区：主标 brand（BOLD brandColor）+ 副标题（muted），各一行。
 * @param input - 宽度、品牌名、副标题与对齐。
 * @param theme - 当前主题（主标 brandColor BOLD，副标题 muted）。
 * @returns 两行 ANSI；width ≤ 0 返回空数组。
 */
export function formatBrandWelcome(input: FormatBrandWelcomeInput, theme: RivetTheme): string[] {
  if (input.width <= 0) return []
  const brand = truncateTo(input.brand ?? 'DSH', input.width)
  const subtitle = truncateTo(input.subtitle ?? 'dsh × Tianshu Harness', input.width)
  const brandLine = color(brand, theme.brandColor, { bold: true })
  const subLine = color(subtitle, theme.muted)
  if (input.align === 'left') return [brandLine, subLine]
  return [center(brandLine, input.width), center(subLine, input.width)]
}

/**
 * 首次启动环境检查结果，供欢迎页环境行使用。
 */
export interface WelcomeEnvCheck {
  /** API key 是否已配置（env / credentials 文件 / .env 分层，非仅环境变量）。 */
  hasApiKey: boolean
  /** 当前目录是否为 git 仓库（git status 可执行）。 */
  isGitRepo: boolean
  /** 当前主题引用名（如 'graphite'，环境行首段展示）。 */
  themeName: string
  /** 终端列数（宽度预算）。 */
  cols: number
  /** 水平对齐；hero 左栏用 left，窄屏叠放用 center（缺省）。 */
  align?: 'center' | 'left'
}

/**
 * 环境检查紧凑行（欢迎页常驻）：`graphite · API Key ✓ · Git ✓`。
 * 缺 API key 时该段换 warning 色并携带可行动提示（设 DEEPSEEK_API_KEY）；
 * git ✗ 仅信息性展示。用「API Key」措辞（非 footer 的「API ✗」）。
 * @param env - 环境检查结果（主题名/API key/git/对齐）。
 * @param theme - 当前主题（muted；缺 key 段 warning）。
 * @returns 单行 ANSI；cols ≤ 0 返回空数组。
 */
export function formatEnvCheckLine(env: WelcomeEnvCheck, theme: RivetTheme): string[] {
  if (env.cols <= 0) return []
  const sep = color(' · ', theme.muted)
  const api = env.hasApiKey
    ? color('API Key ✓', theme.muted)
    : color('API Key ✗（设 DEEPSEEK_API_KEY）', theme.warning)
  const git = color(`Git ${env.isGitRepo ? '✓' : '✗'}`, theme.muted)
  const line = `${color(env.themeName, theme.muted)}${sep}${api}${sep}${git}`
  const aligned = env.align === 'left' ? line : center(line, env.cols)
  return [truncateToDisplayWidth(aligned, env.cols)]
}

/** 欢迎页 Tips 一项（快捷键 + 说明；不可用项整行 muted）。 */
export interface WelcomeTipItem {
  /** 快捷键（如 'ctrl+n'、'/'）。 */
  keyHint: string
  /** 说明（如 '新会话'）。 */
  label: string
  /** 可用性；false 时整行 muted（如无可恢复会话）。 */
  available?: boolean
}

/** formatWelcomeTips 的渲染输入。 */
export interface FormatWelcomeTipsInput {
  width: number
  items: readonly WelcomeTipItem[]
  /** 水平对齐；宽屏右栏 left，窄屏叠放 center（缺省 left）。 */
  align?: 'center' | 'left'
}

/**
 * 欢迎页右栏 Tips：标题 + 快捷键列对齐 + 说明。
 * 不可用项整行 muted 且仍显示 keyHint（与旧菜单不同：tips 要让用户知道键还在）。
 * 空 items 仍渲染标题（调用方恒有一组默认 tips）。
 * @param input - 宽度、tips 项与对齐。
 * @param theme - 当前主题（标题 brandColor，hint secondary，说明 muted）。
 * @returns ANSI 行数组。
 */
export function formatWelcomeTips(input: FormatWelcomeTipsInput, theme: RivetTheme): string[] {
  const { width, items } = input
  if (width <= 0) return []
  const budget = Math.max(0, width - 1)
  let hintCol = 0
  for (const item of items) {
    hintCol = Math.max(hintCol, displayWidth(item.keyHint))
  }
  const rows: string[] = []
  const title = color('Tips', theme.brandColor, { bold: true })
  rows.push(title)
  for (const item of items) {
    const hintPad = Math.max(0, hintCol - displayWidth(item.keyHint))
    const hintText = `${item.keyHint}${' '.repeat(hintPad)}`
    const body = `${hintText}  ${item.label}`
    const truncated = truncateTo(body, budget)
    if (item.available === false) {
      rows.push(color(truncated, theme.muted))
      continue
    }
    const hintPart = color(hintText, theme.secondary)
    const labelPart = color(`  ${truncateTo(item.label, Math.max(0, budget - hintCol - 2))}`, theme.muted)
    rows.push(displayWidth(body) > budget ? color(truncated, theme.muted) : `${hintPart}${labelPart}`)
  }
  if (input.align === 'center') {
    let blockW = 0
    for (const row of rows) blockW = Math.max(blockW, displayWidth(row))
    blockW = Math.min(blockW, budget)
    const indent = ' '.repeat(Math.max(0, Math.floor((width - blockW) / 2)))
    return rows.map(row => truncateToDisplayWidth(`${indent}${row}`, budget))
  }
  return rows.map(row => truncateToDisplayWidth(row, budget))
}

/** 宽屏左品牌 / 右 tips 的最小列数。 */
export const WELCOME_HERO_WIDE_MIN = 72

/** 欢迎区 / live chrome 左侧留白（列）。避免鲸鱼、品牌、输入轨贴边。 */
export const CHROME_GUTTER = 2

/** 左右栏间隙列数。 */
const HERO_GAP = 3

/** 右栏 tips 放不下时回落叠放的最小宽度。 */
const TIPS_MIN_WIDTH = 18

/** formatWelcomeHero 的渲染输入。 */
export interface FormatWelcomeHeroInput {
  width: number
  /** 已渲染的鲸鱼行（可能为空：窄屏/无色/legacy 降级）。 */
  whale: readonly string[]
  env: WelcomeEnvCheck
  tips: readonly WelcomeTipItem[]
}

/**
 * 欢迎英雄区：宽屏左鲸鱼/品牌/环境 + 右 Tips zip；窄屏垂直居中叠放。
 * @param input - 终端宽、鲸鱼行、环境检查、tips 项。
 * @param theme - 当前主题。
 * @returns ANSI 行数组；width ≤ 0 返回空数组。
 */
export function formatWelcomeHero(input: FormatWelcomeHeroInput, theme: RivetTheme): string[] {
  const { width, whale, tips } = input
  if (width <= 0) return []
  const env = { ...input.env, cols: width }

  const stacked = (): string[] => {
    const out: string[] = []
    if (whale.length > 0) {
      out.push(...whale)
      out.push('')
    }
    out.push(...formatBrandWelcome({ width, align: 'center' }, theme))
    out.push('')
    out.push(...formatEnvCheckLine({ ...env, cols: width, align: 'center' }, theme))
    out.push('')
    out.push(...formatWelcomeTips({ width, items: tips, align: 'center' }, theme))
    return out
  }

  if (width < WELCOME_HERO_WIDE_MIN) return stacked()

  const gutter = width >= CHROME_GUTTER * 2 + TIPS_MIN_WIDTH ? CHROME_GUTTER : 0
  const inner = width - gutter
  const brand = formatBrandWelcome({ width: inner, align: 'left' }, theme)
  const envLeft = formatEnvCheckLine({ ...env, cols: inner, align: 'left' }, theme)
  const whaleStripped = whale.map(stripLeadingSpaces)
  let leftW = WHALE_COLS
  for (const line of [...whaleStripped, ...brand, ...envLeft]) {
    leftW = Math.max(leftW, displayWidth(line))
  }
  const rightW = inner - leftW - HERO_GAP
  if (rightW < TIPS_MIN_WIDTH) return stacked()

  const leftCol: string[] = []
  if (whaleStripped.length > 0) {
    leftCol.push(...whaleStripped)
    leftCol.push('')
  }
  leftCol.push(...brand)
  leftCol.push(...envLeft)

  const rightCol = formatWelcomeTips({ width: rightW, items: tips, align: 'left' }, theme)
  const rows = Math.max(leftCol.length, rightCol.length)
  const gap = ' '.repeat(HERO_GAP)
  const pad = ' '.repeat(gutter)
  const out: string[] = []
  for (let i = 0; i < rows; i++) {
    const left = padTo(leftCol[i] ?? '', leftW)
    const right = rightCol[i] ?? ''
    out.push(truncateToDisplayWidth(`${pad}${left}${gap}${right}`, width))
  }
  return out
}
