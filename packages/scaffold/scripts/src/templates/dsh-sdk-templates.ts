/**
 * Package-owned terminal templates for the dsh-sdk launcher.
 *
 * @module @deepseek-ai/dsh-scripts/templates/dsh-sdk-templates
 */

import { TextTemplate, type PackageManagerName } from '@deepseek-ai/dsh-helper'

interface ConfigInstallFailureTemplateModel {
  error: string
  packageManager: PackageManagerName
  installArgs: string
}

/** Compiled dsh-sdk terminal templates. */
export const DSH_SDK_TEMPLATES = {
  usage: TextTemplate.fromFile<Record<string, never>>(new URL('./assets/usage.txt.tpl', import.meta.url)),
  configInstallFailure: TextTemplate.fromFile<ConfigInstallFailureTemplateModel>(
    new URL('./assets/config-install-failure.txt.tpl', import.meta.url),
  ),
} as const
