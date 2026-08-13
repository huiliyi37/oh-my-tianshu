/**
 * Shared creation and project-profile values for SDK project editing.
 *
 * @module @deepseek-ai/dsh-helper/project/types
 */

import type { PackageManager } from '../package-managers/package-manager.ts'
import type { LocalPluginBlueprint } from '../plugins/local-plugin-blueprint.ts'
import type { FeatureId } from '../ids.ts'

/** Runtime front door selected for a generated project. */
export type RunInterface = 'acp' | 'embed'

/** Values shared by the required provider and app features. */
interface ProjectRuntimeOptions {
  model: string
}

/** Selected options and captured secrets for one feature. */
export interface FeatureSelection {
  id: FeatureId
  options: readonly string[]
  values?: Readonly<Record<string, unknown>>
  secrets?: Readonly<Record<string, string>>
}

/** Stable context available to project and feature objects. */
export interface ProjectProfile {
  name: string
  description: string
  runtime: ProjectRuntimeOptions
  runInterface: RunInterface
  packageManager: PackageManager
  releaseVersion: string
  linkWorkspaceRoot?: string
}

/** Fully collected create request; it contains intent, never rendered file text. */
export interface ProjectCreationRequest {
  name: string
  description: string
  runtime: ProjectRuntimeOptions
  packageManager: PackageManager
  releaseVersion: string
  linkWorkspaceRoot?: string
  features: readonly FeatureSelection[]
  localPlugins: readonly LocalPluginBlueprint[]
}
