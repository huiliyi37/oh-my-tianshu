// Meridian 类型面 —— 天枢 src/repo/meridian-types.ts 原样移植（去除 CliEntry 生态类型）。

/** 符号种类（函数/类/接口/类型/变量/方法/枚举/路由）。 */
export type MeridianSymbolKind = 'function' | 'class' | 'interface' | 'type' | 'variable' | 'method' | 'enum' | 'route'

/** 边种类：imports/calls/contains/type_of/co_edit/tested_by/route_handles/jsx_children。 */
export type MeridianEdgeKind = 'imports' | 'calls' | 'contains' | 'type_of' | 'co_edit' | 'tested_by' | 'route_handles' | 'jsx_children'

/** 边置信度：extracted（tree-sitter 提取）/ inferred（命名匹配推断）/ ambiguous（多候选歧义）。 */
export type EdgeConfidence = 'extracted' | 'inferred' | 'ambiguous'

/** 边置信度 → 图查询分数权重（extracted 全值，inferred/ambiguous 打折）。 */
export const CONFIDENCE_MULTIPLIER: Record<EdgeConfidence, number> = {
  extracted: 1.0,
  inferred: 0.7,
  ambiguous: 0.4,
}

/** 一个已索引符号：id = `file:name:line`，含导出标记与内容哈希。 */
export interface MeridianSymbol {
  id: string
  name: string
  kind: MeridianSymbolKind
  filePath: string
  line: number
  exported: boolean
  contentHash: string
}

/** 一条符号间边：source 指向 target，kind + weight + confidence。 */
export interface MeridianEdge {
  sourceId: string
  targetId: string
  kind: MeridianEdgeKind
  weight: number
  confidence?: EdgeConfidence
}

/** A call site whose callee did not resolve to a same-file symbol.
 *  The indexer matches it against cross-file symbols by name after
 *  upserting the file, so the incremental index path rebuilds these edges
 *  together with the file. */
export interface CallSite {
  /** Symbol id of the enclosing (calling) symbol — never the callee. */
  sourceId: string
  /** Callee name extracted from the call_expression. */
  name: string
  line: number
}

/** 单文件解析产物：符号、边、导入串与未解析调用点。 */
export interface ParseResult {
  filePath: string
  contentHash: string
  symbols: MeridianSymbol[]
  edges: MeridianEdge[]
  imports: string[]
  /** Same-file-unresolved call sites, matched cross-file by the indexer. */
  calls: CallSite[]
}

/** repo_map 的一个结果条目：文件路径、导出符号列表与激活分数。 */
export interface RepoMapEntry {
  filePath: string
  symbols: Array<{ name: string; kind: MeridianSymbolKind; line: number }>
  score: number
}

/** repo_map 结果：按分数降序的条目 + 全库统计。 */
export interface RepoMapResult {
  entries: RepoMapEntry[]
  totalSymbols: number
  graphSize: number
}

// ─── Codebase index types (project perception layer) ──────────────────

/** codebase-index 的模块摘要条目（目录级责任/导出/状态）。 */
export interface ModuleSummaryEntry {
  /** Directory path relative to cwd, e.g. "src/agent/" */
  dirPath: string
  /** One-line responsibility summary */
  summary: string
  /** Key exported symbol names */
  keyExports: string[]
  /** Number of source files in this module */
  fileCount: number
  /** active | deprecated | experimental */
  status: string
  /** Aggregate content hash of all files in dir (for incremental detection) */
  contentHash: string
  /** Git commit SHA when this entry was last verified */
  verifiedAtCommit?: string
}
