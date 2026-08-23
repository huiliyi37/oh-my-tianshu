/**
 * Persistent approval-rule loading, merging, and matching.
 *
 * Rules live as YAML lists in two layers, merged user-first:
 *
 * - the user home file `<resolveDshHome()>/permissions.yaml`, and
 * - the project file `<cwd>/.dsh/permissions.yaml`.
 *
 * Merging is simple list concatenation (user layer first), and matching walks
 * the merged list in order returning the first hit — the earlier a rule sits,
 * the earlier it wins. A missing file is an empty layer. A malformed file or an
 * illegal rule (empty `tool`/`pattern`, a `decision` outside `allow`/`deny`)
 * fails loud with the offending file path.
 * @module @huiliyi37/dsh-approval-rules/rules
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { dump, load } from 'js-yaml'
import type { FileRule, PermissionDecision, Rule } from './types.ts'
import { matchesPattern } from './glob.ts'

/** The closed decision vocabulary stored in a rule file. */
const DECISIONS: readonly string[] = ['allow', 'deny']

/**
 * Parse and validate one YAML rules document.
 * @param source - the raw YAML text.
 * @param filePath - the source path, reported verbatim in every failure.
 * @returns the validated rules in document order.
 * @throws when the YAML is malformed, the top level is not a list, or a rule
 *   entry is not a mapping or has an illegal/empty field.
 */
export function parseRules(source: string, filePath: string): FileRule[] {
  let parsed: unknown
  try {
    parsed = load(source)
  } catch (error: unknown) {
    throw new Error(`approval-rules: malformed YAML in "${filePath}": ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`approval-rules: "${filePath}" must contain a YAML list of rules`)
  }
  return parsed.map((entry, index) => normalizeRule(entry, filePath, index))
}

/** Validate one rule entry and return its normalized form. */
function normalizeRule(entry: unknown, filePath: string, index: number): FileRule {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    throw new Error(`approval-rules: rule at index ${index} in "${filePath}" must be a mapping`)
  }
  const record = entry as Record<string, unknown>
  const tool = record['tool']
  const pattern = record['pattern']
  const decision = record['decision']
  if (typeof tool !== 'string' || tool.trim() === '') {
    throw new Error(`approval-rules: rule at index ${index} in "${filePath}" has an empty or missing "tool"`)
  }
  if (typeof pattern !== 'string' || pattern.trim() === '') {
    throw new Error(`approval-rules: rule at index ${index} in "${filePath}" has an empty or missing "pattern"`)
  }
  if (typeof decision !== 'string' || !DECISIONS.includes(decision)) {
    throw new Error(`approval-rules: rule at index ${index} in "${filePath}" has an illegal decision "${String(decision)}" (must be "allow" or "deny")`)
  }
  return { tool: tool.trim(), pattern: pattern.trim(), decision: decision as PermissionDecision }
}

/**
 * Load and validate one layer's rule file.
 * @param filePath - the rule file to read.
 * @returns the validated rules in document order, or an empty list when the
 *   file does not exist.
 * @throws when the file exists but is malformed or contains an illegal rule.
 */
export async function loadRules(filePath: string): Promise<FileRule[]> {
  let source: string
  try {
    source = await readFile(filePath, 'utf8')
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  return parseRules(source, filePath)
}

/**
 * Merge a user and a project layer into one effective list (user first). The
 * owning layer is stamped onto each rule so the answerer and `/permissions`
 * command can report and remove by origin.
 * @param user - the user layer, in file order.
 * @param project - the project layer, in file order.
 * @returns the effective rules, user rules first.
 */
export function mergeRules(user: readonly FileRule[], project: readonly FileRule[]): Rule[] {
  return [
    ...user.map(rule => ({ ...rule, layer: 'user' as const })),
    ...project.map(rule => ({ ...rule, layer: 'project' as const })),
  ]
}

/** The first rule matching a request, or undefined when no rule applies. */
export interface RuleMatch {
  /** The matched rule, with its owning layer. */
  readonly rule: Rule
  /** The rule's zero-based index in the effective list. */
  readonly index: number
}

/**
 * Find the first rule governing a tool call.
 * @param rules - the effective rules, in priority order.
 * @param tool - the tool name to match (exact).
 * @param normalizedArgs - the normalized argument string to glob against.
 * @returns the first matching rule and its effective index, or `undefined`.
 */
export function matchRule(rules: readonly Rule[], tool: string, normalizedArgs: string): RuleMatch | undefined {
  for (let index = 0; index < rules.length; index += 1) {
    const rule = rules[index]
    /* v8 ignore next -- the loop index is always in range */
    if (rule === undefined) continue
    if (rule.tool === tool && matchesPattern(normalizedArgs, rule.pattern)) {
      return { rule, index }
    }
  }
  return undefined
}

/**
 * Write a rules list to one layer file, creating its directory if needed and
 * setting the file to owner-only `0600`.
 * @param filePath - the layer file to write.
 * @param rules - the rules to serialize as a YAML list.
 */
export async function writeRules(filePath: string, rules: readonly FileRule[]): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  const source = dump(rules.map(rule => ({ tool: rule.tool, pattern: rule.pattern, decision: rule.decision })), { lineWidth: -1 })
  await writeFile(filePath, source, { mode: 0o600 })
}

/**
 * Append one rule to a layer file, creating it (and its directory) when absent.
 * @param filePath - the layer file to update.
 * @param rule - the rule to append.
 */
export async function appendRule(filePath: string, rule: FileRule): Promise<void> {
  const existing = await loadRules(filePath)
  await writeRules(filePath, [...existing, rule])
}

/**
 * Remove the rule at a layer-local index from a layer file.
 * @param filePath - the layer file to update.
 * @param index - the zero-based index within this layer's list.
 * @throws when `index` is out of range for the layer.
 */
export async function removeRuleAtFile(filePath: string, index: number): Promise<void> {
  const existing = await loadRules(filePath)
  if (index < 0 || index >= existing.length) {
    throw new Error(`approval-rules: remove index ${index} is out of range for "${filePath}" (has ${existing.length} rules)`)
  }
  const next = existing.filter((_rule, cursor) => cursor !== index)
  await writeRules(filePath, next)
}
