#!/usr/bin/env node
/**
 * Self-executing dsh-sdk launcher.
 *
 * @module @huiliyi37/dsh-scripts/bin
 */

import { runDshSdkCommand } from './command.ts'

process.exitCode = await runDshSdkCommand()
