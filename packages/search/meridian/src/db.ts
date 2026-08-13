// MeridianDB 数据层 —— 天枢 src/repo/meridian-db.ts 移植（node:sqlite 适配，schema 裁剪为 6 表）。
// 适配点：better-sqlite3 独有 API（transaction()/pragma()）用本地包装替代；
// 生态表（physarum/immune/mistake/p3/sensorimotor/cli_entries）裁剪——dsh 无消费者。

import { join } from 'node:path'
import { existsSync, mkdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import type { ParseResult, MeridianSymbol, MeridianEdge, EdgeConfidence } from './types.ts'
import type { ModuleSummaryEntry } from './types.ts'

/** 当前 schema 版本（SQLite user_version，dsh 惯例：单调递增、拒绝旧格式）。 */
export const MERIDIAN_SCHEMA_VERSION = 1

const SCHEMA = `
CREATE TABLE IF NOT EXISTS files (
  path TEXT PRIMARY KEY,
  content_hash TEXT NOT NULL,
  indexed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS symbols (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  file_path TEXT NOT NULL,
  line INTEGER NOT NULL,
  exported INTEGER NOT NULL DEFAULT 0,
  content_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_path);
CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);

CREATE TABLE IF NOT EXISTS edges (
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0,
  confidence TEXT NOT NULL DEFAULT 'extracted',
  PRIMARY KEY(source_id, target_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);

CREATE TABLE IF NOT EXISTS access_log (
  file_path TEXT NOT NULL,
  accessed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_access_file ON access_log(file_path);

CREATE TABLE IF NOT EXISTS co_edits (
  file_a TEXT NOT NULL,
  file_b TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0,
  last_turn INTEGER NOT NULL,
  PRIMARY KEY(file_a, file_b)
);
CREATE INDEX IF NOT EXISTS idx_co_edits_a ON co_edits(file_a);
CREATE INDEX IF NOT EXISTS idx_co_edits_b ON co_edits(file_b);

CREATE TABLE IF NOT EXISTS module_summaries (
  dir_path TEXT PRIMARY KEY,
  summary TEXT NOT NULL,
  key_exports_json TEXT NOT NULL DEFAULT '[]',
  file_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  content_hash TEXT NOT NULL DEFAULT '',
  verified_at_commit TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`

/**
 * Escape GLOB wildcards so a literal file path can be used with SQLite GLOB.
 * LIKE treats underscore as a single-char wildcard, so path-prefix queries
 * must use GLOB with the literal path escaped.
 */
function globEscape(filePath: string): string {
  return filePath.replace(/[*?[]/g, '[$&]')
}

/** 事务包装：node:sqlite 无 better-sqlite3 的 db.transaction()，手动 BEGIN/COMMIT/ROLLBACK。 */
function withTransaction(conn: DatabaseSync, fn: () => void): void {
  conn.exec('BEGIN')
  try {
    fn()
    conn.exec('COMMIT')
  } catch (err) {
    conn.exec('ROLLBACK')
    throw err
  }
}

function toSymbol(row: Record<string, unknown>): MeridianSymbol {
  return {
    id: row.id as string,
    name: row.name as string,
    kind: row.kind as MeridianSymbol['kind'],
    filePath: row.file_path as string,
    line: row.line as number,
    exported: (row.exported as number) === 1,
    contentHash: row.content_hash as string,
  }
}

function toEdge(row: Record<string, unknown>): MeridianEdge {
  return {
    sourceId: row.source_id as string,
    targetId: row.target_id as string,
    kind: row.kind as MeridianEdge['kind'],
    weight: row.weight as number,
    confidence: (row.confidence ?? 'extracted') as EdgeConfidence,
  }
}

/** Meridian 代码库索引的 SQLite 数据层（node:sqlite，WAL + user_version 校验）。 */
export class MeridianDb {
  private conn: DatabaseSync | null = null
  private readonly stateDir: string

  constructor(stateDir: string) {
    this.stateDir = stateDir
  }

  /** 懒连接：首次触碰时打开并校验版本。版本不符 fails loud（拒绝打开）。 */
  private get db(): DatabaseSync {
    if (!this.conn) {
      if (!existsSync(this.stateDir)) mkdirSync(this.stateDir, { recursive: true })
      const dbPath = join(this.stateDir, 'meridian.db')
      const conn = new DatabaseSync(dbPath)
      try {
        conn.exec('PRAGMA journal_mode = WAL')
        conn.exec('PRAGMA busy_timeout = 3000')
        this.assertSchemaVersion(conn)
        conn.exec(SCHEMA)
        this.setSchemaVersion(conn)
        this.conn = conn
      } catch (err) {
        conn.close()
        throw err
      }
    }
    return this.conn
  }

  /** user_version 校验：0 且无对象 → 新库待初始化；0 且有对象 → 未版本化拒绝；非当前 → 拒绝。 */
  private assertSchemaVersion(conn: DatabaseSync): void {
    const { user_version: onDisk } = conn.prepare('PRAGMA user_version').get() as { user_version: number }
    if (onDisk === 0) {
      const { count } = conn.prepare(
        "SELECT COUNT(*) AS count FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*'",
      ).get() as { count: number }
      if (count > 0) {
        throw new Error('meridian database has an unversioned schema (application created it without user_version)')
      }
      return // fresh database — initialization below
    }
    if (onDisk !== MERIDIAN_SCHEMA_VERSION) {
      throw new Error(`meridian database has schema version ${onDisk}, incompatible with this build (${MERIDIAN_SCHEMA_VERSION})`)
    }
  }

  private setSchemaVersion(conn: DatabaseSync): void {
    conn.exec(`PRAGMA user_version = ${MERIDIAN_SCHEMA_VERSION}`)
  }

  /** 当前 schema 版本。版本不匹配/库不可用 → 抛错（fails loud，不静默降级）。
   * @returns user_version。 */
  schemaVersion(): number {
    return (this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
  }

  /** 该文件是否需要重新解析（内容哈希变化或从未索引）。
   * @param filePath - repo 相对路径。
   * @param contentHash - 当前内容哈希。
   * @returns true 表示需要解析。 */
  needsParse(filePath: string, contentHash: string): boolean {
    const row = this.db.prepare('SELECT content_hash FROM files WHERE path = ?').get(filePath) as { content_hash: string } | undefined
    return !row || row.content_hash !== contentHash
  }

  /** 单文件解析结果入库（事务）：替换 files 行、清旧符号/出边、写新符号/边/导入边。
   * @param result - 解析产物。 */
  upsertFile(result: ParseResult): void {
    const conn = this.db
    withTransaction(conn, () => {
      conn.prepare('INSERT OR REPLACE INTO files (path, content_hash) VALUES (?, ?)').run(result.filePath, result.contentHash)
      conn.prepare('DELETE FROM symbols WHERE file_path = ?').run(result.filePath)
      // GLOB 而非 LIKE——LIKE 把 _ 当单字符通配，误删相似命名文件的边。
      const escapedPath = globEscape(result.filePath)
      conn.prepare('DELETE FROM edges WHERE source_id GLOB ?').run(`${escapedPath}:*`)

      const insertSym = conn.prepare('INSERT OR REPLACE INTO symbols (id, name, kind, file_path, line, exported, content_hash) VALUES (?, ?, ?, ?, ?, ?, ?)')
      for (const s of result.symbols) {
        insertSym.run(s.id, s.name, s.kind, s.filePath, s.line, s.exported ? 1 : 0, s.contentHash)
      }

      const insertEdge = conn.prepare('INSERT OR REPLACE INTO edges (source_id, target_id, kind, weight, confidence) VALUES (?, ?, ?, ?, ?)')
      for (const e of result.edges) {
        insertEdge.run(e.sourceId, e.targetId, e.kind, e.weight, e.confidence ?? 'extracted')
      }

      for (const imp of result.imports) {
        const firstSymbol = result.symbols[0]
        if (firstSymbol) {
          insertEdge.run(firstSymbol.id, `${imp}:*:0`, 'imports', 1.0, 'extracted')
        }
      }
    })
  }

  /** 某文件的全部已索引符号。
   * @param filePath - repo 相对路径。
   * @returns 符号列表。 */
  getSymbolsForFile(filePath: string): MeridianSymbol[] {
    return (this.db.prepare('SELECT * FROM symbols WHERE file_path = ?').all(filePath) as Array<Record<string, unknown>>).map(toSymbol)
  }

  /** 全部已索引符号——跨文件 callee 名匹配读它。
   * @returns 符号列表。 */
  getAllSymbols(): MeridianSymbol[] {
    return (this.db.prepare('SELECT * FROM symbols').all() as Array<Record<string, unknown>>).map(toSymbol)
  }

  /** 某符号的出边。
   * @param symbolId - 符号 id。
   * @returns 出边列表。 */
  getEdgesFrom(symbolId: string): MeridianEdge[] {
    return (this.db.prepare('SELECT * FROM edges WHERE source_id = ?').all(symbolId) as Array<Record<string, unknown>>).map(toEdge)
  }

  /** 某符号的入边。
   * @param symbolId - 符号 id。
   * @returns 入边列表。 */
  getEdgesTo(symbolId: string): MeridianEdge[] {
    return (this.db.prepare('SELECT * FROM edges WHERE target_id = ?').all(symbolId) as Array<Record<string, unknown>>).map(toEdge)
  }

  /** 记录一次文件访问（access_log 追加）。
   * @param filePath - repo 相对路径。 */
  recordAccess(filePath: string): void {
    this.db.prepare('INSERT INTO access_log (file_path) VALUES (?)').run(filePath)
  }

  /** 访问热度：最近 20 次访问按半衰期衰减求和。
   * @param filePath - repo 相对路径。
   * @param decayHalfLifeN - 半衰期（以访问序计）。
   * @returns 热度值。 */
  getAccessHeat(filePath: string, decayHalfLifeN = 10): number {
    const rows = this.db.prepare(
      'SELECT accessed_at FROM access_log WHERE file_path = ? ORDER BY rowid DESC LIMIT 20',
    ).all(filePath) as Array<{ accessed_at: string }>
    let heat = 0
    for (let i = 0; i < rows.length; i++) {
      heat += Math.pow(0.5, i / decayHalfLifeN)
    }
    return heat
  }

  /** 全库统计（文件/符号/边计数）。
   * @returns 三项计数。 */
  getStats(): { files: number; symbols: number; edges: number } {
    const files = (this.db.prepare('SELECT COUNT(*) as cnt FROM files').get() as { cnt: number }).cnt
    const symbols = (this.db.prepare('SELECT COUNT(*) as cnt FROM symbols').get() as { cnt: number }).cnt
    const edges = (this.db.prepare('SELECT COUNT(*) as cnt FROM edges').get() as { cnt: number }).cnt
    return { files, symbols, edges }
  }

  /** 记录一次协同编辑（无向、去重、权重递增封顶）。
   * @param fileA - 文件 A。
   * @param fileB - 文件 B。
   * @param turn - 所在轮次。 */
  recordCoEdit(fileA: string, fileB: string, turn: number): void {
    const [a, b] = fileA < fileB ? [fileA, fileB] : [fileB, fileA]
    this.db.prepare(`
      INSERT INTO co_edits (file_a, file_b, weight, last_turn)
      VALUES (?, ?, 1.0, ?)
      ON CONFLICT(file_a, file_b) DO UPDATE SET
        weight = MIN(weight + 0.5, 5.0),
        last_turn = excluded.last_turn
    `).run(a, b, turn)
  }

  /** 协同编辑邻居（双向查询）。
   * @param filePath - repo 相对路径。
   * @returns 邻居文件与权重。 */
  getCoEditNeighbors(filePath: string): Array<{ file: string; weight: number }> {
    return this.db.prepare(`
      SELECT file_b as file, weight FROM co_edits WHERE file_a = ?
      UNION ALL
      SELECT file_a as file, weight FROM co_edits WHERE file_b = ?
    `).all(filePath, filePath) as Array<{ file: string; weight: number }>
  }

  /** 依赖此文件的所有文件（逆向边：谁 import/调用进此文件）。 */
  /** 依赖此文件的所有文件（逆向边：谁 import/调用进此文件）。
   * @param filePath - repo 相对路径。
   * @returns 依赖方文件与边信息。 */
  getReverseDependents(filePath: string): Array<{ file: string; kind: string; weight: number }> {
    return this.db.prepare(`
      SELECT DISTINCT
        substr(e.source_id, 1, instr(e.source_id, ':') - 1) as file,
        e.kind,
        e.weight
      FROM edges e
      WHERE e.target_id GLOB ? || ':*'
        AND substr(e.source_id, 1, instr(e.source_id, ':') - 1) != ?
    `).all(globEscape(filePath), filePath) as Array<{ file: string; kind: string; weight: number }>
  }

  /** 此文件依赖的文件（imports 出边，与 getReverseDependents 对称）。
   * @param filePath - repo 相对路径。
   * @returns 被依赖文件与边信息。 */
  getForwardDependencies(filePath: string): Array<{ file: string; kind: string; weight: number }> {
    return this.db.prepare(`
      SELECT DISTINCT
        substr(e.target_id, 1, instr(e.target_id, ':') - 1) as file,
        e.kind,
        e.weight
      FROM edges e
      WHERE e.kind = 'imports'
        AND e.source_id GLOB ? || ':*'
        AND substr(e.target_id, 1, instr(e.target_id, ':') - 1) != ?
    `).all(globEscape(filePath), filePath) as Array<{ file: string; kind: string; weight: number }>
  }

  /** tested_by 边关联的测试文件。 */
  /** tested_by 边关联的测试文件。
   * @param filePath - repo 相对路径。
   * @returns 测试文件路径列表。 */
  getTestsFor(filePath: string): string[] {
    const rows = this.db.prepare(`
      SELECT DISTINCT substr(e.source_id, 1, instr(e.source_id, ':') - 1) as file
      FROM edges e
      WHERE e.target_id GLOB ? || ':*' AND e.kind = 'tested_by'
    `).all(globEscape(filePath)) as Array<{ file: string }>
    return rows.map(r => r.file)
  }

  /** 全部已索引文件路径。 */
  /** 全部已索引文件路径。
   * @returns 文件路径列表。 */
  getAllFiles(): string[] {
    return (this.db.prepare('SELECT path FROM files').all() as Array<{ path: string }>).map(r => r.path)
  }

  /** 插入或更新单条边。
   * @param sourceId - 源符号 id。
   * @param targetId - 目标符号 id。
   * @param kind - 边种类。
   * @param weight - 权重。
   * @param confidence - 置信度。 */
  upsertEdge(sourceId: string, targetId: string, kind: string, weight: number, confidence: EdgeConfidence = 'extracted'): void {
    this.db.prepare(
      'INSERT OR REPLACE INTO edges (source_id, target_id, kind, weight, confidence) VALUES (?, ?, ?, ?, ?)',
    ).run(sourceId, targetId, kind, weight, confidence)
  }

  // ─── Codebase index (module summaries) ──────────────────────────────

  /** 插入或更新模块摘要。
   * @param entry - 摘要条目。 */
  upsertModuleSummary(entry: ModuleSummaryEntry): void {
    this.db.prepare(`INSERT OR REPLACE INTO module_summaries (dir_path, summary, key_exports_json, file_count, status, content_hash, verified_at_commit, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`).run(
      entry.dirPath,
      entry.summary,
      JSON.stringify(entry.keyExports),
      entry.fileCount,
      entry.status,
      entry.contentHash,
      entry.verifiedAtCommit ?? null,
    )
  }

  /** 全部模块摘要（按目录排序）。
   * @returns 摘要列表。 */
  getModuleSummaries(): ModuleSummaryEntry[] {
    const rows = this.db.prepare('SELECT * FROM module_summaries ORDER BY dir_path').all() as Array<Record<string, unknown>>
    return rows.map((r) => {
      const verified = (r.verified_at_commit as string | null) ?? undefined
      return {
        dirPath: r.dir_path as string,
        summary: r.summary as string,
        keyExports: JSON.parse(r.key_exports_json as string) as string[],
        fileCount: r.file_count as number,
        status: r.status as string,
        contentHash: r.content_hash as string,
        ...(verified !== undefined ? { verifiedAtCommit: verified } : {}),
      }
    })
  }

  /** 关闭数据库连接（幂等）。 */
  close(): void {
    if (this.conn) {
      this.conn.close()
      this.conn = null
    }
  }
}
