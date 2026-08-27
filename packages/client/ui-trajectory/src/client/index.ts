/**
 * Browser trajectory plugin contributing one entry to the conversation view
 * slot without defining a service.
 */
import type { ClientContext } from '@huiliyi37/dsh-client-runtime/client'
import type { ConnectionHandle } from '@huiliyi37/dsh-client-connection/client'
import type { SessionId } from '@huiliyi37/dsh-client-runtime/client'
// Type-only: the 'conversation.view' SlotMap row (declared by the slot's
// owning package) must be in the program for the register calls to type.
import type {} from '@huiliyi37/dsh-client-ui-conversation/client'
import { createTrajectoryDurationStore } from './duration-store.ts'
import { TrajectoryView, type TrajectoryViewInjected } from './TrajectoryView.tsx'

/** Required services: the conversation view slot and independent history source. */
export const inject = ['connection', 'slots', 'sessionHistory']

/**
 * Client plugin body: register the trajectory view tab. The registration
 * rides the slot service's effect wrapper, so plugin unload removes the tab.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const duration = createTrajectoryDurationStore()
  // The wire face (same ctx.get pattern the runtime entry uses): rewind rides
  // the host session.rewind unary.
  const connection = ctx.get('connection') as ConnectionHandle
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'trajectory',
    order: 10,
    label: 'Trajectory',
    inject: (sessionId: SessionId): TrajectoryViewInjected => {
      const history = ctx.sessionHistory.source(sessionId)
      return {
        hooks: { history, duration },
        loadHistoryTail: signal => history.loadTail(signal),
        loadOlderHistory: signal => history.loadOlder(signal),
        setActualDuration: (value) => { duration.set(value) },
        rewind: async (atSeq, mode) => {
          const { result } = await connection.api.sessions.rewind({ sessionId, atSeq, mode })
          if (!result.ok) {
            throw new Error(`session.rewind failed: ${result.error.code}: ${result.error.message}`)
          }
          return result.value
        },
      }
    },
  }, TrajectoryView))
}
