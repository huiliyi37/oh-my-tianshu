import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { defaultDshHome } from '@deepseek-ai/dsh-paths'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ANONYMOUS_ID_FILE_NAME,
  getOrCreateAnonymousId,
  globalConfigDir,
} from '@deepseek-ai/dsh-telemetry'

const dirs: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-anon-'))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

describe('globalConfigDir', () => {
  it('prefers an explicit DSH_HOME override', () => {
    expect(globalConfigDir({ env: { DSH_HOME: '/custom/dsh' } })).toBe(resolve('/custom/dsh'))
  })

  it('falls back to ~/.dsh when DSH_HOME is unset', () => {
    expect(globalConfigDir({ env: {} })).toBe(resolve(defaultDshHome()))
  })

  it('reads process.env by default', () => {
    // No override supplied: the call must not throw and must return an absolute path.
    // The ambient DSH_HOME is unknown here, so assert only the invariant the
    // resolver guarantees rather than a specific location.
    expect(isAbsolute(globalConfigDir())).toBe(true)
  })
})

describe('getOrCreateAnonymousId', () => {
  it('creates, persists, and returns a UUID on first use', async () => {
    const dir = await tempDir()
    const id = await getOrCreateAnonymousId({ env: { DSH_HOME: dir } })
    expect(id).toMatch(UUID)
    const stored: unknown = JSON.parse(await readFile(join(dir, ANONYMOUS_ID_FILE_NAME), 'utf8'))
    expect(stored).toEqual({ anonymousId: id })
  })

  it('returns the same persisted id on subsequent calls', async () => {
    const dir = await tempDir()
    const first = await getOrCreateAnonymousId({ env: { DSH_HOME: dir } })
    const second = await getOrCreateAnonymousId({ env: { DSH_HOME: dir } })
    expect(second).toBe(first)
  })

  it('uses the injected UUID generator', async () => {
    const dir = await tempDir()
    const id = await getOrCreateAnonymousId({
      env: { DSH_HOME: dir },
      randomUUID: () => '00000000-0000-4000-8000-000000000000',
    })
    expect(id).toBe('00000000-0000-4000-8000-000000000000')
  })

  it('regenerates when the stored file is corrupt JSON', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, ANONYMOUS_ID_FILE_NAME), 'not json', 'utf8')
    const id = await getOrCreateAnonymousId({ env: { DSH_HOME: dir } })
    expect(id).toMatch(UUID)
  })

  it('regenerates when the stored value is not a valid UUID or object', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, ANONYMOUS_ID_FILE_NAME), JSON.stringify({ anonymousId: 'nope' }), 'utf8')
    expect(await getOrCreateAnonymousId({ env: { DSH_HOME: dir } })).toMatch(UUID)
    await writeFile(join(dir, ANONYMOUS_ID_FILE_NAME), '123', 'utf8')
    expect(await getOrCreateAnonymousId({ env: { DSH_HOME: dir } })).toMatch(UUID)
  })

  it('returns a usable id even when persistence fails', async () => {
    const dir = await tempDir()
    // A regular file where a directory is expected makes mkdir/writeFile fail.
    await writeFile(join(dir, 'blocker'), 'x', 'utf8')
    const id = await getOrCreateAnonymousId({ env: { DSH_HOME: join(dir, 'blocker') } })
    expect(id).toMatch(UUID)
  })
})
