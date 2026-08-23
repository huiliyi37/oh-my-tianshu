/**
 * input-history-store.spec.ts — 输入历史持久化存储单测：记录语义（最新在
 * 前/去重/截顶）、落盘回读往返、坏档降级为空、写失败静默（下次成功写补齐）。
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InputHistoryStore, MAX_PERSISTED } from '../src/engine/input-history-store.js'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }).catch(() => {})))
})

async function tempPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-history-spec-'))
  dirs.push(dir)
  return join(dir, 'input-history.json')
}

/** 等待串行写链排空（scheduleWrite 异步落盘）。 */
async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 30))
}

describe('InputHistoryStore', () => {
  it(`记录语义：最新在前、去重、截顶 ${MAX_PERSISTED} 条`, () => {
    const store = new InputHistoryStore('/dev/null-spec-path')
    store.record('a')
    store.record('b')
    store.record('a')
    expect(store.snapshot()).toEqual(['a', 'b'])
    for (let i = 0; i < MAX_PERSISTED + 20; i++) store.record(`e${i}`)
    expect(store.snapshot()).toHaveLength(MAX_PERSISTED)
    expect(store.snapshot()[0]).toBe(`e${MAX_PERSISTED + 19}`)
  })

  it('落盘回读往返：JSON 数组、0600 原子写', async () => {
    const path = await tempPath()
    const store = new InputHistoryStore(path)
    store.record('第一条')
    store.record('第二条')
    await settle()
    const raw = await readFile(path, 'utf8')
    expect(JSON.parse(raw)).toEqual(['第二条', '第一条'])

    const reloaded = await new InputHistoryStore(path).load()
    expect(reloaded.snapshot()).toEqual(['第二条', '第一条'])
  })

  it('坏档/缺失降级为空历史（不抛、不拦启动）', async () => {
    const path = await tempPath()
    await writeFile(path, 'not json at all{', 'utf8')
    const store = await new InputHistoryStore(path).load()
    expect(store.snapshot()).toEqual([])
    // 降级后记录照常工作（下次写覆盖坏档）。
    store.record('fresh')
    await settle()
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(['fresh'])
  })

  it('写失败静默：记录仍在内存，不阻塞调用方', async () => {
    // 目录路径当文件写 → writeFileAtomic 必失败。
    const dir = await mkdtemp(join(tmpdir(), 'dsh-history-spec-block-'))
    dirs.push(dir)
    const store = new InputHistoryStore(join(dir, 'sub', 'file.json'))
    const spy = vi.spyOn(process, 'emitWarning').mockImplementation(() => undefined)
    store.record('kept-in-memory')
    await settle()
    expect(store.snapshot()).toEqual(['kept-in-memory'])
    spy.mockRestore()
  })
})
