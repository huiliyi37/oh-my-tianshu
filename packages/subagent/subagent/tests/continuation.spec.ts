import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@huiliyi37/cordis'
import type { Agent } from '@huiliyi37/dsh-agent'
import AgentLoop from '@huiliyi37/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@huiliyi37/dsh-agent-loop-testkit'
import { SessionId } from '@huiliyi37/dsh-session'
import type { SessionEvent } from '@huiliyi37/dsh-session'
import JsonlSessionPersistence from '@huiliyi37/dsh-session-persistence-jsonl'
import * as SubagentSpawn from '@huiliyi37/dsh-subagent-spawn'
import * as SubagentFork from '@huiliyi37/dsh-subagent-fork'
import type { GenerateOptions, MessageId, StreamChunk } from '@huiliyi37/dsh-llm'
import { createUserMessage, LlmAdapter } from '@huiliyi37/dsh-llm'
import { defineTool } from '@huiliyi37/dsh-tools'
import InvariantService from '@huiliyi37/dsh-invariants'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import SubagentService, {
  SubagentError,
  SUBAGENT_DESCRIPTOR_VERSION,
} from '../src/index.ts'
import type { SubagentRunEndInfo, SubagentRunInfo } from '../src/index.ts'
import * as SubagentInvariant from '../src/invariant.ts'

type Script = ConstructorParameters<typeof MockAdapter>[0]

/** One scripted response that may wait on a caller-released gate before streaming. */
interface GatedEntry {
  chunks: StreamChunk[]
  gate?: Promise<undefined>
}

/** Adapter whose entries can hold a model call open until the test releases it. */
class GatedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  constructor(private script: GatedEntry[]) {
    super()
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const entry = this.script.shift()
    if (!entry) throw new Error('GatedAdapter: script exhausted')
    if (entry.gate) await entry.gate
    for (const chunk of entry.chunks) {
      if (options.signal?.aborted) throw new Error('aborted')
      yield chunk
    }
  }
}

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** Boot the full continuable stack: loop, persistence, providers, and subagents. */
async function setupWith(adapter: LlmAdapter, options: { persistence?: boolean } = {}) {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  let disposePersistence: (() => Promise<void>) | undefined
  let root: string | undefined
  if (options.persistence !== false) {
    root = mkdtempSync(join(tmpdir(), 'dsh-subagent-continuation-'))
    roots.push(root)
    const persistenceFiber = await ctx.plugin(JsonlSessionPersistence, { root })
    disposePersistence = () => persistenceFiber.dispose()
  }
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentService)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  await ctx.plugin(SubagentFork, { providerName: 'fork' })
  ctx.llm.registerAdapter(['mock'], adapter)
  const parent = ctx.agentLoop.create(SessionId('parent'), { provider: 'mock', model: 'mock' })
  return { ctx, parent, disposePersistence, root }
}

async function setup(script: Script, options: { persistence?: boolean } = {}) {
  const adapter = new MockAdapter(script)
  const booted = await setupWith(adapter, options)
  return { ...booted, adapter }
}

const testSignal = new AbortController().signal

function startSpec(parent: Agent, provider = 'spawn', signal: AbortSignal = testSignal) {
  return {
    provider,
    label: 'child task',
    request: { prompt: [{ type: 'text' as const, text: 'child task' }], parent },
    signal,
  }
}

function message(text: string) {
  return [{ type: 'text' as const, text }]
}

function hasUserText(events: readonly SessionEvent[], text: string): boolean {
  return events.some(event => event.type === 'user/message'
    && event.data.content.some(block => block.type === 'text' && block.text === text))
}

/** Every user-role message text in log order, for FIFO assertions. */
function userTexts(events: readonly SessionEvent[]): string[] {
  return events.flatMap(event => event.type === 'user/message'
    ? event.data.content.flatMap(block => block.type === 'text' ? [block.text] : [])
    : [])
}

function followup(
  ctx: Context,
  parent: Agent,
  childId: SessionId,
  content: ReturnType<typeof message>,
  signal: AbortSignal = testSignal,
) {
  return ctx.subagents.followup(parent, childId, content, {
    source: { kind: 'user' },
    signal,
  })
}

/**
 * Exercise manager-wide teardown through the package-private owner rather than
 * adding the irreversible operation to the public service contract.
 */
function drainManager(ctx: Context): Promise<void> {
  const manager = (ctx.subagents as unknown as {
    continuations?: { drain(): Promise<void> }
  }).continuations
  if (manager === undefined) throw new Error('expected a bound continuation manager')
  return manager.drain()
}

/** Wait until a child's Activation is gone, i.e. its handle finished disposal. */
async function waitNoActivation(ctx: Context, childId: SessionId): Promise<void> {
  await vi.waitFor(() => {
    expect(ctx.agents.get(childId)).toBeUndefined()
  }, { timeout: 5_000 })
}

/** Observe calls at the Agent cancellation boundary without a production event. */
function observeCancel(agent: Agent, callback: () => void): void {
  const cancel = agent.cancel.bind(agent)
  let observed = false
  vi.spyOn(agent, 'cancel').mockImplementation((cause, options) => {
    if (!observed) {
      observed = true
      callback()
    }
    cancel(cause, options)
  })
}

describe('SubagentService.startContinuable', () => {
  it('returns both identities at inbox acceptance, without waiting for the turn or the log', async () => {
    const { ctx, parent, adapter } = await setup([textResponse('first answer')])
    const enqueued: { id: MessageId; loggedYet: boolean }[] = []
    ctx.on('agent/inbox/inserted', ({ agent, message }) => {
      // Acceptance is the boundary `startContinuable` resolves at, so observe
      // the log state exactly there rather than after later microtasks.
      enqueued.push({ id: message.id, loggedYet: hasUserText(agent.session.events, 'child task') })
    })

    const started = await ctx.subagents.startContinuable(startSpec(parent))

    expect(started.childId).toMatch(/[0-9a-f-]{36}/)
    // The returned id is exactly the accepted inbox message's id, and nothing
    // was logged or requested to earn it.
    expect(enqueued).toEqual([{ id: started.messageId, loggedYet: false }])
    expect(adapter.requests).toEqual([])

    await waitNoActivation(ctx, started.childId)
    const loaded = await ctx.sessionPersistence.load(started.childId)
    expect(hasUserText(loaded.events, 'child task')).toBe(true)
  })

  it('rejects without ids when the provider has no prepareContinuable capability', async () => {
    const { ctx, parent } = await setup([])
    const start = vi.fn(async () => { throw new Error('must not dispatch') })
    ctx.subagents.registerProvider({
      name: 'one-shot',
      capabilities: { outputSchema: false, depthLimit: false, toolFilter: false, persona: false, sandboxMode: false },
      inheritsParentContext: false,
      start,
    })

    await expect(ctx.subagents.startContinuable(startSpec(parent, 'one-shot')))
      .rejects.toThrow(/does not support continuable children/)
    expect(start).not.toHaveBeenCalled()
    // No child Agent and no session were created.
    expect(ctx.agents.list().map(agent => agent.id)).toEqual([SessionId('parent')])
  })

  it('rejects synchronously when persistence is not configured', async () => {
    const { ctx, parent } = await setup([textResponse('unused')], { persistence: false })
    await expect(ctx.subagents.startContinuable(startSpec(parent)))
      .rejects.toThrow(/require session persistence/)
  })

  it('publishes the reserved child id and appends the pre-turn descriptor', async () => {
    const { ctx, parent } = await setup([textResponse('answer')])
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await waitNoActivation(ctx, started.childId)

    const loaded = await ctx.sessionPersistence.load(started.childId)
    const descriptorIndex = loaded.events.findIndex(event => event.type === 'subagent/descriptor')
    const turnStartIndex = loaded.events.findIndex(event => event.type === 'turn/start')
    expect(descriptorIndex).toBeGreaterThanOrEqual(0)
    expect(descriptorIndex).toBeLessThan(turnStartIndex)
    const descriptor = loaded.events[descriptorIndex] as SessionEvent<'subagent/descriptor'>
    expect(descriptor.data).toEqual({
      version: SUBAGENT_DESCRIPTOR_VERSION,
      mode: 'continuable',
      provider: 'spawn',
      label: 'child task',
      agentProvider: 'mock',
      agentModel: 'mock',
    })
    // Model-hidden: the descriptor never carries surface metadata.
    expect('surfaceOp' in descriptor).toBe(false)
    expect(loaded.meta.id).toBe(started.childId)
    expect(loaded.meta.parentSession).toBe(SessionId('parent'))
    expect(loaded.meta.origin).toBe('subagent')
  })

  it('persists a requested sandbox narrowing on the child log across cold resume', async () => {
    const { ctx, parent } = await setup([textResponse('first'), textResponse('after resume')])
    const spec = startSpec(parent)
    const started = await ctx.subagents.startContinuable({
      ...spec,
      request: { ...spec.request, sandboxMode: 'read-only' as const },
    })
    await waitNoActivation(ctx, started.childId)

    const loaded = await ctx.sessionPersistence.load(started.childId)
    const modeEvents = loaded.events.filter(event => event.type === 'sandbox/mode')
    expect(modeEvents).toHaveLength(1)
    expect(modeEvents[0]).toMatchObject({ data: { mode: 'read-only', source: 'delegation' } })

    // Cold resume replays the durable event instead of appending a fresh one.
    await followup(ctx, parent, started.childId, message('again'))
    await waitNoActivation(ctx, started.childId)
    const reloaded = await ctx.sessionPersistence.load(started.childId)
    expect(reloaded.events.filter(event => event.type === 'sandbox/mode')).toHaveLength(1)
  })

  it('rolls the child back completely when the caller signal aborts before acceptance', async () => {
    const { ctx, parent } = await setup([textResponse('unused')])
    const controller = new AbortController()
    // Abort inside the child's creation window: setup runs before publication.
    ctx.on('agent/created', ({ agent: child }) => {
      if (child !== parent) controller.abort('caller gave up')
    })

    await expect(ctx.subagents.startContinuable(startSpec(parent, 'spawn', controller.signal)))
      .rejects.toThrow()
    // No Activation, no live child Agent, and no parent ownership remains.
    await vi.waitFor(() => {
      expect(ctx.agents.list().map(agent => agent.id)).toEqual([SessionId('parent')])
    })
  })

  it('rolls the child back when the signal aborts between publication and acceptance', async () => {
    const { ctx, parent } = await setup([textResponse('unused')])
    const controller = new AbortController()
    // `subagent/start` fires once the epoch is resident, before the prompt is
    // submitted, so cancelling here lands squarely in the handoff window.
    ctx.on('subagent/start', () => { controller.abort('caller gave up') })

    await expect(ctx.subagents.startContinuable(startSpec(parent, 'spawn', controller.signal)))
      .rejects.toThrow()

    // No resident child and no queued turn survive the abort.
    await vi.waitFor(() => {
      expect(ctx.agents.list().map(agent => agent.id)).toEqual([SessionId('parent')])
    })
  })

  it('rolls an unpublished Activation back when lifecycle publication fails', async () => {
    const { ctx, parent } = await setup([textResponse('unused')])
    const ends: SubagentRunEndInfo[] = []
    ctx.on('subagent/end', (info) => {
      if ('runId' in info) ends.push(info)
    })
    ctx.on('internal/dispatch', (_mode, eventName) => {
      if (eventName === 'subagent/start') throw new Error('start publication failed')
    }, { global: true })

    await expect(ctx.subagents.startContinuable(startSpec(parent)))
      .rejects.toThrow(/start publication failed/)

    await vi.waitFor(() => {
      expect(ctx.agents.list().map(agent => agent.id)).toEqual([SessionId('parent')])
    })
    expect(ends).toEqual([])
    await expect(drainManager(ctx)).resolves.toBeUndefined()
  })

  it('rejects a continuable child that would exceed the configured depth cap', async () => {
    const { ctx, parent } = await setup([])
    await expect(ctx.subagents.startContinuable({
      ...startSpec(parent),
      request: { prompt: message('deep'), parent, maxDepth: 0 },
    })).rejects.toThrow(/exceeds maxDepth 0/)
    expect(ctx.agents.list().map(agent => agent.id)).toEqual([SessionId('parent')])
  })

  it('rejects an invalid continuable depth cap before provider preparation', async () => {
    const { ctx, parent } = await setup([])
    await expect(ctx.subagents.startContinuable({
      ...startSpec(parent),
      request: { prompt: message('deep'), parent, maxDepth: Number.NaN },
    })).rejects.toThrow(/non-negative safe integer/)
    expect(ctx.agents.list().map(agent => agent.id)).toEqual([SessionId('parent')])
  })

  it('omits undeclared composition fields from the descriptor', async () => {
    const { ctx } = await setup([])
    // A routeless parent declares no provider/model, and this start declares no
    // persona or tool filter, so the descriptor records only what exists.
    const routeless = ctx.agentLoop.create(SessionId('routeless'), {})
    const started = await ctx.subagents.startContinuable(startSpec(routeless))
    const child = await vi.waitFor(() => {
      const found = ctx.agents.get(started.childId)
      expect(found).toBeDefined()
      return found!
    })
    const descriptor = child.session.events.find(event => event.type === 'subagent/descriptor')

    expect(descriptor?.data).toEqual({
      version: SUBAGENT_DESCRIPTOR_VERSION,
      mode: 'continuable',
      provider: 'spawn',
      label: 'child task',
    })
    await drainManager(ctx)
  })

  it('records a declared tool filter in the descriptor', async () => {
    const { ctx } = await setup([])
    // Register one global tool so the filter names something real.
    ctx.tools.register(defineTool({
      name: 'noop',
      description: 'does nothing',
      parameters: {},
      output: {
        schema: { type: 'object', additionalProperties: false, properties: {} },
        render: () => [{ type: 'text', text: 'noop' }],
      },
      execute: () => Promise.resolve({}),
    }))
    const routeless = ctx.agentLoop.create(SessionId('routeless-filtered'), {})
    const started = await ctx.subagents.startContinuable({
      ...startSpec(routeless),
      request: { prompt: message('filtered work'), parent: routeless, toolFilter: { deny: ['noop'] } },
    })
    const child = await vi.waitFor(() => {
      const found = ctx.agents.get(started.childId)
      expect(found).toBeDefined()
      return found!
    })

    expect(child.session.events.find(event => event.type === 'subagent/descriptor')?.data)
      .toEqual({
        version: SUBAGENT_DESCRIPTOR_VERSION,
        mode: 'continuable',
        provider: 'spawn',
        label: 'child task',
        toolFilter: { deny: ['noop'] },
      })
    await drainManager(ctx)
  })

  it('cold-resumes without inventing a model route the descriptor never declared', async () => {
    const { ctx, root } = await setup([textResponse('first')])
    const routeless = ctx.agentLoop.create(SessionId('routeless-resume'), {})
    const started = await ctx.subagents.startContinuable(startSpec(routeless))
    await waitNoActivation(ctx, started.childId)

    const fresh = new Context()
    await mountAgentLoopTestDependencies(fresh)
    await fresh.plugin(JsonlSessionPersistence, { root: root! })
    await fresh.plugin(AgentLoop, { agents: [] })
    await fresh.plugin(SubagentService)
    await fresh.plugin(SubagentSpawn, { providerName: 'spawn' })
    const freshParent = fresh.agentLoop.create(SessionId('routeless-resume'), {})
    await followup(fresh, freshParent, started.childId, message('resume routeless'))

    const resumed = await vi.waitFor(() => {
      const found = fresh.agents.get(started.childId)
      expect(found).toBeDefined()
      return found!
    })
    expect(resumed.options.provider).toBeUndefined()
    expect(resumed.options.model).toBeUndefined()
    await drainManager(fresh)
  })

  it('continues turn numbering after an inherited fork prefix and pre-turn descriptor', async () => {
    const { ctx, parent } = await setup([
      textResponse('parent turn'),
      textResponse('forked child'),
    ])
    // Complete one parent turn so fork has a prefix to contribute.
    parent.followup(createUserMessage({ content: message('parent work'), source: { kind: 'user' } }))
    await parent.whenIdle()

    const started = await ctx.subagents.startContinuable(startSpec(parent, 'fork'))
    await waitNoActivation(ctx, started.childId)

    const loaded = await ctx.sessionPersistence.load(started.childId)
    const descriptorIndex = loaded.events.findIndex(event => event.type === 'subagent/descriptor')
    const childTurn = loaded.events.slice(descriptorIndex + 1)
      .find(event => event.type === 'turn/start')
    // The first child turn after the descriptor continues the inherited prefix
    // rather than restarting at 1, so the replayed child log stays balanced.
    expect(descriptorIndex).toBeGreaterThanOrEqual(0)
    expect(childTurn?.type === 'turn/start' && childTurn.data.turn).toBe(2)
    expect(loaded.meta.seedLength).toBeGreaterThan(0)
  })

  it('records the declared persona in the descriptor and reapplies it on cold resume', async () => {
    const { ctx, parent } = await setup([textResponse('scoped'), textResponse('resumed')])
    const started = await ctx.subagents.startContinuable({
      ...startSpec(parent),
      request: {
        prompt: message('scoped work'),
        parent,
        persona: 'You are scoped.',
      },
    })
    await waitNoActivation(ctx, started.childId)

    const loaded = await ctx.sessionPersistence.load(started.childId)
    const descriptor = loaded.events.find(event => event.type === 'subagent/descriptor')
    expect(descriptor?.data).toMatchObject({ persona: 'You are scoped.' })

    // Cold resume reconstructs the declared composition from that descriptor.
    await followup(ctx, parent, started.childId, message('resume it'))
    await waitNoActivation(ctx, started.childId)
    const resumed = await ctx.sessionPersistence.load(started.childId)
    expect(hasUserText(resumed.events, 'resume it')).toBe(true)
  })
})

describe('SubagentService.followup residency routing', () => {
  it('enqueues in the same Activation while it is running, preserving one inbox FIFO', async () => {
    const releaseFirst = Promise.withResolvers<undefined>()
    const adapter = new GatedAdapter([
      { chunks: textResponse('first'), gate: releaseFirst.promise },
      { chunks: textResponse('second') },
      { chunks: textResponse('third') },
    ])
    const { ctx, parent } = await setupWith(adapter)
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    const child = ctx.agents.get(started.childId)
    expect(child?.status).toBe('running')

    // Both messages queue behind the open turn, in call order.
    const firstMessage = await followup(ctx, parent, started.childId, message('first follow-up'))
    const secondMessage = await followup(ctx, parent, started.childId, message('second follow-up'))
    expect(firstMessage).not.toBe(secondMessage)
    // Still the same Activation: no second child Agent was created.
    expect(ctx.agents.get(started.childId)).toBe(child)

    releaseFirst.resolve(undefined)
    await waitNoActivation(ctx, started.childId)
    const loaded = await ctx.sessionPersistence.load(started.childId)
    expect(userTexts(loaded.events)).toEqual(['child task', 'first follow-up', 'second follow-up'])
  })

  it('cold-resumes a settled child into a new Activation', async () => {
    const { ctx, parent } = await setup([textResponse('first'), textResponse('after resume')])
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await waitNoActivation(ctx, started.childId)

    const messageId = await followup(ctx, parent, started.childId, message('continue please'))
    expect(messageId).toBeTypeOf('string')
    await waitNoActivation(ctx, started.childId)

    const loaded = await ctx.sessionPersistence.load(started.childId)
    expect(userTexts(loaded.events)).toEqual(['child task', 'continue please'])
    // One descriptor only: cold resume never re-seeds it.
    expect(loaded.events.filter(event => event.type === 'subagent/descriptor')).toHaveLength(1)
  })

  it('cold-resumes after the initial provider unregisters', async () => {
    const { ctx, parent } = await setup([textResponse('first'), textResponse('after resume')])
    await ctx.plugin(InvariantService)
    await ctx.plugin(SubagentInvariant)
    const disposeProvider = ctx.subagents.registerProvider({
      name: 'retired',
      capabilities: { outputSchema: false, depthLimit: false, toolFilter: false, persona: false, sandboxMode: false },
      inheritsParentContext: false,
      start: async () => { throw new Error('one-shot start is not used') },
      prepareContinuable: () => Promise.resolve({}),
    })
    const starts: SubagentRunInfo[] = []
    const ends: SubagentRunEndInfo[] = []
    ctx.on('subagent/start', (info) => {
      if ('runId' in info) starts.push(info)
    })
    ctx.on('subagent/end', (info) => {
      if ('runId' in info) ends.push(info)
    })

    const started = await ctx.subagents.startContinuable(startSpec(parent, 'retired'))
    await waitNoActivation(ctx, started.childId)
    disposeProvider()
    expect(ctx.subagents.getProvider('retired')).toBeUndefined()

    await expect(followup(ctx, parent, started.childId, message('continue without provider')))
      .resolves.toBeTypeOf('string')
    await waitNoActivation(ctx, started.childId)
    await vi.waitFor(() => { expect(ends).toHaveLength(2) })

    expect(starts.map(info => info.provider)).toEqual(['retired', 'retired'])
    expect(ends.map(info => info.runId)).toEqual(starts.map(info => info.runId))
    const loaded = await ctx.sessionPersistence.load(started.childId)
    expect(userTexts(loaded.events)).toEqual(['child task', 'continue without provider'])
  })

  it('wakes a waiting Activation instead of cold-resuming it', async () => {
    const releaseGrandchild = Promise.withResolvers<undefined>()
    const adapter = new GatedAdapter([
      // The child delegates, then finishes its own turn while the grandchild runs.
      { chunks: textResponse('child done') },
      { chunks: textResponse('grandchild'), gate: releaseGrandchild.promise },
      { chunks: textResponse('woken') },
    ])
    const { ctx, parent } = await setupWith(adapter)
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    const child = await vi.waitFor(() => {
      const found = ctx.agents.get(started.childId)
      expect(found).toBeDefined()
      return found!
    })
    // The child starts its own continuable grandchild, then goes quiescent.
    const grandchild = await ctx.subagents.startContinuable(startSpec(child))
    await vi.waitFor(() => { expect(adapter.requests.length).toBeGreaterThanOrEqual(2) })
    await vi.waitFor(() => {
      expect(child.status).toBe('idle')
      expect(ctx.agents.get(started.childId)).toBe(child)
    }, { timeout: 5_000 })
    // Waiting retains the handle: the same Agent is still live.
    expect(ctx.agents.get(started.childId)).toBe(child)

    await followup(ctx, parent, started.childId, message('while waiting'))
    // Woken back to running on the SAME Activation.
    expect(ctx.agents.get(started.childId)).toBe(child)

    releaseGrandchild.resolve(undefined)
    await waitNoActivation(ctx, grandchild.childId)
    await waitNoActivation(ctx, started.childId)
    const loaded = await ctx.sessionPersistence.load(started.childId)
    expect(userTexts(loaded.events)).toEqual(['child task', 'while waiting'])
  })

  it('rejects a parent that is not the durable direct parent', async () => {
    const { ctx, parent } = await setup([textResponse('first')])
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await waitNoActivation(ctx, started.childId)
    const stranger = ctx.agentLoop.create(SessionId('stranger'), { provider: 'mock', model: 'mock' })

    await expect(followup(ctx, stranger, started.childId, message('mine now')))
      .rejects.toThrow(/belongs to another parent session/)
  })

  it('reports an unresumable child whose persisted log has no supported descriptor', async () => {
    const { ctx, parent } = await setup([textResponse('one shot')])
    // A one-shot child has durable identity but no supported continuation state.
    const run = await ctx.subagents.start('spawn', {
      label: 'one-shot work',
      prompt: message('one-shot work'),
      parent,
      signal: testSignal,
    })
    await run.result
    await ctx.sessions.flush(run.localAgent!.session)
    const oneShotId = run.id
    await run.dispose()

    await expect(followup(ctx, parent, oneShotId, message('continue')))
      .rejects.toThrow(/no supported continuation state/)
  })

  it('reports an unknown child id as unavailable', async () => {
    const { ctx, parent } = await setup([])
    await expect(followup(ctx, parent, SessionId('missing'), message('hello')))
      .rejects.toMatchObject({ code: 'NOT_RESUMABLE' })
  })

  it('propagates cancellation while inspecting a cold child', async () => {
    const { ctx, parent } = await setup([textResponse('first')])
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await waitNoActivation(ctx, started.childId)
    const inspectStarted = Promise.withResolvers<undefined>()
    const inspect = vi.spyOn(ctx.sessionPersistence, 'inspect').mockImplementation((_id, signal) => {
      return new Promise<never>((_resolve, reject) => {
        if (signal === undefined) {
          reject(new Error('cold inspection must receive the followup signal'))
          return
        }
        inspectStarted.resolve(undefined)
        signal.addEventListener('abort', () => {
          reject(reason)
        }, { once: true })
      })
    })
    const controller = new AbortController()
    const reason = new Error('cold inspection cancelled')

    try {
      const delivery = followup(ctx, parent, started.childId, message('cancel me'), controller.signal)
      await inspectStarted.promise
      controller.abort(reason)
      await expect(delivery).rejects.toBe(reason)
    } finally {
      inspect.mockRestore()
    }
  })

  it('preserves a SubagentError raised while cold-materializing a child', async () => {
    const { ctx, parent } = await setup([textResponse('first')])
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await waitNoActivation(ctx, started.childId)
    const failure = new SubagentError('materialization denied', 'UNAUTHORIZED')
    ctx.agents.resume = () => Promise.reject(failure)

    await expect(followup(ctx, parent, started.childId, message('continue')))
      .rejects.toBe(failure)
  })

  it('cold-resumes a delivery that lost the race with final disposal', async () => {
    const { ctx, parent } = await setup([textResponse('first'), textResponse('after the race')])
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    const child = await vi.waitFor(() => {
      const found = ctx.agents.get(started.childId)
      expect(found).toBeDefined()
      return found!
    })
    // Deliver in the same tick the settlement watcher opens its transaction:
    // exactly one side wins the cutoff. A delivery that loses awaits release and
    // cold-resumes rather than reaching a handle being torn down.
    const delivery = child.whenIdle().then(() =>
      followup(ctx, parent, started.childId, message('raced')))

    await expect(delivery).resolves.toBeTypeOf('string')
    await waitNoActivation(ctx, started.childId)
    const loaded = await ctx.sessionPersistence.load(started.childId)
    expect(hasUserText(loaded.events, 'raced')).toBe(true)
  })
})

describe('continuable child ownership', () => {
  it('keeps a parent Activation waiting until its child completes disposal', async () => {
    const releaseGrandchild = Promise.withResolvers<undefined>()
    const adapter = new GatedAdapter([
      { chunks: textResponse('child done') },
      { chunks: textResponse('grandchild'), gate: releaseGrandchild.promise },
    ])
    const { ctx, parent } = await setupWith(adapter)
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    const child = await vi.waitFor(() => {
      const found = ctx.agents.get(started.childId)
      expect(found).toBeDefined()
      return found!
    })
    const grandchild = await ctx.subagents.startContinuable(startSpec(child))

    await vi.waitFor(() => {
      expect(child.status).toBe('idle')
      expect(ctx.agents.get(started.childId)).toBe(child)
    }, { timeout: 5_000 })
    // Child-first: the parent handle is retained while the grandchild is live.
    expect(ctx.agents.get(started.childId)).toBe(child)
    expect(ctx.agents.get(grandchild.childId)).toBeDefined()

    releaseGrandchild.resolve(undefined)
    await waitNoActivation(ctx, grandchild.childId)
    await waitNoActivation(ctx, started.childId)
  })

  it('does not add a top-level parent to the waiting graph', async () => {
    const { ctx, parent } = await setup([textResponse('done')])
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await waitNoActivation(ctx, started.childId)
    // The top-level parent remains independently registered after its child settles.
    expect(ctx.agents.get(parent.id)).toBe(parent)
  })
})

describe('continuable durability and teardown', () => {
  it('settles when the best-effort final flush has no listeners', async () => {
    const releaseResponse = Promise.withResolvers<undefined>()
    const adapter = new GatedAdapter([
      { chunks: textResponse('unconfirmed answer'), gate: releaseResponse.promise },
    ])
    const { ctx, parent, disposePersistence } = await setupWith(adapter)
    const warnings: string[] = []
    ctx.logger.warn = (message: string) => { warnings.push(message) }

    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    // Remove every persistence listener; the final flush is advisory.
    await disposePersistence!()
    releaseResponse.resolve(undefined)

    await waitNoActivation(ctx, started.childId)
    expect(warnings.some(warning => warning.includes('final session flush'))).toBe(false)
  })

  it('logs a failed final flush after every listener settles without failing the Activation', async () => {
    const { ctx, parent } = await setup([textResponse('answer')])
    const warnings: string[] = []
    const ends: SubagentRunEndInfo[] = []
    let peerFlushed = false
    ctx.logger.warn = (message: string) => { warnings.push(message) }
    ctx.on('subagent/end', (info) => {
      if ('runId' in info) ends.push(info)
    })
    ctx.on('session/flush', (session) => {
      if (session.header.parentSession !== undefined) throw new Error('disk full')
    })
    ctx.on('session/flush', (session) => {
      if (session.header.parentSession !== undefined) peerFlushed = true
    })

    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await waitNoActivation(ctx, started.childId)
    expect(peerFlushed).toBe(true)
    expect(warnings.some(warning => warning.includes('best-effort final session flush failed'))).toBe(true)
    expect(ends.at(-1)?.stopReason).toBe('completed')
  })

  it('logs a teardown failure reached through normal settlement', async () => {
    const hold = Promise.withResolvers<undefined>()
    const adapter = new GatedAdapter([{ chunks: textResponse('answer'), gate: hold.promise }])
    const { ctx, parent } = await setupWith(adapter)
    const warnings: string[] = []
    ctx.logger.warn = (message: string) => { warnings.push(message) }

    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    const manager = (ctx.subagents as unknown as {
      continuations: { activations: Map<SessionId, { handle: { dispose: () => Promise<void> } }> }
    }).continuations
    const activation = manager.activations.get(started.childId)!
    const realDispose = activation.handle.dispose.bind(activation.handle)
    activation.handle.dispose = async () => {
      await realDispose()
      throw new Error('normal settlement cleanup failed')
    }

    hold.resolve(undefined)

    await vi.waitFor(() => {
      expect(warnings.some(warning => warning.includes('normal settlement cleanup failed'))).toBe(true)
    })
    expect(ctx.agents.get(started.childId)).toBeUndefined()
  })

  it('disposes every live Activation forest child-first on manager teardown', async () => {
    const hold = Promise.withResolvers<undefined>()
    const adapter = new GatedAdapter([
      { chunks: textResponse('child done') },
      { chunks: textResponse('grandchild'), gate: hold.promise },
    ])
    const { ctx, parent } = await setupWith(adapter)
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    const child = await vi.waitFor(() => {
      const found = ctx.agents.get(started.childId)
      expect(found).toBeDefined()
      return found!
    })
    const grandchild = await ctx.subagents.startContinuable(startSpec(child))
    await vi.waitFor(() => { expect(ctx.agents.get(grandchild.childId)).toBeDefined() })

    const disposals: SessionId[] = []
    ctx.on('agent/disposed', ({ agent }) => { disposals.push(agent.id) })
    const drained = drainManager(ctx)
    // Let the held model call observe its cancellation so quiescence can settle.
    hold.resolve(undefined)
    await drained

    // Child-first: the grandchild's disposal precedes its parent's.
    expect(disposals.indexOf(grandchild.childId)).toBeGreaterThanOrEqual(0)
    expect(disposals.indexOf(grandchild.childId))
      .toBeLessThan(disposals.indexOf(started.childId))
    // Durable sessions survive process-local teardown.
    const loaded = await ctx.sessionPersistence.load(started.childId)
    expect(loaded.meta.id).toBe(started.childId)
  })

  it('drains one parent forest without disabling a sibling parent forest', async () => {
    const releaseTarget = Promise.withResolvers<undefined>()
    const releaseGrandchild = Promise.withResolvers<undefined>()
    const releaseSibling = Promise.withResolvers<undefined>()
    const adapter = new GatedAdapter([
      { chunks: textResponse('target child'), gate: releaseTarget.promise },
      { chunks: textResponse('sibling child'), gate: releaseSibling.promise },
      { chunks: textResponse('target grandchild'), gate: releaseGrandchild.promise },
      { chunks: textResponse('sibling follow-up') },
    ])
    const { ctx, parent } = await setupWith(adapter)
    const siblingParent = ctx.agentLoop.create(
      SessionId('sibling-parent'),
      { provider: 'mock', model: 'mock' },
    )
    const target = await ctx.subagents.startContinuable(startSpec(parent))
    const sibling = await ctx.subagents.startContinuable(startSpec(siblingParent))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(2) })
    const targetChild = ctx.agents.get(target.childId)!
    const siblingChild = ctx.agents.get(sibling.childId)!
    const grandchild = await ctx.subagents.startContinuable(startSpec(targetChild))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(3) })
    const cancellations: SessionId[] = []
    observeCancel(targetChild, () => { cancellations.push(targetChild.id) })
    const grandchildAgent = ctx.agents.get(grandchild.childId)!
    observeCancel(grandchildAgent, () => { cancellations.push(grandchildAgent.id) })

    const drained = ctx.subagents.drainContinuableDescendants([parent])
    const convergedDrain = ctx.subagents.drainContinuableDescendants([parent])

    // The scoped cutoff stops only the selected forest. The sibling child stays
    // resident and can accept later work while target cleanup is still blocked.
    expect(cancellations).toEqual([target.childId, grandchild.childId])
    expect(ctx.agents.get(target.childId)).toBe(targetChild)
    expect(ctx.agents.get(grandchild.childId)).toBeDefined()
    expect(ctx.agents.get(sibling.childId)).toBe(siblingChild)
    await expect(followup(ctx, siblingParent, sibling.childId, message('still live')))
      .resolves.toBeTypeOf('string')
    await expect(ctx.subagents.startContinuable(startSpec(parent)))
      .rejects.toMatchObject({ code: 'DRAINING' })
    await expect(followup(ctx, parent, target.childId, message('too late')))
      .rejects.toMatchObject({ code: 'DRAINING' })

    releaseTarget.resolve(undefined)
    releaseGrandchild.resolve(undefined)
    await Promise.all([drained, convergedDrain])
    expect(ctx.agents.get(target.childId)).toBeUndefined()
    expect(ctx.agents.get(grandchild.childId)).toBeUndefined()
    expect(ctx.agents.get(sibling.childId)).toBe(siblingChild)
    // The exact root remains closed until its host disposes it, even after all
    // current descendants are gone.
    await expect(ctx.subagents.startContinuable(startSpec(parent)))
      .rejects.toMatchObject({ code: 'DRAINING' })

    releaseSibling.resolve(undefined)
    await waitNoActivation(ctx, sibling.childId)
  })

  it('retains a continuable root while draining only its descendants', async () => {
    const releaseChild = Promise.withResolvers<undefined>()
    const releaseGrandchild = Promise.withResolvers<undefined>()
    const adapter = new GatedAdapter([
      { chunks: textResponse('child'), gate: releaseChild.promise },
      { chunks: textResponse('grandchild'), gate: releaseGrandchild.promise },
    ])
    const { ctx, parent } = await setupWith(adapter)
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    const child = ctx.agents.get(started.childId)!
    const grandchild = await ctx.subagents.startContinuable(startSpec(child))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(2) })
    const cancellations: SessionId[] = []
    const grandchildAgent = ctx.agents.get(grandchild.childId)!
    observeCancel(grandchildAgent, () => { cancellations.push(grandchildAgent.id) })

    const drained = ctx.subagents.drainContinuableDescendants([child])

    expect(cancellations).toEqual([grandchild.childId])
    expect(ctx.agents.get(started.childId)).toBe(child)
    releaseGrandchild.resolve(undefined)
    await drained
    expect(ctx.agents.get(grandchild.childId)).toBeUndefined()
    expect(ctx.agents.get(started.childId)).toBe(child)
    await expect(ctx.subagents.startContinuable(startSpec(child)))
      .rejects.toMatchObject({ code: 'DRAINING' })

    releaseChild.resolve(undefined)
    await waitNoActivation(ctx, started.childId)
  })

  it('finds scoped descendants after an intermediate one-shot Agent leaves the registry', async () => {
    const releaseIntermediate = Promise.withResolvers<undefined>()
    const releaseDescendant = Promise.withResolvers<undefined>()
    const adapter = new GatedAdapter([
      { chunks: textResponse('one-shot'), gate: releaseIntermediate.promise },
      { chunks: textResponse('continuable descendant'), gate: releaseDescendant.promise },
    ])
    const { ctx, parent } = await setupWith(adapter)
    const run = await ctx.subagents.start('spawn', {
      label: 'one-shot task',
      prompt: message('one-shot task'),
      parent,
      signal: testSignal,
    })
    const intermediate = run.localAgent
    expect(intermediate).toBeDefined()
    if (intermediate === undefined) throw new Error('spawn must publish a local Agent')
    const descendant = await ctx.subagents.startContinuable(startSpec(intermediate))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(2) })

    const intermediateId = intermediate.id
    const disposingIntermediate = run.dispose()
    releaseIntermediate.resolve(undefined)
    await disposingIntermediate
    expect(ctx.agents.get(intermediateId)).toBeUndefined()
    expect(ctx.agents.get(descendant.childId)).toBeDefined()
    const cancellations: SessionId[] = []
    const descendantAgent = ctx.agents.get(descendant.childId)!
    observeCancel(descendantAgent, () => { cancellations.push(descendantAgent.id) })

    const drained = ctx.subagents.drainContinuableDescendants([parent])

    expect(cancellations).toEqual([descendant.childId])
    releaseDescendant.resolve(undefined)
    await drained
    expect(ctx.agents.get(descendant.childId)).toBeUndefined()
  })

  it('awaits and rolls back an admitted materialization below a scoped root', async () => {
    const { ctx, parent } = await setup([])
    const manager = (ctx.subagents as unknown as {
      continuations: { ownerCtx: Context }
    }).continuations
    const agents = manager.ownerCtx.agents
    const create = agents.create.bind(agents)
    const published = Promise.withResolvers<SessionId>()
    const releaseMaterialization = Promise.withResolvers<undefined>()
    const createSpy = vi.spyOn(agents, 'create').mockImplementation(async (options) => {
      const handle = await create(options)
      published.resolve(handle.agent.id)
      await releaseMaterialization.promise
      return handle
    })

    try {
      const starting = ctx.subagents.startContinuable(startSpec(parent))
      const childId = await published.promise
      let drainResolved = false
      const drained = ctx.subagents.drainContinuableDescendants([parent]).then(() => {
        drainResolved = true
      })
      await Promise.resolve()
      expect(drainResolved).toBe(false)

      releaseMaterialization.resolve(undefined)
      await expect(starting).rejects.toMatchObject({ code: 'DRAINING' })
      await drained
      expect(ctx.agents.get(childId)).toBeUndefined()
    } finally {
      createSpy.mockRestore()
    }
  })

  it('ignores a stale scoped root without disabling its live same-id Agent', async () => {
    const { ctx, parent } = await setup([textResponse('done')])
    const stale = { ...parent, id: parent.id } as unknown as Agent

    await ctx.subagents.drainContinuableDescendants([stale])
    const started = await ctx.subagents.startContinuable(startSpec(parent))

    await waitNoActivation(ctx, started.childId)
  })

  it('reports a scoped teardown failure after releasing the selected branch', async () => {
    const hold = Promise.withResolvers<undefined>()
    const adapter = new GatedAdapter([
      { chunks: textResponse('target child'), gate: hold.promise },
    ])
    const { ctx, parent } = await setupWith(adapter)
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    const manager = (ctx.subagents as unknown as {
      continuations: { activations: Map<SessionId, { handle: { dispose: () => Promise<void> } }> }
    }).continuations
    const activation = manager.activations.get(started.childId)!
    const realDispose = activation.handle.dispose.bind(activation.handle)
    activation.handle.dispose = async () => {
      await realDispose()
      throw new Error('scoped child reap failed')
    }

    const drained = ctx.subagents.drainContinuableDescendants([parent])
    hold.resolve(undefined)

    await expect(drained).rejects.toMatchObject({ code: 'ACTIVATION_TEARDOWN_FAILED' })
    expect(ctx.agents.get(started.childId)).toBeUndefined()
  })

  it('rejects new materialization and delivery once draining begins', async () => {
    const { ctx, parent } = await setup([textResponse('done')])
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await waitNoActivation(ctx, started.childId)

    await drainManager(ctx)

    await expect(ctx.subagents.startContinuable(startSpec(parent)))
      .rejects.toMatchObject({ code: 'DRAINING' })
    await expect(followup(ctx, parent, started.childId, message('too late')))
      .rejects.toMatchObject({ code: 'DRAINING' })
  })

  it('rejects an initial prompt when drain starts after materialization', async () => {
    const { ctx, parent } = await setup([])
    const drains: Promise<void>[] = []
    const accepted: MessageId[] = []
    ctx.on('subagent/start', () => { drains.push(drainManager(ctx)) })
    ctx.on('agent/inbox/inserted', ({ message }) => { accepted.push(message.id) })

    await expect(ctx.subagents.startContinuable(startSpec(parent)))
      .rejects.toMatchObject({ code: 'DRAINING' })
    await Promise.all(drains)

    expect(accepted).toEqual([])
    expect(ctx.agents.list()).toEqual([parent])
  })

  it('waits for a published materialization to finish rollback before drain resolves', async () => {
    const { ctx, parent } = await setup([])
    const order: string[] = []
    const drains: Promise<void>[] = []
    ctx.on('agent/created', ({ agent: child }) => {
      if (child === parent) return
      const draining = drainManager(ctx).then(() => { order.push('drain') })
      drains.push(draining)
    })
    ctx.on('agent/disposed', ({ agent: child }) => {
      if (child !== parent) order.push('disposed')
    })

    // `agent/created` runs after registry publication but before materialize()
    // receives the handle and installs the Activation.
    await expect(ctx.subagents.startContinuable(startSpec(parent)))
      .rejects.toMatchObject({ code: 'DRAINING' })
    await Promise.all(drains)

    expect(order).toEqual(['disposed', 'drain'])
    expect(ctx.agents.list()).toEqual([parent])
  })

  it('admits a live follow-up before a later drain can begin disposal', async () => {
    const hold = Promise.withResolvers<undefined>()
    const adapter = new GatedAdapter([{ chunks: textResponse('working'), gate: hold.promise }])
    const { ctx, parent } = await setupWith(adapter)
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    const child = ctx.agents.get(started.childId)!
    const order: string[] = []
    child.ctx.on('agent/inbox/inserted', ({ message }) => {
      if (message.content.some(block => block.type === 'text' && block.text === 'before drain')) {
        order.push('enqueue')
      }
    })
    observeCancel(child, () => { order.push('cancel') })

    const delivery = followup(ctx, parent, started.childId, message('before drain'))
    // Let the child-lock operation reach the live admission cutoff. Admission
    // and inbox submission must then complete in one synchronous span.
    await Promise.resolve()
    const drained = drainManager(ctx)
    hold.resolve(undefined)

    await expect(delivery).resolves.toBeTypeOf('string')
    await drained
    expect(order).toEqual(['enqueue', 'cancel'])
  })

  it('has no automatic replay for an accepted but unlogged message', async () => {
    const hold = Promise.withResolvers<undefined>()
    const adapter = new GatedAdapter([{ chunks: textResponse('first'), gate: hold.promise }])
    const { ctx, parent } = await setupWith(adapter)
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    // Accepted into the inbox, but this queued turn never opens.
    await followup(ctx, parent, started.childId, message('never logged'))

    const drained = drainManager(ctx)
    hold.resolve(undefined)
    await drained
    await waitNoActivation(ctx, started.childId)

    const loaded = await ctx.sessionPersistence.load(started.childId)
    // Only what actually reached the log is reconstructable.
    expect(hasUserText(loaded.events, 'never logged')).toBe(false)
  })
})

describe('continuable review regressions', () => {
  it('rechecks exact parent liveness after cold-resume materialization', async () => {
    const { ctx } = await setup([textResponse('first')])
    const parentId = SessionId('replaceable-parent')
    const originalParent = await ctx.agents.create({
      sessionId: parentId,
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const started = await ctx.subagents.startContinuable(startSpec(originalParent.agent))
    await waitNoActivation(ctx, started.childId)

    const manager = (ctx.subagents as unknown as {
      continuations: { ownerCtx: Context }
    }).continuations
    const ownerAgents = manager.ownerCtx.agents
    const originalResume = ownerAgents.resume.bind(ownerAgents)
    const resumed = Promise.withResolvers<undefined>()
    const releaseResume = Promise.withResolvers<undefined>()
    const resumeSpy = vi.spyOn(ownerAgents, 'resume').mockImplementation(async (options) => {
      const handle = await originalResume(options)
      resumed.resolve(undefined)
      await releaseResume.promise
      return handle
    })

    const delivery = followup(
      ctx,
      originalParent.agent,
      started.childId,
      message('must not cross parent replacement'),
    )
    await resumed.promise
    await originalParent.dispose()
    const replacement = await ctx.agents.create({
      sessionId: parentId,
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    releaseResume.resolve(undefined)

    await expect(delivery).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    resumeSpy.mockRestore()
    await waitNoActivation(ctx, started.childId)
    const loaded = await ctx.sessionPersistence.load(started.childId)
    expect(hasUserText(loaded.events, 'must not cross parent replacement')).toBe(false)
    await replacement.dispose()
  })

  it('clears the accepted reservation when Agent.followup throws', async () => {
    const hold = Promise.withResolvers<undefined>()
    const adapter = new GatedAdapter([{ chunks: textResponse('working'), gate: hold.promise }])
    const { ctx, parent } = await setupWith(adapter)
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    const child = ctx.agents.get(started.childId)!
    const manager = (ctx.subagents as unknown as {
      continuations: {
        activations: Map<SessionId, { accepted: Set<MessageId> }>
      }
    }).continuations
    const activation = manager.activations.get(started.childId)!
    const realFollowup = child.followup.bind(child)
    child.followup = () => {
      throw new Error('synthetic inbox failure')
    }

    await expect(followup(ctx, parent, started.childId, message('throws')))
      .rejects.toThrow(/synthetic inbox failure/)
    expect(activation.accepted.size).toBe(0)

    child.followup = realFollowup
    const drained = drainManager(ctx)
    hold.resolve(undefined)
    await drained
  })

  it('reports the child\'s own terminal reason, not teardown success', async () => {
    // The child hits its token ceiling; teardown still succeeds.
    const { ctx, parent } = await setupWith(new MockAdapter([
      [{ type: 'block-start', index: 0, blockType: 'text' },
        { type: 'text-delta', index: 0, text: 'partial' },
        { type: 'block-end', index: 0, block: { type: 'text', text: 'partial' } },
        { type: 'finish', reason: { kind: 'max-tokens' } }],
    ]))
    const ends: SubagentRunEndInfo[] = []
    ctx.on('subagent/end', (info) => {
      if ('runId' in info) ends.push(info)
    })

    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await waitNoActivation(ctx, started.childId)

    await vi.waitFor(() => { expect(ends).toHaveLength(1) })
    // Deriving this from disposal success would report the failure as completed.
    expect(ends[0]!.stopReason).toBe('max-tokens')
  })

  it('rejects a live delivery whose caller signal aborted before admission', async () => {
    const releaseFirst = Promise.withResolvers<undefined>()
    const adapter = new GatedAdapter([{ chunks: textResponse('working'), gate: releaseFirst.promise }])
    const { ctx, parent } = await setupWith(adapter)
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    const child = ctx.agents.get(started.childId)!
    const before = child.session.events.length

    const controller = new AbortController()
    controller.abort('caller gave up')
    await expect(followup(ctx, parent, started.childId, message('cancelled'), controller.signal))
      .rejects.toThrow()

    // Nothing was enqueued, so no later turn can carry it.
    releaseFirst.resolve(undefined)
    await waitNoActivation(ctx, started.childId)
    const loaded = await ctx.sessionPersistence.load(started.childId)
    expect(hasUserText(loaded.events, 'cancelled')).toBe(false)
    expect(before).toBeGreaterThan(0)
  })

  it('reports this epoch\'s own output, captured while the child was still live', async () => {
    const { ctx, parent } = await setup([textResponse('first answer'), textResponse('second answer')])
    const ends: SubagentRunEndInfo[] = []
    ctx.on('subagent/end', (info) => {
      if ('runId' in info) ends.push(info)
    })

    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await waitNoActivation(ctx, started.childId)
    await vi.waitFor(() => { expect(ends).toHaveLength(1) })
    // Handle disposal unregisters the child, so the edge's content must have
    // been captured before that — an after-the-fact lookup would find nothing.
    expect(ends[0]!.lastAssistantMessage).toEqual([{ type: 'text', text: 'first answer' }])

    // A cold resume is a new epoch: it must report its OWN answer, never the
    // previous epoch's, which the replayed transcript still contains.
    await followup(ctx, parent, started.childId, message('again'))
    await waitNoActivation(ctx, started.childId)
    await vi.waitFor(() => { expect(ends).toHaveLength(2) })
    expect(ends[1]!.lastAssistantMessage).toEqual([{ type: 'text', text: 'second answer' }])
  })

  it('reports a resumed epoch that opened no turn without the previous answer', async () => {
    const { ctx, parent } = await setup([textResponse('first answer')])
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await waitNoActivation(ctx, started.childId)

    const ends: SubagentRunEndInfo[] = []
    ctx.on('subagent/end', (info) => {
      if ('runId' in info) ends.push(info)
    })
    // Block the resumed prompt so this epoch produces nothing of its own.
    ctx.on('agent/pre-step', async ({ agent: subject }, next) => {
      if (subject === parent) return next()
      return { kind: 'reject' }
    })
    await followup(ctx, parent, started.childId, message('again'))
    await waitNoActivation(ctx, started.childId)

    await vi.waitFor(() => { expect(ends).toHaveLength(1) })
    // Reading the whole session would resurrect 'first answer' here.
    expect(ends[0]!.lastAssistantMessage).toBeUndefined()
    expect(ends[0]!.stopReason).toBe('completed')
  })

  it('reports handle-disposal failure on the terminal edge', async () => {
    const { ctx, parent } = await setup([textResponse('answer')])
    const ends: SubagentRunEndInfo[] = []
    ctx.on('subagent/end', (info) => {
      if ('runId' in info) ends.push(info)
    })

    const started = await ctx.subagents.startContinuable(startSpec(parent))
    const manager = (ctx.subagents as unknown as {
      continuations: { activations: Map<SessionId, { handle: { dispose: () => Promise<void> } }> }
    }).continuations
    const activation = await vi.waitFor(() => {
      const found = manager.activations.get(started.childId)
      expect(found).toBeDefined()
      return found!
    })
    const realDispose = activation.handle.dispose.bind(activation.handle)
    activation.handle.dispose = async () => {
      await realDispose()
      throw new Error('scoped cleanup failed')
    }

    await expect(drainManager(ctx)).rejects.toThrow()
    await vi.waitFor(() => { expect(ends).toHaveLength(1) })
    // Emitting before disposal would have reported this failed epoch as success.
    expect(ends[0]!.stopReason).toBe('error')
  })

  it('reports a pre-disposal teardown failure on the terminal edge', async () => {
    const hold = Promise.withResolvers<undefined>()
    const adapter = new GatedAdapter([{ chunks: textResponse('answer'), gate: hold.promise }])
    const { ctx, parent } = await setupWith(adapter)
    const ends: SubagentRunEndInfo[] = []
    ctx.on('subagent/end', (info) => {
      if ('runId' in info) ends.push(info)
    })

    const started = await ctx.subagents.startContinuable(startSpec(parent))
    const manager = (ctx.subagents as unknown as {
      continuations: {
        activations: Map<SessionId, { observer: { capture: (child: Agent) => void } }>
      }
    }).continuations
    const activation = manager.activations.get(started.childId)!
    activation.observer.capture = () => { throw new Error('capture failed') }

    const drained = drainManager(ctx)
    hold.resolve(undefined)
    await expect(drained).rejects.toMatchObject({ code: 'ACTIVATION_TEARDOWN_FAILED' })
    await vi.waitFor(() => { expect(ends).toHaveLength(1) })
    expect(ends[0]!.stopReason).toBe('error')
  })

  it('preserves independent pre-disposal and handle-disposal failures', async () => {
    const hold = Promise.withResolvers<undefined>()
    const adapter = new GatedAdapter([{ chunks: textResponse('answer'), gate: hold.promise }])
    const { ctx, parent } = await setupWith(adapter)
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    const manager = (ctx.subagents as unknown as {
      continuations: {
        activations: Map<SessionId, {
          handle: { dispose: () => Promise<void> }
          observer: { capture: (child: Agent) => void }
        }>
      }
    }).continuations
    const activation = manager.activations.get(started.childId)!
    const realDispose = activation.handle.dispose.bind(activation.handle)
    activation.observer.capture = () => { throw new Error('capture failed') }
    activation.handle.dispose = async () => {
      await realDispose()
      throw new Error('scoped cleanup failed')
    }

    const drained = drainManager(ctx)
    hold.resolve(undefined)
    const failure = await drained.catch((error: unknown) => error)

    expect(failure).toMatchObject({ code: 'ACTIVATION_TEARDOWN_FAILED' })
    expect(String(failure)).toContain('capture failed')
    expect(String(failure)).toContain('scoped cleanup failed')
    expect(ctx.agents.get(started.childId)).toBeUndefined()
  })

  it('cancels a running turn before the best-effort final flush', async () => {
    const hold = Promise.withResolvers<undefined>()
    const adapter = new GatedAdapter([{ chunks: textResponse('slow'), gate: hold.promise }])
    const { ctx, parent } = await setupWith(adapter)
    const order: string[] = []
    ctx.on('session/flush', (session) => {
      if (session.header.parentSession !== undefined) order.push('flush')
    })

    const started = await ctx.subagents.startContinuable(startSpec(parent))
    const child = await vi.waitFor(() => {
      const found = ctx.agents.get(started.childId)
      expect(found).toBeDefined()
      return found!
    })
    observeCancel(child, () => { order.push('cancel') })

    const drained = drainManager(ctx)
    hold.resolve(undefined)
    await drained

    // Flushing a still-running turn cannot cover the events cancellation adds.
    expect(order.indexOf('cancel')).toBeGreaterThanOrEqual(0)
    expect(order.indexOf('cancel')).toBeLessThan(order.lastIndexOf('flush'))
  })

  it('releases an accepted message that is discarded instead of run', async () => {
    const hold = Promise.withResolvers<undefined>()
    const adapter = new GatedAdapter([{ chunks: textResponse('working'), gate: hold.promise }])
    const { ctx, parent } = await setupWith(adapter)
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    // Queue a turn, then cancel so it is discarded rather than dequeued. The
    // Activation must still reach settlement instead of waiting on that id.
    await followup(ctx, parent, started.childId, message('discarded'))

    const drained = drainManager(ctx)
    hold.resolve(undefined)
    await drained

    await waitNoActivation(ctx, started.childId)
    const loaded = await ctx.sessionPersistence.load(started.childId)
    expect(hasUserText(loaded.events, 'discarded')).toBe(false)
  })

  it('settles after a delivery discarded inside its own admission window', async () => {
    const releaseFirst = Promise.withResolvers<undefined>()
    const adapter = new GatedAdapter([{ chunks: textResponse('working'), gate: releaseFirst.promise }])
    const { ctx, parent } = await setupWith(adapter)
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    const child = ctx.agents.get(started.childId)!

    // Cancel from the synchronous enqueue observer: the discard fires after the
    // id is recorded but before `followup()` returns.
    const off = child.ctx.on('agent/inbox/inserted', ({ message }) => {
      if (message.content.some(block => block.type === 'text' && block.text === 'doomed')) {
        child.cancel({ kind: 'user' })
      }
    })
    await followup(ctx, parent, started.childId, message('doomed'))
    off()

    releaseFirst.resolve(undefined)
    // Retaining the discarded id would pin residency at `running` forever, so
    // reaching no-Activation without an explicit drain is the assertion.
    await waitNoActivation(ctx, started.childId)
    const loaded = await ctx.sessionPersistence.load(started.childId)
    expect(hasUserText(loaded.events, 'doomed')).toBe(false)
  })

  it('releases older ids discarded during a later admission window', async () => {
    const releaseFirst = Promise.withResolvers<undefined>()
    const adapter = new GatedAdapter([{ chunks: textResponse('working'), gate: releaseFirst.promise }])
    const { ctx, parent } = await setupWith(adapter)
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    const child = ctx.agents.get(started.childId)!
    const manager = (ctx.subagents as unknown as {
      continuations: {
        activations: Map<SessionId, { accepted: Set<MessageId> }>
      }
    }).continuations
    const activation = manager.activations.get(started.childId)!

    await followup(ctx, parent, started.childId, message('queued'))
    expect(activation.accepted.size).toBe(1)
    const off = child.ctx.on('agent/inbox/inserted', ({ message }) => {
      if (message.content.some(block => block.type === 'text' && block.text === 'doomed')) {
        child.cancel({ kind: 'user' })
      }
    })
    await followup(ctx, parent, started.childId, message('doomed'))
    off()

    expect(activation.accepted.size).toBe(0)
    releaseFirst.resolve(undefined)
    await waitNoActivation(ctx, started.childId)
  })

  it('reports completed when no ordinary turn closed', async () => {
    const { ctx, parent } = await setup([])
    const ends: SubagentRunEndInfo[] = []
    ctx.on('subagent/end', (info) => {
      if ('runId' in info) ends.push(info)
    })
    // Block admission so the child's only turn never opens.
    ctx.on('agent/pre-step', async ({ agent: subject }, next) => {
      if (subject === parent) return next()
      return { kind: 'reject' }
    })

    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await waitNoActivation(ctx, started.childId)

    await vi.waitFor(() => { expect(ends).toHaveLength(1) })
    expect(ends[0]!.stopReason).toBe('completed')
  })

  it('retains the Activation while an accepted message is still in the inbox', async () => {
    const releaseFirst = Promise.withResolvers<undefined>()
    const adapter = new GatedAdapter([
      { chunks: textResponse('first'), gate: releaseFirst.promise },
      { chunks: textResponse('second') },
    ])
    const { ctx, parent } = await setupWith(adapter)
    const registeredAtEnqueue: boolean[] = []
    // A synchronous inbox observer runs before the admitting microtask, the
    // exact window where `Agent.status` is still idle.
    ctx.on('agent/inbox/inserted', ({ agent }) => {
      if (agent.session.header.parentSession !== undefined) {
        registeredAtEnqueue.push(ctx.agents.get(agent.id) === agent)
      }
    })

    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    const child = ctx.agents.get(started.childId)
    await followup(ctx, parent, started.childId, message('queued'))

    expect(registeredAtEnqueue.length).toBeGreaterThan(0)
    expect(registeredAtEnqueue).not.toContain(false)
    expect(ctx.agents.get(started.childId)).toBe(child)
    releaseFirst.resolve(undefined)
    await waitNoActivation(ctx, started.childId)
    expect(adapter.requests).toHaveLength(2)
    const loaded = await ctx.sessionPersistence.load(started.childId)
    expect(hasUserText(loaded.events, 'queued')).toBe(true)
  })
})

describe('continuable lifecycle observation', () => {
  it('emits one paired start/end per residency epoch', async () => {
    const { ctx, parent } = await setup([textResponse('first'), textResponse('second')])
    const starts: SubagentRunInfo[] = []
    const ends: SubagentRunEndInfo[] = []
    ctx.on('subagent/start', (info) => {
      if ('runId' in info) starts.push(info)
    })
    ctx.on('subagent/end', (info) => {
      if ('runId' in info) ends.push(info)
    })

    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await waitNoActivation(ctx, started.childId)
    await vi.waitFor(() => { expect(ends).toHaveLength(1) })

    // A cold resume is a NEW epoch with its own pair.
    await followup(ctx, parent, started.childId, message('again'))
    await waitNoActivation(ctx, started.childId)
    await vi.waitFor(() => { expect(ends).toHaveLength(2) })

    expect(starts).toHaveLength(2)
    expect(starts.map(info => info.id)).toEqual([started.childId, started.childId])
    expect(starts.map(info => info.provider)).toEqual(['spawn', 'spawn'])
    // Each end pairs its own start's runId.
    expect(ends.map(info => info.runId)).toEqual(starts.map(info => info.runId))
  })
})

describe('continuable public surface', () => {
  it('exposes no host authority, residency query, cancellation, steering, or report operation', async () => {
    const { ctx } = await setup([])
    const subagents: Record<string, unknown> = ctx.subagents as unknown as Record<string, unknown>
    for (const absent of [
      'activationState',
      'cancel',
      'kill',
      'report',
      'resume',
      'steer',
      'steerContinuable',
      'userAuthority',
    ]) {
      expect(subagents[absent]).toBeUndefined()
    }
    // No steering tool and no report tool are registered by this seam.
    const names = ctx.tools.schemas().map(schema => schema.name)
    expect(names).not.toContain('report')
    expect(names).not.toContain('steer_subagent')
  })

  it('keeps one-shot runs free of a steering capability', async () => {
    const { ctx, parent } = await setup([textResponse('one shot')])
    const run = await ctx.subagents.start('spawn', {
      label: 'one-shot work',
      prompt: message('one-shot work'),
      parent,
      signal: testSignal,
    })
    expect('steer' in run).toBe(false)
    await run.result
    await run.dispose()
  })

  it('reports a caller-signal abort before acceptance without delivering', async () => {
    const { ctx, parent } = await setup([textResponse('first')])
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await waitNoActivation(ctx, started.childId)

    const controller = new AbortController()
    controller.abort('caller gave up')
    await expect(followup(ctx, parent, started.childId, message('aborted'), controller.signal))
      .rejects.toThrow()

    const loaded = await ctx.sessionPersistence.load(started.childId)
    expect(hasUserText(loaded.events, 'aborted')).toBe(false)
  })

  it('does not cancel an accepted turn when the caller signal aborts afterwards', async () => {
    const releaseFirst = Promise.withResolvers<undefined>()
    const adapter = new GatedAdapter([
      { chunks: textResponse('first'), gate: releaseFirst.promise },
      { chunks: textResponse('second') },
    ])
    const { ctx, parent } = await setupWith(adapter)
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })

    const controller = new AbortController()
    await followup(ctx, parent, started.childId, message('survives'), controller.signal)
    // After acceptance the manager owns the Activation independently.
    controller.abort('caller gave up')

    releaseFirst.resolve(undefined)
    await waitNoActivation(ctx, started.childId)
    const loaded = await ctx.sessionPersistence.load(started.childId)
    expect(hasUserText(loaded.events, 'survives')).toBe(true)
  })
})

describe('continuable errors', () => {
  it('rejects a duplicate Activation at the agent registry collision boundary', async () => {
    const hold = Promise.withResolvers<undefined>()
    const adapter = new GatedAdapter([{ chunks: textResponse('working'), gate: hold.promise }])
    const { ctx, parent } = await setupWith(adapter)
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    const child = await vi.waitFor(() => {
      const found = ctx.agents.get(started.childId)
      expect(found).toBeDefined()
      return found!
    })
    // Drop the Activation without disposing the Agent, leaving the id live but
    // unmanaged. Materialization must not adopt it.
    const manager = (ctx.subagents as unknown as {
      continuations: { activations: Map<SessionId, unknown> }
    }).continuations
    manager.activations.delete(started.childId)

    await expect(followup(ctx, parent, started.childId, message('hello')))
      .rejects.toThrow(SubagentError)
    expect(ctx.agents.get(started.childId)).toBe(child)
    hold.resolve(undefined)
  })

  it('rejects a parent that is no longer the live registry entry', async () => {
    const { ctx, parent } = await setup([textResponse('first')])
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    const child = await vi.waitFor(() => {
      const found = ctx.agents.get(started.childId)
      expect(found).toBeDefined()
      return found!
    })
    // A stale parent reference: same id, not the exact live entry.
    const stale = { ...parent, id: parent.id } as unknown as Agent

    await expect(followup(ctx, stale, started.childId, message('stale')))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    void child
  })

  it('rejects establishing a child under a parent whose disposal already began', async () => {
    const hold = Promise.withResolvers<undefined>()
    const adapter = new GatedAdapter([{ chunks: textResponse('child'), gate: hold.promise }])
    const { ctx, parent } = await setupWith(adapter)
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    const child = await vi.waitFor(() => {
      const found = ctx.agents.get(started.childId)
      expect(found).toBeDefined()
      return found!
    })

    // Begin the parent Activation's teardown, then try to give it a child.
    const drained = drainManager(ctx)
    await expect(ctx.subagents.startContinuable(startSpec(child)))
      .rejects.toMatchObject({ code: 'DRAINING' })
    hold.resolve(undefined)
    await drained
  })

  it('reports a failing branch after every branch settles, without pinning the rest', async () => {
    const hold = Promise.withResolvers<undefined>()
    const adapter = new GatedAdapter([
      { chunks: textResponse('child done') },
      { chunks: textResponse('grandchild'), gate: hold.promise },
    ])
    const { ctx, parent } = await setupWith(adapter)
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    const child = await vi.waitFor(() => {
      const found = ctx.agents.get(started.childId)
      expect(found).toBeDefined()
      return found!
    })
    const grandchild = await ctx.subagents.startContinuable(startSpec(child))
    await vi.waitFor(() => { expect(ctx.agents.get(grandchild.childId)).toBeDefined() })
    // Make the grandchild's own handle disposal reject: scope teardown failure
    // propagates, unlike a contained `agent/disposed` listener throw.
    const manager = (ctx.subagents as unknown as {
      continuations: { activations: Map<SessionId, { handle: { dispose: () => Promise<void> } }> }
    }).continuations
    const branch = manager.activations.get(grandchild.childId)!
    const realDispose = branch.handle.dispose.bind(branch.handle)
    branch.handle.dispose = async () => {
      await realDispose()
      throw new Error('grandchild reap failed')
    }

    const drained = drainManager(ctx)
    hold.resolve(undefined)
    await expect(drained).rejects.toMatchObject({ code: 'ACTIVATION_TEARDOWN_FAILED' })
    // The other branch still released, and durable sessions survive.
    expect(ctx.agents.get(started.childId)).toBeUndefined()
    const loaded = await ctx.sessionPersistence.load(started.childId)
    expect(loaded.meta.id).toBe(started.childId)
  })

  it('rolls the transfer back when ownership registration fails after handle transfer', async () => {
    const hold = Promise.withResolvers<undefined>()
    const adapter = new GatedAdapter([
      { chunks: textResponse('parent child'), gate: hold.promise },
      { chunks: textResponse('unused') },
    ])
    const { ctx, parent } = await setupWith(adapter)
    const outer = await ctx.subagents.startContinuable(startSpec(parent))
    const child = await vi.waitFor(() => {
      const found = ctx.agents.get(outer.childId)
      expect(found).toBeDefined()
      return found!
    })
    // Begin the would-be parent's disposal, then race a grandchild into it. The
    // handle transfers before ownership registration rejects, so the rollback
    // must leave no Activation and no live Agent behind.
    const manager = (ctx.subagents as unknown as {
      continuations: { activations: Map<SessionId, { disposal: Promise<void> | undefined }> }
    }).continuations
    const before = new Set(ctx.agents.list().map(agent => agent.id))
    manager.activations.get(outer.childId)!.disposal = Promise.resolve()

    await expect(ctx.subagents.startContinuable(startSpec(child)))
      .rejects.toMatchObject({ code: 'ACTIVATION_CLOSING' })
    await vi.waitFor(() => {
      expect(ctx.agents.list().map(agent => agent.id).filter(id => !before.has(id))).toEqual([])
    })
    hold.resolve(undefined)
  })

  it('reapplies the descriptor model route on cold resume', async () => {
    const { ctx, parent } = await setup([textResponse('first'), textResponse('resumed')])
    const started = await ctx.subagents.startContinuable({
      ...startSpec(parent),
      request: {
        prompt: message('routed work'),
        parent,
        agentOptions: { provider: 'mock', model: 'child-model' },
      },
    })
    await waitNoActivation(ctx, started.childId)
    const loaded = await ctx.sessionPersistence.load(started.childId)
    expect(loaded.events.find(event => event.type === 'subagent/descriptor')?.data)
      .toMatchObject({ agentProvider: 'mock', agentModel: 'child-model' })

    // The resumed Activation runs on the declared route, not the parent's.
    await followup(ctx, parent, started.childId, message('again'))
    await vi.waitFor(() => {
      expect(ctx.agents.get(started.childId)?.options.model).toBe('child-model')
    })
    await waitNoActivation(ctx, started.childId)
  })

  it('unloading the manager drains its live activations', async () => {
    const hold = Promise.withResolvers<undefined>()
    const adapter = new GatedAdapter([{ chunks: textResponse('child'), gate: hold.promise }])
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    const root = mkdtempSync(join(tmpdir(), 'dsh-subagent-continuation-'))
    roots.push(root)
    await ctx.plugin(JsonlSessionPersistence, { root })
    await ctx.plugin(AgentLoop, { agents: [] })
    const serviceFiber = await ctx.plugin(SubagentService)
    await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
    ctx.llm.registerAdapter(['mock'], adapter)
    const parent = ctx.agentLoop.create(SessionId('parent'), { provider: 'mock', model: 'mock' })
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await vi.waitFor(() => { expect(ctx.agents.get(started.childId)).toBeDefined() })

    // Manager unload uses the same drain, so no child outlives its runtime.
    const disposal = serviceFiber.dispose()
    hold.resolve(undefined)
    await disposal
    expect(ctx.agents.get(started.childId)).toBeUndefined()
  })
})

describe('SubagentService.interrupt', () => {
  it('aborts the current turn durably, parks accepted follow-ups, and resumes them only on a waking send', async () => {
    const releaseFirst = Promise.withResolvers<undefined>()
    const adapter = new GatedAdapter([
      { chunks: textResponse('first'), gate: releaseFirst.promise },
      { chunks: textResponse('second') },
      { chunks: textResponse('third') },
      { chunks: textResponse('fourth') },
    ])
    const { ctx, parent } = await setupWith(adapter)
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    const child = ctx.agents.get(started.childId)!
    await followup(ctx, parent, started.childId, message('parked B'))
    await followup(ctx, parent, started.childId, message('parked C'))
    const cancelSpy = vi.spyOn(child, 'cancel')

    ctx.subagents.interrupt(started.childId, { kind: 'user', parentSessionId: parent.id })

    expect(cancelSpy).toHaveBeenCalledTimes(1)
    expect(cancelSpy).toHaveBeenCalledWith({ kind: 'user' }, { keepInbox: true })
    // Cancellation is cooperative: the held model call observes it on release.
    releaseFirst.resolve(undefined)
    await child.whenIdle()
    // Parked, not resumed: no second model request follows the abort, the
    // accepted follow-ups stay pending, and the same Activation stays resident.
    expect(adapter.requests).toHaveLength(1)
    expect(child.inbox.nextTurn).toHaveLength(2)
    expect(child.status).toBe('idle')
    expect(ctx.agents.get(started.childId)).toBe(child)

    // Only an explicit waking send restores the driver; the parked items then
    // run before it in the existing FIFO order.
    await followup(ctx, parent, started.childId, message('waking D'))
    await waitNoActivation(ctx, started.childId)
    const loaded = await ctx.sessionPersistence.load(started.childId)
    expect(userTexts(loaded.events)).toEqual(['child task', 'parked B', 'parked C', 'waking D'])
    const turnEnds = loaded.events
      .filter(event => event.type === 'turn/end')
      .map(event => (event).data.reason.kind)
    expect(turnEnds).toEqual(['aborted', 'completed', 'completed', 'completed'])
  })

  it('interrupts only the target while its resident descendant keeps running', async () => {
    const releaseChild = Promise.withResolvers<undefined>()
    const releaseGrandchild = Promise.withResolvers<undefined>()
    const adapter = new GatedAdapter([
      { chunks: textResponse('child'), gate: releaseChild.promise },
      { chunks: textResponse('grandchild'), gate: releaseGrandchild.promise },
    ])
    const { ctx, parent } = await setupWith(adapter)
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    const child = ctx.agents.get(started.childId)!
    const grandchild = await ctx.subagents.startContinuable(startSpec(child))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(2) })
    const grandchildAgent = ctx.agents.get(grandchild.childId)!
    const childCancel = vi.spyOn(child, 'cancel')
    const grandchildCancel = vi.spyOn(grandchildAgent, 'cancel')

    ctx.subagents.interrupt(started.childId, { kind: 'user', parentSessionId: parent.id })

    expect(childCancel).toHaveBeenCalledTimes(1)
    releaseChild.resolve(undefined)
    await child.whenIdle()
    // The target parks as a waiting owner; the published descendant was never
    // signalled and keeps its own turn open.
    expect(grandchildCancel).not.toHaveBeenCalled()
    expect(ctx.agents.get(started.childId)).toBe(child)
    expect(ctx.agents.get(grandchild.childId)).toBe(grandchildAgent)

    releaseGrandchild.resolve(undefined)
    await waitNoActivation(ctx, grandchild.childId)
    await waitNoActivation(ctx, started.childId)
    const loaded = await ctx.sessionPersistence.load(grandchild.childId)
    const turnEnds = loaded.events
      .filter(event => event.type === 'turn/end')
      .map(event => (event).data.reason.kind)
    expect(turnEnds).toEqual(['completed'])
  })

  it('authorizes the human address against the live target\'s durable direct parent', async () => {
    const hold = Promise.withResolvers<undefined>()
    const adapter = new GatedAdapter([{ chunks: textResponse('working'), gate: hold.promise }])
    const { ctx, parent } = await setupWith(adapter)
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    const child = ctx.agents.get(started.childId)!
    const cancelSpy = vi.spyOn(child, 'cancel')

    expect(() => { ctx.subagents.interrupt(started.childId, {
      kind: 'user',
      parentSessionId: SessionId('stranger'),
    }) }).toThrow(/belongs to another parent session/)
    expect(cancelSpy).not.toHaveBeenCalled()

    ctx.subagents.interrupt(started.childId, { kind: 'user', parentSessionId: parent.id })
    expect(cancelSpy).toHaveBeenCalledWith({ kind: 'user' }, { keepInbox: true })
    hold.resolve(undefined)
    await waitNoActivation(ctx, started.childId)
  })

  it('lets a deep exact live ancestor interrupt its descendant with the parent cause', async () => {
    const releaseChild = Promise.withResolvers<undefined>()
    const releaseGrandchild = Promise.withResolvers<undefined>()
    const adapter = new GatedAdapter([
      { chunks: textResponse('child'), gate: releaseChild.promise },
      { chunks: textResponse('grandchild'), gate: releaseGrandchild.promise },
    ])
    const { ctx, parent } = await setupWith(adapter)
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    const child = ctx.agents.get(started.childId)!
    const grandchild = await ctx.subagents.startContinuable(startSpec(child))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(2) })
    const grandchildAgent = ctx.agents.get(grandchild.childId)!
    const childCancel = vi.spyOn(child, 'cancel')
    const grandchildCancel = vi.spyOn(grandchildAgent, 'cancel')

    // Deep ancestor: the top-level parent interrupts the grandchild.
    ctx.subagents.interrupt(grandchild.childId, { kind: 'ancestor', agent: parent })
    expect(grandchildCancel).toHaveBeenCalledWith({ kind: 'parent' }, { keepInbox: true })
    // Direct ancestor: the same authority kind covers the immediate parent.
    ctx.subagents.interrupt(started.childId, { kind: 'ancestor', agent: parent })
    expect(childCancel).toHaveBeenCalledWith({ kind: 'parent' }, { keepInbox: true })

    releaseChild.resolve(undefined)
    releaseGrandchild.resolve(undefined)
    await waitNoActivation(ctx, grandchild.childId)
    await waitNoActivation(ctx, started.childId)
  })

  it('rejects self, sibling, stale, and unrelated ancestor callers without touching the target', async () => {
    const releaseA = Promise.withResolvers<undefined>()
    const releaseB = Promise.withResolvers<undefined>()
    const adapter = new GatedAdapter([
      { chunks: textResponse('a'), gate: releaseA.promise },
      { chunks: textResponse('b'), gate: releaseB.promise },
    ])
    const { ctx, parent } = await setupWith(adapter)
    const targetStart = await ctx.subagents.startContinuable(startSpec(parent))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    const target = ctx.agents.get(targetStart.childId)!
    const siblingStart = await ctx.subagents.startContinuable(startSpec(parent))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(2) })
    const sibling = ctx.agents.get(siblingStart.childId)!
    const stranger = ctx.agentLoop.create(SessionId('stranger'), { provider: 'mock', model: 'mock' })
    const stale = { ...parent, id: parent.id } as unknown as Agent
    const cancelSpy = vi.spyOn(target, 'cancel')

    expect(() => { ctx.subagents.interrupt(targetStart.childId, { kind: 'ancestor', agent: target }) })
      .toThrow(/cannot interrupt itself/)
    expect(() => { ctx.subagents.interrupt(targetStart.childId, { kind: 'ancestor', agent: sibling }) })
      .toThrow(/not a live descendant/)
    expect(() => { ctx.subagents.interrupt(targetStart.childId, { kind: 'ancestor', agent: stranger }) })
      .toThrow(/not a live descendant/)
    expect(() => { ctx.subagents.interrupt(targetStart.childId, { kind: 'ancestor', agent: stale }) })
      .toThrow(/exact live ancestor/)
    // A stale caller is rejected before target lookup, even for an absent id.
    expect(() => { ctx.subagents.interrupt(SessionId('missing'), { kind: 'ancestor', agent: stale }) })
      .toThrow(/exact live ancestor/)
    expect(cancelSpy).not.toHaveBeenCalled()

    releaseA.resolve(undefined)
    releaseB.resolve(undefined)
    await waitNoActivation(ctx, targetStart.childId)
    await waitNoActivation(ctx, siblingStart.childId)
  })

  it('accepts absent and one-shot ids as no-ops without touching the one-shot Agent', async () => {
    const { ctx, parent } = await setup([textResponse('one shot')])
    ctx.subagents.interrupt(SessionId('missing'), { kind: 'user', parentSessionId: parent.id })
    ctx.subagents.interrupt(SessionId('missing'), { kind: 'ancestor', agent: parent })

    const run = await ctx.subagents.start('spawn', {
      label: 'one-shot work',
      prompt: message('one-shot work'),
      parent,
      signal: testSignal,
    })
    const oneShot = run.localAgent!
    const cancelSpy = vi.spyOn(oneShot, 'cancel')
    ctx.subagents.interrupt(run.id, { kind: 'user', parentSessionId: parent.id })
    ctx.subagents.interrupt(run.id, { kind: 'ancestor', agent: parent })
    expect(cancelSpy).not.toHaveBeenCalled()
    await run.result
    await run.dispose()
  })

  it('accepts an interrupt after natural completion', async () => {
    const { ctx, parent } = await setup([textResponse('done')])
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await waitNoActivation(ctx, started.childId)
    ctx.subagents.interrupt(started.childId, { kind: 'user', parentSessionId: parent.id })
    ctx.subagents.interrupt(started.childId, { kind: 'ancestor', agent: parent })
  })

  it('accepts an interrupt that lost the race with disposal without signalling twice', async () => {
    const hold = Promise.withResolvers<undefined>()
    const adapter = new GatedAdapter([{ chunks: textResponse('working'), gate: hold.promise }])
    const { ctx, parent } = await setupWith(adapter)
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    const child = ctx.agents.get(started.childId)!
    const cancelSpy = vi.spyOn(child, 'cancel')

    // Scoped teardown opens the disposal transaction synchronously and issues
    // its own whole-Activation cancel before this call returns.
    const drained = ctx.subagents.drainContinuableDescendants([parent])
    expect(cancelSpy).toHaveBeenCalledTimes(1)

    // Interrupt after the cutoff: accepted no-op, no second signal, no waiting.
    ctx.subagents.interrupt(started.childId, { kind: 'user', parentSessionId: parent.id })
    expect(cancelSpy).toHaveBeenCalledTimes(1)

    hold.resolve(undefined)
    await drained
  })
})
