import type { Context } from 'cordis'
import type {
  HostFrame, IApiClient, MuxFrame, RpcRequest, SessionId,
} from '@deepseek-ai/dsh-client-connection/client'
import type {
  ISessionHistory, SessionHistoryFace,
} from '../contract/session-history.ts'
import { SessionHistorySource } from './source.ts'

/** Root registry and frame router for independent inspection histories. */
export class SessionHistoryService implements ISessionHistory {
  private readonly sources = new Map<SessionId, SessionHistorySource>()

  /**
   * @param ctx - Client root context.
   * @param api - Shared wire client.
   */
  constructor(ctx: Context, private readonly api: IApiClient) {
    ctx.reflect.provide('sessionHistory', this, undefined)
  }

  /**
   * Resolve one identity-stable history source.
   * @param sessionId - Host session identity.
   * @returns Source independent from SessionManager.
   */
  source(sessionId: SessionId): SessionHistoryFace {
    let source = this.sources.get(sessionId)
    if (source === undefined) {
      source = new SessionHistorySource(sessionId, this.api)
      this.sources.set(sessionId, source)
    }
    return source
  }

  /**
   * Route history-relevant mux frames only to an existing source.
   * @param envelope - Validated mux envelope.
   */
  handleMuxEnvelope(envelope: RpcRequest<MuxFrame>): void {
    const frame = envelope.payload
    if (frame.type === 'stream/error') return
    this.sources.get(frame.sessionId)?.handleMuxFrame(frame)
  }

  /**
   * Drop a removed session's independent history source.
   * @param envelope - Validated host envelope.
   */
  handleHostEnvelope(envelope: RpcRequest<HostFrame>): void {
    const frame = envelope.payload
    if (frame.type !== 'host/session-removed') { return }
    this.sources.get(frame.sessionId)?.dispose()
    this.sources.delete(frame.sessionId)
  }

  /** Invalidate requests from the dead connection generation. */
  handleDisconnected(): void {
    for (const source of this.sources.values()) source.handleDisconnected()
  }

  /** Rebuild every previously activated source from the new generation. */
  handleConnected(): void {
    for (const source of this.sources.values()) source.resync()
  }
}
