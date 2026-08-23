/**
 * Wire-safe rule vocabulary for the persistent approval-rule policy layer,
 * free of cordis/service imports so client type chains can consume them
 * without loading this package's Context augmentation.
 * @module @huiliyi37/dsh-approval-rules/types
 */

/** A rule's decision: `allow` grants one-shot approval, `deny` rejects it. */
export type PermissionDecision = 'allow' | 'deny'

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
   */
  readonly pattern: string
  /** The decision returned when this rule matches. */
  readonly decision: PermissionDecision
}

/**
 * An effective (merged) rule — a {@link FileRule} stamped with its owning
 * layer, the shape the answerer and `/permissions` command consume.
 */
export interface Rule extends FileRule {
  /** Whether the rule came from the user home file or the project file. */
  readonly layer: PermissionLayer
}
