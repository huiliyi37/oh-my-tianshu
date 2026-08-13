/**
 * 启动欢迎面（format/welcome.ts）— 纯渲染。
 *
 * 首屏骨架对齐 grok 欢迎页（views/welcome/）：品牌区居中（主标 + 副标）、
 * 菜单居中（label 左 BOLD + 快捷键右对齐，grok menu.rs 形态）、环境检查
 * 压成一行（formatEnvCheckLine）。无四周边框线——延续 C4 概念稿 B 的纯净感。
 * 宽度守恒：任何输入下每行显示宽度 ≤ width。
 */
import { color } from '../engine/ansi.js'
import type { RivetTheme } from '../theme.js'
import { displayWidth } from '../width.js'

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

/** formatBrandWelcome 的渲染输入。 */
export interface FormatBrandWelcomeInput {
  width: number
  /** 品牌名（缺省 'DSH'）。 */
  brand?: string
  /** 副标题（缺省 'Tianshu Harness'）。 */
  subtitle?: string
}

/**
 * 欢迎页品牌区：主标 brand（BOLD brandColor）+ 副标题（muted），各一行，
 * 均在 width 内水平居中。
 * @param input - 宽度、品牌名与副标题。
 * @param theme - 当前主题（主标 brandColor BOLD，副标题 muted）。
 * @returns 两行 ANSI；width ≤ 0 返回空数组。
 */
export function formatBrandWelcome(input: FormatBrandWelcomeInput, theme: RivetTheme): string[] {
  if (input.width <= 0) return []
  const brand = truncateTo(input.brand ?? 'DSH', input.width)
  const subtitle = truncateTo(input.subtitle ?? 'Tianshu Harness', input.width)
  return [
    center(color(brand, theme.brandColor, { bold: true }), input.width),
    center(color(subtitle, theme.muted), input.width),
  ]
}

/**
 * 首次启动环境检查结果，供欢迎页环境行使用。
 */
export interface WelcomeEnvCheck {
  /** DEEPSEEK_API_KEY 环境变量是否已设置。 */
  hasApiKey: boolean
  /** 当前目录是否为 git 仓库（git status 可执行）。 */
  isGitRepo: boolean
  /** 终端背景色检测结果（'dark' | 'light' | 'unknown'）。 */
  background: string
  /** 终端列数。 */
  cols: number
  /** 终端行数。 */
  rows: number
}

/**
 * 环境检查紧凑行（欢迎页常驻）：`API Key ✓ · Git ✓ · 100×30 · dark`，单行 muted。
 * 用「API Key」措辞（非 footer 的「API ✗」），避免与 footer 合并段混淆。
 * @param env - 环境检查结果（API key/git/终端信息）。
 * @param theme - 当前主题（muted）。
 * @returns 单行 ANSI；cols ≤ 0 返回空数组。
 */
export function formatEnvCheckLine(env: WelcomeEnvCheck, theme: RivetTheme): string[] {
  if (env.cols <= 0) return []
  const api = env.hasApiKey ? '✓' : '✗'
  const git = env.isGitRepo ? '✓' : '✗'
  const plain = `API Key ${api} · Git ${git} · ${env.cols}×${env.rows} · ${env.background}`
  return [color(truncateTo(plain, env.cols), theme.muted)]
}

/** 欢迎页菜单项（grok menu.rs 形态的 label + 快捷键行）。 */
export interface WelcomeMenuItem {
  /** 稳定 id（app.ts 键路由用）。 */
  id: string
  /** 显示标签（左对齐，BOLD）。 */
  label: string
  /** 快捷键提示文本（如 'ctrl+n'；右对齐到行尾）。 */
  keyHint: string
  /** 可用性；false 时整行 muted（如无可恢复会话时的「恢复会话」）。 */
  available?: boolean
}

/** formatWelcomeMenu 的渲染输入。 */
export interface FormatWelcomeMenuInput {
  width: number
  items: readonly WelcomeMenuItem[]
}

/** 菜单内容块最小宽度（对齐 grok menu.rs 的 `.max(30)`）。 */
const MENU_MIN_WIDTH = 30

/**
 * 欢迎页菜单入口渲染（grok menu.rs 形态）：整块在 width 内水平居中，
 * 每项一行，label 左对齐 BOLD、keyHint 右对齐（secondary）；不可用项整行
 * muted。宽度守恒：label 完整放不下时丢弃 keyHint、label 截断（label 优先）。
 * 空 items 返回空数组（调用方不占位）。
 * @param input - 宽度与菜单项。
 * @param theme - 当前主题（label primary、keyHint secondary、禁用 muted）。
 * @returns ANSI 行数组。
 */
export function formatWelcomeMenu(input: FormatWelcomeMenuInput, theme: RivetTheme): string[] {
  const { width, items } = input
  if (items.length === 0) return []
  // 预留末列：行内容 ≤ width-1，规避终端「写满最后列 + 换行」的 autowrap
  // 空行/裁字（keyHint 右对齐时 `ctrl+q` 尾字符此前会被裁成 `ctrl+`）。
  const budget = Math.max(0, width - 1)
  // 内容块宽：label + 4 列 gap + hint 的最小值，至少 MENU_MIN_WIDTH，再钳到 budget。
  let contentW = MENU_MIN_WIDTH
  for (const item of items) {
    const hintW = item.available === false ? 0 : displayWidth(item.keyHint) + 1
    contentW = Math.max(contentW, displayWidth(item.label) + 4 + hintW)
  }
  contentW = Math.min(contentW, budget)
  const indent = ' '.repeat(Math.max(0, Math.floor((width - contentW) / 2)))
  const out: string[] = []
  for (const item of items) {
    const hintText = item.available === false ? '' : ` ${item.keyHint}`
    const hintW = displayWidth(hintText)
    const labelFull = displayWidth(item.label)
    if (item.available === false) {
      out.push(color(truncateTo(`${indent}${item.label}${hintText}`, budget), theme.muted))
      continue
    }
    if (labelFull + 4 + hintW > contentW) {
      // label 优先：丢弃 keyHint，label 独占整行（截断保宽）。
      out.push(color(truncateTo(`${indent}${item.label}`, budget), theme.primary, { bold: true }))
      continue
    }
    const pad = contentW - labelFull - hintW
    const labelPart = color(`${indent}${item.label}`, theme.primary, { bold: true })
    const hintPart = color(hintText, theme.secondary)
    out.push(`${labelPart}${' '.repeat(pad)}${hintPart}`)
  }
  return out
}
