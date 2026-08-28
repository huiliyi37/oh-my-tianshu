/**
 * Model-facing UTF-8 read. It performs one provider stat for type, routing, and observed version,
 * streams large or size-unknown files, renders a bounded window, then emits the observation.
 * @module @huiliyi37/dsh-tool-fs/src/read
 */

import type { Context } from '@huiliyi37/cordis'
import { defineTool } from '@huiliyi37/dsh-tools'
import type { GenericCallView, ReadResultView, ToolResult } from '@huiliyi37/dsh-tools'
import { FsError } from '@huiliyi37/dsh-fs'
import type {} from '@huiliyi37/dsh-fs'
import type {} from '@huiliyi37/dsh-system-prompt'
import { buildWindow, formatReadOutput, langFromPath, readMetaFromMeta } from './read-render.ts'
import { focusedWindow } from './focus.ts'
import { sessionResolveOptions } from './session-cwd.ts'
import { FIRST_PARTY_SECTION_ORDER } from '@huiliyi37/dsh-system-prompt'

/** Default and maximum number of lines returned by one `read` call (the `readLimit` config). */
export const READ_LIMIT = 2000

/**
 * Default streaming threshold (the `readStreamMinSize` config): files at or
 * above this size stream; smaller files read whole into memory.
 */
export const STREAM_MIN_SIZE = 10 * 1024 * 1024

/** Default read-ref threshold (the `readRefThresholdBytes` config): unchanged re-reads of files this large return a reference. */
export const READ_REF_THRESHOLD_BYTES = 2048

/** Cumulative bytes saved by read-ref shortcuts (avoided uncached re-emission). */
let readRefSavedBytes = 0
/** Number of read-ref shortcuts served. */
let readRefCount = 0

/**
 * Read-ref telemetry: how many unchanged re-reads were short-circuited to a
 * reference and how many bytes of file content that kept out of the request
 * suffix (the main driver of uncached growth — upstream measured most
 * cacheCreate coming exactly from in-turn tool-result growth).
 * @returns the cumulative saved-bytes and shortcut count.
 */
export function getReadRefStats(): { savedBytes: number; count: number } {
  return { savedBytes: readRefSavedBytes, count: readRefCount }
}

/** Resolved read-tool caps — plugin config after defaulting (see `Config` in index.ts). */
export interface ReadToolCaps {
  /** Default and maximum number of lines returned by one call. */
  limit: number
  /** Maximum characters returned for a single line. */
  maxLineLength: number
  /** Maximum bytes returned for selected file lines. */
  maxBytes: number
  /** Files at or above this size stream; smaller files read whole into memory. */
  streamMinSize: number
  /**
   * Unchanged re-reads of files at or above this size return a one-line
   * `[read-ref]` reference instead of the content again (0 disables) — the
   * earlier read is already in the conversation, so re-sending it only grows
   * the uncached suffix (upstream measured most cacheCreate coming exactly
   * from in-turn tool-result growth).
   */
  refThresholdBytes: number
}

/** One session's memory of a file's last full default-window read. */
interface ReadRefState {
  /** The stat freshness token observed at that read; a different token means the file changed. */
  version: unknown
  /** The window parameters of that read — a reference is only valid for the same window. */
  offset: number
  limit: number
  /** Whether the reference for this state has already been served (an insisted re-read then serves content). */
  refServed: boolean
}

/**
 * Per-session read-ref memory, keyed by the live session object so entries
 * die with it. The map key is the resolved target's opaque `targetKey`.
 */
const readRefs = new WeakMap<object, Map<string, ReadRefState>>()

/** Validated `read` arguments after defaulting. */
interface ReadInput {
  filePath: string
  offset: number
  limit: number
  focus?: string
}

function parsePositiveInteger(value: number, name: string): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`)
  }
  return value
}

/**
 * Validate value constraints the schema DSL can't express. `maxLimit` is the deployment's line cap.
 * @param args - the schema-validated raw tool arguments; `offset`/`limit` must be positive integers when given.
 * @param maxLimit - the configured line cap: both the default `limit` and the largest one accepted.
 * @returns the validated input with `offset` defaulted to 1 and `limit` to `maxLimit`.
 */
export function parseReadArgs(
  args: { file_path: string; offset?: number; limit?: number; focus?: string },
  maxLimit: number,
): ReadInput {
  if (args.file_path.trim().length === 0) throw new Error('file_path must be a non-empty string')
  const offset = args.offset === undefined ? 1 : parsePositiveInteger(args.offset, 'offset')
  const limit = args.limit !== undefined ? parsePositiveInteger(args.limit, 'limit') : maxLimit
  if (limit > maxLimit) throw new Error(`limit must be less than or equal to ${maxLimit}`)
  return {
    filePath: args.file_path,
    offset,
    limit,
    ...args.focus !== undefined && args.focus.trim().length > 0 ? { focus: args.focus } : {},
  }
}

/**
 * Register the `read` tool and its system-prompt guidance.
 * @param ctx - the plugin context; registrations are effects scoped to it, and execution uses its `fs` service.
 * @param caps - the deployment's resolved read caps (plugin config after defaulting).
 */
export function applyReadTool(ctx: Context, caps: ReadToolCaps): void {
  ctx.systemPrompt.section({
    name: 'tool:read',
    order: FIRST_PARTY_SECTION_ORDER.TOOL_READ,
    text: 'Use the read tool — not shell commands like cat — to inspect text files. Results include line numbers. Use offset and limit to continue reading large files.',
  })

  ctx.tools.register(defineTool({
    name: 'read',
    description: 'Read a UTF-8 text file and return line-numbered content.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'Path to read, resolved by the filesystem backend.' },
      offset: { type: 'number', description: '1-based first line to return. Defaults to 1.' },
      limit: { type: 'number', description: `Maximum number of lines to return. Defaults to ${caps.limit}.` },
      focus: { type: 'string', description: 'Optional focus query: return only the relevant line ranges plus a structural skeleton instead of a full window.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          offset: { type: 'integer', required: true },
          lines: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                number: { type: 'integer', required: true },
                text: { type: 'string', required: true },
              },
            },
          },
          totalLines: { type: 'integer', required: true },
          skeleton: {
            type: 'array',
            items: { type: 'string' },
          },
          readRef: {
            type: 'boolean',
            description: 'Present when this result is an unchanged-re-read reference: the content is in the earlier read already in the conversation.',
          },
        },
      },
      render: (args, value) => {
        const input = parseReadArgs(args, caps.limit)
        if (value.readRef === true) {
          return [{
            type: 'text',
            text: `[read-ref] ${value.path} is unchanged since its last read in this conversation (same file version, same window). `
              + `Need a specific part? Use read_section(file_path="${args.file_path}", section="L100-L200") or section="c0-c5000" `
              + 'to fetch just that range from disk. Do not re-read the whole file — it only grows the uncached request suffix.',
          }]
        }
        if (input.focus !== undefined) {
          const endLine = value.lines.at(-1)?.number ?? 0
          const omitted = Math.max(0, value.totalLines - value.lines.length)
          const body = value.lines.map(line => `${String(line.number).padStart(5, ' ')} | ${line.text}`).join('\n')
          const skeleton = (value.skeleton ?? []).join('\n') || '（无）'
          const header = [
            `[focused-read] ${value.path}`,
            `focus: ${input.focus}`,
            `source: ${value.totalLines} lines; showing ${value.lines.length} relevant lines${endLine === 0 ? ' (no direct match)' : ` (up to L${endLine})`}`,
            `结构骨架:\n${skeleton}`,
          ].join('\n')
          return [{
            type: 'text',
            text: `${header}\n\n${body || 'No direct focus match — structural outline only.'}\n\n[focused-read] omitted ${omitted} source lines; use read(offset, limit) for an exact range.`,
          }]
        }
        const endLine = value.lines.at(-1)?.number ?? Math.max(0, value.offset - 1)
        const truncatedByBytes = value.lines.length < input.limit && endLine < value.totalLines
        return [{
          type: 'text',
          text: formatReadOutput(value.path, {
            offset: value.offset,
            lines: value.lines,
            totalLines: value.totalLines,
            ...truncatedByBytes ? { truncatedByBytes: true } : {},
          }),
        }]
      },
      // Project the structured window into persisted `meta` so a UI's read card
      // survives replay: the raw canonical output object is not on the wire, only
      // the model-facing text, from which the line/lang data cannot be recovered.
      presentationMeta: (_args, value) => {
        const lang = langFromPath(value.path)
        return {
          path: value.path,
          offset: value.offset,
          lines: value.lines.map(({ number, text }) => ({ number, text })),
          totalLines: value.totalLines,
          ...lang === undefined ? {} : { lang },
        }
      },
    },
    // Observation races fail closed because guarded mutations re-check the version in-lock.
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const input = parseReadArgs(args, caps.limit)
      const target = await ctx.fs.resolve(input.filePath, sessionResolveOptions(exec, input.filePath))

      // One stat: absence observation OR type check + size routing + present version.
      // A concurrent write can only make a later guarded mutation fail stale and require reread.
      const info = await ctx.fs.stat(target, exec.signal)
      if (!info) {
        ctx.emit('fs/observed', target, { kind: 'absent' }, exec)
        throw new FsError(`cannot read "${target.displayPath}": not found`, 'FS_NOT_FOUND')
      }
      if (info.type !== 'file') throw new FsError(`cannot read "${target.displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE')

      // read-ref（token 效率）：同文件、同版本（stat 身份未变）、同窗口的重读，
      // 且文件 ≥ 阈值 → 返回一行引用而非再次灌入全文——早前读取已在会话里，
      // 重发只会扩大未缓存后缀。引用已服务过仍重读 = 模型坚持要内容：本次
      // 降级返回真内容（防循环），状态由随后的全量读重置。编辑自然失效
      // （版本令牌随 stat 身份变化）。观察事件照发——ref 也是一次读取观察。
      const session = exec.agent?.session
      if (caps.refThresholdBytes > 0 && session !== undefined && input.focus === undefined
        && (info.size ?? 0) >= caps.refThresholdBytes) {
        const state = readRefs.get(session)?.get(String(target.targetKey))
        if (state !== undefined && state.version === info.version
          && state.offset === input.offset && state.limit === input.limit
          && !state.refServed) {
          state.refServed = true
          readRefSavedBytes += info.size ?? 0
          readRefCount += 1
          ctx.emit('fs/observed', target, { kind: 'present', version: info.version }, exec)
          return { path: target.displayPath, offset: input.offset, lines: [], totalLines: 0, readRef: true }
        }
      }

      // Stream when the file is large OR size is unknown, so a size-less backend
      // never buffers an arbitrarily large file.
      const chunks = info.size === undefined || info.size >= caps.streamMinSize
        ? await ctx.fs.streamText(target, exec.signal)
        : [await ctx.fs.readText(target, exec.signal)]

      // Focus mode: read the whole text, score lines against the focus, and
      // return only the relevant ranges plus the structural skeleton.
      if (input.focus !== undefined) {
        let full = ''
        for await (const chunk of chunks) full += chunk
        const focused = focusedWindow(full, input.focus, caps.maxBytes)
        const outcome = {
          path: target.displayPath,
          offset: 1,
          lines: focused.lines,
          totalLines: focused.totalLines,
          skeleton: focused.skeleton,
        }
        ctx.emit('fs/observed', target, { kind: 'present', version: info.version }, exec)
        return outcome
      }

      const window = await buildWindow(
        chunks,
        { offset: input.offset, limit: input.limit, maxLineLength: caps.maxLineLength, maxBytes: caps.maxBytes },
        target.displayPath,
      )

      const outcome = {
        path: target.displayPath,
        offset: input.offset,
        lines: window.lines,
        totalLines: window.totalLines,
      }
      // 记录本次全量读的身份与窗口，供后续未变更重读的引用判定。
      if (caps.refThresholdBytes > 0 && session !== undefined) {
        const perSession = readRefs.get(session) ?? new Map<string, ReadRefState>()
        perSession.set(String(target.targetKey), {
          version: info.version,
          offset: input.offset,
          limit: input.limit,
          refServed: false,
        })
        readRefs.set(session, perSession)
      }
      // Record the present observation (a no-op when no policy plugin listens). The
      // read already succeeded; an fs/observed listener is contractually a
      // synchronous, side-effect-only recorder.
      ctx.emit('fs/observed', target, { kind: 'present', version: info.version }, exec)
      return outcome
    },
    // Result-time display: a `read` card carrying the structured line window a
    // capable UI renders as a line-numbered, syntax-highlighted view. The
    // structured data is narrowed from the persisted `meta` (replay-safe); the
    // envelope-stripped model-facing text rides along as `content` so a UI without
    // the read capability still shows the file text. A malformed or absent meta,
    // or a result whose text is not the read envelope, declines to `undefined`
    // (the generic fallback), never throwing on replay of obsolete logged output.
    presentResult(_args, result: ToolResult): ReadResultView | undefined {
      if (result.isError) return undefined
      const meta = readMetaFromMeta(result.meta)
      if (meta === undefined) return undefined
      const only = result.content.length === 1 ? result.content[0] : undefined
      const text = only?.type === 'text' ? only.text : undefined
      if (text === undefined) return undefined
      // Group 1 always captures (possibly empty) when the envelope matches.
      const body = /^<path>[^\n]*<\/path>\n<type>file<\/type>\n<content>\n([\s\S]*)\n<\/content>$/u.exec(text)?.[1]
      if (body === undefined) return undefined
      return {
        card: 'read',
        path: meta.path,
        offset: meta.offset,
        lines: meta.lines,
        totalLines: meta.totalLines,
        ...meta.lang === undefined ? {} : { lang: meta.lang },
        content: [{ type: 'text', text: body }],
      }
    },
    // Pure display: a generic card titled by the file with the read window appended (`Read
    // foo.txt (5 - 8)`), `read` kind (icon), and a follow-along location whose line is the
    // read's offset (defaulting to 1). The window reflects raw args, so an omitted limit keeps
    // the title bare instead of smuggling config into this pure presenter.
    presentCall(args): GenericCallView {
      const { offset, limit } = args
      const window = limit !== undefined && limit > 0
        ? ` (${offset ?? 1} - ${(offset ?? 1) + limit - 1})`
        : offset !== undefined ? ` (from line ${offset})` : ''
      return {
        card: 'generic',
        title: `Read ${args.file_path}${window}`,
        kind: 'read',
        locations: [{ path: args.file_path, line: offset ?? 1 }],
      }
    },
  }))
}
