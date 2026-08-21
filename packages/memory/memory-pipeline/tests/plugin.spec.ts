/**
 * memory-pipeline apply：fail loud 校验矩阵、opt-in 总开关、触发调度与
 * ctx.tasks 注册路径（tasks 缺席降级内联）。
 *
 * @module @huiliyi37/dsh-memory-pipeline/tests/plugin
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@huiliyi37/cordis'
import { createAssistantMessage, createUserMessage } from '@huiliyi37/dsh-llm'
import type { TaskService } from '@huiliyi37/dsh-tasks'
import { SessionStore, SessionId } from '@huiliyi37/dsh-session'
import type { SessionEvent } from '@huiliyi37/dsh-session'
import { SessionPersistenceJsonl } from '@huiliyi37/dsh-session-persistence-jsonl'
import { MarkdownMemoryStore } from '@huiliyi37/dsh-memory'
import type { LedgerFile } from '../src/ledger.ts'
import { loadLedger } from '../src/ledger.ts'
import { apply, Config, name } from '../src/index.ts'

let dir: string | undefined

afterEach(async () => {
  vi.useRealTimers()
  if (dir !== undefined) await rm(dir, { recursive: true, force: true })
  dir = undefined
})

async function tempDir(): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), 'memory-pipeline-plugin-'))
  return dir
}

describe('memory-pipeline plugin apply', () => {
  it('named export 与 Config schema 存在', () => {
    expect(name).toBe('memory-pipeline')
    expect(Config).toBeDefined()
  })

  it('llmProvider / llmModel 必须成对', () => {
    const ctx = new Context()
    expect(() => { apply(ctx, { enabled: true, extractor: 'llm', llmProvider: 'p' }) }).toThrow(/必须成对配置/)
    expect(() => { apply(ctx, { enabled: true, extractor: 'llm', llmModel: 'm' }) }).toThrow(/必须成对配置/)
  })

  it('extractor "llm" 需要显式路由对（回填无会话路由可借）', () => {
    const ctx = new Context()
    expect(() => { apply(ctx, { enabled: true }) }).toThrow(/需要成对配置/)
  })

  it('闲置窗必须落在年龄窗内', () => {
    const ctx = new Context()
    expect(() => {
      apply(ctx, {
        enabled: true,
        extractor: 'heuristic',
        minIdleHours: 48,
        maxAgeDays: 1,
      })
    }).toThrow(/minIdleHours/)
  })

  it('负数上限 fail loud', () => {
    const ctx = new Context()
    expect(() => {
      apply(ctx, { enabled: true, extractor: 'heuristic', scanLimit: -1 })
    }).toThrow(/非负安全整数/)
  })

  it('enabled: false 完全不挂监听', () => {
    const ctx = new Context()
    const onSpy = vi.spyOn(ctx, 'on')
    expect(() => { apply(ctx, {}) }).not.toThrow()
    expect(onSpy).not.toHaveBeenCalled()
  })

  it('根会话启动经防抖后注册 tasks 作业；派生会话不触发', async () => {
    vi.useFakeTimers()
    const ctx = new Context()
    const started: Array<{ kind: string; label: string }> = []
    // 测试夹具：只实现 start 的 TaskService 形状（管线仅消费 start）。
    const fakeTasks = {
      start(spec: { kind: string; label: string }) {
        started.push({ kind: spec.kind, label: spec.label })
        return spec
      },
    } as unknown as TaskService
    ctx.provide('tasks', fakeTasks)
    apply(ctx, {
      enabled: true,
      extractor: 'heuristic',
      startDelayMs: 1000,
      // sessionPersistence 缺席：作业会失败 settle——本测试只断言注册路径。
    })
    /** 测试夹具：监听器只读 session.header.parentSession（见 index.ts 触发监听）。 */
    const fixtureAgent = (parentSession?: string): unknown => ({ session: { header: { parentSession } } })
    type Emit = (name: 'agent/session-start', payload: { agent: unknown; source: string }) => void
    const emit = ctx.emit.bind(ctx) as unknown as Emit
    // 派生会话触发不留下任何调度。
    emit('agent/session-start', { agent: fixtureAgent('p1'), source: 'startup' })
    await vi.advanceTimersByTimeAsync(2000)
    expect(started).toEqual([])
    // 根会话触发：防抖窗口内不注册，窗口过后恰好一个作业。
    emit('agent/session-start', { agent: fixtureAgent(undefined), source: 'startup' })
    expect(started).toEqual([])
    await vi.advanceTimersByTimeAsync(1500)
    expect(started).toHaveLength(1)
    expect(started[0]?.kind).toBe('memory-pipeline')
    expect(started[0]?.label).toContain('backfill sweep')
  })

  it('真装配回填：JSONL 持久化的历史会话被补抽进 Markdown 记忆库，二次触发零重复', async () => {
    const root = await tempDir()
    const now = Date.now()
    const lastEventTime = now - 2 * 3600_000
    // 同一 Context：Service 构造即注册 sessionPersistence，插件的 reflect 才能取到。
    // JSONL 后端的 coordinator 装配读取 ctx.sessions（HMR 种子同步），先挂 SessionStore。
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const persistence = new SessionPersistenceJsonl(ctx, { root: join(root, 'sessions'), compression: 'none' })
    const meta = { version: 0, id: SessionId('seed-1'), createdAt: lastEventTime - 5000, cwd: root }
    await persistence.create(meta)
    let seq = 0
    const event = (type: SessionEvent['type'], data: unknown): SessionEvent =>
      ({ type, seq: seq++, time: lastEventTime - (100 - seq), data }) as SessionEvent
    // surface-eligible 事件必须携带 surfaceOp 标记（持久化边界校验）。
    const surface = (e: SessionEvent): SessionEvent => ({ ...e, surfaceOp: 'append' })
    await persistence.append(meta.id, [
      event('turn/start', { turn: 1 }),
      surface(event('user/message', createUserMessage({
        content: [{ type: 'text', text: 'remember: deploy uses pnpm here' }],
        source: { kind: 'user' },
      }))),
      surface(event('assistant/message', {
        turn: 1, step: 1,
        message: createAssistantMessage({
          content: [{ type: 'text', text: 'noted' }],
          source: { provider: 'mock', model: 'mock-1' },
        }),
      })),
      event('turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ])
    // 真实 Markdown 记忆库 + 捕获 done 的 tasks 夹具。
    const store = new MarkdownMemoryStore(join(root, 'memory'))
    ctx.provide('memory', store)
    const settled: Array<unknown> = []
    const fakeTasks = {
      start(spec: { run(): { done: Promise<unknown> } }) {
        void spec.run().done.then(outcome => settled.push(outcome))
        return spec
      },
    } as unknown as TaskService
    ctx.provide('tasks', fakeTasks)
    apply(ctx, {
      enabled: true,
      extractor: 'heuristic',
      startDelayMs: 10,
      minIdleHours: 1,
      ledgerPath: join(root, 'ledger.json'),
      workspaceCwd: root,
    })
    /** 测试夹具：监听器只读 session.header.parentSession（见 index.ts 触发监听）。 */
    const fixtureAgent = { session: { header: { parentSession: undefined } } }
    type Emit = (name: 'agent/session-start', payload: { agent: unknown; source: string }) => void
    const emit = ctx.emit.bind(ctx) as unknown as Emit
    emit('agent/session-start', { agent: fixtureAgent, source: 'startup' })
    await vi.waitFor(() => { expect(settled).toHaveLength(1) }, { timeout: 10_000 })
    // 候选落库：R1 显式 remember 信号 → global scope 条目。
    const entries = await store.list({ scope: 'global' })
    expect(entries.some(entry => entry.text.includes('deploy uses pnpm'))).toBe(true)
    // 台账记 ok；二次触发零重复（终态跳过，store 条目数不变）。
    const ledger: LedgerFile = await loadLedger(join(root, 'ledger.json'))
    expect(ledger.sessions['seed-1']?.outcome).toBe('ok')
    settled.length = 0
    emit('agent/session-start', { agent: fixtureAgent, source: 'startup' })
    await vi.waitFor(() => { expect(settled).toHaveLength(1) }, { timeout: 10_000 })
    const after = await store.list({ scope: 'global' })
    expect(after.filter(entry => entry.text.includes('deploy uses pnpm'))).toHaveLength(1)
  })
})
