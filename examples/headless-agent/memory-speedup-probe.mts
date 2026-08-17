// 记忆提速探针（真实 API 实验）：同一临时工作区里跑两个相似的小编码任务，
// 对比「全记忆栈」（mem）与「无记忆」（nomem）两臂在第二个任务上的成本。
//   会话 1 做任务 T（新建小模块 + 修一个种子 bug）→ dispose 触发巩固
//   （memory-consolidate，extractor: 'llm'：会话摘要 + 候选 + 做法条目入 LTM）；
//   会话 2 做同族任务 T'（同一模块族、不同细节），观察 STM/检索是否复用上
//   会话 1 的沉淀。
// 用法：node --env-file=.env --import tsx/esm examples/headless-agent/memory-speedup-probe.mts <run-label> <out.json> [arm]
// arm（缺省 mem）：
//   mem   memory-sqlite + tool-memory + adaptive-memory + memory-consolidate(llm)
//   nomem 不挂任何 memory 插件（参照臂）
// 每臂报告：turns、input+cacheRead+output tokens、wall time、会话 2 的 STM 刷新
// 与 memory_* 工具调用。无 DEEPSEEK_API_KEY 时打印 skipped 并以 0 退出（同
// baseline-probe 的 keyless 约定）。任务刻意小（各 3–6 轮）以控制成本。
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { createUserMessage } from '@huiliyi37/dsh-llm'
import type { SessionEvent } from '@huiliyi37/dsh-session'
import { SessionId } from '@huiliyi37/dsh-session'
import type { Context } from '@huiliyi37/cordis'
import type { MemoryService } from '@huiliyi37/dsh-memory'
import * as MemorySqlite from '@huiliyi37/dsh-memory-sqlite'
import * as ToolMemory from '@huiliyi37/dsh-tool-memory'
import * as AdaptiveMemory from '@huiliyi37/dsh-adaptive-memory'
import * as MemoryConsolidate from '@huiliyi37/dsh-memory-consolidate'
import { codingHarness, waitForIdle, SYSTEM_PROMPT } from './tests/harness.ts'

/** 探针臂：mem = 全记忆栈；nomem = 无记忆插件。 */
export type ProbeArm = 'mem' | 'nomem'

/**
 * 硬任务对的种子工作区：一个带「隐藏约定」的命令注册表项目。
 * 约定只能从现有样例（ping.ts）里读出来：新命令必须用 defineCommand、
 * 必须 registry.push、文件必须在 src/commands/ 下，否则 check.mjs 失败。
 * 会话 2 没有会话 1 的知识就必须重新发现这套约定——这是记忆提速的测点。
 */
export function seedWorkspace(workdir: string): void {
  const files: Record<string, string> = {
    // type:module 决定 .ts 按 ESM 解析（缺省 CJS 会让 named import 全部失败）。
    'package.json': '{ "type": "module" }\n',
    'src/contract.ts': [
      'export interface Command { name: string; run: () => string }',
      'export function defineCommand(c: Command): Command {',
      "  if (!c.name || typeof c.run !== 'function') throw new Error('CONTRACT_VIOLATION')",
      '  return c',
      '}',
      '',
    ].join('\n'),
    'src/registry.ts': [
      "import type { Command } from './contract.ts'",
      'export const registry: Command[] = []',
      '',
    ].join('\n'),
    'src/commands/ping.ts': [
      "import { defineCommand } from '../contract.ts'",
      "import { registry } from '../registry.ts'",
      "export const ping = defineCommand({ name: 'ping', run: () => 'pong' })",
      'registry.push(ping)',
      '',
    ].join('\n'),
    'check.mjs': [
      '// 项目自检：src/commands/ 下每个模块都必须导出一个经 defineCommand 定义、',
      '// 且已 push 进 registry 的命令。输出仅供人读；退出码 0/1 是机器信号。',
      "import { readdirSync } from 'node:fs'",
      "import { registry } from './src/registry.ts'",
      "const files = readdirSync('src/commands').filter(f => f.endsWith('.ts'))",
      'let failed = false',
      'for (const f of files) {',
      "  const mod = await import('./src/commands/' + f)",
      '  for (const value of Object.values(mod)) {',
      "    if (value && typeof value === 'object' && 'name' in value && !registry.includes(value)) {",
      "      console.error('UNREGISTERED_COMMAND', f)",
      '      failed = true',
      '    }',
      '  }',
      '}',
      "console.log(failed ? 'CHECK FAILED' : `CHECK OK (${registry.length} commands)`)",
      'process.exit(failed ? 1 : 0)',
      '',
    ].join('\n'),
  }
  for (const [rel, content] of Object.entries(files)) {
    const path = join(workdir, rel)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
  }
}

/** 会话 1 任务 T：在带隐藏约定的项目里加一个 time 命令（须发现约定才能过检）。 */
export const TASK_ONE = [
  'This workspace is a small command-registry project. Add a `time` command that returns the current time',
  'as an ISO string, following the project conventions. Then run `node check.mjs` and make it pass.',
  'If the check fails, read the project files to figure out why and fix it.',
].join(' ')

/** 会话 2 任务 T'：同族任务（加一个 uuid 命令）——有会话 1 的约定知识就该直接写对。 */
export const TASK_TWO = [
  'Add a `uuid` command to this same project that returns a random UUID (crypto.randomUUID()).',
  'Run `node check.mjs` and make it pass.',
].join(' ')

/** 解析臂参数（无效臂 fail loud；供无 key 单测覆盖参数形状）。 */
export function parseArm(raw: string | undefined): ProbeArm {
  const arm = (raw ?? 'mem').toLowerCase()
  if (arm !== 'mem' && arm !== 'nomem') {
    throw new Error(`unknown arm ${JSON.stringify(raw)} (expected mem or nomem)`)
  }
  return arm
}

/** 一个会话的成本与记忆活动报告。 */
export interface SessionReport {
  /** 会话 id。 */
  sessionId: string
  /** 完成轮数（turn/end 计数）。 */
  turns: number
  /** 未命中缓存的输入 token 合计。 */
  inputTokens: number
  /** 缓存命中的输入 token 合计。 */
  cacheReadTokens: number
  /** 输出 token 合计。 */
  outputTokens: number
  /** 端到端墙钟毫秒。 */
  wallMs: number
  /** STM 刷新原因序列（memory/cache-miss，log-only；无记忆臂恒为空）。 */
  stmRefreshes: string[]
  /** memory_* 工具调用名序列（模型主动检索行为；无记忆臂恒为空）。 */
  memoryToolCalls: string[]
}

/** 一份探针报告（一臂两个会话 + 巩固落地标记）。 */
export interface ProbeReport {
  /** 运行标签。 */
  run: string
  /** 臂。 */
  arm: ProbeArm
  /** mem 臂：会话 1 的巩固是否产出了 session-summary 条目（nomem 臂为 null）。 */
  consolidatedSummary: boolean | null
  /** 两个会话的报告（顺序：会话 1、会话 2）。 */
  sessions: SessionReport[]
}

/** 从事件日志折算一个会话的报告（纯函数；无 key 单测覆盖形状）。 */
export function collectSessionReport(sessionId: string, events: readonly SessionEvent[], wallMs: number): SessionReport {
  let inputTokens = 0
  let cacheReadTokens = 0
  let outputTokens = 0
  const stmRefreshes: string[] = []
  const memoryToolCalls: string[] = []
  for (const event of events) {
    if (event.type === 'assistant/message' && event.data.usage !== undefined) {
      inputTokens += event.data.usage.inputTokens
      cacheReadTokens += event.data.usage.cacheReadTokens ?? 0
      outputTokens += event.data.usage.outputTokens
    } else if (event.type === 'memory/cache-miss') {
      stmRefreshes.push(event.data.reason)
    } else if (event.type === 'tool/call' && event.data.name.startsWith('memory_')) {
      memoryToolCalls.push(event.data.name)
    }
  }
  return {
    sessionId,
    turns: events.filter(event => event.type === 'turn/end').length,
    inputTokens,
    cacheReadTokens,
    outputTokens,
    wallMs,
    stmRefreshes,
    memoryToolCalls,
  }
}

/** 跑一个单消息会话并折算报告（dispose 触发 session/disposed → 巩固）。 */
async function runSession(ctx: Context, id: string, task: string): Promise<SessionReport> {
  const handle = await ctx.agents.create({
    sessionId: SessionId(id),
    agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  })
  const start = Date.now()
  handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: task }], source: { kind: 'user' } }))
  await waitForIdle(ctx, handle.agent)
  const events = [...handle.agent.session.events]
  const wallMs = Date.now() - start
  await handle.dispose()
  return collectSessionReport(id, events, wallMs)
}

/** 等会话 1 的巩固落地（session-summary 条目出现；巩固是 fire-and-forget，轮询有界等待）。 */
async function waitForConsolidation(memory: MemoryService, timeoutMs: number): Promise<boolean> {
  const deadlineAt = Date.now() + timeoutMs
  while (Date.now() < deadlineAt) {
    const entries = await memory.list({ scope: 'global' })
    if (entries.some(entry => entry.tags.includes('session-summary'))) return true
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  return false
}

async function main(): Promise<void> {
  const run = process.argv[2] ?? 'run'
  const out = process.argv[3]
  const arm = parseArm(process.argv[4])
  // 真实 API 探针：无 key 时按测试政策跳过（报 skipped，不产出数据、不算失败）。
  if (process.env.DEEPSEEK_API_KEY === undefined) {
    console.log('skipped: DEEPSEEK_API_KEY not set (real-API probe; see docs/testing.md)')
    process.exit(0)
  }

  const workdir = mkdtempSync(join(tmpdir(), 'dsh-memory-speedup-'))
  seedWorkspace(workdir)
  const ctx = await codingHarness(workdir, { persona: SYSTEM_PROMPT })
  // mem 臂：全记忆栈。adaptive-memory 的门阈值在此刻意放宽（confidenceMedium: 0
  // 让小语料的 BM25 低分也进索引行；topicBoosts 抬升 procedure 做法条目进
  // 全文层）——缺省阈值是占位待调参项（见 adaptive-memory README）。
  let memory: MemoryService | undefined
  if (arm === 'mem') {
    await ctx.plugin(MemorySqlite, { root: workdir })
    memory = ctx.reflect.get('memory', false) as MemoryService | undefined
    if (memory === undefined) throw new Error('memory service unavailable after mounting dsh-memory-sqlite')
    await ctx.plugin(ToolMemory, {})
    await ctx.plugin(AdaptiveMemory, { confidenceHigh: 0.4, confidenceMedium: 0, topicBoosts: { procedure: 0.5 } })
    await ctx.plugin(MemoryConsolidate, { extractor: 'llm' })
  }

  const session1 = await runSession(ctx, `speedup-${run}-s1`, TASK_ONE)
  // 会话 1 dispose 触发巩固（LLM 提取：摘要 + 候选 + 做法）；mem 臂等其落地再开会话 2。
  const consolidatedSummary = arm === 'mem' ? await waitForConsolidation(memory!, 60_000) : null
  const session2 = await runSession(ctx, `speedup-${run}-s2`, TASK_TWO)

  const report: ProbeReport = { run, arm, consolidatedSummary, sessions: [session1, session2] }
  const fmt = (s: SessionReport): string =>
    `turns=${s.turns} input=${s.inputTokens} cacheRead=${s.cacheReadTokens} output=${s.outputTokens}`
    + ` wall=${s.wallMs}ms stm=[${s.stmRefreshes.join(',')}] memoryTools=[${s.memoryToolCalls.join(',')}]`
  console.log(`=== SPEEDUP ${run} (arm ${arm}) === consolidated=${String(consolidatedSummary)}`)
  console.log(`  session1: ${fmt(session1)}`)
  console.log(`  session2: ${fmt(session2)}`)
  if (out !== undefined) {
    // 追加式记录：多次运行写入同一文件
    const existing = (() => {
      try { return JSON.parse(readFileSync(out, 'utf-8')) as unknown[] } catch { return [] }
    })()
    writeFileSync(out, JSON.stringify([...existing, report], null, 2))
    console.log(`written to ${out}`)
  }

  await ctx.fiber.dispose()
  rmSync(workdir, { recursive: true, force: true })
}

// 仅直接执行时跑 main（测试 import 本文件只取纯函数/常量，不触发真实 API 调用）。
if (basename(process.argv[1] ?? '') === 'memory-speedup-probe.mts') {
  await main()
}
