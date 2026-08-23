/**
 * Model-facing read, write, and edit tools over `ctx.fs`. This package owns schemas, validation,
 * read windows, formatting, and observation events, never a concrete provider. An optional
 * event policy supplies mutation guards; without one the tools use unconditional provider calls.
 * @module @huiliyi37/dsh-tool-fs
 */

import type { Context } from '@huiliyi37/cordis'
import z from '@huiliyi37/schemastery'
import type {} from '@huiliyi37/dsh-user-approval'
import { applyReadTool, READ_LIMIT, READ_REF_THRESHOLD_BYTES, STREAM_MIN_SIZE } from './read.ts'
import { applyReadSectionTool } from './read-section.ts'
import { applyWriteTool } from './write.ts'
import { applyEditTool } from './edit.ts'
import { READ_MAX_BYTES, READ_MAX_LINE_LENGTH } from './read-render.ts'
import { FsSandboxSurface } from './sandbox.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-fs'

/** Services required by the filesystem tool suite. */
export const inject = ['tools', 'fs', 'systemPrompt']

/** Plugin config (all optional — `Config` supplies the defaults). */
export interface Config {
  /** Default and maximum number of lines returned by one `read` call. */
  readLimit?: number
  /** Maximum characters returned for a single line before truncation. */
  readMaxLineLength?: number
  /** Maximum bytes returned for the selected lines of one `read` call. */
  readMaxBytes?: number
  /** Files at or above this size stream instead of loading whole into memory. */
  readStreamMinSize?: number
  /**
   * Unchanged re-reads of files at or above this size (same stat version and
   * window) return a one-line `[read-ref]` reference instead of the content
   * again (0 disables; default 2048) — the earlier read is already in the
   * conversation.
   */
  readRefThresholdBytes?: number
}

export const Config: z<Config> = z.object({
  readLimit: z.number().default(READ_LIMIT),
  readMaxLineLength: z.number().default(READ_MAX_LINE_LENGTH),
  readMaxBytes: z.number().default(READ_MAX_BYTES),
  readStreamMinSize: z.number().default(STREAM_MIN_SIZE),
  readRefThresholdBytes: z.number().default(READ_REF_THRESHOLD_BYTES),
})

/** The shape after schemastery applied the defaults. */
type ResolvedConfig = Required<Config>

/** Every read cap counts lines/chars/bytes — a positive integer, or windowing arithmetic misbehaves silently. */
function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) throw new Error(`tool-fs: ${name} must be a positive integer`)
}

/** Register the full `read`/`write`/`edit` filesystem tool suite. */
export function apply(ctx: Context, config: Config): void {
  // schemastery (Config) has already filled every defaulted field.
  const resolved = config as ResolvedConfig
  assertPositiveInteger('readLimit', resolved.readLimit)
  assertPositiveInteger('readMaxLineLength', resolved.readMaxLineLength)
  assertPositiveInteger('readMaxBytes', resolved.readMaxBytes)
  assertPositiveInteger('readStreamMinSize', resolved.readStreamMinSize)
  // read-ref 阈值允许 0（关闭该机制），但仍须是非负整数。
  if (!Number.isInteger(resolved.readRefThresholdBytes) || resolved.readRefThresholdBytes < 0) {
    throw new Error(`tool-fs: readRefThresholdBytes must be a non-negative integer (got ${resolved.readRefThresholdBytes})`)
  }
  applyReadTool(ctx, {
    limit: resolved.readLimit,
    maxLineLength: resolved.readMaxLineLength,
    maxBytes: resolved.readMaxBytes,
    streamMinSize: resolved.readStreamMinSize,
    refThresholdBytes: resolved.readRefThresholdBytes,
  })
  applyReadSectionTool(ctx, {
    limit: resolved.readLimit,
    maxLineLength: resolved.readMaxLineLength,
    maxBytes: resolved.readMaxBytes,
    streamMinSize: resolved.readStreamMinSize,
    refThresholdBytes: resolved.readRefThresholdBytes,
  })
  // One escalation surface shared by both mutating tools: advertisement gating,
  // per-call policy resolution, and denial-marker mapping, all keyed off whether
  // the mounted ctx.fs confines (ctx.fs.sandboxMode).
  const sandbox = new FsSandboxSurface(ctx)
  applyWriteTool(ctx, sandbox)
  applyEditTool(ctx, sandbox)
}
