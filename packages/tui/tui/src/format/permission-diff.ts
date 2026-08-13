/**
 * 审批 diff 预览（C2 项 1）— 反 grok 之道：grok 审批 modal 不放 diff，
 * DSH 的痛点是盲批（信任断点），在 y/N 提示上方渲染内联 diff 建立信任。
 *
 * 数据通路：approval/request 携带 callId → transcript 查找 tool 调用 →
 * 原始参数 JSON → 此处解析 → 复用 renderFileDiff 渲染（与结算工具卡同一
 * FileDiff 渲染：所批即所见，审批预览与落底卡片同型）。
 */

import type { RivetTheme } from '../theme.js'
import { color } from '../engine/ansi.js'
import { fileDiffStats, renderFileDiff } from './tool-view-card.js'

/** 审批场景内容行硬上限（审批期间键锁只 y/N/Esc，diff 必须无翻页全可见）。 */
export const APPROVAL_DIFF_MAX_LINES = 12

/** write 预览最多显示的内容行数（新文件无 old，无 diff 可看）。 */
export const WRITE_PREVIEW_LINES = 4

/** formatPermissionDiff 的输入：待审批工具调用的名与原始参数。 */
export interface PermissionDiffInput {
  /** 工具名（transcript tool.name）。 */
  toolName: string
  /** 原始参数 JSON 字符串（transcript tool.arguments）。 */
  arguments: string
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/**
 * 从编辑类工具参数提取 old/new 文本对。
 * str_replace_editor 的 str_replace 用 old_str/new_str；edit_file 用
 * old_string/new_string（宿主侧工具，兼容提取）。
 */
function extractReplacePair(
  args: Record<string, unknown>,
): { path: string | null; oldText: string | null; newText: string | null } {
  return {
    path: asString(args.path),
    oldText: asString(args.old_str) ?? asString(args.old_string),
    newText: asString(args.new_str) ?? asString(args.new_string),
  }
}

/** write 类预览：path + 前 N 行内容（create/write_file）。 */
function formatWritePreview(
  path: string,
  content: string,
  theme: RivetTheme,
): string[] {
  const head = content.split('\n').slice(0, WRITE_PREVIEW_LINES)
  const lines = [`${path} 新文件内容预览:`]
  for (const line of head) lines.push(`  ${line}`)
  if (content.split('\n').length > WRITE_PREVIEW_LINES) {
    // muted 缺失是真实边界（spec 显式构造缺 muted 的 theme 验证省略号分支）
    const muted = theme.muted as string | undefined
    lines.push(muted === undefined ? '  …' : `  …（共 ${content.split('\n').length} 行）`)
  }
  return lines
}

/** old/new 替换对 → 路径统计头 + renderFileDiff 行（结算卡同一渲染）。 */
function formatReplaceDiff(
  path: string,
  oldText: string,
  newText: string,
  theme: RivetTheme,
): string[] {
  const diff = { path, oldText, newText }
  const { adds, dels } = fileDiffStats([diff])
  return [
    color(`${path} (+${adds} −${dels})`, theme.warning),
    ...renderFileDiff(diff, { maxLines: APPROVAL_DIFF_MAX_LINES }, theme),
  ]
}

/**
 * 格式化审批 diff 为 ANSI 行数组；非编辑工具或参数不可解析返回 null。
 * - str_replace_editor str_replace / edit_file：old/new → renderFileDiff
 *   （±3 context，与结算工具卡共用渲染——所批即所见）
 * - str_replace_editor create / write_file：path + 前 4 行预览（无 old）
 * - 其他命令/工具：null（无替换语义不渲染）
 * @param input - 待审批工具调用的名与原始参数 JSON。
 * @param theme - 当前主题（diff 染色透传 renderFileDiff）。
 * @returns diff/预览的 ANSI 行数组；不可渲染时 null（调用方不占位）。
 */
export function formatPermissionDiff(
  input: PermissionDiffInput,
  theme: RivetTheme,
): string[] | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(input.arguments)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const args = parsed as Record<string, unknown>

  if (input.toolName === 'str_replace_editor') {
    if (args.command === 'str_replace') {
      const { path, oldText, newText } = extractReplacePair(args)
      if (path === null || oldText === null || newText === null) {
        return null
      }
      if (oldText === newText) return null
      return formatReplaceDiff(path, oldText, newText, theme)
    }
    if (args.command === 'create') {
      const path = asString(args.path)
      const content = asString(args.file_text)
      if (path === null || content === null) return null
      return formatWritePreview(path, content, theme)
    }
    return null
  }

  if (input.toolName === 'write_file') {
    const path = asString(args.path)
    const content = asString(args.content) ?? asString(args.file_text)
    if (path === null || content === null) return null
    return formatWritePreview(path, content, theme)
  }

  if (input.toolName === 'edit_file') {
    const { path, oldText, newText } = extractReplacePair(args)
    if (path === null || oldText === null || newText === null) return null
    if (oldText === newText) return null
    return formatReplaceDiff(path, oldText, newText, theme)
  }

  return null
}
