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
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
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

/** 会话 1 任务 T：新建小模块 + 修种子 bug（确定性任务文本）。 */
export const TASK_ONE = [
  'Create src/format.ts with exactly this content:',
  'export function padLeft(s: string, width: number): string { return s.padEnd(width) } // BUG: should padStart',
  'export function shout(s: string): string { return s.toUpperCase() }',
  'Then run `node --experimental-strip-types -e "import(\'./src/format.ts\').then(m => console.log(m.padLeft(\'ab\', 5)))"`',
  '(or plain node with a dynamic import if strip-types is unavailable), notice the output is NOT padded on the left,',
  'fix the bug so padLeft actually left-pads, and re-run to verify the fix.',
].join(' ')

/** 会话 2 任务 T'：同一模块族（src/format.ts 风格的字符串工具），不同细节。 */
export const TASK_TWO = [
  'Create src/format-extra.ts in the same style as the existing string-formatting utilities:',
  'export function padRight(s: string, width: number): string that right-pads with spaces,',
  'and export function whisper(s: string): string that lowercases.',
  'Verify both with a quick node -e run and report the results.',
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
