/**
 * Process-local owner for the static welcome snapshot.
 *
 * The controller owns no timer. Attach settles the same rest pose for `auto`
 * and `off`; {@link current} reports completion immediately while active.
 *
 * @module @huiliyi37/dsh-tui/controllers/welcome-intro-controller
 */

/** Reasons that can settle the temporary welcome intro into final scrollback. */
export type WelcomeIntroSettleReason = 'natural' | 'input' | 'resize' | 'skipped' | 'commit'

/** Mutable caller input copied into the controller-owned welcome snapshot. */
export interface WelcomeIntroSnapshotInput {
  /** Model identifier captured for the complete welcome lifetime. */
  modelId: string
  /** Optional reasoning effort captured with the selected model. */
  reasoningEffort?: string
  /** Session working directory captured during startup preparation. */
  cwd: string
  /** Optional distribution version captured during startup preparation. */
  version?: string
  /** Already-rendered restore rows pending final settlement. */
  restoreLines: readonly string[]
  /** Already-selected startup tip pending final settlement. */
  tip: string
}

/** Frozen welcome data shared by preview and final settlement. */
export interface WelcomeIntroSnapshot {
  /** Model identifier captured for the complete welcome lifetime. */
  readonly modelId: string
  /** Optional reasoning effort captured with the selected model. */
  readonly reasoningEffort?: string
  /** Session working directory captured during startup preparation. */
  readonly cwd: string
  /** Optional distribution version captured during startup preparation. */
  readonly version?: string
  /** Frozen restore rows pending final settlement. */
  readonly restoreLines: readonly string[]
  /** Already-selected startup tip pending final settlement. */
  readonly tip: string
}

/** Immediate-completion signal returned while the intro is still active. */
export interface WelcomeIntroCompleteSample {
  /** Completion-sample discriminant. */
  readonly kind: 'complete'
  /** Elapsed duration; static attach always reports zero. */
  readonly elapsedMs: number
}

/**
 * Result of sampling an intro: immediate completion, or null after the
 * controller has settled or been cancelled.
 */
export type WelcomeIntroSample = WelcomeIntroCompleteSample | null

type WelcomeIntroLifecycle = 'active' | 'settled' | 'cancelled'

function freezeSnapshot(input: WelcomeIntroSnapshotInput): WelcomeIntroSnapshot {
  const restoreLines = Object.freeze([...input.restoreLines])
  return Object.freeze({
    modelId: input.modelId,
    ...(input.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: input.reasoningEffort }),
    cwd: input.cwd,
    ...(input.version === undefined ? {} : { version: input.version }),
    restoreLines,
    tip: input.tip,
  })
}

/**
 * Owns one immutable welcome snapshot until settlement or cancellation.
 *
 * Settlement and cancellation are one-way, idempotent transitions. Once
 * either transition wins, {@link current} returns null permanently.
 */
export class WelcomeIntroController {
  /** Frozen startup data used by final settlement. */
  readonly snapshot: WelcomeIntroSnapshot
  /** Monotonic attach origin in the caller's `performance.now()` domain. */
  readonly startedAt: number

  private lifecycle: WelcomeIntroLifecycle = 'active'
  private settledBecause: WelcomeIntroSettleReason | null = null

  /**
   * Creates one process-attach welcome snapshot.
   *
   * @param snapshot - Startup values copied and recursively frozen at the array boundary.
   * @param startedAt - Monotonic origin; defaults to `performance.now()`.
   */
  constructor(
    snapshot: WelcomeIntroSnapshotInput,
    startedAt: number = performance.now(),
  ) {
    this.snapshot = freezeSnapshot(snapshot)
    this.startedAt = startedAt
  }

  /** Whether completion samples can still be observed. */
  get active(): boolean {
    return this.lifecycle === 'active'
  }

  /** Whether final settlement won the lifecycle race. */
  get settled(): boolean {
    return this.lifecycle === 'settled'
  }

  /** Whether cancellation won the lifecycle race. */
  get cancelled(): boolean {
    return this.lifecycle === 'cancelled'
  }

  /** First settlement reason, or null before settlement and after cancellation. */
  get settleReason(): WelcomeIntroSettleReason | null {
    return this.settledBecause
  }

  /**
   * Reports immediate completion while the intro is still active.
   *
   * @param _now - Ignored; retained so callers can keep passing timestamps.
   * @returns Immediate completion, or null after lifecycle closure.
   */
  current(_now: number = performance.now()): WelcomeIntroSample {
    if (!this.active) return null
    return { kind: 'complete', elapsedMs: 0 }
  }

  /**
   * Closes the intro at its sole final-commit boundary.
   *
   * @param reason - First lifecycle reason that reached final settlement.
   * @returns True only for the transition that changed active to settled.
   */
  settle(reason: WelcomeIntroSettleReason): boolean {
    if (!this.active) return false
    this.lifecycle = 'settled'
    this.settledBecause = reason
    return true
  }

  /**
   * Cancels the intro without authorizing a final welcome commit.
   *
   * @returns True only for the transition that changed active to cancelled.
   */
  cancel(): boolean {
    if (!this.active) return false
    this.lifecycle = 'cancelled'
    return true
  }
}
