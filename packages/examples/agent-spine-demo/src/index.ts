/**
 * Default executor-less, UI-less agent spine. It bundles the common services,
 * background-task registry and controls, optional persisted goals, concrete loop, local skill and
 * workspace-context providers, and model-facing bash/skill consumers;
 * deployments still choose the LLM adapter, bash executor, and presentation.
 * The plugin intentionally exposes named exports only because Loader default
 * unwrapping would discard its `Config` schema (see docs/postmortem/0001).
 * @module @deepseek-ai/dsh-agent-spine-demo
 */

import type { Context } from 'cordis'
import Timer from '@cordisjs/plugin-timer'
import z from 'schemastery'
import LlmService from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionTitleService, { type Config as SessionTitleConfig } from '@deepseek-ai/dsh-session-title'
import SystemPrompt, { type Config as SystemPromptConfig } from '@deepseek-ai/dsh-system-prompt'
import ToolRegistry, { type Config as ToolsConfig } from '@deepseek-ai/dsh-tools'
import SkillService, { type Config as SkillRegistryConfig } from '@deepseek-ai/dsh-skill'
import * as SkillLocal from '@deepseek-ai/dsh-skill-local'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import GoalService, { type Config as GoalDomainConfig } from '@deepseek-ai/dsh-goal'
import * as goalSession from '@deepseek-ai/dsh-goal-session'
import * as toolGoal from '@deepseek-ai/dsh-tool-goal'
import LocalTaskService from '@deepseek-ai/dsh-tasks-local'
import InvariantService, { type Config as InvariantConfig } from '@deepseek-ai/dsh-invariants'
import * as sessionInvariant from '@deepseek-ai/dsh-session/invariant'
import * as agentInvariant from '@deepseek-ai/dsh-agent/invariant'
import * as scopeInvariant from '@deepseek-ai/dsh-scope/invariant'
import * as agentLoopInvariant from '@deepseek-ai/dsh-agent-loop/invariant'
import * as toolBash from '@deepseek-ai/dsh-tool-bash'
import * as bashEnv from '@deepseek-ai/dsh-bash-env'
import * as workspaceContext from '@deepseek-ai/dsh-workspace-context'
import * as toolSkill from '@deepseek-ai/dsh-tool-skill'
import * as toolTasks from '@deepseek-ai/dsh-tool-tasks'
import AgentLoop, { type Config as AgentLoopConfig } from '@deepseek-ai/dsh-agent-loop'
import * as llmRetry from '@deepseek-ai/dsh-llm-retry'
import { resolveDshHome } from '@deepseek-ai/dsh-paths'

export const name = 'agent-spine-demo'

/** Overridable example policy used when a bundle consumer omits `sessionTitle`. */
const EXAMPLE_SESSION_TITLE_CONFIG: SessionTitleConfig = {
  fallbackMaxWords: 5,
  fallbackMaxBytes: 40,
  maxTitleBytes: 80,
}

/** Skill bundle config forwarded to the registry, local provider, and model-facing consumer. */
export interface SkillConfig {
  /** Mount the bundled local skill provider and model-facing skill tool (default true). */
  enabled?: boolean
  /** Registry-level discovery cache settings. */
  registry?: SkillRegistryConfig
  /** Local filesystem skill provider settings. */
  local?: SkillLocal.Config
  /** Model-facing skill catalog and tool settings. */
  tool?: toolSkill.Config
}

/** Persisted goal domain, model-tool policy, and same-session driver config. */
export interface GoalConfig {
  /** Goal-domain creation defaults. */
  domain?: GoalDomainConfig
  /** Model-facing goal-tool authority policy. */
  tool?: toolGoal.Config
}

/**
 * Bundle config: each field forwarded verbatim to the child that owns it —
 * `agents` to the agent loop (an app that pre-creates no agents, like the ACP
 * bridge, simply omits it), `includeHarnessIdentity`, `persona`, and `toolOrder`
 * to the system-prompt plugin (the fixed opener, deployment persona, and explicit
 * model-facing tool order), the `tools` object to the tool registry (its presentation `mode`),
 * `dshHome` to bash environment and local skill discovery, `sessionTitle` to
 * the fallback title service, `skills` to the
 * skill registry/local provider/tool consumer, `workspaceContext` to the
 * workspace-context loader, and `toolBash`/`toolTasks` to the model-facing tool
 * plugins this bundle owns. Provider adapters own their `retryPolicy`; this
 * bundle always mounts its executor.
 * `goals` opts into and configures the persisted goal domain plus its model tool
 * and same-session driver; `invariants` configures global and package-filtered
 * relational checks. Owner schemas supply defaults for optional input;
 * workspace context instead requires an explicit byte budget or `false` because
 * it changes model-visible input. Producer opt-in stays producer-local:
 * `toolBash` configures bash only; independently composed producers keep their
 * own config. Set `toolBash: false` when another plugin owns the model-facing
 * `bash` name.
 */
export interface Config {
  /** The agent-loop `agents` list (see dsh-agent-loop's `Config`). */
  agents?: AgentLoopConfig['agents']
  /** Agent-loop concurrency cap; `1` is serial. */
  maxParallelToolCalls?: AgentLoopConfig['maxParallelToolCalls']
  /** Whether the system prompt includes the fixed Harness identity (default true). */
  includeHarnessIdentity?: SystemPromptConfig['includeHarnessIdentity']
  /** The deployment persona (see dsh-system-prompt's `Config`). */
  persona?: SystemPromptConfig['persona']
  /** The explicit model-facing tool order (see dsh-system-prompt's `Config`). */
  toolOrder?: SystemPromptConfig['toolOrder']
  /** The tool registry's config — its presentation `mode` (see dsh-tools' `Config`). */
  tools?: ToolsConfig
  /** DeepSeek Harness home directory shared by shell context and local skill discovery. */
  dshHome?: string
  /** Deterministic fallback and accepted-title limits; omission uses the bundle's example policy. */
  sessionTitle?: SessionTitleConfig
  /** Workspace-context loader controls with an explicit byte budget; set `false` for hermetic prompts. */
  workspaceContext: workspaceContext.Config | false
  /**
   * Skill registry, local provider, and model-facing consumer config.
   * Skills use `enabled` because one nested config controls a provider stack;
   * single model-tool plugins use `Config | false` to disable that one consumer.
   */
  skills?: SkillConfig
  /** Model-facing bash tool config, or false when another plugin owns `bash`. */
  toolBash?: toolBash.Config | false
  /** Generic background-task controls; set false to keep the task service without model-facing task tools. */
  toolTasks?: toolTasks.Config | false
  /** Global enablement and package-name filters for invariant companions. */
  invariants?: InvariantConfig
  /** Opt-in persisted same-session goal stack; set false or omit to leave it unmounted. */
  goals?: GoalConfig | false
}

/** The skill config schema exported for app packages that forward `skills`. */
export const SkillConfigSchema: z<SkillConfig> = z.object({
  enabled: z.boolean().default(true),
  registry: SkillService.Config,
  local: SkillLocal.Config,
  tool: toolSkill.Config,
})

/** The session-title config schema with the shared bundle's overridable example limits. */
export const SessionTitleConfigSchema: z<SessionTitleConfig> = SessionTitleService.Config
  .default(EXAMPLE_SESSION_TITLE_CONFIG)

/** The bash-tool config schema exported for app packages that forward `toolBash`. */
export const ToolBashConfigSchema: z<toolBash.Config | false> =
  z.union([z.const(false), toolBash.Config])

/** The task-control-tool config schema exported for app packages that forward `toolTasks`. */
export const ToolTasksConfigSchema: z<toolTasks.Config> = toolTasks.Config

/** The persisted-goal config schema exported for app packages that opt in. */
export const GoalConfigSchema: z<GoalConfig> = z.object({
  domain: GoalService.Config,
  tool: toolGoal.Config,
})

/** Intersect the owners' schemas so validation + defaulting stay identical. */
export const Config = z.intersect([
  AgentLoop.Config,
  SystemPrompt.Config,
  z.object({
    tools: ToolRegistry.Config,
    dshHome: z.string(),
    sessionTitle: SessionTitleConfigSchema,
    skills: SkillConfigSchema,
    workspaceContext: z.union([z.const(false), workspaceContext.Config]).required(),
    toolBash: ToolBashConfigSchema,
    toolTasks: z.union([z.const(false), ToolTasksConfigSchema]),
    invariants: InvariantService.Config,
    goals: z.union([z.const(false), GoalConfigSchema]),
  }) as unknown as z<Pick<Config, 'tools' | 'dshHome' | 'sessionTitle' | 'skills' | 'workspaceContext' | 'toolBash' | 'toolTasks' | 'invariants' | 'goals'>>,
]) as unknown as z<Config>

/**
 * Copy the bundle-owned fields from an app config without leaking front-door settings.
 * @param config - App config containing the shared spine fields.
 * @returns The fields accepted by this bundle, preserving optional absence.
 */
export function pickSpineConfig(config: Omit<Config, 'agents'>): Omit<Config, 'agents'> {
  return {
    ...config.maxParallelToolCalls !== undefined ? { maxParallelToolCalls: config.maxParallelToolCalls } : {},
    ...config.includeHarnessIdentity !== undefined ? { includeHarnessIdentity: config.includeHarnessIdentity } : {},
    ...config.persona !== undefined ? { persona: config.persona } : {},
    ...config.toolOrder !== undefined ? { toolOrder: config.toolOrder } : {},
    ...config.tools !== undefined ? { tools: config.tools } : {},
    ...config.dshHome !== undefined ? { dshHome: config.dshHome } : {},
    ...config.sessionTitle !== undefined ? { sessionTitle: config.sessionTitle } : {},
    workspaceContext: config.workspaceContext,
    ...config.skills !== undefined ? { skills: config.skills } : {},
    ...config.toolBash !== undefined ? { toolBash: config.toolBash } : {},
    ...config.toolTasks !== undefined ? { toolTasks: config.toolTasks } : {},
    ...config.invariants !== undefined ? { invariants: config.invariants } : {},
    ...config.goals !== undefined ? { goals: config.goals } : {},
  }
}

/**
 * Load the spine. Each `ctx.plugin(...)` mounts one child of the bundle fiber;
 * `agent-loop` receives the forwarded `agents` list and `system-prompt` the
 * forwarded `persona` and `toolOrder`. Workspace-context receives its own
 * explicitly forwarded config. Load order is irrelevant (cordis
 * pends each fiber on its `inject` until the services it needs exist), but the
 * listing mirrors the dependency layering for readability: the LLM vocabulary
 * and core registries first, then extension plugins that wrap request/tool
 * seams, then the loop that drives them.
 */
export function apply(ctx: Context, config: Config): void {
  const nestedDshHome = config.skills?.local?.dshHome
  if (config.dshHome !== undefined && nestedDshHome !== undefined
    && resolveDshHome(config.dshHome) !== resolveDshHome(nestedDshHome)) {
    throw new Error('agent-spine-demo: dshHome and skills.local.dshHome must resolve to the same directory')
  }
  const dshHome = resolveDshHome(config.dshHome ?? nestedDshHome)

  ctx.plugin(Timer)
  ctx.plugin(LlmService)
  ctx.plugin(SessionStore)
  ctx.plugin(SessionTitleService, config.sessionTitle ?? EXAMPLE_SESSION_TITLE_CONFIG)
  // Owner schemas resolve defaults; forward toolOrder only when explicitly set.
  ctx.plugin(SystemPrompt, {
    includeHarnessIdentity: config.includeHarnessIdentity ?? true,
    persona: config.persona ?? '',
    ...config.toolOrder !== undefined ? { toolOrder: config.toolOrder } : {},
  })
  ctx.plugin(ToolRegistry, config.tools ?? {})
  const skillsEnabled = config.skills?.enabled ?? true
  if (skillsEnabled) {
    ctx.plugin(SkillService, config.skills?.registry ?? {})
    ctx.plugin(SkillLocal, Object.assign({}, config.skills?.local, { dshHome }))
  }
  ctx.plugin(AgentRegistry)
  ctx.plugin(llmRetry)
  if (config.goals !== undefined && config.goals !== false) {
    ctx.plugin(GoalService, config.goals.domain ?? {})
    ctx.plugin(toolGoal, config.goals.tool ?? {})
    ctx.plugin(goalSession)
  }
  ctx.plugin(LocalTaskService)
  ctx.plugin(InvariantService, config.invariants ?? {})
  ctx.plugin(sessionInvariant)
  ctx.plugin(agentInvariant)
  ctx.plugin(scopeInvariant)
  ctx.plugin(agentLoopInvariant)
  if (config.toolBash !== false) {
    ctx.plugin(bashEnv, { dshHome })
    ctx.plugin(toolBash, config.toolBash ?? {})
  }
  if (config.workspaceContext !== false) {
    ctx.plugin(workspaceContext, config.workspaceContext)
  }
  // Both plugins prepend session-prefix messages. Registration order is the
  // rendered order, so workspace instructions must precede the skill catalog.
  if (skillsEnabled) { ctx.plugin(toolSkill, config.skills?.tool ?? {}) }
  if (config.toolTasks !== false) ctx.plugin(toolTasks, config.toolTasks ?? {})
  ctx.plugin(AgentLoop, {
    agents: config.agents ?? [],
    ...config.maxParallelToolCalls !== undefined ? { maxParallelToolCalls: config.maxParallelToolCalls } : {},
  })
}
