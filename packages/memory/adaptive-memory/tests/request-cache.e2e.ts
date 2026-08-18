/**
 * adaptive-memory 缓存纪律 e2e（真实 DeepSeek API，key-gated）——Agent Note
 * `.agents/notes/implemented/feature/2026-08-18-adaptive-memory-stm.md`
 * 验收臂 D/E：
 * - D：STM 刷新后的下一个请求，cacheReadTokens 仍覆盖刷新前前缀（不得跌向
 *   零——区分正常增量 prefill 与错误的全历史重写）。memory/cache-miss 事件
 *   证明刷新确实发生，usage 证明前缀缓存仍然命中。
 * - E：memory_search 工具调用后的下一个请求继续命中前缀缓存（工具结果只在
 *   会话尾部追加，永不使前缀失效）。
 * cacheReadTokens 只有真实 provider 上报（prompt_cache_hit_tokens），mock
 * 适配器无法替代，故 D/E 在本文件而非单测；无 DEEPSEEK_API_KEY 时整组跳过
 * （CI 同例，见 docs/testing.md）。末尾的 keyless 冒烟用 ScriptedAdapter
 * 验证同一组合的接线（插件挂载、门控事件、memory_search 注册），使 D/E 的
 * harness 在无 key 环境也有可执行覆盖。
 *
 * @module @huiliyi37/dsh-adaptive-memory/tests/request-cache
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import { LlmAdapter, createUserMessage } from '@huiliyi37/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@huiliyi37/dsh-llm'
import { SessionId } from '@huiliyi37/dsh-session'
import type { Agent } from '@huiliyi37/dsh-agent'
import AgentLoop from '@huiliyi37/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@huiliyi37/dsh-agent-loop-testkit'
import { MarkdownMemoryStore } from '@huiliyi37/dsh-memory'
import * as LlmDeepSeek from '@huiliyi37/dsh-llm-deepseek'
import * as ToolMemory from '@huiliyi37/dsh-tool-memory'
import * as adaptiveMemory from '../src/index.ts'
import type { StmRefreshReason } from '../src/types.ts'

/**
 * D 臂 persona：让模型直接作答、不调用工具，使每轮恰为一个请求、用量序列
 * 只反映 STM 快照的追加成本。真实模型不保证服从，断言按轮取首/末请求而非
 * 固定步数，对多步轮次保持稳健。
 */
const D_SYSTEM = 'You are a terse assistant in an automated cache test. A project '
  + 'memory snapshot may appear as runtime context. Answer every question in one '
  + 'short sentence using that context. Never call any tool.'

/** E 臂 persona：强制先 memory_search 再作答，产出“工具调用 → 后续请求”序列。 */
const E_SYSTEM = 'You are a terse assistant in an automated cache test. When the '
  + 'user asks about a project fact, call the memory_search tool first, wait for '
  + 'its result, then answer in one short sentence that repeats the found value '
  + 'verbatim. Never call memory_save. Do not use markdown.'

let ctx: Context | undefined
let dir: string | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  if (dir !== undefined) await rm(dir, { recursive: true, force: true })
  dir = undefined
})

interface Harness {
  store: MarkdownMemoryStore
}

/** 挂载 D/E 共用的完整组合：真实 loop + memory 服务 + 两个记忆插件。 */
async function memoryHarness(persona: string, adapter?: LlmAdapter): Promise<Harness> {
  dir = await mkdtemp(join(tmpdir(), 'dsh-adaptive-memory-e2e-'))
  const store = new MarkdownMemoryStore(join(dir, '.dsh/memory'))
  const created = new Context()
  await mountAgentLoopTestDependencies(created, { systemPrompt: { persona } })
  await created.plugin(AgentLoop, { agents: [] })
  if (adapter === undefined) await created.plugin(LlmDeepSeek)
  else created.llm.registerAdapter(['mock'], adapter)
  created.provide('memory', store)
  await created.plugin(ToolMemory)
  await created.plugin(adaptiveMemory, {})
  ctx = created
  return { store }
}

function waitForIdle(context: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = context.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}

function send(agent: Agent, text: string): void {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
}

interface Usage { inputTokens: number; cacheReadTokens?: number }

/** 一轮之内各请求的 usage（按事件下标切片，等同 baseline-probe 的观测面）。 */
function turnUsages(agent: Agent, from: number, to: number): Usage[] {
  return agent.session.events.slice(from, to)
    .flatMap(event => event.type === 'assistant/message' && event.data.usage !== undefined
      ? [event.data.usage]
      : [])
}

/** 一次请求的 prompt 总量（mapUsage 已从 inputTokens 扣除 cacheRead，故取和）。 */
function promptTotal(usage: Usage): number {
  return usage.inputTokens + (usage.cacheReadTokens ?? 0)
}

/** 历次 STM 刷新原因（memory/cache-miss，log-only）。 */
function missReasons(agent: Agent): StmRefreshReason[] {
  return agent.session.events.flatMap(event => event.type === 'memory/cache-miss' ? [event.data.reason] : [])
}

/**
 * 缓存覆盖断言：一次尾部追加（STM 快照 / 工具结果）之后的请求，其命中前缀
 * 应 ≈ 前一请求的完整 prompt（provider 缓存粒度 64 token，留 10% 余量）；
 * 若实现退化为改写前缀中部（全历史重写），命中量会跌向 system 段大小而失败。
 */
function expectPrefixCached(after: Usage, before: Usage): void {
  expect(after.cacheReadTokens ?? 0).toBeGreaterThanOrEqual(promptTotal(before) * 0.9)
}

describe.skipIf(!process.env.DEEPSEEK_API_KEY)('adaptive-memory cache discipline (real API)', () => {
  it('D: an STM refresh leaves the pre-refresh prefix cached on the next request', async () => {
    const { store } = await memoryHarness(D_SYSTEM)
    // 与首个 intent（login/auth）相关的条目，使 STM 快照非空。
    await store.save({
      text: 'login retry policy: exponential backoff in auth.ts, factor 2, at most 3 attempts',
      scope: 'global',
      tags: ['auth'],
      source: 'user',
    })
    const agent = ctx!.agentLoop.create(SessionId('cache-arm-d'), { provider: 'deepseek-official', model: 'deepseek-v4-flash' })

    // 轮 1：锚点消息尚未落日志，无 STM；建立初始前缀。
    let from = agent.session.events.length
    send(agent, 'Please fix the login retry logic in auth.ts.')
    await waitForIdle(ctx!, agent)
    const turn1 = turnUsages(agent, from, agent.session.events.length)

    // 轮 2：initial 刷新，STM 快照在尾部追加（本轮请求付出一次增量 prefill）。
    from = agent.session.events.length
    send(agent, 'What backoff factor does the retry policy use?')
    await waitForIdle(ctx!, agent)
    const turn2 = turnUsages(agent, from, agent.session.events.length)

    // 相关写入 ⇒ 下一轮门控判 topic-version，换发新快照（仍为尾部追加）。
    await store.save({
      text: 'login retry jitter: full jitter on top of the exponential backoff in auth.ts',
      scope: 'global',
      tags: ['auth'],
      source: 'agent',
    })
    from = agent.session.events.length
    send(agent, 'Does the policy mention jitter?')
    await waitForIdle(ctx!, agent)
    const turn3 = turnUsages(agent, from, agent.session.events.length)

    // 刷新确实按预期发生（initial → topic-version），断言才有意义。
    expect(missReasons(agent)).toEqual(['initial', 'topic-version'])
    expect(turn1.length).toBeGreaterThanOrEqual(1)
    expect(turn2.length).toBeGreaterThanOrEqual(1)
    expect(turn3.length).toBeGreaterThanOrEqual(1)

    // 首个请求无前缀可命中；之后每个请求都必须有命中（不跌向零）。
    const all = [...turn1, ...turn2, ...turn3]
    for (const usage of all.slice(1)) {
      expect(usage.cacheReadTokens ?? 0).toBeGreaterThan(0)
    }
    // D 的核心：两次 STM 追加之后的请求仍覆盖各自刷新前的前缀。
    expectPrefixCached(turn2[0]!, turn1.at(-1)!)
    expectPrefixCached(turn3[0]!, turn2.at(-1)!)
  }, 180_000)

  it('E: a memory_search tool result never invalidates the existing prefix', async () => {
    const { store } = await memoryHarness(E_SYSTEM)
    await store.save({
      text: 'the deploy color is azure-falcon-42',
      scope: 'global',
      tags: ['deploy'],
      source: 'user',
    })
    const agent = ctx!.agentLoop.create(SessionId('cache-arm-e'), { provider: 'deepseek-official', model: 'deepseek-v4-flash' })

    // 轮 1：persona 强制 memory_search ⇒ ≥2 步（工具请求 → 带工具结果的请求）。
    let from = agent.session.events.length
    send(agent, 'What is the deploy color?')
    await waitForIdle(ctx!, agent)
    const turn1 = turnUsages(agent, from, agent.session.events.length)

    // 轮 2：同一（更长）前缀上的追问。
    from = agent.session.events.length
    send(agent, 'Repeat that value one more time.')
    await waitForIdle(ctx!, agent)
    const turn2 = turnUsages(agent, from, agent.session.events.length)

    expect(turn1.length).toBeGreaterThanOrEqual(2)
    expect(turn2.length).toBeGreaterThanOrEqual(1)

    // E 的核心：工具结果请求仍覆盖工具调用前的前缀；追问同理。
    expectPrefixCached(turn1[1]!, turn1[0]!)
    expectPrefixCached(turn2[0]!, turn1.at(-1)!)

    // 世界验证：工具值穿过 loop 进入最终回答。
    const finalText = agent.session.deriveMessages().at(-1)!.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
    expect(finalText).toContain('azure-falcon-42')
  }, 180_000)
})

describe('adaptive-memory cache e2e harness (keyless wiring smoke)', () => {
  function textResponse(text: string): StreamChunk[] {
    return [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'block-end', index: 0, block: { type: 'text', text } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
  }

  class ScriptedAdapter extends LlmAdapter {
    readonly requests: GenerateOptions[] = []

    constructor(private readonly script: StreamChunk[][]) {
      super()
    }

    override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      this.requests.push(options)
      const chunks = this.script.shift()
      if (chunks === undefined) throw new Error('ScriptedAdapter: script exhausted')
      for (const chunk of chunks) yield chunk
    }
  }

  it('mounts memory + tool-memory + adaptive-memory and runs the STM gate', async () => {
    const adapter = new ScriptedAdapter([textResponse('one'), textResponse('two')])
    const { store } = await memoryHarness(D_SYSTEM, adapter)
    await store.save({
      text: 'login retry policy: exponential backoff in auth.ts',
      scope: 'global',
      tags: ['auth'],
      source: 'user',
    })
    // D/E harness 的接线面：memory_search 已注册、真实 loop 可创建 agent。
    expect(ctx!.tools.get('memory_search')).toBeDefined()
    expect(ctx!.tools.get('memory_save')).toBeDefined()
    const agent = ctx!.agentLoop.create(SessionId('cache-e2e-wiring'), { provider: 'mock', model: 'mock' })

    send(agent, 'Please fix the login retry logic in auth.ts.')
    await waitForIdle(ctx!, agent)
    send(agent, 'What backoff factor does it use?')
    await waitForIdle(ctx!, agent)

    expect(missReasons(agent)).toEqual(['initial'])
    expect(adapter.requests).toHaveLength(2)
  })
})
