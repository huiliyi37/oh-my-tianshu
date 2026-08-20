/**
 * Task-conditioned one-shot face (V4): classify the first user message into
 * extra non-bash-substitutable tools, then freeze that face for the session.
 *
 * Every selected face already contains the deployment's alt-0 base (`face`
 * config: bash + one edit stack + todo_write). Classification only *appends*
 * tools bash cannot stand in for. A miss therefore degrades to substitution
 * (measurable) rather than a helpless session.
 *
 * @module
 */

/**
 * Global tool names that duplicate bash (or the kept `str_replace_editor`
 * stack). The TUI's promoted face denies this list so the default top face
 * keeps specialized tools and drops the overlapping stacks; the plugins stay
 * registered for subagent role allow-lists.
 */
export const BASH_OVERLAP_TOOLS = ['edit', 'file_info', 'git', 'glob', 'grep', 'read', 'write'] as const

/** One keyword-triggered extra: tools to append when the first message matches. */
export interface FaceExtra {
  /** Global tool names to append (dropped if the deployment did not register them). */
  readonly tools: readonly string[]
  /** Case-insensitive match against the first user message's text. */
  readonly pattern: RegExp
}

/**
 * Conservative extras: only groups bash cannot substitute, and only on
 * phrasing that names the capability. Over-matching would spend a prefix
 * refill for tools the session never calls (the F-arm never-called set).
 */
export const FACE_EXTRAS: readonly FaceExtra[] = [
  { tools: ['subagent'], pattern: /\b(?:subagent|delegat(?:e|ion)|explor(?:e|ation) agent)\b/i },
  { tools: ['lsp', 'semantic_search'], pattern: /\b(?:lsp|language server|go to definition|semantic search)\b/i },
  { tools: ['memory_save', 'memory_search'], pattern: /\b(?:memory_save|memory_search|remember this|across sessions)\b/i },
  { tools: ['session_search', 'session_trace'], pattern: /\b(?:session_search|previous session|past conversation)\b/i },
  { tools: ['skill'], pattern: /\bskill\b|SKILL\.md/i },
  { tools: ['ask_user_question'], pattern: /\b(?:ask(?: the)? user|ask_user_question)\b/i },
]

/**
 * Tools the first message wants appended onto the alt-0 base face.
 * @param text - first user message, already joined from text blocks.
 * @returns sorted unique extra names; empty when the message needs only the base.
 */
export function selectFaceExtras(text: string): readonly string[] {
  const names = new Set<string>()
  for (const extra of FACE_EXTRAS) {
    if (!extra.pattern.test(text)) continue
    for (const tool of extra.tools) names.add(tool)
  }
  return [...names].sort()
}

/**
 * Alt-0 base plus extras that this deployment actually registered.
 * Unknown extras are dropped, never fail loud: a classifier naming a tool
 * the profile omitted must not veto the session.
 * @param base - deployment `face` (already validated non-empty unique names).
 * @param extras - {@link selectFaceExtras} output.
 * @param registered - globally registered tool names.
 * @returns the frozen session face, base names first, then extras in given order.
 */
export function selectedFace(
  base: readonly string[],
  extras: readonly string[],
  registered: ReadonlySet<string>,
): readonly string[] {
  const out = [...base]
  for (const name of extras) {
    if (registered.has(name) && !out.includes(name)) out.push(name)
  }
  return out
}
