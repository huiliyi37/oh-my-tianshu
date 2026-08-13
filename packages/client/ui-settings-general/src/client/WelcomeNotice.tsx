/** Product-wide, versioned first-run welcome step. */

import { useCallback, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { BrandWordmark, Button, OnboardingSurface } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-web-react'
import type { WelcomeNoticeState, WelcomeNoticeStore } from './welcome-store.ts'
import css from './WelcomeNotice.module.css'

function emphasizedFeedback(paragraph: string, emphasis: string): ReactNode {
  const index = paragraph.indexOf(emphasis)
  /* v8 ignore next -- both locale values derive from one owner object that contains the emphasis */
  if (index < 0) return paragraph
  return (
    <>
      {paragraph.slice(0, index)}
      <strong>{emphasis}</strong>
      {paragraph.slice(index + emphasis.length)}
    </>
  )
}

/** Registrant-owned dependencies of {@link WelcomeNotice}. */
export interface WelcomeNoticeInjected {
  controller: WelcomeNoticeStore
  useSnapshot: SnapshotSelectorHook<WelcomeNoticeState>
}

/** Coordinator owner props plus the welcome step's injected face. */
export type WelcomeNoticeProps =
  PropsRuntime<'settings.onboarding'> & PropsLocale<'settings'> & WelcomeNoticeInjected

/** Render the mandatory notice until its current version is acknowledged. */
export function WelcomeNotice(props: WelcomeNoticeProps): ReactNode {
  const { complete, controller, useSnapshot, t } = props
  const state = useSnapshot(snapshot => snapshot)
  const finished = useRef(false)
  const titleRef = useRef<HTMLHeadingElement | null>(null)
  const finish = useCallback((): void => {
    if (finished.current) return
    finished.current = true
    complete()
  }, [complete])

  useEffect(() => {
    if (state.status === 'idle') void controller.load()
  }, [controller, state.status])

  useEffect(() => {
    if (state.acknowledged) finish()
  }, [finish, state.acknowledged])

  useEffect(() => {
    if (state.status === 'ready' && !state.acknowledged) { titleRef.current?.focus() }
  }, [state.acknowledged, state.status])

  // Null while the acknowledgement fact is still loading (or already given):
  // the takeover chrome below is part of THIS render, so deciding not to
  // show paints and blocks nothing.
  if (state.status === 'idle' || state.status === 'loading' || state.acknowledged) return null

  const acknowledge = async (): Promise<void> => {
    if (await controller.acknowledge()) finish()
  }

  return (
    <OnboardingSurface>
      <section className={css.page} role="region" aria-labelledby="welcome-notice-title">
        <div className={css.brand} aria-hidden="true"><BrandWordmark size={24} /></div>
        <h2 ref={titleRef} id="welcome-notice-title" className={css.title} tabIndex={-1}>{t('welcome.title')}</h2>
        <p className={css.opening}>{t('welcome.paragraph.0')}</p>
        <blockquote className={css.reflection}>{t('welcome.paragraph.1')}</blockquote>
        <p className={css.feedback}>
          {emphasizedFeedback(t('welcome.paragraph.2'), t('welcome.feedbackEmphasis'))}
        </p>
        {state.error === null ? null : <p className={css.error} role="alert">{t('welcome.error')}</p>}
        <div className={css.footer}>
          <Button
            variant="primary"
            className={css.primary}
            disabled={state.status === 'saving'}
            onClick={() => { void acknowledge() }}
          >
            {t('welcome.continue')}
          </Button>
        </div>
      </section>
    </OnboardingSurface>
  )
}
