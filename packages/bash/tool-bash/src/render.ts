/**
 * Model-facing result rendering for the bash tool.
 *
 * @module @huiliyi37/dsh-tool-bash/render
 */

import type { BashProcessRead, BashRunResult, BashSandboxInfo } from '@huiliyi37/dsh-bash'
import type { SandboxMode } from '@huiliyi37/dsh-sandbox'
import { escalationHintMarker, sandboxDenialMarker } from '@huiliyi37/dsh-sandbox'
import { filterCommandOutput, type CommandFilterConfig } from './command-filters.ts'
import { composeResultBody, shapeModelOutput, type OutputShaping } from './model-output.ts'

/** Whether the run's own facts mark it failed for shaping purposes (non-zero exit, signal, or timeout). */
function runFailed(result: Pick<BashRunResult, 'exitCode' | 'signal' | 'timedOut'>): boolean {
  return result.exitCode !== 0 || result.signal !== null || result.timedOut
}

/**
 * Shape one finished run into the text the model sees: stdout, then a marked
 * stderr section, then exit-status markers. Non-zero exits are reported, not
 * errored — the model decides how to react; only infrastructure failures
 * (spawn errors, aborts) surface as isError results.
 *
 * When `commandFilters` is given, the per-command semantic filter (git log /
 * git diff / test runs) runs FIRST; a body it curated skips the generic
 * shaping (the filter already made the relevance decisions — re-folding
 * curated output would keep the wrong end). When `shaping` is given, the
 * generic trim (success tail folding / error-aware selection) applies to the
 * (un-curated) body. Exit markers always survive intact after the body.
 * @param result - the completed foreground run from the executor.
 * @param escalationModes - the escalation targets this composition advertises;
 *   non-empty adds the same-turn escalation hint after a denial marker
 *   (default `[]`: no hint).
 * @param shaping - resolved output-shaping knobs with the run's failure fact
 *   and recovery spill path (omit for byte-identical legacy behavior).
 * @param commandFilters - the executed command plus resolved command-filter
 *   knobs (omit to skip per-command filtering).
 * @returns the model-facing text: output body (or `(no output)`), then any timeout/signal/exit markers, each on its own line.
 */
export function renderResult(
  result: BashRunResult,
  escalationModes: readonly SandboxMode[] = [],
  shaping?: OutputShaping,
  commandFilters?: { command: string; config: CommandFilterConfig },
): string {
  let body = composeResultBody(result)
  let curated = false
  if (commandFilters !== undefined) {
    const filtered = filterCommandOutput(commandFilters.command, body, commandFilters.config)
    body = filtered.text
    curated = filtered.curated
  }
  if (shaping !== undefined && !curated) {
    body = shapeModelOutput(body, { ...shaping, failed: shaping.failed || runFailed(result) })
  }
  if (body.length === 0) body = '(no output)'

  const markers: Array<string> = []
  // Keep the exit marker last because parseExitStatus anchors there.
  if (result.sandbox?.denied) {
    markers.push(sandboxDenialMarker(result.sandbox.mode))
    // Hint only when the composition exposes escalation, before the final exit marker.
    if (escalationModes.length > 0) {
      markers.push(escalationHintMarker('command'))
    }
  }
  // A command may trap SIGTERM and exit 0 after timeout; still report interruption.
  if (result.timedOut) markers.push(`[timed out after ${result.timeoutMs}ms]`)
  if (result.signal !== null) {
    markers.push(`[killed by signal: ${result.signal}]`)
  } else if (result.exitCode !== 0) {
    markers.push(`[exit code: ${result.exitCode}]`)
  }
  if (markers.length === 0) return body

  if (!body.endsWith('\n')) body += '\n'
  return body + markers.join('\n')
}

/**
 * Shape one background-process read into the `task_output` delta the model
 * sees: the incremental delta, plus the lossy-read notice (with full-stream
 * spill paths) when in-memory truncation dropped unread bytes. Empty-delta
 * rendering (`(no new output)`) is the generic control surface's job.
 * @param read - one incremental read from the process handle.
 * @param sandbox - settled sandbox facts, when this was a confined process.
 * @param escalationModes - escalation targets advertised by this composition.
 * @returns the delta text with any loss or sandbox notice appended.
 */
export function renderProcessRead(
  read: BashProcessRead,
  sandbox?: BashSandboxInfo,
  escalationModes: readonly SandboxMode[] = [],
): string {
  const notices: string[] = []
  if (read.lossy) {
    const paths = [read.stdoutSpillPath, read.stderrSpillPath].filter((path): path is string => path !== undefined)
    notices.push(`[some output was dropped from memory; full output: ${paths.length > 0 ? paths.join(', ') : '(unavailable)'}]`)
  }
  if (sandbox?.runnerFailed) {
    notices.push(`[sandbox: the sandbox runner itself failed under ${sandbox.mode} mode — the command did not run; this is a sandbox problem, not a command failure]`)
  } else if (sandbox?.denied) {
    notices.push(sandboxDenialMarker(sandbox.mode))
    if (escalationModes.length > 0) {
      notices.push(escalationHintMarker('command'))
    }
  }
  if (notices.length === 0) return read.delta
  return `${read.delta}${read.delta.length > 0 && !read.delta.endsWith('\n') ? '\n' : ''}${notices.join('\n')}`
}

/**
 * The exit-status parse is the shared marker-contract half of the shell-tool
 * rendering story, owned by `@huiliyi37/dsh-bash` so `dsh-tool-pwsh` reuses
 * it (its renderer emits the same markers). Re-exported here to keep
 * `../src/render.ts` a single import root for bash-tool consumers.
 */
export { parseExitStatus, type ParsedExitStatus } from '@huiliyi37/dsh-bash'
