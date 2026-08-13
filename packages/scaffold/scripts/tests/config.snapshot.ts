import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import {
  NpmPackageManager,
  SdkProject,
  featureId,
  createBuiltinRegistry,
  type NestedMultiSelectValue,
  type PromptPort,
} from '@deepseek-ai/dsh-helper'
import type {
  ConfirmPromptRequest,
  MultiSelectPromptRequest,
  NestedMultiSelectRequest,
  PromptOutcome,
  SecretPromptRequest,
  SelectPromptRequest,
  TextPromptRequest,
} from '../../helper/src/questions/prompt-port.ts'
import { ConfigWorkflow } from '../src/config/config-workflow.ts'

class RecordingPort implements PromptPort {
  readonly transcript: unknown[] = []
  readonly #answers: unknown[]

  constructor(answers: unknown[]) { this.#answers = [...answers] }

  answer<T>(record: unknown): Promise<PromptOutcome<T>> {
    this.transcript.push(record)
    return Promise.resolve({ status: 'answered', value: this.#answers.shift() as T })
  }

  text(request: TextPromptRequest): Promise<PromptOutcome<string>> {
    return this.answer({ kind: 'text', message: request.message })
  }
  secret(request: SecretPromptRequest): Promise<PromptOutcome<string>> {
    return this.answer({ kind: 'secret', message: request.message })
  }
  select<T>(request: SelectPromptRequest<T>): Promise<PromptOutcome<T>> {
    return this.answer({
      kind: 'select', message: request.message,
      options: request.options.map(option => ({ value: option.value, label: option.label })),
    })
  }
  multiselect<T>(request: MultiSelectPromptRequest<T>): Promise<PromptOutcome<readonly T[]>> {
    return this.answer({ kind: 'multiselect', message: request.message })
  }
  confirm(request: ConfirmPromptRequest): Promise<PromptOutcome<boolean>> {
    return this.answer({ kind: 'confirm', message: request.message, initialValue: request.initialValue })
  }
  nestedMultiselect<TValue, TChoice>(
    request: NestedMultiSelectRequest<TValue, TChoice>,
  ): Promise<PromptOutcome<readonly NestedMultiSelectValue<TValue, TChoice>[]>> {
    return this.answer({
      kind: 'nested-multiselect',
      message: request.message,
      showChanges: request.showChanges,
      options: request.options.map(option => ({
        value: option.value,
        label: option.label,
        required: option.required,
        default: option.default,
        disabled: option.disabled,
        warning: option.warning,
        choiceMode: option.choiceMode,
        choices: option.choices?.map(choice => ({
          value: choice.value,
          label: choice.label,
          default: choice.default,
        })),
      })),
    })
  }
}

const temporary: string[] = []

afterEach(async () => {
  await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function baseProject(): Promise<SdkProject> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-config-snapshot-'))
  temporary.push(root)
  const request = {
    name: 'snapshot-agent',
    description: 'snapshot',
    runtime: { model: 'deepseek-v4-flash' },
    packageManager: new NpmPackageManager('10.0.0'),
    releaseVersion: '0.0.1',
    features: [
      { id: featureId('provider'), options: ['deepseek-official'], secrets: { apiKey: 'key' } },
      { id: featureId('bash'), options: ['local'] },
      { id: featureId('app'), options: ['acp'] },
      { id: featureId('persistence'), options: ['jsonl'] },
    ],
    localPlugins: [],
  }
  const project = SdkProject.create(root, request)
  const registry = createBuiltinRegistry(project.profile)
  const edit = project.edit(registry)
  for (const item of request.features) edit.installFeature(registry.get(item.id), item)
  return (await edit.commit()).project
}

describe('dsh-sdk config terminal contract', () => {
  it('pins the feature tree and Review & Apply output', async () => {
    const project = await baseProject()
    const registry = createBuiltinRegistry(project.profile)
    const port = new RecordingPort([
      [{ value: 'feature:todo', choices: [] }],
      true,
    ])
    let output = ''
    const stream = new Writable({ write(chunk, _encoding, callback) { output += String(chunk); callback() } })
    let installs = 0
    const result = await new ConfigWorkflow(port, stream, async () => { installs += 1 }).run(project, registry)
    expect({
      transcript: port.transcript,
      review: output,
      installs,
      committed: result.commit?.changes,
    }).toMatchSnapshot()
  })
})
