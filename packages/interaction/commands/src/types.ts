/**
 * Durable command event vocabulary shared with type-only consumers.
 *
 * @module @deepseek-ai/dsh-commands/types
 */

import type { CommandId } from './brand.ts'

/**
 * Producer record for one command invocation (the `command/run` event's
 * source slot). Merge-extensible sum type mirroring `MessageSourceMap`'s
 * shape; minimal today because every executor caller is a human-facing UI
 * surface dispatching a human-typed line, so the sole variant is `user`.
 */
export interface CommandSourceMap {
  user: { kind: 'user' }
}

/** The union over {@link CommandSourceMap} — who issued a command line. */
export type CommandSource = CommandSourceMap[keyof CommandSourceMap]

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * A resolved slash command entered its handler. Log-only (never model
     * surface); paired with `command/done` by `commandId`, mirroring the
     * `tool/call`↔`tool/result` pairing. The payload is structured — `name`
     * and `args` are `parseCommand`'s own split (name and verbatim rawInput,
     * separator whitespace included), so a consumer (a projection unit
     * folding its own command records, a rich command card) never re-parses
     * a line. `args` is absent when the definition sets `recordInput: false`
     * because an authoritative domain event owns the input payload.
     */
    'command/run': { commandId: CommandId; name: string; args?: string; source: CommandSource }
    /**
     * The paired command settled. `kind`/`text` carry the handler's verbatim
     * outcome (a thrown/aborted handler settles as `kind: 'error'` with the
     * rendered failure). A successful command may identify the earlier
     * authoritative domain event for a richer client-computed presentation.
     */
    'command/done': {
      commandId: CommandId
      kind: 'success' | 'error'
      text?: string
      sourceEventSeq?: number
    }
  }
}
