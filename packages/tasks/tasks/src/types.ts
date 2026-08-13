/**
 * Types shared by task producers, the registry, and control surfaces. The
 * service implementation lives in `./index.ts`.
 * @module @huiliyi37/dsh-tasks/types
 */

import type { Branded } from '@huiliyi37/dsh-brand'
import type { Agent } from '@huiliyi37/dsh-agent'
import type { SessionId } from '@huiliyi37/dsh-session'

/**
 * Identifies a background task. The registry generates `<kind>-N`; predictable
 * ids rely on owner authorization rather than secrecy.
 */
export type TaskId = Branded<'TaskId'>

/**
 * Brand a string as a {@link TaskId}.
 * @param id - the raw task-id string (the registry generates `<kind>-N`).
 * @returns the same string, branded; no validation is performed.
 */
export function TaskId(id: string): TaskId {
  return id as TaskId
}

/**
 * Task lifecycle: `running`, optionally `stopping`, then exactly one terminal
 * status. Producer-specific facts belong in {@link TaskSnapshot.detail}.
 */
export type TaskStatus = 'running' | 'stopping' | 'completed' | 'killed' | 'failed'

/**
 * Producer-defined task kinds. Plugins extend this map by declaration merging;
 * the registry treats every value as an opaque id namespace.
 */
export interface TaskKindMap {
  bash: 'bash'
  subagent: 'subagent'
}

/** The merge-extensible union of registered producer kind names. */
export type TaskKind = TaskKindMap[keyof TaskKindMap]

/** Terminal result supplied by a producer through {@link TaskHooks.done}. */
export interface TaskOutcome {
  /** How the task ended: finished (`completed`), cancelled (`killed`), or broke (`failed`). */
  status: 'completed' | 'killed' | 'failed'
  /** Kind-specific detail rendered into status lines ('exit code: 3', 'max-tokens'). */
  detail?: string
  /** Final output for tasks without `readOutput`; stream tasks leave it unset. */
  output?: string
}

/**
 * Producer declaration passed to {@link TaskService.start}. The runtime
 * preflights access and cleanup before invoking {@link run}; the producer owns
 * execution resources while the runtime owns identity and lifecycle state.
 */
export interface TaskStart {
  /** Producer kind — also the id prefix (`bash`, `subagent`, …). */
  kind: TaskKind
  /** One-line model-facing label (the command; the delegation description). */
  label: string
  /**
   * Optional UTF-8 byte cap for each complete model-facing completion notice or
   * output read, including control-surface status metadata.
   */
  outputLimitBytes?: number
  /**
   * Owning live agent. Access is fenced by its session id, and agent disposal
   * cancels and awaits the task. The instance must be the one currently
   * registered under its agent id. Omitting the owner creates an unowned task,
   * open to any caller until service disposal.
   */
  owner?: Agent
  /**
   * Start the work after preflight and synchronously return its hooks. Called
   * once; a throw leaves nothing registered, and the producer must clean up any
   * partially started resources.
   */
  run(): TaskHooks
}

/** Hooks through which the runtime controls and observes producer work. */
export interface TaskHooks {
  /**
   * Request termination. Must be synchronous, idempotent, and eventually settle
   * {@link done}; throws propagate. The optional reason is forwarded verbatim.
   */
  cancel(reason?: string): void
  /**
   * Resolves after the producer releases its resources, not merely when work
   * finishes. Must not reject; the runtime converts a rejection to `failed`.
   * If teardown cancellation throws, the runtime may force-fail only the
   * registry record without claiming that the work stopped.
   */
  done: Promise<TaskOutcome>
  /**
   * Consume output produced since the previous call. The producer formats
   * truncation and spill notices. Absence marks a final-output-only task; each
   * task has one consuming cursor.
   */
  readOutput?(): string
}

/**
 * A read-only projection of one task, safe to hand to listeners and tools —
 * a fresh object per call, never live registry state.
 */
export interface TaskSnapshot {
  /** The registry-issued id (`<kind>-N`). */
  id: TaskId
  /** The producer kind the task was registered with. */
  kind: TaskKind
  /** The producer-supplied one-line label. */
  label: string
  /** Producer-owned cap for complete model-facing notices and output reads. */
  outputLimitBytes?: number
  /**
   * Owner session id used for authorization and correlation; absent for
   * unowned tasks. Completion listeners receive the exact {@link Agent}
   * separately through {@link TaskDoneListener}.
   */
  ownerSession?: SessionId
  /** Current lifecycle state. */
  status: TaskStatus
  /** Kind-specific status detail, present once the producer supplied one (usually terminal). */
  detail?: string
  /** Epoch ms when the task was registered. */
  startedAt: number
  /** Epoch ms when the task settled; absent while `running`/`stopping`. */
  finishedAt?: number
  /**
   * True when a kill, read, or wait has reported or committed to report the
   * terminal state. Completion surfaces suppress redundant notices when set.
   */
  reported: boolean
}

/** Output and post-read state returned by {@link TaskService.read}. */
export interface TaskRead {
  /**
   * Stream kinds: the consuming delta since the previous read. Final-output
   * kinds: empty while live, the terminal {@link TaskOutcome.output} (or
   * empty) once settled — idempotent, never consumed.
   */
  text: string
  /** The task's state at read time. */
  snapshot: TaskSnapshot
}

/**
 * Completion callback with the exact owner supplied at start, or `undefined`
 * for an unowned task. Returned promises are observed but not awaited.
 */
export type TaskDoneListener = (
  snapshot: TaskSnapshot,
  owner: Agent | undefined,
) => void | PromiseLike<void>
