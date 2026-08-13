// 索引器 —— 天枢 src/repo/meridian-indexer.ts 移植。
// 适配：StigmergyStore ← dsh-pheromone；classifyPath(rel).silent ← 本地 SKIP_DIRS 黑名单。

import { readFileSync, existsSync, realpathSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { MeridianDb } from './db.ts'
import { MeridianBehavior } from './behavior.ts'
import { parseFile, initParser } from './parser.ts'
import { buildRepoMap } from './graph.ts'
import { analyzeImpact, inferTestedByTargets } from './impact.ts'
import { extractExpressRoutes, extractJsxChildren } from './framework.ts'
import type { RepoMapResult, MeridianSymbol, MeridianEdge, MeridianSymbolKind } from './types.ts'
import type { CallSite } from './types.ts'
import type { RepoMapOptions } from './graph.ts'
import type { ImpactResult } from './impact.ts'
import type { StigmergyStore } from '@huiliyi37/dsh-pheromone'

const TS_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx']
const ALL_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go']
const IGNORE_PATTERNS = ['node_modules', 'dist', '.git', '.rivet']
/** 静默目录/文件后缀 —— dsh 噪音过滤惯例（对齐 semantic-index 的 SKIP_DIRS）。 */
const SILENT_DIRS = new Set(['build', 'coverage', 'target', 'vendor', '__pycache__', '.venv', 'venv'])
const SILENT_SUFFIXES = ['.log', '.min.js', '.d.ts', '.map']

/**
 * 可索引判定（扩展名白名单 + IGNORE_PATTERNS + 静默层）——
 * 懒建（indexFile）与后台全量索引（meridian-backfill）共用的单一来源，
 * 防两处规则漂移。输入必须是 repo 相对路径；越界/绝对路径的 fail-closed
 * 归 toRepoRelative 管，不在此层。
 * @param rel - repo 相对路径。
 * @returns 是否可索引。 */
export function isMeridianIndexablePath(rel: string): boolean {
  if (IGNORE_PATTERNS.some(p => rel.includes(p))) return false
  const segments = rel.split('/')
  if (segments.some(seg => SILENT_DIRS.has(seg))) return false
  if (SILENT_SUFFIXES.some(s => rel.endsWith(s))) return false
  return ALL_EXTENSIONS.some(ext => rel.endsWith(ext))
}

// ─── Flow 查询：named-symbol BFS，≤1 个未命名桥 ──────────────────────────

/** flow 查询选项。 */
export interface FlowQueryOptions {
  /** BFS 深度上限（默认 4）。 */
  maxHops?: number
  /** 路径允许的未命名桥数上限（默认 1）。 */
  maxBridges?: number
}

/** flow 命中点：符号信息 + BFS 跳数/桥数。 */
export interface FlowHit {
  symbolId: string
  name: string
  kind: MeridianSymbolKind
  filePath: string
  line: number
  /** 到达该命中点的 BFS 跳数。 */
  hops: number
  /** 路径经过的未命名桥数（0 = 全程命名符号直达）。 */
  bridges: number
}

/** 未命名占位 id（`file:*:0`）判定。
 * @param id - 符号 id。
 * @returns 是否未命名占位。 */
export function isUnnamedSymbolId(id: string): boolean {
  return /:\*:0$/.test(id)
}

/** named-symbol BFS：seed 必须是命名符号；返回的命中点也全是命名符号。
 * @param db - 数据库。
 * @param seedId - 起始符号 id。
 * @param opts - 跳数/桥数上限。
 * @returns 按跳数升序的命中列表。 */
export function queryFlow(db: MeridianDb, seedId: string, opts?: FlowQueryOptions): FlowHit[] {
  const maxHops = opts?.maxHops ?? 4
  const maxBridges = opts?.maxBridges ?? 1
  // 两端 named 约束：未命名 seed 直接拒绝（空结果）。
  if (isUnnamedSymbolId(seedId)) return []
  const seedFile = seedId.split(':')[0] ?? ''
  const seed = db.getSymbolsForFile(seedFile).find(s => s.id === seedId)
  if (!seed) return []

  const hits = new Map<string, FlowHit>()
  const visited = new Set<string>()
  let frontier: Array<{ id: string; bridges: number; hops: number }> = [{ id: seedId, bridges: 0, hops: 0 }]
  visited.add(`${seedId}:0`)

  for (let hop = 0; hop < maxHops && frontier.length > 0; hop++) {
    const next: Array<{ id: string; bridges: number; hops: number }> = []
    for (const cur of frontier) {
      const neighbors = [
        ...db.getEdgesFrom(cur.id).map(e => e.targetId),
        ...db.getEdgesTo(cur.id).map(e => e.sourceId),
      ]
      for (const nid of neighbors) {
        const unnamed = isUnnamedSymbolId(nid)
        const bridges = cur.bridges + (unnamed ? 1 : 0)
        if (bridges > maxBridges) continue
        const key = `${nid}:${bridges}`
        if (visited.has(key)) continue
        visited.add(key)
        if (unnamed) {
          next.push({ id: nid, bridges, hops: cur.hops + 1 })
        } else {
          const file = nid.split(':')[0] ?? ''
          const sym = db.getSymbolsForFile(file).find(s => s.id === nid)
          if (sym) {
            // 同一符号多条路径命中：保留 bridges 更小的那条（≤1 桥优先）。
            const existing = hits.get(nid)
            if (!existing || bridges < existing.bridges) {
              hits.set(nid, {
                symbolId: nid, name: sym.name, kind: sym.kind,
                filePath: sym.filePath, line: sym.line, hops: cur.hops + 1, bridges,
              })
            }
            next.push({ id: nid, bridges, hops: cur.hops + 1 })
          }
        }
      }
    }
    frontier = next
  }
  return [...hits.values()].sort((a, b) => a.hops - b.hops || a.symbolId.localeCompare(b.symbolId))
}

/** 代码图索引器：懒建 indexFile/invalidateFile + 图查询 + 影响分析 + 行为信号接线。 */
export class MeridianIndexer {
  private db: MeridianDb
  private behavior: MeridianBehavior
  private initialized = false
  private indexing = new Set<string>()
  /** 后台全量索引（meridian-backfill）每实例只调度一次的 flag。 */
  backfillScheduled = false

  constructor(private cwd: string, stateDir?: string, stigmergy?: StigmergyStore) {
    const dir = stateDir ?? resolve(cwd, '.rivet')
    this.db = new MeridianDb(dir)
    this.behavior = new MeridianBehavior(this.db, stigmergy)
  }

  /** 数据库句柄。
   * @returns MeridianDb 实例。 */
  getDb(): MeridianDb { return this.db }

  private async ensureInit(): Promise<void> {
    if (!this.initialized) {
      await initParser()
      this.initialized = true
    }
  }

  /** 懒建单文件：hash 幂等（needsParse 短路），1-hop import 展开后写符号/边/测试边/调用边。
   * @param filePath - 文件路径（绝对或相对）。 */
  async indexFile(filePath: string): Promise<void> {
    const rel = this.toRepoRelative(filePath)
    if (rel === null) return
    if (this.indexing.has(rel)) return
    if (!this.isIndexable(rel)) return
    // Bail before touching the disk, not after. Everything below — read, hash,
    // tree-sitter parse — exists only to fill the index, and the 1-hop import
    // expansion at the bottom multiplies it across every direct dependency.
    const absPath = resolve(this.cwd, rel)
    if (!existsSync(absPath)) return

    const source = readFileSync(absPath, 'utf-8')
    const hash = createHash('sha256').update(source).digest('hex').slice(0, 16)

    if (!this.db.needsParse(rel, hash)) {
      this.db.recordAccess(rel)
      return
    }

    await this.ensureInit()
    this.indexing.add(rel)

    try {
      const result = await parseFile(rel, source)
      // Resolve raw import strings to repo-relative paths before storing, so
      // reverse-dependency lookups (getReverseDependents) actually match.
      const resolvedImports = this.resolveImports(rel, result.imports)

      // 1-hop expand first: cross-file symbols must be in the DB before the
      // framework extraction below resolves handlers/components by name.
      for (const resolved of resolvedImports) {
        if (!this.indexing.has(resolved)) {
          await this.indexFile(resolved)
        }
      }

      // Framework edges (route_handles/jsx_children). knownSymbols = this file
      // + symbols from reachable files; fileSymbols stays this-file-only so the
      // JSX enclosing selection never compares against foreign line numbers.
      const known = [...result.symbols, ...resolvedImports.flatMap(imp => this.db.getSymbolsForFile(imp))]
      const fw = this.extractFrameworkEdges(rel, source, result.symbols, known)
      // Single upsertFile with the complete symbol set — a second upsertFile
      // would wipe tested_by edges built below.
      this.db.upsertFile({ ...result, imports: resolvedImports, symbols: [...result.symbols, ...fw.symbols] })
      this.db.recordAccess(rel)

      // Build tested_by edges if this file is a test
      if (this.isTestFile(rel)) {
        this.buildTestEdges(rel)
      }

      for (const e of fw.edges) {
        this.db.upsertEdge(e.sourceId, e.targetId, e.kind, e.weight, e.confidence ?? 'extracted')
      }

      // Cross-file call resolution runs after the import expansion above, so
      // symbols reachable via imports are already in the DB when matched.
      this.buildCallEdges(rel, result.calls)
    } finally {
      this.indexing.delete(rel)
    }
  }

  /** 热更新单文件（与 indexFile 保持同构，避免热路径丢框架边）。
   * @param filePath - 文件路径。 */
  async invalidateFile(filePath: string): Promise<void> {
    const rel = this.toRepoRelative(filePath)
    if (rel === null) return
    if (!this.isIndexable(rel)) return
    const absPath = resolve(this.cwd, rel)
    if (!existsSync(absPath)) return

    await this.ensureInit()
    const source = readFileSync(absPath, 'utf-8')
    const result = await parseFile(rel, source)
    const resolvedImports = this.resolveImports(rel, result.imports)
    // Framework extraction on the hot-update path too: upsertFile wipes all
    // symbols/out-edges for the file, so without this the route symbols and
    // route_handles/jsx_children edges disappear after every agent edit.
    const known = [...result.symbols, ...resolvedImports.flatMap(imp => this.db.getSymbolsForFile(imp))]
    const fw = this.extractFrameworkEdges(rel, source, result.symbols, known)
    this.db.upsertFile({ ...result, imports: resolvedImports, symbols: [...result.symbols, ...fw.symbols] })
    // Hot-update must rebuild tested_by edges too — keep this path in lockstep
    // with indexFile.
    if (this.isTestFile(rel)) {
      this.buildTestEdges(rel)
    }
    for (const e of fw.edges) {
      this.db.upsertEdge(e.sourceId, e.targetId, e.kind, e.weight, e.confidence ?? 'extracted')
    }
    this.buildCallEdges(rel, result.calls)
  }

  /** Shared framework-edge extraction for the indexFile and invalidateFile
   *  paths — keeps the two production paths in lockstep so hot updates never
   *  silently drop framework edges. */
  private extractFrameworkEdges(
    rel: string,
    source: string,
    fileSymbols: MeridianSymbol[],
    knownSymbols: MeridianSymbol[],
  ): { symbols: MeridianSymbol[]; edges: MeridianEdge[] } {
    const out: { symbols: MeridianSymbol[]; edges: MeridianEdge[] } = { symbols: [], edges: [] }
    const fw = extractExpressRoutes(rel, source, knownSymbols)
    out.symbols.push(...fw.symbols)
    out.edges.push(...fw.edges)
    const jsx = extractJsxChildren(rel, source, fileSymbols, knownSymbols)
    out.edges.push(...jsx.edges)
    return out
  }

  /** 删除文件处理：跨文件入边复活为 pending 而非静默断裂。
   * @param filePath - 文件路径。
   * @returns 复活条数。 */
  removeFile(filePath: string): number {
    const rel = this.toRepoRelative(filePath)
    if (rel === null) return 0
    if (!this.isIndexable(rel)) return 0
    return reviveDeletedFile(this.db, rel)
  }

  /** 以文件为起点的图查询（repo_map）。
   * @param seedFile - 种子文件路径。
   * @param opts - 跳数/衰减/token 预算。
   * @returns repo_map 结果。 */
  async query(seedFile: string, opts?: Partial<RepoMapOptions>): Promise<RepoMapResult> {
    await this.behavior.refreshPheromoneCache()
    return buildRepoMap(this.db, seedFile, {
      maxHops: opts?.maxHops ?? 3,
      decay: opts?.decay ?? 0.5,
      maxTokens: opts?.maxTokens ?? 2000,
      behavior: this.behavior,
    })
  }

  /** 记录一次编辑（行为信号：协同编辑）。
   * @param filePath - 文件路径。
   * @param turn - 轮次。 */
  recordEdit(filePath: string, turn: number): void {
    const rel = this.toRepoRelative(filePath)
    if (rel === null) return
    this.behavior.recordEdit(rel, turn)
  }

  /** 冲刷当前轮协同编辑。 */
  flushTurn(): void {
    this.behavior.flushCoEdits()
  }

  /** 影响半径分析。
   * @param changedFiles - 变更文件列表。
   * @param opts - 跳数上限。
   * @returns 直接/传递依赖与应跑测试。 */
  impact(changedFiles: string[], opts?: { maxHops?: number }): ImpactResult {
    return analyzeImpact(this.db, changedFiles, opts)
  }

  /** 按命名约定 + 全库文件推断 tested_by 边。
   * @param testFilePath - 测试文件路径。 */
  buildTestEdges(testFilePath: string): void {
    const allFiles = this.db.getAllFiles()
    const targets = inferTestedByTargets(testFilePath, allFiles)
    for (const target of targets) {
      const sourceId = `${testFilePath}:*:0`
      const targetId = `${target}:*:0`
      this.db.upsertEdge(sourceId, targetId, 'tested_by', 0.7, 'inferred')
    }
  }

  /** Resolve same-file-unresolved call sites against cross-file symbols by name.
   *  Unique match → inferred; multiple matches → ambiguous on every candidate. */
  private buildCallEdges(fromFile: string, calls: CallSite[]): void {
    if (calls.length === 0) return
    const allSymbols = this.db.getAllSymbols()
    for (const call of calls) {
      const matches = allSymbols.filter(s => s.name === call.name && s.filePath !== fromFile)
      if (matches.length === 0) continue
      if (matches.length === 1) {
        const target = matches[0]
        if (target) this.db.upsertEdge(call.sourceId, target.id, 'calls', 1.0, 'inferred')
      } else {
        for (const m of matches) {
          this.db.upsertEdge(call.sourceId, m.id, 'calls', 1.0, 'ambiguous')
        }
      }
    }
  }

  /** 全库统计。
   * @returns 文件/符号/边计数。 */
  /** 全库统计。
   * @returns 文件/符号/边计数。 */
  getStats(): { files: number; symbols: number; edges: number } {
    return this.db.getStats()
  }

  /** 关闭数据库连接。 */
  close(): void {
    this.db.close()
  }

  /** Normalize to repo-relative path for classification & DB keys.
   *  Returns null for any path that resolves outside the repo root —
   *  covers both absolute paths and relative `../` traversal.
   *  Fail-closed: the indexer must never read/parse/store files
   *  outside the project boundary. */
  private toRepoRelative(filePath: string): string | null {
    const absCwd = resolve(this.cwd)
    // Symlink hardening: canonicalize both sides before the prefix check.
    let realCwd: string
    try {
      realCwd = realpathSync(this.cwd)
    } catch {
      realCwd = absCwd
    }
    const absFile = resolve(absCwd, filePath)
    // Prefix guard BEFORE slicing: a shared-prefix outside path
    // (e.g. cwd+'-other/...') would otherwise leave a residual suffix that lands
    // inside realCwd after rebasing and pass the check.
    if (!absFile.startsWith(absCwd + '/')) return null
    let realFile: string
    try {
      // Existing file: resolve symlinks so an in-repo link pointing outside
      // the project boundary fails the prefix check.
      realFile = realpathSync(absFile)
    } catch {
      // Non-existent file (classification probe): resolve within the real cwd
      // domain — realpath(absFile) would throw, and an unresolved absFile
      // compared against a realpath'd cwd mismatches on macOS /var→/private/var.
      realFile = resolve(realCwd, '.' + absFile.slice(absCwd.length))
    }
    if (!realFile.startsWith(realCwd + '/')) return null
    // Key by the non-canonical relative path so DB keys stay stable
    // regardless of symlink resolution differences across runs.
    return absFile.slice(absCwd.length + 1)
  }

  private isIndexable(filePath: string): boolean {
    const rel = this.toRepoRelative(filePath)
    if (rel === null) return false
    return isMeridianIndexablePath(rel)
  }

  private isTestFile(filePath: string): boolean {
    return filePath.includes('.test.') || filePath.includes('.spec.') ||
      filePath.includes('__tests__/') || filePath.includes('test/')
  }

  /** Resolve a list of raw import strings to deduped repo-relative paths.
   *  External packages (zod, node:fs) and tsconfig path aliases (@/, ~) fail
   *  resolution and are dropped — they carry no reverse-dependency value here. */
  private resolveImports(fromFile: string, imports: string[]): string[] {
    const seen = new Set<string>()
    for (const imp of imports) {
      const resolved = this.resolveImport(fromFile, imp)
      if (resolved) seen.add(resolved)
    }
    return [...seen]
  }

  private resolveImport(fromFile: string, importPath: string): string | null {
    const baseDir = dirname(resolve(this.cwd, fromFile))
    for (const ext of TS_EXTENSIONS) {
      const withExt = resolve(baseDir, importPath.replace(/\.[jt]sx?$/, '') + ext)
      if (existsSync(withExt)) {
        return withExt.slice(resolve(this.cwd).length + 1)
      }
      const indexFile = resolve(baseDir, importPath, 'index' + ext)
      if (existsSync(indexFile)) {
        return indexFile.slice(resolve(this.cwd).length + 1)
      }
    }
    return null
  }
}

/** 删除文件处理：文件删除后，跨文件入边复活为 pending——target
 *  从具体符号 `file:sym:line` 重定向到文件级占位 `file:*:0`，依赖关系不静默
 *  断裂。文件重新索引时 buildCallEdges 会按名字重建精确边。
 * @param db - 数据库。
 * @param rel - repo 相对路径。
 * @returns 复活条数。 */
export function reviveDeletedFile(db: MeridianDb, rel: string): number {
  const symbols = db.getSymbolsForFile(rel)
  let revived = 0
  for (const sym of symbols) {
    for (const edge of db.getEdgesTo(sym.id)) {
      const sourceFile = edge.sourceId.split(':')[0]
      if (sourceFile && sourceFile !== rel) {
        db.upsertEdge(edge.sourceId, `${rel}:*:0`, edge.kind, edge.weight, edge.confidence ?? 'extracted')
        revived++
      }
    }
  }
  // 清空该文件的符号与出边（files 行保留占位，contentHash 置空使重现文件
  // 的 needsParse 判定必然为 true，触发重新解析）。
  db.upsertFile({ filePath: rel, contentHash: '', symbols: [], edges: [], imports: [], calls: [] })
  return revived
}
