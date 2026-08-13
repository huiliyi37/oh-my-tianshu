import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const createBin = join(repoRoot, 'packages/scaffold/create-sdk/lib/bin.js')
const scriptsBin = join(repoRoot, 'packages/scaffold/scripts/lib/bin.js')

describe.skipIf(!existsSync(createBin) || !existsSync(scriptsBin))(
  'SDK built artifacts',
  () => {
    it('runs the published dsh-sdk bin help path under plain Node', async () => {
      const result = await execFileAsync(process.execPath, [scriptsBin, '--help'], { encoding: 'utf8' })
      expect(result.stdout).toContain('Usage: dsh-sdk <command>')
      expect(result.stderr).toBe('')
    })

    it('runs the published create-sdk bin help path under plain Node', async () => {
      const result = await execFileAsync(process.execPath, [createBin, '--help'], { encoding: 'utf8' })
      expect(result.stdout).toContain('Usage: create-sdk [directory]')
      expect(result.stderr).toBe('')
    })
  },
)
