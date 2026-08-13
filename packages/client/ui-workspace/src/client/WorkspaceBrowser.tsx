/**
 * The workspace/session browsing region filling the sidebar shell's
 * `sidebar.workspaces` hole: section header (title + group-by + add
 * workspace), search, the grouped tree or flat list, and the workspace
 * dialogs. Wide state renders the full browser; rail state renders the two
 * region icons (search / add workspace), each requesting shell expansion
 * through the owner share. Adding is the header button's one action, so it
 * raises the directory flow with no menu in between; the flow and its error
 * dialog live in WorkspacePicker (same package — direct composition, no slot
 * between them).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  Button, IconCloseFill14, IconPersonalizationOutline16,
  IconProjectAddOutline16, IconSearchOutline16, Menu, Modal, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  SessionSearchResultItem, WorkspaceId, WorkspaceView,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { WorkspaceBrowserProps } from './contract/slots.ts'
import type { SessionNode } from './tree.ts'
import { deriveFlat, deriveGroups, deriveSearchResults, UNGROUPED_KEY } from './tree.ts'
import { ProjectRowItem, SearchResultItem, SessionNodeItem } from './rows/Rows.tsx'
import { WorkspacePickFlow } from './WorkspacePicker.tsx'
import css from './WorkspaceBrowser.module.css'

/**
 * Column slide length (--ds-transition-duration-slow): rail-search focus waits it out —
 * focus() forces a synchronous layout and would jank the slide.
 */
const EXPAND_SLIDE_MS = 300
/** Pause between the latest keystroke and a Host content-search request. */
const SEARCH_DEBOUNCE_MS = 250
/** `session.search` wire bound, measured in JavaScript UTF-16 code units. */
const SEARCH_QUERY_MAX_CODE_UNITS = 500

/** Keep controlled input and RPC payload inside the session.search wire contract. */
function sanitizeSearchQuery(value: string): string {
  const withoutNul = value.replaceAll('\0', '')
  if (withoutNul.length <= SEARCH_QUERY_MAX_CODE_UNITS) return withoutNul
  let end = SEARCH_QUERY_MAX_CODE_UNITS
  const last = withoutNul.charCodeAt(end - 1)
  const next = withoutNul.charCodeAt(end)
  if (last >= 0xD800 && last <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF) end--
  return withoutNul.slice(0, end)
}

/** Immutable membership toggle for the local expansion arrays. */
function toggled(list: readonly string[], key: string): string[] {
  return list.includes(key) ? list.filter(k => k !== key) : [...list, key]
}

/** Group-by strategy menu; own open state so it resets with the wide chrome. */
function GroupByMenu({ groupBy, onPick, t }: {
  groupBy: 'workspace' | 'flat'
  onPick: (mode: 'workspace' | 'flat') => void
  t: WorkspaceBrowserProps['t']
}) {
  const [open, setOpen] = useState(false)
  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      items={[
        { type: 'label' as const, id: 'group-by', text: t('groupBy.label') },
        { id: 'workspace', label: t('groupBy.workspace') },
        { id: 'flat', label: t('groupBy.flat') },
      ]}
      selectedId={groupBy}
      onSelect={(id) => {
        /* v8 ignore next -- narrowing guard: the heading label is not selectable, so the only arriving ids are the two modes. */
        if (id === 'workspace' || id === 'flat') onPick(id)
        setOpen(false)
      }}
      align="end"
      // Portal: the section header clips overflow, so an in-place list would
      // be cut off at the header's bounds.
      portal
      anchor={(
        <Tooltip label={t('groupBy.label')} side="bottom" delayMs={500}>
          <button
            type="button"
            className={clsx(css.iconButton, css.wide)}
            aria-label={t('groupBy.label')}
            onClick={() => { setOpen(v => !v) }}
          >
            <IconPersonalizationOutline16 />
          </button>
        </Tooltip>
      )}
    />
  )
}

/** In-flight root-row drag: source identity plus the current insert marker. */
interface DragState {
  workspaceId: WorkspaceId
  sessionId: SessionNode['id']
  /** Row the marker sits on and which half (insert above/below it). */
  over: { id: SessionNode['id']; half: 'before' | 'after' } | null
}

type SessionTreeProps = Pick<
  WorkspaceBrowserProps,
  'useSessions' | 'startSession' | 'open' | 'forkSession' | 'insertSessionBefore' | 't'
> & {
  workspaces: readonly WorkspaceView[]
  /** Registry-global archive set (hidden rows). */
  archivedSessionIds: readonly SessionNode['id'][]
  /** Open the browser-owned rename dialog for a real Workspace group. */
  onRenameRequest: (workspaceId: WorkspaceId, currentTitle: string) => void
  /** Open the browser-owned delete-confirmation dialog for a real Workspace group. */
  onDeleteRequest: (workspaceId: WorkspaceId, currentTitle: string) => void
  /** Open the browser-owned session rename dialog. */
  onSessionRename: (sessionId: SessionNode['id'], currentTitle: string) => void
  /** Archive a session (row menu action; the row disappears on the state echo). */
  onSessionArchive: (sessionId: SessionNode['id']) => void
}

/** The scrolling session tree; unmounting at collapse settle drops the sessions subscription and expansion state. */
function SessionTree({
  useSessions, startSession, open, forkSession, workspaces, archivedSessionIds,
  onRenameRequest, onDeleteRequest, onSessionRename, onSessionArchive, insertSessionBefore, t,
}: SessionTreeProps) {
  const list = useSessions(s => s)
  const current = list.current
  const [expandedProjects, setExpandedProjects] = useState<string[]>([])
  // Transient drag viewing state (never store-bound; order truth stays Host-side).
  const [drag, setDrag] = useState<DragState | null>(null)
  const currentGroup = current === undefined
    ? undefined
    : (workspaces.find(w => w.sessionIds.includes(current))?.workspaceId as string | undefined)
      ?? UNGROUPED_KEY
  useEffect(() => {
    if (current === undefined || currentGroup === undefined) return
    setExpandedProjects(l => (l.includes(currentGroup) ? l : [...l, currentGroup]))
  }, [current, currentGroup])
  const groups = useMemo(
    () => deriveGroups(list, workspaces, archivedSessionIds, { expandedProjects }),
    [list, workspaces, archivedSessionIds, expandedProjects],
  )
  const now = Date.now()

  return (
    <div className={clsx(css.treeBody, css.wide)}>
      <div className={css.list} role="tree" aria-label={t('section.sessions')}>
        {groups.length === 0 && (
          <div className={css.empty}>{t('empty.none')}</div>
        )}
        {groups.map(group => (
          // Group section: header row + expanded top-level session rows. The
          // inter-group breathing room (former flat-list batch separator)
          // is the section's own margin (WorkspaceBrowser.module.css).
          <div key={group.key} className={css.groupSection}>
            <ProjectRowItem
              group={group}
              t={t}
              onToggle={() => { setExpandedProjects(l => toggled(l, group.key)) }}
              onCreate={() => {
                if (group.workspaceId !== undefined) startSession(group.workspaceId)
              }}
              actions={group.workspaceId === undefined
                ? undefined
                : {
                  rename: () => {
                    /* v8 ignore next -- narrowing guard: the actions object exists only for real-workspace groups. */
                    if (group.workspaceId !== undefined) onRenameRequest(group.workspaceId, group.label)
                  },
                  delete: () => {
                    /* v8 ignore next -- narrowing guard: the actions object exists only for real-workspace groups. */
                    if (group.workspaceId !== undefined) onDeleteRequest(group.workspaceId, group.label)
                  },
                }}
            />
            {group.sessions.map((node, index) => {
              // Draggable: real-workspace session rows. The drag
              // never leaves its group — rows of other groups show no markers
              // and reject drops (visual movement confined to this section).
              const draggable = group.workspaceId !== undefined
              const sameGroupDrag = drag !== null && drag.workspaceId === group.workspaceId
              const dragProps = !draggable || group.workspaceId === undefined ? undefined : {
                start: () => {
                  setDrag({ workspaceId: group.workspaceId as WorkspaceId, sessionId: node.id, over: null })
                },
                active: sameGroupDrag,
                marker: sameGroupDrag && drag.over?.id === node.id ? drag.over.half : null,
                hover: (half: 'before' | 'after') => {
                  /* v8 ignore next -- narrowing guard: Rows gates hover on `active`, which is false while the drag state is null. */
                  setDrag(d => (d === null ? d : { ...d, over: { id: node.id, half } }))
                },
                drop: (half: 'before' | 'after') => {
                  /* v8 ignore next -- narrowing guard: Rows gates drop on `active`, which is false while the drag state is null. */
                  if (drag === null) return
                  const sessions = group.sessions
                  // Anchor = the row the insert line points at ('after' means
                  // the next root; end-of-list omits the anchor → append).
                  const anchor = half === 'before' ? node.id : sessions[index + 1]?.id
                  setDrag(null)
                  if (anchor === drag.sessionId) return
                  // No-op when the drop lands back on the source position.
                  const sourceIndex = sessions.findIndex(r => r.id === drag.sessionId)
                  const anchorIndex = anchor === undefined ? sessions.length : sessions.findIndex(r => r.id === anchor)
                  if (sourceIndex !== -1 && (anchorIndex === sourceIndex || anchorIndex === sourceIndex + 1)) return
                  insertSessionBefore(drag.workspaceId, drag.sessionId, anchor).catch((reason: unknown) => {
                    console.warn('session reorder rejected:', reason)
                  })
                },
                end: () => { setDrag(null) },
              }
              return (
                <SessionNodeItem
                  key={node.id}
                  node={node}
                  currentId={current}
                  now={now}
                  onOpen={open}
                  onRename={onSessionRename}
                  onFork={forkSession}
                  onArchive={onSessionArchive}
                  drag={dragProps}
                  t={t}
                />
              )
            })}
          </div>
        ))}
      </div>
      <span className={css.fade} />
    </div>
  )
}

/** The flat "In one list" body: every session a top-level row, newest-first. */
function FlatList({ useSessions, open, forkSession, onSessionRename, onSessionArchive, archivedSessionIds, t }: Pick<
  SessionTreeProps, 'useSessions' | 'open' | 'forkSession' | 'onSessionRename' | 'onSessionArchive' | 'archivedSessionIds' | 't'
>) {
  const list = useSessions(s => s)
  const rows = useMemo(() => deriveFlat(list, archivedSessionIds), [list, archivedSessionIds])
  const now = Date.now()
  return (
    <div className={clsx(css.treeBody, css.wide)}>
      <div className={clsx(css.list, css.flatList)} role="tree" aria-label={t('section.sessions')}>
        {rows.length === 0 && (
          <div className={css.empty}>{t('empty.none')}</div>
        )}
        {rows.map(node => (
          <SessionNodeItem
            key={node.id}
            node={node}
            currentId={list.current}
            now={now}
            onOpen={open}
            onRename={onSessionRename}
            onFork={forkSession}
            onArchive={onSessionArchive}
            t={t}
          />
        ))}
      </div>
      <span className={css.fade} />
    </div>
  )
}

interface RemoteSearchState {
  query: string
  status: 'idle' | 'loading' | 'ready' | 'error'
  items: readonly SessionSearchResultItem[]
  hasMore: boolean
}

/** Flat search body: local metadata matches plus the current Host result page. */
function SearchResults({
  useSessions,
  open,
  workspaces,
  archivedSessionIds,
  query,
  remote,
  resultLimit,
  t,
}: Pick<SessionTreeProps, 'useSessions' | 'open' | 't'> & {
  workspaces: readonly WorkspaceView[]
  archivedSessionIds: readonly SessionNode['id'][]
  query: string
  remote: RemoteSearchState
  resultLimit: number
}) {
  const list = useSessions(s => s)
  const currentRemote = remote.query === query
    ? remote
    : { query, status: 'loading' as const, items: [], hasMore: false }
  const results = useMemo(
    () => deriveSearchResults(list, workspaces, query, archivedSessionIds, currentRemote, resultLimit),
    [list, workspaces, query, archivedSessionIds, currentRemote, resultLimit],
  )
  const pending = currentRemote.status === 'loading'
  const failed = currentRemote.status === 'error'

  return (
    <div className={clsx(css.treeBody, css.wide)}>
      <div className={css.list}>
        <div className={css.searchTree} role="tree" aria-label={t('search.results.aria')}>
          {results.items.map(result => (
            <SearchResultItem
              key={result.id}
              result={result}
              currentId={list.current}
              onOpen={open}
              t={t}
            />
          ))}
        </div>
        {pending && (
          <div className={css.searchStatus} role="status">{t('search.pending')}</div>
        )}
        {failed && (
          <div className={css.searchWarning} role="status">
            {t('search.unavailable')}
          </div>
        )}
        {!pending && results.items.length === 0 && (
          <div className={css.empty}>{t('search.noMatches')}</div>
        )}
        {results.hasMore && (
          <div className={css.searchStatus}>
            {t('search.hasMore', { n: resultLimit })}
          </div>
        )}
      </div>
      <span className={css.fade} />
    </div>
  )
}

/**
 * Render the browsing region.
 * @param props - composed slot props (shell owner share + store + injected actions).
 * @returns the region element tree.
 */
export function WorkspaceBrowser({
  wide,
  expandSidebar,
  useSessions,
  useWorkspaces,
  useStore,
  actions,
  startSession,
  open,
  renameSession,
  forkSession,
  renameWorkspace,
  deleteWorkspace,
  archiveSession,
  insertSessionBefore,
  createWorkspace,
  searchSessions,
  searchResultLimit,
  useDirectoryFlow,
  renderSlot,
  t,
}: WorkspaceBrowserProps) {
  const workspaces = useWorkspaces(state => state.items)
  const archivedSessionIds = useWorkspaces(state => state.archivedSessionIds)
  // Live occupancy of this surface's directory-flow hole (the same source the
  // flow reads): a composition without a picking affordance can add nothing.
  const directoryFlowAvailable = useDirectoryFlow(occupied => occupied)
  const groupBy = useStore(s => s.groupBy)
  // The query outlives the tree and the input (both wide-only) so collapsing
  // does not silently drop an in-progress filter.
  const [query, setQuery] = useState('')
  const normalizedQuery = sanitizeSearchQuery(query).trim()
  const [remoteSearch, setRemoteSearch] = useState<RemoteSearchState>({
    query: '',
    status: 'idle',
    items: [],
    hasMore: false,
  })
  const searchInput = useRef<HTMLInputElement | null>(null)
  // Section-header ＋ opens the picker menu (same popover in wide and rail
  // states; the menu anchors on this button).
  const [wsPickerOpen, setWsPickerOpen] = useState(false)
  const wsPlusRef = useRef<HTMLButtonElement>(null)
  const composingRef = useRef(false)

  // Rail search = expand + land in the search box: the flag arms before the
  // expand request; once the shell flips wide the input mounts and takes focus.
  const [searchOnExpand, setSearchOnExpand] = useState(false)
  useEffect(() => {
    if (wide && searchOnExpand) {
      const timer = window.setTimeout(() => {
        searchInput.current?.focus({ preventScroll: true })
        setSearchOnExpand(false)
      }, EXPAND_SLIDE_MS)
      return () => { window.clearTimeout(timer) }
    }
  }, [wide, searchOnExpand])

  useEffect(() => {
    if (normalizedQuery === '') {
      setRemoteSearch({ query: '', status: 'idle', items: [], hasMore: false })
      return
    }
    const controller = new AbortController()
    setRemoteSearch({
      query: normalizedQuery,
      status: 'loading',
      items: [],
      hasMore: false,
    })
    const timer = window.setTimeout(() => {
      searchSessions(normalizedQuery, controller.signal).then((result) => {
        if (controller.signal.aborted) return
        setRemoteSearch({
          query: normalizedQuery,
          status: 'ready',
          items: result.items,
          hasMore: result.hasMore,
        })
      }).catch(() => {
        if (controller.signal.aborted) return
        setRemoteSearch({
          query: normalizedQuery,
          status: 'error',
          items: [],
          hasMore: false,
        })
      })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [normalizedQuery, searchSessions])

  // Rename dialog (browser-owned so it outlives row unmounts during collapse).
  const [renameTarget, setRenameTarget] = useState<{ workspaceId: WorkspaceId; currentTitle: string } | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)
  const renameTrimmed = renameDraft.trim()
  const renameDuplicate = renameTarget !== null && renameTrimmed !== '' && renameTrimmed !== renameTarget.currentTitle
    && workspaces.some(w => w.title === renameTrimmed)
  const renameBlocked = renaming || renameTrimmed === ''
    || renameTarget === null || renameTrimmed === renameTarget.currentTitle || renameDuplicate
  const closeRename = () => {
    if (renaming) return
    setRenameTarget(null)
    setRenameError(null)
  }
  const confirmRename = () => {
    if (renameBlocked) return
    setRenaming(true)
    setRenameError(null)
    renameWorkspace(renameTarget.workspaceId, renameTrimmed).then(() => {
      setRenaming(false)
      setRenameTarget(null)
    }).catch((reason: unknown) => {
      setRenaming(false)
      setRenameError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  // Session rename dialog (same browser-owned pattern as workspace rename;
  // sessions have no client-side name-conflict rule — the host normalizes).
  // Unlike workspace rename, an unchanged title is NOT blocked: confirming
  // the current automatic title is the gesture that pins it.
  const [sessionRenameTarget, setSessionRenameTarget] = useState<{ sessionId: SessionNode['id']; currentTitle: string } | null>(null)
  const [sessionRenameDraft, setSessionRenameDraft] = useState('')
  const [sessionRenaming, setSessionRenaming] = useState(false)
  const [sessionRenameError, setSessionRenameError] = useState<string | null>(null)
  const sessionRenameTrimmed = sessionRenameDraft.trim()
  const sessionRenameBlocked = sessionRenaming || sessionRenameTrimmed === '' || sessionRenameTarget === null
  const closeSessionRename = () => {
    if (sessionRenaming) return
    setSessionRenameTarget(null)
    setSessionRenameError(null)
  }
  const confirmSessionRename = () => {
    if (sessionRenameBlocked) return
    setSessionRenaming(true)
    setSessionRenameError(null)
    renameSession(sessionRenameTarget.sessionId, sessionRenameTrimmed).then(() => {
      setSessionRenaming(false)
      setSessionRenameTarget(null)
    }).catch((reason: unknown) => {
      setSessionRenaming(false)
      setSessionRenameError(reason instanceof Error ? reason.message : String(reason))
    })
  }
  const onSessionRename = (sessionId: SessionNode['id'], currentTitle: string) => {
    setSessionRenameTarget({ sessionId, currentTitle })
    setSessionRenameDraft(currentTitle)
    setSessionRenameError(null)
  }

  // Archive is dialog-free: not destructive (the log and the accounting slot
  // remain), so the menu action commits directly; the row disappears when the
  // archive-set echo lands. Failures are non-fatal console diagnostics, the
  // same posture as reorder rejections.
  const onSessionArchive = (sessionId: SessionNode['id']) => {
    archiveSession(sessionId).catch((reason: unknown) => {
      console.warn('session archive rejected:', reason)
    })
  }

  // Delete dialog is separate from the row so a successful removal can
  // unmount that row without tearing down the in-flight confirmation state.
  const [deleteTarget, setDeleteTarget] = useState<{ workspaceId: WorkspaceId; title: string } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteCommittedId, setDeleteCommittedId] = useState<WorkspaceId | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  useEffect(() => {
    if (deleteCommittedId === null
      || workspaces.some(workspace => workspace.workspaceId === deleteCommittedId)) return
    setDeleting(false)
    setDeleteCommittedId(null)
    setDeleteTarget(null)
  }, [deleteCommittedId, workspaces])
  const closeDelete = () => {
    if (deleting) return
    setDeleteTarget(null)
    setDeleteError(null)
  }
  const confirmDelete = () => {
    /* v8 ignore next -- the Modal is absent without a target and its button is disabled while deleting. */
    if (deleting || deleteTarget === null) return
    setDeleting(true)
    setDeleteCommittedId(null)
    setDeleteError(null)
    deleteWorkspace(deleteTarget.workspaceId).then(() => {
      // Keep the confirmation pending until this component has rendered the
      // committed list projection without the deleted id. Closing earlier
      // exposes one stale React frame to the next Create Workspace gesture.
      setDeleteCommittedId(deleteTarget.workspaceId)
    }).catch((reason: unknown) => {
      setDeleting(false)
      setDeleteError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  return (
    <div className={clsx(css.root, !wide && css.rail)}>
      <div className={css.sectionHeader}>
        {wide && (
          <span className={clsx(css.sectionLabel, css.wide)}>
            {groupBy === 'flat' ? t('section.sessions') : t('section.workspaces')}
          </span>
        )}
        {wide && <GroupByMenu groupBy={groupBy} onPick={(mode) => { actions.setGroupBy(mode) }} t={t} />}
        {/* Adding is the button's one action, so a composition with no
            picking affordance has nothing to offer here: the region hides the
            button rather than leaving a dead one in the header. */}
        {directoryFlowAvailable && (
          <Tooltip label={t('workspace.add')} side="bottom" delayMs={500}>
            <button
              ref={wsPlusRef}
              type="button"
              className={css.iconButton}
              aria-label={t('workspace.add')}
              onClick={() => {
                setWsPickerOpen(v => !v)
              }}
            >
              <IconProjectAddOutline16 size={wide ? 16 : 18} />
            </button>
          </Tooltip>
        )}
        {/* Add flow + its error dialog (same package — direct composition). */}
        <WorkspacePickFlow
          t={t}
          open={wsPickerOpen}
          anchorRef={wsPlusRef}
          useWorkspaces={useWorkspaces}
          createWorkspace={createWorkspace}
          useDirectoryFlow={useDirectoryFlow}
          renderDirectoryFlow={owner => renderSlot('sidebar.workspaces.directoryFlow', owner)}
          addOnly
          side="right"
          onPick={(workspaceId) => {
            setWsPickerOpen(false)
            startSession(workspaceId)
          }}
          onClose={() => { setWsPickerOpen(false) }}
        />
      </div>

      {/* Expanded: the row is a click-to-focus field (the leading icon is
          decorative). Rail: the icon is the region's search control. */}
      <div className={css.search} onClick={() => { if (wide) searchInput.current?.focus() }}>
        <Tooltip label={t('search')} disabled={wide}>
          <button
            type="button"
            className={css.searchButton}
            aria-label={t('search.sessions.aria')}
            tabIndex={wide ? -1 : 0}
            onClick={() => { if (!wide) { setSearchOnExpand(true); expandSidebar() } }}
          >
            <IconSearchOutline16 size={wide ? 14 : 18} />
          </button>
        </Tooltip>
        {wide && (
          <input
            ref={searchInput}
            className={clsx(css.searchInput, css.wide)}
            type="text"
            placeholder={t('search.placeholder')}
            maxLength={SEARCH_QUERY_MAX_CODE_UNITS}
            value={query}
            onChange={(e) => { setQuery(sanitizeSearchQuery(e.target.value)) }}
          />
        )}
        {wide && query !== '' && (
          <button
            type="button"
            className={clsx(css.clearButton, css.wide)}
            aria-label={t('search.clear')}
            onClick={() => { setQuery('') }}
          >
            <IconCloseFill14 />
          </button>
        )}
      </div>

      {/* Always-mounted seat keeps the region's flex slot while the list
          itself is wide-only. */}
      <div className={css.listArea}>
        {wide && (normalizedQuery !== ''
          ? (
            <SearchResults
              useSessions={useSessions}
              open={open}
              workspaces={workspaces}
              archivedSessionIds={archivedSessionIds}
              query={normalizedQuery}
              remote={remoteSearch}
              resultLimit={searchResultLimit}
              t={t}
            />
          )
          : groupBy === 'flat'
            ? (
              <FlatList
                useSessions={useSessions} open={open} forkSession={forkSession}
                onSessionRename={onSessionRename} onSessionArchive={onSessionArchive}
                archivedSessionIds={archivedSessionIds} t={t}
              />
            )
            : (
              <SessionTree
                useSessions={useSessions}
                onSessionRename={onSessionRename}
                onSessionArchive={onSessionArchive}
                forkSession={forkSession}
                workspaces={workspaces}
                archivedSessionIds={archivedSessionIds}
                startSession={startSession}
                open={open}
                insertSessionBefore={insertSessionBefore}
                t={t}
                onRenameRequest={(workspaceId, currentTitle) => {
                  setRenameTarget({ workspaceId, currentTitle })
                  setRenameDraft(currentTitle)
                  setRenameError(null)
                }}
                onDeleteRequest={(workspaceId, title) => {
                  setDeleteTarget({ workspaceId, title })
                  setDeleteError(null)
                }}
              />
            ))}
      </div>

      <Modal
        open={renameTarget !== null}
        onClose={closeRename}
        closeLabel={t('close')}
        title={t('rename.workspace.title')}
        footer={(
          <>
            <Button variant="outline" disabled={renaming} onClick={closeRename}>{t('cancel')}</Button>
            <Button variant="primary" disabled={renameBlocked} onClick={confirmRename}>{t('rename')}</Button>
          </>
        )}
      >
        <input
          className={css.renameInput}
          value={renameDraft}
          aria-label={t('field.workspaceName')}
          autoFocus
          disabled={renaming}
          onFocus={(e) => { e.target.select() }}
          onChange={(e) => { setRenameDraft(e.target.value); setRenameError(null) }}
          onCompositionStart={() => { composingRef.current = true }}
          onCompositionEnd={() => { composingRef.current = false }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !composingRef.current) {
              e.preventDefault()
              confirmRename()
            }
          }}
        />
        {renameDuplicate && (
          <div className={css.renameError} role="alert">{t('conflict.named', { name: renameTrimmed })}</div>
        )}
        {renameError !== null && <div className={css.renameError} role="alert">{renameError}</div>}
      </Modal>

      <Modal
        open={sessionRenameTarget !== null}
        onClose={closeSessionRename}
        closeLabel={t('close')}
        title={t('rename.session.title')}
        footer={(
          <>
            <Button variant="outline" disabled={sessionRenaming} onClick={closeSessionRename}>{t('cancel')}</Button>
            <Button variant="primary" disabled={sessionRenameBlocked} onClick={confirmSessionRename}>{t('rename')}</Button>
          </>
        )}
      >
        <input
          className={css.renameInput}
          value={sessionRenameDraft}
          aria-label={t('field.sessionName')}
          autoFocus
          disabled={sessionRenaming}
          onFocus={(e) => { e.target.select() }}
          onChange={(e) => { setSessionRenameDraft(e.target.value); setSessionRenameError(null) }}
          onCompositionStart={() => { composingRef.current = true }}
          onCompositionEnd={() => { composingRef.current = false }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !composingRef.current) {
              e.preventDefault()
              confirmSessionRename()
            }
          }}
        />
        {sessionRenameError !== null && <div className={css.renameError} role="alert">{sessionRenameError}</div>}
      </Modal>
      <Modal
        open={deleteTarget !== null}
        onClose={closeDelete}
        closeLabel={t('close')}
        title={t('delete.workspace')}
        {...deleteTarget === null
          ? {}
          : { description: t('delete.desc', { name: deleteTarget.title }) }}
        footer={(
          <>
            <Button variant="outline" disabled={deleting} onClick={closeDelete}>{t('cancel')}</Button>
            <Button
              variant="outline"
              className={css.deleteAction}
              disabled={deleting}
              onClick={confirmDelete}
            >
              {t('delete.workspace')}
            </Button>
          </>
        )}
      >
        {deleting && <div className={css.deleteStatus} role="status">{t('delete.pending')}</div>}
        {deleteError !== null && <div className={css.renameError} role="alert">{deleteError}</div>}
      </Modal>
    </div>
  )
}
