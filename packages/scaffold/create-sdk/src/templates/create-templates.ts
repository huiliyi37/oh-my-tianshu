/**
 * Package-owned terminal templates for create-sdk.
 *
 * @module @deepseek-ai/create-sdk/templates/create-templates
 */

import {
  TextTemplate,
  type PackageManager,
  type PackageManagerName,
} from '@deepseek-ai/dsh-helper'

interface CreatedTemplateModel {
  name: string
  directory: string
}

interface NextStepsTemplateModel extends PackageManagerTemplateModel {
  directory: string
  setupRequired: boolean
}

interface SetupFailureTemplateModel extends PackageManagerTemplateModel {
  directory: string
  error: string
}

/** Package-manager execution data consumed by create-sdk templates. */
export interface PackageManagerTemplateModel {
  packageManager: PackageManagerName
  installArgs: string
  buildArgs: string
}

/**
 * Map package-manager execution data into terminal-template fields.
 * @param manager - selected package-manager strategy.
 * @returns executable name and operation arguments.
 */
export function packageManagerTemplateModel(manager: PackageManager): PackageManagerTemplateModel {
  return {
    packageManager: manager.name,
    installArgs: manager.installCommand().join(' '),
    buildArgs: manager.buildCommand().join(' '),
  }
}

/** Compiled create-sdk terminal templates. */
export const CREATE_TEMPLATES = {
  usage: TextTemplate.fromFile<Record<string, never>>(new URL('./assets/usage.txt.tpl', import.meta.url)),
  created: TextTemplate.fromFile<CreatedTemplateModel>(new URL('./assets/created.txt.tpl', import.meta.url)),
  nextSteps: TextTemplate.fromFile<NextStepsTemplateModel>(new URL('./assets/next-steps.txt.tpl', import.meta.url)),
  setupFailure: TextTemplate.fromFile<SetupFailureTemplateModel>(
    new URL('./assets/setup-failure.txt.tpl', import.meta.url),
  ),
  installQuestion: TextTemplate.fromFile<PackageManagerTemplateModel>(
    new URL('./assets/install-question.txt.tpl', import.meta.url),
  ),
} as const
