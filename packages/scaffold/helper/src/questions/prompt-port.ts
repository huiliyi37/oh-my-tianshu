/**
 * Terminal-prompt port shared by create and config workflows.
 *
 * @module @deepseek-ai/dsh-helper/questions/prompt-port
 */

/** One selectable prompt option. */
export interface PromptOption<T> {
  value: T
  label: string
  hint?: string
  disabled?: boolean
}

/** Answer or explicit cancellation returned by every prompt. */
export type PromptOutcome<T> =
  | { status: 'answered'; value: T }
  | { status: 'cancelled' }

/** Input for one text prompt. */
export interface TextPromptRequest {
  message: string
  placeholder?: string
  initialValue?: string
  defaultValue?: string
  validate?: (value: string) => string | undefined
}

/** Input for one masked secret prompt. */
export interface SecretPromptRequest {
  message: string
  validate?: (value: string) => string | undefined
}

/** Input for one single-choice prompt. */
export interface SelectPromptRequest<T> {
  message: string
  options: readonly PromptOption<T>[]
  initialValue?: T
}

/** Input for one additive multi-choice prompt. */
export interface MultiSelectPromptRequest<T> {
  message: string
  options: readonly PromptOption<T>[]
  initialValues?: readonly T[]
  required?: boolean
}

/** Input for one yes/no prompt. */
export interface ConfirmPromptRequest {
  message: string
  initialValue?: boolean
  tone?: 'default' | 'warning'
}

/** One nested choice under a multi-select option. */
interface NestedSelectChoice<T> {
  value: T
  label: string
  default?: boolean
}

/** One root option with optional child option configuration. */
export interface NestedMultiSelectOption<TValue, TChoice> {
  value: TValue
  label: string
  required?: boolean
  default?: boolean
  disabled?: boolean
  warning?: string
  choiceMode?: 'exclusive' | 'multiple'
  choices?: readonly NestedSelectChoice<TChoice>[]
}

/** Input for a tree-shaped feature-style picker. */
export interface NestedMultiSelectRequest<TValue, TChoice> {
  message: string
  options: readonly NestedMultiSelectOption<TValue, TChoice>[]
  showChanges?: boolean
}

/** One selected root option and its child options. */
export interface NestedMultiSelectValue<TValue, TChoice> {
  value: TValue
  choices: readonly TChoice[]
}

/** Interaction boundary consumed by typed question objects. */
export interface PromptPort {
  /** Ask for one line of visible text. */
  text(request: TextPromptRequest): Promise<PromptOutcome<string>>
  /** Ask for one masked value. */
  secret(request: SecretPromptRequest): Promise<PromptOutcome<string>>
  /** Ask for exactly one option. */
  select<T>(request: SelectPromptRequest<T>): Promise<PromptOutcome<T>>
  /** Ask for zero or more options. */
  multiselect<T>(request: MultiSelectPromptRequest<T>): Promise<PromptOutcome<readonly T[]>>
  /** Ask for a boolean confirmation. */
  confirm(request: ConfirmPromptRequest): Promise<PromptOutcome<boolean>>
  /** Select root options and configure finite child options in one tree prompt. */
  nestedMultiselect<TValue, TChoice>(
    request: NestedMultiSelectRequest<TValue, TChoice>,
  ): Promise<PromptOutcome<readonly NestedMultiSelectValue<TValue, TChoice>[]>>
}

/** Error used when a workflow chooses to turn prompt cancellation into command cancellation. */
export class PromptCancelledError extends Error {
  /** Create a stable cancellation error. */
  constructor(message = 'operation cancelled') {
    super(message)
    this.name = 'PromptCancelledError'
  }
}

/**
 * Return an answered value or throw the shared cancellation error.
 * @param outcome - prompt result to unwrap.
 * @returns answered value.
 */
export function requireAnswer<T>(outcome: PromptOutcome<T>): T {
  if (outcome.status === 'cancelled') throw new PromptCancelledError()
  return outcome.value
}
