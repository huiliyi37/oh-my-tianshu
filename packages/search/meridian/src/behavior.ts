// 行为信号层 —— 天枢 src/repo/meridian-behavior.ts 移植。
// StigmergyStore 直接接 dsh-pheromone（形状一致：query() → {path, currentStrength}[]）。

import type { MeridianDb } from './db.ts'
import type { StigmergyStore } from '@huiliyi37/dsh-pheromone'

const CO_EDIT_BLACKLIST = [
  'package.json', 'package-lock.json', 'tsconfig.json',
  '.eslintrc', '.prettierrc', 'yarn.lock', 'pnpm-lock.yaml',
]

function isBlacklisted(filePath: string): boolean {
  return CO_EDIT_BLACKLIST.some(p => filePath.endsWith(p))
}

/** 行为信号权重：结构/协同编辑/访问热度/信息素。 */
export interface BehaviorWeights {
  structural: number
  coEdit: number
  accessHeat: number
  pheromone: number
}

const DEFAULT_WEIGHTS: BehaviorWeights = {
  structural: 1.0,
  coEdit: 0.6,
  accessHeat: 0.3,
  pheromone: 0.2,
}

/** 行为信号层：协同编辑缓冲、访问热度与信息素缓存，供图查询加成。 */
export class MeridianBehavior {
  private editBuffer: Set<string> = new Set()
  private currentTurn = 0
  /** Pre-loaded pheromone cache for sync access during graph queries */
  private pheromoneCache: Map<string, number> = new Map()

  constructor(
    private db: MeridianDb,
    private stigmergy?: StigmergyStore,
    private weights: BehaviorWeights = DEFAULT_WEIGHTS,
  ) {}

  /** Load pheromone signals into cache (call before sync graph queries) */
  async refreshPheromoneCache(): Promise<void> {
    if (!this.stigmergy) return
    const all = await this.stigmergy.query()
    this.pheromoneCache.clear()
    for (const p of all) {
      const existing = this.pheromoneCache.get(p.path) ?? 0
      this.pheromoneCache.set(p.path, existing + p.currentStrength)
    }
  }

  /** 记录编辑；turn 变化时冲刷上一轮协同编辑。
   * @param filePath - 文件路径。
   * @param turn - 轮次。 */
  recordEdit(filePath: string, turn: number): void {
    if (isBlacklisted(filePath)) return
    if (turn !== this.currentTurn) {
      this.flushCoEdits()
      this.currentTurn = turn
      this.editBuffer.clear()
    }
    this.editBuffer.add(filePath)
  }

  /** 把缓冲文件两两写入 co_edits（去黑名单）。 */
  flushCoEdits(): void {
    const files = [...this.editBuffer]
    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        const a = files[i]
        const b = files[j]
        if (a && b) this.db.recordCoEdit(a, b, this.currentTurn)
      }
    }
    this.editBuffer.clear()
  }

  /** 综合加成：协同编辑 + 访问热度 + 信息素（各自封顶加权）。
   * @param filePath - 文件路径。
   * @returns 加成值。 */
  getFileBoost(filePath: string): number {
    let boost = 0
    const coNeighbors = this.db.getCoEditNeighbors(filePath)
    const coEditScore = coNeighbors.reduce((sum, n) => sum + n.weight, 0)
    boost += Math.min(coEditScore, 5.0) * this.weights.coEdit

    const heat = this.db.getAccessHeat(filePath)
    boost += Math.min(heat, 3.0) * this.weights.accessHeat

    const pheromoneScore = this.pheromoneCache.get(filePath) ?? 0
    boost += Math.min(pheromoneScore, 2.0) * this.weights.pheromone

    return boost
  }

  /** 种子文件的协同编辑邻居（去黑名单，权重按 coEdit 加权）。
   * @param seedFile - 种子文件。
   * @returns 邻居列表。 */
  getCoEditEdges(seedFile: string): Array<{ targetFile: string; weight: number }> {
    if (isBlacklisted(seedFile)) return []
    return this.db.getCoEditNeighbors(seedFile)
      .filter(n => !isBlacklisted(n.file))
      .map(n => ({ targetFile: n.file, weight: n.weight * this.weights.coEdit }))
  }
}
