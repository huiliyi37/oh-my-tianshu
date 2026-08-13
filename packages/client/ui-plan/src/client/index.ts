/**
 * Plan control plugin, browser half: occupies the composer's named
 * `conversation.input.plan` seat with an active-state status chip. Plan mode
 * is entered through the command source; while the projection's effective
 * target is plan mode the chip renders and executes /plan off through
 * `command.execute`, otherwise the seat stays empty. Reads ride the generic
 * projection pair through the standard-kit `useProjection`; zero client-side
 * plan state.
 */
import type { ConnectionHandle } from '@huiliyi37/dsh-client-connection/client'
import type { ClientContext, SessionId } from '@huiliyi37/dsh-client-runtime/client'
// Type-only: pulls the ui-conversation SlotMap merge (the input.plan seat).
import type {} from '@huiliyi37/dsh-client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@huiliyi37/dsh-client-locale/client'
// Type-only: pulls the `plan` SessionProjectionMap merge for useProjection.
import type {} from '@huiliyi37/dsh-plan-mode/client'
import { PlanChip } from './PlanModeControl.tsx'
import { en, zh, type PlanKey } from './locales.ts'

export type { PlanKey } from './locales.ts'

declare module '@huiliyi37/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The composer plan chip's copy. */
    plan: PlanKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'plan'

/** Injected business face of the composer plan seat. */
export interface PlanChipInjected {
  /**
   * Leave plan mode by executing /plan off.
   * @returns null on admitted execution; a user-visible failure line otherwise.
   */
  exitPlanMode: () => Promise<string | null>
}

/** Required services: the seat's slot registry, transport, and locale registry. */
export const inject = ['slots', 'connection', 'locale']

/**
 * Client plugin body: register the plan chip over the command channel.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => { return ctx.locale.register(NS, { zh, en }) }, 'ui-plan: dictionaries')

  ctx.slots.inject('conversation.input.plan', () => ctx.slots.register({
    name: 'conversation.input.plan',
    locale: NS,
    inject: (sessionId: SessionId): PlanChipInjected => ({
      // Failure strings stay English (error-surface policy: not localized).
      exitPlanMode: async () => {
        const connection = ctx.get('connection') as ConnectionHandle
        const { result } = await connection.api.commands.execute({ sessionId, line: '/plan off' })
        if (!result.ok) return `${result.error.message} (${result.error.code})`
        if (!result.value.matched) return 'unknown command: /plan off'
        return null
      },
    }),
  }, PlanChip))
}
