/**
 * Read-only aggregate for one generated or existing SDK project.
 *
 * @module @huiliyi37/dsh-helper/project/sdk-project
 */

import { access, readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { CordisYamlFile, type CordisConfigEntry } from '../documents/cordis-yaml-file.ts'
import { EnvFile } from '../documents/env-file.ts'
import { PackageJsonFile, type PackageManifest } from '../documents/package-json-file.ts'
import { PnpmWorkspaceFile } from '../documents/pnpm-workspace-file.ts'
import { ProjectFile, TextProjectFile } from '../documents/project-file.ts'
import { TsConfigFile } from '../documents/tsconfig-file.ts'
import {
  createPackageManager,
  type PackageManager,
  type PackageManagerName,
} from '../package-managers/package-manager.ts'
import {
  createBaselineProjectArtifacts,
  createPackageJsonDoc,
  createProjectTemplateContext,
} from '../templates/project-template.ts'
import type { ProjectCreationRequest, ProjectProfile, RunInterface } from './types.ts'
import type { FeatureRegistry } from '../features/registry.ts'
import { ProjectEditSession } from './project-edit-session.ts'

/** Whether a project snapshot describes uncommitted creation or files on disk. */
export type ProjectOrigin = 'create' | 'disk'

const OPTIONAL_DOCUMENTS = [
  '.env',
  '.env.example',
  'tsconfig.json',
  'pnpm-workspace.yaml',
  'hooks.json',
  'codex-hooks.json',
  'README.md',
  'index.ts',
] as const

function runInterface(entries: readonly CordisConfigEntry[]): RunInterface {
  // The TUI bundle (root or a subpath) runs on the embedded interface: the
  // interactive terminal surface mounts over the same embed tree as the
  // default headless composition.
  if (entries.some(entry => entry.name === '@huiliyi37/dsh-acp')) return 'acp'
  return 'embed'
}

function runtimeModel(entries: readonly CordisConfigEntry[]): string {
  const acp = entries.find(entry => entry.name === '@huiliyi37/dsh-acp')
  if (typeof acp?.config?.model === 'string' && acp.config.model.length > 0) return acp.config.model
  const provider = entries.find(entry => entry.name === '@huiliyi37/dsh-llm-deepseek'
    || entry.name === '@huiliyi37/dsh-llm-pi-ai')
  const models = provider?.config?.models
  if (Array.isArray(models) && typeof models[0] === 'string') return models[0]
  return 'deepseek-v4-flash'
}

function releaseVersion(manifest: Readonly<PackageManifest>): string {
  const spec = manifest.dependencies?.['@huiliyi37/dsh-scripts']
  const match = spec && /(?:^|[^0-9])(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/.exec(spec)
  return match?.[1] ?? '0.0.1'
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch (error) {
    /* v8 ignore else -- the other arm requires a filesystem permission/IO fault from access */
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    /* v8 ignore next -- paired with the ignored defensive access-error arm above */
    throw error
  }
}

async function detectPackageManager(root: string, manifest: Readonly<PackageManifest>): Promise<PackageManager> {
  let name: PackageManagerName = 'npm'
  let version = '10.0.0'
  const field = manifest.packageManager
  if (field) {
    const match = /^(npm|pnpm|yarn)@(.+)$/.exec(field)
    if (!match?.[1] || !match[2]) throw new Error(`invalid packageManager field: ${field}`)
    name = match[1] as PackageManagerName
    version = match[2]
  } else if (await pathExists(resolve(root, 'pnpm-lock.yaml'))) {
    name = 'pnpm'
    version = '10.0.0'
  } else if (await pathExists(resolve(root, 'yarn.lock'))) {
    name = 'yarn'
    version = '2.0.0'
  }
  return createPackageManager(name, version)
}

function linkedRepositoryRoot(root: string, manifest: Readonly<PackageManifest>): string | undefined {
  const spec = manifest.dependencies?.['@huiliyi37/dsh-scripts']
  const match = /^(?:file|link|portal):(.+)\/packages\/scaffold\/scripts\/?$/.exec(spec ?? '')
  return match?.[1] ? resolve(root, match[1]) : undefined
}

function parseOptionalDocument(path: string, text: string): ProjectFile {
  try {
    switch (path) {
      case '.env': return EnvFile.parse('.env', text)
      case '.env.example': return EnvFile.parse('.env.example', text)
      case 'tsconfig.json': return TsConfigFile.parse(text)
      case 'pnpm-workspace.yaml': return PnpmWorkspaceFile.parse(text)
      default: return new TextProjectFile(path, text, text)
    }
  } catch {
    // Optional malformed resources do not invalidate the project aggregate;
    // an operation that needs their structure checks the concrete document type.
    return new TextProjectFile(path, text, text)
  }
}

/** A project snapshot whose documents can only be changed through {@link ProjectEditSession}. */
export class SdkProject {
  /** Absolute project directory. */
  readonly root: string
  /** Whether this snapshot is an uncommitted blueprint or disk state. */
  readonly origin: ProjectOrigin
  /** Project identity, runtime, interface, and package-manager context. */
  readonly profile: ProjectProfile
  private readonly documents: ReadonlyMap<string, ProjectFile>

  private constructor(
    root: string,
    origin: ProjectOrigin,
    profile: ProjectProfile,
    documents: ReadonlyMap<string, ProjectFile>,
  ) {
    this.root = resolve(root)
    this.origin = origin
    this.profile = profile
    this.documents = documents
  }

  /**
   * Build an in-memory project blueprint without touching the target directory.
   * @param root - target project directory.
   * @param request - complete creation request.
   * @returns uncommitted project snapshot.
   */
  static create(root: string, request: ProjectCreationRequest): SdkProject {
    const app = request.features.find(selection => selection.id === 'app')
    const selectedInterface = app?.options[0]
    if (selectedInterface !== 'acp' && selectedInterface !== 'embed') {
      throw new Error('project creation requires one app feature option')
    }
    const profile: ProjectProfile = {
      name: request.name,
      description: request.description,
      runtime: request.runtime,
      runInterface: selectedInterface,
      packageManager: request.packageManager,
      releaseVersion: request.releaseVersion,
      ...request.linkWorkspaceRoot ? { linkWorkspaceRoot: resolve(request.linkWorkspaceRoot) } : {},
    }
    const templates = createProjectTemplateContext(profile)
    const manifest = createPackageJsonDoc(templates)
    const documents = new Map<string, ProjectFile>()
    documents.set(manifest.relativePath, manifest)
    documents.set('cordis.yml', CordisYamlFile.create())
    documents.set('.env.example', EnvFile.create('.env.example'))
    documents.set('tsconfig.json', TsConfigFile.create())
    for (const document of request.packageManager.configureWorkspace(manifest)) documents.set(document.relativePath, document)
    for (const document of createBaselineProjectArtifacts(templates)) {
      documents.set(document.relativePath, document)
    }
    return new SdkProject(root, 'create', profile, documents)
  }

  /**
   * Load an existing project from required and SDK-managed optional files.
   * @param root - existing project directory.
   * @returns disk-backed project snapshot.
   */
  static async open(root: string): Promise<SdkProject> {
    const absolute = resolve(root)
    const [manifestText, cordisText] = await Promise.all([
      readFile(resolve(absolute, 'package.json'), 'utf8'),
      readFile(resolve(absolute, 'cordis.yml'), 'utf8'),
    ])
    const manifest = PackageJsonFile.parse(manifestText)
    const cordis = CordisYamlFile.parse(cordisText)
    const value = manifest.value()
    const manager = await detectPackageManager(absolute, value)
    const entries = cordis.entries()
    const linkWorkspaceRoot = linkedRepositoryRoot(absolute, value)
    const profile: ProjectProfile = {
      name: value.name ?? basename(absolute),
      description: typeof value.description === 'string' ? value.description : '',
      runtime: { model: runtimeModel(entries) },
      runInterface: runInterface(entries),
      packageManager: manager,
      releaseVersion: releaseVersion(value),
      ...linkWorkspaceRoot ? { linkWorkspaceRoot } : {},
    }
    const documents = new Map<string, ProjectFile>([
      ['package.json', manifest],
      ['cordis.yml', cordis],
    ])
    await Promise.all(OPTIONAL_DOCUMENTS.map(async (path) => {
      try {
        const text = await readFile(resolve(absolute, path), 'utf8')
        documents.set(path, parseOptionalDocument(path, text))
      } catch (error) {
        /* v8 ignore next -- optional-file reads fail normally only with ENOENT; other IO faults surface */
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }))
    return new SdkProject(absolute, 'disk', profile, documents)
  }

  /**
   * Read the root package manifest defensively.
   * @returns cloned manifest value.
   */
  packageManifest(): Readonly<PackageManifest> {
    return this.packageJson.value()
  }

  /**
   * Read Cordis config entries defensively in file order.
   * @returns cloned Cordis config entries.
   */
  cordisConfigEntries(): readonly CordisConfigEntry[] {
    return this.cordis.entries()
  }

  /**
   * Check whether this snapshot contains one managed document.
   * @param path - project-relative document path.
   * @returns whether the document is loaded.
   */
  hasDocument(path: string): boolean {
    return this.documents.has(path)
  }

  /**
   * Read one environment variable from a loaded dotenv document.
   * @param path - environment file to read.
   * @param name - variable name.
   * @returns variable value when present.
   */
  readEnvironment(path: '.env' | '.env.example', name: string): string | undefined {
    const document = this.documents.get(path)
    if (!document) return undefined
    if (!(document instanceof EnvFile)) throw new Error(`${path} is not an environment document`)
    return document.get(name)
  }

  /** Read the root package document. */
  get packageJson(): PackageJsonFile {
    const document = this.documents.get('package.json')
    if (!(document instanceof PackageJsonFile)) throw new Error('project package.json is missing or invalid')
    return document
  }

  /** Read the root Cordis document. */
  get cordis(): CordisYamlFile {
    const document = this.documents.get('cordis.yml')
    if (!(document instanceof CordisYamlFile)) throw new Error('project cordis.yml is missing or invalid')
    return document
  }

  /**
   * Return one managed document without exposing the aggregate map.
   * @param path - project-relative document path.
   * @returns loaded document when present.
   */
  document(path: string): ProjectFile | undefined {
    return this.documents.get(path)
  }

  /**
   * Create the only mutable boundary for this snapshot.
   * @param registry - feature catalog governing edits.
   * @returns isolated edit session.
   */
  edit(registry: FeatureRegistry): ProjectEditSession {
    return new ProjectEditSession(this, registry)
  }

  /**
   * Clone every managed document for an isolated edit session.
   * @returns project-relative document map.
   */
  cloneDocuments(): Map<string, ProjectFile> {
    return new Map([...this.documents].map(([path, document]) => [path, document.clone()]))
  }

  /**
   * Reload this aggregate from committed disk state.
   * @returns fresh disk-backed snapshot.
   */
  reopen(): Promise<SdkProject> {
    return SdkProject.open(this.root)
  }

}
