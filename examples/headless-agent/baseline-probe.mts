// 基线命中率测量（一次性）：真实模型 + 真实会话形态，20 轮固定任务序列。
// 命中率 = ΣcacheReadTokens / Σ(cacheReadTokens + inputTokens)
//   —— mapUsage 的 inputTokens 已扣除 cacheRead（translate.ts:57），分母取两者之和 = prompt_tokens。
// 用法：node --env-file=.env --import tsx/esm examples/headless-agent/baseline-probe.mts <run-label>
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import { codingHarness, waitForIdle, SYSTEM_PROMPT } from './tests/harness.ts'

const RUN = process.argv[2] ?? 'run'
const OUT = process.argv[3]

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
const agent = ctx.agentLoop.create(SessionId(`baseline-${RUN}`), {
  provider: 'deepseek-official',
  model: 'deepseek-v4-flash',
})

const rounds: Array<{ turn: number; input: number; cache: number; hitRate: number }> = []
let totalInput = 0
let totalCache = 0

for (let i = 0; i < TASKS.length; i++) {
  const before = agent.session.events.length
  agent.followup(createUserMessage({ content: [{ type: 'text', text: TASKS[i]! }], source: { kind: 'user' } }))
  await waitForIdle(ctx, agent)
  const newEvents = agent.session.events.slice(before)
  const { input, cache } = collectUsage(newEvents)
  totalInput += input
  totalCache += cache
  const hit = totalCache / (totalCache + totalInput)
  rounds.push({ turn: i + 1, input, cache, hitRate: Number(hit.toFixed(4)) })
  console.log(`turn=${i + 1} input=${input} cache=${cache} cumHit=${hit.toFixed(4)}`)
}

const overall = totalCache / (totalCache + totalInput)
const result = {
  run: RUN,
  turns: TASKS.length,
  totalInputTokens: totalInput,
  totalCacheReadTokens: totalCache,
  overallHitRate: Number(overall.toFixed(4)),
  rounds,
}
console.log(`=== BASELINE ${RUN} === hitRate=${result.overallHitRate} input=${totalInput} cache=${totalCache}`)
if (OUT !== undefined) {
  // 追加式记录：多次运行写入同一文件
  const existing = (() => { try { return JSON.parse(readFileSync(OUT, 'utf-8')) } catch { return [] } })()
  writeFileSync(OUT, JSON.stringify([...existing, result], null, 2))
  console.log(`written to ${OUT}`)
}

await ctx.fiber.dispose()
rmSync(workdir, { recursive: true, force: true })
