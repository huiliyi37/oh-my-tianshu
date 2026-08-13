/**
 * Frozen service contract of the slash pipeline. Types only. The
 * SlashService implementation publishes this face as `ctx.slash`; sources
 * see registerSource alone, the conversation wiring layer resolves its
 * per-session controller through sessionOf.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { SlashSource } from '../types.ts'
import type { SlashController } from './controller.ts'

/** The `ctx.slash` service face. */
export interface SlashServiceContract {
  /** Register one trigger source; effect disposer. Duplicate (trigger, name) throws. */
  registerSource(src: SlashSource): () => void
  /** Resolve the per-session controller for one session scope (lazy; dies with the scope). */
  sessionOf(actx: ClientContext): SlashController
}
