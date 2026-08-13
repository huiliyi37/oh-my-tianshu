/** Publication payload policy shared by static manifests and packed tarballs. */

/** Publication exceptions required for TypeRT declaration-map navigation. */
export interface PublicationPayloadPolicy {
  readonly typeRTRemoteNavigation?: boolean
}

/** Whether a package manifest exports generated Host-for-Client metadata with source navigation. */
export function hasTypeRTRemoteNavigation(manifest: unknown): boolean {
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) return false
  const exportsField = (manifest as Record<string, unknown>).exports
  if (exportsField === null || typeof exportsField !== 'object' || Array.isArray(exportsField)) return false
  const remote = (exportsField as Record<string, unknown>)['./remote']
  if (remote === null || typeof remote !== 'object' || Array.isArray(remote)) return false
  const entry = remote as Record<string, unknown>
  return entry.types === './lib/typert.remote-client.d.ts'
    && entry.default === './lib/typert.remote-client.js'
}

/** Normalize a package manifest path or npm tarball member to its payload-relative path. */
function payloadPath(file: string): string {
  const normalized = file.replaceAll('\\', '/').replace(/^\.\/+/, '').replace(/\/+$/, '')
  return normalized.startsWith('package/') ? normalized.slice('package/'.length) : normalized
}

/** Whether a package payload path exposes source or declaration-map intermediates. */
export function isForbiddenPublicationFile(
  file: string,
  policy: PublicationPayloadPolicy = {},
): boolean {
  const normalized = payloadPath(file)
  if (policy.typeRTRemoteNavigation === true
    && (normalized === 'src'
      || normalized.startsWith('src/')
      || normalized === 'lib/typert.remote-client.d.ts.map')) {
    return false
  }
  return normalized === 'src'
    || normalized.startsWith('src/')
    || normalized.endsWith('.d.ts.map')
}

/** Reject source and declaration-map members in a packed npm tarball. */
export function validateTarballPayload(
  files: readonly string[],
  context: string,
  policy: PublicationPayloadPolicy = {},
): void {
  for (const file of files) {
    if (!isForbiddenPublicationFile(file, policy)) continue
    const normalized = payloadPath(file)
    if (normalized === 'src' || normalized.startsWith('src/')) {
      throw new Error(`${context} publishes source file ${file}`)
    }
    throw new Error(`${context} publishes declaration map ${file}`)
  }
}
