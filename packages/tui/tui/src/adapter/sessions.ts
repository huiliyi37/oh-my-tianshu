/**
 * Session management surface: listing, lookup, forking, history loading, and
 * teardown flushing. The session log is the authoritative fact source — this
 * module only READS logs and the live store; it never appends events and never
 * disposes agents (a handle's teardown belongs to its holder).
 *
 * @module @huiliyi37/dsh-tui/adapter/sessions
 */

import type { Context } from '@huiliyi37/cordis'
import type { Session, SessionEvent, SessionForkSource, SessionHeader, SessionId } from '@huiliyi37/dsh-session'
import { resolvePresetId } from '../preset-surface.js'

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
  /**
   * Agent preset id in effect for the session（`agent-preset/selected` 切换值
   * fold；本 fork 的 session header 不记录创建值，故无切换记录时 undefined）。
   * undefined = 未记录（host 未装配 preset 或从未切换）。
   */
  readonly agentPreset: string | undefined
  /** true = 持久化工件损坏（version -1 占位），不可恢复且应标注原因。 */
  readonly corrupt: boolean
}

function toSummary(header: Session['header']): SessionSummary {
  const summary: SessionSummary = {
    id: header.id,
    version: header.version,
    createdAt: header.createdAt,
    cwd: header.cwd,
    parentSession: header.parentSession,
    // 本地 session header 无 agentPreset 字段（dsh-tui 的上游 fork 扩展）；
    // preset 创建值不可得，展示值只来自事件 fold（见 listSessions）。
    agentPreset: undefined,
    // 损坏占位 header 以 version -1 标记（JSONL listArtifacts 保留损坏工件）。
    corrupt: header.version < 0,
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
  const persistence = ctx.reflect.get('sessionPersistence', false) as SessionPersistenceFacet | undefined
  const headers: readonly SessionHeader[] = persistence !== undefined
    ? await persistence.list()
    : ctx.sessions.list().map(session => session.header)
  return headers
    .map((header) => {
      const summary = toSummary(header)
      // live 会话的事件日志在内存，fold 切换值（blank 窗口 /preset 切换）；
      // 持久化会话不 inspect（避免 N 次 IO），且本地 header 无创建值 → undefined。
      const live = ctx.sessions.get(header.id)
      if (live !== undefined) {
        const preset = resolvePresetId(summary.agentPreset, live.events)
        if (preset !== undefined) return { ...summary, agentPreset: preset }
      }
      return summary
    })
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
 * Load failures (unknown or corrupt persisted sessions) PROPAGATE so list and
 * picker surfaces can mark the row with the reason instead of silently showing
 * an empty conversation; live lookups never throw.
 * @param ctx - any context exposing `ctx.sessions` and optionally
 *   `ctx.sessionPersistence`.
 * @param id - the session whose log is requested.
 * @returns the immutable event log.
 * @throws when a persisted session cannot be read (corrupt/unknown/backend fault).
 */
export async function loadHistory(ctx: Context, id: SessionId): Promise<readonly SessionEvent[]> {
  const live = ctx.sessions.get(id)
  if (live !== undefined) return live.events
  const persistence = ctx.get('sessionPersistence') as SessionPersistenceFacet | undefined
  if (persistence !== undefined) {
    const inspected = await persistence.inspect(id)
    return inspected.events
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
