import { defineConfig } from 'tsdown'
import { ProjectBuild } from '@deepseek-ai/dsh-scripts/dev/tsdown-config'

export default defineConfig(ProjectBuild({
  entry: ['index.ts'],
  outDir: '.',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
}))
