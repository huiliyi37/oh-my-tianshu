/** Package-owned background-task snapshot invariants. @module @huiliyi37/dsh-tasks/invariant */

import type { Context } from '@huiliyi37/cordis'
import type { Agent } from '@huiliyi37/dsh-agent'
import type { InvariantFailure, InvariantInstaller } from '@huiliyi37/dsh-invariants'
import type { TaskSnapshot } from './types.ts'

const PACKAGE_NAME = '@huiliyi37/dsh-tasks'
const TERMINAL_STATUSES = new Set(['completed', 'killed', 'failed'])

/** Cordis companion plugin name. */
export const name = 'tasks-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Validate the cross-field relationships in one registry snapshot. */
function validateSnapshot(snapshot: TaskSnapshot, owner: Agent | undefined, fail: InvariantFailure): void {
  const id = String(snapshot.id)
  const prefix = `${snapshot.kind}-`
  const ordinal = Number(id.slice(prefix.length))
  if (snapshot.kind.length === 0 || !id.startsWith(prefix)
    || !Number.isSafeInteger(ordinal) || ordinal < 1) {
    fail(`task snapshot id ${JSON.stringify(id)} must be ${JSON.stringify(prefix)} followed by a positive ordinal`)
  }
  if (snapshot.label.length === 0) { fail(`task ${JSON.stringify(id)} label must be non-empty`) }
  if (!Number.isSafeInteger(snapshot.startedAt) || snapshot.startedAt < 0) {
    fail(`task ${JSON.stringify(id)} startedAt must be a non-negative epoch integer`)
  }

  const terminal = TERMINAL_STATUSES.has(snapshot.status)
  if (terminal !== (snapshot.finishedAt !== undefined)) {
    fail(`task ${JSON.stringify(id)} finishedAt must be present exactly for a terminal status`)
  }
  if (snapshot.finishedAt !== undefined
    && (!Number.isSafeInteger(snapshot.finishedAt) || snapshot.finishedAt < snapshot.startedAt)) {
    fail(`task ${JSON.stringify(id)} finishedAt must be an epoch integer no earlier than startedAt`)
  }

  const expectedOwner = owner?.id
  if (snapshot.ownerSession !== expectedOwner) {
    fail(`task ${JSON.stringify(id)} ownerSession does not match its completion owner`)
  }
}

/** Install checks over current unowned records and every terminal snapshot. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  for (const snapshot of ctx.tasks.list()) validateSnapshot(snapshot, undefined, fail)
  ctx.tasks.onTaskDone((snapshot, owner) => { validateSnapshot(snapshot, owner, fail) })
}, { inject: ['tasks'] })

/**
 * Register the task-registry invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
