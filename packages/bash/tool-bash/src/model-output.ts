/**
 * Shared model-output shaping for the shell tools (`dsh-tool-bash`,
 * `dsh-tool-pwsh`): how a finished run's combined output body is trimmed for
 * the model's context. Two strategies (upstream Tianshu `output-store`
 * lineage, internalized without external dependencies):
 *
 * 1. Success folding — a successful run's verbose output collapses to its
 *    tail lines (the summary a build/test happy path ends with).
 * 2. Error-aware selection — a FAILED run's long output keeps the
 *    error-relevant lines (each match ± context) plus head/tail anchors,
 *    instead of a blind tail cut that may drop the actual failure.
 *
 * Discipline (inherited from the upstream command-filter rules): small
 * outputs pass through untouched; content is only deleted, never invented;
 * every deletion leaves an omission count; when the caller has a spill path
 * it is attached so the full output stays recoverable without re-running the
 * command (a rerun may have side effects).
 *
 * @module @huiliyi37/dsh-tool-bash/model-output
 */

import type { BashRunResult, CollectedOutput } from '@huiliyi37/dsh-bash'

/** Lines of context kept around each error-relevant match (algorithm constant). */
const CONTEXT_LINES = 2
/** Leading lines always kept by error-aware selection (anchors the command echo). */
const HEAD_ANCHOR_LINES = 3
/** Trailing lines always kept by error-aware selection (anchors the exit context). */
const TAIL_ANCHOR_LINES = 2
/** Share of the error budget spent on the head in the over-budget fallback. */
const FALLBACK_HEAD_SHARE = 0.6

/**
 * Heuristic line test for error-relevant output: diagnostics vocabulary that
 * survives across build tools, test runners, and Unix errors. Selection is a
 * heuristic, not a parser — the omission notice and spill path are the
 * guarantees, not completeness.
 */
const ERROR_LINE_RE = new RegExp([
  'error',
  'fail',
  'fatal',
  'panic',
  'exception',
  'traceback',
  'denied',
  'refused',
  'enoent',
  'eacces',
  'eaddrinuse',
  'timeout',
  'timed out',
  'not found',
  'no such',
  'cannot find',
  'syntaxerror',
  'typeerror',
  'referenceerror',
  'assert',
].join('|'), 'i')

/** Shaping knobs resolved by the tool's config (thresholds > 0 enable; 0 disables that arm). */
export interface OutputShaping {
  /** Whether the run failed (non-zero exit, signal, or timeout). */
  readonly failed: boolean
  /** Tail lines kept for a successful run above the fold threshold (0 disables folding). */
  readonly successTailLines: number
  /** A failed run's body above this many lines gets error-aware selection (0 disables). */
  readonly errorThresholdLines: number
  /** Total line budget for error-aware selection. */
  readonly errorBudgetLines: number
  /** Where the full unshaped body is durably recoverable; omitted when unknown. */
  readonly spillPath?: string
}

/** `body` split into content lines plus whether it ended with a newline. */
function splitLines(body: string): { lines: string[]; trailingNewline: boolean } {
  const trailingNewline = body.endsWith('\n')
  const lines = body.split('\n')
  if (trailingNewline) lines.pop()
  return { lines, trailingNewline }
}

/** The omission suffix naming where the dropped content is recoverable. */
function spillSuffix(spillPath: string | undefined): string {
  return spillPath === undefined ? '' : `; full output: ${spillPath}`
}

/** The composed output body of a finished run: stdout, the stderr section, nothing else. */
function streamText(output: CollectedOutput): string {
  if (!output.truncated) return output.text
  return `${output.text}\n[output truncated; full output: ${output.spillPath ?? '(unavailable)'}]`
}

/**
 * Compose the output body exactly as the shell tools render it before exit
 * markers: stdout text (with the executor's truncation notice), then a marked
 * stderr section. Shaping decisions and execute-time spill both key off this
 * composition, so the spilled artifact matches what the omission notice promises.
 * @param result - the finished foreground run.
 * @returns the combined body ('' when both streams are empty).
 */
export function composeResultBody(result: Pick<BashRunResult, 'stdout' | 'stderr'>): string {
  let body = streamText(result.stdout)
  const err = streamText(result.stderr)
  if (err.length > 0) {
    if (body.length > 0 && !body.endsWith('\n')) body += '\n'
    body += `[stderr]\n${err}`
  }
  return body
}

/**
 * Whether shaping would drop any line of `body` under `shaping` — the
 * execute-time predicate for proactively spilling the full body (the model's
 * copy may be folded, so the original must be durably saved first).
 * @param body - the composed output body.
 * @param shaping - resolved shaping knobs.
 * @returns true when shaping will omit lines.
 */
export function outputShapingDropsLines(body: string, shaping: OutputShaping): boolean {
  if (body.length === 0) return false
  const { lines } = splitLines(body)
  if (shaping.failed) {
    return shaping.errorThresholdLines > 0 && lines.length > shaping.errorThresholdLines
  }
  return shaping.successTailLines > 0 && lines.length > shaping.successTailLines
}

/** The error-aware selection: matched lines ± context, head/tail anchors, budget-capped. */
function selectErrorAwareLines(lines: readonly string[], budget: number): number[] {
  const keep = new Set<number>()
  lines.forEach((line, index) => {
    if (!ERROR_LINE_RE.test(line)) return
    const first = Math.max(0, index - CONTEXT_LINES)
    const last = Math.min(lines.length - 1, index + CONTEXT_LINES)
    for (let i = first; i <= last; i++) keep.add(i)
  })
  for (let i = 0; i < Math.min(HEAD_ANCHOR_LINES, lines.length); i++) keep.add(i)
  for (let i = Math.max(0, lines.length - TAIL_ANCHOR_LINES); i < lines.length; i++) keep.add(i)
  let selected = [...keep].sort((a, b) => a - b)
  if (selected.length <= budget) return selected
  // Over budget: fall back to a plain head+tail split of the same budget —
  // deterministic and position-predictable, matching the upstream strategy.
  const headCount = Math.max(1, Math.ceil(budget * FALLBACK_HEAD_SHARE))
  const tailCount = Math.max(1, budget - headCount)
  const head = lines.slice(0, headCount).map((_, i) => i)
  const tailStart = Math.max(headCount, lines.length - tailCount)
  const tail = lines.slice(tailStart).map((_, i) => tailStart + i)
  selected = [...new Set([...head, ...tail])].sort((a, b) => a - b)
  return selected.length > budget ? selected.slice(0, budget) : selected
}

/**
 * Shape the composed output body for the model's context. Small bodies pass
 * through byte-identical; a successful body folds to its tail; a failed body
 * above the threshold keeps error-relevant lines. Every omission is flagged
 * with its line count (and the spill path when recovery is available).
 * @param body - the composed output body (see {@link composeResultBody}).
 * @param shaping - resolved shaping knobs.
 * @returns the shaped body; identical to `body` when nothing is dropped.
 */
export function shapeModelOutput(body: string, shaping: OutputShaping): string {
  if (!outputShapingDropsLines(body, shaping)) return body
  const { lines, trailingNewline } = splitLines(body)
  const tail = trailingNewline ? '\n' : ''

  if (!shaping.failed) {
    const kept = lines.slice(-shaping.successTailLines)
    const omitted = lines.length - kept.length
    return `[${omitted} earlier line${omitted === 1 ? '' : 's'} omitted${spillSuffix(shaping.spillPath)}]\n${kept.join('\n')}${tail}`
  }

  const selected = selectErrorAwareLines(lines, shaping.errorBudgetLines)
  const out: string[] = []
  let previous = -1
  for (const index of selected) {
    if (previous !== -1 && index > previous + 1) {
      out.push(`[... ${index - previous - 1} lines omitted ...]`)
    }
    if (previous === -1 && index > 0) {
      out.push(`[... ${index} lines omitted ...]`)
    }
    out.push(lines[index] ?? '')
    previous = index
  }
  const omitted = lines.length - selected.length
  const header = `[${omitted} line${omitted === 1 ? '' : 's'} omitted — error-relevant lines kept${spillSuffix(shaping.spillPath)}]`
  return `${header}\n${out.join('\n')}${tail}`
}

/** Standardized diagnoses for environmental exit codes (protocol facts, not tunables). */
const EXIT_DIAGNOSIS: Readonly<Record<number, string>> = {
  126: 'not executable (permission or not a command) — check the file mode and path before retrying',
  127: 'command not found — verify the command name and PATH before retrying',
  130: 'interrupted (SIGINT)',
  137: 'killed (SIGKILL; often the OOM killer or a manual kill -9) — reduce memory use or ask the user',
  143: 'terminated (SIGTERM)',
}

/**
 * A one-line standardized diagnosis for a purely environmental failure: a
 * known exit code whose body carries no real program output (at most a couple
 * of shell lines). Bodies with real output skip this — their relevance is the
 * error-aware selection's job — and the exit marker stays last so the
 * terminal pill parse keeps anchoring.
 * @param exitCode - the run's exit code (signal kills have their own marker).
 * @param bodyLineCount - the composed body's line count.
 * @returns the `[environment: …]` marker line, or undefined when not applicable.
 */
export function environmentDiagnosis(exitCode: number | null, bodyLineCount: number): string | undefined {
  if (exitCode === null || bodyLineCount > 3) return undefined
  const diagnosis = EXIT_DIAGNOSIS[exitCode]
  return diagnosis === undefined ? undefined : `[environment: exit ${exitCode} — ${diagnosis}]`
}
