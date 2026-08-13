import { clientBundle } from '../../client/tsdown.client.ts'

// The Win32 dialog worker builds as its own CJS entry (mirroring
// dsh-workflow-workerthread's worker): path-loaded by the driver, inlining
// the dialog logic while koffi stays an external native require.
export default clientBundle(
  '@deepseek-ai/dsh-host-directory-picker-native',
  ['lib/types/index.js', 'lib/types/invariant.js'],
  {
    companions: [{
      // The artifact is lib/worker.cjs (the ./worker export the workspace
      // constraint keys on), bundled from the descriptive source entry.
      entry: { worker: 'lib/types/win32-dialog-worker.js' },
      outDir: 'lib',
      format: ['cjs'],
      platform: 'node',
      target: 'es2024',
      fixedExtension: false,
      dts: false,
      clean: false,
    }],
  },
)
