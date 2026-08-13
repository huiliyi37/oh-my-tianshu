import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runLoaderSmoke } from '@huiliyi37/dsh-loader-smoke'

const binScript = fileURLToPath(new URL('./fixtures/transcript-driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./fixtures/transcript-smoke.cordis.yml', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
const snapshotDir = fileURLToPath(new URL('../../../.rivet/scratch/', import.meta.url))
const snapshotPath = join(snapshotDir, 'tui-transcript.snapshot.json')
const hasKey = Boolean(process.env.DEEPSEEK_API_KEY)

interface TranscriptProjection {
  readonly type: 'transcript_projection'
  readonly sessionId: string
  readonly seq: number
  readonly turn: number
  readonly messages: readonly { kind: 'user' | 'assistant'; turn: number; step?: number; text: string }[]
  readonly tools: readonly { name: string; turn: number; step?: number; hasResult: boolean }[]
  readonly output: string
}

describe.skipIf(!hasKey)('examples/tui with real model', () => {
  it('runs a task and folds its session events into the keyless transcript projection', async () => {
    const { stdout } = await runLoaderSmoke({
      label: 'tui transcript smoke',
      tempDirPrefix: 'tui-transcript-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath, 'Reply with exactly: TUI_TRANSCRIPT_SMOKE_OK'],
      tsconfigPath,
      processTimeoutMs: 120_000,
    })
    const lines = stdout.trimEnd().split('\n').map(line => JSON.parse(line) as unknown)
    const record = lines.at(-1) as TranscriptProjection
    expect(record?.type).toBe('transcript_projection')
    expect(record.messages.length).toBeGreaterThanOrEqual(2)
    expect(record.messages.some(m => m.kind === 'user')).toBe(true)
    expect(record.messages.some(m => m.kind === 'assistant')).toBe(true)
    expect(record.seq).toBeGreaterThan(0)
    expect(record.output).toContain('TUI_TRANSCRIPT_SMOKE_OK')
    // Keyless: the serialized view must never carry the credential value.
    expect(stdout).not.toContain(process.env.DEEPSEEK_API_KEY)
    await mkdir(snapshotDir, { recursive: true })
    await writeFile(snapshotPath, `${JSON.stringify(record, null, 2)}\n`)
    const persisted = JSON.parse(await readFile(snapshotPath, 'utf8')) as TranscriptProjection
    expect(persisted.type).toBe('transcript_projection')
    expect(persisted.sessionId).toBe(record.sessionId)
  }, 135_000)
})
