/**
 * Tree-shaped existing-project feature workflow and single Apply boundary.
 *
 * @module @deepseek-ai/dsh-scripts/config/config-workflow
 */

import type { Writable } from 'node:stream'
import {
  FeatureConfigurator,
  ConfirmQuestion,
  requireAnswer,
  type Feature,
  type FeatureInstallation,
  type FeatureRegistry,
  type FeatureSelection,
  type ChangeSet,
  type NestedMultiSelectValue,
  type ProjectCommitResult,
  type PromptPort,
  type RunInterface,
  type SdkProject,
} from '@deepseek-ai/dsh-helper'
import { DSH_SDK_TEMPLATES } from '../templates/dsh-sdk-templates.ts'

/** Config result, including an install failure that happened after commit. */
export interface ConfigWorkflowResult {
  commit?: ProjectCommitResult<SdkProject>
  installError?: Error
}

/**
 * Non-interactive desired end-state for a config run: the complete set of enabled
 * features, with options and any secrets/values a newly installed feature needs.
 * Features not listed are reconciled to disabled, exactly as an interactive tree
 * selection would be. Custom (non-feature) cordis plugins keep their current state;
 * toggling them headlessly is not yet supported.
 */
export interface ConfigPlan {
  features: readonly FeatureSelection[]
}

function featureTarget(feature: Feature): string {
  return `feature:${feature.id}`
}

function pluginTarget(id: string): string {
  return `plugin:${id}`
}

function sameOptions(left: readonly string[], right: readonly string[]): boolean {
  return [...left].sort().join('\0') === [...right].sort().join('\0')
}

function targetRunInterface(
  current: RunInterface,
  desired: ReadonlyMap<string, NestedMultiSelectValue<string, string>>,
): RunInterface {
  const selected = desired.get('feature:app')?.choices[0]
  return selected === 'acp' || selected === 'embed' ? selected : current
}

/** Reconcile one tree selection into domain commands, then review and commit once. */
export class ConfigWorkflow {
  private readonly port: PromptPort
  private readonly output: Writable
  private readonly install: (project: SdkProject) => Promise<void>

  /** Bind terminal prompts and descriptive output. */
  constructor(
    port: PromptPort,
    output: Writable = process.stdout,
    install: (project: SdkProject) => Promise<void> = project => project.profile.packageManager.install(project.root),
  ) {
    this.port = port
    this.output = output
    this.install = install
  }

  /** Select desired state, reconcile the working copy, review, and apply. */
  async run(project: SdkProject, registry: FeatureRegistry, plan?: ConfigPlan): Promise<ConfigWorkflowResult> {
    const edit = project.edit(registry)
    const configurator = new FeatureConfigurator(this.port)
    const features = registry.all().filter(feature => feature.isApplicable(project.profile))
    const inspections = new Map(edit.inspections().map(item => [item.id, item]))
    const custom = edit.cordisConfigEntries().filter(entry => !registry.ownerOfPackage(entry.name, project.profile))
    const desired = plan
      ? [
        ...plan.features.map(selection => ({
          value: featureTarget(registry.get(selection.id)),
          choices: selection.options,
        })),
        ...custom
          .filter(entry => !entry.disabled)
          .map(entry => ({ value: pluginTarget(entry.id), choices: [] as readonly string[] })),
      ]
      : requireAnswer(await this.port.nestedMultiselect<string, string>({
        message: 'Configure the project',
        showChanges: true,
        options: [
          ...features.map((feature) => {
            const installation = inspections.get(feature.id)
            /* v8 ignore next -- inspections() is built from this exact feature registry */
            if (!installation) throw new Error(`feature inspection is missing: ${feature.id}`)
            const inconsistent = installation.state === 'inconsistent'
            const selectedOptions = new Set(installation.options.length > 0
              ? installation.options
              : feature.defaultOptions(project.profile))
            return {
              value: featureTarget(feature),
              label: feature.summary,
              required: feature.required,
              default: feature.required || installation.state === 'enabled' || inconsistent,
              disabled: inconsistent,
              ...inconsistent ? { warning: installation.diagnostics.join('; ') } : {},
              ...feature.mode === 'single' ? {} : {
                choiceMode: feature.mode,
                choices: feature.options.map(option => ({
                  value: option.id,
                  label: option.label,
                  default: selectedOptions.has(option.id),
                })),
              },
            }
          }),
          ...custom.map(entry => ({
            value: pluginTarget(entry.id),
            label: `${entry.name} [custom]`,
            default: !entry.disabled,
          })),
        ],
      }))
    const desiredByTarget = new Map(desired.map(item => [item.value, item]))
    const targetProfile = {
      ...project.profile,
      runInterface: targetRunInterface(project.profile.runInterface, desiredByTarget),
    }
    for (const feature of features) {
      /* v8 ignore next -- no current built-in feature is interface-specific */
      if (!feature.isApplicable(targetProfile)) desiredByTarget.delete(featureTarget(feature))
    }

    const plannedById = new Map<FeatureSelection['id'], FeatureSelection>(
      (plan?.features ?? []).map(selection => [selection.id, selection]),
    )
    for (const feature of features) {
      const installation = inspections.get(feature.id)
      /* v8 ignore next -- inspections() is built from this exact feature registry */
      if (!installation) throw new Error(`feature inspection is missing: ${feature.id}`)
      if (installation.state === 'inconsistent') continue
      const choice = desiredByTarget.get(featureTarget(feature))
      if (!choice && !feature.required) continue
      await this.enableOrConfigure(feature, installation, choice, project, edit, configurator, plannedById.get(feature.id))
    }

    for (const feature of [...features].reverse()) {
      const installation = inspections.get(feature.id)
      /* v8 ignore next -- inspections() is built from this exact feature registry */
      if (!installation) throw new Error(`feature inspection is missing: ${feature.id}`)
      if (feature.required || installation.state !== 'enabled'
        || desiredByTarget.has(featureTarget(feature))) continue
      edit.disableFeature(feature)
    }

    for (const entry of custom) {
      const enabled = desiredByTarget.has(pluginTarget(entry.id))
      if (enabled === !entry.disabled) continue
      edit.setCustomPluginDisabled(entry.id, !enabled)
    }

    const changes = edit.changes()
    if (changes.changedFiles.length === 0) {
      this.output.write('No changes.\n')
      return {}
    }
    this.renderReview(changes)
    const apply = requireAnswer(await new ConfirmQuestion({
      id: 'config.apply', message: 'Apply these changes?', initialValue: true,
    }).resolve(this.port))
    if (!apply) return {}
    const commit = await edit.commit()
    if (!commit.changes.npmDependenciesChanged) return { commit }
    try {
      await this.install(project)
      return { commit }
    } catch (error) {
      const installError = error instanceof Error ? error : new Error(String(error))
      const manager = project.profile.packageManager
      this.output.write(DSH_SDK_TEMPLATES.configInstallFailure.render({
        error: installError.message,
        packageManager: manager.name,
        installArgs: manager.installCommand().join(' '),
      }))
      return { commit, installError }
    }
  }

  private async enableOrConfigure(
    feature: Feature,
    installation: FeatureInstallation,
    choice: NestedMultiSelectValue<string, string> | undefined,
    project: SdkProject,
    edit: ReturnType<SdkProject['edit']>,
    configurator: FeatureConfigurator,
    planned?: FeatureSelection,
  ): Promise<void> {
    const options = choice?.choices.length
      ? choice.choices
      : installation.options.length > 0
        ? installation.options
        : feature.defaultOptions(project.profile)
    if (installation.state === 'absent') {
      const selection = await configurator.configure(
        feature, project.profile, undefined, options, planned?.secrets ?? {}, planned?.values ?? {},
      )
      edit.installFeature(feature, selection)
      return
    }
    /* v8 ignore next -- non-absent/non-inconsistent inspections always carry their normalized selection */
    if (!installation.selection) throw new Error(`feature ${feature.id} has no readable selection`)
    if (!sameOptions(installation.options, options)) {
      const selection: FeatureSelection = await configurator.configure(
        feature, project.profile, installation.selection, options, planned?.secrets ?? {}, planned?.values ?? {},
      )
      edit.configureFeature(feature, selection)
    }
    if (installation.state === 'disabled') edit.enableFeature(feature)
  }

  private renderReview(changes: ChangeSet): void {
    const lines = [
      ...changes.addedFeatures.map(id => `Install feature: ${id}`),
      ...changes.enabledFeatures.map(id => `Enable feature: ${id}`),
      ...changes.disabledFeatures.map(id => `Disable feature: ${id}`),
      ...changes.configuredFeatures.map(id => `Configure feature: ${id}`),
      ...changes.enabledPlugins.map(id => `Enable custom plugin: ${id}`),
      ...changes.disabledPlugins.map(id => `Disable custom plugin: ${id}`),
      ...changes.changedFiles.map(path => `Change file: ${path}`),
    ]
    this.output.write(`${lines.join('\n')}\n`)
  }
}
