/**
 * Branded identities owned by the SDK project domain.
 *
 * @module @huiliyi37/dsh-helper/ids
 */

import type { Branded } from '@huiliyi37/dsh-brand'

/** Stable identity of a builtin SDK feature. */
export type FeatureId = Branded<'FeatureId'>

/**
 * Construct a feature identity from its registry key.
 * @param value - lowercase kebab-case registry key.
 * @returns branded feature identity.
 */
export function featureId(value: string): FeatureId {
  if (!/^[a-z][a-z0-9-]*$/.test(value)) {
    throw new Error(`invalid feature id: ${JSON.stringify(value)}`)
  }
  return value as FeatureId
}

/** Stable identity of a resource contributed to an SDK project. */
export type ResourceKey = Branded<'ResourceKey'>

/** Construct a resource key from its owner-qualified value. */
export function resourceKey(value: string): ResourceKey {
  if (value.length === 0) throw new Error('resource key must not be empty')
  return value as ResourceKey
}
