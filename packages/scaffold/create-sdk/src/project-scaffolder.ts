/**
 * Project creation use case over the shared SDK aggregate and edit session.
 *
 * @module @deepseek-ai/create-sdk/project-scaffolder
 */

import { stat } from 'node:fs/promises'
import {
  SdkProject,
  createBuiltinRegistry,
  type ChangeSet,
  type ProjectCreationRequest,
} from '@deepseek-ai/dsh-helper'

/** Result of writing one new SDK project. */
export interface ScaffoldResult {
  project: SdkProject
  changes: ChangeSet
}

/** Create a project entirely in memory, then validate and commit it once. */
export async function scaffoldProject(root: string, request: ProjectCreationRequest): Promise<ScaffoldResult> {
  let targetExists = true
  try {
    await stat(root)
  } catch (error) {
    /* v8 ignore else -- the other arm requires a filesystem permission/IO fault from stat */
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') targetExists = false
    /* v8 ignore next -- paired with the ignored defensive stat-error arm above */
    else throw error
  }
  if (targetExists) throw new Error(`target already exists: ${root}`)
  const project = SdkProject.create(root, request)
  const registry = createBuiltinRegistry(project.profile)
  const edit = project.edit(registry)
  for (const selection of request.features) {
    edit.installFeature(registry.get(selection.id), selection)
  }
  for (const plugin of request.localPlugins) edit.addPlugin(plugin)
  return edit.commit()
}
