/**
 * Session management surface: listing, lookup, forking, history loading, and
 * teardown flushing. The session log is the authoritative fact source — this
 * module only READS logs and the live store; it never appends events and never
 * disposes agents (a handle's teardown belongs to its holder).
 *
 * @module @deepseek-ai/dsh-tui/adapter/sessions
 */

import type { Context } from 'cordis'
import type { Session, SessionEvent, SessionForkSource, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'

/**
 * `ctx.sessionPersistence` 的最小读面（metadata 列表 + 事件日志），不引入
 * 完整服务类型。适配层 as 收窄是仓规允许模式（同 registry.ts CompactFacet）。
 */
interface SessionPersistenceFacet {
  /** 列出已持久化会话的 metadata（仅头部，不含事件日志）。 */
  list(): Promise<readonly SessionHeader[]>
  /** 读取一个会话的完整事件日志。 */
  inspect(id: SessionId): Promise<{ readonly events: readonly SessionEvent[] }>
}

/** One session row for the TUI session list. */
export interface SessionSummary {
  /** Session identity (shared with its agent, when live). */
  readonly id: SessionId
  /** On-disk format version from the durable header. */
  readonly version: number
  /** Non-negative safe-integer Unix epoch milliseconds of creation. */
  readonly createdAt: number
  /** Working directory the session was bound to, when recorded. */
  readonly cwd: string | undefined
  /** The session this one was forked from, when known. */
  readonly parentSession: SessionId | undefined
}

function toSummary(header: Session['header']): SessionSummary {
  const summary: SessionSummary = {
    id: header.id,
    version: header.version,
    createdAt: header.createdAt,
    cwd: header.cwd,
    parentSession: header.parentSession,
  }
  return summary
}

/**
 * List known sessions, newest first. Persisted sessions come from
 * `ctx.sessionPersistence` (metadata-only listing) when that service is
 * configured; otherwise the live in-memory store's headers are used.
 * @param ctx - any context exposing `ctx.sessions` and optionally
 *   `ctx.sessionPersistence`.
 * @returns one summary per known session, ordered by `createdAt` descending.
 */
export async function listSessions(ctx: Context): Promise<SessionSummary[]> {
  const persistence = ctx.get('sessionPersistence') as SessionPersistenceFacet | undefined
  const headers: readonly SessionHeader[] = persistence !== undefined
    ? await persistence.list()
    : ctx.sessions.list().map(session => session.header)
  return headers
    .map(toSummary)
    .sort((a: SessionSummary, b: SessionSummary) => b.createdAt - a.createdAt)
}

/**
 * Resolve the live session object for an id.
 * @param ctx - any context exposing `ctx.sessions`.
 * @param id - the session id to look up.
 * @returns the live session, or `undefined` when not in the live store.
 */
export function getSession(ctx: Context, id: SessionId): Session | undefined {
  return ctx.sessions.get(id)
}

/**
 * Fork a live session at an optional boundary, creating a live child session.
 * @param ctx - any context exposing `ctx.sessions`.
 * @param source - the fork source: a live session or its store id.
 * @param boundary - optional contiguous boundary seq; defaults to a safe point.
 * @param childSessionId - optional child identity; the store generates one when absent.
 * @returns the created live child session.
 */
export function forkSession(
  ctx: Context,
  source: SessionForkSource,
  boundary?: number,
  childSessionId?: SessionId,
): Session {
  if (boundary === undefined && childSessionId === undefined) return ctx.sessions.fork(source)
  if (childSessionId === undefined) return ctx.sessions.fork(source, boundary)
  return ctx.sessions.fork(source, boundary, childSessionId)
}

/**
 * Load a session's event log for display. A live session's in-process log is
 * authoritative (it includes events not yet flushed); a persisted-only session
 * is loaded through `ctx.sessionPersistence.inspect` when available.
 * @param ctx - any context exposing `ctx.sessions` and optionally
 *   `ctx.sessionPersistence`.
 * @param id - the session whose log is requested.
 * @returns the immutable event log, or an empty array when the session is unknown.
 */
export async function loadHistory(ctx: Context, id: SessionId): Promise<readonly SessionEvent[]> {
  const live = ctx.sessions.get(id)
  if (live !== undefined) return live.events
  const persistence = ctx.get('sessionPersistence') as SessionPersistenceFacet | undefined
  if (persistence !== undefined) {
    try {
      const inspected = await persistence.inspect(id)
      return inspected.events
    } catch {
      // Unknown/corrupt persisted session: report an empty history; the list
      // surface still shows the row so the TUI can surface the failure itself.
      return []
    }
  }
  return []
}

/**
 * Flush every live session to durable storage — the teardown checkpoint.
 * Each flush dispatches the awaited `session/flush` durability barrier through
 * `ctx.sessions.flush`; persistence plugins drain their buffers there.
 * @param ctx - any context exposing `ctx.sessions`.
 * @returns after every live session's flush has settled; the first listener
 *   failure propagates.
 */
export async function flushAll(ctx: Context): Promise<void> {
  for (const session of ctx.sessions.list()) {
    await ctx.sessions.flush(session)
  }
}
