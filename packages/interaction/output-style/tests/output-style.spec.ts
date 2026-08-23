/** Output-style presets over a real settings provider, prompt registry, and command plane. */

import { describe, expect, it } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import { Settings } from '@huiliyi37/dsh-settings'
import type { SettingsNamespace } from '@huiliyi37/dsh-settings'
import { SystemPrompt } from '@huiliyi37/dsh-system-prompt'
import CommandService from '@huiliyi37/dsh-commands'
import { Session, SessionId } from '@huiliyi37/dsh-session'
import type { Agent } from '@huiliyi37/dsh-agent'
import {
  apply,
  Config,
  OUTPUT_STYLE_SECTION_NAME,
  OUTPUT_STYLE_SECTION_ORDER,
  OUTPUT_STYLE_SETTINGS_NAMESPACE,
  OUTPUT_STYLE_TEXTS,
} from '../src/index.ts'

/** The smallest real provider: one in-memory document, always writable. */
class MemorySettings extends Settings {
  doc: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

/** The plugin as a Cordis module with its runtime config schema attached
 * (direct plugin() boot; the Loader path reads the module's own exports). */
const outputStylePlugin = Object.assign(
  (ctx: Context, config: Config = {}) => { apply(ctx, config) },
  { inject: ['systemPrompt', 'commands'], Config },
)

/** Minimal agent stand-in satisfying the command executor's contract. */
function makeAgent(id: string): Agent {
  return {
    session: Session.create(SessionId(id)),
    status: 'idle',
    options: {},
    reserveTurnAdmission: () => () => undefined,
  } as unknown as Agent
}

async function boot(options?: { withSettings?: boolean; defaultStyle?: 'default' | 'explanatory' | 'learning' }): Promise<{
  ctx: Context
  settingsFiber: Context['fiber'] | undefined
  pluginFiber: Context['fiber']
}> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(CommandService)
  const settingsFiber = options?.withSettings === false ? undefined : ctx.plugin(MemorySettings)
  if (settingsFiber !== undefined) await settingsFiber.await()
  const pluginFiber = ctx.plugin(outputStylePlugin, options?.defaultStyle === undefined ? {} : { defaultStyle: options.defaultStyle })
  await pluginFiber.await()
  return { ctx, settingsFiber, pluginFiber }
}

/** The rendered texts of the assembled `output-style` sections, in assembly order. */
async function styleSections(ctx: Context): Promise<string[]> {
  return (await ctx.systemPrompt.assemble()).sections
    .filter(section => section.name === OUTPUT_STYLE_SECTION_NAME)
    .map(section => section.text)
}

async function runStyle(ctx: Context, agent: Agent, input: string): Promise<{ kind: string; text: string }> {
  const execution = await ctx.commands.execute(agent, `/style${input === '' ? '' : ` ${input}`}`, new AbortController().signal)
  if (execution === undefined) throw new Error('composition did not resolve /style')
  const result = execution.result
  if (result.text === undefined) throw new Error('/style result carries no text')
  return { kind: result.kind, text: result.text }
}

describe('output-style section', () => {
  it('registers exactly one section rendering the composition default, ordered between persona and tool guidance', async () => {
    const bench = await boot({ withSettings: false, defaultStyle: 'explanatory' })
    // Assembled sections carry only name+text (order is consumed by the sort),
    // so position is asserted against probe sections at the neighboring bands.
    bench.ctx.systemPrompt.section({ name: 'probe:persona', order: 0, text: 'BEFORE' })
    bench.ctx.systemPrompt.section({ name: 'probe:tools', order: OUTPUT_STYLE_SECTION_ORDER + 90, text: 'AFTER' })
    const names = (await bench.ctx.systemPrompt.assemble()).sections.map(section => section.name)
    // Registry-owned identity/persona sections also render; assert placement only.
    const at = (name: string): number => names.indexOf(name)
    expect(at('probe:persona')).toBeLessThan(at(OUTPUT_STYLE_SECTION_NAME))
    expect(at(OUTPUT_STYLE_SECTION_NAME)).toBeLessThan(at('probe:tools'))
    const texts = await styleSections(bench.ctx)
    expect(texts).toEqual([OUTPUT_STYLE_TEXTS.explanatory])
    await bench.ctx.fiber.dispose()
  })

  it('defaults to the `default` preset when no config is given', async () => {
    const bench = await boot({ withSettings: false })
    expect(await styleSections(bench.ctx)).toEqual([OUTPUT_STYLE_TEXTS.default])
    await bench.ctx.fiber.dispose()
  })

  it('renders the committed style from the next assembly (realtime read, single section)', async () => {
    const bench = await boot()
    const settings = bench.ctx.get('settings')!
    await settings.mutate(OUTPUT_STYLE_SETTINGS_NAMESPACE, [{ op: 'set', path: ['style'], value: 'learning' }])
    expect(await styleSections(bench.ctx)).toEqual([OUTPUT_STYLE_TEXTS.learning])
    // The realtime read must not stack registrations across switches.
    await settings.mutate(OUTPUT_STYLE_SETTINGS_NAMESPACE, [{ op: 'set', path: ['style'], value: 'default' }])
    expect(await styleSections(bench.ctx)).toHaveLength(1)
    expect(await styleSections(bench.ctx)).toEqual([OUTPUT_STYLE_TEXTS.default])
    await bench.ctx.fiber.dispose()
  })

  it('rejects an unknown committed style at the namespace boundary', async () => {
    const bench = await boot()
    await expect(bench.ctx.get('settings')!.mutate(OUTPUT_STYLE_SETTINGS_NAMESPACE, [
      { op: 'set', path: ['style'], value: 'bogus' },
    ])).rejects.toThrow()
    expect(await styleSections(bench.ctx)).toEqual([OUTPUT_STYLE_TEXTS.default])
    await bench.ctx.fiber.dispose()
  })

  it('falls back to the composition default when the settings provider detaches', async () => {
    const bench = await boot({ defaultStyle: 'explanatory' })
    await bench.ctx.get('settings')!.mutate(OUTPUT_STYLE_SETTINGS_NAMESPACE, [
      { op: 'set', path: ['style'], value: 'learning' },
    ])
    expect(await styleSections(bench.ctx)).toEqual([OUTPUT_STYLE_TEXTS.learning])
    await bench.settingsFiber!.dispose()
    expect(await styleSections(bench.ctx)).toEqual([OUTPUT_STYLE_TEXTS.explanatory])
    await bench.ctx.fiber.dispose()
  })

  it('HMR safety: disposing the plugin fiber removes the section from assembly', async () => {
    const bench = await boot()
    expect(await styleSections(bench.ctx)).toHaveLength(1)
    await bench.pluginFiber.dispose()
    expect(await styleSections(bench.ctx)).toEqual([])
    await bench.ctx.fiber.dispose()
  })
})

describe('/style command', () => {
  it('bare reports the current style; a known argument commits hot; unknown fails loud', async () => {
    const bench = await boot()
    const agent = makeAgent('style-cmd')
    await expect(runStyle(bench.ctx, agent, '')).resolves.toEqual({
      kind: 'success',
      text: 'Current output style: default.',
    })
    await expect(runStyle(bench.ctx, agent, 'learning')).resolves.toEqual({
      kind: 'success',
      text: 'Output style set to learning (applies from the next request).',
    })
    // Hot: the same assembly pipeline already renders the committed preset.
    expect(await styleSections(bench.ctx)).toEqual([OUTPUT_STYLE_TEXTS.learning])
    await expect(runStyle(bench.ctx, agent, 'bogus')).resolves.toEqual({
      kind: 'error',
      text: 'Unknown style "bogus". Available: default, explanatory, learning.',
    })
    expect(await styleSections(bench.ctx)).toEqual([OUTPUT_STYLE_TEXTS.learning])
    await bench.ctx.fiber.dispose()
  })

  it('without a settings provider the switch fails loud while reporting still works', async () => {
    const bench = await boot({ withSettings: false, defaultStyle: 'explanatory' })
    const agent = makeAgent('style-nosettings')
    await expect(runStyle(bench.ctx, agent, '')).resolves.toEqual({
      kind: 'success',
      text: 'Current output style: explanatory.',
    })
    await expect(runStyle(bench.ctx, agent, 'learning')).resolves.toEqual({
      kind: 'error',
      text: 'No settings provider is assembled; /style cannot persist a switch.',
    })
    await bench.ctx.fiber.dispose()
  })

  it('mirrors into the TUI slash menu when tui.commands appears later, delegating execution', async () => {
    const bench = await boot()
    interface RegisteredCommand {
      name: string
      description: string
      argsHint?: string
      run(args: { text: string; sessionId: string | null; echo(text: string): void; ctx: { agents?: Map<string, unknown> } }): Promise<void>
    }
    const registered: RegisteredCommand[] = []
    bench.ctx.provide('tui.commands', { register: (command: RegisteredCommand) => { registered.push(command) } })
    await new Promise(resolve => setImmediate(resolve))
    expect(registered.map(command => command.name)).toEqual(['style'])
    expect(registered[0]?.description).toContain('输出风格')

    const echoes: string[] = []
    const agent = makeAgent('style-tui')
    const agents = new Map<string, unknown>([['session-tui', agent]])
    await registered[0]!.run({ text: '', sessionId: 'session-tui', echo: (text) => { echoes.push(text) }, ctx: { agents } })
    expect(echoes).toEqual(['Current output style: default.'])
    await registered[0]!.run({ text: 'learning', sessionId: 'session-tui', echo: (text) => { echoes.push(text) }, ctx: { agents } })
    expect(echoes.at(-1)).toContain('Output style set to learning')
    await bench.ctx.fiber.dispose()
  })
})
