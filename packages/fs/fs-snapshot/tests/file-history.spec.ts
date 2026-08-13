import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FileHistory } from '../src/file-history.js'

let dir: string
let backupDir: string
const SESSION = 'session-test-1'

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fs-snapshot-'))
  backupDir = join(dir, 'backups')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function makeFile(rel: string, content: string): string {
  const p = join(dir, rel)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, content, 'utf-8')
  return p
}

function dirname(p: string): string {
  const idx = p.lastIndexOf('/')
  return idx < 0 ? '.' : p.slice(0, idx)
}

describe('FileHistory.trackEdit', () => {
  it('首次编辑创建备份，快照索引记录 boundaryId + 备份名', async () => {
    const f = makeFile('a.txt', 'v1')
    const fh = new FileHistory(backupDir, SESSION)
    await fh.trackEdit(f, 'call-1')

    const snaps = fh.getAllSnapshots()
    expect(snaps).toHaveLength(1)
    expect(snaps[0]!.boundaryId).toBe('call-1')
    const backup = snaps[0]!.trackedFileBackups[f]
    expect(backup?.backupFileName).toMatch(/^[0-9a-f]{16}@v1$/)
    expect(readFileSync(join(backupDir, SESSION, backup!.backupFileName!), 'utf-8')).toBe('v1')
  })

  it('同一 boundaryId 内重复编辑同一文件只保留首个快照（= 边界前状态）', async () => {
    const f = makeFile('a.txt', 'v1')
    const fh = new FileHistory(backupDir, SESSION)
    await fh.trackEdit(f, 'call-1')
    writeFileSync(f, 'v2', 'utf-8')
    await fh.trackEdit(f, 'call-1')

    const snaps = fh.getAllSnapshots()
    expect(snaps).toHaveLength(1)
    const backup = snaps[0]!.trackedFileBackups[f]
    expect(backup?.version).toBe(1)
    expect(readFileSync(join(backupDir, SESSION, backup!.backupFileName!), 'utf-8')).toBe('v1')
  })

  it('新 boundaryId 编辑同一文件递增版本（v1 → v2），两个快照独立', async () => {
    const f = makeFile('a.txt', 'v1')
    const fh = new FileHistory(backupDir, SESSION)
    await fh.trackEdit(f, 'call-1')
    writeFileSync(f, 'v2', 'utf-8')
    await fh.trackEdit(f, 'call-2')

    const snaps = fh.getAllSnapshots()
    expect(snaps).toHaveLength(2)
    const b1 = snaps[0]!.trackedFileBackups[f]
    const b2 = snaps[1]!.trackedFileBackups[f]
    expect(b1?.version).toBe(1)
    expect(b2?.version).toBe(2)
    expect(readFileSync(join(backupDir, SESSION, b1!.backupFileName!), 'utf-8')).toBe('v1')
    expect(readFileSync(join(backupDir, SESSION, b2!.backupFileName!), 'utf-8')).toBe('v2')
  })

  it('文件不存在时备份为 null（回退时删除）', async () => {
    const missing = join(dir, 'missing.txt')
    const fh = new FileHistory(backupDir, SESSION)
    await fh.trackEdit(missing, 'call-1')
    expect(fh.getAllSnapshots()[0]!.trackedFileBackups[missing]?.backupFileName).toBeNull()
  })
})

describe('FileHistory.rewindToBoundary', () => {
  it('恢复边界后被编辑文件到边界前状态', async () => {
    const f = makeFile('a.txt', 'v1')
    const fh = new FileHistory(backupDir, SESSION)
    await fh.trackEdit(f, 'call-1') // 边界前编辑（快照 v1）
    writeFileSync(f, 'v2', 'utf-8')
    await fh.trackEdit(f, 'call-2') // 边界后首个编辑（快照 v2 = 边界时状态）
    writeFileSync(f, 'v3', 'utf-8')

    const { changed, skipped } = await fh.rewindToBoundary(new Set(['call-2']))
    expect(changed).toContain(f)
    expect(skipped).toBe(0)
    expect(readFileSync(f, 'utf-8')).toBe('v2') // 恢复到边界时状态（call-2 编辑前）
  })

  it('边界后新建的文件被删除', async () => {
    const created = join(dir, 'new.txt')
    const fh = new FileHistory(backupDir, SESSION)
    await fh.trackEdit(created, 'call-1') // 边界后首次编辑（此前不存在 → null 备份）
    writeFileSync(created, 'hello', 'utf-8')

    const { changed, skipped } = await fh.rewindToBoundary(new Set(['call-1']))
    expect(changed).toContain(created)
    expect(skipped).toBe(0)
    expect(existsSync(created)).toBe(false)
  })

  it('边界前的编辑不受影响', async () => {
    const f = makeFile('a.txt', 'v0')
    const fh = new FileHistory(backupDir, SESSION)
    await fh.trackEdit(f, 'call-1')
    writeFileSync(f, 'v1', 'utf-8')
    await fh.trackEdit(f, 'call-2')
    writeFileSync(f, 'v2', 'utf-8')

    const { changed } = await fh.rewindToBoundary(new Set(['call-2']))
    expect(changed).toContain(f)
    expect(readFileSync(f, 'utf-8')).toBe('v1') // 恢复到 call-1 后的状态（v1），保留边界前编辑
  })

  it('备份缺失的文件计入 skipped（回退缺口，不静默）', async () => {
    const f = makeFile('a.txt', 'v1')
    const fh = new FileHistory(backupDir, SESSION)
    await fh.trackEdit(f, 'call-1')
    writeFileSync(f, 'v2', 'utf-8')
    const snap = fh.getAllSnapshots()[0]!
    const backupName = snap.trackedFileBackups[f]!.backupFileName!
    rmSync(join(backupDir, SESSION, backupName)) // 模拟快照被驱逐/清理

    const { changed, skipped } = await fh.rewindToBoundary(new Set(['call-1']))
    expect(changed).not.toContain(f)
    expect(skipped).toBe(1)
    expect(readFileSync(f, 'utf-8')).toBe('v2') // 文件保持现状
  })

  it('getBoundaryFiles 预览 restore/delete 动作', async () => {
    const f = makeFile('a.txt', 'v1')
    const created = join(dir, 'new.txt')
    const fh = new FileHistory(backupDir, SESSION)
    await fh.trackEdit(f, 'call-1')
    await fh.trackEdit(created, 'call-2') // null 备份（不存在）
    writeFileSync(created, 'x', 'utf-8')

    const preview = fh.getBoundaryFiles(new Set(['call-2']))
    expect(preview).toEqual([
      { path: created, action: 'delete' },
    ])
  })
})

describe('FileHistory.rewind（按边界 id）', () => {
  it('恢复到指定边界快照', async () => {
    const f = makeFile('a.txt', 'v1')
    const fh = new FileHistory(backupDir, SESSION)
    await fh.trackEdit(f, 'call-1')
    writeFileSync(f, 'v2', 'utf-8')
    await fh.trackEdit(f, 'call-2')
    writeFileSync(f, 'v3', 'utf-8')

    const changed = await fh.rewind('call-1')
    expect(changed).toContain(f)
    expect(readFileSync(f, 'utf-8')).toBe('v1')
  })

  it('边界 id 无快照时抛错', async () => {
    const fh = new FileHistory(backupDir, SESSION)
    await expect(fh.rewind('nope')).rejects.toThrow('not found')
  })
})

describe('FileHistory 容量与清理', () => {
  it('cleanupOrphans 删除索引未引用的备份', async () => {
    const f = makeFile('a.txt', 'v1')
    const fh = new FileHistory(backupDir, SESSION)
    await fh.trackEdit(f, 'call-1')
    // 手工写入孤儿备份
    const sessionDir = join(backupDir, SESSION)
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(join(sessionDir, 'orphan@v99'), 'x', 'utf-8')

    const removed = await fh.cleanupOrphans()
    expect(removed).toBe(1)
    expect(existsSync(join(sessionDir, 'orphan@v99'))).toBe(false)
  })

  it('hasSnapshot / getLatestSnapshotId', async () => {
    const f = makeFile('a.txt', 'v1')
    const fh = new FileHistory(backupDir, SESSION)
    await fh.trackEdit(f, 'call-1')
    expect(fh.hasSnapshot('call-1')).toBe(true)
    expect(fh.hasSnapshot('call-2')).toBe(false)
    expect(fh.getLatestSnapshotId()).toBe('call-1')
  })
})
