/**
 * Result summary for one SDK project edit session.
 *
 * @module @deepseek-ai/dsh-helper/project/change-set
 */

import type { FeatureId } from '../ids.ts'

/** Immutable description of committed or pending project changes. */
export interface ChangeSet {
  addedFeatures: readonly FeatureId[]
  enabledFeatures: readonly FeatureId[]
  disabledFeatures: readonly FeatureId[]
  configuredFeatures: readonly FeatureId[]
  addedPlugins: readonly string[]
  enabledPlugins: readonly string[]
  disabledPlugins: readonly string[]
  changedFiles: readonly string[]
  npmDependenciesChanged: boolean
}

/** Result of committing one project edit session. */
export interface ProjectCommitResult<TProject> {
  project: TProject
  changes: ChangeSet
}
