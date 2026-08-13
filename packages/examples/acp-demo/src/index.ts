/**
 * The ACP automation server app: the default agent spine
 * ({@link @huiliyi37/dsh-agent-spine-demo}), JSONL session persistence, and
 * the {@link @huiliyi37/dsh-acp} bridge. The app owns those plugins through one
 * ordered lifecycle so ACP sessions quiesce before persistence detaches. It
 * writes nothing to stdout.
 * It pre-creates no agents and leaves adapters, executors, and optional tools to
 * the leaf, which must likewise avoid stdout loggers. Named exports are
 * required so Loader retains this plugin's `Config` schema (see
 * docs/postmortem/0001).
 * @module @huiliyi37/dsh-acp-demo
 */

import type { Context } from '@huiliyi37/cordis'
import { join } from 'node:path'
import z from '@huiliyi37/schemastery'
import * as acp from '@huiliyi37/dsh-acp'
import * as agentCore from '@huiliyi37/dsh-agent-spine-demo'
import * as workspaceContext from '@huiliyi37/dsh-workspace-context'
import ToolRegistry, { type Config as ToolsConfig } from '@huiliyi37/dsh-tools'
import SessionPersistenceJsonl, {
  JsonlCompressionSchema,
  type JsonlCompression,
} from '@huiliyi37/dsh-session-persistence-jsonl'
import * as sessionCheckpointPolicy from '@huiliyi37/dsh-session-checkpoint-policy'
import SessionQuerySqlite from '@huiliyi37/dsh-session-query-sqlite'

export const name = 'acp-demo'
const DEFAULT_PERSISTENCE_ROOT = './.sessions'

/**
 * App config: the swappable per-deployment values. `provider` and `model` configure
 * each agent the ACP bridge creates at `session/new`; `persona` is the
 * deployment persona (forwarded to the system-prompt plugin); `toolOrder` is
 * the explicit model-facing tool order (forwarded to the system-prompt plugin);
 * `tools` is the tool registry's config (its presentation `mode`, forwarded
 * through agent-spine-demo); `persistenceRoot` is the JSONL backend's directory.
 */
export interface Config {
  /** Provider route for ACP-created agents. */
  provider: string
  /** Model name for ACP-created agents (must have a registered adapter). */
  model: string
  /** Bundled agent-loop concurrency cap; `1` is serial and omission uses its default. */
  maxParallelToolCalls?: number
  /** Deployment persona (the system-prompt plugin's `persona` config). */
  persona?: string
  /** Explicit model-facing tool order (the system-prompt plugin's `toolOrder` config; see dsh-system-prompt). */
  toolOrder?: string[]
  /** Tool-registry config — its presentation `mode` (forwarded through agent-spine-demo; see dsh-tools). */
  tools?: ToolsConfig
  /** Tianshu Harness home directory exposed to bash and used for local skill discovery. */
  dshHome?: string
  /** Fallback session-title limits forwarded through agent-spine-demo. */
  sessionTitle?: NonNullable<agentCore.Config['sessionTitle']>
  /** Directory for JSONL sessions and the derived query index. Defaults to `./.sessions`. */
  persistenceRoot?: string
  /** Write delta-chunk runs as packed storage rows (the JSONL backend's `packChunks`). Defaults to `true`. */
  packChunks?: boolean
  /** JSONL artifact encoding; defaults to checksummed Zstandard frames. */
  persistenceCompression?: JsonlCompression
  /** Controls automatic AGENTS.md/CLAUDE.md loading; configure a byte budget or set `false`. */
  workspaceContext: agentCore.Config['workspaceContext']
  /** Skill registry, local-provider, and model-facing consumer config forwarded to agent-spine-demo. */
  skills?: agentCore.SkillConfig
  /** Model-facing bash tool config forwarded through agent-core. */
  toolBash?: NonNullable<agentCore.Config['toolBash']>
  /** Generic background-task controls forwarded through agent-core; set false to omit their tool surface. */
  toolTasks?: NonNullable<agentCore.Config['toolTasks']>
  /** Persisted same-session goals; owner defaults enable them, or false disables the stack and tools. */
  goals?: agentCore.GoalConfig | false
}

// Each front door owns a complete, directly readable config schema; extracting
// the common fields would make two small app contracts depend on a new facade.
/* jscpd:ignore-start */
export const Config: z<Config> = z.object({
  provider: z.string().required(),
  model: z.string().required(),
  maxParallelToolCalls: z.number().step(1).min(1),
  persona: z.string(),
  // The array default is forced to undefined: ABSENT means "lexicographic
  // order" (the owning dsh-system-prompt schema does the same), while
  // schemastery's native [] default would read as an invalid configured list.
  toolOrder: z.array(z.string()).default(undefined as unknown as string[]),
  tools: ToolRegistry.Config,
  dshHome: z.string(),
  sessionTitle: agentCore.SessionTitleConfigSchema,
  persistenceRoot: z.string().default(DEFAULT_PERSISTENCE_ROOT),
  packChunks: z.boolean().default(true),
  persistenceCompression: JsonlCompressionSchema,
  workspaceContext: z.union([z.const(false), workspaceContext.Config]).required(),
  skills: agentCore.SkillConfigSchema,
  toolBash: agentCore.ToolBashConfigSchema,
  toolTasks: z.union([z.const(false), agentCore.ToolTasksConfigSchema]),
  goals: z.union([z.const(false), agentCore.GoalConfigSchema]),
})
/* jscpd:ignore-end */

/**
 * Compose the spine with the ACP automation transport. The agent-spine-demo bundle pre-creates
 * NO agents (its `agents` list defaults to `[]`) and carries the deployment
 * `persona`; the JSONL backend and derived query index persist under
 * `persistenceRoot`; the ACP bridge owns stdout for JSON-RPC and creates one
 * agent per `session/new` from the provider/model pair. The composite effect
 * unloads in reverse order, keeping checkpoint and persistence listeners
 * attached until ACP agents have flushed their closing events. No logger, no
 * `hmr` — stdout stays pure.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const goals = config.goals ?? {}
  const persistenceRoot = config.persistenceRoot ?? DEFAULT_PERSISTENCE_ROOT
  await ctx.effect(async function* () {
    const spine = ctx.plugin(agentCore, { ...agentCore.pickSpineConfig(config), goals })
    await spine
    yield spine.dispose
    // Same rationale as the Config schema above: each front door forwards its own
    // persistence passthroughs rather than sharing a facade with stdio-demo.
    /* jscpd:ignore-start */
    const persistence = ctx.plugin(SessionPersistenceJsonl, {
      root: persistenceRoot,
      ...config.packChunks !== undefined ? { packChunks: config.packChunks } : {},
      ...(config.persistenceCompression !== undefined ? { compression: config.persistenceCompression } : {}),
    })
    await persistence
    yield persistence.dispose
    /* jscpd:ignore-end */
    const checkpoint = ctx.plugin(sessionCheckpointPolicy)
    await checkpoint
    yield checkpoint.dispose
    const query = ctx.plugin(SessionQuerySqlite, { path: join(persistenceRoot, 'session-query.db') })
    await query
    yield query.dispose
    const transport = ctx.plugin(acp, { provider: config.provider, model: config.model })
    await transport
    yield transport.dispose
  }, 'acp-demo.composition')
}
