// Central contract re-export point: every contract import inside
// web-runtime goes through this single file.
// Types and runtime protocol helpers/bounds come from the apiproxy api/ layer
// (zero Node deps, browser-safe); AbstractApiClient is the client boundary.
// NEVER import the package root: it drags bootHost/cordis into the browser bundle.
// The ./api and ./client subpath exports are the browser-safe channels added for this.

export type {
  ApiProxy, SessionsApi, SessionSearchItem, SessionSummary, HostApi, EventsApi, MuxFrame, HostFrame,
  ApprovalResponsePayload, QuestionResponsePayload, HistoryEntry, ToolEventView,
  DirectoryEntry, DirectoryListing,
  WorkspaceApi, WorkspaceId, WorkspaceView,
  CommandsApi, CommandDescriptor, SkillsApi, SkillEntry,
  ModelCatalogFailure, ModelCatalogModel, ModelProviderGroup, ModelReasoning,
  ModelReasoningEffort, ModelSelection, QueueAction, QueuedInboxItem, SessionModels,
  GoalsApi, GoalRef,
  SettingsApi, SettingsNamespaceView, SettingsPathOpView, SettingsSecretView,
  CredentialsApi, CredentialView, ConfigurableProviderView, DiscoveredModelView, LlmApi,
  SubagentsApi, SubagentAddress, SubagentCatalog, SubagentListEntry, SubagentPromptReceipt,
} from '@huiliyi37/dsh-host-apiproxy/api'
export type { ToolCallView, ToolResultView } from '@huiliyi37/dsh-tools/presentation'
export type {
  RpcRequest, RpcResponse, RpcResult, RpcError, RpcErrorCode,
  ClientRequest, ServerResponse, ServerRequest, ClientResponse, RpcMessage, RpcReceipt,
} from '@huiliyi37/dsh-host-apiproxy/api'
// transportError moved down to the apiproxy api layer (it belongs beside
// RpcResult, its subject); re-exported here so connection consumers keep one
// contract entry point.
export {
  RpcId,
  SESSION_SEARCH_RESULT_LIMIT,
  transportError,
} from '@huiliyi37/dsh-host-apiproxy/api'
export { AbstractApiClient } from '@huiliyi37/dsh-host-apiproxy/client'
export type { IApiClient } from '@huiliyi37/dsh-host-apiproxy/client'
export type { SessionId, SessionEvent } from '@huiliyi37/dsh-session/types'
export type { MessageId } from '@huiliyi37/dsh-llm/brand'
export type { ContentBlock, StreamChunk } from '@huiliyi37/dsh-llm/types'

/** Successful value returned by the connection-generation host handshake. */
export type HostDescription = import('@huiliyi37/dsh-host-apiproxy/api').ResponseValue<'host.describe'>

import type { RpcResponse, RpcResult } from '@huiliyi37/dsh-host-apiproxy/api'

/**
 * Unwrap a unary response: RpcResponse<T> -> RpcResult<T> (business code only
 * cares about the result slot).
 * @param response - the unary response.
 * @returns its result slot.
 */
export function resultOf<T>(response: RpcResponse<T>): RpcResult<T> {
  return response.result
}
