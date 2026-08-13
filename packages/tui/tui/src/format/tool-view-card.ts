/**
 * presenter 卡渲染 — 消费 harness 工具声明的结构化渲染意图
 * （dsh-tools presentation.ts 的 ToolCallView/ToolResultView），把 diff /
 * terminal 卡渲染为 ANSI 行；generic 与其余卡型（search/read/web，二批
 * 结构化）回落 formatToolCard 的文本折叠。
 *
 * 与 formatToolCard 的关系：本模块是「结构化意图优先」的分派层——意图
 * 缺失（工具无 presenter / 桥软降级）时整体回落文本卡；标题行与 body
 * 缩进语汇（formatToolCardHeader / indentToolBody）两者共用。
 *
 * diff 卡不渲染行号 gutter：FileDiff 不携带原始行号（fs 的逐 hunk meta
 * 已剥掉 hunk 起点），伪造 1 起的行号会误导，+/− 前缀是诚实的双通道。
 */

import { structuredPatch } from 'diff'
import type { FileDiff, ToolCallView, ToolResultView } from '@huiliyi37/dsh-tools'
import { color } from '../engine/ansi.js'
import type { RivetTheme } from '../theme.js'
import { truncationHint } from '../truncation-marker.js'
import { hiddenLinesMarker } from './hidden-lines.js'
import { parseToolArguments } from './tool-meta.js'
import {
  formatToolCard,
  formatToolCardHeader,
  getDefaultMaxLines,
  indentToolBody,
  toolCardTitle,
  toolTitleVerb,
} from './tool-card.js'

/** diff 上下文行数（与 fs 工具 meta 的逐 hunk 上下文口径一致）。 */
const DIFF_CONTEXT_LINES = 3

/** 折叠阈值：增删行合计超过此数折叠为统计行（与 formatToolCard diff 嗅探分支同口径）。 */
const DIFF_FOLD_CHANGES = 10

/** 单个 FileDiff 正文行数上限（折叠态；与 tool-card write 族 DIFF_MAX_LINES 同口径）。 */
const DIFF_MAX_BODY_LINES = 20

/** terminal 卡标题里命令的截断长度（与 toolArgSummary 的 bash 口径一致）。 */
const COMMAND_TITLE_MAX = 55

/** 一行 diff 的类型：增 / 删 / 上下文 / hunk 间隔。 */
type DiffRowKind = 'add' | 'del' | 'ctx' | 'gap'

interface DiffRow {
  kind: DiffRowKind
  text: string
}

/** structuredPatch 一个 hunk 的行 → DiffRow（`\ No newline` 标注是补丁元信息，剥掉）。 */
function hunkRows(lines: readonly string[]): DiffRow[] {
  const rows: DiffRow[] = []
  for (const line of lines) {
    if (line.startsWith('\\')) continue
    const text = line.slice(1)
    if (line.startsWith('+')) rows.push({ kind: 'add', text })
    else if (line.startsWith('-')) rows.push({ kind: 'del', text })
    else rows.push({ kind: 'ctx', text })
  }
  return rows
}

/** 一个 FileDiff 的行序列：纯新建全为 add；否则 Myers（structuredPatch）逐 hunk，hunk 间插 gap。 */
function fileDiffRows(diff: FileDiff): DiffRow[] {
  if (diff.oldText === null) {
    return diff.newText.replace(/\n$/, '').split('\n').map(text => ({ kind: 'add' as const, text }))
  }
  const patch = structuredPatch(diff.path, diff.path, diff.oldText, diff.newText, undefined, undefined, { context: DIFF_CONTEXT_LINES })
  const rows: DiffRow[] = []
  for (const hunk of patch.hunks) {
    if (rows.length > 0) rows.push({ kind: 'gap', text: '' })
    rows.push(...hunkRows(hunk.lines))
  }
  return rows
}

/**
 * 多个 FileDiff 的增删统计（折叠阈值与统计行数据源）。
 * @param diffs - presenter 产出的文件级 diff 列表。
 * @returns 增/删行计数。
 */
export function fileDiffStats(diffs: readonly FileDiff[]): { adds: number; dels: number } {
  let adds = 0
  let dels = 0
  for (const diff of diffs) {
    for (const row of fileDiffRows(diff)) {
      if (row.kind === 'add') adds++
      else if (row.kind === 'del') dels++
    }
  }
  return { adds, dels }
}

/** renderFileDiff 的渲染选项。 */
export interface RenderFileDiffOptions {
  /** 正文行数上限（超限头尾对半 + 隐藏行标记）；缺省不设限。 */
  maxLines?: number
}

/**
 * 渲染一个结构化 {@link FileDiff} 为着色行数组：`+` 绿 / `-` 红 /
 * 上下文 muted，hunk 间以 dim `⋯` 分隔；新建文件（oldText null）全为
 * 添加行。审批预览（permission-diff.ts）与结算卡共用此渲染。
 * @param diff - 单文件 diff（oldText null = 新建/覆盖，无前像可比）。
 * @param options - 行数上限。
 * @param theme - 当前主题。
 * @returns ANSI 行数组；old/new 相同（无 hunk）时为空数组。
 */
export function renderFileDiff(diff: FileDiff, options: RenderFileDiffOptions, theme: RivetTheme): string[] {
  const rows = fileDiffRows(diff)
  const render = (row: DiffRow): string => {
    switch (row.kind) {
      case 'add': return color(`+ ${row.text}`, theme.success)
      case 'del': return color(`- ${row.text}`, theme.error)
      case 'ctx': return color(`  ${row.text}`, theme.muted)
      case 'gap': return color('⋯', theme.dim)
    }
  }
  const rendered = rows.map(render)
  const maxLines = options.maxLines
  if (maxLines === undefined || rendered.length <= maxLines) return rendered
  const head = Math.floor(maxLines / 2)
  return [
    ...rendered.slice(0, head),
    color(hiddenLinesMarker(rendered.length - maxLines), theme.secondary),
    ...rendered.slice(rendered.length - (maxLines - head)),
  ]
}

/** formatToolViewCard 的渲染输入：一次已结算工具调用 + 可选渲染意图。 */
export interface FormatToolViewCardInput {
  /** 工具名（模型原样产出）。 */
  toolName: string
  /** 原始参数 JSON 字符串（标题启发式与 generic 回落用）。 */
  argumentsRaw: string
  /** 模型面结果文本（tool-result text 块折叠）。 */
  content: string
  /** 是否为错误结果。 */
  isError: boolean
  /** presentCall 意图（标题来源之一）；桥降级时缺省。 */
  callView?: ToolCallView
  /** presentResult 意图（卡型分派依据）；缺失整体回落文本卡。 */
  resultView?: ToolResultView
  /** 工具耗时（毫秒）。 */
  elapsedMs?: number
  /** 完整展开：diff 不折叠为统计行、terminal 不截断输出。 */
  expanded?: boolean
  /** 紧凑模式（/density）：diff 卡仅标题 + 统计行，terminal 卡仅标题。 */
  compact?: boolean
}

/** 超长截断（显示语义同 toolArgSummary）。 */
function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** diff 结算卡：标题 + 红绿正文（大改动折叠为统计行）。 */
function diffCard(
  input: FormatToolViewCardInput,
  view: ToolResultView & { card: 'diff' },
  theme: RivetTheme,
): string[] {
  const toolInput = parseToolArguments(input.argumentsRaw)
  const title = view.title ?? input.callView?.title ?? toolCardTitle(input.toolName, toolInput)
  const lines: string[] = [formatToolCardHeader({
    toolName: input.toolName,
    title,
    isError: input.isError,
    ...(input.elapsedMs === undefined ? {} : { elapsedMs: input.elapsedMs }),
  }, theme)]

  const { adds, dels } = fileDiffStats(view.diffs)
  const statsLine = color(`${view.diffs.length} 处修改 (+${adds} −${dels})`, theme.muted)
  if (input.compact === true || (input.expanded !== true && adds + dels > DIFF_FOLD_CHANGES)) {
    lines.push(...indentToolBody([statsLine], '', theme))
    return lines
  }

  const multiPath = new Set(view.diffs.map(d => d.path)).size > 1
  const body: string[] = []
  for (const diff of view.diffs) {
    if (body.length > 0) body.push(color('⋯', theme.dim))
    if (multiPath) body.push(color(diff.path, theme.warning))
    body.push(...renderFileDiff(diff, input.expanded === true ? {} : { maxLines: DIFF_MAX_BODY_LINES }, theme))
  }
  if (body.length === 0) body.push(color('(无变更)', theme.muted))
  lines.push(...indentToolBody(body, '', theme))
  return lines
}

/** terminal 结算卡：命令标题 + exit/signal 徽标 + cwd 头 + 折叠输出体。 */
function terminalCard(
  input: FormatToolViewCardInput,
  view: ToolResultView & { card: 'terminal' },
  theme: RivetTheme,
): string[] {
  const toolInput = parseToolArguments(input.argumentsRaw)
  const command = view.title ?? (input.callView?.card === 'terminal' ? input.callView.title : undefined)
  const title = command === undefined
    ? toolCardTitle(input.toolName, toolInput)
    : `${toolTitleVerb(input.toolName)}(${clip(command.split('\n')[0] ?? command, COMMAND_TITLE_MAX)})`
  const badge = view.signal !== undefined
    ? color(`[${view.signal}]`, theme.warning)
    : view.exitCode !== undefined && view.exitCode !== 0
      ? color(`[exit ${view.exitCode}]`, theme.error)
      : undefined
  const lines: string[] = [formatToolCardHeader({
    toolName: input.toolName,
    title,
    isError: input.isError,
    ...(input.elapsedMs === undefined ? {} : { elapsedMs: input.elapsedMs }),
    ...(badge === undefined ? {} : { badge }),
  }, theme)]
  if (input.compact === true) return lines

  const body: string[] = []
  if (input.callView?.card === 'terminal' && input.callView.cwd !== undefined) {
    body.push(color(`cwd: ${input.callView.cwd}`, theme.dim))
  }
  const output = (view.output ?? input.content).replace(/\n+$/, '')
  const bodyColor = input.isError ? theme.error : theme.muted
  if (!output) {
    body.push(color('(无输出)', theme.muted))
  } else {
    const rows = output.split('\n')
    const maxLines = getDefaultMaxLines(input.toolName)
    if (input.expanded === true || rows.length <= maxLines) {
      body.push(...rows.map(row => color(row, bodyColor)))
    } else {
      body.push(...rows.slice(0, maxLines).map(row => color(row, bodyColor)))
      body.push(color(truncationHint(rows.length - maxLines), theme.secondary))
    }
  }
  lines.push(...indentToolBody(body, '', theme))
  return lines
}

/** GenericResultView 的 content 块折叠为显示文本（text 块拼接；无 text 块回落 undefined）。 */
function foldViewContent(view: ToolResultView & { card: 'generic' }): string | undefined {
  if (view.content === undefined) return undefined
  const text = view.content
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map(block => block.text)
    .join('\n')
  return text === '' ? undefined : text
}

/**
 * 结算工具卡总入口：按 presentResult 意图分派 diff / terminal 结构化卡；
 * generic 与其余卡型（search/read/web 二批结构化）回落 formatToolCard
 * 文本折叠（generic 的 content 块覆盖模型面文本）。
 * @param input - 调用事实 + 渲染意图（桥产物，可全缺省）。
 * @param theme - 当前主题。
 * @returns ANSI 行数组（标题行 + 卡片体）。
 */
export function formatToolViewCard(input: FormatToolViewCardInput, theme: RivetTheme): string[] {
  const view = input.resultView
  if (view !== undefined) {
    if (view.card === 'diff') return diffCard(input, view, theme)
    if (view.card === 'terminal') return terminalCard(input, view, theme)
  }
  const override = view?.card === 'generic' ? foldViewContent(view) : undefined
  const toolInput = parseToolArguments(input.argumentsRaw)
  return formatToolCard({
    toolName: input.toolName,
    content: override ?? input.content,
    isError: input.isError,
    ...(toolInput === undefined ? {} : { toolInput }),
    ...(input.elapsedMs === undefined ? {} : { elapsedMs: input.elapsedMs }),
    ...(input.expanded === undefined ? {} : { expanded: input.expanded }),
  }, theme)
}
