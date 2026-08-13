/** Host loader entry for the browser implementation exported from `./client`. */

import type { Context } from 'cordis'
import z from 'schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  WELCOME_NOTICE_ACK_FIELD, WELCOME_NOTICE_SETTINGS_NAMESPACE,
} from './onboarding-copy.ts'

export {
  WELCOME_NOTICE_ACK_FIELD, WELCOME_NOTICE_COPY, WELCOME_NOTICE_SETTINGS_NAMESPACE,
  WELCOME_NOTICE_VERSION,
} from './onboarding-copy.ts'

interface OnboardingSettings {
  welcomeNoticeVersion?: string
}

const OnboardingSettingsSchema: z<OnboardingSettings> = z.object({
  [WELCOME_NOTICE_ACK_FIELD]: z.string(),
})

/** Register the durable GUI-onboarding section when a settings provider exists. */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(
      settingsNamespace(WELCOME_NOTICE_SETTINGS_NAMESPACE),
      OnboardingSettingsSchema,
    )
  })
}
