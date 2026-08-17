/**
 * Assembled-app regression for the task-card first-message rewrite: a short
 * first message (no newline, would be triaged as trivial by zen) is rewritten
 * into a structured card before the model sees it, and the rewritten message
 * — with the verbatim original under the marker — is what lands in the
 * persisted session log. Real Loader composition, replay adapter for the
 * model response, keyless fixtures.
 * @module task-card-first-message-snapshot
 */

import { readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeSessionLog, scrubRequestHeaders, type NormalizeContext } from '@huiliyi37/dsh-acp-snapshot'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@huiliyi37/dsh-loader-smoke'
import { SessionId } from '@huiliyi37/dsh-session'
import { describe, expect, it } from 'vitest'

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'task-card-snapshots/first-message')
const replayFixture = join(fixtureDir, 'replay.jsonl')
const replayOverride = join(fixtureDir, 'replay.override.json')
const sessionExpected = join(fixtureDir, 'session.expected.jsonl')
const configPath = fileURLToPath(new URL('../task-card.cordis.snapshot.yml', import.meta.url))
const binScript = fileURLToPath(new URL('./fixtures/headless-driver.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
const sessionId = SessionId('task-card-replay')
const refreshing = process.env.DSH_SNAPSHOT === 'refresh'
// Short, single-line, text-only: the shape zen's triage would skip — the card
// rewrite must still fire (it is decided at pre-step, after triage).
const task = '帮我重构 src/auth.ts 的登录逻辑'
const CARD_MARKER = '—— 原始请求 ——'

describe('task-card first-message snapshot', () => {
  it('rewrites the first message into a card that lands in the persisted log', async () => {
    let cwd = ''
    let sessionPath = ''
    const result = await runLoaderSmoke({
      label: 'task-card first-message headless stream-json snapshot',
      tempDirPrefix: 'dsh-task-card-',
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
        // The session is created by the driver after boot; locate it in inspect.
        cwd = runCwd
      },
      inspect: async () => {
        const files = await readdir(join(cwd, '.sessions'), { recursive: true })
        const jsonl = files.filter(file => file.endsWith('.jsonl'))
        expect(jsonl).toHaveLength(1)
        sessionPath = join(cwd, '.sessions', jsonl[0] ?? '')
        const normalization: NormalizeContext = { sessionIds: [sessionId], cwd }
        const session = scrubRequestHeaders(normalizeSessionLog(await readFile(sessionPath, 'utf8'), normalization))
        if (refreshing) await writeFile(sessionExpected, session)
        expect(session).toBe(await readFile(sessionExpected, 'utf8'))

        const records = session.trimEnd().split('\n').map(line => JSON.parse(line) as {
          type?: string
          data?: { content?: Array<{ type?: string; text?: string }> }
        })
        const firstUser = records.find(record => record.type === 'user/message')
        const text = firstUser?.data?.content?.flatMap(block => block.type === 'text' ? [block.text] : []).join('') ?? ''
        expect(text).toContain(`# ${task}`)
        expect(text).toContain('## 目标')
        expect(text).toContain(CARD_MARKER)
        expect(text).toContain(task)
      },
    })

    expect(result.stderr).toBe('')
    const records = result.stdout.trimEnd().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
    expect(records.at(-1)).toMatchObject({
      type: 'result',
      sessionId,
      output: 'Understood the card: refactor the login flow now.',
    })
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
