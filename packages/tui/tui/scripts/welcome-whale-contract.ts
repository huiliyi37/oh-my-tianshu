/**
 * Internal geometry contract shared by welcome-whale authoring and projection
 * scripts. Generated runtime data repeats these values without importing this
 * repository-only module. Band geometry intentionally matches the fox rest
 * bands so the welcome hero layout is mascot-independent.
 */

/** Palette-source projection width in pixels (matches the fox frame grid). */
export const WELCOME_WHALE_PALETTE_SOURCE_WIDTH = 96

/** Palette-source projection height in pixels (matches the fox frame grid). */
export const WELCOME_WHALE_PALETTE_SOURCE_HEIGHT = 72

/** Runtime rest-pose grids projected from the cutout. */
export const WELCOME_WHALE_RUNTIME_BANDS = [
  { width: 28, height: 30 },
  { width: 36, height: 38 },
] as const
