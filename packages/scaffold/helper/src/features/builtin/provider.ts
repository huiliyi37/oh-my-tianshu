/**
 * Required direct-fetch DeepSeek and custom pi-ai provider behavior.
 *
 * @module @deepseek-ai/dsh-helper/features/builtin/provider
 */

import { featureId } from '../../ids.ts'
import type { FeatureSelection, ProjectProfile } from '../../project/types.ts'
import {
  FeatureOption,
  ExclusiveOptionFeature,
  type FeatureProjectView,
} from '../feature.ts'
import { ProjectContribution } from '../resources.ts'
import { npmCordisConfigEntry, environment } from './helpers.ts'

const ID = featureId('provider')
const DEFAULT_MODEL = 'deepseek-v4-flash'
const API_KEY_COMMENT = 'Required before the first model request.'

class DeepSeekOption extends FeatureOption {
  override readonly id = 'deepseek-official'
  override readonly label = 'DeepSeek'
  override readonly secrets = [{
    id: 'apiKey',
    environment: 'DEEPSEEK_API_KEY',
    message: 'DeepSeek API key',
    required: true,
  }]

  override contribution(_profile: ProjectProfile, secrets: Readonly<Record<string, string>>): ProjectContribution {
    return new ProjectContribution([
      ...npmCordisConfigEntry(ID, {
        id: 'llm-deepseek',
        name: '@deepseek-ai/dsh-llm-deepseek',
      }, ['baseURL', 'models']),
      environment(ID, 'DEEPSEEK_API_KEY', secrets.apiKey, API_KEY_COMMENT),
    ])
  }
}

class CustomOption extends FeatureOption {
  override readonly id = 'custom'
  override readonly label = 'Custom endpoint (pi-ai)'
  override readonly secrets = [{
    id: 'apiKey',
    environment: 'DEEPSEEK_API_KEY',
    message: 'Custom provider API key',
    required: true,
  }]
  override readonly inputs = [{
    id: 'baseURL',
    message: 'Custom provider base URL',
  }]

  override contribution(_profile: ProjectProfile, secrets: Readonly<Record<string, string>>): ProjectContribution {
    return new ProjectContribution([
      ...npmCordisConfigEntry(ID, {
        id: 'llm-pi-ai',
        name: '@deepseek-ai/dsh-llm-pi-ai',
      }, ['baseURL', 'models']),
      environment(ID, 'DEEPSEEK_API_KEY', secrets.apiKey, API_KEY_COMMENT),
    ])
  }
}

/** Required provider feature with DeepSeek and custom pi-ai options. */
export class ProviderFeature extends ExclusiveOptionFeature {
  override readonly id = ID
  override readonly summary = 'Model provider'
  override readonly required = true
  override readonly options = [new DeepSeekOption(), new CustomOption()]

  /** Prefer the direct-fetch adapter and its public endpoint defaults. */
  override defaultOptions(): readonly string[] {
    return ['deepseek-official']
  }

  /** Recover literal endpoint overrides from either provider entry. */
  override readSelection(project: FeatureProjectView, selection: FeatureSelection): FeatureSelection {
    const base = super.readSelection(project, selection)
    const entry = project.cordisConfigEntries().find(item => item.id === 'llm-deepseek' || item.id === 'llm-pi-ai')
    const baseURL = entry?.config?.baseURL
    return typeof baseURL === 'string' ? { ...base, values: { baseURL } } : base
  }

  /** Apply explicit endpoint/model overrides while omitting provider defaults. */
  override contribution(selection: FeatureSelection, profile: ProjectProfile): ProjectContribution {
    const contribution = super.contribution(selection, profile)
    const baseURL = selection.values?.baseURL
    if (baseURL !== undefined && typeof baseURL !== 'string') throw new Error('provider baseURL must be a string')
    return new ProjectContribution(contribution.resources.map((resource) => {
      if (resource.kind !== 'cordis-config-entry' || (resource.entry.id !== 'llm-deepseek'
        && resource.entry.id !== 'llm-pi-ai')) return resource
      return {
        ...resource,
        entry: {
          ...resource.entry,
          config: {
            ...resource.entry.config,
            ...baseURL ? { baseURL } : {},
            ...profile.runtime.model === DEFAULT_MODEL ? {} : { models: [profile.runtime.model] },
          },
        },
      }
    }))
  }
}
