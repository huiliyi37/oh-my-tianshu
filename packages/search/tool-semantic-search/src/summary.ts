/**
 * Bounded dynamic-context index summary (Tianshu `<codebase-index>` injection
 * spirit, dsh-flavored). The summary is a deterministic, ≤2000-char file
 * listing plus chunk census — deterministic per index state so the
 * runtime-context content-diff injects it only when the index actually
 * changes (volatile content never enters the frozen system-prompt prefix).
 *
 * @module @huiliyi37/dsh-tool-semantic-search/summary
 */

import type { SemanticIndex } from '@huiliyi37/dsh-semantic-index'

/** Injection budget cap for the workspace index summary (new discipline). */
export const INDEX_SUMMARY_MAX_CHARS = 2000

/** Cap on listed files before the summary truncates with a count note. */
const SUMMARY_MAX_FILES = 80

/**
 * Render the current index summary. Checks staleness first so the summary
 * reflects the freshest state; content is deterministic for the same index
 * state (paths sorted), so the runtime-context diff injects only on real
 * change.
 * @param index - the workspace semantic index.
 * @returns the bounded summary text.
 */
export function renderIndexSummary(index: SemanticIndex): string {
  if (index.isStale()) index.incrementalUpdate()
  const paths = [...index.listFiles()].sort()
  const chunkCount = index.chunkCount
  const lines = paths.map(path => `- ${path}`)
  if (lines.length > SUMMARY_MAX_FILES) {
    lines.splice(SUMMARY_MAX_FILES, lines.length - SUMMARY_MAX_FILES, `- … ${paths.length - SUMMARY_MAX_FILES} more files`)
  }
  let summary = [
    `工作区索引（semantic_index）：${paths.length} 个源文件、${chunkCount} 个分块。`,
    ...lines,
  ].join('\n')
  if (summary.length > INDEX_SUMMARY_MAX_CHARS) {
    summary = `${summary.slice(0, INDEX_SUMMARY_MAX_CHARS - 40)}…（截断）`
  }
  return summary
}
