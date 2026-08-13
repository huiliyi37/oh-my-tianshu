/**
 * commands domain contract: the web catalog/dispatch face of the host command
 * registry (`ctx.commands`). Both methods address an ordinary session's Agent
 * via `sessionId`, resuming it when cold. Session-backed subagents reject with
 * `agent-busy` and retain their dedicated continuation owner.
 */

import type { CommandId } from '@deepseek-ai/dsh-commands/brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RpcRequest, RpcResponse } from './rpc.ts'

/**
 * Handler-free command view served to clients. Wire mirror of the host
 * registry descriptor (which stays host-side with its cordis dependencies);
 * no source field — the host descriptor has none.
 */
export interface CommandDescriptor {
  /** Lowercase command name without the leading slash. */
  readonly name: string
  /** Human-readable summary used in discovery UI. */
  readonly description: string
  /** Optional free-form input hint advertised to capable clients. */
  readonly input?: { readonly hint: string }
}

/** Command-domain unary methods (the map keys command.* of RpcMethodMap). */
export interface CommandsApi {
  /**
   * Lists the addressed agent's effective command catalog (name-sorted,
   * globals plus its scoped shadows). Session-backed subagents reject with
   * `agent-busy`.
   */
  list(request: RpcRequest<{ sessionId: SessionId }>): Promise<RpcResponse<{ commands: readonly CommandDescriptor[] }>>

  /**
   * Parses and executes one slash-command line against the addressed agent
   * without sending it to the model — pure admission semantics. matched=false
   * when syntax or name does not resolve (the client falls back to its
   * default sink). The handler's outcome does NOT ride the response: the host
   * executor durably logs the lifecycle (`command/run`/`command/done`), which
   * broadcasts on the mux stream and renders as a persistent flow node.
   * `commandId` is present exactly when matched — the minted lifecycle
   * pairing id, letting the issuing client correlate this acknowledgment
   * with that flow node. The signal rides beside the request, never on the
   * wire: the fetch carrier's request signal cancels the running handler.
   * Session-backed subagents reject with `agent-busy` before dispatch.
   */
  execute(request: RpcRequest<{ sessionId: SessionId; line: string }>, signal: AbortSignal):
  Promise<RpcResponse<{ matched: boolean; commandId?: CommandId }>>
}
