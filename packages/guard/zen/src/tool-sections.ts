/**
 * Drop tool guidance the model cannot act on.
 *
 * Tool plugins register a `tool:<name>` section next to the tool itself, so a
 * narrowed face leaves prose arguing for a call that cannot run — `tool:read`
 * tells the model to prefer `read` over `cat`, which sends it into a
 * `ToolNotFoundError` and then forbids the shell fallback it would otherwise
 * reach for. Narrowing therefore has to prune the prompt, not only the face.
 *
 * @module
 */

import type { AssembledSection } from '@huiliyi37/dsh-system-prompt'

/** Prefix by which a section declares it documents one named tool. */
const TOOL_SECTION_PREFIX = 'tool:'

/**
 * Keep only the `tool:<name>` sections whose tool is callable on this face.
 *
 * A suffix that names no registered tool documents a family rather than one
 * tool (`tool:tasks` covers `task_output`/`task_kill`/`task_list`), so it
 * survives: only the owning plugin knows whether its remaining tools still
 * back the prose. Sections without the prefix are never touched.
 *
 * @param sections - the assembled sections, in assembly order.
 * @param visible - tool names on the face this assembly will ship.
 * @param isRegistered - whether a name is a registered tool in the unrestricted view.
 * @returns the sections that still have a callable tool behind them.
 */
export function stripUnbackedToolSections(
  sections: readonly AssembledSection[],
  visible: ReadonlySet<string>,
  isRegistered: (name: string) => boolean,
): AssembledSection[] {
  return sections.filter((section) => {
    if (!section.name.startsWith(TOOL_SECTION_PREFIX)) return true
    const tool = section.name.slice(TOOL_SECTION_PREFIX.length)
    if (!isRegistered(tool)) return true
    return visible.has(tool)
  })
}
