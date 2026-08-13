#!/usr/bin/env node

/** Command-line entry that prepares the current `.dsh-plugin` package. @module */

import { prepareDshPlugin } from './format.ts'

try {
  await prepareDshPlugin()
} catch (error) {
  process.stderr.write(`dsh-plugin-prepare: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
