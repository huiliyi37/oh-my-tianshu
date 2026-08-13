/**
 * GoalBar's injected face. The target 'conversation.input.dock' slot is
 * declared (children table) and typed by ui-conversation; this package only
 * contributes the entry, so no SlotMap merge lives here. The live goal value
 * is NOT part of this face — it arrives through `useProjection('goal')`
 * (the framework standard kit); inject carries only the mutation verbs
 * (callbacks from inject, live state from useProjection).
 */

/** Settled outcome of one goal mutation, rendered inline by the strip. */
export type GoalActionResult =
  | { ok: true }
  | { ok: false; error: { code: string; message: string } }

/** Injected business face of the GoalBar dock entry: the mutation verbs (function properties: the strip destructures them freely). */
export interface GoalBarActions {
  /**
   * Replace the current goal's objective (CAS on the projected ref).
   * @param objective - replacement objective text.
   */
  onEdit: (objective: string) => Promise<GoalActionResult>
  /** Pause an active goal. */
  onPause: () => Promise<GoalActionResult>
  /** Resume a paused goal. */
  onResume: () => Promise<GoalActionResult>
  /** Clear the current goal (tombstone). */
  onClear: () => Promise<GoalActionResult>
}
