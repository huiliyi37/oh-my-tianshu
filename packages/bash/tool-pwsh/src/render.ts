/**
 * Model-facing result rendering for the pwsh tool — the PowerShell twin of
 * `dsh-tool-bash`'s renderer minus the sandbox surface: stdout, a marked
 * stderr section, truncation notices with spill paths, then exit-status
 * markers. Non-zero exits are reported, not errored — the model decides how to
 * react; only infrastructure failures (spawn errors, aborts) surface as
 * isError results.
 *
 * @module @deepseek-ai/dsh-tool-pwsh/render
 */

import type { BashProcessRead, CollectedOutput } from '@deepseek-ai/dsh-bash'

/* jscpd:ignore-start -- deliberate twin of dsh-tool-bash/render.ts minus the sandbox surface (Agent Note). */

/** Append the truncation notice (with the full-output spill path) to a stream's text. */
function streamText(output: CollectedOutput): string {
  if (!output.truncated) return output.text
  return `${output.text}\n[output truncated; full output: ${output.spillPath ?? '(unavailable)'}]`
}

/** The renderable foreground result shape (the schema-derived value, no `kind`). */
export interface RenderablePwshResult {
  exitCode: number | null
  signal: string | null
  timedOut: boolean
  timeoutMs: number
  stdout: CollectedOutput
  stderr: CollectedOutput
}

/**
 * Shape one finished run into the text the model sees: stdout, then a marked
 * stderr section, then exit-status markers, matching the bash tool's story —
 * a clean exit (0, no signal) produces no marker.
 * @param result - the completed foreground run from the executor.
 * @returns the model-facing text: output body (or `(no output)`), then any timeout/signal/exit markers, each on its own line.
 */
export function renderPwshResult(result: RenderablePwshResult): string {
  const out = streamText(result.stdout)
  const err = streamText(result.stderr)

  let body = out
  if (err.length > 0) {
    // Single newline between sections (stdout usually ends with one already).
    if (body.length > 0 && !body.endsWith('\n')) body += '\n'
    body += `[stderr]\n${err}`
  }
  if (body.length === 0) body = '(no output)'

  const markers: string[] = []
  // A command may trap the termination and exit 0 after timeout; still report interruption.
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
 * spill paths) when in-memory truncation dropped unread bytes.
 * @param read - one incremental read from the process handle.
 * @returns the delta text with any loss notice appended.
 */
export function renderPwshProcessRead(read: BashProcessRead): string {
  const notices: string[] = []
  if (read.lossy) {
    const paths = [read.stdoutSpillPath, read.stderrSpillPath].filter((path): path is string => path !== undefined)
    notices.push(`[some output was dropped from memory; full output: ${paths.length > 0 ? paths.join(', ') : '(unavailable)'}]`)
  }
  if (notices.length === 0) return read.delta
  return `${read.delta}${read.delta.length > 0 && !read.delta.endsWith('\n') ? '\n' : ''}${notices.join('\n')}`
}
/* jscpd:ignore-end */
