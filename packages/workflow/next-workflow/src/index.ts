/**
 * Human-facing `/next-workflow <objective>` command: a fixed, harness-owned
 * intent pipeline — INTENT → PLAN → CRITIQUE → IMPLEMENT → VERIFY → REVIEW.
 * The harness holds the phase machine; models write the content.
 *
 * Design contract: Agent Note
 * `.agents/notes/implemented/feature/2026-08-17-next-workflow-intent-pipeline.md`.
 *
 * Mechanics:
 * - INTENT, PLAN, CRITIQUE, and REVIEW are one-shot structured-output subagents
 *   over `ctx.subagents`. The critic and reviewer are fresh contexts that see
 *   only the SPEC/PLAN artifacts (plus the review diff), never another phase's
 *   reasoning. When `planCandidates` exceeds 1, PLAN fans out to that many
 *   parallel candidate planners over the same SPEC, and a SELECT phase between
 *   PLAN and CRITIQUE runs an independent fresh-context judge over SPEC plus
 *   the candidate texts — the planner never judges its own work. Phase
 *   artifacts are files under the configured workflows root;
 *   they are the cross-phase handoff besides the bounded gap/finding lists.
 *   INTENT derives the SPEC with a structured-output subagent (rather than
 *   deterministic templating) because a verbatim objective dump adds no
 *   normalization value.
 * - IMPLEMENT steers the invoking session's own agent, so implementation runs
 *   live with the full tool surface and stays visible. VERIFY is the
 *   deterministic configured `verifyCommand` through the `ctx.bash`
 *   request/spec split — never a self-report; without `verifyCommand` the run
 *   reports `unverified` and continues to REVIEW honestly.
 * - While a run is active, an `agent/request` waterfall listener rewrites
 *   `reasoningEffort` per phase from the Config map. Switches happen only at
 *   phase boundaries (the cache-legitimate points), and the pre-run header
 *   effort is restored on the first request after the run. The map only
 *   reaches the main session's requests: `AgentOptions` has no effort channel,
 *   so subagent phases get the default model route (documented limitation).
 * - Phase transitions, artifact paths, and the terminal outcome are log-only
 *   session events (`next-workflow/phase`, `next-workflow/end`); the session
 *   log plus the artifact files reconstruct every model-visible input.
 *
 * @module @huiliyi37/dsh-next-workflow
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@huiliyi37/cordis'
import z from '@huiliyi37/schemastery'
import type { Agent } from '@huiliyi37/dsh-agent'
import type {} from '@huiliyi37/dsh-bash'
import type { BashExecRequest, BashExecutor } from '@huiliyi37/dsh-bash'
import type { CommandInvocation, CommandResult } from '@huiliyi37/dsh-commands'
import type { SessionId } from '@huiliyi37/dsh-session'
import type {} from '@huiliyi37/dsh-git'
import type { Git } from '@huiliyi37/dsh-git'
import { createUserMessage, ReasoningEffortId } from '@huiliyi37/dsh-llm'
import type { LlmCallConfig } from '@huiliyi37/dsh-llm'
import { dshHomePath } from '@huiliyi37/dsh-paths'
import type {} from '@huiliyi37/dsh-subagent'
import type { SubagentResult, SubagentRun, SubagentService } from '@huiliyi37/dsh-subagent'
import type { ObjectJsonSchema } from '@huiliyi37/dsh-tools'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'next-workflow'

/** Only the command registry is injected; every other capability is probed at handler time. */
export const inject = ['commands']

/** The fixed phase machine's phases, in execution order (`select` runs only when `planCandidates` exceeds 1). */
export type NextWorkflowPhase = 'intent' | 'plan' | 'select' | 'critique' | 'implement' | 'verify' | 'review'

/** Every valid {@link NextWorkflowPhase}, used to reject unknown `phaseEfforts` keys at load. */
const PHASE_IDS: readonly NextWorkflowPhase[] = ['intent', 'plan', 'select', 'critique', 'implement', 'verify', 'review']

/** Terminal outcome of one `/next-workflow` run, carried by `next-workflow/end`. */
export type NextWorkflowOutcome = 'completed' | 'failed-verification' | 'failed'

/** Audit payload a `select` phase event carries beyond the common phase fields. */
export interface SelectionAudit {
  /** Candidate plans the judge scored. */
  candidates: number
  /** 1-based index of the winning candidate. */
  winner: number
  /** Why the winner beat the other candidates against the rubric. */
  rationale: string
}

declare module '@huiliyi37/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One `/next-workflow` phase settled. Log-only (never the model surface or
     * derived history); `artifact` points at the on-disk phase handoff, which
     * survives compaction, and `detail` carries a short human summary such as
     * the critique verdict or the verify outcome. A `select` phase additionally
     * carries `selection`, so best-of-N plan selection is auditable from the log.
     */
    'next-workflow/phase': { runId: string; phase: NextWorkflowPhase; artifact?: string; detail?: string; selection?: SelectionAudit }
    /**
     * A `/next-workflow` run settled. Log-only; pairs with its
     * `next-workflow/phase` records by `runId`. `detail` carries the verify
     * disposition (`verified`/`unverified`) or the failure message.
     */
    'next-workflow/end': { runId: string; outcome: NextWorkflowOutcome; detail?: string }
  }
}

/** Deployment policy for the fixed intent pipeline. */
export interface Config {
  /** One-shot structured-output provider for every subagent phase (default `spawn`). */
  provider?: string
  /** Artifact root; one `<run-id>` directory per run holding `SPEC.md`/`PLAN.md`/`REVIEW.md`
   * (plus `PLAN-*.md`/`SELECTION.md` for best-of-N). Default `$DSH_HOME/workflows`. */
  workflowsRoot?: string
  /** Deterministic VERIFY gate command run through the bash executor (default unset: report `unverified`). */
  verifyCommand?: string
  /** Timeout for one `verifyCommand` run in milliseconds (default 120000). */
  verifyTimeoutMs?: number
  /** Maximum critique-driven PLAN revisions (default 1). */
  maxCritiqueRounds?: number
  /** Candidate plans per PLAN round; above 1 an independent fresh-context judge selects the winner (default 1: no selection; maximum 5). */
  planCandidates?: number
  /** Maximum characters of one candidate plan artifact (default 32768; bounds the judge prompt at `planCandidates` × this). */
  maxCandidateChars?: number
  /** Maximum verify-failure retries steered back into IMPLEMENT (default 1). */
  maxVerifyRetries?: number
  /** Per-phase reasoning effort for main-session requests (default plan/critique/review `high`; unset inherit; select rides critique). */
  phaseEfforts?: Record<string, string>
  /** Maximum characters of one phase artifact (default 32768; longer subagent output is truncated). */
  maxArtifactChars?: number
  /** Maximum characters of verify output steered back on failure (default 8192). */
  maxVerifyOutputChars?: number
  /** Maximum characters of the git diff offered to the reviewer (default 32768). */
  maxDiffChars?: number
}

/** Schemastery configuration for the `/next-workflow` command. */
export const Config: z<Config> = z.object({
  provider: z.string().default('spawn'),
  // Empty means "the harness home's workflows directory": the default is a
  // runtime path, while the config catalog walks this schema statically.
  workflowsRoot: z.string().default(''),
  verifyCommand: z.string().default(''),
  verifyTimeoutMs: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(120_000),
  maxCritiqueRounds: z.number().step(1).min(0).max(Number.MAX_SAFE_INTEGER).default(1),
  planCandidates: z.number().step(1).min(1).max(5).default(1),
  maxCandidateChars: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(32_768),
  maxVerifyRetries: z.number().step(1).min(0).max(Number.MAX_SAFE_INTEGER).default(1),
  phaseEfforts: z.dict(z.string()).default({ plan: 'high', critique: 'high', review: 'high' }),
  maxArtifactChars: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(32_768),
  maxVerifyOutputChars: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(8192),
  maxDiffChars: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(32_768),
})

/** Fully resolved configuration: schema defaults plus load-time validation. */
interface ResolvedConfig {
  readonly provider: string
  readonly workflowsRoot: string
  readonly verifyCommand: string | undefined
  readonly verifyTimeoutMs: number
  readonly maxCritiqueRounds: number
  readonly planCandidates: number
  readonly maxCandidateChars: number
  readonly maxVerifyRetries: number
  readonly phaseEfforts: Readonly<Partial<Record<NextWorkflowPhase, ReasoningEffortId>>>
  readonly maxArtifactChars: number
  readonly maxVerifyOutputChars: number
  readonly maxDiffChars: number
}

/** `tui.commands` 斜杠命令注册表最小消费面（不引入 dsh-tui 运行时依赖；reflect 动态获取）。 */
interface TuiSlashFacet {
  register(command: {
    name: string
    description: string
    argsHint?: string
    run(args: TuiSlashRunArgs): void | Promise<void>
  }): void
}

/** TUI 斜杠命令执行参数（与 dsh-tui 的 SlashCommandArgs 对齐的最小面）。 */
interface TuiSlashRunArgs {
  /** 命令名后参数（已 trim；无参数为空串）。 */
  text: string
  /** TUI 运行上下文（agents 已在该上下文注入）。 */
  ctx: TuiRunContext
  /** 当前会话 id；尚未 attach 时为 null。 */
  sessionId: SessionId | null
  /** 回显一行命令结果到 scrollback。 */
  echo: (text: string) => void
}

/** TUI 运行上下文的最小 agents 面。 */
interface TuiRunContext {
  agents?: { get(id: SessionId): Agent | undefined }
}

/** Normalize and validate the deployment config, including direct `apply()` calls outside Loader schema normalization. */
function resolveConfig(config: Config): ResolvedConfig {
  const provider = config.provider ?? 'spawn'
  if (provider.length === 0 || provider !== provider.trim()) {
    throw new TypeError('next-workflow: provider must be a non-empty normalized string')
  }
  const verifyCommandRaw = config.verifyCommand ?? ''
  const verifyCommand = verifyCommandRaw.trim().length === 0 ? undefined : verifyCommandRaw
  const bounds = {
    verifyTimeoutMs: config.verifyTimeoutMs ?? 120_000,
    maxCritiqueRounds: config.maxCritiqueRounds ?? 1,
    maxCandidateChars: config.maxCandidateChars ?? 32_768,
    maxVerifyRetries: config.maxVerifyRetries ?? 1,
    maxArtifactChars: config.maxArtifactChars ?? 32_768,
    maxVerifyOutputChars: config.maxVerifyOutputChars ?? 8192,
    maxDiffChars: config.maxDiffChars ?? 32_768,
  }
  const countable = {
    maxCritiqueRounds: bounds.maxCritiqueRounds,
    maxVerifyRetries: bounds.maxVerifyRetries,
  }
  const positive = {
    verifyTimeoutMs: bounds.verifyTimeoutMs,
    maxCandidateChars: bounds.maxCandidateChars,
    maxArtifactChars: bounds.maxArtifactChars,
    maxVerifyOutputChars: bounds.maxVerifyOutputChars,
    maxDiffChars: bounds.maxDiffChars,
  }
  for (const [key, value] of Object.entries(countable)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(`next-workflow: ${key} must be a non-negative safe integer`)
    }
  }
  for (const [key, value] of Object.entries(positive)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new TypeError(`next-workflow: ${key} must be a positive safe integer`)
    }
  }
  const planCandidates = config.planCandidates ?? 1
  if (!Number.isSafeInteger(planCandidates) || planCandidates < 1 || planCandidates > 5) {
    throw new TypeError('next-workflow: planCandidates must be an integer in 1..5')
  }
  const phaseEfforts: Partial<Record<NextWorkflowPhase, ReasoningEffortId>> = {}
  for (const [phase, effort] of Object.entries(config.phaseEfforts ?? { plan: 'high', critique: 'high', review: 'high' })) {
    if (!(PHASE_IDS as readonly string[]).includes(phase)) {
      throw new TypeError(`next-workflow: phaseEfforts key "${phase}" is not a phase (${PHASE_IDS.join(', ')})`)
    }
    if (effort.length === 0 || effort !== effort.trim()) {
      throw new TypeError(`next-workflow: phaseEfforts["${phase}"] must be a non-empty normalized effort id`)
    }
    phaseEfforts[phase as NextWorkflowPhase] = ReasoningEffortId(effort)
  }
  // The selection judge rides the critique effort entry unless the deployment maps select itself.
  const selectEffort = phaseEfforts.select ?? phaseEfforts.critique
  if (selectEffort !== undefined) phaseEfforts.select = selectEffort
  const workflowsRoot = (config.workflowsRoot ?? '').trim()
  return {
    provider,
    workflowsRoot: workflowsRoot === '' ? dshHomePath('workflows') : workflowsRoot,
    verifyCommand,
    ...bounds,
    planCandidates,
    phaseEfforts,
  }
}

/** Structured SPEC fields returned by the INTENT subagent. */
export interface SpecFields {
  /** One-paragraph precise restatement of the objective. */
  goal: string
  /** Explicit limits the objective states or implies. */
  constraints: string[]
  /** Codebase areas or files the work likely touches. */
  areas: string[]
  /** Checkable conditions deciding the work is done. */
  acceptance: string[]
}

/** Validated CRITIQUE outcome: approval, or material gaps that send the run back to PLAN. */
export interface CritiqueResult {
  /** `approve` accepts the plan as written; `revise` requires another planning round. */
  verdict: 'approve' | 'revise'
  /** Material gaps to close; always empty on approval. */
  gaps: string[]
}

/** Validated REVIEW outcome, findings strictly scoped to correctness and stated requirements. */
export interface ReviewResult {
  /** `approve` records no material findings; `changes-requested` lists them. */
  verdict: 'approve' | 'changes-requested'
  /** Concrete correctness or requirement issues; always empty on approval. */
  findings: string[]
}

/** Validated SELECT outcome: the 1-based winning candidate plus the judge's rationale. */
export interface SelectionResult {
  /** 1-based index of the winning candidate plan. */
  winner: number
  /** Why the winner beat the other candidates against the rubric. */
  rationale: string
  /** Strong parts of losing candidates worth folding in later; empty when the judge offered none. */
  mergeHints: string[]
}

/** Static INTENT persona (byte-stable: the subagent's own prefix cache stays reusable). */
const INTENT_PERSONA = [
  'You normalize a raw engineering objective into a specification. Return the structured result:',
  'goal (one paragraph restating the objective precisely), constraints (explicit limits the',
  'objective states or implies; empty when none), areas (codebase areas or files the work likely',
  'touches), and acceptance (checkable conditions that decide the work is done). Report only what',
  'the objective supports; never invent requirements.',
].join(' ')

/** Static PLAN persona (byte-stable). */
const PLANNER_PERSONA = [
  'You are an implementation planner. You receive a SPEC and produce an executable plan as markdown:',
  'ordered steps, each naming the files and interfaces it touches, plus an explicit out-of-scope',
  'section. Plan only what the SPEC acceptance checks require. When revision gaps are supplied,',
  'revise the plan to close exactly those gaps. Return the structured result: plan (the complete',
  'markdown plan).',
].join(' ')

/** Static CRITIQUE persona (byte-stable); the critic never sees the planner's reasoning. */
const CRITIC_PERSONA = [
  'You are a plan critic. You see only a SPEC and a PLAN artifact — never the planner\'s reasoning',
  'or conversation. Check the PLAN against every SPEC acceptance check and constraint: missing',
  'coverage, contradictions, unnamed integration points, scope creep. Return the structured result:',
  'verdict ("approve" when the plan is executable as written, else "revise") and gaps (the material',
  'gaps requiring revision; empty when approving).',
].join(' ')

/** Static SELECT persona (byte-stable); the judge is independent of every planner and sees only artifacts. */
const SELECTOR_PERSONA = [
  'You are a plan selector. You see only a SPEC and several candidate plans — never any planner\'s',
  'reasoning or conversation. Score every candidate against this rubric: correctness against the',
  'SPEC acceptance checks, feasibility, scope fit (no scope creep, no missing coverage), and risk.',
  'Pick exactly one winner. Return the structured result: winner (the 1-based candidate index),',
  'rationale (why the winner beats the other candidates against the rubric), and mergeHints',
  '(strong parts of losing candidates worth folding in later; omit when none).',
].join(' ')

/** Static REVIEW persona (byte-stable); findings are scope-limited so the reviewer cannot invent work. */
const REVIEWER_PERSONA = [
  'You are a final change reviewer. You see a SPEC and the diff produced for it. Findings are',
  'strictly scoped to correctness and the stated requirements: acceptance checks the diff fails,',
  'bugs, regressions. Do not request new features, refactors, or style changes. Return the',
  'structured result: verdict ("approve" when there are no material findings, else',
  '"changes-requested") and findings (each a concrete correctness or requirement issue; empty when',
  'approving).',
].join(' ')

/** INTENT structured-output schema (`assertObjectJsonSchema` subset). */
const INTENT_OUTPUT_SCHEMA: ObjectJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['goal', 'constraints', 'areas', 'acceptance'],
  properties: {
    goal: { type: 'string' },
    constraints: { type: 'array', items: { type: 'string' } },
    areas: { type: 'array', items: { type: 'string' } },
    acceptance: { type: 'array', items: { type: 'string' } },
  },
}

/** PLAN structured-output schema: the complete markdown plan. */
const PLAN_OUTPUT_SCHEMA: ObjectJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['plan'],
  properties: { plan: { type: 'string' } },
}

/** CRITIQUE structured-output schema; verdict values are validated at the boundary. */
const CRITIQUE_OUTPUT_SCHEMA: ObjectJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'gaps'],
  properties: {
    verdict: { type: 'string' },
    gaps: { type: 'array', items: { type: 'string' } },
  },
}

/** SELECT structured-output schema; the winner index is range-validated at the boundary. */
const SELECTION_OUTPUT_SCHEMA: ObjectJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['winner', 'rationale'],
  properties: {
    winner: { type: 'number' },
    rationale: { type: 'string' },
    mergeHints: { type: 'array', items: { type: 'string' } },
  },
}

/** REVIEW structured-output schema; verdict values are validated at the boundary. */
const REVIEW_OUTPUT_SCHEMA: ObjectJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'findings'],
  properties: {
    verdict: { type: 'string' },
    findings: { type: 'array', items: { type: 'string' } },
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Read one required string-list field of a phase subagent's structured result. */
function readStringList(record: Record<string, unknown>, field: string, label: string): string[] {
  const value: unknown = record[field]
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === 'string')) {
    throw new Error(`next-workflow: ${label} structured result field "${field}" must be a string array`)
  }
  return value
}

/** Read one required non-empty string field of a phase subagent's structured result. */
function readText(record: Record<string, unknown>, field: string, label: string): string {
  const value = record[field]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`next-workflow: ${label} structured result field "${field}" must be a non-empty string`)
  }
  return value
}

/**
 * Validate the INTENT subagent's structured output (model-produced JSON — a real
 * boundary, so runtime validation is required).
 * @param value - the raw structured value.
 * @returns the validated SPEC fields.
 */
export function distillSpec(value: unknown): SpecFields {
  if (!isRecord(value)) throw new Error('next-workflow: intent subagent returned no structured result object')
  return {
    goal: readText(value, 'goal', 'intent'),
    constraints: readStringList(value, 'constraints', 'intent'),
    areas: readStringList(value, 'areas', 'intent'),
    acceptance: readStringList(value, 'acceptance', 'intent'),
  }
}

/**
 * Validate the PLAN subagent's structured output.
 * @param value - the raw structured value.
 * @returns the complete markdown plan.
 */
export function distillPlan(value: unknown): string {
  if (!isRecord(value)) throw new Error('next-workflow: planner subagent returned no structured result object')
  return readText(value, 'plan', 'planner')
}

/**
 * Validate the CRITIQUE subagent's structured output. Approval discards any
 * gaps the critic emitted anyway, keeping the loop decision one-valued.
 * @param value - the raw structured value.
 * @returns the validated critique verdict and gaps.
 */
export function distillCritique(value: unknown): CritiqueResult {
  if (!isRecord(value)) throw new Error('next-workflow: critic subagent returned no structured result object')
  const verdict = readText(value, 'verdict', 'critic')
  if (verdict !== 'approve' && verdict !== 'revise') {
    throw new Error(`next-workflow: critic verdict must be "approve" or "revise", got ${JSON.stringify(verdict)}`)
  }
  if (verdict === 'approve') return { verdict, gaps: [] }
  const gaps = readStringList(value, 'gaps', 'critic').filter(gap => gap.trim().length > 0)
  if (gaps.length === 0) throw new Error('next-workflow: critic returned "revise" without any gap')
  return { verdict, gaps }
}

/**
 * Validate the SELECT subagent's structured output. The winner index is a
 * model-produced pointer into the candidate array, so an out-of-range or
 * non-integer value fails the run loud rather than selecting garbage.
 * @param value - the raw structured value.
 * @param candidates - the number of candidate plans the judge scored.
 * @returns the validated selection: 1-based winner, rationale, merge hints.
 */
export function distillSelection(value: unknown, candidates: number): SelectionResult {
  if (!isRecord(value)) throw new Error('next-workflow: selector subagent returned no structured result object')
  const winner: unknown = value['winner']
  if (typeof winner !== 'number' || !Number.isSafeInteger(winner) || winner < 1 || winner > candidates) {
    throw new Error(`next-workflow: selector winner must be an integer in 1..${candidates}, got ${JSON.stringify(winner)}`)
  }
  const rationale = readText(value, 'rationale', 'selector')
  const mergeHints = value['mergeHints'] === undefined
    ? []
    : readStringList(value, 'mergeHints', 'selector').filter(hint => hint.trim().length > 0)
  return { winner, rationale, mergeHints }
}

/**
 * Validate the REVIEW subagent's structured output. Approval discards any
 * findings the reviewer emitted anyway, keeping the summary one-valued.
 * @param value - the raw structured value.
 * @returns the validated review verdict and findings.
 */
export function distillReview(value: unknown): ReviewResult {
  if (!isRecord(value)) throw new Error('next-workflow: reviewer subagent returned no structured result object')
  const verdict = readText(value, 'verdict', 'reviewer')
  if (verdict !== 'approve' && verdict !== 'changes-requested') {
    throw new Error(`next-workflow: reviewer verdict must be "approve" or "changes-requested", got ${JSON.stringify(verdict)}`)
  }
  if (verdict === 'approve') return { verdict, findings: [] }
  const findings = readStringList(value, 'findings', 'reviewer').filter(finding => finding.trim().length > 0)
  if (findings.length === 0) throw new Error('next-workflow: reviewer returned "changes-requested" without any finding')
  return { verdict, findings }
}

/** Render a markdown list section body, with an explicit empty marker. */
function renderList(items: readonly string[]): string {
  return items.length === 0 ? '(none)' : items.map(item => `- ${item}`).join('\n')
}

/**
 * Render the SPEC artifact: normalized fields plus the verbatim objective for traceability.
 * @param objective - the raw `/next-workflow` input.
 * @param fields - the validated INTENT fields.
 * @returns the SPEC.md content.
 */
export function renderSpec(objective: string, fields: SpecFields): string {
  return [
    '# SPEC',
    '',
    '## Goal',
    '',
    fields.goal,
    '',
    '## Original objective',
    '',
    objective,
    '',
    '## Constraints',
    '',
    renderList(fields.constraints),
    '',
    '## Affected areas',
    '',
    renderList(fields.areas),
    '',
    '## Acceptance checks',
    '',
    renderList(fields.acceptance),
    '',
  ].join('\n')
}

/**
 * Render the REVIEW artifact from the validated reviewer output.
 * @param review - the validated REVIEW verdict and findings.
 * @returns the REVIEW.md content.
 */
export function renderReview(review: ReviewResult): string {
  return [
    '# REVIEW',
    '',
    `Verdict: ${review.verdict}`,
    '',
    '## Findings',
    '',
    renderList(review.findings),
    '',
  ].join('\n')
}

/**
 * Render the SELECTION artifact: the judge's decision record. Kept separate
 * from PLAN.md so the winning plan stays the planner's own text.
 * @param selection - the validated SELECT outcome.
 * @param candidates - the number of candidate plans the judge scored.
 * @returns the SELECTION.md content.
 */
export function renderSelection(selection: SelectionResult, candidates: number): string {
  return [
    '# SELECTION',
    '',
    `Winner: candidate ${selection.winner} of ${candidates}`,
    '',
    '## Rationale',
    '',
    selection.rationale,
    '',
    '## Merge hints',
    '',
    renderList(selection.mergeHints),
    '',
  ].join('\n')
}

const TRUNCATION_NOTICE = '\n… [truncated]'

/** Bound one complete text (artifact, diff, or gate output) to its Config budget. */
function boundText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  if (maxChars <= TRUNCATION_NOTICE.length) return TRUNCATION_NOTICE.slice(0, maxChars)
  return `${text.slice(0, maxChars - TRUNCATION_NOTICE.length)}${TRUNCATION_NOTICE}`
}

/** Collect and release one phase subagent run; disposal always runs, failures aggregate. */
async function settlePhaseRun(run: SubagentRun): Promise<SubagentResult> {
  const [execution] = await Promise.allSettled([run.result])
  const [disposal] = await Promise.allSettled([run.dispose()])
  if (execution.status === 'rejected') {
    if (disposal.status === 'rejected') {
      throw new AggregateError(
        [execution.reason, disposal.reason],
        `next-workflow: phase subagent failed: ${String(execution.reason)}; dispose failed: ${String(disposal.reason)}`,
      )
    }
    throw execution.reason
  }
  if (disposal.status === 'rejected') throw disposal.reason
  return execution.value
}

/** Start one structured-output phase subagent and return its validated-boundary raw structured value. */
async function runPhaseSubagent(
  subagents: SubagentService,
  config: ResolvedConfig,
  agent: Agent,
  signal: AbortSignal,
  options: { label: string; persona: string; prompt: string; schema: ObjectJsonSchema },
): Promise<unknown> {
  const run = await subagents.start(config.provider, {
    label: options.label,
    prompt: [{ type: 'text', text: options.prompt }],
    parent: agent,
    signal,
    outputSchema: options.schema,
    persona: options.persona,
  })
  const result = await settlePhaseRun(run)
  if (result.stopReason !== 'completed') {
    throw new Error(`next-workflow: ${options.label} subagent did not complete (${result.stopReason})`)
  }
  if (result.structured === undefined) {
    throw new Error(`next-workflow: ${options.label} subagent returned no structured result`)
  }
  return result.structured
}

/** Write one phase artifact; failures fail the run loud because artifacts are the phase handoff. */
async function writeArtifact(dir: string, file: string, text: string): Promise<string> {
  await mkdir(dir, { recursive: true })
  const path = join(dir, file)
  await writeFile(path, text, 'utf8')
  return path
}

/** Convert arbitrary abort reasons to one stable Error. */
function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason
  return new Error(typeof signal.reason === 'string' ? signal.reason : '/next-workflow aborted')
}

/** Await implementation-turn quiescence; a command abort cancels the turn and rejects. */
async function waitForTurn(agent: Agent, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw abortError(signal)
  await new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      agent.cancel({ kind: 'user' })
      reject(abortError(signal))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    agent.whenIdle().then(
      () => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}

/** One bounded `git diff` attempt through the git service; any failure degrades to `undefined`. */
async function tryGitServiceDiff(git: Git, cwd: string, signal: AbortSignal): Promise<string | undefined> {
  try {
    return (await git.diff(cwd, {}, signal)).diff
  } catch {
    // NOT_A_REPOSITORY and EXEC_FAILED both mean "no usable diff here"; the caller falls back to bash.
    return undefined
  }
}

/** One bounded `git diff HEAD` attempt through the bash executor; any failure degrades to `undefined`. */
async function tryBashDiff(bash: BashExecutor, cwd: string | undefined, signal: AbortSignal): Promise<string | undefined> {
  try {
    const request: BashExecRequest = { command: 'git diff HEAD', signal }
    if (cwd !== undefined) request.workdir = cwd
    const result = await bash.run(bash.resolve(request))
    return result.exitCode === 0 ? result.stdout.text : undefined
  } catch {
    // Infrastructure failure means "no usable diff here"; the caller degrades honestly.
    return undefined
  }
}

/** Collect the review diff: the git service when mounted, else `git diff HEAD` through bash, else an explicit marker. */
async function collectDiff(ctx: Context, cwd: string | undefined, signal: AbortSignal, maxChars: number): Promise<string> {
  const git = ctx.get('git')
  if (git !== undefined && cwd !== undefined) {
    const diff = await tryGitServiceDiff(git, cwd, signal)
    if (diff !== undefined) return boundText(diff, maxChars)
  }
  const bash = ctx.get('bash')
  if (bash !== undefined) {
    const diff = await tryBashDiff(bash, cwd, signal)
    if (diff !== undefined) return boundText(diff, maxChars)
  }
  return '(no git diff available: the reviewer assessed the run record only)'
}

/** Compose the SELECT judge prompt: the SPEC plus every candidate plan, each bounded by `maxCandidateChars`. */
function selectionPrompt(spec: string, candidates: readonly string[]): string {
  return [
    `# SPEC\n\n${spec}`,
    ...candidates.map((candidate, index) => `# Candidate plan ${index + 1}\n\n${candidate}`),
  ].join('\n\n')
}

/** Compose the IMPLEMENT steering message: the plan inline (it is the work order) plus artifact paths. */
function implementMessage(specPath: string, planPath: string, spec: string, plan: string): string {
  return [
    'You are the IMPLEMENT phase of a /next-workflow run. Implement the plan below in this workspace —',
    'make the file changes, do not just describe them, and stay inside the plan\'s declared scope.',
    `The artifacts are also on disk: SPEC at ${specPath}, PLAN at ${planPath}.`,
    '',
    '# SPEC',
    '',
    spec,
    '',
    '# PLAN',
    '',
    plan,
  ].join('\n')
}

/** Compose the bounded verify-failure steering message for one IMPLEMENT retry. */
function retryMessage(verifyCommand: string, detail: string, output: string): string {
  return [
    `The VERIFY gate of this /next-workflow run failed: \`${verifyCommand}\` ${detail}.`,
    'Fix the implementation so the gate passes; the harness re-runs it after this turn.',
    '',
    'Gate output (bounded):',
    output.length === 0 ? '(no output)' : output,
  ].join('\n')
}

/** Describe one verify run's failure compactly for the retry steer and summary. */
function verifyFailureDetail(result: { exitCode: number | null; timedOut: boolean; aborted: boolean }): string {
  if (result.timedOut) return 'timed out'
  if (result.aborted) return 'was aborted'
  return `exited ${String(result.exitCode)}`
}

/**
 * Parse `/next-workflow` input: an optional leading candidate count (1..5) followed by the objective.
 * @param raw - the command's raw input after `/next-workflow`.
 * @returns the objective (and optional per-run candidate override), or `{ error }` when the input is empty or the count is out of range.
 */
export function parseInvocationInput(raw: string): { objective: string; planCandidates?: number } | { error: string } {
  const text = raw.trim()
  const match = /^(\d+)\s+([\s\S]+)$/.exec(text)
  if (match === null) return text === '' ? { error: 'Usage: /next-workflow [candidates] <objective>' } : { objective: text }
  const planCandidates = Number(match[1])
  if (!Number.isSafeInteger(planCandidates) || planCandidates < 1 || planCandidates > 5) {
    return { error: `/next-workflow: candidates must be an integer in 1..5 (got ${match[1] as string})` }
  }
  return { objective: (match[2] as string).trim(), planCandidates }
}

/** Run the fixed phase machine for one `/next-workflow` invocation. */
async function executeNextWorkflow(ctx: Context, config: ResolvedConfig, invocation: CommandInvocation): Promise<CommandResult> {
  const parsed = parseInvocationInput(invocation.rawInput)
  if ('error' in parsed) return { kind: 'error', text: parsed.error }
  const { objective } = parsed
  // 命令行候选数覆盖 Config（/next-workflow 3 … = 本次开 3 方案；不带数字 = Config 值）。
  const runConfig: ResolvedConfig = parsed.planCandidates === undefined
    ? config
    : { ...config, planCandidates: parsed.planCandidates }
  const { agent, signal } = invocation

  // Capability checks fail loud before any phase work starts.
  const subagents = ctx.get('subagents')
  if (subagents === undefined) {
    return { kind: 'error', text: '/next-workflow is unavailable: the subagents service is not mounted (load @huiliyi37/dsh-subagent and a provider)' }
  }
  const provider = subagents.getProvider(config.provider)
  if (provider === undefined) {
    return { kind: 'error', text: `/next-workflow is unavailable: subagent provider "${config.provider}" is not registered` }
  }
  for (const capability of ['outputSchema', 'persona'] as const) {
    if (!provider.capabilities[capability]) {
      return { kind: 'error', text: `/next-workflow is unavailable: subagent provider "${config.provider}" does not support the "${capability}" capability` }
    }
  }
  if (provider.inheritsParentContext) {
    return { kind: 'error', text: `/next-workflow is unavailable: subagent provider "${config.provider}" inherits parent context; critique and review require a fresh-context provider` }
  }
  const bash = ctx.get('bash')
  if (config.verifyCommand !== undefined && bash === undefined) {
    return { kind: 'error', text: '/next-workflow is unavailable: verifyCommand is configured but no bash executor is mounted (load a ctx.bash provider)' }
  }

  const session = agent.session
  const runId = `nw-${crypto.randomUUID().slice(0, 8)}`
  const dir = join(config.workflowsRoot, runId)
  const cwd = session.header.cwd
  const transcript: string[] = []

  // Phase effort steering: rewrite only the main session's requests, switch
  // only at phase boundaries, and restore the pre-run header effort on the
  // first request after the run (the loop persists each logged header).
  const priorEffort = session.requestHeader()?.config.reasoningEffort
  let activePhase: NextWorkflowPhase | undefined
  let effortTouched = false
  let pendingRestore = false
  const disposeEffort = agent.ctx.on('agent/request', async (_payload, next): Promise<LlmCallConfig> => {
    const resolved = await next()
    if (pendingRestore) {
      pendingRestore = false
      // Self-dispose outside the waterfall dispatch so listener teardown never disturbs iteration.
      queueMicrotask(() => { disposeEffort() })
      const { reasoningEffort: _dropped, ...rest } = resolved
      return priorEffort === undefined ? rest : { ...rest, reasoningEffort: priorEffort }
    }
    if (activePhase === undefined) return resolved
    const effort = config.phaseEfforts[activePhase]
    if (effort === undefined || effort === resolved.reasoningEffort) return resolved
    effortTouched = true
    return { ...resolved, reasoningEffort: effort }
  })

  const logPhase = (phase: NextWorkflowPhase, extra: { artifact?: string; detail?: string; selection?: SelectionAudit } = {}): void => {
    session.append('next-workflow/phase', { runId, phase, ...extra })
  }

  try {
    // INTENT
    activePhase = 'intent'
    const specFields = distillSpec(await runPhaseSubagent(subagents, config, agent, signal, {
      label: 'next-workflow intent',
      persona: INTENT_PERSONA,
      prompt: `Objective:\n${objective}`,
      schema: INTENT_OUTPUT_SCHEMA,
    }))
    const spec = boundText(renderSpec(objective, specFields), config.maxArtifactChars)
    const specPath = await writeArtifact(dir, 'SPEC.md', spec)
    logPhase('intent', { artifact: specPath })
    transcript.push('intent → SPEC normalized')

    // PLAN ⇄ CRITIQUE (bounded by maxCritiqueRounds). planCandidates > 1 fans
    // PLAN out to N parallel candidate planners and inserts SELECT: an
    // independent fresh-context judge picks the winner, which becomes PLAN.md.
    let gaps: string[] = []
    let plan = ''
    let planPath = ''
    for (let round = 0; ; round += 1) {
      activePhase = 'plan'
      const plannerPrompt = gaps.length === 0
        ? `# SPEC\n\n${spec}`
        : `# SPEC\n\n${spec}\n\n# Revision gaps to close\n\n${renderList(gaps)}`
      if (runConfig.planCandidates === 1) {
        plan = boundText(distillPlan(await runPhaseSubagent(subagents, config, agent, signal, {
          label: 'next-workflow planner',
          persona: PLANNER_PERSONA,
          prompt: plannerPrompt,
          schema: PLAN_OUTPUT_SCHEMA,
        })), config.maxArtifactChars)
        planPath = await writeArtifact(dir, 'PLAN.md', plan)
        logPhase('plan', { artifact: planPath, ...round > 0 ? { detail: `revision ${round}` } : {} })
        transcript.push(round === 0 ? 'plan → PLAN written' : `plan → revision ${round} written`)
      } else {
        const candidates = await Promise.all(Array.from({ length: runConfig.planCandidates }, async () =>
          boundText(distillPlan(await runPhaseSubagent(subagents, config, agent, signal, {
            label: 'next-workflow planner',
            persona: PLANNER_PERSONA,
            prompt: plannerPrompt,
            schema: PLAN_OUTPUT_SCHEMA,
          })), config.maxCandidateChars)))
        for (const [index, candidate] of candidates.entries()) {
          const candidatePath = await writeArtifact(dir, `PLAN-${index + 1}.md`, candidate)
          logPhase('plan', { artifact: candidatePath, detail: `candidate ${index + 1}/${runConfig.planCandidates}${round > 0 ? ` (revision ${round})` : ''}` })
        }
        transcript.push(`plan → ${runConfig.planCandidates} candidates written`)
        activePhase = 'select'
        const selection = distillSelection(await runPhaseSubagent(subagents, config, agent, signal, {
          label: 'next-workflow selector',
          persona: SELECTOR_PERSONA,
          prompt: selectionPrompt(spec, candidates),
          schema: SELECTION_OUTPUT_SCHEMA,
        }), candidates.length)
        const selectionPath = await writeArtifact(dir, 'SELECTION.md', renderSelection(selection, candidates.length))
        logPhase('select', {
          artifact: selectionPath,
          detail: `candidate ${selection.winner} of ${candidates.length}`,
          selection: { candidates: candidates.length, winner: selection.winner, rationale: selection.rationale },
        })
        transcript.push(`select → candidate ${selection.winner} of ${candidates.length}`)
        // distillSelection bounds the winner to 1..candidates.length.
        plan = boundText(candidates[selection.winner - 1] as string, config.maxArtifactChars)
        planPath = await writeArtifact(dir, 'PLAN.md', plan)
      }
      if (round >= config.maxCritiqueRounds) break
      activePhase = 'critique'
      const critique = distillCritique(await runPhaseSubagent(subagents, config, agent, signal, {
        label: 'next-workflow critic',
        persona: CRITIC_PERSONA,
        prompt: `# SPEC\n\n${spec}\n\n# PLAN\n\n${plan}`,
        schema: CRITIQUE_OUTPUT_SCHEMA,
      }))
      logPhase('critique', { detail: critique.verdict === 'approve' ? 'approved' : `revise: ${critique.gaps.length} gap(s)` })
      if (critique.verdict === 'approve') {
        transcript.push('critique → approved')
        break
      }
      transcript.push(`critique → revise (${critique.gaps.length} gap(s))`)
      gaps = critique.gaps
    }

    // IMPLEMENT
    activePhase = 'implement'
    agent.steer(createUserMessage({
      content: [{ type: 'text', text: implementMessage(specPath, planPath, spec, plan) }],
      source: { kind: 'plugin', plugin: name, form: 'instructions' },
    }))
    await waitForTurn(agent, signal)
    logPhase('implement')
    transcript.push('implement → steered and settled')

    // VERIFY (deterministic gate; bounded retries steer back into IMPLEMENT)
    let verifyDisposition: 'verified' | 'unverified' = 'unverified'
    if (config.verifyCommand === undefined) {
      activePhase = 'verify'
      logPhase('verify', { detail: 'unverified: no verifyCommand configured' })
      transcript.push('verify → unverified (no verifyCommand configured)')
    } else {
      for (let attempt = 0; ; attempt += 1) {
        activePhase = 'verify'
        // No per-request stdoutMaxBytes: collection follows the executor's
        // deployment output cap, and maxVerifyOutputChars stays the single
        // (character) bound on the gate output steered back to the model below.
        const request: BashExecRequest = {
          command: config.verifyCommand,
          timeoutMs: config.verifyTimeoutMs,
          signal,
        }
        if (cwd !== undefined) request.workdir = cwd
        // The capability check above proves bash is present on this branch.
        const gate = bash as BashExecutor
        const result = await gate.run(gate.resolve(request))
        if (result.exitCode === 0 && !result.timedOut && !result.aborted) {
          verifyDisposition = 'verified'
          logPhase('verify', { detail: 'verified' })
          transcript.push(`verify → verified${attempt > 0 ? ` after ${attempt} retr${attempt === 1 ? 'y' : 'ies'}` : ''}`)
          break
        }
        const detail = verifyFailureDetail(result)
        logPhase('verify', { detail: `failed (${detail})` })
        if (attempt >= config.maxVerifyRetries) {
          session.append('next-workflow/end', { runId, outcome: 'failed-verification', detail })
          transcript.push(`verify → failed-verification (${detail})`)
          return {
            kind: 'error',
            text: renderSummary(runId, 'failed-verification', transcript, specPath, planPath, undefined),
          }
        }
        transcript.push(`verify → failed (${detail}); retry ${attempt + 1}/${config.maxVerifyRetries}`)
        activePhase = 'implement'
        const output = boundText(
          [result.stdout.text, result.stderr.text].filter(text => text !== '').join('\n'),
          config.maxVerifyOutputChars,
        )
        agent.steer(createUserMessage({
          content: [{ type: 'text', text: retryMessage(config.verifyCommand, detail, output) }],
          source: { kind: 'plugin', plugin: name, form: 'instructions' },
        }))
        await waitForTurn(agent, signal)
        logPhase('implement', { detail: `verify retry ${attempt + 1}` })
      }
    }

    // REVIEW
    activePhase = 'review'
    const diff = await collectDiff(ctx, cwd, signal, config.maxDiffChars)
    const review = distillReview(await runPhaseSubagent(subagents, config, agent, signal, {
      label: 'next-workflow reviewer',
      persona: REVIEWER_PERSONA,
      prompt: `# SPEC\n\n${spec}\n\n# DIFF\n\n${diff}`,
      schema: REVIEW_OUTPUT_SCHEMA,
    }))
    const reviewPath = await writeArtifact(dir, 'REVIEW.md', renderReview(review))
    logPhase('review', { artifact: reviewPath, detail: review.verdict })
    transcript.push(review.verdict === 'approve'
      ? 'review → approved'
      : `review → changes-requested (${review.findings.length} finding(s))`)

    session.append('next-workflow/end', { runId, outcome: 'completed', detail: verifyDisposition })
    return {
      kind: 'success',
      text: renderSummary(runId, `completed (verify: ${verifyDisposition})`, transcript, specPath, planPath, reviewPath),
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    try {
      session.append('next-workflow/end', { runId, outcome: 'failed', detail: message })
    } catch {
      // The original failure stays the reported one; a failed end-marker append must not mask it.
    }
    return { kind: 'error', text: `next-workflow ${runId} failed: ${message}` }
  } finally {
    activePhase = undefined
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- the listener closure mutates effortTouched before this finally
    if (effortTouched) {
      // The next request restores the pre-run effort and self-disposes; if none
      // ever arrives, the listener unwinds with the agent's context.
      pendingRestore = true
    } else {
      disposeEffort()
    }
  }
}

/** Render the human-facing run summary: outcome, phase transcript, artifact paths. */
function renderSummary(
  runId: string,
  outcome: string,
  transcript: readonly string[],
  specPath: string,
  planPath: string,
  reviewPath: string | undefined,
): string {
  return [
    `next-workflow ${runId} ${outcome}.`,
    ...transcript.map(line => `- ${line}`),
    'Artifacts:',
    `- SPEC: ${specPath}`,
    `- PLAN: ${planPath}`,
    ...(reviewPath === undefined ? [] : [`- REVIEW: ${reviewPath}`]),
  ].join('\n')
}

/**
 * Register the global `/next-workflow` command for every composed command adapter.
 * @param ctx - plugin context (injects `commands`; every other capability is probed at handler time).
 * @param config - deployment policy for the fixed pipeline.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)
  // One active run per session: a second run would race the first's effort
  // listener and implementation steering on the same agent.
  const activeSessions = new Set<string>()
  ctx.commands.register({
    name: 'next-workflow',
    description: 'Run the fixed intent pipeline: INTENT → PLAN → CRITIQUE → IMPLEMENT → VERIFY → REVIEW',
    input: { hint: '[candidates] <objective>' },
    handler: async (invocation) => {
      const key = String(invocation.agent.session.id)
      if (activeSessions.has(key)) {
        return { kind: 'error', text: '/next-workflow is already running on this session' }
      }
      activeSessions.add(key)
      try {
        return await executeNextWorkflow(ctx, resolved, invocation)
      } finally {
        activeSessions.delete(key)
      }
    },
  })
  // TUI 斜杠菜单（可选缝）：host CommandService（ctx.commands）平面不会出现在
  // TUI 的 `/` 菜单里——菜单数据源是 TUI 暴露的 tui.commands 注册表。打包顺序
  // 是 dsh-base 行先于 tui-runner 行应用，apply 时该服务尚未提供：经 ctx.inject
  // 等服务可用后再注册（headless 装配保持 pending）；执行仍委托下方的
  // CommandService（保持 command/run 生命周期事件与逐 agent 命令视图）。
  ctx.inject(['tui.commands'], (tuiCtx) => {
    const tuiCommands = tuiCtx.get('tui.commands') as TuiSlashFacet
    tuiCommands.register({
      name: 'next-workflow',
      description: '固定意图管线：规范 → 计划 → 批判 → 实现 → 验证 → 评审',
      argsHint: '[candidates] <objective>',
      run: async ({ text, ctx: runCtx, sessionId, echo }) => {
        const input = text.trim() === '' ? '/next-workflow' : `/next-workflow ${text.trim()}`
        if (sessionId === null) {
          echo('⚠ /next-workflow 需要活动会话')
          return
        }
        const agent = (runCtx as TuiRunContext).agents?.get(sessionId)
        if (agent === undefined) {
          echo('⚠ /next-workflow 需要活动会话')
          return
        }
        const execution = await ctx.commands.execute(agent, input, new AbortController().signal)
        if (execution === undefined) {
          echo(`未知命令: ${input}`)
          return
        }
        if (execution.result.kind === 'success') {
          echo(execution.result.text ?? '已执行')
        } else {
          echo(`⚠ 命令执行失败: ${execution.result.text}`)
        }
      },
    })
  })
}
