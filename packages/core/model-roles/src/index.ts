/**
 * Per-role model pins resolved from the user settings document.
 *
 * Three model-consuming roles — vision, secondary, subagent — may each carry
 * a provider/model pin stored in the `model-roles` settings section. This
 * package owns only the pins; every consumer resolves its role at the point
 * of use and owns the fallback chain it applies when no pin is set.
 *
 * @module @huiliyi37/dsh-model-roles
 */

import { Context, Service } from '@huiliyi37/cordis'
import z from '@huiliyi37/schemastery'
import { installSettingsSection, settingsNamespace } from '@huiliyi37/dsh-settings'

declare module '@huiliyi37/cordis' {
  interface Context {
    /** Model pins for the vision, secondary, and subagent roles. */
    modelRoles: ModelRolesService
  }
}

/** A model-consuming role that may carry its own routing pin. */
export type ModelRole = 'vision' | 'secondary' | 'subagent'

/** One role's pinned provider/model route. */
export interface ModelRoleSelection {
  /** Registered provider route. */
  provider: string
  /** Provider-owned model id. */
  model: string
}

/** Stored model-roles settings section; every key is one role's pin. */
export interface ModelRolesSettings {
  /** Pin for the vision role: image descriptions produced by the vision bridge. */
  vision?: ModelRoleSelection
  /** Pin for the secondary role: cheap background work such as session titles and compaction summaries. */
  secondary?: ModelRoleSelection
  /** Pin for the subagent role: the default route of delegated subagent sessions. */
  subagent?: ModelRoleSelection
}

/** Settings namespace carrying the per-role model pins. */
export const MODEL_ROLES_SETTINGS_NAMESPACE = settingsNamespace('model-roles')

/** Schema of one role pin: both route fields are required once the role is present. */
const ROLE_SELECTION_SCHEMA: z<ModelRoleSelection> = z.object({
  provider: z.string().required(),
  model: z.string().required(),
})

/**
 * Schema of the model-roles settings section: every role optional, a present
 * role pins both fields. `union(object, never)` is the optional-object idiom:
 * an absent role falls back to undefined, while a given one must be complete.
 */
export const MODEL_ROLES_SETTINGS_SCHEMA: z<ModelRolesSettings> = z.object({
  vision: z.union([ROLE_SELECTION_SCHEMA, z.never()]),
  secondary: z.union([ROLE_SELECTION_SCHEMA, z.never()]),
  subagent: z.union([ROLE_SELECTION_SCHEMA, z.never()]),
})

/** Composition entry: empty by contract, since every pin lives in the settings user layer. */
export type Config = Record<string, never>

/** Reject stale or misspelled keys before they silently pin nothing. */
function validateConfigKeys(config: Config): void {
  for (const key of Object.keys(config)) {
    throw new Error(`ModelRoles Config: unknown key "${key}" (role pins belong to the settings user layer)`)
  }
}

/**
 * Owns the per-role model pins independently of any consumer. The composition
 * entry is empty and stays usable without a settings provider — every role
 * resolves to undefined and writes are no-ops; when a provider is mounted, its
 * user layer is read live at each {@link ModelRolesService.resolve} call, so a
 * committed settings change is visible at the next read with no restart. The
 * service deliberately emits no change event of its own: consumers resolve at
 * their point of use, and observers use the existing `settings/updated` event.
 */
export class ModelRolesService extends Service {
  // Schemastery preserves untrusted loader keys on an empty object schema;
  // the public type excludes settings while validateConfigKeys rejects them.
  static Config: z<Config> = z.object({}) as unknown as z<Config>

  private source: () => ModelRolesSettings

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'modelRoles')
    validateConfigKeys(config)
    const entry: ModelRolesSettings = {}
    this.source = () => { return entry }
    installSettingsSection(ctx, MODEL_ROLES_SETTINGS_NAMESPACE, MODEL_ROLES_SETTINGS_SCHEMA, entry, {
      setSource: (current) => { this.source = current },
      // Every consumer reads through resolve(), so no registration-level fact
      // needs rebuilding when the settings document changes.
      onChange: () => {},
    })
  }

  /**
   * Read one role's current pin.
   * @param role - the role to resolve.
   * @returns the pinned selection, or undefined when the role follows the consumer's default route.
   */
  resolve(role: ModelRole): ModelRoleSelection | undefined {
    return this.source()[role]
  }

  /**
   * Pin one role to a provider/model route, persisting through the settings
   * user layer. A deployment without a settings provider cannot retain pins:
   * the write is a no-op and the role keeps following the default route.
   * @param role - the role to pin.
   * @param selection - the provider/model route the role resolves to.
   * @returns fulfillment after the optional settings write settles.
   */
  async pin(role: ModelRole, selection: ModelRoleSelection): Promise<void> {
    await this.ctx.get('settings')?.mutate(MODEL_ROLES_SETTINGS_NAMESPACE, [
      { op: 'set', path: [role], value: { provider: selection.provider, model: selection.model } },
    ])
  }

  /**
   * Remove one role's pin so it follows the consumer's default route again.
   * A no-op without a settings provider, exactly like {@link pin}.
   * @param role - the role to unpin.
   * @returns fulfillment after the optional settings write settles.
   */
  async unpin(role: ModelRole): Promise<void> {
    await this.ctx.get('settings')?.mutate(MODEL_ROLES_SETTINGS_NAMESPACE, [
      { op: 'unset', path: [role] },
    ])
  }
}

export default ModelRolesService
