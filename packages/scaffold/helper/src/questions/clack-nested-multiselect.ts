/**
 * Tree-shaped Clack picker for root checkboxes with finite child options.
 *
 * @module @deepseek-ai/dsh-helper/questions/clack-nested-multiselect
 */

import { styleText } from 'node:util'
import type { Readable, Writable } from 'node:stream'
import { Prompt, isCancel } from '@clack/core'
import {
  S_BAR,
  S_BAR_END,
  S_CHECKBOX_ACTIVE,
  S_CHECKBOX_INACTIVE,
  S_CHECKBOX_SELECTED,
  S_RADIO_ACTIVE,
  S_RADIO_INACTIVE,
  symbol,
  symbolBar,
} from '@clack/prompts'
import type {
  NestedMultiSelectOption,
  NestedMultiSelectRequest,
  NestedMultiSelectValue,
  PromptOutcome,
} from './prompt-port.ts'

interface NestedPromptOptions<TValue, TChoice> extends NestedMultiSelectRequest<TValue, TChoice> {
  input: Readable
  output: Writable
}

class NestedPrompt<TValue, TChoice> extends Prompt<readonly NestedMultiSelectValue<TValue, TChoice>[]> {
  readonly options: readonly NestedMultiSelectOption<TValue, TChoice>[]
  private readonly selected = new Set<TValue>()
  private readonly selectedChoices = new Map<TValue, Set<TChoice>>()
  private readonly initialSelected: Set<TValue>
  private readonly initialChoices: Map<TValue, Set<TChoice>>
  private readonly showChanges: boolean
  private layer: 'root' | 'choices' = 'root'
  private rootCursor = 0
  private choiceCursor = 0

  constructor(options: NestedPromptOptions<TValue, TChoice>) {
    super({
      input: options.input,
      output: options.output,
      validate: value => NestedPrompt.validate(options.options, value),
      render(this: Prompt<readonly NestedMultiSelectValue<TValue, TChoice>[]>) {
        return (this as NestedPrompt<TValue, TChoice>).renderFrame(options.message)
      },
    }, false)
    this.options = options.options
    this.showChanges = options.showChanges ?? false
    for (const option of options.options) {
      if (option.required || option.default) this.selected.add(option.value)
      this.selectedChoices.set(option.value, new Set(
        option.choices?.filter(choice => choice.default).map(choice => choice.value) ?? [],
      ))
    }
    this.initialSelected = new Set(this.selected)
    this.initialChoices = new Map([...this.selectedChoices].map(([value, choices]) => [
      value, new Set(choices),
    ]))
    this.updateValue()
    this.on('cursor', (action) => { this.handleAction(action) })
  }

  private static validate<TValue, TChoice>(
    options: readonly NestedMultiSelectOption<TValue, TChoice>[],
    value: readonly NestedMultiSelectValue<TValue, TChoice>[] | undefined,
  ): string | undefined {
    /* v8 ignore next -- NestedPrompt initializes its value before submission validation */
    const selected = new Map(value?.map(item => [item.value, item.choices]) ?? [])
    for (const option of options) {
      if (option.disabled) continue
      /* v8 ignore next -- required options initialize selected and cannot be toggled off */
      if (option.required && !selected.has(option.value)) return `${option.label} is required`
      if (!selected.has(option.value) || !option.choiceMode) continue
      const choices = selected.get(option.value)
      /* v8 ignore next -- selected.has above guarantees the map value exists */
      if (!choices) continue
      const count = choices.length
      if (option.choiceMode === 'exclusive' && count !== 1) return `Choose one ${option.label} option`
      if (option.choiceMode === 'multiple' && count === 0) return `Choose at least one ${option.label} option`
    }
    return undefined
  }

  protected override _shouldSubmit(): boolean {
    if (this.layer === 'choices') {
      this.leaveChoices()
      return false
    }
    return true
  }

  private handleAction(action: string | undefined): void {
    if (this.layer === 'root') this.handleRootAction(action)
    else this.handleChoiceAction(action)
    this.updateValue()
  }

  private handleRootAction(action: string | undefined): void {
    if (action === 'up') this.rootCursor = this.move(this.rootCursor, -1, this.options.length)
    if (action === 'down') this.rootCursor = this.move(this.rootCursor, 1, this.options.length)
    const option = this.options[this.rootCursor]
    /* v8 ignore next -- Clack cannot emit a cursor action when the option list is empty */
    if (!option) return
    if (action === 'space' && !option.required && !option.disabled) {
      if (this.selected.has(option.value)) this.selected.delete(option.value)
      else this.selected.add(option.value)
    }
    if (action === 'right' && !option.disabled && option.choices && option.choices.length > 0) {
      this.selected.add(option.value)
      this.layer = 'choices'
      const selected = this.selectedChoices.get(option.value)
      const selectedIndex = option.choices.findIndex(choice => selected?.has(choice.value))
      this.choiceCursor = Math.max(selectedIndex, 0)
    }
  }

  private handleChoiceAction(action: string | undefined): void {
    const rootOption = this.options[this.rootCursor]
    /* v8 ignore next -- the choices layer is entered only from a concrete root option */
    if (!rootOption) return
    /* v8 ignore next -- the choices layer is entered only for a non-empty choices array */
    const choices = rootOption.choices ?? []
    if (action === 'left') {
      this.leaveChoices()
      return
    }
    if (action === 'up') this.choiceCursor = this.move(this.choiceCursor, -1, choices.length)
    if (action === 'down') this.choiceCursor = this.move(this.choiceCursor, 1, choices.length)
    if ((action === 'up' || action === 'down') && rootOption.choiceMode === 'exclusive') {
      const choice = choices[this.choiceCursor]
      /* v8 ignore else -- a cursor in the non-empty choices layer always addresses a choice */
      if (choice) this.selectedChoices.set(rootOption.value, new Set([choice.value]))
    }
    if (action !== 'space' && action !== 'right') return
    const choice = choices[this.choiceCursor]
    /* v8 ignore next -- the choices layer requires a non-empty choice list */
    if (!choice) return
    /* v8 ignore next -- every root option initializes its choice set in the constructor */
    const selected = this.selectedChoices.get(rootOption.value) ?? new Set<TChoice>()
    if (rootOption.choiceMode === 'exclusive') {
      selected.clear()
      selected.add(choice.value)
    } else if (selected.has(choice.value)) selected.delete(choice.value)
    else selected.add(choice.value)
    this.selectedChoices.set(rootOption.value, selected)
  }

  private move(cursor: number, offset: number, length: number): number {
    /* v8 ignore next -- cursor movement is emitted only for a non-empty displayed list */
    if (length === 0) return 0
    return (cursor + offset + length) % length
  }

  private updateValue(): void {
    this._setValue(this.options.filter(option => this.selected.has(option.value)).map(option => ({
      value: option.value,
      /* v8 ignore next -- every root option initializes its choice set in the constructor */
      choices: [...this.selectedChoices.get(option.value) ?? []],
    })))
  }

  private renderFrame(message: string): string {
    const header = `${symbolBar(this.state)}  ${message}`
    if (this.state === 'submit') {
      /* v8 ignore next -- NestedPrompt initializes its value before it can submit */
      const summary = (this.value ?? []).map(item => this.options.find(option => option.value === item.value)?.label)
        .filter(Boolean).join(', ') || 'none'
      return `${symbol(this.state)}  ${message}\n${styleText('gray', S_BAR)}  ${styleText('dim', summary)}`
    }
    if (this.state === 'cancel') return `${symbol(this.state)}  ${message}`
    const body = this.layer === 'root' ? this.renderRoot() : this.renderChoices()
    const instructions = this.layer === 'root'
      ? `${styleText('dim', '↑/↓')} navigate  ${styleText('dim', 'Space')} select  ${styleText('dim', '→')} configure  ${styleText('dim', 'Enter')} confirm`
      : `${styleText('dim', '↑/↓')} navigate  ${styleText('dim', 'Space/→')} select  ${styleText('dim', '←/Enter')} back`
    const error = this.state === 'error' ? `\n${styleText('yellow', `${S_BAR_END}  ${this.error}`)}` : ''
    return `${header}\n${styleText('cyan', S_BAR)}  ${body.join(`\n${styleText('cyan', S_BAR)}  `)}\n${styleText('cyan', S_BAR_END)}  ${instructions}${error}`
  }

  private renderRoot(): string[] {
    return this.options.map((option, index) => {
      const active = index === this.rootCursor
      const selected = this.selected.has(option.value)
      const focus = active ? styleText('cyan', '›') : ' '
      const checkbox = selected
        ? styleText('green', S_CHECKBOX_SELECTED)
        : styleText('dim', active ? S_CHECKBOX_ACTIVE : S_CHECKBOX_INACTIVE)
      const choices = option.choices?.filter(choice => this.selectedChoices.get(option.value)?.has(choice.value))
        .map(choice => choice.label).join(', ')
      const suffix = option.choices?.length
        ? ` ${styleText('dim', `* →${choices ? ` ${choices}` : ''}`)}`
        : ''
      const required = option.required ? ` ${styleText('yellow', '(required)')}` : ''
      const issue = this.choiceIssue(option)
      const warningText = option.warning ?? issue
      const warning = warningText ? ` ${styleText('yellow', `▲ ${warningText}`)}` : ''
      const changed = this.optionChanged(option)
      const change = changed ? ` ${styleText('yellow', '● changed')}` : ''
      const label = active
        ? styleText('cyan', option.label)
        : changed
          ? styleText('yellow', option.label)
          : selected ? styleText('green', option.label) : styleText('dim', option.label)
      const line = `${focus} ${checkbox} ${label}${required}${suffix}${warning}${change}`
      return option.disabled ? styleText('gray', line) : line
    })
  }

  private renderChoices(): string[] {
    const rootOption = this.options[this.rootCursor]
    /* v8 ignore next -- renderChoices runs only after entering from a concrete root option */
    if (!rootOption) return []
    /* v8 ignore next -- every root option initializes its choice set in the constructor */
    const selected = this.selectedChoices.get(rootOption.value) ?? new Set<TChoice>()
    const issue = this.choiceIssue(rootOption)
    const changed = this.optionChanged(rootOption)
    const header = styleText('dim', `${rootOption.label} options`)
      + (issue ? ` ${styleText('yellow', `▲ ${issue}`)}` : '')
      + (changed ? ` ${styleText('yellow', '● changed')}` : '')
    const choices = rootOption.choices
    /* v8 ignore next -- the choices layer is entered only for a non-empty choices array */
    if (!choices) return [header]
    return [
      header,
      ...choices.map((choice, index) => {
        const active = index === this.choiceCursor
        const checked = selected.has(choice.value)
        const choiceChanged = this.choiceChanged(rootOption.value, choice.value)
        const focus = active ? styleText('cyan', '›') : ' '
        const marker = rootOption.choiceMode === 'exclusive'
          ? checked ? styleText('green', S_RADIO_ACTIVE) : styleText('dim', S_RADIO_INACTIVE)
          : checked ? styleText('green', S_CHECKBOX_SELECTED) : styleText('dim', S_CHECKBOX_INACTIVE)
        const label = active
          ? styleText('cyan', choice.label)
          : choiceChanged
            ? styleText('yellow', choice.label)
            : checked ? styleText('green', choice.label) : styleText('dim', choice.label)
        const change = choiceChanged ? ` ${styleText('yellow', '●')}` : ''
        return `${focus} ${marker} ${label}${change}`
      }),
    ]
  }

  private optionChanged(option: NestedMultiSelectOption<TValue, TChoice>): boolean {
    if (!this.showChanges) return false
    const selected = this.selected.has(option.value)
    const initiallySelected = this.initialSelected.has(option.value)
    if (selected !== initiallySelected) return true
    if (!selected) return false
    /* v8 ignore next -- every root option initializes both current and baseline option sets */
    const current = this.selectedChoices.get(option.value) ?? new Set<TChoice>()
    /* v8 ignore next -- every root option initializes both current and baseline option sets */
    const initial = this.initialChoices.get(option.value) ?? new Set<TChoice>()
    return current.size !== initial.size || [...current].some(value => !initial.has(value))
  }

  private choiceChanged(value: TValue, choice: TChoice): boolean {
    if (!this.showChanges) return false
    return this.selectedChoices.get(value)?.has(choice) !== this.initialChoices.get(value)?.has(choice)
  }

  private choiceIssue(option: NestedMultiSelectOption<TValue, TChoice>): string | undefined {
    if (option.disabled || !this.selected.has(option.value) || !option.choiceMode) return undefined
    /* v8 ignore next -- every root option initializes its choice set in the constructor */
    const count = this.selectedChoices.get(option.value)?.size ?? 0
    if (option.choiceMode === 'exclusive' && count !== 1) return 'choose one'
    if (option.choiceMode === 'multiple' && count === 0) return 'choose at least one'
    return undefined
  }

  private leaveChoices(): boolean {
    const option = this.options[this.rootCursor]
    /* v8 ignore next -- leaveChoices runs only after entering from a concrete root option */
    if (!option) return false
    const issue = this.choiceIssue(option)
    if (issue) {
      this.error = `${option.label}: ${issue}`
      this.state = 'error'
      return false
    }
    this.error = ''
    this.layer = 'root'
    return true
  }
}

/** Run the nested picker with Clack's standard cancellation symbol. */
export async function clackNestedMultiselect<TValue, TChoice>(
  request: NestedPromptOptions<TValue, TChoice>,
): Promise<PromptOutcome<readonly NestedMultiSelectValue<TValue, TChoice>[]>> {
  const value = await new NestedPrompt(request).prompt()
  return isCancel(value)
    ? { status: 'cancelled' }
    : {
      status: 'answered',
      /* v8 ignore next -- NestedPrompt initializes its value before it can submit */
      value: value ?? [],
    }
}
