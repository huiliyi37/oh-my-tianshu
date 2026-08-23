/**
 * memory-pipeline 回填扫描：资格过滤（谱系/工作区/台账终态/重试上限）、
 * 闲置与年龄窗口、抽取写入、失败退避、单会话一次性语义。
 *
 * @module @huiliyi37/dsh-memory-pipeline/tests/sweep
 */

import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import { createUserMessage, createAssistantMessage } from '@huiliyi37/dsh-llm'
import { SessionId } from '@huiliyi37/dsh-session'
import type { SessionEvent } from '@huiliyi37/dsh-session'
import { SessionPersistence, type SessionListEntry } from '@huiliyi37/dsh-session-persistence'
import type { SessionHeader, SessionInspection } from '@huiliyi37/dsh-session-persistence'
import type { MemoryEntry, MemorySaveInput, MemorySearchResult, MemoryService } from '@huiliyi37/dsh-memory'
import type { ExperienceExtractor, ExtractionCandidate } from '@huiliyi37/dsh-memory-consolidate'
import { emptyLedger } from '../src/ledger.ts'
import type { LedgerFile } from '../src/ledger.ts'
import { isDerivedSession, runBackfillSweep } from '../src/sweep.ts'
import type { SweepOptions } from '../src/sweep.ts'

const NOW = 1_000_000_000
const WORKSPACE = '/ws'

/** 事件构造器：seq 自增，时间固定为 NOW 之前的时间偏移。 */
function eventBuilder(startSeq = 0): (type: SessionEvent['type'], data: unknown, timeMs: number) => SessionEvent {
  let seq = startSeq
  return (type, data, timeMs) => ({ type, seq: seq++, time: timeMs, data }) as SessionEvent
}

/** 构造一个通过成功门的会话日志（一个 completed turn）。 */
function passingEvents(lastTimeMs: number): SessionEvent[] {
  const build = eventBuilder()
  return [
    build('turn/start', { turn: 1 }, lastTimeMs - 1000),
    build('user/message', createUserMessage({
      content: [{ type: 'text', text: 'remember: deploy uses pnpm' }],
      source: { kind: 'user' },
    }), lastTimeMs - 900),
    build('assistant/message', {
      turn: 1, step: 1,
      message: createAssistantMessage({
        content: [{ type: 'text', text: 'noted' }],
        source: { provider: 'mock', model: 'mock-1' },
      }),
    }, lastTimeMs - 800),
    build('turn/end', { turn: 1, reason: { kind: 'completed' } }, lastTimeMs),
  ]
}

function header(id: string, overrides: Partial<SessionHeader> = {}): SessionHeader {
  return { version: 0, id: SessionId(id), createdAt: NOW - 5000, cwd: WORKSPACE, ...overrides }
}

class FakePersistence extends SessionPersistence {
  constructor(
    ctx: Context,
    private readonly headers: SessionHeader[],
    private readonly logs: Map<string, SessionEvent[]>,
  ) { super(ctx) }

  locate(): undefined { return undefined }
  async create(): Promise<void> {}
  async append(): Promise<void> {}
  async truncateStored(): Promise<void> {}
  async list(): Promise<SessionListEntry[]> { return this.headers.map(h => ({ header: h })) }
  async listSnapshots(): Promise<[]> { return [] }
  async load(id: SessionHeader['id']): Promise<SessionInspection> {
    return { meta: this.headers.find(h => h.id === id) ?? header('unknown'), events: this.logs.get(id) ?? [] }
  }
  async inspect(id: SessionHeader['id']): Promise<SessionInspection> { return this.load(id) }
  async readFrom(id: SessionHeader['id'], fromSeq: number): Promise<{ meta: SessionHeader; events: SessionEvent[] }> {
    const { meta, events } = await this.load(id)
    return { meta, events: events.filter(event => event.seq >= fromSeq) }
  }
}

interface MemorySpy {
  service: MemoryService
  saves: MemorySaveInput[]
  deleted: string[]
  uncertain: Array<[string, string, string]>
}

function fakeMemory(): MemorySpy {
  const spy: MemorySpy = { service: undefined as never, saves: [], deleted: [], uncertain: [] }
  spy.service = {
    async save(entry: MemorySaveInput): Promise<MemoryEntry> {
      spy.saves.push(entry)
      return { id: `m${String(spy.saves.length)}`, text: entry.text, scope: entry.scope, tags: entry.tags, createdAt: NOW, source: 'auto' }
    },
    async search(): Promise<MemorySearchResult[]> { return [] },
    async list(): Promise<MemoryEntry[]> { return [] },
    async delete(id: string): Promise<void> { spy.deleted.push(id) },
    async markUncertain(scope: string, subject: string, predicate: string): Promise<boolean> {
      spy.uncertain.push([scope, subject, predicate])
      return true
    },
  }
  return spy
}

function fakeExtractor(candidates: ExtractionCandidate[] = []): ExperienceExtractor & { calls: string[] } {
  return {
    calls: [],
    async extract(input: { sessionId: string }): Promise<ExtractionCandidate[]> {
      this.calls.push(input.sessionId)
      return candidates
    },
  }
}

function sweepOptions(overrides: Partial<SweepOptions> = {}): SweepOptions {
  return {
    maxTextChars: 280,
    maxEntities: 8,
    proceduresEnabled: true,
    recordFailures: true,
    maxCandidatesPerSession: 8,
    scanLimit: 20,
    minIdleMs: 3600_000,
    maxAgeMs: 14 * 86_400_000,
    maxRetriesPerSession: 3,
    workspaceCwd: WORKSPACE,
    leaseMs: 600_000,
    ...overrides,
  }
}

function noLog(): { info(message: string): void; warn(message: string): void } {
  return { info: () => {}, warn: () => {} }
}

describe('isDerivedSession', () => {
  it('fork / 子代理 / 委派深度均判定为派生', () => {
    expect(isDerivedSession(header('a', { parentSession: SessionId('p') }))).toBe(true)
    expect(isDerivedSession(header('b', { origin: 'subagent' }))).toBe(true)
    expect(isDerivedSession(header('c', { delegationDepth: 1 }))).toBe(true)
    expect(isDerivedSession(header('d'))).toBe(false)
  })
})

describe('runBackfillSweep', () => {
  it('合格会话被抽取并写入 global/auto/sourceRefs，台账记 ok', async () => {
    const ctx = new Context()
    const lastTime = NOW - 2 * 3600_000
    const logs = new Map([[ 's1', passingEvents(lastTime) ]])
    const persistence = new FakePersistence(ctx, [header('s1')], logs)
    const memory = fakeMemory()
    const extractor = fakeExtractor([{
      kind: 'observation', topic: 'explicit', text: 'deploy uses pnpm',
      keywords: ['deploy'], entities: [], confidence: 0.9, sourceSeqs: [2],
    }])
    const ledger: LedgerFile = emptyLedger()
    const report = await runBackfillSweep({
      persistence, memory: memory.service, extractor, ledger,
      options: sweepOptions(), now: () => NOW, log: noLog(), signal: new AbortController().signal,
    }, 'w1')
    expect(report.extractedSessions).toBe(1)
    expect(report.savedCandidates).toBe(1)
    expect(memory.saves).toHaveLength(1)
    expect(memory.saves[0]?.scope).toBe('global')
    expect(memory.saves[0]?.source).toBe('auto')
    expect(memory.saves[0]?.sourceRefs).toEqual([{ sessionId: 's1', eventSeqs: [2] }])
    expect(ledger.sessions['s1']?.outcome).toBe('ok')
    expect(extractor.calls).toEqual(['s1'])
  })

  it('ok 与 expired 终态不再处理；idle 复查解析为 expired；failed 达重试上限后跳过', async () => {
    const ctx = new Context()
    const lastTime = NOW - 2 * 3600_000
    const ledger: LedgerFile = emptyLedger()
    ledger.sessions['done'] = { lastEventSeq: 1, lastEventTimeMs: lastTime, firstSeenAtMs: lastTime, outcome: 'ok', retries: 0 }
    // 上次扫描观察到 idle 的会话：本次复查按年龄窗解析为 expired 终态。
    ledger.sessions['old'] = { lastEventSeq: 1, lastEventTimeMs: NOW - 30 * 86_400_000, firstSeenAtMs: NOW - 30 * 86_400_000, outcome: 'idle', retries: 0 }
    ledger.sessions['stuck'] = { lastEventSeq: 1, lastEventTimeMs: lastTime, firstSeenAtMs: lastTime, outcome: 'failed', retries: 3 }
    const headers = [header('done'), header('old'), header('stuck'), header('fresh')]
    const logs = new Map([[ 'fresh', passingEvents(lastTime) ]])
    const extractor = fakeExtractor()
    const report = await runBackfillSweep({
      persistence: new FakePersistence(ctx, headers, logs),
      memory: fakeMemory().service, extractor, ledger,
      options: sweepOptions(), now: () => NOW, log: noLog(), signal: new AbortController().signal,
    }, 'w1')
    expect(extractor.calls).toEqual(['fresh'])
    expect(report.inspected).toBe(2)
    expect(ledger.sessions['old']?.outcome).toBe('expired')
    expect(report.skippedExpired).toBe(1)
    expect(report.extractedSessions).toBe(1)
  })

  it('闲置不足记 idle 复查，超龄记 expired 终态', async () => {
    const ctx = new Context()
    const fresh = NOW - 60_000
    const ancient = NOW - 20 * 86_400_000
    const ledger: LedgerFile = emptyLedger()
    const report = await runBackfillSweep({
      persistence: new FakePersistence(ctx, [header('a'), header('b')], new Map([
        ['a', passingEvents(fresh)],
        ['b', passingEvents(ancient)],
      ])),
      memory: fakeMemory().service, extractor: fakeExtractor(), ledger,
      options: sweepOptions(), now: () => NOW, log: noLog(), signal: new AbortController().signal,
    }, 'w1')
    expect(ledger.sessions['a']?.outcome).toBe('idle')
    expect(ledger.sessions['b']?.outcome).toBe('expired')
    expect(report.skippedIdle).toBe(1)
    expect(report.skippedExpired).toBe(1)
    expect(report.extractedSessions).toBe(0)
  })

  it('他工作区与派生会话被元数据过滤，不计入 inspect', async () => {
    const ctx = new Context()
    const lastTime = NOW - 2 * 3600_000
    const extractor = fakeExtractor()
    const report = await runBackfillSweep({
      persistence: new FakePersistence(ctx, [
        header('elsewhere', { cwd: '/other' }),
        header('child', { parentSession: SessionId('p') }),
        header('root', {}),
      ], new Map([[ 'root', passingEvents(lastTime) ]])),
      memory: fakeMemory().service, extractor, ledger: emptyLedger(),
      options: sweepOptions(), now: () => NOW, log: noLog(), signal: new AbortController().signal,
    }, 'w1')
    expect(extractor.calls).toEqual(['root'])
    expect(report.listed).toBe(3)
    expect(report.inspected).toBe(1)
  })

  it('抽取失败记 failed 递增 retries，不中断扫描', async () => {
    const ctx = new Context()
    const lastTime = NOW - 2 * 3600_000
    const ledger: LedgerFile = emptyLedger()
    let calls = 0
    const failingExtractor: ExperienceExtractor = {
      async extract() {
        calls += 1
        throw new Error('boom')
      },
    }
    const report = await runBackfillSweep({
      persistence: new FakePersistence(ctx, [header('x'), header('y')], new Map([
        ['x', passingEvents(lastTime)],
        ['y', passingEvents(lastTime - 10)],
      ])),
      memory: fakeMemory().service, extractor: failingExtractor, ledger,
      options: sweepOptions(), now: () => NOW, log: noLog(), signal: new AbortController().signal,
    }, 'w1')
    expect(calls).toBe(2)
    expect(report.failed).toBe(2)
    expect(ledger.sessions['x']?.outcome).toBe('failed')
    expect(ledger.sessions['x']?.retries).toBe(1)
    expect(ledger.sessions['x']?.error).toContain('boom')
  })

  it('同扫描内同 (subject,predicate) 不同 value 触发 uncertain 标记', async () => {
    const ctx = new Context()
    const lastTime = NOW - 2 * 3600_000
    const extractor = fakeExtractor([
      {
        kind: 'fact', topic: 'db', text: 'uses postgres',
        keywords: ['db'], entities: [], confidence: 0.9,
        fact: { subject: 'app', predicate: 'uses-db', value: 'postgres' }, sourceSeqs: [1],
      },
      {
        kind: 'fact', topic: 'db', text: 'uses mysql',
        keywords: ['db'], entities: [], confidence: 0.9,
        fact: { subject: 'app', predicate: 'uses-db', value: 'mysql' }, sourceSeqs: [2],
      },
    ])
    const memory = fakeMemory()
    await runBackfillSweep({
      persistence: new FakePersistence(ctx, [header('s1')], new Map([[ 's1', passingEvents(lastTime) ]])),
      memory: memory.service, extractor, ledger: emptyLedger(),
      options: sweepOptions(), now: () => NOW, log: noLog(), signal: new AbortController().signal,
    }, 'w1')
    expect(memory.saves).toHaveLength(2)
    expect(memory.uncertain).toEqual([['global', 'app', 'uses-db']])
  })

  it('abort 后停止处理后续会话', async () => {
    const ctx = new Context()
    const lastTime = NOW - 2 * 3600_000
    const controller = new AbortController()
    const extractor = fakeExtractor()
    await runBackfillSweep({
      persistence: new FakePersistence(ctx, [header('a'), header('b')], new Map([
        ['a', passingEvents(lastTime)],
        ['b', passingEvents(lastTime)],
      ])),
      memory: fakeMemory().service, extractor, ledger: emptyLedger(),
      options: sweepOptions(), now: () => NOW, log: noLog(), signal: controller.signal,
    }, 'w1')
    controller.abort()
    expect(extractor.calls.length).toBeLessThanOrEqual(2)
  })
})

describe('runBackfillSweep — 溯源去重与 cwd 规范化', () => {
  it('记忆库已有该会话的 auto 溯源（consolidate 活抽取）→ 记终态 ok，不再抽取', async () => {
    const ctx = new Context()
    const lastTime = NOW - 2 * 3600_000
    const logs = new Map([[ 's1', passingEvents(lastTime) ]])
    const persistence = new FakePersistence(ctx, [header('s1')], logs)
    const memory = fakeMemory()
    // global 已有 consolidate 写入的 auto 条目，溯源指向 s1。
    ;(memory.service.list) = async () => [{
      id: 'm0', text: 'already extracted', scope: 'global', tags: [], createdAt: NOW, source: 'auto',
      sourceRefs: [{ sessionId: 's1', eventSeqs: [2] }],
    }]
    const extractor = fakeExtractor([])
    const ledger: LedgerFile = emptyLedger()
    const report = await runBackfillSweep({
      persistence, memory: memory.service, extractor, ledger,
      options: sweepOptions(), now: () => NOW, log: noLog(), signal: new AbortController().signal,
    }, 'w1')
    expect(report.dedupSkipped).toBe(1)
    expect(report.extractedSessions).toBe(0)
    expect(memory.saves).toHaveLength(0)
    expect(extractor.calls).toEqual([])
    expect(ledger.sessions['s1']?.outcome).toBe('ok')
    expect(ledger.sessions['s1']?.extractor).toBe('provenance-dedup')
  })

  it('非 auto 条目的溯源不去重（用户手写条目不算已抽取）', async () => {
    const ctx = new Context()
    const lastTime = NOW - 2 * 3600_000
    const logs = new Map([[ 's1', passingEvents(lastTime) ]])
    const persistence = new FakePersistence(ctx, [header('s1')], logs)
    const memory = fakeMemory()
    ;(memory.service.list) = async () => [{
      id: 'm0', text: 'user note', scope: 'global', tags: [], createdAt: NOW, source: 'user',
      sourceRefs: [{ sessionId: 's1', eventSeqs: [2] }],
    }]
    const extractor = fakeExtractor([{
      kind: 'observation', topic: 'explicit', text: 'deploy uses pnpm',
      keywords: ['deploy'], entities: [], confidence: 0.9, sourceSeqs: [2],
    }])
    const ledger: LedgerFile = emptyLedger()
    const report = await runBackfillSweep({
      persistence, memory: memory.service, extractor, ledger,
      options: sweepOptions(), now: () => NOW, log: noLog(), signal: new AbortController().signal,
    }, 'w1')
    expect(report.dedupSkipped).toBe(0)
    expect(report.extractedSessions).toBe(1)
  })

  it('cwd 符号链接形式不同但指向同一目录 → 仍属本工作区（realpath 回落）', async () => {
    const ctx = new Context()
    const lastTime = NOW - 2 * 3600_000
    const logs = new Map([[ 's1', passingEvents(lastTime) ]])
    // 真实 tmpdir 在 macOS 上即 /var ↔ /private/var 符号链接对；字面不等、
    // realpath 相等——正好构造该场景。
    const real = realpathSync(tmpdir())
    const literal = tmpdir()
    const persistence = new FakePersistence(ctx, [header('s1', { cwd: literal })], logs)
    const extractor = fakeExtractor([{
      kind: 'observation', topic: 'explicit', text: 'x',
      keywords: [], entities: [], confidence: 0.9, sourceSeqs: [2],
    }])
    const ledger: LedgerFile = emptyLedger()
    const report = await runBackfillSweep({
      persistence, memory: fakeMemory().service, extractor, ledger,
      options: sweepOptions({ workspaceCwd: real }), now: () => NOW, log: noLog(), signal: new AbortController().signal,
    }, 'w1')
    expect(report.extractedSessions + report.dedupSkipped + report.skippedIdle).toBe(1)
    expect(report.extractedSessions).toBe(1)
  })
})
