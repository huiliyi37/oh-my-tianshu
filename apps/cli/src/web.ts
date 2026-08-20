/**
 * `tianshu web` — the browser-surface alias over the profile boot: `--profile web`
 * plus the Web flag family (`--host/--port/--dev/--workspace-root/
 * --trusted-host/--no-open`), each flag becoming a patch over the composed
 * profile tree. All web runtime glue (dist serving, prompt section, URL line,
 * browser handoff) lives in the `@huiliyi37/dsh-web-app` bundle; this
 * launcher only derives flag patches and the LAN-trust snapshot.
 * @module @huiliyi37/oh-my-tianshu/web
 */

import { networkInterfaces } from 'node:os'
import { fileURLToPath } from 'node:url'
import type { Context } from '@huiliyi37/cordis'
import type { PatchOptions } from '@huiliyi37/cordis-plugin-include'
import { addHarnessSourceSection } from '@huiliyi37/dsh-app-boot'
import type { EnvironmentSnapshot } from '@huiliyi37/dsh-environment'
import { runProfile, type ProfileRows } from './profile-boot.ts'

const SOURCE_ROOT = fileURLToPath(new URL('../../..', import.meta.url))

/** The webserver schema's all-interfaces bind literal: gates LAN-authority derivation. */
const ALL_INTERFACES_HOST = '0.0.0.0'

/**
 * Non-internal IPv4 interface addresses of this machine — the IP-literal
 * authorities an all-interfaces bind is reachable by on the LAN.
 * @returns the addresses in interface order (possibly empty).
 */
function lanIPv4Addresses(): string[] {
  return Object.values(networkInterfaces()).flat()
    .filter((iface): iface is NonNullable<typeof iface> => iface !== undefined && iface.family === 'IPv4' && !iface.internal)
    .map(iface => iface.address)
}

/**
 * One LAN-trust resolution for one invocation, sampled exactly once: the
 * machine's LAN IP literals when the effective bind is all-interfaces, and
 * the `trustedHosts` value built from them plus the explicit extras. The
 * single sample is deliberate — display must advertise only addresses the
 * fence was configured with, so the web-app row receives this same snapshot.
 * Derived entries are port-less IP literals: DNS rebinding needs an
 * attacker-controlled name, so an IP-literal Host is safe on any port, and
 * the bound port may be OS-assigned, unknowable pre-boot.
 * @param bindHost - the effective webserver bind host (CLI flag, else the composed row value).
 * @param extra - `--trusted-host` values, in argv order.
 * @returns the sampled LAN addresses and the connection row's `trustedHosts` value (each possibly empty).
 */
export function resolveLanTrust(
  bindHost: string | undefined,
  extra: readonly string[],
): { lanAddresses: string[]; trustedHosts: string[] } {
  const lanAddresses = bindHost !== ALL_INTERFACES_HOST ? [] : lanIPv4Addresses()
  return { lanAddresses, trustedHosts: [...lanAddresses, ...extra] }
}

/** The `tianshu web` flag family, already parsed by the argument adapter. */
export interface WebFlags {
  patches: string[]
  host?: string
  port?: number
  dev: boolean
  workspaceRoot?: string
  trustedHosts?: string[]
  /** Whether this invocation opens the default browser after startup. */
  open: boolean
}

/**
 * Derive the web alias's flag patches over an already-composed profile tree.
 * Patches replace a row's whole config, so each patched row's composed values
 * are re-read and merged under the overrides.
 * @param rows - the composed row index from {@link composeProfile}.
 * @param flags - the parsed flag family.
 * @returns the flag patch list, in application order.
 */
function deriveWebFlagPatches(
  rows: ProfileRows,
  flags: WebFlags,
): PatchOptions[] {
  const overrides = new Map<string, Record<string, unknown>>()
  const put = (entryId: string, key: string, value: unknown): void => {
    const bag = overrides.get(entryId) ?? {}
    bag[key] = value
    overrides.set(entryId, bag)
  }
  if (flags.host !== undefined) put('webserver', 'host', flags.host)
  if (flags.port !== undefined) put('webserver', 'port', flags.port)
  if (flags.workspaceRoot !== undefined) put('api-gateway', 'workspaceRoot', flags.workspaceRoot)
  const composedHost = (rows.get('webserver')?.config as { host?: string } | undefined)?.host
  const { lanAddresses, trustedHosts } = resolveLanTrust(flags.host ?? composedHost, flags.trustedHosts ?? [])
  if (trustedHosts.length > 0) {
    // Additive over the composed value: a cordis.patch.yml-configured fence
    // authority must survive the derived LAN literals and flag extras — a
    // silent drop of security-relevant fence configuration.
    const composedTrusted = (rows.get('connection')?.config as { trustedHosts?: string[] } | undefined)?.trustedHosts ?? []
    put('connection', 'trustedHosts', [...composedTrusted, ...trustedHosts])
  }
  // mode and lanAddresses are launcher-derived on every boot (--dev also
  // inserts the client-hmr row), never pass-throughs of composed values.
  put('web-runtime', 'mode', flags.dev ? 'development' : 'production')
  put('web-runtime', 'lanAddresses', lanAddresses)
  // --no-open is per-invocation: only an explicit opt-out patches the row, so
  // a composed `openBrowser: false` survives a default launch.
  if (!flags.open) put('web-runtime', 'openBrowser', false)
  const patches = [...overrides.entries()].map(([id, bag]): PatchOptions => {
    const composed = rows.get(id)
    if (composed === undefined) throw new Error(`dsh: patch target row "${id}" not found in the web profile composition`)
    return { id, config: { ...(composed.config ?? {}) as Record<string, unknown>, ...bag } }
  })
  if (flags.dev) patches.push({ insert: [{ id: 'client-hmr', name: '@huiliyi37/dsh-client-hmr' }] })
  return patches
}

/**
 * Whether the composed Web runtime keeps its model- and shell-visible surface
 * context. The bundle schema defaults the field to true, so only an explicit
 * false suppresses both the bundle contributions and the launcher-owned
 * source-checkout section.
 * @param rows - the composed Web profile rows before launcher flag patches.
 * @returns true unless the web-runtime row explicitly disables surface context.
 */
export function webSurfaceContextEnabled(rows: ProfileRows): boolean {
  return (rows.get('web-runtime')?.config as { surfaceContext?: boolean } | undefined)?.surfaceContext !== false
}

/**
 * Serve the browser UI from the web profile. Host/port/workspace-root flags
 * are passed through only when given (absent, the composed profile values
 * stand); `web-runtime.mode` and `lanAddresses` are launcher-derived on
 * every boot. The URL line and the default-browser handoff are announced by
 * the web-app bundle's runtime row after Loader settlement.
 * @param flags - the parsed `tianshu web` flag family.
 * @param environment - this run's frozen environment snapshot.
 */
export async function runWeb(flags: WebFlags, environment: EnvironmentSnapshot): Promise<void> {
  await runProfile({
    environment,
    profile: 'web',
    patchFiles: flags.patches,
    deriveFlagPatches: rows => deriveWebFlagPatches(rows, flags),
    prepare: (ctx: Context, rows: ProfileRows) => {
      if (!webSurfaceContextEnabled(rows)) return
      ctx.inject(['systemPrompt'], (promptCtx) => {
        addHarnessSourceSection(promptCtx, SOURCE_ROOT)
      })
    },
  })
}
