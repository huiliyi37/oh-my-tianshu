/**
 * output-style real Loader composition: the plugin is discovered through the
 * Loader like any shipped row, /style executes against a live settings seam,
 * and the assembled prompt carries the committed preset.
 * @module @huiliyi37/dsh-output-style/tests/loader-composition
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import Loader from '@huiliyi37/cordis-plugin-loader'
import Include from '@huiliyi37/cordis-plugin-include'
import type { Agent } from '@huiliyi37/dsh-agent'
import CommandService from '@huiliyi37/dsh-commands'
import { SystemPrompt } from '@huiliyi37/dsh-system-prompt'
import * as outputStyle from '@huiliyi37/dsh-output-style'
import { Session, SessionId } from '@huiliyi37/dsh-session'

/** Minimal in-memory settings seam: register/get/watch/mutate over one document. */
function makeSettingsStub() {
  const sections = new Map<string, { current: Record<string, unknown>; watchers: Set<() => void> }>()
  return {
    register(ns: unknown, _schema: unknown, options: { base: Record<string, unknown> }) {
      const entry = { current: structuredClone(options.base), watchers: new Set<() => void>() }
      sections.set(String(ns), entry)
      return {
        get: () => entry.current,
        watch: (fn: () => void) => {
          entry.watchers.add(fn)
          return () => { entry.watchers.delete(fn) }
        },
      }
    },
    async mutate(ns: unknown, ops: ReadonlyArray<{ op: string; path: readonly string[]; value?: unknown }>): Promise<void> {
      const entry = sections.get(String(ns))
      if (entry === undefined) throw new Error(`unknown namespace ${String(ns)}`)
      for (const op of ops) {
        if (op.op !== 'set') throw new Error(`unsupported op ${op.op}`)
        entry.current[op.path[0]!] = op.value
      }
      for (const watcher of [...entry.watchers]) watcher()
    },
  }
}

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('output-style real Loader composition', () => {
  it('discovers /style, commits a switch, and renders the preset in assembly', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-output-style-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@huiliyi37/dsh-commands'",
      "- name: '@huiliyi37/dsh-system-prompt'",
      "- name: 'test-settings-stub'",
      "- name: '@huiliyi37/dsh-output-style'",
      '',
    ].join('\n'))

    const settingsStub = makeSettingsStub()
    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@huiliyi37/dsh-commands', CommandService],
      ['@huiliyi37/dsh-system-prompt', SystemPrompt],
      ['test-settings-stub', { name: 'test-settings-stub', apply(ctx: Context) { ctx.provide('settings', settingsStub) } }],
      ['@huiliyi37/dsh-output-style', outputStyle],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(configPath).href },
    })
    await context.loader.await()

    const session = Session.create(SessionId('loader-output-style'))
    const agent = {
      session,
      status: 'idle',
      options: {},
      reserveTurnAdmission: () => () => undefined,
    } as unknown as Agent

    // The command is listed for adapters and the lifecycle pair is logged per run.
    expect(context.commands.list(agent).map(command => command.name)).toContain('style')

    const bare = await context.commands.execute(agent, '/style', new AbortController().signal)
    expect(bare?.result).toEqual({ kind: 'success', text: 'Current output style: default.' })

    const switched = await context.commands.execute(agent, '/style explanatory', new AbortController().signal)
    expect(switched?.result.kind).toBe('success')
    expect(session.events.filter(event => event.type === 'command/run')).toHaveLength(2)

    // The assembled prompt now carries the committed preset verbatim.
    const texts = (await context.systemPrompt.assemble()).sections
      .filter(section => section.name === 'output-style')
      .map(section => section.text)
    expect(texts).toEqual([outputStyle.OUTPUT_STYLE_TEXTS.explanatory])

    // Unknown styles fail loud at the command boundary.
    const rejected = await context.commands.execute(agent, '/style bogus', new AbortController().signal)
    expect(rejected?.result.kind).toBe('error')
  })
})
