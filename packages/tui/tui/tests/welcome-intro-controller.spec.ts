/**
 * Process-local welcome intro settlement contracts.
 */

import { describe, expect, it } from 'vitest'
import {
  WelcomeIntroController,
  type WelcomeIntroSnapshotInput,
} from '../src/controllers/welcome-intro-controller.js'

function snapshot(
  over: Partial<WelcomeIntroSnapshotInput> = {},
): WelcomeIntroSnapshotInput {
  return {
    modelId: 'deepseek-chat',
    reasoningEffort: 'high',
    cwd: '/work/tianshu',
    version: '0.4.0',
    restoreLines: ['[1] session one', '[2] session two'],
    tip: 'Tip: stay focused',
    ...over,
  }
}

describe('WelcomeIntroController settlement', () => {
  it('is immediately complete while active', () => {
    const controller = new WelcomeIntroController(snapshot(), 1_000)

    expect(controller.current(1_000)).toEqual({ kind: 'complete', elapsedMs: 0 })
    expect(controller.current(4_240)).toEqual({ kind: 'complete', elapsedMs: 0 })
    expect(controller.active).toBe(true)
    expect(controller.settled).toBe(false)
  })
})

describe('WelcomeIntroController ownership', () => {
  it('defensively freezes the snapshot and restore-line array', () => {
    const restoreLines = ['[1] original']
    const controller = new WelcomeIntroController(snapshot({ restoreLines }), 0)

    restoreLines.push('[2] external mutation')
    expect(controller.snapshot.restoreLines).toEqual(['[1] original'])
    expect(Object.isFrozen(controller.snapshot)).toBe(true)
    expect(Object.isFrozen(controller.snapshot.restoreLines)).toBe(true)
    expect(() => {
      ;(controller.snapshot.restoreLines as string[]).push('[3] forbidden')
    }).toThrow()
  })

  it('omits an unavailable distribution version from the frozen snapshot', () => {
    const controller = new WelcomeIntroController({
      modelId: 'deepseek-chat',
      cwd: '/work/tianshu',
      restoreLines: [],
      tip: 'Tip: stay focused',
    }, 0)

    expect(controller.snapshot).not.toHaveProperty('version')
  })

  it.each(['natural', 'input', 'resize', 'skipped', 'commit'] as const)(
    'settles once with the first %s reason and emits no late sample',
    (reason) => {
      const controller = new WelcomeIntroController(snapshot(), 0)

      expect(controller.settle(reason)).toBe(true)
      expect(controller.settle('resize')).toBe(false)
      expect(controller.active).toBe(false)
      expect(controller.settled).toBe(true)
      expect(controller.cancelled).toBe(false)
      expect(controller.settleReason).toBe(reason)
      expect(controller.current(120)).toBeNull()
    },
  )

  it('cancels idempotently and emits no late sample', () => {
    const controller = new WelcomeIntroController(snapshot(), 0)

    expect(controller.cancel()).toBe(true)
    expect(controller.cancel()).toBe(false)
    expect(controller.settle('natural')).toBe(false)
    expect(controller.active).toBe(false)
    expect(controller.settled).toBe(false)
    expect(controller.cancelled).toBe(true)
    expect(controller.current(1)).toBeNull()
  })
})
