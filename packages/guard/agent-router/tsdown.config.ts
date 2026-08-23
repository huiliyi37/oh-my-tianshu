import { defineConfig } from 'tsdown'

/**
 * Build the package root and invariant companion as independent bundles.
 *
 * `finding.ts` is shared runtime (and public re-export) of both entries; a
 * shared build would emit it as a hashed chunk, which the packaging `files`
 * whitelist (`lib/index.js`, `lib/invariant.js`, d.ts) does not carry and the
 * compiled-companion contract requires standalone.
 */
export default defineConfig([
  {
    entry: ['lib/types/index.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
  {
    entry: ['lib/types/invariant.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
])
