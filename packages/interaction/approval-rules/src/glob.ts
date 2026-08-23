/**
 * Full-string-anchored glob matching for approval-rule patterns.
 * @module @huiliyi37/dsh-approval-rules/glob
 */

/** Escape every regex metacharacter so user-supplied pattern text stays literal. */
function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
/* v8 ignore next -- escapeRegex is a tiny local helper exercised through matchesPattern */

/**
 * Normalize a tool call's raw argument string for rule matching: collapse any
 * whitespace run to a single space and trim. This is the string a {@link Rule}
 * pattern is anchored against, so `{"command": "git push"}` becomes a stable,
 * whitespace-stable form even when the producer emitted irregular spacing.
 * @param raw - the raw `arguments` JSON string from a `tool/call` event.
 * @returns the normalized argument string (empty for an empty input).
 */
export function normalizeArguments(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim()
}

/**
 * Test whether a normalized argument string matches a rule pattern under the
 * rule glob contract:
 *
 * - the whole string must match (implicit `^…$` — `git push` does not match
 *   `safe-git push`);
 * - `*` matches any run of characters, including across spaces and multibyte
 *   text (turned into regex `.*`);
 * - every other character is literal (this is a glob, not a general regex).
 *
 * @param normalizedArgs - the normalized argument string to test.
 * @param pattern - the rule pattern as written in the YAML file.
 * @returns whether the full string matches.
 */
export function matchesPattern(normalizedArgs: string, pattern: string): boolean {
  const anchored = escapeRegex(pattern).replace(/\\\*/g, '.*')
  return new RegExp(`^${anchored}$`).test(normalizedArgs)
}
