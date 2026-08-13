/**
 * Base abstraction for one file in an SDK project snapshot.
 *
 * @module @deepseek-ai/dsh-helper/documents/project-file
 */

/** Return text with exactly one trailing newline. */
export function withTrailingNewline(text: string): string {
  return text.replace(/\n*$/, '') + '\n'
}

/** One cloneable, validatable project file. */
export abstract class ProjectFile {
  /** Project-relative POSIX path. */
  readonly relativePath: string

  /** Text observed when the document entered the snapshot; absent for a new file. */
  readonly originalText: string | undefined

  /** Permission bits used only when the file is first created. */
  readonly createMode: number | undefined

  protected constructor(relativePath: string, originalText?: string, createMode?: number) {
    if (relativePath.startsWith('/') || relativePath.split('/').includes('..')) {
      throw new Error(`project document path must stay inside the project: ${relativePath}`)
    }
    this.relativePath = relativePath
    this.originalText = originalText
    this.createMode = createMode
  }

  /** Clone the document for an isolated edit session. */
  abstract clone(): ProjectFile

  /** Validate the document's complete current state. */
  abstract validate(): void

  /** Serialize the complete current file. */
  abstract serialize(): string
}

/** Immutable complete-text file used by one-shot artifacts. */
export class TextProjectFile extends ProjectFile {
  private readonly text: string

  /** Create a complete-text project document. */
  constructor(relativePath: string, text: string, originalText?: string) {
    super(relativePath, originalText)
    this.text = withTrailingNewline(text)
  }

  /** Clone this immutable document. */
  override clone(): TextProjectFile {
    return new TextProjectFile(this.relativePath, this.text, this.originalText)
  }

  /** Complete text artifacts have no extra structural validation. */
  override validate(): void {}

  /** Return the complete artifact text. */
  override serialize(): string {
    return this.text
  }
}
