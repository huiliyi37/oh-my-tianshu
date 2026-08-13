/**
 * Settings shell plugin, browser half. A pure composition face: occupies the
 * sidebar-owned `sidebar.settings` hole with the trigger chrome + modal
 * panel, declares its chrome, section, and onboarding slots, and projects the
 * section ledger into panel navigation. The shell ships no copy; it reads the
 * optional locale revision only to resolve registrant-owned nav-label thunks.
 * ui-settings-general owns the chrome and General content; features own their
 * rows, sections, and onboarding pages. Export discipline: packages/client/AGENTS.md.
 */
import type { ClientContext } from '@huiliyi37/dsh-client-runtime/client'
// Type-only: the ctx.locale Context merge for the optional ctx.get('locale')
// read (nav labels may be locale-following thunks; the shell still ships no
// copy of its own and takes no hard locale dependency).
import type {} from '@huiliyi37/dsh-client-locale/client'
import { resolveSlotLabel } from '@huiliyi37/dsh-client-ui-slots'
import type {
  SettingsOnboardingStep, SettingsRootInjected, SettingsSectionRow,
} from './contract/slots.ts'
import { SettingsRoot } from './SettingsRoot.tsx'

export type {
  SettingsHeaderOwnerProps, SettingsRootComponentProps, SettingsRootInjected,
  SettingsOnboardingOwnerProps, SettingsOnboardingStep, SettingsSectionOwnerProps,
  SettingsSectionRow, SettingsTriggerOwnerProps,
} from './contract/slots.ts'

/**
 * Required services (cordis fiber inject). The target slot is declared by
 * ui-sidebar's apply, whose activation order relative to this one is NOT
 * constrained (dshClient.inject edges are informational); registration
 * depends on the slot through `slots.inject()`.
 */
export const inject = ['slots']

/**
 * Register the settings shell into `sidebar.settings` once the declaration is
 * on the ledger.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  // Ledger → nav-row projection as an observable source (uSES contract:
  // getSnapshot returns the cached rows until the ledger version moves).
  // Labels may be locale-following thunks, so the cache key includes the
  // locale revision and subscribers ride both sources.
  let rowsVersion = -1
  let rowsRevision = -1
  let rows: ReadonlyArray<SettingsSectionRow> = []
  let onboardingVersion = -1
  let onboardingSteps: readonly SettingsOnboardingStep[] = []
  const localeRevision = (): number => ctx.get('locale')?.getSnapshot().revision ?? 0
  const injected = (): SettingsRootInjected => ({
    hooks: {
      sections: {
        getSnapshot: () => {
          const version = ctx.slots.getVersion('settings.section')
          const revision = localeRevision()
          if (version !== rowsVersion || revision !== rowsRevision) {
            rowsVersion = version
            rowsRevision = revision
            rows = ctx.slots.entries('settings.section')
              .map(e => ({
                /* v8 ignore next -- list-slot registration requires id (SlotCore rejects an entry without one) */
                id: e.options.id ?? '',
                order: e.options.order ?? 0,
                label: resolveSlotLabel(e.options.label) ?? '',
              }))
              .sort((a, b) => { return a.order - b.order })
          }
          return rows
        },
        subscribe: (listener) => {
          const offLedger = ctx.slots.subscribe('settings.section', listener)
          const offLocale = ctx.get('locale')?.subscribe(listener)
          return () => {
            offLedger()
            offLocale?.()
          }
        },
      },
      onboardingSteps: {
        getSnapshot: () => {
          const version = ctx.slots.getVersion('settings.onboarding')
          if (version !== onboardingVersion) {
            onboardingVersion = version
            onboardingSteps = ctx.slots.entries('settings.onboarding')
              .map(e => ({
                /* v8 ignore next -- list-slot registration requires id */
                id: e.options.id ?? '',
                order: e.options.order ?? 0,
              }))
              .sort((a, b) => a.order - b.order)
          }
          return onboardingSteps
        },
        subscribe: listener => ctx.slots.subscribe('settings.onboarding', listener),
      },
    },
  })
  ctx.slots.inject('sidebar.settings', () => ctx.slots.register({
    name: 'sidebar.settings',
    children: {
      'settings.trigger': { kind: 'single', scope: 'root' },
      'settings.header': { kind: 'single', scope: 'root' },
      'settings.action': { kind: 'list', scope: 'root' },
      'settings.close': { kind: 'single', scope: 'root' },
      'settings.section': { kind: 'list', scope: 'root' },
      'settings.onboarding': { kind: 'list', scope: 'root' },
    },
    inject: injected,
  }, SettingsRoot))
}
