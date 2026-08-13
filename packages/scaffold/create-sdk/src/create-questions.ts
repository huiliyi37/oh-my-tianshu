/**
 * Static create-sdk question sequence; dynamic feature/plugin loops remain
 * in the wizard orchestrator.
 *
 * @module @huiliyi37/create-sdk/create-questions
 */

import { existsSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import {
  ConfirmQuestion,
  SecretQuestion,
  SelectQuestion,
  TextQuestion,
  requireAnswer,
  type PromptPort,
  type Question,
  type RunInterface,
} from '@huiliyi37/dsh-helper'
import type { CreateArgs } from './args.ts'

/** Answers that establish project identity and feature applicability. */
export interface ProjectAnswers {
  directory: string
  name: string
  description: string
  provider: 'deepseek-official' | 'custom'
  baseURL: string
  apiKey: string
  model: string
  runInterface: RunInterface
}

interface ProjectAnswerState extends Partial<ProjectAnswers> {
  readonly args: CreateArgs
  readonly cwd: string
}

interface WizardStep<TState> {
  run(port: PromptPort, state: TState): Promise<void>
}

function questionStep<TState, TValue>(options: {
  question: (state: TState) => Question<TValue>
  when?: (state: TState) => boolean
  prefilled?: (state: TState) => TValue | undefined
  apply: (state: TState, value: TValue) => void
}): WizardStep<TState> {
  return {
    async run(port, state) {
      if (options.when && !options.when(state)) return
      const value = requireAnswer(await options.question(state).resolve(port, options.prefilled?.(state)))
      options.apply(state, value)
    },
  }
}

/** Validate one required text answer. */
function nonEmpty(value: string): string | undefined {
  return value.trim().length === 0 ? 'A value is required' : undefined
}

function packageName(value: string): string | undefined {
  if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(value)) {
    return 'Use a lowercase npm package name'
  }
  return undefined
}

function projectDirectory(value: string, cwd: string): string | undefined {
  const empty = nonEmpty(value)
  if (empty) return empty
  return existsSync(resolve(cwd, value)) ? 'Target already exists' : undefined
}

const API_KEY_STEP: WizardStep<ProjectAnswerState> = {
  async run(port, state) {
    let prefilled = state.args.apiKey
    while (true) {
      const apiKey = requireAnswer(await new SecretQuestion({
        id: 'apiKey',
        message: state.provider === 'custom' ? 'Custom provider API key' : 'DeepSeek API key',
      }).resolve(port, prefilled))
      if (apiKey.length > 0) {
        state.apiKey = apiKey
        return
      }
      const keepEmpty = requireAnswer(await new ConfirmQuestion({
        id: 'apiKey.empty',
        message: 'Keep the API key empty and fill .env later?',
        initialValue: false,
        tone: 'warning',
      }).resolve(port))
      if (keepEmpty) {
        state.apiKey = ''
        return
      }
      prefilled = undefined
    }
  },
}

const PROJECT_QUESTION_STEPS: ReadonlyArray<WizardStep<ProjectAnswerState>> = [
  questionStep({
    question: state => new TextQuestion({
      id: 'directory',
      message: 'Where should the project be created?',
      placeholder: 'my-agent',
      defaultValue: 'my-agent',
      validate: value => projectDirectory(value, state.cwd),
    }),
    prefilled: state => state.args.directory,
    apply: (state, value) => { state.directory = resolve(state.cwd, value) },
  }),
  questionStep({
    question: (state) => {
      /* v8 ignore next -- the preceding directory step always populates this state */
      if (!state.directory) throw new Error('directory must resolve before package name')
      return new TextQuestion({
        id: 'name',
        message: 'Package name',
        placeholder: basename(state.directory),
        defaultValue: basename(state.directory),
        validate: packageName,
      })
    },
    apply: (state, value) => { state.name = value },
  }),
  questionStep({
    question: (state) => {
      /* v8 ignore next -- the preceding package-name step always populates this state */
      if (!state.name) throw new Error('package name must resolve before description')
      return new TextQuestion({
        id: 'description',
        message: 'Project description',
        placeholder: `A Tianshu Harness agent named ${state.name}`,
        defaultValue: `A Tianshu Harness agent named ${state.name}`,
        validate: nonEmpty,
      })
    },
    prefilled: state => state.args.description,
    apply: (state, value) => { state.description = value },
  }),
  questionStep({
    question: () => new SelectQuestion<'deepseek-official' | 'custom'>({
      id: 'provider',
      message: 'Model provider',
      options: [
        { value: 'deepseek-official', label: 'DeepSeek' },
        { value: 'custom', label: 'Custom endpoint (pi-ai)' },
      ],
      initialValue: 'deepseek-official',
    }),
    prefilled: state => state.args.provider,
    apply: (state, value) => { state.provider = value },
  }),
  questionStep({
    question: () => new TextQuestion({
      id: 'baseURL', message: 'Custom provider base URL', validate: nonEmpty,
    }),
    when: state => state.provider === 'custom' || state.args.baseURL !== undefined,
    prefilled: state => state.args.baseURL,
    apply: (state, value) => { state.baseURL = value },
  }),
  API_KEY_STEP,
  questionStep({
    question: () => new SelectQuestion<RunInterface>({
      id: 'interface',
      message: 'Run interface',
      options: [
        { value: 'acp', label: 'ACP automation server' },
        { value: 'embed', label: 'Embedded context' },
      ],
      initialValue: 'acp',
    }),
    prefilled: state => state.args.runInterface,
    apply: (state, value) => { state.runInterface = value },
  }),
]

function completeAnswers(state: ProjectAnswerState): ProjectAnswers {
  const keys = ['directory', 'name', 'description', 'provider', 'baseURL', 'apiKey', 'model', 'runInterface'] as const
  for (const key of keys) {
    /* v8 ignore next -- the fixed step list above populates every key or throws/cancels first */
    if (state[key] === undefined) throw new Error(`create question did not resolve ${key}`)
  }
  return state as ProjectAnswerState & ProjectAnswers
}

/** Run the fixed project-context sequence in declaration order. */
export async function collectProjectAnswers(
  port: PromptPort,
  args: CreateArgs,
  cwd: string,
): Promise<ProjectAnswers> {
  const state: ProjectAnswerState = {
    args,
    cwd,
    baseURL: args.baseURL ?? '',
    model: args.model ?? 'deepseek-v4-flash',
  }
  for (const step of PROJECT_QUESTION_STEPS) await step.run(port, state)
  return completeAnswers(state)
}
