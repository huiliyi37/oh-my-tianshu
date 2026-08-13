/**
 * ModelService (`ctx.models`): the root owner of per-session
 * {@link ModelDirectory} instances. Both selection entries (the /model popup
 * and the composer model seat) resolve their session's directory through
 * this service, which is what makes the dual entry one shared state.
 *
 * Per-session storage follows the client service pattern (SlashService /
 * CommandService): a lazy service-internal map whose entry is deleted by the
 * owning scope's disposer. The host `dsh-scope` ScopedLayers registry does
 * not transplant here: it derives scope from the host carrier mechanism
 * (object-keyed), while client scopes tag contexts with branded SessionId
 * strings, and it models global+shadow named registries — this is a
 * per-session singleton with no global layer to merge.
 */
import { Service } from 'cordis'
import type { Context } from 'cordis'
import type { ConnectionHandle, SessionId } from '@deepseek-ai/dsh-client-connection/client'
import type { SessionsService } from '@deepseek-ai/dsh-client-runtime/client'
import { ModelDirectory } from './directory.ts'

declare module 'cordis' {
  interface Context {
    models: ModelService
  }
}

/** Live mutable state in one holder (service methods run behind the caller-ctx tracker). */
interface LiveState {
  /** Per-session directories; entries are deleted by their scope disposer. */
  readonly directories: Map<SessionId, ModelDirectory>
}

/** The `ctx.models` session model-selection service. */
export class ModelService extends Service {
  static inject = ['connection', 'sessions']

  private readonly live: LiveState = { directories: new Map() }

  /** Localized composer-block copy; this plugin owns the string it raises. */
  private readonly blockReason: () => string

  /**
   * @param ctx - owning root context (the service registers itself as `models`).
   * @param config - the bound translator for this plugin's own dictionary.
   */
  constructor(ctx: Context, config: { blockReason: () => string }) {
    super(ctx, 'models')
    this.blockReason = config.blockReason
    ctx.on('connection/reset', () => {
      for (const directory of this.live.directories.values()) directory.resetConnected()
    })
    // Provider topology changed on the host (a settings-born route appeared
    // or dropped): refresh every open directory in the background so pickers
    // show the new catalog without a reopen. Failures stay on each store.
    ctx.on('models/changed', () => {
      for (const directory of this.live.directories.values()) {
        directory.load().catch(() => undefined)
      }
    })
  }

  /**
   * Resolve the per-session shared directory (lazy; the scope disposer
   * removes and disposes it). Unknown sessions fail loud.
   * @param sessionId - the owning session.
   * @returns the resident directory both entries share.
   */
  directoryFor(sessionId: SessionId): ModelDirectory {
    const { live } = this
    const existing = live.directories.get(sessionId)
    if (existing !== undefined) return existing
    const sessions = this.ctx.get('sessions') as SessionsService
    const actx = sessions.scope(sessionId)
    if (actx === undefined) throw new Error(`ui-model: session "${String(sessionId)}" resolved no scope`)
    const connection = this.ctx.get('connection') as ConnectionHandle
    const directory = new ModelDirectory(
      connection.api.sessions,
      sessionId,
      () => sessions.subagentAddress(sessionId) === undefined,
    )
    live.directories.set(sessionId, directory)
    // The composer cannot read this plugin (the dependency runs one way), so
    // the block is pushed: the Host says whether an adapter serves the
    // session's route, and only a definite `false` makes the input inert.
    // `null` — before the first load, or after one failed — must not, or a
    // slow or unreachable Host would lock a working composer.
    const conversation = this.ctx.get('conversation')
    if (conversation !== undefined) {
      const publish = (): void => {
        conversation.blocks.set(sessionId, directory.store.getSnapshot().routable === false
          ? { reason: this.blockReason() }
          : undefined)
      }
      publish()
      actx.effect(() => {
        const stop = directory.store.subscribe(publish)
        return () => {
          stop()
          conversation.blocks.set(sessionId, undefined)
        }
      }, 'ui-model: composer block')
    }
    actx.effect(() => () => {
      directory.dispose()
      live.directories.delete(sessionId)
    }, 'ui-model: session directory')
    return directory
  }
}
