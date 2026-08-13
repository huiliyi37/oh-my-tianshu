import { describe, expect, it } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import type { Agent } from '@huiliyi37/dsh-agent'
import { TaskId, TaskService } from '@huiliyi37/dsh-tasks'
import type { TaskDoneListener, TaskRead, TaskSnapshot, TaskStart } from '@huiliyi37/dsh-tasks'

/**
 * Minimal concrete registry: one canned record. The Service Definition owns the contract
 * only (ids, snapshots, authorization-shaped signatures); the registry
 * behavior suite lives with `@huiliyi37/dsh-tasks-local`.
 */
class StubTaskService extends TaskService {
  snapshotOf(id: TaskId): TaskSnapshot {
    return {
      id,
      kind: 'bash',
      label: 'sleep 60',
      status: 'running',
      startedAt: 0,
      reported: false,
    }
  }

  start(spec: TaskStart): TaskId {
    spec.run()
    return TaskId(`${spec.kind}-1`)
  }

  list(): TaskSnapshot[] {
    return [this.snapshotOf(TaskId('bash-1'))]
  }

  get(id: TaskId): TaskSnapshot {
    return this.snapshotOf(id)
  }

  read(id: TaskId): TaskRead {
    return { text: '', snapshot: this.snapshotOf(id) }
  }

  kill(): 'requested' | 'already-finished' {
    return 'requested'
  }

  wait(id: TaskId, _timeoutMs: number, _caller?: Agent, _signal?: AbortSignal): Promise<TaskSnapshot> {
    return Promise.resolve(this.snapshotOf(id))
  }

  onTaskDone(_listener: TaskDoneListener): () => void {
    return () => {}
  }

  attachSurface(_name: string): () => void {
    return () => {}
  }
}

describe('TaskService seam', () => {
  it('a concrete subclass registers as ctx.tasks and serves the abstract API', async () => {
    const ctx = new Context()
    await ctx.plugin(StubTaskService)

    const detachSurface = ctx.tasks.attachSurface('seam-test')
    const id = ctx.tasks.start({ kind: 'bash', label: 'sleep 60', run: () => { return ({ cancel() {}, done: new Promise(() => {}) }) } })
    expect(id).toBe('bash-1')
    expect(ctx.tasks.list()).toHaveLength(1)
    expect(ctx.tasks.get(id).status).toBe('running')
    expect(ctx.tasks.read(id).text).toBe('')
    expect(ctx.tasks.kill(id)).toBe('requested')
    await expect(ctx.tasks.wait(id, 5)).resolves.toMatchObject({ id })
    const detachListener = ctx.tasks.onTaskDone(() => {})
    detachListener()
    detachSurface()
  })

  it('loading a second implementation throws (one tasks service per context — cordis standard)', async () => {
    const ctx = new Context()
    await ctx.plugin(StubTaskService)
    class SecondTaskService extends StubTaskService {}
    await expect(ctx.plugin(SecondTaskService)).rejects.toThrow(/service "tasks" has been registered/)
  })

  it('mounting the abstract seam directly fails loudly at load (stale-composition fence)', async () => {
    const ctx = new Context()
    await expect(ctx.plugin(TaskService as unknown as typeof StubTaskService))
      .rejects.toThrow(/abstract task registry seam; load an implementation such as @huiliyi37\/dsh-tasks-local/)
  })
})
