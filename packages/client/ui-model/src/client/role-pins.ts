/**
 * Role-pins settings controller (P2④ final tail): the Web mirror of the TUI's
 * `/model vision|secondary|subagent` picker, bound to the host's `model-roles`
 * settings namespace instead of a command surface. Reads the namespace view
 * plus the global model catalog (`llm.models` — session-free, unlike the
 * per-session directory), and persists one role's pin or clears it back to
 * follow-default through `settings.mutate`.
 */

import type {
  IApiClient, ModelCatalogFailure, ModelProviderGroup, SettingsNamespaceView,
} from '@huiliyi37/dsh-client-connection/client'
import type { SnapshotStore } from '@huiliyi37/dsh-client-runtime/client'
import { createSnapshotStore } from '@huiliyi37/dsh-client-runtime/client'
import type { ModelRole } from '@huiliyi37/dsh-model-roles'

/** The settings namespace the host's model-roles plugin pins live in. */
const MODEL_ROLES_NS = 'model-roles'

/** The three pinned roles (the host's closed ModelRole union, in display order). */
export const MODEL_ROLES: readonly ModelRole[] = ['vision', 'secondary', 'subagent']

/** One pinned route (provider/model pair). */
export interface RolePin {
  provider: string
  model: string
}

/** Role-pins row snapshot. */
export interface RolePinsState {
  status: 'idle' | 'loading' | 'ready' | 'saving' | 'unavailable' | 'error'
  error: string | null
  writable: boolean
  revision: number
  pins: Partial<Record<ModelRole, RolePin>>
  catalog: { groups: ModelProviderGroup[]; failures: ModelCatalogFailure[] }
}

const IDLE: RolePinsState = {
  status: 'idle', error: null, writable: false, revision: 0, pins: {},
  catalog: { groups: [], failures: [] },
}

/** Extract one pin from the namespace's resolved value (unknown wire data; absent = follow-default). */
function pinOf(value: unknown): RolePin | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Record<string, unknown>
  return typeof candidate.provider === 'string' && typeof candidate.model === 'string'
    ? { provider: candidate.provider, model: candidate.model }
    : undefined
}

/** Fold the resolved value's three role pins. */
function pinsOf(value: unknown): Partial<Record<ModelRole, RolePin>> {
  const raw = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
  const pins: Partial<Record<ModelRole, RolePin>> = {}
  for (const role of MODEL_ROLES) {
    const pin = pinOf(raw[role])
    if (pin !== undefined) pins[role] = pin
  }
  return pins
}

/** Role-pins controller: settings reads/writes over the global catalog (pure state, api-bound). */
export class RolePinsController {
  /** Row snapshot consumed through a bound selector hook. */
  readonly store: SnapshotStore<RolePinsState> = createSnapshotStore(IDLE)

  private view: SettingsNamespaceView | undefined
  private generation = 0

  constructor(private readonly api: Pick<IApiClient, 'settings' | 'llm'>) {}

  /**
   * Load the namespace view and the global catalog in parallel; a missing
   * namespace marks the row unavailable, a catalog failure degrades to an
   * empty picker without failing the pins read.
   */
  async load(): Promise<void> {
    const generation = ++this.generation
    this.store.update((state) => { state.status = 'loading'; state.error = null })
    try {
      const [settingsResponse, catalogResponse] = await Promise.all([
        this.api.settings.describe({}),
        this.api.llm.models({}),
      ])
      if (generation !== this.generation) return
      if (!settingsResponse.result.ok) throw new Error(settingsResponse.result.error.message)
      const view = settingsResponse.result.value.namespaces.find(entry => entry.ns === MODEL_ROLES_NS)
      if (view === undefined) {
        this.view = undefined
        this.store.update((state) => { state.status = 'unavailable'; state.writable = false; state.pins = {} })
        return
      }
      this.view = view
      const writable = settingsResponse.result.value.writable
      const catalog = catalogResponse.result.ok
        ? catalogResponse.result.value
        : { groups: [], failures: [] }
      this.store.update((state) => {
        state.status = 'ready'
        state.error = null
        state.writable = writable
        state.revision = view.revision
        state.pins = pinsOf(view.value)
        state.catalog = catalog
      })
    } catch (error) {
      if (generation !== this.generation) return
      this.fail(error)
    }
  }

  /**
   * Pin one role to a route, or clear it back to follow-default (unset).
   * @param role - the pinned role.
   * @param selection - the route, or undefined to clear.
   */
  async selectRole(role: ModelRole, selection: RolePin | undefined): Promise<void> {
    const view = this.view
    const state = this.store.getSnapshot()
    if (view === undefined || !state.writable || state.status !== 'ready') return
    const generation = ++this.generation
    this.store.update((draft) => { draft.status = 'saving'; draft.error = null })
    try {
      const response = await this.api.settings.mutate({
        ns: MODEL_ROLES_NS,
        ops: selection === undefined
          ? [{ op: 'unset', path: [role] }]
          : [{ op: 'set', path: [role], value: selection }],
        expectedRevision: view.revision,
      })
      if (generation !== this.generation) return
      if (!response.result.ok) throw new Error(response.result.error.message)
      this.accept(response.result.value)
    } catch (error) {
      if (generation !== this.generation) return
      this.fail(error)
    }
  }

  /** Stop in-flight responses from publishing after plugin disposal. */
  dispose(): void {
    this.generation += 1
    this.view = undefined
  }

  private accept(value: SettingsNamespaceView): void {
    this.view = value
    this.store.update((state) => {
      state.status = 'ready'
      state.error = null
      state.revision = value.revision
      state.pins = pinsOf(value.value)
    })
  }

  private fail(error: unknown): void {
    this.store.update((state) => {
      state.status = 'error'
      state.error = error instanceof Error ? error.message : String(error)
    })
  }
}
