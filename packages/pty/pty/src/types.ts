/**
 * Types shared by PTY backends, the owner-scoped registry, and tool consumers.
 * Runtime service code lives in `./index.ts`.
 * @module @deepseek-ai/dsh-pty/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { Agent } from '@deepseek-ai/dsh-agent'

/** Internal exported basis for the public `PtySessionId` type/value pair. */
export type PtySessionIdValue = Branded<'PtySessionId'>

/**
 * Backend-reported failure to clean partial resources after unpublished setup failed.
 * @param spawnError - original setup or cancellation failure.
 * @param cleanupError - failure that may leave backend-owned resources alive.
 */
export class PtyBackendCleanupError extends AggregateError {
  constructor(
    readonly spawnError: unknown,
    readonly cleanupError: unknown,
  ) {
    super([spawnError, cleanupError], 'PTY backend startup and cleanup both failed')
    this.name = 'PtyBackendCleanupError'
  }
}

/** Why one interactive send returned control to its caller. */
export type PtyWaitReason = 'stdin_read' | 'inferred_idle' | 'timeout' | 'session_exit'

/**
 * Signals the model-facing PTY surface permits for foreground process groups.
 * Kept member-identical to `SubprocessTerminalSignal` in
 * `@deepseek-ai/dsh-subprocess` without a cross-seam dependency; change both together.
 */
export type PtySignal = 'SIGINT' | 'SIGTERM' | 'SIGKILL' | 'SIGTSTP' | 'SIGHUP'

/** Top-level PTY process status, independent of a send's wait reason. */
export type PtySessionStatus =
  | { kind: 'running' }
  | { kind: 'exited'; exitCode: number | null; signal: NodeJS.Signals | null }

/** Request to create one owner-scoped PTY session. */
export interface PtySpawnRequest {
  /** Registered backend type. */
  type: string
  /** Optional owner-local display name. */
  name?: string
  /** Optional initial working directory interpreted by the backend. */
  cwd?: string
}

/** Fully identified request handed from the registry to a backend. */
export interface PtyBackendSpawnSpec extends PtySpawnRequest {
  /** Registry-minted session identity. */
  sessionId: PtySessionIdValue
  /** Exact live owner for authority-aware backend setup. */
  owner: Agent
  /** Cancellation of unpublished backend setup. */
  signal?: AbortSignal
}

/** Input for one line-oriented terminal interaction. */
export interface PtySendRequest {
  /** UTF-8 text to write. */
  text: string
  /** Whether to write the backend's Enter sequence after {@link text}. */
  submit: boolean
  /** Cancellation for the wait; backends also interrupt the foreground command. */
  signal?: AbortSignal
}

/** Incremental output consumed from one live send operation. */
export interface PtySendRead {
  /** Output produced since the previous operation read. */
  delta: string
  /** Whether unread operation output was dropped by the backend's bound. */
  truncated: boolean
}

/** Settled result for one foreground or background send. */
export interface PtySendResult {
  /** Bounded rendered terminal delta remaining at settlement. */
  viewport: string
  /** Why the wait returned; this does not imply arbitrary child-process exit. */
  waitReason: PtyWaitReason
  /** Top-level session status observed at settlement. */
  sessionStatus: PtySessionStatus
  /** Whether output was dropped from the operation or retained scrollback. */
  truncated: boolean
}

/** Live backend-owned send; exactly one may be active per PTY session. */
export interface PtySendOperation {
  /** Resolves after readiness, timeout, cancellation, or top-level process exit. */
  done: Promise<PtySendResult>
  /** Consume output produced since the prior call. */
  readOutput(): PtySendRead
  /** Request `SIGINT`; returns false after the operation settled. */
  cancel(): boolean
}

/** Request for one backward scrollback page. */
export interface PtyReadRequest {
  /** Offset from the newest retained line; defaults are backend-owned. */
  offset?: number
  /** Requested line count; backend limits still apply. */
  count?: number
}

/** Bounded scrollback page. */
export interface PtyReadResult {
  /** Retained text in chronological order. */
  text: string
  /** Number of lines currently retained. */
  totalLines: number
  /** Inclusive newest-relative offset of the first returned line. */
  lineBegin: number
  /** Exclusive newest-relative offset after the returned page. */
  lineEnd: number
  /** Whether older retained output or the requested result exceeded a bound. */
  truncated: boolean
}

/** Result of delivering a signal to a verified foreground process group. */
export interface PtySignalResult {
  /** True only after the backend delivered the signal. */
  delivered: true
  /** Process group that received the signal. */
  targetPgid: number
}

/** Owner-visible summary of one published PTY session. */
export interface PtySessionSnapshot {
  /** Registry-minted identity used by every operation. */
  sessionId: PtySessionIdValue
  /** Optional owner-local display name. */
  name?: string
  /** Backend type that created the session. */
  type: string
  /** Top-level process id when the backend has one. */
  pid?: number
  /** Current top-level process status. */
  status: PtySessionStatus
}

/** Backend-owned live session retained by {@link PtyService}. */
export interface PtyBackendSession {
  /** Initial bounded terminal output returned from `terminal_open`. */
  readonly motd: string
  /** Top-level process id when one exists. */
  readonly pid?: number
  /** Start one exclusive send operation. */
  startSend(request: PtySendRequest): PtySendOperation
  /** Read one bounded page from retained scrollback. */
  read(request: PtyReadRequest): PtyReadResult
  /** Signal the verified foreground process group. */
  signal(signal: PtySignal): Promise<PtySignalResult>
  /** Observe top-level process status. */
  status(): PtySessionStatus
  /** Idempotently close the captured owned process tree and await quiescence. */
  close(reason: string): Promise<void>
}

/** Replaceable provider for one PTY session type. */
export interface PtyBackend {
  /** Stable type selected by {@link PtySpawnRequest.type}. */
  readonly type: string
  /** Create an unpublished session or reject after cleaning partial resources; cleanup failure uses {@link PtyBackendCleanupError}. */
  spawn(spec: PtyBackendSpawnSpec): Promise<PtyBackendSession>
}

/** Successful publication returned by {@link PtyService.spawn}. */
export interface PtySpawnResult extends PtySessionSnapshot {
  /** Initial bounded output captured before publication. */
  motd: string
}
