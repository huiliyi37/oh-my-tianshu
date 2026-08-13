import { describe, expect, it } from 'vitest'
import { HeadlessPromptError, HeadlessPromptPort } from '../src/questions/headless-prompt-port.ts'

/** Unwrap an answered outcome or fail the test. */
async function answered<T>(promise: Promise<{ status: 'answered'; value: T } | { status: 'cancelled' }>): Promise<T> {
  const outcome = await promise
  if (outcome.status !== 'answered') throw new Error('expected an answered outcome')
  return outcome.value
}

describe('HeadlessPromptError', () => {
  it('names the unanswered prompt', () => {
    const error = new HeadlessPromptError('DeepSeek API key')
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('HeadlessPromptError')
    expect(error.prompt).toBe('DeepSeek API key')
    expect(error.message).toContain('DeepSeek API key')
  })
})

describe('HeadlessPromptPort', () => {
  const port = new HeadlessPromptPort()

  describe('text', () => {
    it('takes the initial value when present', async () => {
      expect(await answered(port.text({ message: 'name', initialValue: 'agent' }))).toBe('agent')
    })

    it('falls back to the default value', async () => {
      expect(await answered(port.text({ message: 'dir', defaultValue: 'my-agent' }))).toBe('my-agent')
    })

    it('prefers the initial value over the default value', async () => {
      expect(await answered(port.text({ message: 'dir', initialValue: 'given', defaultValue: 'my-agent' }))).toBe('given')
    })

    it('fails loud when no default exists', async () => {
      await expect(port.text({ message: 'base URL' })).rejects.toThrow(HeadlessPromptError)
    })

    it('fails loud when the default is invalid', async () => {
      await expect(port.text({
        message: 'name',
        defaultValue: '',
        validate: value => value.length === 0 ? 'required' : undefined,
      })).rejects.toThrow(/required/)
    })
  })

  describe('secret', () => {
    it('always fails loud', async () => {
      await expect(port.secret({ message: 'API key' })).rejects.toThrow(HeadlessPromptError)
    })
  })

  describe('select', () => {
    it('takes the initial value when present', async () => {
      expect(await answered(port.select({ message: 'pm', options: [{ value: 'npm', label: 'npm' }], initialValue: 'npm' }))).toBe('npm')
    })

    it('fails loud without an initial value', async () => {
      await expect(port.select({ message: 'pm', options: [{ value: 'npm', label: 'npm' }] })).rejects.toThrow(HeadlessPromptError)
    })
  })

  describe('multiselect', () => {
    it('returns the initial values', async () => {
      expect(await answered(port.multiselect({ message: 'x', options: [], initialValues: ['a', 'b'] }))).toEqual(['a', 'b'])
    })

    it('returns an empty selection when none are supplied and none are required', async () => {
      expect(await answered(port.multiselect({ message: 'x', options: [] }))).toEqual([])
    })

    it('fails loud when required and nothing is preselected', async () => {
      await expect(port.multiselect({ message: 'x', options: [], required: true })).rejects.toThrow(HeadlessPromptError)
    })
  })

  describe('confirm', () => {
    it('takes the initial value when present', async () => {
      expect(await answered(port.confirm({ message: 'install?', initialValue: false }))).toBe(false)
    })

    it('fails loud without an initial value', async () => {
      await expect(port.confirm({ message: 'apply?' })).rejects.toThrow(HeadlessPromptError)
    })
  })

  describe('nestedMultiselect', () => {
    it('always fails loud', async () => {
      await expect(port.nestedMultiselect({ message: 'Select features', options: [] })).rejects.toThrow(HeadlessPromptError)
    })
  })
})
