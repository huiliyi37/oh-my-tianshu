/**
 * Thin @clack/prompts adapter for the shared prompt port.
 *
 * @module @deepseek-ai/dsh-helper/questions/clack-prompt-port
 */

import type { Readable, Writable } from 'node:stream'
import { styleText } from 'node:util'
import {
  confirm,
  isCancel,
  multiselect,
  password,
  select,
  text,
  S_WARN,
} from '@clack/prompts'
import type { Option } from '@clack/prompts'
import type {
  ConfirmPromptRequest,
  MultiSelectPromptRequest,
  NestedMultiSelectRequest,
  NestedMultiSelectValue,
  PromptOutcome,
  PromptPort,
  SecretPromptRequest,
  SelectPromptRequest,
  TextPromptRequest,
} from './prompt-port.ts'
import { clackNestedMultiselect } from './clack-nested-multiselect.ts'

function outcome<T>(value: T | symbol): PromptOutcome<T> {
  return isCancel(value) ? { status: 'cancelled' } : { status: 'answered', value }
}

function clackOptions<T>(values: readonly import('./prompt-port.ts').PromptOption<T>[]): Option<T>[] {
  return values.map(value => ({
    value: value.value,
    label: value.label,
    ...value.hint === undefined ? {} : { hint: value.hint },
    ...value.disabled === undefined ? {} : { disabled: value.disabled },
  })) as Option<T>[]
}

/** Clack-backed prompt adapter with injectable streams for snapshots and tests. */
export class ClackPromptPort implements PromptPort {
  private readonly input: Readable
  private readonly output: Writable

  /** Bind all prompts to one input/output pair. */
  constructor(input: Readable = process.stdin, output: Writable = process.stdout) {
    this.input = input
    this.output = output
  }

  /** Ask for visible text through clack. */
  async text(request: TextPromptRequest): Promise<PromptOutcome<string>> {
    return outcome(await text({
      message: request.message,
      ...request.placeholder === undefined ? {} : { placeholder: request.placeholder },
      ...request.initialValue === undefined ? {} : { initialValue: request.initialValue },
      ...request.defaultValue === undefined ? {} : { defaultValue: request.defaultValue },
      ...request.validate === undefined
        ? {}
        : {
          /* v8 ignore next -- value/default precedence is exercised through the adapter contract tests */
          validate: value => request.validate?.(value || request.defaultValue || ''),
        },
      input: this.input,
      output: this.output,
    }))
  }

  /** Ask for a masked secret through clack. */
  async secret(request: SecretPromptRequest): Promise<PromptOutcome<string>> {
    return outcome(await password({
      message: request.message,
      ...request.validate === undefined ? {} : {
        /* v8 ignore next -- @clack/password always calls validation with a string; fallback is defensive */
        validate: value => request.validate?.(value ?? ''),
      },
      input: this.input,
      output: this.output,
    }))
  }

  /** Ask for one option through clack. */
  async select<T>(request: SelectPromptRequest<T>): Promise<PromptOutcome<T>> {
    return outcome(await select({
      ...request,
      options: clackOptions(request.options),
      input: this.input,
      output: this.output,
    }))
  }

  /** Ask for multiple options through clack. */
  async multiselect<T>(request: MultiSelectPromptRequest<T>): Promise<PromptOutcome<readonly T[]>> {
    return outcome(await multiselect({
      message: request.message,
      options: clackOptions(request.options),
      ...request.initialValues === undefined ? {} : { initialValues: [...request.initialValues] },
      ...request.required === undefined ? {} : { required: request.required },
      input: this.input,
      output: this.output,
    }))
  }

  /** Ask for confirmation through clack. */
  async confirm(request: ConfirmPromptRequest): Promise<PromptOutcome<boolean>> {
    return outcome(await confirm({
      message: request.tone === 'warning'
        ? styleText('yellow', `${S_WARN} ${request.message}`)
        : request.message,
      ...request.initialValue === undefined ? {} : { initialValue: request.initialValue },
      input: this.input,
      output: this.output,
    }))
  }

  /** Select root values and finite child options in one tree prompt. */
  nestedMultiselect<TValue, TChoice>(
    request: NestedMultiSelectRequest<TValue, TChoice>,
  ): Promise<PromptOutcome<readonly NestedMultiSelectValue<TValue, TChoice>[]>> {
    return clackNestedMultiselect({ ...request, input: this.input, output: this.output })
  }
}
