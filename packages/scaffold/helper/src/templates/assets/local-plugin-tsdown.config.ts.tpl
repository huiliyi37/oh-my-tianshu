import { defineConfig } from 'tsdown'
import { PluginBuild } from '@deepseek-ai/dsh-scripts/dev/tsdown-config'

export default defineConfig(PluginBuild({
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: true,
  clean: false,
}))
