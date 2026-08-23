#!/usr/bin/env node
/** Snapshot-only driver that boots the shipped TUI composition and yields lifecycle ownership to it. */

import { boot, installFailLoud, loadEnv, resolveConfigPath } from '@huiliyi37/dsh-app-boot'

const NAME = 'tui-welcome-driver'
const STARTUP_TIP_DEADLINE_MS = 10_000
const configPath = process.argv[2]
let ctx: Awaited<ReturnType<typeof boot>> | undefined
const uninstallFailLoud = installFailLoud(NAME, process, async () => {
  await ctx?.fiber.dispose()
})

try {
  if (configPath === undefined || configPath === '') {
    throw new Error(`${NAME}: expected <config-path>`)
  }
  const originalRandom = Math.random
  let startupTipRandomConsumed = false
  let firstRandomFailure: Error | undefined
  let observeFirstRandom: (() => void) | undefined
  const firstRandomObserved = new Promise<void>((resolve) => {
    observeFirstRandom = resolve
  })
  // Retry plugins may cache this function during apply. The wrapper therefore
  // keeps its own one-shot state and delegates every later cached call.
  const startupTipRandom = (): number => {
    if (startupTipRandomConsumed) return originalRandom()
    const stack = new Error('startup Tip random callsite').stack ?? ''
    // tsdown preserves the stable function name in lib/index.js but does not
    // preserve the source path or ship a source map.
    const fromWelcomeTip = stack.split('\n').some(line => line.includes('pickWelcomeTip'))
    if (!fromWelcomeTip) {
      const failure = new Error(
        `${NAME}: first Math.random call did not originate from pickWelcomeTip`,
      )
      firstRandomFailure = failure
      observeFirstRandom?.()
      throw failure
    }
    startupTipRandomConsumed = true
    observeFirstRandom?.()
    return 0
  }
  Math.random = startupTipRandom
  try {
    loadEnv(NAME)
    ctx = await boot(NAME, resolveConfigPath(configPath, undefined))
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        firstRandomObserved,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            reject(new Error(
              `${NAME}: startup Tip was not selected within ${STARTUP_TIP_DEADLINE_MS}ms after boot`,
            ))
          }, STARTUP_TIP_DEADLINE_MS)
        }),
      ])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
    if (firstRandomFailure !== undefined) throw firstRandomFailure
    if (!startupTipRandomConsumed) {
      throw new Error(`${NAME}: boot completed without selecting the startup Tip`)
    }
  } finally {
    Math.random = originalRandom
  }
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
  } catch (cleanupError: unknown) {
    const primary = error instanceof Error ? error.stack ?? error.message : String(error)
    const cleanup = cleanupError instanceof Error
      ? cleanupError.stack ?? cleanupError.message
      : String(cleanupError)
    reported = new AggregateError(
      [error, cleanupError],
      `${NAME}: startup failed:\n${primary}\n${NAME}: fiber cleanup also failed:\n${cleanup}`,
    )
  } finally {
    uninstallFailLoud()
  }
  process.stderr.write(`${reported instanceof Error ? reported.stack ?? reported.message : String(reported)}\n`)
  process.exitCode = 1
}
