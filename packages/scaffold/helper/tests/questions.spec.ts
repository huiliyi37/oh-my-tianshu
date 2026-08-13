import { PassThrough, Writable } from 'node:stream'
import { stripVTControlCharacters } from 'node:util'
import { S_CHECKBOX_SELECTED, S_RADIO_ACTIVE, S_WARN } from '@clack/prompts'
import { describe, expect, it } from 'vitest'
import { createBuiltinRegistry } from '../src/features/builtin/index.ts'
import { FeatureConfigurator } from '../src/features/feature-configurator.ts'
import { FeatureOption, ExclusiveOptionFeature } from '../src/features/feature.ts'
import { ProjectContribution } from '../src/features/resources.ts'
import { featureId } from '../src/ids.ts'
import { NpmPackageManager } from '../src/package-managers/package-manager.ts'
import { ClackPromptPort } from '../src/questions/clack-prompt-port.ts'
import {
  PromptCancelledError,
  requireAnswer,
  type ConfirmPromptRequest,
  type MultiSelectPromptRequest,
  type NestedMultiSelectRequest,
  type NestedMultiSelectValue,
  type PromptOutcome,
  type PromptPort,
  type SecretPromptRequest,
  type SelectPromptRequest,
  type TextPromptRequest,
} from '../src/questions/prompt-port.ts'
import {
  ConfirmQuestion,
  MultiSelectQuestion,
  SecretQuestion,
  SelectQuestion,
  TextQuestion,
} from '../src/questions/question.ts'
import type { ProjectProfile } from '../src/project/types.ts'
import { clackNestedMultiselect } from '../src/questions/clack-nested-multiselect.ts'

function validateString(
  outcome: PromptOutcome<string>,
  validate: ((value: string) => string | undefined) | undefined,
): PromptOutcome<string> {
  if (outcome.status === 'answered') {
    const diagnostic = validate?.(outcome.value)
    if (diagnostic) throw new Error(diagnostic)
  }
  return outcome
}

class QueuePromptPort implements PromptPort {
  readonly answers: unknown[]
  readonly requests: string[] = []

  constructor(answers: unknown[]) {
    this.answers = [...answers]
  }

  next<T>(message: string): PromptOutcome<T> {
    this.requests.push(message)
    const value = this.answers.shift()
    return value === QueuePromptPort.cancel ? { status: 'cancelled' } : { status: 'answered', value: value as T }
  }

  async text(request: TextPromptRequest): Promise<PromptOutcome<string>> {
    return validateString(this.next<string>(request.message), request.validate)
  }

  async secret(request: SecretPromptRequest): Promise<PromptOutcome<string>> {
    return validateString(this.next<string>(request.message), request.validate)
  }

  select<T>(request: SelectPromptRequest<T>): Promise<PromptOutcome<T>> {
    return Promise.resolve(this.next(request.message))
  }

  multiselect<T>(request: MultiSelectPromptRequest<T>): Promise<PromptOutcome<readonly T[]>> {
    return Promise.resolve(this.next(request.message))
  }

  confirm(request: ConfirmPromptRequest): Promise<PromptOutcome<boolean>> {
    return Promise.resolve(this.next(request.message))
  }
  nestedMultiselect<TValue, TChoice>(
    request: NestedMultiSelectRequest<TValue, TChoice>,
  ): Promise<PromptOutcome<readonly NestedMultiSelectValue<TValue, TChoice>[]>> {
    return Promise.resolve(this.next(request.message))
  }

  static readonly cancel = Symbol('cancel')
}

describe('typed questions', () => {
  it('uses and validates prefilled answers without prompting', async () => {
    const port = new QueuePromptPort([])
    const text = new TextQuestion({ id: 'name', message: 'Name', validate: value => !value ? 'required' : undefined })
    await expect(text.resolve(port, 'demo')).resolves.toEqual({ status: 'answered', value: 'demo' })
    await expect(text.resolve(port, '')).rejects.toThrow('name: required')
    const select = new SelectQuestion({
      id: 'choice', message: 'Choice', options: [{ value: 'a', label: 'A' }], initialValue: 'a',
    })
    await expect(select.resolve(port, 'b')).rejects.toThrow('unknown or disabled option')
    await expect(select.resolve(port, 'a')).resolves.toMatchObject({ value: 'a' })
    const disabled = new SelectQuestion({
      id: 'disabled', message: 'Disabled', options: [{ value: 'a', label: 'A', disabled: true }],
    })
    await expect(disabled.resolve(port, 'a')).rejects.toThrow('disabled option')
    const multi = new MultiSelectQuestion({
      id: 'many', message: 'Many', options: [{ value: 'a', label: 'A' }], required: true,
    })
    await expect(multi.resolve(port, [])).rejects.toThrow('choose at least one')
    await expect(multi.resolve(port, ['missing'])).rejects.toThrow('unknown or disabled option')
    await expect(new MultiSelectQuestion({
      id: 'disabled-many', message: 'Disabled many', options: [{ value: 'a', label: 'A', disabled: true }],
    }).resolve(port, ['a'])).rejects.toThrow('disabled option')
    await expect(new MultiSelectQuestion({
      id: 'optional', message: 'Optional', options: [{ value: 'a', label: 'A' }],
    }).resolve(port, [])).resolves.toMatchObject({ value: [] })
    const secret = new SecretQuestion({ id: 'secret', message: 'Secret', validate: value => value ? undefined : 'required' })
    await expect(secret.resolve(port, 'value')).resolves.toMatchObject({ value: 'value' })
    await expect(secret.resolve(port, '')).rejects.toThrow('secret: required')
    await expect(new ConfirmQuestion({ id: 'confirm', message: 'Confirm' }).resolve(port, false))
      .resolves.toEqual({ status: 'answered', value: false })
    expect(port.requests).toEqual([])
  })

  it('delegates each interaction shape and propagates cancellation', async () => {
    const port = new QueuePromptPort(['text', 'secret', 'a', ['a'], true, QueuePromptPort.cancel])
    await expect(new TextQuestion({ id: 't', message: 'Text' }).resolve(port)).resolves.toMatchObject({ value: 'text' })
    await expect(new SecretQuestion({ id: 's', message: 'Secret' }).resolve(port)).resolves.toMatchObject({ value: 'secret' })
    await expect(new SelectQuestion({
      id: 'one', message: 'One', options: [{ value: 'a', label: 'A' }],
    }).resolve(port)).resolves.toMatchObject({ value: 'a' })
    await expect(new MultiSelectQuestion({
      id: 'many', message: 'Many', options: [{ value: 'a', label: 'A' }],
    }).resolve(port)).resolves.toMatchObject({ value: ['a'] })
    await expect(new ConfirmQuestion({ id: 'yes', message: 'Yes?' }).resolve(port)).resolves.toMatchObject({ value: true })
    const cancelled = await new ConfirmQuestion({ id: 'cancel', message: 'Cancel?' }).resolve(port)
    expect(() => requireAnswer(cancelled)).toThrow(PromptCancelledError)
    const optionsPort = new QueuePromptPort(['full', 'a', ['a']])
    await new TextQuestion({
      id: 'full', message: 'Full', placeholder: 'p', initialValue: 'i', defaultValue: 'd', validate: () => undefined,
    }).resolve(optionsPort)
    await new SelectQuestion({
      id: 'initial', message: 'Initial', options: [{ value: 'a', label: 'A' }], initialValue: 'a',
    }).resolve(optionsPort)
    await new MultiSelectQuestion({
      id: 'initial-many', message: 'Initial many', options: [{ value: 'a', label: 'A' }],
      initialValues: ['a'], required: true,
    }).resolve(optionsPort)
  })

  it('accepts a visible placeholder default before required validation', async () => {
    const input = new PassThrough()
    const output = new Writable({ write(_chunk, _encoding, callback) { callback() } })
    const pending = new ClackPromptPort(input, output).text({
      message: 'Directory',
      placeholder: 'my-agent',
      defaultValue: 'my-agent',
      validate: value => value ? undefined : 'required',
    })
    setTimeout(() => input.write('\r'), 0)
    await expect(pending).resolves.toEqual({ status: 'answered', value: 'my-agent' })
  })

  it('renders warning confirmations with a yellow warning marker', async () => {
    const input = new PassThrough()
    let screen = ''
    const output = new Writable({ write(chunk, _encoding, callback) { screen += String(chunk); callback() } })
    const pending = new ClackPromptPort(input, output).confirm({
      message: 'Keep empty?',
      initialValue: true,
      tone: 'warning',
    })
    setTimeout(() => input.write('\r'), 0)
    await expect(pending).resolves.toEqual({ status: 'answered', value: true })
    expect(stripVTControlCharacters(screen)).toContain(`${S_WARN} Keep empty?`)
  })

  it('adapts secret, select, multiselect, nested, and cancellation prompts', async () => {
    const run = async <T>(
      start: (port: ClackPromptPort) => Promise<PromptOutcome<T>>,
      keys: string,
    ): Promise<PromptOutcome<T>> => {
      const input = new PassThrough()
      const output = new Writable({ write(_chunk, _encoding, callback) { callback() } })
      const pending = start(new ClackPromptPort(input, output))
      setTimeout(() => input.write(keys), 0)
      return pending
    }
    await expect(run(port => port.secret({ message: 'Secret', validate: value => value ? undefined : 'required' }), 'key\r'))
      .resolves.toEqual({ status: 'answered', value: 'key' })
    await expect(run(port => port.secret({ message: 'Secret' }), 'plain\r'))
      .resolves.toEqual({ status: 'answered', value: 'plain' })
    await expect(run(port => port.text({ message: 'Text', initialValue: 'seed' }), '\r'))
      .resolves.toEqual({ status: 'answered', value: 'seed' })
    let validated = 'unset'
    await expect(run(port => port.text({
      message: 'Empty', validate: (value) => { validated = value; return undefined },
    }), '\r')).resolves.toEqual({ status: 'answered', value: '' })
    expect(validated).toBe('')
    await expect(run(port => port.select({
      message: 'Select', options: [{ value: 'a', label: 'A', hint: 'hint' }, { value: 'b', label: 'B', disabled: true }],
      initialValue: 'a',
    }), '\r')).resolves.toEqual({ status: 'answered', value: 'a' })
    await expect(run(port => port.multiselect({
      message: 'Many', options: [{ value: 'a', label: 'A' }], initialValues: ['a'], required: true,
    }), '\r')).resolves.toEqual({ status: 'answered', value: ['a'] })
    await expect(run(port => port.multiselect({
      message: 'Many', options: [{ value: 'a', label: 'A' }],
    }), ' \r')).resolves.toEqual({ status: 'answered', value: ['a'] })
    await expect(run(port => port.nestedMultiselect({
      message: 'Nested', options: [{ value: 'a', label: 'A', default: true }],
    }), '\r')).resolves.toEqual({ status: 'answered', value: [{ value: 'a', choices: [] }] })
    await expect(run(port => port.confirm({ message: 'Cancel' }), '\u0003')).resolves.toEqual({ status: 'cancelled' })
    expect(new ClackPromptPort()).toBeInstanceOf(ClackPromptPort)
  })
})

describe('nested Clack picker', () => {
  it('navigates root options, ignores disabled rows, and toggles optional rows', async () => {
    const input = new PassThrough()
    const output = new Writable({ write(_chunk, _encoding, callback) { callback() } })
    const pending = clackNestedMultiselect({
      message: 'Features', showChanges: true, input, output,
      options: [
        { value: 'required', label: 'Required', required: true },
        { value: 'optional', label: 'Optional', default: true },
        { value: 'added', label: 'Added' },
        { value: 'disabled', label: 'Disabled', disabled: true, warning: 'disabled warning' },
      ],
    })
    setTimeout(() => input.write('\x1b[A \x1b[B\x1b[B \x1b[B \x1b[A\r'), 0)
    await expect(pending).resolves.toEqual({
      status: 'answered',
      value: [{ value: 'required', choices: [] }, { value: 'added', choices: [] }],
    })
  })

  it('cancels from the root layer', async () => {
    const input = new PassThrough()
    const output = new Writable({ write(_chunk, _encoding, callback) { callback() } })
    const pending = clackNestedMultiselect({
      message: 'Features', input, output, options: [{ value: 'one', label: 'One' }],
    })
    setTimeout(() => input.write('\u0003'), 0)
    await expect(pending).resolves.toEqual({ status: 'cancelled' })
  })

  it('enters an exclusive child with Right and commits the selected option', async () => {
    const input = new PassThrough()
    let screen = ''
    const output = new Writable({ write(chunk, _encoding, callback) { screen += String(chunk); callback() } })
    const pending = clackNestedMultiselect({
      message: 'Features',
      showChanges: true,
      input,
      output,
      options: [
        {
          value: 'persistence',
          label: 'Session storage',
          required: true,
          default: true,
          choiceMode: 'exclusive',
          choices: [
            { value: 'jsonl', label: 'JSONL', default: true },
            { value: 'sqlite', label: 'SQLite' },
          ],
        },
        { value: 'fs', label: 'Filesystem', default: true },
      ],
    })
    setTimeout(() => input.write('\x1b[C\x1b[B\x1b[A\x1b[B\x1b[C\r\r'), 0)
    await expect(pending).resolves.toEqual({
      status: 'answered',
      value: [
        { value: 'persistence', choices: ['sqlite'] },
        { value: 'fs', choices: [] },
      ],
    })
    const rendered = stripVTControlCharacters(screen)
    expect(rendered).toContain(`› ${S_CHECKBOX_SELECTED} Session storage`)
    expect(rendered).toContain(`› ${S_RADIO_ACTIVE} SQLite`)
    expect(rendered).toContain('● changed')
  })

  it('highlights and blocks a selected multiple feature with no child option', async () => {
    const input = new PassThrough()
    let screen = ''
    const output = new Writable({ write(chunk, _encoding, callback) { screen += String(chunk); callback() } })
    const pending = clackNestedMultiselect({
      message: 'Features',
      input,
      output,
      options: [{
        value: 'hooks',
        label: 'Hooks',
        default: true,
        choiceMode: 'multiple',
        choices: [
          { value: 'claude', label: 'Claude', default: true },
          { value: 'codex', label: 'Codex' },
        ],
      }],
    })
    setTimeout(() => input.write('\x1b[C \x1b[D \x1b[D\r'), 0)
    await expect(pending).resolves.toEqual({
      status: 'answered',
      value: [{ value: 'hooks', choices: ['claude'] }],
    })
    expect(stripVTControlCharacters(screen)).toContain('▲ choose at least one')
  })

  it('blocks root submission for an exclusive feature with no selected option', async () => {
    const input = new PassThrough()
    let screen = ''
    const output = new Writable({ write(chunk, _encoding, callback) { screen += String(chunk); callback() } })
    const pending = clackNestedMultiselect({
      message: 'Features', input, output,
      options: [{
        value: 'provider', label: 'Provider', default: true, choiceMode: 'exclusive',
        choices: [{ value: 'one', label: 'One' }],
      }],
    })
    setTimeout(() => input.write('\r\x1b[C\x1b[C\r\r'), 0)
    await expect(pending).resolves.toEqual({
      status: 'answered', value: [{ value: 'provider', choices: ['one'] }],
    })
    expect(stripVTControlCharacters(screen)).toContain('Choose one Provider option')
  })

  it('blocks root submission for a multiple feature with no selected option', async () => {
    const input = new PassThrough()
    const output = new Writable({ write(_chunk, _encoding, callback) { callback() } })
    const pending = clackNestedMultiselect({
      message: 'Features', input, output,
      options: [{
        value: 'hooks', label: 'Hooks', default: true, choiceMode: 'multiple',
        choices: [{ value: 'one', label: 'One' }],
      }],
    })
    setTimeout(() => input.write('\r\x1b[C \r\r'), 0)
    await expect(pending).resolves.toEqual({
      status: 'answered', value: [{ value: 'hooks', choices: ['one'] }],
    })
  })

  it('renders an unchanged checked option while another child is focused', async () => {
    const input = new PassThrough()
    const output = new Writable({ write(_chunk, _encoding, callback) { callback() } })
    const pending = clackNestedMultiselect({
      message: 'Features', input, output,
      options: [{
        value: 'hooks', label: 'Hooks', default: true, choiceMode: 'multiple',
        choices: [
          { value: 'one', label: 'One', default: true },
          { value: 'two', label: 'Two', default: true },
        ],
      }],
    })
    setTimeout(() => input.write('\x1b[C\x1b[B\x1b[D\r'), 0)
    await expect(pending).resolves.toEqual({
      status: 'answered', value: [{ value: 'hooks', choices: ['one', 'two'] }],
    })
  })

  it('submits an empty optional selection', async () => {
    const input = new PassThrough()
    const output = new Writable({ write(_chunk, _encoding, callback) { callback() } })
    const pending = clackNestedMultiselect({
      message: 'Features', input, output, options: [{ value: 'one', label: 'One' }],
    })
    setTimeout(() => input.write('\r'), 0)
    await expect(pending).resolves.toEqual({ status: 'answered', value: [] })
  })
})

describe('feature configurator', () => {
  const profile: ProjectProfile = {
    name: 'demo',
    description: 'demo',
    runtime: { model: 'deepseek-v4-flash' },
    runInterface: 'embed',
    packageManager: new NpmPackageManager('10.0.0'),
    releaseVersion: '0.0.1',
  }

  it('shares exclusive, multiple, fixed, and secret behavior', async () => {
    const registry = createBuiltinRegistry(profile)
    const port = new QueuePromptPort(['sqlite', ['spawn', 'fork'], 'deepseek-official', 'new-key'])
    const configurator = new FeatureConfigurator(port)
    await expect(configurator.configure(registry.get(featureId('persistence')), profile)).resolves.toMatchObject({
      options: ['sqlite'],
    })
    await expect(configurator.configure(registry.get(featureId('subagent')), profile)).resolves.toMatchObject({
      options: ['spawn', 'fork'],
    })
    await expect(configurator.configure(
      registry.get(featureId('provider')),
      profile,
      { id: featureId('provider'), options: ['deepseek-official'], secrets: { apiKey: 'old-key' } },
    )).resolves.toMatchObject({ secrets: { apiKey: 'new-key' } })
    expect(port.requests).toEqual([
      'Choose durable session storage',
      'Choose delegate work to child agents',
      'Choose model provider',
      'DeepSeek API key (leave empty to keep current)',
    ])
  })

  it('validates feature values, defaults, and retained secrets', async () => {
    const registry = createBuiltinRegistry(profile)
    const fixed = new FeatureConfigurator(new QueuePromptPort([]))
    await expect(fixed.configure(registry.get(featureId('bash')), profile, undefined, ['local'])).resolves.toMatchObject({
      options: ['local'],
    })
    const requiredSecret = new FeatureConfigurator(new QueuePromptPort([]))
    await expect(requiredSecret.configure(
      registry.get(featureId('provider')), profile, undefined, ['deepseek-official'], { apiKey: '' },
    )).rejects.toThrow('required')
    const keep = new FeatureConfigurator(new QueuePromptPort(['deepseek-official', '']))
    await expect(keep.configure(
      registry.get(featureId('provider')),
      profile,
      { id: featureId('provider'), options: ['deepseek-official'], secrets: { apiKey: 'old' } },
    )).resolves.toMatchObject({ secrets: { apiKey: 'old' } })
    const custom = registry.get(featureId('provider'))
    await expect(new FeatureConfigurator(new QueuePromptPort(['custom'])).configure(
      custom,
      profile,
      { id: featureId('provider'), options: ['custom'], values: { baseURL: 1 }, secrets: { apiKey: 'old' } },
    )).rejects.toThrow('current value must be a string')
    await expect(new FeatureConfigurator(new QueuePromptPort(['custom', ''])).configure(
      custom, profile, undefined,
    )).rejects.toThrow('required')
    await expect(new FeatureConfigurator(new QueuePromptPort(['custom', 'https://next', ''])).configure(
      custom,
      profile,
      {
        id: featureId('provider'), options: ['custom'],
        values: { baseURL: 'https://old' }, secrets: { apiKey: 'old' },
      },
    )).resolves.toMatchObject({ values: { baseURL: 'https://next' }, secrets: { apiKey: 'old' } })
    class EmptyExclusive extends ExclusiveOptionFeature {
      override readonly id = featureId('empty-exclusive')
      override readonly summary = 'Empty'
      override readonly options = [new (class extends FeatureOption {
        override readonly id = 'one'
        override readonly label = 'One'
        override contribution(): ProjectContribution { return new ProjectContribution([]) }
      })()]
      override defaultOptions(): readonly string[] { return [] }
    }
    await expect(new FeatureConfigurator(new QueuePromptPort([])).configure(new EmptyExclusive(), profile))
      .rejects.toThrow('has no default option')
  })

  it('configures fully from prefilled options, values, and secrets without prompting', async () => {
    const registry = createBuiltinRegistry(profile)
    const port = new QueuePromptPort([])
    const result = await new FeatureConfigurator(port).configure(
      registry.get(featureId('provider')),
      profile,
      undefined,
      ['custom'],
      { apiKey: 'prefilled-key' },
      { baseURL: 'https://prefilled' },
    )
    expect(result).toMatchObject({
      options: ['custom'],
      values: { baseURL: 'https://prefilled' },
      secrets: { apiKey: 'prefilled-key' },
    })
    expect(port.requests).toEqual([])
  })

  it('rejects a non-string prefilled feature value', async () => {
    const registry = createBuiltinRegistry(profile)
    await expect(new FeatureConfigurator(new QueuePromptPort([])).configure(
      registry.get(featureId('provider')),
      profile,
      undefined,
      ['custom'],
      { apiKey: 'k' },
      { baseURL: 123 },
    )).rejects.toThrow('must be a string')
  })
})
