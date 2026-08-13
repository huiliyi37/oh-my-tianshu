/** Host BFF entry and Loader shell for the Remote contribution assembly. */

export {
  ApiRemoteSessionNotFound,
  ApiRemoteSubagentSessionOwnership,
  apiRemoteSubagentOwnershipError,
  createApiRemoteAgentResolver,
  hasApiRemoteSubagentOwner,
  inspectApiRemoteSession,
} from './agent-lookup.ts'
export type {
  ApiRemoteAgentOptions,
  ApiRemoteAgentResult,
  ApiRemoteLookupError,
} from './agent-lookup.ts'

/** Host plugin body; the selected contributions mount only in Client environments. */
export function apply(): void {}
