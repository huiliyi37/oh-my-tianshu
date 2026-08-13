/**
 * The outward session face. Feature packages never see the concrete Session
 * class: components read conversation state through `useSession` (the
 * ObservableSnapshot half), and orchestration code calls the behavior verbs
 * below — nothing else. Widening this interface is the explicit act of
 * widening what features may do to a session (and what every test fixture
 * must stub); runtime-internal entry points (history staging, wire-frame
 * dispatch) stay on the class, invisible out here.
 */
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type {
  MessageId, QueueAction, RpcResult, SessionId,
} from '@deepseek-ai/dsh-client-connection/client'
import type { ConversationSnapshot } from '../sessions/conversation.ts'
import type { ObservableSnapshot } from './store.ts'

/** Key-addressed projection read face (the useProjection resolution path; see ProjectionValueStore). */
export interface ProjectionsFace {
  /**
   * The identity-stable bare observable for one projection key (absence is
   * an `undefined` snapshot, never a missing face).
   * @param key - projection key.
   * @returns the key's value face.
   */
  faceOf(key: string): ObservableSnapshot<unknown>
}

/** Identity plus the behavior verbs features may invoke on a session. */
export interface ISession {
  /** The session's host identity (agent id — same axis). */
  readonly sessionId: SessionId
  /** Host-computed projection values by key (the useProjection seat). */
  readonly projections: ProjectionsFace
  /**
   * Send a prompt into the session.
   * @param content - model-facing content blocks.
   * @param mode - 'queue' appends a turn; 'steer' interrupts the running one.
   * @returns acceptance, or the business error (also mirrored into snapshot.promptError).
   */
  prompt(content: ContentBlock[], mode: 'queue' | 'steer'): Promise<RpcResult<{ accepted: true }>>
  /**
   * Apply one edit, remove, or strict steer action to a still-pending queue occurrence.
   * @param itemId - agent-owned inbox occurrence identity.
   * @param action - requested queue operation.
   * @returns acceptance, or a business/transport error.
   */
  updateQueue(itemId: MessageId, action: QueueAction): Promise<RpcResult<{ accepted: true }>>
  /**
   * Cancel the running turn. Pending queued work remains and resumes in FIFO
   * order after the Host reaches cancellation quiescence.
   * @returns acceptance, or the business error.
   */
  cancel(): Promise<RpcResult<{ accepted: true }>>
  /**
   * Rename this session (explicit user title; pins it against automatic
   * regeneration).
   * @param title - raw title text (the host normalizes acceptance).
   * @returns the normalized accepted title and its event seq, or the business error.
   */
  rename(title: string): Promise<RpcResult<{ title: string; seq: number }>>
  /**
   * Extend the history window backwards (older messages pagination).
   * @returns completion; failures land in snapshot.openState/loadingOlder.
   */
  loadOlder(): Promise<void>
  /**
   * Execute one slash-command line against this session's agent — pure
   * admission semantics (the host executor durably logs the lifecycle).
   * @param line - the full command line, leading slash included.
   * @returns the admission result, or the error branch on transport failure.
   */
  command(line: string): Promise<RpcResult<{ matched: boolean }>>
}

/**
 * The full outward face: behavior verbs plus the conversation read side
 * (the `useSession` hook source). This is the type carried by
 * `SessionBinding.session` and the provide channel.
 */
export type SessionFace = ISession & ObservableSnapshot<ConversationSnapshot>
