import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MeridianIndexer } from '../src/indexer.ts'
import { isMeridianIndexablePath } from '../src/indexer.ts'

let root: string
let indexer: MeridianIndexer

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'meridian-idx-'))
  indexer = new MeridianIndexer(root, join(root, '.rivet'))
})

afterEach(() => {
  indexer.close()
  rmSync(root, { recursive: true, force: true })
})

describe('isMeridianIndexablePath', () => {
  it('扩展名白名单 + 黑名单过滤', () => {
    expect(isMeridianIndexablePath('src/a.ts')).toBe(true)
    expect(isMeridianIndexablePath('src/a.py')).toBe(true)
    expect(isMeridianIndexablePath('src/a.go')).toBe(true)
    expect(isMeridianIndexablePath('src/a.rs')).toBe(false)
    expect(isMeridianIndexablePath('node_modules/x/index.ts')).toBe(false)
    expect(isMeridianIndexablePath('dist/a.ts')).toBe(false)
    expect(isMeridianIndexablePath('src/a.min.js')).toBe(false)
    expect(isMeridianIndexablePath('src/a.d.ts')).toBe(false)
    expect(isMeridianIndexablePath('src/a.log')).toBe(false)
  })
})

describe('MeridianIndexer.indexFile', () => {
  it('索引符号 + 增量更新（文件变化后重解析）', async () => {
    const f = join(root, 'a.ts')
    writeFileSync(f, 'export function one() {}', 'utf-8')
    await indexer.indexFile('a.ts')
    let symbols = indexer.getDb().getSymbolsForFile('a.ts')
    expect(symbols.map(s => s.name)).toEqual(['one'])

    // 同内容再索引：needsParse false，无变化
    await indexer.indexFile('a.ts')
    symbols = indexer.getDb().getSymbolsForFile('a.ts')
    expect(symbols.map(s => s.name)).toEqual(['one'])

    // 内容变化 → 重解析
    writeFileSync(f, 'export function one() {}\nexport function two() {}', 'utf-8')
    await indexer.indexFile('a.ts')
    symbols = indexer.getDb().getSymbolsForFile('a.ts')
    expect(symbols.map(s => s.name)).toEqual(['one', 'two'])
  })

  it('imports 1-hop 展开：索引 a.ts 时其相对依赖也被索引', async () => {
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'b.ts'), 'export const b = 1', 'utf-8')
    writeFileSync(join(root, 'src', 'a.ts'), "import { b } from './b'\nexport function a() { return b }", 'utf-8')
    await indexer.indexFile('src/a.ts')
    const files = indexer.getDb().getAllFiles()
    expect(files).toEqual(expect.arrayContaining(['src/a.ts', 'src/b.ts']))
  })

  it('跨文件 call 边：唯一名字匹配 inferred，多匹配 ambiguous', async () => {
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'b.ts'), 'export function helper() {}', 'utf-8')
    writeFileSync(join(root, 'src', 'c.ts'), 'export function helper() {}', 'utf-8')
    writeFileSync(join(root, 'src', 'a.ts'), "import { helper } from './b'\nexport function a() { helper() }", 'utf-8')

    // 先索引 b，再索引 a —— helper 跨文件唯一匹配 b
    await indexer.indexFile('src/b.ts')
    await indexer.indexFile('src/a.ts')
    const aSymbol = indexer.getDb().getSymbolsForFile('src/a.ts').find(s => s.name === 'a')!
    const edges = indexer.getDb().getEdgesFrom(aSymbol.id).filter(e => e.kind === 'calls')
    expect(edges).toHaveLength(1)
    expect(edges[0]!.confidence).toBe('inferred')
    expect(edges[0]!.targetId).toContain('src/b.ts')

    // 引入同名第二符号 → 修改 a.ts 触发重解析（内容未变则增量跳过），
    // 此时 helper 双匹配 → ambiguous
    await indexer.indexFile('src/c.ts')
    writeFileSync(join(root, 'src', 'a.ts'), "import { helper } from './b'\nexport function a() { helper() }\n// touch\n", 'utf-8')
    await indexer.indexFile('src/a.ts')
    const edges2 = indexer.getDb().getEdgesFrom(aSymbol.id).filter(e => e.kind === 'calls')
    expect(edges2.filter(e => e.confidence === 'ambiguous')).toHaveLength(2)
  })

  it('tested_by 边：测试文件按命名推断目标', async () => {
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'foo.ts'), 'export function foo() {}', 'utf-8')
    writeFileSync(join(root, 'src', 'foo.test.ts'), "import { foo } from './foo'\n", 'utf-8')
    await indexer.indexFile('src/foo.test.ts')
    const tests = indexer.getDb().getTestsFor('src/foo.ts')
    expect(tests).toEqual(['src/foo.test.ts'])
  })
})

describe('MeridianIndexer.removeFile', () => {
  it('删除文件：入边复活为文件级占位，不静默断裂', async () => {
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'b.ts'), 'export function helper() {}', 'utf-8')
    writeFileSync(join(root, 'src', 'a.ts'), "import { helper } from './b'\nexport function a() { helper() }", 'utf-8')
    await indexer.indexFile('src/a.ts') // 1-hop 展开索引 b
    const aSymbol = indexer.getDb().getSymbolsForFile('src/a.ts').find(s => s.name === 'a')!

    rmSync(join(root, 'src', 'b.ts'))
    const revived = indexer.removeFile('src/b.ts')
    expect(revived).toBeGreaterThan(0)
    // a 的调用边被重定向到 b 的文件级占位
    const edges = indexer.getDb().getEdgesFrom(aSymbol.id).filter(e => e.kind === 'calls')
    expect(edges.some(e => e.targetId === 'src/b.ts:*:0')).toBe(true)
    // b 的符号清空
    expect(indexer.getDb().getSymbolsForFile('src/b.ts')).toEqual([])
  })
})

describe('MeridianIndexer 路径边界', () => {
  it('../ 逃逸拒绝：越界路径不索引', async () => {
    writeFileSync(join(root, 'a.ts'), 'export function a() {}', 'utf-8')
    await indexer.indexFile('../outside.ts')
    await indexer.indexFile('/etc/passwd')
    expect(indexer.getDb().getAllFiles()).toEqual([])
  })

  it('symlink 指向 repo 外的文件被拒绝', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'meridian-outside-'))
    try {
      const outsideFile = join(outside, 'evil.ts')
      writeFileSync(outsideFile, 'export function evil() {}', 'utf-8')
      symlinkSync(outsideFile, join(root, 'link.ts'))
      await indexer.indexFile('link.ts')
      expect(indexer.getDb().getAllFiles()).toEqual([])
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })
})
