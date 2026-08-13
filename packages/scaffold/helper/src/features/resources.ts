/**
 * Resource vocabulary contributed by builtin SDK features.
 *
 * @module @deepseek-ai/dsh-helper/features/resources
 */

import type { CordisConfigEntry } from '../documents/cordis-yaml-file.ts'
import type { ProjectFile } from '../documents/project-file.ts'
import type { ResourceKey } from '../ids.ts'

/** Runtime or development NPM dependency contribution. */
export interface NpmDependencyResource {
  kind: 'npm-dependency'
  key: ResourceKey
  name: string
  section: 'dependencies' | 'devDependencies'
}

/** Feature-owned package script. */
export interface PackageScriptResource {
  kind: 'package-script'
  key: ResourceKey
  name: string
  command: string
  removeOnlyWhenUnchanged: boolean
}

/** Owned Cordis config entry plus the config keys safe to update in place. */
export interface CordisConfigEntryResource {
  kind: 'cordis-config-entry'
  key: ResourceKey
  entry: CordisConfigEntry
  ownedConfigKeys: readonly string[]
  commentedExample?: string
  validateConfig?: (config: Readonly<Record<string, unknown>>) => readonly string[]
}

/** Environment variable reference and dotenv material. */
export interface EnvironmentResource {
  kind: 'environment'
  key: ResourceKey
  name: string
  value?: string
  exampleValue: string
  comment?: string
}

/** Feature-exclusive complete file. */
export interface OwnedFileResource {
  kind: 'owned-file'
  key: ResourceKey
  document: ProjectFile
  removeOnlyWhenUnchanged: boolean
}

/** Any resource a feature can add to a project. */
export type ProjectResource =
  | NpmDependencyResource
  | PackageScriptResource
  | CordisConfigEntryResource
  | EnvironmentResource
  | OwnedFileResource

/** Complete resource contribution for one selected feature state. */
export class ProjectContribution {
  readonly resources: readonly ProjectResource[]

  /** Validate and retain one feature-owned resource set. */
  constructor(resources: readonly ProjectResource[]) {
    const seen = new Set<ResourceKey>()
    for (const resource of resources) {
      if (seen.has(resource.key)) throw new Error(`duplicate contribution resource key: ${resource.key}`)
      seen.add(resource.key)
    }
    this.resources = resources
  }

  /** Merge base and option contributions by stable key. */
  static merge(...contributions: readonly ProjectContribution[]): ProjectContribution {
    const resources = new Map<ResourceKey, ProjectResource>()
    for (const contribution of contributions) {
      for (const resource of contribution.resources) {
        const previous = resources.get(resource.key)
        if (previous && JSON.stringify(previous) !== JSON.stringify(resource)) {
          throw new Error(`resource ${resource.key} has conflicting definitions inside one feature`)
        }
        resources.set(resource.key, resource)
      }
    }
    return new ProjectContribution([...resources.values()])
  }

  /** Index resources by stable key. */
  byKey(): ReadonlyMap<ResourceKey, ProjectResource> {
    return new Map(this.resources.map(resource => [resource.key, resource]))
  }
}
