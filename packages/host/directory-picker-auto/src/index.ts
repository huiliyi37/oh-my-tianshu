/**
 * Adaptive chooser of the directory-picker seam: resolves the host's
 * situation once at boot (bind host, SSH launch, display session, Linux
 * chooser binary) and mounts the matching dual-face backend — `-native` or
 * `-browse` — as a real Loader entry in the in-memory root tree. Because the
 * backend arrives as an ordinary entry, its browser half is discovered
 * exactly as a config-row's would be, so the seam's one-row-swaps-both-faces
 * invariant holds for the resolved choice; pinning an interaction remains
 * composing that backend row directly instead of this one.
 * @module @huiliyi37/dsh-host-directory-picker-auto
 */

import type { Context } from '@huiliyi37/cordis'
// Empty type imports carry the `loader` and `webServer` Context merges for the reads below.
import type {} from '@huiliyi37/cordis-plugin-loader'
import type {} from '@huiliyi37/dsh-host-webserver'
import { canExecute, hasLinuxChooserBinary } from './probe.ts'
import type { DirectoryPickerBackendKind } from './resolve.ts'
import { resolveDirectoryPickerBackend } from './resolve.ts'

export { canExecute, hasLinuxChooserBinary } from './probe.ts'
export type { DirectoryPickerBackendKind, DirectoryPickerEnv, DirectoryPickerHostFacts } from './resolve.ts'
export { resolveDirectoryPickerBackend } from './resolve.ts'

/** Cordis plugin name. */
export const name = 'directory-picker-auto'
/** Required services: the effective bind host (`webServer`) and the entry tree the backend mounts into (`loader`). */
export const inject = ['webServer', 'loader']

/**
 * Backend package per resolved kind — fixed composition vocabulary, not a
 * tunable. Exported because the reference is a runtime string the static
 * config gate cannot see in a yml row: `verify-cordis-config` requires every
 * app composing this chooser to declare both values as dependencies.
 */
export const BACKEND_PACKAGES: Record<DirectoryPickerBackendKind, string> = {
  native: '@huiliyi37/dsh-host-directory-picker-native',
  browse: '@huiliyi37/dsh-host-directory-picker-browse',
}

/**
 * Resolve the backend from one boot-time sample and mount it as a Loader
 * entry; the effect's disposer removes the entry and joins the backend
 * fiber's teardown, so unloading this plugin returns only after both faces
 * of the mounted backend (and their dependents) quiesced.
 * @param ctx - cordis context carrying the injected `webServer` and `loader`.
 */
export async function apply(ctx: Context): Promise<void> {
  const backend = resolveDirectoryPickerBackend({
    bindHost: ctx.webServer.host,
    platform: process.platform,
    env: process.env,
    linuxChooser: hasLinuxChooserBinary(process.env.PATH, canExecute),
  })
  await ctx.effect(async () => {
    // Root-tree create: the Loader root is in-memory (write() is a no-op), so
    // the mounted row can never be persisted back into a config file.
    const id = await ctx.loader.create({ name: BACKEND_PACKAGES[backend] })
    return async () => {
      // Tree teardown (group.stop) can have removed the entry already;
      // nothing is left to unmount or await then.
      const entry = ctx.loader.store[id]
      if (entry === undefined) { return }
      // remove() disposes the entry transactionally, so the chooser's unload
      // signals completion only after the backend quiesced.
      await ctx.loader.remove(id)
    }
  }, 'directory-picker-auto: backend entry')
}
