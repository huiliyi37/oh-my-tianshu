/**
 * Welcome mascot identity: which hero art the welcome surface renders.
 *
 * Zero-import leaf shared by the render dispatch, the `/welcome` command, the
 * prefs persistence layer, and the runner config validation.
 */

/** Selectable welcome mascots; the first entry is the default. */
export const WELCOME_MASCOTS = ['whale', 'fox'] as const

/** One selectable welcome mascot. */
export type WelcomeMascot = (typeof WELCOME_MASCOTS)[number]

/** Mascot rendered when neither config nor prefs choose one. */
export const DEFAULT_WELCOME_MASCOT: WelcomeMascot = WELCOME_MASCOTS[0]
