/**
 * memory-pipeline 全局整合：输入渲染截断、输出解析校验（围栏/未知 id/重复
 * 引用/形状）、应用语义（canonical save + 吸收 delete）、解析失败不落部分
 * 写入、租约互斥。
 *
 * @module @huiliyi37/dsh-memory-pipeline/tests/phase2
 */

import { describe, expect, it } from 'vitest'
import type { MemoryEntry, MemorySaveInput, MemorySearchResult, MemoryService } from '@huiliyi37/dsh-memory'
import { emptyLedger } from '../src/ledger.ts'
import type { LedgerFile } from '../src/ledger.ts'
import { parseConsolidationGroups, PHASE2_SYSTEM_PROMPT } from '../src/invoke.ts'
import { runGlobalConsolidation } from '../src/phase2.ts'

const NOW = 1_000_000_000

interface MemorySpy {
  service: MemoryService
  saves: MemorySaveInput[]
  deleted: string[]
}

function fakeMemory(entries: MemoryEntry[]): MemorySpy {
  const spy: MemorySpy = { service: undefined as never, saves: [], deleted: [] }
  spy.service = {
    async save(entry: MemorySaveInput): Promise<MemoryEntry> {
      spy.saves.push(entry)
      return { id: `new-${String(spy.saves.length)}`, text: entry.text, scope: entry.scope, tags: entry.tags, createdAt: NOW, source: 'auto' }
    },
    async search(): Promise<MemorySearchResult[]> { return [] },
    async list(): Promise<MemoryEntry[]> { return entries },
    async delete(id: string): Promise<void> { spy.deleted.push(id) },
  }
  return spy
}

function entry(id: string, text: string, createdAt: number, source: MemoryEntry['source'] = 'auto'): MemoryEntry {
  return { id, text, scope: 'global', tags: [], createdAt, source }
}

const OPTIONS = { maxInputEntries: 40, maxInputChars: 24_000, maxCanonicalChars: 600, leaseMs: 600_000 }

describe('parseConsolidationGroups', () => {
  const ids = new Set(['a', 'b', 'c'])

  it('接受裸 JSON 与围栏包裹的合法输出', () => {
    const raw = '```json\n{"groups":[{"text":"merged","tags":["x"],"confidence":0.9,"absorbs":["a","b"]}]}\n```'
    expect(parseConsolidationGroups(raw, ids, 600)).toEqual([
      { text: 'merged', tags: ['x'], confidence: 0.9, absorbs: ['a', 'b'] },
    ])
  })

  it('缺 confidence 时缺省（字段省略）', () => {
    const groups = parseConsolidationGroups('{"groups":[{"text":"m","tags":[],"absorbs":["a"]}]}', ids, 600)
    expect(groups[0]?.confidence).toBeUndefined()
  })

  it('absorbs 引用未知 id 抛错', () => {
    expect(() => parseConsolidationGroups('{"groups":[{"text":"m","tags":[],"absorbs":["zzzz"]}]}', ids, 600))
      .toThrow(/未知条目/)
  })

  it('absorbs 重复引用同一 id 抛错', () => {
    const raw = '{"groups":[{"text":"m1","tags":[],"absorbs":["a","b"]},{"text":"m2","tags":[],"absorbs":["b"]}]}'
    expect(() => parseConsolidationGroups(raw, ids, 600)).toThrow(/重复引用/)
  })

  it('空 absorbs / 非数组 / 缺 groups 均抛错', () => {
    expect(() => parseConsolidationGroups('{"groups":[{"text":"m","tags":[],"absorbs":[]}]}', ids, 600)).toThrow(/非空/)
    expect(() => parseConsolidationGroups('{"groups":"nope"}', ids, 600)).toThrow(/缺少 groups/)
    expect(() => parseConsolidationGroups('not json at all', ids, 600)).toThrow()
  })

  it('canonical 文本超上限抛错', () => {
    const long = 'x'.repeat(601)
    expect(() => parseConsolidationGroups(`{"groups":[{"text":"${long}","tags":[],"absorbs":["a"]}]}`, ids, 600))
      .toThrow(/上限/)
  })
})

describe('runGlobalConsolidation', () => {
  it('合并组应用为 canonical save + 吸收 delete，台账 pendingCount 清零', async () => {
    const memory = fakeMemory([
      entry('a', 'deploy uses pnpm', 100),
      entry('b', 'deployment uses pnpm package manager', 200),
      entry('c', 'unrelated fact', 300),
    ])
    const ledger: LedgerFile = emptyLedger()
    ledger.phase2.pendingCount = 5
    let invokedSystem = ''
    const applied = await runGlobalConsolidation({
      memory: memory.service,
      ledger,
      options: OPTIONS,
      invoke: async (system) => {
        invokedSystem = system
        return '{"groups":[{"text":"deploy uses pnpm (package manager)","tags":["deploy"],"confidence":0.85,"absorbs":["a","b"]}]}'
      },
      now: () => NOW,
      log: { info: () => {}, warn: () => {} },
      signal: new AbortController().signal,
    }, 'w1')
    expect(applied).toBe(1)
    expect(invokedSystem).toBe(PHASE2_SYSTEM_PROMPT)
    expect(memory.saves).toEqual([{
      text: 'deploy uses pnpm (package manager)',
      scope: 'global',
      tags: ['deploy'],
      source: 'auto',
      confidence: 0.85,
    }])
    expect(memory.deleted).toEqual(['a', 'b'])
    expect(ledger.phase2.pendingCount).toBe(0)
    expect(ledger.phase2.lastRunAtMs).toBe(NOW)
  })

  it('auto 条目不足两条时直接记账返回，不调用模型', async () => {
    // list 返回 2 条，但其中 1 条是 user 来源 → 过滤后 auto 仅 1 条。
    const memory = fakeMemory([entry('a', 'only one auto', 100), entry('u1', 'human note', 200, 'user')])
    const ledger: LedgerFile = emptyLedger()
    let modelCalls = 0
    const applied = await runGlobalConsolidation({
      memory: memory.service,
      ledger,
      options: OPTIONS,
      invoke: async () => { modelCalls += 1; return '{"groups":[]}' },
      now: () => NOW,
      log: { info: () => {}, warn: () => {} },
      signal: new AbortController().signal,
    }, 'w1')
    expect(applied).toBe(0)
    expect(modelCalls).toBe(0)
    expect(ledger.phase2.lastRunAtMs).toBe(NOW)
  })

  it('解析失败放弃本次整合：pendingCount 保留、零写入零删除', async () => {
    const memory = fakeMemory([
      entry('a', 'one', 100),
      entry('b', 'two', 200),
    ])
    const ledger: LedgerFile = emptyLedger()
    ledger.phase2.pendingCount = 3
    await expect(runGlobalConsolidation({
      memory: memory.service,
      ledger,
      options: OPTIONS,
      invoke: async () => 'garbage not json',
      now: () => NOW,
      log: { info: () => {}, warn: () => {} },
      signal: new AbortController().signal,
    }, 'w1')).rejects.toThrow()
    expect(memory.saves).toHaveLength(0)
    expect(memory.deleted).toHaveLength(0)
    expect(ledger.phase2.pendingCount).toBe(3)
  })

  it('租约被他人持有时跳过', async () => {
    const memory = fakeMemory([entry('a', 'one', 100), entry('b', 'two', 200)])
    const ledger: LedgerFile = emptyLedger()
    ledger.leases.phase2 = { workerId: 'someone-else', expiresAtMs: NOW + 1000 }
    const applied = await runGlobalConsolidation({
      memory: memory.service,
      ledger,
      options: OPTIONS,
      invoke: async () => { throw new Error('should not be called') },
      now: () => NOW,
      log: { info: () => {}, warn: () => {} },
      signal: new AbortController().signal,
    }, 'w1')
    expect(applied).toBe(0)
    expect(memory.saves).toHaveLength(0)
  })
})
