/**
 * Wire-safe rule vocabulary for the persistent approval-rule policy layer,
 * free of cordis/service imports so client type chains can consume them
 * without loading this package's Context augmentation.
 * @module @huiliyi37/dsh-approval-rules/types
 */

/** A rule's decision: `allow` grants a standing approval, `deny` rejects it. */
export type PermissionDecision = 'allow' | 'deny'

/**
 * How {@link FileRule.pattern} is compared to the normalized argument string.
 * Omitted/`glob` treats `*` as a wildcard; `exact` is a literal full-string
 * match so a persisted `[p]` grant cannot widen when the call itself contains `*`.
 */
export type RuleMatchMode = 'glob' | 'exact'

/** Which storage layer owns a rule: the user home file or the project file. */
export type PermissionLayer = 'user' | 'project'

/**
 * One rule as stored on disk (YAML) — the layer is implied by the file and
 * only becomes part of a {@link Rule} once merged into the effective list.
 */
export interface FileRule {
  /** The tool name this rule governs (exact match). */
  readonly tool: string
  /**
   * Full-string-anchored glob matched against the tool call's normalized
   * argument string; `*` crosses any characters. The exact value in the file.
   * When {@link FileRule.match} is `exact`, this string is compared with `===`.
   */
  readonly pattern: string
  /** The decision returned when this rule matches. */
  readonly decision: PermissionDecision
  /**
   * Comparison mode. Omitted means `glob` (hand-authored `/permissions add`
   * rules). `persistAllowRule` writes `exact`.
   */
  readonly match?: RuleMatchMode
}

/**
 * An effective (merged) rule — a {@link FileRule} stamped with its owning
 * layer, the shape the answerer and `/permissions` command consume.
 */
export interface Rule extends FileRule {
  /** Whether the rule came from the user home file or the project file. */
  readonly layer: PermissionLayer
}
