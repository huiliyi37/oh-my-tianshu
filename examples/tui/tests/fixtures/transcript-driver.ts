#!/usr/bin/env node
/**
 * Snapshot-only Loader driver for the tui example: boot the keyless smoke
 * composition, run one fixture turn, fold every canonical session event into
 * the read-only transcript projection (the same read path the TUI render core
 * uses), and print a keyless view of the derived transcript as the final JSON
 * record. No key is read or echoed here — credentials resolve inside the
 * booted tree from the process environment.
 */

import type { Context } from '@huiliyi37/cordis'
import { boot, installFailLoud, loadEnv, resolveConfigPath } from '@huiliyi37/dsh-app-boot'
import { runFixtureTurn } from '@huiliyi37/dsh-loader-smoke'
import { applyTranscriptEvent, emptyTranscript } from '../../../../packages/tui/tui/src/adapter/transcript.ts'

const NAME = 'tui-transcript-driver'
const [configPath, ...taskParts] = process.argv.slice(2)
if (configPath === undefined || taskParts.length === 0 || taskParts.every(part => part.trim() === '')) {
  throw new Error(`${NAME}: expected <config-path> <task...>`)
}

const uninstallFailLoud = installFailLoud(NAME)
let ctx: Context | undefined
try {
  loadEnv(NAME)
  ctx = await boot(NAME, resolveConfigPath(configPath, undefined))
  let view = emptyTranscript('' as never)
  const result = await runFixtureTurn(ctx, {
    task: taskParts.join(' '),
    onEvent: (_sessionId: string, event) => {
      view = applyTranscriptEvent(view, event)
    },
  })
  // Keyless projection record: message/tool surface only, no event payload
  // (tool results may carry file content; credentials stay in the tree).
  const record = {
    type: 'transcript_projection',
    sessionId: result.sessionId,
    seq: view.seq,
    turn: view.turn,
    messages: view.messages.map(message => ({ kind: message.kind, turn: message.turn, step: message.step, text: message.text })),
    tools: view.tools.map(tool => ({ name: tool.name, turn: tool.turn, step: tool.step, hasResult: tool.result !== undefined })),
    output: result.output,
  }
  process.stdout.write(`${JSON.stringify(record)}\n`)
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
} finally {
  await ctx?.fiber.dispose()
  uninstallFailLoud()
}
