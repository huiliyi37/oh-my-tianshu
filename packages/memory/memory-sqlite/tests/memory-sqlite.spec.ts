/**
 * dsh-memory-sqlite 单测（阶段二a，TDD）。
 *
 * 行为契约：
 * - save：追加事件 + 物化视图新版本；同 (scope, subject, predicate) 不同 value
 *   → 旧版本 superseded（valid_to 设置，不删除）；完全相同的重保存幂等 no-op。
 * - 非结构化保存的 subject 派生自条目 id（带 id 保存 = 更新该条目的 supersede 链）。
 * - search：FTS BM25 + 实体/topic 精确过滤 + scope/excludeIds 过滤；score 归一化
 *   （relevance × 状态权重：active 1 / uncertain 0.6 / superseded 0.3）；
 *   CJK 子串经二元组化可命中；空 query 匹配全部。
 * - delete：tombstone（superseded + tombstone 事件），不存在的 id 幂等 no-op；
 *   delete 后同 id 再 save 视为新条目。
 * - topicVersions：按 topic 单调 +1，只 bump 被触及的 topic。
 * - Markdown 共存：按内容哈希幂等导入（新增/变更/移除/整文件删除）；被 API
 *   delete 的条目不因文件未变而复活；文件库重开后靠 imports 哈希跳过重复导入。
 * - 磁盘格式：旧 schema 版本与外来 application_id fail loud 拒绝打开。
 *
 * @module @huiliyi37/dsh-memory-sqlite/tests/memory-sqlite
 */

import { chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MemoryScope } from '@huiliyi37/dsh-memory'
import { ftsNormalize } from '../src/fts.ts'
import { openMemoryDatabase, MEMORY_SQLITE_APPLICATION_ID } from '../src/schema.ts'
import { SqliteMemoryStore } from '../src/store.ts'
import type { SqliteMemoryStoreOptions } from '../src/store.ts'

const dirs: string[] = []
const stores: SqliteMemoryStore[] = []

afterEach(async () => {
  for (const store of stores.splice(0)) await store.close()
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

/** 每个用例独立临时目录；缺省 ':memory:' 数据库 + 该目录下的 Markdown 共存源。 */
async function makeStore(overrides: Partial<SqliteMemoryStoreOptions> = {}): Promise<{ store: SqliteMemoryStore; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-memory-sqlite-'))
  dirs.push(dir)
  const store = new SqliteMemoryStore({
    dbPath: ':memory:',
    mdRoot: join(dir, '.dsh/memory'),
    journalMode: 'wal',
    importMaxFileBytes: 1_048_576,
    ...overrides,
  })
  stores.push(store)
  return { store, dir }
}

/** 手写 Markdown 条目（dsh-memory v1 格式的最小字段）。 */
interface MdEntrySpec { id: string; scope: string; tags?: string[]; text: string; created?: number }

/** 写一份 dsh-memory v1 格式的 Markdown 文件。 */
async function writeMarkdown(dir: string, relative: string, entries: MdEntrySpec[]): Promise<void> {
  const file = join(dir, '.dsh/memory', relative)
  await mkdir(join(file, '..'), { recursive: true })
  const blocks = entries.map(entry => [
    `<!-- entry id="${entry.id}" scope="${entry.scope}" source="user" tags="${(entry.tags ?? []).join(',')}" created="${entry.created ?? 1000}" -->`,
    entry.text,
    '<!-- /entry -->',
  ].join('\n'))
  await writeFile(file, ['<!-- dsh-memory v1 -->', ...blocks].join('\n') + '\n')
}

describe('SqliteMemoryStore', () => {
  it('save 新建：生成 id + createdAt，list 可见，topic 版本从 1 起', async () => {
    const { store } = await makeStore()
    const entry = await store.save({ text: '项目使用 pnpm workspace', scope: 'global', tags: ['tooling'], source: 'user' })
    expect(entry.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(entry.createdAt).toBeGreaterThan(0)
    expect(entry.updatedAt).toBeUndefined()
    const all = await store.list()
    expect(all).toHaveLength(1)
    expect(all[0]).toEqual(entry)
    expect(await store.topicVersions()).toEqual({ tooling: 1 })
  })

  it('save 更新（带 id）：旧版本 superseded 不删除，新条目继承 id 与 createdAt', async () => {
    const { store } = await makeStore()
    const first = await store.save({ text: 'PostgreSQL 作为主库', scope: 'global', tags: ['db'], source: 'agent' })
    const updated = await store.save({ id: first.id, text: 'Neon Postgres 作为主库', scope: 'global', tags: ['db'], source: 'agent' })
    expect(updated.id).toBe(first.id)
    expect(updated.createdAt).toBe(first.createdAt)
    expect(updated.updatedAt).toBeGreaterThanOrEqual(first.createdAt)
    // 物化视图只留当前版本
    const all = await store.list()
    expect(all).toHaveLength(1)
    expect(all[0]?.text).toBe('Neon Postgres 作为主库')
    // 两个版本都可检索，active 恒高于 superseded
    const hits = await store.search('主库')
    expect(hits).toHaveLength(2)
    expect(hits[0]?.text).toBe('Neon Postgres 作为主库')
    expect(hits[0]?.score).toBeGreaterThan(hits[1]?.score ?? 0)
    // 旧文本仍可命中（审计可见），但降权
    const old = await store.search('PostgreSQL')
    expect(old).toHaveLength(1)
    expect(old[0]?.text).toBe('PostgreSQL 作为主库')
    expect(old[0]?.score).toBeLessThanOrEqual(0.3)
    expect(await store.topicVersions()).toEqual({ db: 2 })
  })

  it('结构化事实：同 subject+predicate 不同 value 触发 supersede，省略 id 时继承逻辑 id', async () => {
    const { store } = await makeStore()
    const first = await store.save({
      text: '主数据库是 PostgreSQL', scope: 'global', tags: ['db'], source: 'agent',
      fact: { subject: 'database', predicate: 'engine', value: 'PostgreSQL' },
    })
    const second = await store.save({
      text: '主数据库是 Neon Postgres', scope: 'global', tags: ['db'], source: 'agent',
      fact: { subject: 'database', predicate: 'engine', value: 'Neon Postgres' },
    })
    expect(second.id).toBe(first.id)
    expect(await store.list()).toHaveLength(1)
    expect((await store.list())[0]?.text).toBe('主数据库是 Neon Postgres')
  })

  it('幂等：完全相同的重保存不产生新版本、不 bump topic 版本', async () => {
    const { store } = await makeStore()
    const input = { text: '约定：ESM everywhere', scope: 'global' as const, tags: ['convention'], source: 'agent' as const }
    const first = await store.save(input)
    const second = await store.save({ ...input, id: first.id })
    expect(second.id).toBe(first.id)
    expect(second.updatedAt).toBeUndefined()
    expect(await store.list()).toHaveLength(1)
    expect(await store.topicVersions()).toEqual({ convention: 1 })
  })

  it('search：BM25 排序命中，score 归一化在 (0, 1]', async () => {
    const { store } = await makeStore()
    await store.save({ text: 'the quick brown fox jumps', scope: 'global', tags: [], source: 'user' })
    await store.save({ text: 'unrelated notes about databases', scope: 'global', tags: [], source: 'user' })
    const hits = await store.search('fox')
    expect(hits).toHaveLength(1)
    expect(hits[0]?.text).toBe('the quick brown fox jumps')
    expect(hits[0]?.score).toBeGreaterThan(0)
    expect(hits[0]?.score).toBeLessThanOrEqual(1)
  })

  it('search：CJK 子串经二元组化命中（unicode61 整段单 token 的补偿）', async () => {
    const { store } = await makeStore()
    await store.save({ text: '项目使用 pnpm workspace 管理依赖', scope: 'global', tags: [], source: 'user' })
    await store.save({ text: '完全无关的一条记录', scope: 'global', tags: [], source: 'user' })
    const hits = await store.search('依赖')
    expect(hits).toHaveLength(1)
    expect(hits[0]?.text).toBe('项目使用 pnpm workspace 管理依赖')
  })

  it('search：空 query 匹配全部；excludeIds 按 id 或 id 前缀排除', async () => {
    const { store } = await makeStore()
    const keep = await store.save({ text: '保留的记忆', scope: 'global', tags: [], source: 'user' })
    const drop = await store.save({ text: '已进 STM 的记忆', scope: 'global', tags: [], source: 'user' })
    const exact = await store.search('', { excludeIds: [drop.id] })
    expect(exact.map(e => e.id)).toEqual([keep.id])
    const prefix = await store.search('', { excludeIds: [drop.id.slice(0, 8)] })
    expect(prefix.map(e => e.id)).toEqual([keep.id])
    const all = await store.search('', { excludeIds: [''] })
    expect(all).toHaveLength(2)
  })

  it('search：实体精确过滤与 topic 过滤', async () => {
    const { store } = await makeStore()
    await store.save({ text: 'auth 模块用 JWT', scope: 'global', tags: ['auth'], source: 'agent', entities: ['src/auth.ts'] })
    await store.save({ text: 'billing 模块用 Stripe', scope: 'global', tags: ['billing'], source: 'agent', entities: ['src/billing.ts'] })
    const byEntity = await store.search('', { entities: ['src/auth.ts'] })
    expect(byEntity).toHaveLength(1)
    expect(byEntity[0]?.text).toBe('auth 模块用 JWT')
    const byTopic = await store.search('', { topic: 'billing' })
    expect(byTopic).toHaveLength(1)
    expect(byTopic[0]?.text).toBe('billing 模块用 Stripe')
  })

  it('scope 过滤：global 精确 / session 前缀 / session:<id> 精确', async () => {
    const { store } = await makeStore()
    await store.save({ text: '全局笔记', scope: 'global', tags: [], source: 'user' })
    await store.save({ text: 's1 笔记', scope: 'session:s1', tags: [], source: 'auto' })
    await store.save({ text: 's2 笔记', scope: 'session:s2', tags: [], source: 'auto' })
    expect(await store.list({ scope: 'global' })).toHaveLength(1)
    expect(await store.list({ scope: 'session' })).toHaveLength(2)
    const s1 = await store.search('', { scope: 'session:s1' })
    expect(s1).toHaveLength(1)
    expect(s1[0]?.text).toBe('s1 笔记')
    expect(await store.list({ scope: 'bogus' })).toHaveLength(0)
  })

  it('delete：tombstone 后 list 排除、search 降权可见；幂等；同 id 可重建', async () => {
    const { store } = await makeStore()
    const entry = await store.save({ text: '要删的记忆', scope: 'global', tags: ['tmp'], source: 'user' })
    await store.delete(entry.id)
    expect(await store.list()).toHaveLength(0)
    const hits = await store.search('要删')
    expect(hits).toHaveLength(1)
    expect(hits[0]?.score).toBeLessThanOrEqual(0.3)
    expect(await store.topicVersions()).toEqual({ tmp: 2 })
    await store.delete(entry.id) // 幂等 no-op
    expect(await store.topicVersions()).toEqual({ tmp: 2 })
    // 同 id 重建 = 全新条目（无 supersedes 链、无 updatedAt）
    const reborn = await store.save({ id: entry.id, text: '重生的记忆', scope: 'global', tags: ['tmp'], source: 'user' })
    expect(reborn.updatedAt).toBeUndefined()
    const all = await store.list()
    expect(all).toHaveLength(1)
    expect(all[0]?.text).toBe('重生的记忆')
  })

  it('topic 版本：只 bump 被触及的 topic', async () => {
    const { store } = await makeStore()
    await store.save({ text: 'a1', scope: 'global', tags: ['a'], source: 'user' })
    await store.save({ text: 'b1', scope: 'global', tags: ['b'], source: 'user' })
    expect(await store.topicVersions()).toEqual({ a: 1, b: 1 })
    const a1 = (await store.search('a1'))[0]
    expect(a1).toBeDefined()
    await store.save({ id: a1!.id, text: 'a2', scope: 'global', tags: ['a'], source: 'user' })
    expect(await store.topicVersions()).toEqual({ a: 2, b: 1 })
  })

  it('Markdown 导入：首次操作触发；重复同步幂等（不重复导入、不重复 bump）', async () => {
    const { store, dir } = await makeStore()
    await writeMarkdown(dir, 'global.md', [
      { id: 'md-1', scope: 'global', tags: ['tooling'], text: '项目使用 pnpm workspace' },
      { id: 'md-2', scope: 'global', tags: [], text: '无标签条目进 general 分区' },
    ])
    const all = await store.list()
    expect(all).toHaveLength(2)
    expect(all.map(e => e.id).sort()).toEqual(['md-1', 'md-2'])
    expect(all.find(e => e.id === 'md-1')?.createdAt).toBe(1000)
    const versions = await store.topicVersions()
    expect(versions).toEqual({ tooling: 1, general: 1 })
    await store.syncMarkdown()
    await store.syncMarkdown()
    expect(await store.list()).toHaveLength(2)
    expect(await store.topicVersions()).toEqual(versions)
    // 中文全文可检索（导入条目走同一 FTS 管道）
    expect(await store.search('workspace')).toHaveLength(1)
  })

  it('Markdown 变更：改文本 → 旧版本 superseded；移除条目 → superseded；删文件 → 全部 superseded', async () => {
    const { store, dir } = await makeStore()
    await writeMarkdown(dir, 'global.md', [
      { id: 'md-1', scope: 'global', tags: ['db'], text: '旧文本' },
      { id: 'md-2', scope: 'global', tags: ['db'], text: '会被移除' },
    ])
    expect(await store.list()).toHaveLength(2)
    await writeMarkdown(dir, 'global.md', [
      { id: 'md-1', scope: 'global', tags: ['db'], text: '新文本' },
    ])
    const all = await store.list()
    expect(all).toHaveLength(1)
    expect(all[0]?.text).toBe('新文本')
    const old = await store.search('旧文本')
    // 二元组 '文本' 同时命中新旧文本；active 恒高于 superseded
    expect(old).toHaveLength(2)
    expect(old[0]?.text).toBe('新文本')
    expect(old[1]?.text).toBe('旧文本')
    expect(old[1]?.score).toBeLessThanOrEqual(0.3)
    const removed = await store.search('会被移除')
    expect(removed).toHaveLength(1)
    expect(removed[0]?.score).toBeLessThanOrEqual(0.3)
    await rm(join(dir, '.dsh/memory/global.md'))
    expect(await store.list()).toHaveLength(0)
  })

  it('Markdown 共存：API delete 的条目不因文件未变而复活', async () => {
    const { store, dir } = await makeStore()
    await writeMarkdown(dir, 'global.md', [{ id: 'md-1', scope: 'global', tags: [], text: '人类与 API 都能删' }])
    expect(await store.list()).toHaveLength(1)
    await store.delete('md-1')
    expect(await store.list()).toHaveLength(0)
    await store.syncMarkdown() // 文件未变（哈希相同）→ 不重导
    expect(await store.list()).toHaveLength(0)
  })

  it('文件库：重开后数据恢复；imports 哈希跳过重复导入（跨进程幂等）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-memory-sqlite-'))
    dirs.push(dir)
    const dbPath = join(dir, 'ltm.sqlite')
    await writeMarkdown(dir, 'global.md', [{ id: 'md-1', scope: 'global', tags: ['k'], text: '持久化的记忆' }])
    const first = new SqliteMemoryStore({ dbPath, mdRoot: join(dir, '.dsh/memory'), journalMode: 'wal', importMaxFileBytes: 1_048_576 })
    stores.push(first)
    const saved = await first.save({ text: 'API 写入的记忆', scope: 'global', tags: ['k'], source: 'agent' })
    const versionsBefore = await first.topicVersions()
    await first.close()
    const second = new SqliteMemoryStore({ dbPath, mdRoot: join(dir, '.dsh/memory'), journalMode: 'wal', importMaxFileBytes: 1_048_576 })
    stores.push(second)
    const all = await second.list()
    expect(all).toHaveLength(2)
    expect(all.map(e => e.id).sort()).toEqual(['md-1', saved.id].sort())
    // 重开不重导（哈希命中）：topic 版本与首轮导入后一致
    expect(await second.topicVersions()).toEqual(versionsBefore)
    // 事件日志 append-only：2 条导入/API 各一
    const { DatabaseSync } = await import('node:sqlite')
    const raw = new DatabaseSync(dbPath)
    const { count } = raw.prepare('SELECT COUNT(*) AS count FROM events').get() as { count: number }
    expect(count).toBe(2)
    raw.close()
  })

  it('磁盘格式：旧 schema 版本与外来 application_id fail loud 拒绝打开', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-memory-sqlite-'))
    dirs.push(dir)
    const { DatabaseSync } = await import('node:sqlite')
    const stale = join(dir, 'stale.sqlite')
    const db1 = new DatabaseSync(stale)
    db1.exec(`PRAGMA application_id = ${MEMORY_SQLITE_APPLICATION_ID}`)
    db1.exec('PRAGMA user_version = 999')
    db1.close()
    await expect(openMemoryDatabase(stale, 'wal')).rejects.toThrow(/schema version 999/)
    const foreign = join(dir, 'foreign.sqlite')
    const db2 = new DatabaseSync(foreign)
    db2.exec('PRAGMA application_id = 12345')
    db2.close()
    await expect(openMemoryDatabase(foreign, 'wal')).rejects.toThrow(/belongs to another application/)
  })

  it('超限的 Markdown 文件 fail loud（importMaxFileBytes）', async () => {
    const { store, dir } = await makeStore({ importMaxFileBytes: 16 })
    await writeMarkdown(dir, 'global.md', [{ id: 'md-1', scope: 'global', tags: [], text: '这条记忆的内容远超十六字节上限' }])
    await expect(store.list()).rejects.toThrow(/importMaxFileBytes/)
  })

  it('非法 scope 在 save 时 fail loud；检索侧非法/空 session 过滤为空', async () => {
    const { store } = await makeStore()
    // 非法 scope 模拟越过静态类型边界的外部输入；save 必须在自身边界 fail loud。
    const invalidScope = 'nope' as unknown as MemoryScope
    await expect(store.save({ text: 'x', scope: invalidScope, tags: [], source: 'user' }))
      .rejects.toThrow(/invalid memory scope/)
    await store.save({ text: 'sess', scope: 'session:abc', tags: ['s'], source: 'user' })
    expect(await store.search('sess', { scope: 'session' })).toHaveLength(1)
    expect(await store.search('sess', { scope: 'session:' })).toHaveLength(0)
    expect(await store.search('sess', { scope: 'nope' })).toHaveLength(0)
    expect(await store.list({ scope: 'session', limit: 1, offset: 0 })).toHaveLength(1)
  })

  it('空查询匹配全部；limit/offset/空 excludeIds；换 topic  bump 两侧', async () => {
    const { store } = await makeStore()
    const first = await store.save({ text: 'alpha one', scope: 'global', tags: ['a'], source: 'user' })
    await store.save({ text: 'beta two', scope: 'global', tags: ['b'], source: 'user' })
    expect(await store.search('')).toHaveLength(2)
    expect(await store.search('alpha', { limit: 1, offset: 0 })).toHaveLength(1)
    expect(await store.search('alpha', { excludeIds: [''] })).toHaveLength(1)
    await store.save({ id: first.id, text: 'alpha one', scope: 'global', tags: ['c'], source: 'user' })
    const versions = await store.topicVersions()
    expect(versions.a).toBeGreaterThanOrEqual(1)
    expect(versions.c).toBe(1)
  })

  it('单字 CJK 保留为单 token', () => {
    expect(ftsNormalize('中')).toBe('中')
    expect(ftsNormalize('记忆')).toBe('记忆')
  })

  it('Markdown session 文件与 sessions 目录中的非 md 文件', async () => {
    const { store, dir } = await makeStore()
    await writeMarkdown(dir, 'sessions/s1.md', [
      { id: 'md-s', scope: 'session:s1', tags: ['sess'], text: '会话笔记' },
    ])
    await writeFile(join(dir, '.dsh/memory/sessions', 'ignore.txt'), 'not markdown\n')
    const all = await store.list({ scope: 'session:s1' })
    expect(all.map(e => e.id)).toEqual(['md-s'])
  })

  it('sessions 路径若是文件则导入 fail loud', async () => {
    const { store, dir } = await makeStore()
    await mkdir(join(dir, '.dsh/memory'), { recursive: true })
    await writeFile(join(dir, '.dsh/memory/sessions'), 'not a directory\n')
    await expect(store.list()).rejects.toThrow()
  })

  it('非法 source 触发事务回滚，后续写入仍可用', async () => {
    const { store } = await makeStore()
    await expect(store.save({
      text: 'bad source',
      scope: 'global',
      tags: ['t'],
      source: 'nope' as 'user',
    })).rejects.toThrow()
    await store.save({ text: 'ok', scope: 'global', tags: ['t'], source: 'user' })
    expect(await store.list()).toHaveLength(1)
  })

  it('关闭后 requireDb 失败', async () => {
    const { store } = await makeStore()
    await store.save({ text: 'x', scope: 'global', tags: ['t'], source: 'user' })
    await store.close()
    expect(() => (store as unknown as { requireDb: () => unknown }).requireDb())
      .toThrow(/database not open/)
  })

  it('空库 + 非空 version 的外来文件 fail loud；journal delete 可开', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-memory-sqlite-'))
    dirs.push(dir)
    const { DatabaseSync } = await import('node:sqlite')
    const weird = join(dir, 'weird.sqlite')
    const db = new DatabaseSync(weird)
    db.exec('PRAGMA application_id = 0')
    db.exec('PRAGMA user_version = 1')
    db.close()
    await expect(openMemoryDatabase(weird, 'wal')).rejects.toThrow(/not an empty or recognized/)
    const fresh = join(dir, 'fresh.sqlite')
    const opened = await openMemoryDatabase(fresh, 'delete')
    opened.close()
  })

  it('无法创建数据库文件时 fail loud', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-memory-sqlite-'))
    dirs.push(dir)
    const blocked = join(dir, 'blocked')
    await mkdir(blocked, { mode: 0o700 })
    await chmod(blocked, 0o500)
    await expect(openMemoryDatabase(join(blocked, 'x.sqlite'), 'wal')).rejects.toThrow()
    await chmod(blocked, 0o700)
  })

  it('global.md 非 ENOENT 的 stat 失败会上抛', async () => {
    const { store, dir } = await makeStore()
    await mkdir(join(dir, '.dsh/memory'), { recursive: true })
    await symlink('global.md', join(dir, '.dsh/memory/global.md'))
    await expect(store.list()).rejects.toThrow()
  })

  it('空查询且相同 createdAt 时按 versionId 打破平局', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    try {
      const { store } = await makeStore()
      await store.save({ text: 'tie-a', scope: 'global', tags: ['t'], source: 'user' })
      await store.save({ text: 'tie-b', scope: 'global', tags: ['t'], source: 'user' })
      await store.save({ text: 'tie-c', scope: 'global', tags: ['t'], source: 'user' })
      expect(await store.search('')).toHaveLength(3)
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('Markdown 文件哈希变但条目未变则跳过 upsert；换 topic  bump 旧分区', async () => {
    const { store, dir } = await makeStore()
    await writeMarkdown(dir, 'global.md', [{ id: 'md-1', scope: 'global', tags: ['old'], text: '同一条目' }])
    expect(await store.list()).toHaveLength(1)
    const firstVersions = await store.topicVersions()
    const path = join(dir, '.dsh/memory/global.md')
    await writeFile(path, `${await readFile(path, 'utf8')}\n<!-- trailing -->\n`)
    await store.syncMarkdown()
    expect(await store.topicVersions()).toEqual(firstVersions)
    await writeMarkdown(dir, 'global.md', [{ id: 'md-1', scope: 'global', tags: ['new'], text: '同一条目' }])
    await store.syncMarkdown()
    const after = await store.topicVersions()
    expect(after.new).toBe(1)
    expect(after.old).toBeGreaterThan(firstVersions.old ?? 0)
  })

  it('Markdown 文件有变更但无归因条目时按空清单导入', async () => {
    const { store, dir } = await makeStore()
    await writeMarkdown(dir, 'global.md', [{ id: 'md-s', scope: 'session:s1', tags: ['s'], text: '写在 global 文件里的会话条目' }])
    expect(await store.list({ scope: 'global' })).toHaveLength(0)
  })

  it('未配置 embedder 时内部 embedding 辅助函数走禁用分支', async () => {
    const { store } = await makeStore()
    await store.list()
    const internal = store as unknown as {
      embed: (texts: string[]) => Promise<number[][]>
      upsertEmbedding: (id: string, vector: number[]) => void
      candidateVectors: (c: Array<{ versionId: string; text: string }>) => Promise<Map<string, number[]>>
    }
    await expect(internal.embed(['x'])).rejects.toThrow(/embedder not configured/)
    internal.upsertEmbedding('unused', [1])
    expect(await internal.candidateVectors([])).toEqual(new Map())
  })
})
