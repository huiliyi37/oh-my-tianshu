/**
 * Non-interactive prompt port for headless create/config and skill-driven runs.
 *
 * @module @deepseek-ai/dsh-helper/questions/headless-prompt-port
 */

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

/**
 * Raised when a headless run reaches a decision that was neither prefilled nor
 * carries a usable default. The message names the unanswered prompt so an agent
 * or CI caller can see exactly which input the spec must supply.
 */
export class HeadlessPromptError extends Error {
  /** The unanswered prompt's user-facing message. */
  readonly prompt: string

  /** Build an error naming the unanswered prompt. */
  constructor(prompt: string) {
    super(`headless run needs an answer for: ${prompt}`)
    this.name = 'HeadlessPromptError'
    this.prompt = prompt
  }
}

/** Resolve an answered outcome. */
function answered<T>(value: T): Promise<PromptOutcome<T>> {
  return Promise.resolve({ status: 'answered', value })
}

/** Reject with a named unanswered-prompt error. */
function unanswered<T>(message: string): Promise<PromptOutcome<T>> {
  return Promise.reject(new HeadlessPromptError(message))
}

/**
 * A {@link PromptPort} that never blocks on a terminal.
 *
 * Answers are expected to arrive as prefilled values through the `Question` /
 * `FeatureConfigurator` layers, so in a fully specified run this port is never
 * reached. When it *is* reached, it takes the prompt's own declared default
 * (`defaultValue` / `initialValue`) if one exists; otherwise it fails loud with
 * {@link HeadlessPromptError}. Nested feature selection has no scalar default,
 * so it always fails loud — headless callers must supply the feature set through
 * the spec rather than the tree picker.
 */
export class HeadlessPromptPort implements PromptPort {
  /** Answer visible text from its default, or fail loud. */
  text(request: TextPromptRequest): Promise<PromptOutcome<string>> {
    const fallback = request.initialValue ?? request.defaultValue
    if (fallback === undefined) return unanswered(request.message)
    const diagnostic = request.validate?.(fallback)
    if (diagnostic) return unanswered(`${request.message} (${diagnostic})`)
    return answered(fallback)
  }

  /** A secret has no safe default: always fail loud. */
  secret(request: SecretPromptRequest): Promise<PromptOutcome<string>> {
    return unanswered(request.message)
  }

  /** Answer a single choice from its initial value, or fail loud. */
  select<T>(request: SelectPromptRequest<T>): Promise<PromptOutcome<T>> {
    if (request.initialValue === undefined) { return unanswered(request.message) }
    return answered(request.initialValue)
  }

  /** Answer a multi-choice from its initial values, or fail loud when required. */
  multiselect<T>(request: MultiSelectPromptRequest<T>): Promise<PromptOutcome<readonly T[]>> {
    const initial = request.initialValues ?? []
    if (request.required && initial.length === 0) return unanswered(request.message)
    return answered(initial)
  }

  /** Answer a confirmation from its initial value, or fail loud. */
  confirm(request: ConfirmPromptRequest): Promise<PromptOutcome<boolean>> {
    if (request.initialValue === undefined) return unanswered(request.message)
    return answered(request.initialValue)
  }

  /** Nested feature selection has no scalar default: always fail loud. */
  nestedMultiselect<TValue, TChoice>(
    request: NestedMultiSelectRequest<TValue, TChoice>,
  ): Promise<PromptOutcome<readonly NestedMultiSelectValue<TValue, TChoice>[]>> {
    return unanswered(request.message)
  }
}
