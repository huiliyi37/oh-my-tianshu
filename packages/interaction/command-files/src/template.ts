/**
 * Pure template rendering for file-backed slash commands.
 *
 * A command template body carries a small substitution vocabulary:
 *
 * - `$ARGUMENTS` — the complete `rawInput` verbatim (never trimmed).
 * - `$1` … `$9` — whitespace-split positional arguments: `$1` is the first
 *   word of the trimmed `rawInput`, `$2` the second, and so on. A referenced
 *   argument that is absent leaves the `$n` placeholder in place.
 * - Any other `$`-prefixed sequence (e.g. `$0`, `$10`, `$foo`) is undefined and
 *   passes through the template unchanged, so a template never silently drops
 *   an unknown placeholder.
 *
 * The module is side-effect free so the substitution algebra can be unit-tested
 * without a plugin context.
 *
 * @module @huiliyi37/dsh-command-files/template
 */

/**
 * Match one recognized placeholder, in priority order: the whole-input token
 * `ARGUMENTS`, then a single positional digit `1`–`9` that is not itself the
 * first digit of a longer decimal (so `$10` stays undefined rather than
 * truncating to `$1` followed by `0`).
 */
const VARIABLE = /\$(ARGUMENTS|[1-9](?![0-9]))/gu

/**
 * Split the trimmed raw input into positional arguments on runs of whitespace.
 * @param rawInput - exact text following the command name.
 * @returns the positional arguments; an empty input yields an empty list.
 */
function positionalArguments(rawInput: string): string[] {
  return rawInput.trim().split(/\s+/u).filter(part => part !== '')
}

/**
 * Render one command template body against the exact raw user input.
 *
 * Undefined `$n` placeholders and any unrecognized `$x` sequence are preserved
 * verbatim, so a template can reference more arguments than the user supplied
 * without mutating the unknown text.
 *
 * @param body - the markdown template body (after frontmatter).
 * @param rawInput - the exact text following the slash command, including any
 *   leading separator whitespace.
 * @returns the rendered text with every defined placeholder substituted.
 */
export function renderTemplate(body: string, rawInput: string): string {
  const positionals = positionalArguments(rawInput)
  return body.replace(VARIABLE, (match, token: string) => {
    if (token === 'ARGUMENTS') return rawInput
    const value = positionals[Number(token) - 1]
    return value === undefined ? match : value
  })
}
