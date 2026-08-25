#!/usr/bin/env node
/** Snapshot-only driver that boots a composition and yields lifecycle ownership to the interactive TUI. */

import { boot, installFailLoud, loadEnv, resolveConfigPath } from '@huiliyi37/dsh-app-boot'

const NAME = 'tui-interactive-driver'
const configPath = process.argv[2]
let ctx: Awaited<ReturnType<typeof boot>> | undefined
const uninstallFailLoud = installFailLoud(NAME, process, async () => {
  await ctx?.fiber.dispose()
})

try {
  if (configPath === undefined || configPath === '') {
    throw new Error(`${NAME}: expected <config-path>`)
  }
  loadEnv(NAME)
  ctx = await boot(NAME, resolveConfigPath(configPath, undefined))
  // The interactive TUI owns stdin/stdout on a TTY; hold the process open for it.
  const keepAlive = setInterval(() => {}, 60_000)
  try {
    await new Promise<void>(() => {})
  } finally {
    clearInterval(keepAlive)
  }
} catch (error: unknown) {
  let reported = error
  try {
    await ctx?.fiber.dispose()
  } catch (disposeError: unknown) {
    reported = new AggregateError([error, disposeError], `${NAME}: boot failed and dispose also failed`)
  }
  uninstallFailLoud()
  console.error(`${NAME}: ${reported instanceof Error ? reported.stack ?? reported.message : String(reported)}`)
  process.exitCode = 1
}
