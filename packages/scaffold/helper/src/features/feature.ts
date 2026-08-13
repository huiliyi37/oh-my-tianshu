/**
 * Stateful builtin feature and option domain objects.
 *
 * @module @deepseek-ai/dsh-helper/features/feature
 */

import type { CordisConfigEntry } from '../documents/cordis-yaml-file.ts'
import type { PackageManifest } from '../documents/package-json-file.ts'
import type { FeatureId } from '../ids.ts'
import type { FeatureSelection, ProjectProfile, RunInterface } from '../project/types.ts'
import { ProjectContribution, type CordisConfigEntryResource, type ProjectResource } from './resources.ts'

/** Read-only project surface used by feature inspection. */
export interface FeatureProjectView {
  readonly profile: ProjectProfile
  cordisConfigEntries(): readonly CordisConfigEntry[]
  packageManifest(): Readonly<PackageManifest>
  hasDocument(path: string): boolean
  readEnvironment(path: '.env' | '.env.example', name: string): string | undefined
}

/** Installation state visible to create/config workflows. */
type FeatureInstallationState = 'absent' | 'enabled' | 'disabled' | 'inconsistent'

/** Result of round-tripping one feature from a project snapshot. */
export interface FeatureInstallation {
  id: FeatureId
  state: FeatureInstallationState
  options: readonly string[]
  selection?: FeatureSelection
  diagnostics: readonly string[]
}

/** One final-state requirement on another builtin feature. */
export interface FeatureRequirement {
  id: FeatureId
  options?: readonly string[]
}

/** One secret captured into an environment binding rather than Cordis plugin config. */
export interface FeatureSecret {
  id: string
  environment: string
  message: string
  required: boolean
}

/** One visible string value requested only by options that own it. */
export interface FeatureValueInput {
  id: string
  message: string
}

/** One selectable behavior option owned by a feature. */
export abstract class FeatureOption {
  abstract readonly id: string
  abstract readonly label: string
  readonly secrets: readonly FeatureSecret[] = []
  readonly inputs: readonly FeatureValueInput[] = []

  /** Contribute this option's project resources. */
  abstract contribution(profile: ProjectProfile, secrets: Readonly<Record<string, string>>): ProjectContribution

  /** Every Cordis config entry package owned by this option during inspection. */
  ownedConfigEntries(profile: ProjectProfile): readonly Pick<CordisConfigEntry, 'id' | 'name'>[] {
    return this.contribution(profile, {}).resources
      .filter((resource): resource is CordisConfigEntryResource => resource.kind === 'cordis-config-entry')
      .map(resource => ({ id: resource.entry.id, name: resource.entry.name }))
  }

  /** Cordis config entry identities that distinguish this option during inspection. */
  markerConfigEntries(profile: ProjectProfile): readonly Pick<CordisConfigEntry, 'id' | 'name'>[] {
    return this.ownedConfigEntries(profile)
  }

  /** Whether current owned Cordis config entries identify this option. */
  matchesConfigEntries(entries: readonly CordisConfigEntry[], profile: ProjectProfile): boolean {
    return this.markerConfigEntries(profile).some(marker => entries.some(
      entry => entry.id === marker.id && entry.name === marker.name,
    ))
  }
}

/** How a feature's options compose. */
export type FeatureOptionMode = 'single' | 'exclusive' | 'multiple'

function packageNames(resources: readonly ProjectResource[]): Set<string> {
  return new Set(resources
    .filter((resource): resource is CordisConfigEntryResource => resource.kind === 'cordis-config-entry')
    .map(resource => resource.entry.name))
}

function configDiagnostics(resource: CordisConfigEntryResource, entry: CordisConfigEntry): string[] {
  /* v8 ignore next -- entries without validators have no diagnostics to compute */
  if (!resource.validateConfig) return []
  return [...resource.validateConfig(entry.config ?? {})].map(message => `${entry.id}: ${message}`)
}

/** A behavior-owning builtin feature with shallow option composition. */
export abstract class Feature {
  /** Stable registry identity. */
  abstract readonly id: FeatureId
  /** User-facing feature summary. */
  abstract readonly summary: string
  /** Option-selection rule. */
  abstract readonly mode: FeatureOptionMode
  /** Available behavior options. */
  abstract readonly options: readonly FeatureOption[]
  /** Whether every valid project must enable this feature. */
  readonly required: boolean = false
  /** Unconditional feature requirements. */
  readonly requires: readonly FeatureId[] = []
  /** Features recommended during creation. */
  readonly suggests: readonly FeatureId[] = []
  /** Front doors under which this feature is meaningful. */
  readonly supportedInterfaces: readonly RunInterface[] = ['acp', 'embed']

  /**
   * Options selected when installation has no override.
   * @param profile - project context controlling applicable defaults.
   * @returns selected option ids.
   */
  abstract defaultOptions(profile: ProjectProfile): readonly string[]

  /**
   * Shared resources present for every installed option set.
   * @param _profile - project context available to behavior features.
   * @returns shared project contribution.
   */
  baseContribution(_profile: ProjectProfile): ProjectContribution {
    return new ProjectContribution([])
  }

  /**
   * Additional final-state requirements depending on selected options.
   * @param _selection - normalized feature selection.
   * @returns required features and option constraints.
   */
  requirements(_selection: FeatureSelection): readonly FeatureRequirement[] {
    return this.requires.map(id => ({ id }))
  }

  /**
   * Whether the feature may be selected for this project front door.
   * @param profile - project context to check.
   * @returns whether the feature applies.
   */
  isApplicable(profile: ProjectProfile): boolean {
    return this.supportedInterfaces.includes(profile.runInterface)
  }

  /**
   * Validate and normalize one requested option set.
   * @param selection - requested feature and options.
   * @param profile - project context for applicability and defaults.
   * @returns deduplicated, sorted selection.
   */
  normalizeSelection(selection: FeatureSelection, profile: ProjectProfile): FeatureSelection {
    if (selection.id !== this.id) throw new Error(`selection ${selection.id} does not belong to feature ${this.id}`)
    if (!this.isApplicable(profile)) {
      throw new Error(`feature ${this.id} is not available for ${profile.runInterface}`)
    }
    const available = new Set(this.options.map(option => option.id))
    const options = [...new Set(selection.options.length > 0 ? selection.options : this.defaultOptions(profile))]
    for (const option of options) {
      if (!available.has(option)) throw new Error(`unknown ${this.id} option: ${option}`)
    }
    if (this.mode === 'single' && (options.length !== 1 || this.options.length !== 1)) {
      throw new Error(`feature ${this.id} has one fixed option`)
    }
    if (this.mode === 'exclusive' && options.length !== 1) {
      throw new Error(`feature ${this.id} requires exactly one option`)
    }
    if (this.mode === 'multiple' && options.length === 0) {
      throw new Error(`feature ${this.id} requires at least one option`)
    }
    return { ...selection, options: options.sort() }
  }

  /**
   * Build the complete selected resource contribution.
   * @param selection - selected options and captured inputs.
   * @param profile - target project context.
   * @returns merged base and option resources.
   */
  contribution(selection: FeatureSelection, profile: ProjectProfile): ProjectContribution {
    const normalized = this.normalizeSelection(selection, profile)
    const selected = this.selectedOptions(normalized)
      .map(option => option.contribution(profile, normalized.secrets ?? {}))
    return ProjectContribution.merge(this.baseContribution(profile), ...selected)
  }

  /**
   * All secret definitions required by one selected option set.
   * @param selection - selected options.
   * @param profile - target project context.
   * @returns selected secret definitions.
   */
  secrets(selection: FeatureSelection, profile: ProjectProfile): readonly FeatureSecret[] {
    const normalized = this.normalizeSelection(selection, profile)
    return this.selectedOptions(normalized).flatMap(option => option.secrets)
  }

  /**
   * All visible value definitions required by one selected option set.
   * @param selection - selected options.
   * @param profile - target project context.
   * @returns selected visible-input definitions.
   */
  valueInputs(selection: FeatureSelection, profile: ProjectProfile): readonly FeatureValueInput[] {
    const normalized = this.normalizeSelection(selection, profile)
    return this.selectedOptions(normalized).flatMap(option => option.inputs)
  }

  private selectedOptions(selection: FeatureSelection): readonly FeatureOption[] {
    return selection.options.map((id) => {
      const option = this.options.find(candidate => candidate.id === id)
      /* v8 ignore next -- normalizeSelection already membership-checks every selected id */
      if (!option) throw new Error(`unknown ${this.id} option: ${id}`)
      return option
    })
  }

  /**
   * Recover input and secret values after structural inspection.
   * @param project - project snapshot being inspected.
   * @param selection - structurally detected selection.
   * @returns selection enriched with readable values.
   */
  readSelection(project: FeatureProjectView, selection: FeatureSelection): FeatureSelection {
    const secrets = Object.fromEntries(this.secrets(selection, project.profile).flatMap((secret) => {
      const value = project.readEnvironment('.env', secret.environment)
      return value === undefined ? [] : [[secret.id, value]]
    }))
    return Object.keys(secrets).length === 0 ? selection : { ...selection, secrets }
  }

  /**
   * Inspect current files and reject any partial or ambiguous owned shape.
   * @param project - project snapshot to inspect.
   * @returns installation state, selection, and diagnostics.
   */
  inspect(project: FeatureProjectView): FeatureInstallation {
    const profile = project.profile
    const allPackages = new Set<string>()
    for (const option of this.options) {
      for (const entry of option.ownedConfigEntries(profile)) allPackages.add(entry.name)
    }
    for (const name of packageNames(this.baseContribution(profile).resources)) allPackages.add(name)
    const configEntries = project.cordisConfigEntries()
    const ownedConfigEntries = configEntries.filter(entry => allPackages.has(entry.name))

    const options = this.options
      .filter(option => option.matchesConfigEntries(configEntries, profile))
      .map(option => option.id)
    if (ownedConfigEntries.length === 0 && options.length === 0) {
      return { id: this.id, state: 'absent', options: [], diagnostics: [] }
    }
    let selection: FeatureSelection
    try {
      selection = this.normalizeSelection({ id: this.id, options }, profile)
    } catch (error) {
      return { id: this.id, state: 'inconsistent', options, diagnostics: [String(error)] }
    }
    selection = this.readSelection(project, selection)
    const expected = this.contribution(selection, profile)
    const expectedEntries = expected.resources
      .filter((resource): resource is CordisConfigEntryResource => resource.kind === 'cordis-config-entry')
    const diagnostics: string[] = []
    for (const resource of expectedEntries) {
      const actual = ownedConfigEntries.find(entry => entry.id === resource.entry.id && entry.name === resource.entry.name)
      if (!actual) diagnostics.push(`missing Cordis config entry ${resource.entry.id} (${resource.entry.name})`)
      else diagnostics.push(...configDiagnostics(resource, actual))
    }
    for (const actual of ownedConfigEntries) {
      if (!expectedEntries.some(resource => resource.entry.id === actual.id && resource.entry.name === actual.name)) {
        diagnostics.push(`unexpected owned Cordis config entry ${actual.id} (${actual.name})`)
      }
    }
    const manifest = project.packageManifest()
    for (const resource of expected.resources) {
      switch (resource.kind) {
        case 'npm-dependency':
          if (!manifest[resource.section]?.[resource.name]) {
            diagnostics.push(`missing package.json ${resource.section} entry ${resource.name}`)
          }
          break
        case 'package-script':
          if (!manifest.scripts?.[resource.name]) {
            diagnostics.push(`missing package.json script ${resource.name}`)
          }
          break
        case 'owned-file':
          if (!project.hasDocument(resource.document.relativePath)) diagnostics.push(`missing owned file ${resource.document.relativePath}`)
          break
        case 'environment':
          try {
            if (project.readEnvironment('.env.example', resource.name) === undefined) {
              diagnostics.push(`missing .env.example variable ${resource.name}`)
            }
          } catch (error) {
            diagnostics.push(String(error))
          }
          break
        case 'cordis-config-entry': break
      }
    }
    const disabled = ownedConfigEntries.map(entry => entry.disabled === true)
    if (disabled.some(Boolean) && disabled.some(value => !value)) {
      diagnostics.push('owned Cordis config entries have mixed enabled states')
    }
    if (diagnostics.length > 0) {
      return { id: this.id, state: 'inconsistent', options, diagnostics }
    }
    return {
      id: this.id,
      state: ownedConfigEntries.length > 0 && disabled.every(Boolean) ? 'disabled' : 'enabled',
      options,
      selection,
      diagnostics: [],
    }
  }
}

/** Fixed one-option feature base. */
export abstract class FixedFeature extends Feature {
  override readonly mode = 'single'

  /** Select the sole option. */
  override defaultOptions(): readonly string[] {
    const option = this.options[0]
    if (!option) throw new Error(`simple feature ${this.id} has no option`)
    return [option.id]
  }
}

/** Mutually exclusive option feature base. */
export abstract class ExclusiveOptionFeature extends Feature {
  override readonly mode = 'exclusive'
}

/** Additive multi-option feature base. */
export abstract class MultiOptionFeature extends Feature {
  override readonly mode = 'multiple'
}
