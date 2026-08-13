import { defineConfig } from 'tsdown'

/** Bundle each public or runtime entry and mirror package-owned terminal templates. */
export default defineConfig([
  {
    entry: ['lib/types/index.js'], outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
    fixedExtension: false, outputOptions: { codeSplitting: false }, dts: false, clean: false,
    copy: [{ from: 'src/templates/assets/*', to: 'lib/assets' }],
  },
  {
    entry: ['lib/types/invariant.js'], outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
    fixedExtension: false, outputOptions: { codeSplitting: false }, dts: false, clean: false,
  },
  {
    entry: ['lib/types/bin.js'], outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
    fixedExtension: false, outputOptions: { codeSplitting: false }, dts: false, clean: false,
  },
  {
    entry: ['lib/types/dev/tsdown-config.js'], outDir: 'lib/dev', format: ['esm'], platform: 'node',
    target: 'es2024', fixedExtension: false, outputOptions: { codeSplitting: false }, dts: false, clean: false,
  },
  {
    entry: ['lib/types/local-plugin-loader-hooks.js'], outDir: 'lib', format: ['esm'], platform: 'node',
    target: 'es2024', fixedExtension: false, outputOptions: { codeSplitting: false }, dts: false, clean: false,
  },
])
