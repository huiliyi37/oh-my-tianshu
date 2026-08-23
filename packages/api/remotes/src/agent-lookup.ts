/** Host BFF policy for resolving Remote Agent and Session identities. */

import type { Context } from '@huiliyi37/cordis'
import type { Agent, AgentOptions, AgentSetup } from '@huiliyi37/dsh-agent'
import type { Session, SessionEvent, SessionHeader, SessionId } from '@huiliyi37/dsh-session'
import type {} from '@huiliyi37/dsh-session-persistence'
import { TypeRTLookupFailure } from '@huiliyi37/dsh-type-meta'
import type {} from '@huiliyi37/dsh-typert-registry'

/** Caller-facing failures preserved by the Gateway's RPC adapter. */
export type ApiRemoteLookupError =
  | { readonly code: 'agent-busy'; readonly message: string; readonly details: { readonly reason: string } }
  | { readonly code: 'session-not-found'; readonly message: string; readonly details: { readonly sessionId: SessionId } }
  | { readonly code: 'internal'; readonly message: string; readonly details: Record<never, never> }

/** Result of resolving one session identity to its live Agent. */
export type ApiRemoteAgentResult =
  | { readonly agent: Agent }
  | { readonly error: ApiRemoteLookupError }

/** Resume configuration supplied by the owning Host composition. */
export interface ApiRemoteAgentOptions {
  /** Read the per-Agent defaults when a cold identity must resume. */
  readonly agentOptions?: () => AgentOptions
  /** Host-specific Agent-scope composition completed before publication. */
  readonly setup?: AgentSetup
}

/** Cold identity absent from the durable session store. */
export class ApiRemoteSessionNotFound extends Error {}

/** Session identity whose lifecycle belongs to subagent routing. */
export class ApiRemoteSubagentSessionOwnership extends Error {
  /**
   * Construct the ownership fence.
   * @param sessionId - identity reserved to subagent routing.
   */
  constructor(readonly sessionId: SessionId) {
    super(`session "${sessionId}" is a subagent session; use subagent delivery`)
  }
}

/**
 * Test whether generic Host routing must leave an identity to subagent routing.
 * @param ctx - Host Context carrying the live Agent registry.
 * @param session - attached or live Session metadata.
 * @param agent - live Agent when one is registered.
 * @returns whether generic Remote and legacy API calls must reject the identity.
 */
export function hasApiRemoteSubagentOwner(
  ctx: Context,
  session: Pick<Session, 'header'>,
  agent: Agent | undefined,
): boolean {
  if (session.header.origin === 'subagent') return true
  const parentId = session.header.parentSession
  if (parentId === undefined || agent === undefined) return false
  const parent = ctx.agents.get(parentId)
  return parent !== undefined && ctx.agents.isOwnedBy(agent.id, parent)
}

/**
 * Build the stable caller-facing ownership rejection.
 * @param sessionId - identity reserved to subagent routing.
 * @returns the existing `agent-busy` RPC shape.
 */
export function apiRemoteSubagentOwnershipError(sessionId: SessionId): ApiRemoteLookupError {
  return {
    code: 'agent-busy',
    message: `session "${sessionId}" is owned by subagent routing`,
    details: { reason: 'use subagent delivery for this child session' },
  }
}

/**
 * Inspect one cold served session without repairing, resuming, or publishing it.
 * @param ctx - Host Context carrying the optional persistence provider.
 * @param sessionId - durable identity to inspect.
 * @returns detached metadata and events for a servable session.
 * @throws {@link ApiRemoteSessionNotFound} when the identity has no project-backed session.
 */
export async function inspectApiRemoteSession(
  ctx: Context,
  sessionId: SessionId,
): Promise<{ meta: SessionHeader; events: SessionEvent[] }> {
  const persistence = ctx.get('sessionPersistence')
  if (persistence === undefined) {
    throw new Error('session persistence is not configured (load a dsh-session-persistence backend)')
  }
  const meta = (await persistence.list()).find(candidate => candidate.header.id === sessionId)
  if (meta === undefined || meta.header.cwd === undefined) {
    throw new ApiRemoteSessionNotFound(`session "${sessionId}" not found`)
  }
  const inspected = await persistence.inspect(sessionId)
  if (inspected.meta.cwd === undefined) {
    throw new ApiRemoteSessionNotFound(`session "${sessionId}" not found`)
  }
  return { meta: inspected.meta, events: [...inspected.events] }
}

/**
 * Create the Host's shared Agent resolver and configure Agent/Session TypeRT lookups.
 * Live Agents are reused, ordinary cold sessions resume once per identity, and
 * subagent-owned identities retain the legacy `agent-busy` fence.
 * @param ctx - owning Host Context.
 * @param options - defaults and Agent-scope setup used only for cold resume.
 * @returns resolver shared by legacy API Proxy methods and TypeRT lookups.
 */
export function createApiRemoteAgentResolver(
  ctx: Context,
  options: ApiRemoteAgentOptions,
): (sessionId: SessionId) => Promise<ApiRemoteAgentResult> {
  const resumes = new Map<SessionId, Promise<Agent>>()

  const fencedLiveAgent = (sessionId: SessionId): ApiRemoteAgentResult | undefined => {
    const live = ctx.agents.get(sessionId)
    if (live === undefined) return undefined
    if (hasApiRemoteSubagentOwner(ctx, live.session, live)) {
      return { error: apiRemoteSubagentOwnershipError(sessionId) }
    }
    return { agent: live }
  }

  const agentFor = async (sessionId: SessionId): Promise<ApiRemoteAgentResult> => {
    const fenced = fencedLiveAgent(sessionId)
    if (fenced !== undefined) return fenced
    const attached = ctx.sessions.get(sessionId)
    if (attached !== undefined && hasApiRemoteSubagentOwner(ctx, attached, undefined)) {
      return { error: apiRemoteSubagentOwnershipError(sessionId) }
    }
    let resume = resumes.get(sessionId)
    if (resume === undefined) {
      resume = (async () => {
        try {
          const inspected = await inspectApiRemoteSession(ctx, sessionId)
          if (hasApiRemoteSubagentOwner(ctx, { header: inspected.meta }, undefined)) {
            throw new ApiRemoteSubagentSessionOwnership(sessionId)
          }
          const publishedSession = ctx.sessions.get(sessionId)
          const publishedAgent = ctx.agents.get(sessionId)
          if (publishedSession !== undefined
            && hasApiRemoteSubagentOwner(ctx, publishedSession, publishedAgent)) {
            throw new ApiRemoteSubagentSessionOwnership(sessionId)
          }
          const handle = await ctx.agents.resume({
            resumeSessionId: sessionId,
            ...options.agentOptions !== undefined ? { agentOptions: options.agentOptions() } : {},
            ...options.setup === undefined ? {} : { setup: options.setup },
          })
          return handle.agent
        } finally {
          resumes.delete(sessionId)
        }
      })()
      resumes.set(sessionId, resume)
    }
    try {
      return { agent: await resume }
    } catch (error: unknown) {
      if (error instanceof ApiRemoteSessionNotFound) {
        return { error: { code: 'session-not-found', message: error.message, details: { sessionId } } }
      }
      if (error instanceof ApiRemoteSubagentSessionOwnership) {
        return { error: apiRemoteSubagentOwnershipError(error.sessionId) }
      }
      const fenced = fencedLiveAgent(sessionId)
      if (fenced !== undefined) return fenced
      const attached = ctx.sessions.get(sessionId)
      if (attached !== undefined && hasApiRemoteSubagentOwner(ctx, attached, undefined)) {
        return { error: apiRemoteSubagentOwnershipError(sessionId) }
      }
      return {
        error: {
          code: 'internal',
          message: `resume failed for session "${sessionId}": ${String(error)}`,
          details: {},
        },
      }
    }
  }

  ctx.inject(['typert'], (typeCtx) => {
    const resolveAgent = async (sessionId: SessionId): Promise<Agent> => {
      const found = await agentFor(sessionId)
      if ('error' in found) throw new TypeRTLookupFailure(found.error)
      return found.agent
    }
    typeCtx.typert.lookups.configure('agent', resolveAgent)
    typeCtx.typert.lookups.configure('session', async sessionId => (await resolveAgent(sessionId)).session)
    typeCtx.typert.contexts.configureHost('agent', async sessionId => (await resolveAgent(sessionId)).ctx)
  })

  return agentFor
}
