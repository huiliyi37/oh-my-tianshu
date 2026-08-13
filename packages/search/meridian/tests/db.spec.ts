import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { MeridianDb } from '../src/db.ts'
import type { ParseResult } from '../src/types.ts'

let dir: string
let db: MeridianDb

function parseResult(filePath: string, symbols: ParseResult['symbols'] = [], edges: ParseResult['edges'] = [], imports: string[] = [], contentHash = 'h1'): ParseResult {
  return { filePath, contentHash, symbols, edges, imports, calls: [] }
}

function rawOpen(): DatabaseSync {
  return new DatabaseSync(join(dir, 'meridian.db'))
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'meridian-db-'))
  db = new MeridianDb(dir)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('MeridianDb schema', () => {
  it('建表：6 表存在且 user_version = 1', () => {
    // 懒连接：先触发一次初始化（schemaVersion 触碰 db），再直接开文件核验
    expect(db.schemaVersion()).toBe(1)
    const conn = rawOpen()
    const tables = (conn.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all() as Array<{ name: string }>).map(r => r.name)
    conn.close()
    expect(tables).toEqual(expect.arrayContaining(['files', 'symbols', 'edges', 'access_log', 'co_edits', 'module_summaries']))
  })

  it('schema 版本拒绝：非当前 user_version 抛错', () => {
    const conn = rawOpen()
    conn.exec('PRAGMA user_version = 99')
    conn.close()
    // 懒连接：版本校验在首次触碰 db 时触发
    expect(() => {
      const legacy = new MeridianDb(dir)
      legacy.schemaVersion()
    }).toThrow(/version/)
  })
})

describe('MeridianDb upsert/needsParse', () => {
  it('新文件 needsParse = true；同 hash 再查 = false；hash 变化 = true', () => {
    expect(db.needsParse('src/a.ts', 'h1')).toBe(true)
    db.upsertFile(parseResult('src/a.ts', [], [], [], 'h1'))
    expect(db.needsParse('src/a.ts', 'h1')).toBe(false)
    expect(db.needsParse('src/a.ts', 'h2')).toBe(true)
  })

  it('upsertFile 替换同文件旧符号与边（GLOB 转义：相似文件名不误删）', () => {
    db.upsertFile(parseResult('src/a.ts', [
      { id: 'src/a.ts:foo:1', name: 'foo', kind: 'function', filePath: 'src/a.ts', line: 1, exported: true, contentHash: 'h1' },
    ], [
      { sourceId: 'src/a.ts:foo:1', targetId: 'src/b.ts:bar:1', kind: 'calls', weight: 1, confidence: 'extracted' },
    ], [], 'h1'))
    // 相似文件 a2.ts 的边不应被 a.ts 的 upsert 删除
    db.upsertEdge('src/a2.ts:sym:1', 'src/c.ts:other:1', 'calls', 1, 'extracted')

    db.upsertFile(parseResult('src/a.ts', [
      { id: 'src/a.ts:foo:2', name: 'foo', kind: 'function', filePath: 'src/a.ts', line: 2, exported: true, contentHash: 'h2' },
    ], [], [], 'h2'))

    expect(db.getSymbolsForFile('src/a.ts').map(s => s.line)).toEqual([2])
    // 旧边被清（upsertFile 删 source GLOB 'src/a.ts:*'）
    expect(db.getEdgesFrom('src/a.ts:foo:1')).toEqual([])
    // 相似文件边保留
    expect(db.getEdgesFrom('src/a2.ts:sym:1')).toHaveLength(1)
  })

  it('imports 边写入 firstSymbol → <path>:*:0', () => {
    db.upsertFile(parseResult('src/a.ts', [
      { id: 'src/a.ts:foo:1', name: 'foo', kind: 'function', filePath: 'src/a.ts', line: 1, exported: true, contentHash: 'h1' },
    ], [], ['src/b.ts'], 'h1'))
    const edges = db.getEdgesFrom('src/a.ts:foo:1')
    expect(edges).toContainEqual(expect.objectContaining({ targetId: 'src/b.ts:*:0', kind: 'imports', weight: 1 }))
  })

  it('无符号文件的 imports 不产生边（无 firstSymbol）', () => {
    db.upsertFile(parseResult('src/empty.ts', [], [], ['src/b.ts'], 'h1'))
    expect(db.getStats().edges).toBe(0)
  })
})

describe('MeridianDb 查询', () => {
  it('getSymbolsForFile / getAllSymbols / getEdgesFrom / getEdgesTo', () => {
    db.upsertFile(parseResult('src/a.ts', [
      { id: 'src/a.ts:foo:1', name: 'foo', kind: 'function', filePath: 'src/a.ts', line: 1, exported: true, contentHash: 'h1' },
    ], [
      { sourceId: 'src/a.ts:foo:1', targetId: 'src/b.ts:bar:1', kind: 'calls', weight: 1, confidence: 'inferred' },
    ], [], 'h1'))
    expect(db.getSymbolsForFile('src/a.ts')).toHaveLength(1)
    expect(db.getAllSymbols()).toHaveLength(1)
    expect(db.getEdgesFrom('src/a.ts:foo:1')).toHaveLength(1)
    expect(db.getEdgesTo('src/b.ts:bar:1')).toHaveLength(1)
  })

  it('getReverseDependents：GLOB 前缀匹配 + 排除自身', () => {
    db.upsertEdge('src/a.ts:foo:1', 'src/b.ts:bar:1', 'calls', 1, 'extracted')
    db.upsertEdge('src/b.ts:bar:1', 'src/b.ts:bar:1', 'calls', 1, 'extracted') // 自环不入
    const deps = db.getReverseDependents('src/b.ts')
    expect(deps.map(d => d.file)).toEqual(['src/a.ts'])
  })

  it('getTestsFor：tested_by 边按 target 文件前缀命中', () => {
    db.upsertEdge('src/a.test.ts:*:0', 'src/a.ts:*:0', 'tested_by', 0.7, 'inferred')
    expect(db.getTestsFor('src/a.ts')).toEqual(['src/a.test.ts'])
    expect(db.getTestsFor('src/b.ts')).toEqual([])
  })

  it('getStats 计数', () => {
    db.upsertFile(parseResult('src/a.ts', [
      { id: 'src/a.ts:foo:1', name: 'foo', kind: 'function', filePath: 'src/a.ts', line: 1, exported: true, contentHash: 'h1' },
    ], [
      { sourceId: 'src/a.ts:foo:1', targetId: 'src/b.ts:bar:1', kind: 'calls', weight: 1 },
    ], [], 'h1'))
    expect(db.getStats()).toEqual({ files: 1, symbols: 1, edges: 1 })
  })
})

describe('MeridianDb 行为信号', () => {
  it('recordAccess / getAccessHeat：指数衰减', () => {
    db.recordAccess('src/a.ts')
    db.recordAccess('src/a.ts')
    const heat2 = db.getAccessHeat('src/a.ts')
    expect(heat2).toBeGreaterThan(1)
    expect(heat2).toBeLessThan(2)
    expect(db.getAccessHeat('src/never.ts')).toBe(0)
  })

  it('recordCoEdit：pair 规范化（a<b）+ ON CONFLICT 加权封顶 5.0', () => {
    db.recordCoEdit('src/z.ts', 'src/a.ts', 1) // 乱序写入，规范化存储
    db.recordCoEdit('src/a.ts', 'src/z.ts', 2)
    expect(db.getCoEditNeighbors('src/a.ts')).toHaveLength(1)
    const n = db.getCoEditNeighbors('src/a.ts')[0]!
    expect(n.file).toBe('src/z.ts')
    expect(n.weight).toBe(1.5)
    for (let i = 0; i < 10; i++) db.recordCoEdit('src/a.ts', 'src/z.ts', i)
    expect(db.getCoEditNeighbors('src/a.ts')[0]!.weight).toBe(5.0)
  })
})

describe('MeridianDb module_summaries', () => {
  it('upsert/get 往返', () => {
    db.upsertModuleSummary({ dirPath: 'src/agent/', summary: 'agent loop', keyExports: ['Agent'], fileCount: 3, status: 'active', contentHash: 'c1' })
    const rows = db.getModuleSummaries()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ dirPath: 'src/agent/', keyExports: ['Agent'], fileCount: 3 })
  })
})
