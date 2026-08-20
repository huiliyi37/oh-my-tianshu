/**
 * `semantic_search` tool — workspace code retrieval over
 * `@huiliyi37/dsh-semantic-index` (Tianshu `semantic_search` port). The
 * plugin owns one index instance per configured root; each execution runs the
 * single-flight refresh (staleness check → incremental update, all
 * asynchronous IO) → hybrid search pipeline, and a bounded index summary is
 * contributed to the dynamic context (order 120) so the agent sees the
 * workspace shape without a full dump.
 *
 * The summary renders in-memory index state only (freshness comes from the
 * mount-time warm-up refresh and per-execution refreshes) — prompt assembly
 * never touches the filesystem. The summary is volatile content (it changes
 * as the index changes) and is therefore registered as a *context*
 * contribution, never as a system-prompt section — the runtime-context
 * content-diff injects it only when it actually changes, preserving
 * prefix-cache byte stability (Wave 4 discipline).
 *
 * @module @huiliyi37/dsh-tool-semantic-search
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Context } from '@huiliyi37/cordis'
import z from '@huiliyi37/schemastery'
import { STALE_CHECK_TTL_MS, SemanticIndex } from '@huiliyi37/dsh-semantic-index'
import { defineTool } from '@huiliyi37/dsh-tools'
import { renderIndexSummary } from './summary.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-semantic-search'

/** Services required by the search tool suite. */
export const inject = ['tools', 'systemPrompt']

/** Plugin config; the index root defaults to the deployment workdir. */
export interface Config {
  /** Workspace root the index scans (must exist — fails loud at load). */
  root?: string
  /** Max source files indexed in one pass. */
  maxFiles?: number
  /** Staleness-verdict cache window (ms) reused by each refresh. */
  staleTtlMs?: number
  /** Cooperative tool-call timeout budget (ms). */
  timeoutMs?: number
}

export const Config: z<Config> = z.object({
  root: z.string().required(false),
  maxFiles: z.number().default(500),
  staleTtlMs: z.number().default(STALE_CHECK_TTL_MS),
  timeoutMs: z.number().default(30_000),
})

/** The shape after schemastery applied the defaults. */
type ResolvedConfig = Required<Config>

/** Search caps are positive integers, or staleness/limit arithmetic misbehaves silently. */
function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`tool-semantic-search: ${name} must be a positive integer`)
  }
}

/**
 * Register the `semantic_search` tool and the dynamic index summary. The
 * configured root must exist — a missing workspace fails loud at load instead
 * of silently serving an empty index.
 * @param ctx - plugin context; registrations are effects scoped to this plugin.
 * @param config - resolved plugin configuration from schemastery.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = config as ResolvedConfig
  assertPositiveInteger('maxFiles', resolved.maxFiles)
  assertPositiveInteger('staleTtlMs', resolved.staleTtlMs)
  assertPositiveInteger('timeoutMs', resolved.timeoutMs)
  // root 缺省 = deployment workdir（Config 注释语义；schemastery 无默认值，
  // 未配置时 resolved.root 为 undefined——显式 resolve 步骤，与 tool-meridian 对齐）。
  // oxlint-disable-next-line typescript/no-unnecessary-condition
  const root = resolve(resolved.root ?? process.cwd())
  if (!existsSync(root)) {
    throw new Error(`tool-semantic-search: configured root "${root}" does not exist`)
  }

  const index = new SemanticIndex(root, undefined, { staleTtlMs: resolved.staleTtlMs })

  // Off the critical path: warm the index (and thus the summary) without
  // blocking plugin apply or prompt assembly. A failed warm-up degrades to a
  // cold index — the next tool execution retries the refresh.
  void index.refresh().catch((error: unknown) => {
    ctx.logger.warn('semantic index warm-up refresh failed: %o', error)
  })

  const tool = defineTool({
    name: 'semantic_search',
    description:
      '按语义检索工作区代码：BM25 词项匹配（含中文 bigram）+ 路径注意力排序，返回相关文件与行段。'
      + '适合"找与 X 相关的代码"型问题；精确文件名/路径请用 glob。',
    parameters: {
      query: { type: 'string', required: true, description: '检索词（中英文均可）' },
      limit: { type: 'number', description: '返回条数上限（默认 10，上限 50）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          hits: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                file: { type: 'string', required: true },
                startLine: { type: 'number', required: true },
                endLine: { type: 'number', required: true },
                text: { type: 'string', required: true },
                score: { type: 'number', required: true },
              },
            },
          },
          backend: { type: 'string', required: true },
        },
      },
      render(args, value) {
        const hits = value.hits as unknown as Array<{ file: string; startLine: number; endLine: number; text: string; score: number }>
        if (hits.length === 0) return [{ type: 'text', text: `semantic_search(${args.query}): 无命中` }]
        const body = hits.map(hit => `${hit.file}:${hit.startLine}-${hit.endLine} (${hit.score.toFixed(3)})\n${hit.text}`).join('\n\n')
        return [{ type: 'text', text: `semantic_search(${args.query}): ${hits.length} hits\n${body}` }]
      },
    },
    timeoutMs: resolved.timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args) {
      const limit = Math.min(Math.max(1, Math.floor(args.limit ?? 10)), 50)
      await index.refresh()
      const { hits, backend } = await index.searchHybrid(args.query, limit)
      return {
        hits: hits.map(hit => ({
          file: hit.file,
          startLine: hit.startLine,
          endLine: hit.endLine,
          text: hit.text,
          score: hit.score,
        })),
        backend,
      }
    },
    presentCall: args => ({ card: 'generic', title: `semantic_search(${args.query})` }),
    presentResult: args => ({ card: 'generic', title: `semantic_search(${args.query})` }),
  })
  ctx.tools.register(tool)

  // Volatile workspace shape → dynamic context (order 120), not a frozen
  // section: the runtime-context content-diff injects only on real change.
  ctx.systemPrompt.context({
    name: 'semantic:index',
    order: 120,
    text: () => renderIndexSummary(index),
  })
}
