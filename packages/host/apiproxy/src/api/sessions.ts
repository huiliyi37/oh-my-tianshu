/**
 * sessions domain contract. Method signatures are the source of truth:
 * unary methods take the RpcRequest<P> narrow form and the impl echoes rpcId; everything
 * else references RequestPayload<'session.*'> / ResponseValue<'session.*'>.
 */

import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session/types'
// The pure-type outlet: api/ is browser-importable, and the package root's
// cordis Context merge (via dsh-agent) must not enter client aggregates.
import type { SessionProjectionMap } from '@deepseek-ai/dsh-session-projection/types'
import type { RpcId, RpcRequest, RpcResponse } from './rpc.ts'
import type { ToolEventView } from './events.ts'
import type { WorkspaceId } from './workspace.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /**
     * The prompt's rpcId is passed through MessageSource into the `user/message` event
     * (the client uses it to reconcile the optimistically
     * echoed provisional message with the event stream). kind stays `'user'` — the model face
     * carries no transport vocabulary; rpcId is an extra durable-JSON field passed back to the client with the event.
     */
    'user-rpc': { kind: 'user'; rpcId: RpcId }
  }
}

/**
 * One history page entry: the raw event plus the optional host-computed render
 * intent (same semantics as the mux frame's `view` slot — a pagination-time
 * derivation, never persisted).
 */
export interface HistoryEntry {
  event: SessionEvent
  view?: ToolEventView
}

/**
 * The projection baseline riding the history tail page: one synchronous cut
 * over every registered projection unit, read from the registry's watermark
 * cache. `asOfSeq` is the seq of the last committed event every value
 * reflects — the window tail event seq (`-1` for an empty log, mirroring
 * `session/subscribed.lastSeq`), directly comparable with
 * `session/projection` frame seqs under the client's higher-seq-wins rule. A
 * key absent from `values` means the capability is absent (its domain plugin
 * is unmounted).
 */
export interface SessionProjectionsBlock {
  /** Seq of the last event the values reflect; -1 for an empty log. */
  asOfSeq: number
  /** Whole current value per registered projection key. */
  values: Partial<SessionProjectionMap>
}

/** Complete model selection for one session. */
export interface ModelSelection {
  /** Registered provider route. */
  provider: string
  /** Provider-owned model id. */
  model: string
  /** Adapter-owned reasoning effort; absence preserves adapter/provider default behavior. */
  reasoningEffort?: string
}

/** One adapter-owned reasoning effort displayed for an exact model route. */
export interface ModelReasoningEffort {
  /** Opaque value submitted back to the owning adapter. */
  id: string
  /** Adapter-supplied display name. */
  name: string
  /** Optional adapter-supplied description. */
  description?: string
}

/** Selectable reasoning metadata for one exact model route. */
export interface ModelReasoning {
  /** Efforts in adapter-preferred display order. */
  efforts: ModelReasoningEffort[]
  /** Adapter-configured default; absence preserves the provider default. */
  defaultEffort?: string
}

/** One model displayed inside its provider group. */
export interface ModelCatalogModel {
  /** Provider-owned model id. */
  id: string
  /** Provider-supplied display name. */
  name: string
  /** Optional provider-supplied description. */
  description?: string
  /** Exact-route reasoning metadata when the adapter exposes it. */
  reasoning?: ModelReasoning
}

/** One provider and the models it advertised successfully. */
export interface ModelProviderGroup {
  /** Provider route id used for requests. */
  id: string
  /** Provider display name. */
  name: string
  /** Models in provider-preferred order. */
  models: ModelCatalogModel[]
}

/** A provider whose asynchronous catalog lookup failed. */
export interface ModelCatalogFailure {
  /** Provider route id. */
  id: string
  /** Provider display name. */
  name: string
  /** Lookup failure diagnostic. */
  message: string
}

/** Detached model-directory snapshot for one session. */
export interface SessionModels {
  /** Model selection for the session's next assembled step. */
  current: ModelSelection
  /**
   * Whether an adapter currently serves `current.provider`, and therefore
   * whether this session can start a turn at all. Deliberately NOT derivable
   * from `groups`: catalog membership is advisory, so a route serving a model
   * it stopped advertising is absent from the groups yet perfectly usable,
   * while a route whose adapter is gone can serve nothing. A surface that
   * blocks input must read this rather than the groups.
   */
  routable: boolean
  /** Successfully loaded provider groups. */
  groups: ModelProviderGroup[]
  /** Provider-local failures; successful groups remain usable. */
  failures: ModelCatalogFailure[]
}

/** A client-requested mutation of one still-pending queue item. */
export type QueueAction =
  | { kind: 'edit'; content: ContentBlock[] }
  | { kind: 'remove' }
  | { kind: 'steer' }

/** Session list entry (v1 builds no index: list does readdir+stat). */
export interface SessionSummary {
  sessionId: SessionId
  /**
   * Last activity. Attached: the last non-`session/end-seed` event, since a
   * pickup is not activity. Cold: the log's mtime, or `createdAt` for a backend
   * with no per-session file (README Known Limitations covers the skew).
   */
  updatedAt: number
  /** Status of the attached agent; always false for cold (unattached) sessions. */
  running: boolean
  /**
   * Derived conversation-not-started bit: true while no turn has run (no
   * prompt was accepted yet). Standalone plugin events — command lifecycle
   * records, plan/mode, titles, goals — do not open a turn and therefore do
   * not clear it. Clients hide blank sessions from lists and reuse them for
   * New Session on the same workspace. Always false for cold sessions —
   * lazy persistence keeps a never-appended session out of the store, and a
   * listed cold session's log holds its turns.
   */
  blank: boolean
  /** fork/spawn lineage (session.header.parentSession passthrough); absent for root sessions. */
  parentSessionId?: SessionId
  /** Coarse durable origin used by navigation surfaces; never proves resumability. */
  origin?: 'subagent'
  /** Session working directory (header.cwd passthrough); absent when unrecorded. */
  cwd?: string
  /**
   * Projection baseline for this row, with zero log loads: attached sessions
   * read the registry's live watermark cut; cold sessions read the persisted
   * projection cache's stored rows — as stale as that session's last durable
   * checkpoint (`asOfSeq` says exactly how stale), never wrong, and directly
   * seedable into the client's per-session value store under its
   * higher-seq-wins rule (a list baseline can never overwrite a newer push
   * frame). Absent when no value is available (no registry, no cache row for
   * a cold session, or a fail-soft cache read miss); a listing client treats
   * absence as "no title yet", exactly like a blank session.
   */
  projections?: SessionProjectionsBlock
}

/** One session-content search result; display metadata stays owned by `session.list`. */
export interface SessionSearchItem {
  sessionId: SessionId
  /** Plain-text excerpt around the strongest matching visible message. */
  snippet: string
}

/** Session-domain unary methods (the map keys session.* of RpcMethodMap). */
export interface SessionsApi {
  /** Lists persisted sessions (updatedAt descending). v1 returns everything; cursor is a reserved seat, unimplemented. */
  list(request: RpcRequest<{ cursor?: string }>): Promise<RpcResponse<{ items: SessionSummary[] }>>

  /**
   * Searches the current user/assistant/steering message surface across
   * sessions visible to `list`. Results contain at most 20 sessions and carry
   * no continuation cursor; `hasMore` asks the client to refine the query.
   */
  search(
    request: RpcRequest<{ query: string }>,
    signal: AbortSignal,
  ): Promise<RpcResponse<{ items: SessionSearchItem[]; hasMore: boolean }>>

  /**
   * Creates a real session and its idle agent. At most one of `workspaceId` /
   * `cwd` is accepted; an omitted project uses the Host cwd. A caller may
   * preallocate `sessionId`: retries with the same id and cwd return the same
   * session, while a different cwd fails with `session-conflict`. Workspace
   * creation attaches the session after publication; an attach failure
   * returns `workspace-attach-failed` with the published session id.
   */
  create(request: RpcRequest<{ workspaceId?: WorkspaceId; cwd?: string; sessionId?: SessionId }>):
  Promise<RpcResponse<{ sessionId: SessionId }>>

  /**
   * Reads a window of history events; page boundaries align to append-origin message
   * boundaries: one page = all raw events owned by a whole number of such messages (including
   * their chunk / tool events), never cut mid-message. Model-only replacement copies consume no
   * `maxMessages`, so a compaction's `compact/summary` record stays on the page of its replacement. The tail
   * page (beforeSeq absent) additionally carries the in-flight
   * partial — chunk events already emitted for the last unfinalized message.
   * Each entry pairs the raw SessionEvent with the host-computed view (tool events whose
   * presenter produced one, evaluated against the registry at pagination time); the client
   * rebuilds the surface from the events with the shared fold.
   * The tail page — and only the tail page — additionally carries `projections`
   * when the deployment mounts the session-projection registry: every moment
   * the client needs a fresh baseline already pulls the tail page, and
   * loadOlder (the only beforeSeq path) is the only path that never needs one.
   * A deployment without the registry serves histories without the block.
   * Reading history uses an attached Session or persistence inspection and
   * never resumes or publishes an Agent.
   */
  history(request: RpcRequest<{ sessionId: SessionId; beforeSeq?: number; maxMessages?: number }>):
  Promise<RpcResponse<{ events: HistoryEntry[]; hasMore: boolean; projections?: SessionProjectionsBlock }>>

  /**
   * Reads a fresh advisory model directory for an ordinary session. Provider
   * lookups run independently; subagents reject with `agent-busy`.
   */
  models(request: RpcRequest<{ sessionId: SessionId }>): Promise<RpcResponse<SessionModels>>

  /**
   * Selects the complete model selection for this session. Exact model metadata
   * validates an optional reasoning effort, while catalog membership remains
   * advisory. Session-backed subagents reject with `agent-busy`.
   */
  selectModel(request: RpcRequest<{
    sessionId: SessionId
    provider: string
    model: string
    reasoningEffort?: string
  }>):
  Promise<RpcResponse<{ selected: ModelSelection }>>

  /**
   * Renames a session: appends a `session/title` event with the `user`
   * source, which pins the title against automatic regeneration. The
   * normalized accepted title and the title event's seq return so the caller
   * can settle its projection cell without waiting for the push frame. A
   * title that normalizes to empty fails with `title-invalid`.
   * Session-backed subagents reject with `agent-busy`.
   */
  rename(request: RpcRequest<{ sessionId: SessionId; title: string }>):
  Promise<RpcResponse<{ title: string; seq: number }>>

  /**
   * Sends a message. content is core's ContentBlock[] verbatim; mode maps 1:1 — queue→send, steer→steer.
   * A prompt whose content is exactly one text block starting with '/' is a slash command: the host
   * executes it through the command registry (mode-agnostic) and it is never sent to the model. A
   * successful command returns ok with the command slot (its success text, when the command produced
   * one — carried for future rendering; the state change is the feedback). A usage/state error is an
   * RPC error with code command-error; an unrecognized name is an RPC error with code unknown-command.
   */
  /**
   * Forks a new session from a completed-turn prefix of the source. `atSeq`
   * anchors the cut: the boundary is the first `turn/end` at or after it
   * (a message's fork button passes the message seq, so the fork includes
   * that whole turn); a boundary past the log end, or an omitted `atSeq`,
   * falls back to the source's last completed turn. An in-log anchor whose
   * turn is still open fails with `fork-unavailable` instead of clipping to
   * an earlier turn. The child inherits the source cwd, latest logged model
   * target and `parentSessionId` lineage; the seed prefix carries the source
   * title. Reading the source uses attached state or persistence inspection
   * without acquiring an Agent. Workspace attachment follows the source
   * directly, or the nearest workspace-owning ancestor when the source is a
   * subagent.
   */
  fork(request: RpcRequest<{ sessionId: SessionId; atSeq?: number }>):
  Promise<RpcResponse<{ sessionId: SessionId }>>

  /** Sends a message to an ordinary session Agent. Session-backed subagents reject with `agent-busy` and use `subagent.prompt`. */
  prompt(request: RpcRequest<{ sessionId: SessionId; mode: 'queue' | 'steer'; content: ContentBlock[] }>):
  Promise<RpcResponse<{ accepted: true; command?: { kind: 'success'; text?: string } }>>

  /**
   * Edits, removes, or strictly steers one pending queued occurrence on an ordinary session.
   * Session-backed subagents reject with `agent-busy`.
   */
  updateQueue(request: RpcRequest<{ sessionId: SessionId; itemId: MessageId; action: QueueAction }>):
  Promise<RpcResponse<{ accepted: true }>>

  /**
   * Stops an ordinary session's active turn, preserving pending inbox work
   * that resumes in FIFO order after cancellation settles. Session-backed
   * subagents reject with `agent-busy`.
   */
  cancel(request: RpcRequest<{ sessionId: SessionId }>): Promise<RpcResponse<{ accepted: true }>>

}
