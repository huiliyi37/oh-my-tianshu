/**
 * Shared profile boot for every `dsh` surface: resolve the profile, stack its
 * patch layers (bundle layers in `dsh.profile.bundles` order, the profile's own
 * `cordis.patch.yml`, `--patch` overlays, flag-derived patches, the telemetry
 * switch), mount the tree over the profile's empty root config, keep the
 * profile patch layer live, and wire fail-loud plus bounded shutdown.
 * @module @huiliyi37/oh-my-tianshu/profile-boot
 */

import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@huiliyi37/cordis'
import type { PatchOptions } from '@huiliyi37/cordis-plugin-include'
import {
  boot,
  composeEntries,
  healProfilesModuleFallback,
  installFailLoud,
  loadOptionalPatches,
  loadOverlayPatches,
  loadProfile,
  PROFILE_PATCH_FILENAME,
  watchUserPatches,
  type Profile,
} from '@huiliyi37/dsh-app-boot'
import { resolveDshHome } from '@huiliyi37/dsh-paths'
import { DSH_ENVIRONMENT_KEY, type EnvironmentSnapshot } from '@huiliyi37/dsh-environment'
import type { HeadlessIo } from '@huiliyi37/dsh-headless'
import { createProcessShutdown, type ProcessShutdown } from './process-shutdown.ts'

const NAME = 'dsh'

/**
 * The home-level user patch layer (`$DSH_HOME/cordis.patch.yml`), applied
 * over every profile's own layer. Resolved per call, not at module load:
 * `$DSH_HOME` may be set by the test or launcher after import.
 * @returns the absolute patch-file path.
 */
export function homePatchPath(): string {
  return join(resolveDshHome(), PROFILE_PATCH_FILENAME)
}

/** Absolute path of this dsh installation's package.json (both anchors: src/ and lib/ sit one level under apps/cli). */
export const INSTALL_ANCHOR = fileURLToPath(new URL('../package.json', import.meta.url))

/** The session-telemetry row id the DSH_TELEMETRY_DISABLED switch targets. */
const TELEMETRY_ROW_ID = 'telemetry-otel'

/** The one-shot runner row a `tianshu run` task requires and configures. */
const HEADLESS_ROW_ID = 'headless-runner'

/** The empty root entry list every profile tree patches over. */
const PROFILE_ROOT_CONFIG = `# dsh profile root — an empty entry list. The tree is composed as patches:
# each bundle in package.json's dsh.profile.bundles, then cordis.patch.yml, then any
# --patch overlays. Edit cordis.patch.yml, not this file.
[]
`

/** Root config filename inside a profile directory. */
export const PROFILE_ROOT_FILENAME = 'cordis.yml'

/**
 * Resolve the telemetry opt-out switch into its boot patch. ANY non-empty
 * value (including `'0'`/`'false'`) disables: a privacy switch prefers
 * off-by-mistake over on-by-mistake. A composition without the telemetry row
 * exports nothing, so the switch is then trivially satisfied and no patch is
 * generated — custom profiles need not mount telemetry to run with the
 * switch set.
 * @param disabledEnv - the raw `DSH_TELEMETRY_DISABLED` value (`undefined` when unset).
 * @param hasRow - whether the composition carries the telemetry row.
 * @returns the disable patch, or `undefined` when telemetry stays enabled or is not mounted.
 */
export function resolveTelemetryPatch(disabledEnv: string | undefined, hasRow: boolean): PatchOptions | undefined {
  if ((disabledEnv ?? '') === '' || !hasRow) return undefined
  return { id: TELEMETRY_ROW_ID, disabled: true }
}

/**
 * Load a resolved profile for `name`: heal the shared module fallback, then
 * (re)write the empty root config. The root is always rewritten: the whole
 * composition is patch layers, and the vendored Loader's tree write-back (a
 * plugin self-disposing persists the current tree) can bake composed rows
 * into this file — which would duplicate every bundle insert on the next
 * boot. The file exists on disk only because the Loader needs a real include
 * root to anchor `baseUrl` at the profile directory (the config dump anchors
 * on the same file, so both compose over the identical base).
 * @param name - the profile name.
 * @param userLayer - `false` skips parsing `cordis.patch.yml` (the default dump).
 * @returns the loaded profile.
 */
export function prepareProfile(name: string, userLayer = true): Profile {
  healProfilesModuleFallback(INSTALL_ANCHOR)
  const profile = loadProfile(NAME, name, INSTALL_ANCHOR, undefined, { userLayer })
  writeFileSync(join(profile.dir, PROFILE_ROOT_FILENAME), PROFILE_ROOT_CONFIG)
  return profile
}

/** Read-only row index of a profile composition before launcher flag patches. */
export type ProfileRows = ReadonlyMap<string, { name?: string; config?: unknown }>

/** One profile's patch layers (application order) and the row index of its pre-flag composition. */
interface ComposedProfile {
  profile: Profile
  /** Bundle layers concatenated — the part below the user layers on a live reload. */
  bundlePatches: PatchOptions[]
  /** The home-level user layer (`$DSH_HOME/cordis.patch.yml`), applied after the profile's own. */
  homePatches: PatchOptions[]
  /** Layers above the user layers on a live reload: --patch overlays, flag patches, the telemetry switch. */
  overlayAndFlags: PatchOptions[]
  /**
   * id → row of the pre-flag composition (bundles + user layers + overlays),
   * for flag merges and row checks. Flag patches must not insert rows the
   * launcher consults here (they only override values and insert dev glue).
   */
  rows: ProfileRows
}

/** The full patch stack of one composed profile, in application order. */
function allPatches(composed: ComposedProfile): PatchOptions[] {
  return [...composed.bundlePatches, ...composed.profile.patches, ...composed.homePatches, ...composed.overlayAndFlags]
}

/**
 * Load `name` and compose its effective patch stack: bundle layers in
 * `dsh.profile.bundles` order, the profile's user layer, the home-level user layer
 * (`$DSH_HOME/cordis.patch.yml` — machine-local preferences that apply to
 * every profile, so it outranks the per-profile layer), `--patch` overlays,
 * then flag patches derived from the composed rows, then the telemetry
 * switch.
 * @param name - the profile name.
 * @param patchFiles - `--patch` overlay paths, in argv order.
 * @param deriveFlagPatches - launcher hook turning composed rows into flag patches.
 * @returns the profile, its patch layers, and the composed row index.
 */
function composeProfile(
  name: string,
  patchFiles: readonly string[],
  deriveFlagPatches: (rows: ComposedProfile['rows']) => PatchOptions[] = () => [],
): ComposedProfile {
  const profile = prepareProfile(name)
  const homePatches = loadOptionalPatches(NAME, homePatchPath()) ?? []
  const overlays = patchFiles.flatMap(file => loadOverlayPatches(NAME, resolve(file)))
  const bundlePatches = profile.layers.flatMap(layer => layer.patches)
  const rows = new Map<string, { name?: string; config?: unknown }>()
  for (const row of composeEntries([bundlePatches, profile.patches, homePatches, overlays])) {
    if (typeof row.id === 'string') rows.set(row.id, row)
  }
  const overlayAndFlags = [...overlays, ...deriveFlagPatches(rows)]
  const telemetryPatch = resolveTelemetryPatch(process.env.DSH_TELEMETRY_DISABLED, rows.has(TELEMETRY_ROW_ID))
  if (telemetryPatch !== undefined) overlayAndFlags.push(telemetryPatch)
  return { profile, bundlePatches, homePatches, overlayAndFlags, rows }
}

/** Options for {@link runProfile}. */
export interface RunProfileOptions {
  /** The profile name to boot. */
  profile: string
  /** `--patch` overlay paths, in argv order. */
  patchFiles: readonly string[]
  /** Launcher hook turning the pre-flag composed rows into flag patches (the web alias's flag family). */
  deriveFlagPatches?: (rows: ProfileRows) => PatchOptions[]
  /** `tianshu run` task text; requires the composition to mount the headless runner row. */
  task?: string
  /** Inner launcher arguments forwarded to the booted app (tui --help/--version/positional prompt). */
  innerArgs?: string[]
  /** Surface setup registered after Loader installation and before any config-tree entry mounts. */
  prepare?: (ctx: Context, rows: ProfileRows) => Promise<void> | void
  /** This run's frozen environment snapshot, provided to the tree before any entry mounts. */
  environment: EnvironmentSnapshot
}

/**
 * Boot one profile invocation end to end and leave process lifetime to the
 * mounted plugins (or to the one-shot runner when `task` is present).
 * @param options - profile name, overlays, flag patches, and the optional task.
 * @returns the settled root context and the shutdown controller.
 */
export async function runProfile(options: RunProfileOptions): Promise<{ ctx: Context; shutdown: ProcessShutdown }> {
  const composed = composeProfile(options.profile, options.patchFiles, options.deriveFlagPatches)
  if (options.task !== undefined) {
    if (!composed.rows.has(HEADLESS_ROW_ID)) {
      throw new Error(
        `dsh: profile ${JSON.stringify(options.profile)} takes no task — its composition mounts no "${HEADLESS_ROW_ID}" row `
        + '(the headless profile does)',
      )
    }
    composed.overlayAndFlags.push({ id: HEADLESS_ROW_ID, config: { task: options.task } })
  } else if (composed.rows.has(HEADLESS_ROW_ID)) {
    // The inverse misuse: a one-shot composition booted without its task
    // would otherwise die in the runner row's schema with a raw "required"
    // error naming no fix.
    throw new Error(
      `dsh: profile ${JSON.stringify(options.profile)} mounts the one-shot runner and needs a task: `
      + `tianshu run --profile ${options.profile} "<task>"`,
    )
  }

  const app: { current?: Context } = {}
  const shutdown = createProcessShutdown(async () => { await app.current?.fiber.dispose() })
  // Signals own teardown throughout the startup window, not only after boot()
  // settles: an inserted front door can publish readiness before sibling rows
  // finish mounting.
  process.on('SIGTERM', () => { shutdown.interrupt(options.task !== undefined ? 143 : 0) })
  process.on('SIGINT', () => { shutdown.interrupt(130) })
  installFailLoud(NAME, process, async () => {
    await app.current?.fiber.dispose()
  })

  const rootConfig = join(composed.profile.dir, PROFILE_ROOT_FILENAME)
  // Recomposition for the live user layers: bundle layers below, overlays
  // and flag patches above, so a user edit can never displace them. BOTH
  // user files are re-read per generation (the HMR watcher hands us only the
  // changed file's patches, which one of the reads duplicates — fresh reads
  // keep the two watchers from stitching in each other's stale copy).
  // Fresh clones per generation: the include pushes `insert` rows into the
  // mounted tree BY REFERENCE and later id-targeted patches mutate those
  // objects in place. Reusing one parsed patch object across applications
  // would bake a user override into the bundle's in-memory insert row, so
  // removing the override could never revert the row to the bundle default.
  const composeLive = (): PatchOptions[] => structuredClone([
    ...composed.bundlePatches,
    ...loadOptionalPatches(NAME, composed.profile.patchPath) ?? [],
    ...loadOptionalPatches(NAME, homePatchPath()) ?? [],
    ...composed.overlayAndFlags,
  ])
  // One-shot runs exit through the runner; watching would only hold the
  // process open after its exit request.
  const watchProfilePatch = options.task === undefined
  // Cloned for the same insert-aliasing reason as composeLive: the boot
  // application must not mutate the objects later reloads recompose from.
  const ctx = await boot(NAME, rootConfig, structuredClone(allPatches(composed)), async (hostCtx) => {
    app.current = hostCtx
    // Before any config-tree entry mounts, so a plugin that resolves a
    // user-facing value at construction already sees this run's layers.
    hostCtx.provide(DSH_ENVIRONMENT_KEY, options.environment)
    // Forward launcher inner args to the tree: the TUI consumes them via
    // ctx.reflect.get('cmdlineArgs') (--help/--version/initial prompt; port of dsh-tianshu-tui#21).
    if (options.innerArgs !== undefined) {
      hostCtx.reflect.set('cmdlineArgs', { get: () => options.innerArgs })
    }
    if (options.task !== undefined) {
      const io: HeadlessIo = {
        stdout: process.stdout,
        stderr: process.stderr,
        exit: (code) => { void shutdown.shutdown(code) },
      }
      hostCtx.provide('headlessIo', io)
    }
    await options.prepare?.(hostCtx, composed.rows)
  })
  app.current = ctx
  // A surface can dispose the whole tree while startup was still in flight
  // (early SIGTERM); the Loader service goes with it and there is nothing to
  // keep live.
  if (watchProfilePatch && ctx.get('loader') !== undefined) {
    // Config-only HMR for the live profile patch layer: the web bundle
    // disables the shared module-reload `hmr` row (its reload lifecycle is
    // untested), so when the composition leaves no HMR service, mount a
    // watch-only instance with no module roots — cordis.patch.yml edits stay
    // live on every long-lived surface. A silent skip would break the
    // documented hot-reload contract. HMR injects the timer service, which a
    // bare custom profile may not mount either.
    if (ctx.get('hmr') === undefined) {
      if (ctx.get('timer') === undefined) {
        await ctx.loader.create({ name: '@huiliyi37/cordis-plugin-timer' })
      }
      await ctx.loader.create({ name: '@huiliyi37/cordis-plugin-hmr', config: { root: [] } })
    }
    await watchUserPatches(ctx, {
      binName: NAME,
      filename: composed.profile.patchPath,
      compose: composeLive,
    })
    await watchUserPatches(ctx, {
      binName: NAME,
      filename: homePatchPath(),
      compose: composeLive,
    })
  }
  return { ctx, shutdown }
}
