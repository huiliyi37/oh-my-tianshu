/**
 * dsh-sdk config command composition.
 *
 * @module @deepseek-ai/dsh-scripts/config
 */

import {
  ClackPromptPort,
  SdkProject,
  createBuiltinRegistry,
  type PromptPort,
} from '@deepseek-ai/dsh-helper'
import { ConfigWorkflow, type ConfigWorkflowResult } from './config/config-workflow.ts'

/** Process stream slice required by dsh-sdk config. */
export interface ConfigCommandContext {
  cwd: string
  stdin: NodeJS.ReadStream
  stdout: NodeJS.WriteStream
  port?: PromptPort
  install?: (project: SdkProject) => Promise<void>
}

/** Open and interactively edit one existing SDK project. */
export async function runConfigCommand(context: ConfigCommandContext): Promise<ConfigWorkflowResult> {
  if (!context.port && (!context.stdin.isTTY || !context.stdout.isTTY)) {
    throw new Error('dsh-sdk config requires an interactive TTY')
  }
  const project = await SdkProject.open(context.cwd)
  const registry = createBuiltinRegistry(project.profile)
  return new ConfigWorkflow(
    /* v8 ignore next -- production TTY wiring is exercised by the built-bin smoke */
    context.port ?? new ClackPromptPort(context.stdin, context.stdout),
    context.stdout,
    context.install,
  ).run(project, registry)
}
