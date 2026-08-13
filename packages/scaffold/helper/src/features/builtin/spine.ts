/**
 * Required agent-spine feature expressed as top-level Cordis config entries.
 *
 * @module @deepseek-ai/dsh-helper/features/builtin/spine
 */

import { featureId } from '../../ids.ts'
import type { ProjectProfile } from '../../project/types.ts'
import { loadHelperTemplate } from '../../templates/template-assets.ts'
import { FeatureOption, FixedFeature } from '../feature.ts'
import { ProjectContribution } from '../resources.ts'
import { cordisConfigEntry, npmCordisConfigEntry, requiredString } from './helpers.ts'

const ID = featureId('spine')
const PERSONA = loadHelperTemplate<Record<string, never>>('persona.txt.tpl').render({}).trimEnd()

function emptyAgentsDiagnostics(config: Readonly<Record<string, unknown>>): string[] {
  const agents = config.agents
  if (!Array.isArray(agents)) return ['agents must be an array']
  return agents.length !== 0 ? ['agents must be empty'] : []
}

class SpineOption extends FeatureOption {
  override readonly id = 'default'
  override readonly label = 'Default agent spine'

  override contribution(_profile: ProjectProfile): ProjectContribution {
    return new ProjectContribution([
      ...npmCordisConfigEntry(ID, { id: 'timer', name: '@cordisjs/plugin-timer' }),
      ...npmCordisConfigEntry(ID, { id: 'llm', name: '@deepseek-ai/dsh-llm' }),
      ...npmCordisConfigEntry(ID, { id: 'session', name: '@deepseek-ai/dsh-session' }),
      ...npmCordisConfigEntry(ID, {
        id: 'system-prompt',
        name: '@deepseek-ai/dsh-system-prompt',
        config: { persona: PERSONA },
      }, ['persona'], config => requiredString(config, 'persona')),
      ...npmCordisConfigEntry(ID, { id: 'tools', name: '@deepseek-ai/dsh-tools' }, []),
      ...npmCordisConfigEntry(ID, { id: 'agent', name: '@deepseek-ai/dsh-agent' }),
      ...npmCordisConfigEntry(ID, { id: 'invariants', name: '@deepseek-ai/dsh-invariants' }),
      cordisConfigEntry(ID, { id: 'session-invariant', name: '@deepseek-ai/dsh-session/invariant' }),
      cordisConfigEntry(ID, { id: 'agent-invariant', name: '@deepseek-ai/dsh-agent/invariant' }),
      ...npmCordisConfigEntry(ID, { id: 'scope-invariant', name: '@deepseek-ai/dsh-scope/invariant' }),
      cordisConfigEntry(ID, { id: 'agent-loop-invariant', name: '@deepseek-ai/dsh-agent-loop/invariant' }),
      ...npmCordisConfigEntry(ID, {
        id: 'agent-loop',
        name: '@deepseek-ai/dsh-agent-loop',
        config: { agents: [] },
      }, ['agents'], emptyAgentsDiagnostics),
    ])
  }
}

/** Required providerless agent spine without a composition bundle entry. */
export class SpineFeature extends FixedFeature {
  override readonly id = ID
  override readonly summary = 'Agent runtime spine'
  override readonly required = true
  override readonly options = [new SpineOption()]
}
