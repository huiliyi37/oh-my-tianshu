import { defineConfig } from 'tsdown'

/** Bundle the library and create bin, then mirror package-owned terminal templates. */
export default defineConfig({
  entry: ['lib/types/index.js', 'lib/types/invariant.js', 'lib/types/bin.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  copy: [{ from: 'src/templates/assets/*', to: 'lib/assets' }],
})
