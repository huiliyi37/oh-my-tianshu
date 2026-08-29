/**
 * Pure ANSI renderer binding for the generated indexed welcome-whale frames.
 *
 * Runtime rendering consumes only generated palette indexes through the
 * shared renderer in `./fox.ts`. It performs no asset or filesystem I/O.
 */

import {
  bindIndexedPalette,
  formatIndexedMascotFrame,
  type FormatIndexedMascotFrameInput,
  type IndexedHalfBlockPaletteEntry,
  type IndexedMascotFrames,
} from './fox.js'
import { WELCOME_WHALE_BANDS, WELCOME_WHALE_PALETTE } from './whale-frames.js'

/** Runtime palette derived from the generated hex palette. */
const WHALE_PALETTE: readonly (IndexedHalfBlockPaletteEntry | null)[] =
  bindIndexedPalette(WELCOME_WHALE_PALETTE)

/** The whale mascot's generated bands, palette, and error label. */
const WHALE_FRAMES: IndexedMascotFrames = {
  bands: WELCOME_WHALE_BANDS,
  palette: WHALE_PALETTE,
  label: 'welcome whale',
}

/** Input for {@link formatWhaleFrame}. */
export type FormatWhaleFrameInput = FormatIndexedMascotFrameInput

/**
 * Renders the generated welcome-whale rest band without runtime asset access.
 *
 * @param input - Optional color level and band width.
 * @returns Half-block ANSI rows, or no rows when art is unsupported.
 * @throws {TypeError} When `width` is present and is not `28`, `36`, or `44`.
 */
export function formatWhaleFrame(input: FormatWhaleFrameInput = {}): string[] {
  return formatIndexedMascotFrame(WHALE_FRAMES, input)
}
