/** Pure official-DeepSeek readiness projection over the shared Models join. */
import { describe, expect, it } from 'vitest'
import type { CredentialView } from '@deepseek-ai/dsh-client-connection/client'
import type { ModelsSettingsState, ProviderRow } from '../src/client/store.ts'
import { deepSeekReadiness } from '../src/client/store.ts'

const missingCredential: CredentialView = { configured: false, writable: true }

function row(overrides: Partial<ProviderRow> = {}): ProviderRow {
  return {
    entry: {
      provider: 'deepseek-official',
      displayName: 'DeepSeek',
      settingsNs: 'llm-deepseek',
      settingsPath: [],
      active: true,
    },
    configured: true,
    removable: false,
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    credential: missingCredential,
    ...overrides,
  }
}

function state(overrides: Partial<ModelsSettingsState> = {}): ModelsSettingsState {
  return {
    status: 'ready',
    error: null,
    credentialError: null,
    writable: true,
    rows: [row()],
    namespaces: new Map(),
    ...overrides,
  }
}

describe('deepSeekReadiness', () => {
  it('waits for the first join and skips onboarding when the adapter directory entry is absent', () => {
    expect(deepSeekReadiness(state({ status: 'idle', rows: [] }))).toEqual({ kind: 'loading' })
    expect(deepSeekReadiness(state({ status: 'loading', rows: [] }))).toEqual({ kind: 'loading' })
    expect(deepSeekReadiness(state({ rows: [] }))).toEqual({ kind: 'adapter-absent' })
    expect(deepSeekReadiness(state({
      rows: [row({
        entry: {
          ...row().entry,
          settingsNs: '',
        },
      })],
    }))).toEqual({ kind: 'adapter-absent' })
  })

  it('reports a missing writable effective credential', () => {
    expect(deepSeekReadiness(state())).toEqual({ kind: 'credential-missing' })
  })

  it('accepts file and process-environment credentials without prompting', () => {
    expect(deepSeekReadiness(state({
      rows: [row({ credential: { configured: true, source: 'file', writable: true } })],
    }))).toEqual({ kind: 'configured' })
    expect(deepSeekReadiness(state({
      rows: [row({ credential: { configured: true, source: 'env', writable: false } })],
    }))).toEqual({ kind: 'configured' })
  })

  it('turns missing capabilities and inconsistent descriptors into diagnostics', () => {
    expect(deepSeekReadiness(state({ status: 'error', error: 'settings down' }))).toEqual({
      kind: 'unavailable',
      reason: 'load-failed',
    })
    expect(deepSeekReadiness(state({
      rows: [row({ entry: { ...row().entry, active: false } })],
    }))).toEqual({ kind: 'unavailable', reason: 'provider-inactive' })
    expect(deepSeekReadiness(state({
      rows: [row({ configured: false })],
    }))).toEqual({ kind: 'unavailable', reason: 'settings-unavailable' })
    expect(deepSeekReadiness(state({
      rows: [row({ apiKeyEnv: undefined })],
    }))).toEqual({ kind: 'unavailable', reason: 'credential-ref-unavailable' })
    expect(deepSeekReadiness(state({
      credentialError: 'credentials service is absent',
    }))).toEqual({
      kind: 'unavailable',
      reason: 'credentials-unavailable',
    })
    expect(deepSeekReadiness(state({
      rows: [row({ credential: undefined })],
    }))).toEqual({ kind: 'unavailable', reason: 'credentials-unavailable' })
    expect(deepSeekReadiness(state({
      rows: [row({ credential: { configured: false, writable: false } })],
    }))).toEqual({ kind: 'unavailable', reason: 'credential-read-only' })
    expect(deepSeekReadiness(state({ writable: false }))).toEqual({
      kind: 'unavailable',
      reason: 'settings-read-only',
    })
  })
})
