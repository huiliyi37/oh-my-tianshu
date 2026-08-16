/**
 * 置信度门（纯函数）：检索得分 → STM 注入层级。
 *
 * 设计契约：Agent Note
 * `.agents/notes/proposed/feature/2026-08-16-adaptive-memory-cache-contract.md`
 * 的 Retrieval 一节——自动注入通道上的三层门：
 * - high（score ≥ 高阈值）：条目正文进入 STM 快照；
 * - medium（score ≥ 中阈值）：只进索引行；
 * - low（其余）：不注入——模型保留 memory_search 工具通道。
 *
 * 门只作用于产出归一化 score 的 provider（dsh-memory-sqlite）；Markdown
 * provider 的子串扫描无 score，走阶段一行为（全部索引行，见 index.ts 的
 * 能力探测）。阈值语义随 provider 的 score 定义变化（sqlite：BM25 归一化 ×
 * 状态权重），缺省值是占位（0.82/0.55），待真实任务集调参。
 *
 * @module @huiliyi37/dsh-adaptive-memory/gate
 */

/** STM 注入层级（closed union）。 */
export type StmTier = 'high' | 'medium' | 'low'

/** 置信度门阈值（全部来自插件 Config）。 */
export interface GateThresholds {
  /** 高置信阈值：score ≥ 此值注入条目正文。 */
  high: number
  /** 中置信阈值：score ≥ 此值注入索引行；低于此不注入。 */
  medium: number
}

/**
 * 得分 → 注入层级（确定性纯函数；边界归属：恰好等于阈值进入较高层）。
 * @param score - provider 的归一化相关性得分（0..1）。
 * @param thresholds - 门阈值（插件 Config）。
 * @returns 注入层级。
 */
export function tierOfScore(score: number, thresholds: GateThresholds): StmTier {
  if (score >= thresholds.high) return 'high'
  if (score >= thresholds.medium) return 'medium'
  return 'low'
}
