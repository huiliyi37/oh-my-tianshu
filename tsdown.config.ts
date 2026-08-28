import { defineConfig } from 'tsdown'
import { typertPlugin } from './packages/typert/generator/lib/types/tsdown-plugin.js'

function isBuildFaceClient(value: unknown): boolean {
  if (value === undefined || value === 'host') return false
  if (value === 'client') return true
  throw new Error(`tsdown: --env.DSH_BUILD_FACE must be host or client, received ${String(value)}`)
}

/**
 * The ordinary workspace build consumes JavaScript emitted by the Host
 * TypeScript project and runs TypeRT. The Client pass selects packages that
 * declare a browser bundle and lets their package-local configs emit both
 * their Node loader entry and browser artifact.
 */
export default defineConfig(({ env }) => {
  const client = isBuildFaceClient(env?.DSH_BUILD_FACE)
  return {
    // tsdown's default workspace exclude includes `**/test?(s)/**`, which
    // drops the real package at `packages/tests/tool-run-tests`. Keep the
    // other defaults (`node_modules`, `dist`, temp dirs) and name the tests
    // group as a first-class include.
    workspace: {
      include: ['vendor/*', 'packages/*/*', 'apps/cli'],
      exclude: ['**/node_modules/**', '**/dist/**', '**/t?(e)mp/**'],
    },
    entry: client ? '' : ['lib/types/{index,invariant,model-selection-settings}.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    plugins: client ? [] : [typertPlugin({ mode: 'workspace', faces: ['host'] })],
  }
})
