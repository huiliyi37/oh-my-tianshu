/**
 * `file_info` tool + pheromone signal sources (Tianshu file-perception port).
 *
 * The plugin owns one `StigmergyStore` per configured root and wires two
 * signal sources from the session event stream:
 *   - `read_file` tool calls → `entry-point` deposit (frequent reads mark
 *     entry points);
 *   - bash/tool calls whose command output text matched a failure marker
 *     → `fragile` deposit on the test files named in the command.
 * The `file_info` tool then recalls signals on demand (path-filtered query
 * with decayed strength) — pheromones never enter the system prompt (they
 * are high-frequency volatile content), the tool is the consumption path.
 *
 * All file access goes through the `ctx.fs` service (the same seam as the
 * `read` tool): resolution, versioned stat, and text reading. Paths supplied
 * by the model are normalized to workspace-relative form before they become
 * pheromone keys, so absolute and relative spellings of the same file answer
 * the same query.
 *
 * @module @huiliyi37/dsh-tool-file-info
 */

import { existsSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import type { Context } from '@huiliyi37/cordis'
import z from '@huiliyi37/schemastery'
import { FsError } from '@huiliyi37/dsh-fs'
import type { ContentBlock } from '@huiliyi37/dsh-llm'
import { StigmergyStore } from '@huiliyi37/dsh-pheromone'
import type { SessionEvent } from '@huiliyi37/dsh-session'
import { defineTool } from '@huiliyi37/dsh-tools'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-file-info'

/** Services required by the tool suite: fs is the sandbox/observation seam. */
export const inject = ['tools', 'fs']

/** Plugin config; the workspace root defaults to the deployment workdir. */
export interface Config {
  /** Workspace root (must exist — fails loud at load). */
  root?: string
  /** Cooperative tool-call timeout budget (ms). */
  timeoutMs?: number
}

export const Config: z<Config> = z.object({
  root: z.string().required(false),
  timeoutMs: z.number().default(30_000),
})

type ResolvedConfig = Required<Config>

/** Failure markers shared with evidence-gate's output heuristic. */
const FAILED_RE = /\b(failed|failures?|FAILED|Failing|AssertionError)\b/i
/** Test file paths extracted from a failing command line (workspace-relative). */
const TEST_FILE_RE = /([^\s'"]+\.(?:spec|test)\.[a-z]+)/gi
/** Structural lines for the skeleton preview (focused-read's structural set). */
const STRUCTURAL_LINE = [
  /^\s*(?:import\b|export\b|(?:async\s+)?function\b|class\b|interface\b|type\b|enum\b)/,
  /^\s*(?:const\b|let\b|var\b|def\b|struct\b|impl\b|trait\b|#{1,6}\s)/,
]

/** Entry-point deposit strength for one read_file call (low, decays fast). */
const ENTRY_POINT_STRENGTH = 0.3
/** Fragile deposit strength for one failing verification run. */
const FRAGILE_STRENGTH = 0.8
/** Skeleton preview cap: show at most this many structural lines. */
const SKELETON_MAX_LINES = 5

/** Parse a tool call's arguments JSON (defensive — model payloads are wire data). */
function parseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

/**
 * Normalize a tool-supplied path to the workspace-relative form used as a
 * pheromone key. Absolute paths inside the workspace become relative (a model
 * may call `read_file` with either form; the store must answer both);
 * workspace-external or already-relative paths are kept as-is so no signal is
 * dropped.
 * @param p - the path as supplied on the wire.
 * @param workdir - the configured workspace root.
 * @returns the pheromone key for the path.
 */
function toWorkspaceRelative(p: string, workdir: string): string {
  if (!isAbsolute(p)) return p
  const rel = relative(workdir, p)
  if (rel.startsWith('..') || isAbsolute(rel)) return p
  return rel
}

/**
 * Extract plain text from model-facing content blocks. Tool-result messages
 * wrap their raw blocks in a `tool-result` envelope, so text can sit one level
 * deep — recurse through envelope blocks instead of probing only the top
 * level (a top-level `'text' in block` probe silently misses the failure
 * text and the fragile signal is never deposited).
 * @param content - message content blocks.
 * @returns concatenated text of all text blocks (any nesting depth).
 */
function extractText(content: readonly ContentBlock[]): string {
  const parts: string[] = []
  for (const block of content) {
    if ('text' in block && typeof (block as { text?: unknown }).text === 'string') {
      parts.push((block as { text: string }).text)
    } else if ('content' in block && Array.isArray((block as { content?: unknown }).content)) {
      parts.push(extractText((block as { content: ContentBlock[] }).content))
    }
  }
  return parts.join('\n')
}

/**
 * Register the `file_info` tool and the session-event signal sources.
 * @param ctx - plugin context; registrations are effects scoped to this plugin.
 * @param config - resolved plugin configuration from schemastery.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = config as ResolvedConfig
  // root 缺省 = deployment workdir（Config 注释语义；schemastery 无默认值，
  // 未配置时 resolved.root 为 undefined——显式 resolve 步骤，与 tool-meridian 对齐）。
  // resolved.root 类型为 string（Required<Config>）但 schemastery required(false)
  // 下运行时可能 undefined。
  // oxlint-disable-next-line typescript/no-unnecessary-condition
  const root = resolve(resolved.root ?? process.cwd())
  if (!existsSync(root)) {
    throw new Error(`tool-file-info: configured root "${root}" does not exist`)
  }

  const store = new StigmergyStore(resolve(root, '.rivet', 'pheromones.json'))
  const workdir = root

  // Command lookup: `tool/result` carries no call id, so the fragile source
  // correlates by turn:step. Kept bounded by the session turn count.
  const commands = new Map<string, string>()

  ctx.on('session/event', (_owner: { id: string }, event: SessionEvent) => {
    if (event.type !== 'tool/call') return
    const { name: toolName, arguments: rawArgs, turn, step } = event.data
    const args = parseArgs(rawArgs)
    if (toolName === 'read_file') {
      const file = args.file ?? args.path
      if (typeof file === 'string' && file.length > 0) {
        void store.deposit({ path: toWorkspaceRelative(file, workdir), signal: 'entry-point', strength: ENTRY_POINT_STRENGTH })
      }
      return
    }
    const command = typeof args.command === 'string' ? args.command : ''
    if (command.length > 0) commands.set(`${turn}:${step}`, command)
  })

  // Signal source 2: a failing verification run marks its test files fragile.
  ctx.on('session/event', (_owner: { id: string }, event: SessionEvent) => {
    if (event.type !== 'tool/result') return
    const { turn, step, message } = event.data
    const text = extractText(message.content)
    if (!FAILED_RE.test(text)) return
    const command = commands.get(`${turn}:${step}`)
    if (command === undefined) return
    for (const match of command.matchAll(TEST_FILE_RE)) {
      const file = match[1]
      if (file === undefined) continue
      void store.deposit({ path: toWorkspaceRelative(file, workdir), signal: 'fragile', strength: FRAGILE_STRENGTH, context: 'verification failure' })
    }
  })

  const tool = defineTool({
    name: 'file_info',
    description:
      '查看单个文件的信息：大小、行数与结构骨架（顶层定义行预览），'
      + '并附带该文件的信息素信号（fragile/entry-point 等，衰减强度）。'
      + '适合先探明文件概况再决定是否 read_file 全量读取。',
    parameters: {
      path: { type: 'string', required: true, description: '工作区相对路径' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          size: { type: 'number', required: true },
          lines: { type: 'number', required: true },
          skeleton: { type: 'array', required: true, items: { type: 'string' } },
          pheromones: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                signal: { type: 'string', required: true },
                currentStrength: { type: 'number', required: true },
              },
            },
          },
        },
      },
      render(args, value) {
        const v = value
        const signals = v.pheromones.map(p => `${p.signal}(${p.currentStrength.toFixed(2)})`).join(', ')
        return [{
          type: 'text',
          text: `file_info(${args.path}): ${v.lines} 行, ${v.size} bytes`
            + `\n结构骨架:\n${v.skeleton.join('\n') || '（无）'}`
            + `\n信号: ${signals || '（无）'}`,
        }]
      },
    },
    timeoutMs: resolved.timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      // All file access goes through the fs service (the same seam as `read`):
      // resolution, versioned stat, text reading, and the fs/observed record.
      const target = await ctx.fs.resolve(args.path, { cwd: workdir, signal: exec.signal })
      const info = await ctx.fs.stat(target, exec.signal)
      if (!info) {
        throw new FsError(`file_info: "${args.path}" does not exist under ${workdir}`, 'FS_NOT_FOUND')
      }
      if (info.type !== 'file') {
        throw new FsError(`file_info: "${args.path}" is not a regular file`, 'FS_NOT_REGULAR_FILE')
      }
      const content = await ctx.fs.readText(target, exec.signal)
      const lines = content.split('\n')
      const skeleton: string[] = []
      for (const line of lines) {
        if (skeleton.length >= SKELETON_MAX_LINES) break
        if (STRUCTURAL_LINE.some(re => re.test(line))) skeleton.push(line.trim().slice(0, 120))
      }
      const pheromones = (await store.query(args.path)).map(p => ({
        signal: p.signal,
        currentStrength: p.currentStrength,
      }))
      // Record the observation (no-op when no policy plugin listens) — same
      // contract as the `read` tool: synchronous, side-effect-only recorder.
      ctx.emit('fs/observed', target, { kind: 'present', version: info.version }, exec)
      return {
        size: info.size ?? 0,
        lines: lines.length,
        skeleton,
        pheromones,
      }
    },
    presentCall: args => ({ card: 'generic', title: `file_info(${args.path})` }),
    presentResult: args => ({ card: 'generic', title: `file_info(${args.path})` }),
  })
  ctx.tools.register(tool)
}
