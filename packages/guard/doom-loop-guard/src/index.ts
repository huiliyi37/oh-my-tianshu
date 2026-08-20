/**
 * Advisory doom-loop guard: watches each agent's tool-call stream and injects
 * escalating reminders when the stream shows loop patterns that repeat-tool-guard's
 * identical-call chain does not cover — an alternating call pair, repeated failed
 * edits on the same file, and an unchanged failing test run. It never vetoes or
 * rewrites a call, and it never duplicates repeat-tool-guard's identical-repeat
 * reminder. Configuration and chain semantics live in the package README; rationale
 * lives in the doom-loop-guard Agent Note.
 * @module @huiliyi37/dsh-doom-loop-guard
 */

import { createHash } from 'node:crypto'
import type { Context } from '@huiliyi37/cordis'
import z from '@huiliyi37/schemastery'
import type { Agent, PreStepDecision } from '@huiliyi37/dsh-agent'
import { createUserMessage } from '@huiliyi37/dsh-llm'
import type { MessageSource } from '@huiliyi37/dsh-llm'
import type { UserMessage } from '@huiliyi37/dsh-session'
import type { PostToolDecision, ToolExecution, ToolResult } from '@huiliyi37/dsh-tools'

export const name = 'doom-loop-guard'

/**
 * Plugin config, validated by the same-named schemastery schema plus the
 * load-time checks in `apply` (misconfiguration fails loud: a threshold below
 * 2, a sub-1 `argumentsPreviewChars`, or a sub-1 `reminderBudget` throws at
 * plugin load, never a silent fall-back).
 */
export interface Config {
  /** Alternating-pair length that trips the oscillation detector (default `2` → A,B,A,B). */
  oscillationPairs?: number
  /** Consecutive failed same-file edits that trip the edit spiral (default `3`). */
  editRetryThreshold?: number
  /** Consecutive identical failing test runs that trip the churn detector (default `3`). */
  testChurnThreshold?: number
  /** Tool-name patterns transparent to every detector (default: read-only discovery tools). */
  exclude?: string[]
  /** Maximum characters of canonical arguments quoted in detailed reminders (default `200`). */
  argumentsPreviewChars?: number
  /** Reminders per agent per user-turn (default `3`); observation continues past the budget. */
  reminderBudget?: number
}

/** Default `exclude`: read-only discovery tools transparent to every detector. */
const DEFAULT_EXCLUDE = [
  'read', 'glob', 'grep', 'file_info', 'related_tests', 'task_output', 'task_list',
  'session_search', 'session_event_search', 'memory_search', 'web_search', 'skill',
]

export const Config: z<Config> = z.object({
  oscillationPairs: z.number().default(2),
  editRetryThreshold: z.number().default(3),
  testChurnThreshold: z.number().default(3),
  exclude: z.array(z.string()).default(DEFAULT_EXCLUDE),
  argumentsPreviewChars: z.number().default(200),
  reminderBudget: z.number().default(3),
})

/** Tools whose same-path repeated failures are an edit spiral. */
const EDIT_TOOLS = new Set(['str_replace_editor', 'edit'])

/**
 * The `{kind:'plugin'}` source stamped on every reminder this guard injects —
 * the label is load-bearing (an unlabeled context would render as a user
 * prompt in derived history).
 */
const PLUGIN_SOURCE: MessageSource = { kind: 'plugin', plugin: 'doom-loop-guard' }

/** One observed call in the sliding window. */
interface RecentCall {
  name: string
  /** Canonical identity (name + canonical arguments). */
  key: string
  /** Edit target path (edit-family tools only). */
  path?: string
  isError: boolean
  /** Result text carries a failure marker (failed/FAIL/AssertionError). */
  failedText: boolean
  /** Normalized result hash (test-churn comparison). */
  resultHash?: string
}

/** Per-agent detector state; object lifetime bounds the weak entry. */
interface AgentState {
  recent: RecentCall[]
  fired: Set<string>
  turnBudget: number
}

const WINDOW = 12

/** Deep key-sort of a parsed-JSON value (mirrors repeat-tool-guard's canonicalization). */
function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue)
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortJsonValue(record[key])
    }
    return sorted
  }
  return value
}

/** Canonical string form of a call's arguments: deep key-sort, then stringify. */
function canonicalize(argumentsValue: unknown): string {
  return JSON.stringify(sortJsonValue(argumentsValue))
}

/** Compile one `*`-wildcard pattern to an anchored RegExp (mirrors repeat-tool-guard). */
function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, String.raw`\$&`)
  return new RegExp(`^${escaped.replaceAll('*', '.*')}$`)
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** Parse the call's arguments JSON (or its raw-string fallback). */
function parseArguments(raw: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}

/** Join a tool result's text blocks. */
function resultText(result: ToolResult): string {
  return result.content
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('')
}

/**
 * Normalize volatile fragments out of a result text before hashing: elapsed-time
 * markers (`in 1.2s`) would otherwise make two identical failing runs hash
 * differently.
 */
function normalizeForHash(text: string): string {
  return text.replace(/\bin \d+(?:\.\d+)?s\b/g, 'in <t>s')
}

function resultHash(text: string): string {
  return createHash('sha256').update(normalizeForHash(text)).digest('hex').slice(0, 16)
}

/** Head-truncate canonical arguments for quoting in a detailed reminder. */
function previewArguments(canonical: string, cap: number): string {
  if (canonical.length <= cap) return canonical
  return `${canonical.slice(0, cap)}… (+${canonical.length - cap} more chars)`
}

/** Validate one integer threshold per the fail-loud contract. */
function validateThreshold(label: string, value: number, minimum = 2): number {
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`doom-loop-guard: invalid ${label} ${value} — must be an integer >= ${minimum}`)
  }
  return value
}

/** Prepend the guard's reminder while preserving every downstream context's source. */
function prependContext(ours: UserMessage, theirs: UserMessage[] | undefined): UserMessage[] {
  return [ours, ...theirs ?? []]
}

/** One detector outcome: the reminder text and the dedupe key. */
interface Reminder {
  key: string
  text: string
  summary: string
}

/**
 * Alternating-pair detector: the last `2 * pairs` calls form exactly two tools
 * alternating (A,B,A,B, …) with identical per-tool identity, and at least one
 * call failed or reported a failure — a pure successful alternation may be a
 * legitimate search-then-act rhythm and stays quiet.
 */
function detectOscillation(state: AgentState, pairs: number): Reminder | undefined {
  const needed = pairs * 2
  const recent = state.recent
  if (recent.length < needed) return undefined
  const window = recent.slice(-needed)
  const first = window[0]
  const second = window[1]
  if (first === undefined || second === undefined || first.key === second.key) return undefined
  for (let i = 0; i + 2 < window.length; i++) {
    const a = window[i]
    const b = window[i + 2]
    if (a === undefined || b === undefined || a.key !== b.key) return undefined
  }
  if (!window.some(call => call.isError || call.failedText)) return undefined
  const key = `osc:${[first.name, second.name].sort().join('<>')}`
  if (state.fired.has(key)) return undefined
  return {
    key,
    summary: `alternating ${first.name} / ${second.name}`,
    text: `Your recent tool calls alternate between ${first.name} and ${second.name} `
      + 'without progress, and at least one call reported a failure. Stop repeating the pair: '
      + 'inspect the latest results and pick a different action, or finish the task with the evidence you have.',
  }
}

/**
 * Edit-spiral detector: consecutive failed edits of the same file by an
 * edit-family tool. A successful edit on that path clears the fired marker.
 */
function detectEditSpiral(state: AgentState, threshold: number): Reminder | undefined {
  const recent = state.recent
  const tail = recent.filter(call => EDIT_TOOLS.has(call.name) && call.path !== undefined)
  const last = tail.at(-1)
  if (last === undefined || !last.isError || last.path === undefined) return undefined
  const path = last.path
  let count = 0
  for (let i = tail.length - 1; i >= 0; i--) {
    const call = tail[i]
    if (call === undefined || call.path !== path || !call.isError) break
    count++
  }
  if (count < threshold) return undefined
  const key = `edit:${last.name}:${path}`
  if (state.fired.has(key)) return undefined
  return {
    key,
    summary: `${last.name} ${path} × ${count}`,
    text: `The same edit on ${path} has failed ${count} times in a row. Read the file again before editing: `
      + 'the edit is not landing, so repeating it unchanged cannot work. Change the arguments, '
      + 'fix what the failure message names, or stop and report the blocker.',
  }
}

/**
 * Test-churn detector: consecutive runs of the same test command whose
 * normalized output hash is unchanged and whose output reports a failure.
 */
function detectTestChurn(state: AgentState, threshold: number, argumentsPreviewChars: number): Reminder | undefined {
  const recent = state.recent
  const last = recent.at(-1)
  if (last === undefined || last.resultHash === undefined || !(last.isError || last.failedText)) return undefined
  const key = last.key
  let count = 0
  for (let i = recent.length - 1; i >= 0; i--) {
    const call = recent[i]
    if (call === undefined || call.key !== key || call.resultHash !== last.resultHash || !(call.isError || call.failedText)) break
    count++
  }
  if (count < threshold) return undefined
  const dedupe = `churn:${key}`
  if (state.fired.has(dedupe)) return undefined
  return {
    key: dedupe,
    summary: `test churn × ${count}`,
    text: `The same test command has produced the same failing output ${count} times in a row: `
      + `${previewArguments(key, argumentsPreviewChars)}. Running it again cannot change the result. `
      + 'Change the code under test or the test itself, then run again.',
  }
}

/**
 * Install the guard's listeners.
 * @param ctx - plugin context; listeners are scoped to it and disposed with it.
 * @param config - validated {@link Config}; thresholds are re-checked fail-loud here.
 */
export function apply(ctx: Context, config: Config = {}): void {
  // Schema defaults mirrored as `??` fallbacks for direct apply calls (单一缺省来源).
  const oscillationPairs = validateThreshold('oscillationPairs', config.oscillationPairs ?? 2)
  const editRetryThreshold = validateThreshold('editRetryThreshold', config.editRetryThreshold ?? 3)
  const testChurnThreshold = validateThreshold('testChurnThreshold', config.testChurnThreshold ?? 3)
  const argumentsPreviewChars = validateThreshold('argumentsPreviewChars', config.argumentsPreviewChars ?? 200, 1)
  const reminderBudget = validateThreshold('reminderBudget', config.reminderBudget ?? 3, 1)
  const excludePatterns = (config.exclude ?? DEFAULT_EXCLUDE).map(wildcardToRegExp)

  const states = new WeakMap<Agent, AgentState>()

  function stateFor(agent: Agent): AgentState {
    const existing = states.get(agent)
    if (existing !== undefined) return existing
    const fresh: AgentState = { recent: [], fired: new Set(), turnBudget: reminderBudget }
    states.set(agent, fresh)
    return fresh
  }

  function tracked(toolName: string): boolean {
    return !excludePatterns.some(pattern => pattern.test(toolName))
  }

  /**
   * Advance the calling agent's window for one call and return the reminder
   * to deliver, if a detector trips and the turn budget has room. Counting
   * happens here — in post-execute — because denied calls also flow through
   * this waterfall, and a model hammering a denied call is exactly the loop
   * worth breaking.
   */
  function observe(exec: ToolExecution, result: ToolResult): UserMessage | undefined {
    if (!exec.agent) return undefined
    if (!tracked(exec.name)) return undefined
    const state = stateFor(exec.agent)
    const args = parseArguments(typeof exec.arguments === 'string' ? exec.arguments : JSON.stringify(exec.arguments))
    const text = resultText(result)
    const command = asString(args?.['command'])
    const isTestRun = exec.name === 'run_tests' || (exec.name === 'bash' && command !== undefined && /\btest/i.test(command))
    const editPath = EDIT_TOOLS.has(exec.name)
      ? asString(args?.['path']) ?? asString(args?.['filePath']) ?? asString(args?.['file_path'])
      : undefined
    const call: RecentCall = {
      name: exec.name,
      key: JSON.stringify([exec.name, canonicalize(exec.arguments)]),
      isError: result.isError,
      // A failure needs a non-zero count ("3 failed") or a Java-style assert
      // name; a passing summary that merely prints "0 failed" stays quiet.
      failedText: /\b[1-9]\d*\s+(?:failed|failing|errors?)\b/i.test(text) || /\bAssertionError\b/.test(text),
    }
    if (editPath !== undefined) call.path = editPath
    if (isTestRun) call.resultHash = resultHash(text)
    state.recent.push(call)
    if (state.recent.length > WINDOW) state.recent.shift()

    // A successful edit clears its spiral marker so the next genuine spiral can fire.
    const last = state.recent.at(-1)
    if (last !== undefined && EDIT_TOOLS.has(last.name) && last.path !== undefined && !last.isError) {
      state.fired.delete(`edit:${last.name}:${last.path}`)
    }

    const detected = detectOscillation(state, oscillationPairs)
      ?? detectEditSpiral(state, editRetryThreshold)
      ?? detectTestChurn(state, testChurnThreshold, argumentsPreviewChars)
    if (detected === undefined) return undefined
    if (state.turnBudget <= 0) return undefined
    state.turnBudget--
    state.fired.add(detected.key)
    return createUserMessage({
      content: [{ type: 'text', text: detected.text }],
      source: { ...PLUGIN_SOURCE, form: 'notice', summary: detected.summary },
    })
  }

  // Observe-and-enrich, never veto: count first (state advances regardless of
  // the downstream outcome), DELEGATE so a later listener can still block or
  // replace, then fold the reminder onto whatever came back — additionalContexts
  // rides both decision variants, so a blocked call still gets the nudge.
  ctx.on('tools/post-execute', async (exec, result, next): Promise<PostToolDecision> => {
    const reminder = observe(exec, result)
    const downstream = await next()
    if (!reminder) return downstream
    if (downstream.kind === 'block') {
      return { kind: 'block', feedback: downstream.feedback, additionalContexts: prependContext(reminder, downstream.additionalContexts) }
    }
    return {
      ...downstream,
      additionalContexts: prependContext(reminder, downstream.additionalContexts),
    }
  })

  // A user interjection changes the context; repetition across it is not a
  // loop. Pure reset hook: always delegates (attaching nothing, vetoing nothing).
  ctx.on('agent/pre-step', ({ agent, messages }, next): Promise<PreStepDecision> => {
    if (messages.some(message => message.source.kind === 'user')) {
      const state = states.get(agent)
      if (state !== undefined) {
        state.recent = []
        state.fired = new Set()
        state.turnBudget = reminderBudget
      }
    }
    return next()
  })
}
