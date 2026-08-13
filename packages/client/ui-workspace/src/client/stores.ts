/**
 * The workspace browser's viewing store: the session-list grouping mode,
 * persisted across reloads. Module level exports the factory only (a
 * module-level handle would pin the store identity across plugin reloads);
 * register() receives the factory and the browser derives its PropsStore
 * share from the return type.
 */
import { defineStore, type EngineStoreHandle } from '@huiliyi37/dsh-client-runtime/client'

/** Session-list grouping mode: workspace sections or one flat recency list. */
export type WorkspaceGroupBy = 'workspace' | 'flat'

/** Workspace browser viewing state (grouping mode only; transient UI facts stay component-local). */
type WorkspaceViewState = { groupBy: WorkspaceGroupBy }

/**
 * Annotation twin of the actions literal below (the export needs a declared
 * return type); drift fails assignability at the defineStore call.
 */
type WorkspaceViewActions = {
  setGroupBy: (draft: WorkspaceViewState, mode: WorkspaceGroupBy) => void
}

/**
 * Create the workspace browser viewing store handle.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createWorkspaceViewStore(): EngineStoreHandle<WorkspaceViewState, WorkspaceViewActions> {
  return defineStore({
    init: (): WorkspaceViewState => ({ groupBy: 'workspace' }),
    persist: 'dsh.workspace.view',
    actions: {
      setGroupBy: (d, mode: WorkspaceGroupBy) => { d.groupBy = mode },
    },
  })
}
