// 基线命中率测量（一次性）：真实模型 + 真实会话形态，20 轮固定任务序列。
// 命中率 = ΣcacheReadTokens / Σ(cacheReadTokens + inputTokens)
//   —— mapUsage 的 inputTokens 已扣除 cacheRead（translate.ts:57），分母取两者之和 = prompt_tokens。
// 用法：node --env-file=.env --import tsx/esm examples/headless-agent/baseline-probe.mts <run-label> <out.json> [arm]
// arm（缺省 A）：
//   A 不挂 memory —— 参照臂（对照 docs/cache-hit-baseline-20260812.md 的 96.8%）。
//   B 挂 memory + tool-memory（digest: true）—— 量化动态摘要重写请求前缀的损失。
//   C 挂 memory + tool-memory + adaptive-memory —— STM 经 append-on-change 通道注入。
// B/C 在第 5/10/15 轮后程序化写入一条相关记忆：B 经 memory_save 工具触发 digest
// 刷新（重写 system 段 = B 要量化的损失）；C 直接写 store，下一轮换发 STM
// topic-version 快照（尾部一次追加的有界增量成本）。
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createUserMessage } from '@huiliyi37/dsh-llm'
import { CallId } from '@huiliyi37/dsh-llm/brand'
import type { SessionEvent } from '@huiliyi37/dsh-session'
import { SessionId } from '@huiliyi37/dsh-session'
import * as MemoryPlugin from '@huiliyi37/dsh-memory'
import type { MemoryService } from '@huiliyi37/dsh-memory'
import * as ToolMemory from '@huiliyi37/dsh-tool-memory'
import * as AdaptiveMemory from '@huiliyi37/dsh-adaptive-memory'
import { codingHarness, waitForIdle, SYSTEM_PROMPT } from './tests/harness.ts'

const RUN = process.argv[2] ?? 'run'
const OUT = process.argv[3]
const ARM = (process.argv[4] ?? 'A').toUpperCase()
if (!['A', 'B', 'C'].includes(ARM)) {
  throw new Error(`unknown arm ${JSON.stringify(ARM)} (expected A, B or C)`)
}
// 真实 API 探针：无 key 时按测试政策跳过（报 skipped，不产出数据、不算失败）。
if (process.env.DEEPSEEK_API_KEY === undefined) {
  console.log('skipped: DEEPSEEK_API_KEY not set (real-API probe; see docs/testing.md)')
  process.exit(0)
}

// 20 轮固定任务序列：读/写/查小操作，同一文件反复触碰（前缀缓存友好形态）
const TASKS: string[] = [
  'Read task.txt and report its contents.',
  'Use bash to run `ls -la` and report what you see.',
  'Read src/lib.ts and summarize its purpose.',
  'Use the bash tool with a heredoc to append `export function double(x) { return x * 2 }` to src/lib.ts.',
  'Read src/lib.ts again and report the last line.',
  'Use bash to check the byte size of src/lib.ts.',
  'Append a comment line `// baseline probe` to src/lib.ts with bash.',
  'Read task.txt and report the first line.',
  'Create notes.md containing the text "baseline probe run".',
  'Run `wc -l src/lib.ts notes.md` in bash and report.',
  'Read src/lib.ts and report how many lines it has.',
  'Use bash to append `export function triple(x) { return x * 3 }` to src/lib.ts.',
  'Read task.txt and report whether it mentions "baseline".',
  'Run `grep -n function src/lib.ts` in bash and report.',
  'Read notes.md and report its contents.',
  'Use bash to rename notes.md to notes2.md (mv).',
  'Read src/lib.ts and list every exported function name.',
  'Run `ls -la` in bash and report which files changed.',
  'Read task.txt and report its full contents again.',
  'Summarize in one sentence what files we worked with this session.',
]

interface RoundUsage { input: number; cache: number }

function collectUsage(events: SessionEvent[]): RoundUsage {
  let input = 0
  let cache = 0
  for (const event of events) {
    if (event.type !== 'assistant/message') continue
    const usage = event.data.usage
    if (usage === undefined) continue
    input += usage.inputTokens
    cache += usage.cacheReadTokens ?? 0
  }
  return { input, cache }
}

const workdir = mkdtempSync(join(tmpdir(), 'dsh-baseline-'))
writeFileSync(join(workdir, 'task.txt'), 'baseline probe task file\n')
mkdirSync(join(workdir, 'src'), { recursive: true })
writeFileSync(join(workdir, 'src', 'lib.ts'), 'export function identity(x) { return x }\n')

const ctx = await codingHarness(workdir, { persona: SYSTEM_PROMPT })

// B/C 臂挂载记忆插件（A 臂为参照，不挂任何 memory）。memory 服务经真实
// dsh-memory 插件提供（root=workdir，随会话结束一并清理）；tool-memory 的
// digest 开关是 B 臂的测量对象；C 臂挂 adaptive-memory（STM 快照）。
let memory: MemoryService | undefined
if (ARM !== 'A') {
  await ctx.plugin(MemoryPlugin, { root: workdir })
  memory = ctx.reflect.get(MemoryPlugin.MEMORY_KEY, false) as MemoryService | undefined
  if (memory === undefined) throw new Error('memory service unavailable after mounting dsh-memory')
  await ctx.plugin(ToolMemory, { digest: ARM === 'B' })
  if (ARM === 'C') await ctx.plugin(AdaptiveMemory, {})
  // 预置与任务序列相关的条目（围绕 task.txt / src/lib.ts），使 digest/STM 有实际内容。
  await memory.save({ text: 'baseline probe：task.txt 是本探测会话的任务文件', scope: 'global', tags: ['baseline'], source: 'user' })
  await memory.save({ text: 'src/lib.ts 只导出纯函数，不放副作用', scope: 'global', tags: ['baseline'], source: 'user' })
}

const agent = ctx.agentLoop.create(SessionId(`baseline-${RUN}`), {
  provider: 'deepseek-official',
  model: 'deepseek-v4-flash',
})

const rounds: Array<{ turn: number; input: number; cache: number; hitRate: number; stmRefreshes: string[] }> = []
let totalInput = 0
let totalCache = 0

// B/C 臂在这些轮次之后程序化写入一条相关记忆（见文件头注释）。
const WRITE_AFTER_TURNS = new Set([5, 10, 15])

for (let i = 0; i < TASKS.length; i++) {
  const before = agent.session.events.length
  agent.followup(createUserMessage({ content: [{ type: 'text', text: TASKS[i]! }], source: { kind: 'user' } }))
  await waitForIdle(ctx, agent)
  const newEvents = agent.session.events.slice(before)
  const { input, cache } = collectUsage(newEvents)
  totalInput += input
  totalCache += cache
  const hit = totalCache / (totalCache + totalInput)
  const stmRefreshes = newEvents.flatMap(event => event.type === 'memory/cache-miss' ? [event.data.reason] : [])
  rounds.push({ turn: i + 1, input, cache, hitRate: Number(hit.toFixed(4)), stmRefreshes })
  console.log(`turn=${i + 1} input=${input} cache=${cache} cumHit=${hit.toFixed(4)} stm=[${stmRefreshes.join(',')}]`)
  if (ARM !== 'A' && WRITE_AFTER_TURNS.has(i + 1)) {
    const text = `baseline probe 第 ${i + 1} 轮观察：task.txt 与 src/lib.ts 均被反复读取`
    if (ARM === 'B') {
      // 走 memory_save 工具以触发 digest 刷新；execute 内 fire-and-forget，等一拍让 section 文本落定。
      await ctx.tools.execute({
        callId: CallId(`probe-save-${i + 1}`),
        name: 'memory_save',
        arguments: { text, tags: ['baseline'] },
        signal: new AbortController().signal,
      })
      await new Promise(resolve => setTimeout(resolve, 200))
    } else {
      await memory!.save({ text, scope: 'global', tags: ['baseline'], source: 'agent' })
    }
  }
}

const overall = totalCache / (totalCache + totalInput)
const result = {
  run: RUN,
  arm: ARM,
  turns: TASKS.length,
  totalInputTokens: totalInput,
  totalCacheReadTokens: totalCache,
  overallHitRate: Number(overall.toFixed(4)),
  rounds,
}
console.log(`=== BASELINE ${RUN} (arm ${ARM}) === hitRate=${result.overallHitRate} input=${totalInput} cache=${totalCache}`)
if (OUT !== undefined) {
  // 追加式记录：多次运行写入同一文件
  const existing = (() => { try { return JSON.parse(readFileSync(OUT, 'utf-8')) } catch { return [] } })()
  writeFileSync(OUT, JSON.stringify([...existing, result], null, 2))
  console.log(`written to ${OUT}`)
}

await ctx.fiber.dispose()
rmSync(workdir, { recursive: true, force: true })
