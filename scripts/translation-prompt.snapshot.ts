/** Runnable keyless snapshot for the assembled translation request and consumed response. */

import { execFile } from 'node:child_process'
import { access, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const root = resolve(import.meta.dirname, '..')
const expected = join(root, 'scripts/snapshots/translation-prompt-v4/request-response.expected.json')
const refreshing = process.env.DSH_SNAPSHOT === 'record' || process.env.DSH_SNAPSHOT === 'refresh'

describe('translation prompt runnable snapshot', () => {
  it('assembles the reviewed examples and consumes a recorded new-pair response', async () => {
    const { stdout, stderr } = await execFileAsync(process.execPath, [
      // Node 24.0–24.2 still tags type stripping experimental; the warning
      // would pollute the stderr-is-empty assertion below.
      '--disable-warning=ExperimentalWarning',
      join(root, 'scripts/verify-translation-prompt.ts'),
      '--snapshot',
    ], { cwd: root, maxBuffer: 4 * 1024 * 1024 })
    expect(stderr).toBe('')
    expect(() => {
      JSON.parse(stdout)
    }).not.toThrow()
    if (!refreshing) {
      await access(expected)
    } else {
      await mkdir(dirname(expected), { recursive: true })
      await writeFile(expected, stdout)
    }
    await expect(stdout).toMatchFileSnapshot(expected)
  })
})
