/**
 * Task card — a built-in agent-lifecycle enhancement, not a skill: a fresh
 * session's FIRST user message is rewritten into a structured task card
 * (title / goal / constraints / acceptance, original kept verbatim under
 * `—— 原始请求 ——`) before it reaches the model, for clearer semantics and
 * task framing. The rewrite happens at `agent/pre-step` — the one waterfall
 * whose return value is honored — so the rewritten message is what the model
 * sees AND what lands in the session log (`model-visible ⟺ logged` closes for
 * free). The verbatim original section keeps the user's exact input
 * reconstructable from the log.
 *
 * Generation ladder: LLM (one bounded call, explicit route, short deadline,
 * zero retries) → semantic template (pure function, never fails) → untouched
 * (the caller only rewrites messages that pass the trigger conditions). A
 * failed card never blocks the first step.
 *
 * Orthogonal composition: the rewrite is decided after zen's triage
 * (`agent/inbox/inserted` precedes `agent/pre-step`), so task cards neither
 * depend on nor disturb the zen phase; subagent sessions
 * (`header.parentSession` set) are skipped — their dispatch prompt is already
 * the anchor. Resume/fork sessions never re-rewrite: a message that already
 * carries the card marker, or a log that already holds a `user/message`, is
 * left untouched.
 *
 * Agent Note:
 * - .agents/notes/implemented/architecture/2026-08-18-task-card-first-message.md
 *
 * @module @huiliyi37/dsh-task-card
 */

import { Context, Service } from '@huiliyi37/cordis'
import type {} from '@huiliyi37/dsh-agent' // 'agent/pre-step' event declaration merge
import type { UserMessage } from '@huiliyi37/dsh-llm'
import type { SessionEvent } from '@huiliyi37/dsh-session'
import { hasTaskCard, parseLlmCard, renderTaskCard, templateCard } from './generate.ts'
import { createTaskCardInvoke, TASK_CARD_SYSTEM_PROMPT } from './llm.ts'
import type { TaskCardLlmInvoke } from './llm.ts'

export { ORIGINAL_MARKER, hasTaskCard, parseLlmCard, renderTaskCard, templateCard } from './generate.ts'

declare module '@huiliyi37/cordis' {
  interface Context {
    taskCard: TaskCardService
  }
}

/** Deployment-owned task-card policy. */
export interface TaskCardConfig {
  /** Master switch; `false` mounts the service with no behavior. Default true. */
  enabled?: boolean
  /**
   * `'llm'` generates the card with one bounded LLM call and falls back to
   * the semantic template on any failure; `'template'` skips the model and
   * uses the zero-cost template directly. Default `'llm'`.
   */
  mode?: 'llm' | 'template'
  /** LLM route; REQUIRED when `mode: 'llm'` (the first message has no assistant message to derive a route from). */
  provider?: string
  /** LLM route; REQUIRED when `mode: 'llm'`. */
  model?: string
  /** End-to-end card-generation deadline. Default 5000. */
  timeoutMs?: number
  /** Messages longer than this are left untouched. Default 4000. */
  maxInputChars?: number
  /** Card-generation output budget. Default 300. */
  maxOutputTokens?: number
  /** Reserved for a future rendered card guidance section; accepted but unused in the MVP. */
  section?: string
}

/** {@link TaskCardConfig} with every default materialized. */
export interface ResolvedTaskCardConfig {
  enabled: boolean
  mode: 'llm' | 'template'
  provider: string | undefined
  model: string | undefined
  timeoutMs: number
  maxInputChars: number
  maxOutputTokens: number
  section: string | undefined
}

/** The closed `mode` vocabulary, held as strings so validation survives direct `apply()` calls. */
const TASK_CARD_MODES: readonly string[] = ['llm', 'template']

/**
 * Validate deployment-owned task-card policy and materialize defaults.
 * Unknown keys, a bad mode, non-positive budgets, and a `mode: 'llm'`
 * without a provider/model pair fail at plugin load rather than silently
 * rewriting nothing.
 *
 * @param config Raw plugin config.
 * @returns A detached validated config with all defaults applied.
 */
export function resolveConfig(config: TaskCardConfig): ResolvedTaskCardConfig {
  const known = ['enabled', 'mode', 'provider', 'model', 'timeoutMs', 'maxInputChars', 'maxOutputTokens', 'section']
  const unknown = Object.keys(config).filter(key => !known.includes(key))
  if (unknown.length > 0) {
    throw new Error(`TaskCardConfig has unknown key(s) ${unknown.join(', ')} — config is { enabled?, mode?, provider?, model?, timeoutMs?, maxInputChars?, maxOutputTokens?, section? }`)
  }
  if (config.enabled !== undefined && typeof config.enabled !== 'boolean') {
    throw new Error('TaskCardConfig `enabled` must be a boolean')
  }
  const mode = config.mode ?? 'llm'
  // The schema types the vocabulary closed, but direct `apply()` calls bypass
  // Loader validation: compare against a string list so the check survives.
  if (!TASK_CARD_MODES.includes(mode)) {
    throw new Error('TaskCardConfig `mode` must be "llm" or "template"')
  }
  const timeoutMs = config.timeoutMs ?? 5000
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('TaskCardConfig `timeoutMs` must be a positive integer')
  }
  const maxInputChars = config.maxInputChars ?? 4000
  if (!Number.isInteger(maxInputChars) || maxInputChars <= 0) {
    throw new Error('TaskCardConfig `maxInputChars` must be a positive integer')
  }
  const maxOutputTokens = config.maxOutputTokens ?? 300
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens <= 0) {
    throw new Error('TaskCardConfig `maxOutputTokens` must be a positive integer')
  }
  if (config.section !== undefined && typeof config.section !== 'string') {
    throw new Error('TaskCardConfig `section` must be a string')
  }
  const provider = config.provider
  const model = config.model
  if (mode === 'llm' && (provider === undefined || model === undefined)) {
    throw new Error('TaskCardConfig mode "llm" requires a provider/model pair (the first message has no assistant message to derive a route from)')
  }
  return {
    enabled: config.enabled ?? true,
    mode,
    provider,
    model,
    timeoutMs,
    maxInputChars,
    maxOutputTokens,
    section: config.section,
  }
}

/** Join a user message's text blocks; non-text blocks contribute nothing. */
function messageText(message: UserMessage): string {
  return message.content.map(block => block.type === 'text' ? block.text : '').join('')
}

/** Whether the session log already holds any user message (first-message test). */
function hasUserMessage(events: readonly SessionEvent[]): boolean {
  return events.some(event => event.type === 'user/message')
}

/**
 * `ctx.taskCard`: owns the first-message rewrite. UIs observe the rewritten
 * message as a plain `user/message` in the session log; there is no extra
 * event surface.
 */
export class TaskCardService extends Service {
  /** Validated deployment policy with defaults materialized. */
  private readonly config: ResolvedTaskCardConfig

  /** LLM executor plus its explicit route; `undefined` in template mode. */
  private readonly invoke: { run: TaskCardLlmInvoke; provider: string; model: string } | undefined

  constructor(ctx: Context, config: TaskCardConfig = {}) {
    super(ctx, 'taskCard')
    this.config = resolveConfig(config)
    if (!this.config.enabled) return

    this.invoke = this.config.mode === 'llm' && this.config.provider !== undefined && this.config.model !== undefined
      ? {
        run: createTaskCardInvoke(ctx, {
          provider: this.config.provider,
          model: this.config.model,
          timeoutMs: this.config.timeoutMs,
          maxOutputTokens: this.config.maxOutputTokens,
        }),
        provider: this.config.provider,
        model: this.config.model,
      }
      : undefined

    // Rewrite at agent/pre-step: the only waterfall whose return value is
    // honored, and the rewritten messages are what agent-loop appends to the
    // session log (model-visible ⟺ logged). A reject decision, an abort, a
    // non-user first message, a subagent session, an already-carded message,
    // an over-long message, or any log that already holds a user message
    // short-circuits to the untouched decision.
    ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
      const decision = await next()
      if (decision.kind === 'reject' || signal.aborted) return decision
      const [first, ...rest] = decision.messages
      if (first === undefined || first.source.kind !== 'user') return decision
      if (agent.session.header.parentSession !== undefined) return decision
      const text = messageText(first)
      if (text === '' || hasTaskCard(text)) return decision
      if (text.length > this.config.maxInputChars) return decision
      if (hasUserMessage(agent.session.events)) return decision
      const rewritten = await this.rewrite(ctx, text, signal)
      if (rewritten === text) return decision
      return {
        ...decision,
        messages: [{ ...first, content: [{ type: 'text', text: rewritten }] }, ...rest],
      }
    })
  }

  /**
   * Generate the rewritten text: template mode renders the template card
   * directly; llm mode calls the model once and falls back to the template on
   * any failure or contract miss. Never throws — a card must not block the
   * first step.
   */
  private async rewrite(
    ctx: Context,
    text: string,
    signal: AbortSignal,
  ): Promise<string> {
    if (this.invoke === undefined) return renderTaskCard(templateCard(text), text)
    try {
      const raw = await this.invoke.run({
        system: TASK_CARD_SYSTEM_PROMPT,
        user: text,
        route: { provider: this.invoke.provider, model: this.invoke.model },
      }, signal)
      const card = parseLlmCard(raw)
      if (card === undefined) {
        ctx.logger.warn('task-card: LLM output missed the card contract; falling back to the template')
        return renderTaskCard(templateCard(text), text)
      }
      return renderTaskCard(card, text)
    } catch (error) {
      ctx.logger.warn('task-card: LLM card generation failed (%o); falling back to the template', error)
      return renderTaskCard(templateCard(text), text)
    }
  }
}

export default TaskCardService
