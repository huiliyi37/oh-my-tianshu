/**
 * memory-pipeline 台账：加载校验、原子写回、租约获取/接管/释放。
 *
 * @module @huiliyi37/dsh-memory-pipeline/tests/ledger
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { acquireLease, emptyLedger, LEDGER_VERSION, loadLedger, newWorkerId, releaseLease, saveLedger } from '../src/ledger.ts'
import type { LedgerFile } from '../src/ledger.ts'

let dir: string | undefined

afterEach(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true })
  dir = undefined
})

async function tempLedgerPath(): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), 'memory-pipeline-ledger-'))
  return join(dir, 'ledger.json')
}

describe('ledger load', () => {
  it('文件不存在时返回全新台账', async () => {
    const ledger = await loadLedger(await tempLedgerPath())
    expect(ledger).toEqual({ version: LEDGER_VERSION, leases: {}, sessions: {}, phase2: { pendingCount: 0 } })
  })

  it('版本不符拒绝加载（不迁移）', async () => {
    const path = await tempLedgerPath()
    await writeFile(path, JSON.stringify({ ...emptyLedger(), version: LEDGER_VERSION + 1 }), 'utf8')
    await expect(loadLedger(path)).rejects.toThrow(/不受支持/)
  })

  it('形状损坏拒绝加载', async () => {
    const path = await tempLedgerPath()
    await writeFile(path, JSON.stringify({ version: LEDGER_VERSION }), 'utf8')
    await expect(loadLedger(path)).rejects.toThrow(/形状损坏/)
  })

  it('写回后读回一致（原子 rename 落盘）', async () => {
    const path = await tempLedgerPath()
    const ledger = emptyLedger()
    ledger.sessions['s1'] = {
      lastEventSeq: 7, lastEventTimeMs: 100, firstSeenAtMs: 90,
      outcome: 'ok', retries: 0, extractedAtMs: 120, extractor: 'extractor',
    }
    await saveLedger(path, ledger)
    expect(await readFile(path, 'utf8')).toContain('"s1"')
    const loaded = await loadLedger(path)
    expect(loaded.sessions['s1']?.outcome).toBe('ok')
  })
})

describe('lease', () => {
  it('空闲时获取成功，他人持有未过期时失败', () => {
    const ledger: LedgerFile = emptyLedger()
    expect(acquireLease(ledger, 'sweep', 'w1', 1000, 500)).toBe(true)
    expect(acquireLease(ledger, 'sweep', 'w2', 1000, 600)).toBe(false)
  })

  it('过期租约可被他人接管', () => {
    const ledger: LedgerFile = emptyLedger()
    expect(acquireLease(ledger, 'phase2', 'w1', 100, 500)).toBe(true)
    expect(acquireLease(ledger, 'phase2', 'w2', 100, 700)).toBe(true)
    expect(ledger.leases.phase2?.workerId).toBe('w2')
  })

  it('持有者自身可续期', () => {
    const ledger: LedgerFile = emptyLedger()
    expect(acquireLease(ledger, 'sweep', 'w1', 100, 500)).toBe(true)
    expect(acquireLease(ledger, 'sweep', 'w1', 100, 550)).toBe(true)
    expect(ledger.leases.sweep?.expiresAtMs).toBe(650)
  })

  it('仅持有者本人能释放', () => {
    const ledger: LedgerFile = emptyLedger()
    acquireLease(ledger, 'sweep', 'w1', 1000, 500)
    releaseLease(ledger, 'sweep', 'w2')
    expect(ledger.leases.sweep?.workerId).toBe('w1')
    releaseLease(ledger, 'sweep', 'w1')
    expect(ledger.leases.sweep).toBeUndefined()
  })

  it('workerId 每次生成唯一', () => {
    expect(newWorkerId()).not.toBe(newWorkerId())
  })
})
