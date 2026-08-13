/**
 * Comment-preserving root tsconfig editor for local plugin references.
 *
 * @module @deepseek-ai/dsh-helper/documents/tsconfig-file
 */

import { applyEdits, modify, parse, type ParseError } from 'jsonc-parser'
import { ProjectFile, withTrailingNewline } from './project-file.ts'

const FORMAT = { insertSpaces: true, tabSize: 2, eol: '\n' }

function parseConfig(text: string): Record<string, unknown> {
  const errors: ParseError[] = []
  const value: unknown = parse(text, errors, { allowTrailingComma: true, disallowComments: false })
  if (errors.length > 0 || value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new Error('tsconfig.json is not a valid JSONC object')
  }
  return value as Record<string, unknown>
}

/** Root tsconfig document edited with jsonc-parser patches. */
export class TsConfigFile extends ProjectFile {
  private text: string

  private constructor(text: string, originalText?: string) {
    super('tsconfig.json', originalText)
    this.text = withTrailingNewline(text)
  }

  /** Create the root project-reference config. */
  static create(): TsConfigFile {
    return new TsConfigFile(JSON.stringify({
      extends: './tsconfig.base.json',
      compilerOptions: { noEmit: true },
      include: ['index.ts'],
      references: [],
    }, null, 2))
  }

  /** Parse an existing root tsconfig. */
  static parse(text: string): TsConfigFile {
    parseConfig(text)
    return new TsConfigFile(text, text)
  }

  /** Clone the current JSONC text. */
  override clone(): TsConfigFile {
    return new TsConfigFile(this.text, this.originalText)
  }

  /** Add one project reference while retaining comments and formatting. */
  addReference(path: string): void {
    const value = parseConfig(this.text)
    const references = value.references
    if (references !== undefined && !Array.isArray(references)) {
      throw new Error('tsconfig.json references must be an array')
    }
    const typed = (references ?? []) as unknown[]
    for (const item of typed) {
      if (item === null || Array.isArray(item) || typeof item !== 'object' || typeof (item as { path?: unknown }).path !== 'string') {
        throw new Error('tsconfig.json references must contain { path: string } objects')
      }
    }
    if (typed.some(item => (item as { path: string }).path === path)) return
    this.text = applyEdits(this.text, modify(
      this.text,
      ['references', typed.length],
      { path },
      { formattingOptions: FORMAT, isArrayInsertion: true },
    ))
  }

  /** Validate JSONC and the project-reference shape. */
  override validate(): void {
    const value = parseConfig(this.text)
    if (value.references === undefined) return
    if (!Array.isArray(value.references)) throw new Error('tsconfig.json references must be an array')
    for (const item of value.references) {
      if (item === null || Array.isArray(item) || typeof item !== 'object' || typeof (item as { path?: unknown }).path !== 'string') {
        throw new Error('tsconfig.json references must contain { path: string } objects')
      }
    }
  }

  /** Return patched JSONC text. */
  override serialize(): string {
    return withTrailingNewline(this.text)
  }
}
