/**
 * File discovery and parsing for file-backed slash commands.
 *
 * Two layers are loaded: a user layer (`<harness home>/commands`) and a
 * project layer (`<cwd>/.dsh/commands`). Every `.md` file under a layer becomes
 * one command whose name is the lowercase file stem with any nested directory
 * flattened by `-` (so `git/log.md` → `git-log`). Each file must carry a YAML
 * frontmatter (`---` fence) with a non-empty `description`; a missing or
 * malformed fence, invalid YAML, a command name that violates the registry
 * regex, or a same-layer name collision all fail loud at load time and report
 * the offending file path.
 *
 * Cross-layer collisions are de-duplicated here, not by the registry (which
 * throws on a global same-name `register`): the user layer is collected first,
 * then the project layer overwrites it, so a project command shadows the
 * homonymous user command and only the winner is registered.
 *
 * The module is lazy (directories that do not exist yield no commands) and
 * read-only: it never watches the filesystem, so new or edited command files
 * take effect on restart.
 *
 * @module @huiliyi37/dsh-command-files/loader
 */

import { readFile, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { parse as parseYaml } from 'yaml'

/** Command-name grammar the registry enforces (leading letter; no uppercase). */
const COMMAND_NAME = /^[a-z][a-z0-9_-]*$/u

/** Which filesystem layer a loaded command came from. */
export type CommandSource = 'user' | 'project'

/** One command fully parsed out of a single `.md` command file. */
export interface LoadedCommand {
  /** Lowercase command name without the leading slash (directory-flattened). */
  readonly name: string
  /** Absolute path of the source `.md` file (reported in load failures). */
  readonly filePath: string
  /** Which layer supplied this command (project shadows user on a collision). */
  readonly source: CommandSource
  /** Required frontmatter `description`, trimmed. */
  readonly description: string
  /** Whether this command accepts image attachments (`input.images`). */
  readonly images: boolean
  /** Template body after the frontmatter fence. */
  readonly body: string
}

/** Frontmatter fields after YAML parsing, before name resolution. */
interface ParsedFile {
  readonly description: string
  readonly images: boolean
  readonly body: string
}

/**
 * Derive the command name from a layer-relative file path.
 * @param relPath - path relative to the command layer root (any separator).
 * @returns the lowercase directory-flattened stem, e.g. `git/log.md` → `git-log`.
 */
export function commandNameFromPath(relPath: string): string {
  return relPath
    .replace(/\\/gu, '/')
    .replace(/\.md$/iu, '')
    .split('/')
    .join('-')
    .toLowerCase()
}

/**
 * Load every command from both layers and resolve cross-layer collisions.
 *
 * The user layer is collected first and the project layer overwrites it, so a
 * project command shadows a homonymous user command. Within a single layer a
 * duplicate name (stem or flattened collision) throws loud.
 *
 * @param userDir - absolute user-command directory (default `<home>/commands`).
 * @param projectDir - absolute project-command directory (default `<cwd>/.dsh/commands`).
 * @returns a map from command name to its winning definition (project shadows user).
 */
export async function loadCommandFiles(userDir: string, projectDir: string): Promise<Map<string, LoadedCommand>> {
  const user = await loadLayer(userDir, 'user')
  const project = await loadLayer(projectDir, 'project')
  return new Map([...user, ...project])
}

/**
 * Collect and validate every `.md` file under one layer.
 * @param dir - absolute layer directory; a missing directory yields no commands.
 * @param source - layer label used in diagnostics.
 * @returns a map from validated command name to its definition.
 */
async function loadLayer(dir: string, source: CommandSource): Promise<Map<string, LoadedCommand>> {
  const commands = new Map<string, LoadedCommand>()
  for (const file of await collectMarkdownFiles(dir)) {
    const name = commandNameFromPath(relative(dir, file))
    if (!COMMAND_NAME.test(name)) {
      throw new Error(`command file "${file}" derives name "${name}" which must match ${String(COMMAND_NAME)}`)
    }
    const parsed = parseCommandFile(await readFile(file, 'utf8'), file)
    const existing = commands.get(name)
    if (existing !== undefined) {
      throw new Error(`command name "${name}" is duplicated in the ${source} layer: "${existing.filePath}" and "${file}"`)
    }
    commands.set(name, { name, filePath: file, source, ...parsed })
  }
  return commands
}

/**
 * Recursively collect `.md` files under a directory.
 * @param dir - directory to walk; a missing directory yields no files.
 * @returns absolute paths of every `.md` file (symlinks are not followed).
 */
async function collectMarkdownFiles(dir: string): Promise<string[]> {
  const files: string[] = []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (isAbsentError(error)) return files
    throw error
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await collectMarkdownFiles(full))
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(full)
    }
  }
  return files
}

/**
 * Parse one command file's frontmatter and body.
 * @param content - complete file text.
 * @param filePath - absolute path used in load-failure diagnostics.
 * @returns the frontmatter fields and template body.
 * @throws on a missing/malformed fence, invalid YAML, or a missing `description`.
 */
function parseCommandFile(content: string, filePath: string): ParsedFile {
  const { yaml, body } = splitFrontmatter(content, filePath)
  let data: unknown
  try {
    data = parseYaml(yaml)
  } catch (error) {
    throw new Error(`command file "${filePath}" has invalid YAML frontmatter: ${errorMessage(error)}`)
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error(`command file "${filePath}" frontmatter must be a YAML mapping`)
  }
  const record = data as Record<string, unknown>
  const description = stringField(record, 'description')
  if (description === undefined) {
    throw new Error(`command file "${filePath}" is missing a non-empty frontmatter description`)
  }
  return { description, images: frontmatterBoolean(record, 'images', filePath), body }
}

/**
 * Split a frontmatter fence from a command file.
 * @param content - complete file text.
 * @param filePath - absolute path used in diagnostics.
 * @returns the YAML text and the body after the closing fence.
 * @throws when the file does not start with `---` or never closes the fence.
 */
function splitFrontmatter(content: string, filePath: string): { yaml: string; body: string } {
  const firstLineEnd = content.indexOf('\n')
  if (firstLineEnd < 0) {
    throw new Error(`command file "${filePath}" must start with a YAML frontmatter fence`)
  }
  const firstLine = content.slice(0, firstLineEnd).replace(/\r$/, '')
  if (firstLine !== '---') {
    throw new Error(`command file "${filePath}" must start with a YAML frontmatter fence`)
  }
  const start = firstLineEnd + 1
  const closing = findClosingFrontmatter(content, start)
  if (closing === undefined) {
    throw new Error(`command file "${filePath}" is missing the closing frontmatter fence`)
  }
  return { yaml: content.slice(start, closing.start), body: content.slice(closing.bodyStart) }
}

/**
 * Locate the closing `---` fence line after the opening one.
 * @param raw - complete file text.
 * @param start - offset just past the opening-fence newline.
 * @returns the opening offset of the closing fence and the body start, or
 *   `undefined` when no closing fence exists.
 */
function findClosingFrontmatter(raw: string, start: number): { start: number; bodyStart: number } | undefined {
  let lineStart = start
  while (lineStart <= raw.length) {
    const nextNewline = raw.indexOf('\n', lineStart)
    const lineEnd = nextNewline < 0 ? raw.length : nextNewline
    const line = raw.slice(lineStart, lineEnd).replace(/\r$/, '')
    if (line === '---') {
      return { start: lineStart, bodyStart: nextNewline < 0 ? raw.length : nextNewline + 1 }
    }
    if (nextNewline < 0) return undefined
    lineStart = nextNewline + 1
  }
}

/** Read a required non-empty string field. @returns the trimmed value, or `undefined` when absent/blank. */
function stringField(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/**
 * Read an optional boolean frontmatter field; absent means `false`.
 * @param data - parsed frontmatter mapping.
 * @param key - the frontmatter key.
 * @param filePath - absolute path used in diagnostics.
 * @returns the boolean value.
 * @throws when the field is present but not coercible to a boolean.
 */
function frontmatterBoolean(data: Record<string, unknown>, key: string, filePath: string): boolean {
  if (!Object.hasOwn(data, key)) return false
  const value = data[key]
  if (typeof value === 'boolean') return value
  if (value === 1 || value === '1') return true
  if (value === 0 || value === '0') return false
  if (typeof value === 'string') {
    switch (value.toLowerCase()) {
      case 'true':
      case 'yes':
      case 'on':
        return true
      case 'false':
      case 'no':
      case 'off':
        return false
    }
  }
  throw new Error(`command file "${filePath}" frontmatter field "${key}" must be a boolean`)
}

/** Report an arbitrary thrown value without trusting its coercion. @returns a human-readable string. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** @returns whether a filesystem error is an ordinary missing-path report. */
function isAbsentError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'
}
