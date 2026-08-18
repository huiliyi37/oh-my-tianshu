/**
 * Assembled-app regression for the intent-bridge first-message handoff: the
 * alignment session (seeded zen-completed, restricted to finalize_alignment)
 * finalizes into a task card, the bridge creates a fresh main session and
 * feeds it the card, and the main session arms the zen phase — the card is in
 * the persisted log with the verbatim original, the handoff is recorded, and
 * the main session's first header carries the anchored face. Real Loader
 * composition, replay adapter for both model routes, keyless fixtures.
 * @module intent-bridge-first-message-snapshot
 */

import { readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeSessionLog, scrubRequestHeaders, type NormalizeContext } from '@huiliyi37/dsh-acp-snapshot'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@huiliyi37/dsh-loader-smoke'
import { describe, expect, it } from 'vitest'

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'intent-bridge-snapshots/first-message')
const replayFixture = join(fixtureDir, 'replay.jsonl')
const replayOverride = join(fixtureDir, 'replay.override.json')
const sessionExpected = join(fixtureDir, 'session.expected.jsonl')
const configPath = fileURLToPath(new URL('../intent-bridge.cordis.snapshot.yml', import.meta.url))
const binScript = fileURLToPath(new URL('./fixtures/headless-driver.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
const refreshing = process.env.DSH_SNAPSHOT === 'refresh'
const task = '帮我重构 src/auth.ts 的登录逻辑'

interface SessionLogRecord {
  type?: string
  data?: {
    title?: string
    phase?: string
    reason?: string
    alignSessionId?: string
    header?: { tools?: Array<{ name: string }> }
    content?: Array<{ type?: string; text?: string }>
  }
}

function textOf(record: SessionLogRecord): string {
  return record.data?.content?.flatMap(block => block.type === 'text' ? [block.text] : []).join('') ?? ''
}

describe('intent-bridge first-message snapshot', () => {
  it('aligns in one round, hands off a task card, and the main session arms zen', async () => {
    let cwd = ''
    const result = await runLoaderSmoke({
      label: 'intent-bridge first-message headless stream-json snapshot',
      tempDirPrefix: 'dsh-intent-bridge-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath, task],
      tsconfigPath,
      env: {
        DSH_SNAPSHOT_FILE: replayFixture,
        DSH_SNAPSHOT_OVERRIDE: replayOverride,
      },
      prepare: async (runCwd) => {
        // Sessions are created by the fixture and the bridge; locate them in inspect.
        cwd = runCwd
      },
      inspect: async () => {
        const files = await readdir(join(cwd, '.sessions'), { recursive: true })
        const jsonl = files.filter(file => file.endsWith('.jsonl'))
        expect(jsonl).toHaveLength(2)

        // The MAIN session (the one that recorded the handoff) carries the card.
        let mainLog: string | undefined
        let alignLog: string | undefined
        for (const file of jsonl) {
          const raw = await readFile(join(cwd, '.sessions', file), 'utf8')
          if (raw.includes('intent-bridge/handoff')) mainLog = raw
          else alignLog = raw
        }
        expect(mainLog).toBeDefined()
        expect(alignLog).toBeDefined()

        const normalization: NormalizeContext = { cwd, sessionIds: [] }
        const main = scrubRequestHeaders(normalizeSessionLog(mainLog!, normalization))
        const align = scrubRequestHeaders(normalizeSessionLog(alignLog!, normalization))
        if (refreshing) {
          const { writeFile } = await import('node:fs/promises')
          await writeFile(sessionExpected, main)
        }
        expect(main).toBe(await readFile(sessionExpected, 'utf8'))
        const mainRecords = main.trimEnd().split('\n').map(line => JSON.parse(line) as SessionLogRecord)

        // Handoff recorded once with the alignment session id.
        const handoffs = mainRecords.filter(record => record.type === 'intent-bridge/handoff')
        expect(handoffs).toHaveLength(1)
        expect(handoffs[0]?.data?.alignSessionId).toBeDefined()

        // The main session's first user message is the rendered task card,
        // with the verbatim original under the marker.
        const firstUser = mainRecords.find(record => record.type === 'user/message')
        const text = textOf(firstUser ?? {})
        expect(text).toContain('# 重构登录逻辑')
        expect(text).toContain('不改变 API 签名')
        expect(text).toContain('—— 原始请求 ——')
        expect(text).toContain(task)

        // The main session armed the zen phase (fresh top-level session).
        const zenPhases = mainRecords.filter(record => record.type === 'zen/phase').map(record => record.data?.phase)
        expect(zenPhases).toEqual(['zen'])

        // The alignment session never armed zen (seeded completed) and carries
        // the deterministic title.
        const alignRecords = align.trimEnd().split('\n').map(line => JSON.parse(line) as SessionLogRecord)
        expect(alignRecords.filter(record => record.type === 'zen/phase').map(record => record.data?.phase))
          .toEqual(['zen', 'full'])
        const titles = alignRecords.filter(record => record.type === 'session/title').map(record => record.data?.title)
        expect(titles).toContain('意图对齐')
      },
    })

    expect(result.stderr).toBe('')
    const records = result.stdout.trimEnd().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
    expect(records.at(-1)).toMatchObject({ type: 'result' })
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
