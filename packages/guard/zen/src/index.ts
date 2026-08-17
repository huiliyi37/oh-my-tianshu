/**
 * Zen phase — a built-in agent-lifecycle phase, not a skill: a fresh top-level
 * session's first steps run on a minimal anchored tool face (the official
 * DeepSeek evaluation recipe) while a `zen:policy` prompt section directs the
 * model to anchor the task — restate the goal, verify a landmark with a
 * read-only probe, then call `zen_anchor`. A host-verified predicate (anchor
 * structure + ≥1 successful non-bookkeeping tool result), a step-budget
 * timeout, or a first-message triage heuristic promotes the session to the
 * full face: it lifts the zen-phase `tools.restrict({ allow: face })` and,
 * when `promoteDeny` is set, installs `restrict({ deny })` so overlapping
 * stacks leave the parent catalog. Arming is at `agent/created` (the
 * veto-capable seam, so a misconfigured face or deny list fails creation
 * loud).
 *
 * Phase state is logged per session (`zen/phase`, last one wins) and folded
 * on read, so resume and fork reinstall the face without a live mirror, and
 * every face the model saw stays reconstructable from `request/header`
 * (model-visible ⟺ logged). Subagent sessions (`header.parentSession`) are
 * excluded: their dispatch prompt is already the anchor and routers own their
 * tool profiles. The phase composes orthogonally with agent presets
 * (session-level roster), plan mode (permission axis), and skills
 * (model-side discipline).
 *
 * `zen_anchor` stays registered (agent-scoped) after promotion so crossing
 * the boundary changes only the restriction, mirroring `exit_plan_mode`'s
 * stable-catalog rule; calling it outside the zen phase returns an error.
 *
 * Agent Note:
 * - .agents/notes/implemented/architecture/2026-08-17-zen-phase-engineering-paradigm.md
 *
 * @module @huiliyi37/dsh-zen
 */

import { Context, Service } from '@huiliyi37/cordis'
import type { Agent } from '@huiliyi37/dsh-agent'
import { createUserMessage } from '@huiliyi37/dsh-llm'
import type { UserMessage } from '@huiliyi37/dsh-llm'
import type { SessionEvent } from '@huiliyi37/dsh-session'
import { defineTool } from '@huiliyi37/dsh-tools'
import type { ToolDefinition } from '@huiliyi37/dsh-tools'
import type {} from '@huiliyi37/dsh-system-prompt'
import { selectFaceExtras, selectedFace } from './face-selection.ts'
import { clipDescription } from './schema-diet.ts'

export { BASH_OVERLAP_TOOLS, selectFaceExtras, selectedFace } from './face-selection.ts'
export { clipDescription } from './schema-diet.ts'

declare module '@huiliyi37/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Which zen phase is in force from this point on: log-only, non-surface,
     * whole-value replace. The last `zen/phase` wins; a log with none folds to
     * `'full'` (never armed) through {@link foldZenPhase}. `reason` names the
     * transition: `'arm'` (session start, always with phase `'zen'`) or one of
     * the promotions `'anchor' | 'timeout' | 'triage'` (always with `'full'`).
     */
    'zen/phase': { phase: ZenPhase; reason: ZenTransitionReason }
  }
}

declare module '@huiliyi37/cordis' {
  interface Context {
    zen: ZenPhaseService
  }
}

/** The two logged phases: `'zen'` (anchored minimal face) and `'full'` (promoted face). */
export type ZenPhase = 'zen' | 'full'

/** Why a `zen/phase` event was logged; see the event's JSDoc for the pairing rule. */
export type ZenTransitionReason = 'arm' | 'anchor' | 'timeout' | 'triage'

/** The model-facing anchor tool's name; agent-scoped, stable across the phase boundary. */
export const ZEN_ANCHOR = 'zen_anchor'

/** Deployment-owned zen-phase policy. */
export interface ZenConfig {
  /** Guidance rendered as the `zen:policy` prompt section while the zen phase is active. */
  section: string
  /**
   * Global tool names visible during the zen phase (the anchored face);
   * `zen_anchor` is agent-scoped and always visible on top. Every name must
   * be a registered global tool — an unknown name fails agent creation loud.
   * Default: `['bash', 'str_replace_editor', 'todo_write']` (the official
   * DeepSeek evaluation recipe plus plan bookkeeping).
   */
  face?: readonly string[]
  /**
   * The zen phase's step budget: promotion fires on the budget's final step
   * (assembly precedes the boundary), so the full face is visible from the
   * following step. Default 4.
   */
  timeoutSteps?: number
  /**
   * Whether `zen_anchor` requires ≥1 successful non-bookkeeping tool result
   * (`todo_write` and `zen_anchor` do not count) before it promotes; a bare
   * anchor is rejected back to the model with the probe-first instruction.
   * Default true.
   */
  requireEvidence?: boolean
  /** First-message triage heuristic: skip the zen phase for trivially short prompts. */
  triage?: {
    /** Whether triage runs at all. Default true. */
    enabled?: boolean
    /**
     * A first user message at most this many characters, single-line and
     * text-only, promotes to the full face before the first request.
     * Default 80.
     */
    maxChars?: number
  }
  /**
   * Task-conditioned one-shot face: classify the first user message and freeze
   * the resulting tool face for the rest of the session. The selected face is
   * always `face` plus extras bash cannot substitute; promotion (anchor,
   * timeout, short-prompt triage) is disabled so the prefix is filled once.
   * Default off — the binary skip-or-stay triage remains the shipped path.
   */
  faceSelection?: {
    /** Whether the first message selects a frozen face. Default false. */
    enabled?: boolean
  }
  /**
   * Clip every assembled tool `description` to this many characters. Saves
   * tokens; does not change which tool the model picks (H-arm: names without
   * schemas did not induce calls). Omitted = no clipping. Applied at
   * `system-prompt/assemble`, so the registered catalog is unchanged.
   */
  diet?: {
    /** Inclusive character budget; a positive integer. */
    maxDescriptionChars: number
  }
  /**
   * Global tool names hidden after promotion (the curated top face). Empty
   * (the default) lifts the zen restriction and exposes every registered
   * global tool. Non-empty installs `restrict({ deny })` so overlapping
   * stacks stay registered for subagent roles but leave the parent catalog.
   * Unknown names fail at agent creation; a name that also appears in `face`
   * fails at plugin load. The TUI ships {@link BASH_OVERLAP_TOOLS}.
   */
  promoteDeny?: readonly string[]
  /** Master switch; `false` mounts the service with no behavior. Default true. */
  enabled?: boolean
}

/** {@link ZenConfig} with every default materialized. */
export interface ResolvedZenConfig {
  section: string
  face: readonly string[]
  timeoutSteps: number
  requireEvidence: boolean
  triage: { enabled: boolean; maxChars: number }
  faceSelection: { enabled: boolean }
  diet: { maxDescriptionChars: number } | undefined
  promoteDeny: readonly string[]
  enabled: boolean
}

/**
 * Validate deployment-owned zen policy and materialize defaults. Missing or
 * blank section, malformed face names, non-positive budgets, and unknown
 * fields fail at plugin load rather than silently shaping nothing.
 *
 * @param config Raw plugin config.
 * @returns A detached validated config with all defaults applied.
 */
export function resolveConfig(config: ZenConfig): ResolvedZenConfig {
  const raw = config as Partial<ZenConfig>
  if (typeof raw.section !== 'string' || raw.section.trim() === '') {
    throw new Error('ZenConfig needs a non-empty string `section`')
  }
  const known = ['section', 'face', 'timeoutSteps', 'requireEvidence', 'triage', 'faceSelection', 'diet', 'promoteDeny', 'enabled']
  const unknown = Object.keys(config).filter(key => !known.includes(key))
  if (unknown.length > 0) {
    throw new Error(`ZenConfig has unknown key(s) ${unknown.join(', ')} — config is { section, face?, timeoutSteps?, requireEvidence?, triage?, faceSelection?, diet?, promoteDeny?, enabled? }`)
  }
  const face = raw.face ?? ['bash', 'str_replace_editor', 'todo_write']
  if (!Array.isArray(face) || face.length === 0
    || face.some(name => typeof name !== 'string' || name.trim() === '')) {
    throw new Error('ZenConfig `face` must be a non-empty list of non-empty tool names')
  }
  if (new Set(face).size !== face.length) {
    throw new Error('ZenConfig `face` must not repeat tool names')
  }
  if (face.includes(ZEN_ANCHOR)) {
    throw new Error(`ZenConfig \`face\` must not name '${ZEN_ANCHOR}' — the anchor tool is agent-scoped and always visible in the zen phase`)
  }
  const timeoutSteps = raw.timeoutSteps ?? 4
  if (!Number.isInteger(timeoutSteps) || timeoutSteps <= 0) {
    throw new Error('ZenConfig `timeoutSteps` must be a positive integer')
  }
  if (raw.requireEvidence !== undefined && typeof raw.requireEvidence !== 'boolean') {
    throw new Error('ZenConfig `requireEvidence` must be a boolean')
  }
  const triageRaw = raw.triage ?? {}
  const triageUnknown = Object.keys(triageRaw).filter(key => key !== 'enabled' && key !== 'maxChars')
  if (triageUnknown.length > 0) {
    throw new Error(`ZenConfig \`triage\` has unknown key(s) ${triageUnknown.join(', ')} — triage is { enabled?, maxChars? }`)
  }
  if (triageRaw.enabled !== undefined && typeof triageRaw.enabled !== 'boolean') {
    throw new Error('ZenConfig `triage.enabled` must be a boolean')
  }
  const maxChars = triageRaw.maxChars ?? 80
  if (!Number.isInteger(maxChars) || maxChars <= 0) {
    throw new Error('ZenConfig `triage.maxChars` must be a positive integer')
  }
  if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') {
    throw new Error('ZenConfig `enabled` must be a boolean')
  }
  const faceSelectionRaw = raw.faceSelection ?? {}
  const faceSelectionUnknown = Object.keys(faceSelectionRaw).filter(key => key !== 'enabled')
  if (faceSelectionUnknown.length > 0) {
    throw new Error(`ZenConfig \`faceSelection\` has unknown key(s) ${faceSelectionUnknown.join(', ')} — faceSelection is { enabled? }`)
  }
  if (faceSelectionRaw.enabled !== undefined && typeof faceSelectionRaw.enabled !== 'boolean') {
    throw new Error('ZenConfig `faceSelection.enabled` must be a boolean')
  }
  let diet: { maxDescriptionChars: number } | undefined
  if (raw.diet !== undefined) {
    const dietUnknown = Object.keys(raw.diet).filter(key => key !== 'maxDescriptionChars')
    if (dietUnknown.length > 0) {
      throw new Error(`ZenConfig \`diet\` has unknown key(s) ${dietUnknown.join(', ')} — diet is { maxDescriptionChars }`)
    }
    const maxDescriptionChars = raw.diet.maxDescriptionChars
    if (!Number.isInteger(maxDescriptionChars) || maxDescriptionChars <= 0) {
      throw new Error('ZenConfig `diet.maxDescriptionChars` must be a positive integer')
    }
    diet = { maxDescriptionChars }
  }
  const promoteDeny = raw.promoteDeny ?? []
  if (!Array.isArray(promoteDeny)
    || promoteDeny.some(name => typeof name !== 'string' || name.trim() === '')) {
    throw new Error('ZenConfig `promoteDeny` must be a list of non-empty tool names')
  }
  if (new Set(promoteDeny).size !== promoteDeny.length) {
    throw new Error('ZenConfig `promoteDeny` must not repeat tool names')
  }
  if (promoteDeny.includes(ZEN_ANCHOR)) {
    throw new Error(`ZenConfig \`promoteDeny\` must not name '${ZEN_ANCHOR}'`)
  }
  if (promoteDeny.some(name => face.includes(name))) {
    throw new Error('ZenConfig `promoteDeny` must not repeat a name from `face`')
  }
  return {
    section: raw.section,
    face: [...face],
    timeoutSteps,
    requireEvidence: raw.requireEvidence ?? true,
    triage: { enabled: triageRaw.enabled ?? true, maxChars },
    faceSelection: { enabled: faceSelectionRaw.enabled ?? false },
    diet,
    promoteDeny: [...promoteDeny],
    enabled: raw.enabled ?? true,
  }
}

/**
 * The zen phase in force after the first `end` events. The last `zen/phase`
 * wins; a prefix with none folds to `'full'` (never armed).
 *
 * @param events The session log or any prefix of it.
 * @param end Fold `events[0, end)`; defaults to the whole log.
 * @returns The folded phase.
 */
export function foldZenPhase(events: readonly SessionEvent[], end = events.length): ZenPhase {
  let phase: ZenPhase = 'full'
  let index = 0
  for (const event of events) {
    if (index >= end) break
    index++
    if (event.type === 'zen/phase') phase = event.data.phase
  }
  return phase
}

/**
 * Reconstruct the last model-visible zen face from `request/header`.
 * `zen_anchor` is agent-scoped and not part of `face`.
 * @param events - session log (or a seed).
 * @param fallback - deployment `face` when no header has been logged yet.
 * @returns the frozen allow-list to reinstall on resume.
 */
function faceFromLog(events: readonly SessionEvent[], fallback: readonly string[]): readonly string[] {
  let names: string[] | undefined
  for (const event of events) {
    if (event.type !== 'request/header') continue
    names = (event.data.header.tools ?? []).map(tool => tool.name).filter(name => name !== ZEN_ANCHOR)
  }
  return names === undefined || names.length === 0 ? fallback : names
}

/** Whether the log holds any `zen/phase` event (armed at least once). */
function hasZenEvents(events: readonly SessionEvent[]): boolean {
  return events.some(event => event.type === 'zen/phase')
}

/**
 * Whether the conversation has reached the model at least once. The first
 * request always logs its `request/header` (reason `'initial'`), so presence
 * is the signal; counting would undercount because later requests log only on
 * header change.
 */
function conversationStarted(events: readonly SessionEvent[]): boolean {
  return events.some(event => event.type === 'request/header')
}

/** Count of started steps (`step/start` events) — the zen step budget's meter. */
function stepCount(events: readonly SessionEvent[]): number {
  let count = 0
  for (const event of events) {
    if (event.type === 'step/start') count++
  }
  return count
}

/** Tool names whose successful results do not count as anchor evidence (pure bookkeeping). */
const NON_EVIDENCE_TOOLS: ReadonlySet<string> = new Set(['todo_write', ZEN_ANCHOR])

/** Join a user message's text blocks; non-text blocks contribute nothing. */
function messageText(message: UserMessage): string {
  return message.content.map(block => block.type === 'text' ? block.text : '').join('')
}

/**
 * Whether the log holds at least one successful non-bookkeeping tool result —
 * the model touched the world and got a real answer back.
 *
 * @param events The session log.
 * @returns Whether anchor evidence exists.
 */
export function hasAnchorEvidence(events: readonly SessionEvent[]): boolean {
  const callNames = new Map<string, string>()
  for (const event of events) {
    if (event.type === 'tool/call') {
      callNames.set(String(event.data.callId), event.data.name)
      continue
    }
    if (event.type !== 'tool/result') continue
    const block = event.data.message.content[0]
    if (block?.type !== 'tool-result' || block.isError === true) continue
    const name = callNames.get(String(event.data.message.source.callId))
    if (name !== undefined && !NON_EVIDENCE_TOOLS.has(name)) return true
  }
  return false
}

const ANCHOR_DESCRIPTION
  = 'Use only in the zen phase (the toolset is reduced while you anchor the task). '
  + 'After at least one read-only probe, call this ONCE to state your task frame and unlock the full toolset: '
  + 'goal — the task in your own words, one sentence; '
  + 'landmarks — 2-4 concrete anchors you will steer by (files, commands, acceptance checks); '
  + 'pass — fast (1-2 steps) | full (multi-step) | loop (long-horizon); '
  + 'forbidden — what this task must NOT touch (optional).'

/** Per-agent live installations (restrict swapped on promotion; both lifted on unload). */
interface ZenInstall {
  /** Lifts the current restriction (zen allow, or post-promotion deny). */
  restrict?: () => void
  /** Unregisters the agent-scoped anchor tool. */
  anchor: () => void
  /** The frozen allow-list while zen is armed (alt-0, or the one-shot selection). */
  face: readonly string[]
}

/**
 * `ctx.zen`: owns the logged zen phase, the anchored tool face, the
 * `zen:policy` section, the `zen_anchor` tool, and the three promotion
 * predicates (anchor, step-budget timeout, first-message triage). UIs observe
 * committed flips through `session/event`; there is no live mirror.
 */
export class ZenPhaseService extends Service {
  static inject = ['tools', 'systemPrompt']

  /** Validated deployment policy with defaults materialized. */
  private readonly config: ResolvedZenConfig

  /** Live installations per armed agent; entries leave on promotion/disposal. */
  private readonly installs = new Map<Agent, ZenInstall>()

  constructor(ctx: Context, config: ZenConfig = { section: '' }) {
    super(ctx, 'zen')
    this.config = resolveConfig(config)
    if (!this.config.enabled) return

    ctx.systemPrompt.section({
      name: 'zen:policy',
      order: 48,
      text: (context) => {
        if (context.agent === undefined) return ''
        return foldZenPhase(context.agent.session.events) === 'zen' ? this.config.section : ''
      },
    })

    if (this.config.diet !== undefined) {
      const maxDescriptionChars = this.config.diet.maxDescriptionChars
      ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
        const assembled = await next()
        return {
          ...assembled,
          tools: assembled.tools.map(tool => ({
            ...tool,
            description: clipDescription(tool.description, maxDescriptionChars),
          })),
        }
      })
    }

    // Defense in depth behind the restriction: the guard folds the committed
    // log, so even if the live restrict bookkeeping and the logged phase ever
    // disagree, no non-face tool executes while the log still says zen.
    // Guards cannot be overturned by later listeners.
    ctx.effect(() => ctx.tools.guard((exec) => {
      if (exec.name === ZEN_ANCHOR) return undefined
      const agent = exec.agent
      if (agent === undefined) return undefined
      if (foldZenPhase(agent.session.events) !== 'zen') return undefined
      const face = this.installs.get(agent)?.face ?? this.config.face
      if (face.includes(exec.name)) return undefined
      return `the zen phase is active: '${exec.name}' is locked. `
        + `Anchor the task first — probe a landmark with the reduced toolset, then call ${ZEN_ANCHOR}.`
    }), 'dsh-zen: lock non-face tools while the logged phase is zen')

    // Arm at agent/created: it precedes the driver and the first assembly, so
    // the first request/header already carries the anchored face, and — unlike
    // agent/session-start, whose listener errors are contained — a synchronous
    // throw vetoes publication, so a face misconfiguration (unknown tool name
    // in `face`) fails creation loud instead of silently skipping the phase.
    ctx.on('agent/created', ({ agent }) => {
      if (agent.session.header.parentSession !== undefined) return
      this.assertPromoteDenyRegistered()
      const anchor = agent.ctx.tools.register(this.anchorTool())
      const events = agent.session.events
      if (foldZenPhase(events) === 'zen') {
        // Resume or fork mid-zen: reinstall the face the log last showed
        // (one-shot selection survives in request/header; a pre-request seed
        // has none yet and falls back to the deployment face).
        const face = faceFromLog(events, this.config.face)
        this.installs.set(agent, { restrict: this.installRestrict(agent, face), anchor, face })
        return
      }
      if (hasZenEvents(events) || conversationStarted(events)) {
        // Promoted history or a mid-conversation fork: reinstall the curated
        // top face (deny list, or unrestricted when the list is empty).
        this.installs.set(agent, {
          anchor,
          face: this.config.face,
          restrict: this.installPromoteRestrict(agent),
        })
        return
      }
      const restrict = this.installRestrict(agent)
      this.installs.set(agent, { restrict, anchor, face: this.config.face })
      agent.session.append('zen/phase', { phase: 'zen', reason: 'arm' })
    })

    ctx.on('agent/disposed', ({ agent }) => {
      // The agent scope already tore down its own registrations; only drop the
      // bookkeeping so unload never re-disposes a dead scope's effects.
      this.installs.delete(agent)
    })

    // Triage runs on the first real user message, which arrives after arming
    // and before the driver claims it, so a skip lands before the first
    // assembly and the model never sees the zen face.
    ctx.on('agent/inbox/inserted', ({ agent, message }) => {
      if (this.installs.get(agent)?.restrict === undefined) return
      const events = agent.session.events
      if (foldZenPhase(events) !== 'zen' || conversationStarted(events)) return
      if (this.config.faceSelection.enabled) {
        this.specializeFace(agent, message)
        return
      }
      if (!this.config.triage.enabled) return
      if (this.isFastTask(message)) this.promote(agent, 'triage')
    })

    // Step-budget timeout: pre-step is outside Session.append publication, so
    // the promotion event can land here; the unlock is visible on the next
    // assembly, and the narration joins this step's messages. The current
    // step's index is the logged step/start count plus one (its own step/start
    // has not landed yet); promotion fires on the budget's final step.
    ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
      const decision = await next()
      if (decision.kind === 'reject' || signal.aborted) return decision
      if (this.config.faceSelection.enabled) return decision
      if (this.installs.get(agent)?.restrict === undefined) return decision
      if (foldZenPhase(agent.session.events) !== 'zen') return decision
      if (stepCount(agent.session.events) + 1 < this.config.timeoutSteps) return decision
      try {
        this.promote(agent, 'timeout')
      } catch (error) {
        ctx.logger.warn('dsh-zen: timeout promotion failed: %o', error)
        return decision
      }
      return { ...decision, messages: [...decision.messages, this.timeoutNarration()] }
    })

    // Unload while agents live: lift every remaining installation so no
    // session is left restricted with nobody able to promote it.
    ctx.effect(() => () => {
      for (const install of this.installs.values()) {
        install.restrict?.()
        install.anchor()
      }
      this.installs.clear()
    }, 'dsh-zen: lift live zen installations on unload')
  }

  /**
   * Read the folded zen phase of an agent's session.
   *
   * @param agent The agent to read.
   * @returns `'zen'` while the anchored face is in force, else `'full'`.
   */
  phase(agent: Agent): ZenPhase {
    return foldZenPhase(agent.session.events)
  }

  /** Install the anchored-face restriction on the agent's scope. */
  private installRestrict(agent: Agent, face: readonly string[] = this.config.face): () => void {
    return agent.ctx.tools.restrict({ allow: [...face] })
  }

  /**
   * Fail loud when `promoteDeny` names a tool this deployment did not register.
   * Called at `agent/created` so a bad deny list cannot wait until promotion.
   */
  private assertPromoteDenyRegistered(): void {
    if (this.config.promoteDeny.length === 0) return
    const registered = new Set(this.ctx.tools.schemas().map(schema => schema.name))
    const unknown = this.config.promoteDeny.filter(name => !registered.has(name))
    if (unknown.length === 0) return
    throw new Error(
      `tools.restrict() names unknown global tool${unknown.length > 1 ? 's' : ''} `
      + unknown.map(name => `"${name}"`).join(', '),
    )
  }

  /**
   * Install the curated top-face restriction, or nothing when `promoteDeny` is empty.
   * @returns the disposer, or `undefined` when the promoted face is unrestricted.
   */
  private installPromoteRestrict(agent: Agent): (() => void) | undefined {
    if (this.config.promoteDeny.length === 0) return undefined
    return agent.ctx.tools.restrict({ deny: [...this.config.promoteDeny] })
  }

  /**
   * Freeze a task-conditioned face from the first user message: lift the
   * alt-0 restriction and reinstall the selected allow-list. No-op when the
   * extras add nothing. Unknown extras (not registered globally) are dropped.
   */
  private specializeFace(agent: Agent, message: UserMessage): void {
    if (message.source.kind !== 'user') return
    const extras = selectFaceExtras(messageText(message))
    const registered = new Set(this.ctx.tools.schemas().map(schema => schema.name))
    const face = selectedFace(this.config.face, extras, registered)
    if (face.length === this.config.face.length && face.every((name, index) => name === this.config.face[index])) {
      return
    }
    const install = this.installs.get(agent)
    if (install?.restrict === undefined) return
    install.restrict()
    install.restrict = this.installRestrict(agent, face)
    install.face = face
  }

  /**
   * Promote the session to the full face: log the flip, lift the zen allow
   * list, then install `promoteDeny` when set. Append-first ordering keeps
   * log and face consistent when the append fails (both stay zen).
   * Idempotent on an already-promoted session.
   */
  private promote(agent: Agent, reason: Exclude<ZenTransitionReason, 'arm'>): void {
    if (foldZenPhase(agent.session.events) !== 'zen') return
    agent.session.append('zen/phase', { phase: 'full', reason })
    const install = this.installs.get(agent)
    install?.restrict?.()
    if (install === undefined) return
    const deny = this.installPromoteRestrict(agent)
    if (deny === undefined) delete install.restrict
    else install.restrict = deny
  }

  /** Whether the first user message reads as a trivially short task (triage skip). */
  private isFastTask(message: UserMessage): boolean {
    if (message.source.kind !== 'user') return false
    if (!message.content.every(block => block.type === 'text')) return false
    const text = messageText(message)
    return text.trim() !== '' && text.length <= this.config.triage.maxChars && !text.includes('\n')
  }

  /** The injected notice accompanying a step-budget promotion. */
  private timeoutNarration(): UserMessage {
    const text = 'Zen phase ended (step budget reached); the full toolset unlocks from your next step.'
    return createUserMessage({
      content: [{ type: 'text', text }],
      // The narration is already one sentence, so it is its own summary.
      source: { kind: 'plugin', plugin: 'zen', form: 'notice', summary: text },
    })
  }

  /** Build the agent-scoped anchor tool bound to this service's predicates. */
  private anchorTool(): ToolDefinition {
    return defineTool({
      name: ZEN_ANCHOR,
      description: ANCHOR_DESCRIPTION,
      parameters: {
        goal: { type: 'string', required: true, description: 'The task in your own words, one sentence.' },
        landmarks: {
          type: 'array',
          items: { type: 'string' },
          required: true,
          description: '2-4 concrete anchors to steer by: files, commands, acceptance checks.',
        },
        pass: {
          type: 'string',
          enum: ['fast', 'full', 'loop'],
          required: true,
          description: 'Expected depth: fast (1-2 steps), full (multi-step), loop (long-horizon).',
        },
        forbidden: { type: 'string', description: 'What this task must NOT touch.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            unlocked: { type: 'boolean', const: true, required: true },
          },
        },
        render: () => [{
          type: 'text',
          text: 'Anchor accepted — the full toolset unlocks from your next step. Steer by your landmarks and verify before you conclude.',
        }],
      },
      execute: (args, exec) => {
        const agent = exec.agent
        if (agent === undefined) throw new Error(`${ZEN_ANCHOR} requires a calling agent (no session to promote)`)
        if (foldZenPhase(agent.session.events) !== 'zen') {
          throw new Error(`${ZEN_ANCHOR} is only available during the zen phase; the full toolset is already unlocked`)
        }
        if (this.config.faceSelection.enabled) {
          throw new Error(`${ZEN_ANCHOR} cannot change the face: this session froze its tool face on the first message`)
        }
        if (args.goal.trim() === '') throw new Error(`${ZEN_ANCHOR} needs a non-empty goal`)
        const landmarks = args.landmarks.map(landmark => landmark.trim()).filter(landmark => landmark !== '')
        if (landmarks.length < 2 || landmarks.length > 4) {
          throw new Error(`${ZEN_ANCHOR} needs 2-4 non-empty landmarks (got ${landmarks.length})`)
        }
        if (this.config.requireEvidence && !hasAnchorEvidence(agent.session.events)) {
          throw new Error('anchor rejected: verify one landmark first with a read-only probe '
            + '(e.g. bash ls / cat / git status), then call zen_anchor again')
        }
        this.promote(agent, 'anchor')
        return Promise.resolve({ unlocked: true as const })
      },
      presentCall: args => ({
        card: 'generic',
        title: `Zen anchor: ${args.goal}`,
        kind: 'other',
        content: [{
          type: 'text',
          text: [
            `goal: ${args.goal}`,
            `landmarks:\n${args.landmarks.map(landmark => `- ${landmark}`).join('\n')}`,
            `pass: ${args.pass}`,
            ...args.forbidden === undefined ? [] : [`forbidden: ${args.forbidden}`],
          ].join('\n'),
        }],
      }),
      presentResult: (_args, result) => ({
        card: 'generic',
        title: 'Zen anchor',
        content: result.content,
      }),
    })
  }
}

export default ZenPhaseService
