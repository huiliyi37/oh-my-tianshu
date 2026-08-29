/** Durable per-session state for the user-controlled model-selection opt-in. */

import type { Session } from '@huiliyi37/dsh-session'
import { assertAllowedModelRoutes, type AllowedModelRoute } from './model-selection.ts'

declare module '@huiliyi37/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Records that this session's delegation tool exposes child provider,
     * model, and reasoning-effort selection. Appended before the first model
     * request; absence means the fixed-route definition. Log-only: it carries
     * no `surfaceOp` and never enters model history.
     */
    'subagent/model-selection-policy': {
      /** Exact routes this Session may select explicitly for a child. */
      allowedModels: AllowedModelRoute[]
    }
  }
}

/**
 * Read the exact route list captured for a model-selectable definition.
 * @param session - session whose durable decision is read.
 * @returns a detached route list, or undefined for the fixed-route definition.
 */
export function subagentModelSelectionPolicy(session: Session): AllowedModelRoute[] | undefined {
  const event = session.events.find(candidate => candidate.type === 'subagent/model-selection-policy')
  if (event?.type !== 'subagent/model-selection-policy') return undefined
  const { allowedModels } = event.data
  assertAllowedModelRoutes(allowedModels)
  const routes = allowedModels.map(route => ({ ...route }))
  if (routes.length === 0) throw new Error('subagent/model-selection-policy requires at least one route')
  return routes
}

/**
 * Append the route policy once, before its definition can reach a model request.
 * @param session - session receiving the model-selectable definition.
 * @param allowedModels - exact routes the definition may select explicitly.
 */
export function recordSubagentModelSelection(session: Session, allowedModels: readonly AllowedModelRoute[]): void {
  if (subagentModelSelectionPolicy(session) !== undefined) return
  appendSubagentModelSelection(session, allowedModels)
}

/**
 * Append the route policy directly, without the idempotence scan
 * {@link recordSubagentModelSelection} performs. The caller must have just
 * confirmed this session records no policy event (its own durable read IS the
 * scan); appending twice would surface only as a later durable-read failure,
 * not as a rejection here.
 * @param session - session receiving the model-selectable definition.
 * @param allowedModels - exact routes the definition may select explicitly.
 */
export function appendSubagentModelSelection(session: Session, allowedModels: readonly AllowedModelRoute[]): void {
  session.append('subagent/model-selection-policy', {
    allowedModels: allowedModels.map(route => ({ ...route })),
  })
}
