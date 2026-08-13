// @vitest-environment jsdom
/** First-run DeepSeek prompt behavior over the shared Models join. */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcResponse } from '@huiliyi37/dsh-client-connection/client'
import { bindSnapshotSelector } from '@huiliyi37/dsh-client-web-react'
import { DeepSeekOnboardingDialog } from '../src/client/DeepSeekOnboardingDialog.tsx'
import type { DeepSeekOnboardingDialogProps } from '../src/client/DeepSeekOnboardingDialog.tsx'
import { ModelsSettingsStore } from '../src/client/store.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

let nextRpc = 0
function ok<T>(value: T): RpcResponse<T> {
  return { rpcId: `onboarding-${nextRpc++}` as never, result: { ok: true, value } }
}
function fail<T>(message: string): RpcResponse<T> {
  return {
    rpcId: `onboarding-${nextRpc++}` as never,
    result: { ok: false, error: { code: 'internal', message, details: {} } },
  }
}

function harness(options: {
  provider?: boolean
  providerSettingsNs?: string
  providerActive?: boolean
  settingsNamespace?: boolean
  apiKeyEnv?: string | null
  configured?: () => boolean
  credential?: { source?: string; writable: boolean }
  describeFailure?: string
  settingsWritable?: boolean
  providersReject?: boolean
} = {}) {
  let fileConfigured = false
  const configured = options.configured ?? (() => { return fileConfigured })
  const face = {
    llm: {
      providers: () => {
        if (options.providersReject === true) { return Promise.reject(new Error('provider transport unavailable')) }
        return Promise.resolve(ok({
          providers: options.provider === false
            ? []
            : [{
              provider: 'deepseek-official',
              displayName: 'DeepSeek',
              settingsNs: options.providerSettingsNs ?? 'llm-deepseek',
              settingsPath: [],
              active: options.providerActive ?? true,
            }],
        }))
      },
    },
    settings: {
      describe: () => Promise.resolve(ok({
        writable: options.settingsWritable ?? true,
        namespaces: options.settingsNamespace === false
          ? []
          : [{
            ns: 'llm-deepseek',
            schema: {},
            value: options.apiKeyEnv === null
              ? {}
              : { apiKeyEnv: options.apiKeyEnv ?? 'DEEPSEEK_API_KEY' },
            applies: 'live' as const,
            secrets: [],
            revision: 0,
          }],
      })),
    },
    credentials: {
      describe: () => options.describeFailure === undefined
        ? Promise.resolve(ok({
          credentials: {
            DEEPSEEK_API_KEY: {
              configured: configured(),
              ...configured() && options.credential?.source !== undefined
                ? { source: options.credential.source }
                : {},
              writable: options.credential?.writable ?? true,
            },
          },
        }))
        : Promise.resolve(fail(options.describeFailure)),
    },
  }
  const controller = new ModelsSettingsStore(face as never)
  const openSection = vi.fn()
  const complete = vi.fn()
  const unusedHook = (() => { throw new Error('unused standard hook') }) as never
  const props: DeepSeekOnboardingDialogProps = {
    stepId: 'deepseek-official',
    complete,
    openSection,
    useSessions: unusedHook,
    useWorkspaces: unusedHook,
    controller,
    useSnapshot: bindSnapshotSelector(controller.store),
    t: key => en[key],
  }
  return { controller, complete, openSection, props, configure: () => { fileConfigured = true } }
}

describe('DeepSeekOnboardingDialog', () => {
  it('loads on first entry and presents one accessible route to Models', async () => {
    const h = harness()
    render(<DeepSeekOnboardingDialog {...h.props} />)
    expect(await screen.findByRole('region', { name: en.onboardingTitle })).toBeTruthy()
    expect(screen.getByText(en.onboardingDescription)).toBeTruthy()
    const action = screen.getByRole('button', { name: en.onboardingGoToSettings })
    expect(action).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: en.onboardingTitle }))
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('opens the Models section and dismisses the prompt', async () => {
    const h = harness()
    render(<DeepSeekOnboardingDialog {...h.props} />)
    await screen.findByRole('region')
    fireEvent.click(screen.getByRole('button', { name: en.onboardingGoToSettings }))
    expect(h.complete).toHaveBeenCalledOnce()
    expect(h.openSection).toHaveBeenCalledWith('models')
  })

  it('allows configure-later dismissal without opening settings', async () => {
    const h = harness()
    render(<DeepSeekOnboardingDialog {...h.props} />)
    await screen.findByRole('region')
    fireEvent.click(screen.getByRole('button', { name: en.onboardingLater }))
    expect(h.complete).toHaveBeenCalledOnce()
    expect(h.openSection).not.toHaveBeenCalled()
  })

  it('does not block the product when DeepSeek setup is unavailable', async () => {
    for (const h of [
      harness({ describeFailure: 'credentials service is absent' }),
      harness({ credential: { writable: false } }),
      harness({ settingsWritable: false }),
      harness({ providersReject: true }),
      harness({ providerActive: false }),
      harness({ settingsNamespace: false }),
      harness({ apiKeyEnv: null }),
    ]) {
      const view = render(<DeepSeekOnboardingDialog {...h.props} />)
      await act(async () => { await h.controller.load() })
      expect(screen.queryByRole('region')).toBeNull()
      await waitFor(() => { expect(h.complete).toHaveBeenCalledOnce() })
      expect(h.openSection).not.toHaveBeenCalled()
      view.unmount()
    }
  })

  it('skips an absent adapter and an already-configured environment credential', async () => {
    for (const h of [
      harness({ provider: false }),
      harness({ providerSettingsNs: '' }),
      harness({ configured: () => true, credential: { source: 'env', writable: false } }),
    ]) {
      const view = render(<DeepSeekOnboardingDialog {...h.props} />)
      await act(async () => { await h.controller.load() })
      expect(screen.queryByRole('region')).toBeNull()
      await waitFor(() => { expect(h.complete).toHaveBeenCalledOnce() })
      view.unmount()
    }
  })

  it('closes when an external credential invalidation refreshes the shared join', async () => {
    const h = harness()
    render(<DeepSeekOnboardingDialog {...h.props} />)
    await screen.findByRole('region')
    h.configure()
    await act(async () => { await h.controller.load() })
    await waitFor(() => { expect(screen.queryByRole('region')).toBeNull() })
    expect(h.complete).toHaveBeenCalledOnce()
  })
})
