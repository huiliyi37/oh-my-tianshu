/**
 * Source blueprints for local Cordis plugins generated under `plugins/*`.
 *
 * @module @deepseek-ai/dsh-helper/plugins/local-plugin-blueprint
 */

import { TextProjectFile } from '../documents/project-file.ts'
import type { CordisConfigEntry } from '../documents/cordis-yaml-file.ts'
import { resolveNpmDependency } from '../project/npm-dependency-policy.ts'
import { loadHelperTemplate } from '../templates/template-assets.ts'

/** Supported generated local-plugin shapes. */
export type LocalPluginKind = 'plugin' | 'tool'

function kebab(value: string): string {
  const result = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  if (!result || !/^[a-z]/.test(result)) throw new Error(`invalid local plugin name: ${JSON.stringify(value)}`)
  return result
}

function packageName(projectName: string, pluginName: string): string {
  if (projectName.startsWith('@')) {
    const separator = projectName.indexOf('/')
    if (separator > 1 && separator < projectName.length - 1) {
      return `${projectName.slice(0, separator)}/${projectName.slice(separator + 1)}-${pluginName}`
    }
  }
  return `${projectName}-${pluginName}`
}

interface LocalPluginTemplateContext {
  pluginName: string
  toolName: string
  toolTitle: string
}

const PLUGIN_SOURCE = loadHelperTemplate<LocalPluginTemplateContext>('local-plugin.ts.tpl')
const TOOL_SOURCE = loadHelperTemplate<LocalPluginTemplateContext>('local-tool.ts.tpl')
const PLUGIN_TSDOWN = loadHelperTemplate<LocalPluginTemplateContext>('local-plugin-tsdown.config.ts.tpl')

/** One local plugin's derived package, source, build, and runtime entry. */
export class LocalPluginBlueprint {
  /** Normalized local package and Cordis config entry name. */
  readonly name: string
  /** Generated plugin source shape. */
  readonly kind: LocalPluginKind

  /** Normalize and validate one local plugin request. */
  constructor(name: string, kind: LocalPluginKind) {
    this.name = kebab(name)
    this.kind = kind
  }

  /** Root-relative plugin directory. */
  get directory(): string {
    return `plugins/${this.name}`
  }

  /**
   * Derive an npm package name from the root project identity.
   * @param projectName - generated root package name.
   * @returns local plugin package name.
   */
  packageName(projectName: string): string {
    return packageName(projectName, this.name)
  }

  /**
   * Build the runtime Cordis config entry for this local package.
   * @param projectName - generated root package name.
   * @returns Loader entry referencing the local package.
   */
  cordisConfigEntry(projectName: string): CordisConfigEntry {
    return { id: this.name, name: this.packageName(projectName) }
  }

  /**
   * Render the complete local package files.
   * @param projectName - generated root package name.
   * @param releaseVersion - SDK dependency version.
   * @returns local manifest, configs, and source documents.
   */
  documents(projectName: string, releaseVersion: string): TextProjectFile[] {
    const name = this.packageName(projectName)
    const toolName = this.name.replaceAll('-', '_')
    const cordisSpec = resolveNpmDependency('cordis', 'devDependencies', releaseVersion).spec
    const manifest = {
      name,
      version: '0.0.0',
      private: true,
      type: 'module',
      main: 'lib/index.js',
      types: 'lib/index.d.ts',
      exports: { '.': { types: './lib/index.d.ts', default: './lib/index.js' } },
      peerDependencies: {
        ...this.kind === 'tool' ? { '@deepseek-ai/dsh-tools': `^${releaseVersion}` } : {},
        cordis: cordisSpec,
      },
      devDependencies: {
        cordis: cordisSpec,
      },
    }
    const tsconfig = {
      extends: '../../tsconfig.base.json',
      compilerOptions: { rootDir: 'src', outDir: 'lib/types' },
      include: ['src'],
    }
    const context: LocalPluginTemplateContext = {
      pluginName: this.name,
      toolName,
      toolTitle: toolName.replaceAll('_', ' '),
    }
    return [
      new TextProjectFile(`${this.directory}/package.json`, JSON.stringify(manifest, null, 2)),
      new TextProjectFile(`${this.directory}/tsconfig.json`, JSON.stringify(tsconfig, null, 2)),
      new TextProjectFile(`${this.directory}/tsdown.config.ts`, PLUGIN_TSDOWN.render(context)),
      new TextProjectFile(
        `${this.directory}/src/index.ts`,
        (this.kind === 'tool' ? TOOL_SOURCE : PLUGIN_SOURCE).render(context),
      ),
    ]
  }
}
