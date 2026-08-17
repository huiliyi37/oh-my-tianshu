/**
 * `repo_graph` tool — code-graph queries (graph/impact/flow) over the
 * `@huiliyi37/dsh-meridian` SQLite codebase index (Tianshu meridian port).
 * First tool use kicks an on-demand full-project backfill; a bounded
 * codebase-index summary (stats + module table) is contributed to the dynamic
 * context (order 120) so the agent sees the workspace shape without a full
 * dump.
 *
 * The summary is volatile content (it changes as the index grows) and is
 * therefore registered as a *context* contribution, never as a system-prompt
 * section — the runtime-context content-diff injects it only when it actually
 * changes, preserving prefix-cache byte stability (Wave 4 discipline).
 *
 * @module @huiliyi37/dsh-tool-meridian
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Context } from '@huiliyi37/cordis'
import z from '@huiliyi37/schemastery'
import {
  DEFAULT_MERIDIAN_BACKFILL_MAX,
  MeridianIndexer,
  scheduleMeridianBackfill,
  isUnnamedSymbolId,
  queryFlow,
} from '@huiliyi37/dsh-meridian'
import { defineTool } from '@huiliyi37/dsh-tools'
import { generateCodebaseIndexBlock } from './summary.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-meridian'

/** Services required by the meridian tool suite. */
export const inject = ['tools', 'systemPrompt']

/** Plugin config; the index root defaults to the deployment workdir. */
export interface Config {
  /** Workspace root the index scans (must exist — fails loud at load). */
  root?: string
  /** 首次 repo_graph 调用是否触发后台全量索引（默认 true）。 */
  backfillOnDemand?: boolean
  /** 后台全量索引文件数上限（默认 2000）。 */
  backfillMaxFiles?: number
  /** 启动即回填（默认 false，对应天枢 RIVET_MERIDIAN_BACKFILL=1）。 */
  backfillOnStart?: boolean
}

export const Config: z<Config> = z.object({
  root: z.string().required(false),
  backfillOnDemand: z.boolean().default(true),
  backfillMaxFiles: z.number().default(DEFAULT_MERIDIAN_BACKFILL_MAX),
  backfillOnStart: z.boolean().default(false),
})

/** The shape after schemastery applied the defaults. */
type ResolvedConfig = Required<Config>

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`tool-meridian: ${name} must be a positive integer`)
  }
}

/** repo_map 输出中的一行符号记录（名称/种类/行号）。 */
interface SymbolRow { name: string; kind: string; line: number }

/**
 * Register the `repo_graph` tool and the dynamic codebase-index summary. The
 * configured root must exist — a missing workspace fails loud at load instead
 * of silently serving an empty index.
 * @param ctx - plugin context; registrations are effects scoped to this plugin.
 * @param config - resolved plugin configuration from schemastery.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = config as ResolvedConfig
  assertPositiveInteger('backfillMaxFiles', resolved.backfillMaxFiles)
  // root 缺省 = deployment workdir（Config 注释语义；schemastery 无默认值，
  // 未配置时 resolved.root 为 undefined——显式 resolve 步骤，勿删）。
  // resolved.root 类型为 string（Required<Config>）但 schemastery required(false)
  // 下运行时可能 undefined；resolve(undefined) 曾致 loader 装配失败。
  // oxlint-disable-next-line typescript/no-unnecessary-condition
  const root = resolve(resolved.root ?? process.cwd())
  if (!existsSync(root)) {
    throw new Error(`tool-meridian: configured root "${root}" does not exist`)
  }

  const indexer = new MeridianIndexer(root)

  if (resolved.backfillOnStart) {
    scheduleMeridianBackfill(indexer, root, {
      reason: 'startup',
      allowed: true,
      maxFiles: resolved.backfillMaxFiles,
    })
  }

  const tool = defineTool({
    name: 'repo_graph',
    description:
      '查询代码图，找出与给定文件存在结构关联的文件和符号（基于 SQLite 符号/边索引）。'
      + '### 模式\n'
      + '- **graph**（默认）：按调用/导入距离排序，返回带导出符号的相关文件排名。\n'
      + '- **impact**：返回改动该文件的爆炸半径——哪些文件依赖它、需要跑哪些测试。\n'
      + '- **flow**：从指定符号（symbol 参数）出发沿调用/导入边双向追踪，返回沿途的命名符号（路径最多穿过 1 个未命名桥）。\n'
      + '### 何时使用\n'
      + '- 读完文件后，查它依赖什么、什么依赖它\n'
      + '- 编辑前评估爆炸半径（mode: "impact"）；编辑后确认需跑哪些测试\n'
      + '- 沿结构连接在陌生代码中导航；追踪函数/类的数据流（mode: "flow"）',
    parameters: {
      from_file: { type: 'string', required: true, description: '要查关联代码的文件路径（相对项目根）' },
      max_tokens: { type: 'number', description: '响应的 token 预算（默认 2000）' },
      mode: { type: 'string', enum: ['graph', 'impact', 'flow'], description: '查询模式（默认 graph）' },
      symbol: { type: 'string', description: '流查询的起点符号名（mode: "flow" 必填）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          mode: { type: 'string', required: true },
          content: { type: 'string', required: true, description: '渲染好的文本结果（与 render 一致）' },
        },
      },
      render(_args, value) {
        return [{ type: 'text', text: value.content }]
      },
    },
    isConcurrencySafe: () => true,
    async execute(args) {
      const input = args
      const mode = input.mode ?? 'graph'

      // First repo_* use: kick idle full-project backfill (no-op if already
      // scheduled / disabled).
      if (resolved.backfillOnDemand) {
        scheduleMeridianBackfill(indexer, root, {
          reason: 'ondemand',
          allowed: true,
          maxFiles: resolved.backfillMaxFiles,
        })
      }

      if (mode === 'impact') {
        return { mode, content: executeImpact(indexer, input.from_file) }
      }
      if (mode === 'flow') {
        return { mode, content: executeFlow(indexer, input.from_file, input.symbol) }
      }
      return { mode, content: await executeGraph(indexer, input.from_file, input.max_tokens ?? 2000) }
    },
    presentCall: args => ({ card: 'generic', title: `repo_graph(${args.mode ?? 'graph'})` }),
    presentResult: args => ({ card: 'generic', title: `repo_graph(${args.mode ?? 'graph'})` }),
  })
  ctx.tools.register(tool)

  // Volatile workspace shape → dynamic context (order 120), not a frozen
  // section: the runtime-context content-diff injects only on real change.
  ctx.systemPrompt.context({
    name: 'meridian:index',
    order: 120,
    text: () => {
      try {
        return generateCodebaseIndexBlock(indexer.getDb())
      } catch {
        // 派生索引打不开（含误开天枢 meridian.db 的历史路径）：本回合不注入摘要，
        // 避免把 schema 冲突渲染成 ✗ 工具失败。repo_graph 显式调用仍 fails loud。
        return ''
      }
    },
  })
}

async function executeGraph(indexer: MeridianIndexer, fromFile: string, maxTokens: number): Promise<string> {
  const result = await indexer.query(fromFile, { maxTokens })
  if (result.entries.length === 0) {
    return `\`${fromFile}\` 尚无图数据。请先读取该文件以建立索引。`
  }
  const lines: string[] = [
    `## 代码图（起点 \`${fromFile}\`）`,
    `索引：${result.graphSize} 个文件，${result.totalSymbols} 个符号`,
    '',
  ]
  for (const entry of result.entries) {
    lines.push(`### ${entry.filePath}（分数：${entry.score.toFixed(2)}）`)
    for (const sym of entry.symbols) {
      const prefix = sym.kind === 'function' ? 'ƒ' : sym.kind === 'class' ? '◆' : sym.kind === 'interface' || sym.kind === 'type' ? '◇' : '•'
      lines.push(`  ${prefix} ${sym.name} L${sym.line}`)
    }
    lines.push('')
  }
  const content = lines.join('\n')
  return content.length > 15000 ? `${content.slice(0, 15000)}\n…（已截断）` : content
}

/** flow 模式：符号名 → seed id → queryFlow 命名符号 BFS。 */
function executeFlow(indexer: MeridianIndexer, filePath: string, symbolName: string | undefined): string {
  const db = indexer.getDb()
  const symbols = db.getSymbolsForFile(filePath).filter(s => !isUnnamedSymbolId(s.id))
  const available = () => {
    const names = [...new Set(symbols.map(s => s.name))]
    return names.length > 0 ? names.slice(0, 30).join(', ') : '（无——先读取该文件建立索引）'
  }

  if (!symbolName) {
    return `flow 模式需要 symbol 参数。\`${filePath}\` 可用符号：${available()}`
  }

  // 同名多符号（重载/重声明）取行号最小的那个。
  const seed = symbols.filter(s => s.name === symbolName).sort((a, b) => a.line - b.line)[0]
  if (!seed) {
    return `\`${filePath}\` 中找不到符号 \`${symbolName}\`。可用符号：${available()}`
  }

  const hits = queryFlow(db, seed.id).map(h => ({
    name: h.name, kind: h.kind, filePath: h.filePath, line: h.line, hops: h.hops, bridges: h.bridges,
  }))
  if (hits.length === 0) {
    return `\`${symbolName}\`（${filePath} L${seed.line}）尚无流关联。图可能还需要索引更多文件。`
  }

  const lines: string[] = [
    `## 数据流（起点 \`${symbolName}\` @ ${filePath} L${seed.line}）`,
    `命中 ${hits.length} 个命名符号；桥 = 路径经过的未命名占位数（0 = 全程命名直达）`,
    '',
  ]
  const shown = hits.slice(0, 40)
  for (const h of shown) {
    const bridge = h.bridges > 0 ? `（${h.bridges} 桥）` : ''
    lines.push(`- ${h.hops} 跳 ${h.name}（${h.kind}） ${h.filePath}:L${h.line}${bridge}`)
  }
  if (hits.length > shown.length) {
    lines.push(`- ...（另有 ${hits.length - shown.length} 个）`)
  }
  return lines.join('\n')
}

function executeImpact(indexer: MeridianIndexer, filePath: string): string {
  const result = indexer.impact([filePath])

  if (result.totalImpact === 0 && result.tests.length === 0) {
    return `\`${filePath}\` 尚无已知依赖方。图可能还需要索引更多文件。`
  }

  const lines: string[] = [
    `## 影响分析：\`${filePath}\``,
    `受影响合计：${result.totalImpact} 个文件`,
    '',
  ]

  if (result.direct.length > 0) {
    lines.push(`### 直接依赖方（${result.direct.length}）`)
    for (const f of result.direct) lines.push(`- ${f}`)
    lines.push('')
  }

  if (result.transitive.length > 0) {
    lines.push(`### 传递依赖方（${result.transitive.length}）`)
    for (const f of result.transitive.slice(0, 20)) lines.push(`- ${f}`)
    if (result.transitive.length > 20) lines.push(`- ...（另有 ${result.transitive.length - 20} 个）`)
    lines.push('')
  }

  if (result.tests.length > 0) {
    lines.push(`### 应运行的测试（${result.tests.length}）`)
    for (const f of result.tests) lines.push(`- ${f}`)
    lines.push('')
  }

  return lines.join('\n')
}

export type { SymbolRow }
