#!/usr/bin/env node
/**
 * Boots an external `cordis.yml`; its `@huiliyi37/dsh-jsonrpc` entry serves
 * newline-delimited JSON-RPC on stdio. `$DSH_CORDIS_CONFIG` wins over `argv[2]`;
 * empty or missing paths exit 1, with no default config or `DSH_SNAPSHOT` mode.
 * App-boot owns env loading, Loader guards, and settled-tree startup.
 * stdin EOF and SIGTERM dispose the root context and exit 0; SIGINT exits 130.
 * Protocol `shutdown` belongs to the server plugin. Stdout is reserved for frames.
 *
 * @module @huiliyi37/dsh-jsonrpc-demo/bin
 */

import { existsSync } from 'node:fs'
import { boot, installFailLoud, loadEnv, resolveConfigPath } from '@huiliyi37/dsh-app-boot'

const NAME = 'dsh-jsonrpc-agent'

/* v8 ignore start -- composition over tested app-boot/jsonrpc and executable acceptance paths */
installFailLoud(NAME)
loadEnv(NAME)

// Env wins over argv; empty values are absent. External config defines the deployment.
const fromEnv = process.env['DSH_CORDIS_CONFIG']
const fromArgv = process.argv[2]
const requested = fromEnv !== undefined && fromEnv !== ''
  ? fromEnv
  : fromArgv !== undefined && fromArgv !== '' ? fromArgv : undefined
const configPath = requested !== undefined ? resolveConfigPath(requested, undefined) : undefined
if (configPath === undefined || !existsSync(configPath)) {
  process.stderr.write(
    `usage: ${NAME} <path/to/cordis.yml> (or set DSH_CORDIS_CONFIG=<path>, which wins); the config is required — there is no built-in fallback\n`,
  )
  process.exit(1)
}

const ctx = await boot(NAME, configPath)
let exiting = false

async function disposeAndExit(code: number): Promise<void> {
  if (exiting) return
  exiting = true
  try {
    await ctx.fiber.dispose()
  } finally {
    process.exit(code)
  }
}

process.stdin.on('end', () => { void disposeAndExit(0) })
process.on('SIGTERM', () => { void disposeAndExit(0) })
process.on('SIGINT', () => { void disposeAndExit(130) })
/* v8 ignore stop */
