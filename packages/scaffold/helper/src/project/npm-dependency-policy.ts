/**
 * NPM dependency baseline and version policy for generated SDK projects.
 *
 * @module @deepseek-ai/dsh-helper/project/npm-dependency-policy
 */

import type { NpmDependencySection } from '../documents/package-json-file.ts'

/** One NPM dependency spec selected by the SDK release policy. */
export interface ResolvedNpmDependency {
  section: NpmDependencySection
  spec: string
}

/** NPM dependency maps rendered into a newly created root package.json. */
export interface BaselineNpmDependencies {
  dependencies: Readonly<Record<string, string>>
  devDependencies: Readonly<Record<string, string>>
}

const EXTERNAL_NPM_DEPENDENCY_SPECS: Readonly<Record<string, string>> = {
  '@cordisjs/plugin-hmr': '^1.0.15',
  '@cordisjs/plugin-timer': '^1.1.2',
  '@types/node': '^22.20.0',
  cordis: '^4.0.0-rc.7',
  tsdown: '0.22.2',
  tsx: '^4.22.4',
  typescript: '^6.0.3',
}

const BASELINE_NPM_DEPENDENCY_NAMES: Readonly<Record<NpmDependencySection, readonly string[]>> = {
  dependencies: ['@deepseek-ai/dsh-scripts', 'cordis'],
  devDependencies: ['@types/node', 'tsdown', 'tsx', 'typescript'],
}

/** Resolve one package to its generated-project section and version spec. */
export function resolveNpmDependency(
  name: string,
  requestedSection: NpmDependencySection,
  releaseVersion: string,
): ResolvedNpmDependency {
  if (name.startsWith('@deepseek-ai/dsh-')) {
    return { section: requestedSection, spec: `^${releaseVersion}` }
  }
  const spec = EXTERNAL_NPM_DEPENDENCY_SPECS[name]
  if (spec) return { section: requestedSection, spec }
  throw new Error(`no generated-project NPM dependency policy for ${name}`)
}

/** Build the root package.json NPM dependency maps from the shared version policy. */
export function baselineNpmDependencies(releaseVersion: string): BaselineNpmDependencies {
  return {
    dependencies: Object.fromEntries(BASELINE_NPM_DEPENDENCY_NAMES.dependencies.map((name) => {
      const dependency = resolveNpmDependency(name, 'dependencies', releaseVersion)
      return [name, dependency.spec]
    })),
    devDependencies: Object.fromEntries(BASELINE_NPM_DEPENDENCY_NAMES.devDependencies.map((name) => {
      const dependency = resolveNpmDependency(name, 'devDependencies', releaseVersion)
      return [name, dependency.spec]
    })),
  }
}
