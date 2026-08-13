/**
 * Vocabulary for the fs-policy plugin: the minimal execution-context
 * shape used to derive an observed-state owner by narrowing the opaque `object`
 * actor the `fs/*` events carry.
 *
 * The provider vocabulary (`FsTarget`, `FsVersion`, write/edit shapes) is
 * re-used from `@deepseek-ai/dsh-fs`; this package owns only the observed-state
 * owner structure on top of it.
 *
 * @module @deepseek-ai/dsh-fs-policy/types
 */

/**
 * Minimal structural view of a tool execution the policy plugin needs to derive
 * an observed-state owner. `@deepseek-ai/dsh-tools`' `ToolExecution` satisfies
 * this shape, so the tool passes its `exec` straight through as the opaque
 * `object` actor on the `fs/*` events; this plugin narrows that actor to this
 * shape without importing `dsh-tools`, `dsh-agent`, or `dsh-session`.
 *
 * The owner is `agent.session` when present. It is treated as an opaque object
 * identity (a `WeakMap` key); this package never reads any of its fields.
 */
export interface FsPolicyExec {
  /** The agent on whose behalf the call runs, when there is one. */
  agent?: {
    /** The session that owns observed-file state, used as an opaque key. */
    session?: object
  }
}
