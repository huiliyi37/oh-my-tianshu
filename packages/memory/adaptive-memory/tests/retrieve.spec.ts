/**
 * selectStructured：重复命中去重、实体检索、topic 加分、pinned、缺版本回落。
 *
 * @module @huiliyi37/dsh-adaptive-memory/tests/retrieve
 */

import { describe, expect, it } from 'vitest'
import type { MemorySearchResult } from '@huiliyi37/dsh-memory'
import { asStructuredMemory, selectStructured } from '../src/retrieve.ts'
import type { StructuredMemoryService } from '../src/retrieve.ts'

function hit(partial: Partial<MemorySearchResult> & { id: string; text: string }): MemorySearchResult {
  return {
    scope: 'global',
    tags: ['auth'],
    createdAt: 1,
    source: 'agent',
    score: 0.4,
    ...partial,
  }
}

function fake(opts: {
  search?: MemorySearchResult[]
  entitySearch?: MemorySearchResult[]
  list?: MemorySearchResult[]
  versions?: Record<string, number>
}): StructuredMemoryService {
  const searchHits = opts.search ?? []
  const entityHits = opts.entitySearch ?? searchHits
  const listed = opts.list ?? []
  return {
    topicVersions: () => Promise.resolve(opts.versions ?? {}),
    search: (_query: string, queryOpts?: { entities?: string[] }) =>
      Promise.resolve(queryOpts?.entities !== undefined && queryOpts.entities.length > 0 ? entityHits : searchHits),
    list: () => Promise.resolve(listed),
  } as StructuredMemoryService
}

const OPTS = {
  alwaysIncludeTags: ['safety'],
  maxKeywords: 5,
  summaryMaxChars: 120,
  thresholds: { high: 0.82, medium: 0.2 },
  retrievalLimit: 24,
  topicBoosts: { procedure: 0.5 },
}

describe('asStructuredMemory', () => {
  it('无 topicVersions 则 undefined', () => {
    expect(asStructuredMemory({} as never)).toBeUndefined()
  })
})

describe('selectStructured', () => {
  it('重复 id 不去重两次；实体检索补进未命中条目', async () => {
    const shared = hit({ id: 'a-1', text: 'login' })
    const extra = hit({ id: 'b-2', text: 'src/auth/login.ts', tags: ['auth'], score: 0.3 })
    const selection = await selectStructured(fake({
      search: [shared, shared],
      entitySearch: [extra],
      versions: { auth: 3 },
    }), { query: 'login', entities: ['src/auth/login.ts'], sessionScope: 'session:s' }, OPTS)
    expect(selection.candidates.map(c => c.id).sort()).toEqual(['a-1', 'b-2'])
    expect(selection.topicVersions.auth).toBe('3')
  })

  it('无实体时跳过实体检索；缺 tags 走 general 加分键；缺版本号回落 0', async () => {
    const untagged = hit({ id: 'c-3', text: 'note', tags: [], score: 0.3 })
    const selection = await selectStructured(fake({
      search: [untagged],
      versions: {},
    }), { query: 'note', entities: [], sessionScope: 'session:s' }, OPTS)
    expect(selection.candidates.map(c => c.id)).toEqual(['c-3'])
    expect(selection.topicVersions.general).toBe('0')
  })

  it('topicBoosts 抬升带 score 的 procedure；pinned 无 score 仍进索引行；low 被丢', async () => {
    const procedure = hit({
      id: 'p-1', text: 'use pnpm', tags: ['procedure'], score: 0.4,
    })
    const pinned = hit({ id: 's-1', text: 'never delete secrets', tags: ['safety'] })
    delete (pinned as { score?: number }).score
    const low = hit({ id: 'l-1', text: 'noise', tags: ['other'], score: 0.01 })
    const selection = await selectStructured(fake({
      search: [procedure, low],
      list: [pinned],
      versions: { procedure: 1, safety: 1, other: 1 },
    }), { query: 'pnpm', entities: [], sessionScope: 'session:s' }, OPTS)
    expect(selection.candidates[0]?.id).toBe('s-1')
    expect(selection.candidates.some(c => c.id === 'p-1')).toBe(true)
    expect(selection.candidates[0]?.body).toBeUndefined()
    const boosted = selection.candidates.find(c => c.id === 'p-1')
    expect(boosted?.body).toBe('use pnpm')
    expect(selection.candidates.every(c => c.id !== 'l-1')).toBe(true)
  })

  it('同分按 id 升序', async () => {
    const a = hit({ id: 'b-2', text: 'alpha', score: 0.5 })
    const b = hit({ id: 'a-1', text: 'alpha', score: 0.5 })
    const selection = await selectStructured(fake({
      search: [a, b],
      versions: { auth: 1 },
    }), { query: 'alpha', entities: [], sessionScope: 'session:s' }, OPTS)
    expect(selection.candidates.map(c => c.id)).toEqual(['a-1', 'b-2'])
  })
})
