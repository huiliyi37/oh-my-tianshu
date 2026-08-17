/**
 * dsh-memory-sqlite 的 SQLite schema：append-only 事件日志 + 物化事实视图。
 *
 * 表结构（设计契约见 Agent Note
 * `.agents/notes/proposed/feature/2026-08-16-adaptive-memory-cache-contract.md`
 * 的 LTM 一节）：
 * - `events`：append-only 日志——每次写入/废止/markdown 导入一条事件，
 *   永不更新、永不删除（审计链）。
 * - `facts`：物化当前视图——同 (scope, subject, predicate) 的新 value 让旧版本
 *   status='superseded' 并设 valid_to，新版本以 supersedes 指回旧版本；
 *   部分唯一索引保证同一 (scope, subject, predicate) 至多一条 active。
 * - `topics`：topic → 单调版本号（按 topic 分区的失效信号）。
 * - `imports`：markdown 共存导入的幂等记录（文件路径 → 内容哈希 + 已导入条目 id）。
 * - `meta`：单行元数据（当前仅 `consolidations` 巩固期计数，驱动未使用退役）。
 * - `memory_fts`：FTS5 虚表（text + keywords），rowid 即 facts.version_id 的
 *   伴随行；事实文本不可变（更新 = 新版本行），故 FTS 只插不改。
 * - `embeddings`：可选向量层（schema v3）——fact version_id → Float32 向量
 *   BLOB + `embedder` 模型戳记；派生数据（可重建），不进 append-only 日志。
 *   戳记与当前 embedder 不符 = 换模型，检索时惰性重嵌（见 store.ts）。
 * 退役（阶段三）：retired 事实退出检索与 list，但行与事件日志保留
 * （invalidate-don't-delete 延伸到生命周期末端）。
 *
 * 版本纪律（pre-release stance）：SCHEMA_VERSION 单调递增；application_id
 * 匹配而版本不符 = 旧格式，fail loud 拒绝打开（不静默迁移、不重置）。
 *
 * @module @huiliyi37/dsh-memory-sqlite/schema
 */

import type { DatabaseSync } from 'node:sqlite'
import { mkdir, open } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

/** 当前 schema 版本（单调递增；旧版本拒绝打开）。v2：facts 增加 retired 状态、
 * used_at_consolidation 列与 meta 表（巩固期计数），支撑阶段三退役。
 * v3：embeddings 表（fact version → Float32 向量 BLOB + embedder 戳记），
 * 支撑可选嵌入混合检索（阶段二c）。 */
export const MEMORY_SQLITE_SCHEMA_VERSION = 3

/** SQLite application id（'DSHM'），防止误开其他应用的数据库文件。 */
export const MEMORY_SQLITE_APPLICATION_ID = 0x4453484D

/** 支持的 SQLite journal 模式。 */
export type JournalMode = 'wal' | 'delete' | 'truncate' | 'persist'

/** 建库时独占创建数据库文件（owner-only 权限）；已存在则保留，其他错误上抛。 */
async function createDatabaseFile(path: string): Promise<void> {
  try {
    const handle = await open(path, 'wx', 0o600)
    await handle.close()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

/**
 * 打开、校验并初始化记忆数据库。
 * @param path - 数据库文件路径或 `:memory:`；缺失的文件以 owner-only 权限创建。
 * @param journalMode - 校验过的 journal 模式（closed union，非调用方 SQL）。
 * @returns 初始化完成的数据库句柄（属主为调用方 store）。
 */
export async function openMemoryDatabase(path: string, journalMode: JournalMode): Promise<DatabaseSync> {
  const actual = path === ':memory:' ? path : resolve(path)
  if (actual !== ':memory:') {
    await mkdir(dirname(actual), { recursive: true, mode: 0o700 })
    await createDatabaseFile(actual)
  }
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(actual)
  try {
    const { application_id: applicationId } = db.prepare('PRAGMA application_id').get() as { application_id: number }
    const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number }
    if (applicationId !== 0 && applicationId !== MEMORY_SQLITE_APPLICATION_ID) {
      throw new Error(`memory database at "${actual}" belongs to another application`)
    }
    if (applicationId === 0 && version !== 0) {
      throw new Error(`memory database at "${actual}" is not an empty or recognized memory store`)
    }
    if (applicationId === MEMORY_SQLITE_APPLICATION_ID && version !== MEMORY_SQLITE_SCHEMA_VERSION) {
      // Pre-release stance：后端拒绝旧磁盘格式。Markdown 共存源仍在，可删库重建。
      throw new Error(
        `memory database at "${actual}" has schema version ${version}, expected ${MEMORY_SQLITE_SCHEMA_VERSION};`
        + ' old on-disk formats are rejected — delete the file to rebuild from the Markdown source',
      )
    }
    // 变更性 pragma 只在拒绝外来/旧版文件之后应用。
    db.exec(`PRAGMA journal_mode = ${journalMode.toUpperCase()}`)
    ensureSchema(db)
    return db
  } catch (error: unknown) {
    db.close()
    throw error
  }
}

/** 建表（幂等）并写入 application id 与 schema 版本。 */
function ensureSchema(db: DatabaseSync): void {
  db.exec(`PRAGMA application_id = ${MEMORY_SQLITE_APPLICATION_ID}`)
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id          TEXT PRIMARY KEY,
      session_id  TEXT,
      scope       TEXT NOT NULL,
      kind        TEXT NOT NULL CHECK (kind IN ('fact', 'experience', 'observation', 'tombstone')),
      text        TEXT NOT NULL,
      keywords    TEXT NOT NULL,
      entities    TEXT NOT NULL,
      topic       TEXT NOT NULL,
      confidence  REAL NOT NULL,
      source_refs TEXT NOT NULL,
      created_at  INTEGER NOT NULL
    ) STRICT
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS facts (
      version_id      TEXT PRIMARY KEY,
      id              TEXT NOT NULL,
      scope           TEXT NOT NULL,
      subject         TEXT NOT NULL,
      predicate       TEXT NOT NULL,
      value           TEXT NOT NULL,
      text            TEXT NOT NULL,
      keywords        TEXT NOT NULL,
      entities        TEXT NOT NULL,
      topic           TEXT NOT NULL,
      source          TEXT NOT NULL CHECK (source IN ('user', 'agent', 'auto')),
      valid_from      INTEGER NOT NULL,
      valid_to        INTEGER,
      confidence      REAL NOT NULL,
      status          TEXT NOT NULL CHECK (status IN ('active', 'superseded', 'uncertain', 'retired')),
      supersedes      TEXT REFERENCES facts(version_id),
      source_event_id TEXT NOT NULL REFERENCES events(id),
      created_at      INTEGER NOT NULL,
      used_at_consolidation INTEGER NOT NULL DEFAULT 0
    ) STRICT
  `)
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS facts_one_active_per_pair
    ON facts(scope, subject, predicate) WHERE status = 'active'
  `)
  db.exec('CREATE INDEX IF NOT EXISTS facts_by_logical_id ON facts(id)')
  db.exec(`
    CREATE TABLE IF NOT EXISTS topics (
      name    TEXT PRIMARY KEY,
      version INTEGER NOT NULL
    ) STRICT
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS imports (
      path        TEXT PRIMARY KEY,
      hash        TEXT NOT NULL,
      entry_ids   TEXT NOT NULL,
      imported_at INTEGER NOT NULL
    ) STRICT
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value INTEGER NOT NULL
    ) STRICT
  `)
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
      text,
      keywords,
      fact_version UNINDEXED,
      tokenize = 'unicode61'
    )
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS embeddings (
      fact_version TEXT PRIMARY KEY REFERENCES facts(version_id),
      embedder     TEXT NOT NULL,
      dim          INTEGER NOT NULL,
      vector       BLOB NOT NULL
    ) STRICT
  `)
  db.exec(`PRAGMA user_version = ${MEMORY_SQLITE_SCHEMA_VERSION}`)
}
