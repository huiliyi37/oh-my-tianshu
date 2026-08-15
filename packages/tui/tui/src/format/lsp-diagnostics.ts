/**
 * lsp-diagnostics — LSP 诊断的展示纯函数（工具卡徽标 + /lsp 面板段）。
 *
 * 纯函数层：输入诊断视图数组/分组视图，输出 ANSI 行；无 I/O、无时钟。
 * severity 映射与 LSP 语义一致：1 Error / 2 Warning / 3 Info / 4 Hint，
 * 语义色名（error/warning/info）由接线层映射主题色（同 tool-status 模式）。
 *
 * @module @huiliyi37/dsh-tui/format/lsp-diagnostics
 */

import type { LspDiagnosticView } from '../lsp/lsp-bridge.js'
import { color } from '../engine/ansi.js'
import type { RivetTheme } from '../theme.js'
import { displayWidth } from '../width.js'

/**
 * 单文件诊断徽标（工具卡标题行注入；无诊断返回 null 不渲染）。
 * @param diags - 该文件诊断视图（undefined = 未拉取）。
 * @returns 徽标文本（如 `2错 1警 3提示`，按 severity 聚合）；未拉取/无诊断为 null。
 */
export function lspBadgeText(diags: readonly LspDiagnosticView[] | undefined): string | null {
  if (diags === undefined || diags.length === 0) return null
  const errors = diags.filter(d => d.severity === 1).length
  const warnings = diags.filter(d => d.severity === 2).length
  const others = diags.length - errors - warnings
  const parts: string[] = []
  if (errors > 0) parts.push(`${errors}错`)
  if (warnings > 0) parts.push(`${warnings}警`)
  if (others > 0) parts.push(`${others}提示`)
  return parts.join(' ')
}

/**
 * severity → 语义色名（接线层映射主题色）。
 * @param severity - LSP severity（1 Error / 2 Warning / 3 Info / 4 Hint）。
 * @returns 语义色名：1 → error、2 → warning、其余 → info。
 */
export function lspSeverityColorName(severity: LspDiagnosticView['severity']): 'error' | 'warning' | 'info' {
  switch (severity) {
    case 1: return 'error'
    case 2: return 'warning'
    default: return 'info'
  }
}

/** 面板按文件分组视图（每组含该文件全部诊断）。 */
export interface LspFileGroup {
  /** cwd 相对路径（工具卡同口径）。 */
  file: string
  /** 该文件诊断（行序）。 */
  diags: readonly LspDiagnosticView[]
}

/**
 * 按文件分组（保持输入顺序，不跨文件重排）。
 * @param entries - 全量诊断视图（可能来自多个文件）。
 * @returns 文件分组列表；空输入返回 []。
 */
export function groupLspDiagnostics(entries: readonly LspDiagnosticView[]): LspFileGroup[] {
  const order: string[] = []
  const byFile = new Map<string, LspDiagnosticView[]>()
  for (const entry of entries) {
    let list = byFile.get(entry.file)
    if (list === undefined) {
      list = []
      byFile.set(entry.file, list)
      order.push(entry.file)
    }
    list.push(entry)
  }
  return order.map(file => ({ file, diags: byFile.get(file) ?? [] }))
}

/** 单条诊断行的最大宽度（列预算内截断，超长以 … 收尾）。 */
const DIAG_LINE_MAX = 80

/**
 * 单条诊断行：`line:col · message`（severity 着色）。
 * @param diag - 单条诊断视图（1-based 行列）。
 * @param theme - 主题（severity 语义色 + dim/muted 配色）。
 * @returns ANSI 行；message 空白折叠、超出列预算截断以 … 收尾。
 */
export function lspDiagnosticLine(diag: LspDiagnosticView, theme: RivetTheme): string {
  const colorName = lspSeverityColorName(diag.severity)
  const themeColor = colorName === 'error' ? theme.error : colorName === 'warning' ? theme.warning : theme.muted
  const loc = color(`${diag.line}:${diag.character}`, theme.dim)
  const message = diag.message.replace(/\s+/g, ' ').trim()
  const budget = Math.max(20, DIAG_LINE_MAX - 8)
  const text = displayWidth(message) > budget
    ? Array.from(message).reduce((acc, ch) => {
      if (displayWidth(acc + ch) > budget - 1) return acc
      return acc + ch
    }, '') + '…'
    : message
  return `${loc} ${color('·', theme.muted)} ${color(text, themeColor)}`
}

/**
 * /lsp 面板段行序列：每组「文件头行 + 诊断行」；空输入 → 空态行。
 * @param groups - 按文件分组的诊断。
 * @param theme - 主题（着色）。
 * @param available - 是否至少一个语言 server 可用（区分空态文案）。
 * @returns 面板行（ANSI 文本；组合器按需包装）。
 */
export function projectLspPanel(
  groups: readonly LspFileGroup[],
  theme: RivetTheme,
  available: boolean,
): string[] {
  const rows: string[] = []
  if (groups.length === 0) {
    rows.push(color(available ? '（无 LSP 诊断）' : '（LSP server 未安装——诊断不可用）', theme.muted))
    return rows
  }
  for (const group of groups) {
    rows.push(color(`◆ ${group.file}`, theme.primary, { bold: true }))
    for (const diag of group.diags) {
      rows.push(`  ${lspDiagnosticLine(diag, theme)}`)
    }
  }
  return rows
}
