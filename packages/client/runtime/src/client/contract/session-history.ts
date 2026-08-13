import type {
  RpcError, SessionId,
} from '@deepseek-ai/dsh-client-connection/client'
import type { SessionHistoryInspection } from '../sessions/history.ts'
import type { ObservableSnapshot } from './store.ts'

/** Observable state of one independently loaded session history ledger. */
export interface SessionHistorySnapshot {
  state: 'cold' | 'loading' | 'ready' | 'error'
  error: RpcError | null
  hasMore: boolean
  /** Absolute sequence of the first loaded raw event, or zero for an empty window. */
  baseSeq: number
  inspection: SessionHistoryInspection
}

/** Read-only history source addressed by session id. */
export interface SessionHistoryFace
  extends ObservableSnapshot<SessionHistorySnapshot> {
  readonly sessionId: SessionId
  /**
   * Load the current tail without reading older pages.
   * @param signal - Consumer lifetime.
   * @returns When the tail is ready or loading fails.
   */
  loadTail(signal?: AbortSignal): Promise<void>
  /**
   * Prepend one older page when the current window has a predecessor.
   * @param signal - Consumer lifetime.
   * @returns Whether the loaded window advanced.
   */
  loadOlder(signal?: AbortSignal): Promise<boolean>
}

/** Runtime service resolving independent history sources. */
export interface ISessionHistory {
  /**
   * Resolve the identity-stable source for a session.
   * @param sessionId - Host session identity.
   * @returns The source owned outside Session and SessionManager.
   */
  source(sessionId: SessionId): SessionHistoryFace
}
