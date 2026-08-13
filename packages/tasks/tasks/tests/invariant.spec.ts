import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import TaskService, { TaskId } from '@deepseek-ai/dsh-tasks'
import type { TaskDoneListener, TaskSnapshot } from '@deepseek-ai/dsh-tasks'
import * as TasksInvariant from '@deepseek-ai/dsh-tasks/invariant'
import InvariantService from '@deepseek-ai/dsh-invariants'

const BASE: TaskSnapshot = {
  id: TaskId('bash-1'),
  kind: 'bash',
  label: 'compile',
  status: 'completed',
  startedAt: 10,
  finishedAt: 20,
  reported: false,
}

const RUNNING: TaskSnapshot = {
  id: TaskId('bash-1'),
  kind: 'bash',
  label: 'compile',
  status: 'running',
  startedAt: 10,
  reported: false,
}

const TERMINAL_WITHOUT_FINISH: TaskSnapshot = {
  id: TaskId('bash-1'),
  kind: 'bash',
  label: 'compile',
  status: 'completed',
  startedAt: 10,
  reported: false,
}

async function setup(seed: TaskSnapshot[] = []): Promise<(snapshot: unknown, owner?: Agent) => void> {
  const ctx = new Context()
  let listener: TaskDoneListener | undefined
  const probe = {
    list: () => { return seed },
    onTaskDone(value: TaskDoneListener) {
      listener = value
      return () => { listener = undefined }
    },
  } as unknown as TaskService
  await ctx.plugin(InvariantService)
  await ctx.plugin({
    name: 'task-invariant-probe',
    apply(child: Context) { child.provide('tasks', probe) },
  })
  await ctx.plugin(TasksInvariant)
  if (listener === undefined) { throw new Error('task invariant did not subscribe to terminal snapshots') }
  return (snapshot, owner) => { listener!(snapshot as TaskSnapshot, owner) }
}

describe('task-registry invariants', () => {
  it('accepts coherent current and terminal snapshots', async () => {
    const notify = await setup([RUNNING])
    expect(() => { notify(BASE) }).not.toThrow()
    const owner = { id: SessionId('owner') } as Agent
    expect(() => { notify({ ...BASE, id: TaskId('subagent-2'), kind: 'subagent', ownerSession: owner.id }, owner) })
      .not.toThrow()
  })

  it.each([
    [{ ...BASE, id: TaskId('-1'), kind: '' }, undefined, /positive ordinal/],
    [{ ...BASE, id: TaskId('other-1') }, undefined, /must be "bash-" followed by a positive ordinal/],
    [{ ...BASE, id: TaskId('bash-x') }, undefined, /positive ordinal/],
    [{ ...BASE, id: TaskId('bash-0') }, undefined, /positive ordinal/],
    [{ ...BASE, startedAt: -1 }, undefined, /startedAt must be a non-negative epoch integer/],
    [{ ...BASE, startedAt: 0.5 }, undefined, /startedAt must be a non-negative epoch integer/],
    [{ ...BASE, status: 'running' }, undefined, /finishedAt must be present exactly for a terminal status/],
    [TERMINAL_WITHOUT_FINISH, undefined, /finishedAt must be present exactly for a terminal status/],
    [{ ...BASE, finishedAt: 9 }, undefined, /no earlier than startedAt/],
    [{ ...BASE, finishedAt: 20.5 }, undefined, /no earlier than startedAt/],
    [{ ...BASE, ownerSession: SessionId('recorded') }, { id: SessionId('actual') } as Agent, /does not match its completion owner/],
  ] as const)('rejects an incoherent registry snapshot', async (snapshot, owner, message) => {
    const notify = await setup()
    expect(() => { notify(snapshot, owner) }).toThrow(message)
  })

  it('rejects an incoherent record already present at installation', async () => {
    await expect(setup([{ ...BASE, label: '' }])).rejects.toThrow(/label must be non-empty/)
  })
})
