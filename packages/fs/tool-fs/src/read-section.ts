/**
 * Model-facing `read_section`: read a line or character range from a live
 * file without re-reading the whole content. This is the fetch point the
 * `read` tool's `[read-ref]` references point to — a model that needs a
 * specific part of an unchanged file uses `read_section` instead of
 * re-reading the full file and growing the uncached request suffix.
 *
 * Adapted from the opencode-tui upstream `src/tools/read-section.ts`
 * (file_path branch only): the artifactId branch is omitted because this
 * harness has no artifact store — the spill package handles tool-result
 * spill, not recoverable file artifacts.
 *
 * @module @huiliyi37/dsh-tool-fs/src/read-section
 */

import type { Context } from '@huiliyi37/cordis'
import { defineTool } from '@huiliyi37/dsh-tools'
import { FsError } from '@huiliyi37/dsh-fs'
import type {} from '@huiliyi37/dsh-fs'
import type { ReadToolCaps } from './read.ts'
import { sessionResolveOptions } from './session-cwd.ts'

/** Maximum raw file size read_section reads into memory; larger files must be inspected with grep or shell head/tail. */
export const MAX_RAW_BYTES = 2 * 1024 * 1024

/**
 * Parse a section id like `L100-L200` or `100-200` into [start, end] line
 * numbers. Returns null when not a line-range format.
 * @param sectionId - the raw section id.
 * @returns the inclusive line range, or null.
 */
export function parseLineRange(sectionId: string): { start: number; end: number } | null {
  const match = /^L?(\d+)-L?(\d+)$/i.exec(sectionId)
  if (!match) return null
  const start = Number.parseInt(match[1]!, 10)
  const end = Number.parseInt(match[2]!, 10)
  if (start < 1 || end < start) return null
  return { start, end }
}

/**
 * Parse a character range like `c0-c5000` into [start, end) offsets.
 * Returns null when not a char-range format.
 * @param sectionId - the raw section id.
 * @returns the half-open char range, or null.
 */
export function parseCharRange(sectionId: string): { start: number; end: number } | null {
  const match = /^c(\d+)-c(\d+)$/i.exec(sectionId)
  if (!match) return null
  const start = Number.parseInt(match[1]!, 10)
  const end = Number.parseInt(match[2]!, 10)
  if (start < 0 || end < start) return null
  return { start, end }
}

/**
 * Extract a section from raw content by line range or char range.
 * @param rawContent - the full file text.
 * @param sectionId - `L100-L200` (lines) or `c0-c5000` (chars).
 * @returns the extracted section, an out-of-range notice, or an invalid-format error text.
 */
export function extractSection(rawContent: string, sectionId: string): string {
  const lineRange = parseLineRange(sectionId)
  if (lineRange) {
    const lines = rawContent.split('\n')
    const startIdx = lineRange.start - 1
    const endIdx = Math.min(lineRange.end, lines.length)
    if (startIdx >= lines.length) {
      return `[区段 ${sectionId} 超出范围 — 文件共 ${lines.length} 行]`
    }
    return lines.slice(startIdx, endIdx).join('\n')
  }

  const charRange = parseCharRange(sectionId)
  if (charRange) {
    const start = Math.min(charRange.start, rawContent.length)
    const end = Math.min(charRange.end, rawContent.length)
    return rawContent.slice(start, end)
  }

  return `[无效的区段格式：${sectionId}。行范围用 "L100-L200"，字符范围用 "c0-c5000"]`
}

/** Last observed version per file per session — a stale read gets a warning. */
const lastReadVersions = new WeakMap<object, Map<string, unknown>>()

/**
 * Register the `read_section` tool.
 * @param ctx - the plugin context; execution uses its `fs` service.
 * @param caps - the deployment's resolved read caps (the `maxBytes` budget caps section output).
 */
export function applyReadSectionTool(ctx: Context, caps: ReadToolCaps): void {
  ctx.tools.register(defineTool({
    name: 'read_section',
    description: 'Read a line range (L100-L200) or character range (c0-c5000) from a file without re-reading the whole content. '
      + 'Use after a [read-ref] reference when you need a specific part of an already-read unchanged file.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'Path to read, resolved by the filesystem backend.' },
      section: { type: 'string', required: true, description: 'Section to read: "L100-L200" for lines, "c0-c5000" for characters.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          section: { type: 'string', required: true },
          content: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.content,
      }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const section = args.section.trim()
      // 参数校验用普通 Error（同 read.ts parseReadArgs 惯例）；文件层错误才用 FsError。
      if (section === '') throw new Error('section must be a non-empty string')
      if (!parseLineRange(section) && !parseCharRange(section)) {
        throw new Error(
          `invalid section "${section}": use "L100-L200" (lines) or "c0-c5000" (characters)`,
        )
      }
      const target = await ctx.fs.resolve(args.file_path, sessionResolveOptions(exec, args.file_path))
      const info = await ctx.fs.stat(target, exec.signal)
      if (!info) throw new FsError(`cannot read "${target.displayPath}": not found`, 'FS_NOT_FOUND')
      if (info.type !== 'file') throw new FsError(`cannot read "${target.displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE')
      if ((info.size ?? 0) > MAX_RAW_BYTES) {
        throw new FsError(
          `file ${target.displayPath} is too large (${((info.size ?? 0) / 1024 / 1024).toFixed(1)}MB > ${MAX_RAW_BYTES / 1024 / 1024}MB): use grep or shell head/tail instead`,
          'FS_IO_ERROR',
        )
      }

      // Staleness note: if the file changed since this session last read it
      // (via read_section), the section may not match what an earlier read
      // showed — warn rather than silently present a different version.
      const session = exec.agent?.session
      let staleness = ''
      if (session !== undefined) {
        const perSession = lastReadVersions.get(session)
        const last = perSession?.get(String(target.targetKey))
        if (last !== undefined && last !== info.version) {
          staleness = '\n⚠ 文件自本会话上次读取后已变更（版本不匹配），以下为当前磁盘内容，可能与上文不一致。\n'
        }
      }

      const raw = await ctx.fs.readText(target, exec.signal)
      const sectionContent = extractSection(raw, section)
      const truncated = sectionContent.length > caps.maxBytes
        ? sectionContent.slice(0, caps.maxBytes) + `\n... [已截断至 ${caps.maxBytes} 字符]`
        : sectionContent

      if (session !== undefined) {
        const perSession = lastReadVersions.get(session) ?? new Map<string, unknown>()
        perSession.set(String(target.targetKey), info.version)
        lastReadVersions.set(session, perSession)
      }

      return {
        path: target.displayPath,
        section,
        content: staleness === '' ? truncated : staleness + truncated,
      }
    },
  }))
}
