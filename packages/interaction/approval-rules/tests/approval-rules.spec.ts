import { mkdir, readFile, rm } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import type { ApprovalOutcome } from '@huiliyi37/dsh-user-approval'
import { writeRules } from '@huiliyi37/dsh-approval-rules'
import { bootRules, makeAgent, requestAgent, teardown, type Harness } from './harness.ts'

const active: Harness[] = []

afterEach(async () => {
  while (active.length > 0) {
    const harness = active.pop()
    if (harness !== undefined) await teardown(harness)
  }
})

function withHarness(harness: Harness): Harness {
  active.push(harness)
  return harness
}

/** The approval-audit slice of a session log, in order. */
function auditTypes(session: { events: Array<{ type: string }> }): string[] {
  return session.events
    .filter(event => ['approval/asked', 'approval/rule', 'approval/decided'].includes(event.type))
    .map(event => event.type)
}

function ruleEvents(session: { events: Array<{ type: string; data: unknown }> }): Array<Record<string, unknown>> {
  return session.events
    .filter(event => event.type === 'approval/rule')
    .map(event => event.data as Record<string, unknown>)
}

describe('answerer semantics over the approval seam', () => {
  it('a deny rule settles rejected without consulting the interactive stub, auditing asked→rule→decided', async () => {
    const harness = withHarness(await bootRules({
      user: [{ tool: 'echo', pattern: '*', decision: 'deny' }],
      project: [],
    }))
    let stubCalled = false
    harness.ctx.on('approval/request', (_req, next) => {
      stubCalled = true
      return next()
    })

    const { agent, session, callId } = requestAgent('echo', 'say hi')
    const outcome = await harness.ctx.approval.request({ agent, toolName: 'echo', callId })

    expect(outcome).toBe('rejected')
    expect(stubCalled).toBe(false)
    expect(auditTypes(session)).toEqual(['approval/asked', 'approval/rule', 'approval/decided'])
    expect(ruleEvents(session)).toEqual([
      { tool: 'echo', pattern: '*', decision: 'deny', ruleIndex: 0, layer: 'user' },
    ])
  })

  it('an allow rule settles allowed-once without consulting the interactive stub', async () => {
    const harness = withHarness(await bootRules({
      user: [{ tool: 'echo', pattern: '*', decision: 'allow' }],
      project: [],
    }))
    let stubCalled = false
    harness.ctx.on('approval/request', (_req, next) => {
      stubCalled = true
      return next()
    })

    const { agent, session, callId } = requestAgent('echo', 'say hi')
    const outcome = await harness.ctx.approval.request({ agent, toolName: 'echo', callId })

    expect(outcome).toBe('allowed-once')
    expect(stubCalled).toBe(false)
    expect(ruleEvents(session)).toEqual([
      { tool: 'echo', pattern: '*', decision: 'allow', ruleIndex: 0, layer: 'user' },
    ])
  })

  it('delegates via next() to a later interactive answerer when no rule matches', async () => {
    const harness = withHarness(await bootRules({
      user: [{ tool: 'echo', pattern: 'nomatch', decision: 'allow' }],
      project: [],
    }))
    let stubCalled = false
    harness.ctx.on('approval/request', () => {
      stubCalled = true
      return Promise.resolve<ApprovalOutcome>('allowed-once')
    })

    const { agent, session, callId } = requestAgent('echo', 'say hi')
    const outcome = await harness.ctx.approval.request({ agent, toolName: 'echo', callId })

    expect(outcome).toBe('allowed-once')
    expect(stubCalled).toBe(true)
    expect(ruleEvents(session)).toEqual([])
  })

  it('policy=never rejects before consulting any rule, with no rule event', async () => {
    const harness = withHarness(await bootRules({
      user: [{ tool: 'echo', pattern: '*', decision: 'allow' }],
      project: [],
      approvalPolicy: 'never',
    }))
    let consulted = false
    harness.ctx.on('approval/request', (_req, next) => {
      consulted = true
      return next()
    })

    const { agent, session, callId } = requestAgent('echo', 'say hi')
    const outcome = await harness.ctx.approval.request({ agent, toolName: 'echo', callId })

    expect(outcome).toBe('rejected')
    expect(consulted).toBe(false)
    expect(ruleEvents(session)).toEqual([])
    expect(auditTypes(session)).toEqual(['approval/asked', 'approval/decided'])
  })

  it('the rule answerer runs before a later interactive answerer (order contract)', async () => {
    const harness = withHarness(await bootRules({
      user: [{ tool: 'echo', pattern: '*', decision: 'deny' }],
      project: [],
    }))
    // A late interactive answerer that would eagerly allow if it were consulted.
    harness.ctx.on('approval/request', () => Promise.resolve<ApprovalOutcome>('allowed-once'))

    const { agent, callId } = requestAgent('echo', 'say hi')
    const outcome = await harness.ctx.approval.request({ agent, toolName: 'echo', callId })
    expect(outcome).toBe('rejected')
  })

  it('a project-layer rule is matched and reported with its layer', async () => {
    const harness = withHarness(await bootRules({
      user: [],
      project: [{ tool: 'bash', pattern: 'git*', decision: 'deny' }],
    }))

    const { agent, session, callId } = requestAgent('bash', 'git push origin')
    const outcome = await harness.ctx.approval.request({ agent, toolName: 'bash', callId })

    expect(outcome).toBe('rejected')
    expect(ruleEvents(session)).toEqual([
      { tool: 'bash', pattern: 'git*', decision: 'deny', ruleIndex: 0, layer: 'project' },
    ])
  })
})

describe('/permissions command', () => {
  it('bare lists the effective rules with index, layer, tool, pattern, decision', async () => {
    const harness = withHarness(await bootRules({
      user: [{ tool: 'echo', pattern: '*', decision: 'allow' }],
      project: [{ tool: 'bash', pattern: 'git*', decision: 'deny' }],
      withCommands: true,
    }))
    const agent = makeAgent('perm-list')
    const execution = await harness.ctx.commands.execute(agent, '/permissions', new AbortController().signal)
    if (execution === undefined) throw new Error('composition did not resolve /permissions')
    expect(execution.result.kind).toBe('success')
    expect(execution.result.text).toEqual([
      '0  user  echo  *  allow',
      '1  project  bash  git*  deny',
    ].join('\n'))
  })

  it('add appends to the project-layer file and shows up on the next bare listing', async () => {
    const harness = withHarness(await bootRules({ user: [], project: [], withCommands: true }))
    const agent = makeAgent('perm-add')
    const added = await harness.ctx.commands.execute(agent, '/permissions add echo * deny', new AbortController().signal)
    if (added === undefined) throw new Error('composition did not resolve /permissions')
    expect(added.result.kind).toBe('success')
    expect(added.result.text).toBe('Added deny rule: echo * (project)')

    const source = await readFile(harness.projectFile, 'utf8')
    expect(source).toContain('echo')
    expect(source).toContain('deny')

    const listed = await harness.ctx.commands.execute(agent, '/permissions', new AbortController().signal)
    if (listed === undefined) throw new Error('composition did not resolve /permissions')
    expect(listed.result.text).toEqual('0  project  echo  *  deny')
  })

  it('remove deletes the rule at the effective index from the owning layer', async () => {
    const harness = withHarness(await bootRules({
      user: [{ tool: 'echo', pattern: '*', decision: 'allow' }],
      project: [{ tool: 'bash', pattern: 'git*', decision: 'deny' }],
      withCommands: true,
    }))
    const agent = makeAgent('perm-remove')
    const removed = await harness.ctx.commands.execute(agent, '/permissions remove 1', new AbortController().signal)
    if (removed === undefined) throw new Error('composition did not resolve /permissions')
    expect(removed.result.kind).toBe('success')
    expect(removed.result.text).toBe('Removed rule at index 1')

    const projectSource = await readFile(harness.projectFile, 'utf8')
    expect(projectSource).not.toContain('bash')
    const listed = await harness.ctx.commands.execute(agent, '/permissions', new AbortController().signal)
    if (listed === undefined) throw new Error('composition did not resolve /permissions')
    expect(listed.result.text).toEqual('0  user  echo  *  allow')
  })

  it('remove with an out-of-range effective index fails loud as an error result', async () => {
    const harness = withHarness(await bootRules({
      user: [{ tool: 'echo', pattern: '*', decision: 'allow' }],
      project: [],
      withCommands: true,
    }))
    const agent = makeAgent('perm-remove-bad')
    const removed = await harness.ctx.commands.execute(agent, '/permissions remove 5', new AbortController().signal)
    if (removed === undefined) throw new Error('composition did not resolve /permissions')
    expect(removed.result.kind).toBe('error')
    expect(removed.result.text).toContain('no rule at effective index 5')
  })

  it('rejects an illegal add decision as an error result', async () => {
    const harness = withHarness(await bootRules({ user: [], project: [], withCommands: true }))
    const agent = makeAgent('perm-add-bad')
    const added = await harness.ctx.commands.execute(agent, '/permissions add echo * maybe', new AbortController().signal)
    if (added === undefined) throw new Error('composition did not resolve /permissions')
    expect(added.result.kind).toBe('error')
    expect(added.result.text).toContain('Invalid decision "maybe"')
  })

  it('a failed add never reaches the effective snapshot (disk-authoritative commit)', async () => {
    const harness = withHarness(await bootRules({ user: [], project: [], withCommands: true }))
    const agent = makeAgent('perm-add-fail')
    // Replace the project file with a directory: every read/write fails with
    // EISDIR regardless of process uid, so the append cannot commit.
    await rm(harness.projectFile)
    await mkdir(harness.projectFile)
    const added = await harness.ctx.commands.execute(agent, '/permissions add echo * deny', new AbortController().signal)
    if (added === undefined) throw new Error('composition did not resolve /permissions')
    expect(added.result.kind).toBe('error')

    await rm(harness.projectFile, { recursive: true })
    await writeRules(harness.projectFile, [])
    const listed = await harness.ctx.commands.execute(agent, '/permissions', new AbortController().signal)
    if (listed === undefined) throw new Error('composition did not resolve /permissions')
    expect(listed.result.text).toBe('No approval rules configured.')
  })

  it('remove resolves the listed index against a fresh disk read (external edit coherence)', async () => {
    const harness = withHarness(await bootRules({
      user: [{ tool: 'echo', pattern: '*', decision: 'allow' }],
      project: [],
      withCommands: true,
    }))
    // External edit after plugin load: the user layer gains a rule the
    // in-memory snapshot has never absorbed.
    await writeRules(harness.userFile, [
      { tool: 'echo', pattern: '*', decision: 'allow' },
      { tool: 'bash', pattern: 'git*', decision: 'deny' },
    ])
    const agent = makeAgent('perm-remove-fresh')
    const removed = await harness.ctx.commands.execute(agent, '/permissions remove 0', new AbortController().signal)
    if (removed === undefined) throw new Error('composition did not resolve /permissions')
    expect(removed.result.kind).toBe('success')

    // The post-command listing re-mirrors disk: the externally added rule is
    // visible and effective, never silently dropped from both views at once.
    const listed = await harness.ctx.commands.execute(agent, '/permissions', new AbortController().signal)
    if (listed === undefined) throw new Error('composition did not resolve /permissions')
    expect(listed.result.text).toBe('0  user  bash  git*  deny')
  })

  it('mirrors into the TUI slash menu when tui.commands appears, delegating to the host command', async () => {
    const harness = withHarness(await bootRules({ user: [], project: [], withCommands: true }))
    interface Registered {
      name: string
      description: string
      argsHint?: string
      run(args: { text: string; sessionId: string | null; echo(text: string): void; ctx: { agents?: Map<string, unknown> } }): Promise<void>
    }
    const registered: Registered[] = []
    harness.ctx.provide('tui.commands', { register: (command: Registered) => { registered.push(command) } })
    await new Promise(resolve => setImmediate(resolve))
    expect(registered.map(command => command.name)).toEqual(['permissions'])
    expect(registered[0]?.description).toContain('持久化审批规则')

    const echoes: string[] = []
    const agent = makeAgent('perm-tui')
    const agents = new Map<string, unknown>([['sess-tui', agent]])
    await registered[0]!.run({ text: '', sessionId: 'sess-tui', echo: (text) => { echoes.push(text) }, ctx: { agents } })
    expect(echoes).toEqual(['No approval rules configured.'])
  })
})

describe('HMR disposal', () => {
  it('disposing the answerer fiber stops the rules from answering and lets a later answerer take over', async () => {
    const harness = withHarness(await bootRules({
      user: [{ tool: 'echo', pattern: '*', decision: 'deny' }],
      project: [],
    }))
    let stubCalled = false
    harness.ctx.on('approval/request', () => {
      stubCalled = true
      return Promise.resolve<ApprovalOutcome>('allowed-once')
    })

    const first = requestAgent('echo', 'once')
    expect(await harness.ctx.approval.request({ agent: first.agent, toolName: 'echo', callId: first.callId })).toBe('rejected')
    expect(stubCalled).toBe(false)

    await harness.fiber.dispose()

    const second = requestAgent('echo', 'twice')
    expect(await harness.ctx.approval.request({ agent: second.agent, toolName: 'echo', callId: second.callId })).toBe('allowed-once')
    expect(stubCalled).toBe(true)
  })
})
