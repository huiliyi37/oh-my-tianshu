import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    outputOptions: { codeSplitting: false },
    dts: false,
    clean: false,
    entry: ['lib/types/index.js'],
  },
])
