/**
 * Required agent-spine feature expressed as top-level Cordis config entries.
 *
 * @module @huiliyi37/dsh-helper/features/builtin/spine
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
      ...npmCordisConfigEntry(ID, { id: 'timer', name: '@huiliyi37/cordis-plugin-timer' }),
      ...npmCordisConfigEntry(ID, { id: 'llm', name: '@huiliyi37/dsh-llm' }),
      ...npmCordisConfigEntry(ID, { id: 'session', name: '@huiliyi37/dsh-session' }),
      ...npmCordisConfigEntry(ID, {
        id: 'system-prompt',
        name: '@huiliyi37/dsh-system-prompt',
        config: { persona: PERSONA },
      }, ['persona'], config => requiredString(config, 'persona')),
      ...npmCordisConfigEntry(ID, { id: 'tools', name: '@huiliyi37/dsh-tools' }, []),
      ...npmCordisConfigEntry(ID, { id: 'agent', name: '@huiliyi37/dsh-agent' }),
      ...npmCordisConfigEntry(ID, { id: 'invariants', name: '@huiliyi37/dsh-invariants' }),
      cordisConfigEntry(ID, { id: 'session-invariant', name: '@huiliyi37/dsh-session/invariant' }),
      cordisConfigEntry(ID, { id: 'agent-invariant', name: '@huiliyi37/dsh-agent/invariant' }),
      ...npmCordisConfigEntry(ID, { id: 'scope-invariant', name: '@huiliyi37/dsh-scope/invariant' }),
      cordisConfigEntry(ID, { id: 'agent-loop-invariant', name: '@huiliyi37/dsh-agent-loop/invariant' }),
      ...npmCordisConfigEntry(ID, {
        id: 'agent-loop',
        name: '@huiliyi37/dsh-agent-loop',
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
