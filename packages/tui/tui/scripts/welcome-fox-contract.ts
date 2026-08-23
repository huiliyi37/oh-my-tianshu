/**
 * Internal geometry and frame-order contract shared by welcome-fox authoring
 * and projection scripts. Generated runtime data repeats these values without
 * importing this repository-only module.
 */

/** Width of each welcome-fox frame in pixels. */
export const WELCOME_FOX_FRAME_WIDTH = 96

/** Height of each welcome-fox frame in pixels. */
export const WELCOME_FOX_FRAME_HEIGHT = 72

/** Runtime rest-pose grids projected from the cutout. Authoring stays 96×72. */
export const WELCOME_FOX_RUNTIME_BANDS = [
  { width: 56, height: 42 },
  { width: 72, height: 54 },
] as const

/** Stable frame ids in horizontal sprite-sheet order. */
export const WELCOME_FOX_FRAME_IDS = [
  'rest',
  'tail-left',
  'tail-right',
  'breathe-in',
  'breathe-out',
  'blink',
  'glint-a',
  'glint-b',
] as const

/** One welcome-fox frame identifier. */
export type WelcomeFoxFrameId = (typeof WELCOME_FOX_FRAME_IDS)[number]

/** Required width of the complete horizontal sprite sheet. */
export const WELCOME_FOX_SHEET_WIDTH = WELCOME_FOX_FRAME_WIDTH * WELCOME_FOX_FRAME_IDS.length
