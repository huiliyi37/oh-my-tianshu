/**
 * Ownership-aware, line-preserving dotenv document.
 *
 * @module @deepseek-ai/dsh-helper/documents/env-file
 */

import { ProjectFile, withTrailingNewline } from './project-file.ts'

interface ParsedVariable {
  index: number
  value: string
}

const VARIABLE = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/
const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

/** `.env` appends missing variables; `.env.example` supports managed replacement and removal. */
export class EnvFile extends ProjectFile {
  private readonly lines: string[]

  private constructor(relativePath: '.env' | '.env.example', lines: string[], originalText?: string) {
    super(relativePath, originalText, relativePath === '.env' ? 0o600 : undefined)
    this.lines = [...lines]
  }

  /** Create an empty environment file. */
  static create(relativePath: '.env' | '.env.example'): EnvFile {
    return new EnvFile(relativePath, [])
  }

  /** Parse an existing environment file without rewriting unknown lines. */
  static parse(relativePath: '.env' | '.env.example', text: string): EnvFile {
    const normalized = text.replace(/\n$/, '')
    return new EnvFile(relativePath, normalized.length === 0 ? [] : normalized.split('\n'), text)
  }

  /** Clone the current line model. */
  override clone(): EnvFile {
    return new EnvFile(this.relativePath as '.env' | '.env.example', this.lines, this.originalText)
  }

  private variables(): Map<string, ParsedVariable[]> {
    const values = new Map<string, ParsedVariable[]>()
    this.lines.forEach((line, index) => {
      const match = VARIABLE.exec(line)
      if (!match) return
      const name = match[1]
      const value = match[2]
      /* v8 ignore next -- both captures are mandatory in VARIABLE */
      if (name === undefined || value === undefined) return
      const occurrences = values.get(name) ?? []
      occurrences.push({ index, value })
      values.set(name, occurrences)
    })
    return values
  }

  /** Read the effective value; append-only `.env` accepts duplicates and uses the last declaration. */
  get(name: string): string | undefined {
    const occurrences = this.variables().get(name) ?? []
    if (this.relativePath === '.env.example' && occurrences.length > 1) {
      throw new Error(`${this.relativePath} contains duplicate variable ${name}`)
    }
    return occurrences.at(-1)?.value
  }

  /** Add or replace one SDK-managed `.env.example` variable while preserving unrelated lines. */
  set(name: string, value: string): void {
    if (this.relativePath !== '.env.example') throw new Error('.env is append-only')
    if (!VARIABLE_NAME.test(name)) throw new Error(`invalid environment variable name: ${name}`)
    const occurrences = this.variables().get(name) ?? []
    if (occurrences.length > 1) throw new Error(`${this.relativePath} contains duplicate variable ${name}`)
    const line = `${name}=${value}`
    if (occurrences[0]) this.lines[occurrences[0].index] = line
    else this.lines.push(line)
  }

  /** Append a missing `.env` variable and optional comment without changing any existing declaration. */
  append(name: string, value: string, comment?: string): boolean {
    if (this.relativePath !== '.env') throw new Error('.env.example is SDK-managed')
    if (!VARIABLE_NAME.test(name)) throw new Error(`invalid environment variable name: ${name}`)
    if (comment !== undefined && (!comment || comment.includes('\n'))) {
      throw new Error('environment comment must be one non-empty line')
    }
    if (this.variables().has(name)) return false
    if (comment) this.lines.push(`# ${comment}`)
    this.lines.push(`${name}=${value}`)
    return true
  }

  /** Remove one SDK-managed `.env.example` variable while retaining every other line. */
  remove(name: string): void {
    if (this.relativePath !== '.env.example') throw new Error('.env is append-only')
    const occurrences = this.variables().get(name) ?? []
    if (occurrences.length > 1) throw new Error(`${this.relativePath} contains duplicate variable ${name}`)
    if (occurrences[0]) this.lines.splice(occurrences[0].index, 1)
  }

  /** Validate the managed placeholder file; append-only `.env` accepts duplicate declarations. */
  override validate(): void {
    if (this.relativePath === '.env') return
    for (const [name, occurrences] of this.variables()) {
      if (occurrences.length > 1) throw new Error(`${this.relativePath} contains duplicate variable ${name}`)
    }
  }

  /** Serialize all retained lines with one trailing newline. */
  override serialize(): string {
    return withTrailingNewline(this.lines.join('\n'))
  }
}
