/**
 * Structured package.json document owned by an SDK project.
 *
 * @module @huiliyi37/dsh-helper/documents/package-json-file
 */

import { ProjectFile, withTrailingNewline } from './project-file.ts'

/** NPM dependency sections managed by the SDK. */
export type NpmDependencySection = 'dependencies' | 'devDependencies'

/** JSON shape retained by {@link PackageJsonFile}. */
export interface PackageManifest {
  name?: string
  version?: string
  private?: boolean
  description?: string
  type?: string
  packageManager?: string
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  workspaces?: string[]
  resolutions?: Record<string, string>
  [key: string]: unknown
}

function parseManifest(text: string): PackageManifest {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new Error(`invalid package.json: ${String(error)}`)
  }
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new Error('invalid package.json: root must be an object')
  }
  return value as PackageManifest
}

function sortedRecord(value: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)))
}

/** Editable, deterministic package.json representation. */
export class PackageJsonFile extends ProjectFile {
  private readonly manifest: PackageManifest

  private constructor(manifest: PackageManifest, originalText?: string) {
    super('package.json', originalText)
    this.manifest = structuredClone(manifest)
  }

  /** Create a new package manifest from a complete rendered template. */
  static create(text: string): PackageJsonFile {
    return new PackageJsonFile(parseManifest(text))
  }

  /** Parse an existing package.json document. */
  static parse(text: string): PackageJsonFile {
    return new PackageJsonFile(parseManifest(text), text)
  }

  /** Clone this document and its nested manifest data. */
  override clone(): PackageJsonFile {
    return new PackageJsonFile(this.manifest, this.originalText)
  }

  /** Return a defensive copy of the manifest. */
  value(): Readonly<PackageManifest> {
    return structuredClone(this.manifest)
  }

  /** Set one package script. */
  setScript(name: string, command: string): void {
    this.manifest.scripts ??= {}
    this.manifest.scripts[name] = command
  }

  /** Read one package script. */
  script(name: string): string | undefined {
    return this.manifest.scripts?.[name]
  }

  /** Remove one package script. */
  removeScript(name: string): void {
    delete this.manifest.scripts?.[name]
  }

  /** Set one NPM dependency in its runtime or development section. */
  setNpmDependency(section: NpmDependencySection, name: string, spec: string): void {
    this.manifest[section] ??= {}
    this.manifest[section][name] = spec
  }

  /** Remove one NPM dependency from a section. */
  removeNpmDependency(section: NpmDependencySection, name: string): void {
    delete this.manifest[section]?.[name]
  }

  /** Read an NPM dependency spec from either managed section. */
  npmDependency(name: string): { section: NpmDependencySection; spec: string } | undefined {
    for (const section of ['dependencies', 'devDependencies'] as const) {
      const spec = this.manifest[section]?.[name]
      if (spec !== undefined) return { section, spec }
    }
    return undefined
  }

  /** Return all managed NPM dependency names. */
  npmDependencyNames(): string[] {
    return [...new Set([
      ...Object.keys(this.manifest.dependencies ?? {}),
      ...Object.keys(this.manifest.devDependencies ?? {}),
    ])].sort()
  }

  /** Add a package-manager workspace glob. */
  addWorkspace(pattern: string): void {
    const workspaces = this.manifest.workspaces ??= []
    if (!workspaces.includes(pattern)) workspaces.push(pattern)
  }

  /** Set or remove the packageManager field. */
  setPackageManager(value: string | undefined): void {
    if (value === undefined) delete this.manifest.packageManager
    else this.manifest.packageManager = value
  }

  /** Pin a Yarn resolution used by live-link projects. */
  setResolution(name: string, spec: string): void {
    this.manifest.resolutions ??= {}
    this.manifest.resolutions[name] = spec
  }

  /** Validate the fields the SDK relies on. */
  override validate(): void {
    if (!this.manifest.name || typeof this.manifest.name !== 'string') {
      throw new Error('package.json name must be a non-empty string')
    }
    for (const section of ['scripts', 'dependencies', 'devDependencies'] as const) {
      const value: unknown = this.manifest[section]
      if (value === undefined) continue
      if (value === null || Array.isArray(value) || typeof value !== 'object') {
        throw new Error(`package.json ${section} must be an object`)
      }
      for (const [key, item] of Object.entries(value)) {
        if (typeof item !== 'string' || item.length === 0) {
          throw new Error(`package.json ${section}.${key} must be a non-empty string`)
        }
      }
    }
    if (this.manifest.workspaces !== undefined
      && (!Array.isArray(this.manifest.workspaces) || this.manifest.workspaces.some(item => typeof item !== 'string'))) {
      throw new Error('package.json workspaces must be an array of strings')
    }
  }

  /** Serialize with deterministic managed maps and two-space JSON formatting. */
  override serialize(): string {
    const value: PackageManifest = structuredClone(this.manifest)
    if (this.manifest.scripts) value.scripts = sortedRecord(this.manifest.scripts)
    if (this.manifest.dependencies) value.dependencies = sortedRecord(this.manifest.dependencies)
    if (this.manifest.devDependencies) value.devDependencies = sortedRecord(this.manifest.devDependencies)
    if (this.manifest.workspaces) { value.workspaces = [...this.manifest.workspaces].sort() }
    if (this.manifest.resolutions) value.resolutions = sortedRecord(this.manifest.resolutions)
    return withTrailingNewline(JSON.stringify(value, null, 2))
  }
}
