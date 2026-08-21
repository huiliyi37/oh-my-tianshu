/**
 * Per-command output filters for the bash tool (upstream Tianshu
 * `command-filters.ts` lineage, itself an internalization of rtk's per-command
 * TOML filters): high-volume command families whose noise is structural get a
 * semantic compaction BEFORE the generic model-output shaping runs.
 *
 * Three families (the ones the upstream measured as the highest-frequency
 * offenders): `git log`, `git diff`, and test-runner invocations.
 *
 * Discipline (identical to {@link ./model-output.ts}): outputs below each
 * family's minimum threshold pass through untouched; content is only deleted,
 * never invented; every deletion leaves a marker naming what was dropped; the
 * un-filtered body stays recoverable through the spill path the caller
 * attaches. A filtered body is "curated": the generic success-fold/error-aware
 * shaping is skipped for it (the filter already made the relevance decisions;
 * re-folding curated output would keep the wrong end).
 *
 * @module @huiliyi37/dsh-tool-bash/command-filters
 */

/** Resolved command-filter knobs (validated once at load by the tool plugin). */
export interface CommandFilterConfig {
  /** Master switch; false disables all three families. */
  readonly enabled: boolean
  /** git log: maximum commits kept (default 15). */
  readonly gitLogMaxCommits: number
  /** git diff: maximum lines kept per hunk (default 60). */
  readonly gitDiffHunkMaxLines: number
  /** test runs: maximum lines kept (default 120). */
  readonly testRunMaxLines: number
}

/** git log bodies at or below this many lines pass through untouched (algorithm constant). */
const GIT_LOG_MIN_LINES = 30
/** git log per-line character cap (algorithm constant, matches upstream). */
const GIT_LOG_LINE_WIDTH = 120
/** git log message lines kept per commit (algorithm constant). */
const GIT_LOG_MESSAGE_LINES = 3
/** git diff bodies at or below this many lines pass through untouched (algorithm constant). */
const GIT_DIFF_MIN_LINES = 40
/** git diff total line cap across the body (algorithm constant). */
const GIT_DIFF_MAX_TOTAL_LINES = 300
/** test-run bodies at or below this many lines pass through untouched (algorithm constant). */
const TEST_MIN_LINES = 15
/** test-run context lines around each kept failure line (algorithm constant). */
const TEST_CONTEXT_LINES = 5
/** test-run head/tail anchor lines (algorithm constant). */
const TEST_HEAD_LINES = 5
const TEST_TAIL_LINES = 10

/** A command's output after semantic filtering. */
export interface FilteredCommandOutput {
  /** The filtered text (identical to the input when nothing matched or dropped). */
  readonly text: string
  /** Whether the filter dropped anything (the caller skips generic shaping and spills the original). */
  readonly curated: boolean
}

/** Trailer lines stripped from git log commit messages (merge metadata and sign-offs). */
const GIT_LOG_STRIP_RE = /^(?:Merge: |Co-Authored-By: |Signed-off-by: |Reviewed-by: |Co-authored-by: )/

/** Test-runner failure vocabulary for the keep-window selection. */
const TEST_FAIL_RE = new RegExp([
  'fail',
  '✕',
  '✗',
  '×',
  'not ok',
  'error',
  'expect',
  'assert',
  'expected',
  'received',
  'snapshot',
  'traceback',
].join('|'), 'i')

/** Split a body into content lines plus whether it ended with a newline. */
function splitLines(body: string): { lines: string[]; trailingNewline: boolean } {
  const trailingNewline = body.endsWith('\n')
  const lines = body.split('\n')
  if (trailingNewline) lines.pop()
  return { lines, trailingNewline }
}

/** Rejoin lines restoring the original trailing-newline shape. */
function joinLines(lines: readonly string[], trailingNewline: boolean): string {
  return lines.join('\n') + (trailingNewline ? '\n' : '')
}

/** `git log` with a custom --format/--pretty already encodes the user's intent: skip. */
function isPlainGitLog(command: string): boolean {
  if (!/\bgit\b.*\blog\b/.test(command)) return false
  return !/(--format=|--pretty=|-f\b)/.test(command)
}

/** Compact a default-format git log body: commit + Date + ≤3 message lines, no Author/trailers. */
function filterGitLog(body: string, maxCommits: number): FilteredCommandOutput {
  const { lines, trailingNewline } = splitLines(body)
  if (lines.length <= GIT_LOG_MIN_LINES || maxCommits <= 0) return { text: body, curated: false }

  // Split into per-commit blocks on `commit <hash>` boundary lines; --oneline and
  // custom formats have no such boundary, so each line is its own block there.
  const blocks: string[][] = []
  let current: string[] = []
  let sawCommitHeaders = false
  for (const line of lines) {
    if (/^commit [0-9a-f]{7,40}/.test(line)) {
      sawCommitHeaders = true
      if (current.length > 0) blocks.push(current)
      current = [line]
    } else {
      current.push(line)
    }
  }
  if (current.length > 0) blocks.push(current)
  // A format without commit headers (e.g. --oneline): each line is one block.
  if (!sawCommitHeaders) {
    const out = lines.slice(0, maxCommits)
    const omitted = lines.length - out.length
    if (omitted <= 0) return { text: body, curated: false }
    return {
      text: joinLines(out, trailingNewline) + (trailingNewline ? '' : '\n') + `[git-log filter: kept ${out.length} of ${lines.length} entries]`,
      curated: true,
    }
  }

  const totalCommits = blocks.length
  const keptBlocks = blocks.slice(0, maxCommits)
  const out: string[] = []
  for (const block of keptBlocks) {
    let messageLines = 0
    for (const line of block) {
      if (line === 'commit ' || /^commit [0-9a-f]{7,40}/.test(line)) {
        out.push(line)
        continue
      }
      if (/^Author: /.test(line) || GIT_LOG_STRIP_RE.test(line)) continue
      if (/^Date:   /.test(line)) {
        out.push(line)
        continue
      }
      // Indented lines are the commit message.
      if (line.startsWith('    ')) {
        if (messageLines >= GIT_LOG_MESSAGE_LINES) continue
        messageLines += 1
        out.push(line.length > GIT_LOG_LINE_WIDTH ? `${line.slice(0, GIT_LOG_LINE_WIDTH - 1)}…` : line)
        continue
      }
      out.push(line.length > GIT_LOG_LINE_WIDTH ? `${line.slice(0, GIT_LOG_LINE_WIDTH - 1)}…` : line)
    }
  }
  const omitted = totalCommits - keptBlocks.length
  if (omitted <= 0) return { text: body, curated: false }
  return {
    text: joinLines(out, trailingNewline) + (trailingNewline ? '' : '\n') + `[git-log filter: kept ${keptBlocks.length} of ${totalCommits} commits — oldest dropped]`,
    curated: true,
  }
}

/** Compact a git diff body: per-hunk line caps, total cap, per-file +A -R counts. */
function filterGitDiff(body: string, hunkMaxLines: number): FilteredCommandOutput {
  const { lines, trailingNewline } = splitLines(body)
  if (lines.length <= GIT_DIFF_MIN_LINES || hunkMaxLines <= 0) return { text: body, curated: false }

  const out: string[] = []
  let dropped = 0
  // Per-file accounting for the trailing +A -R summary.
  let fileAdded = 0
  let fileRemoved = 0
  const flushFileSummary = (): void => {
    if (fileAdded > 0 || fileRemoved > 0) {
      out.push(`# +${fileAdded} -${fileRemoved}`)
      fileAdded = 0
      fileRemoved = 0
    }
  }

  let hunkLine: string | undefined
  let hunkKept = 0
  const flushHunk = (): void => {
    hunkLine = undefined
    hunkKept = 0
  }

  for (const line of lines) {
    if (line.startsWith('diff --git ') || line.startsWith('--- ') || line.startsWith('+++ ')) {
      flushHunk()
      flushFileSummary()
      out.push(line)
      continue
    }
    if (line.startsWith('@@')) {
      flushHunk()
      flushFileSummary()
      hunkLine = line
      hunkKept = 0
      out.push(line)
      continue
    }
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (hunkLine !== undefined && hunkKept >= hunkMaxLines) {
      dropped += 1
      if (line.startsWith('+')) fileAdded += 1
      if (line.startsWith('-')) fileRemoved += 1
      continue
    }
    if (line.startsWith('+')) fileAdded += 1
    if (line.startsWith('-')) fileRemoved += 1
    hunkKept += 1
    out.push(line)
  }
  flushFileSummary()

  if (dropped === 0) {
    // Only summaries were appended — still curated only when lines were actually cut.
    const total = out.length
    if (total <= GIT_DIFF_MAX_TOTAL_LINES) {
      return { text: joinLines(out, trailingNewline), curated: out.length !== lines.length }
    }
  }
  // Total cap: keep the head within the budget and mark the tail dropped.
  if (out.length > GIT_DIFF_MAX_TOTAL_LINES) {
    const excess = out.length - GIT_DIFF_MAX_TOTAL_LINES
    const kept = out.slice(0, GIT_DIFF_MAX_TOTAL_LINES)
    return {
      text: joinLines(kept, false) + `\n[... ${excess} diff lines omitted ...]` + (trailingNewline ? '\n' : ''),
      curated: true,
    }
  }
  return {
    text: joinLines(out, trailingNewline),
    curated: dropped > 0 || out.length !== lines.length,
  }
}

/** Keep failure blocks (±context) and head/tail anchors from a test-run body. */
function filterTestRun(body: string, maxLines: number): FilteredCommandOutput {
  const { lines, trailingNewline } = splitLines(body)
  if (lines.length <= TEST_MIN_LINES || maxLines <= 0) return { text: body, curated: false }

  const keep = new Set<number>()
  lines.forEach((line, index) => {
    if (!TEST_FAIL_RE.test(line)) return
    const first = Math.max(0, index - TEST_CONTEXT_LINES)
    const last = Math.min(lines.length - 1, index + TEST_CONTEXT_LINES)
    for (let i = first; i <= last; i++) keep.add(i)
  })
  for (let i = 0; i < Math.min(TEST_HEAD_LINES, lines.length); i++) keep.add(i)
  for (let i = Math.max(0, lines.length - TEST_TAIL_LINES); i < lines.length; i++) keep.add(i)

  let selected = [...keep].sort((a, b) => a - b)
  if (selected.length > maxLines) {
    const headCount = Math.ceil(maxLines * 0.5)
    const tailCount = maxLines - headCount
    const head = selected.slice(0, headCount)
    const tail = selected.slice(selected.length - tailCount)
    selected = [...new Set([...head, ...tail])].sort((a, b) => a - b)
  }
  if (selected.length >= lines.length) return { text: body, curated: false }

  const out: string[] = []
  let previous = -1
  for (const index of selected) {
    if (previous !== -1 && index > previous + 1) out.push(`[... ${index - previous - 1} lines omitted ...]`)
    if (previous === -1 && index > 0) out.push(`[... ${index} lines omitted ...]`)
    out.push(lines[index] ?? '')
    previous = index
  }
  const omitted = lines.length - selected.length
  return {
    text: `[test filter: kept ${selected.length} of ${lines.length} lines — failure blocks preserved]\n${joinLines(out, trailingNewline)}`,
    curated: omitted > 0,
  }
}

/**
 * Whether any enabled filter would drop lines from this command's body — the
 * execute-time predicate for spilling the un-filtered original first.
 * @param command - the executed bash command line.
 * @param body - the composed output body.
 * @param config - resolved command-filter knobs.
 * @returns true when a filter will omit lines.
 */
export function commandFilterDropsLines(command: string, body: string, config: CommandFilterConfig): boolean {
  if (!config.enabled || body.length === 0) return false
  if (isPlainGitLog(command)) {
    const { lines } = splitLines(body)
    return lines.length > GIT_LOG_MIN_LINES && config.gitLogMaxCommits > 0
  }
  if (/\bgit\b.*\bdiff\b/.test(command)) {
    const { lines } = splitLines(body)
    if (lines.length <= GIT_DIFF_MIN_LINES || config.gitDiffHunkMaxLines <= 0) return false
    // Cheap upper bound: with per-hunk caps a body only survives intact when
    // every hunk is small; treat any qualifying body as potentially dropping.
    return true
  }
  if (TEST_COMMAND_RE.test(command)) {
    const { lines } = splitLines(body)
    return lines.length > TEST_MIN_LINES && config.testRunMaxLines > 0
  }
  return false
}

/** Test-runner command shapes eligible for the failure-block filter. */
const TEST_COMMAND_RE = new RegExp([
  '\\bvitest\\b',
  '\\bjest\\b',
  '\\bpytest\\b',
  '\\bcargo test\\b',
  '\\bgo test\\b',
  '\\bnpm (?:run )?test\\b',
  '\\bpnpm (?:run )?test\\b',
  '\\byarn test\\b',
  '\\brun_tests\\b',
].join('|'))

/**
 * Apply the matching per-command filter, if any: git log, git diff, or a test
 * run. Bodies below each family's threshold (or commands with no family) pass
 * through untouched.
 * @param command - the executed bash command line.
 * @param body - the composed output body.
 * @param config - resolved command-filter knobs.
 * @returns the filtered text plus whether anything was curated away.
 */
export function filterCommandOutput(command: string, body: string, config: CommandFilterConfig): FilteredCommandOutput {
  if (!config.enabled || body.length === 0) return { text: body, curated: false }
  if (isPlainGitLog(command)) return filterGitLog(body, config.gitLogMaxCommits)
  if (/\bgit\b.*\bdiff\b/.test(command)) return filterGitDiff(body, config.gitDiffHunkMaxLines)
  if (TEST_COMMAND_RE.test(command)) return filterTestRun(body, config.testRunMaxLines)
  return { text: body, curated: false }
}
