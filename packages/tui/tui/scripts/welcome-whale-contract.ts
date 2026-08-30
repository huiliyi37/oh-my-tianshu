/**
 * Internal geometry contract shared by welcome-whale authoring and projection
 * scripts. Generated runtime data repeats these values without importing this
 * repository-only module. Band geometry intentionally matches the fox rest
 * bands so the welcome hero layout is mascot-independent.
 */

/**
 * Native pixel-art grid of the whale cutout (each art pixel ≈ 6 source
 * pixels, measured from the cutout's dominant structural run length).
 * Projection recovers this grid before sampling so the star, the eye glint,
 * and the belly ridges survive the tiny runtime bands.
 */
export const WELCOME_WHALE_NATIVE_GRID = { width: 155, height: 118 } as const

/** Palette-source projection geometry: the recovered native grid itself. */
export const WELCOME_WHALE_PALETTE_SOURCE_WIDTH = WELCOME_WHALE_NATIVE_GRID.width

/** Palette-source projection geometry: the recovered native grid itself. */
export const WELCOME_WHALE_PALETTE_SOURCE_HEIGHT = WELCOME_WHALE_NATIVE_GRID.height

/** Runtime rest-pose grids projected from the recovered native grid. */
export const WELCOME_WHALE_RUNTIME_BANDS = [
  { width: 28, height: 30 },
  { width: 36, height: 38 },
  { width: 44, height: 46 },
] as const
