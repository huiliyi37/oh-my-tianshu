/**
 * Permission preset plugin, browser half — a popupSelect DECORATION hung on
 * the host `/permission` command: one flat list of presets, current value
 * marked active, a pick executes the switch. The decoration owns only the
 * bare invocation; the host command keeps its catalog row, the argued path
 * (`/permission <preset>` still switches directly), and the lifecycle
 * logging. Options and the active mark read the session's `permissions`
 * projection (the same host-computed select the composer chip renders); a
 * pick submits the `/permission <preset>` command line, so both surfaces
 * write through one path and the pushed projection frame is the one
 * confirmation. The Full access row carries the same explicit risk gate as
 * the composer chip; the shared popup shell owns the modal mechanics.
 * The General-settings row separately writes the default preset for sessions
 * created later through the host Settings API.
 */
import type { ConnectionHandle } from '@huiliyi37/dsh-client-connection/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@huiliyi37/dsh-client-locale/client'
import type { ClientContext, SessionFace } from '@huiliyi37/dsh-client-runtime/client'
import type { CommandServiceContract, SelectOption } from '@huiliyi37/dsh-client-ui-command/client'
import type { ClientSessionContext } from '@huiliyi37/dsh-client-ui-slash/client'
import type { PermissionSelect } from '@huiliyi37/dsh-permission/client'
import { PermissionRow } from './PermissionRow.tsx'
import type { PermissionRowInjected } from './PermissionRow.tsx'
import {
  accessEn, accessZh, en, zh,
} from './locales.ts'
import {
  displayPermissionPreset, FULL_ACCESS_PRESET,
} from './presentation.ts'
import {
  PERMISSION_SETTINGS_NS, PermissionSettingsController, refreshPermissionIfLoaded,
} from './settings-store.ts'

export type { PermissionRowInjected, PermissionRowProps } from './PermissionRow.tsx'
export type {
  PermissionDefaultOption, PermissionSettingsState,
} from './settings-store.ts'

/** Required services (cordis fiber inject). */
export const inject = ['command', 'sessions', 'slots', 'locale', 'connection']

const ACCESS_NS = 'permission.access'

/** Read one session's current permissions projection value (undefined = capability absent). */
function selectOf(session: SessionFace | undefined): PermissionSelect | undefined {
  return session?.projections.faceOf('permissions').getSnapshot() as PermissionSelect | undefined
}

/** Flatten the projection select into popup rows; `custom` is display state, never a target. */
function optionsOf(value: PermissionSelect, t: (key: string) => string): SelectOption[] {
  return value.options
    .filter(option => option.value !== 'custom')
    .map(option => ({
      id: option.value,
      label: displayPermissionPreset(option.value, option.name, t),
      ...(option.description === undefined ? {} : { detail: option.description }),
      ...(option.value === value.currentValue ? { active: true } : {}),
      ...(option.value === FULL_ACCESS_PRESET
        ? {
          confirmation: {
            title: t('confirm.title'),
            description: t('confirm.description'),
            acknowledgeLabel: t('confirm.acknowledge'),
            cancelLabel: t('confirm.cancel'),
            confirmLabel: t('confirm.enable'),
          },
        }
        : {}),
    }))
}

/**
 * Client plugin body: register the /permission popup picker over the
 * permissions projection.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const command = ctx.get('command') as CommandServiceContract
  const sessions = ctx.sessions
  // This optional bundle and ui-conversation can load independently, so each
  // owns the same safety copy under its own locale namespace.
  /* jscpd:ignore-start */
  ctx.effect(() => {
    const disposers = [
      ctx.locale.register(ACCESS_NS, 'zh', {
        'preset.readOnly': accessZh['preset.readOnly'],
        'preset.workspaceWrite': accessZh['preset.workspaceWrite'],
        'preset.fullAccess': accessZh['preset.fullAccess'],
        'confirm.title': accessZh['confirm.title'],
        'confirm.description': accessZh['confirm.description'],
        'confirm.acknowledge': accessZh['confirm.acknowledge'],
        'confirm.cancel': accessZh['confirm.cancel'],
        'confirm.enable': accessZh['confirm.enable'],
      }),
      ctx.locale.register(ACCESS_NS, 'en', {
        'preset.readOnly': accessEn['preset.readOnly'],
        'preset.workspaceWrite': accessEn['preset.workspaceWrite'],
        'preset.fullAccess': accessEn['preset.fullAccess'],
        'confirm.title': accessEn['confirm.title'],
        'confirm.description': accessEn['confirm.description'],
        'confirm.acknowledge': accessEn['confirm.acknowledge'],
        'confirm.cancel': accessEn['confirm.cancel'],
        'confirm.enable': accessEn['confirm.enable'],
      }),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'ui-permission: Full access confirmation dictionaries')
  /* jscpd:ignore-end */
  const t = ctx.locale.bind(ACCESS_NS)
  const sessionFor = (session: ClientSessionContext): SessionFace | undefined =>
    sessions.binding(session.sessionId)?.session

  ctx.effect(() => ctx.locale.register('settings.permission', { zh, en }), 'ui-permission: settings row dictionaries')

  const connection = ctx.get('connection') as ConnectionHandle
  const controller = new PermissionSettingsController(connection.api)
  const load = (): Promise<void> => controller.load()
  const select = (preset: string): Promise<void> => controller.select(preset)
  const injected = (): PermissionRowInjected => ({
    hooks: { permission: controller.store },
    load,
    select,
  })

  ctx.effect(() => {
    const refresh = (ns?: string): void => {
      if (ns !== undefined && ns !== PERMISSION_SETTINGS_NS) return
      refreshPermissionIfLoaded(controller)
    }
    const disposers = [
      ctx.on('settings/changed', refresh),
      ctx.on('connection/reset', () => { refresh() }),
    ]
    return () => {
      controller.dispose()
      for (const dispose of disposers) dispose()
    }
  }, 'ui-permission: settings invalidations')

  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'permission',
    order: -20,
    locale: 'settings.permission',
    inject: injected,
  }, PermissionRow))

  ctx.effect(() => command.decorate({
    name: 'permission',
    // The picker exists exactly while the projection does: a permission-less
    // host serves no key and the bare invocation falls through to the host
    // command (which is absent too — the line simply misses).
    available: session => selectOf(sessionFor(session)) !== undefined,
    ui: {
      kind: 'popupSelect',
      options: (session) => {
        const value = selectOf(sessionFor(session))
        if (value === undefined) throw new Error('permission presets are not available on this host')
        return Promise.resolve(optionsOf(value, t))
      },
      onSelect: async (option, session) => {
        const live = sessionFor(session)
        if (live === undefined) throw new Error('this session is not materialized yet')
        const result = await live.command(`/permission ${option.id}`)
        if (!result.ok) throw new Error(`permission switch failed: ${result.error.code}: ${result.error.message}`)
        if (!result.value.matched) throw new Error('the host offers no /permission command')
      },
    },
  }), 'ui-permission: /permission decoration')
}
