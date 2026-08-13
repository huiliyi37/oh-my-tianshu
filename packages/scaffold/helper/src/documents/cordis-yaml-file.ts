/**
 * Comment-preserving Cordis YAML document and `!!js` expression value.
 *
 * @module @deepseek-ai/dsh-helper/documents/cordis-yaml-file
 */

import {
  Document, isMap, isSeq, parseDocument, visit, YAMLMap, YAMLSeq,
  type ScalarTag,
} from 'yaml'
import { ProjectFile, withTrailingNewline } from './project-file.ts'

/** Explicit JavaScript expression serialized with Cordis' `!!js` YAML tag. */
export class JsExpression {
  /** Expression source evaluated by the Cordis include loader. */
  readonly source: string

  /** Create an expression value. */
  constructor(source: string) {
    if (source.trim().length === 0) throw new Error('JavaScript expression must not be empty')
    this.source = source
  }

  /** Return expression source for YAML scalar stringification. */
  toString(): string {
    return this.source
  }
}

const JS_EXPRESSION_TAG: ScalarTag = {
  tag: 'tag:yaml.org,2002:js',
  identify: value => value instanceof JsExpression,
  resolve: value => new JsExpression(value),
  stringify: item => String(item.value),
}

/** Plain domain representation of one top-level Cordis config entry. */
export interface CordisConfigEntry {
  id: string
  name: string
  config?: Record<string, unknown>
  disabled?: boolean
}

function parseYaml(text: string): Document.Parsed {
  const document = parseDocument(text, {
    customTags: [JS_EXPRESSION_TAG],
    keepSourceTokens: true,
    prettyErrors: true,
  })
  if (document.errors.length > 0) {
    throw new Error(`invalid cordis.yml: ${document.errors.map(error => error.message).join('; ')}`)
  }
  if (!isSeq(document.contents)) throw new Error('invalid cordis.yml: root must be a sequence')
  visit(document, { Collection: (_key, collection) => { collection.flow = false } })
  return document
}

function entryFromValue(value: unknown): CordisConfigEntry {
  /* v8 ignore next -- entries() calls this only after requiring a YAMLMap, whose JSON value is an object */
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new Error('invalid cordis.yml entry: expected an object')
  }
  const entry = value as Record<string, unknown>
  if (typeof entry.id !== 'string' || entry.id.length === 0) {
    throw new Error('invalid cordis.yml entry: id must be a non-empty string')
  }
  if (typeof entry.name !== 'string' || entry.name.length === 0) {
    throw new Error(`invalid cordis.yml entry ${entry.id}: name must be a non-empty string`)
  }
  if (entry.config !== undefined
    && (entry.config === null || Array.isArray(entry.config) || typeof entry.config !== 'object')) {
    throw new Error(`invalid cordis.yml entry ${entry.id}: plugin config must be an object`)
  }
  if (entry.disabled !== undefined && typeof entry.disabled !== 'boolean') {
    throw new Error(`invalid cordis.yml entry ${entry.id}: disabled must be boolean`)
  }
  return {
    id: entry.id,
    name: entry.name,
    ...entry.config !== undefined ? { config: entry.config as Record<string, unknown> } : {},
    ...entry.disabled !== undefined ? { disabled: entry.disabled } : {},
  }
}

/** Editable top-level cordis.yml using YAML's document API. */
export class CordisYamlFile extends ProjectFile {
  private readonly document: Document.Parsed

  private constructor(document: Document.Parsed, originalText?: string) {
    super('cordis.yml', originalText)
    this.document = document
  }

  /** Create an empty Cordis config entry list. */
  static create(): CordisYamlFile {
    return new CordisYamlFile(parseYaml('[]\n'))
  }

  /** Parse an existing cordis.yml while retaining comments and scalar styles. */
  static parse(text: string): CordisYamlFile {
    return new CordisYamlFile(parseYaml(text), text)
  }

  /** Clone through YAML text so the edit session owns an independent AST. */
  override clone(): CordisYamlFile {
    return new CordisYamlFile(parseYaml(this.serialize()), this.originalText)
  }

  private sequence(): YAMLSeq {
    /* v8 ignore next -- parseYaml and create both establish a sequence root */
    if (!isSeq(this.document.contents)) throw new Error('cordis.yml root is not a sequence')
    return this.document.contents
  }

  private entryNode(id: string): YAMLMap | undefined {
    for (const item of this.sequence().items) {
      if (!isMap(item)) continue
      if (item.get('id') === id) return item
    }
    return undefined
  }

  /** Return defensive plain entry values in file order. */
  entries(): CordisConfigEntry[] {
    return this.sequence().items.map((item) => {
      if (!isMap(item)) throw new Error('invalid cordis.yml: every entry must be a mapping')
      return entryFromValue(item.toJSON())
    })
  }

  /** Find one entry by stable id. */
  entry(id: string): CordisConfigEntry | undefined {
    return this.entries().find(entry => entry.id === id)
  }

  /** Add one new top-level entry, rejecting duplicate ids. */
  addEntry(entry: CordisConfigEntry, commentedExample?: string): void {
    if (this.entryNode(entry.id)) throw new Error(`Cordis config entry already exists: ${entry.id}`)
    const node = this.document.createNode(entry)
    if (commentedExample) node.comment = commentedExample.split('\n').map(line => ` ${line}`).join('\n')
    this.sequence().items.push(node)
  }

  /** Remove an entry by id and report whether it existed. */
  removeEntry(id: string): boolean {
    const sequence = this.sequence()
    const index = sequence.items.findIndex(item => isMap(item) && item.get('id') === id)
    if (index < 0) return false
    sequence.items.splice(index, 1)
    return true
  }

  /** Enable or disable an entry through the Loader-native field. */
  setDisabled(id: string, disabled: boolean): void {
    const node = this.entryNode(id)
    if (!node) throw new Error(`Cordis config entry does not exist: ${id}`)
    if (disabled) node.set('disabled', true)
    else node.delete('disabled')
  }

  /** Replace only owned plugin config keys while retaining unknown user keys. */
  updateOwnedConfig(id: string, ownedKeys: readonly string[], next: Record<string, unknown>): void {
    const entry = this.entryNode(id)
    if (!entry) throw new Error(`Cordis config entry does not exist: ${id}`)
    let config: unknown = entry.get('config', true)
    if (config === undefined || config === null) {
      config = new YAMLMap()
      entry.set('config', config)
    }
    if (!isMap(config)) throw new Error(`Cordis config entry ${id} plugin config is not a mapping`)
    for (const key of ownedKeys) config.delete(key)
    for (const [key, value] of Object.entries(next)) config.set(key, this.document.createNode(value))
    if (config.items.length === 0) entry.delete('config')
  }

  /** Validate ids, names, plugin config maps, and id uniqueness. */
  override validate(): void {
    const seen = new Set<string>()
    for (const entry of this.entries()) {
      if (seen.has(entry.id)) throw new Error(`duplicate Cordis config entry id: ${entry.id}`)
      seen.add(entry.id)
    }
  }

  /** Serialize through the YAML document while retaining untouched trivia. */
  override serialize(): string {
    return withTrailingNewline(this.document.toString({ lineWidth: 0 }))
  }
}
