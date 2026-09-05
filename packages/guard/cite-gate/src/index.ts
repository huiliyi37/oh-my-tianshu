import type { Context } from '@huiliyi37/cordis'
import z from '@huiliyi37/schemastery'
import { createUserMessage } from '@huiliyi37/dsh-llm'
import type { ToolExecution, ToolResult } from '@huiliyi37/dsh-tools'
import type { Agent } from '@huiliyi37/dsh-agent'
import type { SessionEvent, UserMessage } from '@huiliyi37/dsh-session'
import { vocabulary } from './vocabulary.ts'
import {
  extractAssistantText,
  extractToolPaths,
  normalizePath,
  renderReminder,
  renderSummary,
  scanText,
} from './scan.ts'

export const name = 'cite-gate'

/**
 * Cite-gate plugin config. Every check is advisory: findings surface as
 * per-turn reminders and never block a reply or tool call.
 */
export interface Config {
  /** Master switch. When false the guard registers no behavior. */
  enabled?: boolean
  /** Reminders injected per assistant message (deduplicated per session). */
  reminderBudget?: number
  /** Flag upgrade/feature card IDs absent from the compiled vocabulary. */
  cardCheck?: boolean
  /** Flag error codes in legacy forms the current catalog replaced. */
  legacyCodeCheck?: boolean
  /** Optional: also flag namespaced error codes not in the curated list. Noisy — off by default. */
  namespacedCodeCheck?: boolean
  /** Flag workspace paths cited before any read ({@link Config.readTools} history). */
  pathCheck?: boolean
  /** Tool names whose successful calls mark a path as read. */
  readTools?: string[]
  /** Tool names whose successful calls mark a path as read-and-written. */
  writeTools?: string[]
}

const DEFAULT_READ_TOOLS = ['read', 'read_section', 'read_file', 'file_info', 'grep', 'repo_map', 'repo_graph', 'semantic_search', 'related_tests']
const DEFAULT_WRITE_TOOLS = ['write_file', 'str_replace_editor', 'edit_file']

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  reminderBudget: z.number().default(3),
  cardCheck: z.boolean().default(true),
  legacyCodeCheck: z.boolean().default(true),
  namespacedCodeCheck: z.boolean().default(false),
  pathCheck: z.boolean().default(true),
  readTools: z.array(z.string()).default(DEFAULT_READ_TOOLS),
  writeTools: z.array(z.string()).default(DEFAULT_WRITE_TOOLS),
})



interface CiteState {
  /** Paths this session read or wrote (normalized). */
  seen: Set<string>
  /** Highest assistant/message seq already scanned. */
  lastSeq: number
  /** Finding keys already reminded this turn. */
  fired: Set<string>
  /** Remaining reminder budget this turn. */
  budget: number
  /** Turn the budget/fired set belongs to. */
  turn: number
}

/**
 * Advisory citation gate. Watches every agent's assembled assistant messages
 * and folds a notice into the next step when the message cites something it
 * cannot back:
 *
 *  1. an upgrade-card ID absent from the compiled vocabulary (fabricated cards);
 *  2. a 0.1.1-era legacy error code that alpha.2 renamed with a namespace;
 *  3. (opt-in) a namespaced code absent from the curated list;
 *  4. a file path the session never read or wrote (read-before-cite).
 *
 * The guard never vetoes, never rewrites a call, and never appears in the tool
 * list — the decision stays with the model, exactly like doom-loop-guard.
 *
 * Injection point: `agent/pre-step` folds the reminders into the step's
 * `decision.messages` (the loop then logs them as user/message events), which
 * is the platform's delivery path for advisory context. `agent.inject()` would
 * queue into the next-step inbox instead — items queued inside a finishing
 * turn are never claimed by later turns.
 */
export function apply(ctx: Context, config: Config = {}): void {
  // Schema defaults mirrored as ?? fallbacks for direct apply calls (单一缺省来源):
  // ctx.plugin() does not run the Schema — only the loader does.
  const enabled = config.enabled ?? true
  if (!enabled) return
  const reminderBudget = config.reminderBudget ?? 3
  const cardCheck = config.cardCheck ?? true
  const legacyCodeCheck = config.legacyCodeCheck ?? true
  const namespacedCodeCheck = config.namespacedCodeCheck ?? false
  const pathCheck = config.pathCheck ?? true
  const readTools = config.readTools ?? DEFAULT_READ_TOOLS
  const writeTools = config.writeTools ?? DEFAULT_WRITE_TOOLS
  const states = new WeakMap<Agent, CiteState>()

  const stateFor = (agent: Agent, turn = 0): CiteState => {
    let state = states.get(agent)
    if (!state) {
      state = { seen: new Set(), lastSeq: 0, fired: new Set(), budget: reminderBudget, turn }
      states.set(agent, state)
    }
    if (turn !== state.turn) {
      state.fired = new Set()
      state.budget = reminderBudget
      state.turn = turn
    }
    return state
  }

  // Read/write tracking: a tool call carrying a path marks the path as seen —
  // writing a file obviously means the session produced (and thus knows) its
  // content; reading it likewise.
  ctx.on('tools/post-execute', async (exec: ToolExecution, _result: ToolResult, next) => {
    if (!exec.agent) return next()
    const isRead = readTools.includes(exec.name)
    const isWrite = writeTools.includes(exec.name)
    if (!isRead && !isWrite) return next()
    const state = stateFor(exec.agent)
    for (const raw of extractToolPaths(exec.arguments)) {
      const path = normalizePath(raw)
      if (path) state.seen.add(path)
    }
    return next()
  })

  // Citation scan: at each pre-step, scan assistant messages assembled since
  // the last scan, and fold reminders into the step's messages.
  ctx.on('agent/pre-step', async (payload, next) => {
    const downstream = await next()
    if (downstream.kind !== 'enter') return downstream
    const state = stateFor(payload.agent, payload.turn)
    const fresh = [...payload.agent.session.events]
      .filter((e): e is SessionEvent<'assistant/message'> => e.type === 'assistant/message' && e.seq > state.lastSeq)
    if (fresh.length === 0) return downstream

    const reminders: UserMessage[] = []
    for (const e of fresh) {
      state.lastSeq = Math.max(state.lastSeq, e.seq)
      const text = extractAssistantText(e.data.message)
      if (!text) continue
      const findings = scanText(text, vocabulary, state.seen, {
        cardCheck,
        legacyCodeCheck,
        namespacedCodeCheck,
        pathCheck,
      })
      for (const finding of findings) {
        if (state.budget <= 0) break
        const key = finding.kind === 'unread-path'
          ? `${finding.kind}:${finding.path}`
          : `${finding.kind}:${'id' in finding ? finding.id : finding.code}`
        if (state.fired.has(key)) continue
        state.fired.add(key)
        state.budget -= 1
        reminders.push(createUserMessage({
          content: [{ type: 'text', text: renderReminder(finding) }],
          source: { kind: 'plugin', plugin: name, form: 'notice', summary: renderSummary(finding) },
        }))
      }
    }
    if (reminders.length === 0) return downstream
    return { ...downstream, messages: [...downstream.messages, ...reminders] }
  })
}
