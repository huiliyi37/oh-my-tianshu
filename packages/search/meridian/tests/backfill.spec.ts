import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MeridianIndexer } from '../src/indexer.ts'
import { scheduleMeridianBackfill } from '../src/backfill.ts'

let root: string
let indexer: MeridianIndexer

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'meridian-backfill-'))
  indexer = new MeridianIndexer(root, join(root, '.rivet'))
})

afterEach(() => {
  indexer.close()
  rmSync(root, { recursive: true, force: true })
})

describe('scheduleMeridianBackfill', () => {
  it('非 git 目录走 readdir 回退：只索引可索引文件，跳过黑名单目录', async () => {
    mkdirSync(join(root, 'src'), { recursive: true })
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true })
    writeFileSync(join(root, 'src', 'a.ts'), 'export function a() {}', 'utf-8')
    writeFileSync(join(root, 'src', 'b.py'), 'def b():\n    pass\n', 'utf-8')
    writeFileSync(join(root, 'src', 'c.md'), '# doc', 'utf-8')
    writeFileSync(join(root, 'node_modules', 'pkg', 'x.ts'), 'export const x = 1', 'utf-8')
    writeFileSync(join(root, 'README.md'), '# readme', 'utf-8')

    const logs: string[] = []
    const handle = scheduleMeridianBackfill(indexer, root, { allowed: true, maxFiles: 100, log: m => logs.push(m) })
    await handle.done

    const files = indexer.getDb().getAllFiles().sort()
    expect(files).toEqual(['src/a.ts', 'src/b.py'])
    expect(logs.some(m => m.includes('done: indexed=2/2'))).toBe(true)
  })

  it('allowed=false 跳过（不调度、不枚举）', async () => {
    writeFileSync(join(root, 'a.ts'), 'export function a() {}', 'utf-8')
    const handle = scheduleMeridianBackfill(indexer, root, { allowed: false })
    await handle.done
    expect(indexer.getDb().getAllFiles()).toEqual([])
  })

  it('重复调度幂等：第二个调用返回即时完成的空句柄', async () => {
    writeFileSync(join(root, 'a.ts'), 'export function a() {}', 'utf-8')
    const h1 = scheduleMeridianBackfill(indexer, root, { allowed: true })
    await h1.done
    const h2 = scheduleMeridianBackfill(indexer, root, { allowed: true })
    await h2.done
    expect(indexer.getDb().getAllFiles()).toEqual(['a.ts'])
  })

  it('stop 提前终止：后续批不再索引', async () => {
    for (let i = 0; i < 30; i++) {
      writeFileSync(join(root, `f${i}.ts`), `export function f${i}() {}`, 'utf-8')
    }
    const handle = scheduleMeridianBackfill(indexer, root, { allowed: true, maxFiles: 30 })
    // 立即 stop —— 批间 setTimeout(0) 让 stop 在首批后生效
    handle.stop()
    await handle.done
    const count = indexer.getDb().getAllFiles().length
    expect(count).toBeLessThan(30)
  })
})
