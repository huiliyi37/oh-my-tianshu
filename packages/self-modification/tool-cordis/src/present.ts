/**
 * UI render intents for the three cordis tools — all `generic` cards, decided
 * up front as part of the tool design. Presenters are pure functions of the
 * call arguments (they run on replay too): no I/O, no session state, no clock.
 * No `presentResult` overrides exist — the tools' text results are their
 * correct completed rendering.
 *
 * @module @deepseek-ai/dsh-tool-cordis/present
 */

import type { GenericCallView } from '@deepseek-ai/dsh-tools'

/**
 * The `cordis_inspect` call card: a read, titled with the requested section.
 * @param args - the validated call arguments.
 * @returns the generic call card.
 */
export function presentInspectCall(args: { what?: string; name?: string }): GenericCallView {
  const target = args.name === undefined ? args.what : `${args.what}: ${args.name}`
  return {
    card: 'generic',
    kind: 'read',
    title: target === undefined ? 'Inspect cordis runtime' : `Inspect cordis runtime: ${target}`,
  }
}

/**
 * The `cordis_mount` call card: an execute carrying the temporary-plugin code as raw input.
 * @param args - the validated call arguments.
 * @returns the generic call card.
 */
export function presentMountCall(args: { code: string }): GenericCallView {
  return {
    card: 'generic',
    kind: 'execute',
    title: 'Mount temporary Cordis Plugin',
    rawInput: { code: args.code },
  }
}

/**
 * The `cordis_unmount` call card: a delete, titled with the temporary-plugin id.
 * @param args - the validated call arguments.
 * @returns the generic call card.
 */
export function presentUnmountCall(args: { id: string }): GenericCallView {
  return {
    card: 'generic',
    kind: 'delete',
    title: `Unmount temporary Cordis Plugin ${args.id}`,
  }
}
