/**
 * Load user-defined slash commands from Markdown command files.
 *
 * Two layers are scanned at load time:
 *
 * - a user layer under `<resolveDshHome()>/commands` (default `~/.dsh-tianshu/commands`), and
 * - a project layer under `<cwd>/.dsh/commands`.
 *
 * Each `.md` file is one command: a YAML `---` frontmatter carrying a required
 * `description` and an optional `images` flag, followed by a template body. The
 * command name is the lowercase file stem with nested directories flattened by
 * `-` (so `git/log.md` → `git-log`); it must match the registry regex
 * `/^[a-z][a-z0-9_-]*$/u`. Every parse/name/dedup violation fails loud at load
 * and reports the offending file path.
 *
 * Cross-layer name collisions are de-duplicated here, not by the registry
 * (which throws on a global same-name `register`): the user layer is collected
 * first, then the project layer overwrites it, so a project command shadows the
 * homonymous user command and only the winner is registered.
 *
 * A command's handler renders its template against the exact raw input and
 * steers the resulting text to the agent as a user message (`agent.steer`), so
 * the model-visible transcript is the rendered text itself — no extra session
 * event is needed (model-visible ⟺ logged). Image attachments pass through only
 * when the file declares `images: true` (the registry also rejects attachments
 * to an `images`-less command before the handler runs). An empty template body
 * settles as an execution-time error rather than steering an empty turn.
 *
 * The TUI slash menu is mirrored through the optional `tui.commands` seam,
 * delegating execution to the host command registry so `command/run` /
 * `command/done` stay intact.
 *
 * No filesystem watching happens; new or edited command files take effect on
 * restart (see Known Limitations in the README).
 *
 * @module @huiliyi37/dsh-command-files
 */

import { join } from 'node:path'
import type { Context } from '@huiliyi37/cordis'
import z from '@huiliyi37/schemastery'
import { createUserMessage } from '@huiliyi37/dsh-llm'
import { dshHomePath } from '@huiliyi37/dsh-paths'
import type { CommandDefinition, CommandInvocation, CommandResult } from '@huiliyi37/dsh-commands'
// Declaration merging: teaches Context about `ctx.commands` and `ctx.inject`'s
// `tui.commands` type edge used below.
import type {} from '@huiliyi37/dsh-commands'
import type { Agent } from '@huiliyi37/dsh-agent'
import { loadCommandFiles, type LoadedCommand } from './loader.ts'
import { renderTemplate } from './template.ts'

/** Cordis plugin name. */
export const name = 'command-files'

/** Services this plugin consumes: the host command registry (the TUI facade attaches through an optional inject). */
export const inject = ['commands']

/** Free-form input placeholder advertised to capable clients for a file-backed command. */
const ARGS_HINT = '[args]'

/** Plugin config: the two command-layer directories. */
export interface Config {
  /** Absolute user-command directory; defaults to `<resolveDshHome()>/commands`. */
  readonly userDir?: string
  /** Absolute project-command directory; defaults to `<cwd>/.dsh/commands`. */
  readonly projectDir?: string
}

/** Runtime schema for the plugin config. */
export const Config: z<Config> = z.object({
  userDir: z.string(),
  projectDir: z.string(),
})

/** Resolved, non-optional layer directories. */
interface ResolvedConfig {
  readonly userDir: string
  readonly projectDir: string
}

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
 * Resolve the two layer directories from config or their documented defaults.
 * @param config - plugin config from cordis.yml.
 * @returns the resolved absolute layer paths.
 */
function resolveConfig(config: Config): ResolvedConfig {
  return {
    userDir: config.userDir ?? dshHomePath('commands'),
    projectDir: config.projectDir ?? join(process.cwd(), '.dsh', 'commands'),
  }
}

/**
 * Build a host command definition from one loaded command file.
 * @param command - the parsed, de-duplicated command.
 * @returns a registry-ready definition whose handler renders and steers.
 */
function buildDefinition(command: LoadedCommand): CommandDefinition {
  return {
    name: command.name,
    description: command.description,
    input: {
      hint: ARGS_HINT,
      ...command.images ? { images: true } : {},
    },
    handler: invocation => execute(command, invocation),
  }
}

/**
 * Execute one file-backed command: render its template and steer the result.
 * @param command - the loaded command definition.
 * @param invocation - the registry-supplied invocation.
 * @returns the execution result; an empty body settles as an error.
 */
function execute(command: LoadedCommand, { agent, rawInput, attachments }: CommandInvocation): CommandResult {
  const rendered = renderTemplate(command.body, rawInput)
  if (rendered.trim() === '') {
    return { kind: 'error', text: `/${command.name} has an empty template body` }
  }
  agent.steer(createUserMessage({
    content: [...attachments, { type: 'text', text: rendered }],
    source: { kind: 'user' },
  }))
  return { kind: 'success', text: rendered }
}

/**
 * Register one file-backed command into the TUI slash menu, delegating
 * execution to the host command registry.
 * @param ctx - the plugin context (reaches the host CommandService).
 * @param command - the loaded command definition.
 * @returns a TUI slash command object.
 */
function buildTuiCommand(ctx: Context, command: LoadedCommand): {
  name: string
  description: string
  argsHint: string
  run: (args: TuiSlashRun) => Promise<void>
} {
  return {
    name: command.name,
    description: command.description,
    argsHint: ARGS_HINT,
    run: async ({ text, ctx: runCtx, sessionId, echo }) => {
      const input = text.trim() === '' ? `/${command.name}` : `/${command.name} ${text.trim()}`
      if (sessionId === null) {
        echo(`⚠ /${command.name} 需要活动会话`)
        return
      }
      const agent = runCtx.agents?.get(sessionId)
      if (agent === undefined) {
        echo(`⚠ /${command.name} 需要活动会话`)
        return
      }
      const execution = await ctx.commands.execute(agent as Agent, input, new AbortController().signal)
      if (execution === undefined) {
        echo(`未知命令: ${input}`)
        return
      }
      if (execution.result.kind === 'success') {
        echo(execution.result.text ?? '已执行')
      } else {
        echo(`⚠ 命令执行失败: ${execution.result.text}`)
      }
    },
  }
}

/**
 * Apply the command-files plugin: scan both layers, register the winning
 * commands into the host registry, and mirror them into the TUI slash menu.
 * @param ctx - plugin context (injects `commands`).
 * @param config - the two layer directories.
 */
export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  const resolved = resolveConfig(config)
  const commands = await loadCommandFiles(resolved.userDir, resolved.projectDir)

  for (const command of commands.values()) {
    ctx.commands.register(buildDefinition(command))
  }

  // TUI 斜杠菜单（可选缝）：host CommandService 平面不进 TUI 的 `/` 菜单——菜单数
  // 据源是 tui.commands 注册表。执行仍委托下方 CommandService，保持 command/run
  // 与 command/done 生命周期事件（见 /next-workflow 同款双注册）。
  ctx.inject(['tui.commands'], (tuiCtx) => {
    const tuiCommands = tuiCtx.get('tui.commands') as TuiSlashFacet
    for (const command of commands.values()) {
      tuiCommands.register(buildTuiCommand(ctx, command))
    }
  })
}
