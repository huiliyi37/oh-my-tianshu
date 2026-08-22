/**
 * next-workflow unit tests (mock ctx + scripted subagents/bash/git; zero model calls).
 *
 * Behavior contract:
 * - Registers `/next-workflow` on ctx.commands; one active run per session.
 * - Happy path runs INTENT → PLAN → CRITIQUE → IMPLEMENT → VERIFY → REVIEW,
 *   writes SPEC/PLAN/REVIEW artifacts, and logs every transition as log-only
 *   `next-workflow/phase` + `next-workflow/end` events.
 * - Critique gaps loop back to PLAN, bounded by maxCritiqueRounds.
 * - Verify failure steers one bounded retry; exhaustion is terminal
 *   `failed-verification` (an error result, never silent success).
 * - Absent verifyCommand reports `unverified` honestly and continues.
 * - Missing capabilities (subagents service, provider, provider capabilities,
 *   bash for a configured verifyCommand) fail loud before phase work.
 * - The effort listener rewrites reasoningEffort for mapped phases, passes
 *   unmapped phases through, and restores the pre-run header afterwards.
 * - planCandidates > 1 fans PLAN out to N parallel candidate planners
 *   (PLAN-1.md…PLAN-N.md), an independent selector subagent picks the winner
 *   (PLAN.md + SELECTION.md), and CRITIQUE receives the winning plan; a bad
 *   winner index fails the run loud. planCandidates = 1 keeps the single-plan
 *   path byte-identical.
 *
 * @module @huiliyi37/dsh-next-workflow/tests/next-workflow
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import type { Context } from '@huiliyi37/cordis'
import type { Agent } from '@huiliyi37/dsh-agent'
import type { BashExecRequest, BashExecSpec, BashRunResult } from '@huiliyi37/dsh-bash'
import { CommandId } from '@huiliyi37/dsh-commands'
import type { CommandDefinition, CommandInvocation, CommandResult } from '@huiliyi37/dsh-commands'
import { ReasoningEffortId } from '@huiliyi37/dsh-llm'
import type { LlmCallConfig } from '@huiliyi37/dsh-llm'
import type { UserMessage } from '@huiliyi37/dsh-llm'
import { Session, SessionId } from '@huiliyi37/dsh-session'
import type { SubagentCapabilities, SubagentResult, SubagentRun, SubagentStartRequest } from '@huiliyi37/dsh-subagent'
import { apply, distillCritique, distillPlan, distillReview, distillSelection, distillSpec, parseInvocationInput } from '../src/index.ts'
import type { Config } from '../src/index.ts'

const FULL_CAPABILITIES: SubagentCapabilities = {
  outputSchema: true,
  depthLimit: true,
  toolFilter: true,
  persona: true,
  sandboxMode: true,
  runBudget: true,
}

/** Scripted structured outputs, keyed by phase; planner/critic/selector queues are consumed in order. */
interface Script {
  intent?: unknown
  plans?: unknown[]
  selections?: unknown[]
  critiques?: unknown[]
  review?: unknown
}

const HAPPY_SCRIPT: Script = {
  intent: { goal: 'Add tests for foo.', constraints: ['no new deps'], areas: ['src/foo.ts'], acceptance: ['foo tests pass'] },
  plans: [{ plan: '# Plan\n\n1. Write foo tests in tests/foo.spec.ts.' }],
  critiques: [{ verdict: 'approve', gaps: [] }],
  review: { verdict: 'approve', findings: [] },
}

interface BashOutcome {
  exitCode: number
  stdout?: string
  stderr?: string
  timedOut?: boolean
  aborted?: boolean
}

type EffortListener = (payload: unknown, next: () => Promise<LlmCallConfig>) => Promise<LlmCallConfig>

interface Harness {
  ctx: Context
  agent: Agent
  session: Session
  commands: CommandDefinition[]
  subagentRequests: SubagentStartRequest[]
  steers: UserMessage[]
  bashCommands: string[]
  bashSpecs: BashExecSpec[]
  effortListener: EffortListener | undefined
  disposeEffort: ReturnType<typeof vi.fn>
  cancel: ReturnType<typeof vi.fn>
  whenIdle: Mock<() => Promise<void>>
}

function bashResult(outcome: BashOutcome): BashRunResult {
  return {
    exitCode: outcome.exitCode,
    signal: null,
    timedOut: outcome.timedOut ?? false,
    aborted: outcome.aborted ?? false,
    timeoutMs: 1000,
    stdout: { text: outcome.stdout ?? '', truncated: false },
    stderr: { text: outcome.stderr ?? '', truncated: false },
  }
}

/** Assemble a mock ctx + stub agent with scripted subagent, bash, and git seams. */
function makeHarness(opts: {
  script?: Script
  subagents?: boolean
  provider?: boolean
  capabilities?: Partial<SubagentCapabilities>
  inheritsParentContext?: boolean
  bash?: boolean
  bashQueue?: BashOutcome[]
  bashThrowOn?: string
  git?: boolean
  gitDiff?: () => Promise<{ diff: string }>
  omitCwd?: boolean
  priorEffort?: ReturnType<typeof ReasoningEffortId>
  subagentRun?: (request: SubagentStartRequest, structured: unknown) => SubagentRun | Promise<SubagentRun>
} = {}): Harness {
  const script = opts.script ?? HAPPY_SCRIPT
  const plans = [...script.plans ?? []]
  const selections = [...script.selections ?? []]
  const critiques = [...script.critiques ?? []]
  const commands: CommandDefinition[] = []
  const subagentRequests: SubagentStartRequest[] = []
  const steers: UserMessage[] = []
  const bashCommands: string[] = []
  const bashSpecs: BashExecSpec[] = []
  const bashQueue = [...opts.bashQueue ?? []]
  const sessionId = SessionId('nw-unit')
  const session = Session.create(sessionId, undefined, {
    version: 0,
    id: sessionId,
    createdAt: 0,
    ...opts.omitCwd ? {} : { cwd: '/tmp/nw-unit-workspace' },
  })
  if (opts.priorEffort !== undefined) {
    session.append('request/header', {
      header: { config: { provider: 'mock', model: 'mock', reasoningEffort: opts.priorEffort } },
      reason: 'initial',
    })
  }
  const harness: Harness = {
    ctx: undefined as unknown as Context,
    agent: undefined as unknown as Agent,
    session,
    commands,
    subagentRequests,
    steers,
    bashCommands,
    bashSpecs,
    effortListener: undefined,
    disposeEffort: vi.fn(),
    cancel: vi.fn(),
    whenIdle: vi.fn(() => Promise.resolve()),
  }

  const structuredFor = (label: string): unknown => {
    if (label.includes('intent')) return script.intent
    if (label.includes('planner')) return plans.shift()
    if (label.includes('selector')) return selections.shift()
    if (label.includes('critic')) return critiques.shift()
    return script.review
  }
  const subagents = {
    getProvider: (name: string) => (opts.provider === false || name !== 'spawn'
      ? undefined
      : {
        name: 'spawn',
        capabilities: { ...FULL_CAPABILITIES, ...opts.capabilities, runBudget: false },
        inheritsParentContext: opts.inheritsParentContext ?? false,
      }),
    start: vi.fn(async (_provider: string, request: SubagentStartRequest): Promise<SubagentRun> => {
      subagentRequests.push(request)
      const structured = structuredFor(request.label ?? '')
      if (opts.subagentRun !== undefined) return opts.subagentRun(request, structured)
      const result: SubagentResult = {
        output: [],
        structured,
        stopReason: 'completed',
      }
      return {
        id: SessionId(`run-${subagentRequests.length}`),
        localAgent: undefined,
        result: Promise.resolve(result),
        dispose: () => Promise.resolve(),
      }
    }),
  }
  const bash = {
    resolve: (request: BashExecRequest): BashExecSpec => ({
      command: request.command,
      workdir: request.workdir ?? '/tmp',
      timeoutMs: request.timeoutMs ?? 1000,
      stdoutMaxBytes: request.stdoutMaxBytes ?? 65_536,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
      sandboxPolicy: undefined,
    }),
    run: (spec: BashExecSpec): Promise<BashRunResult> => {
      bashCommands.push(spec.command)
      bashSpecs.push(spec)
      if (opts.bashThrowOn !== undefined && spec.command === opts.bashThrowOn) {
        return Promise.reject(new Error('bash-down'))
      }
      return Promise.resolve(bashResult(bashQueue.shift() ?? { exitCode: 0 }))
    },
    start: (): never => { throw new Error('background processes are not scripted') },
  }
  const git = {
    diff: opts.gitDiff ?? (() => Promise.resolve({ diff: 'DIFF_BODY' })),
  }

  harness.ctx = {
    commands: { register: vi.fn((definition: CommandDefinition) => { commands.push(definition) }) },
    get: vi.fn((key: string) => {
      if (key === 'subagents') return opts.subagents === false ? undefined : subagents
      if (key === 'bash') return opts.bash === false ? undefined : bash
      if (key === 'git') return opts.git === false ? undefined : git
      return undefined
    }),
  } as unknown as Context
  harness.agent = {
    id: session.id,
    session,
    options: {},
    status: 'idle',
    steer: vi.fn((message: UserMessage) => { steers.push(message) }),
    whenIdle: harness.whenIdle,
    cancel: harness.cancel,
    ctx: {
      on: vi.fn((event: string, listener: EffortListener) => {
        if (event !== 'agent/request') throw new Error(`unexpected listener on ${event}`)
        harness.effortListener = listener
        return harness.disposeEffort
      }),
    },
  } as unknown as Agent
  return harness
}

let serial = 0

/** Invoke the captured `/next-workflow` handler with a fresh cancellation signal. */
async function runCommand(h: Harness, objective = 'add tests for foo', signal?: AbortSignal): Promise<CommandResult> {
  const definition = h.commands.find(candidate => candidate.name === 'next-workflow')
  if (definition === undefined) throw new Error('/next-workflow was not registered')
  serial += 1
  const invocation: CommandInvocation = {
    commandId: CommandId(`cmd-test-${serial}`),
    agent: h.agent,
    rawInput: ` ${objective}`,
    attachments: [],
    signal: signal ?? new AbortController().signal,
  }
  return definition.handler(invocation)
}

/** Read the log-only next-workflow events appended to the session, in order. */
function workflowEvents(h: Harness): Array<{ type: string; data: Record<string, unknown> }> {
  return h.session.events
    .filter(event => event.type.startsWith('next-workflow/'))
    .map(event => ({ type: event.type, data: event.data as Record<string, unknown> }))
}

const BASE_CONFIG: LlmCallConfig = { provider: 'mock', model: 'mock' }

describe('/next-workflow command', () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
  })

  async function makeConfig(overrides: Config = {}): Promise<Config> {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-next-workflow-'))
    roots.push(dir)
    return Object.assign({ workflowsRoot: dir }, overrides)
  }

  it('runs the full phase machine, writes artifacts, and logs log-only events', async () => {
    const h = makeHarness({ bashQueue: [{ exitCode: 0 }] })
    apply(h.ctx, await makeConfig({ verifyCommand: 'pnpm test' }))
    const result = await runCommand(h)

    expect(result.kind).toBe('success')
    const text = result.kind === 'success' ? result.text ?? '' : ''
    expect(text).toContain('completed (verify: verified)')
    expect(text).toContain('- SPEC: ')
    expect(text).toContain('- PLAN: ')
    expect(text).toContain('- REVIEW: ')

    // Artifacts on disk are the phase handoff.
    const runDir = join(roots[0]!, h.session.events
      .map(event => event.data as Record<string, unknown>)
      .find(data => typeof data['runId'] === 'string')?.['runId'] as string)
    const spec = await readFile(join(runDir, 'SPEC.md'), 'utf8')
    expect(spec).toContain('# SPEC')
    expect(spec).toContain('Add tests for foo.')
    expect(spec).toContain('foo tests pass')
    const plan = await readFile(join(runDir, 'PLAN.md'), 'utf8')
    expect(plan).toContain('Write foo tests')
    const review = await readFile(join(runDir, 'REVIEW.md'), 'utf8')
    expect(review).toContain('Verdict: approve')

    // Four fresh structured-output subagents, each with its own static persona.
    expect(h.subagentRequests.map(request => request.label)).toEqual([
      'next-workflow intent',
      'next-workflow planner',
      'next-workflow critic',
      'next-workflow reviewer',
    ])
    for (const request of h.subagentRequests) {
      expect(typeof request.persona).toBe('string')
      expect(request.outputSchema).toBeDefined()
    }
    // The critic sees only SPEC + PLAN; the reviewer sees SPEC + the diff.
    const criticPrompt = (h.subagentRequests[2]?.prompt[0] as { text: string }).text
    expect(criticPrompt).toContain('# SPEC')
    expect(criticPrompt).toContain('# PLAN')
    expect(criticPrompt).toContain('Write foo tests')
    const reviewPrompt = (h.subagentRequests[3]?.prompt[0] as { text: string }).text
    expect(reviewPrompt).toContain('DIFF_BODY')

    // IMPLEMENT steered the invoking session once with spec + plan inline.
    expect(h.steers).toHaveLength(1)
    const steerText = (h.steers[0]?.content[0] as { text: string }).text
    expect(steerText).toContain('IMPLEMENT phase')
    expect(steerText).toContain('# SPEC')
    expect(steerText).toContain('# PLAN')
    expect(h.steers[0]?.source).toEqual({ kind: 'plugin', plugin: 'next-workflow', form: 'instructions' })

    // The verify gate ran through the request/spec split with the configured command.
    expect(h.bashCommands).toEqual(['pnpm test'])

    // Every transition is a log-only event: intent..review phases plus the end record.
    expect(workflowEvents(h).map(event => `${event.type}:${String(event.data['phase'] ?? event.data['outcome'])}`)).toEqual([
      'next-workflow/phase:intent',
      'next-workflow/phase:plan',
      'next-workflow/phase:critique',
      'next-workflow/phase:implement',
      'next-workflow/phase:verify',
      'next-workflow/phase:review',
      'next-workflow/end:completed',
    ])
    expect(h.session.surface.nodes).toEqual([])
    expect(h.session.deriveMessages()).toEqual([])
  })

  it('planCandidates = 3 fans PLAN out, an independent selector picks the winner, and CRITIQUE receives it', async () => {
    const h = makeHarness({
      bashQueue: [{ exitCode: 0 }],
      script: {
        ...HAPPY_SCRIPT,
        plans: [{ plan: '# Plan A\n\n1. Thin.' }, { plan: '# Plan B\n\n1. Covers the acceptance checks.' }, { plan: '# Plan C\n\n1. Scope creep.' }],
        selections: [{ winner: 2, rationale: 'B is the only candidate covering every acceptance check.', mergeHints: ['A names the test helper'] }],
      },
    })
    apply(h.ctx, await makeConfig({ verifyCommand: 'check', planCandidates: 3 }))
    const result = await runCommand(h)

    expect(result.kind).toBe('success')
    // Subagent order: intent, three parallel planners, selector, critic, reviewer.
    expect(h.subagentRequests.map(request => request.label)).toEqual([
      'next-workflow intent',
      'next-workflow planner',
      'next-workflow planner',
      'next-workflow planner',
      'next-workflow selector',
      'next-workflow critic',
      'next-workflow reviewer',
    ])
    // Every candidate lands as its own artifact; the winner becomes PLAN.md.
    const runId = h.session.events
      .map(event => event.data as Record<string, unknown>)
      .find(data => typeof data['runId'] === 'string')?.['runId'] as string
    const runDir = join(roots[0]!, runId)
    expect(await readFile(join(runDir, 'PLAN-1.md'), 'utf8')).toContain('# Plan A')
    expect(await readFile(join(runDir, 'PLAN-2.md'), 'utf8')).toContain('# Plan B')
    expect(await readFile(join(runDir, 'PLAN-3.md'), 'utf8')).toContain('# Plan C')
    expect(await readFile(join(runDir, 'PLAN.md'), 'utf8')).toContain('# Plan B')
    const selection = await readFile(join(runDir, 'SELECTION.md'), 'utf8')
    expect(selection).toContain('Winner: candidate 2 of 3')
    expect(selection).toContain('A names the test helper')

    // The judge saw the SPEC plus all three candidates — never any planner context.
    const selectorPrompt = (h.subagentRequests[4]?.prompt[0] as { text: string }).text
    expect(selectorPrompt).toContain('# SPEC')
    expect(selectorPrompt).toContain('# Candidate plan 1')
    expect(selectorPrompt).toContain('# Candidate plan 3')
    expect(selectorPrompt).toContain('# Plan C')

    // CRITIQUE and IMPLEMENT receive the winning plan, not a loser.
    const criticPrompt = (h.subagentRequests[5]?.prompt[0] as { text: string }).text
    expect(criticPrompt).toContain('# Plan B')
    expect(criticPrompt).not.toContain('# Plan A')
    const steerText = (h.steers[0]?.content[0] as { text: string }).text
    expect(steerText).toContain('# Plan B')

    // The select phase is auditable from the log-only event stream.
    const selectEvent = workflowEvents(h).find(event => event.data['phase'] === 'select')
    expect(selectEvent?.data['selection']).toEqual({
      candidates: 3,
      winner: 2,
      rationale: 'B is the only candidate covering every acceptance check.',
    })
    expect(String(selectEvent?.data['artifact'])).toContain('SELECTION.md')
    const planEvents = workflowEvents(h).filter(event => event.data['phase'] === 'plan')
    expect(planEvents.map(event => event.data['detail'])).toEqual(['candidate 1/3', 'candidate 2/3', 'candidate 3/3'])
  })

  it('fails the run loud when the selector returns an out-of-range winner', async () => {
    const h = makeHarness({
      script: {
        ...HAPPY_SCRIPT,
        plans: [{ plan: '# Plan A' }, { plan: '# Plan B' }, { plan: '# Plan C' }],
        selections: [{ winner: 4, rationale: 'No such candidate.' }],
      },
    })
    apply(h.ctx, await makeConfig({ planCandidates: 3 }))
    const result = await runCommand(h)

    expect(result.kind).toBe('error')
    expect(result.kind === 'error' ? result.text : '').toContain('winner')
    // The invalid winner never becomes PLAN.md, and the critic never runs.
    expect(h.subagentRequests.some(request => request.label === 'next-workflow critic')).toBe(false)
    const end = workflowEvents(h).find(event => event.type === 'next-workflow/end')
    expect(end?.data['outcome']).toBe('failed')
  })

  it('bounds every candidate plan artifact and the selector prompt by maxCandidateChars', async () => {
    const bloated = `# Plan\n\n${'x'.repeat(500)}`
    const h = makeHarness({
      script: {
        ...HAPPY_SCRIPT,
        plans: [{ plan: bloated }, { plan: bloated }],
        selections: [{ winner: 1, rationale: 'First.' }],
      },
    })
    apply(h.ctx, await makeConfig({ planCandidates: 2, maxCandidateChars: 64 }))
    const result = await runCommand(h)

    expect(result.kind).toBe('success')
    const runId = h.session.events
      .map(event => event.data as Record<string, unknown>)
      .find(data => typeof data['runId'] === 'string')?.['runId'] as string
    const runDir = join(roots[0]!, runId)
    for (const file of ['PLAN-1.md', 'PLAN-2.md', 'PLAN.md']) {
      const text = await readFile(join(runDir, file), 'utf8')
      expect(text.length).toBeLessThanOrEqual(64)
      expect(text).toContain('[truncated]')
    }
    // The judge prompt carries the SPEC plus two bounded candidates.
    const selectorPrompt = (h.subagentRequests[3]?.prompt[0] as { text: string }).text
    expect(selectorPrompt.length).toBeLessThanOrEqual(32_768 + 2 * 64 + 512)
    expect(selectorPrompt).not.toContain('x'.repeat(500))
  })

  it('rejects invalid planCandidates at load', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-next-workflow-'))
    roots.push(dir)
    for (const planCandidates of [0, 6, 2.5]) {
      const h = makeHarness()
      expect(() => {
        apply(h.ctx, { workflowsRoot: dir, planCandidates })
      }).toThrow('planCandidates')
    }
  })

  it('loops critique gaps back to PLAN, bounded by maxCritiqueRounds', async () => {
    const h = makeHarness({
      script: {
        ...HAPPY_SCRIPT,
        plans: [{ plan: '# Plan v1' }, { plan: '# Plan v2 closing the gap' }],
        critiques: [{ verdict: 'revise', gaps: ['missing rollback step'] }, { verdict: 'revise', gaps: ['still thin'] }],
      },
    })
    apply(h.ctx, await makeConfig({ verifyCommand: 'check', maxCritiqueRounds: 1 }))
    const result = await runCommand(h)

    expect(result.kind).toBe('success')
    // Two planner rounds, exactly one critic round (the bound stops the loop).
    const planners = h.subagentRequests.filter(request => request.label === 'next-workflow planner')
    const critics = h.subagentRequests.filter(request => request.label === 'next-workflow critic')
    expect(planners).toHaveLength(2)
    expect(critics).toHaveLength(1)
    const revisionPrompt = (planners[1]?.prompt[0] as { text: string }).text
    expect(revisionPrompt).toContain('missing rollback step')
    // The revised plan is what reaches IMPLEMENT and disk.
    const steerText = (h.steers[0]?.content[0] as { text: string }).text
    expect(steerText).toContain('# Plan v2 closing the gap')
    const phases = workflowEvents(h).filter(event => event.type === 'next-workflow/phase')
    expect(phases.map(event => event.data['phase'])).toEqual([
      'intent', 'plan', 'critique', 'plan', 'implement', 'verify', 'review',
    ])
  })

  it('verify failure steers one bounded retry, then settles failed-verification', async () => {
    const h = makeHarness({
      bashQueue: [
        { exitCode: 1, stderr: 'GATE_FAIL_ONE' },
        { exitCode: 1, stderr: 'GATE_FAIL_TWO' },
      ],
    })
    apply(h.ctx, await makeConfig({ verifyCommand: 'pnpm test' }))
    const result = await runCommand(h)

    expect(result.kind).toBe('error')
    expect(result.kind === 'error' ? result.text : '').toContain('failed-verification')
    // Implement steer plus exactly one verify-retry steer carrying bounded gate output.
    expect(h.steers).toHaveLength(2)
    const retryText = (h.steers[1]?.content[0] as { text: string }).text
    expect(retryText).toContain('GATE_FAIL_ONE')
    expect(retryText).toContain('pnpm test')
    expect(h.bashCommands).toEqual(['pnpm test', 'pnpm test'])
    // The reviewer never runs after verify exhaustion.
    expect(h.subagentRequests.some(request => request.label === 'next-workflow reviewer')).toBe(false)
    const end = workflowEvents(h).find(event => event.type === 'next-workflow/end')
    expect(end?.data['outcome']).toBe('failed-verification')
  })

  it('reports unverified honestly when no verifyCommand is configured', async () => {
    const h = makeHarness({ bash: false })
    apply(h.ctx, await makeConfig())
    const result = await runCommand(h)

    expect(result.kind).toBe('success')
    expect(result.kind === 'success' ? result.text ?? '' : '').toContain('completed (verify: unverified)')
    expect(h.bashCommands).toEqual([])
    const verify = workflowEvents(h).find(event => event.data['phase'] === 'verify')
    expect(String(verify?.data['detail'])).toContain('unverified')
    const end = workflowEvents(h).find(event => event.type === 'next-workflow/end')
    expect(end?.data).toMatchObject({ outcome: 'completed', detail: 'unverified' })
  })

  it('fails loud when capabilities are missing', async () => {
    const noSubagents = makeHarness({ subagents: false })
    apply(noSubagents.ctx, await makeConfig())
    const missing = await runCommand(noSubagents)
    expect(missing).toMatchObject({ kind: 'error' })
    expect(missing.kind === 'error' ? missing.text : '').toContain('subagents')
    expect(noSubagents.subagentRequests).toHaveLength(0)

    const noProvider = makeHarness({ provider: false })
    apply(noProvider.ctx, await makeConfig())
    const providerResult = await runCommand(noProvider)
    expect(providerResult.kind === 'error' ? providerResult.text : '').toContain('"spawn"')

    const noSchema = makeHarness({ capabilities: { outputSchema: false, runBudget: false } })
    apply(noSchema.ctx, await makeConfig())
    const capabilityResult = await runCommand(noSchema)
    expect(capabilityResult.kind === 'error' ? capabilityResult.text : '').toContain('outputSchema')

    const inheriting = makeHarness({ inheritsParentContext: true })
    apply(inheriting.ctx, await makeConfig())
    const freshResult = await runCommand(inheriting)
    expect(freshResult.kind === 'error' ? freshResult.text : '').toContain('fresh-context')

    const noPersona = makeHarness({ capabilities: { persona: false, runBudget: false } })
    apply(noPersona.ctx, await makeConfig())
    const personaResult = await runCommand(noPersona)
    expect(personaResult.kind === 'error' ? personaResult.text : '').toContain('persona')

    const noBash = makeHarness({ bash: false })
    apply(noBash.ctx, await makeConfig({ verifyCommand: 'pnpm test' }))
    const bashResultText = await runCommand(noBash)
    expect(bashResultText.kind === 'error' ? bashResultText.text : '').toContain('bash executor')
    expect(noBash.subagentRequests).toHaveLength(0)
  })

  it('rewrites effort for mapped phases, passes others through, and restores after the run', async () => {
    const h = makeHarness({ bashQueue: [{ exitCode: 0 }], priorEffort: ReasoningEffortId('low') })
    // Invoke the captured listener from inside the phase waits, where the
    // active phase is deterministic.
    const implementConfigs: LlmCallConfig[] = []
    h.whenIdle.mockImplementation(async () => {
      if (h.effortListener !== undefined) {
        implementConfigs.push(await h.effortListener({}, () => Promise.resolve({ ...BASE_CONFIG })))
      }
    })
    apply(h.ctx, await makeConfig({ verifyCommand: 'check', phaseEfforts: { implement: 'high' } }))
    const result = await runCommand(h)
    expect(result.kind).toBe('success')

    // The implement-phase request carries the mapped effort.
    expect(implementConfigs).toHaveLength(1)
    expect(implementConfigs[0]?.reasoningEffort).toBe('high')
    expect(implementConfigs[0]?.provider).toBe('mock')

    // The run touched the header, so the listener waits to restore it: the
    // first post-run request puts the pre-run effort back and self-disposes.
    // A second call in the same turn still sees an undefined phase.
    expect(h.disposeEffort).not.toHaveBeenCalled()
    if (h.effortListener === undefined) throw new Error('effort listener was not captured')
    const restored = await h.effortListener({}, () => Promise.resolve({ ...BASE_CONFIG, reasoningEffort: ReasoningEffortId('high') }))
    expect(restored.reasoningEffort).toBe(ReasoningEffortId('low'))
    const afterRestore = await h.effortListener({}, () => Promise.resolve({ ...BASE_CONFIG }))
    expect(afterRestore).toEqual(BASE_CONFIG)
    await new Promise<void>((resolve) => { queueMicrotask(() => { resolve() }) })
    expect(h.disposeEffort).toHaveBeenCalledTimes(1)
  })

  it('drops the injected effort when the pre-run header had none', async () => {
    const h = makeHarness({ bashQueue: [{ exitCode: 0 }] })
    h.whenIdle.mockImplementation(async () => {
      if (h.effortListener !== undefined) {
        await h.effortListener({}, () => Promise.resolve({ ...BASE_CONFIG }))
      }
    })
    apply(h.ctx, await makeConfig({ verifyCommand: 'check', phaseEfforts: { implement: 'high' } }))
    const result = await runCommand(h)
    expect(result.kind).toBe('success')
    if (h.effortListener === undefined) throw new Error('effort listener was not captured')
    const restored = await h.effortListener({}, () => Promise.resolve({ ...BASE_CONFIG, reasoningEffort: ReasoningEffortId('high') }))
    expect(restored.reasoningEffort).toBeUndefined()
    expect(restored.provider).toBe('mock')
  })

  it('passes requests through unchanged for unmapped phases and disposes at run end', async () => {
    const h = makeHarness({ bashQueue: [{ exitCode: 0 }] })
    const implementConfigs: LlmCallConfig[] = []
    h.whenIdle.mockImplementation(async () => {
      if (h.effortListener !== undefined) {
        implementConfigs.push(await h.effortListener({}, () => Promise.resolve({ ...BASE_CONFIG })))
      }
    })
    // Default map covers plan/critique/review only; implement passes through.
    apply(h.ctx, await makeConfig({ verifyCommand: 'check' }))
    const result = await runCommand(h)
    expect(result.kind).toBe('success')
    expect(implementConfigs).toEqual([BASE_CONFIG])
    // Nothing was rewritten, so the listener is disposed outright (no restore pass).
    expect(h.disposeEffort).toHaveBeenCalledTimes(1)
  })

  it('rejects a second concurrent run on the same session', async () => {
    const h = makeHarness({ bashQueue: [{ exitCode: 0 }] })
    let release: (() => void) | undefined
    h.whenIdle.mockImplementation(() => new Promise<void>((resolve) => { release = resolve }))
    apply(h.ctx, await makeConfig({ verifyCommand: 'check' }))
    const first = runCommand(h)
    await vi.waitFor(() => { expect(release).toBeDefined() })
    const second = await runCommand(h)
    expect(second).toMatchObject({ kind: 'error' })
    expect(second.kind === 'error' ? second.text : '').toContain('already running')
    if (release === undefined) throw new Error('unreachable: waitFor proved release is set')
    release()
    const firstResult = await first
    expect(firstResult.kind).toBe('success')
  })

  it('requires a non-empty objective', async () => {
    const h = makeHarness()
    apply(h.ctx, await makeConfig())
    const result = await runCommand(h, '')
    expect(result).toEqual({ kind: 'error', text: 'Usage: /next-workflow [candidates] <objective>' })
  })

  it('fails the run loud when a phase subagent returns malformed output', async () => {
    const h = makeHarness({ script: { ...HAPPY_SCRIPT, intent: { goal: 42 } } })
    apply(h.ctx, await makeConfig())
    const result = await runCommand(h)
    expect(result.kind).toBe('error')
    expect(result.kind === 'error' ? result.text : '').toContain('goal')
    const end = workflowEvents(h).find(event => event.type === 'next-workflow/end')
    expect(end?.data['outcome']).toBe('failed')
  })

  it('rejects invalid Config at apply, including direct calls outside Loader', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-next-workflow-'))
    roots.push(dir)
    const cases: Array<[Config, string]> = [
      [{ provider: '' }, 'provider'],
      [{ provider: ' spawn' }, 'provider'],
      [{ maxCritiqueRounds: -1 }, 'maxCritiqueRounds'],
      [{ maxCritiqueRounds: 1.5 }, 'maxCritiqueRounds'],
      [{ maxVerifyRetries: Number.NaN }, 'maxVerifyRetries'],
      [{ verifyTimeoutMs: 0 }, 'verifyTimeoutMs'],
      [{ maxCandidateChars: 0 }, 'maxCandidateChars'],
      [{ maxArtifactChars: 0 }, 'maxArtifactChars'],
      [{ maxVerifyOutputChars: 0 }, 'maxVerifyOutputChars'],
      [{ maxDiffChars: 0 }, 'maxDiffChars'],
      [{ verifyTimeoutMs: Number.MAX_SAFE_INTEGER + 1 }, 'verifyTimeoutMs'],
      [{ phaseEfforts: { nope: 'high' } }, 'phaseEfforts'],
      [{ phaseEfforts: { plan: '' } }, 'phaseEfforts'],
      [{ phaseEfforts: { plan: ' high' } }, 'phaseEfforts'],
    ]
    for (const [config, fragment] of cases) {
      const h = makeHarness()
      expect(() => {
        apply(h.ctx, Object.assign({ workflowsRoot: dir }, config))
      }).toThrow(fragment)
    }
    // Empty workflowsRoot resolves to the harness home; an empty phase map is legal.
    const defaults = makeHarness()
    expect(() => { apply(defaults.ctx, { phaseEfforts: { select: 'low' } }) }).not.toThrow()
    const emptyMap = makeHarness()
    expect(() => { apply(emptyMap.ctx, { workflowsRoot: dir, phaseEfforts: {} }) }).not.toThrow()
  })

  it('treats a whitespace verifyCommand as unset', async () => {
    const h = makeHarness({ bash: false })
    apply(h.ctx, await makeConfig({ verifyCommand: '   ' }))
    const result = await runCommand(h)
    expect(result.kind === 'success' ? result.text ?? '' : '').toContain('completed (verify: unverified)')
  })

  it('skips critique when maxCritiqueRounds is 0', async () => {
    const h = makeHarness()
    apply(h.ctx, await makeConfig({ maxCritiqueRounds: 0 }))
    const result = await runCommand(h)
    expect(result.kind).toBe('success')
    expect(h.subagentRequests.some(request => request.label === 'next-workflow critic')).toBe(false)
  })

  it('a leading candidate count on the command overrides Config for that run', async () => {
    const h = makeHarness({
      script: {
        ...HAPPY_SCRIPT,
        plans: [{ plan: '# Plan A' }, { plan: '# Plan B' }],
        selections: [{ winner: 1, rationale: 'A is enough.' }],
      },
    })
    apply(h.ctx, await makeConfig({ planCandidates: 1 }))
    const result = await runCommand(h, '2 add tests for foo')
    expect(result.kind).toBe('success')
    expect(h.subagentRequests.filter(request => request.label === 'next-workflow planner')).toHaveLength(2)
    expect(h.subagentRequests.some(request => request.label === 'next-workflow selector')).toBe(true)
  })

  it('labels revised best-of-N candidates and continues after a critique gap', async () => {
    const h = makeHarness({
      script: {
        ...HAPPY_SCRIPT,
        plans: [{ plan: '# A1' }, { plan: '# B1' }, { plan: '# A2' }, { plan: '# B2' }],
        selections: [
          { winner: 1, rationale: 'A1 first.' },
          { winner: 2, rationale: 'B2 closes the gap.' },
        ],
        critiques: [{ verdict: 'revise', gaps: ['missing rollback'] }],
      },
    })
    apply(h.ctx, await makeConfig({ planCandidates: 2, maxCritiqueRounds: 1 }))
    const result = await runCommand(h)
    expect(result.kind).toBe('success')
    const planEvents = workflowEvents(h).filter(event => event.data['phase'] === 'plan')
    expect(planEvents.map(event => event.data['detail'])).toEqual([
      'candidate 1/2',
      'candidate 2/2',
      'candidate 1/2 (revision 1)',
      'candidate 2/2 (revision 1)',
    ])
    const steerText = (h.steers[0]?.content[0] as { text: string }).text
    expect(steerText).toContain('# B2')
  })

  it('records a changes-requested review in the summary', async () => {
    const h = makeHarness({
      script: { ...HAPPY_SCRIPT, review: { verdict: 'changes-requested', findings: ['missing rollback test'] } },
    })
    apply(h.ctx, await makeConfig())
    const result = await runCommand(h)
    expect(result.kind).toBe('success')
    expect(result.kind === 'success' ? result.text ?? '' : '').toContain('review → changes-requested (1 finding(s))')
    const runId = h.session.events
      .map(event => event.data as Record<string, unknown>)
      .find(data => typeof data['runId'] === 'string')?.['runId'] as string
    expect(await readFile(join(roots[0]!, runId, 'REVIEW.md'), 'utf8')).toContain('missing rollback test')
  })

  it('truncates an artifact to the notice prefix when the budget is smaller than the notice', async () => {
    const h = makeHarness()
    apply(h.ctx, await makeConfig({ maxArtifactChars: 5 }))
    const result = await runCommand(h)
    expect(result.kind).toBe('success')
    const runId = h.session.events
      .map(event => event.data as Record<string, unknown>)
      .find(data => typeof data['runId'] === 'string')?.['runId'] as string
    const spec = await readFile(join(roots[0]!, runId, 'SPEC.md'), 'utf8')
    expect(spec).toBe('\n… [t')
  })

  it('settles failed-verification on the first gate failure when maxVerifyRetries is 0', async () => {
    const h = makeHarness({ bashQueue: [{ exitCode: 1, stderr: 'ONCE' }] })
    apply(h.ctx, await makeConfig({ verifyCommand: 'check', maxVerifyRetries: 0 }))
    const result = await runCommand(h)
    expect(result.kind).toBe('error')
    expect(result.kind === 'error' ? result.text : '').toContain('failed-verification')
    expect(h.steers).toHaveLength(1)
    expect(h.bashCommands).toEqual(['check'])
  })

  it('steers a verify retry with (no output) and reports timed-out / aborted details', async () => {
    const timeout = makeHarness({ bashQueue: [{ exitCode: 1, timedOut: true }] })
    apply(timeout.ctx, await makeConfig({ verifyCommand: 'check', maxVerifyRetries: 0 }))
    const timedOut = await runCommand(timeout)
    expect(timedOut.kind === 'error' ? timedOut.text : '').toContain('timed out')

    const aborted = makeHarness({ bashQueue: [{ exitCode: 1, aborted: true }] })
    apply(aborted.ctx, await makeConfig({ verifyCommand: 'check', maxVerifyRetries: 0 }))
    const abortedResult = await runCommand(aborted)
    expect(abortedResult.kind === 'error' ? abortedResult.text : '').toContain('was aborted')

    const empty = makeHarness({
      bashQueue: [{ exitCode: 1 }, { exitCode: 1 }],
    })
    apply(empty.ctx, await makeConfig({ verifyCommand: 'check' }))
    const emptyResult = await runCommand(empty)
    expect(emptyResult.kind).toBe('error')
    expect((empty.steers[1]?.content[0] as { text: string }).text).toContain('(no output)')
  })

  it('reports verified after one retry and after two retries', async () => {
    const one = makeHarness({
      bashQueue: [{ exitCode: 1, stderr: 'fail-1' }, { exitCode: 0 }],
    })
    apply(one.ctx, await makeConfig({ verifyCommand: 'check' }))
    const oneResult = await runCommand(one)
    expect(oneResult.kind === 'success' ? oneResult.text ?? '' : '').toContain('after 1 retry')

    const two = makeHarness({
      bashQueue: [{ exitCode: 1 }, { exitCode: 1 }, { exitCode: 0 }],
    })
    apply(two.ctx, await makeConfig({ verifyCommand: 'check', maxVerifyRetries: 2 }))
    const twoResult = await runCommand(two)
    expect(twoResult.kind === 'success' ? twoResult.text ?? '' : '').toContain('after 2 retries')
  })

  it('omits verify workdir when the session has no cwd', async () => {
    const h = makeHarness({ omitCwd: true, bashQueue: [{ exitCode: 0 }] })
    apply(h.ctx, await makeConfig({ verifyCommand: 'check' }))
    const result = await runCommand(h)
    expect(result.kind).toBe('success')
    const gate = h.bashSpecs.find(spec => spec.command === 'check')
    expect(gate?.workdir).toBe('/tmp')
  })

  it('passes an already-mapped effort through and disposes without a restore pass', async () => {
    const h = makeHarness({ bashQueue: [{ exitCode: 0 }] })
    h.whenIdle.mockImplementation(async () => {
      if (h.effortListener !== undefined) {
        await h.effortListener({}, () => Promise.resolve({ ...BASE_CONFIG, reasoningEffort: ReasoningEffortId('high') }))
      }
    })
    apply(h.ctx, await makeConfig({ verifyCommand: 'check', phaseEfforts: { implement: 'high' } }))
    const result = await runCommand(h)
    expect(result.kind).toBe('success')
    expect(h.disposeEffort).toHaveBeenCalledTimes(1)
  })

  it('falls back through git and bash when collecting the review diff', async () => {
    const viaBash = makeHarness({
      git: false,
      bashQueue: [{ exitCode: 0, stdout: 'BASH_DIFF' }],
    })
    apply(viaBash.ctx, await makeConfig())
    const viaBashResult = await runCommand(viaBash)
    expect(viaBashResult.kind).toBe('success')
    expect((viaBash.subagentRequests.at(-1)?.prompt[0] as { text: string }).text).toContain('BASH_DIFF')

    const gitThrows = makeHarness({
      gitDiff: () => Promise.reject(new Error('not a repo')),
      bashQueue: [{ exitCode: 0, stdout: 'AFTER_GIT_FAIL' }],
    })
    apply(gitThrows.ctx, await makeConfig())
    await runCommand(gitThrows)
    expect((gitThrows.subagentRequests.at(-1)?.prompt[0] as { text: string }).text).toContain('AFTER_GIT_FAIL')

    const bashThrows = makeHarness({ git: false, bashThrowOn: 'git diff HEAD' })
    apply(bashThrows.ctx, await makeConfig())
    await runCommand(bashThrows)
    expect((bashThrows.subagentRequests.at(-1)?.prompt[0] as { text: string }).text)
      .toContain('(no git diff available')

    const bashFails = makeHarness({ git: false, bashQueue: [{ exitCode: 1 }] })
    apply(bashFails.ctx, await makeConfig())
    await runCommand(bashFails)
    expect((bashFails.subagentRequests.at(-1)?.prompt[0] as { text: string }).text)
      .toContain('(no git diff available')

    const none = makeHarness({ git: false, bash: false })
    apply(none.ctx, await makeConfig())
    await runCommand(none)
    expect((none.subagentRequests.at(-1)?.prompt[0] as { text: string }).text)
      .toContain('(no git diff available')

    const noCwd = makeHarness({
      omitCwd: true,
      gitDiff: () => Promise.resolve({ diff: 'SHOULD_NOT_SEE' }),
      bashQueue: [{ exitCode: 0, stdout: 'NO_CWD_BASH' }],
    })
    apply(noCwd.ctx, await makeConfig())
    await runCommand(noCwd)
    const reviewPrompt = (noCwd.subagentRequests.at(-1)?.prompt[0] as { text: string }).text
    expect(reviewPrompt).toContain('NO_CWD_BASH')
    expect(reviewPrompt).not.toContain('SHOULD_NOT_SEE')
  })

  it('fails the run when the implement turn is already aborted or rejects', async () => {
    const pre = makeHarness()
    const preAbort = new AbortController()
    preAbort.abort('already-stopped')
    apply(pre.ctx, await makeConfig())
    const preResult = await runCommand(pre, 'add tests for foo', preAbort.signal)
    expect(preResult.kind === 'error' ? preResult.text : '').toContain('already-stopped')

    const noReason = makeHarness()
    const emptyAbort = new AbortController()
    emptyAbort.abort(1)
    apply(noReason.ctx, await makeConfig())
    const noReasonResult = await runCommand(noReason, 'add tests for foo', emptyAbort.signal)
    expect(noReasonResult.kind === 'error' ? noReasonResult.text : '').toContain('/next-workflow aborted')

    const mid = makeHarness()
    const midAbort = new AbortController()
    mid.whenIdle.mockImplementation(() => new Promise(() => { midAbort.abort(new Error('user cancel')) }))
    apply(mid.ctx, await makeConfig())
    const midResult = await runCommand(mid, 'add tests for foo', midAbort.signal)
    expect(midResult.kind === 'error' ? midResult.text : '').toContain('user cancel')
    expect(mid.cancel).toHaveBeenCalledWith({ kind: 'user' })

    const idleErr = makeHarness()
    idleErr.whenIdle.mockImplementation(() => Promise.reject(new Error('idle-broke')))
    apply(idleErr.ctx, await makeConfig())
    const idleErrResult = await runCommand(idleErr)
    expect(idleErrResult.kind === 'error' ? idleErrResult.text : '').toContain('idle-broke')

    const idleWrap = makeHarness()
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- the non-Error rejection is the wrap path under test
    idleWrap.whenIdle.mockImplementation(() => Promise.reject('idle-string'))
    apply(idleWrap.ctx, await makeConfig())
    const idleWrapResult = await runCommand(idleWrap)
    expect(idleWrapResult.kind === 'error' ? idleWrapResult.text : '').toContain('idle-string')
  })

  it('aggregates phase-run failures and rejects incomplete structured results', async () => {
    const both = makeHarness({
      subagentRun: () => ({
        id: SessionId('both'),
        localAgent: undefined,
        result: Promise.reject(new Error('phase-boom')),
        dispose: () => Promise.reject(new Error('dispose-boom')),
      }),
    })
    apply(both.ctx, await makeConfig())
    const bothResult = await runCommand(both)
    expect(bothResult.kind === 'error' ? bothResult.text : '').toContain('phase-boom')
    expect(bothResult.kind === 'error' ? bothResult.text : '').toContain('dispose-boom')

    const resultOnly = makeHarness({
      subagentRun: () => ({
        id: SessionId('result-only'),
        localAgent: undefined,
        result: Promise.reject(new Error('result-only')),
        dispose: () => Promise.resolve(),
      }),
    })
    apply(resultOnly.ctx, await makeConfig())
    const resultOnlyOutcome = await runCommand(resultOnly)
    expect(resultOnlyOutcome.kind === 'error' ? resultOnlyOutcome.text : '').toContain('result-only')

    const disposeOnly = makeHarness({
      subagentRun: (_request, structured) => ({
        id: SessionId('dispose-only'),
        localAgent: undefined,
        result: Promise.resolve({ output: [], structured, stopReason: 'completed' as const }),
        dispose: () => Promise.reject(new Error('dispose-only')),
      }),
    })
    apply(disposeOnly.ctx, await makeConfig())
    const disposeOnlyOutcome = await runCommand(disposeOnly)
    expect(disposeOnlyOutcome.kind === 'error' ? disposeOnlyOutcome.text : '').toContain('dispose-only')

    const incomplete = makeHarness({
      subagentRun: () => ({
        id: SessionId('stop'),
        localAgent: undefined,
        result: Promise.resolve({ output: [], structured: { goal: 'x' }, stopReason: 'aborted' as const }),
        dispose: () => Promise.resolve(),
      }),
    })
    apply(incomplete.ctx, await makeConfig())
    const incompleteOutcome = await runCommand(incomplete)
    expect(incompleteOutcome.kind === 'error' ? incompleteOutcome.text : '').toContain('did not complete')

    const noStructured = makeHarness({
      subagentRun: () => ({
        id: SessionId('none'),
        localAgent: undefined,
        result: Promise.resolve({ output: [], stopReason: 'completed' as const }),
        dispose: () => Promise.resolve(),
      }),
    })
    apply(noStructured.ctx, await makeConfig())
    const noStructuredOutcome = await runCommand(noStructured)
    expect(noStructuredOutcome.kind === 'error' ? noStructuredOutcome.text : '').toContain('no structured result')

    const thrown = makeHarness({
      subagentRun: () => ({
        id: SessionId('string'),
        localAgent: undefined,
        // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- the non-Error rejection is the catch-string path
        result: Promise.reject('structured-boom'),
        dispose: () => Promise.resolve(),
      }),
    })
    apply(thrown.ctx, await makeConfig())
    const thrownOutcome = await runCommand(thrown)
    expect(thrownOutcome.kind === 'error' ? thrownOutcome.text : '').toContain('structured-boom')
  })

  it('fails the run when a phase artifact cannot be written', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-next-workflow-'))
    roots.push(dir)
    const blocked = join(dir, 'blocked')
    await writeFile(blocked, 'not-a-directory')
    const h = makeHarness()
    apply(h.ctx, { workflowsRoot: blocked })
    const result = await runCommand(h)
    expect(result.kind).toBe('error')
    expect(result.kind === 'error' ? result.text : '').toContain('failed')
  })

  it('keeps the original failure when the end-marker append also throws', async () => {
    const h = makeHarness({ script: { ...HAPPY_SCRIPT, intent: { goal: 42 } } })
    const original = h.session.append.bind(h.session)
    vi.spyOn(h.session, 'append').mockImplementation((type, data, ...rest) => {
      if (type === 'next-workflow/end') throw new Error('journal sealed')
      return original(type as never, data as never, ...rest as never)
    })
    apply(h.ctx, await makeConfig())
    const result = await runCommand(h)
    expect(result.kind === 'error' ? result.text : '').toContain('goal')
    expect(result.kind === 'error' ? result.text : '').not.toContain('journal sealed')
  })
})

describe('parseInvocationInput', () => {
  it('plain objective keeps the Config default (no override)', () => {
    expect(parseInvocationInput('fix the login bug')).toEqual({ objective: 'fix the login bug' })
  })

  it('a leading integer overrides planCandidates for this run', () => {
    expect(parseInvocationInput('3 redesign the parser')).toEqual({ objective: 'redesign the parser', planCandidates: 3 })
    expect(parseInvocationInput('1  plain run')).toEqual({ objective: 'plain run', planCandidates: 1 })
  })

  it('out-of-range counts and empty input fail loud', () => {
    expect(parseInvocationInput('')).toEqual({ error: 'Usage: /next-workflow [candidates] <objective>' })
    for (const raw of ['0 task', '6 task', '9007199254740992 task']) {
      const parsed = parseInvocationInput(raw)
      expect('error' in parsed).toBe(true)
      if ('error' in parsed) expect(parsed.error).toContain('1..5')
    }
  })
})

describe('structured-output validation', () => {
  it('distillSpec rejects malformed shapes', () => {
    expect(() => distillSpec(null)).toThrow()
    expect(() => distillSpec({ goal: '', constraints: [], areas: [], acceptance: [] })).toThrow()
    expect(() => distillSpec({ goal: 'g', constraints: ['x', 1], areas: [], acceptance: [] })).toThrow()
    expect(distillSpec({ goal: 'g', constraints: [], areas: [], acceptance: ['a'] })).toEqual({
      goal: 'g', constraints: [], areas: [], acceptance: ['a'],
    })
  })

  it('distillPlan requires a non-empty plan', () => {
    expect(() => distillPlan(null)).toThrow('no structured result object')
    expect(() => distillPlan({})).toThrow()
    expect(() => distillPlan({ plan: '  ' })).toThrow()
    expect(distillPlan({ plan: '# Plan' })).toBe('# Plan')
  })

  it('distillCritique keeps the loop decision one-valued', () => {
    expect(() => distillCritique('x')).toThrow('no structured result object')
    expect(distillCritique({ verdict: 'approve', gaps: ['stray'] })).toEqual({ verdict: 'approve', gaps: [] })
    expect(distillCritique({ verdict: 'revise', gaps: ['gap'] })).toEqual({ verdict: 'revise', gaps: ['gap'] })
    expect(() => distillCritique({ verdict: 'revise', gaps: [] })).toThrow()
    expect(() => distillCritique({ verdict: 'maybe', gaps: [] })).toThrow()
  })

  it('distillReview keeps the summary one-valued', () => {
    expect(() => distillReview(1)).toThrow('no structured result object')
    expect(distillReview({ verdict: 'approve', findings: ['stray'] })).toEqual({ verdict: 'approve', findings: [] })
    expect(distillReview({ verdict: 'changes-requested', findings: ['bug'] }))
      .toEqual({ verdict: 'changes-requested', findings: ['bug'] })
    expect(() => distillReview({ verdict: 'changes-requested', findings: [] })).toThrow()
    expect(() => distillReview({ verdict: 'lgtm', findings: [] })).toThrow()
  })

  it('distillSelection range-validates the winner against the candidate count', () => {
    expect(distillSelection({ winner: 2, rationale: 'B wins' }, 3))
      .toEqual({ winner: 2, rationale: 'B wins', mergeHints: [] })
    expect(distillSelection({ winner: 1, rationale: 'A wins', mergeHints: ['keep C’s rollback step', ''] }, 2))
      .toEqual({ winner: 1, rationale: 'A wins', mergeHints: ['keep C’s rollback step'] })
    expect(() => distillSelection(null, 3)).toThrow()
    expect(() => distillSelection({ winner: 0, rationale: 'r' }, 3)).toThrow()
    expect(() => distillSelection({ winner: 4, rationale: 'r' }, 3)).toThrow()
    expect(() => distillSelection({ winner: 1.5, rationale: 'r' }, 3)).toThrow()
    expect(() => distillSelection({ winner: '2', rationale: 'r' }, 3)).toThrow()
    expect(() => distillSelection({ winner: 1, rationale: ' ' }, 3)).toThrow()
    expect(() => distillSelection({ winner: 1, rationale: 'r', mergeHints: [1] }, 3)).toThrow()
  })
})
