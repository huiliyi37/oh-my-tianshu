/**
 * Output style presets — a switchable answer-style channel for the assembled
 * system prompt.
 *
 * The package registers exactly one `system-prompt` section named
 * `output-style` at order `10` (between the deployment persona at `0` and the
 * tool-guidance band at `100`–`199`) and ships three verbatim style presets:
 * `default`, `explanatory`, and `learning`. The active style lives in the
 * `output-style` settings namespace; `/style` commits it. The section is
 * registered once and its text reads the live source on every assembly (the
 * model-roles realtime-read pattern), so a commit applies from the next
 * assembly with no dispose/re-register gap. Without a settings provider the
 * section renders the composition's `Config.defaultStyle`.
 *
 * The preset is deployment-global in this cut; agent-scoped overrides are
 * deferred until a consumer asks for them.
 *
 * @module @huiliyi37/dsh-output-style
 */

import type { Context } from '@huiliyi37/cordis'
import z from '@huiliyi37/schemastery'
import { installSettingsSection, settingsNamespace } from '@huiliyi37/dsh-settings'
import type {} from '@huiliyi37/dsh-system-prompt'
// Declaration merging: teaches Context about ctx.commands used below.
import type {} from '@huiliyi37/dsh-commands'
import { FIRST_PARTY_SECTION_ORDER } from '@huiliyi37/dsh-system-prompt'

/** Cordis plugin name. */
export const name = 'output-style'

/** Services this plugin consumes: the prompt registry and the command plane. */
export const inject = ['systemPrompt', 'commands']

/** The closed output-style vocabulary. */
export type OutputStyle = 'default' | 'explanatory' | 'learning'

/** Every shipped style, in vocabulary order. */
export const OUTPUT_STYLES = ['default', 'explanatory', 'learning'] as const

/** Settings namespace holding the active style (lowercase kebab-case by contract). */
export const OUTPUT_STYLE_SETTINGS_NAMESPACE = settingsNamespace('output-style')

/** Name of the single prompt section this package contributes. */
export const OUTPUT_STYLE_SECTION_NAME = 'output-style'

/** Section order: after the deployment persona (`0`), before tool guidance (`100`–`199`). */
/** Section order: the output-style guidance band (see FIRST_PARTY_SECTION_ORDER). */
export const OUTPUT_STYLE_SECTION_ORDER = FIRST_PARTY_SECTION_ORDER.OUTPUT_STYLE

/**
 * The three verbatim preset bodies rendered as the `output-style` section.
 * These strings are model-visible; tests pin them byte-for-byte, so any
 * wording change is a snapshot-visible contract change.
 */
export const OUTPUT_STYLE_TEXTS: Record<OutputStyle, string> = {
  default: 'Answer directly and concisely. Lead with the result or decision, then only the supporting detail needed to act on it. Skip preamble, restatement of the question, and unsolicited alternatives unless a real trade-off changes the answer.',
  explanatory: 'Teach while you answer. After delivering the correct result, add a short explanation of the key mechanism behind it (two to five sentences), and define any non-obvious concept in one sentence at first use. Keep code examples runnable; prefer the instructive middle over complete boilerplate.',
  learning: 'Turn the answer into a guided exercise. State the goal, then work toward it interactively: give the plan and one concrete first step, ask the user to attempt it or answer a check question before revealing the next step, and review their result against the expected outcome. Never present the full solution up front; keep every hint small enough to act on in one edit or command.',
}

/** Wire shape of the `output-style` settings namespace. */
export interface OutputStyleSettings {
  /** The active style; every assembly renders its verbatim text. */
  style: OutputStyle
}

/** Runtime schema for the namespace: the committed value must be a known style. */
export const OUTPUT_STYLE_SETTINGS_SCHEMA: z<OutputStyleSettings> = z.object({
  style: z.union(OUTPUT_STYLES as unknown as OutputStyle[]).required(),
})

/** Plugin config: composition-level default and no-provider fallback. */
export interface Config {
  /**
   * Style active until a settings commit switches it, and the permanent
   * fallback when no settings provider is assembled. Defaults to `default`.
   */
  defaultStyle?: OutputStyle
}

/** Runtime schema for the plugin config. */
export const Config: z<Config> = z.object({
  defaultStyle: z.union(OUTPUT_STYLES as unknown as OutputStyle[]),
})

/** Minimal shape of the TUI slash facet consumed through the optional seam. */
interface TuiSlashFacet {
  register(command: { name: string; description: string; argsHint?: string; run: (args: TuiSlashRun) => void | Promise<void> }): void
}

/** Arguments the TUI slash registry hands each command invocation. */
interface TuiSlashRun {
  text: string
  sessionId: string | null
  echo: (text: string) => void
  ctx: { agents?: { get(id: string): unknown } }
}

/**
 * Register the `output-style` section, its settings wiring, and `/style`.
 * @param ctx - plugin context (injects `systemPrompt` and `commands`; the
 *   settings seam and the TUI slash facet attach through optional injects).
 * @param config - the composition default style.
 */
export function apply(ctx: Context, config: Config = {}): void {
  // TUI 斜杠菜单（可选缝）：host 命令平面不进 TUI 的 `/` 菜单——菜单数据源是
  // tui.commands 注册表（见 /next-workflow 同款双注册）。执行仍委托 host
  // CommandService，保持 command/run 生命周期事件。
  ctx.inject(['tui.commands'], (tuiCtx) => {
    const tuiCommands = tuiCtx.get('tui.commands') as TuiSlashFacet
    tuiCommands.register({
      name: 'style',
      description: '查看或切换输出风格预设',
      argsHint: '[default|explanatory|learning]',
      run: async ({ text, ctx: runCtx, sessionId, echo }) => {
        const arg = text.trim()
        const input = arg === '' ? '/style' : `/style ${arg}`
        if (sessionId === null) {
          echo('⚠ /style 需要活动会话')
          return
        }
        const agent = runCtx.agents?.get(sessionId)
        if (agent === undefined) {
          echo('⚠ /style 需要活动会话')
          return
        }
        const execution = await ctx.commands.execute(agent as never, input, new AbortController().signal)
        if (execution === undefined) {
          echo(`未知命令: ${input}`)
          return
        }
        if (execution.result.kind === 'success') {
          echo(execution.result.text ?? '已执行')
        } else {
          echo(`⚠ ${execution.result.text}`)
        }
      },
    })
  })

  const initial: OutputStyleSettings = { style: config.defaultStyle ?? 'default' }
  // Live source over the resolved namespace; falls back to the composition
  // entry whenever the settings service detaches (installSettingsSection).
  let source: () => OutputStyleSettings = () => initial
  installSettingsSection(ctx, OUTPUT_STYLE_SETTINGS_NAMESPACE, OUTPUT_STYLE_SETTINGS_SCHEMA, initial, {
    setSource: (current) => { source = current },
    onChange: () => {},
  })
  // Registered once; the text closure reads the live source on every assembly,
  // so a committed switch re-renders the section with no unregister gap.
  ctx.effect(() => ctx.systemPrompt.section({
    name: OUTPUT_STYLE_SECTION_NAME,
    order: OUTPUT_STYLE_SECTION_ORDER,
    text: () => OUTPUT_STYLE_TEXTS[source().style],
  }), 'outputStyle.section()')

  ctx.commands.register({
    name: 'style',
    description: 'Report or switch the output style preset',
    input: { hint: '[default|explanatory|learning]' },
    handler: async ({ rawInput }) => {
      const requested = rawInput.trim()
      if (requested === '') {
        return { kind: 'success', text: `Current output style: ${source().style}.` }
      }
      if (!(OUTPUT_STYLES as readonly string[]).includes(requested)) {
        return { kind: 'error', text: `Unknown style "${requested}". Available: ${OUTPUT_STYLES.join(', ')}.` }
      }
      const settings = ctx.get('settings')
      if (settings === undefined) {
        return { kind: 'error', text: 'No settings provider is assembled; /style cannot persist a switch.' }
      }
      await settings.mutate(OUTPUT_STYLE_SETTINGS_NAMESPACE, [{ op: 'set', path: ['style'], value: requested }])
      return { kind: 'success', text: `Output style set to ${requested} (applies from the next request).` }
    },
  })
}
