/**
 * Role-models settings row (P2④ final tail): the Web mirror of the TUI's
 * `/model vision|secondary|subagent` picker, as a General-section row. One
 * expandable row: the header summarizes the three pins; expanded, each role
 * gets a Menu over the global catalog plus a follow-default (clear) entry.
 */

import { useEffect, useState } from 'react'
import type { SnapshotStore } from '@huiliyi37/dsh-client-runtime/client'
import { Menu, type MenuEntry } from '@huiliyi37/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@huiliyi37/dsh-client-ui-slots'
import type { InjectFace } from '@huiliyi37/dsh-client-ui-slots'
import type { ModelRole } from '@huiliyi37/dsh-model-roles'
import { MODEL_ROLES, type RolePin, type RolePinsState } from './role-pins.ts'
import css from './RoleModelsRow.module.css'

/** Registration-side business face for the host-backed role pins. */
export interface RoleModelsRowInjected {
  hooks: {
    /** Role-pins snapshot bound by the renderer as useRolePins. */
    rolePins: SnapshotStore<RolePinsState>
  }
  /** Load the pins + global catalog when the row first renders. */
  load: () => Promise<void>
  /** Pin one role, or clear it back to follow-default. */
  selectRole: (role: ModelRole, selection: RolePin | undefined) => Promise<void>
}

/** Full component props. */
export type RoleModelsRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'model'>
  & InjectFace<RoleModelsRowInjected>

/** Label one pin for the summary/current display (catalog display name, raw id fallback). */
function pinLabel(pin: RolePin | undefined, state: RolePinsState, fallback: string): string {
  if (pin === undefined) return fallback
  for (const group of state.catalog.groups) {
    for (const model of group.models) {
      if (model.id === pin.model) return model.name
    }
  }
  return pin.model
}

/** Role display label key. */
function roleLabelKey(role: ModelRole): 'rolePins.vision' | 'rolePins.secondary' | 'rolePins.subagent' {
  switch (role) {
    case 'vision': return 'rolePins.vision'
    case 'secondary': return 'rolePins.secondary'
    case 'subagent': return 'rolePins.subagent'
  }
}

/**
 * Render the expandable role-models row.
 * @param props - composed slot props.
 * @returns the row, or null when the host does not expose the model-roles namespace.
 */
export function RoleModelsRow({ load, selectRole, useRolePins, t }: RoleModelsRowProps) {
  const state = useRolePins(snapshot => snapshot)
  const [expanded, setExpanded] = useState(false)
  const [openRole, setOpenRole] = useState<ModelRole | null>(null)

  useEffect(() => {
    void load()
  }, [load])

  if (state.status === 'unavailable') return null
  const busy = state.status === 'loading' || state.status === 'saving'

  const summary = MODEL_ROLES.map(role =>
    `${t(roleLabelKey(role))}: ${pinLabel(state.pins[role], state, t('rolePins.followDefault'))}`,
  ).join(' · ')

  return (
    <div className={css.root}>
      <button
        type="button"
        className={css.header}
        aria-expanded={expanded}
        onClick={() => { setExpanded(!expanded) }}
      >
        <span className={css.title}>{t('rolePins.title')}</span>
        <span className={css.summary}>{state.status === 'ready' ? summary : ''}</span>
        <span className={css.chevron} aria-hidden="true">{expanded ? '▾' : '▸'}</span>
      </button>
      {state.status === 'error' && <div className={css.error}>{state.error}</div>}
      {expanded && state.status === 'ready' && (
        <div className={css.roles}>
          {MODEL_ROLES.map((role) => {
            const pin = state.pins[role]
            const items: MenuEntry[] = [
              { id: 'follow-default', label: t('rolePins.followDefault') },
              ...state.catalog.groups.flatMap((group): MenuEntry[] => [
                { type: 'label', id: `label/${group.id}`, text: group.name },
                ...group.models.map(model => ({
                  id: `${group.id}/${model.id}`,
                  label: model.name,
                })),
              ]),
            ]
            return (
              <div className={css.roleRow} key={role}>
                <span className={css.roleLabel}>{t(roleLabelKey(role))}</span>
                <Menu
                  open={openRole === role}
                  items={items}
                  selectedId={pin === undefined ? 'follow-default' : `${pin.provider}/${pin.model}`}
                  onClose={() => { setOpenRole(null) }}
                  onSelect={(id) => {
                    setOpenRole(null)
                    if (id === 'follow-default') {
                      void selectRole(role, undefined)
                      return
                    }
                    const slash = id.indexOf('/')
                    const provider = id.slice(0, slash)
                    const model = id.slice(slash + 1)
                    void selectRole(role, { provider, model })
                  }}
                  align="end"
                  portal
                  anchor={(
                    <button
                      type="button"
                      className={css.selector}
                      aria-haspopup="menu"
                      aria-expanded={openRole === role}
                      disabled={busy || !state.writable}
                      onClick={() => { setOpenRole(openRole === role ? null : role) }}
                    >
                      <span className={css.selectorValue}>{pinLabel(pin, state, t('rolePins.followDefault'))}</span>
                    </button>
                  )}
                />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
