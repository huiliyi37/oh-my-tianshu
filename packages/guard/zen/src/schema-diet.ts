/**
 * Clip a model-facing tool description to a character budget.
 *
 * Orthogonal to face width: shorter descriptions save tokens on every
 * request, but (per the name-only H arm) do not change which tool the model
 * reaches for. Applied at `system-prompt/assemble`, so `ctx.tools.schemas()`
 * and the generated catalog stay the full registered text.
 *
 * @param text - registered description.
 * @param maxChars - inclusive budget; a positive integer from plugin config.
 * @returns `text` unchanged when it already fits; otherwise a word-bounded prefix.
 */
export function clipDescription(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const slice = text.slice(0, maxChars)
  const at = slice.lastIndexOf(' ')
  return (at > 0 ? slice.slice(0, at) : slice).trimEnd()
}
