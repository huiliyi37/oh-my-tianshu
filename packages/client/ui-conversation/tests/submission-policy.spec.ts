// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BUSY_ENTER_STORAGE_KEY, ComposerSubmissionPolicy, DEFAULT_BUSY_ENTER_BEHAVIOR,
} from '../src/client/input/submission-policy.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('ComposerSubmissionPolicy', () => {
  it('defaults to Queue and only applies the preference while running', () => {
    const policy = new ComposerSubmissionPolicy()
    expect(policy.busyEnter.getSnapshot()).toBe(DEFAULT_BUSY_ENTER_BEHAVIOR)
    expect(policy.resolve(false, 'enter', true)).toBe('queue')
    expect(policy.resolve(false, 'accelerated', true)).toBe('queue')
    expect(policy.resolve(true, 'enter', true)).toBe('queue')
    expect(policy.resolve(true, 'accelerated', true)).toBe('steer')
    expect(policy.resolve(true, 'enter', false)).toBe('queue')
    expect(policy.resolve(true, 'accelerated', false)).toBe('queue')

    const changed = vi.fn()
    policy.busyEnter.subscribe(changed)
    policy.setBusyEnter('steer')
    expect(changed).toHaveBeenCalledTimes(1)
    expect(policy.resolve(true, 'enter', true)).toBe('steer')
    expect(policy.resolve(true, 'accelerated', true)).toBe('queue')
    expect(policy.resolve(false, 'enter', true)).toBe('queue')
    expect(policy.resolve(false, 'accelerated', true)).toBe('queue')
    expect(localStorage.getItem(BUSY_ENTER_STORAGE_KEY)).toBe('steer')
  })

  it('restores a valid preference and leaves an identical write untouched', () => {
    localStorage.setItem(BUSY_ENTER_STORAGE_KEY, 'steer')
    const write = vi.spyOn(Storage.prototype, 'setItem')
    const policy = new ComposerSubmissionPolicy()
    expect(policy.busyEnter.getSnapshot()).toBe('steer')
    policy.setBusyEnter('steer')
    expect(write).not.toHaveBeenCalled()
    write.mockRestore()
  })

  it('uses Queue for invalid, unavailable, or unreadable storage', () => {
    localStorage.setItem(BUSY_ENTER_STORAGE_KEY, 'invalid')
    expect(new ComposerSubmissionPolicy().busyEnter.getSnapshot()).toBe('queue')

    vi.stubGlobal('localStorage', undefined)
    expect(new ComposerSubmissionPolicy().busyEnter.getSnapshot()).toBe('queue')

    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked') },
      setItem: vi.fn(),
    })
    expect(new ComposerSubmissionPolicy().busyEnter.getSnapshot()).toBe('queue')
  })

  it('keeps the in-memory preference when persistence throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { return null },
      setItem: () => { throw new Error('quota') },
    })
    const policy = new ComposerSubmissionPolicy()
    policy.setBusyEnter('steer')
    expect(policy.busyEnter.getSnapshot()).toBe('steer')
  })
})
