/**
 * Welcome hero art selection: resolves the active mascot's rendered rest band
 * for the current terminal, so the app assembly never names a mascot.
 *
 * @module @huiliyi37/dsh-tui/format/welcome-mascot-art
 */

import { formatFoxFrame } from './fox.js'
import { formatWhaleFrame } from './whale.js'
import { resolveWelcomeArtWidth, type RenderedWelcomeArt } from './welcome.js'
import type { WelcomeMascot } from './welcome-mascots.js'

/**
 * Renders the active mascot's rest band for the given terminal geometry.
 *
 * @param mascot - Already-resolved mascot (prefs/config/default precedence
 * is the caller's job).
 * @param columns - Current terminal columns.
 * @param rows - Current terminal rows.
 * @param colorLevel - Terminal color level (0–3); unsupported levels render no
 * rows.
 * @returns Pre-rendered art for {@link formatWelcome}; empty lines with zero
 * width when the terminal cannot host a band.
 */
export function formatWelcomeMascotArt(
  mascot: WelcomeMascot,
  columns: number,
  rows: number,
  colorLevel: number,
): RenderedWelcomeArt {
  const artWidth = resolveWelcomeArtWidth(columns, rows)
  if (artWidth === null) return { lines: [], width: 0 }
  const formatMascot = mascot === 'fox' ? formatFoxFrame : formatWhaleFrame
  return { lines: formatMascot({ colorLevel, width: artWidth }), width: artWidth }
}
