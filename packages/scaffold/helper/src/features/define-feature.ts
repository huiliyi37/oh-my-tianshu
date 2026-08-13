/**
 * Typed declarative definitions for features whose behavior is entirely
 * the shared resource lifecycle.
 *
 * @module @deepseek-ai/dsh-helper/features/define-feature
 */

import type { CordisConfigEntry } from '../documents/cordis-yaml-file.ts'
import { TextProjectFile } from '../documents/project-file.ts'
import { featureId, resourceKey, type FeatureId } from '../ids.ts'
import type { FeatureSelection, ProjectProfile, RunInterface } from '../project/types.ts'
import {
  Feature,
  FeatureOption,
  type FeatureRequirement,
  type FeatureSecret,
} from './feature.ts'
import { ProjectContribution, type ProjectResource } from './resources.ts'

/** Static NPM dependency in a declarative feature. */
interface NpmDependencySpec {
  kind: 'npm-dependency'
  name: string
  section?: 'dependencies' | 'devDependencies'
}

/** Bare-package Cordis config entry that also contributes its NPM dependency. */
interface NpmCordisConfigEntrySpec {
  kind: 'npm-cordis-config-entry'
  id: string
  package: string
  config?: Readonly<Record<string, unknown>>
  ownedConfigKeys?: readonly string[]
  commentedExample?: string
}

/** Relative or absolute file Cordis config entry with no NPM dependency. */
interface FileCordisConfigEntrySpec {
  kind: 'file-cordis-config-entry'
  id: string
  path: string
  config?: Readonly<Record<string, unknown>>
  ownedConfigKeys?: readonly string[]
  commentedExample?: string
}

/** Static complete file owned by one feature option. */
interface OwnedFileSpec {
  kind: 'owned-file'
  path: string
  text: string
  removeOnlyWhenUnchanged?: boolean
}

/** Resource forms that require no feature-specific imperative code. */
type FeatureResourceSpec =
  | NpmDependencySpec
  | NpmCordisConfigEntrySpec
  | FileCordisConfigEntrySpec
  | OwnedFileSpec

/** Cordis config entry identity and optional plugin-config subset that identifies an option. */
interface FeatureOptionMarkerSpec {
  id: string
  name: string
  config?: Readonly<Record<string, unknown>>
}

/** Declarative requirement converted to branded domain identity at the boundary. */
interface FeatureRequirementSpec {
  id: string
  options?: readonly string[]
}

/** One static option inside a typed feature definition. */
interface FeatureOptionSpec {
  id: string
  label: string
  default?: boolean
  resources: readonly FeatureResourceSpec[]
  secrets?: readonly FeatureSecret[]
  markers?: readonly FeatureOptionMarkerSpec[]
  requires?: readonly FeatureRequirementSpec[]
}

/** Complete declarative feature definition. */
export interface FeatureSpec {
  id: string
  summary: string
  mode: 'single' | 'exclusive' | 'multiple'
  options: readonly FeatureOptionSpec[]
  baseResources?: readonly FeatureResourceSpec[]
  required?: boolean
  requires?: readonly FeatureRequirementSpec[]
  suggests?: readonly string[]
  supportedInterfaces?: readonly RunInterface[]
}

function sameShape(expected: unknown, actual: unknown): boolean {
  if (expected === null || actual === null) return expected === actual
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && (expected.length === 0 || actual.every(item => sameShape(expected[0], item)))
  }
  if (typeof expected !== 'object') return typeof expected === typeof actual
  if (typeof actual !== 'object' || Array.isArray(actual)) return false
  return Object.entries(expected as Record<string, unknown>).every(
    ([key, value]) => sameShape(value, (actual as Record<string, unknown>)[key]),
  )
}

function configDiagnostics(
  expected: Readonly<Record<string, unknown>> | undefined,
): ((config: Readonly<Record<string, unknown>>) => readonly string[]) | undefined {
  if (!expected || Object.keys(expected).length === 0) return undefined
  return config => Object.entries(expected).flatMap(([key, value]) => sameShape(value, config[key])
    ? []
    : [`${key} has an incompatible value shape`])
}

function resourcesFromSpec(spec: FeatureResourceSpec): ProjectResource[] {
  switch (spec.kind) {
    case 'npm-dependency':
      return [{
        kind: 'npm-dependency',
        key: resourceKey(`npm-dependency:${spec.name}`),
        name: spec.name,
        section: spec.section ?? 'dependencies',
      }]
    case 'npm-cordis-config-entry':
    case 'file-cordis-config-entry': {
      const config = spec.config ? { ...spec.config } : undefined
      const validateConfig = configDiagnostics(config)
      const name = spec.kind === 'npm-cordis-config-entry' ? spec.package : spec.path
      return [
        ...spec.kind === 'npm-cordis-config-entry'
          ? [{
            kind: 'npm-dependency' as const,
            key: resourceKey(`npm-dependency:${spec.package}`),
            name: spec.package,
            section: 'dependencies' as const,
          }]
          : [],
        {
          kind: 'cordis-config-entry',
          key: resourceKey(`cordis-config-entry:${spec.id}`),
          entry: {
            id: spec.id,
            name,
            ...config ? { config } : {},
          },
          ownedConfigKeys: spec.ownedConfigKeys ?? Object.keys(config ?? {}),
          ...spec.commentedExample ? { commentedExample: spec.commentedExample } : {},
          ...validateConfig ? { validateConfig } : {},
        },
      ]
    }
    case 'owned-file':
      return [{
        kind: 'owned-file',
        key: resourceKey(`file:${spec.path}`),
        document: new TextProjectFile(spec.path, spec.text),
        removeOnlyWhenUnchanged: spec.removeOnlyWhenUnchanged ?? true,
      }]
  }
}

function isSubset(expected: Readonly<Record<string, unknown>>, actual: Readonly<Record<string, unknown>>): boolean {
  return Object.entries(expected).every(([key, value]) => { return Object.is(actual[key], value) })
}

class DefinedFeatureOption extends FeatureOption {
  override readonly id: string
  override readonly label: string
  override readonly secrets: readonly FeatureSecret[]
  private readonly spec: FeatureOptionSpec

  constructor(spec: FeatureOptionSpec) {
    super()
    this.spec = spec
    this.id = spec.id
    this.label = spec.label
    this.secrets = spec.secrets ?? []
  }

  override contribution(_profile: ProjectProfile, secrets: Readonly<Record<string, string>>): ProjectContribution {
    return new ProjectContribution([
      ...this.spec.resources.flatMap(resourcesFromSpec),
      ...this.secrets.map(secret => ({
        kind: 'environment' as const,
        key: resourceKey(`environment:${secret.environment}`),
        name: secret.environment,
        ...secrets[secret.id] === undefined ? {} : { value: secrets[secret.id] },
        exampleValue: '',
      })),
    ])
  }

  override markerConfigEntries(): readonly Pick<CordisConfigEntry, 'id' | 'name'>[] {
    const markers = this.spec.markers ?? this.spec.resources.flatMap((resource) => {
      switch (resource.kind) {
        case 'npm-cordis-config-entry': return [{ id: resource.id, name: resource.package }]
        case 'file-cordis-config-entry': return [{ id: resource.id, name: resource.path }]
        default: return []
      }
    })
    return markers.map(marker => ({ id: marker.id, name: marker.name }))
  }

  override matchesConfigEntries(entries: readonly CordisConfigEntry[]): boolean {
    const markers = this.spec.markers
    if (!markers) return this.markerConfigEntries().some(marker => entries.some(
      entry => entry.id === marker.id && entry.name === marker.name,
    ))
    return markers.some(marker => entries.some(entry => entry.id === marker.id
      && entry.name === marker.name
      && (!marker.config || isSubset(marker.config, entry.config ?? {}))))
  }
}

/** Feature entity backed by a typed static definition. */
class DefinedFeature extends Feature {
  override readonly id: FeatureId
  override readonly summary: string
  override readonly mode: FeatureSpec['mode']
  override readonly options: readonly FeatureOption[]
  override readonly required: boolean
  override readonly requires: readonly FeatureId[]
  override readonly suggests: readonly FeatureId[]
  override readonly supportedInterfaces: readonly RunInterface[]
  private readonly spec: FeatureSpec

  /** Validate and materialize one declarative definition. */
  constructor(spec: FeatureSpec) {
    super()
    this.spec = spec
    this.id = featureId(spec.id)
    this.summary = spec.summary
    this.mode = spec.mode
    this.options = spec.options.map(option => new DefinedFeatureOption(option))
    const defaultCount = spec.options.filter(option => option.default).length
    if (spec.mode === 'single' && (spec.options.length !== 1 || defaultCount !== 1)) {
      throw new Error(`single feature ${spec.id} requires one default option`)
    }
    if (spec.mode === 'exclusive' && defaultCount !== 1) {
      throw new Error(`exclusive feature ${spec.id} requires exactly one default option`)
    }
    if (spec.mode === 'multiple' && defaultCount === 0) {
      throw new Error(`multiple feature ${spec.id} requires at least one default option`)
    }
    this.required = spec.required ?? false
    this.requires = (spec.requires ?? []).map(requirement => featureId(requirement.id))
    this.suggests = (spec.suggests ?? []).map(featureId)
    this.supportedInterfaces = spec.supportedInterfaces ?? ['acp', 'embed']
  }

  override defaultOptions(): readonly string[] {
    return this.spec.options.filter(option => option.default).map(option => option.id)
  }

  override baseContribution(): ProjectContribution {
    return new ProjectContribution((this.spec.baseResources ?? []).flatMap(resourcesFromSpec))
  }

  override requirements(selection: FeatureSelection): readonly FeatureRequirement[] {
    const selected = new Set(selection.options)
    return [
      ...(this.spec.requires ?? []),
      ...this.spec.options.filter(option => selected.has(option.id)).flatMap(option => option.requires ?? []),
    ].map(requirement => ({
      id: featureId(requirement.id),
      ...requirement.options ? { options: requirement.options } : {},
    }))
  }
}

/** Construct the shared lifecycle entity from a typed declarative definition. */
export function defineFeature(spec: FeatureSpec): Feature {
  return new DefinedFeature(spec)
}

/** Materialize one ordered catalog containing static specs and behavior entities. */
export function defineFeatures(definitions: readonly (Feature | FeatureSpec)[]): Feature[] {
  return definitions.map(definition => definition instanceof Feature
    ? definition
    : defineFeature(definition))
}
