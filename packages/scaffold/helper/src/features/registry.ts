/**
 * Builtin feature registry and definition-time conflict checks.
 *
 * @module @deepseek-ai/dsh-helper/features/registry
 */

import type { FeatureId, ResourceKey } from '../ids.ts'
import type { ProjectProfile } from '../project/types.ts'
import type { Feature, FeatureProjectView } from './feature.ts'
import type { CordisConfigEntryResource } from './resources.ts'

/** Compile-time builtin feature collection. */
export class FeatureRegistry {
  private readonly features = new Map<FeatureId, Feature>()

  /** Register and validate a complete builtin set. */
  constructor(features: readonly Feature[], validationProfile: ProjectProfile) {
    const owners = new Map<ResourceKey, FeatureId>()
    for (const feature of features) {
      if (this.features.has(feature.id)) throw new Error(`duplicate feature id: ${feature.id}`)
      this.features.set(feature.id, feature)
      const validationInterface = feature.supportedInterfaces[0]
      if (!validationInterface) throw new Error(`feature ${feature.id} supports no run interface`)
      const selections = feature.options.map(option => ({ id: feature.id, options: [option.id] }))
      for (const selection of selections) {
        const contribution = feature.contribution(selection, {
          ...validationProfile,
          runInterface: validationInterface,
        })
        for (const resource of contribution.resources) {
          const owner = owners.get(resource.key)
          if (owner && owner !== feature.id) {
            throw new Error(`resource ${resource.key} is declared by both ${owner} and ${feature.id}`)
          }
          owners.set(resource.key, feature.id)
        }
      }
    }
  }

  /**
   * Return all builtins in display order.
   * @returns all registered features.
   */
  all(): readonly Feature[] {
    return [...this.features.values()]
  }

  /**
   * Resolve one builtin or fail loud.
   * @param id - stable feature identity.
   * @returns registered feature.
   */
  get(id: FeatureId): Feature {
    const feature = this.features.get(id)
    if (!feature) throw new Error(`unknown feature: ${id}`)
    return feature
  }

  /**
   * Inspect every applicable builtin in display order.
   * @param project - project view to inspect.
   * @returns installation snapshots for applicable features.
   */
  inspect(project: FeatureProjectView): ReturnType<Feature['inspect']>[] {
    return this.all()
      .filter(feature => feature.isApplicable(project.profile))
      .map(feature => feature.inspect(project))
  }

  /**
   * Resolve the builtin that owns a Cordis package name for this profile.
   * @param name - Loader package name.
   * @param profile - project context controlling applicability.
   * @returns owning feature, if the package is builtin-owned.
   */
  ownerOfPackage(name: string, profile: ProjectProfile): Feature | undefined {
    return this.all().find((feature) => {
      if (!feature.isApplicable(profile)) return false
      const selections = feature.options.map(option => ({ id: feature.id, options: [option.id] }))
      return selections.some(selection => feature.contribution(selection, profile).resources.some(
        (resource): resource is CordisConfigEntryResource => resource.kind === 'cordis-config-entry'
          && resource.entry.name === name,
      ))
    })
  }
}
