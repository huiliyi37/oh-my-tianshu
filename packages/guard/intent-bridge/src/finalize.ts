/**
 * The alignment agent's single tool: `finalize_alignment` declares the
 * clarified intent as a task card. Argument validation happens at the tool
 * boundary (`parseFinalizeArgs`) — a malformed call is rejected back to the
 * model with the contract instructions, mirroring zen_anchor's rejection
 * pattern.
 *
 * @module @huiliyi37/dsh-intent-bridge/finalize
 */

/** The model-facing alignment-completion tool's name. */
export const FINALIZE_TOOL_NAME = 'finalize_alignment'

/** Maximum accepted constraint/acceptance entries per call. */
export const FINALIZE_LIST_MAX = 4

/** Validated `finalize_alignment` arguments (task-card `TaskCard` shape). */
export interface FinalizeArgs {
  /** One-line task title. */
  title: string
  /** 1-2 sentence goal restatement. */
  goal: string
  /** What the task must NOT touch; empty when none. */
  constraints: readonly string[]
  /** Verifiable acceptance criteria; empty when none. */
  acceptance: readonly string[]
}

/** Trim and drop blank entries, bounded at {@link FINALIZE_LIST_MAX}. */
function cleanList(value: unknown, name: string): readonly string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error(`finalize_alignment: \`${name}\` must be an array of strings`)
  const items: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') {
      throw new Error(`finalize_alignment: \`${name}\` entries must be strings (got ${JSON.stringify(item)})`)
    }
    const trimmed = item.trim()
    if (trimmed !== '') items.push(trimmed)
  }
  if (items.length > FINALIZE_LIST_MAX) {
    throw new Error(`finalize_alignment: \`${name}\` has at most ${FINALIZE_LIST_MAX} entries (got ${items.length})`)
  }
  return items
}

/**
 * Validate raw tool arguments at the boundary. Title and goal are mandatory
 * non-empty strings; constraints/acceptance are optional string arrays,
 * trimmed, blank entries dropped, capped at {@link FINALIZE_LIST_MAX}.
 *
 * @param args - raw tool arguments (unknown at the wire boundary).
 * @returns the validated, normalized arguments.
 * @throws with a contract-shaped message on any violation.
 */
export function parseFinalizeArgs(args: unknown): FinalizeArgs {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    throw new Error('finalize_alignment: arguments must be an object with title and goal')
  }
  const raw = args as Record<string, unknown>
  const title = typeof raw.title === 'string' ? raw.title.trim() : ''
  if (title === '') throw new Error('finalize_alignment: needs a non-empty `title`')
  const goal = typeof raw.goal === 'string' ? raw.goal.trim() : ''
  if (goal === '') throw new Error('finalize_alignment: needs a non-empty `goal`')
  return {
    title,
    goal,
    constraints: cleanList(raw.constraints, 'constraints'),
    acceptance: cleanList(raw.acceptance, 'acceptance'),
  }
}
