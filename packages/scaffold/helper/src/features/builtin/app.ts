/**
 * Required run-interface app feature.
 *
 * @module @deepseek-ai/dsh-helper/features/builtin/app
 */

import { featureId } from '../../ids.ts'
import type { ProjectProfile, RunInterface } from '../../project/types.ts'
import {
  createAppPackageScripts,
  createAppProjectArtifacts,
  createProjectTemplateContext,
} from '../../templates/project-template.ts'
import {
  FeatureOption,
  ExclusiveOptionFeature,
} from '../feature.ts'
import { ProjectContribution, type ProjectResource } from '../resources.ts'
import {
  npmCordisConfigEntry,
  ownedTextFile,
  packageScript,
  requiredString,
} from './helpers.ts'

const ID = featureId('app')

function appProjectResources(
  profile: ProjectProfile,
  runInterface: RunInterface,
): readonly ProjectResource[] {
  const context = createProjectTemplateContext(profile, runInterface)
  const scripts = createAppPackageScripts()
  return [
    ...createAppProjectArtifacts(context).map(document => (
      ownedTextFile(ID, document.relativePath, document.serialize())
    )),
    packageScript(ID, 'dev', scripts.dev),
    packageScript(ID, 'start', scripts.start),
  ]
}

class AppOption extends FeatureOption {
  override readonly id: RunInterface
  override readonly label: string

  constructor(id: RunInterface, label: string) {
    super()
    this.id = id
    this.label = label
  }

  /** Identify options by their unique front door, not the shared interaction service. */
  override markerConfigEntries(): readonly { id: string; name: string }[] {
    switch (this.id) {
      case 'acp': return [{ id: 'acp', name: '@deepseek-ai/dsh-acp' }]
      case 'embed': return []
    }
  }

  /** Embed is identified by the configured loop with no external front door. */
  override matchesConfigEntries(entries: readonly { id: string; name: string }[], profile: ProjectProfile): boolean {
    if (this.id !== 'embed') return super.matchesConfigEntries(entries, profile)
    return entries.some(entry => entry.id === 'agent-loop' && entry.name === '@deepseek-ai/dsh-agent-loop')
      && !entries.some(entry => entry.name === '@deepseek-ai/dsh-acp')
  }

  override contribution(profile: ProjectProfile): ProjectContribution {
    switch (this.id) {
      case 'acp':
        return new ProjectContribution([
          ...appProjectResources(profile, this.id),
          ...npmCordisConfigEntry(ID, {
            id: 'acp',
            name: '@deepseek-ai/dsh-acp',
            config: { model: profile.runtime.model },
          }, ['model'], config => requiredString(config, 'model')),
        ])
      case 'embed':
        return new ProjectContribution(appProjectResources(profile, this.id))
    }
  }
}

/** Required app selection represented by ACP or embed options. */
export class AppFeature extends ExclusiveOptionFeature {
  override readonly id = ID
  override readonly summary = 'Run interface'
  override readonly required = true
  override readonly requires = [featureId('spine')]
  override readonly options = [
    new AppOption('acp', 'ACP automation server'),
    new AppOption('embed', 'Embedded context'),
  ]

  /** Default to the profile's already selected front door. */
  override defaultOptions(profile: ProjectProfile): readonly string[] {
    return [profile.runInterface]
  }
}
