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
 *
 * @module @huiliyi37/dsh-next-workflow/tests/next-workflow
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
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
import { apply, distillCritique, distillPlan, distillReview, distillSpec } from '../src/index.ts'
import type { Config } from '../src/index.ts'

const FULL_CAPABILITIES: SubagentCapabilities = {
  outputSchema: true,
  depthLimit: true,
  toolFilter: true,
  persona: true,
  sandboxMode: true,
}

/** Scripted structured outputs, keyed by phase; planner/critic queues are consumed in order. */
interface Script {
  intent?: unknown
  plans?: unknown[]
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
  effortListener: EffortListener | undefined
  disposeEffort: ReturnType<typeof vi.fn>
  whenIdle: Mock<() => Promise<void>>
}

function bashResult(outcome: BashOutcome): BashRunResult {
  return {
    exitCode: outcome.exitCode,
    signal: null,
    timedOut: outcome.timedOut ?? false,
    aborted: false,
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
  git?: boolean
} = {}): Harness {
  const script = opts.script ?? HAPPY_SCRIPT
  const plans = [...script.plans ?? []]
  const critiques = [...script.critiques ?? []]
  const commands: CommandDefinition[] = []
  const subagentRequests: SubagentStartRequest[] = []
  const steers: UserMessage[] = []
  const bashCommands: string[] = []
  const bashQueue = [...opts.bashQueue ?? []]
  const sessionId = SessionId('nw-unit')
  const session = Session.create(sessionId, undefined, {
    version: 0,
    id: sessionId,
    createdAt: 0,
    cwd: '/tmp/nw-unit-workspace',
  })
  const harness: Harness = {
    ctx: undefined as unknown as Context,
    agent: undefined as unknown as Agent,
    session,
    commands,
    subagentRequests,
    steers,
    bashCommands,
    effortListener: undefined,
    disposeEffort: vi.fn(),
    whenIdle: vi.fn(() => Promise.resolve()),
  }

  const structuredFor = (label: string): unknown => {
    if (label.includes('intent')) return script.intent
    if (label.includes('planner')) return plans.shift()
    if (label.includes('critic')) return critiques.shift()
    return script.review
  }
  const subagents = {
    getProvider: (name: string) => (opts.provider === false || name !== 'spawn'
      ? undefined
      : {
        name: 'spawn',
        capabilities: { ...FULL_CAPABILITIES, ...opts.capabilities },
        inheritsParentContext: opts.inheritsParentContext ?? false,
      }),
    start: vi.fn(async (_provider: string, request: SubagentStartRequest): Promise<SubagentRun> => {
      subagentRequests.push(request)
      const result: SubagentResult = {
        output: [],
        structured: structuredFor(request.label ?? ''),
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
      return Promise.resolve(bashResult(bashQueue.shift() ?? { exitCode: 0 }))
    },
    start: (): never => { throw new Error('background processes are not scripted') },
  }
  const git = {
    diff: () => Promise.resolve({ diff: 'DIFF_BODY' }),
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
    cancel: vi.fn(),
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

    const noSchema = makeHarness({ capabilities: { outputSchema: false } })
    apply(noSchema.ctx, await makeConfig())
    const capabilityResult = await runCommand(noSchema)
    expect(capabilityResult.kind === 'error' ? capabilityResult.text : '').toContain('outputSchema')

    const inheriting = makeHarness({ inheritsParentContext: true })
    apply(inheriting.ctx, await makeConfig())
    const freshResult = await runCommand(inheriting)
    expect(freshResult.kind === 'error' ? freshResult.text : '').toContain('fresh-context')

    const noBash = makeHarness({ bash: false })
    apply(noBash.ctx, await makeConfig({ verifyCommand: 'pnpm test' }))
    const bashResultText = await runCommand(noBash)
    expect(bashResultText.kind === 'error' ? bashResultText.text : '').toContain('bash executor')
    expect(noBash.subagentRequests).toHaveLength(0)
  })

  it('rewrites effort for mapped phases, passes others through, and restores after the run', async () => {
    const h = makeHarness({ bashQueue: [{ exitCode: 0 }] })
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
    // first post-run request drops the injected effort and self-disposes.
    expect(h.disposeEffort).not.toHaveBeenCalled()
    if (h.effortListener === undefined) throw new Error('effort listener was not captured')
    const restored = await h.effortListener({}, () => Promise.resolve({ ...BASE_CONFIG, reasoningEffort: ReasoningEffortId('high') }))
    expect(restored.reasoningEffort).toBeUndefined()
    await new Promise<void>((resolve) => { queueMicrotask(() => { resolve() }) })
    expect(h.disposeEffort).toHaveBeenCalledTimes(1)
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
    expect(result).toEqual({ kind: 'error', text: 'Usage: /next-workflow <objective>' })
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
    expect(() => distillPlan({})).toThrow()
    expect(() => distillPlan({ plan: '  ' })).toThrow()
    expect(distillPlan({ plan: '# Plan' })).toBe('# Plan')
  })

  it('distillCritique keeps the loop decision one-valued', () => {
    expect(distillCritique({ verdict: 'approve', gaps: ['stray'] })).toEqual({ verdict: 'approve', gaps: [] })
    expect(distillCritique({ verdict: 'revise', gaps: ['gap'] })).toEqual({ verdict: 'revise', gaps: ['gap'] })
    expect(() => distillCritique({ verdict: 'revise', gaps: [] })).toThrow()
    expect(() => distillCritique({ verdict: 'maybe', gaps: [] })).toThrow()
  })

  it('distillReview keeps the summary one-valued', () => {
    expect(distillReview({ verdict: 'approve', findings: ['stray'] })).toEqual({ verdict: 'approve', findings: [] })
    expect(distillReview({ verdict: 'changes-requested', findings: ['bug'] }))
      .toEqual({ verdict: 'changes-requested', findings: ['bug'] })
    expect(() => distillReview({ verdict: 'changes-requested', findings: [] })).toThrow()
    expect(() => distillReview({ verdict: 'lgtm', findings: [] })).toThrow()
  })
})
