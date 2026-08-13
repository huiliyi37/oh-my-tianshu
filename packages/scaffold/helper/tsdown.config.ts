import { defineConfig } from 'tsdown'

/** Bundle helper runtime and mirror template assets beside the bundle. */
export default defineConfig({
  entry: ['lib/types/index.js', 'lib/types/invariant.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  copy: [{ from: 'src/templates/assets/*', to: 'lib/assets' }],
})
