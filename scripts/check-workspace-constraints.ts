/**
 * Workspace package invariant checks for package-manager-independent quality
 * gates.
 *
 * Run: `tsx scripts/check-workspace-constraints.ts`.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { hasTypeRTRemoteNavigation, isForbiddenPublicationFile } from './publication-payload.ts'
import { collectProjectReferenceFaceViolations } from './project-reference-faces.ts'

const root = resolve(import.meta.dirname, '..')
// vendor/* is single-level; packages/<group>/<pkg> nests one level deeper
// (the group dirs — core/llm/bash/… — are pure containers with no manifest).
const workspaceGlobs = [
  { dir: 'vendor', depth: 1 },
  { dir: 'packages', depth: 2 },
  { dir: 'native', depth: 1 },
  { dir: 'native/landlock-run/packages', depth: 1 },
  { dir: 'apps', depth: 1 },
] as const
const vendoredPackages = new Set([
  '@huiliyi37/cordis',
  '@huiliyi37/cosmokit',
  '@huiliyi37/schemastery',
  '@huiliyi37/cordis-plugin-loader',
  '@huiliyi37/cordis-plugin-include',
  '@huiliyi37/cordis-plugin-group',
  '@huiliyi37/cordis-plugin-timer',
  '@huiliyi37/cordis-plugin-hmr',
  '@huiliyi37/cordis-plugin-logger-console',
])
const publicLandlockPackages = new Set([
  '@huiliyi37/node-addon-landlock-run',
  '@huiliyi37/node-addon-landlock-run-linux-arm64',
  '@huiliyi37/node-addon-landlock-run-linux-x64',
])
/** Deliberate source payloads whose exact bytes are part of the package's audit surface. */
const publicationSourceAllowlist: Readonly<Record<string, readonly string[]>> = {
  '@huiliyi37/node-addon-landlock-run': ['src/main.c'],
}
const repositoryUrl = 'git+https://github.com/huiliyi37/dsh-tianshu-build.git'

const localArtifactDirs = new Set(['node_modules'])
const appPackageFiles: Readonly<Record<string, readonly string[]>> = {
  '@huiliyi37/dsh-tianshu': ['lib/*.js', 'config'],
  '@huiliyi37/dsh-frontend': ['dist'],
}

/** The subset of package.json fields this constraint check cares about. */
interface PackageManifest {
  name?: string
  version?: string
  private?: boolean
  type?: string
  main?: string
  types?: string
  bin?: string | Record<string, string>
  exports?: Record<
    string,
    | string
    | {
      types?: string
      default?: string
    }
    | null
    | undefined
  >
  files?: string[]
  publishConfig?: { access?: string }
  repository?: { type?: string; url?: string; directory?: string }
  peerDependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

/** One workspace manifest and its repo-relative path. */
interface WorkspaceManifest {
  dir: string
  manifest: PackageManifest
}

function readJson(path: string): PackageManifest {
  return JSON.parse(readFileSync(path, 'utf8')) as PackageManifest
}

const rootManifest = readJson(join(root, 'package.json'))
const repositoryVersion = rootManifest.version
const landlockWorkspaceManifest = readJson(join(root, 'native/landlock-run/package.json'))
const landlockVersion = landlockWorkspaceManifest.version

/** Repo-relative dirs holding a package.json, walked to the configured depth. */
function packageDirs(base: string, depth: number): string[] {
  if (depth === 1) {
    return readdirSync(join(root, base), { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .filter(entry => !localArtifactDirs.has(entry.name))
      .filter(entry => existsSync(join(root, base, entry.name, 'package.json')))
      .map(entry => `${base}/${entry.name}`)
  }
  return readdirSync(join(root, base), { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .filter(entry => !localArtifactDirs.has(entry.name))
    .flatMap(group => packageDirs(`${base}/${group.name}`, depth - 1))
}

function workspaceManifests(): WorkspaceManifest[] {
  const manifests: WorkspaceManifest[] = [
    { dir: '.', manifest: rootManifest },
  ]

  for (const { dir: base, depth } of workspaceGlobs) {
    for (const dir of packageDirs(base, depth)) {
      manifests.push({ dir, manifest: readJson(join(root, dir, 'package.json')) })
    }
  }

  return manifests
}

const packageFileExtras: Readonly<Record<string, readonly string[]>> = {
  // Profile bundles publish their dsh.bundle.patch layer beside the lib.
  '@huiliyi37/dsh-base': ['cordis.patch.yml'],
  '@huiliyi37/dsh-web-app': ['cordis.patch.yml'],
  '@huiliyi37/dsh-headless': ['cordis.patch.yml'],
  '@huiliyi37/dsh-tui': ['cordis.patch.yml'],
  '@huiliyi37/dsh-client-ui-theme': ['lib/styles'],
  '@huiliyi37/dsh-skill-badge': ['assets'],
  '@huiliyi37/dsh-subprocess-local': ['scripts/ensure-spawn-helper.mjs'],
}

function sameStringList(actual: readonly string[] | undefined, expected: readonly string[]): boolean {
  return !!actual && actual.length === expected.length && actual.every((value, index) => value === expected[index])
}

function expectedDshPackageFiles(manifest: PackageManifest): readonly string[] {
  const extras = manifest.name ? packageFileExtras[manifest.name] ?? [] : []
  const typeRTRemoteNavigation = hasTypeRTRemoteNavigation(manifest)
  return [
    'lib/index.js',
    // Every package publishes its invariant ownership companion as a separate
    // bundle; the package-invariant gate validates the companion itself.
    'lib/invariant.js',
    ...manifest.bin ? ['lib/bin.js'] : [],
    ...manifest.exports?.['./worker'] ? ['lib/worker.cjs'] : [],
    // UI plugin packages ship their browser bundle beside the node lib
    // (single-artifact ruling: dist/ retired, ./client resolves lib/client.js).
    // Keyed on the artifact path, not the subpath name: apiproxy's ./client is
    // a browser-safe source channel, not a bundle.
    ...exportDefault(manifest, './client') === './lib/client.js' ? ['lib/client.js'] : [],
    // runtime's shell-held loader subpath ships as its own bundle beside the client half.
    ...exportDefault(manifest, './loader') === './lib/loader.js' ? ['lib/loader.js'] : [],
    // web-react's store subpath ships its own bundle (single-entry builds; no shared chunk).
    ...exportDefault(manifest, './store') === './lib/store/index.js' ? ['lib/store/index.js'] : [],
    ...extras,
    // Subpaths whose runtime default is the tsc-emitted tree (lib/types/*.js —
    // browser-safe source channels rehomed off src so plain Node can import
    // them without type stripping) publish the emitted JS alongside the
    // declarations.
    ...usesEmittedTreeDefaults(manifest) ? ['lib/types/**/*.js'] : [],
    'lib/types/**/*.d.ts',
    ...hasExportPair(manifest, './typert', './lib/typert.host.d.ts', './lib/typert.host.js')
      ? ['lib/typert.host.js', 'lib/typert.host.d.ts']
      : [],
    ...hasExportPair(manifest, './client/typert', './lib/typert.client.d.ts', './lib/typert.client.js')
      ? ['lib/typert.client.js', 'lib/typert.client.d.ts']
      : [],
    ...typeRTRemoteNavigation
      ? [
        'lib/typert.remote-client.js',
        'lib/typert.remote-client.d.ts',
        'lib/typert.remote-client.d.ts.map',
        'src',
      ]
      : [],
  ]
}

/** Whether one conditional export exactly names the generated runtime and declaration pair. */
function hasExportPair(
  manifest: PackageManifest,
  subpath: string,
  types: string,
  runtime: string,
): boolean {
  const entry = manifest.exports?.[subpath]
  return typeof entry === 'object'
    && entry !== null
    && entry.types === types
    && entry.default === runtime
}

/** Runtime target of an export entry: conditional `default`, or the bare-string shorthand. */
function exportDefault(manifest: PackageManifest, subpath: string): string | undefined {
  const entry = manifest.exports?.[subpath]
  if (typeof entry === 'string') return entry
  if (typeof entry === 'object' && entry !== null) return entry.default
  return undefined
}

/** Whether any export's runtime default points into the tsc-emitted lib/types tree. */
function usesEmittedTreeDefaults(manifest: PackageManifest): boolean {
  return Object.keys(manifest.exports ?? {}).some(subpath =>
    exportDefault(manifest, subpath)?.startsWith('./lib/types/') === true)
}

function checkWorkspace({ dir, manifest }: WorkspaceManifest): string[] {
  const errors: string[] = []
  const label = manifest.name ?? dir
  const isLandlockPackageDir = dir.startsWith('native/landlock-run/packages/')
  const isPublicLandlockPackage = isLandlockPackageDir
    && manifest.name !== undefined
    && publicLandlockPackages.has(manifest.name)

  if (isPublicLandlockPackage) {
    if (manifest.private === true) {
      errors.push(`${label}: published Landlock package must not set "private": true`)
    }
    if (manifest.publishConfig?.access !== 'public') {
      errors.push(`${label}: published Landlock package must set publishConfig.access to "public"`)
    }
    const expectedDirectory = dir
    if (manifest.repository?.type !== 'git'
      || manifest.repository.url !== repositoryUrl
      || manifest.repository.directory !== expectedDirectory) {
      errors.push(`${label}: published Landlock package repository must use ${repositoryUrl} with directory ${expectedDirectory} for trusted publishing`)
    }
  } else if (manifest.private !== true && manifest.publishConfig?.access !== 'public') {
    // Public monorepo: every publishable package must opt into public access
    // (scoped packages default to restricted on npm); container/example
    // packages stay `private: true` instead.
    errors.push(`${label}: published package must set publishConfig.access to "public" (or be "private": true)`)
  }

  if (manifest.name && vendoredPackages.has(manifest.name)) {
    return errors
  }

  if (manifest.name?.startsWith('@huiliyi37/')) {
    const allowedSources = publicationSourceAllowlist[manifest.name] ?? []
    const publicationPolicy = { typeRTRemoteNavigation: hasTypeRTRemoteNavigation(manifest) }
    for (const file of manifest.files ?? []) {
      if (isForbiddenPublicationFile(file, publicationPolicy) && !allowedSources.includes(file)) {
        errors.push(`${label}: package.json files must not publish ${JSON.stringify(file)}`)
      }
    }
  }

  if (dir.startsWith('apps/') && manifest.name?.startsWith('@huiliyi37/')) {
    const expectedFiles = appPackageFiles[manifest.name]
    if (expectedFiles === undefined) {
      errors.push(`${label}: app package has no publication files policy`)
    } else if (!sameStringList(manifest.files, expectedFiles)) {
      errors.push(`${label}: package.json files must be ${JSON.stringify(expectedFiles)}`)
    }
  }

  if (isLandlockPackageDir) {
    if (!isPublicLandlockPackage) {
      errors.push(`${label}: unexpected package in the public Landlock package family`)
    }
    if (manifest.version !== landlockVersion) {
      errors.push(`${label}: package.json version must match Landlock workspace version ${landlockVersion ?? '(missing)'}`)
    }
  }

  if (dir.startsWith('packages/') && manifest.name?.startsWith('@huiliyi37/dsh-')) {
    const peer = manifest.peerDependencies?.['@huiliyi37/cordis']
    const dev = manifest.devDependencies?.['@huiliyi37/cordis']

    if (!peer) errors.push(`${label}: @huiliyi37/cordis must be a peerDependency`)
    if (!dev) errors.push(`${label}: @huiliyi37/cordis must also be a devDependency`)
    if (peer && dev && peer !== dev) {
      errors.push(`${label}: @huiliyi37/cordis peer (${peer}) and dev (${dev}) ranges must match`)
    }
    if (manifest.version !== repositoryVersion) {
      errors.push(`${label}: package.json version must match root version ${repositoryVersion ?? '(missing)'}`)
    }
    if (manifest.type !== 'module') {
      errors.push(`${label}: package.json must set "type": "module"`)
    }
    if (manifest.main !== 'lib/index.js') {
      errors.push(`${label}: package.json must set "main": "lib/index.js"`)
    }
    if (manifest.types !== 'lib/types/index.d.ts') {
      errors.push(`${label}: package.json must set "types": "lib/types/index.d.ts"`)
    }
    const rootExport = manifest.exports?.['.']
    const rootEntry = typeof rootExport === 'object' && rootExport !== null ? rootExport : undefined
    if (rootEntry?.types !== './lib/types/index.d.ts') {
      errors.push(`${label}: package.json exports["."].types must be "./lib/types/index.d.ts"`)
    }
    if (rootEntry?.default !== './lib/index.js') {
      errors.push(`${label}: package.json exports["."].default must be "./lib/index.js"`)
    }
    const invariantRaw = manifest.exports?.['./invariant']
    const invariantExport = typeof invariantRaw === 'object' && invariantRaw !== null ? invariantRaw : undefined
    if (invariantExport?.types !== undefined && invariantExport.types !== './lib/types/invariant.d.ts') {
      errors.push(`${label}: package.json exports["./invariant"].types must be "./lib/types/invariant.d.ts"`)
    }
    if (invariantExport?.default !== undefined && invariantExport.default !== './lib/invariant.js') {
      errors.push(`${label}: package.json exports["./invariant"].default must be "./lib/invariant.js"`)
    }
    if (invariantExport && (invariantExport.types === undefined || invariantExport.default === undefined)) {
      errors.push(`${label}: package.json exports["./invariant"] must declare both types and default targets`)
    }
    const expectedFiles = expectedDshPackageFiles(manifest)
    if (!sameStringList(manifest.files, expectedFiles)) {
      errors.push(`${label}: package.json files must be ${JSON.stringify(expectedFiles)}`)
    }
  }

  return errors.map(error => `${relative(root, join(root, dir, 'package.json'))}: ${error}`)
}

/**
 * Enforce `packages/<group>/<pkg>`: groups are open-named containers without a
 * package.json, and packages may be neither flat nor more deeply nested.
 */
function checkHierarchyShape(): string[] {
  const errors: string[] = []
  const packagesRoot = join(root, 'packages')
  for (const group of readdirSync(packagesRoot, { withFileTypes: true })) {
    if (!group.isDirectory()) continue
    const groupRel = join('packages', group.name)
    if (existsSync(join(packagesRoot, group.name, 'package.json'))) {
      errors.push(`${groupRel}: a group dir must not contain a package.json — packages live at packages/<group>/<pkg>, not directly under packages/`)
      continue
    }
    for (const pkg of readdirSync(join(packagesRoot, group.name), { withFileTypes: true })) {
      if (!pkg.isDirectory()) continue
      if (localArtifactDirs.has(pkg.name)) continue
      const pkgRel = join(groupRel, pkg.name)
      if (!existsSync(join(packagesRoot, group.name, pkg.name, 'package.json'))) {
        errors.push(`${pkgRel}: expected a package here (no package.json found) — the hierarchy is exactly packages/<group>/<pkg>, no deeper nesting`)
      }
    }
  }
  return errors
}

function checkRepositoryVersion(): string[] {
  if (repositoryVersion && /^\d+\.\d+\.\d+$/.test(repositoryVersion)) return []
  return ['package.json: version must be stable X.Y.Z']
}

const errors = [
  ...checkRepositoryVersion(),
  ...workspaceManifests().flatMap(checkWorkspace),
  ...checkHierarchyShape(),
  ...collectProjectReferenceFaceViolations(root),
]
if (errors.length > 0) {
  console.error(errors.join('\n'))
  process.exitCode = 1
}
