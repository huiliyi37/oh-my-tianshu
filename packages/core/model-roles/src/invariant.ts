/**
 * Package-owned invariant companion for `@huiliyi37/dsh-model-roles`.
 *
 * @module @huiliyi37/dsh-model-roles/invariant
 */

import type { Context } from '@huiliyi37/cordis'
import type { InvariantFailure, InvariantInstaller } from '@huiliyi37/dsh-invariants'
import { deepEqualJson } from '@huiliyi37/dsh-settings'
import { MODEL_ROLES_SETTINGS_NAMESPACE } from './index.ts'
import type { ModelRole, ModelRolesSettings } from './index.ts'

const PACKAGE_NAME = '@huiliyi37/dsh-model-roles'

/** Cordis companion plugin name. */
export const name = 'model-roles-invariant'
/** Services required before the companion can register. */
export const inject = ['invariants']

/** Every role the settings section can pin. */
const ROLES: readonly ModelRole[] = ['vision', 'secondary', 'subagent']

/**
 * Install the pin-visibility contract: when the model-roles section commits,
 * `resolve()` must already read the committed value for every role. The
 * service constructor wires its source to the live settings scope; a
 * regression that snapshots the section at attach time passes the settings
 * seam's own commit invariant yet strands every consumer on stale pins, which
 * is exactly what this check rejects. The listener stays synchronous per the
 * `settings/updated` containment contract.
 */
const install: InvariantInstaller = (ctx: Context, fail: InvariantFailure) => {
  ctx.on('settings/updated', (ns, next) => {
    if (ns !== MODEL_ROLES_SETTINGS_NAMESPACE) return
    const service = ctx.get('modelRoles')
    if (service === undefined) {
      fail(`settings/updated for "${ns}" emitted without a live modelRoles service`)
    }
    const committed = next as ModelRolesSettings
    for (const role of ROLES) {
      if (!deepEqualJson(service.resolve(role), committed[role])) {
        fail(`resolve("${role}") does not reflect the committed model-roles section`)
      }
    }
  })
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
