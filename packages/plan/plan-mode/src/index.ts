/**
 * Plan mode is logged per-agent collaboration state: while active, a
 * deployment-owned guidance section shapes each model request, and
 * `exit_plan_mode` presents the completed plan for user review, while the
 * `/plan off` command lets a user leave directly. Plan mode is independent of
 * sandbox mode and approval policy; those enforcement axes do not read or
 * write plan state.
 *
 * While plan mode is active, a monotonic tool guard denies the mutation-tool
 * families (fs writes, git commits, persistent-terminal control) at the
 * registry boundary — the prompt section advises, the guard enforces. Shell
 * exploration (bash/pwsh) stays available like Claude Code's plan mode; the
 * residual shell-write hole rides on the orthogonal sandbox axis and is
 * documented in the Agent Note. The presented plan is also persisted to a
 * plan file under the harness home and recorded as a log-only `plan/file`
 * event, so approved plans survive compaction and can be re-read later.
 *
 * The state in force is folded from the session log (`plan/mode`, last one
 * wins), so resume and fork restore it without a live mirror. User selections
 * are held as pending intent until an in-turn step boundary. The service
 * projects pending intent into the proposed step assembly, then flushes it
 * from `agent/pre-step` only when the step is accepted. Same-step request
 * retries reuse their assembly.
 *
 * The exit tool remains registered while plan mode is inactive so crossing a
 * boundary changes only the prompt section, not the request tool catalog.
 *
 * Agent Note:
 * - .agents/notes/implemented/simplification/2026-07-22-plan-specific-collaboration-state.md
 *
 * @module @huiliyi37/dsh-plan-mode
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Context, Service } from '@huiliyi37/cordis'
import { z as zod } from 'zod'
import type { ZodType } from 'zod'
import type { Agent, PreStepDecision } from '@huiliyi37/dsh-agent'
import { createUserMessage } from '@huiliyi37/dsh-llm'
import type { Session, SessionEvent, UserMessage } from '@huiliyi37/dsh-session'
import { defineTool } from '@huiliyi37/dsh-tools'
import type {} from '@huiliyi37/dsh-system-prompt'
import { dshHomePath } from '@huiliyi37/dsh-paths'
import { UserInteractionError } from '@huiliyi37/dsh-user-interaction'
// Type-only edge: resolves `ctx.commands` for the optional command child.
import type {} from '@huiliyi37/dsh-commands'
import type { CommandId } from '@huiliyi37/dsh-commands/brand'
// Type-only: resolves ctx.sessionProjections for the optional unit child.
import type {} from '@huiliyi37/dsh-session-projection'
import type { PlanProjection } from './types.ts'
// The `plan` projection-key declaration lives in src/types.ts (its one home);
// this re-export projects the type face onto the package root AND keeps the
// module edge in the emitted index.d.ts, so aggregate programs consuming the
// declarations still receive the SessionProjectionMap merge.
export type * from './types.ts'

declare module '@huiliyi37/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Whether plan mode is in force from this point on: log-only, non-surface,
     * whole-value replace. The last `plan/mode` wins; a log with none folds to
     * inactive through {@link foldPlanMode}.
     */
    'plan/mode': { active: boolean }
    /**
     * A presented plan was persisted to a plan file: log-only audit carrying
     * the absolute `path` written and the plan's first `heading`. Appended
     * when `exit_plan_mode` is called, whether the review approves or keeps
     * planning, so every reviewable draft remains recoverable after
     * compaction; it never enters the model surface or derived history.
     */
    'plan/file': { path: string; heading: string }
  }
}

declare module '@huiliyi37/cordis' {
  interface Context {
    planMode: PlanModeService
  }
}

/**
 * The model-facing exit tool's name. It stays registered while plan mode is
 * inactive so the request tool catalog is stable across transitions.
 */
export const EXIT_PLAN_MODE = 'exit_plan_mode'

/** Deployment-owned plan guidance. */
export interface PlanModeConfig {
  /** Guidance rendered as the `plan:policy` prompt section while plan mode is active. */
  section: string
  /**
   * Extra tool names the plan-mode guard denies on top of the built-in
   * mutation families (fs writes, git commits, persistent-terminal control).
   * Shell exploration (bash/pwsh) is intentionally not blocked by default —
   * list them here for a stricter deployment.
   */
  blockedTools?: readonly string[]
}

/** The review question's id, echoed in the answer this tool reads. */
const REVIEW_ID = 'plan-review'

/** The review question's approve option label. */
const APPROVE_LABEL = 'Approve'

/** The review question's keep-planning option label. */
const KEEP_PLANNING_LABEL = 'Keep planning'

/**
 * Tool names the plan-mode guard always denies while plan mode is active.
 * `str_replace_editor` is discriminated by its `command` argument in
 * {@link isPlanModeBlocked}: only the mutating commands are denied.
 */
const PLAN_BLOCKED_TOOLS: ReadonlySet<string> = new Set([
  'write',
  'edit',
  'str_replace_editor',
  'git_commit',
  'terminal_open',
  'terminal_send',
  'terminal_signal',
  'terminal_close',
])

/** The `str_replace_editor` commands that mutate files; `view` stays allowed. */
const PLAN_BLOCKED_EDITOR_COMMANDS: ReadonlySet<string> = new Set(['create', 'str_replace', 'insert'])

/**
 * Whether the guard denies this call while plan mode is active. The shell
 * tools (bash/pwsh) are deliberately absent: plan mode keeps read-only shell
 * exploration (Claude Code's plan semantics), and the residual shell-write
 * hole rides on the orthogonal sandbox axis.
 *
 * @param name - the tool being called.
 * @param args - the call's arguments (read for `str_replace_editor`'s command).
 * @param extra - deployment-added names from {@link PlanModeConfig.blockedTools}.
 * @returns whether the call is denied.
 */
function isPlanModeBlocked(name: string, args: unknown, extra: ReadonlySet<string>): boolean {
  if (extra.has(name)) return true
  if (!PLAN_BLOCKED_TOOLS.has(name)) return false
  if (name !== 'str_replace_editor') return true
  const command = (args as { command?: unknown } | null)?.command
  return typeof command === 'string' && PLAN_BLOCKED_EDITOR_COMMANDS.has(command)
}

/** One path segment's safe encoding: alphanumerics and `._-` pass, the rest become `~XXXX`. */
function encodePathSegment(value: string): string {
  let out = ''
  for (const ch of value) {
    const code = ch.codePointAt(0)
    out += /^[A-Za-z0-9._-]$/.test(ch) || code === undefined ? ch : `~${code.toString(16).toUpperCase().padStart(4, '0')}`
  }
  return out || 'root'
}

/** The plan file's slug from its first heading: lowercase words joined by `-`, capped. */
function planSlug(heading: string | undefined): string {
  if (heading === undefined) return 'plan'
  const slug = heading.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
  return slug === '' ? 'plan' : slug
}

const EXIT_DESCRIPTION
  = 'Use only in plan mode. Present your plan for the user\'s review and, on approval, leave plan mode. '
  + 'Send the COMPLETE plan as markdown, starting with a # heading that names it. '
  + 'The user may approve (carry out the plan from your next step) or keep '
  + 'planning — their feedback comes back in the tool result; revise and present again.'

/** The plan's first markdown heading (any level), or `undefined` when it has none. */
function firstHeading(plan: string): string | undefined {
  for (const line of plan.split('\n')) {
    const match = /^#{1,6}\s+(.+?)\s*$/.exec(line)
    if (match) return match[1]
  }
  return undefined
}

/**
 * Validate deployment-owned plan guidance. Missing, blank, non-string, or
 * unknown fields fail at plugin load rather than silently shaping nothing.
 *
 * @param config Raw plugin config.
 * @returns A detached validated config.
 */
export function resolveConfig(config: PlanModeConfig): PlanModeConfig {
  const section = (config as Partial<PlanModeConfig>).section
  if (typeof section !== 'string') {
    throw new Error('PlanModeConfig needs a string `section`')
  }
  if (section.trim() === '') {
    throw new Error('PlanModeConfig needs a non-empty `section`')
  }
  const unknown = Object.keys(config).filter(key => key !== 'section' && key !== 'blockedTools')
  if (unknown.length > 0) {
    throw new Error(`PlanModeConfig has unknown key(s) ${unknown.join(', ')} — config is { section, blockedTools? }`)
  }
  const blockedTools = (config as Partial<PlanModeConfig>).blockedTools
  if (blockedTools !== undefined) {
    if (!Array.isArray(blockedTools) || blockedTools.some(name => typeof name !== 'string' || name.trim() === '')) {
      throw new Error('PlanModeConfig `blockedTools` must be a list of non-empty tool names')
    }
  }
  // Re-annotate past the Array.isArray any[] narrowing before the detach spread.
  const detached: readonly string[] | undefined = blockedTools
  return detached === undefined ? { section } : { section, blockedTools: [...detached] }
}

/**
 * Whether plan mode is active after the first `end` events. The last
 * `plan/mode` wins; a prefix with none is inactive.
 *
 * @param events The session log or any prefix of it.
 * @param end Fold `events[0, end)`; defaults to the whole log.
 * @returns Whether plan mode is active.
 */
export function foldPlanMode(events: readonly SessionEvent[], end = events.length): boolean {
  let active = false
  let index = 0
  for (const event of events) {
    if (index >= end) break
    index++
    if (event.type === 'plan/mode') active = event.data.active
  }
  return active
}

/**
 * Projection unit state: the logged mode, the latest successful `/plan`
 * selection not yet resolved by a `plan/mode` commit, and an execution whose
 * paired `command/done` has not settled. Plain JSON (persisted-cache
 * precondition).
 */
interface PlanUnitState {
  active: boolean
  /** The selection's target mode; null when no selection is outstanding. */
  wanted: boolean | null
  /** The latest plan command awaiting its paired settlement. */
  running: { commandId: CommandId; wanted: boolean } | null
}

/** Wire payload schema of the `plan` projection. */
const planProjectionSchema: ZodType<PlanProjection> = zod.object({
  active: zod.boolean(),
  pending: zod.boolean(),
})

/** Whether the log holds an opened turn without its closing `turn/end`. */
function hasOpenTurn(events: readonly SessionEvent[]): boolean {
  let open = false
  for (const event of events) {
    if (event.type === 'turn/start') open = true
    else if (event.type === 'turn/end') open = false
  }
  return open
}

/** Plan state at the last logged request header, or `undefined` before the first header. */
function planModeAtLastHeader(events: readonly SessionEvent[]): boolean | undefined {
  let lastHeader = -1
  let index = 0
  for (const event of events) {
    if (event.type === 'request/header') lastHeader = index
    index++
  }
  if (lastHeader < 0) return undefined
  return foldPlanMode(events, lastHeader + 1)
}

/**
 * `ctx.planMode`: owns logged plan state, boundary application and narration,
 * the `plan:policy` section, the `/plan` command, and the stable exit tool.
 * UIs observe committed flips through `session/event`; there is no live mirror.
 */
export class PlanModeService extends Service {
  static inject = ['tools', 'systemPrompt']

  /** Validated deployment-owned guidance. */
  private readonly section: string

  /** Deployment-added guard denials from {@link PlanModeConfig.blockedTools}. */
  private readonly extraBlockedTools: ReadonlySet<string>

  /**
   * Latest selection per session awaiting an in-turn request-boundary flush.
   * `narrate` is true for user selections and false for the exit tool, whose
   * result already narrates the transition.
   */
  private readonly pendingIntents = new WeakMap<Session, { active: boolean; narrate: boolean }>()

  constructor(ctx: Context, config: PlanModeConfig = { section: '' }) {
    super(ctx, 'planMode')
    const resolved = resolveConfig(config)
    this.section = resolved.section
    this.extraBlockedTools = new Set(resolved.blockedTools ?? [])
    let disposed = false
    // The hard half of plan mode: a monotonic registry guard denying the
    // mutation-tool families while the logged state is active. It reads the
    // committed log only — a pending mid-turn entry must not break the running
    // turn's legitimate writes, and an approved exit's own batch stays guided
    // by the "from the next step" contract. Guards cannot be overturned by
    // later listeners, so no deployment or hook accidentally re-allows a write.
    ctx.effect(() => ctx.tools.guard((exec) => {
      const agent = exec.agent
      if (agent === undefined) return undefined
      if (!foldPlanMode(agent.session.events)) return undefined
      if (!isPlanModeBlocked(exec.name, exec.arguments, this.extraBlockedTools)) return undefined
      return `plan mode is active: '${exec.name}' is blocked. `
        + 'Explore with read-only tools and present the plan with exit_plan_mode when ready.'
    }), 'dsh-plan-mode: guard mutation tools in plan mode')
    // Pre-step is outside Session.append publication, so its log-only mode
    // event can land between turns or inside an open turn without re-entering
    // the session. A failed append remains pending for a later boundary, and
    // policy cannot block the step.
    ctx.on('agent/pre-step', async (
      { agent, signal },
      next,
    ): Promise<PreStepDecision> => {
      const decision = await next()
      const pending = this.pendingIntents.get(agent.session)
      if (decision.kind === 'reject' || signal.aborted || pending === undefined) return decision
      const narration = this.narration(agent.session, pending.active)
      try {
        this.onBoundary(agent.session)
      } catch (error) {
        ctx.logger.warn('dsh-plan-mode: boundary flush failed: %o', error)
        return decision
      }
      return !pending.narrate || narration === undefined
        ? decision
        : { ...decision, messages: [...decision.messages, narration] }
    })
    ctx.effect(() => () => { disposed = true }, 'dsh-plan-mode: close service lifetime')

    ctx.systemPrompt.section({
      name: 'plan:policy',
      order: 50,
      text: (context) => {
        if (context.agent === undefined) return ''
        const pending = this.pendingIntents.get(context.agent.session)
        return (pending?.active ?? foldPlanMode(context.agent.session.events)) ? this.section : ''
      },
    })

    // The plan projection unit (session-projection RFC): a pure event fold
    // serving clients the whole {active, pending} value. `command/run`
    // records the user's logged /plan selection, its paired `command/done`
    // keeps only successful selections, and `plan/mode` records that
    // selection and clears it. Pending is thereby a pure
    // replay quantity: host restarts, other tabs, and cold reads all recover
    // it from the log alone. The unit child activates only when a projection
    // registry is composed (headless assemblies stay unaffected).
    ctx.inject(['sessionProjections'], (projectionCtx) => {
      projectionCtx.sessionProjections.register<'plan', PlanUnitState>({
        key: 'plan',
        schema: planProjectionSchema,
        init: () => ({ active: false, wanted: null, running: null }),
        apply: (state, event) => {
          if (event.type === 'command/run' && event.data.name === 'plan') {
            if (event.data.args === undefined) return state
            const wanted = event.data.args.trim() !== 'off'
            return { ...state, running: { commandId: event.data.commandId, wanted } }
          }
          if (event.type === 'command/done' && event.data.commandId === state.running?.commandId) {
            const wanted = event.data.kind === 'success' && state.running.wanted !== state.active
              ? state.running.wanted
              : null
            return { ...state, wanted, running: null }
          }
          if (event.type === 'plan/mode') {
            return { ...state, active: event.data.active, wanted: null }
          }
          return state
        },
        view: (state) => {
          const wanted = state.running?.wanted ?? state.wanted
          return { active: state.active, pending: wanted !== null && wanted !== state.active }
        },
        stateVersion: 2,
      })
    })

    // The command child activates only when a command registry is composed.
    ctx.inject(['commands'], (commandCtx) => {
      commandCtx.commands.register({
        name: 'plan',
        description: 'Enter or leave plan mode',
        input: { hint: '[off|message]', images: true },
        handler: ({ agent, rawInput, attachments }) => {
          const message = rawInput.trim()
          if (message === 'off' && attachments.length > 0) {
            return { kind: 'error', text: 'Image attachments cannot accompany /plan off.' }
          }
          if (message === 'off') {
            switch (this.set(agent, false)) {
              case 'committed':
                return { kind: 'success', text: 'Plan mode off.' }
              case 'queued':
                return { kind: 'success', text: 'Leaving plan mode (applies from the next step).' }
              case 'cancelled':
                return { kind: 'success', text: 'Plan mode entry cancelled.' }
              case 'noop':
                // Repeat the queued wording while an exit still awaits its
                // boundary; only a truly inactive session reads idempotent.
                return foldPlanMode(agent.session.events)
                  ? { kind: 'success', text: 'Leaving plan mode (applies from the next step).' }
                  : { kind: 'success', text: 'Plan mode is already inactive.' }
            }
          }
          const outcome = this.set(agent, true)
          if (message !== '' || attachments.length > 0) {
            agent.steer(createUserMessage({
              content: [
                ...attachments,
                ...message === '' ? [] : [{ type: 'text' as const, text: message }],
              ],
              source: { kind: 'user' },
            }))
          }
          return {
            kind: 'success',
            text: outcome === 'committed'
              ? 'Plan mode on. Use /plan off to leave.'
              : 'Entering plan mode (applies from the next step). Use /plan off to leave.',
          }
        },
      })
    })

    ctx.tools.register(defineTool({
      name: EXIT_PLAN_MODE,
      description: EXIT_DESCRIPTION,
      parameters: {
        plan: { type: 'string', required: true, description: 'The complete plan, as markdown, starting with a # heading that names it.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            approved: { type: 'boolean', const: true, required: true },
            path: { type: 'string', description: 'The plan file this approved plan was persisted to.' },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: 'Plan approved — plan mode exited; carry out the plan starting with your next step.'
            + (typeof value.path === 'string' ? ` Plan file: ${value.path}` : ''),
        }],
      },
      execute: async (args, exec) => {
        const agent = exec.agent
        if (agent === undefined) throw new Error(`${EXIT_PLAN_MODE} requires a calling agent (no session to switch)`)
        if (!foldPlanMode(agent.session.events)) {
          throw new Error(`${EXIT_PLAN_MODE} is only available in plan mode`)
        }
        if (!/^#\s+\S/.test(args.plan.trim())) {
          throw new Error(`${EXIT_PLAN_MODE} requires a non-empty markdown plan starting with a # heading`)
        }
        // Persist every presented draft before the review: an approved plan is
        // carried out (and compacted away), a kept-planning one is revised —
        // both stay recoverable from the plan file and its log-only event.
        const planPath = this.persistPlan(agent.session, args.plan)
        const interaction = ctx.get('userInteraction')
        if (interaction === undefined) {
          throw new Error('no user-interaction channel is available to review the plan; ask the user to switch the session mode instead')
        }
        const answer = await interaction.ask({
          questions: [{
            id: REVIEW_ID,
            header: 'Plan review',
            question: 'Approve this plan and leave plan mode?',
            detail: args.plan,
            options: [
              { label: APPROVE_LABEL, description: 'Leave plan mode; the plan is carried out from the next step.' },
              { label: KEEP_PLANNING_LABEL, description: 'Stay in plan mode; feedback goes back to the model.' },
            ],
            // Presentation only: a capable UI renders the plan as a review
            // decision instead of a generic question, and answers with one of
            // the labels above either way.
            intent: { kind: 'plan-review', approve: APPROVE_LABEL },
          }],
          agent,
          signal: exec.signal,
        }).catch((cause: unknown) => {
          // A dismissed review is not a failed one: the user took the turn back
          // to say something the two options do not cover. Say so, because the
          // generic channel message names ask_user_question, which the model
          // never called. An abort (turn cancel, provider teardown) keeps its
          // own message — there is no user to wait for.
          if (cause instanceof UserInteractionError && cause.code === 'ASK_CANCELLED') {
            throw new Error('The user dismissed the plan review to speak instead; '
              + 'stay in plan mode, stop here, and wait for their message.')
          }
          throw cause
        })
        // A review may outlive this plugin fiber. Without boundary listeners,
        // an approved result could never land, so fail and keep planning.
        if (disposed) {
          throw new Error('the plan-mode service was reloaded while the plan was under review; present the plan again')
        }
        const reviewItems = answer.answers.filter(entry => entry.id === REVIEW_ID)
        const item = reviewItems.length === 1 ? reviewItems[0] : undefined
        if (item?.selected.length !== 1 || item.selected[0] !== APPROVE_LABEL || item.custom !== undefined) {
          const feedback = item?.custom ?? ''
          throw new Error(feedback === ''
            ? 'The user chose to keep planning; revise the plan and present it again.'
            : `The user chose to keep planning; their feedback: ${feedback}`)
        }
        // Keep plan guidance for the rest of this assistant tool batch. The
        // silent intent flushes after the step, before the next assembly.
        this.pendingIntents.set(agent.session, { active: false, narrate: false })
        return planPath === undefined ? { approved: true } : { approved: true, path: planPath }
      },
      presentCall: args => ({
        card: 'generic',
        title: firstHeading(args.plan) ?? 'Plan',
        kind: 'other',
        content: [{ type: 'text', text: args.plan }],
      }),
      presentResult: (_args, result) => ({
        card: 'generic',
        title: 'Plan review',
        content: result.content,
      }),
    }))
  }

  /**
   * Read the logged plan state and any selected state awaiting a boundary.
   *
   * @param agent The agent to read.
   * @returns Current logged state plus a pending selection, when present.
   */
  get(agent: Agent): { active: boolean; pending?: boolean } {
    const active = foldPlanMode(agent.session.events)
    const pending = this.pendingIntents.get(agent.session)
    return pending === undefined ? { active } : { active, pending: pending.active }
  }

  /**
   * Select whether plan mode should be active. Between turns the change
   * commits immediately — no request boundary would arrive until the next
   * prompt, so a queued intent would hang (the open-turn fold is the idle
   * signal: agent status stays `running` through post-turn checkpointing,
   * where a boundary equally never comes). During an open turn the
   * selection is held as pending intent for the next in-turn request
   * boundary. Repeated selection of the current or already-pending state is
   * a no-op.
   *
   * @param agent The agent to switch.
   * @param active Whether plan mode should be active.
   * @returns what happened: `committed` (logged now), `queued` (awaiting the
   * next boundary), `cancelled` (an opposite pending selection was cleared;
   * the logged state already matches), or `noop` (already in that state).
   */
  set(agent: Agent, active: boolean): 'committed' | 'queued' | 'cancelled' | 'noop' {
    const session = agent.session
    const pending = this.pendingIntents.get(session)
    const target = pending?.active ?? foldPlanMode(session.events)
    if (active === target) return 'noop'
    if (hasOpenTurn(session.events)) {
      this.pendingIntents.set(session, { active, narrate: true })
      return foldPlanMode(session.events) === active ? 'cancelled' : 'queued'
    }
    // No open turn: commit now. Delete only after append succeeds so a
    // failed durable write leaves the selection retryable, not dropped.
    if (active === foldPlanMode(session.events)) {
      this.pendingIntents.delete(session)
      return 'cancelled'
    }
    session.append('plan/mode', { active })
    this.pendingIntents.delete(session)
    const narration = this.narration(session, active)
    if (narration !== undefined) agent.inject(narration)
    return 'committed'
  }

  /** Flush one pending selection before the next request assembly. */
  private onBoundary(session: Session): void {
    const pending = this.pendingIntents.get(session)
    if (pending === undefined) return
    const target = pending.active
    if (target === foldPlanMode(session.events)) {
      this.pendingIntents.delete(session)
      return
    }
    session.append('plan/mode', { active: target })
    // Delete only after append succeeds so a later boundary can retry a failed
    // durable write.
    this.pendingIntents.delete(session)
  }

  /**
   * Write the presented plan to its plan file under the harness home and
   * append the log-only `plan/file` event. The plugin-private node:fs write
   * (the spill-local/fs-snapshot precedent) never crosses the fs sandbox, so
   * a read-only deployment cannot deadlock the review. Best-effort: a write
   * failure loses only the durable copy, never the review flow.
   *
   * @param session The session the plan belongs to.
   * @param plan The complete presented plan, as markdown.
   * @returns The absolute plan-file path, or `undefined` when writing failed.
   */
  private persistPlan(session: Session, plan: string): string | undefined {
    const heading = firstHeading(plan) ?? 'Plan'
    try {
      const dir = join(dshHomePath('plans'), encodePathSegment(session.header.cwd ?? ''), encodePathSegment(session.id))
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      const path = join(dir, `${planSlug(heading)}.md`)
      writeFileSync(path, plan, 'utf8')
      session.append('plan/file', { path, heading })
      return path
    } catch (error) {
      this.ctx.logger.warn('dsh-plan-mode: plan file persistence failed: %o', error)
      return undefined
    }
  }

  /** Build a user-switch notice when the last logged header described the other mode. */
  private narration(session: Session, target: boolean): UserMessage | undefined {
    const told = planModeAtLastHeader(session.events)
    if (told === undefined || told === target) return
    const text = target
      ? 'The user switched this session to plan mode.'
      : 'The user switched this session back to the default mode.'
    return createUserMessage({
      content: [{ type: 'text', text }],
      // The narration is already one sentence, so it is its own summary.
      source: { kind: 'plugin', plugin: 'plan-mode', form: 'notice', summary: text },
    })
  }
}

export default PlanModeService
