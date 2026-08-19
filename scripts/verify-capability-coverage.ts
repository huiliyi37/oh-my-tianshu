/**
 * Prove the shipped tool catalog's intent-group namespace stays exhaustive.
 *
 * A newly registered tool that nobody grouped is a silent hole in the face
 * partition. This gate checks three things against `docs/tool-catalog.md`:
 *
 * 1. every registered tool name sits in exactly one capability group,
 * 2. no group names a tool that no package registers,
 * 3. every group is accounted for as the self-sufficient base face, a mountable
 *    product-face layer, or an explicitly excluded group with a written reason.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  BASE_FACE,
  CAPABILITY_GROUPS,
  capabilityCoverageViolations,
  EXCLUDED_CAPABILITIES,
  EXCLUDED_TOOLS,
  groupOfTool,
  REAL_LAYERS,
} from './tool-face-catalog.ts'

const root = resolve(import.meta.dirname, '..')

const CATALOG_PATH = 'docs/tool-catalog.md'

/** Tool-name headings in the generated catalog: `### \`name\``. */
const TOOL_HEADING = /^### `([^`]+)`/gm

/**
 * Read the registered tool names out of the generated catalog.
 * @param text - full `docs/tool-catalog.md` contents.
 * @returns every registered tool name, deduplicated and sorted.
 */
export function catalogToolNames(text: string): string[] {
  const names = new Set<string>()
  for (const match of text.matchAll(TOOL_HEADING)) names.add(match[1] as string)
  return [...names].sort()
}

/**
 * Check that every capability group has a recorded fate: base face, a real-face
 * layer, or an explicit exclusion.
 * @returns violations, one readable line each; empty means the partition holds.
 */
export function facePartitionViolations(): string[] {
  const violations: string[] = []
  const base = new Set(BASE_FACE.map(tool => groupOfTool(tool)?.id))
  const mounted = new Set(REAL_LAYERS.flatMap(layer => layer.capabilities))
  const excluded = new Set(EXCLUDED_CAPABILITIES.map(entry => entry.capability))
  for (const group of CAPABILITY_GROUPS) {
    const homes = [base.has(group.id), mounted.has(group.id), excluded.has(group.id)].filter(Boolean).length
    if (homes === 0) {
      violations.push(`capability group '${group.id}' is neither on the base face, mounted by a real-face layer, `
        + 'nor listed in EXCLUDED_CAPABILITIES with a reason')
    }
    if (homes > 1) {
      violations.push(`capability group '${group.id}' claims ${homes} homes; base / real layer / excluded are exclusive`)
    }
  }
  for (const entry of EXCLUDED_CAPABILITIES) {
    if (!CAPABILITY_GROUPS.some(group => group.id === entry.capability)) {
      violations.push(`EXCLUDED_CAPABILITIES names unknown capability '${entry.capability}'`)
    }
  }
  for (const entry of EXCLUDED_TOOLS) {
    if (groupOfTool(entry.tool) === undefined) {
      violations.push(`EXCLUDED_TOOLS names '${entry.tool}', which is in no capability group`)
    }
    if (REAL_LAYERS.some(layer => layer.tools.includes(entry.tool))) {
      violations.push(`EXCLUDED_TOOLS names '${entry.tool}', which a real-face layer still mounts`)
    }
  }
  return violations
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  const registered = catalogToolNames(readFileSync(resolve(root, CATALOG_PATH), 'utf8'))
  const failures = [...capabilityCoverageViolations(registered), ...facePartitionViolations()]
  if (failures.length > 0) {
    console.error('verify-capability-coverage failed:\n')
    for (const failure of failures) console.error(`  ${failure}`)
    console.error('\nGroup the tool in scripts/tool-face-catalog.ts, then either mount it '
      + 'in a REAL_LAYERS layer or record why not in EXCLUDED_CAPABILITIES / EXCLUDED_TOOLS.')
    process.exit(1)
  }
  console.log(`verify-capability-coverage: ${registered.length} catalogued tools grouped; `
    + `${REAL_LAYERS.length} real-face layers, ${EXCLUDED_CAPABILITIES.length} excluded capabilities.`)
}
