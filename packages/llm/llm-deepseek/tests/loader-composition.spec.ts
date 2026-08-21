/**
 * Real-composition guard for the dynamic-configuration chain: LlmService,
 * settings-local, credentials-local, and llm-deepseek boot from a test-only
 * cordis.yml through the actual Loader + Include path, external edits of
 * settings.yaml and the credentials document hot-publish through their providers, and the very
 * next request carries the fresh base URL and credential. The same adapter
 * composition without settings or credentials entries keeps entry-config
 * behavior — the documented optional-inject fallback.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import Loader from '@huiliyi37/cordis-plugin-loader'
import Include from '@huiliyi37/cordis-plugin-include'
import LlmService from '@huiliyi37/dsh-llm'
import { createMessage, CallId } from '@huiliyi37/dsh-llm'
import { credentialRef } from '@huiliyi37/dsh-credentials'
import CredentialsLocal from '@huiliyi37/dsh-credentials-local'
import { settingsNamespace } from '@huiliyi37/dsh-settings'
import SettingsLocal from '@huiliyi37/dsh-settings-local'
import * as LlmDeepSeek from '@huiliyi37/dsh-llm-deepseek'
import { assemble } from './assemble.ts'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'

const NS = settingsNamespace('llm-deepseek')
const KEY_REF = credentialRef('DEEPSEEK_API_KEY')

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) { await rm(root, { recursive: true, force: true }) }
  root = undefined
  await closeMockServers()
  vi.unstubAllEnvs()
})

async function loadComposition(
  options: {
    withDynamic: boolean
    baseURL: string
    reuseRoot?: string
    spark?: { enabled: boolean; truncateN?: { flash?: number; pro?: number } }
  },
): Promise<{ ctx: Context; settingsPath: string; credentialsPath: string }> {
  // A reused root is the restart case: the same harness home, its documents
  // exactly as the previous process left them.
  const fresh = options.reuseRoot === undefined
  root = options.reuseRoot ?? await mkdtemp(join(tmpdir(), 'dsh-llm-composition-'))
  const settingsPath = join(root, 'settings.yaml')
  const credentialsPath = join(root, '.credentials.yaml')
  if (options.withDynamic && fresh) {
    await writeFile(settingsPath, '# personal settings\n')
    await writeFile(credentialsPath, 'version: 1\nrefs:\n  DEEPSEEK_API_KEY: boot-key\n', { mode: 0o600 })
  }

  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    '- id: llm',
    "  name: 'test-llm-service'",
    ...options.withDynamic
      ? [
        '- id: settings',
        "  name: '@huiliyi37/dsh-settings-local'",
        '  config:',
        `    path: ${JSON.stringify(settingsPath)}`,
        '    debounceMs: 10',
        '- id: credentials',
        "  name: '@huiliyi37/dsh-credentials-local'",
        '  config:',
        `    path: ${JSON.stringify(credentialsPath)}`,
        '    debounceMs: 10',
      ]
      : [],
    '- id: llm-deepseek',
    "  name: '@huiliyi37/dsh-llm-deepseek'",
    '  config:',
    `    baseURL: ${JSON.stringify(options.baseURL)}`,
    ...options.spark !== undefined
      ? [
        '    spark:',
        `      enabled: ${String(options.spark.enabled)}`,
        ...options.spark.truncateN !== undefined
          ? [
            '      truncateN:',
            ...options.spark.truncateN.flash !== undefined
              ? [`        flash: ${String(options.spark.truncateN.flash)}`]
              : [],
            ...options.spark.truncateN.pro !== undefined
              ? [`        pro: ${String(options.spark.truncateN.pro)}`]
              : [],
          ]
          : [],
      ]
      : [],
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['test-llm-service', LlmService],
    ['@huiliyi37/dsh-settings-local', SettingsLocal],
    ['@huiliyi37/dsh-credentials-local', CredentialsLocal],
    ['@huiliyi37/dsh-llm-deepseek', LlmDeepSeek],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await ctx.loader.await()
  return { ctx, settingsPath, credentialsPath }
}

describe('llm-deepseek real dynamic composition', () => {
  it('boots from cordis.yml and routes the next request after external settings and credential edits', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', '')
    const serverA = await mockServer([{ kind: 'sse', events: textEvents }])
    const serverB = await mockServer([{ kind: 'sse', events: textEvents }])
    const { ctx, settingsPath, credentialsPath } = await loadComposition({ withDynamic: true, baseURL: serverA.url })

    expect(ctx.get('settings')!.describe().map(entry => entry.ns)).toEqual([NS])
    await assemble(ctx, { model: 'deepseek-v4-flash', messages: [] })
    expect(serverA.headers[0]?.authorization).toBe('Bearer boot-key')

    // External edits, exactly as a user or the web UI would leave them on disk.
    await writeFile(settingsPath, `llm-deepseek:\n  baseURL: ${serverB.url}\n`)
    await vi.waitFor(() => {
      expect((ctx.get('settings')!.get(NS) as { baseURL?: string }).baseURL).toBe(serverB.url)
    }, { timeout: 5000 })
    await writeFile(credentialsPath, 'version: 1\nrefs:\n  DEEPSEEK_API_KEY: rotated-key\n', { mode: 0o600 })
    await vi.waitFor(async () => {
      expect(await ctx.get('credentials')!.resolve(KEY_REF)).toEqual({ value: 'rotated-key', source: 'file' })
    }, { timeout: 5000 })

    await assemble(ctx, { model: 'deepseek-v4-flash', messages: [] })
    expect(serverA.requests).toHaveLength(1)
    expect(serverB.headers[0]?.authorization).toBe('Bearer rotated-key')
  })

  it('keeps a stored key writable and rotatable across a real restart', async () => {
    // No ambient DEEPSEEK_API_KEY: the shipped surfaces no longer hoist
    // the credentials document into process.env, so a stored key must stay file-sourced.
    vi.stubEnv('DEEPSEEK_API_KEY', '')
    const first = await mockServer([{ kind: 'sse', events: textEvents }])
    const second = await mockServer([{ kind: 'sse', events: textEvents }])
    const boot = await loadComposition({ withDynamic: true, baseURL: first.url })
    const home = root!
    await boot.ctx.get('credentials')!.set(KEY_REF, 'stored-by-ui')
    expect(await boot.ctx.get('credentials')!.describe(KEY_REF))
      .toEqual({ configured: true, source: 'file', writable: true })
    await assemble(boot.ctx, { model: 'deepseek-v4-flash', messages: [] })
    expect(first.headers[0]?.authorization).toBe('Bearer stored-by-ui')
    await boot.ctx.fiber.dispose()
    context = undefined

    // Restart over the same harness home.
    const restarted = await loadComposition({ withDynamic: true, baseURL: second.url, reuseRoot: home })
    const credentials = restarted.ctx.get('credentials')!
    // The stored key is still the provider's own writable file entry — not a
    // read-only launch override, which is what hoisting it would have made it.
    expect(await credentials.resolve(KEY_REF)).toEqual({ value: 'stored-by-ui', source: 'file' })
    expect(await credentials.describe(KEY_REF)).toEqual({ configured: true, source: 'file', writable: true })
    // Rotation still works after the restart, and the next request uses it.
    await credentials.set(KEY_REF, 'rotated-after-restart')
    await assemble(restarted.ctx, { model: 'deepseek-v4-flash', messages: [] })
    expect(second.headers[0]?.authorization).toBe('Bearer rotated-after-restart')
  })

  it('boots the same adapter on entry config alone, resolving the reference from the environment', async () => {
    // No settings and no credentials provider: configuration carries only the
    // reference, so the environment is the whole credential plane here.
    vi.stubEnv('DEEPSEEK_API_KEY', 'entry-key')
    const server = await mockServer([{ kind: 'sse', events: textEvents }])
    const { ctx } = await loadComposition({ withDynamic: false, baseURL: server.url })

    expect(ctx.get('settings')).toBeUndefined()
    expect(ctx.get('credentials')).toBeUndefined()
    await assemble(ctx, { model: 'deepseek-v4-flash', messages: [] })
    expect(server.headers[0]?.authorization).toBe('Bearer entry-key')
  })

  it('boots spark enabled and truncates reasoning on the wire for the spark route', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'entry-key')
    const LONG_REASONING = '字'.repeat(400)
    const messages = [createMessage({
      role: 'assistant',
      content: [
        { type: 'tool-call', id: CallId('c1'), name: 'tool', arguments: '{}' },
        { type: 'reasoning', text: LONG_REASONING },
      ],
      source: { kind: 'plugin', plugin: 'test' },
    })]
    const server = await mockServer([{ kind: 'sse', events: textEvents }])
    const { ctx } = await loadComposition({
      withDynamic: false,
      baseURL: server.url,
      spark: { enabled: true, truncateN: { flash: 100 } },
    })
    await assemble(ctx, { provider: 'deepseek-spark', model: 'deepseek-v4-flash', messages })
    const wire = server.requests[0] as { messages: { role: string; reasoning_content?: string }[] }
    // 400 CJK 单字 → 尾部 100 token（连续子串）
    expect(wire.messages[0]?.reasoning_content).toBeDefined()
    expect(wire.messages[0]!.reasoning_content!.length).toBe(100)
    expect(LONG_REASONING.endsWith(wire.messages[0]!.reasoning_content!)).toBe(true)
  })

  it('boots spark disabled (default) and leaves reasoning intact on the wire', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'entry-key')
    const LONG_REASONING = '字'.repeat(400)
    const messages = [createMessage({
      role: 'assistant',
      content: [
        { type: 'tool-call', id: CallId('c1'), name: 'tool', arguments: '{}' },
        { type: 'reasoning', text: LONG_REASONING },
      ],
      source: { kind: 'plugin', plugin: 'test' },
    })]
    const server = await mockServer([{ kind: 'sse', events: textEvents }])
    const { ctx } = await loadComposition({ withDynamic: false, baseURL: server.url })
    await assemble(ctx, { provider: 'deepseek-spark', model: 'deepseek-v4-flash', messages })
    const wire = server.requests[0] as { messages: { role: string; reasoning_content?: string }[] }
    // spark 缺省 disabled：wire 与单 route 时一致（完整推理回传）
    expect(wire.messages[0]?.reasoning_content).toBe(LONG_REASONING)
  })
})
