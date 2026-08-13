/**
 * Small resource constructors shared by builtin feature modules.
 *
 * @module @deepseek-ai/dsh-helper/features/builtin/helpers
 */

import type { CordisConfigEntry } from '../../documents/cordis-yaml-file.ts'
import { TextProjectFile } from '../../documents/project-file.ts'
import { resourceKey } from '../../ids.ts'
import type {
  CordisConfigEntryResource,
  EnvironmentResource,
  OwnedFileResource,
  NpmDependencyResource,
  PackageScriptResource,
} from '../resources.ts'

/** Return the installable package name for a bare package or package subpath. */
function installablePackageName(specifier: string): string {
  const segments = specifier.split('/')
  const expectedSegments = specifier.startsWith('@') ? 2 : 1
  if (segments.length < expectedSegments || segments.slice(0, expectedSegments).some(segment => segment.length === 0)) {
    throw new Error(`invalid bare package specifier: ${JSON.stringify(specifier)}`)
  }
  return segments.slice(0, expectedSegments).join('/')
}

/** Create a runtime NPM dependency resource. */
function npmDependency(_owner: string, specifier: string): NpmDependencyResource {
  const name = installablePackageName(specifier)
  return {
    kind: 'npm-dependency',
    key: resourceKey(`npm-dependency:${name}`),
    name,
    section: 'dependencies',
  }
}

/** Create a feature-owned package script that is replaceable only while unchanged. */
export function packageScript(_owner: string, name: string, command: string): PackageScriptResource {
  return {
    kind: 'package-script',
    key: resourceKey(`package-script:${name}`),
    name,
    command,
    removeOnlyWhenUnchanged: true,
  }
}

/** Create a Cordis config entry resource with explicitly owned config keys. */
export function cordisConfigEntry(
  _owner: string,
  value: CordisConfigEntry,
  ownedConfigKeys: readonly string[] = Object.keys(value.config ?? {}),
  validateConfig?: CordisConfigEntryResource['validateConfig'],
): CordisConfigEntryResource {
  return {
    kind: 'cordis-config-entry',
    key: resourceKey(`cordis-config-entry:${value.id}`),
    entry: value,
    ownedConfigKeys,
    ...validateConfig ? { validateConfig } : {},
  }
}

/** Couple one bare-package or subpath Cordis entry to its installable NPM package. */
export function npmCordisConfigEntry(
  owner: string,
  value: CordisConfigEntry,
  ownedConfigKeys: readonly string[] = Object.keys(value.config ?? {}),
  validateConfig?: CordisConfigEntryResource['validateConfig'],
): readonly [NpmDependencyResource, CordisConfigEntryResource] {
  return [
    npmDependency(owner, value.name),
    cordisConfigEntry(owner, value, ownedConfigKeys, validateConfig),
  ]
}

/** Create a secret/environment binding resource. */
export function environment(
  _owner: string,
  name: string,
  value: string | undefined,
  comment?: string,
): EnvironmentResource {
  return {
    kind: 'environment',
    key: resourceKey(`environment:${name}`),
    name,
    ...value === undefined ? {} : { value },
    exampleValue: '',
    ...comment === undefined ? {} : { comment },
  }
}

/** Create an owned complete-text file that is removable only while unchanged. */
export function ownedTextFile(_owner: string, path: string, text: string): OwnedFileResource {
  return {
    kind: 'owned-file',
    key: resourceKey(`file:${path}`),
    document: new TextProjectFile(path, text),
    removeOnlyWhenUnchanged: true,
  }
}

/** Validate a config key as a string when present. */
export function optionalString(config: Readonly<Record<string, unknown>>, key: string): string[] {
  return config[key] === undefined || typeof config[key] === 'string' ? [] : [`${key} must be a string`]
}

/** Validate a config key as a non-empty string when required. */
export function requiredString(config: Readonly<Record<string, unknown>>, key: string): string[] {
  return typeof config[key] === 'string' && config[key].length > 0 ? [] : [`${key} must be a non-empty string`]
}

/** Validate a config key as an array of strings. */
export function stringArray(config: Readonly<Record<string, unknown>>, key: string): string[] {
  const value = config[key]
  return Array.isArray(value) && value.every(item => typeof item === 'string')
    ? []
    : [`${key} must be an array of strings`]
}
