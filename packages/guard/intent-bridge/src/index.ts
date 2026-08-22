/**
 * Intent bridge — a built-in lifecycle phase, not a skill: a new session's
 * first message is handled by a low-cost ALIGNMENT agent (multi-round
 * clarification with the user, ordinary conversation turns), and when the
 * intent is clear the bridge hands off a structured task card to a FRESH main
 * session. The main session never inherits the alignment context — it only
 * receives the card, which is multi-line and long, so task-card stays
 * idempotent (no rewrite) and zen's triage does not skip it: the main session
 * naturally arms the zen phase and anchors before unlocking the full face.
 *
 * The alignment agent is seeded with a completed `zen/phase` pair
 * (`{zen, arm}` → `{full, timeout}`), so zen's resume branch (history present)
 * never arms it; the bridge itself restricts its tool face to
 * `finalize_alignment` alone. `intent:policy` renders the alignment contract
 * only while an alignment session is live.
 *
 * Failure paths never block the task: when the alignment rounds are exhausted
 * the bridge force-finalizes a template card; when the alignment agent errors,
 * the original message flows straight to the main session (task-card's single
 * shot rewrite is the fallback).
 *
 * Agent Note:
 * - .agents/notes/implemented/architecture/2026-08-18-intent-bridge.md
 *
 * @module @huiliyi37/dsh-intent-bridge
 */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@huiliyi37/cordis'
import type { Agent, AgentHandle, AgentOptions } from '@huiliyi37/dsh-agent'
import type {} from '@huiliyi37/dsh-agent' // 'agent/pre-step' / 'agent/inbox/inserted' event declaration merge
import { createUserMessage } from '@huiliyi37/dsh-llm'
import type { ReasoningEffortId, UserMessage } from '@huiliyi37/dsh-llm'
import type { Session, SessionEvent } from '@huiliyi37/dsh-session'
import { SessionId } from '@huiliyi37/dsh-session'
import type {} from '@huiliyi37/dsh-session-title' // 'session/title' event declaration merge
import { ORIGINAL_MARKER, renderTaskCard, templateCard } from '@huiliyi37/dsh-task-card'
import { defineTool } from '@huiliyi37/dsh-tools'
import type { ToolDefinition } from '@huiliyi37/dsh-tools'
import { ALIGN_FACE_STATEMENT, ALIGN_SECTION } from './align.ts'
import { FINALIZE_TOOL_NAME, parseFinalizeArgs } from './finalize.ts'
import type { FinalizeArgs } from './finalize.ts'

declare module '@huiliyi37/cordis' {
  interface Context {
    intentBridge: IntentBridgeService
  }
  interface Events {
    /**
     * An alignment session handed off to its main session. The main session
     * already received the rendered task card as its first user message.
     * @mode emit
     * @param payload.alignSessionId - the alignment session that completed.
     * @param payload.mainSessionId - the fresh main session to switch to.
     * @param payload.title - the task card's title ('' on failure fallback).
     */
    'intent-bridge/handoff'(this: unknown, payload: IntentBridgeHandoff): void
  }
}

declare module '@huiliyi37/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Durable handoff record on the MAIN session's log: log-only (never
     * reaches the model surface), whole-value append. At most one per
     * session — the invariant checks it.
     */
    'intent-bridge/handoff': { alignSessionId: string; reason: string }
  }
}

/** Handoff event payload; see the event's JSDoc for the field rules. */
export interface IntentBridgeHandoff {
  alignSessionId: string
  mainSessionId: string
  title: string
}

/** Deterministic title for alignment sessions (folded by the TUI tab list). */
export const ALIGN_TITLE = '意图对齐'

/** Deployment-owned intent-bridge policy. */
export interface IntentBridgeConfig {
  /** Master switch; `false` mounts the service with no behavior. Default true. */
  enabled?: boolean
  /** Alignment agent route. REQUIRED. */
  alignProvider?: string
  /** Alignment agent route. REQUIRED. */
  alignModel?: string
  /** Main (execution) agent route. REQUIRED. */
  execProvider?: string
  /** Main (execution) agent route. REQUIRED. */
  execModel?: string
  /** Alignment rounds before a template card is force-finalized. Default 5. */
  alignMaxRounds?: number
  /** Custom alignment contract; defaults to the built-in {@link ALIGN_SECTION}. */
  section?: string
}

/** {@link IntentBridgeConfig} with every default materialized. */
export interface ResolvedIntentBridgeConfig {
  enabled: boolean
  alignProvider: string | undefined
  alignModel: string | undefined
  execProvider: string | undefined
  execModel: string | undefined
  alignMaxRounds: number
  section: string
}

/** Main-session route, optionally carrying an explicit conversation effort. */
export interface IntentBridgeExecRoute {
  /** Provider route for the main session. */
  provider: string
  /** Model id for the main session. */
  model: string
  /** Explicit conversation reasoning effort; omission leaves the adapter default. */
  reasoningEffort?: ReasoningEffortId
}

/**
 * Spread one exec route into AgentOptions without inventing an omitted effort.
 * @param route - main-session provider/model and optional explicit effort.
 * @returns AgentOptions with `reasoningEffort` present only when the route set it.
 */
function agentOptionsFor(route: IntentBridgeExecRoute): AgentOptions {
  return {
    provider: route.provider,
    model: route.model,
    ...route.reasoningEffort === undefined ? {} : { reasoningEffort: route.reasoningEffort },
  }
}

/** Per-call alignment-session options (caller-owned; all optional). */
export interface CreateAlignedSessionOptions {
  /** Project directory (durable header.cwd) for the alignment session AND its main session; omitted lands both in `_no-cwd/`. */
  cwd?: string
  /** Main-session route override for this alignment's handoff; default is the config exec route. May carry `reasoningEffort`. */
  exec?: IntentBridgeExecRoute
}

/**
 * Validate deployment-owned policy and materialize defaults. Unknown keys,
 * missing provider/model pairs, and non-positive budgets fail at plugin load.
 *
 * @param config Raw plugin config.
 * @returns A detached validated config with all defaults applied.
 */
export function resolveConfig(config: IntentBridgeConfig): ResolvedIntentBridgeConfig {
  const known = ['enabled', 'alignProvider', 'alignModel', 'execProvider', 'execModel', 'alignMaxRounds', 'section']
  const unknown = Object.keys(config).filter(key => !known.includes(key))
  if (unknown.length > 0) {
    throw new Error(`IntentBridgeConfig has unknown key(s) ${unknown.join(', ')} — config is { enabled?, alignProvider?, alignModel?, execProvider?, execModel?, alignMaxRounds?, section? }`)
  }
  if (config.enabled !== undefined && typeof config.enabled !== 'boolean') {
    throw new Error('IntentBridgeConfig `enabled` must be a boolean')
  }
  const routes: Array<[string, string | undefined]> = [
    ['alignProvider', config.alignProvider],
    ['alignModel', config.alignModel],
    ['execProvider', config.execProvider],
    ['execModel', config.execModel],
  ]
  for (const [name, value] of routes) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`IntentBridgeConfig \`${name}\` is required (non-empty string)`)
    }
  }
  const alignMaxRounds = config.alignMaxRounds ?? 5
  if (!Number.isInteger(alignMaxRounds) || alignMaxRounds <= 0) {
    throw new Error('IntentBridgeConfig `alignMaxRounds` must be a positive integer')
  }
  if (config.section !== undefined && typeof config.section !== 'string') {
    throw new Error('IntentBridgeConfig `section` must be a string')
  }
  return {
    enabled: config.enabled ?? true,
    alignProvider: config.alignProvider,
    alignModel: config.alignModel,
    execProvider: config.execProvider,
    execModel: config.execModel,
    alignMaxRounds,
    section: config.section ?? ALIGN_SECTION,
  }
}

/** Join a user message's text blocks; non-text blocks contribute nothing. */
function textOf(message: UserMessage): string {
  return message.content.map(block => block.type === 'text' ? block.text : '').join('')
}

/** The verbatim original of a user message (the card marker section when present). */
function originalOf(text: string): string {
  const marker = text.indexOf(ORIGINAL_MARKER)
  if (marker < 0) return text
  return text.slice(marker + ORIGINAL_MARKER.length).trim()
}

/** Per-alignment-session state. */
interface AlignState {
  /** Steps consumed (the round meter). */
  rounds: number
  /**
   * Whether the handoff already happened (1:1). Set only after the main
   * session received the card, so a failed handoff stays retryable.
   */
  finalized: boolean
  /**
   * Whether a handoff is currently in flight. Set synchronously before the
   * first await so every path (tool, forced, fallback) serializes against
   * the create window; cleared in `finally` on success and failure alike.
   */
  finalizing: boolean
  /** The user's first message verbatim (recorded before any rewrite). */
  originalText: string | undefined
  /** Project directory for the alignment session and its main session (header.cwd). */
  cwd: string | undefined
  /** Per-session main-session route override; falls back to the config exec route. */
  execRoute?: IntentBridgeExecRoute
}

/**
 * `ctx.intentBridge`: owns alignment sessions and the handoff. UIs observe the
 * handoff through the `intent-bridge/handoff` dispatch event; the main session
 * is a plain session that needs no special handling.
 */
export class IntentBridgeService extends Service {
  static inject = ['agents', 'tools', 'systemPrompt', 'sessions']

  /** Validated deployment policy with defaults materialized. */
  private readonly config: ResolvedIntentBridgeConfig

  /** Narrowed alignment route (resolveConfig validated both fields non-empty). */
  private readonly alignRoute: { provider: string; model: string } = { provider: '', model: '' }

  /** Narrowed main-session route (resolveConfig validated both fields non-empty). */
  private readonly execRoute: { provider: string; model: string } = { provider: '', model: '' }

  /** Live alignment sessions by session id. */
  private readonly aligns = new Map<string, AlignState>()

  constructor(ctx: Context, config: IntentBridgeConfig = {}) {
    super(ctx, 'intentBridge')
    this.config = resolveConfig(config)
    if (!this.config.enabled) return
    const alignProvider = this.config.alignProvider
    const alignModel = this.config.alignModel
    const execProvider = this.config.execProvider
    const execModel = this.config.execModel
    if (alignProvider === undefined || alignModel === undefined || execProvider === undefined || execModel === undefined) {
      throw new Error('intent-bridge: missing route (unreachable: resolveConfig validates)')
    }
    this.alignRoute = { provider: alignProvider, model: alignModel }
    this.execRoute = { provider: execProvider, model: execModel }

    // The alignment contract renders only while an alignment session is live.
    ctx.systemPrompt.section({
      name: 'intent:policy',
      order: 49,
      text: (context) => {
        if (context.agent === undefined) return ''
        return this.aligns.has(context.agent.session.id) ? this.config.section : ''
      },
    })

    // Defense in depth behind the single-tool face: the restrict allow list
    // already hides every global tool, but a flighty alignment model may
    // still call familiar names (bash/glob) from its priors and read back a
    // bare "unknown tool" with no recovery. This guard turns any non-finalize
    // call — including the leaked zen_anchor — into the face statement,
    // mirroring zen's locked-tool guard but shared verbatim with
    // ALIGN_SECTION (ALIGN_FACE_STATEMENT) instead of a bare refusal.
    ctx.effect(() => ctx.tools.guard((exec) => {
      const agent = exec.agent
      if (agent === undefined) return undefined
      if (!this.aligns.has(agent.session.id)) return undefined
      if (exec.name === FINALIZE_TOOL_NAME) return undefined
      return ALIGN_FACE_STATEMENT
    }), 'dsh-intent-bridge: lock the alignment face to finalize_alignment')

    // Record the user's first message verbatim (pre-rewrite) per alignment session.
    ctx.on('agent/inbox/inserted', ({ agent, message }) => {
      const state = this.aligns.get(agent.session.id)
      if (state === undefined || state.originalText !== undefined) return
      const text = textOf(message)
      if (text !== '') state.originalText = text
    })

    // Round meter: at the budget's final step, force-finalize a template card
    // and reject the step so the alignment model never runs past the budget.
    ctx.on('agent/pre-step', async ({ agent }, next) => {
      const state = this.aligns.get(agent.session.id)
      if (state === undefined || state.finalized || state.finalizing) return next()
      state.rounds += 1
      if (state.rounds < this.config.alignMaxRounds) return next()
      try {
        await this.finalize(agent, undefined, 'rounds-exhausted')
      } catch (error) {
        ctx.logger.warn('intent-bridge: forced finalize failed: %o', error)
      }
      return { kind: 'reject' }
    })

    // Alignment agent failure (e.g. no adapter): flow the original message
    // straight to the main session — task-card's single-shot rewrite is the
    // fallback, so the task is never blocked.
    ctx.on('internal/dispatch', (_mode, eventName, args) => {
      if (eventName !== 'session/event') return
      const [session, event] = args as [Session, SessionEvent]
      const state = this.aligns.get(session.id)
      if (state === undefined || state.finalized || state.finalizing) return
      if (event.type === 'turn/end' && event.data.reason.kind === 'error') {
        this.finalizeFromSession(session.id).catch((error: unknown) => {
          ctx.logger.warn('intent-bridge: error fallback finalize failed: %o', error)
        })
      }
    }, { global: true })
  }

  /**
   * The mounted master switch: `false` keeps the service resolvable with no
   * behavior and {@link createAlignedSession} throwing. UI callers check this
   * before routing a new session through the bridge, falling back to a plain
   * session otherwise.
   *
   * @returns whether the bridge routes new sessions.
   */
  get enabled(): boolean {
    return this.config.enabled
  }

  /**
   * Create a fresh alignment session: seeded zen-completed (never arms),
   * tool face restricted to `finalize_alignment`, titled for the tab list.
   * Caller-owned options: `cwd` lands BOTH the alignment session and the main
   * session it hands off to in a real project directory (omitted → `_no-cwd/`),
   * `exec` overrides the main-session route for this alignment's handoff
   * (omitted → config exec route) and may carry `reasoningEffort`.
   *
   * @param options - per-call options (all optional).
   * @returns the session id and the owned handle (drive it after resolve).
   */
  async createAlignedSession(options: CreateAlignedSessionOptions = {}): Promise<{ sessionId: string; handle: AgentHandle }> {
    if (!this.config.enabled) throw new Error('intent-bridge: disabled')
    const sessionId = `session-${randomUUID()}`
    const seed: SessionEvent[] = [
      { type: 'zen/phase', seq: 0, time: 1, data: { phase: 'zen', reason: 'arm' } } as SessionEvent,
      { type: 'zen/phase', seq: 1, time: 2, data: { phase: 'full', reason: 'timeout' } } as SessionEvent,
    ]
    const handle = await this.ctx.agents.create({
      sessionId: SessionId(sessionId),
      seed,
      ...(options.cwd === undefined ? {} : { meta: { cwd: options.cwd } }),
      agentOptions: { provider: this.alignRoute.provider, model: this.alignRoute.model },
    })
    const agent = handle.agent
    // The alignment agent's tool face: register the single tool agent-scoped
    // (agent-scoped tools bypass restrict's allow list — zen's zen_anchor is
    // the same pattern) and empty the global allow list.
    agent.ctx.tools.register(this.finalizeTool())
    agent.ctx.tools.restrict({ allow: [] })
    agent.session.append('session/title', { title: ALIGN_TITLE, messageSeqs: [], source: { kind: 'fallback' } })
    this.aligns.set(sessionId, {
      rounds: 0,
      finalized: false,
      finalizing: false,
      originalText: undefined,
      cwd: options.cwd,
      ...(options.exec === undefined ? {} : { execRoute: options.exec }),
    })
    return { sessionId, handle }
  }

  /**
   * The alignment agent's single tool: declare the clarified intent as a task
   * card. Validates at the boundary (malformed calls are rejected back to the
   * model), renders the card with the verbatim original, creates the fresh
   * main session, feeds it the card, and emits `intent-bridge/handoff`.
   */
  private finalizeTool(): ToolDefinition {
    return defineTool({
      name: FINALIZE_TOOL_NAME,
      description: 'Declare the clarified intent as a task card and hand off to the main session. '
        + 'Call ONLY after the goal, constraints, and acceptance are confirmed with the user.',
      parameters: {
        title: { type: 'string', required: true, description: 'One-line task title.' },
        goal: { type: 'string', required: true, description: '1-2 sentence goal restatement.' },
        constraints: { type: 'array', items: { type: 'string' }, description: 'What the task must NOT touch (omit when none).' },
        acceptance: { type: 'array', items: { type: 'string' }, description: 'Verifiable criteria (omit when none).' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { handedOff: { type: 'boolean', const: true, required: true } },
        },
        render: () => [{
          type: 'text',
          text: 'Alignment accepted — the task card was handed to the main session.',
        }],
      },
      execute: async (args, exec) => {
        const agent = exec.agent
        if (agent === undefined) throw new Error(`${FINALIZE_TOOL_NAME} requires a calling agent`)
        const state = this.aligns.get(agent.session.id)
        if (state === undefined) throw new Error(`${FINALIZE_TOOL_NAME} is only available during intent alignment`)
        if (state.finalized) throw new Error(`${FINALIZE_TOOL_NAME}: this session already handed off`)
        if (state.finalizing) throw new Error(`${FINALIZE_TOOL_NAME}: a handoff is already in progress`)
        const parsed = parseFinalizeArgs(args)
        await this.finalize(agent, parsed, 'anchor')
        return { handedOff: true as const }
      },
      presentCall: args => ({
        card: 'generic',
        title: 'Intent alignment complete',
        kind: 'other',
        content: [{
          type: 'text',
          text: `title: ${args.title}\ngoal: ${args.goal}`,
        }],
      }),
      presentResult: (_args, result) => ({
        card: 'generic',
        title: 'Intent alignment',
        content: result.content,
      }),
    })
  }

  /**
   * Complete a handoff from a live agent (tool or forced path).
   *
   * `finalizing` is set synchronously before the first await so the tool,
   * forced, and fallback paths all serialize against the create window;
   * `finalized` is set only after the main session received the card, so a
   * failed create or delivery leaves the alignment session retryable.
   */
  private async finalize(
    agent: Agent,
    parsed: FinalizeArgs | undefined,
    reason: 'anchor' | 'rounds-exhausted',
  ): Promise<void> {
    const state = this.aligns.get(agent.session.id)
    if (state === undefined || state.finalized || state.finalizing) return
    state.finalizing = true
    try {
      const original = state.originalText ?? ''
      const cardText = parsed === undefined
        ? renderTaskCard(templateCard(original), original)
        : renderTaskCard(parsed, original)
      const mainId = `session-${randomUUID()}-exec`
      const route = state.execRoute ?? this.execRoute
      const handle = await this.ctx.agents.create({
        sessionId: SessionId(mainId),
        ...(state.cwd === undefined ? {} : { meta: { cwd: state.cwd } }),
        agentOptions: agentOptionsFor(route),
      })
      try {
        this.deliverCard(handle.agent, cardText, agent.session.id, reason)
      } catch (error) {
        // The main session exists but never received the card: dispose it so
        // a retry mints a fresh main session (the invariant forbids a second
        // handoff record on the same session), then surface the failure.
        await handle.dispose()
        throw error
      }
      state.finalized = true
      this.ctx.emit('intent-bridge/handoff', {
        alignSessionId: agent.session.id,
        mainSessionId: mainId,
        title: parsed?.title ?? '',
      })
      this.ctx.logger.info('intent-bridge: handoff %s -> %s (%s)', agent.session.id, mainId, reason)
    } finally {
      state.finalizing = false
    }
  }

  /**
   * Failure fallback: hand off the verbatim original (task-card rewrites it).
   * Same create-then-commit ordering as {@link finalize}: a failed create or
   * delivery leaves the alignment session retryable via the next error turn.
   */
  private async finalizeFromSession(sessionId: string): Promise<void> {
    const state = this.aligns.get(sessionId)
    if (state === undefined || state.finalized || state.finalizing) return
    const session = this.ctx.sessions.get(SessionId(sessionId))
    if (session === undefined) return
    const firstUser = session.events.find(event => event.type === 'user/message')
    const original = firstUser !== undefined
      ? originalOf(textOf(firstUser.data))
      : (state.originalText ?? '')
    state.finalizing = true
    try {
      const mainId = `session-${randomUUID()}-exec`
      const route = state.execRoute ?? this.execRoute
      const handle = await this.ctx.agents.create({
        sessionId: SessionId(mainId),
        ...(state.cwd === undefined ? {} : { meta: { cwd: state.cwd } }),
        agentOptions: agentOptionsFor(route),
      })
      try {
        this.deliverCard(handle.agent, original, sessionId, 'alignment-error')
      } catch (error) {
        // See {@link finalize}: dispose the card-less main session so a
        // retry mints a fresh one instead of double-appending.
        await handle.dispose()
        throw error
      }
      state.finalized = true
      this.ctx.emit('intent-bridge/handoff', { alignSessionId: sessionId, mainSessionId: mainId, title: '' })
    } finally {
      state.finalizing = false
    }
  }

  /**
   * Deliver the card to a created main session: first user message plus the
   * durable log-only handoff record (at most one per session — the invariant).
   */
  private deliverCard(main: Agent, text: string, alignSessionId: string, reason: string): void {
    main.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
    main.session.append('intent-bridge/handoff', { alignSessionId, reason })
  }
}

export default IntentBridgeService
