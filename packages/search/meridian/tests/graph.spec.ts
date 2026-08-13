import { describe, it, expect } from 'vitest'
import { spreadingActivation, buildRepoMap } from '../src/graph.ts'
import type { MeridianBehavior } from '../src/behavior.ts'
import type { MeridianDb } from '../src/db.ts'

// In-memory MeridianDb stub —— graph 层只依赖 getSymbolsForFile/getEdgesFrom/getEdgesTo/getStats
interface StubDb {
  getSymbolsForFile(f: string): Array<{ id: string; name: string; kind: 'function'; filePath: string; line: number; exported: boolean; contentHash: string }>
  getEdgesFrom(id: string): Array<{ sourceId: string; targetId: string; kind: 'calls'; weight: number; confidence: 'extracted' | 'inferred' | 'ambiguous' }>
  getEdgesTo(id: string): Array<{ sourceId: string; targetId: string; kind: 'calls'; weight: number; confidence: 'extracted' | 'inferred' | 'ambiguous' }>
  getStats(): { files: number; symbols: number; edges: number }
}

function stubDb(files: Record<string, { symbols: string[]; out: Array<{ target: string; weight: number; confidence?: 'extracted' | 'inferred' | 'ambiguous' }>; in: Array<{ source: string; weight: number }> }>): MeridianDb {
  const symbolsOf = (f: string) => (files[f]?.symbols ?? []).map((name, i) => ({
    id: `${f}:${name}:${i + 1}`, name, kind: 'function' as const, filePath: f, line: i + 1, exported: true, contentHash: 'h',
  }))
  const stub: StubDb = {
    getSymbolsForFile: (f: string) => symbolsOf(f),
    getEdgesFrom: (id: string) => {
      const f = id.split(':')[0] ?? ''
      return (files[f]?.out ?? []).map(e => ({ sourceId: id, targetId: e.target, kind: 'calls' as const, weight: e.weight, confidence: e.confidence ?? 'extracted' }))
    },
    getEdgesTo: (id: string) => {
      const f = id.split(':')[0] ?? ''
      return (files[f]?.in ?? []).map(e => ({ sourceId: e.source, targetId: id, kind: 'calls' as const, weight: e.weight, confidence: 'extracted' as const }))
    },
    getStats: () => ({
      files: Object.keys(files).length,
      symbols: Object.values(files).reduce((n, f) => n + f.symbols.length, 0),
      edges: 0,
    }),
  }
  return stub as unknown as MeridianDb
}

describe('spreadingActivation', () => {
  it('seed 文件 1.0，一跳按 decay 衰减，反向边 0.7 折扣', () => {
    const db = stubDb({
      'src/a.ts': { symbols: ['foo'], out: [{ target: 'src/b.ts:bar:1', weight: 1 }], in: [] },
      'src/b.ts': { symbols: ['bar'], out: [], in: [{ source: 'src/c.ts:baz:1', weight: 1 }] },
      'src/c.ts': { symbols: ['baz'], out: [], in: [] },
    })
    const scores = spreadingActivation(db, 'src/a.ts', { maxHops: 2, decay: 0.5 })
    expect(scores.get('src/a.ts')).toBe(1.0)
    expect(scores.get('src/b.ts')).toBeCloseTo(0.5) // decay^1 * 1 * 1.0
    expect(scores.get('src/c.ts')).toBeCloseTo(0.5 * 0.5 * 1 * 0.7) // decay^2 * 反向 0.7
  })

  it('inferred 置信度乘子 0.7', () => {
    const db = stubDb({
      'src/a.ts': { symbols: ['foo'], out: [{ target: 'src/b.ts:bar:1', weight: 1, confidence: 'inferred' }], in: [] },
      'src/b.ts': { symbols: ['bar'], out: [], in: [] },
    })
    const scores = spreadingActivation(db, 'src/a.ts', { maxHops: 1, decay: 1 })
    expect(scores.get('src/b.ts')).toBeCloseTo(0.7)
  })

  it('co-edit 行为边注入（behavior.getCoEditEdges）', () => {
    const db = stubDb({
      'src/a.ts': { symbols: ['foo'], out: [], in: [] },
      'src/d.ts': { symbols: [], out: [], in: [] },
    })
    const behavior = { getCoEditEdges: () => [{ targetFile: 'src/d.ts', weight: 0.6 }] } as unknown as MeridianBehavior
    const scores = spreadingActivation(db, 'src/a.ts', { maxHops: 1, decay: 0.5, behavior })
    expect(scores.get('src/d.ts')).toBe(0.6)
  })
})

describe('buildRepoMap', () => {
  it('按分数降序 + token 预算裁剪（至少保留 seed）', () => {
    const db = stubDb({
      'src/a.ts': { symbols: ['foo'], out: [{ target: 'src/b.ts:bar:1', weight: 1 }], in: [] },
      'src/b.ts': { symbols: ['bar', 'baz', 'qux'], out: [], in: [] },
    })
    const result = buildRepoMap(db, 'src/a.ts', { maxHops: 1, decay: 0.5, maxTokens: 30 })
    expect(result.entries[0]!.filePath).toBe('src/a.ts')
    expect(result.entries[0]!.score).toBe(1.0)
    // token 预算 30：seed 1 符号 = 35 > 30 —— 但至少保留 seed
    expect(result.entries.length).toBeGreaterThanOrEqual(1)
    expect(result.totalSymbols).toBe(4)
  })

  it('behavior boost 叠加进分数', () => {
    const db = stubDb({
      'src/a.ts': { symbols: ['foo'], out: [], in: [] },
    })
    const behavior = { getFileBoost: () => 2.5, getCoEditEdges: () => [] } as unknown as MeridianBehavior
    const result = buildRepoMap(db, 'src/a.ts', { maxHops: 1, decay: 0.5, maxTokens: 100, behavior })
    expect(result.entries[0]!.score).toBeCloseTo(3.5)
  })
})
