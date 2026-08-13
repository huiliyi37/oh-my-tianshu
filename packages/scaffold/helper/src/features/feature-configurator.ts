/**
 * Shared option and secret question flow for create and config.
 *
 * @module @deepseek-ai/dsh-helper/features/feature-configurator
 */

import type { Feature } from './feature.ts'
import type { FeatureSelection, ProjectProfile } from '../project/types.ts'
import type { PromptPort } from '../questions/prompt-port.ts'
import { requireAnswer } from '../questions/prompt-port.ts'
import { MultiSelectQuestion, SecretQuestion, SelectQuestion, TextQuestion } from '../questions/question.ts'

/** Resolve one feature selection without knowing which workflow requested it. */
export class FeatureConfigurator {
  private readonly port: PromptPort

  /** Bind the configurator to the shared prompt boundary. */
  constructor(port: PromptPort) {
    this.port = port
  }

  /**
   * Ask option and input questions, preserving current secrets on empty input.
   * @param feature - feature whose options and inputs are collected.
   * @param profile - target project context.
   * @param current - currently installed selection, when configuring.
   * @param prefilledOptions - options already chosen by a tree picker.
   * @param prefilledSecrets - non-interactive secret values supplied by creation.
   * @param prefilledValues - non-interactive value inputs supplied by a headless spec.
   * @returns normalized selection with captured values and secrets.
   */
  async configure(
    feature: Feature,
    profile: ProjectProfile,
    current?: FeatureSelection,
    prefilledOptions?: readonly string[],
    prefilledSecrets: Readonly<Record<string, string>> = {},
    prefilledValues: Readonly<Record<string, unknown>> = {},
  ): Promise<FeatureSelection> {
    let options: readonly string[]
    switch (feature.mode) {
      case 'single':
        options = feature.defaultOptions(profile)
        break
      case 'exclusive': {
        const initialValue = current?.options[0] ?? feature.defaultOptions(profile)[0]
        if (initialValue === undefined) throw new Error(`feature ${feature.id} has no default option`)
        const question = new SelectQuestion({
          id: `${feature.id}.option`,
          message: `Choose ${feature.summary.toLowerCase()}`,
          options: feature.options.map(option => ({ value: option.id, label: option.label })),
          initialValue,
        })
        const prefilled = prefilledOptions?.[0]
        options = [requireAnswer(await question.resolve(this.port, prefilled))]
        break
      }
      case 'multiple': {
        const question = new MultiSelectQuestion({
          id: `${feature.id}.options`,
          message: `Choose ${feature.summary.toLowerCase()}`,
          options: feature.options.map(option => ({ value: option.id, label: option.label })),
          initialValues: current?.options ?? feature.defaultOptions(profile),
          required: true,
        })
        options = requireAnswer(await question.resolve(this.port, prefilledOptions))
        break
      }
    }
    const selected: FeatureSelection = {
      id: feature.id,
      options,
    }
    const coercedPrefilled: Record<string, string> = {}
    for (const [key, value] of Object.entries(prefilledValues)) {
      if (typeof value !== 'string') throw new Error(`${feature.id}.${key} value must be a string`)
      coercedPrefilled[key] = value
    }
    const values: Record<string, string> = {}
    for (const input of feature.valueInputs(selected, profile)) {
      const existing = current?.values?.[input.id]
      if (existing !== undefined && typeof existing !== 'string') {
        throw new Error(`${feature.id}.${input.id} current value must be a string`)
      }
      const question = new TextQuestion({
        id: `${feature.id}.${input.id}`,
        message: input.message,
        ...existing === undefined ? {} : { initialValue: existing },
        validate: value => value.trim().length === 0 ? 'A value is required' : undefined,
      })
      values[input.id] = requireAnswer(await question.resolve(this.port, coercedPrefilled[input.id]))
    }
    const base: FeatureSelection = Object.keys(values).length === 0
      ? selected
      : { ...selected, values }
    const secrets = { ...current?.secrets }
    for (const secret of feature.secrets(base, profile)) {
      const existing = secrets[secret.id]
      const question = new SecretQuestion({
        id: `${feature.id}.${secret.id}`,
        message: existing === undefined ? secret.message : `${secret.message} (leave empty to keep current)`,
        validate: value => secret.required && existing === undefined && value.length === 0
          ? 'A value is required'
          : undefined,
      })
      const answer = requireAnswer(await question.resolve(this.port, prefilledSecrets[secret.id]))
      if (answer.length > 0) secrets[secret.id] = answer
    }
    return Object.keys(secrets).length === 0 ? base : { ...base, secrets }
  }
}
