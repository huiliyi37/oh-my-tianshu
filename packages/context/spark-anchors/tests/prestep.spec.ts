/**
 * spark-anchors 集成测试：真实装配（AgentRegistry + Session + agent/pre-step
 * waterfall），不 mock 中间层。覆盖：spark route 注入、字节稳定短路、
 * 非 spark 零注入、agentDefaultModel 兜底。
 * @module dsh-spark-anchors/tests/prestep
 */

import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@huiliyi37/cordis'
import { createMessage, createUserMessage, CallId } from '@huiliyi37/dsh-llm'
import { Session, SessionId } from '@huiliyi37/dsh-session'
import { agentEvents, Inbox } from '@huiliyi37/dsh-agent'
import type { Agent } from '@huiliyi37/dsh-agent'
import AgentDefaultModel from '@huiliyi37/dsh-agent-default-model'
import { mountAgentLoopTestDependencies } from '@huiliyi37/dsh-agent-loop-testkit'
import SettingsLocal from '@huiliyi37/dsh-settings-local'
import { installSettingsSection, settingsNamespace } from '@huiliyi37/dsh-settings'
import * as sparkAnchors from '@huiliyi37/dsh-spark-anchors'
import { Config as LlmDeepSeekConfig, SPARK_PROVIDER } from '@huiliyi37/dsh-llm-deepseek'

/** llm-deepseek 的 settings 命名空间（spark 配置同源点）。 */
const NS = settingsNamespace('llm-deepseek')

/** 400 字长推理 + 头部排除句（会被截断丢失）。 */
const TAIL = '字'.repeat(400)
const REASONING = 'A不是最优解。' + TAIL

function sessionAgent(session: Session, id = 'agent'): Agent {
  return {
    id: SessionId(id),
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'running',
    ctx: new Context(),
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => {},
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => { return Promise.resolve() },
  }
}

/** 装配 spark 历史的会话：request/header 标记 route + 一条含长推理的 assistant 消息。 */
function sparkSession(provider: string): Session {
  const session = Session.create(
    SessionId('s1'),
    [],
    { version: 0, id: SessionId('s1'), createdAt: 0, cwd: '/tmp' },
  )
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'turn 1' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('request/header', {
    header: { config: { provider, model: 'deepseek-v4-flash' } },
    reason: 'initial',
  })
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createMessage({
      role: 'assistant',
      content: [
        { type: 'tool-call', id: CallId('c1'), name: 'tool', arguments: '{}' },
        { type: 'reasoning', text: REASONING },
      ],
      source: { kind: 'model', provider: 'test', model: 'test' },
    }),
  }, { surfaceOp: 'append' })
  session.append('tool/result', {
    turn: 1,
    step: 1,
    message: createMessage({
      role: 'user',
      content: [{ type: 'tool-result', toolCallId: CallId('c1'), content: [{ type: 'text', text: 'ok' }] }],
      source: { kind: 'tool', callId: CallId('c1') },
    }),
  }, { surfaceOp: 'append' })
  return session
}

async function mount(options: { spark?: { enabled: boolean; truncateN?: { flash: number; pro: number } } } = {}) {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  // 装配真实 settings 服务并注册 llm-deepseek 命名空间（spark 配置同源点），
  // 使 readSparkPolicy 走 settings 分支而非回落默认——enabled 门控的可测面。
  const root = await mkdtemp(join(tmpdir(), 'spark-anchors-'))
  await ctx.plugin(SettingsLocal, { path: join(root, 'settings.yaml'), debounceMs: 10 })
  installSettingsSection(
    ctx,
    NS,
    LlmDeepSeekConfig,
    options.spark === undefined
      ? {}
      : { spark: { enabled: options.spark.enabled, truncateN: options.spark.truncateN ?? { flash: 300, pro: 0 } } },
    { setSource: () => {}, onChange: () => {} },
  )
  const fiber = await ctx.plugin(sparkAnchors)
  return {
    ctx,
    fiber,
    dispose: async () => {
      await fiber.dispose()
      await rm(root, { recursive: true, force: true })
    },
  }
}

async function fire(ctx: Context, agent: Agent, turn = 2, step = 1) {
  return await agentEvents(ctx, agent).waterfall(
    'agent/pre-step',
    { messages: [], turn, step, signal: new AbortController().signal },
    () => Promise.resolve({ kind: 'enter' as const, messages: [] }),
  )
}

describe('agent/pre-step spark 锚点注入', () => {
  it('spark route + spark.enabled：pre-step 注入排除路径锚点（含 source 标记）', async () => {
    const { ctx, dispose } = await mount({ spark: { enabled: true } })
    try {
      const agent = sessionAgent(sparkSession(SPARK_PROVIDER))
      const decision = await fire(ctx, agent)
      expect(decision.kind).toBe('enter')
      const injected = (decision as {
        messages: { content: { type: string; text: string }[]; source: { kind: string; plugin: string } }[]
      }).messages
      const own = injected.filter(m => m.source.kind === 'plugin' && m.source.plugin === 'spark-anchors')
      expect(own).toHaveLength(1)
      expect(own[0]!.content[0]!.text).toContain('A不是最优解')
    } finally {
      await dispose()
    }
  })

  it('字节稳定：锚点不变 → 第二次 pre-step 不重复注入', async () => {
    const { ctx, dispose } = await mount({ spark: { enabled: true } })
    try {
      const agent = sessionAgent(sparkSession(SPARK_PROVIDER))
      const first = await fire(ctx, agent)
      // 模拟注入落盘（waterfall 返回的 messages 由 loop 追加为 session 事件）
      for (const message of (first as { kind: 'enter'; messages: ReturnType<typeof createUserMessage>[] }).kind === 'enter'
        ? (first as { kind: 'enter'; messages: ReturnType<typeof createUserMessage>[] }).messages
        : []) {
        agent.session.append('user/message', message, { surfaceOp: 'append' })
      }
      const second = await fire(ctx, agent)
      const own = (second as { messages: { source: { plugin: string } }[] }).messages.filter(m => m.source.plugin === 'spark-anchors')
      expect(own).toHaveLength(0)
    } finally {
      await dispose()
    }
  })

  it('非 spark route：零注入', async () => {
    const { ctx, dispose } = await mount({ spark: { enabled: true } })
    try {
      const agent = sessionAgent(sparkSession('deepseek-official'))
      const decision = await fire(ctx, agent)
      const own = (decision as { messages: { source?: { plugin?: string } }[] }).messages.filter(m => m.source?.plugin === 'spark-anchors')
      expect(own).toHaveLength(0)
    } finally {
      await dispose()
    }
  })

  it('spark.enabled=false（settings 同源门控）：零注入', async () => {
    const { ctx, dispose } = await mount({ spark: { enabled: false } })
    try {
      const agent = sessionAgent(sparkSession(SPARK_PROVIDER))
      const decision = await fire(ctx, agent)
      const own = (decision as { messages: { source?: { plugin?: string } }[] }).messages.filter(m => m.source?.plugin === 'spark-anchors')
      expect(own).toHaveLength(0)
    } finally {
      await dispose()
    }
  })

  it('settings 已注册但无 spark 配置（缺省 enabled=false）：零注入', async () => {
    const { ctx, dispose } = await mount({})
    try {
      const agent = sessionAgent(sparkSession(SPARK_PROVIDER))
      const decision = await fire(ctx, agent)
      const own = (decision as { messages: { source?: { plugin?: string } }[] }).messages.filter(m => m.source?.plugin === 'spark-anchors')
      expect(own).toHaveLength(0)
    } finally {
      await dispose()
    }
  })

  it('无 request/header 时经 agentDefaultModel 兜底判定 spark route', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentDefaultModel, { provider: SPARK_PROVIDER, model: 'deepseek-v4-flash' })
    const root = await mkdtemp(join(tmpdir(), 'spark-anchors-'))
    await ctx.plugin(SettingsLocal, { path: join(root, 'settings.yaml'), debounceMs: 10 })
    installSettingsSection(
      ctx,
      NS,
      LlmDeepSeekConfig,
      { spark: { enabled: true, truncateN: { flash: 300, pro: 0 } } },
      { setSource: () => {}, onChange: () => {} },
    )
    const fiber = await ctx.plugin(sparkAnchors)
    try {
      // 会话无 request/header（新会话首步）
      const session = Session.create(
        SessionId('s1'),
        [],
        { version: 0, id: SessionId('s1'), createdAt: 0, cwd: '/tmp' },
      )
      session.append('turn/start', { turn: 1 })
      session.append('user/message', createUserMessage({
        content: [{ type: 'text', text: 'hi' }],
        source: { kind: 'user' },
      }), { surfaceOp: 'append' })
      // 上一条用户消息后的 assistant 推理在 header 前？不——header 由 loop 写入；这里模拟已有一轮推理（无 header 的极简场景）
      session.append('assistant/message', {
        turn: 1,
        step: 1,
        message: createMessage({
          role: 'assistant',
          content: [
            { type: 'tool-call', id: CallId('c1'), name: 'tool', arguments: '{}' },
            { type: 'reasoning', text: REASONING },
          ],
          source: { kind: 'model', provider: 'test', model: 'test' },
        }),
      }, { surfaceOp: 'append' })
      const agent = sessionAgent(session)
      const decision = await fire(ctx, agent)
      const own = (decision as { messages: { source?: { plugin?: string } }[] }).messages.filter(m => m.source?.plugin === 'spark-anchors')
      expect(own).toHaveLength(1)
    } finally {
      await fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})
