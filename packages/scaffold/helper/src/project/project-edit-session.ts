/**
 * Isolated domain-command and commit boundary for SDK project changes.
 *
 * @module @huiliyi37/dsh-helper/project/project-edit-session
 */

import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type {
  Feature,
  FeatureInstallation,
  FeatureProjectView,
  FeatureRequirement,
} from '../features/feature.ts'
import type { FeatureRegistry } from '../features/registry.ts'
import type { ProjectResource } from '../features/resources.ts'
import { CordisYamlFile, type CordisConfigEntry } from '../documents/cordis-yaml-file.ts'
import { EnvFile } from '../documents/env-file.ts'
import { PackageJsonFile, type PackageManifest } from '../documents/package-json-file.ts'
import { ProjectFile } from '../documents/project-file.ts'
import { TsConfigFile } from '../documents/tsconfig-file.ts'
import { featureId, type FeatureId, type ResourceKey } from '../ids.ts'
import { LinkWorkspace } from '../package-managers/link-workspace.ts'
import type { LocalPluginBlueprint } from '../plugins/local-plugin-blueprint.ts'
import type { FeatureSelection, ProjectProfile } from './types.ts'
import { resolveNpmDependency } from './npm-dependency-policy.ts'
import type { ChangeSet, ProjectCommitResult } from './change-set.ts'
import type { SdkProject } from './sdk-project.ts'

interface MutableFeatureState {
  selection?: FeatureSelection
  state: FeatureInstallation['state']
}

function sameText(left: ProjectFile, right: ProjectFile | undefined): boolean {
  return right !== undefined && left.serialize() === right.serialize()
}

function npmDependencyShape(manifest: Readonly<PackageManifest>): string {
  return JSON.stringify({
    /* v8 ignore next -- generated manifests always carry the managed dependency maps */
    dependencies: manifest.dependencies ?? {},
    /* v8 ignore next -- generated manifests always carry the managed dependency maps */
    devDependencies: manifest.devDependencies ?? {},
  })
}

function asError(error: unknown): Error {
  /* v8 ignore else -- node:fs promise APIs reject Error objects */
  if (error instanceof Error) return error
  /* v8 ignore next -- node:fs promise APIs reject Error objects */
  return new Error(String(error))
}

function canUpdateResource(previous: ProjectResource, next: ProjectResource): boolean {
  if (previous.kind !== next.kind) return false
  switch (previous.kind) {
    case 'npm-dependency': return previous.name === (next as typeof previous).name
    case 'package-script': return previous.name === (next as typeof previous).name
    case 'cordis-config-entry': {
      const candidate = next as typeof previous
      return previous.entry.name === candidate.entry.name
    }
    case 'environment': return previous.name === (next as typeof previous).name
    case 'owned-file': return previous.document.relativePath === (next as typeof previous).document.relativePath
  }
}

/** Mutable working copy that applies feature and local-plugin domain commands. */
export class ProjectEditSession implements FeatureProjectView {
  readonly profile: ProjectProfile
  private readonly source: SdkProject
  private readonly registry: FeatureRegistry
  private readonly documents: Map<string, ProjectFile>
  private readonly removed = new Map<string, ProjectFile>()
  private readonly states = new Map<FeatureId, MutableFeatureState>()
  private readonly added = new Set<FeatureId>()
  private readonly enabled = new Set<FeatureId>()
  private readonly disabled = new Set<FeatureId>()
  private readonly configured = new Set<FeatureId>()
  private readonly addedPlugins = new Set<string>()
  private readonly enabledPlugins = new Set<string>()
  private readonly disabledPlugins = new Set<string>()
  private committed = false

  /** Clone one project snapshot into an isolated working copy. */
  constructor(source: SdkProject, registry: FeatureRegistry) {
    this.source = source
    this.registry = registry
    this.profile = source.profile
    this.documents = source.cloneDocuments()
    for (const feature of registry.all()) {
      /* v8 ignore next -- no current built-in feature is interface-specific */
      if (!feature.isApplicable(this.profile)) continue
      const installation = feature.inspect(this)
      this.states.set(feature.id, {
        state: installation.state,
        ...installation.selection ? { selection: installation.selection } : {},
      })
    }
  }

  /** Root manifest value for feature inspection. */
  packageManifest(): Readonly<PackageManifest> {
    return this.manifest().value()
  }

  /** Cordis config entries for feature and custom-plugin inspection. */
  cordisConfigEntries(): readonly CordisConfigEntry[] {
    return this.cordis().entries()
  }

  /** Whether one managed document exists in the working copy. */
  /* jscpd:ignore-start -- FeatureProjectView deliberately has symmetric snapshot/edit implementations. */
  hasDocument(path: string): boolean {
    return this.documents.has(path)
  }

  /** Read one unique working-copy environment variable. */
  readEnvironment(path: '.env' | '.env.example', name: string): string | undefined {
    const document = this.documents.get(path)
    if (!document) return undefined
    if (!(document instanceof EnvFile)) throw new Error(`${path} is not an environment document`)
    return document.get(name)
  }
  /* jscpd:ignore-end */

  /** Inspect every applicable builtin against the current working copy. */
  inspections(): readonly FeatureInstallation[] {
    return this.registry.inspect(this)
  }

  /** Install a builtin and recursively satisfy its declared requirements. */
  installFeature(feature: Feature, selection: FeatureSelection): void {
    this.assertOpen()
    this.installFeatureRecursive(feature, selection, new Set())
  }

  /** Replace one installed builtin's feature-option and captured-input selection. */
  configureFeature(feature: Feature, selection: FeatureSelection): void {
    this.assertOpen()
    const current = this.state(feature)
    if (current.state === 'inconsistent') throw new Error(`feature ${feature.id} is inconsistent`)
    if (current.state === 'absent' || !current.selection) {
      this.installFeature(feature, selection)
      return
    }
    const normalized = feature.normalizeSelection(selection, this.profile)
    this.ensureRequirements(feature, normalized, new Set([feature.id]))
    this.replaceContribution(
      feature.contribution(current.selection, this.profile),
      feature.contribution(normalized, this.profile),
    )
    current.selection = normalized
    current.state = current.state !== 'disabled' ? 'enabled' : 'disabled'
    if (current.state === 'disabled') this.setFeatureDisabled(feature, normalized, true)
    this.assertFeatureConsistent(feature)
    this.configured.add(feature.id)
  }

  /** Enable all entries owned by one installed feature. */
  enableFeature(feature: Feature): void {
    this.assertOpen()
    const current = this.state(feature)
    if (current.state === 'inconsistent') throw new Error(`feature ${feature.id} is inconsistent`)
    if (current.state === 'absent' || !current.selection) {
      throw new Error(`feature ${feature.id} is not installed`)
    }
    this.setFeatureDisabled(feature, current.selection, false)
    current.state = 'enabled'
    this.assertFeatureConsistent(feature)
    this.disabled.delete(feature.id)
    this.enabled.add(feature.id)
  }

  /** Disable an optional feature without removing its configuration. */
  disableFeature(feature: Feature): void {
    this.assertOpen()
    if (feature.required) throw new Error(`required feature ${feature.id} cannot be disabled`)
    const current = this.state(feature)
    if (current.state === 'inconsistent') throw new Error(`feature ${feature.id} is inconsistent`)
    if (current.state === 'absent' || !current.selection) {
      throw new Error(`feature ${feature.id} is not installed`)
    }
    const dependent = this.registry.all().find((candidate) => {
      const state = this.states.get(candidate.id)
      return state?.state === 'enabled' && state.selection
        && candidate.requirements(state.selection).some(requirement => requirement.id === feature.id)
    })
    if (dependent) throw new Error(`feature ${feature.id} is required by ${dependent.id}`)
    this.setFeatureDisabled(feature, current.selection, true)
    current.state = 'disabled'
    this.assertFeatureConsistent(feature)
    this.enabled.delete(feature.id)
    this.disabled.add(feature.id)
  }

  /** Add a generated local plugin and all four of its project registrations. */
  addPlugin(blueprint: LocalPluginBlueprint): void {
    this.assertOpen()
    const manifest = this.manifest()
    const cordis = this.cordis()
    const tsconfig = this.documents.get('tsconfig.json')
    if (!(tsconfig instanceof TsConfigFile)) {
      throw new Error('adding a local plugin requires a valid tsconfig.json')
    }
    const packageName = blueprint.packageName(this.profile.name)
    if (manifest.npmDependency(packageName)) throw new Error(`root NPM dependency already exists: ${packageName}`)
    const entry = blueprint.cordisConfigEntry(this.profile.name)
    if (cordis.entry(entry.id)) throw new Error(`Cordis config entry already exists: ${entry.id}`)
    const documents = blueprint.documents(this.profile.name, this.profile.releaseVersion)
    for (const document of documents) {
      if (this.documents.has(document.relativePath)) {
        throw new Error(`local plugin file already exists: ${document.relativePath}`)
      }
    }
    for (const document of documents) this.documents.set(document.relativePath, document)
    manifest.setNpmDependency('dependencies', packageName, this.profile.packageManager.localPluginSpec())
    tsconfig.addReference(`./${blueprint.directory}`)
    cordis.addEntry(entry)
    this.addedPlugins.add(entry.id)
  }

  /**
   * Mount a Cordis entry for an external dependency the package manager has already
   * added (github or npm), without generating files or re-adding the dependency.
   * @param id - stable Cordis config entry id.
   * @param packageName - the installed dependency's package name.
   */
  addExternalPlugin(id: string, packageName: string): void {
    this.assertOpen()
    if (!this.manifest().npmDependency(packageName)) {
      throw new Error(`external plugin dependency is not installed: ${packageName}`)
    }
    const cordis = this.cordis()
    if (cordis.entry(id)) throw new Error(`Cordis config entry already exists: ${id}`)
    cordis.addEntry({ id, name: packageName })
    this.addedPlugins.add(id)
  }

  /** Enable or disable one custom/manual Cordis config entry by stable id. */
  setCustomPluginDisabled(id: string, disabled: boolean): void {
    this.assertOpen()
    const entry = this.cordis().entry(id)
    if (!entry) throw new Error(`Cordis config entry does not exist: ${id}`)
    if (this.registry.ownerOfPackage(entry.name, this.profile)) {
      throw new Error(`Cordis config entry ${id} belongs to a builtin feature`)
    }
    this.cordis().setDisabled(id, disabled)
    if (disabled) {
      this.enabledPlugins.delete(id)
      this.disabledPlugins.add(id)
    } else {
      this.disabledPlugins.delete(id)
      this.enabledPlugins.add(id)
    }
  }

  /** Summarize all pending domain and file changes. */
  changes(): ChangeSet {
    const changedFiles = new Set<string>()
    for (const [path, document] of this.documents) {
      if (this.source.origin === 'create' || !sameText(document, this.source.document(path))) changedFiles.add(path)
    }
    for (const path of this.removed.keys()) changedFiles.add(path)
    return {
      addedFeatures: [...this.added].sort(),
      enabledFeatures: [...this.enabled].sort(),
      disabledFeatures: [...this.disabled].sort(),
      configuredFeatures: [...this.configured].sort(),
      addedPlugins: [...this.addedPlugins].sort(),
      enabledPlugins: [...this.enabledPlugins].sort(),
      disabledPlugins: [...this.disabledPlugins].sort(),
      changedFiles: [...changedFiles].sort(),
      npmDependenciesChanged: npmDependencyShape(this.manifest().value())
        !== npmDependencyShape(this.source.packageManifest()),
    }
  }

  /** Validate, detect external edits, write affected files, and return a fresh snapshot. */
  async commit(): Promise<ProjectCommitResult<SdkProject>> {
    this.assertOpen()
    if (this.profile.linkWorkspaceRoot) {
      const workspace = await LinkWorkspace.open(this.profile.linkWorkspaceRoot)
      workspace.apply(
        this.source.root,
        this.manifest(),
        this.profile.packageManager,
        [...this.documents.values()],
      )
    }
    this.validateFinalState()
    const changes = this.changes()
    await this.assertUnchanged(changes.changedFiles)
    await mkdir(this.source.root, { recursive: true })
    for (const path of changes.changedFiles) {
      const document = this.documents.get(path)
      const absolute = resolve(this.source.root, path)
      if (!document) {
        await unlink(absolute)
        continue
      }
      await mkdir(dirname(absolute), { recursive: true })
      await writeFile(absolute, document.serialize(), {
        encoding: 'utf8',
        ...document.createMode === undefined ? {} : { mode: document.createMode },
      })
    }
    this.committed = true
    return { project: await this.source.reopen(), changes }
  }

  private installFeatureRecursive(
    feature: Feature,
    selection: FeatureSelection,
    stack: Set<FeatureId>,
  ): void {
    if (stack.has(feature.id)) throw new Error(`cyclic feature requirement involving ${feature.id}`)
    const current = this.state(feature)
    if (current.state === 'inconsistent') throw new Error(`feature ${feature.id} is inconsistent`)
    if (current.state !== 'absent' && current.selection) {
      this.configureFeature(feature, selection)
      if (current.state === 'disabled') this.enableFeature(feature)
      return
    }
    const normalized = feature.normalizeSelection(selection, this.profile)
    const nextStack = new Set(stack).add(feature.id)
    this.ensureRequirements(feature, normalized, nextStack)
    this.replaceContribution(undefined, feature.contribution(normalized, this.profile))
    current.selection = normalized
    current.state = 'enabled'
    this.assertFeatureConsistent(feature)
    this.added.add(feature.id)
  }

  private ensureRequirements(feature: Feature, selection: FeatureSelection, stack: Set<FeatureId>): void {
    for (const requirement of feature.requirements(selection)) {
      const required = this.registry.get(requirement.id)
      const state = this.state(required)
      if (state.state === 'inconsistent') throw new Error(`required feature ${required.id} is inconsistent`)
      if (state.state === 'absent' || !state.selection) {
        this.installFeatureRecursive(required, {
          id: required.id,
          options: requirement.options ?? required.defaultOptions(this.profile),
        }, stack)
      } else {
        const next = this.selectionWithRequiredOptions(required, state.selection, requirement)
        if (next !== state.selection) this.configureFeature(required, next)
        if (state.state === 'disabled') this.enableFeature(required)
      }
    }
  }

  private selectionWithRequiredOptions(
    feature: Feature,
    selection: FeatureSelection,
    requirement: FeatureRequirement,
  ): FeatureSelection {
    if (!requirement.options || requirement.options.every(option => selection.options.includes(option))) {
      return selection
    }
    if (feature.mode !== 'multiple') {
      throw new Error(`${feature.id} does not satisfy the option requirement from another feature`)
    }
    return { ...selection, options: [...new Set([...selection.options, ...requirement.options])] }
  }

  private replaceContribution(
    previous: ReturnType<Feature['contribution']> | undefined,
    next: ReturnType<Feature['contribution']>,
  ): void {
    const previousByKey = previous?.byKey() ?? new Map<ResourceKey, ProjectResource>()
    const nextByKey = next.byKey()
    for (const [key, resource] of previousByKey) {
      const replacement = nextByKey.get(key)
      if (!replacement || !canUpdateResource(resource, replacement)) this.removeResource(resource)
    }
    for (const [key, resource] of nextByKey) {
      const previousResource = previousByKey.get(key)
      this.applyResource(
        resource,
        previousResource && canUpdateResource(previousResource, resource) ? previousResource : undefined,
      )
    }
  }

  private applyResource(resource: ProjectResource, previous: ProjectResource | undefined): void {
    switch (resource.kind) {
      case 'npm-dependency': {
        const dependency = resolveNpmDependency(resource.name, resource.section, this.profile.releaseVersion)
        this.manifest().setNpmDependency(dependency.section, resource.name, dependency.spec)
        return
      }
      case 'package-script': {
        const manifest = this.manifest()
        const current = manifest.script(resource.name)
        if (!previous || previous.kind !== 'package-script') {
          if (current !== undefined) throw new Error(`feature-owned package script already exists: ${resource.name}`)
          manifest.setScript(resource.name, resource.command)
          return
        }
        if (current === resource.command) return
        if (current !== previous.command) {
          throw new Error(`feature-owned package script was modified: ${resource.name}`)
        }
        manifest.setScript(resource.name, resource.command)
        return
      }
      case 'cordis-config-entry': {
        const current = this.cordis().entry(resource.entry.id)
        if (!current) this.cordis().addEntry(resource.entry, resource.commentedExample)
        else {
          if (current.name !== resource.entry.name) {
            throw new Error(`Cordis config entry ${resource.entry.id} is owned by ${current.name}, not ${resource.entry.name}`)
          }
          this.cordis().updateOwnedConfig(
            resource.entry.id,
            resource.ownedConfigKeys,
            resource.entry.config ?? {},
          )
          this.cordis().setDisabled(resource.entry.id, false)
        }
        return
      }
      case 'environment': {
        this.environment('.env.example').set(resource.name, resource.exampleValue)
        /* v8 ignore else -- an omitted secret intentionally materializes only its example placeholder */
        if (resource.value !== undefined) {
          const environment = this.environment('.env')
          environment.append(
            resource.name,
            resource.value,
            resource.value === '' ? resource.comment : undefined,
          )
        }
        return
      }
      case 'owned-file': {
        const existing = this.documents.get(resource.document.relativePath)
        if (!existing) {
          this.documents.set(resource.document.relativePath, resource.document.clone())
          this.removed.delete(resource.document.relativePath)
          return
        }
        if (!previous || previous.kind !== 'owned-file') {
          throw new Error(`feature-owned file already exists: ${resource.document.relativePath}`)
        }
        if (previous.document.serialize() === resource.document.serialize()) return
        if (existing.serialize() !== previous.document.serialize()) {
          throw new Error(`feature-owned file was modified: ${resource.document.relativePath}`)
        }
        this.documents.set(resource.document.relativePath, resource.document.clone())
        this.removed.delete(resource.document.relativePath)
        return
      }
    }
  }

  private removeResource(resource: ProjectResource): void {
    switch (resource.kind) {
      case 'npm-dependency':
        this.manifest().removeNpmDependency(resource.section, resource.name)
        return
      case 'package-script': {
        const manifest = this.manifest()
        const current = manifest.script(resource.name)
        if (current === undefined) throw new Error(`owned package script is missing: ${resource.name}`)
        if (resource.removeOnlyWhenUnchanged && current !== resource.command) {
          throw new Error(`feature-owned package script was modified: ${resource.name}`)
        }
        manifest.removeScript(resource.name)
        return
      }
      case 'cordis-config-entry': {
        const entry = this.cordis().entry(resource.entry.id)
        if (!entry || entry.name !== resource.entry.name) {
          throw new Error(`cannot confirm old Cordis resource ${resource.entry.id}`)
        }
        this.cordis().removeEntry(resource.entry.id)
        return
      }
      case 'environment':
        this.environment('.env.example').remove(resource.name)
        return
      case 'owned-file': {
        const document = this.documents.get(resource.document.relativePath)
        if (!document) throw new Error(`owned file is missing: ${resource.document.relativePath}`)
        if (resource.removeOnlyWhenUnchanged && document.serialize() !== resource.document.serialize()) {
          throw new Error(`owned file was modified: ${resource.document.relativePath}`)
        }
        this.documents.delete(resource.document.relativePath)
        if (this.source.document(resource.document.relativePath)) {
          this.removed.set(resource.document.relativePath, document)
        }
      }
    }
  }

  private setFeatureDisabled(feature: Feature, selection: FeatureSelection, disabled: boolean): void {
    for (const resource of feature.contribution(selection, this.profile).resources) {
      if (resource.kind === 'cordis-config-entry') this.cordis().setDisabled(resource.entry.id, disabled)
    }
  }

  private validateFinalState(): void {
    for (const document of this.documents.values()) document.validate()
    const profile = this.finalProfile()
    const view = this.projectView(profile)
    for (const feature of this.registry.all()) {
      const state = this.states.get(feature.id)
      /* v8 ignore next 5 -- no current built-in feature is interface-specific */
      if (!feature.isApplicable(profile)) {
        if (state?.state === 'enabled') {
          throw new Error(`feature ${feature.id} is not available for ${profile.runInterface}`)
        }
        continue
      }
      const installation = feature.inspect(view)
      /* v8 ignore next 3 -- public domain commands assert feature consistency before final validation */
      if (installation.state === 'inconsistent') {
        throw new Error(`feature ${feature.id} is inconsistent: ${installation.diagnostics.join('; ')}`)
      }
      /* v8 ignore next 3 -- required features are installed by creation and cannot be disabled by public commands */
      if (feature.required && installation.state !== 'enabled') {
        throw new Error(`required feature ${feature.id} must be installed and enabled`)
      }
      if (installation.state !== 'enabled' || !installation.selection) continue
      for (const requirement of feature.requirements(installation.selection)) {
        const required = this.registry.get(requirement.id).inspect(view)
        /* v8 ignore next 3 -- ensureRequirements establishes enabled requirements before contributions change */
        if (required.state !== 'enabled') {
          throw new Error(`feature ${feature.id} requires enabled ${requirement.id}`)
        }
        for (const option of requirement.options ?? []) {
          /* v8 ignore next 3 -- selectionWithRequiredOptions establishes required options before commit */
          if (!required.options.includes(option)) {
            throw new Error(`feature ${feature.id} requires ${requirement.id} option ${option}`)
          }
        }
      }
    }
  }

  private assertFeatureConsistent(feature: Feature): void {
    const installation = feature.inspect(this)
    /* v8 ignore next 3 -- resource application either succeeds completely or throws at the owning operation */
    if (installation.state === 'inconsistent') {
      throw new Error(`feature ${feature.id} is inconsistent: ${installation.diagnostics.join('; ')}`)
    }
  }

  private finalProfile(): ProjectProfile {
    const runInterface = this.states.get(featureId('app'))?.selection?.options[0]
    if (runInterface !== 'acp' && runInterface !== 'embed') return this.profile
    return { ...this.profile, runInterface }
  }

  private projectView(profile: ProjectProfile): FeatureProjectView {
    return {
      profile,
      cordisConfigEntries: () => this.cordisConfigEntries(),
      packageManifest: () => this.packageManifest(),
      hasDocument: path => this.hasDocument(path),
      readEnvironment: (path, name) => this.readEnvironment(path, name),
    }
  }

  private async assertUnchanged(paths: readonly string[]): Promise<void> {
    for (const path of paths) {
      const source = this.source.document(path)
      const absolute = resolve(this.source.root, path)
      try {
        const current = await readFile(absolute, 'utf8')
        if (source?.originalText === undefined || current !== source.originalText) {
          throw new Error(`project file changed outside this edit session: ${path}`)
        }
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code === 'ENOENT' && source?.originalText === undefined) continue
        if (error instanceof Error && error.message.startsWith('project file changed outside')) throw error
        throw new Error(`cannot verify project file ${path}: ${asError(error).message}`)
      }
    }
  }

  private state(feature: Feature): MutableFeatureState {
    const state = this.states.get(feature.id)
    if (!state) throw new Error(`feature ${feature.id} is not applicable to this project`)
    return state
  }

  private manifest(): PackageJsonFile {
    const document = this.documents.get('package.json')
    if (!(document instanceof PackageJsonFile)) throw new Error('project package.json is missing')
    return document
  }

  private cordis(): CordisYamlFile {
    const document = this.documents.get('cordis.yml')
    if (!(document instanceof CordisYamlFile)) throw new Error('project cordis.yml is missing')
    return document
  }

  private environment(path: '.env' | '.env.example'): EnvFile {
    const existing = this.documents.get(path)
    if (existing instanceof EnvFile) return existing
    if (existing) throw new Error(`${path} is not an environment document`)
    const document = EnvFile.create(path)
    this.documents.set(path, document)
    return document
  }

  private assertOpen(): void {
    if (this.committed) throw new Error('project edit session has already committed')
  }
}
