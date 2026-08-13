/**
 * Official-DeepSeek first-run step. Readiness comes from the same
 * provider/settings/credential join as the Models page; the prompt only
 * routes the user to that page's single credential editor.
 */

import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { BrandWordmark, Button, OnboardingSurface } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-web-react'
import type { ModelsSettingsState, ModelsSettingsStore } from './store.ts'
import { deepSeekReadiness } from './store.ts'
import type { en } from './locales.ts'
import styles from './DeepSeekOnboardingDialog.module.css'

/** Injected dependencies of {@link DeepSeekOnboardingDialog}. */
export interface DeepSeekOnboardingInjected {
  /** Shared Models-page join controller. */
  controller: ModelsSettingsStore
  /** Subscription hook bound to the shared join snapshot. */
  useSnapshot: SnapshotSelectorHook<ModelsSettingsState>
  /** Feature copy. */
  t: (key: keyof typeof en) => string
}

/** Slot owner props plus the feature's injected dependencies. */
export type DeepSeekOnboardingDialogProps =
  PropsRuntime<'settings.onboarding'> & DeepSeekOnboardingInjected

/* v8 ignore next 3 -- closed-union defaults only defend future source widening */
function assertNever(_value: never): never {
  throw new Error('unexpected DeepSeek onboarding state')
}

/**
 * Prompt a first-run user to open Models while the official adapter exists
 * and its effective credential is not configured.
 * @param props - settings-shell owner state and Models feature dependencies.
 * @returns the onboarding page or null when onboarding needs no intervention.
 */
export function DeepSeekOnboardingDialog(props: DeepSeekOnboardingDialogProps): ReactNode {
  const { complete, openSection, controller, useSnapshot, t } = props
  const state = useSnapshot(snapshot => snapshot)
  const readiness = deepSeekReadiness(state)
  const titleRef = useRef<HTMLHeadingElement | null>(null)

  useEffect(() => {
    if (state.status === 'idle') void controller.load()
  }, [controller, state.status])

  useEffect(() => {
    if (
      readiness.kind === 'adapter-absent'
      || readiness.kind === 'configured'
      || readiness.kind === 'unavailable'
    ) complete()
  }, [complete, readiness.kind])

  useEffect(() => {
    if (readiness.kind === 'credential-missing') titleRef.current?.focus()
  }, [readiness.kind])

  const openModels = (): void => {
    complete()
    openSection('models')
  }

  // Null covers the still-deciding and nothing-to-do states alike: the
  // takeover chrome below is part of THIS render, so declining paints and
  // blocks nothing while the shared join is in flight.
  switch (readiness.kind) {
    case 'loading':
    case 'adapter-absent':
    case 'configured':
    case 'unavailable':
      return null
    case 'credential-missing':
      break
    /* v8 ignore next -- every current readiness variant is handled above */
    default:
      return assertNever(readiness)
  }

  return (
    <OnboardingSurface>
      <section className={styles['page']} role="region" aria-labelledby="deepseek-onboarding-title">
        <div className={styles['brand']} aria-hidden="true"><BrandWordmark size={24} /></div>
        <h2
          ref={titleRef}
          id="deepseek-onboarding-title"
          className={styles['title']}
          tabIndex={-1}
        >
          {t('onboardingTitle')}
        </h2>
        <p className={styles['description']}>{t('onboardingDescription')}</p>
        <div className={styles['actions']}>
          <Button variant="ghost" className={styles['later']} onClick={complete}>
            {t('onboardingLater')}
          </Button>
          <Button variant="primary" className={styles['primary']} onClick={openModels}>
            {t('onboardingGoToSettings')}
          </Button>
        </div>
      </section>
    </OnboardingSurface>
  )
}
