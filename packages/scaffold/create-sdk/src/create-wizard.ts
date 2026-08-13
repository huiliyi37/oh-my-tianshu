/**
 * Declarative create questions with dynamic feature and plugin orchestration.
 *
 * @module @deepseek-ai/create-sdk/create-wizard
 */

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  FeatureConfigurator,
  ConfirmQuestion,
  LocalPluginBlueprint,
  NpmPackageManager,
  SelectQuestion,
  featureId,
  createBuiltinRegistry,
  createPackageManager,
  inferPackageManagerName,
  probePackageManagerVersion,
  requireAnswer,
  type FeatureRegistry,
  type FeatureSelection,
  type LocalPluginKind,
  type PackageManager,
  type PackageManagerName,
  type PackageManagerVersionProbe,
  type ProjectCreationRequest,
  type ProjectProfile,
  type PromptPort,
} from '@deepseek-ai/dsh-helper'
import type { CreateArgs } from './args.ts'
import { collectProjectAnswers, type ProjectAnswers } from './create-questions.ts'
import { CREATE_TEMPLATES, packageManagerTemplateModel } from './templates/create-templates.ts'

/** Fully resolved initializer request and post-create choice. */
export interface ResolvedCreateRequest {
  directory: string
  request: ProjectCreationRequest
  install: boolean
}

/** Create-specific orchestration around declarative questions and dynamic selections. */
export class CreateWizard {
  private readonly args: CreateArgs
  private readonly port: PromptPort
  private readonly cwd: string
  private readonly releaseVersion: string
  private readonly versionProbe: PackageManagerVersionProbe
  private readonly userAgent: string
  private readonly linkWorkspaceRoot: string | undefined
  private readonly featurePlan: readonly FeatureSelection[] | undefined

  /** Bind parsed args and infrastructure to one wizard run. */
  constructor(options: {
    args: CreateArgs
    port: PromptPort
    cwd?: string
    releaseVersion: string
    versionProbe?: PackageManagerVersionProbe
    userAgent?: string
    features?: readonly FeatureSelection[]
  }) {
    this.args = options.args
    this.port = options.port
    this.cwd = resolve(options.cwd ?? process.cwd())
    this.releaseVersion = options.releaseVersion
    this.versionProbe = options.versionProbe ?? probePackageManagerVersion
    /* v8 ignore next -- pnpm supplies npm_config_user_agent while direct invocations may omit it */
    this.userAgent = options.userAgent ?? process.env.npm_config_user_agent ?? ''
    this.linkWorkspaceRoot = options.args.linkWorkspace
      ? fileURLToPath(new URL('../../../../', import.meta.url))
      : undefined
    this.featurePlan = options.features
  }

  /** Collect all answers before constructing any project files. */
  async run(): Promise<ResolvedCreateRequest> {
    const answers = await this.collectProjectAnswers()
    const profile = this.provisionalProfile(answers)
    const registry = createBuiltinRegistry(profile)
    const features = await this.collectFeatures(profile, registry, answers)
    const localPlugins = await this.collectPlugins()
    const { manager, install } = await this.collectPackageManager()
    return {
      directory: answers.directory,
      install,
      request: {
        name: answers.name,
        description: answers.description,
        runtime: { model: answers.model },
        packageManager: manager,
        releaseVersion: this.releaseVersion,
        ...this.linkWorkspaceRoot ? { linkWorkspaceRoot: this.linkWorkspaceRoot } : {},
        features,
        localPlugins,
      },
    }
  }

  private async collectProjectAnswers(): Promise<ProjectAnswers> {
    return collectProjectAnswers(this.port, this.args, this.cwd)
  }

  private provisionalProfile(answers: ProjectAnswers): ProjectProfile {
    return {
      name: answers.name,
      description: answers.description,
      runtime: { model: answers.model },
      runInterface: answers.runInterface,
      packageManager: new NpmPackageManager('10.0.0'),
      releaseVersion: this.releaseVersion,
      ...this.linkWorkspaceRoot ? { linkWorkspaceRoot: this.linkWorkspaceRoot } : {},
    }
  }

  private async collectFeatures(
    profile: ProjectProfile,
    registry: FeatureRegistry,
    answers: ProjectAnswers,
  ): Promise<FeatureSelection[]> {
    const configurator = new FeatureConfigurator(this.port)
    const selections: FeatureSelection[] = [
      {
        id: featureId('provider'),
        options: [answers.provider],
        ...answers.baseURL ? { values: { baseURL: answers.baseURL } } : {},
        secrets: { apiKey: answers.apiKey },
      },
      { id: featureId('spine'), options: ['default'] },
      { id: featureId('app'), options: [answers.runInterface] },
    ]
    const configurable = registry.all().filter(feature => feature.id === 'bash'
      || feature.id === 'persistence'
      || (!feature.required && feature.isApplicable(profile)))
    const selected = this.featurePlan
      ? this.featurePlan.map(feature => ({ value: feature.id, choices: feature.options }))
      : [...requireAnswer(await this.port.nestedMultiselect({
        message: 'Select features',
        options: configurable.map((feature) => {
          const nested = feature.mode !== 'single'
          const defaults = new Set(feature.defaultOptions(profile))
          return {
            value: feature.id,
            label: feature.summary,
            required: feature.required,
            default: feature.required || feature.id === 'hmr' || feature.id === 'fs' || feature.id === 'todo'
              || feature.id === 'skill',
            ...nested ? {
              choiceMode: feature.mode === 'multiple' ? 'multiple' as const : 'exclusive' as const,
              choices: feature.options.map(option => ({
                value: option.id,
                label: option.label,
                default: defaults.has(option.id),
              })),
            } : {},
          }
        }),
      }))]
    if (!this.featurePlan) {
      for (const { value: id } of [...selected]) {
        const feature = registry.get(id)
        for (const suggestedId of feature.suggests) {
          if (selected.some(item => item.value === suggestedId)) continue
          const suggested = registry.get(suggestedId)
          const add = requireAnswer(await new ConfirmQuestion({
            id: `${feature.id}.${suggested.id}`,
            message: `Add the recommended ${suggested.summary.toLowerCase()} for ${feature.summary.toLowerCase()}?`,
            initialValue: true,
          }).resolve(this.port))
          if (add) selected.push({ value: suggested.id, choices: suggested.defaultOptions(profile) })
        }
      }
    }
    const fixed = new Set(selections.map(selection => selection.id))
    const choices = new Map<FeatureSelection['id'], readonly string[] | undefined>()
    for (const feature of registry.all()) {
      if (feature.required && feature.isApplicable(profile) && !fixed.has(feature.id)) {
        choices.set(feature.id, feature.defaultOptions(profile))
      }
    }
    for (const choice of selected) {
      choices.set(choice.value, choice.choices.length > 0 ? choice.choices : undefined)
    }
    const plannedById = new Map((this.featurePlan ?? []).map(feature => [feature.id, feature]))
    for (const [id, options] of choices) {
      const planned = plannedById.get(id)
      selections.push(await configurator.configure(
        registry.get(id),
        profile,
        undefined,
        options,
        planned?.secrets ?? {},
        planned?.values ?? {},
      ))
    }
    return selections
  }

  private async collectPlugins(): Promise<LocalPluginBlueprint[]> {
    const kind = requireAnswer(await new SelectQuestion<LocalPluginKind | 'none'>({
      id: 'plugins.kind',
      message: 'Local plugin',
      options: [
        { value: 'none', label: 'No local plugin' },
        { value: 'plugin', label: 'Cordis plugin' },
        { value: 'tool', label: 'Model-facing tool' },
      ],
      initialValue: 'none',
    }).resolve(this.port))
    return kind === 'none' ? [] : [new LocalPluginBlueprint(kind, kind)]
  }

  private async collectPackageManager(): Promise<{ manager: PackageManager; install: boolean }> {
    const inferred = inferPackageManagerName(this.args.packageManager, this.userAgent)
    const name = requireAnswer(await new SelectQuestion<PackageManagerName>({
      id: 'packageManager',
      message: 'Package manager',
      options: [
        { value: 'npm', label: 'npm' },
        { value: 'pnpm', label: 'pnpm' },
        { value: 'yarn', label: 'Yarn' },
      ],
      initialValue: inferred ?? 'npm',
    }).resolve(this.port, inferred))
    const manager = createPackageManager(name, await this.versionProbe(name, this.cwd))
    const install = requireAnswer(await new ConfirmQuestion({
      id: 'install',
      message: CREATE_TEMPLATES.installQuestion.render(packageManagerTemplateModel(manager)).trimEnd(),
      initialValue: true,
    }).resolve(this.port, this.args.install))
    return { manager, install }
  }
}
