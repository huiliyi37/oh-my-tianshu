/**
 * Pure static composition for the fox welcome surface.
 *
 * The hero receives already-rendered mascot rows; the final composer places
 * projected restore rows and a selected startup tip.
 */

import { color } from '../engine/ansi.js'
import type { RivetTheme } from '../theme.js'
import { displayWidth, truncateToDisplayWidth, wrapToDisplayWidth } from '../width.js'

/** Welcome and live-chrome left inset in terminal columns. */
export const CHROME_GUTTER = 2

/**
 * Terminal-column fallback when the attached stream reports no size.
 *
 * Live rendering already falls back to `columns || 80`; the heroic welcome
 * must not silently drop the hero when a stream reports zero columns, so it
 * composes against this width instead of dropping the hero.
 */
const WELCOME_FALLBACK_COLUMNS = 80

const HERO_GAP = 6
const WELCOME_FOX_NARROW_COLS = 28
const WELCOME_FOX_WIDE_COLS = 36
const WELCOME_FOX_NARROW_CELLS = 15
const WELCOME_FOX_WIDE_CELLS = 19
const WELCOME_BAND_NARROW_MIN_COLS = 80
const WELCOME_BAND_WIDE_MIN_COLS = 105
const WELCOME_UNWRAP_MIN_COLS = 89
const WELCOME_MARK = '#b48cff'

/** Terminal rows reserved for chrome when deriving the fox art height budget. */
const WELCOME_ART_CHROME_ROWS = 6

/** Minimum terminal width for the split 28-column fox hero. */
export const WELCOME_HERO_WIDE_MIN = WELCOME_BAND_NARROW_MIN_COLS

/** Resolves a non-positive terminal width to the fallback columns. */
function effectiveColumns(width: number): number {
  return width > 0 ? width : WELCOME_FALLBACK_COLUMNS
}

function leftInset(width: number): number {
  return width > CHROME_GUTTER ? CHROME_GUTTER : 0
}

function fitLine(line: string, width: number, inset = leftInset(width)): string {
  return truncateToDisplayWidth(`${' '.repeat(inset)}${line}`, width)
}

function padToWidth(line: string, width: number): string {
  const fitted = truncateToDisplayWidth(line, width)
  return `${fitted}${' '.repeat(Math.max(0, width - displayWidth(fitted)))}`
}

function titleLine(theme: RivetTheme): string {
  return `${color('Oh My Tianshu', theme.brandColor, { bold: true })}${color(' >', WELCOME_MARK, { bold: true })}`
}

function harnessLine(): string {
  return color('< Harness >', WELCOME_MARK, { bold: true })
}

function wrapIdentityLines(theme: RivetTheme, wrapWidth: number): string[] {
  const title = titleLine(theme)
  const harness = harnessLine()
  if (displayWidth('Oh My Tianshu >') <= wrapWidth) {
    return [title, harness]
  }
  return [
    ...wrapToDisplayWidth(title, wrapWidth),
    ...wrapToDisplayWidth(harness, wrapWidth),
  ]
}

function modelLine(input: FormatWelcomeHeroInput, theme: RivetTheme): string {
  return color(
    `Model ${input.modelId} · Effort ${input.reasoningEffort ?? 'auto'}`,
    theme.secondary,
  )
}

function versionLine(version: string, theme: RivetTheme): string {
  return color(version.startsWith('v') ? version : `v${version}`, theme.muted)
}

function heroDetails(
  input: FormatWelcomeHeroInput,
  theme: RivetTheme,
  wrapWidth?: number,
): string[] {
  const lines = [
    ...(wrapWidth === undefined ? [titleLine(theme), harnessLine()] : wrapIdentityLines(theme, wrapWidth)),
    modelLine(input, theme),
    color(`cwd ${input.cwd}`, theme.muted),
  ]
  if (input.version !== undefined && input.version !== '') {
    lines.push(versionLine(input.version, theme))
  }
  if (wrapWidth === undefined) return lines
  return lines.flatMap(line => wrapToDisplayWidth(line, wrapWidth))
}

function compactHero(input: FormatWelcomeHeroInput, theme: RivetTheme): string[] {
  return heroDetails(input, theme).map(line => fitLine(line, effectiveColumns(input.width)))
}

/** Pre-rendered mascot rows and their fixed layout width. */
export interface RenderedWelcomeArt {
  /** ANSI rows; an empty array requests the text-only fallback. */
  lines: readonly string[]
  /** Fixed column allocation, including transparent trailing pixels. */
  width: number
}

/** Input for the static welcome hero preview. */
export interface FormatWelcomeHeroInput {
  /** Current terminal columns. */
  width: number
  /** Current terminal rows. */
  rows: number
  /** Pre-rendered mascot art with no mascot-specific dependency. */
  art: RenderedWelcomeArt
  /** Current model identifier. */
  modelId: string
  /** Current reasoning effort; omitted values display as `auto`. */
  reasoningEffort?: string
  /** Current session working directory. */
  cwd: string
  /** Optional distribution version. */
  version?: string
}

/**
 * Resolves the fox art width for a terminal of the given size.
 *
 * The split hero is one of two rest bands: 28 columns from 80×21, and 36
 * columns from 105×25. Anything smaller uses the compact text form. A
 * 105-column terminal that lacks the 36-band row budget stays on 28.
 * The title stays beside the fox; it is never stacked above it.
 *
 * @param width - Current terminal columns.
 * @param rows - Current terminal rows.
 * @returns Art columns for the split hero, or null for the text fallback.
 */
export function resolveWelcomeArtWidth(width: number, rows: number): number | null {
  const columns = effectiveColumns(width)
  const foxRows = rows - WELCOME_ART_CHROME_ROWS
  if (foxRows < WELCOME_FOX_NARROW_CELLS) return null
  if (columns < WELCOME_BAND_NARROW_MIN_COLS) return null
  if (columns >= WELCOME_BAND_WIDE_MIN_COLS && foxRows >= WELCOME_FOX_WIDE_CELLS) {
    return WELCOME_FOX_WIDE_COLS
  }
  return WELCOME_FOX_NARROW_COLS
}

/**
 * Renders the split fox hero or its compact text-only fallback.
 *
 * The wide layout requires the terminal to pass {@link resolveWelcomeArtWidth}
 * plus non-empty art sized to the resolved allocation.
 *
 * @param input - Terminal size, rendered art, model/effort, cwd, and version.
 * @param theme - Active terminal theme.
 * @returns ANSI-safe rows whose display width never exceeds `input.width`.
 */
export function formatWelcomeHero(
  input: FormatWelcomeHeroInput,
  theme: RivetTheme,
): string[] {
  const width = effectiveColumns(input.width)
  const inset = leftInset(width)
  const artWidth = resolveWelcomeArtWidth(width, input.rows)
  const compact = artWidth === null
    || input.art.lines.length === 0
    || input.art.width <= 0
    || input.art.width !== artWidth
  if (compact) return compactHero(input, theme)

  const detailWidth = width - inset - input.art.width - HERO_GAP
  const details = heroDetails(
    input,
    theme,
    width < WELCOME_UNWRAP_MIN_COLS ? detailWidth : undefined,
  )

  const rowCount = Math.max(input.art.lines.length, details.length)
  const detailsTop = Math.floor((rowCount - details.length) / 2)
  const output: string[] = []
  for (let row = 0; row < rowCount; row++) {
    const art = padToWidth(input.art.lines[row] ?? '', input.art.width)
    const detail = details[row - detailsTop] ?? ''
    output.push(truncateToDisplayWidth(
      `${' '.repeat(inset)}${art}${' '.repeat(HERO_GAP)}${detail}`,
      width,
    ))
  }
  return output
}

/** Input for the final static welcome composition. */
export interface FormatWelcomeInput extends FormatWelcomeHeroInput {
  /** Pre-rendered numbered restore rows. */
  restoreLines: readonly string[]
  /** Already-selected startup tip, including its `Tip:` prefix. */
  tip: string
}

/**
 * Composes the final welcome scrollback block.
 *
 * Restore rows are absent as one unit when the input list is empty. The tip is
 * always the final content row, followed by one empty separator row.
 *
 * @param input - Hero fields plus pre-rendered restore rows and selected tip.
 * @param theme - Active terminal theme.
 * @returns The complete bounded welcome block.
 */
export function formatWelcome(input: FormatWelcomeInput, theme: RivetTheme): string[] {
  const width = effectiveColumns(input.width)
  const output = ['', ...formatWelcomeHero(input, theme)]
  if (input.restoreLines.length > 0) {
    output.push(fitLine(color('恢复会话', theme.brandColor, { bold: true }), width))
    for (const line of input.restoreLines) output.push(fitLine(line, width))
    output.push(fitLine(color('[1-9] 恢复 · ctrl+n 新会话', theme.muted), width))
  }
  output.push(fitLine(color(input.tip, theme.muted, { italic: true }), width))
  output.push('')
  return output
}

/** Stable startup-tip pool. */
export const WELCOME_TIPS = [
  'Ctrl+. 随时调出完整键位表',
  'Shift+Tab 在 normal / plan / always-approve 间循环',
  'Ctrl+V 直接粘贴剪贴板里的截图',
  '@ 开头输入路径，Tab 补全文件',
  'Ctrl+O 展开最近一段推理',
  '/rewind 回退到一条用户消息',
  'Ctrl+F 搜索历史输入，n / N 前后跳',
  '/fork 给当前会话分叉一个探索分支',
  'Ctrl+E 用 $EDITOR 编辑长输入',
  '/export 把会话导出成 Markdown',
] as const satisfies readonly [string, ...string[]]

/** Optional pool entry for a hidden but available restore action. */
export const RESUME_TIP = 'Ctrl+S 恢复上次会话'

/**
 * Selects one startup tip, optionally including the restore action.
 *
 * @param rng - Random source, injectable for deterministic tests.
 * @param opts - Whether the restore action joins the candidate pool.
 * @returns Selected text with a `Tip: ` prefix.
 */
export function pickWelcomeTip(
  rng: () => number = Math.random,
  opts: { resumeVisible?: boolean } = {},
): string {
  const pool = opts.resumeVisible === true ? [...WELCOME_TIPS, RESUME_TIP] : WELCOME_TIPS
  const tip = pool[Math.floor(rng() * pool.length) % pool.length] ?? WELCOME_TIPS[0]
  return `Tip: ${tip}`
}
