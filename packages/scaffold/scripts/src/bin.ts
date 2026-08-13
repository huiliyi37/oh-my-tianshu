#!/usr/bin/env node
/**
 * Self-executing dsh-sdk launcher.
 *
 * @module @deepseek-ai/dsh-scripts/bin
 */

import { runDshSdkCommand } from './command.ts'

process.exitCode = await runDshSdkCommand()
