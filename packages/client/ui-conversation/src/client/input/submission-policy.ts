/**
 * Browser-local Composer submission policy. It owns the persisted busy-Enter
 * preference and resolves keyboard gestures into queue/steer delivery modes;
 * Host and Agent keep the actual delivery-window authority.
 */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  BusyEnterBehavior, ComposerSubmitGesture, InputSubmitMode,
} from '../contract/composer-submission.ts'

/** localStorage key holding the busy-Enter preference. */
export const BUSY_ENTER_STORAGE_KEY = 'dsh.conversation.busyEnter'

/** Default preserves Enter-as-Queue for running conversations. */
export const DEFAULT_BUSY_ENTER_BEHAVIOR: BusyEnterBehavior = 'queue'

/**
 * Persisted policy used by both the composer inject face and its Settings row.
 * Direct `steer` is intentionally best-effort: AgentLoop turns a closed-window
 * submission into the next waking Queue item.
 */
export class ComposerSubmissionPolicy {
  /** Reactive preference source for the Settings row. */
  readonly busyEnter: SnapshotStore<BusyEnterBehavior> = createSnapshotStore(restoreBusyEnter())

  /**
   * Resolve one keyboard gesture without changing state.
   * @param running - whether the addressed agent currently reports busy.
   * @param gesture - plain Enter or the Cmd/Ctrl-accelerated chord.
   * @param steeringAvailable - whether this session transport supports steering.
   * @returns Queue outside steer-capable busy state; otherwise the preferred mode or its opposite.
   */
  resolve(
    running: boolean,
    gesture: ComposerSubmitGesture,
    steeringAvailable: boolean,
  ): InputSubmitMode {
    if (!running || !steeringAvailable) return 'queue'
    const preferred = this.busyEnter.getSnapshot()
    if (gesture === 'enter') return preferred
    return preferred === 'queue' ? 'steer' : 'queue'
  }

  /**
   * Change and persist the plain-Enter behavior used during busy state.
   * @param behavior - Queue or Steer.
   */
  setBusyEnter(behavior: BusyEnterBehavior): void {
    if (this.busyEnter.getSnapshot() === behavior) return
    this.busyEnter.set(behavior)
    persistBusyEnter(behavior)
  }
}

/** Restore a valid preference; unavailable or corrupt storage uses Queue. */
function restoreBusyEnter(): BusyEnterBehavior {
  if (typeof localStorage === 'undefined') return DEFAULT_BUSY_ENTER_BEHAVIOR
  let stored: string | null
  try {
    stored = localStorage.getItem(BUSY_ENTER_STORAGE_KEY)
  } catch {
    // Storage access can fail in privacy modes; the default remains usable.
    return DEFAULT_BUSY_ENTER_BEHAVIOR
  }
  if (stored === 'queue' || stored === 'steer') return stored
  return DEFAULT_BUSY_ENTER_BEHAVIOR
}

/** Persist a preference when browser storage is available. */
function persistBusyEnter(behavior: BusyEnterBehavior): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(BUSY_ENTER_STORAGE_KEY, behavior)
  } catch {
    // A storage failure makes the preference session-only; input stays usable.
  }
}
