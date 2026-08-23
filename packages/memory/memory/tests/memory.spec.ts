/**
 * dsh-memory Markdown 文件后端单测（P2 Wave 1，TDD）。
 *
 * 行为契约：
 * - 存储按 scope 分文件：global → `<root>/.dsh/memory/global.md`；
 *   `session:<id>` → `sessions/<id>.md`。目录自动创建（非 git 目录同样可用——
 *   待验证假设 3：不依赖 git 仓库存在）。
 * - 文件格式人类可读/可手动编辑：每条记忆 = 元数据注释行 + 文本 + 结束注释。
 * - save 新建（id 缺省）→ 生成 uuid + createdAt；save 更新（带 id）→ 覆盖 +
 *   updatedAt；delete → 移除。整文件原子重写（temp + rename）。
 * - list 按 createdAt 倒序；search 朴素子串匹配（大小写不敏感），excludeIds
 *   按 id 或前缀排除；entities/topic 退化为 tags 精确匹配；结构化 save
 *   字段被忽略，不进 Markdown。
 * - 新实例读同一目录可恢复全部记忆（重启可读）。
 *
 * @module @huiliyi37/dsh-memory/tests/memory
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MarkdownMemoryStore } from '../src/store.js'
import type { MemoryService } from '../src/index.js'

let dir: string | undefined

afterEach(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true })
  dir = undefined
})

/** 每个用例独立临时 cwd（非 git 目录——假设 3 的天然验证面）。 */
async function makeStore(): Promise<MarkdownMemoryStore> {
  dir = await mkdtemp(join(tmpdir(), 'dsh-memory-'))
  return new MarkdownMemoryStore(join(dir, '.dsh/memory'))
}

describe('MarkdownMemoryStore', () => {
  it('save 新建：生成 id + createdAt，写入 global.md（目录自动创建）', async () => {
    const store = await makeStore()
    const entry = await store.save({
      text: '项目使用 pnpm workspace',
      scope: 'global',
      tags: ['tooling'],
      source: 'user',
    })
    expect(entry.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(entry.createdAt).toBeGreaterThan(0)
    expect(entry.updatedAt).toBeUndefined()
    expect(entry.text).toBe('项目使用 pnpm workspace')
    const all = await store.list()
    expect(all).toHaveLength(1)
    expect(all[0]).toEqual(entry)
  })

  it('save 更新（带 id）：覆盖文本/标签，设置 updatedAt，不产生重复条目', async () => {
    const store = await makeStore()
    const first = await store.save({ text: 'v1', scope: 'global', tags: [], source: 'user' })
    const updated = await store.save({ id: first.id, text: 'v2', scope: 'global', tags: ['x'], source: 'user' })
    expect(updated.id).toBe(first.id)
    expect(updated.createdAt).toBe(first.createdAt)
    expect(updated.updatedAt).toBeGreaterThanOrEqual(first.createdAt)
    expect(updated.text).toBe('v2')
    const all = await store.list()
    expect(all).toHaveLength(1)
    expect(all[0]?.text).toBe('v2')
  })

  it('list：按 createdAt 倒序，scope 过滤（global / session）', async () => {
    const store = await makeStore()
    await store.save({ text: '第一条', scope: 'global', tags: [], source: 'user' })
    await store.save({ text: '会话笔记', scope: 'session:s1', tags: [], source: 'agent' })
    const global = await store.list({ scope: 'global' })
    expect(global).toHaveLength(1)
    expect(global[0]?.text).toBe('第一条')
    const session = await store.list({ scope: 'session' })
    expect(session).toHaveLength(1)
    expect(session[0]?.text).toBe('会话笔记')
    const all = await store.list()
    expect(all).toHaveLength(2)
    // 倒序：后写入的在前
    expect(all[0]?.text).toBe('会话笔记')
  })

  it('search：朴素子串匹配（大小写不敏感），limit 生效', async () => {
    const store = await makeStore()
    await store.save({ text: 'Tianshu Harness SDK', scope: 'global', tags: [], source: 'user' })
    await store.save({ text: 'pnpm 包管理器', scope: 'global', tags: [], source: 'user' })
    const hits = await store.search('harness')
    expect(hits).toHaveLength(1)
    expect(hits[0]?.text).toBe('Tianshu Harness SDK')
    const miss = await store.search('不存在的词')
    expect(miss).toHaveLength(0)
    const limited = await store.search('', { limit: 1 })
    expect(limited).toHaveLength(1)
  })

  it('search：excludeIds 按 id 或 id 前缀排除条目', async () => {
    const store = await makeStore()
    const keep = await store.save({ text: '保留的记忆', scope: 'global', tags: [], source: 'user' })
    const drop = await store.save({ text: '已进 STM 的记忆', scope: 'global', tags: [], source: 'user' })
    const exact = await store.search('', { excludeIds: [drop.id] })
    expect(exact.map(e => e.id)).toEqual([keep.id])
    const prefix = await store.search('', { excludeIds: [drop.id.slice(0, 8)] })
    expect(prefix.map(e => e.id)).toEqual([keep.id])
    const emptyPrefix = await store.search('', { excludeIds: [''] })
    expect(emptyPrefix).toHaveLength(2)
  })

  it('search：entities / topic 退化为 tags 精确匹配', async () => {
    const store = await makeStore()
    await store.save({ text: '用 pnpm', scope: 'global', tags: ['tooling', 'pnpm'], source: 'user' })
    await store.save({ text: '用 npm', scope: 'global', tags: ['tooling'], source: 'user' })
    const byEntity = await store.search('', { entities: ['pnpm'] })
    expect(byEntity).toHaveLength(1)
    expect(byEntity[0]?.text).toBe('用 pnpm')
    const byTopic = await store.search('', { topic: 'tooling' })
    expect(byTopic).toHaveLength(2)
    const miss = await store.search('', { topic: 'absent' })
    expect(miss).toHaveLength(0)
  })

  it('save：结构化字段被忽略，落盘仍是纯文本条目', async () => {
    const store = await makeStore()
    const entry = await store.save({
      text: '只用 Markdown',
      scope: 'global',
      tags: [],
      source: 'agent',
      kind: 'fact',
      topic: 'architecture',
      entities: ['store'],
      confidence: 0.4,
      fact: { subject: 'repo', predicate: 'uses', value: 'pnpm' },
      sourceRefs: [{ sessionId: 's1', eventSeqs: [1] }],
    })
    expect(entry).toEqual({
      id: entry.id,
      text: '只用 Markdown',
      scope: 'global',
      tags: [],
      createdAt: entry.createdAt,
      source: 'agent',
    })
    // 结构化可选能力按 MemoryService 视图探测（Markdown 后端不提供，恒 undefined）。
    const service: MemoryService = store
    expect(service['topicVersions']).toBeUndefined()
    expect(service['markUncertain']).toBeUndefined()
    expect(service['retireStale']).toBeUndefined()
  })

  it('delete：移除条目；删除不存在的 id 静默 no-op', async () => {
    const store = await makeStore()
    const entry = await store.save({ text: '要删的', scope: 'global', tags: [], source: 'user' })
    await store.delete(entry.id)
    expect(await store.list()).toHaveLength(0)
    await store.delete(entry.id) // 幂等
  })

  it('重启可读：新实例读同一目录恢复全部记忆', async () => {
    await makeStore() // 独立临时目录（dir 由 makeStore 设置；afterEach 已清理前一测试的目录）
    const root = join(dir!, '.dsh/memory')
    const first = new MarkdownMemoryStore(root)
    await first.save({ text: '持久化的记忆', scope: 'global', tags: ['k'], source: 'user' })
    const second = new MarkdownMemoryStore(root)
    const all = await second.list()
    expect(all).toHaveLength(1)
    expect(all[0]?.text).toBe('持久化的记忆')
    expect(all[0]?.tags).toEqual(['k'])
  })

  it('人类可编辑：手工写入格式兼容的文本可被读取（注释行 + 文本块）', async () => {
    const store = await makeStore()
    const manual = [
      '<!-- dsh-memory v1 -->',
      '<!-- entry id="manual-1" scope="global" source="user" tags="a,b" created="1000" -->',
      '手工写的记忆',
      '第二行',
      '<!-- /entry -->',
    ].join('\n')
    // 模拟用户手动编辑 global.md（不经 API）
    const { writeFile, mkdir } = await import('node:fs/promises')
    const file = join(dir!, '.dsh/memory/global.md')
    await mkdir(join(dir!, '.dsh/memory'), { recursive: true })
    await writeFile(file, manual + '\n')
    const all = await store.list()
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({
      id: 'manual-1',
      text: '手工写的记忆\n第二行',
      tags: ['a', 'b'],
      source: 'user',
      createdAt: 1000,
    })
  })

  it('session scope 写入独立文件 sessions/<id>.md', async () => {
    const store = await makeStore()
    await store.save({ text: 's1 笔记', scope: 'session:s1', tags: [], source: 'auto' })
    await store.save({ text: 's2 笔记', scope: 'session:s2', tags: [], source: 'auto' })
    const { readFile } = await import('node:fs/promises')
    const s1 = await readFile(join(dir!, '.dsh/memory/sessions/s1.md'), 'utf8')
    expect(s1).toContain('s1 笔记')
    const s2 = await readFile(join(dir!, '.dsh/memory/sessions/s2.md'), 'utf8')
    expect(s2).toContain('s2 笔记')
    // global.md 不含会话笔记
    const global = await store.list({ scope: 'global' })
    expect(global).toHaveLength(0)
  })

  it('空目录/损坏文件：list 返回空（不抛错）', async () => {
    const store = await makeStore()
    expect(await store.list()).toHaveLength(0)
    expect(await store.search('x')).toHaveLength(0)
  })
})
