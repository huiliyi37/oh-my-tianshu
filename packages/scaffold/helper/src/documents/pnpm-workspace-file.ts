/**
 * Structured pnpm workspace configuration for generated SDK projects.
 *
 * @module @deepseek-ai/dsh-helper/documents/pnpm-workspace-file
 */

import {
  isMap, isScalar, isSeq, parseDocument,
  type Document, type Scalar, type YAMLMap, type YAMLSeq,
} from 'yaml'
import { ProjectFile, withTrailingNewline } from './project-file.ts'

function parseYaml(text: string): Document.Parsed {
  const document = parseDocument(text, { keepSourceTokens: true, prettyErrors: true })
  if (document.errors.length > 0) {
    throw new Error(`invalid pnpm-workspace.yaml: ${document.errors.map(error => error.message).join('; ')}`)
  }
  if (!isMap(document.contents)) throw new Error('pnpm-workspace.yaml root must be an object')
  return document
}

/** Generated pnpm-workspace.yaml model. */
export class PnpmWorkspaceFile extends ProjectFile {
  private readonly document: Document.Parsed

  private constructor(document: Document.Parsed, originalText?: string) {
    super('pnpm-workspace.yaml', originalText)
    this.document = document
  }

  /** Create a pnpm workspace document. */
  static create(): PnpmWorkspaceFile {
    const document = new PnpmWorkspaceFile(parseYaml('{}\n'))
    document.mapping().set('packages', document.document.createNode([]))
    document.mapping().set('allowBuilds', document.document.createNode({ esbuild: true }))
    return document
  }

  /** Parse the workspace fields the SDK owns while retaining all other YAML. */
  static parse(text: string): PnpmWorkspaceFile {
    const document = new PnpmWorkspaceFile(parseYaml(text), text)
    document.packageSequence()
    const autoInstallPeers = document.mapping().get('autoInstallPeers')
    if (autoInstallPeers !== undefined && typeof autoInstallPeers !== 'boolean') {
      throw new Error('pnpm-workspace.yaml autoInstallPeers must be boolean')
    }
    return document
  }

  /** Clone the complete comment-preserving workspace document. */
  override clone(): PnpmWorkspaceFile {
    return new PnpmWorkspaceFile(parseYaml(this.serialize()), this.originalText)
  }

  /** Add one package workspace glob. */
  addPackage(pattern: string): void {
    const packages = this.packageSequence()
    if (packages.items.some(item => item.value === pattern)) return
    packages.add(this.document.createNode(pattern))
  }

  /** Disable registry peer auto-installation for live-link projects. */
  disableAutoInstallPeers(): void {
    this.mapping().set('autoInstallPeers', false)
  }

  /** Validate workspace globs. */
  override validate(): void {
    for (const pattern of this.packageValues()) {
      if (pattern.trim().length === 0) throw new Error('pnpm workspace pattern must not be empty')
    }
  }

  /** Serialize the workspace while retaining unknown settings and comments. */
  override serialize(): string {
    return withTrailingNewline(this.document.toString({ lineWidth: 0 }))
  }

  private mapping(): YAMLMap {
    /* v8 ignore next -- parseYaml and create both establish a mapping root */
    if (!isMap(this.document.contents)) { throw new Error('pnpm-workspace.yaml root must be an object') }
    return this.document.contents
  }

  private packageSequence(): YAMLSeq<Scalar<string>> {
    const packages = this.mapping().get('packages', true)
    if (!isSeq(packages) || packages.items.some(item => !isScalar(item) || typeof item.value !== 'string')) {
      throw new Error('pnpm-workspace.yaml packages must be an array of strings')
    }
    return packages as YAMLSeq<Scalar<string>>
  }

  private packageValues(): string[] {
    return this.packageSequence().items.map(item => item.value)
  }
}
