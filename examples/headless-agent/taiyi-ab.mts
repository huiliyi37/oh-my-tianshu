// 太一 A/B 复现：真实模型 + 真实 bash/todo 工具，同一任务集跑两组 persona，
// 判据为客观可复现的「测试通过 + 测试文件未被改动」。对照组 = 标准 coding
// persona，实验组 = 上游太一词（从 apps/cli/config/agent-presets/taiyi 单轨读取）。
//
// 用法（需 DEEPSEEK_API_KEY）：
//   node --import tsx/esm examples/headless-agent/taiyi-ab.mts
//
// 产出：examples/headless-agent/taiyi-ab/ 下每轮 transcript JSONL + summary.json。
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { load } from 'js-yaml'
import { fileURLToPath } from 'node:url'
import { createUserMessage } from '@huiliyi37/dsh-llm'
import type { SessionEvent } from '@huiliyi37/dsh-session'
import { SessionId } from '@huiliyi37/dsh-session'
import { codingHarness, waitForIdle, SYSTEM_PROMPT } from './tests/harness.ts'

const ROOT = resolve(fileURLToPath(import.meta.url), '../../..')
const OUT = resolve(fileURLToPath(import.meta.url), '../taiyi-ab')

const MODEL = { provider: 'deepseek-official', model: 'deepseek-v4-flash' } as const

/** 从 taiyi preset 单轨读取太一词全文，避免在跑法里复刻一份。 */
function taiyiWord(): string {
  const file = resolve(ROOT, 'apps/cli/config/agent-presets/taiyi/agent.cordis.yml')
  const rows = load(readFileSync(file, 'utf8')) as Array<{ name?: string; config?: Record<string, unknown> }>
  const persona = rows.find(row => row.name === '@huiliyi37/dsh-persona')
  if (persona === undefined) throw new Error('taiyi preset has no persona row')
  const text = persona.config?.text
  if (typeof text !== 'string') throw new Error('taiyi persona text is not a string')
  return text
}

const TEST_FILE = [
  "const assert = require('node:assert');",
  "const { add } = require('./add.js');",
  'assert.strictEqual(add(2, 3), 5);',
  'assert.strictEqual(add(-1, 1), 0);',
  "console.log('PASS');",
  '',
].join('\n')

const BUGGY_ADD = [
  '// A tiny module with an obvious bug.',
  'function add(a, b) {',
  '  return a - b;',
  '}',
  'module.exports = { add };',
  '',
].join('\n')

const MATH_TEST = [
  "const assert = require('node:assert');",
  "const { double, triple } = require('./src/math.js');",
  'assert.strictEqual(double(3), 6);',
  'assert.strictEqual(triple(3), 9);',
  "console.log('PASS');",
  '',
].join('\n')

const MATH_SRC = [
  '// A module with `double` implemented and `triple` left out.',
  'function double(x) {',
  '  return x * 2;',
  '}',
  '// `triple` is expected by math.test.js but missing.',
  'module.exports = { double };',
  '',
].join('\n')

interface Task {
  name: string
  setup: (workdir: string) => void
  prompt: string
  /** Run after the agent: objective pass/fail + a one-line reason. */
  verify: (workdir: string) => { pass: boolean; detail: string }
}

const TASKS: Task[] = [
  {
    name: 'fix-add',
    setup: (w) => {
      writeFileSync(join(w, 'add.js'), BUGGY_ADD)
      writeFileSync(join(w, 'add.test.js'), TEST_FILE)
    },
    prompt: 'In the current directory, `node add.test.js` fails because add.js has a bug. '
      + 'Fix add.js so the test passes, run `node add.test.js` to verify, and report the result. '
      + 'Do not modify add.test.js.',
    verify: (w) => {
      const untouched = readFileSync(join(w, 'add.test.js'), 'utf8') === TEST_FILE
      const r = spawnSync('node', ['add.test.js'], { cwd: w, encoding: 'utf8' })
      return {
        pass: untouched && r.status === 0 && r.stdout.includes('PASS'),
        detail: untouched
          ? (r.status === 0 ? `test passed (${r.stdout.trim()})` : `test failed: ${r.stderr.trim() || r.stdout.trim()}`)
          : 'add.test.js was modified',
      }
    },
  },
  {
    name: 'implement-triple',
    setup: (w) => {
      mkdirSync(join(w, 'src'), { recursive: true })
      writeFileSync(join(w, 'src', 'math.js'), MATH_SRC)
      writeFileSync(join(w, 'math.test.js'), MATH_TEST)
    },
    prompt: 'src/math.js exports `double` but math.test.js also imports `triple`, which is missing. '
      + 'Add `triple` (and fix anything else) so `node math.test.js` passes. '
      + 'Run `node math.test.js` to verify, then report the result. Do not modify math.test.js.',
    verify: (w) => {
      const untouched = readFileSync(join(w, 'math.test.js'), 'utf8') === MATH_TEST
      const r = spawnSync('node', ['math.test.js'], { cwd: w, encoding: 'utf8' })
      return {
        pass: untouched && r.status === 0 && r.stdout.includes('PASS'),
        detail: untouched
          ? (r.status === 0 ? `test passed (${r.stdout.trim()})` : `test failed: ${r.stderr.trim() || r.stdout.trim()}`)
          : 'math.test.js was modified',
      }
    },
  },
]

function collectTokens(events: SessionEvent[]): { input: number; output: number } {
  let input = 0
  let output = 0
  for (const event of events) {
    if (event.type !== 'assistant/message') continue
    const usage = event.data.usage
    if (usage === undefined) continue
    input += usage.inputTokens
    output += usage.outputTokens
  }
  return { input, output }
}

function finalText(events: SessionEvent[]): string {
  const message = events.findLast(event => event.type === 'assistant/message')
  if (message?.type !== 'assistant/message') return ''
  return message.data.message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
    .trim()
}

async function runOne(task: Task, persona: string, personaLabel: string): Promise<Record<string, unknown>> {
  const workdir = mkdtempSync(join(tmpdir(), 'dsh-taiyi-ab-'))
  task.setup(workdir)
  const ctx = await codingHarness(workdir, { persona })
  const started = Date.now()
  try {
    const agent = ctx.agentLoop.create(SessionId(`taiyi-ab-${task.name}-${personaLabel}`), MODEL)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: task.prompt }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const events = [...agent.session.events]
    const verdict = task.verify(workdir)
    const tokens = collectTokens(events)
    const report = finalText(events)
    mkdirSync(OUT, { recursive: true })
    writeFileSync(join(OUT, `${task.name}.${personaLabel}.jsonl`), events.map(e => JSON.stringify(e)).join('\n'))

    return {
      task: task.name,
      persona: personaLabel,
      pass: verdict.pass,
      detail: verdict.detail,
      finalReport: report,
      tokens,
      durationMs: Date.now() - started,
      events: events.length,
    }
  } finally {
    await ctx.fiber.dispose()
    rmSync(workdir, { recursive: true, force: true })
  }
}

const TAIYI = taiyiWord()
const results: Array<Record<string, unknown>> = []
for (const task of TASKS) {
  for (const [label, persona] of [['control', SYSTEM_PROMPT], ['taiyi', TAIYI]] as const) {
    console.log(`running ${task.name}/${label} …`)
    const r = await runOne(task, persona, label)
    results.push(r)
    console.log(`  → ${task.name}/${label}: ${r.pass ? 'PASS' : 'FAIL'} (${r.detail})`)
  }
}

const summary = {
  model: MODEL.model,
  provider: MODEL.provider,
  ranAt: new Date().toISOString(),
  tasks: TASKS.map(t => t.name),
  results,
}
writeFileSync(join(OUT, 'summary.json'), JSON.stringify(summary, null, 2))
console.log('\n=== SUMMARY ===')
for (const r of results) {
  console.log(`${r.task}/${r.persona}: ${r.pass ? 'PASS' : 'FAIL'} — ${r.detail}`)
}
console.log(`written to ${OUT}`)
