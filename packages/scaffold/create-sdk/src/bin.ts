#!/usr/bin/env node
/**
 * Self-executing create-sdk command.
 *
 * @module @deepseek-ai/create-sdk/bin
 */

import { runCreateCommand } from './command.ts'

process.exitCode = await runCreateCommand()
