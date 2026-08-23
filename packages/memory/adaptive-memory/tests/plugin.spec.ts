/**
 * adaptive-memory apply：缺省/显式 Config、fail loud、assemble 边角与门控阀门。
 *
 * @module @huiliyi37/dsh-adaptive-memory/tests/plugin
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import { CallId, createUserMessage } from '@huiliyi37/dsh-llm'
import { Session, SessionId } from '@huiliyi37/dsh-session'
import { Inbox } from '@huiliyi37/dsh-agent'
import type { Agent } from '@huiliyi37/dsh-agent'
import { mountAgentLoopTestDependencies } from '@huiliyi37/dsh-agent-loop-testkit'
import { MarkdownMemoryStore } from '@huiliyi37/dsh-memory'
import type { ToolExecution, ToolExecutionToken } from '@huiliyi37/dsh-tools'
import { apply, Config, name } from '../src/index.ts'
import type { StmRefreshReason } from '../src/types.ts'

const SIGNAL = new AbortController().signal

/** 补全 tools/result 监听器所需的完整 ToolExecution（token/rootCallId 为占位值）。 */
function stubToolExecution(input: Omit<ToolExecution, 'token' | 'rootCallId'>): ToolExecution {
  return {
    ...input,
    rootCallId: input.callId,
    token: Symbol('adaptive-memory-test-execution') as ToolExecutionToken,
  }
}

let dir: string | undefined

afterEach(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true })
  dir = undefined
})

/** 全字段显式 Config（覆盖 resolveConfig 的 `??` 右侧）。 */
const EXPLICIT = {
  stmTokenBudget: 600,
  maxEntries: 12,
  maxIntentTokens: 6,
  maxEntities: 24,
  reviewIntervalTurns: 1,
  goalVerbs: [
    'fix', 'implement', 'add', 'create', 'refactor', 'debug', 'investigate',
    'migrate', 'remove', 'update', 'write', 'build',
    '修复', '实现', '排查', '重构', '新增',
  ],
  alwaysIncludeTags: ['safety', 'constraint', 'preference'],
  summaryMaxChars: 120,
  maxKeywords: 5,
  confidenceHigh: 0.82,
  confidenceMedium: 0.55,
  retrievalLimit: 24,
  topicBoosts: { procedure: 0.2 },
  maxRemindersPerTurn: 1,
  maxRemindersPerIntent: 3,
} satisfies Config

async function harness(config: Parameters<typeof apply>[1] = EXPLICIT): Promise<{
  ctx: Context
  store: MarkdownMemoryStore
}> {
  dir = await mkdtemp(join(tmpdir(), 'dsh-adaptive-memory-plugin-'))
  const store = new MarkdownMemoryStore(join(dir, '.dsh/memory'))
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  apply(ctx, config)
  ctx.provide('memory', store)
  ctx.tools.register({
    name: 'probe',
    description: '探测工具',
    parameters: { path: { type: 'string' } },
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
    },
    async execute(args: { path?: string }) {
      return args.path ?? 'ok'
    },
  })
  return { ctx, store }
}

function sessionAgent(session: Session, ctx: Context): Agent {
  return {
    id: SessionId('agent'),
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'running',
    ctx,
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => { throw new Error('not used') },
    cancel() {},
    runMaintenance: task => task(SIGNAL),
    whenIdle: () => Promise.resolve(),
  }
}

function seed(id: string, text = 'fix the login bug'): Session {
  const session = Session.create(SessionId(id))
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  return session
}

function missReasons(session: Session): StmRefreshReason[] {
  return session.events.flatMap(event => event.type === 'memory/cache-miss' ? [event.data.reason] : [])
}

describe('adaptive-memory plugin apply', { timeout: 20_000 }, () => {
  it('named export 与 Config schema 存在', () => {
    expect(name).toBe('adaptive-memory')
    expect(Config).toBeDefined()
  })

  it('阈值倒挂与非法 topicBoosts fail loud', () => {
    const ctx = new Context()
    expect(() => { apply(ctx, { confidenceHigh: 0.1, confidenceMedium: 0.9 }) })
      .toThrow(/不得低于/)
    expect(() => { apply(ctx, { topicBoosts: { procedure: 1.2 } }) })
      .toThrow(/必须是 0\.\.1/)
    expect(() => { apply(ctx, { topicBoosts: { procedure: Number.NaN } }) })
      .toThrow(/必须是 0\.\.1/)
    expect(() => { apply(ctx, { topicBoosts: { procedure: -0.1 } }) })
      .toThrow(/必须是 0\.\.1/)
  })

  it('assemble 无用户消息：不评估', async () => {
    const { ctx } = await harness({})
    const session = Session.create(SessionId('no-user'))
    const agent = sessionAgent(session, ctx)
    await ctx.systemPrompt.assemble({ agent })
    expect(missReasons(session)).toEqual([])
  })

  it('assemble 无 agent：瀑布原样返回', async () => {
    const { ctx } = await harness()
    const assembly = await ctx.systemPrompt.assemble({})
    expect(assembly.contexts.some(item => item.name === 'memory:stm')).toBe(true)
  })

  it('无 turn/start 时 currentTurn 回落 1；同轮二次 assemble 去重', async () => {
    const { ctx, store } = await harness()
    await store.save({ text: 'login retry in src/auth/login.ts', scope: 'global', tags: ['auth'], source: 'user' })
    const session = Session.create(SessionId('no-turn'))
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'fix login' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    const agent = sessionAgent(session, ctx)
    await ctx.systemPrompt.assemble({ agent })
    await ctx.systemPrompt.assemble({ agent })
    expect(missReasons(session).filter(reason => reason === 'initial')).toHaveLength(1)
  })

  it('pressure-turns：reviewIntervalTurns=1 时下一轮强制刷新', async () => {
    const { ctx, store } = await harness()
    await store.save({ text: 'login retry policy', scope: 'global', tags: ['auth'], source: 'user' })
    const session = seed('pressure')
    const agent = sessionAgent(session, ctx)
    await ctx.systemPrompt.assemble({ agent })
    session.append('turn/start', { turn: 2 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'thanks' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    await ctx.systemPrompt.assemble({ agent })
    expect(missReasons(session)).toEqual(['initial', 'pressure-turns'])
  })

  it('new-entity：工具路径进入实体快照后刷新', async () => {
    const { ctx, store } = await harness({ ...EXPLICIT, reviewIntervalTurns: 99 })
    await store.save({ text: 'login retry policy', scope: 'global', tags: ['auth'], source: 'user' })
    const session = seed('new-entity')
    const agent = sessionAgent(session, ctx)
    await ctx.systemPrompt.assemble({ agent })
    session.append('turn/start', { turn: 2 })
    session.append('tool/call', {
      turn: 2, step: 1, callId: CallId('c1'), name: 'probe',
      arguments: '{"path":"src/auth/login.ts"}',
    })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'continue' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    await ctx.systemPrompt.assemble({ agent })
    expect(missReasons(session)).toContain('new-entity')
  })

  it('intent 切换清掉旧提醒预算', async () => {
    const { ctx, store } = await harness({ ...EXPLICIT, reviewIntervalTurns: 99 })
    await store.save({ text: 'login retry policy', scope: 'global', tags: ['auth'], source: 'user' })
    const session = seed('intent-clear')
    const agent = sessionAgent(session, ctx)
    await ctx.systemPrompt.assemble({ agent })
    await ctx.tools.execute({
      signal: SIGNAL, callId: CallId('c1'), name: 'probe',
      arguments: { path: 'src/secret/vault.ts' }, agent,
    })
    session.append('turn/start', { turn: 2 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'refactor the payment module' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    await ctx.systemPrompt.assemble({ agent })
    expect(missReasons(session)).toEqual(['initial', 'intent-change'])
  })

  it('intentKey general：短词锚点不带 intent token', async () => {
    const { ctx } = await harness({ ...EXPLICIT, reviewIntervalTurns: 99 })
    const session = seed('general', 'ok')
    const agent = sessionAgent(session, ctx)
    await ctx.systemPrompt.assemble({ agent })
    expect(missReasons(session)).toEqual(['initial'])
  })

  it('已覆盖路径不触发提醒；isError 走 error.info.code', async () => {
    const { ctx, store } = await harness()
    await store.save({
      text: 'src/secret/vault.ts is the secrets file',
      scope: 'global',
      tags: ['auth'],
      source: 'user',
    })
    const session = seed('covered')
    const agent = sessionAgent(session, ctx)
    await ctx.systemPrompt.assemble({ agent })
    await ctx.tools.execute({
      signal: SIGNAL, callId: CallId('c-covered'), name: 'probe',
      arguments: { path: 'src/secret/vault.ts' }, agent,
    })
    expect(session.events.some(event => event.type === 'memory/reminder')).toBe(false)
    ctx.emit('tools/result', stubToolExecution({
      callId: CallId('c-error-code'), name: 'probe', arguments: {}, agent, signal: SIGNAL,
    }), {
      isError: true,
      error: { message: 'denied', info: { name: 'IoError', code: 'EACCES' } },
      content: [{ type: 'image', dataUrl: 'data:image/png;base64,xx' }],
    })
    expect(session.events.some(event =>
      event.type === 'memory/reminder' && event.data.kind === 'error-code')).toBe(true)
  })

  it('评估前的 tools/result：pre-intent 提醒；isError 无 info.code', async () => {
    const { ctx } = await harness()
    const session = seed('pre-intent')
    const agent = sessionAgent(session, ctx)
    await ctx.tools.execute({
      signal: SIGNAL, callId: CallId('c-pre'), name: 'probe',
      arguments: { path: 'src/new/file.ts' }, agent,
    })
    expect(session.events.some(event =>
      event.type === 'memory/reminder' && event.data.intentId === 'pre-intent')).toBe(true)
    ctx.emit('tools/result', stubToolExecution({
      callId: CallId('c-error-no-code'), name: 'probe', arguments: {}, agent, signal: SIGNAL,
    }), {
      isError: true,
      error: { message: 'denied' },
      content: [{ type: 'text', text: 'ok' }],
    })
  })

  it('tools/result 无 agent 时忽略', async () => {
    const { ctx } = await harness()
    ctx.emit('tools/result', stubToolExecution({
      callId: CallId('c-no-agent'), name: 'probe', arguments: { path: 'x' }, signal: SIGNAL,
    }), {
      isError: false,
      value: 'ok',
      content: [{ type: 'text', text: 'ok' }],
    })
  })

  it('缺省 Config：同 intent 次轮 assemble 记 cache-hit', async () => {
    const { ctx, store } = await harness({})
    await store.save({ text: 'login retry policy', scope: 'global', tags: ['auth'], source: 'user' })
    const session = seed('cache-hit')
    const agent = sessionAgent(session, ctx)
    await ctx.systemPrompt.assemble({ agent })
    session.append('turn/start', { turn: 2 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'thanks' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    await ctx.systemPrompt.assemble({ agent })
    expect(session.events.some(event => event.type === 'memory/cache-hit')).toBe(true)
  })
})
