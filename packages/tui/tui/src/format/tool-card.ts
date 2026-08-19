/**
 * 工具卡片渲染（基础版）— Claude Code 风格折叠卡片。
 *
 * 源出 .rivet/tui-source/tui/format/tool-card.ts（Apache-2.0 来源，见
 * LICENSE/NOTICE/SOURCE-MAP.md）。本文件为 dsh-tui 移植的基础版：
 * 保留 header/bullet 状态形色、diff 检测分支、read 族头尾预览、截断提示
 * 与 live 进行中卡片；去掉天枢特有的 browser_debug 分级着色、委派任务
 * 流式预览与星域映射（见反目标：不做 worker/星域面板）。
 *
 * 渲染结构：
 *   › Run(npm test) (1.2s)
 *     ⎿  前 4 行输出
 *        … +25 行
 *
 * - 状态形色双通道：› 成功绿 / ✗ 失败红 / ⠋ 进行中 dim / ? 待答黄
 */

import { color } from '../engine/ansi.js'
import { withBgFillLines } from './bg-block.js'
import type { RivetTheme } from '../theme.js'
import { displayWidth, truncateToDisplayWidth } from '../width.js'
import { useAsciiGlyphs } from '../term-caps.js'
import {
  LIVE_CARD_BODY_CONT,
  LIVE_CARD_BODY_FIRST,
  indentLiveCardBody,
  liveCardGlyph,
} from './live-card.js'
import { truncationHint } from '../truncation-marker.js'
import { formatElapsed, getToolFamily, isDelegationTool, parseToolArguments, toolArgSummary } from './tool-meta.js'
import { toolFamilyColor } from './tool-family.js'
import { formatDiff, isDiffContent, computeDiffStats } from './diff.js'
import { buildToolGroupSummary, type ToolGroup } from './tool-group.js'

/** 宽度口径：与 LiveEngine.rowsForLine 一致。工具输出（git diff/代码/日志）
 *  常含 `— … │ →` 等 ambiguous 符号 + CJK，按 .length 截断会低估列宽。 */
const WIDE = { ambiguousAsWide: true }

/** formatToolCard 的渲染输入：一次工具调用的结果卡片（含流式中间态）。 */
export interface FormatToolCardInput {
  /** 工具名称 */
  toolName: string
  /** 工具输出内容 */
  content: string
  /** 是否为错误输出 */
  isError?: boolean
  /** 缩进深度（工具调用链树形连接线） */
  depth?: number
  /** 原始文件路径（用于显示文件名） */
  rawPath?: string
  /** 折叠时显示的输出行数上限 */
  maxLines?: number
  /** 工具耗时（毫秒），可选 */
  elapsedMs?: number
  /** 是否正在流式输出中 */
  streaming?: boolean
  /** 工具输入参数（用于标题参数摘要） */
  toolInput?: Record<string, unknown>
  /** 终端列数（提供且主题带表面底色时，正文按状态垫底色补到整宽）。 */
  width?: number
  /** 完整展开（ctrl+o），不截断 */
  expanded?: boolean
}

const DEFAULT_MAX_LINES = 4
const READ_HEAD_LINES = 3
const READ_TAIL_LINES = 5
const DIFF_MAX_LINES = 20

/**
 * 按工具家族给不同默认展开高度。
 * @param toolName - 工具名（家族判定经 getToolFamily）。
 * @returns 折叠态默认显示的输出行数上限。
 */
export function getDefaultMaxLines(toolName: string): number {
  const family = getToolFamily(toolName).family
  switch (family) {
    case 'run': return 8
    case 'find': return 6
    case 'write': return DIFF_MAX_LINES
    case 'read': return READ_HEAD_LINES + READ_TAIL_LINES
    default: return DEFAULT_MAX_LINES
  }
}

/**
 * 标题动词：family verb 首字母大写（Run/Read/Patch/Write/Search/Find…）。
 * @param toolName - 工具名（家族判定经 getToolFamily）。
 * @returns 首字母大写的标题动词。
 */
export function toolTitleVerb(toolName: string): string {
  const verb = getToolFamily(toolName).verb
  return verb.charAt(0).toUpperCase() + verb.slice(1)
}

/**
 * 标题行文本（无色）：`Run(npm test)` 或 `Read(foo.ts)`。
 * @param toolName - 工具名（决定标题动词）。
 * @param toolInput - 工具输入参数（经 toolArgSummary 摘录主参数）。
 * @param rawPath - 原始文件路径；无参数摘要时回退取其 basename。
 * @returns 有参数摘要时 `Verb(arg)`，否则仅动词。
 */
export function toolCardTitle(toolName: string, toolInput?: Record<string, unknown>, rawPath?: string): string {
  const verb = toolTitleVerb(toolName)
  let arg = toolInput ? toolArgSummary(toolName, toolInput) : ''
  /* v8 ignore next -- split('/') 恒返回非空数组，pop() 恒有值；noUncheckedIndexedAccess 收窄防御 */
  if (!arg && rawPath) arg = rawPath.split('/').pop() ?? rawPath
  return arg ? `${verb}(${arg})` : verb
}

/**
 * 缩进工具卡 body 行：第一行 `⎿  `（dim 着色），后续行对齐缩进。
 * formatToolCard 与 presenter 卡（tool-view-card.ts）共用的卡片体语汇。
 * @param bodyLines - 已着色的 body 行。
 * @param indent - 卡片整体缩进前缀（工具链树形层级）。
 * @param theme - 当前主题。
 * @returns 缩进后的行数组。
 */
export function indentToolBody(bodyLines: readonly string[], indent: string, theme: RivetTheme): string[] {
  return indentLiveCardBody(bodyLines, indent, theme)
}

/** formatToolCardHeader 的输入：标题行的状态与文本。 */
export interface ToolCardHeaderInput {
  /** 工具名（家族着色与待答问判定）。 */
  toolName: string
  /** 标题文本（无色；通常为 toolCardTitle 产出或 presenter title）。 */
  title: string
  /** 是否为错误结果（✗ 红）。 */
  isError?: boolean
  /** 是否流式进行中（⠋ dim + 尾随 …）。 */
  streaming?: boolean
  /** 耗时（毫秒；streaming 时不显示）。 */
  elapsedMs?: number
  /** 卡片整体缩进前缀。 */
  indent?: string
  /** 标题行尾徽标（调用方已着色；terminal 卡 exit pill 等）。 */
  badge?: string
}

/**
 * 工具卡标题行：`› Verb(arg) (1.2s)` 形态，bullet 形色双通道（16 色终端
 * 与红绿色觉障碍下「成功/失败」不能只靠颜色）。
 * @param input - 标题文本与状态。
 * @param theme - 当前主题（状态形色与家族着色取语义 token）。
 * @returns 单行 ANSI 标题。
 */
export function formatToolCardHeader(input: ToolCardHeaderInput, theme: RivetTheme): string {
  const { toolName, title, isError = false, streaming = false, elapsedMs, indent = '', badge } = input
  const isQuestion = toolName === 'ask_user_question'
  const useAscii = useAsciiGlyphs()
  const bulletColor = isError ? theme.error : isQuestion ? theme.warning : streaming ? theme.dim : theme.success
  const bulletGlyph = liveCardGlyph(
    isError ? 'error' : isQuestion ? 'question' : streaming ? 'running' : 'success',
    { ascii: useAscii },
  )
  // 家族着色（Phase 7.2）：标题色按功能域取主题语义 token；待答问保持 warning。
  const tColor = isQuestion ? theme.warning : toolFamilyColor(toolName, theme)
  let header = `${indent}${color(bulletGlyph, bulletColor)} ${color(title, tColor, { bold: true })}`
  if (streaming) {
    header += ` ${color('…', theme.dim)}`
  } else if (elapsedMs !== undefined) {
    header += ` ${color(`(${formatElapsed(elapsedMs)})`, theme.muted)}`
  }
  if (badge !== undefined) header += ` ${badge}`
  return header
}

/**
 * 格式化工具卡片为 ANSI 行数组（›/⎿ 结构）。
 * @param input - 工具名、输出内容与折叠/展开等渲染选项。
 * @param theme - 当前主题（状态形色与家族着色取语义 token）。
 * @returns ANSI 行数组：标题行 + 按截断策略折叠的 body 行。
 */
export function formatToolCard(input: FormatToolCardInput, theme: RivetTheme): string[] {
  const {
    toolName,
    content,
    isError = false,
    depth = 0,
    rawPath,
    elapsedMs,
    streaming = false,
    toolInput,
    expanded = false,
  } = input

  const family = getToolFamily(toolName)
  const indent = depth > 0 ? '  '.repeat(depth) : ''
  const isQuestion = toolName === 'ask_user_question'
  // omp 风格工具块状态底色（主题带表面底色且给定宽度时生效；diff 分支自绘红绿不垫）。
  const statusBg = isError ? theme.toolErrorBg : theme.toolSuccessBg
  const tint = (bodyLines: string[]): string[] => withBgFillLines(bodyLines, input.width ?? 0, statusBg)

  const header = formatToolCardHeader({
    toolName,
    title: toolCardTitle(toolName, toolInput, rawPath),
    isError,
    streaming,
    ...(elapsedMs === undefined ? {} : { elapsedMs }),
    indent,
  }, theme)

  const lines: string[] = [header]

  const trimmed = content.replace(/\n+$/, '')
  if (!trimmed) {
    lines.push(...tint([`${indent}${color(LIVE_CARD_BODY_FIRST, theme.dim)}${color('(无输出)', theme.muted)}`]))
    return lines
  }

  // ── Diff 分支：write/edit 族 + diff 内容 → 红绿渲染 ─────────
  // 阈值：adds+dels ≤ 10 内联完整 diff，>10 折叠为单行摘要
  if (family.family === 'write' && isDiffContent(trimmed)) {
    const stats = computeDiffStats(trimmed)
    const changeCount = stats.adds + stats.dels
    if (changeCount <= 10 || expanded) {
      const diffLines = formatDiff({ content: trimmed, maxLines: Number.MAX_SAFE_INTEGER }, theme)
      lines.push(...indentToolBody(diffLines, indent, theme))
    } else {
      const hunkLabel = stats.hunks > 0 ? `${stats.hunks} 处修改` : `${changeCount} 行修改`
      const summary = `⎿ ${hunkLabel} (+${stats.adds} −${stats.dels})`
      lines.push(`${indent}${color(LIVE_CARD_BODY_FIRST, theme.dim)}${color(summary, theme.muted)}`)
    }
    return lines
  }

  // ── 普通输出分支 ─────────────────────────────────────────────
  const contentLines = trimmed.split('\n')
  const totalLines = contentLines.length
  const maxLines = input.maxLines ?? getDefaultMaxLines(toolName)
  // 正文是「数据」(命令输出/文件列表/git status)，用可读的 muted 前景。
  const bodyColor = isError ? theme.error : isQuestion ? theme.warning : theme.muted
  const renderLine = (l: string) => color(l, bodyColor)

  // ask_user_question 必须完整展示问题和所有选项，禁止截断。
  if (expanded || isQuestion || totalLines <= maxLines) {
    lines.push(...tint(indentToolBody(contentLines.map(renderLine), indent, theme)))
    if (rawPath && !expanded) {
      /* v8 ignore next -- split('/') 恒返回非空数组，pop() 恒有值；noUncheckedIndexedAccess 收窄防御 */
      lines.push(...tint([`${indent}${LIVE_CARD_BODY_CONT}${color(`raw: ${rawPath.split('/').pop() ?? rawPath}`, theme.muted)}`]))
    }
    return lines
  }

  // 截断：read 族用头+尾预览，其他工具用头 N 行
  if (family.family === 'read') {
    const head = contentLines.slice(0, READ_HEAD_LINES)
    const tail = contentLines.slice(-READ_TAIL_LINES)
    const omitted = totalLines - READ_HEAD_LINES - READ_TAIL_LINES
    const body = [
      ...head.map(renderLine),
      color(truncationHint(omitted), theme.secondary),
      ...tail.map(renderLine),
    ]
    lines.push(...tint(indentToolBody(body, indent, theme)))
    return lines
  }

  const head = contentLines.slice(0, maxLines)
  const omitted = totalLines - maxLines
  const body = [
    ...head.map(renderLine),
    color(truncationHint(omitted), theme.secondary),
  ]
  lines.push(...tint(indentToolBody(body, indent, theme)))
  return lines
}

/**
 * 判断该工具结果在折叠渲染下是否被截断（供 ctrl+o 展开记录用）。
 * @param input - 工具名、输出内容与可选行数上限（与 formatToolCard 同一截断口径）。
 * @returns 折叠渲染会隐藏内容时 true；ask_user_question 恒 false（永不截断）。
 */
export function isToolCardTruncated(input: Pick<FormatToolCardInput, 'toolName' | 'content' | 'maxLines'>): boolean {
  // ask_user_question is always rendered in full; no expand action needed.
  if (input.toolName === 'ask_user_question') return false
  const trimmed = input.content.replace(/\n+$/, '')
  if (!trimmed) return false
  const totalLines = trimmed.split('\n').length
  const family = getToolFamily(input.toolName)
  if (family.family === 'write' && isDiffContent(trimmed)) {
    const stats = computeDiffStats(trimmed)
    return (stats.adds + stats.dels) > 10
  }
  return totalLines > (input.maxLines ?? getDefaultMaxLines(input.toolName))
}

// ── Live 进行中工具行 ──────────────────────────────────────────

/** formatToolCardLive 的渲染输入：进行中工具的标题与流式输出 tail。 */
export interface FormatToolCardLiveInput {
  /** 工具名称。 */
  toolName: string
  /** 标题覆盖（presentCall 意图产出）；缺省 toolCardTitle 启发式。 */
  title?: string
  /** 工具输入参数（标题摘要） */
  toolInput?: Record<string, unknown>
  /** 展开态（A5：空输入 Enter 切换）：标题下渲染工具参数 JSON 行。 */
  expanded?: boolean
  /** 已累积的流式输出 */
  outputTail?: string
  /** 预切分的 tail 行（可选）：live 区每帧渲染时按累加器引用缓存切分结果。 */
  outputTailLines?: string[]
  /** 已运行时长（毫秒） */
  elapsedMs?: number
  /** 末尾输出显示行数 */
  tailLines?: number
  /** 终端列数 */
  columns: number
  /** 动画帧序号；提供时用 spinner 替代静态 bullet */
  tick?: number
  /** 紧凑模式（grok-build /compact-mode）：仅渲染标题单行，省略输出 tail。 */
  compact?: boolean
}

/**
 * live 区进行中工具的渲染：dim `⠋` 标题行 + 末 N 行输出（⎿ 缩进）。
 * @param input - 工具名、流式输出 tail、耗时与终端列数等。
 * @param theme - 当前主题。
 * @returns ANSI 行数组：标题行 + tailLines 行（compact 模式仅标题行）。
 */
export function formatToolCardLive(input: FormatToolCardLiveInput, theme: RivetTheme): string[] {
  const title = input.title ?? toolCardTitle(input.toolName, input.toolInput)
  const useAscii = useAsciiGlyphs()
  const bullet = liveCardGlyph('running', {
    ascii: useAscii,
    ...(input.tick === undefined ? {} : { tick: input.tick }),
  })
  let header = `${color(bullet, theme.dim)} ${color(title, toolFamilyColor(input.toolName, theme), { bold: true })}`
  if (input.elapsedMs !== undefined && input.elapsedMs >= 1000) {
    header += ` ${color(`(${formatElapsed(input.elapsedMs)})`, theme.muted)}`
  }

  const lines: string[] = [header]
  // A5：展开态在标题下渲染工具参数 JSON（标题摘要不够时的细节面；
  // 单行截断——live 区每帧重绘，多行参数会推挤输入框）。
  if (input.expanded === true && input.toolInput !== undefined && Object.keys(input.toolInput).length > 0) {
    const argsText = JSON.stringify(input.toolInput)
    lines.push(`${color(LIVE_CARD_BODY_FIRST, theme.dim)}${color(truncateToDisplayWidth(argsText, Math.max(10, input.columns - 6)), theme.muted)}`)
  }
  // 紧凑模式（/compact-mode）：仅标题行，省略输出 tail——高密度渲染。
  if (input.compact === true) return lines
  const tailRows = input.outputTailLines ?? (() => {
    const tail = (input.outputTail ?? '').replace(/\n+$/, '')
    return tail ? tail.split('\n') : undefined
  })()
  const tailCount = Math.max(0, input.tailLines ?? 3)
  const maxWidth = Math.max(10, input.columns - 3)

  const tailLines: string[] = []
  if (tailCount > 0 && tailRows && tailRows.length > 0) {
    const shown = tailRows.slice(-tailCount).map((l) => {
      const ellW = displayWidth('…', WIDE)
      const clipped = displayWidth(l, WIDE) > maxWidth
        ? `${truncateToDisplayWidth(l, maxWidth - ellW, WIDE)}…`
        : l
      return color(clipped, theme.muted)
    })
    tailLines.push(...indentToolBody(shown, '', theme))
  }

  if (tailCount > 0 && tailLines.length === 0) {
    tailLines.push(`${color(LIVE_CARD_BODY_FIRST, theme.dim)}${color('…', theme.dim)}`)
  }
  // 固定 tail 区高度：内容不足时顶部补空行，避免卡片随输出涨缩带动输入框跳动。
  while (tailLines.length < tailCount) {
    tailLines.unshift(LIVE_CARD_BODY_CONT)
  }

  // omp 风格：进行中工具块垫 pending 状态底色（主题带表面底色时；16 色轨不着底）。
  lines.push(...withBgFillLines(tailLines, input.columns, theme.toolPendingBg))
  return lines
}

/**
 * 委派工具是否在流式期展示任务预览（基础版恒 false——见反目标）。
 * @param _toolName - 工具名（基础版不消费，保留签名对齐天枢源）。
 * @returns 恒 false。
 */
export function isDelegationPreviewActive(_toolName: string): boolean {
  return false
}

// ── 并行工具分组渲染（Phase 7.3）──────────────────────────────
// 同 step 内并行发起的多个工具调用聚合为一组：折叠态显示计数与部分完成
// 状态（「3 个工具并行执行中 (1/3 完成)」），展开态逐个渲染完整工具卡片。
// 分组状态由 format/tool-group.ts 的纯投影 fold 维护，本函数只负责投影
// 到 ANSI 行——不写回、不订阅、零副作用。

/** formatToolGroup 的渲染输入：并行工具组与展开态。 */
export interface FormatToolGroupInput {
  /** 按 (turn, step) 聚合后的工具组（tool-group.ts 的 fold 产物）。 */
  group: ToolGroup
  /** 展开态：逐工具渲染完整卡片；折叠态：计数摘要 + 工具名清单。 */
  expanded: boolean
  /** 当前主题。 */
  theme: RivetTheme
  /** 终端列数（透传给子卡片宽度度量；可选）。 */
  columns?: number
}

/** 工具名紧凑摘要：read_file ×2, grep ×1（按首次出现序）。 */
function summarizeToolNames(group: ToolGroup): string {
  const counts = new Map<string, number>()
  for (const entry of group.entries) {
    counts.set(entry.name, (counts.get(entry.name) ?? 0) + 1)
  }
  return [...counts].map(([name, n]) => `${name} ×${n}`).join(', ')
}

/**
 * 渲染并行工具组为 ANSI 行数组。
 * 折叠态：`▶ 摘要` + 工具名清单；展开态：`▼ 摘要` + 逐个 formatToolCard
 * （进行中 entry 保留流式标记）。
 * @param input - 工具组、展开态与主题。
 * @returns ANSI 行数组：摘要头 + 折叠清单或逐工具完整卡片。
 */
export function formatToolGroup(input: FormatToolGroupInput): string[] {
  const { group, expanded, theme } = input
  const summary = buildToolGroupSummary(group)
  const indicator = color(expanded ? '▼' : '▶', theme.secondary, { bold: true })
  const header = `${indicator} ${color(summary, theme.primary, { bold: true })}`
  const lines: string[] = [header]

  if (expanded) {
    for (const entry of group.entries) {
      const toolInput = parseToolArguments(entry.arguments)
      lines.push(...formatToolCard({
        toolName: entry.name,
        content: entry.content,
        isError: entry.isError,
        depth: 1,
        ...(toolInput === undefined ? {} : { toolInput }),
        streaming: !entry.completed,
      }, theme))
    }
    return lines
  }

  const names = summarizeToolNames(group)
  if (names) {
    lines.push(`  ${color(LIVE_CARD_BODY_FIRST, theme.dim)}${color(names, theme.muted)}`)
  }
  return lines
}

// re-export for callers that branch on delegation tools
export { isDelegationTool }
