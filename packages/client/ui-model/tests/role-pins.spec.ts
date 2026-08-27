/**
 * RolePinsController unit tests (P2④ final tail): namespace-view parsing,
 * catalog degradation, set/unset mutation shapes with revision concurrency,
 * and the unavailable/error states.
 */

import { describe, expect, it, vi } from 'vitest'
import type { SettingsNamespaceView } from '@huiliyi37/dsh-client-connection/client'
import { MODEL_ROLES, RolePinsController } from '../src/client/role-pins.ts'

function view(value: unknown, revision = 0): SettingsNamespaceView {
  return {
    ns: 'model-roles', schema: {}, value, applies: 'live', secrets: [], revision,
  }
}

function ok<T>(value: T) {
  return { rpcId: 'test', result: { ok: true as const, value } }
}

function describeWith(value: unknown, writable = true, revision = 3) {
  return vi.fn(() => Promise.resolve(ok({
    writable, hasDocument: false, namespaces: [view(value, revision)],
  })))
}

const CATALOG = {
  groups: [{
    id: 'deepseek-official',
    name: 'DeepSeek',
    models: [
      { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', reasoning: undefined },
      { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', reasoning: undefined },
    ],
  }],
  failures: [],
}

describe('RolePinsController', () => {
  it('loads pins from the resolved namespace value and the global catalog', async () => {
    const controller = new RolePinsController({
      settings: {
        describe: describeWith({ vision: { provider: 'deepseek-official', model: 'deepseek-v4-pro' } }),
        mutate: vi.fn(),
      },
      llm: { models: vi.fn(() => Promise.resolve(ok(CATALOG))) },
    } as never)
    await controller.load()
    expect(controller.store.getSnapshot()).toMatchObject({
      status: 'ready',
      writable: true,
      revision: 3,
      pins: { vision: { provider: 'deepseek-official', model: 'deepseek-v4-pro' } },
    })
    expect(controller.store.getSnapshot().catalog.groups.length).toBe(1)
  })

  it('tolerates a catalog failure without failing the pins read', async () => {
    const controller = new RolePinsController({
      settings: { describe: describeWith({}), mutate: vi.fn() },
      llm: { models: vi.fn(() => Promise.resolve({ rpcId: 't', result: { ok: false as const, error: { code: 'internal', message: 'boom', details: {} } } })) },
    } as never)
    await controller.load()
    expect(controller.store.getSnapshot().status).toBe('ready')
    expect(controller.store.getSnapshot().catalog.groups).toEqual([])
  })

  it('marks the row unavailable when the model-roles namespace is absent', async () => {
    const controller = new RolePinsController({
      settings: {
        describe: vi.fn(() => Promise.resolve(ok({ writable: true, hasDocument: false, namespaces: [] }))),
        mutate: vi.fn(),
      },
      llm: { models: vi.fn(() => Promise.resolve(ok(CATALOG))) },
    } as never)
    await controller.load()
    expect(controller.store.getSnapshot().status).toBe('unavailable')
  })

  it('pins one role with a set op and clears it with an unset op (revision-guarded)', async () => {
    const mutate = vi.fn(() => Promise.resolve(ok(view({ secondary: { provider: 'p', model: 'm' } }, 4))))
    const controller = new RolePinsController({
      settings: { describe: describeWith({}), mutate },
      llm: { models: vi.fn(() => Promise.resolve(ok(CATALOG))) },
    } as never)
    await controller.load()

    await controller.selectRole('secondary', { provider: 'p', model: 'm' })
    expect(mutate).toHaveBeenCalledWith({
      ns: 'model-roles',
      ops: [{ op: 'set', path: ['secondary'], value: { provider: 'p', model: 'm' } }],
      expectedRevision: 3,
    })
    expect(controller.store.getSnapshot()).toMatchObject({
      status: 'ready',
      pins: { secondary: { provider: 'p', model: 'm' } },
      revision: 4,
    })

    await controller.selectRole('secondary', undefined)
    expect(mutate).toHaveBeenLastCalledWith({
      ns: 'model-roles',
      ops: [{ op: 'unset', path: ['secondary'] }],
      expectedRevision: 4,
    })
  })

  it('surfaces mutation failures on the store', async () => {
    const controller = new RolePinsController({
      settings: {
        describe: describeWith({}),
        mutate: vi.fn(() => Promise.resolve({ rpcId: 't', result: { ok: false as const, error: { code: 'settings-conflict', message: 'stale', details: { ns: 'model-roles', expected: 3, actual: 4 } } } })),
      },
      llm: { models: vi.fn(() => Promise.resolve(ok(CATALOG))) },
    } as never)
    await controller.load()
    await controller.selectRole('vision', { provider: 'p', model: 'm' })
    const state = controller.store.getSnapshot()
    expect(state.status).toBe('error')
    expect(state.error).toContain('stale')
  })

  it('MODEL_ROLES lists the three pinned roles in display order', () => {
    expect(MODEL_ROLES).toEqual(['vision', 'secondary', 'subagent'])
  })
})
