/**
 * Asset loader for templates owned by dsh-helper.
 *
 * @module @deepseek-ai/dsh-helper/templates/template-assets
 */

import { TextTemplate } from './text-template.ts'

/**
 * Load one helper-owned template in source and bundled layouts.
 * @param filename - basename under the helper template asset directory.
 * @returns compiled typed template.
 */
export function loadHelperTemplate<TModel extends object>(filename: string): TextTemplate<TModel> {
  if (filename.includes('/') || filename.includes('\\')) {
    throw new Error(`helper template filename must not contain a directory: ${filename}`)
  }
  return TextTemplate.fromFile<TModel>(new URL(`./assets/${filename}`, import.meta.url))
}
