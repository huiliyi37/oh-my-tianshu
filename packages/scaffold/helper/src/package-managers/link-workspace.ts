/**
 * Repository package discovery and NPM dependency-closure rewriting for live links.
 *
 * @module @huiliyi37/dsh-helper/package-managers/link-workspace
 */

import { readFile, readdir } from 'node:fs/promises'
import { existsSync, realpathSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import type { PackageJsonFile, PackageManifest } from '../documents/package-json-file.ts'
import { PnpmWorkspaceFile } from '../documents/pnpm-workspace-file.ts'
import type { ProjectFile } from '../documents/project-file.ts'
import type { PackageManager } from './package-manager.ts'

interface WorkspacePackage {
  directory: string
  manifest: PackageManifest
}

function posixPath(path: string): string {
  return path.split(sep).join('/')
}

function canonicalPath(path: string): string {
  let existing = resolve(path)
  const suffix: string[] = []
  while (!existsSync(existing)) {
    const parent = dirname(existing)
    /* v8 ignore next -- every absolute path reaches the existing filesystem root */
    if (parent === existing) { throw new Error(`cannot resolve an existing ancestor for ${path}`) }
    suffix.unshift(basename(existing))
    existing = parent
  }
  return resolve(realpathSync(existing), ...suffix)
}

async function packageDirectories(root: string): Promise<string[]> {
  const result: string[] = []
  for (const vendor of await readdir(join(root, 'vendor'), { withFileTypes: true })) {
    if (vendor.isDirectory()) result.push(join(root, 'vendor', vendor.name))
  }
  for (const group of await readdir(join(root, 'packages'), { withFileTypes: true })) {
    if (!group.isDirectory()) continue
    for (const pkg of await readdir(join(root, 'packages', group.name), { withFileTypes: true })) {
      if (pkg.isDirectory()) result.push(join(root, 'packages', group.name, pkg.name))
    }
  }
  return result
}

/** Index of repository packages used by `--link-workspace`. */
export class LinkWorkspace {
  readonly root: string
  private readonly packages: Map<string, WorkspacePackage>

  private constructor(root: string, packages: Map<string, WorkspacePackage>) {
    this.root = root
    this.packages = packages
  }

  /** Scan vendor and package workspaces from a repository root. */
  static async open(root: string): Promise<LinkWorkspace> {
    const absolute = resolve(root)
    const packages = new Map<string, WorkspacePackage>()
    for (const directory of await packageDirectories(absolute)) {
      let manifest: PackageManifest
      try {
        manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as PackageManifest
      } catch (error) {
        throw new Error(`cannot read linked package at ${directory}: ${String(error)}`)
      }
      if (!manifest.name || typeof manifest.name !== 'string') continue
      if (packages.has(manifest.name)) throw new Error(`duplicate linked package name: ${manifest.name}`)
      packages.set(manifest.name, { directory, manifest })
    }
    if (!packages.has('cordis') || !packages.has('@huiliyi37/dsh-scripts')) {
      throw new Error(`not a DeepSeek Harness repository root: ${absolute}`)
    }
    return new LinkWorkspace(absolute, packages)
  }

  /** Expand direct NPM dependencies through all repository-local NPM dependency edges. */
  closure(names: Iterable<string>): string[] {
    const pending = [...names]
    const result = new Set<string>()
    while (pending.length > 0) {
      const name = pending.pop()
      if (!name || result.has(name)) continue
      const pkg = this.packages.get(name)
      /* v8 ignore next -- closure() only returns names present in this package map */
      if (!pkg) continue
      result.add(name)
      const edges = {
        ...pkg.manifest.dependencies,
        ...pkg.manifest.peerDependencies as Record<string, string> | undefined,
      }
      for (const dependencyName of Object.keys(edges)) {
        if (this.packages.has(dependencyName) && !result.has(dependencyName)) pending.push(dependencyName)
      }
    }
    return [...result].sort()
  }

  /** Rewrite the full local closure to manager-specific live-link specs. */
  apply(
    projectRoot: string,
    manifest: PackageJsonFile,
    manager: PackageManager,
    documents: readonly ProjectFile[],
  ): void {
    const canonicalProjectRoot = canonicalPath(projectRoot)
    const names = this.closure(manifest.npmDependencyNames())
    for (const name of names) {
      const pkg = this.packages.get(name)
      /* v8 ignore next -- closure() only returns names present in this package map */
      if (!pkg) continue
      const relativePath = posixPath(relative(canonicalProjectRoot, realpathSync(pkg.directory)))
      const spec = manager.linkSpec(relativePath)
      const current = manifest.npmDependency(name)
      manifest.setNpmDependency(current?.section ?? 'dependencies', name, spec)
      if (manager.name === 'yarn') manifest.setResolution(name, spec)
    }
    if (manager.name === 'pnpm') {
      const workspace = documents.find((item): item is PnpmWorkspaceFile => item instanceof PnpmWorkspaceFile)
      if (!workspace) throw new Error('pnpm link mode requires pnpm-workspace.yaml')
      workspace.disableAutoInstallPeers()
    }
  }

  /** Resolve a package directory for diagnostics and tests. */
  packageDirectory(name: string): string | undefined {
    const directory = this.packages.get(name)?.directory
    return directory
      ? resolve(dirname(directory), directory.split(sep).at(-1) as string)
      : undefined
  }
}
