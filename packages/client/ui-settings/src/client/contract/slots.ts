/**
 * Settings shell slot contract — the canonical home of every settings slot
 * type. The shell is a pure composition face with zero copy of its own: it
 * occupies the sidebar-owned `sidebar.settings` hole and declares the slots
 * below; ALL text (trigger label, panel title, header actions, close aria,
 * section content) arrives from registrants. A feature owns its settings surface — adding a
 * setting never means editing the shell; copy that belongs to no single
 * feature (chrome, the General section) is owned by ui-settings-general.
 */
import type { HostObservable, InjectFace, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls ui-sidebar's SlotMap merge (the 'sidebar.settings' entry)
// into every program that sees this contract.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * The sidebar-foot trigger row content: icon + label, supplied as slot
     * content (the accessible name comes from the content — rail state
     * renders the label visually hidden). The shell renders the button
     * chrome and owns open state. Absent contribution degrades to an
     * icon-only button without an accessible name (broken-composition state;
     * the shipped composition always registers the seat).
     */
    'settings.trigger': { kind: 'single'; scope: 'root'; owner: SettingsTriggerOwnerProps }
    /**
     * The panel title text seat. Content renders inside the nav heading row;
     * the dialog's accessible name points at that node via aria-labelledby.
     * Absent contribution leaves the heading empty.
     */
    'settings.header': { kind: 'single'; scope: 'root'; owner: SettingsHeaderOwnerProps }
    /**
     * Optional actions rendered in the content-column header before Close.
     * Registrants own visibility, behavior, copy, and failure presentation;
     * the shell supplies only the ordered render site.
     */
    'settings.action': { kind: 'list'; scope: 'root'; owner: SettingsHeaderOwnerProps }
    /**
     * The close button's visually-hidden label text (the button itself —
     * icon, geometry, focus — is shell chrome). Absent contribution leaves
     * the button without an accessible name (broken-composition state).
     */
    'settings.close': { kind: 'single'; scope: 'root'; owner: SettingsHeaderOwnerProps }
    /**
     * One settings page per list entry. Registrant options carry the nav
     * identity: `id` (section key, drives `only` filtering), `order` (nav
     * position), `label` (registrant-localized display text — the registrant
     * re-registers with fresh text on locale change, so the shell never
     * subscribes locale state; the ledger bump doubles as the shell's
     * re-render trigger). Sections render inside the panel content column.
     * (`settings.general.item`, declared by ui-settings-general's General
     * entry, is typed in the locale package — the common dependency of every
     * item registrant; the shell neither declares nor renders it.)
     */
    'settings.section': { kind: 'list'; scope: 'root'; owner: SettingsSectionOwnerProps }
    /**
     * Root-scoped onboarding steps contributed by settings features. The
     * shell mounts one ordered step at a time; the active registrant either
     * completes itself or keeps ownership until the user completes its sole
     * path. Registrants own readiness, copy, dialog behavior, AND the
     * takeover chrome: a step wraps its visible content in the
     * OnboardingSurface primitive (mask, opaque stage, `#root` inert) and
     * renders null while its private facts are still loading — the shell
     * paints no chrome of its own, so a mounted-but-deciding step shows and
     * blocks nothing (the reload white-flash fix; a bare unwrapped step
     * would render without mask or stage).
     */
    'settings.onboarding': { kind: 'list'; scope: 'root'; owner: SettingsOnboardingOwnerProps }
  }
}

/** Owner share of the trigger content seat: the sidebar column state. */
export interface SettingsTriggerOwnerProps {
  /** Whether the sidebar renders wide content (false = 56px rail, icon only). */
  wide: boolean
}

/** Owner share of the header title seat (the shell supplies nothing). */
export interface SettingsHeaderOwnerProps {
  /** Marker field: header owner props are intentionally empty. */
  children?: never
}

/**
 * Owner share of a settings section entry. The shell owns modal visibility
 * and navigation; sections receive nothing but the render site (their data
 * arrives through their own inject faces and stores).
 */
export interface SettingsSectionOwnerProps {
  /** Marker field: section owner props are intentionally empty for now. */
  children?: never
}

/** Owner share of the currently active settings-backed onboarding step. */
export interface SettingsOnboardingOwnerProps {
  /** Stable id of the step currently selected by the coordinator. */
  stepId: string
  /** Complete or skip this step and transfer ownership to the next entry. */
  complete: () => void
  /** Open the settings panel directly on one registered section. */
  openSection: (id: string) => void
}

/** One nav row projected from a settings.section registration's options. */
export interface SettingsSectionRow {
  id: string
  order: number
  label: string
}

/** One ordered onboarding step projected from a slot registration. */
export interface SettingsOnboardingStep {
  id: string
  order: number
}

/**
 * Registrant-private injected share of the settings shell (assembled in
 * apply): the ledger's nav-row projection as a hooks-compartment source —
 * the shell reads no locale state and subscribes through the bound hook.
 */
export type SettingsRootInjected = {
  hooks: {
    /** settings.section ledger projected into ordered nav rows. */
    sections: HostObservable<readonly SettingsSectionRow[]>
    /** settings.onboarding ledger projected into coordinator order. */
    onboardingSteps: HostObservable<readonly SettingsOnboardingStep[]>
  }
}

/**
 * Full component props of the settings shell root: the sidebar owner share
 * (wide/rail state) plus the declared render shares and the injected face
 * (hooks compartment bound to useSections). No store is registered — modal
 * open state and active section id are component-local viewing state.
 */
export type SettingsRootComponentProps =
  PropsRuntime<'sidebar.settings'>
  & PropsRenderSlots<
    | 'settings.trigger'
    | 'settings.header'
    | 'settings.action'
    | 'settings.close'
    | 'settings.section'
    | 'settings.onboarding'
  >
  & InjectFace<SettingsRootInjected>
