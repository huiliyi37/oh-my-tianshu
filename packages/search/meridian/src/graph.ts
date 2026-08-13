import type { MeridianDb } from './db.ts'
import type { RepoMapEntry, RepoMapResult } from './types.ts'
import { CONFIDENCE_MULTIPLIER } from './types.ts'
import type { MeridianBehavior } from './behavior.ts'

/** 激活传播选项：跳数上限、衰减因子、可选行为信号。 */
export interface ActivationOptions {
  maxHops: number
  decay: number
  behavior?: MeridianBehavior
}

/** repo_map 选项：激活传播 + token 预算。 */
export interface RepoMapOptions extends ActivationOptions {
  maxTokens: number
}

/** 从种子文件出发的激活传播：正/反向边按 hop 衰减，co-edit 行为信号注入。
 * @param db - 数据库。
 * @param seedFile - 种子文件。
 * @param opts - 传播选项。
 * @returns 文件 → 激活分数。 */
export function spreadingActivation(
  db: MeridianDb,
  seedFile: string,
  opts: ActivationOptions,
): Map<string, number> {
  const scores = new Map<string, number>()
  scores.set(seedFile, 1.0)

  const seedSymbols = db.getSymbolsForFile(seedFile)
  let frontier = seedSymbols.map(s => s.id)

  for (let hop = 0; hop < opts.maxHops; hop++) {
    const decayFactor = Math.pow(opts.decay, hop + 1)
    const nextFrontier: string[] = []

    for (const symbolId of frontier) {
      const edges = db.getEdgesFrom(symbolId)
      for (const edge of edges) {
        const targetFile = edge.targetId.split(':')[0] ?? ''
        if (targetFile && !targetFile.includes('*')) {
          const confMult = CONFIDENCE_MULTIPLIER[edge.confidence ?? 'extracted']
          const addition = decayFactor * edge.weight * confMult
          const existing = scores.get(targetFile) ?? 0
          scores.set(targetFile, Math.max(existing, addition))
          nextFrontier.push(edge.targetId)
        }
      }
      // Also traverse reverse edges (who calls me)
      const reverseEdges = db.getEdgesTo(symbolId)
      for (const edge of reverseEdges) {
        const sourceFile = edge.sourceId.split(':')[0] ?? ''
        if (sourceFile && !sourceFile.includes('*')) {
          const confMult = CONFIDENCE_MULTIPLIER[edge.confidence ?? 'extracted']
          const addition = decayFactor * edge.weight * 0.7 * confMult // reverse edges slightly weaker
          const existing = scores.get(sourceFile) ?? 0
          scores.set(sourceFile, Math.max(existing, addition))
          nextFrontier.push(edge.sourceId)
        }
      }
    }
    frontier = nextFrontier
  }

  // P2: inject co-edit behavioral edges
  if (opts.behavior) {
    const coEdges = opts.behavior.getCoEditEdges(seedFile)
    for (const { targetFile, weight } of coEdges) {
      const existing = scores.get(targetFile) ?? 0
      scores.set(targetFile, Math.max(existing, weight))
    }
  }

  return scores
}

const TOKENS_PER_SYMBOL_LINE = 25

/** 构建 repo_map：激活传播 + 行为加成 + token 预算截断。
 * @param db - 数据库。
 * @param seedFile - 种子文件。
 * @param opts - 选项。
 * @returns repo_map 结果。 */
export function buildRepoMap(
  db: MeridianDb,
  seedFile: string,
  opts: RepoMapOptions,
): RepoMapResult {
  const scores = spreadingActivation(db, seedFile, opts)
  const stats = db.getStats()

  const entries: RepoMapEntry[] = []
  for (const [filePath, score] of scores) {
    const symbols = db.getSymbolsForFile(filePath)
    const boost = opts.behavior ? opts.behavior.getFileBoost(filePath) : 0
    entries.push({
      filePath,
      symbols: symbols.map(s => ({ name: s.name, kind: s.kind, line: s.line })),
      score: score + boost,
    })
  }

  entries.sort((a, b) => b.score - a.score)

  // Token budget: binary search on entry count
  let tokenCount = 0
  let cutoff = entries.length
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    if (!entry) break
    const entryTokens = entry.symbols.length * TOKENS_PER_SYMBOL_LINE + 10
    if (tokenCount + entryTokens > opts.maxTokens) {
      cutoff = i
      break
    }
    tokenCount += entryTokens
  }

  return {
    entries: entries.slice(0, Math.max(cutoff, 1)), // always include at least seed
    totalSymbols: stats.symbols,
    graphSize: stats.files,
  }
}
