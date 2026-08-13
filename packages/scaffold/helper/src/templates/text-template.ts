/**
 * Strict typed rendering for package-owned text templates.
 *
 * @module @deepseek-ai/dsh-helper/templates/text-template
 */

import { readFileSync } from 'node:fs'
import Handlebars from 'handlebars'

/** Strict Handlebars template with no HTML escaping or custom extensions. */
export class TextTemplate<TModel extends object> {
  private readonly renderer: Handlebars.TemplateDelegate<TModel>

  /**
   * Compile one template under the SDK's fixed rendering policy.
   * @param source - complete template source.
   */
  constructor(source: string) {
    const handlebars = Handlebars.create()
    this.renderer = handlebars.compile<TModel>(source, {
      strict: true,
      noEscape: true,
      preventIndent: true,
    })
  }

  /**
   * Load a template asset owned by the calling package.
   * @param url - source or bundled asset URL.
   * @returns compiled template.
   */
  static fromFile<T extends object>(url: URL): TextTemplate<T> {
    return new TextTemplate<T>(readFileSync(url, 'utf8'))
  }

  /**
   * Render text from one complete typed model.
   * @param model - values referenced by the template.
   * @returns rendered text.
   */
  render(model: TModel): string {
    return this.renderer(model)
  }
}
