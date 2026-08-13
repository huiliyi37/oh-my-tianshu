/**
 * Shared domain and infrastructure for DeepSeek Harness SDK project tooling.
 *
 * FIXME: rename to `@deepseek-ai/dsh-sdk-helper` before the first tagged release —
 * the current name is indefensibly generic as a published name
 * ([regrouping Agent Note](../../../../.agents/notes/implemented/architecture/2026-07-29-package-regrouping.md)).
 *
 * @module @deepseek-ai/dsh-helper
 */

export { featureId } from './ids.ts'
export { TextTemplate } from './templates/text-template.ts'
export type {
  FeatureSelection,
  ProjectCreationRequest,
  ProjectProfile,
  RunInterface,
} from './project/types.ts'
export type { ChangeSet, ProjectCommitResult } from './project/change-set.ts'
export { SdkProject } from './project/sdk-project.ts'
export {
  NodeCommandRunner,
  NpmPackageManager,
  createPackageManager,
  inferPackageManagerName,
  probePackageManagerVersion,
} from './package-managers/package-manager.ts'
export type {
  CommandRunner,
  PackageManager,
  PackageManagerName,
  PackageManagerVersionProbe,
} from './package-managers/package-manager.ts'
export { LocalPluginBlueprint } from './plugins/local-plugin-blueprint.ts'
export type { LocalPluginKind } from './plugins/local-plugin-blueprint.ts'
export type { Feature, FeatureInstallation } from './features/feature.ts'
export type { FeatureRegistry } from './features/registry.ts'
export { FeatureConfigurator } from './features/feature-configurator.ts'
export { createBuiltinRegistry } from './features/builtin/index.ts'
export { PromptCancelledError, requireAnswer } from './questions/prompt-port.ts'
export type { NestedMultiSelectValue, PromptPort } from './questions/prompt-port.ts'
export {
  ConfirmQuestion,
  SecretQuestion,
  SelectQuestion,
  TextQuestion,
} from './questions/question.ts'
export type { Question } from './questions/question.ts'
export { ClackPromptPort } from './questions/clack-prompt-port.ts'
export { HeadlessPromptError, HeadlessPromptPort } from './questions/headless-prompt-port.ts'
