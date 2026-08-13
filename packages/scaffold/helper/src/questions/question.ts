/**
 * Typed question objects with prefill, validation, and prompt behavior together.
 *
 * @module @deepseek-ai/dsh-helper/questions/question
 */

import type { PromptOption, PromptOutcome, PromptPort } from './prompt-port.ts'

function resolvePrefilled(
  id: string,
  value: string | undefined,
  validate: ((value: string) => string | undefined) | undefined,
): PromptOutcome<string> | undefined {
  if (value === undefined) return undefined
  const diagnostic = validate?.(value)
  if (diagnostic) throw new Error(`${id}: ${diagnostic}`)
  return { status: 'answered', value }
}

/** A typed business question resolved from prefilled input or one prompt call. */
export abstract class Question<T> {
  /** Stable question identity used in diagnostics. */
  readonly id: string
  /** User-facing prompt text. */
  readonly message: string

  protected constructor(id: string, message: string) {
    this.id = id
    this.message = message
  }

  /**
   * Resolve a prefilled answer without prompting, or ask through the port.
   * @param port - prompt interaction boundary.
   * @param prefilled - optional value supplied by CLI or current project state.
   * @returns answered or cancelled prompt outcome.
   */
  abstract resolve(port: PromptPort, prefilled?: T): Promise<PromptOutcome<T>>
}

/** Visible single-line text question. */
export class TextQuestion extends Question<string> {
  /** Light hint displayed when no text has been entered. */
  readonly placeholder: string | undefined
  /** Editable value displayed in the input. */
  readonly initialValue: string | undefined
  /** Value accepted when the user submits an empty input. */
  readonly defaultValue: string | undefined
  private readonly validate: ((value: string) => string | undefined) | undefined

  /** Configure one text question. */
  constructor(options: {
    id: string
    message: string
    placeholder?: string
    initialValue?: string
    defaultValue?: string
    validate?: (value: string) => string | undefined
  }) {
    super(options.id, options.message)
    this.placeholder = options.placeholder
    this.initialValue = options.initialValue
    this.defaultValue = options.defaultValue
    this.validate = options.validate
  }

  /** Validate prefilled text or ask for it. */
  override async resolve(port: PromptPort, prefilled?: string): Promise<PromptOutcome<string>> {
    const resolved = resolvePrefilled(this.id, prefilled, this.validate)
    if (resolved) return resolved
    return port.text({
      message: this.message,
      ...this.placeholder === undefined ? {} : { placeholder: this.placeholder },
      ...this.initialValue === undefined ? {} : { initialValue: this.initialValue },
      ...this.defaultValue === undefined ? {} : { defaultValue: this.defaultValue },
      ...this.validate === undefined ? {} : { validate: this.validate },
    })
  }
}

/** Masked secret question whose empty-input semantics are set by its caller. */
export class SecretQuestion extends Question<string> {
  private readonly validate: ((value: string) => string | undefined) | undefined

  /** Configure one secret question. */
  constructor(options: {
    id: string
    message: string
    validate?: (value: string) => string | undefined
  }) {
    super(options.id, options.message)
    this.validate = options.validate
  }

  /** Validate a prefilled secret or ask for a masked value. */
  override async resolve(port: PromptPort, prefilled?: string): Promise<PromptOutcome<string>> {
    const resolved = resolvePrefilled(this.id, prefilled, this.validate)
    if (resolved) return resolved
    return port.secret({
      message: this.message,
      ...this.validate === undefined ? {} : { validate: this.validate },
    })
  }
}

/** Single-choice question. */
export class SelectQuestion<T> extends Question<T> {
  /** Available choices in display order. */
  readonly options: readonly PromptOption<T>[]
  /** Initially focused choice. */
  readonly initialValue: T | undefined

  /** Configure one single-choice question. */
  constructor(options: {
    id: string
    message: string
    options: readonly PromptOption<T>[]
    initialValue?: T
  }) {
    super(options.id, options.message)
    this.options = options.options
    this.initialValue = options.initialValue
  }

  /** Validate a prefilled option or ask for one choice. */
  override async resolve(port: PromptPort, prefilled?: T): Promise<PromptOutcome<T>> {
    if (prefilled !== undefined) {
      if (!this.options.some(option => Object.is(option.value, prefilled) && !option.disabled)) {
        throw new Error(`${this.id}: unknown or disabled option ${String(prefilled)}`)
      }
      return { status: 'answered', value: prefilled }
    }
    return port.select({
      message: this.message,
      options: this.options,
      ...this.initialValue === undefined ? {} : { initialValue: this.initialValue },
    })
  }
}

/** Additive multi-choice question. */
export class MultiSelectQuestion<T> extends Question<readonly T[]> {
  readonly options: readonly PromptOption<T>[]
  readonly initialValues: readonly T[]
  readonly required: boolean

  /** Configure one multi-choice question. */
  constructor(options: {
    id: string
    message: string
    options: readonly PromptOption<T>[]
    initialValues?: readonly T[]
    required?: boolean
  }) {
    super(options.id, options.message)
    this.options = options.options
    this.initialValues = options.initialValues ?? []
    this.required = options.required ?? false
  }

  /** Validate prefilled values or ask for an additive selection. */
  override async resolve(port: PromptPort, prefilled?: readonly T[]): Promise<PromptOutcome<readonly T[]>> {
    if (prefilled !== undefined) {
      for (const value of prefilled) {
        /* v8 ignore next -- unknown, disabled, and accepted values are each pinned by the question tests */
        if (!this.options.some(option => Object.is(option.value, value) && option.disabled !== true)) {
          throw new Error(`${this.id}: unknown or disabled option ${String(value)}`)
        }
      }
      if (this.required && prefilled.length === 0) throw new Error(`${this.id}: choose at least one option`)
      return { status: 'answered', value: prefilled }
    }
    return port.multiselect({
      message: this.message,
      options: this.options,
      initialValues: this.initialValues,
      required: this.required,
    })
  }
}

/** Boolean confirmation question. */
export class ConfirmQuestion extends Question<boolean> {
  /** Answer selected by pressing Enter. */
  readonly initialValue: boolean
  /** Visual severity used by the prompt adapter. */
  readonly tone: 'default' | 'warning'

  /** Configure one confirmation question. */
  constructor(options: {
    id: string
    message: string
    initialValue?: boolean
    tone?: 'default' | 'warning'
  }) {
    super(options.id, options.message)
    this.initialValue = options.initialValue ?? true
    this.tone = options.tone ?? 'default'
  }

  /** Return a prefilled boolean or ask for confirmation. */
  override async resolve(port: PromptPort, prefilled?: boolean): Promise<PromptOutcome<boolean>> {
    if (prefilled !== undefined) return { status: 'answered', value: prefilled }
    return port.confirm({ message: this.message, initialValue: this.initialValue, tone: this.tone })
  }
}
