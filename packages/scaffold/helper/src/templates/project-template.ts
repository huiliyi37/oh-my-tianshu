/**
 * Strict Handlebars wrapper and complete-file SDK project artifacts.
 *
 * @module @deepseek-ai/dsh-helper/templates/project-template
 */

import { PackageJsonFile } from '../documents/package-json-file.ts'
import { TextProjectFile } from '../documents/project-file.ts'
import type { PackageManagerName } from '../package-managers/package-manager.ts'
import { baselineNpmDependencies } from '../project/npm-dependency-policy.ts'
import type { ProjectProfile, RunInterface } from '../project/types.ts'
import { loadHelperTemplate } from './template-assets.ts'
import type { TextTemplate } from './text-template.ts'

/** Stable typed view consumed by all generated text artifacts. */
export interface ProjectTemplateContext {
  name: string
  description: string
  releaseVersion: string
  model: string
  modelLiteral: string
  isAcp: boolean
  isEmbed: boolean
  packageManager: PackageManagerName
  installArgs: string
  buildArgs: string
}

/** Complete project-file template artifact. */
export class TemplateArtifact<TModel extends object> extends TextProjectFile {
  /** Render and own one complete project file. */
  constructor(relativePath: string, template: TextTemplate<TModel>, model: TModel) {
    super(relativePath, template.render(model))
  }
}

const README_TEMPLATE = loadHelperTemplate<ProjectTemplateContext>('README.md.tpl')
const PACKAGE_JSON_TEMPLATE = loadHelperTemplate<{
  name: string
  description: string
  dependencies: string
  devDependencies: string
}>('package.json.tpl')
const INDEX_TEMPLATE = loadHelperTemplate<ProjectTemplateContext>('index.ts.tpl')
const TSDOWN_TEMPLATE = loadHelperTemplate<ProjectTemplateContext>('tsdown.config.ts.tpl')
const TSCONFIG_BASE_TEMPLATE = loadHelperTemplate<ProjectTemplateContext>('tsconfig.base.json.tpl')
const GITIGNORE_TEMPLATE = loadHelperTemplate<ProjectTemplateContext>('gitignore.tpl')
const YARNRC_TEMPLATE = loadHelperTemplate<ProjectTemplateContext>('yarnrc.yml.tpl')

/** Build the template model for one project and selected run interface. */
export function createProjectTemplateContext(
  profile: ProjectProfile,
  runInterface: RunInterface = profile.runInterface,
): ProjectTemplateContext {
  return {
    name: profile.name,
    description: profile.description,
    releaseVersion: profile.releaseVersion,
    model: profile.runtime.model,
    modelLiteral: JSON.stringify(profile.runtime.model),
    isAcp: runInterface === 'acp',
    isEmbed: runInterface === 'embed',
    packageManager: profile.packageManager.name,
    installArgs: profile.packageManager.installCommand().join(' '),
    buildArgs: profile.packageManager.buildCommand().join(' '),
  }
}

/** Render the complete root package defaults before structured contributions merge. */
export function createPackageJsonDoc(context: ProjectTemplateContext): PackageJsonFile {
  const npmDependencies = baselineNpmDependencies(context.releaseVersion)
  return PackageJsonFile.create(PACKAGE_JSON_TEMPLATE.render({
    name: JSON.stringify(context.name),
    description: JSON.stringify(context.description),
    dependencies: JSON.stringify(npmDependencies.dependencies),
    devDependencies: JSON.stringify(npmDependencies.devDependencies),
  }))
}

/** Build interface-independent one-shot project artifacts. */
export function createBaselineProjectArtifacts(
  context: ProjectTemplateContext,
): TemplateArtifact<ProjectTemplateContext>[] {
  return [
    new TemplateArtifact('tsdown.config.ts', TSDOWN_TEMPLATE, context),
    new TemplateArtifact('tsconfig.base.json', TSCONFIG_BASE_TEMPLATE, context),
    new TemplateArtifact('.gitignore', GITIGNORE_TEMPLATE, context),
    ...context.packageManager === 'yarn'
      ? [new TemplateArtifact('.yarnrc.yml', YARNRC_TEMPLATE, context)]
      : [],
  ]
}

/** Build files owned by the selected app feature option. */
export function createAppProjectArtifacts(
  context: ProjectTemplateContext,
): TemplateArtifact<ProjectTemplateContext>[] {
  return [
    new TemplateArtifact('README.md', README_TEMPLATE, context),
    new TemplateArtifact('index.ts', INDEX_TEMPLATE, context),
  ]
}

/** Build package scripts owned by the selected app feature option. */
export function createAppPackageScripts(): Readonly<Record<'dev' | 'start', string>> {
  return {
    dev: 'dsh-sdk dev index.ts',
    start: 'dsh-sdk start index.js',
  }
}
